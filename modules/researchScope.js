/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
const OZON_HOST_RE = /(^|\.)ozon\.ru$/i;
const SUPPLIER_HOST_RE = /(^|\.)?(1688|taobao|tmall)\.com$/i;

function safeUrl(url = "") {
  try {
    return new URL(String(url || ""));
  } catch (_) {
    return null;
  }
}

function includesAny(text = "", patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeClarificationInput(input = {}) {
  if (!input || typeof input !== "object") return {};
  const seedKeyword = normalizeText(input.seedKeyword || input.keyword || input.query || "");
  const seedCategory = normalizeText(input.seedCategory || input.category || "");
  const targetShop = normalizeText(input.targetShop || input.shop || "");
  const note = normalizeText(input.note || input.extra || input.userInput || "");
  return {
    seedKeyword,
    seedCategory,
    targetShop,
    note,
  };
}

function extractSearchParam(urlObj) {
  if (!urlObj) return "";
  return normalizeText(
    urlObj.searchParams.get("text") ||
    urlObj.searchParams.get("from_global") ||
    urlObj.searchParams.get("q") ||
    urlObj.searchParams.get("query") ||
    ""
  );
}

function extractSellerIdentity(urlObj) {
  if (!urlObj) return "";
  const match = String(urlObj.pathname || "").match(/\/(?:seller|shop)\/([^\/?#]+)/i);
  return normalizeText(match?.[1] || "").toLowerCase();
}

function matchBoundShopBySellerUrl(urlObj, boundShops = []) {
  const currentIdentity = extractSellerIdentity(urlObj);
  if (!currentIdentity) return null;
  return boundShops.find((shop) => {
    const shopUrl = safeUrl(shop?.sellerUrl || "");
    return shopUrl && extractSellerIdentity(shopUrl) === currentIdentity;
  }) || null;
}

function inferOzonEntryPageType(urlObj, pageContext = {}) {
  if (!urlObj || !OZON_HOST_RE.test(urlObj.hostname)) return "";
  const path = urlObj.pathname.toLowerCase();
  const title = `${pageContext.title || ""} ${pageContext.pageType || ""}`.toLowerCase();
  if (path === "/" || path === "") return "ozon_home";
  if (/\/(search|category|highlight|seller-products)/i.test(path) || extractSearchParam(urlObj)) return "ozon_search";
  if (/\/category\//i.test(path)) return "ozon_category";
  if (/\/product\//i.test(path)) return "competitor_product";
  if (/\/(seller|shop)\//i.test(path) || /магазин|seller|shop|витрина/i.test(title)) return "competitor_store";
  return "ozon_category";
}

function inferInstructionScope(instruction = "", growthActionId = "", skillPaths = []) {
  const text = `${instruction || ""} ${growthActionId || ""} ${skillPaths.join(" ")}`.toLowerCase();
  if (includesAny(text, [/趋势|trend|platform_trends|平台|大盘|类目|热卖/])) return "platform_trend";
  if (includesAny(text, [/竞品|competitor|对标|跟踪/])) return "competitor_learning";
  if (includesAny(text, [/店铺|体检|diagnose_store|optimizer|定位|全店/])) return "store_trend_fit";
  if (includesAny(text, [/货源|供应商|1688|taobao|淘宝|采购|sourcing|利润/])) return "sourcing_validation";
  if (includesAny(text, [/商品机会|单品机会|product_opportunity/])) return "product_opportunity";
  if (includesAny(text, [/listing|标题|详情|关键词|seo|首图|转化/])) return "product_opportunity";
  if (includesAny(text, [/机会|扩品|选品|opportunity/])) return "category_opportunity";
  return "";
}

function analysisScopeForEntry(entryPageType = "", instructionScope = "") {
  if (instructionScope) return instructionScope;
  if (entryPageType === "owned_store" || entryPageType === "competitor_store" || entryPageType === "external_store") return "store_trend_fit";
  if (entryPageType === "owned_product" || entryPageType === "competitor_product") return "product_opportunity";
  if (entryPageType === "ozon_search" || entryPageType === "ozon_category") return "category_opportunity";
  if (entryPageType === "ozon_home") return "platform_trend";
  if (entryPageType === "supplier_page") return "sourcing_validation";
  return "unknown";
}

function roleForEntry(entryPageType = "", _analysisScope = "") {
  if (entryPageType === "owned_store") return "self_store";
  if (entryPageType === "owned_product") return "self_product";
  if (entryPageType === "external_store") return "store_subject_external";
  if (entryPageType === "competitor_store" || entryPageType === "competitor_product") return "competitor_reference";
  if (entryPageType === "ozon_home") return "platform_discovery";
  if (entryPageType === "ozon_search" || entryPageType === "ozon_category") return "category_research";
  if (entryPageType === "supplier_page") return "sourcing_reference";
  return "unknown";
}

function trendContextType(analysisScope = "", entryPageType = "") {
  if (analysisScope === "store_trend_fit") return "store_trend_fit";
  if (analysisScope === "platform_trend") return entryPageType === "ozon_home" ? "platform_trend" : "platform_trend";
  if (analysisScope === "category_opportunity") return "category_opportunity";
  if (analysisScope === "product_opportunity") return "product_opportunity";
  if (analysisScope === "competitor_learning") return "competitor_learning";
  if (analysisScope === "sourcing_validation") return "sourcing_validation";
  return "unknown";
}

function buildConclusionPolicy({ entryPageType, analysisScope, sourcePageRole, seedKeywords, autoDiscoveryRequired = false }) {
  const allowed = [];
  const forbidden = [];
  if (analysisScope === "store_trend_fit") {
    allowed.push("判断当前店铺定位、商品矩阵和平台趋势的适配度");
    allowed.push("生成店铺体检下的子任务、人工确认点和观察窗口");
    forbidden.push("未完成公开趋势/竞品/合规/寻源验证前直接建议采购或批量上架");
  }
  if (analysisScope === "platform_trend") {
    allowed.push("输出 Ozon 公开页面、Yandex.ru、Google RU/Trends 支撑的平台需求窗口");
    if (autoDiscoveryRequired) {
      allowed.push("在用户没有明确关键词时，先从 Ozon 首页推荐、热词/排行/类目入口和俄区外部公开趋势自动生成候选研究范围");
    }
    forbidden.push("在没有店铺适配证据时直接声称当前店铺应该执行该机会");
  }
  if (analysisScope === "category_opportunity") {
    allowed.push("围绕当前搜索词或类目输出价格带、评价门槛、竞品结构和下一步验证");
    forbidden.push("把搜索页可见样本写成全平台完整销量或完整价格分布");
  }
  if (analysisScope === "product_opportunity") {
    allowed.push("围绕当前商品输出单品机会、竞品、评论、合规或寻源路径");
    forbidden.push("没有竞品/评论/趋势证据时输出蓝海、高增长或低竞争确定结论");
  }
  if (sourcePageRole === "competitor_reference") {
    allowed.push("把当前页面作为竞品学习样本");
    forbidden.push("把竞品页面误写成自营店铺或自营商品");
  }
  if (sourcePageRole === "store_subject_external") {
    allowed.push("把当前访问店铺作为公开店铺样本做店铺体检或定位学习");
    forbidden.push("把当前公开店铺误写成已绑定自营店铺");
    forbidden.push("把 Seller API 或内部经营数据伪装成当前公开店铺已验证证据");
  }
  if (analysisScope === "sourcing_validation") {
    allowed.push("验证供应商、规格、MOQ、价格、认证和跨境毛利");
    forbidden.push("把 1688/淘宝供应商页当作 Ozon 平台趋势证据");
  }
  if (entryPageType === "ozon_home" && seedKeywords.length === 0 && !autoDiscoveryRequired) {
    forbidden.push("缺少关键词/类目/店铺适配范围时输出 completed 趋势结论");
  }
  return { allowed_conclusions: allowed, forbidden_conclusions: forbidden };
}

export function buildResearchScope({
  pageContext = {},
  tab = {},
  userInstruction = "",
  growthActionId = "",
  matchedSkills = [],
  activeShopId = "",
  boundShops = [],
  clarificationInput = {},
} = {}) {
  const url = normalizeText(pageContext.url || tab.url || "");
  const urlObj = safeUrl(url);
  const instructionScope = inferInstructionScope(userInstruction, growthActionId, matchedSkills);
  let entryPageType = "unknown";
  if (urlObj && OZON_HOST_RE.test(urlObj.hostname)) {
    entryPageType = inferOzonEntryPageType(urlObj, pageContext) || "unknown";
  } else if (urlObj && SUPPLIER_HOST_RE.test(urlObj.hostname)) {
    entryPageType = "supplier_page";
  }
  const matchedBoundShop = matchBoundShopBySellerUrl(urlObj, Array.isArray(boundShops) ? boundShops : []);
  const matchedBoundShopId = normalizeText(matchedBoundShop?.id || "");
  const matchedBoundShopName = normalizeText(matchedBoundShop?.name || "");
  const isStorePage = entryPageType === "competitor_store";
  if (isStorePage && matchedBoundShopId) {
    entryPageType = "owned_store";
  } else if (isStorePage && instructionScope === "store_trend_fit") {
    entryPageType = "external_store";
  }
  const clarification = normalizeClarificationInput(clarificationInput || pageContext.clarification_input || {});
  const seedKeyword = extractSearchParam(urlObj);
  const seedKeywords = Array.from(new Set([
    seedKeyword,
    clarification.seedKeyword,
    clarification.targetShop,
    ...(Array.isArray(pageContext.keywords) ? pageContext.keywords : []),
    ...(Array.isArray(pageContext.productCards) ? pageContext.productCards.slice(0, 3).map((card) => card.title || card.name || "") : []),
  ].map(normalizeText).filter(Boolean))).slice(0, 8);
  const seedCategory = normalizeText(clarification.seedCategory || pageContext.category || pageContext.pageType || "");
  const analysisScope = analysisScopeForEntry(entryPageType, instructionScope);
  const canAutoDiscoverPlatformTrend = ["ozon_home", "unknown"].includes(entryPageType);
  const autoDiscoveryRequired = analysisScope === "platform_trend" && canAutoDiscoverPlatformTrend && seedKeywords.length === 0 && !seedCategory;
  const sourcePageRole = autoDiscoveryRequired ? "platform_discovery" : roleForEntry(entryPageType, analysisScope);
  const weakContext = (entryPageType === "unknown" && !autoDiscoveryRequired) || (
    entryPageType === "ozon_home" &&
    seedKeywords.length === 0 &&
    !seedCategory &&
    !autoDiscoveryRequired
  );
  const scopeConfidence = weakContext
    ? "low"
    : autoDiscoveryRequired
    ? "medium"
    : (seedKeywords.length > 0 || seedCategory || sourcePageRole !== "unknown" ? "high" : "medium");
  const policy = buildConclusionPolicy({ entryPageType, analysisScope, sourcePageRole, seedKeywords, autoDiscoveryRequired });
  const isBoundStorePage = Boolean(matchedBoundShopId);
  const isActiveShopPage = Boolean(matchedBoundShopId) && matchedBoundShopId === normalizeText(activeShopId);
  const runtimeShopId = entryPageType === "owned_store" ? (matchedBoundShopId || normalizeText(activeShopId)) : "";
  const diagnosisMode = analysisScope === "store_trend_fit"
    ? runtimeShopId
      ? "api_bound_diagnosis"
      : normalizeText(activeShopId)
      ? "mixed_diagnosis"
      : "outer_visitor_diagnosis"
    : "";

  return {
    entry_page_type: entryPageType,
    source_page_role: sourcePageRole,
    seed_keywords: seedKeywords,
    seed_category: seedCategory,
    seed_store_positioning: normalizeText(pageContext.shopName || pageContext.title || ""),
    analysis_scope: analysisScope,
    trend_context_type: trendContextType(analysisScope, entryPageType),
    scope_confidence: scopeConfidence,
    needs_user_clarification: weakContext,
    auto_discovery_required: autoDiscoveryRequired,
    discovery_sources: autoDiscoveryRequired
      ? ["current_page_public_clues", "ozon_home_recommendations", "ozon_hot_words_or_rankings", "ozon_category_entrypoints", "yandex_ru_public_trends", "google_ru_public_search", "google_trends_ru"]
      : [],
    clarification_input: clarification,
    current_url: url,
    current_title: normalizeText(pageContext.title || tab.title || ""),
    active_shop_id: runtimeShopId,
    selected_active_shop_id: normalizeText(activeShopId),
    matched_bound_shop_id: matchedBoundShopId,
    matched_bound_shop_name: matchedBoundShopName,
    is_bound_store_page: isBoundStorePage,
    is_active_shop_page: isActiveShopPage,
    diagnosis_mode: diagnosisMode,
    api_evidence_policy: diagnosisMode === "api_bound_diagnosis"
      ? "seller_api_allowed_for_bound_store"
      : diagnosisMode === "mixed_diagnosis"
      ? "seller_api_only_for_selected_bound_shop_not_current_page"
      : diagnosisMode === "outer_visitor_diagnosis"
      ? "public_page_only_bind_seller_api_for_private_metrics"
      : "",
    ...policy,
  };
}

export function isWeakResearchScope(scope = {}) {
  return scope.needs_user_clarification || scope.scope_confidence === "low";
}
