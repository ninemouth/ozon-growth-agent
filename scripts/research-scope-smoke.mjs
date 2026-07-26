import assert from "node:assert/strict";
import { buildResearchScope } from "../modules/researchScope.js";
import {
  sanitizeFinalReportBeforeCritic,
  validateOzonPlatformTrendReport,
  validateWorkflowReadyOutput,
} from "../modules/agentLoop.js";

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

const channelScope = buildResearchScope({
  pageContext: {
    url: "https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/",
    title: "Товары из Китая - купить Китайские товары в интернет магазине OZON",
  },
  userInstruction: "分析这个中国商品专题页趋势",
  matchedSkills: ["skills/ozon_platform_trends.skill.md"],
});
assert.equal(channelScope.entry_page_type, "ozon_channel");
assert.equal(channelScope.analysis_scope, "platform_trend");
assert.equal(channelScope.source_page_role, "channel_research");
assert.equal(channelScope.trend_context_type, "channel_trend");
assert.equal(channelScope.channel_context.scope_type, "channel_page");
assert.match(channelScope.channel_context.channel_boundary, /不代表 Ozon 全站销量/);
assert.match(channelScope.forbidden_conclusions.join(" "), /全站趋势|全平台销量/);

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
  trend_scope: {
    scope_type: "global_discovery",
    scope_name: "Ozon 平台公开趋势发现",
    entry_url: "https://www.ozon.ru/",
    scope_boundary: "本轮仅代表公开页面、Ozon 搜索和外部信源可见样本，不代表完整市场或全平台销量。",
    allowed_conclusions: ["公开需求窗口", "可卖候选初筛", "下一步补证任务"],
    forbidden_conclusions: ["当前店铺立即采购上架", "完整市场份额", "全平台销量"],
  },
  channel_structure: {
    visible_theme: "not_applicable",
    visible_product_clusters: [],
    channel_boundary: "非频道页入口；本轮不使用频道页可见曝光代表全站销量。",
  },
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
      adaptive_qualitative: { sources: [], status: "not_used", used_for: "本轮固定信源已足够轻量验证" },
      macro_context: { sources: [], status: "not_used", used_for: "本轮不使用宏观背景直接支撑 SKU 推荐" },
    },
  },
  adaptive_source_discovery: {
    enabled: false,
    trigger_reason: "本轮 Ozon、Yandex Wordstat 与 Wildberries 已覆盖轻量验证，暂不启用规则外补充信源。",
    candidate_sources: [],
    selection_boundary: "发现来源不等于趋势已验证，必须进入页面取证和 evidence_ledger；定性资料不能单独证明 SKU 可卖。",
  },
  qualitative_market_context: {
    status: "not_used",
    buyer_language: [],
    usage_scenarios: [],
    content_themes: [],
    cultural_fit: { fit: "unknown", reason: "本轮未做社媒/评论/论坛定性取证。", risks: [] },
    objection_patterns: [],
    evidence_ledger: [],
    claim_boundary: "定性市场资料只能解释买家语言、使用场景、文化接受度和内容表达，不能单独证明某个 SKU 或商品机会可卖。",
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
  product_level_map: [{
    opportunity_id: "T-1",
    base_direction: "祈福护身小饰品",
    product_forms: [
      { form: "基础护身挂件", buyer_segment: "低价礼品和自用护身用户", price_tier: "low", trend_logic: "轻小件、低门槛，但需避免同质化红海", seller_action: "仅作为搜索词和主图方向补证" },
      { form: "礼品化小套装", buyer_segment: "礼物/节日/家居祝福用户", price_tier: "mid_low", trend_logic: "通过包装、寓意说明和组合提高差异化", seller_action: "优先补 Ozon 详情页和评论证据" },
    ],
  }],
  price_ladder: [
    { tier: "low", visible_price_range: "待补 Ozon 卢布价格；当前只做词族轻量验证", buyer_mindset: "便宜、随手买、试试看", competition_risk: "high", seller_fit: "partial_fit" },
    { tier: "mid_low", visible_price_range: "待补 Ozon 卢布价格和组合装竞品", buyer_mindset: "更完整的礼品感、寓意说明和包装", competition_risk: "medium", seller_fit: "fit" },
  ],
  audience_price_matrix: [
    { audience: "礼品用户", scenario: "节日或朋友祝福", pain_point: "希望寓意清楚、包装不像廉价小件", price_tier: "mid_low", product_cut: "礼品化小套装", evidence_level: "assumption", next_validation: ["补 Ozon 详情页", "补评论语境"] },
    { audience: "自用护身用户", scenario: "钱包、钥匙、车内小挂件", pain_point: "希望轻小、便携、解释清楚", price_tier: "low", product_cut: "基础护身挂件", evidence_level: "observed", next_validation: ["补 Ozon 搜索页", "补 Yandex Wordstat"] },
  ],
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

const validChannelTrendReport = structuredClone(validPlatformTrendReport);
validChannelTrendReport.trend_context_type = "channel_trend";
validChannelTrendReport.research_scope = channelScope;
validChannelTrendReport.trend_scope = {
  scope_type: "channel_page",
  scope_name: "Ozon 中国商品专题页",
  entry_url: "https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/",
  scope_boundary: "仅代表当前中国商品专题页可见曝光和平台运营选品口径，不代表 Ozon 全站销量、全平台趋势或俄罗斯全市场需求增长。",
  allowed_conclusions: ["频道页商品结构", "频道页可见关注信号", "频道内机会初筛"],
  forbidden_conclusions: ["Ozon 全站趋势已验证", "全平台销量增长", "当前店铺应立即采购上架"],
};
validChannelTrendReport.channel_structure = {
  visible_theme: "中国商品专题页",
  visible_product_clusters: [
    { cluster: "户外/夏季小工具", examples: ["防蚊螺旋支架", "泡沫喷雾器"], trend_hypothesis: "频道内可见夏季户外与家庭维护场景", risk: "季节窗口和合规边界待验证" },
    { cluster: "桌面/文具/小物收纳", examples: ["透明铅笔盒", "小物收纳盒"], trend_hypothesis: "频道内可见返校、办公和宿舍收纳场景", risk: "低价红海和包装破损待验证" },
  ],
  channel_boundary: "频道页可见曝光不代表 Ozon 全站销量或全平台趋势。",
};
validChannelTrendReport.external_source_plan = {
  layers: {
    platform_trade: { sources: ["ozon"], status: "used", used_for: "当前 Ozon 频道页可见商品结构", limitation: "不代表全站销量" },
    search_demand: { sources: ["yandex_wordstat"], status: "not_used", used_for: "待补搜索需求", limitation: "本轮未采集" },
    cross_marketplace: { sources: ["wildberries"], status: "not_used", used_for: "待补跨平台价格和规格", limitation: "本轮未采集" },
    social_content: { sources: [], status: "not_used", used_for: "本轮未采集" },
    macro_context: { sources: [], status: "not_used", used_for: "本轮不使用宏观背景直接支撑 SKU 推荐" },
  },
};
validChannelTrendReport.product_level_map = [{
  opportunity_id: "T-1",
  base_direction: "防蚊螺旋支架",
  product_forms: [
    { form: "基础单支架", buyer_segment: "低价刚需用户", price_tier: "low", trend_logic: "频道页可见低价工具信号，但同质化风险高", seller_action: "不单独优先，作为价格底线参考" },
    { form: "带盖防风接灰款", buyer_segment: "дача/阳台/露营用户", price_tier: "mid_low", trend_logic: "解决灰烬、风吹灭和桌面污染痛点", seller_action: "优先补 Ozon 搜索和低星评论" },
  ],
}];
validChannelTrendReport.price_ladder = [
  { tier: "low", visible_price_range: "频道页可见低价样本，币种待补 Ozon 卢布页", buyer_mindset: "便宜、随手买、解决眼前问题", competition_risk: "high", seller_fit: "partial_fit" },
  { tier: "mid_low", visible_price_range: "待补 Ozon 卢布价格和组合装竞品", buyer_mindset: "更安全、更耐用、更少灰烬污染", competition_risk: "medium", seller_fit: "fit" },
];
validChannelTrendReport.audience_price_matrix = [
  { audience: "дача/户外用户", scenario: "夏季别墅、阳台、烧烤、露营防蚊", pain_point: "灰烬乱飞、风吹灭、烫伤和桌面污染", price_tier: "mid_low", product_cut: "带盖防风接灰款", evidence_level: "observed", next_validation: ["补 Ozon 搜索页", "补低星评论"] },
  { audience: "办公/学生用户", scenario: "返校、办公桌、宿舍抽屉整理", pain_point: "小物难找、透明件易划伤、尺寸虚标", price_tier: "mid_low", product_cut: "透明可叠放带盖收纳盒", evidence_level: "assumption", next_validation: ["补 Ozon 搜索页", "补尺寸评论"] },
];
validChannelTrendReport.data[0] = {
  ...validChannelTrendReport.data[0],
  opportunity_id: "T-1",
  keyword_or_category: "防蚊螺旋支架 / Подставка для спирали от комаров",
  buyer_scenario: "频道页可见夏季户外、阳台、дача 和露营防蚊场景。",
  price_band: "频道页可见低价样本，币种待补 Ozon 卢布搜索页。",
  demand_signal: "observed",
  competitor_signal: "仅代表中国商品专题页可见关注信号，不代表全站销量。",
  evidence: "当前 Ozon 中国商品专题页可见防蚊螺旋支架商品和评价背书。",
  coverage: "频道页可见样本；不代表全站。",
  limitation: "频道页单页证据只能证明频道页可见曝光，不能证明全平台销量或趋势增长。",
  evidence_ledger: [{
    source_type: "page_dom",
    source_ref: "Ozon 中国商品专题页",
    observed_value: "页面可见防蚊螺旋支架商品和评价背书。",
    used_for: "频道页可见关注信号初筛",
    confidence: "medium",
    limitation: "不代表 Ozon 全站销量或俄罗斯全市场趋势。",
  }],
};
validChannelTrendReport.recommended_opportunities = ["T-1"];
validChannelTrendReport.validated_opportunities = ["T-1"];
validChannelTrendReport.assumption_opportunities = [];
assert.deepEqual(
  validateOzonPlatformTrendReport(validChannelTrendReport, [], {
    url: "https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/",
    title: "Товары из Китая",
    text: "Подставка спиралей от комаров Прозрачная коробка для карандашей",
  }),
  [],
  "channel page trend reports should pass with trend scope, channel structure, product tiers, price ladder and audience matrix"
);

const unsafeChannelTrendReport = structuredClone(validChannelTrendReport);
unsafeChannelTrendReport.summary = "中国商品专题页已经证明 Ozon 全站趋势增长，适合直接作为全平台爆品机会。";
assert.match(
  validateOzonPlatformTrendReport(unsafeChannelTrendReport, [], {
    url: "https://www.ozon.ru/highlight/tovary-iz-kitaya-935133/",
    title: "Товары из Китая",
    text: "Подставка спиралей от комаров",
  }).join("\n"),
  /全站|全平台|大盘/,
  "channel page reports should not extrapolate visible channel samples into global platform trends"
);

const macroObservedWithoutEvidenceReport = structuredClone(validPlatformTrendReport);
macroObservedWithoutEvidenceReport.report_status = "completed";
macroObservedWithoutEvidenceReport.macro_context = {
  status: "observed",
  summary: "俄罗斯宏观背景显示买家更关注价格敏感和平台化购物。",
  affects: ["价格敏感", "平台化"],
  claim_boundary: "宏观背景不能单独证明某个 SKU 或商品机会可卖。",
  evidence_ledger: [{
    source_type: "macro_context",
    source_ref: "macro_context",
    observed_value: "俄罗斯宏观背景显示价格敏感。",
    used_for: "解释价格敏感",
    confidence: "medium",
    limitation: "不能证明单品可卖",
  }],
};
macroObservedWithoutEvidenceReport.external_source_plan.layers.macro_context = {
  sources: ["cbr", "rosstat"],
  status: "used",
  used_for: "解释价格敏感和电商结构",
};
macroObservedWithoutEvidenceReport.data[0].evidence_ledger.push({
  source_type: "macro_context",
  source_ref: "macro_context",
  observed_value: "宏观背景用于说明价格敏感。",
  used_for: "解释价格敏感",
  confidence: "medium",
  limitation: "不能证明单品可卖",
});
const macroAssumptionDowngrade = sanitizeFinalReportBeforeCritic(
  { type: "final", output: macroObservedWithoutEvidenceReport },
  platformTrendToolHistory,
  {}
);
assert.equal(macroAssumptionDowngrade.macroDowngraded, true, "pre-critic sanitizer should downgrade unsupported observed macro context");
assert.equal(macroAssumptionDowngrade.parsed.output.macro_context.status, "assumption", "unsupported macro context without an attempt should become assumption");
assert.equal(macroAssumptionDowngrade.parsed.output.external_source_plan.layers.macro_context.status, "not_used", "macro source plan should not keep used status without evidence");
assert.equal(macroAssumptionDowngrade.parsed.output.data[0].evidence_ledger.at(-1).source_type, "assumption", "unsupported data macro ledger should be downgraded before critic");
assert.deepEqual(
  validateOzonPlatformTrendReport(macroAssumptionDowngrade.parsed.output, platformTrendToolHistory, {}),
  [],
  "pre-critic macro assumption downgrade should prevent repeated critic rejection"
);

const macroBlockedDowngrade = sanitizeFinalReportBeforeCritic(
  { type: "final", output: macroObservedWithoutEvidenceReport },
  [
    ...platformTrendToolHistory,
    { tool: "search_in_browser", arguments: { engine: "cbr", query: "Russia inflation ecommerce" }, result: { ok: false, isCaptcha: true, url: "https://www.cbr.ru/" } },
  ],
  {}
);
assert.equal(macroBlockedDowngrade.parsed.output.macro_context.status, "blocked", "attempted but unusable macro context should become blocked");
assert.equal(macroBlockedDowngrade.parsed.output.report_status, "partial", "macro blocking gap should downgrade completed trend report to partial");
assert.match(JSON.stringify(macroBlockedDowngrade.parsed.output.blocking_gaps), /macro_context_evidence_blocked/, "macro blocked downgrade should add a recoverable blocking gap");
assert.deepEqual(
  validateOzonPlatformTrendReport(macroBlockedDowngrade.parsed.output, [...platformTrendToolHistory, { tool: "search_in_browser", arguments: { engine: "cbr", query: "Russia inflation ecommerce" }, result: { ok: false, isCaptcha: true, url: "https://www.cbr.ru/" } }], {}),
  [],
  "pre-critic macro blocked downgrade should satisfy external source and ledger validators"
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

const parentProxyOverScoreReport = structuredClone(validPlatformTrendReport);
parentProxyOverScoreReport.query_funnel.scored_queries[0].scope_relation = "parent_proxy";
parentProxyOverScoreReport.query_funnel.scored_queries[0].future_signal = 2;
const parentProxyErrors = validateOzonPlatformTrendReport(parentProxyOverScoreReport, platformTrendToolHistory, {});
assert.match(parentProxyErrors.join("\n"), /parent_proxy[\s\S]*future_signal 最高只能为 1/);

const fakeUsedSourceReport = structuredClone(validPlatformTrendReport);
fakeUsedSourceReport.external_source_plan.layers.search_demand.sources = ["yandex_wordstat", "google_trends"];
fakeUsedSourceReport.external_source_plan.layers.search_demand.status = "used";
const fakeUsedSourceErrors = validateOzonPlatformTrendReport(fakeUsedSourceReport, platformTrendToolHistory, {});
assert.match(
  fakeUsedSourceErrors.join("\n"),
  /external_source_plan 声明 Google Trends RU 为已使用[\s\S]*没有对应的可用页面\/搜索证据/,
  "platform trend validator should reject external_source_plan used claims without captured evidence"
);

const blockedWithoutAttemptReport = structuredClone(validPlatformTrendReport);
blockedWithoutAttemptReport.external_source_plan.layers.search_demand.sources = ["google_trends"];
blockedWithoutAttemptReport.external_source_plan.layers.search_demand.status = "blocked";
const blockedWithoutAttemptErrors = validateOzonPlatformTrendReport(blockedWithoutAttemptReport, platformTrendToolHistory, {});
assert.match(
  blockedWithoutAttemptErrors.join("\n"),
  /Google Trends RU 被阻断[\s\S]*没有对应访问尝试[\s\S]*blocking_gaps/,
  "blocked external sources should require either a captured attempt or a structured blocking gap"
);

const undeclaredEvidenceErrors = validateOzonPlatformTrendReport(
  validPlatformTrendReport,
  [...platformTrendToolHistory, { tool: "search_in_browser", arguments: { engine: "avito", query: "талисман" }, result: { ok: true, url: "https://www.avito.ru/rossiya?q=талисман" } }],
  {}
);
assert.match(
  undeclaredEvidenceErrors.join("\n"),
  /已采集 Avito 证据[\s\S]*external_source_plan 未声明/,
  "captured external evidence should be declared in external_source_plan for report reconciliation"
);

const qualitativeOnlyReport = structuredClone(validPlatformTrendReport);
qualitativeOnlyReport.external_source_plan.layers.social_content = { sources: ["otzovik"], status: "used", used_for: "评论口碑与买家语言" };
qualitativeOnlyReport.external_source_plan.layers.adaptive_qualitative = { sources: ["ru_forum"], status: "used", used_for: "俄语论坛定性讨论" };
qualitativeOnlyReport.adaptive_source_discovery = {
  enabled: true,
  trigger_reason: "祈福护身类产品需要理解俄罗斯买家的文化接受度和评论语言。",
  candidate_sources: [{
    source_id: "otzovik",
    source_name: "Otzovik",
    source_type: "review_site",
    query: "талисман отзывы",
    intended_use: "买家语言和评论异议",
    status: "used",
    evidence_ref: "Otzovik 搜索：талисман отзывы",
  }],
  selection_boundary: "发现来源不等于趋势已验证，必须进入页面取证和 evidence_ledger；定性资料不能单独证明 SKU 可卖。",
};
qualitativeOnlyReport.qualitative_market_context = {
  status: "observed",
  buyer_language: ["买家用 оберег/талисман 描述护身和礼品场景"],
  usage_scenarios: ["个人护身", "礼品祝福"],
  content_themes: ["幸运", "东方文化"],
  cultural_fit: { fit: "medium", reason: "需要避免宗教承诺和夸大功效。", risks: ["迷信化表达"] },
  objection_patterns: ["材质廉价", "功效承诺过强"],
  evidence_ledger: [{
    source_type: "social_signal",
    source_ref: "Otzovik 搜索：талисман отзывы",
    observed_value: "评论语言用于识别礼品和护身语境",
    used_for: "定性市场语言",
    confidence: "medium",
    limitation: "不能代表 Ozon 销量",
  }],
  claim_boundary: "定性市场资料只能解释买家语言、使用场景、文化接受度和内容表达，不能单独证明某个 SKU 或商品机会可卖。",
};
qualitativeOnlyReport.data[0].evidence_ledger = [{
  source_type: "social_signal",
  source_ref: "Otzovik 搜索：талисман отзывы",
  observed_value: "评论语言显示礼品/护身语境",
  used_for: "定性市场语言",
  confidence: "medium",
  limitation: "不能证明 Ozon 需求",
}];
const qualitativeOnlyErrors = validateOzonPlatformTrendReport(
  qualitativeOnlyReport,
  [
    { tool: "search_in_browser", arguments: { engine: "otzovik", query: "талисман отзывы" }, result: { ok: true, url: "https://otzovik.com/search/?text=талисман" } },
    { tool: "search_in_browser", arguments: { engine: "ru_forum", query: "талисман форум" }, result: { ok: true, url: "https://yandex.com/search/?text=талисман форум отзывы" } },
  ],
  {}
);
assert.match(
  qualitativeOnlyErrors.join("\n"),
  /不能只靠定性市场资料[\s\S]*必须补 Ozon、搜索需求或跨平台交易证据/,
  "qualitative market evidence should not be enough to mark an opportunity demand_signal=observed"
);

console.log("research-scope-smoke: ok");
