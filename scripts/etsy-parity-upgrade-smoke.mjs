import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasValidGoogleTrendsEvidence } from "../modules/toolRegistry.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const dashboardHtml = read("dashboard.html");
const dashboardJs = read("dashboard.js");
const sidepanelHtml = read("sidepanel.html");
const sidepanelJs = read("sidepanel.js");
const sidepanelCss = read("sidepanel.css");
const contentSource = read("content.js");
const agentLoop = read("modules/agentLoop.js");
const background = read("background.js");
const toolRegistry = read("modules/toolRegistry.js");
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
assert.match(sidepanelJs, /pickLatestResumableSessionForContinue[\s\S]*legacyContinueInstruction[\s\S]*pickLatestResumableSessionForContinue/, "plain continue messages should auto-select the latest resumable checkpoint");
assert.match(sidepanelJs, /forceNewSession/, "sidepanel must tell background when a run is intentionally new");
assert.match(sidepanelCss, /session-control/, "sidepanel must style the explicit session controls");
assert.ok(
  sidepanelHtml.indexOf("session-control session-control-top") > sidepanelHtml.indexOf("growth-command-card") &&
  sidepanelHtml.indexOf("session-control session-control-top") < sidepanelHtml.indexOf("advanced-skill-section"),
  "session controls should be visible near the top of the sidepanel instead of hidden below the instruction area"
);

assert.match(contentSource, /chat-new-session-btn[\s\S]*\+ 新会话[\s\S]*chat-session-history-btn[\s\S]*历史会话/, "floating content overlay should expose direct new-session and session-history controls");
assert.match(contentSource, /pickLatestOverlayResumableSessionForContinue[\s\S]*legacyContinueInstruction[\s\S]*pickLatestOverlayResumableSessionForContinue/, "floating overlay plain continue messages should auto-select the latest resumable checkpoint");
assert.match(contentSource, /workflowSessionId[\s\S]*continueSession[\s\S]*forceNewSession/, "floating overlay should pass explicit session intent into RUN_SKILL");
assert.match(contentSource, /startOverlayNewSessionMode[\s\S]*不会沿用旧断点/, "floating overlay should make fresh-session mode visible");
assert.match(contentSource, /resumableEntries\.length > 0[\s\S]*已暂停自动运行[\s\S]*return;[\s\S]*runOverlayGrowthActionNow/, "floating overlay action clicks should pause for session choice when resumable checkpoints exist");
assert.match(contentSource, /chat-session-resume-btn[\s\S]*overlayPendingGrowthAction[\s\S]*resume:\s*true/, "choosing a history item from the floating overlay should resume the pending action");
assert.match(contentSource, /chat-new-session-btn[\s\S]*overlayPendingGrowthAction \|\| overlayLastGrowthAction[\s\S]*resume:\s*false/, "clicking + new session from a pending or last floating action should start a fresh run explicitly");
assert.match(contentSource, /activeAgentPort[\s\S]*CANCEL_WORKFLOW[\s\S]*pauseActiveWorkflow/, "floating overlay pause button should request workflow cancellation through the active port");
assert.match(contentSource, /sendBtn\.innerText = pausing \? "暂停中" : "暂停"/, "floating overlay send button should become a pause button while a workflow is running");
assert.doesNotMatch(contentSource, /Привет|Здравствуйте|Спасибо|Пожалуйста/, "content overlay should not contain Russian greeting copy");

assert.match(agentLoop, /runToolWithTimeout/, "agent loop must run tools through the timeout wrapper");
assert.match(agentLoop, /tool_timeout_does_not_cancel_workflow/, "tool timeout must not cancel the workflow");
assert.match(agentLoop, /tool_heartbeat/, "agent loop must send heartbeat progress for long tools");
assert.match(agentLoop, /type:\s*"tool_stage"/, "agent loop must emit concrete browser tool stage progress");
assert.match(agentLoop, /__sourceTabId:\s*tabId/, "agent loop must pass the original source tab id into runtime tools");
assert.match(agentLoop, /__workflowSkillId:\s*skillId/, "agent loop must pass the current skill id into runtime tools for workflow-specific safety policies");
assert.match(agentLoop, /stripRuntimeToolArgs[\s\S]*__progress[\s\S]*__sourceTabId/, "agent loop must keep runtime-only tool args out of persisted tool history");
assert.match(agentLoop, /delete clean\.__workflowSkillId/, "agent loop must keep workflow skill runtime args out of persisted tool history");
assert.match(agentLoop, /checkpoint\("interrupted"[\s\S]*workflow_cancellation_requested/, "user-paused workflows should stay resumable instead of becoming cancelled checkpoints");
assert.match(agentLoop, /closeTabsCreatedDuringTimedOutTool\(beforeTabIds = new Set\(\), protectedTabIds = \[\]\)/, "agent loop timeout cleanup should accept protected source tab ids");
assert.match(agentLoop, /isProtectedRuntimeTab\(tab\.id, protectedTabIds\)[\s\S]*return false/, "agent loop timeout cleanup must refuse to close protected source tabs");
assert.match(agentLoop, /closeTabsCreatedDuringTimedOutTool\(tabsBeforeTool, \[tabId\]\)/, "agent loop must pass the source tab id into timeout cleanup");
assert.doesNotMatch(agentLoop, /return \/[^\n]*ozon\\\.ru[^\n]*google\\\./, "agent loop timeout cleanup must not auto-close Ozon tabs");
assert.match(agentLoop, /isWorkflowGenerationCurrent/, "agent loop must discard late results from stale workflow generations");
assert.match(background, /workflowGeneration: lease\.generation/, "background must pass workflow generation into the agent loop");
assert.match(background, /port\.sender\?\.tab\?\.id \? port\.sender\.tab : await getCurrentTab\(\)/, "background should bind overlay workflows to the sender source tab instead of whichever temporary tab is active");
assert.match(background, /tools\.read_current_page\(\{ __sourceTabId: tab\.id \}\)/, "background should read initial page context from the protected source tab");
assert.match(background, /message\.type === "CANCEL_WORKFLOW"[\s\S]*requestWorkflowCancellation[\s\S]*lastStage:\s*"user_paused"/, "background should persist user-paused workflows as resumable checkpoints");
assert.match(background, /workflowPaused[\s\S]*type:\s*"INTERRUPTED"[\s\S]*resumeHint/, "background should report explicit interrupted state instead of overwriting user pause as failed");
assert.match(sidepanelJs, /msg\.type === "tool_stage"/, "sidepanel should show concrete browser tool stages");
assert.match(contentSource, /data\.type === "tool_stage"/, "floating overlay should show concrete browser tool stages");

assert.match(platformTrends, /证据阶段完成条件/, "Ozon platform trends must define stage completion conditions");
assert.match(platformTrends, /不是无限搜索循环/, "Ozon platform trends must guard against repeated search loops");
assert.match(platformTrends, /stage_observations/, "Ozon platform trends must require staged screenshot evidence");
assert.match(platformTrends, /平台趋势任务严禁主动关闭任何 Ozon 页面/, "Ozon platform trends must explicitly forbid closing Ozon pages");
assert.match(platformTrends, /protectedOzonTrendTab[\s\S]*protectedSourceTab/, "Ozon platform trends must treat protected-tab responses as safety success");
assert.match(toolRegistry, /minStablePollAttempts[\s\S]*google_trends/, "Google Trends polling must wait for a stable evidence window");
assert.match(toolRegistry, /trendsEvidenceState/, "Google Trends search result should expose evidence readiness state");
assert.match(toolRegistry, /search_tab_opening[\s\S]*search_tab_opened[\s\S]*search_page_reading[\s\S]*search_evidence_ready/, "browser search should report real tab-open/read/evidence stages");
assert.match(toolRegistry, /getSourceOrCurrentTab[\s\S]*read_current_page/, "current-page tools should prefer the workflow source tab over whichever temporary tab is active");
assert.match(toolRegistry, /closeTabQuietly\(tabId, protectedTabIds[\s\S]*isProtectedTabId\(tabId, protectedTabIds\)[\s\S]*return false/, "low-level tab close helper should refuse protected source tabs");
assert.match(toolRegistry, /search_source_tab_protected[\s\S]*protectedSourceTab/, "browser search auto-close should refuse to close the source tab and report the protection state");
assert.match(toolRegistry, /restoreSourceTabFocus[\s\S]*search_tab_closed/, "browser searches should restore focus to the source Ozon tab after closing temporary evidence tabs");
assert.match(toolRegistry, /protectedSourceTab[\s\S]*Refused to close source tab/, "close_tab must refuse to close the original source tab");
assert.match(toolRegistry, /protectedOzonTrendTab[\s\S]*Refused to close Ozon page/, "platform trends close_tab must refuse to close any Ozon page");
assert.match(toolRegistry, /openerTabId[\s\S]*chrome\.tabs\.create/, "workflow-created tabs should preserve the source tab as opener");
assert.equal(hasValidGoogleTrendsEvidence({
  ok: true,
  searchUrl: "https://trends.google.com/trends/explore?date=today%2012-m&geo=RU&q=%D0%BF%D0%BE%D0%BB%D0%BA%D0%B0",
  pageData: {
    url: "https://trends.google.com/trends/explore?date=today%2012-m&geo=RU&q=%D0%BF%D0%BE%D0%BB%D0%BA%D0%B0",
    title: "Google Trends",
    visibleText: "Google Trends Explore",
  },
}), false, "Google Trends shell pages should not count as reliable trend evidence");
assert.equal(hasValidGoogleTrendsEvidence({
  ok: true,
  searchUrl: "https://trends.google.com/trends/explore?date=today%2012-m&geo=RU&q=%D0%BF%D0%BE%D0%BB%D0%BA%D0%B0",
  pageData: {
    url: "https://trends.google.com/trends/explore?date=today%2012-m&geo=RU&q=%D0%BF%D0%BE%D0%BB%D0%BA%D0%B0",
    title: "Google Trends",
    visibleText: "Google Trends Explore Interest over time Related queries Related topics",
  },
}), true, "Google Trends evidence should require core trend modules, not just the shell");

assert.match(operationsTracker, /运营追踪硬门槛/, "Ozon operations tracker must include attribution gates");
assert.match(operationsTracker, /baseline_window/, "Ozon operations tracker must require baseline windows");
assert.match(operationsTracker, /没有优化前快照/, "Ozon operations tracker must reject attribution without baseline snapshots");

console.log("Etsy parity upgrade smoke passed.");
