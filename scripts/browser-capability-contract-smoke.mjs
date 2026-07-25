import assert from "node:assert/strict";
import fs from "node:fs";
import { BROWSER_AUTOMATION_CAPABILITIES } from "../modules/browserAutomationCapabilities.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const toolRegistry = read("modules/toolRegistry.js");
const agentLoop = read("modules/agentLoop.js");
const content = read("content.js");
const sourcing = read("skills/ozon_sourcing_finder.skill.md");
const shop = read("skills/ozon_global_shop_optimizer.skill.md");
const trends = read("skills/ozon_platform_trends.skill.md");
const reviews = read("skills/ozon_review_analyzer.skill.md");

const requiredCapabilityIds = [
  "address_navigation",
  "keyboard_input_search",
  "filter_sort_pagination",
  "dom_collection_cleaning",
  "multimodal_screenshot",
  "review_collection",
  "tab_lifecycle",
  "seller_api_and_archive",
];

const ids = BROWSER_AUTOMATION_CAPABILITIES.map((item) => item.id);
for (const id of requiredCapabilityIds) {
  assert.ok(ids.includes(id), `browser capability manifest must include ${id}`);
}

for (const item of BROWSER_AUTOMATION_CAPABILITIES) {
  assert.ok(item.label, `${item.id} should have a user-facing label`);
  assert.ok(Array.isArray(item.tools) && item.tools.length > 0, `${item.id} should map to runtime tools`);
  assert.ok(Array.isArray(item.guarantees) && item.guarantees.length > 0, `${item.id} should document guarantees`);
  assert.ok(Array.isArray(item.limitations) && item.limitations.length > 0, `${item.id} should document limitations`);
}

assert.match(toolRegistry, /get_browser_capabilities/, "tool registry must expose browser capability contract");
assert.match(toolRegistry, /summarizeBrowserAutomationCapabilities/, "tool registry should return the shared capability manifest");
assert.match(toolRegistry, /apply_page_filter: async[\s\S]*filterEvidence/, "tool registry must expose semantic filter/sort with evidence diff");
assert.match(toolRegistry, /go_next_page: async[\s\S]*paginationEvidence/, "tool registry must expose semantic pagination with evidence diff");
assert.match(toolRegistry, /buildInteractionEvidence[\s\S]*productCardsChanged/, "semantic page interactions should compare before/after product evidence");
assert.match(toolRegistry, /productFingerprint[\s\S]*productCardContentChanged/, "page signatures should detect changed product content even when card counts stay stable");
assert.match(toolRegistry, /collect_reviews: async[\s\S]*blockingGaps/, "tool registry must expose review collection with blocking gaps");
assert.match(toolRegistry, /collect_reviews: async[\s\S]*Сначала негативные[\s\S]*差评/, "review collection should try localized low-rating filter labels");
assert.match(agentLoop, /formatBrowserAutomationCapabilityPrompt/, "agent loop must inject browser capability contract into prompts");
assert.match(agentLoop, /页面动态加载时必须相信工具返回的 loadState、evidenceOk、pageEvidence/, "agent prompt should force evidence-aware browser operation");
assert.match(agentLoop, /apply_page_filter[\s\S]*go_next_page/, "agent loop should classify semantic filter and pagination tools");

assert.match(toolRegistry, /createBrowserTab\(\{ url: safeEncodeURI\(url\), active: false[\s\S]*workflowId/, "open_url should create workflow-owned tabs");
assert.match(toolRegistry, /closeOwnedTab\(workflowId, parseInt\(tabId\)\)/, "close_tab should use workflow-owned tab manager");
assert.match(toolRegistry, /waitForPageCaptureReady[\s\S]*minStableReads/, "runtime should wait for stable page evidence before collection");
const inputSearchSource = toolRegistry.slice(
  toolRegistry.indexOf("input_text_and_search: async"),
  toolRegistry.indexOf("prepare_clean_product_image: async")
);
assert.match(inputSearchSource, /waitForPageCaptureReady[\s\S]*站内搜索结果页/, "input_text_and_search should use shared page readiness");
assert.doesNotMatch(inputSearchSource, /setInterval\(|chrome\.tabs\.get/, "input_text_and_search must not use local polling loops");
const imageSearchSource = toolRegistry.slice(
  toolRegistry.indexOf("image_search_in_browser: async"),
  toolRegistry.indexOf("click_by_coordinate: async")
);
assert.match(imageSearchSource, /waitForPageCaptureReady[\s\S]*图片搜索结果页/, "image_search_in_browser should use shared page readiness");
assert.doesNotMatch(imageSearchSource, /setInterval\(|chrome\.tabs\.get/, "image_search_in_browser must not use local polling loops");
assert.match(toolRegistry, /executeGenericDomSnapshot[\s\S]*allFrames/, "DOM collection should include multi-frame fallback");
assert.match(toolRegistry, /captureFullPageScreenshot[\s\S]*captureVisibleTab/, "screenshot collection should have full-page and viewport fallback");

assert.match(content, /INPUT_TEXT_AND_SEARCH[\s\S]*KeyboardEvent[\s\S]*pressedEnter/, "content script must support keyboard-like input and Enter fallback");
assert.match(content, /CLICK_BY_COORDINATE[\s\S]*Proactively blocked click_by_coordinate on file upload\/camera elements/, "coordinate clicking must block unsafe file upload targets");
assert.match(content, /READ_CURRENT_PAGE[\s\S]*readCurrentPage/, "content script must expose DOM collection");
assert.match(content, /APPLY_PAGE_FILTER[\s\S]*findClickableByText/, "content script must support semantic filter clicks");
assert.match(content, /getSiteFilterCandidateTexts[\s\S]*ozon[\s\S]*1688[\s\S]*taobao/, "semantic filter clicks should use site-aware candidate dictionaries");
assert.match(content, /review_rating[\s\S]*Сначала негативные[\s\S]*有图/, "site-aware filter dictionary should include review-specific low-rating and image-review candidates");
assert.match(content, /candidateTexts/, "filter click results should expose tried candidate texts for debugging");
assert.match(content, /GO_NEXT_PAGE[\s\S]*findNextPageElement/, "content script must support semantic next-page clicks");
assert.match(content, /EXTRACT_REVIEWS[\s\S]*extractVisibleReviews/, "content script must support visible review extraction");

assert.match(sourcing, /input_text_and_search/, "sourcing skill must know when text search is allowed");
assert.match(sourcing, /apply_page_filter[\s\S]*go_next_page/, "sourcing skill should prefer semantic filter and pagination tools");
assert.match(sourcing, /click_by_coordinate/, "sourcing skill must allow necessary filter/sort coordinate actions");
assert.match(sourcing, /open_new_tab[\s\S]*close_tab/, "sourcing skill must require detail tab lifecycle control");
assert.match(shop, /DOM 文本审计双轨制|双轨分析模式/, "shop diagnosis must preserve DOM plus visual dual-track audit");
assert.match(trends, /来源 Ozon 页由运行时保护[\s\S]*本轮任务新开的 Ozon 搜索页[\s\S]*必须关闭/, "trend skill must protect only the source Ozon tab and close task-created evidence tabs");
assert.match(reviews, /collect_reviews/, "review analyzer should use the dedicated review collection tool");
assert.match(reviews, /review_dom/, "review analyzer should support review_dom evidence");

console.log("browser-capability-contract-smoke: ok");
