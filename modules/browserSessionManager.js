/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// Central ownership for workflow-created browser tabs.
// Tools may still use the Chrome API directly for legacy paths, but workflow
// browser evidence tabs use this manager so cleanup can preserve source tabs.

const ownedTabs = new Map();
const protectedTabs = new Map();
const historyPreservedTabs = new Map();
const MAX_HISTORY_PRESERVED_TABS = 60;

function workflowTabs(workflowId = "default") {
  if (!ownedTabs.has(workflowId)) ownedTabs.set(workflowId, new Set());
  return ownedTabs.get(workflowId);
}

function workflowProtectedTabs(workflowId = "default") {
  if (!protectedTabs.has(workflowId)) protectedTabs.set(workflowId, new Set());
  return protectedTabs.get(workflowId);
}

export function protectWorkflowTab(workflowId = "default", tabId) {
  const id = Number(tabId);
  if (Number.isInteger(id)) workflowProtectedTabs(workflowId).add(id);
}

export function isProtectedWorkflowTab(workflowId = "default", tabId) {
  const id = Number(tabId);
  return Number.isInteger(id) && Boolean(protectedTabs.get(workflowId)?.has(id));
}

export async function createOwnedTab({ workflowId = "default", url, active = false, openerTabId = null } = {}) {
  if (!url) throw new Error("url is required");
  const tab = await new Promise((resolve, reject) => {
    const createArgs = { url, active };
    if (Number.isInteger(Number(openerTabId))) createArgs.openerTabId = Number(openerTabId);
    chrome.tabs.create(createArgs, (created) => {
      if (chrome.runtime.lastError || !created) {
        reject(new Error(chrome.runtime.lastError?.message || "Failed to create owned tab"));
      } else {
        resolve(created);
      }
    });
  });
  workflowTabs(workflowId).add(tab.id);
  return tab;
}

export function createOwnedTabCallback({ workflowId = "default", url, active = false, openerTabId = null } = {}, callback) {
  const createArgs = { url, active };
  if (Number.isInteger(Number(openerTabId))) createArgs.openerTabId = Number(openerTabId);
  chrome.tabs.create(createArgs, (tab) => {
    if (!chrome.runtime.lastError && tab?.id !== undefined) workflowTabs(workflowId).add(tab.id);
    callback(tab);
  });
}

export function registerOwnedTab(workflowId = "default", tabId) {
  if (Number.isInteger(Number(tabId))) workflowTabs(workflowId).add(Number(tabId));
}

export async function closeOwnedTab(workflowId = "default", tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) return false;
  if (isProtectedWorkflowTab(workflowId, id)) {
    ownedTabs.get(workflowId)?.delete(id);
    return false;
  }
  try {
    await chrome.tabs.remove(id);
  } catch (_) {
    // The tab may already have been closed by the user or browser.
  }
  ownedTabs.get(workflowId)?.delete(id);
  return true;
}

async function getTabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(Number(tabId));
    return String(tab?.url || "");
  } catch (_) {
    return "";
  }
}

function urlMatchesPattern(url, preserveUrlPattern = null) {
  if (!preserveUrlPattern || !url) return false;
  try {
    if (preserveUrlPattern instanceof RegExp) return preserveUrlPattern.test(url);
    return new RegExp(String(preserveUrlPattern)).test(url);
  } catch (_) {
    return false;
  }
}

function rememberPreservedTab(workflowId, tabId, url = "") {
  const id = Number(tabId);
  if (!Number.isInteger(id)) return;
  historyPreservedTabs.delete(id);
  historyPreservedTabs.set(id, {
    tabId: id,
    workflowId,
    url,
    preservedAt: Date.now(),
  });
  while (historyPreservedTabs.size > MAX_HISTORY_PRESERVED_TABS) {
    const oldestTabId = historyPreservedTabs.keys().next().value;
    historyPreservedTabs.delete(oldestTabId);
  }
}

export async function cleanupOwnedTabs(workflowId = "default", { preserveUrlPattern = null } = {}) {
  const protectedIds = protectedTabs.get(workflowId) || new Set();
  const ids = Array.from(ownedTabs.get(workflowId) || []).filter((id) => !protectedIds.has(id));
  const preserved = [];
  const closable = [];
  for (const id of ids) {
    const url = await getTabUrl(id);
    if (urlMatchesPattern(url, preserveUrlPattern)) {
      preserved.push(id);
      rememberPreservedTab(workflowId, id, url);
    } else {
      closable.push(id);
    }
  }
  await Promise.all(closable.map((id) => closeOwnedTab(workflowId, id)));
  ownedTabs.delete(workflowId);
  protectedTabs.delete(workflowId);
  return { closed: closable, preserved };
}

export async function cleanupPreservedTabs({ maxAgeMs = 6 * 60 * 60 * 1000, preserveUrlPattern = null } = {}) {
  const now = Date.now();
  const closed = [];
  const retained = [];
  const entries = Array.from(historyPreservedTabs.values());
  for (const entry of entries) {
    const url = await getTabUrl(entry.tabId);
    const tooOld = Number(entry.preservedAt || 0) + Math.max(0, Number(maxAgeMs) || 0) < now;
    const shouldKeepByPattern = preserveUrlPattern && urlMatchesPattern(url || entry.url, preserveUrlPattern);
    if (!tooOld || shouldKeepByPattern) {
      retained.push(entry.tabId);
      continue;
    }
    try {
      await chrome.tabs.remove(entry.tabId);
    } catch (_) {
      // Already closed tabs are removed from the preserved registry below.
    }
    historyPreservedTabs.delete(entry.tabId);
    closed.push(entry.tabId);
  }
  return { closed, retained };
}

export function listOwnedTabs(workflowId = "default") {
  return Array.from(ownedTabs.get(workflowId) || []);
}

export function listPreservedTabs() {
  return Array.from(historyPreservedTabs.values()).map((entry) => ({ ...entry }));
}

export const __testInternals = { ownedTabs, protectedTabs, historyPreservedTabs };
