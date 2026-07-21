import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const businessSkills = [
  "skills/ozon_compliance_auditor.skill.md",
  "skills/ozon_global_shop_optimizer.skill.md",
  "skills/ozon_listing_generator.skill.md",
  "skills/ozon_operations_tracker.skill.md",
  "skills/ozon_platform_trends.skill.md",
  "skills/ozon_product_opportunity_explorer.skill.md",
  "skills/ozon_review_analyzer.skill.md",
  "skills/ozon_sourcing_finder.skill.md",
];

const base = read("skills/base_report_auditor.skill.md");

for (const field of ["report_status", "research_scope", "blocking_gaps", "follow_up_tasks", "workflow_nodes"]) {
  assert.match(base, new RegExp(field), `base report auditor must require ${field}`);
}

for (const skillPath of businessSkills) {
  const skill = read(skillPath);
  assert.match(skill, /evidence_ledger/, `${skillPath} must require structured evidence ledger`);
  assert.match(skill, /report_status/, `${skillPath} must expose report_status for industrial delivery`);
  assert.match(skill, /blocking_gaps/, `${skillPath} must expose blocking_gaps for evidence recovery`);
  assert.match(skill, /follow_up_tasks/, `${skillPath} must expose follow_up_tasks for workflow continuation`);
  assert.match(skill, /workflow_nodes/, `${skillPath} must expose workflow_nodes for canvas rendering`);
  assert.match(skill, /manual_confirm|requires_manual_confirmation|人工确认|手工确认/, `${skillPath} must preserve manual confirmation steps`);
}

const sourcing = read("skills/ozon_sourcing_finder.skill.md");
assert.match(sourcing, /至少 2 个可比供应商候选/, "sourcing must keep the two-supplier comparison requirement");
assert.match(sourcing, /不足以形成供应商比价/, "sourcing must require shortage explanation when fewer than two suppliers pass");
assert.match(sourcing, /结果页阶段锁定/, "sourcing must prevent endless search loops after product cards are available");

const shop = read("skills/ozon_global_shop_optimizer.skill.md");
assert.match(shop, /店铺体检不得只凭截图下结论/, "store diagnosis must keep screenshot-only guardrail");
assert.match(shop, /定位重构是店铺体检下的 P0 子节点/, "store diagnosis must keep positioning reconstruction inside the store diagnosis case");
assert.match(shop, /2-3 个同类高排名店铺|头部竞品页面/, "store diagnosis must require competitor store learning");

const trends = read("skills/ozon_platform_trends.skill.md");
assert.match(trends, /来源 Ozon 页由运行时保护[\s\S]*本轮任务新开的 Ozon 搜索页[\s\S]*必须关闭/, "platform trends must protect the source tab and close workflow-created evidence tabs");
assert.match(trends, /不是无限搜索循环/, "platform trends must keep anti-loop stage completion rules");
assert.match(trends, /recommended_opportunities[\s\S]*rejected_directions[\s\S]*recommendation_status/, "platform trends must separate sellable recommendations from rejected directions");

const operations = read("skills/ozon_operations_tracker.skill.md");
assert.match(operations, /baseline_window/, "operations tracker must require baseline windows");
assert.match(operations, /comparison_window/, "operations tracker must require comparison windows");
assert.match(operations, /没有基线窗口|没有优化前快照/, "operations tracker must block attribution without baseline evidence");

console.log("skill-contract-smoke: ok");
