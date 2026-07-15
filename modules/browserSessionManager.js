/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// Central ownership for workflow-created browser tabs.
// Tools may still use the Chrome API directly for legacy paths, but workflow
// browser evidence tabs use this manager so cleanup can preserve source tabs.

const ownedTabs = new Map();
const protectedTabs = new Map();

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

async function tabUrlMatches(tabId, preserveUrlPattern = null) {
  if (!preserveUrlPattern) return false;
  try {
    const tab = await chrome.tabs.get(Number(tabId));
    const url = String(tab?.url || "");
    if (preserveUrlPattern instanceof RegExp) return preserveUrlPattern.test(url);
    return new RegExp(String(preserveUrlPattern)).test(url);
  } catch (_) {
    return false;
  }
}

export async function cleanupOwnedTabs(workflowId = "default", { preserveUrlPattern = null } = {}) {
  const protectedIds = protectedTabs.get(workflowId) || new Set();
  const ids = Array.from(ownedTabs.get(workflowId) || []).filter((id) => !protectedIds.has(id));
  const preserved = [];
  const closable = [];
  for (const id of ids) {
    if (await tabUrlMatches(id, preserveUrlPattern)) {
      preserved.push(id);
    } else {
      closable.push(id);
    }
  }
  await Promise.all(closable.map((id) => closeOwnedTab(workflowId, id)));
  ownedTabs.delete(workflowId);
  protectedTabs.delete(workflowId);
  return { closed: closable, preserved };
}

export function listOwnedTabs(workflowId = "default") {
  return Array.from(ownedTabs.get(workflowId) || []);
}

export const __testInternals = { ownedTabs, protectedTabs };
