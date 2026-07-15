import assert from "node:assert/strict";
import {
  __testInternals,
  appendTaskLog,
  listTaskLogs,
  pruneTaskLogs,
} from "../modules/workflowRuntime.js";

const workflowId = `ozon-task-log-smoke-${Date.now()}`;
const otherWorkflowId = `${workflowId}-other`;

__testInternals.memoryTaskLogs.splice(0);

const normal = await appendTaskLog({
  workflowId,
  category: "skill",
  severity: "info",
  event: "workflow_started",
  message: "开始执行店铺体检 workflow",
  details: {
    skillPath: "skills/ozon_global_shop_optimizer.skill.md",
    nested: { step: "read_platform_positioning" },
  },
  source: "smoke",
});

const sensitive = await appendTaskLog({
  workflowId,
  category: "browser",
  severity: "warning",
  event: "tool_warning",
  message: "浏览器工具返回可恢复风险",
  details: {
    apiKey: "should-not-leak",
    authorization: "Bearer should-not-leak",
    cookie: "session=should-not-leak",
    nested: {
      token: "should-not-leak",
      safe: "visible",
    },
    longText: "x".repeat(2500),
  },
  source: "smoke",
});

await appendTaskLog({
  workflowId: otherWorkflowId,
  category: "maintenance",
  severity: "error",
  event: "monitor_failed",
  message: "另一个 workflow 的失败日志",
  details: { error: "boom" },
  source: "smoke",
});

assert.ok(normal.logId.startsWith("tasklog:"), "task log id should be generated");
assert.equal(sensitive.details.apiKey, "[redacted]", "apiKey must be redacted");
assert.equal(sensitive.details.authorization, "[redacted]", "authorization must be redacted");
assert.equal(sensitive.details.cookie, "[redacted]", "cookie must be redacted");
assert.equal(sensitive.details.nested.token, "[redacted]", "nested token must be redacted");
assert.equal(sensitive.details.nested.safe, "visible", "safe nested fields should remain readable");
assert.equal(sensitive.details.longText.length, 2000, "long log strings should be truncated");

const workflowLogs = await listTaskLogs({ workflowId, limit: 20 });
assert.equal(workflowLogs.length, 2, "workflow filter should return only matching logs");
assert.ok(workflowLogs.every((entry) => entry.workflowId === workflowId), "workflow logs should not leak other workflow entries");

const warningLogs = await listTaskLogs({ severity: "warning", limit: 20 });
assert.equal(warningLogs.length, 1, "severity filter should return matching logs");
assert.equal(warningLogs[0].event, "tool_warning");

const oldLog = {
  logId: `tasklog:old:${Date.now()}`,
  workflowId,
  category: "skill",
  severity: "info",
  event: "old_log",
  message: "过期日志",
  details: {},
  source: "smoke",
  createdAt: "2026-01-01T00:00:00.000Z",
};
__testInternals.memoryTaskLogs.push(oldLog);

const pruneOld = await pruneTaskLogs({
  now: Date.parse("2026-07-15T00:00:00.000Z"),
  retentionMs: 24 * 60 * 60 * 1000,
});
assert.equal(pruneOld.ok, true);
assert.ok(pruneOld.deleted >= 1, "retention prune should delete stale logs");
assert.equal((await listTaskLogs({ workflowId, limit: 20 })).some((entry) => entry.logId === oldLog.logId), false, "stale log should be gone");

__testInternals.memoryTaskLogs.splice(0);
for (let index = 0; index < 6; index += 1) {
  await appendTaskLog({
    workflowId,
    category: "skill",
    severity: "info",
    event: `cap_${index}`,
    message: `cap log ${index}`,
    source: "smoke",
  });
}
const prunePerWorkflow = await pruneTaskLogs({ maxLogs: 10, maxLogsPerWorkflow: 3 });
assert.equal(prunePerWorkflow.ok, true);
assert.equal((await listTaskLogs({ workflowId, limit: 20 })).length, 3, "per-workflow cap should keep only newest logs");

__testInternals.memoryTaskLogs.splice(0);
console.log("task log runtime smoke passed");
