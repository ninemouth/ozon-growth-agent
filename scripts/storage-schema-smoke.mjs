import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  STORAGE_KEY_REGISTRY,
  STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION,
  isRegisteredStorageKey,
  listStorageKeys,
} from "../modules/storageKeys.js";

const root = process.cwd();
const runtimeFiles = [
  "background.js",
  "dashboard.js",
  "sidepanel.js",
  "modules/growthCaseStore.js",
  "modules/llmClient.js",
  "modules/ozonApi.js",
  "modules/toolRegistry.js",
];

const requiredKeys = [
  "activeShopId",
  "agentWorkflowCheckpoints",
  "apiKey",
  "fastmossApiKey",
  "growthActionRuns",
  "growthCases",
  "growthExperiments",
  "growthWorkflowTaskState",
  "helium10ApiKey",
  "llmBaseUrl",
  "llmModel",
  "llmProvider",
  "monitorChangeEvents",
  "monitorEntities",
  "monitorReports",
  "monitorSnapshots",
  "monitorTasks",
  "ozonApiKey",
  "ozonClientId",
  "ozonLogisticsCostProfile",
  "ozonMarketRatesSnapshot",
  "ozonShops",
  "ozonSkuAnalyticsSnapshot",
  "ozonStoreSnapshotCache",
  "ozonTargetMargin",
  "ozonUpdateStatus",
  "ozonWarehouseType",
  "platformMemory",
  "printHtml",
  "savedResults",
  "sellerSpriteApiKey",
  "settingsTheme",
  "temperature",
  "trackedProducts",
];

assert.equal(Number.isInteger(STORAGE_SCHEMA_VERSION), true, "storage schema version must be an integer");
assert.ok(STORAGE_SCHEMA_VERSION >= 1, "storage schema version must start at 1");

const values = listStorageKeys();
assert.equal(values.length, new Set(values).size, "storage key constants must be unique");
for (const key of values) {
  assert.ok(STORAGE_KEY_REGISTRY[key], `${key} must have registry metadata`);
  assert.ok(STORAGE_KEY_REGISTRY[key].owner, `${key} must declare owner`);
  assert.ok(STORAGE_KEY_REGISTRY[key].category, `${key} must declare category`);
  assert.ok(STORAGE_KEY_REGISTRY[key].sensitivity, `${key} must declare sensitivity`);
  assert.ok(STORAGE_KEY_REGISTRY[key].retention, `${key} must declare retention`);
  assert.ok(STORAGE_KEY_REGISTRY[key].description, `${key} must declare description`);
}

for (const key of requiredKeys) {
  assert.ok(isRegisteredStorageKey(key), `${key} must be registered before release`);
}

const secretKeys = [
  STORAGE_KEYS.API_KEY,
  STORAGE_KEYS.FASTMOSS_API_KEY,
  STORAGE_KEYS.HELIUM10_API_KEY,
  STORAGE_KEYS.OZON_API_KEY,
  STORAGE_KEYS.OZON_CLIENT_ID,
  STORAGE_KEYS.OZON_SHOPS,
  STORAGE_KEYS.SELLER_SPRITE_API_KEY,
];
for (const key of secretKeys) {
  assert.equal(STORAGE_KEY_REGISTRY[key].sensitivity, "secret", `${key} must be classified as secret`);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function extractQuotedKeys(fragment) {
  return [...fragment.matchAll(/["']([A-Za-z][A-Za-z0-9_]+)["']/g)].map((match) => match[1]);
}

function collectLiteralGetKeys(source) {
  const keys = [];
  for (const match of source.matchAll(/chrome\.storage\.local\.get\(\s*\[([\s\S]*?)\]/g)) {
    keys.push(...extractQuotedKeys(match[1]));
  }
  for (const match of source.matchAll(/chrome\.storage\.local\.get\(\s*["']([A-Za-z][A-Za-z0-9_]+)["']/g)) {
    keys.push(match[1]);
  }
  return keys;
}

function collectLiteralSetKeys(source) {
  const keys = [];
  for (const match of source.matchAll(/chrome\.storage\.local\.set\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g)) {
    const objectSource = match[1];
    for (const prop of objectSource.matchAll(/(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*:/g)) {
      keys.push(prop[1]);
    }
  }
  return keys.filter((key) => !["ok", "error", "message"].includes(key));
}

const discovered = new Map();
for (const file of runtimeFiles) {
  const source = read(file);
  const keys = [...collectLiteralGetKeys(source), ...collectLiteralSetKeys(source)];
  for (const key of keys) {
    if (!discovered.has(key)) discovered.set(key, new Set());
    discovered.get(key).add(file);
  }
}

const ignoredLiterals = new Set([
  // Message payload fields and nested response fields that are not storage keys.
  "data",
  "dateFrom",
  "dateTo",
  "details",
  "frequency",
  "id",
  "items",
  "name",
  "result",
  "shopId",
  "status",
  "syncedAt",
  "target_type",
  "url",
]);

const unknown = [...discovered.entries()]
  .filter(([key]) => !ignoredLiterals.has(key))
  .filter(([key]) => !isRegisteredStorageKey(key));

assert.deepEqual(
  unknown.map(([key, files]) => `${key} (${[...files].join(", ")})`).sort(),
  [],
  "every chrome.storage.local literal key must be registered in modules/storageKeys.js",
);

console.log(JSON.stringify({
  schemaVersion: STORAGE_SCHEMA_VERSION,
  registeredKeys: values.length,
  discoveredKeys: discovered.size,
}, null, 2));
