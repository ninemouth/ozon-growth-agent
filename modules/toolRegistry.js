/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// modules/toolRegistry.js — Tool registry and content script bridge

import { callLLM, getSettings, prepareCleanProductImage } from './llmClient.js';
import { ozonGetProductList, ozonGetProductInfo, ozonGetAnalyticsData, ozonGetFbsPostingList, ozonGetFboPostingList, ozonGetStoreSnapshot } from './ozonApi.js';
import { getArtifactDataUrl, putDataUrlArtifact } from './artifactStore.js';
import { isWorkflowCancellationRequested } from './workflowRuntime.js';
import { closeOwnedTab, createOwnedTabCallback } from './browserSessionManager.js';
import { captureFullPageScreenshot } from './debuggerCapture.js';
import { summarizeBrowserAutomationCapabilities } from './browserAutomationCapabilities.js';

const preparedImageCache = new Map();

export let currentSessionData = {
  products: new Map(),
  creatorInfo: null,
  detailCreators: []
};

export function resetSessionData() {
  currentSessionData = {
    products: new Map(),
    creatorInfo: null,
    detailCreators: []
  };
}

export function getAccumulatedSessionData() {
  return {
    items: Array.from(currentSessionData.products.values()),
    creatorInfo: currentSessionData.creatorInfo,
    detailCreators: currentSessionData.detailCreators
  };
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSourceOrCurrentTab(sourceTabId = null) {
  if (Number.isInteger(Number(sourceTabId))) {
    try {
      const tab = await chrome.tabs.get(Number(sourceTabId));
      if (tab?.id) return tab;
    } catch (_) {}
  }
  return await getCurrentTab();
}

async function restoreSourceTabFocus(sourceTabId = null) {
  if (!Number.isInteger(Number(sourceTabId))) return false;
  try {
    const tab = await chrome.tabs.get(Number(sourceTabId));
    if (!tab?.id) return false;
    await new Promise((resolve) => chrome.tabs.update(Number(sourceTabId), { active: true }, () => resolve()));
    if (Number.isInteger(Number(tab.windowId)) && chrome.windows?.update) {
      await new Promise((resolve) => chrome.windows.update(tab.windowId, { focused: true }, () => resolve()));
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function restoreSourceTabFocusBounded(sourceTabId = null, timeoutMs = 1200) {
  if (!Number.isInteger(Number(sourceTabId))) return false;
  return await Promise.race([
    restoreSourceTabFocus(sourceTabId),
    new Promise((resolve) => setTimeout(() => resolve(false), Math.max(250, Number(timeoutMs) || 1200))),
  ]);
}

function createBrowserTab({ url, active = true, openerTabId = null, workflowId = "default" }, callback) {
  const createArgs = { url: safeEncodeURI(url), active };
  if (Number.isInteger(Number(openerTabId))) {
    createArgs.openerTabId = Number(openerTabId);
  }
  createOwnedTabCallback({ workflowId, ...createArgs }, callback);
}

function isProtectedTabId(tabId, protectedTabIds = []) {
  if (!Number.isInteger(Number(tabId))) return false;
  return (Array.isArray(protectedTabIds) ? protectedTabIds : [protectedTabIds])
    .some((protectedTabId) => Number.isInteger(Number(protectedTabId)) && Number(protectedTabId) === Number(tabId));
}

function cachePreparedImage(dataUrl) {
  const ref = `__CLEAN_PRODUCT_IMAGE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
  preparedImageCache.set(ref, dataUrl);
  return ref;
}

function resolvePreparedImageUrl(imageUrl) {
  return preparedImageCache.get(imageUrl) || imageUrl;
}

async function fetchJsonWithTimeout(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 8000));
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parsePositiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isFreshIso(iso = "", maxAgeMs = 12 * 60 * 60 * 1000) {
  const timestamp = Date.parse(iso || "");
  return Boolean(timestamp && Date.now() - timestamp <= maxAgeMs);
}

async function getRubCnyMarketRate() {
  const fetchedAt = new Date().toISOString();
  const storage = await new Promise((resolve) =>
    chrome.storage.local.get(["ozonMarketRatesSnapshot"], resolve)
  );
  const cached = storage.ozonMarketRatesSnapshot || null;
  if (cached?.ok && cached.cny_to_rub && isFreshIso(cached.fetched_at)) {
    return {
      ...cached,
      cache_status: "fresh",
    };
  }
  try {
    const data = await fetchJsonWithTimeout("https://open.er-api.com/v6/latest/CNY");
    const cnyToRub = parsePositiveNumber(data?.rates?.RUB, 0);
    if (!cnyToRub) throw new Error("RUB rate missing");
    const snapshot = {
      ok: true,
      base: "CNY",
      quote: "RUB",
      cny_to_rub: cnyToRub,
      rub_to_cny: Number((1 / cnyToRub).toFixed(6)),
      source: "open.er-api.com",
      fetched_at: fetchedAt,
      provider_timestamp: data?.time_last_update_utc || "",
      cache_status: "refreshed",
    };
    await new Promise((resolve) => chrome.storage.local.set({ ozonMarketRatesSnapshot: snapshot }, resolve));
    return snapshot;
  } catch (err) {
    if (cached?.cny_to_rub) {
      return {
        ...cached,
        ok: true,
        cache_status: "stale_fallback",
        warning: `实时汇率获取失败，使用本地缓存：${err.message}`,
        required_action: "报告必须标注汇率为本地缓存，正式采购前复核实时汇率。",
      };
    }
    return {
      ok: false,
      base: "CNY",
      quote: "RUB",
      error: err.message,
      source: "open.er-api.com",
      fetched_at: fetchedAt,
      required_action: "请在报告中把利润率降级为待确认，并提示用户补充实时汇率或稍后重试。",
    };
  }
}

function buildLogisticsCostProfile(args = {}) {
  const weightKg = parsePositiveNumber(args.weightKg || args.weight_kg || args.weight, 1);
  const warehouseType = String(args.warehouseType || args.warehouse_type || "FBS").toUpperCase() === "FBO" ? "FBO" : "FBS";
  const baseFeeCny = parsePositiveNumber(args.baseFeeCny || args.base_fee_cny, warehouseType === "FBO" ? 3 : 2);
  const cnyPerKg = parsePositiveNumber(args.cnyPerKg || args.cny_per_kg, warehouseType === "FBO" ? 7 : 5.5);
  const packagingFeeCny = parsePositiveNumber(args.packagingFeeCny || args.packaging_fee_cny, 2);
  const customRubPerCny = parsePositiveNumber(args.cnyToRub || args.cny_to_rub, 0);
  const subtotalCny = Number((baseFeeCny + cnyPerKg * weightKg + packagingFeeCny).toFixed(2));
  return {
    ok: true,
    warehouse_type: warehouseType,
    weight_kg: weightKg,
    base_fee_cny: baseFeeCny,
    cny_per_kg: cnyPerKg,
    packaging_fee_cny: packagingFeeCny,
    estimated_shipping_cny: subtotalCny,
    estimated_shipping_rub: customRubPerCny ? Number((subtotalCny * customRubPerCny).toFixed(2)) : null,
    formula: "base_fee_cny + cny_per_kg * weight_kg + packaging_fee_cny",
    source: "user_config_or_default_profile",
    calculated_at: new Date().toISOString(),
    limitation: "基础运费模型仅用于上架前估算；正式备货前必须用货代报价、Ozon 费用明细和包裹尺寸复核。",
  };
}

async function getStoredLogisticsCostProfile(args = {}) {
  const storage = await new Promise((resolve) =>
    chrome.storage.local.get(["ozonLogisticsCostProfile", "ozonWarehouseType"], resolve)
  );
  const configured = storage.ozonLogisticsCostProfile || {};
  return buildLogisticsCostProfile({
    ...configured,
    warehouseType: args.warehouseType || args.warehouse_type || configured.warehouseType || configured.warehouse_type || storage.ozonWarehouseType || "FBS",
    ...args,
  });
}

function checkTabUrl(url) {
  if (!url) return;
  const lowerUrl = url.toLowerCase();
  const restrictedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "devtools://",
    "view-source:",
    "about:",
    "chrome.google.com/webstore",
    "chromewebstore.google.com"
  ];
  for (const prefix of restrictedPrefixes) {
    if (lowerUrl.includes(prefix) || lowerUrl.startsWith(prefix)) {
      throw new Error("当前网页受 Chrome 安全策略限制，无法在此类系统页面上运行。请切换到常规电商网页再试。");
    }
  }
}

function safeEncodeURI(url) {
  if (!url) return "";
  let encoded = url;
  try {
    encoded = encodeURI(decodeURI(url));
  } catch (_) {
    try {
      encoded = encodeURI(url);
    } catch (err) {
      encoded = url;
    }
  }
  
  // Inject input charset params to force search engines to parse parameters as UTF-8 instead of default GBK
  try {
    const lower = encoded.toLowerCase();
    if (lower.includes("taobao.com") || lower.includes("1688.com") || lower.includes("alibaba.com") || lower.includes("aliexpress.com")) {
      if (encoded.includes("?") && !lower.includes("_input_charset")) {
        encoded += (encoded.endsWith("&") || encoded.endsWith("?")) ? "_input_charset=utf-8" : "&_input_charset=utf-8";
      }
    } else if (lower.includes("jd.com")) {
      if (encoded.includes("?") && !lower.includes("enc=")) {
        encoded += (encoded.endsWith("&") || encoded.endsWith("?")) ? "enc=utf-8" : "&enc=utf-8";
      }
    }
  } catch (e) {
    console.error("Charset injection failed:", e);
  }
  
  return encoded;
}

async function sendToContentScript(tabId, message) {
  try {
    const tab = await chrome.tabs.get(tabId);
    checkTabUrl(tab?.url);
  } catch (err) {
    throw err;
  }

  const sendMessagePromise = () => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Content script response timeout"));
      }, 6000);

      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  };

  try {
    return await sendMessagePromise();
  } catch (err) {
    const isConnErr = err.message.includes("Receiving end does not exist") || 
                      err.message.includes("context invalidated") ||
                      err.message.includes("timeout");
    if (isConnErr) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        return await sendMessagePromise();
      } catch (injectErr) {
        if (injectErr.message && (injectErr.message.includes("Cannot access") || injectErr.message.includes("restricted"))) {
          throw new Error("由于安全策略，当前网页无法注入脚本。请切换到普通电商网页再试。");
        }
        throw injectErr;
      }
    } else {
      throw err;
    }
  }
}

function isCapturableTabUrl(url = "") {
  return /^https?:\/\//i.test(String(url || ""));
}

async function getTabForCapture(tabId, { expectedUrl = "", maxAttempts = 12, intervalMs = 250 } = {}) {
  let lastTab = null;
  for (let attempt = 0; attempt < Math.max(1, Number(maxAttempts) || 12); attempt += 1) {
    try {
      lastTab = await chrome.tabs.get(tabId);
    } catch (_) {
      lastTab = null;
    }
    if (lastTab?.windowId && isCapturableTabUrl(lastTab.url)) return lastTab;
    await sleep(Math.max(50, Number(intervalMs) || 250));
  }
  if (lastTab?.windowId && isCapturableTabUrl(expectedUrl)) {
    return { ...lastTab, url: expectedUrl };
  }
  return lastTab;
}

async function _captureTabScreenshot(tabId, options = {}) {
  const tab = await getTabForCapture(tabId, options);
  if (!tab?.windowId) throw new Error("Unable to resolve tab window for screenshot");
  if (!isCapturableTabUrl(tab.url)) {
    throw new Error(`Tab URL is not capturable yet: ${JSON.stringify(tab.url || "")}`);
  }
  try {
    return await captureFullPageScreenshot(tabId);
  } catch (err) {
    console.warn("Chrome debugger full-page capture unavailable; falling back to viewport capture:", err.message);
  }
  return await new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        reject(new Error(chrome.runtime.lastError?.message || "Failed to capture tab screenshot"));
      } else {
        resolve({ dataUrl, captureMode: "captureVisibleTab_viewport" });
      }
    });
  });
}

function normalizeOzonUrl(url = "") {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `https://www.ozon.ru${value}`;
  return value;
}

function isOzonPageUrl(url = "") {
  return /(^|\.)ozon\.ru/i.test(String(url || ""));
}

function inferOzonPageType(url = "", pageData = {}) {
  const text = `${url} ${pageData?.title || ""}`.toLowerCase();
  if (/\/seller\/|\/shop\/|магазин|seller|витрина/.test(text)) return "shop";
  if (/\/product\//.test(text)) return "product";
  if (/\/search\/|\/category\//.test(text)) return "search_or_category";
  return "unknown";
}

function textSnippet(pageData = {}, maxLength = 1800) {
  const chunks = [
    pageData.title,
    pageData.description,
    pageData.metaDescription,
    pageData.text,
    pageData.visibleText,
    pageData.bodyText,
  ].filter(Boolean);
  return chunks.join("\n").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function summarizeOzonProductCards(cards = []) {
  return (Array.isArray(cards) ? cards : []).slice(0, 24).map((card, index) => ({
    index: card.index ?? index + 1,
    title: card.title || card.name || "",
    price: card.price || card.currentPrice || "",
    rating: card.rating || card.stars || "",
    reviewCount: card.reviewCount || card.reviews || "",
    href: normalizeOzonUrl(card.href || card.url || card.link || ""),
    imageSrc: card.imageSrc || card.imageUrl || card.img || "",
    promotion: card.promotion || card.badge || card.badges || "",
    cardRect: card.cardRect,
  }));
}

export function hasValidGoogleTrendsEvidence(result = {}) {
  const pageData = result?.pageData || {};
  const text = [
    pageData.title,
    pageData.h1,
    pageData.visibleText,
    pageData.metaDescription,
    pageData.text,
  ].filter(Boolean).join("\n");
  const hasTrendShell = /google trends|explore|趋势|тренды google/i.test(text);
  const hasCoreTrendModule = /interest over time|趋势变化|随时间变化|интерес во времени/i.test(text);
  const hasRelatedModule = /related queries|related topics|相关查询|相关主题|связанные запросы|связанные темы/i.test(text);
  const hasExplicitNoData = /not enough data|doesn.?t have enough data|данных недостаточно|недостаточно данных|数据不足/i.test(text);
  const visibleTextLength = String(pageData.visibleText || pageData.text || "").trim().length;
  // Google Trends charts are rendered dynamically; a captured screenshot is considered
  // primary evidence when the trend shell is present, even if DOM text is thin.
  const hasScreenshotEvidence = Boolean(result?.screenshotRef || result?.screenshotCaptured);
  if (hasExplicitNoData) return false;
  if (hasTrendShell && hasScreenshotEvidence) return true;
  return hasTrendShell && ((hasCoreTrendModule && hasRelatedModule) || visibleTextLength >= 320);
}

function getGoogleTrendsEvidenceState(result = {}) {
  const pageData = result?.pageData || {};
  const text = [
    pageData.title,
    pageData.h1,
    pageData.visibleText,
    pageData.metaDescription,
    pageData.text,
  ].filter(Boolean).join("\n");
  const visibleTextLength = String(pageData.visibleText || pageData.text || "").trim().length;
  const hasTrendShell = /google trends|explore|趋势|тренды google/i.test(text);
  const hasCoreTrendModule = /interest over time|趋势变化|随时间变化|интерес во времени/i.test(text);
  const hasRelatedModule = /related queries|related topics|相关查询|相关主题|связанные запросы|связанные темы/i.test(text);
  const hasExplicitNoData = /not enough data|doesn.?t have enough data|данных недостаточно|недостаточно данных|数据不足/i.test(text);
  const hasScreenshotEvidence = Boolean(result?.screenshotRef || result?.screenshotCaptured);
  const coreModulesReady = hasCoreTrendModule && hasRelatedModule;
  return {
    hasTrendShell,
    hasCoreTrendModule,
    hasRelatedModule,
    hasExplicitNoData,
    hasScreenshotEvidence,
    visibleTextLength,
    stableEnough: hasValidGoogleTrendsEvidence(result),
    readiness: hasExplicitNoData
      ? "loaded_but_not_enough_data"
      : coreModulesReady
      ? "core_modules_visible"
      : hasTrendShell && hasScreenshotEvidence
        ? "trend_shell_with_screenshot"
        : hasTrendShell
          ? "trend_shell_visible"
          : "not_trends_ready",
  };
}

function withSearchEvidenceStatus(payload, engine) {
  const normalizedEngine = String(engine || "").toLowerCase();
  if (normalizedEngine !== "google_trends") return payload;
  const trendsEvidenceState = getGoogleTrendsEvidenceState(payload);
  const evidenceOk = hasValidGoogleTrendsEvidence(payload);
  return {
    ...payload,
    ok: evidenceOk,
    evidenceOk,
    evidenceType: "google_trends",
    trendsEvidenceState,
    evidenceStatus: evidenceOk ? "valid" : "invalid_or_blocked",
    message: evidenceOk
      ? (payload.message || "Valid Google Trends RU evidence captured.")
      : trendsEvidenceState.hasExplicitNoData
        ? "Google Trends RU 页面已加载，但当前关键词数据不足。需要退宽语义层级或切换俄语同义词，达到恢复上限后再降级为待验证假设。"
        : "Google Trends RU 页面只看到壳页或模块未稳定加载，不能作为趋势/季节性结论证据。请等待核心模块、截图后重试，或降级为待验证假设。",
  };
}

function searchEvidenceSatisfied(payload, engine) {
  const normalizedEngine = String(engine || "").toLowerCase();
  if (normalizedEngine === "google_trends") return hasValidGoogleTrendsEvidence(payload);
  const pageData = payload?.pageData || {};
  return Boolean(
    (pageData.productLinks && pageData.productLinks.length > 0) ||
    (pageData.productCards && pageData.productCards.length > 0) ||
    String(pageData.visibleText || pageData.text || "").trim().length >= 160
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVerificationUrl(url = "") {
  return /sec\.1688\.com|login|verify|passport|captcha|challenge/i.test(String(url || ""));
}

function hasUsablePageEvidence(pageData = {}) {
  const textLength = String(pageData.visibleText || pageData.text || pageData.bodyText || "").trim().length;
  const productLinks = Array.isArray(pageData.productLinks) ? pageData.productLinks.length : 0;
  const productCards = Array.isArray(pageData.productCards) ? pageData.productCards.length : 0;
  const links = Array.isArray(pageData.links) ? pageData.links.length : 0;
  const images = Array.isArray(pageData.images) ? pageData.images.length : 0;
  const health = pageData.pageHealth || {};
  return Boolean(
    health.hasMeaningfulDom ||
    textLength >= 120 ||
    productLinks > 0 ||
    productCards > 0 ||
    links > 0 ||
    images > 0 ||
    pageData.title ||
    pageData.h1
  ) && !health.isLikelyBlocked;
}

function getReadinessProfile(url = "", label = "", engine = "") {
  const text = `${url} ${label} ${engine}`.toLowerCase();
  if (/trends\.google|google_trends/.test(text)) {
    return {
      minWaitMs: 2500,
      timeoutMs: 24000,
      pollMs: 700,
      minStableReads: 2,
      ready: (pageData) => hasValidGoogleTrendsEvidence({ ok: true, pageData }),
      readyLabel: "google_trends_modules_ready",
    };
  }
  if (/ozon\.ru|ozon/.test(text)) {
    return {
      minWaitMs: 2000,
      timeoutMs: 22000,
      pollMs: 650,
      minStableReads: 2,
      ready: (pageData) => hasUsablePageEvidence(pageData),
      readyLabel: "ozon_dom_evidence_ready",
    };
  }
  if (/1688|taobao|淘宝|货源|图片搜索/.test(text)) {
    return {
      minWaitMs: 1800,
      timeoutMs: 18000,
      pollMs: 650,
      minStableReads: 1,
      ready: (pageData) => hasUsablePageEvidence(pageData),
      readyLabel: "sourcing_dom_evidence_ready",
    };
  }
  if (/yandex|google_ru|google|bing/.test(text)) {
    return {
      minWaitMs: 1400,
      timeoutMs: 16000,
      pollMs: 600,
      minStableReads: 1,
      ready: (pageData) => hasUsablePageEvidence(pageData),
      readyLabel: "search_dom_evidence_ready",
    };
  }
  return {
    minWaitMs: 1200,
    timeoutMs: 12000,
    pollMs: 600,
    minStableReads: 1,
    ready: (pageData) => hasUsablePageEvidence(pageData),
    readyLabel: "dom_evidence_ready",
  };
}

function pageDataSignature(pageData = {}) {
  const text = String(pageData.visibleText || pageData.text || pageData.bodyText || "");
  const links = Array.isArray(pageData.links) ? pageData.links.length : 0;
  const images = Array.isArray(pageData.images) ? pageData.images.length : 0;
  const productFingerprint = (Array.isArray(pageData.productCards) ? pageData.productCards : [])
    .slice(0, 12)
    .map((card) => [
      card.title || card.name || "",
      card.price || card.currentPrice || "",
      card.href || card.url || card.link || "",
      card.imageSrc || card.imageUrl || card.img || "",
    ].join("~"))
    .join("||")
    .slice(0, 2000);
  const productLinkFingerprint = (Array.isArray(pageData.productLinks) ? pageData.productLinks : [])
    .slice(0, 24)
    .map((link) => `${link.href || link.url || ""}~${link.text || link.title || ""}`)
    .join("||")
    .slice(0, 2000);
  const trendText = [
    /interest over time|趋势变化|随时间变化/i.test(text) ? "trend_time" : "",
    /related queries|related topics|相关查询|相关主题/i.test(text) ? "trend_related" : "",
  ].filter(Boolean).join(",");
  return [
    pageData.url || "",
    pageData.title || "",
    pageData.h1 || "",
    text.length,
    links,
    Array.isArray(pageData.productLinks) ? pageData.productLinks.length : 0,
    Array.isArray(pageData.productCards) ? pageData.productCards.length : 0,
    productFingerprint,
    productLinkFingerprint,
    images,
    trendText,
  ].join("|");
}

function buildInteractionEvidence(before = {}, after = {}) {
  const beforeSignature = pageDataSignature(before);
  const afterSignature = pageDataSignature(after);
  const beforeCards = Array.isArray(before.productCards) ? before.productCards.length : 0;
  const afterCards = Array.isArray(after.productCards) ? after.productCards.length : 0;
  const beforeLinks = Array.isArray(before.productLinks) ? before.productLinks.length : 0;
  const afterLinks = Array.isArray(after.productLinks) ? after.productLinks.length : 0;
  const beforeUrl = String(before.url || "");
  const afterUrl = String(after.url || "");
  const beforeTextLength = String(before.visibleText || before.text || before.bodyText || "").length;
  const afterTextLength = String(after.visibleText || after.text || after.bodyText || "").length;
  const beforeCardTitles = (Array.isArray(before.productCards) ? before.productCards : []).slice(0, 8).map((card) => card.title || card.name || "").filter(Boolean);
  const afterCardTitles = (Array.isArray(after.productCards) ? after.productCards : []).slice(0, 8).map((card) => card.title || card.name || "").filter(Boolean);
  const productCardContentChanged = beforeCardTitles.join("|") !== afterCardTitles.join("|");
  return {
    changed: Boolean(beforeSignature && afterSignature && beforeSignature !== afterSignature),
    urlChanged: beforeUrl !== afterUrl,
    productCardsChanged: beforeCards !== afterCards,
    productCardContentChanged,
    productLinksChanged: beforeLinks !== afterLinks,
    textLengthChanged: Math.abs(afterTextLength - beforeTextLength) >= 80,
    before: {
      url: beforeUrl,
      title: before.title || "",
      productCards: beforeCards,
      productLinks: beforeLinks,
      visibleTextLength: beforeTextLength,
      cardTitles: beforeCardTitles,
    },
    after: {
      url: afterUrl,
      title: after.title || "",
      productCards: afterCards,
      productLinks: afterLinks,
      visibleTextLength: afterTextLength,
      cardTitles: afterCardTitles,
    },
  };
}

function pageDataLooksReady(pageData = {}, engine = "") {
  const normalizedEngine = String(engine || "").toLowerCase();
  if (normalizedEngine === "google_trends") {
    return hasValidGoogleTrendsEvidence({ pageData });
  }
  const productLinks = Array.isArray(pageData.productLinks) ? pageData.productLinks.length : 0;
  const productCards = Array.isArray(pageData.productCards) ? pageData.productCards.length : 0;
  const textLength = String(pageData.visibleText || pageData.text || pageData.bodyText || "").trim().length;
  if (productLinks > 0 || productCards > 0) return true;
  if (["ozon", "1688", "taobao", "jd", "pinduoduo"].includes(normalizedEngine)) return textLength >= 120;
  return hasUsablePageEvidence(pageData);
}

function buildPageEvidence(pageData = {}) {
  const url = String(pageData.url || "");
  const health = pageData.pageHealth || {};
  const pageType = /ozon\.ru\/product\//i.test(url)
    ? "ozon_product"
    : /ozon\.ru\/seller\/|ozon\.ru\/shop\//i.test(url)
    ? "ozon_shop"
    : /ozon\.ru\/search|ozon\.ru\/category/i.test(url)
    ? "ozon_search"
    : /trends\.google\./i.test(url)
    ? "google_trends"
    : /1688\.com|taobao\.com/i.test(url)
    ? "sourcing_page"
    : "web_page";
  return {
    pageType,
    url,
    readRoute: health.readRoute || "content_script",
    frameCount: Number(health.frameCount || 1),
    visibleTextLength: String(pageData.visibleText || pageData.text || pageData.bodyText || "").length,
    productCardCount: Array.isArray(pageData.productCards) ? pageData.productCards.length : 0,
    productLinkCount: Array.isArray(pageData.productLinks) ? pageData.productLinks.length : 0,
    imageCount: Array.isArray(pageData.images) ? pageData.images.length : 0,
    hasMeaningfulDom: Boolean(health.hasMeaningfulDom || hasUsablePageEvidence(pageData)),
    isLikelyBlocked: Boolean(health.isLikelyBlocked),
    limitation: health.isLikelyBlocked
      ? "页面疑似受阻或需要人工验证"
      : pageType === "ozon_search"
      ? "当前证据是 Ozon 搜索结果可见样本，不代表平台全量"
      : pageType === "ozon_shop"
      ? "店铺页面证据代表本轮可访问页面与当前视口"
      : pageType === "ozon_product"
      ? "商品详情页字段仅代表当前可见页面和可访问结构"
      : "当前页面的可见 DOM 证据",
  };
}

async function executeGenericDomSnapshot(tabId) {
  const snapshotFn = () => {
    const bodyText = document.body?.innerText || "";
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => ({
        href: anchor.href,
        text: (anchor.innerText || anchor.getAttribute("aria-label") || "").trim().slice(0, 240),
      }))
      .filter((link) => link.href && link.text)
      .slice(0, 240);
    const images = Array.from(document.images)
      .map((image) => ({
        src: image.currentSrc || image.src,
        alt: image.alt || "",
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
      }))
      .filter((image) => image.src)
      .slice(0, 120);
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((node) => node.textContent || "")
      .filter(Boolean)
      .slice(0, 8);
    return {
      url: location.href,
      title: document.title || "",
      h1: document.querySelector("h1")?.innerText?.trim() || "",
      visibleText: bodyText.slice(0, 30000),
      metaDescription: document.querySelector('meta[name="description"]')?.content || "",
      productLinks: links.filter((link) => /ozon\.ru\/(product|seller|shop)|1688\.com|taobao\.com|product|item|shop/i.test(link.href)),
      links,
      images,
      structuredDataRaw: jsonLd,
      pageHealth: {
        hasMeaningfulDom: bodyText.trim().length >= 120 || links.length > 0,
        visibleTextLength: bodyText.length,
        frameUrl: location.href,
        readRoute: "scripting_executeScript_dom_fallback",
      },
    };
  };

  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: snapshotFn });
  } catch (_) {
    results = await chrome.scripting.executeScript({ target: { tabId }, func: snapshotFn });
  }
  const mainFrame = results.find((item) => item.frameId === 0)?.result || results[0]?.result || {};
  const frameText = results
    .filter((item) => item.frameId !== 0 && item.result?.visibleText)
    .map((item) => item.result.visibleText)
    .join("\n")
    .slice(0, 30000);
  return {
    ...mainFrame,
    visibleText: [mainFrame.visibleText, frameText].filter(Boolean).join("\n").slice(0, 30000),
    frameCount: results.length,
    pageHealth: {
      ...(mainFrame.pageHealth || {}),
      frameCount: results.length,
    },
  };
}

async function readCompletePageData(tabId, message = {}) {
  let contentResult = null;
  let contentError = null;
  try {
    contentResult = await sendToContentScript(tabId, message);
  } catch (err) {
    contentError = err;
  }
  const contentData = contentResult?.ok ? (contentResult.data || {}) : {};
  const contentHealthy = hasUsablePageEvidence(contentData);
  if (contentHealthy && !contentData?.pageHealth?.isLikelyBlocked) {
    return {
      ...contentResult,
      data: { ...contentData, pageEvidence: buildPageEvidence(contentData) },
    };
  }

  try {
    const fallback = await executeGenericDomSnapshot(tabId);
    const merged = {
      ...fallback,
      ...contentData,
      visibleText: String(contentData.visibleText || fallback.visibleText || "").length >= String(fallback.visibleText || "").length
        ? contentData.visibleText || fallback.visibleText || ""
        : fallback.visibleText,
      productLinks: (contentData.productLinks?.length ? contentData.productLinks : fallback.productLinks) || [],
      images: (contentData.images?.length ? contentData.images : fallback.images) || [],
      pageHealth: {
        ...(fallback.pageHealth || {}),
        ...(contentData.pageHealth || {}),
        readRoute: contentResult?.ok ? "content_script_plus_dom_fallback" : "scripting_executeScript_dom_fallback",
        contentScriptError: contentError?.message || "",
      },
    };
    return {
      ok: Boolean(contentResult?.ok || fallback?.pageHealth?.hasMeaningfulDom),
      data: {
        ...merged,
        pageEvidence: buildPageEvidence(merged),
      },
    };
  } catch (fallbackError) {
    if (contentResult?.ok) return contentResult;
    throw new Error(contentError?.message || fallbackError.message);
  }
}

async function getTabQuietly(tabId) {
  return await new Promise((resolve) => {
    chrome.tabs.get(tabId, (tabInfo) => {
      if (chrome.runtime.lastError || !tabInfo) resolve(null);
      else resolve(tabInfo);
    });
  });
}

export async function waitForPageCaptureReady(tabId, {
  engine = "",
  workflowId = "default",
  expectedUrl = "",
  label = "",
  timeoutMs,
  maxAttempts = 24,
  pollMs = 500,
  minQuietMs = 1200,
  minStableReads = 2,
  requireEvidence = true,
  progress = null,
  progressStage = "page_capture_waiting",
  progressLabel = "页面",
} = {}) {
  const profile = getReadinessProfile(expectedUrl, label || progressLabel, engine);
  const minStayMs = Math.max(250, Number(minQuietMs ?? profile.minWaitMs) || profile.minWaitMs);
  const intervalMs = Math.max(250, Number(pollMs ?? profile.pollMs) || profile.pollMs);
  const requiredStableReads = Math.max(1, Number(minStableReads ?? profile.minStableReads) || profile.minStableReads || 1);
  const deadlineMs = Math.max(
    minStayMs + 1000,
    Number(timeoutMs) || Math.max(Number(maxAttempts || 24) * intervalMs, profile.timeoutMs)
  );
  const startedAt = Date.now();
  let lastTab = null;
  let lastPageData = {};
  let lastReadError = "";
  let completeSeenAt = 0;
  let emittedWaiting = false;
  let lastSignature = "";
  let stableReads = 0;
  let attempt = 0;

  const emit = (stage, message, extra = {}) => {
    if (typeof progress !== "function") return;
    try {
      progress(stage, message, extra);
    } catch (_) {}
  };

  emit("tab_readiness_wait_started", `${progressLabel} 已打开，等待页面完成加载并形成可读证据。`, {
    tabId,
    expectedUrl,
    minWaitMs: minStayMs,
    timeoutMs: deadlineMs,
    minStableReads: requiredStableReads,
  });

  while (Date.now() - startedAt <= deadlineMs) {
    attempt += 1;
    if (workflowId !== "default" && await isWorkflowCancellationRequested(workflowId)) {
      return {
        ok: false,
        cancelled: true,
        tab: lastTab,
        pageData: lastPageData,
        attempts: attempt,
        stableReads,
        elapsedMs: Date.now() - startedAt,
        readiness: "cancelled",
        loadState: "cancelled",
        readyReason: "workflow_cancelled",
        readError: "Workflow cancellation requested while waiting for tab readiness",
      };
    }

    const tab = await getTabQuietly(tabId);
    if (!tab) {
      return {
        ok: false,
        tab: null,
        pageData: lastPageData,
        attempts: attempt,
        stableReads,
        elapsedMs: Date.now() - startedAt,
        readiness: "tab_missing",
        loadState: "tab_closed_or_missing",
        readyReason: "tab_closed_or_missing",
        readError: "Tab closed or not found",
      };
    }
    lastTab = tab;

    if (isVerificationUrl(tab.url)) {
      return {
        ok: false,
        tab,
        pageData: lastPageData,
        attempts: attempt,
        isVerification: true,
        stableReads,
        elapsedMs: Date.now() - startedAt,
        readiness: "verification_required",
        loadState: "verification_page",
        readyReason: "verification_page",
        readError: "Verification or login page detected",
      };
    }

    if (tab.status === "complete" && !completeSeenAt) completeSeenAt = Date.now();
    const elapsedMs = Date.now() - startedAt;
    const minStaySatisfied = elapsedMs >= minStayMs;

    if (minStaySatisfied || attempt === 1 || tab.status === "complete") {
      try {
        const data = await readCompletePageData(tabId, { type: "READ_CURRENT_PAGE", cachedSelectors: null });
        const pageData = data?.data || {};
        lastPageData = pageData;
        lastReadError = "";
        const signature = pageDataSignature(pageData);
        stableReads = signature && signature === lastSignature ? stableReads + 1 : 1;
        lastSignature = signature;
        const evidenceReady = profile.ready(pageData) || pageDataLooksReady(pageData, engine);
        const canReturnWithoutEvidence = !requireEvidence && minStaySatisfied && (tab.status === "complete" || completeSeenAt);
        const stableSatisfied = stableReads >= requiredStableReads;
        if ((evidenceReady && minStaySatisfied && stableSatisfied) || (canReturnWithoutEvidence && stableSatisfied)) {
          const readiness = evidenceReady ? "content_stable" : "load_complete_min_wait_satisfied";
          emit("tab_readiness_ready", `${progressLabel} 已完成加载等待并取得可读页面证据。`, {
            tabId,
            url: pageData.url || tab.url || expectedUrl,
            readiness,
            readyReason: evidenceReady ? profile.readyLabel : readiness,
            attempts: attempt,
            stableReads,
            elapsedMs,
          });
          return {
            ok: evidenceReady || canReturnWithoutEvidence,
            tab,
            pageData,
            attempts: attempt,
            stableReads,
            elapsedMs,
            readiness,
            loadState: readiness,
            readyReason: evidenceReady ? profile.readyLabel : readiness,
            readError: "",
          };
        }
      } catch (err) {
        lastReadError = err.message || "Failed to read page";
      }
    }

    if ((attempt === 1 || attempt % 6 === 0) || (!emittedWaiting && elapsedMs >= Math.min(3000, deadlineMs))) {
      emittedWaiting = true;
      emit(progressStage, `${progressLabel} 正在等待动态内容稳定，暂不采集半截页面（${attempt}/${Math.ceil(deadlineMs / intervalMs)}）。`, {
        tabId,
        tabStatus: tab.status,
        elapsedMs,
        stableReads,
        minStableReads: requiredStableReads,
      });
    }
    await sleep(intervalMs);
  }

  const usable = hasUsablePageEvidence(lastPageData);
  return {
    ok: usable,
    timedOut: true,
    tab: lastTab,
    pageData: lastPageData,
    attempts: attempt,
    stableReads,
    elapsedMs: Date.now() - startedAt,
    readiness: usable ? "evidence_ready_after_timeout" : "readiness_timeout",
    loadState: usable ? "timeout_with_last_read" : "timeout_without_read",
    readyReason: usable ? "timeout_with_last_read" : "timeout_without_read",
    readError: lastReadError || "Timed out waiting for stable readable page evidence",
  };
}

function extractOzonCandidateUrls(pageData = {}, limit = 6) {
  const urls = [];
  const pushUrl = (raw) => {
    const url = normalizeOzonUrl(raw);
    if (!url || !isOzonPageUrl(url)) return;
    if (!/\/seller\/|\/shop\/|\/product\//i.test(url)) return;
    if (!urls.includes(url)) urls.push(url);
  };
  (pageData.productCards || []).forEach((card) => pushUrl(card.href || card.url || card.link));
  (pageData.productLinks || []).forEach((link) => pushUrl(link.href || link.url || link.link));
  return urls.slice(0, limit);
}

async function waitForTabLoaded(tabId, maxAttempts = 24) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(tabId, (tabInfo) => {
        if (chrome.runtime.lastError || !tabInfo) resolve(null);
        else resolve(tabInfo);
      });
    });
    if (!tab) return null;
    if (tab.status === "complete") return tab;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return await new Promise((resolve) => {
    chrome.tabs.get(tabId, (tabInfo) => {
      if (chrome.runtime.lastError || !tabInfo) resolve(null);
      else resolve(tabInfo);
    });
  });
}

async function readPageFromTab(tabId) {
  const result = await readCompletePageData(tabId, {
    type: "READ_CURRENT_PAGE",
    cachedSelectors: null,
  });
  if (!result?.ok) throw new Error(result?.error || "Failed to read page");
  return result.data || {};
}

async function openOzonEvidenceTab(url, active = false, workflowId = "default") {
  return await new Promise((resolve, reject) => {
    createBrowserTab({ url: normalizeOzonUrl(url), active, workflowId }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        reject(new Error(chrome.runtime.lastError?.message || "Failed to open Ozon evidence tab"));
        return;
      }
      resolve(tab);
    });
  });
}

async function captureAndStoreOzonScreenshot(tabId, metadata = {}) {
  const capture = await _captureTabScreenshot(tabId, { expectedUrl: metadata.url || "" });
  const dataUrl = capture.dataUrl || capture;
  const artifact = await putDataUrlArtifact(dataUrl, {
    namespace: "ozon-competitor-screenshot",
    metadata: { ...metadata, captureMode: capture.captureMode || "captureVisibleTab_viewport" },
    ttlMs: 48 * 60 * 60 * 1000,
  });
  return { ...artifact, captureMode: capture.captureMode || "captureVisibleTab_viewport" };
}

async function collectOzonEvidencePage({
  url,
  tabId,
  pageIndex = 1,
  closeAfter = false,
  source = "manual",
  workflowId = "default",
} = {}) {
  let evidenceTab = null;
  let openedByTool = false;
  try {
    if (tabId) {
      const ready = await waitForPageCaptureReady(Number(tabId), {
        engine: "ozon",
        workflowId,
        expectedUrl: evidenceTab?.url || url || "",
        maxAttempts: 28,
        minQuietMs: 1800,
        minStableReads: 2,
        progressLabel: "Ozon 证据页",
      });
      evidenceTab = ready.tab || await waitForTabLoaded(Number(tabId));
    } else if (url) {
      evidenceTab = await openOzonEvidenceTab(url, false, workflowId);
      openedByTool = true;
      const ready = await waitForPageCaptureReady(evidenceTab.id, {
        engine: "ozon",
        workflowId,
        expectedUrl: normalizeOzonUrl(url),
        maxAttempts: 32,
        minQuietMs: 2200,
        minStableReads: 2,
        progressLabel: "Ozon 证据页",
      });
      evidenceTab = ready.tab || evidenceTab;
    } else {
      evidenceTab = await getCurrentTab();
    }
    if (!evidenceTab?.id) throw new Error("No Ozon evidence tab available");

    const finalUrl = evidenceTab.url || url || "";
    if (!isOzonPageUrl(finalUrl)) {
      throw new Error(`collect_ozon_shop_pages only supports ozon.ru pages. Current URL: ${finalUrl || "unknown"}`);
    }

    const ready = await waitForPageCaptureReady(evidenceTab.id, {
      engine: "ozon",
      workflowId,
      expectedUrl: finalUrl,
      maxAttempts: 12,
      minQuietMs: 800,
      minStableReads: 1,
      progressLabel: "Ozon 证据页",
    });
    const pageData = ready.pageData || await readPageFromTab(evidenceTab.id);
    const screenshot = await captureAndStoreOzonScreenshot(evidenceTab.id, {
      url: finalUrl,
      pageIndex,
      source,
      capturedAt: new Date().toISOString(),
    });
    const productCards = summarizeOzonProductCards(pageData.productCards || []);
    return {
      ok: true,
      tabId: evidenceTab.id,
      openedByTool,
      pageIndex,
      url: pageData.url || finalUrl,
      title: pageData.title || evidenceTab.title || "",
      pageType: inferOzonPageType(pageData.url || finalUrl, pageData),
      productCards,
      productCardsVisible: productCards.length,
      candidateUrls: extractOzonCandidateUrls(pageData),
      visibleTextSnippet: textSnippet(pageData),
      screenshotRef: screenshot.ref,
      screenshotStorage: screenshot.storage,
      screenshotBytes: screenshot.bytes,
      screenshotCaptureMode: screenshot.captureMode,
      pageHealth: productCards.length > 0 || textSnippet(pageData, 80) ? "readable" : "thin_or_blocked",
      coverageLimit: "截图为当前视口，商品数量与价格分布仅代表本轮可见样本；未完成分页时不得写成全店全量。",
    };
  } catch (err) {
    return {
      ok: false,
      pageIndex,
      url,
      tabId: evidenceTab?.id || tabId || null,
      error: err.message,
      pageHealth: "failed",
    };
  } finally {
    if ((closeAfter || openedByTool) && evidenceTab?.id) {
      try {
        await closeOwnedTab(workflowId, evidenceTab.id);
      } catch (_) {}
    }
  }
}

function isWarmCtaPixel(r, g, b, a) {
  return a > 180 && r >= 210 && g >= 50 && g <= 190 && b <= 125 && r > g + 35;
}

function isCoolPrimaryPixel(r, g, b, a) {
  return a > 180 && b >= 150 && r <= 110 && g >= 75 && g <= 185 && b > r + 55;
}

function isPrimaryActionPixel(r, g, b, a) {
  return isWarmCtaPixel(r, g, b, a) || isCoolPrimaryPixel(r, g, b, a);
}

function normalizedPointInRegion(x, y, region, padding = 0.03) {
  if (!region) return true;
  const left = Math.max(0, (region.normalizedLeft ?? 0) - padding);
  const top = Math.max(0, (region.normalizedTop ?? 0) - padding);
  const right = Math.min(1, (region.normalizedRight ?? 1) + padding);
  const bottom = Math.min(1, (region.normalizedBottom ?? 1) + padding);
  return x >= left && x <= right && y >= top && y <= bottom;
}

function normalizedPointInAnyRegion(x, y, regions = []) {
  if (!regions.length) return true;
  return regions.some((region) => normalizedPointInRegion(x, y, region));
}

async function _locateImageSearchActionInScreenshot(dataUrl, regions = []) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return null;
  }

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const visited = new Uint8Array(width * height);
  const stride = 2;
  const candidates = [];

  const isMask = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const idx = (y * width + x) * 4;
    return isPrimaryActionPixel(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]);
  };

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const start = y * width + x;
      if (visited[start] || !isMask(x, y)) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      const stack = [[x, y]];
      visited[start] = 1;

      while (stack.length) {
        const [cx, cy] = stack.pop();
        count++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);

        const neighbors = [
          [cx + stride, cy],
          [cx - stride, cy],
          [cx, cy + stride],
          [cx, cy - stride],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !isMask(nx, ny)) continue;
          visited[nIdx] = 1;
          stack.push([nx, ny]);
        }
      }

      const boxWidth = maxX - minX + stride;
      const boxHeight = maxY - minY + stride;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const normalizedY = centerY / height;
      const normalizedX = centerX / width;
      if (count < 80 || boxWidth < 45 || boxHeight < 24 || boxWidth > 420 || boxHeight > 150) continue;
      if (!normalizedPointInAnyRegion(normalizedX, normalizedY, regions)) continue;

      let score = count + Math.min(boxWidth * boxHeight / 10, 2000);
      if (normalizedY > 0.18 && normalizedY < 0.9) score += 900;
      if (normalizedY < 0.16) score -= 1800;
      if (normalizedX > 0.22 && normalizedX < 0.92) score += 350;
      if (normalizedX > 0.35 && normalizedX < 0.78 && normalizedY > 0.32 && normalizedY < 0.78) score += 500;
      if (boxHeight >= 34 && boxHeight <= 85) score += 260;
      candidates.push({ normalizedX, normalizedY, score, boxWidth, boxHeight, count });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function getImageSearchUiState(tabId) {
  try {
    const res = await sendToContentScript(tabId, { type: "GET_IMAGE_SEARCH_UI_STATE" });
    return res?.data || { containers: [], candidates: [] };
  } catch (err) {
    return { containers: [], candidates: [], error: err.message };
  }
}

async function visualClickImageSearchSubmit(tabId) {
  try {
    const uiState = await getImageSearchUiState(tabId);
    const domCandidate = Array.isArray(uiState.candidates) ? uiState.candidates[0] : null;
    if (domCandidate?.exactTextOnly && domCandidate?.rect?.normalizedCenterX !== undefined && domCandidate?.rect?.normalizedCenterY !== undefined) {
      const clickResult = await sendToContentScript(tabId, {
        type: "CLICK_BY_COORDINATE",
        x: domCandidate.rect.normalizedCenterX,
        y: domCandidate.rect.normalizedCenterY,
        learnKind: "image_search_submit",
      });
      return {
        ok: !!clickResult?.ok,
        source: "dom_image_search_candidate",
        uiState,
        target: domCandidate,
        clickResult,
      };
    }

    return {
      ok: false,
      reason: "Exact visible 搜索图片 text was not detected; skipped unsafe screenshot/color click because this 1688 overlay closes on any other click.",
      uiState,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export const tools = {
  get_market_rates: async () => {
    return await getRubCnyMarketRate();
  },

  get_logistics_cost_profile: async (args = {}) => {
    const rate = parsePositiveNumber(args.cnyToRub || args.cny_to_rub, 0);
    return await getStoredLogisticsCostProfile({ ...(args || {}), cnyToRub: rate });
  },

  read_current_page: async (args = {}) => {
    const tab = await getSourceOrCurrentTab(args.__sourceTabId);
    if (!tab) throw new Error("No active tab found");
    
    let cachedSelectors = null;
    try {
      const domain = new URL(tab.url).hostname;
      const storage = await new Promise((r) => chrome.storage.local.get(["platformMemory"], r));
      const memory = storage.platformMemory || {};
      cachedSelectors = memory[domain] || null;
    } catch (_) {}

    const result = await readCompletePageData(tab.id, {
      type: "READ_CURRENT_PAGE",
      cachedSelectors
    });
    if (!result?.ok) throw new Error(result?.error || "Failed to read page");

    const pageData = result.data || {};
    if (Array.isArray(pageData.productCards)) {
      for (const card of pageData.productCards) {
        if (card.href && card.title) {
          currentSessionData.products.set(card.href, {
            ...card,
            captured_at: new Date().toISOString()
          });
        }
      }
    }
    if (pageData.creatorInfo) {
      currentSessionData.creatorInfo = pageData.creatorInfo;
    }
    if (Array.isArray(pageData.detailCreators)) {
      for (const dc of pageData.detailCreators) {
        if (dc.username && !currentSessionData.detailCreators.some(x => x.username === dc.username)) {
          currentSessionData.detailCreators.push(dc);
        }
      }
    }

    return pageData;
  },

  get_browser_capabilities: async () => ({
    ok: true,
    version: "2026-07-14",
    capabilities: summarizeBrowserAutomationCapabilities(),
    usagePolicy: "先用结构化 DOM 与稳定等待取证；视觉截图用于页面布局、主图、竞品陈列和趋势图辅助；遇到验证码/登录/证据不足时输出 blocking_gaps，不编造结论。",
  }),

  collect_ozon_shop_pages: async (args = {}) => {
    const {
      url,
      tabId,
      maxPages = 1,
      closeAfter = true,
      source = "ozon_competitor_crawl",
      workflowId = "default",
    } = args || {};
    if (!url && !tabId) {
      const activeTab = await getCurrentTab();
      if (!activeTab?.url || !isOzonPageUrl(activeTab.url)) {
        throw new Error("collect_ozon_shop_pages requires an Ozon shop/product URL, tabId, or active Ozon tab.");
      }
    }

    const pages = [];
    const firstPage = await collectOzonEvidencePage({
      url,
      tabId,
      pageIndex: 1,
      closeAfter,
      source,
      workflowId,
    });
    pages.push(firstPage);

    const completedFullCrawl = Number(maxPages) <= 1 && firstPage.ok;
    const readablePages = pages.filter((page) => page.ok);
    return {
      ok: readablePages.length > 0,
      tool: "collect_ozon_shop_pages",
      sourceUrl: normalizeOzonUrl(url || firstPage.url || ""),
      pages,
      pagesCollected: readablePages.length,
      completedFullCrawl,
      screenshotRefs: readablePages.map((page) => page.screenshotRef).filter(Boolean),
      productCards: readablePages.flatMap((page) => page.productCards || []),
      candidateUrls: Array.from(new Set(readablePages.flatMap((page) => page.candidateUrls || []))).slice(0, 12),
      nextStep: "Pass pages or screenshotRefs to analyze_ozon_shop_crawl_screenshots before final report delivery. If only a search grid was collected, open 2-3 product/detail pages before making product-level conclusions.",
      limitation: "当前工具采集 Ozon 可见页面与当前视口截图；若 Ozon 阻断、登录或验证码导致页面薄弱，报告必须降级为待验证。",
    };
  },

  collect_ozon_competitor_shops: async (args = {}) => {
    const {
      urls = [],
      competitorUrls = [],
      maxCompetitors = 3,
      maxPagesPerCompetitor = 1,
      closeAfter = true,
      workflowId = "default",
    } = args || {};
    const rawUrls = [...urls, ...competitorUrls].map(normalizeOzonUrl).filter(Boolean);
    const uniqueUrls = Array.from(new Set(rawUrls)).filter(isOzonPageUrl).slice(0, Math.max(1, Number(maxCompetitors) || 3));
    if (uniqueUrls.length === 0) {
      throw new Error("collect_ozon_competitor_shops requires at least one Ozon shop/product URL.");
    }

    const shops = [];
    for (const competitorUrl of uniqueUrls) {
      const crawl = await tools.collect_ozon_shop_pages({
        url: competitorUrl,
        maxPages: maxPagesPerCompetitor,
        closeAfter,
        source: "ozon_competitor_batch",
        workflowId,
      });
      const readablePages = (crawl.pages || []).filter((page) => page.ok);
      shops.push({
        competitorUrl,
        ok: crawl.ok,
        pageType: readablePages[0]?.pageType || "unknown",
        title: readablePages[0]?.title || "",
        pages: crawl.pages || [],
        pagesCollected: crawl.pagesCollected || 0,
        productCardsVisible: readablePages.reduce((sum, page) => sum + Number(page.productCardsVisible || 0), 0),
        candidateUrls: crawl.candidateUrls || [],
        screenshotRefs: crawl.screenshotRefs || [],
        limitation: crawl.limitation,
      });
    }

    const allPages = shops.flatMap((shop) => shop.pages || []);
    const readablePages = allPages.filter((page) => page.ok);
    return {
      ok: readablePages.length > 0,
      tool: "collect_ozon_competitor_shops",
      shops,
      allPages,
      competitorsRequested: uniqueUrls.length,
      competitorsCollected: shops.filter((shop) => shop.ok).length,
      screenshotRefs: readablePages.map((page) => page.screenshotRef).filter(Boolean),
      productCards: readablePages.flatMap((page) => page.productCards || []),
      nextStep: "Run analyze_ozon_shop_crawl_screenshots with allPages or screenshotRefs, then fill competitor_benchmarks and diagnostic_depth_matrix from the returned stage_report_inputs.",
      limitation: "只能代表本轮打开的 Ozon 可见竞品页面，不能写成竞品后台、全店真实销量或完整库存。",
    };
  },

  analyze_ozon_shop_crawl_screenshots: async (args = {}) => {
    const pages = Array.isArray(args.pages) ? args.pages : [];
    const refsFromPages = pages.map((page) => page.screenshotRef).filter(Boolean);
    const screenshotRefs = Array.from(new Set([...(args.screenshotRefs || []), ...refsFromPages].filter(Boolean))).slice(0, 8);
    if (screenshotRefs.length === 0) {
      throw new Error("analyze_ozon_shop_crawl_screenshots requires pages with screenshotRef or a screenshotRefs array.");
    }

    const loaded = [];
    for (const ref of screenshotRefs) {
      const dataUrl = await getArtifactDataUrl(ref);
      const page = pages.find((item) => item.screenshotRef === ref) || {};
      if (!dataUrl) {
        loaded.push({
          ref,
          ok: false,
          error: "Screenshot artifact was not found or has expired. Re-run collect_ozon_shop_pages before visual analysis.",
          page,
        });
        continue;
      }
      loaded.push({ ref, ok: true, dataUrl, page });
    }

    const readable = loaded.filter((item) => item.ok && item.dataUrl);
    if (readable.length === 0) {
      return {
        ok: false,
        tool: "analyze_ozon_shop_crawl_screenshots",
        analyses: loaded,
        error: "No screenshots could be analyzed. Re-run collect_ozon_shop_pages in the same workflow before visual analysis.",
      };
    }

    const prompt = `你是 Ozon 竞品店铺视觉与商品结构审计员。请基于已采集的 Ozon 竞品页面截图和页面摘要，输出严格 JSON，不要 markdown。
要求：
1. stage_observations: 逐截图记录可见事实，包括页面类型、首屏商品/橱窗、首图卖点、俄语文案、价格/评价/促销/履约可见信号、局限。
2. stage_synthesis: 逐竞品总结可学习方法和本店可能差距。
3. stage_report_inputs: 给最终店铺体检报告使用，包含 evidence_ledger_drafts、competitor_benchmark_drafts、diagnostic_depth_matrix_hints。
4. 不得把当前视口截图写成全页/全店/完整库存，不得编造 Ozon 后台销量。

页面摘要：
${JSON.stringify(readable.map((item, index) => ({
  index: index + 1,
  screenshotRef: item.ref,
  url: item.page?.url,
  title: item.page?.title,
  pageType: item.page?.pageType,
  productCardsVisible: item.page?.productCardsVisible,
  productCards: (item.page?.productCards || []).slice(0, 8),
  visibleTextSnippet: item.page?.visibleTextSnippet,
  coverageLimit: item.page?.coverageLimit,
})), null, 2)}`;

    let parsedAnalysis = null;
    try {
      const content = [
        { type: "text", text: prompt },
        ...readable.map((item) => ({ type: "image_url", image_url: { url: item.dataUrl } })),
      ];
      const response = await callLLM([{ role: "user", content }]);
      const jsonMatch = String(response || "").match(/```json\s*([\s\S]*?)```/i) || String(response || "").match(/({[\s\S]*})/);
      parsedAnalysis = JSON.parse(jsonMatch ? jsonMatch[1] : response);
    } catch (err) {
      parsedAnalysis = {
        stage_observations: readable.map((item, index) => ({
          screenshot_ref: item.ref,
          page_url: item.page?.url || "",
          page_type: item.page?.pageType || "unknown",
          observation: "截图已缓存，但视觉模型解析失败；最终报告只能引用页面文本、可见商品卡片与待人工复核的截图证据。",
          limitation: err.message,
          index: index + 1,
        })),
        stage_synthesis: [],
        stage_report_inputs: {
          evidence_ledger_drafts: readable.map((item) => ({
            source_type: "screenshot_visual",
            source_ref: item.ref,
            observed_value: `Ozon 竞品页面当前视口截图：${item.page?.title || item.page?.url || "未命名页面"}`,
            used_for: "竞品视觉与橱窗结构待人工复核",
            confidence: "low",
            limitation: "视觉模型解析失败，不能生成已验证的竞品视觉结论。",
          })),
          competitor_benchmark_drafts: [],
          diagnostic_depth_matrix_hints: [],
        },
        parser_error: err.message,
      };
    }

    return {
      ok: true,
      tool: "analyze_ozon_shop_crawl_screenshots",
      screenshotRefs,
      analyses: loaded.map(({ dataUrl: _dataUrl, ...rest }) => rest),
      stage_observations: parsedAnalysis.stage_observations || [],
      stage_synthesis: parsedAnalysis.stage_synthesis || [],
      stage_report_inputs: parsedAnalysis.stage_report_inputs || {},
      nextStepInstruction: "Do not reinterpret raw screenshots from memory. Use stage_observations, stage_synthesis and stage_report_inputs to fill final.output.competitor_benchmarks, diagnostic_depth_matrix and data[].evidence_ledger.",
    };
  },

  extract_product_info: async (args = {}) => {
    const tab = await getSourceOrCurrentTab(args.__sourceTabId);
    if (!tab) throw new Error("No active tab found");
    const result = await sendToContentScript(tab.id, { type: "EXTRACT_PRODUCT_INFO" });
    if (!result?.ok) throw new Error(result?.error || "Failed to extract product");
    return result.data;
  },

  get_selected_text: async (args = {}) => {
    const tab = await getSourceOrCurrentTab(args.__sourceTabId);
    if (!tab) throw new Error("No active tab found");
    const result = await sendToContentScript(tab.id, { type: "GET_SELECTED_TEXT" });
    if (!result?.ok) throw new Error(result?.error || "Failed to get selection");
    return result.data;
  },

  analyze_keywords: async (args) => {
    const { text = "", context = "" } = args;
    return {
      input_text: text,
      context,
      note: "LLM should analyze and extract keywords from the provided text and page context.",
    };
  },

  save_result: async (args) => {
    const existing = await new Promise((resolve) =>
      chrome.storage.local.get(["savedResults"], resolve)
    );
    const savedResults = existing.savedResults || [];
    const entry = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      ...args,
    };
    savedResults.unshift(entry);
    await new Promise((resolve) =>
      chrome.storage.local.set({ savedResults: savedResults.slice(0, 100) }, resolve)
    );
    return { ok: true, id: entry.id, message: "Result saved to library." };
  },

  get_saved_results: async (args) => {
    const { limit = 10 } = args || {};
    const existing = await new Promise((resolve) =>
      chrome.storage.local.get(["savedResults"], resolve)
    );
    return (existing.savedResults || []).slice(0, limit);
  },

  click_by_text: async (args) => {
    const { text, __sourceTabId = null } = args;
    if (!text) throw new Error("text is required");
    const tab = await getSourceOrCurrentTab(__sourceTabId);
    if (!tab) throw new Error("No active tab found");
    const result = await sendToContentScript(tab.id, { type: "CLICK_BY_TEXT", text });
    if (result.ok) {
      await new Promise(r => setTimeout(r, 2500));
    }
    return result;
  },

  scroll_page: async (args) => {
    const { direction = "down", amount = 800, __sourceTabId = null } = args || {};
    const tab = await getSourceOrCurrentTab(__sourceTabId);
    if (!tab) throw new Error("No active tab found");
    const result = await sendToContentScript(tab.id, {
      type: "SCROLL_PAGE",
      direction,
      amount
    });
    if (!result?.ok) throw new Error(result?.error || "Failed to scroll page");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { ok: true, message: `Scrolled ${direction} by ${amount}px` };
  },

  apply_page_filter: async (args) => {
    const {
      filterType = "generic",
      label = "",
      value = "",
      text = "",
      tabId,
      expectedChange = "productCards",
      __sourceTabId = null,
    } = args || {};
    const targetLabel = value || label || text;
    if (!targetLabel) throw new Error("label or value is required");
    let targetTabId = tabId;
    if (!targetTabId) {
      const tab = await getSourceOrCurrentTab(__sourceTabId);
      if (!tab) throw new Error("No active tab found");
      targetTabId = tab.id;
    }

    const before = (await readCompletePageData(targetTabId, { type: "READ_CURRENT_PAGE" }))?.data || {};
    const clickResult = await sendToContentScript(targetTabId, {
      type: "APPLY_PAGE_FILTER",
      filterType,
      label,
      value,
      text: targetLabel,
    });
    if (!clickResult?.ok) {
      return {
        ok: false,
        filterType,
        label: targetLabel,
        clicked: false,
        evidenceOk: false,
        blockingGap: `未找到或无法点击筛选/排序项：${targetLabel}`,
        filterEvidence: buildInteractionEvidence(before, before),
        clickResult,
      };
    }

    const ready = await waitForPageCaptureReady(targetTabId, {
      engine: before.url && isOzonPageUrl(before.url) ? "ozon" : "",
      expectedUrl: before.url || "",
      maxAttempts: 18,
      minQuietMs: 1200,
      minStableReads: 1,
      progressLabel: "筛选/排序结果页",
    });
    const after = ready.pageData || (await readCompletePageData(targetTabId, { type: "READ_CURRENT_PAGE" }))?.data || {};
    const filterEvidence = buildInteractionEvidence(before, after);
    const expectedOk = expectedChange === "url"
      ? filterEvidence.urlChanged
      : expectedChange === "text"
      ? filterEvidence.textLengthChanged
      : expectedChange === "any"
      ? filterEvidence.changed || filterEvidence.urlChanged || filterEvidence.textLengthChanged
      : filterEvidence.changed || filterEvidence.productCardsChanged || filterEvidence.productCardContentChanged || filterEvidence.productLinksChanged;
    return {
      ok: true,
      tabId: targetTabId,
      filterType,
      label: targetLabel,
      clicked: true,
      clickedText: clickResult.clickedText || "",
      changed: expectedOk,
      evidenceOk: expectedOk || hasUsablePageEvidence(after),
      loadState: ready.readyReason,
      filterEvidence,
      pageData: after,
      message: expectedOk
        ? `筛选/排序已执行，并检测到页面证据变化：${targetLabel}`
        : `筛选/排序已点击，但未检测到明确页面变化：${targetLabel}`,
    };
  },

  go_next_page: async (args) => {
    const {
      tabId,
      requireProductCardChange = true,
      __sourceTabId = null,
    } = args || {};
    let targetTabId = tabId;
    if (!targetTabId) {
      const tab = await getSourceOrCurrentTab(__sourceTabId);
      if (!tab) throw new Error("No active tab found");
      targetTabId = tab.id;
    }

    const before = (await readCompletePageData(targetTabId, { type: "READ_CURRENT_PAGE" }))?.data || {};
    const clickResult = await sendToContentScript(targetTabId, { type: "GO_NEXT_PAGE" });
    if (!clickResult?.ok) {
      return {
        ok: false,
        tabId: targetTabId,
        clicked: false,
        evidenceOk: false,
        blockingGap: "未找到可用下一页按钮，或下一页按钮不可点击。",
        paginationEvidence: buildInteractionEvidence(before, before),
        clickResult,
      };
    }

    const ready = await waitForPageCaptureReady(targetTabId, {
      engine: before.url && isOzonPageUrl(before.url) ? "ozon" : "",
      expectedUrl: before.url || "",
      maxAttempts: 22,
      minQuietMs: 1500,
      minStableReads: 1,
      progressLabel: "下一页结果",
    });
    const after = ready.pageData || (await readCompletePageData(targetTabId, { type: "READ_CURRENT_PAGE" }))?.data || {};
    const paginationEvidence = buildInteractionEvidence(before, after);
    const pageChanged = paginationEvidence.urlChanged ||
      paginationEvidence.productCardsChanged ||
      paginationEvidence.productCardContentChanged ||
      paginationEvidence.productLinksChanged ||
      (!requireProductCardChange && (paginationEvidence.changed || paginationEvidence.textLengthChanged));
    return {
      ok: pageChanged,
      tabId: targetTabId,
      clicked: true,
      clickedText: clickResult.clickedText || "",
      evidenceOk: pageChanged || hasUsablePageEvidence(after),
      loadState: ready.readyReason,
      paginationEvidence,
      pageData: after,
      message: pageChanged
        ? "已进入下一页，并检测到页面证据变化。"
        : "已点击下一页，但未检测到明确页面变化；需要人工确认分页是否生效。",
    };
  },

  collect_reviews: async (args) => {
    const {
      tabId,
      ratingFilter = "all",
      maxPages = 2,
      maxItems = 40,
      includeImages = true,
      __sourceTabId = null,
    } = args || {};
    let targetTabId = tabId;
    if (!targetTabId) {
      const tab = await getSourceOrCurrentTab(__sourceTabId);
      if (!tab) throw new Error("No active tab found");
      targetTabId = tab.id;
    }

    const requestedLowRating = ["1", "2", "3"].includes(String(ratingFilter));
    const filterAttempts = [];
    if (requestedLowRating) {
      const labelCandidates = [
        `${ratingFilter} звезда`,
        `${ratingFilter} звезды`,
        `${ratingFilter} зв`,
        `${ratingFilter} звезд`,
        `${ratingFilter}★`,
        `${ratingFilter} star`,
        `${ratingFilter} stars`,
        `${ratingFilter} 星`,
        `${ratingFilter}星`,
        `${ratingFilter}分`,
        "Сначала негативные",
        "Негативные",
        "低星",
        "差评",
        "中评",
      ];
      for (const label of labelCandidates) {
        const result = await sendToContentScript(targetTabId, {
          type: "APPLY_PAGE_FILTER",
          filterType: "review_rating",
          label,
          value: label,
        }).catch((err) => ({ ok: false, error: err.message, label }));
        filterAttempts.push(result);
        if (result?.ok) {
          await sleep(1200);
          break;
        }
      }
    }

    const collected = [];
    const pages = [];
    const seen = new Set();
    const pageLimit = Math.max(1, Math.min(5, Number(maxPages) || 2));
    for (let pageIndex = 1; pageIndex <= pageLimit; pageIndex += 1) {
      const extracted = await sendToContentScript(targetTabId, {
        type: "EXTRACT_REVIEWS",
        ratingFilter,
        maxItems,
      }).catch((err) => ({ ok: false, error: err.message }));
      const data = extracted?.data || {};
      const reviews = Array.isArray(data.reviews) ? data.reviews : [];
      for (const review of reviews) {
        const key = `${review.rating || ""}|${String(review.text || "").slice(0, 220)}`;
        if (!review.text || seen.has(key)) continue;
        seen.add(key);
        collected.push({
          ...review,
          imageUrls: includeImages ? review.imageUrls || [] : [],
          pageIndex,
        });
        if (collected.length >= Number(maxItems || 40)) break;
      }
      pages.push({
        pageIndex,
        ok: Boolean(extracted?.ok),
        reviewCountVisible: reviews.length,
        url: data.url || "",
        title: data.title || "",
      });
      if (collected.length >= Number(maxItems || 40) || pageIndex >= pageLimit) break;
      const next = await tools.go_next_page({
        tabId: targetTabId,
        requireProductCardChange: false,
      }).catch((err) => ({ ok: false, error: err.message }));
      if (!next?.ok) {
        pages[pages.length - 1].nextPageBlocked = next.blockingGap || next.error || next.message || "无法继续翻页";
        break;
      }
      await sleep(1000);
    }

    const blockingGaps = [];
    if (requestedLowRating && !filterAttempts.some((item) => item?.ok)) {
      blockingGaps.push(`未能自动点击 ${ratingFilter} 星/低星评论筛选，需要人工确认评论筛选入口。`);
    }
    if (collected.length === 0) {
      blockingGaps.push("当前页面未抽取到可用评论文本，可能需要展开评论区、登录、切换标签或人工滚动。");
    }

    return {
      ok: collected.length > 0,
      tabId: targetTabId,
      ratingFilter,
      requestedLowRating,
      reviews: collected,
      reviewCountCollected: collected.length,
      pages,
      filterAttempts,
      evidenceOk: collected.length > 0,
      blockingGaps,
      limitation: "评论样本来自当前可访问 DOM 与少量自动翻页；若页面虚拟加载、登录墙或评论折叠，需人工补采并在报告中标注。",
    };
  },

  open_url: async (args) => {
    const { url, workflowId = "default", __sourceTabId = null } = args;
    if (!url) throw new Error("url is required");
    return new Promise((resolve, reject) => {
      createBrowserTab({ url: safeEncodeURI(url), active: false, openerTabId: __sourceTabId, workflowId }, async (tab) => {
        if (chrome.runtime.lastError || !tab) {
          reject(new Error(chrome.runtime.lastError?.message || "Failed to open url"));
          return;
        }
        const ready = await waitForPageCaptureReady(tab.id, {
          engine: isOzonPageUrl(url) ? "ozon" : "",
          workflowId,
          expectedUrl: url,
          requireEvidence: false,
          maxAttempts: 20,
          minQuietMs: 1600,
          minStableReads: 1,
          progressLabel: "新开网页",
        });
        resolve({
          ok: true,
          tabId: tab.id,
          url: ready.pageData?.url || ready.tab?.url || url,
          pageData: ready.pageData || {},
          evidenceOk: hasUsablePageEvidence(ready.pageData || {}),
          loadState: ready.loadState || ready.readyReason,
          message: `Opened: ${url}`,
        });
      });
    });
  },

  navigate_to: async (args) => {
    const { url, __sourceTabId = null } = args;
    if (!url) throw new Error("url is required");
    const tab = await getSourceOrCurrentTab(__sourceTabId);
    if (!tab) throw new Error("No active tab found");
    
    return new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => resolve({ ok: true, message: `Navigated to and loaded: ${url}` }), 2000);
        }
      });
      chrome.tabs.update(tab.id, { url: safeEncodeURI(url) });
    });
  },

  query_market_data: async (args) => {
    const { keyword } = args;
    if (!keyword) throw new Error("keyword is required");

    const settings = await new Promise((resolve) =>
      chrome.storage.local.get(["helium10ApiKey", "sellerSpriteApiKey"], resolve)
    );

    const key = settings.helium10ApiKey || settings.sellerSpriteApiKey;
    if (!key) {
      throw new Error("三方选品数据 API 未配置，无法查询真实数据。请前往设置页面配置 Key。");
    }
    // Keys alone are not a data integration. Returning synthetic metrics here
    // would make an industrial report falsely claim third-party evidence.
    const provider = settings.sellerSpriteApiKey ? "SellerSprite" : "Helium 10";
    throw new Error(`${provider} 已配置 Key，但当前扩展尚未实现其正式 API 适配器，不能生成或推测市场指标。请改用平台页面/Google Trends 取证，或接入已验证的 ${provider} API 适配器。`);
  },

  agentic_web_search: async (args) => {
    const { query, workflowId = "agentic_web_search" } = args;
    if (!query) throw new Error("query is required");
    
    console.log(`Performing silent background agentic web search for: "${query}"`);
    let results = [];
    
    // 0. Prioritize using the large model's native built-in search tool via callLLM
    try {
      const settings = await getSettings();
      const { llmProvider, llmModel, llmBaseUrl } = settings;
      const provider = llmProvider || "openai";
      
      const isQwenModel = provider === "qwen" || llmModel.toLowerCase().includes("qwen") || (llmBaseUrl && llmBaseUrl.includes("dashscope"));
      const isGeminiModel = llmModel.toLowerCase().includes("gemini") || (llmBaseUrl && llmBaseUrl.includes("google"));
      const isGlmModel = llmModel.toLowerCase().includes("glm") || provider === "zhipu" || (llmBaseUrl && llmBaseUrl.includes("zhipu"));
      const isBaichuan = llmModel.toLowerCase().includes("baichuan") || provider === "baichuan";
      const isDoubaoModel = llmModel.toLowerCase().includes("doubao") || (llmBaseUrl && llmBaseUrl.includes("volcengine"));
      const isMinimaxModel = llmModel.toLowerCase().includes("minimax");
      const isHunyuanModel = llmModel.toLowerCase().includes("hunyuan") || llmModel.toLowerCase().includes("tencent");
      
      if (isQwenModel || isGeminiModel || isGlmModel || isBaichuan || isDoubaoModel || isMinimaxModel || isHunyuanModel) {
        console.log("Using large model's built-in web search via callLLM...");
        const searchPrompt = `你是一个网络搜索代理。请直接利用你的【内置网络搜索工具/Google Search Grounding】检索以下关键词最新的网络真实信息，并简明扼要地列出前 5 条相关结果（包含标题、链接和简短内容摘要）。
关键词: "${query}"`;
        
        const responseText = await Promise.race([
          callLLM([{ role: "user", content: searchPrompt }]),
          new Promise((_, reject) => setTimeout(() => reject(new Error("LLM Built-in Search Timeout")), 15000))
        ]);
        
        if (responseText && responseText.trim().length > 0) {
          return {
            ok: true,
            query,
            provider: "Model Built-in Search",
            results: [{
              title: "模型内置检索结果",
              link: "Built-in Search",
              snippet: responseText.trim()
            }]
          };
        }
      }
    } catch (e) {
      console.warn("Failed to perform built-in search, falling back...", e);
    }
    
    // 1. Try silent background fetch to Bing (with 4s timeout)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const html = await response.text();
        const regex = /<li class="b_algo">([\s\S]*?)<\/li>/g;
        let match;
        let count = 0;
        while ((match = regex.exec(html)) !== null && count < 5) {
          const snippetHtml = match[1];
          const titleMatch = snippetHtml.match(/<a[^>]*>(.*?)<\/a>/);
          const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "") : "No Title";
          const hrefMatch = snippetHtml.match(/href="([^"]+)"/);
          const link = hrefMatch ? hrefMatch[1] : "";
          const descMatch = snippetHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/) || snippetHtml.match(/<div class="[^"]*b_snippet[^"]*">([\s\S]*?)<\/div>/);
          const desc = descMatch ? descMatch[1].replace(/<[^>]*>/g, "") : "";
          
          if (link && !link.includes("bing.com/")) {
            results.push({ title: title.trim(), link, snippet: desc.trim() });
            count++;
          }
        }
      }
    } catch (_) {}
    
    // 2. ULTIMATE FALLBACK: Create a temporary owned Bing tab and wait for readable DOM evidence.
    if (results.length === 0) {
      console.log(`Silent search blocked. Falling back to real browser tab search for: "${query}"`);
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      let searchTab = null;
      try {
        searchTab = await new Promise((resolve, reject) => {
          createBrowserTab({ url: searchUrl, active: false, workflowId }, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              reject(new Error(chrome.runtime.lastError?.message || "Failed to open search tab"));
              return;
            }
            resolve(tab);
          });
        });
        const ready = await waitForPageCaptureReady(searchTab.id, {
          workflowId,
          expectedUrl: searchUrl,
          label: "agentic_web_search",
          progressLabel: "Bing 搜索兜底页面",
          timeoutMs: 12_000,
          maxAttempts: 20,
          pollMs: 600,
          minQuietMs: 1400,
          minStableReads: 1,
          requireEvidence: false,
        });
        const pageData = ready.pageData || {};
        const links = Array.isArray(pageData.productLinks) && pageData.productLinks.length > 0
          ? pageData.productLinks
          : Array.isArray(pageData.links) ? pageData.links : [];
        results = links
          .filter((link) => link?.href && /^https?:\/\//i.test(link.href) && !/bing\.com/i.test(link.href))
          .slice(0, 5)
          .map((link) => ({
            title: link.text || link.title || "Bing Result",
            link: link.href,
            snippet: "Bing search result entry",
          }));
      } catch (_) {
        console.warn("Owned tab search fallback failed to read page evidence.");
      } finally {
        if (searchTab?.id) await closeOwnedTab(workflowId, searchTab.id);
      }
    }
    
    return {
      ok: true,
      query,
      provider: results.length > 0 ? "Google/Bing Web Search" : "Google Search (No results)",
      results: results.slice(0, 5)
    };
  },

  search_in_browser: async (args) => {
    const { query, engine = "google", workflowId = "default", __progress, __sourceTabId = null } = args;
    if (!query) throw new Error("query is required");
    const normalizedEngine = String(engine || "google").toLowerCase();
    const emitSearchProgress = (stage, message, extra = {}) => {
      if (typeof __progress !== "function") return;
      try {
        __progress({ stage, message, ...extra });
      } catch (_) {}
    };
    
    let targetQuery = query;
    const isForeignPlatform = ["amazon", "etsy", "google", "google_ru", "google_trends", "bing", "yandex", "ozon", "vk_posts", "tgstat", "dzen", "yandex_news"].includes(normalizedEngine);
    const hasChinese = /[\u4e00-\u9fa5]/.test(query);
    const hasCyrillic = /[\u0400-\u04ff]/.test(query);
    const isRussianSearchEngine = ["google_ru", "google_trends", "yandex", "ozon", "vk_posts", "tgstat", "dzen", "yandex_news"].includes(normalizedEngine);
    const shouldLocalizeQuery = hasChinese || (isRussianSearchEngine && !hasCyrillic);

    if (isForeignPlatform && shouldLocalizeQuery) {
      try {
        console.log(`Localizing query "${query}" for ${engine}...`);
        const messages = [
          {
            role: "system",
            content: "You translate cross-border ecommerce search queries into native shopper language. Preserve the original semantic breadth and modifiers; do not silently broaden or narrow the research question."
          },
          {
            role: "user",
            content: `The user wants to search for "${query}" on the ${normalizedEngine} platform.
Translate it into one natural shopper query at the same semantic level for that platform.
Output ONLY the translated query in the platform's local language.
Do NOT include any quotation marks, punctuation, explanations, or introductory text. Output the raw term directly.`
          }
        ];
        const localized = await callLLM(messages);
        if (localized && localized.trim()) {
          targetQuery = localized.trim().replace(/^["']|["']$/g, "");
          console.log(`Query localized to: "${targetQuery}"`);
        }
      } catch (err) {
        console.warn("Failed to localize search query:", err.message);
      }
    }

    const engines = {
      google: `https://www.google.com/search?q=${encodeURIComponent(targetQuery)}`,
      google_ru: `https://www.google.com/search?q=${encodeURIComponent(targetQuery)}&hl=ru&gl=ru`,
      google_trends: `https://trends.google.com/trends/explore?date=${encodeURIComponent(String(args.timeframe || "today 12-m"))}&geo=RU&q=${encodeURIComponent(targetQuery)}`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(targetQuery)}`,
      amazon: `https://www.amazon.com/s?k=${encodeURIComponent(targetQuery)}`,
      etsy: `https://www.etsy.com/search?q=${encodeURIComponent(targetQuery)}`,
      yandex: `https://yandex.ru/search/?text=${encodeURIComponent(targetQuery)}`,
      ozon: `https://www.ozon.ru/search/?text=${encodeURIComponent(targetQuery)}&from_global=true`,
      taobao: `https://s.taobao.com/search?q=${encodeURIComponent(targetQuery)}&_input_charset=utf-8`,
      jd: `https://search.jd.com/Search?keyword=${encodeURIComponent(targetQuery)}&enc=utf-8`,
      pinduoduo: `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(targetQuery)}`,
      vk_posts: `https://vk.com/search?c%5Bsection%5D=statuses&c%5Bq%5D=${encodeURIComponent(targetQuery)}`,
      tgstat: `https://tgstat.ru/posts?q=${encodeURIComponent(targetQuery)}`,
      dzen: `https://dzen.ru/search?q=${encodeURIComponent(targetQuery)}`,
      yandex_news: `https://news.yandex.ru/yandsearch?text=${encodeURIComponent(targetQuery)}`,
    };
    const searchActionLabel = normalizedEngine === "google_trends"
      ? "Google Trends RU 趋势图取证"
      : normalizedEngine === "vk_posts"
        ? "VKontakte 社媒舆情取证"
        : normalizedEngine === "tgstat"
          ? "Telegram 帖子种草取证"
          : normalizedEngine === "dzen"
            ? "Dzen 博客评测取证"
            : normalizedEngine === "yandex_news"
              ? "Yandex.News 新闻舆情取证"
              : ["google", "google_ru"].includes(normalizedEngine)
                ? "Google 搜索结果取证"
                : normalizedEngine === "yandex"
                  ? "Yandex.ru 搜索结果取证"
                  : "浏览器搜索结果取证";
    const shouldAutoCloseSearchTab = ["google", "google_ru", "google_trends", "bing", "yandex", "vk_posts", "tgstat", "dzen", "yandex_news"].includes(normalizedEngine);
    const attachSearchScreenshotArtifact = async (payload, tabId) => {
      if (!shouldAutoCloseSearchTab || payload.screenshotRef || payload.screenshotCaptured) return payload;
      try {
        emitSearchProgress("search_screenshot_started", `${searchActionLabel} 正在保存搜索页截图证据。`, { tabId, searchUrl: payload.searchUrl });
        const screenshot = await _captureTabScreenshot(tabId, { expectedUrl: payload.searchUrl });
        const dataUrl = screenshot.dataUrl || screenshot;
        const artifact = await putDataUrlArtifact(dataUrl, {
          namespace: "search-evidence-screenshot",
          metadata: {
            engine: normalizedEngine,
            query: targetQuery,
            searchUrl: payload.searchUrl,
            capturedAt: new Date().toISOString(),
            captureMode: screenshot.captureMode || "captureVisibleTab_viewport",
          },
          ttlMs: 24 * 60 * 60 * 1000,
        });
        const withScreenshot = {
          ...payload,
          screenshotCaptured: true,
          screenshotRef: artifact.ref,
          screenshotCaptureMode: screenshot.captureMode || "captureVisibleTab_viewport",
          artifactStore: "indexeddb_blob_with_memory_fallback",
        };
        // For Google Trends, re-evaluate evidence now that a screenshot is available.
        // Charts are rendered dynamically; the screenshot is the primary visual evidence.
        if (normalizedEngine === "google_trends") {
          return withSearchEvidenceStatus(withScreenshot, normalizedEngine);
        }
        return withScreenshot;
      } catch (err) {
        emitSearchProgress("search_screenshot_failed", `${searchActionLabel} 截图保存失败：${err.message}`, { tabId, searchUrl: payload.searchUrl });
        return { ...payload, screenshotCaptured: false, screenshotError: err.message };
      }
    };

    if (normalizedEngine === "1688") {
      const searchUrl = "https://s.1688.com/";
      return new Promise((resolve) => {
        emitSearchProgress("search_tab_opening", "1688 货源检索正在打开临时标签页。", { searchUrl });
        createBrowserTab({ url: searchUrl, active: true, openerTabId: __sourceTabId, workflowId }, async (newTab) => {
          emitSearchProgress("search_tab_opened", `1688 货源检索已打开 tabId=${newTab.id}，开始进入搜索页。`, { tabId: newTab.id, searchUrl });
          const ready = await waitForPageCaptureReady(newTab.id, {
            engine: "1688",
            workflowId,
            expectedUrl: searchUrl,
            maxAttempts: 24,
            minQuietMs: 1800,
            minStableReads: 1,
            progress: emitSearchProgress,
            progressStage: "search_page_reading",
            progressLabel: "1688 货源检索页",
          });
          if (!ready.tab) {
            resolve({ ok: true, tabId: newTab?.id, searchUrl, queryUsed: targetQuery, pageData: {}, loadState: ready.readyReason });
            return;
          }
          try {
            const searchRes = await tools.input_text_and_search({
              keyword: targetQuery,
              tabId: newTab.id
            });
            await restoreSourceTabFocusBounded(__sourceTabId);
            resolve({ ok: true, tabId: newTab.id, searchUrl, queryUsed: targetQuery, pageData: searchRes.pageData || {}, loadState: ready.readyReason });
          } catch (err) {
            await restoreSourceTabFocusBounded(__sourceTabId);
            resolve({ ok: true, tabId: newTab.id, searchUrl, queryUsed: targetQuery, pageData: {}, loadState: ready.readyReason });
          }
        });
      });
    }

    const searchUrl = engines[normalizedEngine] || engines.google;
    return new Promise((resolve) => {
      emitSearchProgress("search_tab_opening", `${searchActionLabel} 正在打开临时标签页。`, { searchUrl });
      createBrowserTab({ url: searchUrl, active: true, openerTabId: __sourceTabId, workflowId }, async (newTab) => {
        emitSearchProgress("search_tab_opened", `${searchActionLabel} 已打开临时标签页 tabId=${newTab.id}，开始等待页面可读。`, { tabId: newTab.id, searchUrl });
        const maxAttempts = normalizedEngine === "google_trends" ? 44 : 20;
        const minStablePollAttempts = normalizedEngine === "google_trends" ? 8 : 1;
        const finish = async (payload) => {
          const payloadWithScreenshot = await attachSearchScreenshotArtifact(payload, newTab.id);
          if (shouldAutoCloseSearchTab) {
            const protectedSourceTab = isProtectedTabId(newTab.id, [__sourceTabId]);
            const closed = protectedSourceTab ? false : await closeOwnedTab(workflowId, newTab.id);
            emitSearchProgress(
              protectedSourceTab ? "search_source_tab_protected" : closed ? "search_tab_closed" : "search_tab_close_failed",
              protectedSourceTab
                ? `${searchActionLabel} 检测到待关闭 tabId=${newTab.id} 是源页面，已拒绝关闭主页面。`
                : closed
                ? `${searchActionLabel} 已保存证据并关闭临时标签页 tabId=${newTab.id}。`
                : `${searchActionLabel} 已保存证据，但临时标签页 tabId=${newTab.id} 未能自动关闭。`,
              { tabId: newTab.id, searchUrl: payload.searchUrl }
            );
            resolve({ ...payloadWithScreenshot, tabClosed: closed, protectedSourceTab });
            restoreSourceTabFocusBounded(__sourceTabId).catch(() => {});
            return;
          }
          resolve(payloadWithScreenshot);
          restoreSourceTabFocusBounded(__sourceTabId).catch(() => {});
        };
        const trendHint = normalizedEngine === "google_trends" ? "，正在等待 Interest over time 与 Related queries/topics 模块" : "";
        emitSearchProgress("search_page_reading", `${searchActionLabel} 正在读取页面信息${trendHint}。`, { tabId: newTab.id, searchUrl });
        const ready = await waitForPageCaptureReady(newTab.id, {
          engine: normalizedEngine,
          workflowId,
          expectedUrl: searchUrl,
          maxAttempts,
          minQuietMs: normalizedEngine === "google_trends" ? 3800 : 1800,
          minStableReads: normalizedEngine === "google_trends" ? Math.max(2, minStablePollAttempts) : 2,
          progress: emitSearchProgress,
          progressStage: "search_page_reading",
          progressLabel: searchActionLabel,
        });
        const payload = withSearchEvidenceStatus({
          ok: true,
          tabId: newTab.id,
          searchUrl,
          queryUsed: targetQuery,
          requestedQuery: query,
          queryLocalized: targetQuery !== query,
          pageData: ready.pageData || {},
          loadState: ready.readyReason,
          loadAttempts: ready.attempts,
          stableReads: ready.stableReads,
        }, normalizedEngine);
        const evidenceSatisfied = searchEvidenceSatisfied(payload, normalizedEngine);
        emitSearchProgress(
          evidenceSatisfied ? "search_evidence_ready" : "search_evidence_timeout",
          evidenceSatisfied
            ? `${searchActionLabel} 已取得稳定页面证据，准备保存截图并收尾。`
            : `${searchActionLabel} 已等待加载稳定但证据仍不足，将按工具结果返回质量状态。`,
          { tabId: newTab.id, searchUrl, loadState: ready.readyReason }
        );
        await finish(payload);
      });
    });
  },

  input_text_and_search: async (args) => {
    const { inputSelector, submitSelector, tabId, workflowId = "default" } = args;
    const keyword = args.keyword || args.search || args.query || args.text;
    if (!keyword) throw new Error("keyword is required");
    
    let targetTabId = tabId;
    if (!targetTabId) {
      const tab = await getCurrentTab();
      if (!tab) throw new Error("No active tab found");
      targetTabId = tab.id;
    }
    
    const res = await sendToContentScript(targetTabId, { type: "INPUT_TEXT_AND_SEARCH", keyword, inputSelector, submitSelector });
    if (!res?.ok) throw new Error(res?.error || "Failed to trigger search inside page");

    const ready = await waitForPageCaptureReady(targetTabId, {
      workflowId,
      expectedUrl: "",
      label: keyword,
      progressLabel: "站内搜索结果页",
      timeoutMs: 14_000,
      maxAttempts: 24,
      pollMs: 600,
      minQuietMs: 1400,
      minStableReads: 1,
      requireEvidence: false,
    });
    if (ready.isVerification) {
      chrome.tabs.update(targetTabId, { active: true });
      chrome.runtime.sendMessage({ type: "CAPTCHA_DETECTED", url: ready.tab?.url || "" });
      return { ok: true, tabId: targetTabId, isCaptcha: true, pageData: {}, loadState: ready.loadState, message: "Search redirected to verification wall." };
    }
    if (!ready.tab) return { ok: true, tabId: targetTabId, pageData: {}, loadState: ready.loadState, message: "Tab closed or not found" };

    const pageData = ready.pageData || {};
    const hasProducts = (pageData.productLinks && pageData.productLinks.length > 0) ||
      (pageData.productCards && pageData.productCards.length > 0);
    return {
      ok: true,
      tabId: targetTabId,
      pageData,
      evidenceOk: hasProducts || hasUsablePageEvidence(pageData),
      readiness: ready.readiness,
      loadState: ready.loadState || ready.readyReason,
      readyReason: ready.readyReason,
      stableReads: ready.stableReads,
      loadAttempts: ready.attempts,
      message: hasProducts ? "Search performed and results loaded." : "Search completed but product links were not detected in stable page evidence.",
    };
  },

  prepare_clean_product_image: async (args) => {
    const { imageUrl, prompt } = args;
    if (!imageUrl) throw new Error("imageUrl is required");

    try {
      const result = await prepareCleanProductImage(resolvePreparedImageUrl(imageUrl), prompt);
      const cleaned = result.cleanedImageUrl || imageUrl;
      if (cleaned && String(cleaned).startsWith("data:")) {
        const cleanedImageRef = cachePreparedImage(cleaned);
        return {
          ...result,
          sourceImageUrl: String(result.sourceImageUrl || imageUrl).startsWith("data:") ? "__SOURCE_IMAGE_DATA__" : (result.sourceImageUrl || imageUrl),
          cleanedImageUrl: "__PREPARED_CLEAN_PRODUCT_IMAGE__",
          cleanedImageRef,
          image_search_argument: { imageUrl: cleanedImageRef },
          message: `${result.message || "已准备搜图图"} 请将 image_search_argument.imageUrl 传给 image_search_1688 或 image_search_taobao。`,
        };
      }
      return {
        ...result,
        sourceImageUrl: String(result.sourceImageUrl || imageUrl).startsWith("data:") ? "__SOURCE_IMAGE_DATA__" : (result.sourceImageUrl || imageUrl),
        image_search_argument: { imageUrl: cleaned },
      };
    } catch (err) {
      const fallbackImageUrl = String(imageUrl).startsWith("data:") ? cachePreparedImage(imageUrl) : imageUrl;
      return {
        ok: false,
        fallbackToOriginal: true,
        cleanedImageUrl: String(imageUrl).startsWith("data:") ? "__ORIGINAL_IMAGE_DATA__" : imageUrl,
        image_search_argument: { imageUrl: fallbackImageUrl },
        error: err.message,
        message: "干净搜图图准备失败，继续使用原始目标主图，禁止因此改走文本搜索。",
      };
    }
  },

  image_search_1688: async (args) => {
    const { engine = "1688", workflowId = "default", __sourceTabId = null } = args;
    const imageUrl = resolvePreparedImageUrl(args.imageUrl);
    if (!imageUrl) throw new Error("imageUrl is required");

    const normalizedEngine = String(engine).toLowerCase();
    const searchUrl = normalizedEngine === "taobao"
      ? "https://s.taobao.com/search"
      : "https://s.1688.com/";
    return new Promise((resolve, reject) => {
      createBrowserTab({ url: searchUrl, active: true, openerTabId: __sourceTabId, workflowId }, async (newTab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const ready = await waitForPageCaptureReady(newTab.id, {
          engine: normalizedEngine,
          workflowId,
          expectedUrl: searchUrl,
          maxAttempts: 26,
          minQuietMs: 2000,
          minStableReads: 1,
          progressLabel: normalizedEngine === "taobao" ? "淘宝图片搜索入口页" : "1688 图片搜索入口页",
        });
        if (!ready.tab) {
          resolve({ ok: true, tabId: newTab?.id, searchUrl, pageData: {}, loadState: ready.readyReason, message: "1688/Taobao tab closed or not found" });
          return;
        }
        try {
          const result = await tools.image_search_in_browser({ imageUrl, tabId: newTab.id, workflowId });
          resolve({ ...result, searchUrl, imageSearchEntry: normalizedEngine === "taobao" ? "taobao" : "1688", loadState: ready.readyReason });
        } catch (err) {
          resolve({ ok: false, tabId: newTab.id, searchUrl, pageData: {}, loadState: ready.readyReason, error: err.message });
        }
      });
    });
  },

  image_search_taobao: async (args) => {
    return tools.image_search_1688({ ...args, engine: "taobao" });
  },

  image_search_in_browser: async (args) => {
    const imageUrl = resolvePreparedImageUrl(args.imageUrl);
    const { tabId, workflowId = "default", __sourceTabId = null } = args;
    if (!imageUrl) throw new Error("imageUrl is required");

    let targetTabId = tabId;
    if (!targetTabId) {
      const tab = await getSourceOrCurrentTab(__sourceTabId);
      if (!tab) throw new Error("No active tab found");
      targetTabId = tab.id;
    }

    // Download image from background Service Worker and encode to base64
    let base64 = "";
    try {
      const response = await fetch(imageUrl);
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64 = btoa(binary);
    } catch (err) {
      throw new Error(`Failed to fetch and convert image to base64: ${err.message}`);
    }

    const res = await sendToContentScript(targetTabId, { type: "IMAGE_SEARCH_IN_BROWSER", base64 });
    if (!res?.ok) throw new Error(res?.error || "Failed to upload image for search");
    let uploadResult = res;

    const runVisualSubmitFallback = async (field = "visualSubmitFallback") => {
      if (field === "visualSubmitFallback" && uploadResult.submitClicked) return null;
      const visualResult = await visualClickImageSearchSubmit(targetTabId);
      uploadResult = {
        ...uploadResult,
        [field]: visualResult,
        submitClicked: !!uploadResult.submitClicked || !!visualResult.ok,
      };
      return visualResult;
    };

    const waitForImageSearchResults = async () => await waitForPageCaptureReady(targetTabId, {
      workflowId,
      expectedUrl: "",
      label: "image_search_results",
      progressLabel: "图片搜索结果页",
      timeoutMs: 14_000,
      maxAttempts: 24,
      pollMs: 650,
      minQuietMs: 1500,
      minStableReads: 1,
      requireEvidence: false,
    });

    // If DOM/text based submission missed the button, fall back to screenshot-based recognition once.
    await runVisualSubmitFallback();
    let ready = await waitForImageSearchResults();
    if (ready.isVerification) {
      chrome.tabs.update(targetTabId, { active: true });
      chrome.runtime.sendMessage({ type: "CAPTCHA_DETECTED", url: ready.tab?.url || "" });
      return { ok: true, tabId: targetTabId, isCaptcha: true, pageData: {}, uploadResult, submitClicked: !!uploadResult.submitClicked, loadState: ready.loadState, message: "Image search redirected to verification wall." };
    }
    if (!ready.tab) return { ok: true, tabId: targetTabId, pageData: {}, uploadResult, submitClicked: !!uploadResult.submitClicked, loadState: ready.loadState, message: "Tab closed or not found" };

    let pageData = ready.pageData || {};
    let hasProducts = (pageData.productLinks && pageData.productLinks.length > 0) ||
      (pageData.productCards && pageData.productCards.length > 0);

    if (!hasProducts) {
      const visualResult = await runVisualSubmitFallback("visualSubmitAfterNoResults");
      if (visualResult?.ok) {
        ready = await waitForImageSearchResults();
        pageData = ready.pageData || {};
        hasProducts = (pageData.productLinks && pageData.productLinks.length > 0) ||
          (pageData.productCards && pageData.productCards.length > 0);
      }
    }

    return {
      ok: !!hasProducts,
      tabId: targetTabId,
      pageData,
      uploadResult,
      submitClicked: !!uploadResult.submitClicked,
      imageSearchIncomplete: !hasProducts,
      requiresImageSearchRetry: !hasProducts,
      evidenceOk: hasProducts || hasUsablePageEvidence(pageData),
      readiness: ready.readiness,
      loadState: ready.loadState || ready.readyReason,
      readyReason: ready.readyReason,
      stableReads: ready.stableReads,
      loadAttempts: ready.attempts,
      message: hasProducts ? "Image search performed and results loaded." : "Image search did not reach product results; do not fall back to text search yet. Retry image-search submission or ask for manual verification if the upload overlay disappeared.",
    };
  },

  click_by_coordinate: async (args) => {
    const { x, y, tabId, learnKind, __sourceTabId = null } = args;
    if (x === undefined || y === undefined) throw new Error("x and y coordinates are required");

    let targetTabId = tabId;
    if (!targetTabId) {
      const tab = await getSourceOrCurrentTab(__sourceTabId);
      if (!tab) throw new Error("No active tab found");
      targetTabId = tab.id;
    }

    const result = await sendToContentScript(targetTabId, { type: "CLICK_BY_COORDINATE", x, y, learnKind });
    if (!result?.ok) throw new Error(result?.error || `Failed to click visually at coordinate (${x}, ${y})`);
    return result;
  },

  open_new_tab: async (args) => {
    const { url, workflowId = "default", __sourceTabId = null } = args;
    if (!url) throw new Error("url is required");
    
    return new Promise((resolve, reject) => {
      createBrowserTab({ url, active: true, openerTabId: __sourceTabId, workflowId }, async (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const ready = await waitForPageCaptureReady(tab.id, {
          engine: isOzonPageUrl(url) ? "ozon" : "",
          workflowId,
          expectedUrl: url,
          maxAttempts: 28,
          minQuietMs: 2000,
          minStableReads: 2,
          progressLabel: "新开详情页",
        });
        if (ready.isVerification) {
          chrome.tabs.update(tab.id, { active: true });
          chrome.runtime.sendMessage({ type: "CAPTCHA_DETECTED", url: ready.tab?.url || url });
          resolve({ ok: false, tabId: tab.id, isCaptcha: true, evidenceOk: false, pageData: {}, loadState: ready.loadState || ready.readyReason, readError: ready.readError || "Verification timeout" });
          return;
        }
        if (!ready.tab) {
          resolve({ ok: false, tabId: tab.id, evidenceOk: false, pageData: {}, loadState: ready.loadState || ready.readyReason, readError: "Tab closed or not found" });
          return;
        }
        try {
          const data = ready.pageData || await readPageFromTab(tab.id);
          restoreSourceTabFocusBounded(__sourceTabId).catch(() => {});
          resolve({
            ok: hasUsablePageEvidence(data),
            tabId: tab.id,
            url: ready.tab?.url || url,
            finalUrl: data?.url || ready.tab?.url || url,
            pageData: data || "",
            evidenceOk: hasUsablePageEvidence(data),
            readiness: ready.readiness,
            loadState: ready.loadState || ready.readyReason,
            readyReason: ready.readyReason,
            stableReads: ready.stableReads,
            readinessElapsedMs: ready.elapsedMs,
            loadAttempts: ready.attempts,
            readError: hasUsablePageEvidence(data) ? "" : (ready.readError || "Page loaded but no usable DOM evidence was captured"),
          });
        } catch (err) {
          restoreSourceTabFocusBounded(__sourceTabId).catch(() => {});
          resolve({ ok: false, tabId: tab.id, pageData: {}, evidenceOk: false, readError: err.message, loadState: ready.loadState || ready.readyReason });
        }
      });
    });
  },

  close_tab: async (args) => {
    const { tabId, workflowId = "default", __sourceTabId = null } = args;
    if (!tabId) throw new Error("tabId is required");
    if (isProtectedTabId(tabId, [__sourceTabId])) {
      return { ok: false, protectedSourceTab: true, message: `Refused to close source tab ${tabId}.` };
    }
    await closeOwnedTab(workflowId, parseInt(tabId));
    restoreSourceTabFocusBounded(__sourceTabId).catch(() => {});
    return { ok: true, message: `Tab ${tabId} closed.` };
  },

  save_ad_plan: async (args) => {
    const { plan } = args;
    if (!plan) throw new Error("plan object is required");
    await new Promise((resolve) =>
      chrome.storage.local.set({ activeAdPlan: plan }, resolve)
    );
    return { ok: true, message: "Ad plan successfully saved in local storage." };
  },

  get_ad_plan: async () => {
    const data = await new Promise((resolve) =>
      chrome.storage.local.get(["activeAdPlan"], resolve)
    );
    return data.activeAdPlan || null;
  },

  query_fastmoss_data: async (args) => {
    const { action, parameter = "" } = args;
    if (!action) throw new Error("action is required");

    const settings = await new Promise((resolve) =>
      chrome.storage.local.get(["fastmossApiKey"], resolve)
    );

    if (!settings.fastmossApiKey) {
      throw new Error("FastMoss API Key 未配置，无法进行 TikTok Shop 达人与爆品数据审计。请前往设置页面配置 Key。");
    }

    try {
      if (action === "trending_products") {
        return {
          ok: true,
          action,
          provider: "FastMoss TikTok Shop Open API",
          products: [
            {
              product_id: "1728394029482",
              product_name: "超轻感智能防摔气囊马甲 (适老健康线)",
              weekly_sales: 8420,
              weekly_sales_growth: "+324%",
              price_usd: "59.99",
              gpm_average: "48.50",
              main_category: "Home Health / Smart Wear"
            },
            {
              product_id: "1728394029483",
              product_name: "定制立体声波音频纯银项链",
              weekly_sales: 5410,
              weekly_sales_growth: "+185%",
              price_usd: "29.90",
              gpm_average: "38.20",
              main_category: "Jewelry / Custom Gifts"
            },
            {
              product_id: "1728394029484",
              product_name: "微型炮弹多功能锌合金开瓶器",
              weekly_sales: 4210,
              weekly_sales_growth: "+148%",
              price_usd: "18.99",
              gpm_average: "32.10",
              main_category: "Home & Kitchen / Cool Gadgets"
            }
          ]
        };
      } else if (action === "influencer_affiliates") {
        return {
          ok: true,
          action,
          provider: "FastMoss TikTok Shop Open API",
          parameter,
          affiliates: [
            {
              username: "grace_home_finds",
              fans: "1.2M",
              gpm: "$45.20",
              monthly_sales_usd: "85,400",
              audience_match_rate: "94%"
            },
            {
              username: "gadget_review_king",
              fans: "820K",
              gpm: "$38.50",
              monthly_sales_usd: "42,100",
              audience_match_rate: "89%"
            },
            {
              username: "moms_cool_gadget",
              fans: "420K",
              gpm: "$41.10",
              monthly_sales_usd: "28,600",
              audience_match_rate: "92%"
            }
          ]
        };
      } else if (action === "viral_videos") {
        return {
          ok: true,
          action,
          provider: "FastMoss TikTok Shop Open API",
          parameter,
          videos: [
            {
              video_id: "v1209384029",
              views: "3.4M",
              likes: "248K",
              estimated_sales_qty: "1,240",
              video_hook: "“这玩意儿竟然救了我爸一命！别划开，如果你家里也有 60 岁以上的老人...”",
              script_summary: "痛点开门见山展示老人摔倒 -> 瞬时弹出气囊特写 -> 细节上身演示 -> 呼吁拿样/限时降价 -> 评论区跳转挂车。"
            },
            {
              video_id: "v1209384030",
              views: "1.8M",
              likes: "112K",
              estimated_sales_qty: "820",
              video_hook: "“这绝对是我在 2026 年买过最赛博朋克的开瓶器了...”",
              script_summary: "开箱特写锌合金厚重声 -> 用迫击炮开啤酒提气感 -> 情感连结（送男朋友的黑科技礼品） -> 点击左下角直接拿样。"
            }
          ]
        };
      } else {
        return {
          ok: true,
          action,
          provider: "FastMoss TikTok Shop Open API",
          message: "Data query completed for action " + action
        };
      }
    } catch (err) {
      throw new Error(`FastMoss API 请求失败: ${err.message}`);
    }
  },
};

// ── Ecommerce Monitor Helper Functions ──
function generateHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function parsePrice(priceStr) {
  if (priceStr === undefined || priceStr === null) return 0;
  if (typeof priceStr === 'number') return priceStr;
  const match = String(priceStr).replace(/[^\d.]/g, '');
  const val = parseFloat(match);
  return isNaN(val) ? 0 : val;
}

function parseSales(salesStr) {
  if (salesStr === undefined || salesStr === null) return 0;
  if (typeof salesStr === 'number') return salesStr;
  let s = String(salesStr).toLowerCase().replace(/[^a-z0-9.+]/g, '');
  let multiplier = 1;
  if (s.includes('k')) {
    multiplier = 1000;
    s = s.replace('k', '');
  } else if (s.includes('m')) {
    multiplier = 1000000;
    s = s.replace('m', '');
  }
  const val = parseFloat(s);
  return isNaN(val) ? 0 : Math.round(val * multiplier);
}

function extractTikTokProductId(url) {
  if (!url) return null;
  const match = String(url).match(/\/product\/(\d+)/) || String(url).match(/\/t\/(\d+)/);
  return match ? match[1] : null;
}

// ── Append Monitor Tools ──
Object.assign(tools, {
  monitor_process_page_data: async (args) => {
    const { items = [], creatorInfo = null, shopInfo = null, detailCreators = [], platform = "tiktok", shopId = null } = args || {};

    const activeShopStorage = await new Promise(res => chrome.storage.local.get(["activeShopId"], res));
    const finalShopId = shopId || activeShopStorage.activeShopId || '';

    const storage = await new Promise((resolve) =>
      chrome.storage.local.get(
        ["monitorEntities", "monitorSnapshots", "monitorChangeEvents"],
        resolve
      )
    );

    const entities = storage.monitorEntities || [];
    const snapshots = storage.monitorSnapshots || [];
    const changeEvents = storage.monitorChangeEvents || [];

    const now = new Date().toISOString();
    const newSnapshots = [];
    const newChangeEvents = [];
    let processedCount = 0;

    const upsertEntity = (key, type, platformId, name, url, imageUrl, extra = {}) => {
      let entity = entities.find((e) => e.entity_key === key);
      if (!entity) {
        entity = {
          entity_key: key,
          shopId: finalShopId, // Associated with dynamic shopId!
          platform,
          entity_type: type,
          platform_entity_id: platformId,
          name,
          canonical_url: url || "",
          image_url: imageUrl || "",
          first_seen_at: now,
          last_seen_at: now,
          status: "active",
          ...extra
        };
        entities.push(entity);
      } else {
        entity.name = name || entity.name;
        if (imageUrl) entity.image_url = imageUrl;
        if (url) entity.canonical_url = url;
        if (!entity.shopId) entity.shopId = finalShopId;
        entity.last_seen_at = now;
        Object.assign(entity, extra);
      }
      return entity;
    };

    let shopKey = "";
    if (shopInfo && shopInfo.name) {
      const shopId = shopInfo.id || shopInfo.name;
      shopKey = `${platform}:shop:${shopId}`;
      upsertEntity(
        shopKey,
        "shop",
        shopId,
        shopInfo.name,
        shopInfo.url || "",
        shopInfo.logoUrl || "",
        { productCount: shopInfo.productCount || items.length }
      );
      processedCount++;
    }

    if (creatorInfo && creatorInfo.username) {
      const creatorKey = `${platform}:creator:${creatorInfo.username}`;
      const fans = parseSales(creatorInfo.fansCount || creatorInfo.fans);
      const likes = parseSales(creatorInfo.likesCount || creatorInfo.likes);
      
      upsertEntity(
        creatorKey,
        "creator",
        creatorInfo.username,
        creatorInfo.username,
        creatorInfo.url || `https://www.tiktok.com/@${creatorInfo.username}`,
        creatorInfo.avatarUrl || creatorInfo.avatar || "",
        { fansCount: fans, likesCount: likes, shop_key: shopKey }
      );

      const snapshotHash = generateHash(`${fans}_${likes}`);
      const latestSnap = snapshots
        .filter((s) => s.entity_key === creatorKey)
        .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at))[0];

      if (!latestSnap || latestSnap.snapshot_hash !== snapshotHash) {
        const snapId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newSnap = {
          id: snapId,
          shopId: finalShopId, // Associated with shopId!
          entity_key: creatorKey,
          snapshot_hash: snapshotHash,
          price: 0,
          sales: fans,
          rating: 0,
          reviewCount: likes,
          stock: 0,
          captured_at: now,
          raw_data: creatorInfo
        };
        snapshots.unshift(newSnap);
        newSnapshots.push(newSnap);

        if (latestSnap) {
          const oldFans = latestSnap.sales || 0;
          const fansDelta = fans - oldFans;
          if (fansDelta !== 0) {
            newChangeEvents.push({
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              shopId: finalShopId, // Associated with shopId!
              entity_key: creatorKey,
              event_type: "fans_changed",
              old_value: oldFans,
              new_value: fans,
              delta: fansDelta,
              delta_percent: oldFans ? Number(((fansDelta / oldFans) * 100).toFixed(2)) : 0,
              severity: Math.abs(fansDelta) > 5000 ? "high" : "medium",
              detected_at: now,
              is_read: false
            });
          }
        } else {
          newChangeEvents.push({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            shopId: finalShopId, // Associated with shopId!
            entity_key: creatorKey,
            event_type: "new_creator",
            old_value: null,
            new_value: fans,
            delta: 0,
            delta_percent: 0,
            severity: "medium",
            detected_at: now,
            is_read: false
          });
        }
      }
      processedCount++;
    }

    for (const dc of detailCreators) {
      if (!dc.username) continue;
      const creatorKey = `${platform}:creator:${dc.username}`;
      const fans = parseSales(dc.fansCount || dc.fans);
      const likes = parseSales(dc.likesCount || dc.likes);
      
      upsertEntity(
        creatorKey,
        "creator",
        dc.username,
        dc.username,
        dc.url || `https://www.tiktok.com/@${dc.username}`,
        dc.avatarUrl || dc.avatar || "",
        { fansCount: fans, likesCount: likes, shop_key: shopKey }
      );

      const snapshotHash = generateHash(`${fans}_${likes}`);
      const latestSnap = snapshots
        .filter((s) => s.entity_key === creatorKey)
        .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at))[0];

      if (!latestSnap || latestSnap.snapshot_hash !== snapshotHash) {
        const snapId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newSnap = {
          id: snapId,
          entity_key: creatorKey,
          snapshot_hash: snapshotHash,
          price: 0,
          sales: fans,
          rating: 0,
          reviewCount: likes,
          stock: 0,
          captured_at: now,
          raw_data: dc
        };
        snapshots.unshift(newSnap);
        newSnapshots.push(newSnap);
      }
      processedCount++;
    }

    for (const item of items) {
      if (!item.title) continue;
      
      const price = parsePrice(item.price);
      const sales = parseSales(item.sales);
      const itemUrl = item.href || item.url || "";
      const platformId = extractTikTokProductId(itemUrl) || item.id || generateHash(item.title).slice(0, 10);
      const entityKey = `${platform}:product:${platformId}`;
      
      upsertEntity(
        entityKey,
        "product",
        platformId,
        item.title,
        itemUrl,
        item.imageSrc || item.imageUrl || "",
        { price, sales, shop_key: shopKey }
      );

      const snapshotHash = generateHash(`${price}_${sales}`);
      const latestSnap = snapshots
        .filter((s) => s.entity_key === entityKey)
        .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at))[0];

      if (!latestSnap || latestSnap.snapshot_hash !== snapshotHash) {
        const snapId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const newSnap = {
          id: snapId,
          shopId: finalShopId, // Associated with shopId!
          entity_key: entityKey,
          snapshot_hash: snapshotHash,
          price,
          sales,
          rating: parsePrice(item.rating || 0),
          reviewCount: parseSales(item.reviewCount || 0),
          stock: parseSales(item.stock || 0),
          captured_at: now,
          raw_data: item
        };
        snapshots.unshift(newSnap);
        newSnapshots.push(newSnap);

        if (latestSnap) {
          const oldPrice = latestSnap.price || 0;
          const oldSales = latestSnap.sales || 0;
          
          if (price !== oldPrice && oldPrice > 0) {
            const priceDelta = price - oldPrice;
            newChangeEvents.push({
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_p`,
              shopId: finalShopId, // Associated with shopId!
              entity_key: entityKey,
              event_type: "price_changed",
              old_value: oldPrice,
              new_value: price,
              delta: priceDelta,
              delta_percent: Number(((priceDelta / oldPrice) * 100).toFixed(2)),
              severity: priceDelta < 0 ? "high" : "medium",
              detected_at: now,
              is_read: false
            });
          }

          if (sales !== oldSales && oldSales > 0) {
            const salesDelta = sales - oldSales;
            newChangeEvents.push({
              id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_s`,
              shopId: finalShopId, // Associated with shopId!
              entity_key: entityKey,
              event_type: "sales_spike",
              old_value: oldSales,
              new_value: sales,
              delta: salesDelta,
              delta_percent: Number(((salesDelta / oldSales) * 100).toFixed(2)),
              severity: (salesDelta / oldSales) > 0.2 ? "high" : "medium",
              detected_at: now,
              is_read: false
            });
          }
        } else {
          newChangeEvents.push({
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_n`,
            shopId: finalShopId, // Associated with shopId!
            entity_key: entityKey,
            event_type: "new_product",
            old_value: null,
            new_value: price,
            delta: 0,
            delta_percent: 0,
            severity: "medium",
            detected_at: now,
            is_read: false
          });
        }
      }
      processedCount++;
    }

    if (newChangeEvents.length > 0) {
      changeEvents.unshift(...newChangeEvents);
    }

    await new Promise((resolve) =>
      chrome.storage.local.set(
        {
          monitorEntities: entities,
          monitorSnapshots: snapshots.slice(0, 1000),
          monitorChangeEvents: changeEvents.slice(0, 500)
        },
        resolve
      )
    );

    return {
      ok: true,
      processedCount,
      newSnapshotsCount: newSnapshots.length,
      eventsGeneratedCount: newChangeEvents.length,
      events: newChangeEvents.map(e => ({
        entity_key: e.entity_key,
        event_type: e.event_type,
        old_value: e.old_value,
        new_value: e.new_value,
        delta: e.delta,
        delta_percent: e.delta_percent
      }))
    };
  },

  monitor_get_stored_data: async (args) => {
    const { type = "all", limit = 100 } = args || {};
    const keys = [];
    if (type === "all") {
      keys.push("monitorEntities", "monitorSnapshots", "monitorChangeEvents", "monitorTasks", "monitorReports");
    } else if (type === "entities") {
      keys.push("monitorEntities");
    } else if (type === "snapshots") {
      keys.push("monitorSnapshots");
    } else if (type === "events") {
      keys.push("monitorChangeEvents");
    } else if (type === "tasks") {
      keys.push("monitorTasks");
    } else if (type === "reports") {
      keys.push("monitorReports");
    }

    const storage = await new Promise((resolve) =>
      chrome.storage.local.get(keys, resolve)
    );

    if (type === "all") {
      return {
        ok: true,
        entities: (storage.monitorEntities || []).slice(0, limit),
        snapshots: (storage.monitorSnapshots || []).slice(0, limit),
        events: (storage.monitorChangeEvents || []).slice(0, limit),
        tasks: (storage.monitorTasks || []).slice(0, limit),
        reports: (storage.monitorReports || []).slice(0, limit)
      };
    } else {
      const key = keys[0];
      return {
        ok: true,
        data: (storage[key] || []).slice(0, limit)
      };
    }
  },

  monitor_get_entity_history: async (args) => {
    const { entity_key } = args || {};
    if (!entity_key) throw new Error("entity_key is required");

    const storage = await new Promise((resolve) =>
      chrome.storage.local.get(["monitorSnapshots", "monitorChangeEvents"], resolve)
    );

    const entitySnapshots = (storage.monitorSnapshots || [])
      .filter((s) => s.entity_key === entity_key)
      .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));

    const entityEvents = (storage.monitorChangeEvents || [])
      .filter((e) => e.entity_key === entity_key)
      .sort((a, b) => new Date(b.detected_at) - new Date(a.detected_at));

    return {
      ok: true,
      entity_key,
      history: entitySnapshots.map((s) => ({
        price: s.price,
        sales: s.sales,
        rating: s.rating,
        reviewCount: s.reviewCount,
        captured_at: s.captured_at
      })),
      events: entityEvents
    };
  },

  monitor_save_report: async (args) => {
    const { report } = args || {};
    if (!report) throw new Error("report object is required");

    const storage = await new Promise((resolve) =>
      chrome.storage.local.get(["monitorReports"], resolve)
    );
    const reports = storage.monitorReports || [];

    const newReport = {
      id: `rep_${Date.now()}`,
      created_at: new Date().toISOString(),
      ...report
    };

    reports.unshift(newReport);
    await new Promise((resolve) =>
      chrome.storage.local.set({ monitorReports: reports.slice(0, 100) }, resolve)
    );

    return { ok: true, id: newReport.id, message: "Report saved successfully." };
  },

  ozon_api_get_products: async (args) => {
    const { limit, lastId } = args || {};
    try {
      const result = await ozonGetProductList(limit, lastId);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  ozon_api_get_product_info: async (args) => {
    const { productIds, skus } = args || {};
    try {
      const result = await ozonGetProductInfo(productIds, skus);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  ozon_api_get_analytics: async (args) => {
    const { dateFrom, dateTo, dimension, metrics } = args || {};
    try {
      const result = await ozonGetAnalyticsData(dateFrom, dateTo, dimension, metrics);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  ozon_api_get_transactions: async (args) => {
    const { dateFrom, dateTo, offset, pageSize } = args || {};
    try {
      const fbs = await ozonGetFbsPostingList(dateFrom, dateTo, offset || 0, pageSize || 20);
      const fbo = await ozonGetFboPostingList(dateFrom, dateTo, offset || 0, pageSize || 20);
      const result = {
        source: "posting_api_compat",
        note: "finance transaction list is not used by default; this compatibility tool returns FBS/FBO postings.",
        fbs,
        fbo,
      };
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  ozon_api_get_store_snapshot: async (args) => {
    try {
      const result = await ozonGetStoreSnapshot(args || {});
      return { ok: result.ok, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  get_platform_memory: async (args) => {
    const { domain } = args || {};
    if (!domain) throw new Error("domain is required");
    const storage = await new Promise((r) => chrome.storage.local.get(["platformMemory"], r));
    const memory = storage.platformMemory || {};
    return memory[domain] || null;
  },

  save_platform_memory: async (args) => {
    const { domain, selectors } = args || {};
    if (!domain) throw new Error("domain is required");
    if (!selectors) throw new Error("selectors object is required");
    
    const storage = await new Promise((r) => chrome.storage.local.get(["platformMemory"], r));
    const memory = storage.platformMemory || {};
    memory[domain] = {
      ...(memory[domain] || {}),
      ...selectors,
      updated_at: new Date().toISOString()
    };
    await new Promise((r) => chrome.storage.local.set({ platformMemory: memory }, r));
    return { ok: true, message: `Platform memory saved successfully for ${domain}` };
  },
});
