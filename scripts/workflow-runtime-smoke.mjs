import assert from "node:assert/strict";
import {
  __testInternals,
  acquireWorkflowLease,
  appendWorkflowEvent,
  clearWorkflowCancellation,
  isWorkflowCancellationRequested,
  isWorkflowGenerationCurrent,
  listWorkflowEvents,
  loadWorkflowSnapshot,
  releaseWorkflowLease,
  requestWorkflowCancellation,
  saveWorkflowSnapshot,
} from "../modules/workflowRuntime.js";

const workflowId = `ozon-runtime-smoke-${Date.now()}`;
const ownerA = "owner-a";
const ownerB = "owner-b";

await saveWorkflowSnapshot(workflowId, { status: "created", snapshot: { step: 0 } });
const leaseA = await acquireWorkflowLease(workflowId, ownerA, 60_000);
assert.equal(leaseA.ok, true);
assert.equal(await isWorkflowGenerationCurrent(workflowId, leaseA.generation), true);
assert.equal((await acquireWorkflowLease(workflowId, ownerB, 60_000)).ok, false, "active workflow lease must be exclusive");

await saveWorkflowSnapshot(workflowId, { status: "running", snapshot: { step: 2, lastNode: "tool_result" } });
await appendWorkflowEvent(workflowId, "tool_completed", { toolName: "search_in_browser" });
await requestWorkflowCancellation(workflowId, "port_disconnected");
assert.equal(await isWorkflowCancellationRequested(workflowId), true, "cancellation request must be durable");

await clearWorkflowCancellation(workflowId);
assert.equal(await isWorkflowCancellationRequested(workflowId), false, "resume must clear the cancellation request");
const events = await listWorkflowEvents(workflowId);
assert.ok(events.length >= 3, "runtime must retain ordered workflow events");
assert.deepEqual(events.map((event) => event.sequence), events.map((event) => event.sequence).sort((a, b) => a - b));
assert.equal((await loadWorkflowSnapshot(workflowId)).snapshot.lastNode, "tool_result");

await releaseWorkflowLease(workflowId, ownerA, "completed");
const leaseB = await acquireWorkflowLease(workflowId, ownerB, 60_000);
assert.equal(leaseB.ok, true);
assert.notEqual(leaseB.generation, leaseA.generation, "a resumed owner must receive a new workflow generation");
assert.equal(await isWorkflowGenerationCurrent(workflowId, leaseA.generation), false, "late results from an old generation must be rejected");
await releaseWorkflowLease(workflowId, ownerB, "completed");
__testInternals.memoryWorkflows.delete(workflowId);
__testInternals.memoryEvents.delete(workflowId);
console.log("workflow runtime smoke passed");
