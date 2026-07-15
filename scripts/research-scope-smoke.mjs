import assert from "node:assert/strict";
import { buildResearchScope } from "../modules/researchScope.js";
import { validateWorkflowReadyOutput } from "../modules/agentLoop.js";

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
assert.equal(homeScope.needs_user_clarification, true);
assert.equal(homeScope.scope_confidence, "low");
assert.match(homeScope.forbidden_conclusions.join(" "), /completed|趋势结论|缺少关键词/);

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

console.log("research-scope-smoke: ok");
