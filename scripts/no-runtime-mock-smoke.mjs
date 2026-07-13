import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertNoMatch(source, pattern, label) {
  if (pattern.test(source)) {
    throw new Error(`${label} still contains runtime mock/demo/seed data: ${pattern}`);
  }
}

const runtimeFiles = [
  "dashboard.html",
  "dashboard.js",
  "dashboard.css",
  "sidepanel.html",
  "sidepanel.js",
  "background.js",
  "content.js",
  "modules/toolRegistry.js",
  "modules/agentLoop.js",
];

for (const file of runtimeFiles) {
  const source = read(file);
  assertNoMatch(source, /\bmock-api-data-btn\b|getShopMockData|renderMockStoreData|drawMockTrackerCharts|mockData|demoData/i, file);
  assertNoMatch(source, /\bopp_seed\b|\bseed_visual\b|\bseed_profit\b|getSeedExperiments|示例 SKU|本地追踪\/示例/i, file);
  assertNoMatch(source, /\/product\/fallback_|\/store\/product\/fallback_/i, file);
  assertNoMatch(source, /value="1500"|value="10"/i, file);
}

const dashboardJs = read("dashboard.js");
if (!/未创建实验时保持空状态/.test(dashboardJs)) {
  throw new Error("dashboard must keep experiments empty when no real experiment exists");
}
if (!/bootstrap_/.test(dashboardJs)) {
  throw new Error("dashboard should use explicit bootstrap tasks instead of seed tasks");
}

console.log("no-runtime-mock-smoke: ok");
