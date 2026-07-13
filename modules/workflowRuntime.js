// Durable workflow runtime for MV3 service-worker workflows.
// Large snapshots and ordered events live in IndexedDB; storage.local keeps
// only a small compatibility index in background.js.

const DB_NAME = "ozonGrowthAgentRuntime";
const DB_VERSION = 1;
const WORKFLOW_STORE = "workflows";
const EVENT_STORE = "workflowEvents";
const memoryWorkflows = new Map();
const memoryEvents = new Map();
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

export const __testInternals = { defaultWorkflow, memoryWorkflows, memoryEvents };
