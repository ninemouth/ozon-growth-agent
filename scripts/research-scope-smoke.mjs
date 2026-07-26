import assert from "node:assert/strict";
import { buildResearchScope } from "../modules/researchScope.js";
import { validateOzonPlatformTrendReport, validateWorkflowReadyOutput } from "../modules/agentLoop.js";

const storeScope = buildResearchScope({
  pageContext: { url: "https://www.ozon.ru/seller/test-shop-123/", title: "Test Shop" },
  userInstruction: "做店铺体检",
  growthActionId: "diagnose_store_growth",
  activeShopId: "shop-1",
  boundShops: [
    { id: "shop-1", name: "Test Shop", sellerUrl: "https://www.ozon.ru/seller/test-shop-123/" },
  ],
});
assert.equal(storeScope.entry_page_type, "owned_store");
assert.equal(storeScope.analysis_scope, "store_trend_fit");
assert.equal(storeScope.source_page_role, "self_store");
assert.equal(storeScope.needs_user_clarification, false);
assert.equal(storeScope.active_shop_id, "shop-1");
assert.equal(storeScope.matched_bound_shop_id, "shop-1");
assert.equal(storeScope.is_bound_store_page, true);

const externalStoreScope = buildResearchScope({
  pageContext: { url: "https://www.ozon.ru/seller/benchmark-shop-999/", title: "Benchmark Shop" },
  userInstruction: "做店铺体检",
  growthActionId: "diagnose_store_growth",
  activeShopId: "shop-1",
  boundShops: [
    { id: "shop-1", name: "Test Shop", sellerUrl: "https://www.ozon.ru/seller/test-shop-123/" },
  ],
});
assert.equal(externalStoreScope.entry_page_type, "external_store");
assert.equal(externalStoreScope.analysis_scope, "store_trend_fit");
assert.equal(externalStoreScope.source_page_role, "store_subject_external");
assert.equal(externalStoreScope.active_shop_id, "");
assert.equal(externalStoreScope.selected_active_shop_id, "shop-1");
assert.equal(externalStoreScope.is_bound_store_page, false);

const competitorStoreScope = buildResearchScope({
  pageContext: { url: "https://www.ozon.ru/seller/benchmark-shop-999/", title: "Benchmark Shop" },
  userInstruction: "跟踪这个竞品店铺",
  growthActionId: "scan_competitor_changes",
  activeShopId: "shop-1",
  boundShops: [
    { id: "shop-1", name: "Test Shop", sellerUrl: "https://www.ozon.ru/seller/test-shop-123/" },
  ],
});
assert.equal(competitorStoreScope.entry_page_type, "competitor_store");
assert.equal(competitorStoreScope.source_page_role, "competitor_reference");

const homeScope = buildResearchScope({
  pageContext: { url: "https://www.ozon.ru/", title: "Ozon" },
  userInstruction: "",
});
assert.equal(homeScope.entry_page_type, "ozon_home");
assert.equal(homeScope.analysis_scope, "platform_trend");
assert.equal(homeScope.needs_user_clarification, false, "platform trends should auto-discover a seed scope from Ozon/external signals");
assert.equal(homeScope.auto_discovery_required, true);
assert.equal(homeScope.scope_confidence, "medium");
assert.ok(homeScope.discovery_sources.includes("ozon_home_recommendations"));

const unknownPlatformScope = buildResearchScope({
  pageContext: { url: "chrome://newtab/", title: "New Tab" },
  userInstruction: "平台趋势",
  matchedSkills: ["skills/ozon_platform_trends.skill.md"],
});
assert.equal(unknownPlatformScope.entry_page_type, "unknown");
assert.equal(unknownPlatformScope.analysis_scope, "platform_trend");
assert.equal(unknownPlatformScope.source_page_role, "platform_discovery");
assert.equal(unknownPlatformScope.needs_user_clarification, false, "platform trends should auto-discover from blank or unknown pages");
assert.equal(unknownPlatformScope.auto_discovery_required, true);
assert.equal(unknownPlatformScope.scope_confidence, "medium");
assert.ok(unknownPlatformScope.discovery_sources.includes("current_page_public_clues"));

const unknownStoreScope = buildResearchScope({
  pageContext: { url: "chrome://newtab/", title: "New Tab" },
  userInstruction: "店铺体检",
  matchedSkills: ["skills/ozon_global_shop_optimizer.skill.md"],
});
assert.equal(unknownStoreScope.entry_page_type, "unknown");
assert.equal(unknownStoreScope.analysis_scope, "store_trend_fit");
assert.equal(unknownStoreScope.needs_user_clarification, true, "non-trend workflows still need a concrete shop, SKU, category, or keyword");
assert.equal(unknownStoreScope.auto_discovery_required, false);

const searchScope = buildResearchScope({
  pageContext: { url: "https://www.ozon.ru/search/?text=%D0%BF%D0%BE%D0%BB%D0%BA%D0%B0", title: "полка" },
  userInstruction: "分析这个类目趋势",
});
assert.equal(searchScope.entry_page_type, "ozon_search");
assert.equal(searchScope.analysis_scope, "platform_trend");
assert.ok(searchScope.seed_keywords.length > 0);

const productScope = buildResearchScope({
  pageContext: { url: "https://www.ozon.ru/product/123456/", title: "Product" },
  userInstruction: "分析这个商品机会",
});
assert.equal(productScope.entry_page_type, "competitor_product");
assert.equal(productScope.analysis_scope, "product_opportunity");
assert.equal(productScope.source_page_role, "competitor_reference");

const supplierScope = buildResearchScope({
  pageContext: { url: "https://detail.1688.com/offer/123.html", title: "1688 offer" },
  userInstruction: "筛选供应商",
});
assert.equal(supplierScope.entry_page_type, "supplier_page");
assert.equal(supplierScope.analysis_scope, "sourcing_validation");
assert.match(supplierScope.forbidden_conclusions.join(" "), /Ozon 平台趋势/);

const competitorErrors = validateWorkflowReadyOutput({
  research_scope: competitorStoreScope,
  report_status: "partial",
  blocking_gaps: [],
  follow_up_tasks: [],
  workflow_nodes: [],
  overview: "当前店铺需要先重构定位。",
}, "skills/ozon_global_shop_optimizer.skill.md", { research_scope: competitorStoreScope });
assert.match(competitorErrors.join("\n"), /竞品参考页/);

const externalAllowed = validateWorkflowReadyOutput({
  research_scope: externalStoreScope,
  report_status: "partial",
  blocking_gaps: [],
  follow_up_tasks: [],
  workflow_nodes: [],
  overview: "当前访问店铺的定位更偏向低价收纳样本，建议作为公开店铺样本学习。",
}, "skills/ozon_global_shop_optimizer.skill.md", { research_scope: externalStoreScope });
assert.equal(externalAllowed.length, 0);

const externalApiErrors = validateWorkflowReadyOutput({
  research_scope: externalStoreScope,
  report_status: "partial",
  blocking_gaps: [],
  follow_up_tasks: [],
  workflow_nodes: [],
  overview: "本店已通过 Seller API 证明加购率偏低。",
}, "skills/ozon_global_shop_optimizer.skill.md", { research_scope: externalStoreScope });
assert.match(externalApiErrors.join("\n"), /未绑定的公开店铺体检对象/);

const platformTrendToolHistory = [
  { tool: "search_in_browser", arguments: { engine: "ozon", query: "китайские талисманы" }, result: { ok: true, url: "https://www.ozon.ru/search/?text=%D1%82%D0%B0%D0%BB%D0%B8%D1%81%D0%BC%D0%B0%D0%BD%D1%8B" } },
  { tool: "search_in_browser", arguments: { engine: "yandex_wordstat", query: "талисман" }, result: { ok: true, url: "https://wordstat.yandex.com/?region=225&words=талисман" } },
  { tool: "search_in_browser", arguments: { engine: "wildberries", query: "талисман" }, result: { ok: true, url: "https://www.wildberries.ru/catalog/0/search.aspx?search=талисман" } },
];

const validPlatformTrendReport = {
  report_status: "partial",
  blocking_gaps: [],
  follow_up_tasks: [{
    task_id: "trend-task-1",
    task_type: "market_validation",
    priority: "P1",
    target: "талисман / оберег",
    reason: "补齐竞品详情页评论和规格差异。",
    required_evidence: ["Ozon 详情页截图", "评论文本", "合规资质确认"],
    expected_output: "确认可小批测试的祈福饰品子类。",
    requires_manual_confirmation: false,
  }],
  workflow_nodes: [{
    node_id: "node-trend-1",
    title: "祈福饰品可卖候选复核",
    status: "queued",
    depends_on: [],
    next_action: "打开 Ozon 详情页补采评论和规格。",
  }],
  trend_context_type: "platform_trend",
  research_scope: {
    entry_page_type: "unknown",
    analysis_scope: "platform_trend",
    source_page_role: "platform_discovery",
    scope_confidence: "medium",
  },
  platform_signal: {
    summary: "Ozon/Wordstat/Wildberries 公开信号用于轻量验证。",
    limitation: "本轮不使用 Seller API 代表平台大盘。",
  },
  external_source_plan: {
    layers: {
      platform_trade: { sources: ["ozon"], status: "used", used_for: "站内价格和评价关注信号" },
      search_demand: { sources: ["yandex_wordstat"], status: "used", used_for: "词族需求撒网" },
      cross_marketplace: { sources: ["wildberries"], status: "used", used_for: "跨平台价格和规格对照" },
      social_content: { sources: [], status: "not_used", used_for: "本轮未使用" },
      macro_context: { sources: [], status: "not_used", used_for: "本轮不使用宏观背景直接支撑 SKU 推荐" },
    },
  },
  macro_context: {
    status: "not_used",
    summary: "本轮未启用宏观资料；不影响用商品和搜索侧证据做轻量机会排序。",
    affects: ["价格敏感", "履约风险"],
    claim_boundary: "宏观背景不能单独证明某个 SKU 或商品机会可卖。",
  },
  store_fit: { fit: "unknown", reason: "当前是平台趋势研究，不等于本店上架建议。" },
  query_funnel: {
    user_intent: "想了解来自中国的祈福产品趋势",
    as_of_date: "2026-07-26",
    forecast_horizon: "next_6_months",
    intent_dimensions: ["祈福/护身", "中国文化来源", "轻小件礼品", "俄罗斯电商搜索"],
    discovery_queries: ["талисман", "оберег", "амулет", "фэншуй", "китайский талисман", "браслет оберег"],
    scored_queries: [
      { query_ru: "талисман", scope_relation: "parent_proxy", decision: "focus", evidence: "Ozon/Wordstat/Wildberries 均可轻量验证", ozon_attention: 2, cross_site_coverage: 2, future_signal: 1, seller_fit: 3, total_score: 8 },
      { query_ru: "оберег", scope_relation: "parent_proxy", decision: "focus", evidence: "词族更接近本地祈福语义", ozon_attention: 2, cross_site_coverage: 1, future_signal: 1, seller_fit: 3, total_score: 7 },
      { query_ru: "фэншуй", scope_relation: "adjacent_proxy", decision: "reserve", evidence: "更偏家居摆件，需验证体积和侵权风险", ozon_attention: 1, cross_site_coverage: 1, future_signal: 1, seller_fit: 2, total_score: 5 },
    ],
    focus_queries: ["талисман", "оберег"],
    refinement_log: [],
  },
  recommended_opportunities: ["T-1"],
  validated_opportunities: ["T-1"],
  assumption_opportunities: [],
  rejected_directions: [{
    direction: "大型风水摆件",
    filter_ids: ["oversize", "fragile"],
    reason: "体积和破损风险较高，先不进入主推荐。",
  }],
  data: [{
    opportunity_id: "T-1",
    recommendation_status: "recommended",
    filter_verdict: "passed",
    seller_fit_reason: "轻小件、非尺码品，可做小批量文化礼品测试。",
    keyword_or_category: "祈福护身小饰品 / талисман",
    buyer_scenario: "礼品、个人护身、节日祝福。",
    price_band: "待用详情页补证的中低价带",
    demand_signal: "observed",
    seasonality: "未使用 Google Trends 季节性结论。",
    competitor_signal: "Ozon 与 Wildberries 均有可见同类结果，仍需详情页补证。",
    next_validation_action: "补采 2 个 Ozon 详情页和评论。",
    evidence: "Ozon 站内搜索、Yandex Wordstat 词族、Wildberries 同类结果形成轻量交叉验证。",
    sample_count: "轻量搜索样本",
    coverage: "Ozon/Wordstat/Wildberries",
    limitation: "未读取详情页评论，不能直接采购。",
    evidence_ledger: [
      { source_type: "ozon_search", source_ref: "Ozon 搜索：талисман", observed_value: "可见同类结果", used_for: "站内供给与价格带初筛", confidence: "medium", limitation: "未打开详情页" },
      { source_type: "yandex_wordstat", source_ref: "Yandex Wordstat：талисман", observed_value: "词族需求可作为撒网依据", used_for: "关键词需求初筛", confidence: "medium", limitation: "不能代表 Ozon 销量" },
      { source_type: "wildberries_search", source_ref: "Wildberries 搜索：талисман", observed_value: "跨平台存在同类供给", used_for: "规格和红海程度对照", confidence: "medium", limitation: "不能替代 Ozon 证据" },
    ],
  }],
};

assert.deepEqual(
  validateOzonPlatformTrendReport(validPlatformTrendReport, platformTrendToolHistory, {}),
  [],
  "platform trend reports should allow macro_context status=not_used when the boundary is explicit and direct demand evidence exists"
);

const macroOnlyObservedReport = structuredClone(validPlatformTrendReport);
macroOnlyObservedReport.data[0].evidence_ledger = [{
  source_type: "macro_context",
  source_ref: "CBR inflation background",
  observed_value: "宏观价格敏感背景",
  used_for: "解释价格敏感",
  confidence: "medium",
  limitation: "不能证明单品可卖",
}];
const macroOnlyErrors = validateOzonPlatformTrendReport(
  macroOnlyObservedReport,
  [...platformTrendToolHistory, { tool: "search_in_browser", arguments: { engine: "cbr", query: "inflation Russia ecommerce" }, result: { ok: true, url: "https://www.cbr.ru/" } }],
  {}
);
assert.match(macroOnlyErrors.join("\n"), /宏观或行业资料只能作为背景，不能单独证明商品机会可卖/);

console.log("research-scope-smoke: ok");
