import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyGoogleTrendsEvidence,
  collectGoogleTrendsAttempts,
  getTrendQueryGuardError,
  getTrendQueryRefinementState,
  hasUsableGoogleTrendsAttempt,
  normalizeTrendQuery,
} from "../modules/trendQueryPlanner.js";

const invalidResult = (query) => ({
  ok: false,
  evidenceOk: false,
  queryUsed: query,
  screenshotCaptured: true,
  screenshotRef: `artifact://trend/${encodeURIComponent(query)}`,
  trendsEvidenceState: {
    readiness: "loaded_but_not_enough_data",
    hasExplicitNoData: true,
  },
  pageData: {
    title: "Google Trends",
    visibleText: "Google Trends Explore Hmm, your search doesn't have enough data to show here",
  },
});

const validResult = (query) => ({
  ok: true,
  evidenceOk: true,
  queryUsed: query,
  screenshotCaptured: true,
  trendsEvidenceState: { readiness: "core_modules_visible" },
  pageData: {
    title: "Google Trends",
    visibleText: "Interest over time Related queries Related topics",
  },
});

const entry = (query, result) => ({
  tool: "search_in_browser",
  arguments: { engine: "google_trends", query },
  result,
});

assert.equal(normalizeTrendQuery("  «Китайские   талисманы»  "), "китайские талисманы");
assert.deepEqual(classifyGoogleTrendsEvidence(invalidResult("китайские талисманы")), {
  insufficient: true,
  loaded: true,
  reason: "loaded_but_not_enough_data",
});

const firstHistory = [entry("китайские талисманы фен шуй", invalidResult("китайские талисманы фен шуй"))];
const firstRefinement = getTrendQueryRefinementState("skills/ozon_platform_trends.skill.md", firstHistory);
assert.equal(firstRefinement.required, true);
assert.equal(firstRefinement.nextAttempt, 2);
assert.match(firstRefinement.message, /退宽一个语义层级/);

const duplicateGuard = getTrendQueryGuardError({
  skillId: "skills/ozon_platform_trends.skill.md",
  toolName: "search_in_browser",
  toolArgs: { engine: "google_trends", query: "КИТАЙСКИЕ ТАЛИСМАНЫ ФЕН ШУЙ" },
  toolHistory: firstHistory,
});
assert.ok(duplicateGuard);
assert.match(duplicateGuard.error, /已经查询过/);

const secondHistory = [
  ...firstHistory,
  entry("талисман", invalidResult("талисман")),
];
const secondRefinement = getTrendQueryRefinementState("skills/ozon_platform_trends.skill.md", secondHistory);
assert.equal(secondRefinement.required, true);
assert.equal(secondRefinement.nextAttempt, 3);
assert.match(secondRefinement.message, /同义词族/);

const exhaustedHistory = [
  ...secondHistory,
  entry("оберег", invalidResult("оберег")),
];
const exhausted = getTrendQueryRefinementState("skills/ozon_platform_trends.skill.md", exhaustedHistory);
assert.equal(exhausted.required, false);
assert.equal(exhausted.exhausted, true);
assert.equal(collectGoogleTrendsAttempts(exhaustedHistory).length, 3);

const recoveredHistory = [
  ...firstHistory,
  entry("амулет", validResult("амулет")),
];
assert.equal(hasUsableGoogleTrendsAttempt(recoveredHistory), true);
assert.deepEqual(getTrendQueryRefinementState("skills/ozon_platform_trends.skill.md", recoveredHistory).required, false);

const toolRegistrySource = fs.readFileSync(new URL("../modules/toolRegistry.js", import.meta.url), "utf8");
const agentLoopSource = fs.readFileSync(new URL("../modules/agentLoop.js", import.meta.url), "utf8");
const trendSkillSource = fs.readFileSync(new URL("../skills/ozon_platform_trends.skill.md", import.meta.url), "utf8");

assert.match(toolRegistrySource, /hasCyrillic[\s\S]*shouldLocalizeQuery[\s\S]*if \(isForeignPlatform && shouldLocalizeQuery\)/, "existing Russian queries should bypass silent localization");
assert.match(toolRegistrySource, /hasExplicitNoData[\s\S]*loaded_but_not_enough_data/, "loaded Google Trends pages with explicit no-data warnings should be classified separately");
assert.match(agentLoopSource, /trend_query_refinement_required[\s\S]*趋势查询执行步骤未完成[\s\S]*不要输出 final/, "agent loop should force query refinement before final validation");
assert.match(agentLoopSource, /trend_evidence_downgrade_required[\s\S]*不进入 Critic 打回/, "agent loop should downgrade exhausted trend evidence before Critic");
assert.match(trendSkillSource, /query_funnel[\s\S]*退宽一个语义层级[\s\S]*第 3 次仍不足/, "trend skill should define a bounded spread-focus-refine funnel");

console.log("trend-query-planner-smoke: ok");
