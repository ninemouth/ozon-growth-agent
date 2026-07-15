import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildEvidenceBundle,
  collectPageEvidenceFromToolHistory,
  collectScreenshotRefsFromToolHistory,
} from "../modules/evidenceBundle.js";

const toolHistory = [
  {
    tool: "open_url",
    arguments: { url: "https://www.ozon.ru/seller/example" },
    result: {
      ok: true,
      tabId: 101,
      url: "https://www.ozon.ru/seller/example",
      evidenceOk: true,
      loadState: "stable_dom",
      pageData: {
        url: "https://www.ozon.ru/seller/example",
        title: "Example seller",
        visibleText: "A".repeat(1500),
        productCards: [
          { title: "Card 1", price: "100 ₽", href: "https://www.ozon.ru/product/1", imageSrc: "https://img/1.jpg" },
        ],
        pageEvidence: { visibleTextLength: 1500, productCardCount: 1 },
      },
    },
  },
  {
    tool: "collect_ozon_shop_pages",
    arguments: { urls: ["https://www.ozon.ru/seller/example"] },
    result: {
      ok: true,
      screenshotRefs: ["artifact://ozon/summary"],
      pages: [
        {
          ok: true,
          url: "https://www.ozon.ru/seller/example",
          title: "Example seller",
          screenshotRef: "artifact://ozon/page-1",
          productCardsVisible: 4,
          visibleTextSnippet: "seller page",
          productCards: [{ title: "Card 2", price: "120 ₽", href: "https://www.ozon.ru/product/2" }],
        },
      ],
      shops: [
        {
          url: "https://www.ozon.ru/seller/competitor",
          title: "Competitor",
          screenshotRefs: ["artifact://ozon/competitor-1"],
          pages: [{ ok: true, url: "https://www.ozon.ru/seller/competitor", screenshotRef: "artifact://ozon/competitor-page" }],
        },
      ],
    },
  },
  {
    tool: "collect_reviews",
    arguments: { ratingFilter: "1", maxPages: 2 },
    result: {
      ok: true,
      reviewCountCollected: 2,
      reviews: [
        { rating: 1, text: "bad packaging", imageUrls: ["https://img/review.jpg"] },
        { rating: 2, text: "slow delivery" },
      ],
      blockingGaps: [],
    },
  },
];

const screenshotRefs = collectScreenshotRefsFromToolHistory(toolHistory);
assert.deepEqual(
  screenshotRefs.sort(),
  [
    "artifact://ozon/competitor-1",
    "artifact://ozon/competitor-page",
    "artifact://ozon/page-1",
    "artifact://ozon/summary",
  ].sort(),
  "evidence bundle should recursively collect screenshot artifact refs",
);

const pageEvidence = collectPageEvidenceFromToolHistory(toolHistory, {
  url: "https://www.ozon.ru/seller/source",
  title: "Source seller",
  productCards: [{ title: "Source card" }],
});
assert.ok(pageEvidence.some((item) => item.tool === "initial_page_context"), "initial page context should be included");
assert.ok(pageEvidence.some((item) => item.tool === "open_url" && item.pageData.productCardCount === 1), "tool pageData should be compacted");
assert.ok(pageEvidence.some((item) => item.tool === "collect_ozon_shop_pages" && item.url.includes("/seller/example")), "crawled pages should be included");

const bundle = buildEvidenceBundle({
  savedEntry: {
    id: 123,
    skillId: "ozon_global_shop_optimizer",
    skillName: "Ozon 店铺体检",
    pageUrl: "https://www.ozon.ru/seller/source",
    pageTitle: "Source seller",
    shopId: "source",
  },
  output: {
    report_status: "completed",
    case_title: "店铺体检",
    data: [{ title: "定位" }],
    follow_up_tasks: [{ task_id: "TASK-1" }],
    blocking_gaps: [],
  },
  pageContext: { url: "https://www.ozon.ru/seller/source", title: "Source seller" },
  researchScope: { active_shop_id: "source", scope_confidence: "high" },
  evidenceQuality: { grade: "B", summary: "证据等级 B" },
  toolHistory,
  workflowId: "workflow:source",
});

assert.equal(bundle.schema_version, "1.0");
assert.equal(bundle.workflowId, "workflow:source");
assert.equal(bundle.reportId, 123);
assert.equal(bundle.page.shopId, "source");
assert.equal(bundle.evidence_quality.grade, "B");
assert.equal(bundle.reportSummary.followUpTaskCount, 1);
assert.ok(bundle.screenshotRefs.includes("artifact://ozon/page-1"));
assert.ok(bundle.toolTimeline.some((entry) => entry.tool === "collect_reviews" && entry.result.reviewCountCollected === 2));
assert.ok(JSON.stringify(bundle).length < 30000, "bundle should stay compact enough for chrome.storage.local report records");

const background = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const agentLoop = readFileSync(new URL("../modules/agentLoop.js", import.meta.url), "utf8");
assert.match(background, /buildEvidenceBundle/, "successful runs should persist evidence_bundle");
assert.match(background, /evidence_bundle/, "savedResults entries should include evidence_bundle");
assert.match(background, /EXPORT_EVIDENCE_BUNDLE/, "background should expose a single-report evidence bundle export endpoint");
assert.match(background, /getArtifactDataUrl/, "evidence bundle export should check artifact availability");
assert.match(background, /artifact_manifest/, "exported evidence bundle should include artifact availability manifest");
assert.match(agentLoop, /toolHistory,\n\s*};/, "agent loop success returns should expose toolHistory to background save path");

console.log("Evidence bundle smoke passed.");
