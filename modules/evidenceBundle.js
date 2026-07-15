/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
const TEXT_LIMIT = 1200;
const TOOL_RESULT_LIMIT = 6000;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function truncateText(value, limit = TEXT_LIMIT) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function compactPageData(pageData = {}) {
  if (!isObject(pageData)) return {};
  return {
    url: pageData.url || pageData.canonicalUrl || "",
    title: pageData.title || pageData.h1 || "",
    pageType: pageData.pageType || "",
    visibleTextLength: String(pageData.visibleText || pageData.text || pageData.bodyText || "").length,
    productCardCount: Array.isArray(pageData.productCards) ? pageData.productCards.length : 0,
    productLinkCount: Array.isArray(pageData.productLinks) ? pageData.productLinks.length : 0,
    imageCount: Array.isArray(pageData.images) ? pageData.images.length : 0,
    productCards: (Array.isArray(pageData.productCards) ? pageData.productCards : []).slice(0, 8).map((card) => ({
      title: truncateText(card.title || card.name || "", 160),
      price: card.price || "",
      url: card.href || card.url || card.link || "",
      imageSrc: card.imageSrc || card.imageUrl || card.img || "",
    })),
    productLinks: (Array.isArray(pageData.productLinks) ? pageData.productLinks : []).slice(0, 12).map((link) => ({
      title: truncateText(link.title || link.text || "", 120),
      url: link.href || link.url || link.link || "",
    })),
    pageHealth: pageData.pageHealth || {},
    pageEvidence: pageData.pageEvidence || {},
  };
}

function compactResult(result = {}) {
  if (!isObject(result)) return result;
  const compacted = {
    ok: result.ok,
    tabId: result.tabId,
    url: result.url || result.finalUrl || result.searchUrl || result.pageData?.url || "",
    title: result.title || result.pageData?.title || "",
    evidenceOk: result.evidenceOk,
    loadState: result.loadState || result.readyReason || "",
    blockingGap: result.blockingGap || "",
    blockingGaps: result.blockingGaps || [],
    pageEvidence: result.pageEvidence || result.pageData?.pageEvidence || {},
    screenshotRef: result.screenshotRef || "",
    screenshotRefs: result.screenshotRefs || [],
    productCardsVisible: result.productCardsVisible,
    reviewCountCollected: result.reviewCountCollected,
    pages: Array.isArray(result.pages) ? result.pages.slice(0, 12).map(compactPageRecord) : undefined,
    shops: Array.isArray(result.shops) ? result.shops.slice(0, 8).map(compactShopRecord) : undefined,
    reviews: Array.isArray(result.reviews) ? result.reviews.slice(0, 20).map((review) => ({
      rating: review.rating || "",
      text: truncateText(review.text || review.content || "", 240),
      imageUrls: Array.isArray(review.imageUrls) ? review.imageUrls.slice(0, 4) : [],
    })) : undefined,
    pageData: compactPageData(result.pageData || {}),
  };
  return Object.fromEntries(Object.entries(compacted).filter(([, value]) => value !== undefined && value !== "" && value !== null));
}

function compactPageRecord(page = {}) {
  return {
    ok: page.ok,
    url: page.url || "",
    title: page.title || "",
    pageType: page.pageType || "",
    screenshotRef: page.screenshotRef || "",
    visibleTextSnippet: truncateText(page.visibleTextSnippet || "", 360),
    productCardsVisible: page.productCardsVisible,
    productCards: (Array.isArray(page.productCards) ? page.productCards : []).slice(0, 8).map((card) => ({
      title: truncateText(card.title || card.name || "", 160),
      price: card.price || "",
      url: card.href || card.url || card.link || "",
      imageSrc: card.imageSrc || card.imageUrl || card.img || "",
    })),
    blockingGap: page.blockingGap || "",
  };
}

function compactShopRecord(shop = {}) {
  return {
    url: shop.url || "",
    title: shop.title || shop.name || "",
    screenshotRefs: Array.isArray(shop.screenshotRefs) ? shop.screenshotRefs.slice(0, 8) : [],
    pages: Array.isArray(shop.pages) ? shop.pages.slice(0, 8).map(compactPageRecord) : [],
  };
}

function addScreenshotRef(refs, value) {
  if (!value) return;
  if (typeof value === "string") refs.add(value);
}

function collectRefsDeep(refs, value, depth = 0) {
  if (!value || depth > 5) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefsDeep(refs, item, depth + 1));
    return;
  }
  if (!isObject(value)) return;
  addScreenshotRef(refs, value.screenshotRef);
  if (Array.isArray(value.screenshotRefs)) value.screenshotRefs.forEach((ref) => addScreenshotRef(refs, ref));
  ["pages", "shops", "artifacts", "visualEvidence"].forEach((key) => collectRefsDeep(refs, value[key], depth + 1));
}

export function collectScreenshotRefsFromToolHistory(toolHistory = []) {
  const refs = new Set();
  toolHistory.forEach((entry) => collectRefsDeep(refs, entry?.result));
  return Array.from(refs);
}

export function collectPageEvidenceFromToolHistory(toolHistory = [], pageContext = {}) {
  const evidence = [];
  const push = (item) => {
    if (!item || !isObject(item)) return;
    evidence.push({
      tool: item.tool || "",
      url: item.url || "",
      title: item.title || "",
      evidenceOk: item.evidenceOk,
      loadState: item.loadState || "",
      pageEvidence: item.pageEvidence || {},
      pageData: item.pageData || {},
    });
  };
  if (pageContext.url || pageContext.title) {
    push({
      tool: "initial_page_context",
      url: pageContext.url || "",
      title: pageContext.title || "",
      evidenceOk: Boolean(pageContext.url || pageContext.screenshot || pageContext.productCards?.length),
      pageEvidence: pageContext.pageEvidence || {},
      pageData: compactPageData(pageContext),
    });
  }
  toolHistory.forEach((entry) => {
    const result = entry?.result || {};
    push({
      tool: entry?.tool || "",
      url: result.url || result.finalUrl || result.searchUrl || result.pageData?.url || "",
      title: result.title || result.pageData?.title || "",
      evidenceOk: result.evidenceOk,
      loadState: result.loadState || result.readyReason || "",
      pageEvidence: result.pageEvidence || result.pageData?.pageEvidence || {},
      pageData: compactPageData(result.pageData || {}),
    });
    (Array.isArray(result.pages) ? result.pages : []).forEach((page) => {
      push({
        tool: entry?.tool || "",
        url: page.url || "",
        title: page.title || "",
        evidenceOk: page.ok,
        pageEvidence: page.pageEvidence || {},
        pageData: compactPageRecord(page),
      });
    });
  });
  return evidence.filter((item) => item.url || item.title || Object.keys(item.pageEvidence || {}).length).slice(0, 40);
}

export function buildEvidenceBundle({
  savedEntry = {},
  output = {},
  pageContext = {},
  researchScope = {},
  evidenceQuality = {},
  toolHistory = [],
  workflowId = "",
} = {}) {
  const screenshotRefs = collectScreenshotRefsFromToolHistory(toolHistory);
  const pageEvidence = collectPageEvidenceFromToolHistory(toolHistory, pageContext);
  const toolTimeline = toolHistory.map((entry, index) => ({
    index: index + 1,
    tool: entry?.tool || "",
    arguments: entry?.arguments || {},
    result: compactResult(entry?.result || {}),
  }));
  const bundle = {
    id: `evidence_bundle_${savedEntry.id || Date.now()}`,
    schema_version: "1.0",
    createdAt: new Date().toISOString(),
    workflowId,
    reportId: savedEntry.id || "",
    skillId: savedEntry.skillId || "",
    skillName: savedEntry.skillName || "",
    growthActionId: savedEntry.growthActionId || "",
    growthRunId: savedEntry.growthRunId || "",
    growthCaseId: savedEntry.growthCaseId || "",
    page: {
      url: savedEntry.pageUrl || pageContext.url || "",
      title: savedEntry.pageTitle || pageContext.title || "",
      shopId: savedEntry.shopId || researchScope.active_shop_id || "",
    },
    research_scope: researchScope || {},
    evidence_quality: evidenceQuality || {},
    screenshotRefs,
    pageEvidence,
    toolTimeline,
    reportSummary: {
      title: output.case_title || output.title || savedEntry.skillName || "",
      status: output.report_status || "",
      dataCount: Array.isArray(output.data) ? output.data.length : 0,
      followUpTaskCount: Array.isArray(output.follow_up_tasks) ? output.follow_up_tasks.length : 0,
      blockingGapCount: Array.isArray(output.blocking_gaps) ? output.blocking_gaps.length : 0,
    },
  };
  const serialized = JSON.stringify(bundle);
  if (serialized.length <= TOOL_RESULT_LIMIT * 4) return bundle;
  return {
    ...bundle,
    toolTimeline: toolTimeline.map((entry) => ({
      index: entry.index,
      tool: entry.tool,
      arguments: entry.arguments,
      result: truncateText(JSON.stringify(entry.result), TOOL_RESULT_LIMIT),
    })),
    compacted: true,
  };
}
