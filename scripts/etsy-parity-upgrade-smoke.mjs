import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const dashboardHtml = read("dashboard.html");
const dashboardJs = read("dashboard.js");
const sidepanelHtml = read("sidepanel.html");
const sidepanelJs = read("sidepanel.js");
const sidepanelCss = read("sidepanel.css");
const agentLoop = read("modules/agentLoop.js");
const background = read("background.js");
const platformTrends = read("skills/ozon_platform_trends.skill.md");
const operationsTracker = read("skills/ozon_operations_tracker.skill.md");

assert.doesNotMatch(dashboardJs, /getShopMockData|renderMockStoreData|drawMockTrackerCharts|mock-api-data-btn/, "dashboard must not retain runtime mock data generators");
assert.doesNotMatch(dashboardHtml, /mock-api-data-btn|示例数据/, "dashboard markup must not expose mock API controls");
assert.match(dashboardHtml, /sync-api-data-btn/, "dashboard should route users to real Seller API sync");
assert.match(dashboardJs, /不生成示例曝光、加购、订单或利润指标/, "source ledger should state that missing API data stays empty");

assert.match(sidepanelHtml, /sessionModeText/, "sidepanel must expose explicit session mode");
assert.match(sidepanelHtml, /sessionHistoryPanel/, "sidepanel must expose resumable session history");
assert.doesNotMatch(sidepanelHtml, /continueSessionCheckbox/, "sidepanel must not use ambiguous continue-session checkbox");
assert.match(sidepanelJs, /createWorkflowSessionId/, "sidepanel must create fresh workflow session ids");
assert.match(sidepanelJs, /selectedResumeSessionKey/, "sidepanel must support selecting a checkpoint to resume");
assert.match(sidepanelJs, /forceNewSession/, "sidepanel must tell background when a run is intentionally new");
assert.match(sidepanelCss, /session-control/, "sidepanel must style the explicit session controls");

assert.match(agentLoop, /runToolWithTimeout/, "agent loop must run tools through the timeout wrapper");
assert.match(agentLoop, /tool_timeout_does_not_cancel_workflow/, "tool timeout must not cancel the workflow");
assert.match(agentLoop, /tool_heartbeat/, "agent loop must send heartbeat progress for long tools");
assert.match(agentLoop, /closeTabsCreatedDuringTimedOutTool/, "agent loop must clean tabs created by timed-out tools");
assert.match(agentLoop, /isWorkflowGenerationCurrent/, "agent loop must discard late results from stale workflow generations");
assert.match(background, /workflowGeneration: lease\.generation/, "background must pass workflow generation into the agent loop");

assert.match(platformTrends, /证据阶段完成条件/, "Ozon platform trends must define stage completion conditions");
assert.match(platformTrends, /不是无限搜索循环/, "Ozon platform trends must guard against repeated search loops");
assert.match(platformTrends, /stage_observations/, "Ozon platform trends must require staged screenshot evidence");

assert.match(operationsTracker, /运营追踪硬门槛/, "Ozon operations tracker must include attribution gates");
assert.match(operationsTracker, /baseline_window/, "Ozon operations tracker must require baseline windows");
assert.match(operationsTracker, /没有优化前快照/, "Ozon operations tracker must reject attribution without baseline snapshots");

console.log("Etsy parity upgrade smoke passed.");
