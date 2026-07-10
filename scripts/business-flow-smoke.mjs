import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const root = process.cwd();
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const js = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard.css"), "utf8");

const dom = new JSDOM(html, {
  url: "chrome-extension://test/dashboard.html",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});

const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => ({
  scale() {},
  clearRect() {},
  beginPath() {},
  roundRect() {},
  fill() {},
  fillText() {},
  set fillStyle(_value) {},
  set font(_value) {},
  set textAlign(_value) {},
});

const storage = {
  trackedProducts: [],
  savedResults: [],
  monitorChangeEvents: [],
  monitorReports: [],
  monitorTasks: [],
  growthExperiments: [],
  growthWorkflowTaskState: {},
  growthCases: [],
  growthActionRuns: [],
  ozonSkuAnalyticsSnapshot: {
    shopId: "shop-1",
    syncedAt: "2026-07-09T08:00:00Z",
    result: {
      metrics: ["hits_view", "session_view", "ordered_units", "conv_tocart"],
      data: [
        {
          dimensions: [{ id: "SKU-001", name: "厨房收纳架" }],
          metrics: [1200, 410, 4, 1.4],
        },
        {
          dimensions: [{ id: "SKU-002", name: "浴室置物架" }],
          metrics: [900, 280, 2, 0.8],
        },
      ],
    },
  },
  ozonStoreSnapshotCache: null,
  ozonShops: [{ id: "shop-1", name: "测试店铺", clientId: "client-1", warehouseType: "FBS" }],
  activeShopId: "shop-1",
};

const messages = [];
let alertText = "";
let connectedPort = null;

function makePort() {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    name: "ozon-agent-loop",
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => disconnectListeners.push(fn) },
    postMessage(message) {
      messages.push(message);
      setTimeout(() => {
        messageListeners.forEach((fn) => fn({
          type: "PROGRESS",
          data: { type: "thinking", message: "正在读取 Seller API 与店铺证据" },
        }));
      }, 0);
      setTimeout(() => {
        messageListeners.forEach((fn) => fn({
          type: "SUCCESS",
          result: {
            type: "final",
            skillId: message.skillPath,
            result: {
              overview: "店铺体检报告：定位、人群与商品矩阵需要先收敛。",
              analysis: "Seller API 显示多个 SKU 有曝光但低加购，当前问题不是单张海报，而是目标客群、价格带和商品结构混乱。",
              summary: "先完成店铺定位重构，再推进 SKU 标题、主图、价格与履约细节。",
              data: [
                {
                  title: "确认目标客群和主价格带",
                  diagnosis_level: "P0",
                  evidence: "2 个核心 SKU 均有曝光但加购弱，且无可放大 SKU。",
                  first_actions: ["确认主客群", "收敛商品矩阵", "列出应下架或弱化 SKU"],
                },
              ],
            },
          },
        }));
      }, 5);
    },
    disconnect() {
      disconnectListeners.forEach((fn) => fn());
    },
  };
}

window.chrome = {
  storage: {
    local: {
      get(keys, callback) {
        if (Array.isArray(keys)) {
          callback(Object.fromEntries(keys.map((key) => [key, storage[key]])));
          return;
        }
        if (typeof keys === "string") {
          callback({ [keys]: storage[keys] });
          return;
        }
        callback({ ...storage });
      },
      set(values, callback) {
        Object.assign(storage, values);
        callback?.();
      },
      clear(callback) {
        Object.keys(storage).forEach((key) => delete storage[key]);
        callback?.();
      },
    },
  },
  runtime: {
    getURL: (filePath) => `chrome-extension://test/${filePath}`,
    sendMessage: async (message) => {
      if (message.type === "GET_SAVED_RESULTS") return { ok: true, data: storage.savedResults };
      if (message.type === "DELETE_RESULT") {
        storage.savedResults = storage.savedResults.filter((item) => String(item.id) !== String(message.id));
        return { ok: true };
      }
      return { ok: true, data: {} };
    },
    connect({ name }) {
      assert.equal(name, "ozon-agent-loop");
      connectedPort = makePort();
      return connectedPort;
    },
  },
};

window.marked = {
  parse: (text = "") => `<article>${String(text)
    .replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]))
    .replace(/\n/g, "<br>")}</article>`,
};
window.alert = (message) => {
  alertText = message;
};
window.confirm = () => true;
window.open = (url, target) => {
  storage.lastOpenedUrl = url;
  storage.lastOpenedTarget = target;
  return null;
};

const context = dom.getInternalVMContext();
context.chrome = window.chrome;
context.marked = window.marked;
context.alert = window.alert;
context.confirm = window.confirm;
vm.runInContext(js, context, { filename: "dashboard.js" });

window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
await wait();

assert.equal(window.document.querySelectorAll(".canvas-command-bar .growth-action-btn").length, 0, "workflow header should not expose direct business action buttons");
assert.equal(window.document.querySelectorAll(".canvas-focus-tab").length, 0, "workflow header should not expose redundant focus tabs");
assert.ok(window.document.querySelector(".workflow-zoom-dock"), "workflow zoom controls should live in the bottom dock");
assert.doesNotMatch(window.document.querySelector(".workflow-canvas-space")?.textContent || "", /滚轮缩放，按住空白处拖动画布/, "workflow helper hint should be removed");
assert.match(window.document.querySelector('.root-node[data-root-id="store_health"]')?.textContent || "", /API 已同步/, "workflow root should expose Seller API evidence status before running");
assert.equal(window.document.querySelectorAll(".store-sidebar-column").length, 0, "API data page should not expose the removed shop-binding sidebar");
assert.equal(window.document.querySelectorAll("#add-shop-form, #dashboard-shop-list").length, 0, "shop credential management should not appear in the API data page");

window.document.querySelector('.root-node[data-root-id="platform_trends"]').click();
await wait();
assert.equal(messages.length, 0, "clicking a workflow root should not start RUN_SKILL");
assert.equal(window.document.querySelector('.root-node[data-root-id="platform_trends"]')?.classList.contains("selected"), true, "root click should select the matching workflow root");
assert.match(window.document.getElementById("workflow-pip").textContent, /平台趋势/, "root click should open the matching root detail");
assert.match(window.document.getElementById("workflow-pip").textContent, /运行前证据检查/, "workflow PIP should expose pre-run evidence checklist");
assert.match(window.document.getElementById("workflow-pip").textContent, /需前台页面/, "platform trend flow should warn when page context is needed");

window.document.querySelector('.root-node[data-root-id="store_health"]').click();
await wait();
const runButton = window.document.querySelector('.scrum-board-head .growth-action-btn[data-action="diagnose_store_growth"]');
assert.ok(runButton, "store diagnosis button should exist on workflow canvas");
runButton.click();

for (let i = 0; i < 30; i += 1) {
  await wait(10);
  if (storage.growthActionRuns?.[0]?.status === "completed") break;
}

assert.ok(connectedPort, "dashboard should connect to the agent loop port");
assert.equal(messages[0]?.type, "RUN_SKILL", "dashboard should start a real RUN_SKILL flow");
assert.equal(messages[0]?.growthActionId, "diagnose_store_growth", "RUN_SKILL should carry growth action id");
assert.ok(messages[0]?.growthRunId, "RUN_SKILL should carry growth run id");
assert.ok(messages[0]?.growthCaseId?.startsWith("store_health_"), "RUN_SKILL should carry growth case id");

const run = storage.growthActionRuns[0];
assert.equal(run.status, "completed", "growth action run should complete");
assert.ok(run.savedResultId, "completed run should link to a saved report");

const storeCase = storage.growthCases.find((item) => item.type === "store_health");
assert.ok(storeCase, "store health case should be created");
assert.equal(storeCase.status, "completed", "store health case should be completed after successful run");
assert.ok(storeCase.reportIds.includes(String(run.savedResultId)), "case should retain saved report id");
assert.equal(storeCase.runs[0].status, "completed", "case run history should be completed");

assert.equal(storage.savedResults.length, 1, "dashboard should save a report when background did not return savedEntry");
assert.equal(storage.savedResults[0].growthCaseId, storeCase.id, "saved report should link back to growth case");

await wait();
const rootTitles = [...window.document.querySelectorAll(".root-node strong")].map((node) => node.textContent.trim());
assert.deepEqual(rootTitles.slice(0, 7), ["店铺体检", "竞品跟踪", "商品页转化", "平台趋势", "机会扩品", "供应商货源", "执行与复盘"], "workflow roots should stay product-scoped");
assert.equal(rootTitles.includes("店铺定位重构"), false, "positioning must not be rendered as an independent root");

window.document.querySelector('.nav-menu button[data-tab="reports"]').click();
assert.equal(window.document.querySelectorAll(".report-item").length, 1, "report center should show generated report");

storage.savedResults.unshift({
  id: "wrapped-final-report",
  createdAt: "2026-07-10T10:00:00Z",
  skillId: "skills/ozon_sourcing_finder.skill.md",
  skillName: "Ozon 货源筛选",
  result: {
    type: "final",
    output: {
      overview: "Ozon 松鼠喂食器跨境供应链审计",
      analysis: "已经进入采购平台结果页，应先筛选候选卡片再打开详情页审计。",
      summary: "停止重复搜索，优先完成视觉初筛和详情页穿透。",
      data: [
        {
          plan_id: "SRC-001",
          diagnosis_level: "P1",
          direction: "图片搜索结果页筛选",
          evidence: "当前已有候选商品卡片。",
          first_actions: ["按主图相似度排序", "打开 1-3 个详情页"],
        },
      ],
    },
  },
});
context.renderReportsList([], storage.savedResults);
const wrappedReportText = window.document.getElementById("report-viewer-content").textContent;
assert.match(wrappedReportText, /Ozon 松鼠喂食器跨境供应链审计/, "wrapped final reports should render as business report content");
assert.doesNotMatch(wrappedReportText, /"type":\s*"final"/, "wrapped final reports should not render raw JSON by default");
window.document.querySelector(".report-pdf-current").click();
assert.match(storage.printHtml, /<meta charset="UTF-8">/, "report center PDF print HTML should declare UTF-8");
assert.match(storage.printHtml, /PingFang SC[\s\S]*Microsoft YaHei[\s\S]*Noto Sans CJK SC/, "report center PDF should use Chinese-capable font fallbacks");
assert.match(storage.printHtml, /@page\s*\{\s*size:\s*A4 portrait;/, "report center PDF should use the native A4 print template");
assert.match(storage.printHtml, /正在生成原生数字版 PDF/, "report center PDF should use the native print-to-PDF bridge");
assert.match(storage.printHtml, /Ozon 松鼠喂食器跨境供应链审计/, "report center PDF should preserve Chinese report content");
assert.equal(storage.lastOpenedUrl, "chrome-extension://test/print.html", "report center PDF should open the shared print bridge");

storage.savedResults.unshift({
  id: "embedded-json-report",
  createdAt: "2026-07-10T10:05:00Z",
  skillId: "skills/ozon_sourcing_finder.skill.md",
  skillName: "Ozon-1688寻源账本",
  result: `让我构建最终报告。 json ${JSON.stringify({
    type: "final",
    output: {
      overview: "Ozon 金属喂食器跨境供应链审计报告",
      analysis: "1688 图片搜索受限，本轮需要人工寻源验证，不得输出采购直达链接。",
      summary: "先联系 2-3 家金属花园装饰品供应商，再复核物流和关税。",
      data: [
        {
          plan_id: "SRC-002",
          diagnosis_level: "待验证假设",
          direction: "1688 货源寻源 - 图片搜索受限",
          evidence: "图片搜索受平台限制，未获得真实详情页。",
          first_actions: ["联系供应商", "要求实物图对比"],
        },
      ],
    },
  })}`,
});
context.renderReportsList([], storage.savedResults);
const embeddedReportText = window.document.getElementById("report-viewer-content").textContent;
assert.match(embeddedReportText, /Ozon 金属喂食器跨境供应链审计报告/, "embedded final JSON text should render as business report content");
assert.doesNotMatch(embeddedReportText, /"type":\s*"final"/, "embedded final JSON text should not render raw JSON by default");

assert.match(css, /\.report-viewer\s*\{[\s\S]*?overflow:\s*hidden;/, "report viewer shell should not rely on page-level overflow");
assert.match(css, /\.report-viewer-content\s*>\s*\.md-report\s*\{[\s\S]*?overflow:\s*auto;/, "report body should own vertical scrolling for long reports");
assert.match(css, /\.md-report img\s*\{[\s\S]*?max-width:\s*min\(420px,\s*100%\);/, "report images should be constrained inside the reader");

window.document.querySelector('.nav-menu button[data-tab="workflow"]').click();
window.document.querySelector('.root-node[data-root-id="store_health"]').click();
await wait();
const pipText = window.document.getElementById("workflow-pip").textContent;
assert.match(pipText, /案件: 已生成报告/, "workflow PIP should expose case status");
assert.match(pipText, /最近运行: 已生成报告/, "workflow PIP should expose run status");
const taskText = [...window.document.querySelectorAll(".workflow-task-card")]
  .map((card) => card.textContent)
  .join("\n");
assert.match(taskText, /确认目标客群和主价格带/, "AI report should generate an actionable workflow task");
assert.equal(alertText, "", "successful dashboard run should not show fallback alert");

console.log(JSON.stringify({
  runStatus: run.status,
  caseStatus: storeCase.status,
  savedResults: storage.savedResults.length,
  reportCenterItems: window.document.querySelectorAll(".report-item").length,
  firstRoot: rootTitles[0],
}, null, 2));
