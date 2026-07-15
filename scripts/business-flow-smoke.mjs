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
const shopOptimizerSkill = fs.readFileSync(path.join(root, "skills/ozon_global_shop_optimizer.skill.md"), "utf8");
const agentLoopSource = fs.readFileSync(path.join(root, "modules/agentLoop.js"), "utf8");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const workflowRuntimeSource = fs.readFileSync(path.join(root, "modules/workflowRuntime.js"), "utf8");
const toolRegistrySource = fs.readFileSync(path.join(root, "modules/toolRegistry.js"), "utf8");
const platformTrendsSkill = fs.readFileSync(path.join(root, "skills/ozon_platform_trends.skill.md"), "utf8");
const complianceSkill = fs.readFileSync(path.join(root, "skills/ozon_compliance_auditor.skill.md"), "utf8");

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
  taskLogs: [
    {
      logId: "tasklog:business:1",
      workflowId: "store_health_shop-1_shop",
      category: "skill",
      severity: "warning",
      event: "tool_warning",
      message: "Google Trends 证据不足，已降级为待验证假设",
      details: {
        toolName: "agentic_web_search",
        apiKey: "[redacted]",
        evidenceQuality: "blocked",
      },
      source: "background",
      createdAt: "2026-07-15T07:30:00.000Z",
    },
    {
      logId: "tasklog:business:2",
      workflowId: "",
      category: "maintenance",
      severity: "info",
      event: "task_logs_pruned",
      message: "任务日志定期清理完成，删除 0 条过期或超限记录。",
      details: { deleted: 0, storage: "memory" },
      source: "alarm",
      createdAt: "2026-07-15T07:00:00.000Z",
    },
  ],
  ozonShops: [{ id: "shop-1", name: "测试店铺", clientId: "client-1", warehouseType: "FBS" }],
  activeShopId: "shop-1",
};

const messages = [];
let alertText = "";
let connectedPort = null;
let exportedEvidenceBundleRequest = null;

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
      if (message.type === "GET_TASK_LOGS") {
        return {
          ok: true,
          data: storage.taskLogs.filter((entry) => !message.severity || entry.severity === message.severity).slice(0, message.limit || 100),
        };
      }
      if (message.type === "DELETE_RESULT") {
        storage.savedResults = storage.savedResults.filter((item) => String(item.id) !== String(message.id));
        return { ok: true };
      }
      if (message.type === "EXPORT_EVIDENCE_BUNDLE") {
        exportedEvidenceBundleRequest = message;
        const report = storage.savedResults.find((item) => String(item.id) === String(message.reportId));
        const base = {
          ...(report?.evidence_bundle || {}),
          artifact_manifest: { total: 1, available: 1, missing: 0, artifacts: [{ ref: "artifact://ozon/test", available: true }] },
        };
        return {
          ok: true,
          data: message.includeArtifactPayloads
            ? {
                ...base,
                artifact_payloads: [{
                  ref: "artifact://ozon/test",
                  filename: "artifact_ozon_test.png",
                  mimeType: "image/png",
                  dataUrl: "data:image/png;base64,AA==",
                }],
              }
            : base,
        };
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
assert.match(messages[0]?.userInstruction || "", /不能只凭截图下结论/, "store diagnosis entry should forbid screenshot-only diagnosis");
assert.match(messages[0]?.userInstruction || "", /2-3 个同类高排名店铺|头部竞品页面/, "store diagnosis entry should require top competitor store learning");
assert.match(shopOptimizerSkill, /店铺体检不得只凭截图下结论/, "shop optimizer skill should include screenshot-only diagnosis guardrail");
assert.match(shopOptimizerSkill, /平台属性与店铺定位/, "shop optimizer skill should require platform attributes and positioning");
assert.match(shopOptimizerSkill, /2-3 个同类高排名店铺|头部竞品页面/, "shop optimizer skill should require competitor store screenshot learning");
assert.match(agentLoopSource, /店铺体检报告不能只依赖截图视觉证据/, "critic should reject screenshot-only store diagnosis reports");
assert.match(agentLoopSource, /缺少 2-3 个同类高排名店铺/, "critic should require top competitor store learning evidence");
assert.match(agentLoopSource, /resumeState/, "agent loop should accept persisted resume state");
assert.match(agentLoopSource, /onCheckpoint/, "agent loop should emit durable checkpoints");
assert.match(backgroundSource, /agentWorkflowCheckpoints/, "background should persist agent workflow checkpoints");
assert.match(backgroundSource, /isResumableCheckpoint/, "background should detect resumable workflow checkpoints");
assert.match(backgroundSource, /shouldResumeFromCheckpoint/, "background should resume interrupted workflows when user sends follow-up input");
assert.match(js, /已保存断点/, "dashboard should expose interrupted workflow state as a resumable checkpoint");
assert.match(workflowRuntimeSource, /ozonGrowthAgentRuntime/, "Ozon should use its own IndexedDB workflow runtime");
assert.match(backgroundSource, /acquireWorkflowLease/, "background should acquire durable workflow leases");
assert.match(backgroundSource, /renewWorkflowLease/, "background should renew workflow leases during long runs");
assert.match(backgroundSource, /releaseWorkflowLease/, "background should release workflow leases on completion or interruption");
assert.match(backgroundSource, /GET_TASK_LOGS/, "background should expose durable task logs to the dashboard");
assert.match(backgroundSource, /TASK_LOG_PRUNE_ALARM/, "background should prune durable task logs on a schedule");
assert.match(workflowRuntimeSource, /TASK_LOG_STORE/, "workflow runtime should have a dedicated task log store");
assert.match(workflowRuntimeSource, /appendTaskLog/, "workflow runtime should append task logs");
assert.match(workflowRuntimeSource, /pruneTaskLogs/, "workflow runtime should prune task logs");
assert.match(backgroundSource, /createOwnedTab[\s\S]*waitForPageCaptureReady[\s\S]*monitor_completed/, "scheduled monitor should use owned tabs and shared page readiness");
assert.match(backgroundSource, /if \(activePorts\.size === 0\) return;[\s\S]*keepAlive/, "MV3 keep-alive should only run while workflow ports are active");
const alarmHandlerSource = backgroundSource.slice(
  backgroundSource.indexOf("chrome.alarms.onAlarm.addListener"),
  backgroundSource.indexOf("// ── Initialize Default Settings on Installation ──")
);
assert.doesNotMatch(alarmHandlerSource, /chrome\.tabs\.create|setInterval\(/, "scheduled monitor alarm must not use raw tab creation or local polling loops");
assert.doesNotMatch(toolRegistrySource, /monthly_search_volume|monthly_sales_estimate/, "tool registry should not include synthetic third-party market metrics");
assert.match(toolRegistrySource, /尚未实现其正式 API 适配器|不能生成或推测市场指标/, "query_market_data should fail closed until a verified provider adapter exists");
const agenticSearchSource = toolRegistrySource.slice(
  toolRegistrySource.indexOf("agentic_web_search: async"),
  toolRegistrySource.indexOf("search_in_browser: async")
);
assert.match(agenticSearchSource, /createBrowserTab[\s\S]*waitForPageCaptureReady[\s\S]*closeOwnedTab/, "agentic web search fallback should use owned tabs and shared readiness");
assert.doesNotMatch(agenticSearchSource, /chrome\.tabs\.create|setInterval\(/, "agentic web search fallback must not use raw tab creation or local polling loops");
assert.match(backgroundSource, /ozon_platform_trends/, "background should route platform trends to the dedicated skill");
assert.match(backgroundSource, /ozon_compliance_auditor/, "background should expose the compliance auditor skill");
assert.match(platformTrendsSkill, /不能把自营店铺 API 数据写成平台大盘数据/, "platform trends skill should enforce API boundary");
assert.match(platformTrendsSkill, /report_status/, "platform trends skill should require industrial report status");
assert.match(platformTrendsSkill, /blocking_gaps/, "platform trends skill should require structured blocking gaps");
assert.match(platformTrendsSkill, /follow_up_tasks/, "platform trends skill should generate executable follow-up tasks");
assert.match(platformTrendsSkill, /workflow_nodes/, "platform trends skill should generate canvas workflow nodes");
assert.match(agentLoopSource, /validateOzonPlatformTrendReport/, "agent loop should validate Ozon platform trend report quality");
assert.match(agentLoopSource, /Google Trends 数据不足|Google Trends 证据不足|hasInvalidGoogleTrendsEvidence/, "critic should downgrade insufficient Google Trends evidence");
assert.match(agentLoopSource, /占位链接|XXXX|placeholder/, "critic should reject placeholder URLs in trend reports");
assert.match(complianceSkill, /EAC|TR CU|欧亚经济联盟/, "compliance auditor should cover Ozon/RU compliance risks");

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
  evidence_bundle: {
    schema_version: "1.0",
    workflowId: "workflow:test",
    screenshotRefs: ["artifact://ozon/test"],
    toolTimeline: [{ tool: "collect_ozon_shop_pages" }],
  },
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
assert.ok(window.document.querySelector(".report-evidence-current"), "report center should expose evidence bundle download for reports with evidence_bundle");
assert.ok(window.document.querySelector(".report-verify-current"), "report center should expose evidence verification for reports with evidence_bundle");
assert.ok(window.document.querySelector(".report-zip-current"), "report center should expose ZIP export for reports with evidence_bundle");
assert.match(window.document.querySelector(".report-item")?.textContent || "", /证据待校验 1/, "report center should show pending evidence status before artifact manifest is fetched");
window.document.querySelector(".report-pdf-current").click();
assert.match(storage.printHtml, /<meta charset="UTF-8">/, "report center PDF print HTML should declare UTF-8");
assert.match(storage.printHtml, /PingFang SC[\s\S]*Microsoft YaHei[\s\S]*Noto Sans CJK SC/, "report center PDF should use Chinese-capable font fallbacks");
assert.match(storage.printHtml, /@page\s*\{\s*size:\s*A4 portrait;/, "report center PDF should use the native A4 print template");
assert.match(storage.printHtml, /正在生成原生数字版 PDF/, "report center PDF should use the native print-to-PDF bridge");
assert.match(storage.printHtml, /Ozon 松鼠喂食器跨境供应链审计/, "report center PDF should preserve Chinese report content");
assert.match(storage.printHtml, /证据包摘要/, "report center PDF should append evidence bundle summary when available");
assert.match(storage.printHtml, /artifact:\/\/ozon\/test/, "report center PDF appendix should include screenshot artifact references");
assert.match(storage.printHtml, /artifact 可用/, "report center PDF appendix should include artifact availability summary");
assert.equal(storage.lastOpenedUrl, "chrome-extension://test/print.html", "report center PDF should open the shared print bridge");
await window.document.querySelector(".report-verify-current").click();
await wait();
assert.equal(exportedEvidenceBundleRequest?.type, "EXPORT_EVIDENCE_BUNDLE", "evidence verification should use the background export endpoint");
await window.document.querySelector(".report-evidence-current").click();
await wait();
assert.equal(exportedEvidenceBundleRequest?.type, "EXPORT_EVIDENCE_BUNDLE", "evidence download should use the background export endpoint");
assert.equal(String(exportedEvidenceBundleRequest?.reportId), "wrapped-final-report", "evidence export should request the selected report id");
assert.equal(storage.savedResults.find((item) => String(item.id) === "wrapped-final-report")?.evidence_bundle?.artifact_manifest?.available, 1, "downloaded evidence bundle should persist artifact manifest back to savedResults");
await window.document.querySelector(".report-zip-current").click();
assert.match(storage.lastOpenedUrl || "", /^data:application\/octet-stream/, "ZIP export should fall back to a downloadable data URL when object URLs are unavailable");

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

window.document.querySelector('.nav-menu button[data-tab="tasks"]').click();
await wait();
assert.match(window.document.querySelector(".task-log-card")?.textContent || "", /运行日志/, "system tasks page should expose operational task logs");
assert.equal(window.document.querySelectorAll(".task-log-item").length, 2, "task log section should render durable runtime logs");
assert.match(window.document.querySelector(".task-log-item")?.textContent || "", /Google Trends 证据不足/, "task logs should show workflow warnings");
assert.match(window.document.querySelector(".task-log-item pre")?.textContent || "", /"apiKey": "\[redacted\]"/, "task log details should render sanitized JSON");
window.document.querySelector('.task-log-filter[data-severity="warning"]').click();
await wait();
assert.equal(window.document.querySelectorAll(".task-log-item").length, 1, "task log severity filter should call the runtime endpoint");
assert.match(window.document.querySelector(".task-log-item")?.textContent || "", /警告/, "warning filter should keep warning logs");

console.log(JSON.stringify({
  runStatus: run.status,
  caseStatus: storeCase.status,
  savedResults: storage.savedResults.length,
  reportCenterItems: window.document.querySelectorAll(".report-item").length,
  firstRoot: rootTitles[0],
}, null, 2));
