import assert from "node:assert/strict";
import { buildResearchScope } from "../modules/researchScope.js";

const storeScope = buildResearchScope({
  pageContext: { url: "https://www.ozon.ru/seller/test-shop-123/", title: "Test Shop" },
  userInstruction: "做店铺体检",
  growthActionId: "diagnose_store_growth",
  activeShopId: "shop-1",
});
assert.equal(storeScope.entry_page_type, "owned_store");
assert.equal(storeScope.analysis_scope, "store_trend_fit");
assert.equal(storeScope.source_page_role, "self_store");
assert.equal(storeScope.needs_user_clarification, false);

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

console.log("research-scope-smoke: ok");
