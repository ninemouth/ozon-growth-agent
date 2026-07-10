// modules/agentLoop.js — The Agent reasoning & tool loop logic

import { callLLM, getSettings } from './llmClient.js';
import { tools } from './toolRegistry.js';

const globalSessionCache = {};

function hasConcreteVisualTerms(text) {
  return /颜色|配色|材质|金属|铁艺|铜|铝|钢|塑料|木|硅胶|玻璃|陶瓷|布|皮革|亚克力|轮廓|造型|形状|结构|弧形|圆形|方形|边缘|纹理|表面|光泽|磨砂|透明|图案|花纹|主体|比例|开孔|把手|支架|外观|细节|同模|相似|差异/i.test(String(text || ""));
}

function hasVisualScore(value) {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "number") return Number.isFinite(value);
  return /\d/.test(String(value));
}

function summarizeProductCards(cards = []) {
  return cards.slice(0, 12).map((card) => ({
    index: card.index,
    title: card.title,
    price: card.price,
    href: card.href,
    imageSrc: card.imageSrc,
    cardRect: card.cardRect,
    imageRect: card.imageRect,
    extractionConfidence: card.extractionConfidence,
  }));
}

const SOURCING_SKILL_RE = /domestic_sourcing_finder|ozon_sourcing_finder/;
const IMAGE_SEARCH_TOOLS = ["image_search_1688", "image_search_taobao", "image_search_in_browser"];
const TECHNICAL_JARGON_ERROR = "报告正文中包含内部技术黑话或函数名（如 DOM, read_current_page, xpath 等），请过滤并替换为通俗易懂的商业/供应链分析术语！";
const TECHNICAL_JARGON_RE = /read_current_page|open_new_tab|close_tab|search_in_browser|click_by_text|click_by_selector|input_text_and_search|agentic_web_search|image_search_1688|image_search_taobao|image_search_in_browser|DOM|xpath|GBK 编码|UTF-8|自愈程序|爬虫|人机拦截|验证码/i;
const REPORT_URL_FIELD_RE = /(^|_)(url|uri|link|href|image|image_src|img|src|thumbnail|photo|picture)(_|$)/i;

function isSourcingSkill(skillId = "") {
  return SOURCING_SKILL_RE.test(String(skillId || ""));
}

function sanitizeReportStringForBusinessAudience(text = "") {
  return String(text)
    .replace(/调用指令[:：]?\s*(read_current_page|open_new_tab|close_tab|search_in_browser|click_by_text|click_by_selector|input_text_and_search|agentic_web_search|image_search_1688|image_search_taobao|image_search_in_browser)/gi, "完成业务取证")
    .replace(/\b(read_current_page|open_new_tab|close_tab|click_by_text|click_by_selector|input_text_and_search|agentic_web_search|image_search_1688|image_search_taobao|image_search_in_browser)\b/gi, "业务取证")
    .replace(/\bsearch_in_browser\b/gi, "市场检索")
    .replace(/\bDOM\b/gi, "页面信息")
    .replace(/\bxpath\b/gi, "页面定位信息")
    .replace(/GBK 编码|UTF-8/gi, "页面编码")
    .replace(/自愈程序/gi, "自动修正机制")
    .replace(/爬虫/gi, "页面采集")
    .replace(/人机拦截|验证码/gi, "平台访问限制");
}

function sanitizeReportValueForBusinessAudience(value, key = "") {
  if (typeof value === "string") {
    return REPORT_URL_FIELD_RE.test(key) ? value : sanitizeReportStringForBusinessAudience(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReportValueForBusinessAudience(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeReportValueForBusinessAudience(entryValue, entryKey),
      ])
    );
  }
  return value;
}

export function sanitizeFinalReportForBusinessAudience(parsed) {
  if (!parsed || parsed.type !== "final" || !parsed.output) return parsed;
  return {
    ...parsed,
    output: sanitizeReportValueForBusinessAudience(parsed.output),
  };
}

function isTechnicalJargonOnlyFailure(validationErrors = []) {
  return validationErrors.length > 0 && validationErrors.every((err) => err === TECHNICAL_JARGON_ERROR);
}

function isImageSearchTool(toolName = "") {
  return IMAGE_SEARCH_TOOLS.includes(toolName);
}

function lastIncompleteImageSearch(toolHistory = []) {
  for (let i = toolHistory.length - 1; i >= 0; i--) {
    const entry = toolHistory[i];
    if (!isImageSearchTool(entry.tool)) continue;
    const result = entry.result || {};
    const hasProducts = (result.pageData?.productLinks || []).length > 0 || (result.pageData?.productCards || []).length > 0;
    if (result.imageSearchIncomplete || result.requiresImageSearchRetry || (!result.ok && !hasProducts && !result.isCaptcha)) {
      return entry;
    }
    return null;
  }
  return null;
}

function hasImageSearchAttempt(toolHistory = []) {
  return toolHistory.some((entry) => isImageSearchTool(entry.tool));
}

function hasPreparedCleanImageAttempt(toolHistory = []) {
  return toolHistory.some((entry) => entry.tool === "prepare_clean_product_image");
}

function countToolCalls(toolHistory = [], toolName) {
  return toolHistory.filter((entry) => entry.tool === toolName).length;
}

function isExplicitTextFallbackAllowed(userInstruction = "") {
  return /允许文本|文本兜底|关键词兜底|文字搜索|文本搜索|标品|standard/i.test(String(userInstruction || ""));
}

function isExplicitSourcingRequested(userInstruction = "") {
  return /1688|寻源|货源|采购|供应商|源头|工厂|拿样|比价|套利|采购直达|供货|批发|起批/i.test(String(userInstruction || ""));
}

function hasProductCandidates(result = {}) {
  const pageData = result.pageData || result;
  const cards = pageData.productCards || result.productCards || [];
  const links = pageData.productLinks || result.productLinks || [];
  return (Array.isArray(cards) && cards.length > 0) || (Array.isArray(links) && links.length > 0);
}

function lastSuccessfulSourcingSearchWithProducts(toolHistory = []) {
  for (let i = toolHistory.length - 1; i >= 0; i--) {
    const entry = toolHistory[i] || {};
    const engine = String(entry.arguments?.engine || "").toLowerCase();
    const isSearchTool = isImageSearchTool(entry.tool) ||
      (entry.tool === "search_in_browser" && ["1688", "taobao"].includes(engine)) ||
      entry.tool === "input_text_and_search";
    if (!isSearchTool) continue;
    const result = entry.result || {};
    if (result.ok === false || result.error || result.isCaptcha) continue;
    if (hasProductCandidates(result)) return entry;
  }
  return null;
}

function isSupplierDetailUrl(url = "") {
  return /detail\.1688\.com\/offer\/|item\.taobao\.com\/item\.htm|detail\.tmall\.com/i.test(String(url || ""));
}

function hasSupplierDetailPageEvidence(toolHistory = [], pageContext = {}) {
  if (isSupplierDetailUrl(pageContext?.url)) return true;
  return toolHistory.some((entry) => {
    const urls = [
      entry.arguments?.url,
      entry.result?.url,
      entry.result?.finalUrl,
      entry.result?.pageData?.url,
      entry.result?.pageData?.canonicalUrl,
    ];
    return urls.some(isSupplierDetailUrl);
  });
}

function isSourcingSearchToolCall(toolName = "", toolArgs = {}) {
  if (isImageSearchTool(toolName) || toolName === "input_text_and_search") return true;
  if (toolName !== "search_in_browser") return false;
  const engine = String(toolArgs.engine || "").toLowerCase();
  const query = String(toolArgs.query || toolArgs.keyword || "");
  return ["1688", "taobao"].includes(engine) || /1688|淘宝|货源|供应商|采购|批发|起批|工厂/i.test(query);
}

export function getSourcingWorkflowGuardError({
  skillId,
  toolName,
  toolArgs = {},
  userInstruction = "",
  toolHistory = [],
  pageContext = {},
} = {}) {
  if (!isSourcingSkill(skillId)) return null;
  if (!isSourcingSearchToolCall(toolName, toolArgs)) return null;

  const completedSearch = lastSuccessfulSourcingSearchWithProducts(toolHistory);
  if (!completedSearch) return null;
  if (hasSupplierDetailPageEvidence(toolHistory, pageContext)) return null;

  const incompleteImageSearch = lastIncompleteImageSearch(toolHistory);
  if (incompleteImageSearch) return null;
  if (isExplicitTextFallbackAllowed(userInstruction)) return null;

  const productCards = completedSearch.result?.pageData?.productCards || completedSearch.result?.productCards || [];
  const productLinks = completedSearch.result?.pageData?.productLinks || completedSearch.result?.productLinks || [];
  return {
    type: "tool_error",
    tool: toolName,
    error: "当前已经拿到 1688/淘宝结果页候选商品卡片，不允许继续换关键词、重新图搜或切换淘宝搜索。下一步必须基于现有 productCards/productLinks 做视觉初筛，按目标主图的外观、材质、结构和细节排序，打开 1-3 个最相似的详情页审计价格、MOQ、规格和供应商资质；只有当前结果明确为空、验证码/登录墙阻断，或用户明确要求文本兜底时，才允许重新搜索。",
    previousSearch: {
      tool: completedSearch.tool,
      productCards: Array.isArray(productCards) ? summarizeProductCards(productCards) : [],
      productLinks: Array.isArray(productLinks) ? productLinks.slice(0, 12) : [],
    },
  };
}

function isLogisticsOrPolicySearchQuery(query = "") {
  return /运费|物流|空派|海运|快递|货代|FBA|配送费|佣金|费率|关税|税率|清关|政策|认证|合规|freight|shipping|logistics|fulfillment|tariff|customs|duty|fee|commission|policy/i.test(String(query || ""));
}

function isShopOptimizerOnly(skillId = "") {
  const id = String(skillId || "");
  return id.includes("ozon_global_shop_optimizer") && !id.includes("ozon_sourcing_finder") && !id.includes("domestic_sourcing_finder");
}

function isOzonBusinessSkill(skillId = "") {
  return String(skillId || "").includes("ozon_");
}

function hasSuccessfulToolCall(toolHistory = [], predicate) {
  return toolHistory.some((entry) => {
    if (!predicate(entry)) return false;
    const result = entry.result || {};
    return result.ok !== false && !result.error;
  });
}

function hasEvidenceSource(toolHistory = [], pageContext = {}, sourceType = "") {
  const normalized = String(sourceType || "").toLowerCase();
  if (normalized === "page_dom") {
    return Boolean(pageContext?.url || pageContext?.title || (pageContext?.text && String(pageContext.text).trim()));
  }
  if (normalized === "screenshot_visual") {
    return Boolean(pageContext?.screenshot);
  }
  if (normalized === "ozon_api") {
    return hasSuccessfulToolCall(toolHistory, (entry) => String(entry.tool || "").startsWith("ozon_api_"));
  }
  if (normalized === "ozon_search") {
    return hasSuccessfulToolCall(toolHistory, (entry) =>
      entry.tool === "search_in_browser" && String(entry.arguments?.engine || "").toLowerCase() === "ozon"
    );
  }
  if (normalized === "yandex_search") {
    return hasSuccessfulToolCall(toolHistory, (entry) =>
      entry.tool === "search_in_browser" && String(entry.arguments?.engine || "").toLowerCase() === "yandex"
    );
  }
  if (normalized === "google_search") {
    return hasSuccessfulToolCall(toolHistory, (entry) => {
      const engine = String(entry.arguments?.engine || "").toLowerCase();
      return entry.tool === "search_in_browser" && (engine === "google" || engine === "google_ru");
    });
  }
  if (normalized === "google_trends") {
    return hasSuccessfulToolCall(toolHistory, (entry) =>
      entry.tool === "search_in_browser" && String(entry.arguments?.engine || "").toLowerCase() === "google_trends"
    );
  }
  if (normalized === "sourcing_search") {
    return hasSuccessfulToolCall(toolHistory, (entry) =>
      isImageSearchTool(entry.tool) ||
      (entry.tool === "search_in_browser" && ["1688", "taobao"].includes(String(entry.arguments?.engine || "").toLowerCase()))
    );
  }
  if (normalized === "supplier_page") {
    return /1688\.com|taobao\.com|tmall\.com/i.test(String(pageContext?.url || "")) ||
      hasSuccessfulToolCall(toolHistory, (entry) => {
        const url = String(entry.result?.url || entry.result?.pageData?.url || entry.arguments?.url || "");
        return /detail\.1688\.com|item\.taobao\.com|tmall\.com/i.test(url);
      });
  }
  if (normalized === "user_input") return true;
  if (normalized === "assumption") return true;
  return false;
}

function hasLedgerType(ledger = [], sourceType = "") {
  return ledger.some((entry) => String(entry?.source_type || "").toLowerCase() === sourceType);
}

function hasAnyLedgerType(ledger = [], sourceTypes = []) {
  const normalizedTypes = sourceTypes.map((type) => String(type || "").toLowerCase());
  return ledger.some((entry) => normalizedTypes.includes(String(entry?.source_type || "").toLowerCase()));
}

function hasAssumptionFallback(ledger = [], topicRegex) {
  return ledger.some((entry) => {
    const sourceType = String(entry?.source_type || "").toLowerCase();
    if (sourceType !== "assumption") return false;
    const text = [
      entry?.source_ref,
      entry?.observed_value,
      entry?.used_for,
      entry?.limitation,
    ].filter(Boolean).join(" ");
    return topicRegex.test(text) && /不可用|未绑定|未获得|未访问|阻断|无法|待验证|blocked|unavailable|not available/i.test(text);
  });
}

function validateEvidenceLedgerEntries({
  entries,
  label,
  toolHistory,
  pageContext,
  allowedTypes = ["page_dom", "screenshot_visual", "ozon_api", "ozon_search", "yandex_search", "google_search", "google_trends", "sourcing_search", "supplier_page", "user_input", "assumption"],
}) {
  const errors = [];
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${label} 缺少 evidence_ledger 结构化证据账本。每个实体必须拆分真实页面/API/搜索/供应商页面/假设来源。`);
    return errors;
  }
  entries.forEach((entry, ledgerIdx) => {
    const prefix = `${label} 的 evidence_ledger 第 ${ledgerIdx + 1} 条`;
    const sourceType = String(entry?.source_type || "").toLowerCase();
    const sourceRef = entry?.source_ref;
    const observedValue = entry?.observed_value;
    const usedFor = entry?.used_for;
    const limitation = entry?.limitation;
    if (!allowedTypes.includes(sourceType)) {
      errors.push(`${prefix} 的 source_type 无效，必须是 ${allowedTypes.join(" / ")}。`);
    }
    if (!sourceRef || !observedValue || !usedFor || !entry?.confidence || !limitation) {
      errors.push(`${prefix} 不完整，必须包含 source_type、source_ref、observed_value、used_for、confidence、limitation。`);
    }
    if (sourceType && sourceType !== "assumption" && sourceType !== "user_input" && !hasEvidenceSource(toolHistory, pageContext, sourceType)) {
      errors.push(`${prefix} 声称来源为 ${sourceType}，但本轮没有对应的真实页面/API/搜索/供应商工具证据。请调用对应工具，或改为 assumption 并明确待验证。`);
    }
  });
  return errors;
}

function domesticVisualRouteActive(skillId, pageContext, toolHistory) {
  if (!isSourcingSkill(skillId)) return false;
  return hasImageSearchAttempt(toolHistory) || hasPreparedCleanImageAttempt(toolHistory);
}

function validateReport(parsed, userInstruction, skillId, toolHistory = [], pageContext = {}) {
  const errors = [];
  if (!parsed || parsed.type !== "final" || !parsed.output) {
    errors.push("未输出符合格式的 final 报告 JSON 结构");
    return errors;
  }
  const out = parsed.output;
  if (!out.overview || !out.analysis || !out.summary || !Array.isArray(out.data)) {
    errors.push("final 报告缺少必须的属性（overview, analysis, summary 或 data 数组）");
    return errors;
  }

  // 1. Check for technical jargon
  const checkJargon = (str) => typeof str === "string" && TECHNICAL_JARGON_RE.test(str);
  if (checkJargon(out.overview) || checkJargon(out.analysis) || checkJargon(out.summary)) {
    errors.push(TECHNICAL_JARGON_ERROR);
  }

  if (isShopOptimizerOnly(skillId)) {
    const combinedReportText = `${out.overview || ""}\n${out.analysis || ""}\n${out.summary || ""}`;
    if (/货源\s*#|推荐对齐货源|采购直达|1688\s*采购直达链接|detail\.1688\.com|s\.1688\.com/i.test(combinedReportText)) {
      errors.push("店铺优化报告不得输出货源编号、采购直达链接或 1688 推荐清单。请改为店铺健康评级、ABC 分级优化候选方案与执行任务。");
    }

    const hasClassifiedPlan = out.data.some((item) => {
      const text = [
        item?.plan_id,
        item?.scheme_id,
        item?.diagnosis_level,
        item?.title,
        item?.name,
        item?.direction,
      ].filter(Boolean).join(" ");
      return /\b[ABC]-?\d*\b|A级|B级|C级|方案|优化|整改|诊断/i.test(text);
    });
    if (!hasClassifiedPlan) {
      errors.push("店铺优化报告的 data 数组必须包含 A/B/C 分级优化候选方案或诊断任务，而不是商品/货源清单。");
    }

    out.data.forEach((item, idx) => {
      const title = item.title || item.name || item.plan_id || `方案 #${idx + 1}`;
      const link = item.product_link || item.link || "";
      const ledger = item.financial_ledger || {};
      if (/1688\.com/i.test(String(link))) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 包含 1688 采购链接。除非用户明确要求寻源，否则不能在店铺优化第一步生成采购链接。`);
      }
      if (ledger.sourcing_cost || ledger.sourcing_cost_cny || ledger.sourcing_cost_rub) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 包含采购成本字段。没有真实寻源时只能写成本压力或待验证假设，不能伪造供应商账本。`);
      }
      const evidence = item.evidence || item.diagnosis_basis || item.selection_rationale || item.trend_evidence || "";
      if (!evidence || String(evidence).trim().length < 20) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 缺少具体证据字段（evidence / diagnosis_basis / selection_rationale），必须说明来自页面、截图、Ozon API 或待验证假设。`);
      }

      const ledgerEntries = Array.isArray(item.evidence_ledger) ? item.evidence_ledger : [];
      if (ledgerEntries.length === 0) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 缺少 evidence_ledger 结构化证据账本。每个方案必须拆分 page_dom / screenshot_visual / ozon_api / ozon_search / yandex_search / google_search / google_trends / assumption 等来源。`);
      }

      ledgerEntries.forEach((entry, ledgerIdx) => {
        const prefix = `店铺优化方案第 ${idx + 1} 项 (${title}) 的 evidence_ledger 第 ${ledgerIdx + 1} 条`;
        const sourceType = String(entry?.source_type || "").toLowerCase();
        const sourceRef = entry?.source_ref;
        const observedValue = entry?.observed_value;
        const usedFor = entry?.used_for;
        const limitation = entry?.limitation;
        const allowedTypes = ["page_dom", "screenshot_visual", "ozon_api", "ozon_search", "yandex_search", "google_search", "google_trends", "assumption"];
        if (!allowedTypes.includes(sourceType)) {
          errors.push(`${prefix} 的 source_type 无效，必须是 ${allowedTypes.join(" / ")}。`);
        }
        if (!sourceRef || !observedValue || !usedFor || !entry?.confidence || !limitation) {
          errors.push(`${prefix} 不完整，必须包含 source_type、source_ref、observed_value、used_for、confidence、limitation。`);
        }
        if (sourceType && sourceType !== "assumption" && !hasEvidenceSource(toolHistory, pageContext, sourceType)) {
          errors.push(`${prefix} 声称来源为 ${sourceType}，但本轮没有对应的真实页面/API/搜索工具证据。请调用对应工具，或把该结论改为 assumption 并明确待验证。`);
        }
      });

      const itemText = JSON.stringify(item);
      if (/API|Seller API|ozon_api|Sessions|session|加购|订单|扣费|交易|履约成本|FBO|FBS/i.test(itemText) && !hasLedgerType(ledgerEntries, "ozon_api") && !hasAssumptionFallback(ledgerEntries, /API|Seller|流量|订单|履约|FBO|FBS/i)) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 使用了 API/流量/订单/履约类结论，但 evidence_ledger 没有 ozon_api 证据或 assumption 降级说明。`);
      }
      if (/Yandex|yandex/i.test(itemText) && !hasLedgerType(ledgerEntries, "yandex_search") && !hasAssumptionFallback(ledgerEntries, /Yandex/i)) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 使用了 Yandex/站外需求结论，但 evidence_ledger 没有 yandex_search 证据或 assumption 降级说明。`);
      }
      if (/站外|搜索指数|外部流量|季节性/i.test(itemText) && !hasAnyLedgerType(ledgerEntries, ["yandex_search", "google_search", "google_trends"]) && !hasAssumptionFallback(ledgerEntries, /Yandex|Google|谷歌|站外|搜索指数|外部流量|季节|趋势/i)) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 使用了站外需求/季节性结论，但 evidence_ledger 没有 yandex_search / google_search / google_trends 证据或 assumption 降级说明。`);
      }
      if (/Google|Google Trends|谷歌趋势|搜索趋势|年度趋势|季度趋势|YoY|QoQ|季节性增长|需求趋势/i.test(itemText) && !hasAnyLedgerType(ledgerEntries, ["google_search", "google_trends"]) && !hasAssumptionFallback(ledgerEntries, /Google|谷歌|趋势|YoY|QoQ|季节/i)) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 使用了 Google/趋势/季节性增长结论，但 evidence_ledger 没有 google_search / google_trends 证据或 assumption 降级说明。`);
      }
      if (/Ozon 站内|ozon 站内|热卖榜|第一页|竞品均价|评价门槛|广告占位/i.test(itemText) && !hasLedgerType(ledgerEntries, "ozon_search") && !hasAssumptionFallback(ledgerEntries, /Ozon|站内|热卖榜|第一页|竞品|评价门槛|广告占位/i)) {
        errors.push(`店铺优化方案第 ${idx + 1} 项 (${title}) 使用了 Ozon 站内/热卖榜/竞品搜索结论，但 evidence_ledger 没有 ozon_search 证据或 assumption 降级说明。`);
      }
    });

    const allLedgerEntries = out.data.flatMap((item) => Array.isArray(item.evidence_ledger) ? item.evidence_ledger : []);
    if (!hasLedgerType(allLedgerEntries, "ozon_search") && !hasAssumptionFallback(allLedgerEntries, /Ozon|站内|热卖榜|竞品|榜单/i)) {
      errors.push("店铺优化报告缺少 Ozon 站内搜索/热卖榜对标证据。请调用 Ozon 搜索/榜单，或用 assumption 明确说明当前无法访问并列为待验证。");
    }
    if (!hasAnyLedgerType(allLedgerEntries, ["yandex_search", "google_search", "google_trends"]) && !hasAssumptionFallback(allLedgerEntries, /Yandex|Google|谷歌|站外|趋势|季节|需求/i)) {
      errors.push("店铺优化报告缺少俄罗斯站外需求趋势证据。请至少使用 Yandex.ru、Google RU 或 Google Trends RU 之一，或用 assumption 明确说明工具/网络不可用并列为待验证。");
    }
    if (!hasAnyLedgerType(allLedgerEntries, ["yandex_search", "google_search", "google_trends"]) && hasAssumptionFallback(allLedgerEntries, /Yandex|Google|谷歌|站外|趋势|季节|需求/i) && /呈现|显示|证明|同比|环比|增长|下降|热度高|趋势上升/i.test(combinedReportText)) {
      errors.push("店铺优化报告的站外趋势只有 assumption，正文不能写成已验证事实。请把趋势判断降级为待验证假设，或先调用 Yandex.ru / Google RU / Google Trends RU 获取真实证据。");
    }
  }

  if (isOzonBusinessSkill(skillId) && !isShopOptimizerOnly(skillId)) {
    out.data.forEach((item, idx) => {
      const title = item.title || item.name || item.plan_id || item.phase_id || item.keyword || `实体 #${idx + 1}`;
      const ledgerEntries = Array.isArray(item.evidence_ledger) ? item.evidence_ledger : [];
      errors.push(...validateEvidenceLedgerEntries({
        entries: ledgerEntries,
        label: `Ozon 业务报告第 ${idx + 1} 项 (${title})`,
        toolHistory,
        pageContext,
      }));

      const itemText = JSON.stringify(item);
      if (/蓝海|爆品|高增长|低竞争|趋势|季节|搜索热度|YoY|QoQ/i.test(itemText) && !hasAnyLedgerType(ledgerEntries, ["ozon_search", "yandex_search", "google_search", "google_trends"]) && !hasAssumptionFallback(ledgerEntries, /Ozon|Yandex|Google|谷歌|趋势|季节|需求|竞争|搜索/i)) {
        errors.push(`Ozon 业务报告第 ${idx + 1} 项 (${title}) 使用了市场机会/趋势/竞争结论，但 evidence_ledger 没有 Ozon/Yandex/Google/Google Trends 证据或主题相关 assumption。`);
      }
      if (/SEO|关键词|搜索词|高频词|标题公式|Listing|листинг/i.test(itemText) && !hasAnyLedgerType(ledgerEntries, ["page_dom", "ozon_search", "yandex_search", "google_search", "google_trends"]) && !hasAssumptionFallback(ledgerEntries, /SEO|关键词|搜索词|标题|Listing/i)) {
        errors.push(`Ozon 业务报告第 ${idx + 1} 项 (${title}) 使用了 SEO/关键词/Listing 结论，但 evidence_ledger 没有页面或搜索证据，也没有降级为待验证假设。`);
      }
      if (/评论|差评|Отзывы|отзыв|买家反馈|退货|破损|不符|Не работает/i.test(itemText) && !hasAnyLedgerType(ledgerEntries, ["page_dom", "screenshot_visual", "ozon_search"]) && !hasAssumptionFallback(ledgerEntries, /评论|差评|Отзывы|买家反馈|退货|破损|不符/i)) {
        errors.push(`Ozon 业务报告第 ${idx + 1} 项 (${title}) 使用了评论/差评/退货结论，但 evidence_ledger 没有页面/截图/Ozon 搜索证据，也没有降级为待验证假设。`);
      }
      if (/1688|淘宝|供应商|采购|拿样|货源/i.test(itemText) && !hasAnyLedgerType(ledgerEntries, ["sourcing_search", "supplier_page", "user_input"]) && !hasAssumptionFallback(ledgerEntries, /1688|淘宝|供应商|采购|拿样|货源/i)) {
        errors.push(`Ozon 业务报告第 ${idx + 1} 项 (${title}) 使用了供应商/采购/拿样结论，但 evidence_ledger 没有 sourcing_search / supplier_page / user_input 证据，也没有降级为待验证假设。`);
      }
    });
  }

  // 2. Check product quantity if specified in instruction
  const numMatch = (userInstruction || "").match(/(\d+)款/);
  if (numMatch) {
    const expectedNum = parseInt(numMatch[1]);
    if (out.data.length < expectedNum) {
      errors.push(`用户要求至少筛选 ${expectedNum} 款商品，但你当前的 data 列表中只有 ${out.data.length} 款，请调用翻页、滚动或抓取工具补充完整，达到 ${expectedNum} 款！`);
    }
  }

  // 3. Sourcing-specific details check (1688 / Taobao links, profiling, spec alignment, profit ledger)
  if (isSourcingSkill(skillId)) {
    if (out.data.length < 1) {
      errors.push("供应链寻源报告至少必须返回 1 个真实采购候选。请继续通过 1688/淘宝完成对应路径的真实检索、视觉筛选或详情页穿透补足；只有找到 1 个合格货源也可以交付，但不能输出空 data。");
    }
    const combinedSourcingText = `${out.overview || ""}\n${out.analysis || ""}\n${out.summary || ""}\n${JSON.stringify(out.data || [])}`;
    const hasSupplierShortageExplanation = /不足\s*2|少于\s*2|仅\s*1\s*个|只有\s*1\s*个|无法形成.*比价|不足以形成.*比价|验证码|登录墙|平台阻断|图片搜索受限|未获得真实|无合格货源|继续人工寻源|暂不建议.*采购|不建议.*备货/i.test(combinedSourcingText);
    if (out.data.length > 0 && out.data.length < 2 && !hasSupplierShortageExplanation) {
      errors.push("供应链寻源报告默认必须返回至少 2 个可比供应商候选，以便比较价格、MOQ、材质、供货能力和跨境毛利。当前只有 1 个候选且未说明平台阻断/严格筛选不足 2 个的原因。请继续基于结果页打开第二个详情页审计；若确实无法获得第二个合格供应商，必须在 summary 和 audit_comment 中明确“不足以形成供应商比价，本轮不建议直接采购/批量备货，需要继续人工寻源或拿样验证”。");
    }

    const hasSuccessfulImageSearch = toolHistory.some((entry) => {
      if (!isImageSearchTool(entry.tool)) return false;
      const result = entry.result || {};
      const links = result.pageData?.productLinks || [];
      const cards = result.pageData?.productCards || [];
      return result.ok && !result.error && !result.isCaptcha && (links.length > 0 || cards.length > 0);
    });
    const hasVisualCandidateExtraction = toolHistory.some((entry) => {
      const cards = entry.result?.pageData?.productCards || entry.result?.productCards || [];
      return Array.isArray(cards) && cards.length > 0;
    });

    out.data.forEach((item, idx) => {
      const title = item.title || item.name || `商品 #${idx + 1}`;
      
      // A. Detail links check
      const link = item.product_link || item.link || "";
      if (!link) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 没有提供采购直达链接！`);
      } else if (link.includes("s.1688.com") || link.includes("search?") || link.includes("offer_search")) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 提供的链接是搜索列表页，必须替换为具体的单品详情页直达链接（格式如 detail.1688.com/offer/XXXX.html）！`);
      }

      // B. Category profiling check (target_profile)
      const profile = item.target_profile;
      if (!profile || typeof profile !== "object" || Object.keys(profile).length === 0) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少分类特征画像属性（target_profile 属性对象）！`);
      } else {
        if (!profile.visual_descriptors || typeof profile.visual_descriptors !== "string" || profile.visual_descriptors.trim().length < 5) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的 target_profile 必须包含多模态提取的外观特征描述（visual_descriptors，如松鼠打伞、材质颜色等）！`);
        }
        if (!profile.refined_query || typeof profile.refined_query !== "string" || profile.refined_query.trim().length < 2) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的 target_profile 必须包含最终构建的中文复合检索词（refined_query，如松鼠打伞喂鸟器）！`);
        }
        if (!profile.routing_decision || !["标品(文本检索)", "非标品(图片检索)"].includes(profile.routing_decision)) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的 target_profile 必须包含检索方式分流决策（routing_decision，取值必须为："标品(文本检索)" 或 "非标品(图片检索)"）！`);
        }
        if (profile.routing_decision === "非标品(图片检索)" && !hasSuccessfulImageSearch) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 标记为非标品图片检索，但本轮没有成功执行 1688/淘宝以图搜图并返回商品结果。请继续使用 image_search_1688 或 image_search_taobao 获取真实视觉候选；若平台图片检索被验证码/登录墙/无结果阻断，只能如实申报视觉寻源受阻或无合格货源，禁止改回文本关键词凑结果。`);
        }
        if (profile.routing_decision === "非标品(图片检索)" && !hasVisualCandidateExtraction) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 标记为非标品图片检索，但本轮未抽取到带候选主图和屏幕坐标的 productCards。请重新读取/刷新搜索结果页，先基于列表页商品卡片主图完成视觉相似度排序，再打开详情页。`);
        }
      }

      // B2. Visual list-page screening proof. This prevents keyword-only supplier picks.
      const routingDecision = profile?.routing_decision || "";
      const requiresVisualGate = routingDecision === "非标品(图片检索)" || hasVisualCandidateExtraction;
      if (requiresVisualGate) {
        const candidateImage = item.candidate_image_url || item.source_candidate_image || item.source_image || item.product_image || item.image_url || "";
        const visualScore = item.list_page_visual_score ?? item.visual_match_score ?? item.visual_score;
        const visualEvidence = [
          item.visual_match_evidence,
          item.list_page_visual_screening,
          item.audit_comment,
        ].filter(Boolean).join(" ");

        if (!candidateImage || !/^https?:\/\//i.test(String(candidateImage))) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少列表页候选主图字段（candidate_image_url 或 source_candidate_image）。必须把 productCards 中被选中卡片的 imageSrc 写入报告，证明不是只按标题关键词选择。`);
        }
        if (!hasVisualScore(visualScore)) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少列表页视觉相似度评分（list_page_visual_score 或 visual_match_score）。请先在搜索结果页按目标主图进行视觉排序后再推荐。`);
        }
        if (!visualEvidence || visualEvidence.trim().length < 20) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少列表页视觉筛选证据（visual_match_evidence 或 list_page_visual_screening）。必须具体说明颜色、材质、轮廓、结构或图案为何与目标主图一致。`);
        } else if (!hasConcreteVisualTerms(visualEvidence)) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的视觉证据过于文本化，未说明具体外观/材质/结构相似点。禁止只依据标题、关键词、价格或销量推荐货源。`);
        }
      }

      // C. Spec alignment check (spec_audit)
      const spec = item.spec_audit;
      if (!spec || typeof spec !== "object" || !spec.target_spec || !spec.sourced_spec || !spec.status) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少规格审计比对参数（spec_audit 必须包含 target_spec、sourced_spec 和 status）！`);
      } else {
        const isRejected = ["一票否决淘汰", "材质缩水", "严重偏离"].includes(spec.status) || 
                           (spec.status.includes("淘汰") || spec.status.includes("缩水") || spec.status.includes("偏离"));
        if (isRejected) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的规格对比状态判定为一票否决或材质/外观不符 (${spec.status})，绝对禁止列为有效的采购货源推荐方案！请通过多轮检索（以图搜图、精确词、筛选项）重新搜寻合格同款；若确属无货，请在报告中如实申报无货，严禁妥协拼凑！`);
        }
      }

      // D. Profit ledger check (financial_ledger)
      const ledger = item.financial_ledger;
      if (!ledger || typeof ledger !== "object") {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少财务账本字段（financial_ledger 属性对象）！`);
      } else {
        const cost = ledger.sourcing_cost || ledger.cost || "";
        const shipping = ledger.shipping_cost || ledger.shipping || "";
        const price = ledger.target_price || ledger.price || "";
        const margin = ledger.margin_rate || ledger.margin || "";
        if (!cost || !shipping || !price || !margin) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的财务账本不完整（financial_ledger 必须包含 sourcing_cost, shipping_cost, target_price 和 margin_rate）！`);
        }
      }
    });
  }

  // 4. Evidence validation must match the current skill semantics.
  out.data.forEach((item, idx) => {
    const evidence = item.trend_evidence || item.selection_rationale || item.evidence || item.diagnosis_basis || "";
    if (!evidence || evidence.trim().length < 20) {
      const label = isShopOptimizerOnly(skillId) ? "方案" : "商品列表";
      errors.push(`${label}第 ${idx + 1} 项 (${item.title || item.name || item.plan_id || "未命名实体"}) 缺少充分证据链（trend_evidence / evidence / diagnosis_basis / selection_rationale 字段长度必须大于 20 字，并说明真实页面、截图、API、竞品或假设来源）！`);
    }
  });

  // 5. Inferred target market verification in report text
  const overviewText = out.overview || "";
  const analysisText = out.analysis || "";
  const combinedText = overviewText + analysisText;
  if (!combinedText.includes("市场") && !combinedText.includes("客群") && !combinedText.includes("定位")) {
    errors.push("报告概述 (overview) 或分析 (analysis) 中未体现自主判断的目标销售市场与目标客群定位（例如：‘中国大陆/国内电商’或‘俄罗斯/独联体市场’等），请予以明确陈述！");
  }

  return errors;
}

export function clearSessionCache(tabId) {
  const sessionKey = `${tabId}`;
  if (globalSessionCache[sessionKey]) {
    delete globalSessionCache[sessionKey];
  }
}

function buildPromptContext(pageContext = {}) {
  const ctx = { ...pageContext };
  if (ctx.targetImageUrl && String(ctx.targetImageUrl).startsWith("data:")) {
    ctx.targetImageUrl = "__TARGET_IMAGE_URL__";
    ctx.targetImageInputType = "uploaded_image";
  }
  if (Array.isArray(ctx.targetImageCandidates)) {
    ctx.targetImageCandidates = ctx.targetImageCandidates.map((url, idx) => (
      String(url).startsWith("data:") ? `__TARGET_IMAGE_CANDIDATE_${idx + 1}__` : url
    ));
  }
  return ctx;
}

export async function runAgentLoop({ tabId, skillId, skillMarkdown, userInstruction, pageContext, sendProgress, continueSession, highRandomness, negativeFilter, maxLoopSteps }) {
  const settings = await getSettings();
  const maxSteps = maxLoopSteps || Math.max(parseInt(settings.maxLoopSteps) || 25, 25);

  let systemPrompt = skillMarkdown;
  if (negativeFilter === false) {
    systemPrompt += `\n\n=========================================\n\n⚠️ 【用户已手动关闭“不卖原则”过滤限制】：当前处于国内国内电商或不受限的宽容寻源环境，用户已手动取消了默认的“不卖原则”（Negative Filter）负面过滤。因此，你【无须】过滤服饰、鞋帽、内衣、大件重货、陶瓷玻璃易碎品、本地容易买到的普通日杂标品或医疗/成人等高风险品类。请完全根据当前页面商品的实际销量表现、货源品质以及用户指令，自由挖掘上述常规品类并推荐它们的源头供应商！`;
  }
  
  const isApiActive = !!(settings.helium10ApiKey || settings.sellerSpriteApiKey);
  const isFastMossActive = !!settings.fastmossApiKey;
  const filteredToolList = Object.keys(tools).filter(name => {
    if (name === "query_market_data") return isApiActive;
    if (name === "query_fastmoss_data") return isFastMossActive;
    return true;
  });
  const availableTools = filteredToolList.join(", ");
  const toolHistory = [];

  const actualTargetImageUrl = pageContext?.targetImageUrl || "";
  const ctxForPrompt = buildPromptContext(pageContext);
  const screenshotData = ctxForPrompt.screenshot;
  delete ctxForPrompt.screenshot;

  const userText = `请严格根据 skill 说明执行任务。

## 可用工具
${availableTools}

## 工具调用格式
当需要调用工具时，输出：
\`\`\`json
{"type":"tool_call","tool":"<tool_name>","arguments":{...}}
\`\`\`

## 最终结果格式
请将你最终构思出的结果，**统一组装为标准化的分析报告结构**，完成后输出：
\`\`\`json
{
  "type": "final",
  "output": {
    "overview": "全局概述（使用Markdown，简述你在本页面的核心发现）",
    "analysis": "深度分析过程与推演逻辑（使用Markdown，展示你的多维博弈和决策依据）",
    "summary": "最终核心结论（使用Markdown，提炼出最关键的建议或结论）",
    "data": [ ... ] // 具体的结构化数据（如具体的商品蓝图、筛选出的列表等，必须是数组）
  }
}
\`\`\`


## 当前页面上下文
${JSON.stringify(ctxForPrompt, null, 2)}

## 用户核心焦点 (User Core Focus)
${userInstruction ? `用户补充了以下核心探索方向。这是你的**最高优先级探索目标**。请你**必须将第一步的动作（search_web 或 click），以及后续的所有推演，全部紧紧围绕该主题展开**。但同时，仍需遵守 Skill 中定义的所有避坑与打分原则。\n用户的核心方向是：\n"${userInstruction}"` : "（无额外焦点。请严格按 skill 流程自主探索。）"}

${highRandomness ? `\n\n## ⚠️ [Anti-Cache] 强制发散与破局指令 (Nonce: ${Date.now()})\n用户要求进行**【全新视角的探索】**。请你**完全抛弃最常规、最容易想到的思路**。如果之前的方向是 A，这次请尝试 B 甚至是冷门的 C。突破固有套路，给我极具差异化的答案！` : ""}

${((skillId || "").includes("domestic_sourcing_finder") || (skillId || "").includes("ozon_sourcing_finder")) ? `\n\n## 国内供应链寻源运行硬约束\n- 如果目标是非标外观/造型/模具商品且存在 targetImageUrl，优先调用 image_search_1688 或 image_search_taobao。若已配置生图模型、且平台自动框选主体不完整，可先调用 prepare_clean_product_image，并把返回的 image_search_argument.imageUrl 用作图片搜索输入。\n- 非标品一旦启动图片搜索或干净搜图图准备流程，后续 Critic 打回也严禁调用 input_text_and_search 文本框搜索；必须继续用 productCards 候选主图、截图和视觉相似度证据筛选。\n- agentic_web_search 最多调用 1 次，且只用于物流、费率、政策或认证核算；严禁用它寻找 1688/淘宝货源或替代站内图片搜索。` : ""}

${(skillId || "").includes("ozon_") ? `\n\n## Ozon 浏览器标签页生命周期纪律\n- agentic_web_search 是静默信息检索工具，它自己的临时浏览器标签页由工具内部清理。\n- search_in_browser、open_new_tab、image_search_1688、image_search_taobao、image_search_in_browser 会打开可见标签页。凡是仅用于 Ozon 取证、竞品查看、站外搜索或详情页抽样的新标签页，在读取证据后必须调用 close_tab 关闭对应 tabId。\n- 只有遇到验证码、登录态、人机验证、上传控件等待人工处理，或用户明确需要保留页面继续人工比对时，才允许暂时不关闭；最终报告必须说明保留原因和 tabId。\n- 输出 final 前必须自检：本轮由你打开且已经完成取证的无关标签页是否已经关闭。` : ""}

${(skillId || "").includes("tiktok_shop_monitor") ? `\n\n## ⚠️ TikTok 监控运行硬约束 (TikTok Monitor Hard Constraints)\n- 【严禁直接输出 final】：你绝对不能在第 1 步就直接输出 final 最终报告！\n- 【详情页深挖流程】：你必须挑选出 2-3 个核心/爆款商品，对这 2-3 个商品依次执行：(1) 调用 open_new_tab 打开该商品详情页，(2) 自动读取页面（在 open_new_tab 返回中会自动包含最新的 pageData，或调用 read_current_page 确认），(3) 调用 close_tab 关闭该标签页。只有将这 2-3 个重点商品对应的详情页细节深度抓取合并后，才允许输出 final 最终报告！` : ""}
`;

  let userContent = userText;
  if (screenshotData) {
    userContent = [
      { type: "text", text: userText },
      { type: "image_url", image_url: { url: screenshotData } }
    ];
  }

  let messages = [];
  const sessionKey = `${tabId}`;

  if (continueSession && globalSessionCache[sessionKey]) {
    messages = globalSessionCache[sessionKey];
    if (messages.length > 0 && messages[0].role === "system") {
      messages[0].content = systemPrompt;
    }

    const newCtx = buildPromptContext(pageContext);
    delete newCtx.screenshot;
    const ctxString = JSON.stringify(newCtx, null, 2);

    let instructionText = userInstruction 
        ? `[追加指令] 用户对刚才的执行结果提出了新的要求或调整。请严格基于以上的上下文记忆，重新推演并输出最终的 JSON 报告。\n用户的最新要求是：\n"${userInstruction}"` 
        : `[追加指令] 请结合你最新的 System Prompt（你的目标任务可能已经发生了改变），并基于最新的页面上下文进行深度推演。`;
    
    if ((skillId || "").includes("domestic_sourcing_finder") || (skillId || "").includes("ozon_sourcing_finder")) {
      instructionText += `\n\n【⚠️ 极其重要：禁止直接生成/必须调用浏览器工具真实寻源】\n当前匹配到的是寻源任务（例如需要去 1688、淘宝等平台寻找货源或对比价格），**你绝对禁止直接从历史记忆中复制或凭空捏造虚假的 1688/淘宝 详情页链接！**\n如果最新页面上下文中存在 targetImageUrl，且目标商品属于非标外观/模具/造型商品，你必须在第一步调用 'image_search_1688'（优先）或 'image_search_taobao' 执行供应商平台以图搜源；如果已配置生图模型且平台自动框选主体不完整，可先调用 'prepare_clean_product_image' 准备干净主体图，再把返回的 image_search_argument.imageUrl 传给图片搜索工具。非标品一旦进入图片检索路径，Critic 打回后也严禁切回 'input_text_and_search' 关键词搜索；只有目标明确为标品或用户明确要求文本兜底，才允许文本搜索。只有在通过工具真实获取并校验了详情页内容、价格和起批量后，才被允许在最后的报告中写入真实的 1688/淘宝详情页链接并输出 final 报告！`;
    }

    instructionText += `\n\n【极其重要：强制输出格式】\n无论你进行了多少轮推演，**你最后一次的输出必须，且只能是如下 JSON 格式**（请包裹在 \`\`\`json 中）：\n\`\`\`json\n{\n  "type": "final",\n  "output": {\n    "overview": "...",\n    "analysis": "...",\n    "summary": "...",\n    "data": [] \n  }\n}\n\`\`\`\n严禁把上述指令文字直接暴露在最终报告中！`;
    instructionText += `\n\n【注意：以下是你当前所处的最新页面上下文数据】\n${ctxString}`;

    let newUserContent = instructionText;
    if (pageContext.screenshot) {
      newUserContent = [
        { type: "text", text: instructionText },
        { type: "image_url", image_url: { url: pageContext.screenshot } }
      ];
    }

    messages.push({
      role: "user",
      content: newUserContent
    });
  } else {
    messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ];
  }

  sendProgress({ type: "start", step: 0, maxSteps });

  for (let step = 1; step <= maxSteps; step++) {
    sendProgress({ type: "thinking", step, maxSteps });

    let assistantContent = "";
    assistantContent = await callLLM(messages, ({ chunk, fullText, isReasoning }) => {
      sendProgress({ type: "streaming", step, chunk, fullText, isReasoning });
    }, highRandomness);

    sendProgress({ type: "llm_done", step, content: assistantContent });

    const parsed = extractJSONBlock(assistantContent);

    if (!parsed) {
      return {
        ok: true,
        type: "text",
        result: assistantContent,
        steps: step,
      };
    }

    if (parsed.type === "final") {
      let finalParsed = parsed;
      let validationErrors = validateReport(finalParsed, userInstruction, skillId, toolHistory, pageContext);
      if (isTechnicalJargonOnlyFailure(validationErrors)) {
        const sanitizedParsed = sanitizeFinalReportForBusinessAudience(finalParsed);
        const sanitizedErrors = validateReport(sanitizedParsed, userInstruction, skillId, toolHistory, pageContext);
        if (sanitizedErrors.length === 0) {
          finalParsed = sanitizedParsed;
          validationErrors = [];
          sendProgress({ type: "reflection", step, message: "Critic 已自动清理报告中的内部技术措辞，保留本轮取证结果并继续完成。" });
        } else {
          validationErrors = sanitizedErrors;
        }
      }
      if (validationErrors.length > 0) {
        const reflectionsCount = ctxForPrompt.__reflectionsCount || 0;
        if (reflectionsCount < 2 && step < maxSteps - 1) {
          ctxForPrompt.__reflectionsCount = reflectionsCount + 1;
          sendProgress({ type: "reflection", step, message: `Critic 自动审计拒绝：${validationErrors[0]} 正在打回重做...` });
          
          messages.push({ role: "assistant", content: assistantContent });
          const domesticVisualActive = domesticVisualRouteActive(skillId, pageContext, toolHistory);
          messages.push({
            role: "user",
            content: `【Critic Agent 报告质量审计拒绝】\n你的报告未能通过系统的自动合规自检，发现了以下问题：\n${validationErrors.map((err, i) => `${i + 1}. ${err}`).join("\n")}\n\n${domesticVisualActive ? "【非标视觉寻源硬约束】本轮已经启动目标主图/以图搜图路径。请继续基于图片搜索结果页 productCards 和截图做视觉相似度修正，补齐 candidate_image_url、list_page_visual_score、visual_match_evidence；严禁回到 1688/淘宝文本框关键词搜索来凑结果。\n\n" : ""}请严格对照系统提示词规范，在脑海中进行深度反思（如补充筛选数量、使用真实详情单页链接、清除技术黑话等），并重新调用工具或重新输出一份完美修正了以上所有问题的 \`{"type":"final", "output": {...}}\` 报告！`
          });
          continue;
        }
      }

      if (!ctxForPrompt.__hasDeepReflected && step < maxSteps - 1) {
        ctxForPrompt.__hasDeepReflected = true;
        sendProgress({ type: "reflection", step, message: "Critic Agent 正在进行深层商业推演反思..." });
        
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({
          role: "user",
          content: `【Critic Agent 报告质量审计与反思】\n请根据本会话系统提示词（System Prompt）头部的【报告设计审计与规划基座 Skill】中的质量审计检查单（Auditor Checklist），对你刚才生成的最终报告进行最严苛的自检审查：\n1. 结构完整性：是否严格包含并对齐了该 Skill 要求的分析模块（如概述、推演、数据结构化卡片）？\n2. 深度审计：内容是否流于表面？是否对消费者痛点、产品改良策略或运营动作进行了多维度的场景化推演？\n3. 格式规范性：数据视图（data 数组）中的键名和键值是否合规（无 [object Object] 等序列化错误，且已翻译为中文）？\n\n【重要要求】在输出优化后的 JSON 时，严禁在 output 内部的字段（如 overview, analysis, summary）中写入任何有关 AI 自我审计、自检表格或自评文字。报告正文必须纯净、专业，不留任何自检草稿痕迹，直接呈现面向 Ozon 卖家的运营/商业诊断方案。\n\n如果你发现可以改进的地方，请进行深度反思，并输出优化后的 \`{"type":"final", "output": {...}}\`。\n如果你确信当前版本已经完美无缺，请直接原样再次输出 \`{"type":"final", "output": {...}}\` 即可通过审查。`
        });
        continue;
      } else {
        messages.push({ role: "assistant", content: JSON.stringify(finalParsed) });
        globalSessionCache[sessionKey] = messages;
        return {
          ok: true,
          type: "final",
          result: finalParsed.output,
          steps: step,
        };
      }
    }

    if (parsed.type === "tool_call") {
      const toolName = parsed.tool;
      const toolArgs = parsed.arguments || {};

      if (toolName === "prepare_clean_product_image") {
        if ((!toolArgs.imageUrl || toolArgs.imageUrl === "__TARGET_IMAGE_URL__") && actualTargetImageUrl) {
          toolArgs.imageUrl = actualTargetImageUrl;
        }
      }

      if (isImageSearchTool(toolName)) {
        if ((!toolArgs.imageUrl || toolArgs.imageUrl === "__TARGET_IMAGE_URL__") && actualTargetImageUrl) {
          toolArgs.imageUrl = actualTargetImageUrl;
        }
      }

      if (isShopOptimizerOnly(skillId) && !isExplicitSourcingRequested(userInstruction)) {
        const engine = String(toolArgs.engine || "").toLowerCase();
        const query = String(toolArgs.query || toolArgs.keyword || "");
        const isSourcingTool =
          isImageSearchTool(toolName) ||
          (toolName === "search_in_browser" && (engine === "1688" || /1688|货源|供应商|采购|批发|起批|工厂/i.test(query)));
        if (isSourcingTool) {
          messages.push({ role: "assistant", content: assistantContent });
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "tool_error",
              tool: toolName,
              error: "当前任务是 Ozon 店铺优化诊断，不是寻源流程。第一步必须围绕店铺健康评级、页面/截图/自营 API 数据、Ozon 站内竞品、Yandex.ru / Google RU / Google Trends RU 需求证据构建 ABC 优化方案；除非用户明确要求 1688/货源/采购，否则禁止调用采购平台搜索或生成供应商链接。",
            }),
          });
          continue;
        }
      }

      const sourcingWorkflowGuardError = getSourcingWorkflowGuardError({
        skillId,
        toolName,
        toolArgs,
        userInstruction,
        toolHistory,
        pageContext,
      });
      if (sourcingWorkflowGuardError) {
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({
          role: "user",
          content: JSON.stringify(sourcingWorkflowGuardError),
        });
        continue;
      }

      if (isSourcingSkill(skillId) && toolName === "input_text_and_search") {
        const incompleteImageSearch = lastIncompleteImageSearch(toolHistory);
        if (incompleteImageSearch) {
          messages.push({ role: "assistant", content: assistantContent });
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "tool_error",
              tool: toolName,
              error: "刚刚的以图搜图流程尚未真正进入商品结果页，禁止立即切换到文本搜索。请先继续完成图片检索动作：优先重新调用 image_search_1688/image_search_taobao；如果页面仍停留在上传浮层，请读取页面或使用截图坐标点击明确的“搜索图片/以图搜款/找同款”按钮；只有平台明确无图搜结果、验证码/登录墙阻断，或用户要求文本兜底时，才允许文本搜索。",
              previousImageSearch: {
                tool: incompleteImageSearch.tool,
                result: incompleteImageSearch.result,
              },
            }),
          });
          continue;
        }

        if (domesticVisualRouteActive(skillId, pageContext, toolHistory) && !isExplicitTextFallbackAllowed(userInstruction)) {
          messages.push({ role: "assistant", content: assistantContent });
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "tool_error",
              tool: toolName,
              error: "本轮国内寻源已经进入非标视觉/以图搜图路径。对于非标外观、模具、造型类商品，Critic 打回后也严格禁止回到文本框关键词搜索。请继续使用 productCards、截图和候选主图做视觉相似度筛选；如 1688 自动框选主体不完整且已配置生图模型，请先调用 prepare_clean_product_image，再把返回的 image_search_argument.imageUrl 传给 image_search_1688/image_search_taobao。",
            }),
          });
          continue;
        }
      }

      if (isSourcingSkill(skillId) && toolName === "agentic_web_search") {
        const query = toolArgs.query || "";
        const previousSearches = countToolCalls(toolHistory, "agentic_web_search");
        if (previousSearches >= 1 || !isLogisticsOrPolicySearchQuery(query)) {
          messages.push({ role: "assistant", content: assistantContent });
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "tool_error",
              tool: toolName,
              error: previousSearches >= 1
                ? "国内供应链寻源流程中 agentic_web_search 最多允许调用 1 次，仅用于物流、费率、政策或认证核算。请不要重复静默联网搜索；继续使用当前 1688/淘宝视觉候选、详情页数据和已获得的物流估算完成报告。"
                : "agentic_web_search 只允许用于物流、费率、政策、认证等纯信息核算，不能用于寻找 1688/淘宝货源或替代图片搜索。请回到 image_search_1688/image_search_taobao、productCards 视觉筛选或详情页审计。",
              query,
            }),
          });
          continue;
        }
      }

      const progressToolArgs = { ...toolArgs };
      if (progressToolArgs.imageUrl && String(progressToolArgs.imageUrl).startsWith("data:")) {
        progressToolArgs.imageUrl = "__UPLOADED_IMAGE_DATA__";
      }
      sendProgress({ type: "tool_call", step, toolName, toolArgs: progressToolArgs });

      if (!tools[toolName]) {
        const errMsg = `Unknown tool: ${toolName}. Available: ${availableTools}`;
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({
          role: "user",
          content: JSON.stringify({ type: "tool_error", tool: toolName, error: errMsg }),
        });
        continue;
      }

      // Auto-inject page context into monitor_process_page_data to prevent LLM token overflow
      if (toolName === "monitor_process_page_data") {
        if (!toolArgs.items || toolArgs.items.length === 0) {
          toolArgs.items = pageContext.productCards || [];
        }
        if (!toolArgs.shopInfo && pageContext.url) {
          toolArgs.shopInfo = {
            name: pageContext.title || "Ozon Seller",
            url: pageContext.url
          };
        }
        if (!toolArgs.platform) {
          toolArgs.platform = (pageContext.url && pageContext.url.includes("ozon")) ? "ozon" : "tiktok";
        }
      }

      let toolResult;
      try {
        toolResult = await tools[toolName](toolArgs);
      } catch (err) {
        toolResult = { error: err.message };
      }
      toolHistory.push({ tool: toolName, arguments: toolArgs, result: toolResult });

      sendProgress({ type: "tool_result", step, toolName, toolResult });

      if (toolResult && toolResult.isCaptcha) {
        sendProgress({
          type: "captcha_warning",
          step,
          message: "【采购平台人机拦截预警】：检测到当前页面被验证码（滑块）或登录限制卡住！请立刻前往打开的浏览器窗口，滑动通过验证或完成登录。操作完成后 Agent 将自动继续。"
        });
      }

      let nextScreenshot = null;
      const pageModifyingTools = ["open_new_tab", "navigate_to", "search_in_browser", "click_by_text", "input_text_and_search", "click_by_selector", "image_search_1688", "image_search_taobao", "image_search_in_browser", "click_by_coordinate"];
      if (pageModifyingTools.includes(toolName)) {
        try {
          const tId = (toolResult && toolResult.tabId) ? toolResult.tabId : tabId;
          const t = await new Promise((resTab) => {
            chrome.tabs.get(tId, (tabInfo) => {
              if (chrome.runtime.lastError || !tabInfo) resTab(null);
              else resTab(tabInfo);
            });
          });
          if (t && t.windowId) {
            nextScreenshot = await new Promise((resScr) => {
              chrome.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 60 }, (dataUrl) => {
                if (chrome.runtime.lastError || !dataUrl) resScr(null);
                else resScr(dataUrl);
              });
            });
          }
        } catch (err) {
          console.warn("Could not capture real-time loop screenshot:", err.message);
        }
      }

      messages.push({ role: "assistant", content: assistantContent });

      const userResultObj = {
        type: "tool_result",
        tool: toolName,
        result: toolResult,
      };
      const productCards = toolResult?.pageData?.productCards || [];
      if (Array.isArray(productCards) && productCards.length > 0) {
        userResultObj.visual_candidate_summary = summarizeProductCards(productCards);
        userResultObj.next_step_instruction = "当前页面已经抽取到带主图与屏幕坐标的 productCards。下一步必须停止继续搜索，先对照目标商品主图和最新截图，把这些卡片按外观/材质/结构视觉相似度排序；只允许打开视觉排名最高且未触发材质/造型红线的 1-3 个详情页。最终 data 每项必须写入 candidate_image_url、list_page_visual_score、visual_match_evidence，禁止只按标题关键词选择。";
      }

      let userMsgContent;
      if (nextScreenshot) {
        userMsgContent = [
          { type: "text", text: JSON.stringify(userResultObj) },
          { type: "image_url", image_url: { url: nextScreenshot } }
        ];
      } else {
        userMsgContent = JSON.stringify(userResultObj);
      }

      messages.push({
        role: "user",
        content: userMsgContent,
      });

      continue;
    }

    messages.push({ role: "assistant", content: assistantContent });
    globalSessionCache[sessionKey] = messages;
    return {
      ok: true,
      type: "json",
      result: parsed,
      steps: step,
    };
  }

  throw new Error(`Agent loop exceeded maximum steps (${maxSteps})`);
}

function repairJSONQuotes(str) {
  if (!str) return str;
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') {
      if (i > 0 && str[i - 1] === '\\') {
        result += char;
        continue;
      }
      let beforeChar = "";
      for (let j = i - 1; j >= 0; j--) {
        if (!/\s/.test(str[j])) {
          beforeChar = str[j];
          break;
        }
      }
      let afterChar = "";
      for (let j = i + 1; j < str.length; j++) {
        if (!/\s/.test(str[j])) {
          afterChar = str[j];
          break;
        }
      }
      const isPrecededByStructure = ["{", "[", ",", ":"].includes(beforeChar);
      const isFollowedByStructure = [":", ",", "}", "]"].includes(afterChar);
      if (isPrecededByStructure || isFollowedByStructure) {
        result += char;
      } else {
        result += '\\"';
      }
    } else {
      result += char;
    }
  }
  return result;
}

function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    try {
      let repaired = repairJSONQuotes(str);
      repaired = repaired.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
        return '"' + p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
      });
      return JSON.parse(repaired);
    } catch (_) {
      throw e;
    }
  }
}

function extractJSONBlock(text) {
  if (!text || typeof text !== "string") return null;

  // 1. Scan code blocks (from last to first to match the final output block after reflections)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let matches = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    matches.push(match[1].trim());
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const parsed = tryParseJSON(matches[i]);
      if (parsed && (parsed.type === "final" || parsed.output || parsed.tool)) {
        return parsed;
      }
    } catch (_) {}
  }

  // 2. Fallback: Search for outer curly braces
  const braceRegex = /(\{[\s\S]*\})/g;
  const braceMatches = [];
  while ((match = braceRegex.exec(text)) !== null) {
    braceMatches.push(match[1].trim());
  }
  for (let i = braceMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = tryParseJSON(braceMatches[i]);
      if (parsed && (parsed.type === "final" || parsed.output || parsed.tool)) {
        return parsed;
      }
    } catch (_) {}
  }

  // 3. Fallback: Try raw parsing of the entire text
  try {
    return tryParseJSON(text.trim());
  } catch (_) {}

  return null;
}
