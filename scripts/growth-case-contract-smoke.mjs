import assert from "node:assert/strict";
import { buildGrowthCaseFromResult } from "../modules/growthCaseStore.js";

const output = {
  report_status: "partial",
  research_scope: {
    entry_page_type: "ozon_home",
    analysis_scope: "platform_trend",
    scope_confidence: "low",
    needs_user_clarification: true,
  },
  blocking_gaps: [{ gap_id: "G-1", evidence_missing: "缺少关键词", recovery_action: "确认研究范围" }],
  follow_up_tasks: [{
    task_id: "TASK-1",
    task_type: "trend_validation",
    priority: "P0",
    target: "确认类目关键词",
    reason: "Ozon 首页上下文过弱",
    required_evidence: ["类目", "关键词"],
    expected_output: "形成平台趋势研究范围",
    requires_manual_confirmation: true,
  }],
  workflow_nodes: [{
    node_id: "NODE-1",
    title: "研究范围确认",
    status: "manual_confirm",
    depends_on: [],
    next_action: "确认关键词",
  }],
  data: [{
    title: "待确认机会",
    evidence_ledger: [{
      source_type: "assumption",
      source_ref: "Ozon 首页",
      observed_value: "缺少明确关键词",
      used_for: "阻断趋势结论",
      confidence: "low",
      limitation: "弱上下文",
    }],
  }],
};

const growthCase = buildGrowthCaseFromResult({
  savedEntry: {
    id: 101,
    skillId: "skills/ozon_platform_trends.skill.md",
    skillName: "平台趋势",
    growthActionId: "explore_platform_trends",
    growthRunId: "run-1",
    createdAt: "2026-07-14T00:00:00.000Z",
  },
  output,
  researchScope: output.research_scope,
  pageContext: {},
});

assert.equal(growthCase.type, "platform_trends");
assert.equal(growthCase.status, "manual_confirm");
assert.equal(growthCase.tasks.length, 1);
assert.equal(growthCase.nodes[0].status, "manual_confirm");
assert.equal(growthCase.evidence_quality.grade, "D");
assert.equal(growthCase.reportIds[0], "101");

console.log("growth-case-contract-smoke: ok");
