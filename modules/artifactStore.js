// modules/artifactStore.js — durable large-artifact storage for extension workflows

const DB_NAME = "ozonGrowthAgentArtifacts";
const DB_VERSION = 1;
const STORE_NAME = "artifacts";
const memoryFallback = new Map();

function indexedDbAvailable() {
  return typeof globalThis.indexedDB !== "undefined";
}

function openArtifactDb() {
  if (!indexedDbAvailable()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "ref" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("namespace", "namespace", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open artifact database"));
  });
}

function closeDb(db) {
  try {
    db?.close?.();
  } catch (_) {}
}

async function withArtifactStore(mode, callback) {
  const db = await openArtifactDb();
  if (!db) throw new Error("IndexedDB is unavailable");
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let settled = false;
      const finish = (value) => {
        settled = true;
        resolve(value);
      };
      tx.onerror = () => reject(tx.error || new Error("Artifact transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("Artifact transaction aborted"));
      tx.oncomplete = () => {
        if (!settled) resolve(undefined);
      };
      callback(store, finish, reject);
    });
  } finally {
    closeDb(db);
  }
}

function dataUrlToBlob(dataUrl = "") {
  const [header, base64 = ""] = String(dataUrl).split(",");
  const mime = header.match(/^data:([^;]+);base64$/i)?.[1] || "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
  });
}

function createArtifactRef(namespace = "artifact") {
  return `artifact://${namespace}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function putMemoryArtifact(record) {
  memoryFallback.set(record.ref, record);
  return {
    ref: record.ref,
    bytes: record.bytes,
    storage: "memory_fallback",
    expiresAt: record.expiresAt,
  };
}

export async function putDataUrlArtifact(dataUrl, {
  namespace = "artifact",
  metadata = {},
  ttlMs = 24 * 60 * 60 * 1000,
} = {}) {
  if (!dataUrl || !/^data:image\//i.test(String(dataUrl))) {
    throw new Error("putDataUrlArtifact requires an image data URL.");
  }
  const ref = createArtifactRef(namespace);
  const blob = dataUrlToBlob(dataUrl);
  const now = Date.now();
  const record = {
    ref,
    namespace,
    blob,
    mimeType: blob.type || "image/png",
    bytes: blob.size || String(dataUrl).length,
    metadata,
    createdAt: now,
    expiresAt: now + ttlMs,
  };

  try {
    await withArtifactStore("readwrite", (store, resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("Failed to store artifact"));
    });
    return {
      ref,
      bytes: record.bytes,
      storage: "indexeddb_blob",
      expiresAt: record.expiresAt,
    };
  } catch (err) {
    console.warn("IndexedDB artifact storage failed; using memory fallback:", err.message);
    return await putMemoryArtifact(record);
  }
}

export async function getArtifactDataUrl(ref) {
  if (!ref) return null;
  const memoryRecord = memoryFallback.get(ref);
  if (memoryRecord?.blob) return await blobToDataUrl(memoryRecord.blob);

  try {
    const record = await withArtifactStore("readonly", (store, resolve, reject) => {
      const request = store.get(ref);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Failed to read artifact"));
    });
    if (!record?.blob) return null;
    return await blobToDataUrl(record.blob);
  } catch (err) {
    console.warn("IndexedDB artifact read failed:", err.message);
    return null;
  }
}

export async function pruneArtifacts({
  namespace = "",
  maxArtifacts = 120,
  now = Date.now(),
} = {}) {
  const shouldDelete = (record) =>
    Boolean(record?.ref) &&
    (!namespace || record.namespace === namespace) &&
    (record.expiresAt < now);

  for (const [ref, record] of memoryFallback.entries()) {
    if (shouldDelete(record)) memoryFallback.delete(ref);
  }

  try {
    const records = await withArtifactStore("readonly", (store, resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("Failed to list artifacts"));
    });
    const scoped = records
      .filter((record) => !namespace || record.namespace === namespace)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const expiredRefs = scoped.filter((record) => record.expiresAt < now).map((record) => record.ref);
    const overflowRefs = scoped.slice(maxArtifacts).map((record) => record.ref);
    const refsToDelete = Array.from(new Set([...expiredRefs, ...overflowRefs]));
    if (refsToDelete.length === 0) return { ok: true, deleted: 0 };
    await withArtifactStore("readwrite", (store, resolve, reject) => {
      refsToDelete.forEach((ref) => store.delete(ref));
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error || new Error("Failed to prune artifacts"));
    });
    return { ok: true, deleted: refsToDelete.length };
  } catch (err) {
    console.warn("IndexedDB artifact prune failed:", err.message);
    return { ok: false, deleted: 0, error: err.message };
  }
}
