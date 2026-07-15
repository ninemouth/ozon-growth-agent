/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// Durable workflow runtime for MV3 service-worker workflows.
// Large snapshots and ordered events live in IndexedDB; storage.local keeps
// only a small compatibility index in background.js.

const DB_NAME = "ozonGrowthAgentRuntime";
const DB_VERSION = 2;
const WORKFLOW_STORE = "workflows";
const EVENT_STORE = "workflowEvents";
const TASK_LOG_STORE = "taskLogs";
const DEFAULT_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TASK_LOGS = 5000;
const DEFAULT_MAX_LOGS_PER_WORKFLOW = 500;
const memoryWorkflows = new Map();
const memoryEvents = new Map();
const memoryTaskLogs = [];
let writeQueue = Promise.resolve();

function enqueueWrite(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {});
  return next;
}

function hasIndexedDb() {
  return typeof globalThis.indexedDB !== "undefined";
}

function openDb() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKFLOW_STORE)) {
        const workflows = db.createObjectStore(WORKFLOW_STORE, { keyPath: "workflowId" });
        workflows.createIndex("updatedAt", "updatedAt", { unique: false });
        workflows.createIndex("leaseExpiresAt", "leaseExpiresAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        const events = db.createObjectStore(EVENT_STORE, { keyPath: "eventId" });
        events.createIndex("workflowId", "workflowId", { unique: false });
        events.createIndex("sequence", ["workflowId", "sequence"], { unique: true });
      }
      if (!db.objectStoreNames.contains(TASK_LOG_STORE)) {
        const taskLogs = db.createObjectStore(TASK_LOG_STORE, { keyPath: "logId" });
        taskLogs.createIndex("createdAt", "createdAt", { unique: false });
        taskLogs.createIndex("workflowId", "workflowId", { unique: false });
        taskLogs.createIndex("severity", "severity", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open workflow runtime database"));
  });
}

function closeDb(db) {
  try { db?.close?.(); } catch (_) {}
}

function clone(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function createLogId() {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);
  return `tasklog:${Date.now()}:${random}`;
}

function sanitizeLogValue(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return value.slice(0, 2000);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeLogValue(item, depth + 1));
  const secretPattern = /(api[_-]?key|authorization|token|password|secret|cookie|set-cookie)/i;
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
    key,
    secretPattern.test(key) ? "[redacted]" : sanitizeLogValue(item, depth + 1),
  ]));
}

function withTransaction(db, storeNames, mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]));
    let result;
    let settled = false;
    const finish = (value) => { result = value; };
    tx.oncomplete = () => {
      settled = true;
      resolve(result);
    };
    tx.onerror = () => {
      if (!settled) reject(tx.error || new Error("Workflow runtime transaction failed"));
    };
    tx.onabort = () => {
      if (!settled) reject(tx.error || new Error("Workflow runtime transaction aborted"));
    };
    try {
      callback(stores, finish, reject);
    } catch (error) {
      reject(error);
      try { tx.abort(); } catch (_) {}
    }
  });
}

function defaultWorkflow(workflowId) {
  const now = nowIso();
  return {
    workflowId,
    status: "created",
    sequence: 0,
    snapshot: {},
    createdAt: now,
    updatedAt: now,
    leaseOwnerId: "",
    leaseExpiresAt: 0,
    generation: "",
    cancelRequestedAt: null,
  };
}

async function readWorkflow(workflowId) {
  if (!workflowId) return null;
  const memory = memoryWorkflows.get(workflowId);
  if (memory) return clone(memory);
  const db = await openDb();
  if (!db) return null;
  try {
    return await withTransaction(db, [WORKFLOW_STORE], "readonly", (stores, finish) => {
      const request = stores[WORKFLOW_STORE].get(workflowId);
      request.onsuccess = () => finish(request.result || null);
      request.onerror = () => finish(null);
    });
  } finally {
    closeDb(db);
  }
}

export async function loadWorkflowSnapshot(workflowId) {
  const record = await readWorkflow(workflowId);
  return record ? clone(record) : null;
}

export async function saveWorkflowSnapshot(workflowId, patch = {}) {
  if (!workflowId) throw new Error("workflowId is required");
  return enqueueWrite(async () => {
    const existing = (await readWorkflow(workflowId)) || defaultWorkflow(workflowId);
    const next = {
      ...existing,
      ...patch,
      workflowId,
      snapshot: patch.snapshot ? clone(patch.snapshot) : existing.snapshot,
      updatedAt: nowIso(),
    };
    memoryWorkflows.set(workflowId, clone(next));
    const db = await openDb();
    if (!db) return clone(next);
    try {
      await withTransaction(db, [WORKFLOW_STORE], "readwrite", (stores) => {
        stores[WORKFLOW_STORE].put(next);
      });
    } finally {
      closeDb(db);
    }
    return clone(next);
  });
}

export async function appendWorkflowEvent(workflowId, type, payload = {}) {
  if (!workflowId) throw new Error("workflowId is required");
  return enqueueWrite(async () => {
    const workflow = (await readWorkflow(workflowId)) || defaultWorkflow(workflowId);
    const sequence = Number(workflow.sequence || 0) + 1;
    const event = {
      eventId: `${workflowId}:${sequence}`,
      workflowId,
      sequence,
      type,
      payload: clone(payload),
      createdAt: nowIso(),
    };
    workflow.sequence = sequence;
    workflow.updatedAt = event.createdAt;
    memoryWorkflows.set(workflowId, clone(workflow));
    const events = memoryEvents.get(workflowId) || [];
    events.push(event);
    memoryEvents.set(workflowId, events.slice(-500));
    const db = await openDb();
    if (!db) return clone(event);
    try {
      await withTransaction(db, [WORKFLOW_STORE, EVENT_STORE], "readwrite", (stores) => {
        stores[WORKFLOW_STORE].put(workflow);
        stores[EVENT_STORE].put(event);
      });
    } finally {
      closeDb(db);
    }
    return clone(event);
  });
}

export async function listWorkflowEvents(workflowId, { afterSequence = 0, limit = 500 } = {}) {
  const memory = memoryEvents.get(workflowId);
  if (memory) return clone(memory.filter((event) => event.sequence > afterSequence).slice(-limit));
  const db = await openDb();
  if (!db) return [];
  try {
    return await withTransaction(db, [EVENT_STORE], "readonly", (stores, finish) => {
      const request = stores[EVENT_STORE].index("workflowId").getAll(workflowId);
      request.onsuccess = () => finish((request.result || [])
        .filter((event) => event.sequence > afterSequence)
        .sort((a, b) => a.sequence - b.sequence)
        .slice(-limit));
      request.onerror = () => finish([]);
    });
  } finally {
    closeDb(db);
  }
}

export async function appendTaskLog({
  workflowId = "",
  category = "workflow",
  severity = "info",
  event = "runtime_event",
  message = "",
  details = {},
  source = "background",
} = {}) {
  return enqueueWrite(async () => {
    const record = {
      logId: createLogId(),
      workflowId: String(workflowId || ""),
      category: String(category || "workflow"),
      severity: ["debug", "info", "warning", "error"].includes(severity) ? severity : "info",
      event: String(event || "runtime_event"),
      message: String(message || "").slice(0, 2000),
      details: sanitizeLogValue(details),
      source: String(source || "background"),
      createdAt: nowIso(),
    };
    memoryTaskLogs.push(record);
    if (memoryTaskLogs.length > DEFAULT_MAX_TASK_LOGS) memoryTaskLogs.splice(0, memoryTaskLogs.length - DEFAULT_MAX_TASK_LOGS);
    const db = await openDb();
    if (!db) return clone(record);
    try {
      await withTransaction(db, [TASK_LOG_STORE], "readwrite", (stores) => {
        stores[TASK_LOG_STORE].put(record);
      });
    } finally {
      closeDb(db);
    }
    return clone(record);
  });
}

export async function listTaskLogs({ workflowId = "", severity = "", limit = 200 } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const filterLogs = (entries) => entries
    .filter((entry) => !workflowId || entry.workflowId === workflowId)
    .filter((entry) => !severity || entry.severity === severity)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, normalizedLimit);
  if (!hasIndexedDb()) return clone(filterLogs(memoryTaskLogs));
  const db = await openDb();
  if (!db) return clone(filterLogs(memoryTaskLogs));
  try {
    const entries = await withTransaction(db, [TASK_LOG_STORE], "readonly", (stores, finish) => {
      const request = workflowId
        ? stores[TASK_LOG_STORE].index("workflowId").getAll(String(workflowId))
        : stores[TASK_LOG_STORE].getAll();
      request.onsuccess = () => finish(request.result || []);
      request.onerror = () => finish([]);
    });
    return clone(filterLogs(entries));
  } finally {
    closeDb(db);
  }
}

export async function pruneTaskLogs({
  now = Date.now(),
  retentionMs = DEFAULT_LOG_RETENTION_MS,
  maxLogs = DEFAULT_MAX_TASK_LOGS,
  maxLogsPerWorkflow = DEFAULT_MAX_LOGS_PER_WORKFLOW,
} = {}) {
  const cutoff = Number(now) - Math.max(0, Number(retentionMs) || DEFAULT_LOG_RETENTION_MS);
  const shouldDelete = (entries) => {
    const sorted = [...entries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const remove = new Set(sorted.filter((entry) => Date.parse(entry.createdAt) < cutoff).map((entry) => entry.logId));
    sorted.slice(Math.max(0, Number(maxLogs) || DEFAULT_MAX_TASK_LOGS)).forEach((entry) => remove.add(entry.logId));
    const byWorkflow = new Map();
    sorted.forEach((entry) => {
      const list = byWorkflow.get(entry.workflowId || "") || [];
      list.push(entry);
      byWorkflow.set(entry.workflowId || "", list);
    });
    byWorkflow.forEach((entriesForWorkflow) => {
      entriesForWorkflow.slice(Math.max(0, Number(maxLogsPerWorkflow) || DEFAULT_MAX_LOGS_PER_WORKFLOW))
        .forEach((entry) => remove.add(entry.logId));
    });
    return remove;
  };
  const memoryDelete = shouldDelete(memoryTaskLogs);
  for (let index = memoryTaskLogs.length - 1; index >= 0; index -= 1) {
    if (memoryDelete.has(memoryTaskLogs[index].logId)) memoryTaskLogs.splice(index, 1);
  }
  const db = await openDb();
  if (!db) return { ok: true, deleted: memoryDelete.size, storage: "memory" };
  try {
    const entries = await withTransaction(db, [TASK_LOG_STORE], "readonly", (stores, finish) => {
      const request = stores[TASK_LOG_STORE].getAll();
      request.onsuccess = () => finish(request.result || []);
      request.onerror = () => finish([]);
    });
    const ids = shouldDelete(entries);
    if (ids.size) {
      await withTransaction(db, [TASK_LOG_STORE], "readwrite", (stores) => {
        ids.forEach((logId) => stores[TASK_LOG_STORE].delete(logId));
      });
    }
    return { ok: true, deleted: ids.size, storage: "indexeddb" };
  } finally {
    closeDb(db);
  }
}

export async function acquireWorkflowLease(workflowId, ownerId, ttlMs = 45_000) {
  const current = (await readWorkflow(workflowId)) || defaultWorkflow(workflowId);
  const now = Date.now();
  if (current.leaseOwnerId && current.leaseOwnerId !== ownerId && Number(current.leaseExpiresAt || 0) > now) {
    return { ok: false, ownerId: current.leaseOwnerId, expiresAt: current.leaseExpiresAt };
  }
  const next = await saveWorkflowSnapshot(workflowId, {
    leaseOwnerId: ownerId,
    leaseExpiresAt: now + ttlMs,
    generation: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    status: current.status === "created" ? "leased" : current.status,
  });
  await appendWorkflowEvent(workflowId, "lease_acquired", { ownerId, expiresAt: next.leaseExpiresAt });
  return { ok: true, ownerId, expiresAt: next.leaseExpiresAt, generation: next.generation };
}

export async function renewWorkflowLease(workflowId, ownerId, ttlMs = 45_000) {
  const current = await readWorkflow(workflowId);
  if (!current || current.leaseOwnerId !== ownerId) return { ok: false };
  const next = await saveWorkflowSnapshot(workflowId, { leaseExpiresAt: Date.now() + ttlMs });
  return { ok: true, expiresAt: next.leaseExpiresAt };
}

export async function releaseWorkflowLease(workflowId, ownerId, status = "released") {
  const current = await readWorkflow(workflowId);
  if (!current || (current.leaseOwnerId && current.leaseOwnerId !== ownerId)) return { ok: false };
  await saveWorkflowSnapshot(workflowId, { leaseOwnerId: "", leaseExpiresAt: 0, status });
  await appendWorkflowEvent(workflowId, "lease_released", { ownerId, status });
  return { ok: true };
}

export async function requestWorkflowCancellation(workflowId, reason = "cancelled") {
  const next = await saveWorkflowSnapshot(workflowId, {
    cancelRequestedAt: nowIso(),
    cancelReason: reason,
    status: "cancellation_requested",
  });
  await appendWorkflowEvent(workflowId, "cancellation_requested", { reason });
  return next;
}

export async function clearWorkflowCancellation(workflowId) {
  const current = await readWorkflow(workflowId);
  if (!current) return null;
  return await saveWorkflowSnapshot(workflowId, {
    cancelRequestedAt: null,
    cancelReason: "",
    status: current.status === "cancellation_requested" ? "resuming" : current.status,
  });
}

export async function isWorkflowCancellationRequested(workflowId) {
  const current = await readWorkflow(workflowId);
  return Boolean(current?.cancelRequestedAt);
}

export async function isWorkflowGenerationCurrent(workflowId, generation) {
  if (!workflowId || !generation) return true;
  const current = await readWorkflow(workflowId);
  return current?.generation === generation && current?.status !== "cancellation_requested";
}

export const __testInternals = { defaultWorkflow, memoryWorkflows, memoryEvents, memoryTaskLogs, sanitizeLogValue };
