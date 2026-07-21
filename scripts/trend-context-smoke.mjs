import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const trendSkill = read("skills/ozon_platform_trends.skill.md");
const agentLoop = read("modules/agentLoop.js");
const background = read("background.js");

for (const term of [
  "trend_context_type",
  "store_trend_fit",
  "platform_trend",
  "category_opportunity",
  "product_opportunity",
  "competitor_learning",
  "sourcing_validation",
  "platform_signal",
  "store_fit",
  "scope_confidence=low",
]) {
  assert.match(trendSkill, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `platform trends skill must mention ${term}`);
}

assert.match(agentLoop, /trend_context_type/, "agent loop must pass and validate trend_context_type");
assert.match(agentLoop, /platform_signal/, "agent loop must require platform_signal");
assert.match(agentLoop, /store_fit/, "agent loop must require store_fit");
assert.match(agentLoop, /recommended_opportunities/, "agent loop must require sellable trend recommendations");
assert.match(agentLoop, /不是通过不卖原则的可卖候选/, "agent loop must keep rejected trend directions out of report data");
assert.match(agentLoop, /needs_user_clarification[\s\S]*report_status[\s\S]*completed/, "agent loop must block completed reports for weak research scope");
assert.match(background, /buildResearchScope/, "background must build research_scope before running skills");
assert.match(background, /pageContext\.research_scope/, "background must inject research_scope into page context");

console.log("trend-context-smoke: ok");
