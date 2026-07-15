/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
import { summarizeEvidenceQuality } from './evidenceQuality.js';

function nowIso() {
  return new Date().toISOString();
}

function caseTypeFromSkill(skillId = "", growthActionId = "", output = {}) {
  const text = `${skillId} ${growthActionId} ${output.trend_context_type || ""}`.toLowerCase();
  if (/platform_trends|explore_platform_trends|platform_trend|category_opportunity/.test(text)) return "platform_trends";
  if (/global_shop_optimizer|diagnose_store_growth|store_trend_fit/.test(text)) return "store_health";
  if (/sourcing|supplier|filter_supplier_sources/.test(text)) return "supplier_sourcing";
  if (/listing|rewrite_listing/.test(text)) return "listing_conversion";
  if (/review_analyzer|analyze_review/.test(text)) return "listing_conversion";
  if (/operations_tracker|experiment|review_experiment|detect_fulfillment/.test(text)) return "experiment_review";
  if (/compliance/.test(text)) return "compliance_review";
  if (/opportunity|find_expansion/.test(text)) return "opportunity_profit";
  return "store_health";
}

function statusFromOutput(output = {}) {
  const status = String(output.report_status || "").toLowerCase();
  if (status === "completed") return "completed";
  if (status === "blocked") return "blocked";
  if (status === "assumption_only") return "manual_confirm";
  if (status === "partial") return "manual_confirm";
  return "completed";
}

function normalizeNodeStatus(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (["validated", "blocked", "manual_confirm", "queued", "done"].includes(normalized)) return normalized;
  return "queued";
}

function nodesFromOutput(output = {}) {
  return (Array.isArray(output.workflow_nodes) ? output.workflow_nodes : []).map((node, index) => ({
    node_id: String(node.node_id || `NODE-${index + 1}`),
    title: String(node.title || `节点 ${index + 1}`),
    status: normalizeNodeStatus(node.status),
    depends_on: Array.isArray(node.depends_on) ? node.depends_on : [],
    next_action: String(node.next_action || ""),
  }));
}

function tasksFromOutput(output = {}) {
  return (Array.isArray(output.follow_up_tasks) ? output.follow_up_tasks : []).map((task, index) => ({
    task_id: String(task.task_id || `TASK-${index + 1}`),
    task_type: String(task.task_type || "manual_follow_up"),
    priority: String(task.priority || "P1"),
    target: String(task.target || ""),
    reason: String(task.reason || ""),
    required_evidence: Array.isArray(task.required_evidence) ? task.required_evidence : [],
    expected_output: String(task.expected_output || ""),
    requires_manual_confirmation: Boolean(task.requires_manual_confirmation),
    status: task.requires_manual_confirmation ? "manual_confirm" : "queued",
  }));
}

export function buildGrowthCaseFromResult({
  savedEntry = {},
  output = {},
  researchScope = {},
  pageContext = {},
} = {}) {
  const now = nowIso();
  const caseType = caseTypeFromSkill(savedEntry.skillId, savedEntry.growthActionId, output);
  const caseId = savedEntry.growthCaseId || `${caseType}_${savedEntry.shopId || researchScope.active_shop_id || "default"}_${savedEntry.growthActionId || savedEntry.id || Date.now()}`;
  const evidenceQuality = summarizeEvidenceQuality({ output, pageContext, researchScope });
  return {
    id: caseId,
    type: caseType,
    title: output.case_title || output.title || savedEntry.skillName || "Ozon 增长案件",
    shopId: savedEntry.shopId || researchScope.active_shop_id || "",
    status: statusFromOutput(output),
    actionId: savedEntry.growthActionId || "",
    research_scope: researchScope,
    evidence_quality: evidenceQuality,
    nodes: nodesFromOutput(output),
    tasks: tasksFromOutput(output),
    blocking_gaps: Array.isArray(output.blocking_gaps) ? output.blocking_gaps : [],
    reportIds: savedEntry.id ? [String(savedEntry.id)] : [],
    runs: savedEntry.growthRunId ? [{
      id: savedEntry.growthRunId,
      actionId: savedEntry.growthActionId || "",
      title: savedEntry.skillName || "AI 运行",
      status: "completed",
      savedResultId: savedEntry.id || "",
      createdAt: savedEntry.createdAt || now,
      updatedAt: now,
    }] : [],
    updatedAt: now,
    createdAt: savedEntry.createdAt || now,
  };
}

export async function upsertGrowthCaseFromResult(args = {}) {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
  const nextCase = buildGrowthCaseFromResult(args);
  const stored = await new Promise((resolve) => chrome.storage.local.get(["growthCases"], resolve));
  const cases = stored.growthCases || [];
  const existing = cases.find((item) => item.id === nextCase.id);
  const merged = existing ? {
    ...existing,
    ...nextCase,
    reportIds: Array.from(new Set([...(existing.reportIds || []), ...(nextCase.reportIds || [])])),
    runs: [...nextCase.runs, ...(existing.runs || []).filter((run) => !nextCase.runs.some((item) => item.id === run.id))].slice(0, 20),
    nodes: nextCase.nodes.length ? nextCase.nodes : existing.nodes || [],
    tasks: nextCase.tasks.length ? nextCase.tasks : existing.tasks || [],
    createdAt: existing.createdAt || nextCase.createdAt,
  } : nextCase;
  const nextCases = [merged, ...cases.filter((item) => item.id !== merged.id)].slice(0, 120);
  await new Promise((resolve) => chrome.storage.local.set({ growthCases: nextCases }, resolve));
  return merged;
}
