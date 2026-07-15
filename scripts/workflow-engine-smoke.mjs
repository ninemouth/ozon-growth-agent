import assert from "node:assert/strict";
import { WorkflowEngine } from "../modules/workflowEngine.js";
import { __testInternals, listTaskLogs, loadWorkflowSnapshot } from "../modules/workflowRuntime.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const engine = new WorkflowEngine({ maxConcurrent: 1 });
const workflowA = `engine-smoke-a-${Date.now()}`;
const workflowB = `engine-smoke-b-${Date.now()}`;

__testInternals.memoryWorkflows.delete(workflowA);
__testInternals.memoryWorkflows.delete(workflowB);
__testInternals.memoryEvents.delete(workflowA);
__testInternals.memoryEvents.delete(workflowB);
__testInternals.memoryTaskLogs.splice(0);

let releaseFirst;
const firstStarted = new Promise((resolve) => {
  releaseFirst = resolve;
});
const finishFirst = new Promise((resolve) => {
  globalThis.__finishFirstWorkflow = resolve;
});

const firstPromise = engine.submit({
  workflowId: workflowA,
  ownerId: "smoke-owner",
  actionKind: "diagnose_store_growth",
  source: "smoke",
  metadata: { tabId: 101 },
}, async () => {
  releaseFirst();
  await finishFirst;
  return { ok: true, name: "first" };
});

await firstStarted;
assert.equal(engine.getState().running.length, 1, "first job should be running");

const secondPromise = engine.submit({
  workflowId: workflowB,
  ownerId: "smoke-owner",
  actionKind: "explore_platform_trends",
  source: "smoke",
  metadata: { tabId: 102 },
}, async () => {
  throw new Error("queued job should not run after cancellation");
});

await sleep(20);
assert.equal(engine.getState().queued.length, 1, "second job should wait in the global queue");
assert.equal(engine.getJob(workflowB).status, "queued", "queued job should be inspectable by workflow id");

const cancelQueued = await engine.cancel(workflowB, "smoke_cancel_queued");
assert.equal(cancelQueued.ok, true);
await assert.rejects(secondPromise, /cancelled before start/);
assert.equal(engine.getJob(workflowB).status, "cancelled", "cancelled queued job should remain inspectable");

globalThis.__finishFirstWorkflow();
const firstResult = await firstPromise;
assert.deepEqual(firstResult, { ok: true, name: "first" });
assert.equal(engine.getJob(workflowA).status, "completed", "completed job should be visible in engine state");

const snapshotA = await loadWorkflowSnapshot(workflowA);
assert.equal(snapshotA.status, "completed", "workflow runtime snapshot should track engine completion");
assert.equal(snapshotA.engine.actionKind, "diagnose_store_growth");

const logs = await listTaskLogs({ limit: 20 });
assert.ok(logs.some((entry) => entry.category === "workflow_engine" && entry.event === "workflow_queued"), "engine should write queued logs");
assert.ok(logs.some((entry) => entry.category === "workflow_engine" && entry.event === "workflow_running"), "engine should write running logs");
assert.ok(logs.some((entry) => entry.category === "workflow_engine" && entry.event === "workflow_engine_completed"), "engine should write completion logs");

__testInternals.memoryWorkflows.delete(workflowA);
__testInternals.memoryWorkflows.delete(workflowB);
__testInternals.memoryEvents.delete(workflowA);
__testInternals.memoryEvents.delete(workflowB);
__testInternals.memoryTaskLogs.splice(0);
delete globalThis.__finishFirstWorkflow;

console.log("workflow engine smoke passed");

