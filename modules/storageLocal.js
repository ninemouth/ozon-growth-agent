/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// Thin reliable wrapper for chrome.storage.local hot paths.

import { isRegisteredStorageKey } from './storageKeys.js';

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_RETRIES = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeReadKeys(keys) {
  if (Array.isArray(keys)) return keys;
  if (typeof keys === "string") return [keys];
  if (keys && typeof keys === "object") return Object.keys(keys);
  return [];
}

function assertRegisteredKeys(keys, operation) {
  const unknown = keys.filter((key) => !isRegisteredStorageKey(key));
  if (unknown.length) {
    throw new Error(`Unregistered chrome.storage.local ${operation} key(s): ${unknown.join(", ")}`);
  }
}

function chromeLastErrorMessage() {
  return globalThis.chrome?.runtime?.lastError?.message || "";
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function retryStorage(operation, { retries = DEFAULT_RETRIES } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= retries) break;
      await sleep(80 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function getLocal(keys, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  assertRegisteredKeys(normalizeReadKeys(keys), "get");
  return await retryStorage(async () => await withTimeout(new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (data) => {
      const error = chromeLastErrorMessage();
      if (error) reject(new Error(error));
      else resolve(data || {});
    });
  }), timeoutMs, "chrome.storage.local.get"), { retries });
}

export async function setLocal(values, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("chrome.storage.local.set values must be an object");
  }
  assertRegisteredKeys(Object.keys(values), "set");
  return await retryStorage(async () => await withTimeout(new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chromeLastErrorMessage();
      if (error) reject(new Error(error));
      else resolve(true);
    });
  }), timeoutMs, "chrome.storage.local.set"), { retries });
}

export async function removeLocal(keys, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  assertRegisteredKeys(normalizeReadKeys(keys), "remove");
  return await retryStorage(async () => await withTimeout(new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chromeLastErrorMessage();
      if (error) reject(new Error(error));
      else resolve(true);
    });
  }), timeoutMs, "chrome.storage.local.remove"), { retries });
}

export async function getLocalSafe(keys, fallback = {}, options = {}) {
  try {
    return await getLocal(keys, options);
  } catch (err) {
    console.warn("chrome.storage.local.get failed:", err.message);
    return fallback;
  }
}
