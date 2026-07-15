/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// sidepanel.js — Ozon Growth Agent UI Controller

// ── State ──
let selectedSkill = null;
let isRunning = false;
let currentResultObj = null;
let currentExcelData = null;
let pastedTargetImageDataUrl = "";
let activeGrowthAction = null;
let availableSkills = [];
let sessionMode = "new";
let selectedResumeSessionKey = "";
let selectedResumeSessionMeta = null;

const WORKFLOW_CHECKPOINTS_KEY = "agentWorkflowCheckpoints";

const MODEL_HINTS = {
  openai: ["gpt-5.2-omni", "gpt-4o", "gpt-4o-mini", "o1-mini", "o3-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
  qwen: ["qwen3.7-max", "qwen3.6-plus", "qwen3.5-plus", "qwen-vl-max"],
  siliconflow: ["Qwen/Qwen2.5-VL-72B-Instruct", "Pro/deepseek-ai/DeepSeek-R1"],
  groq: ["llama-3.2-90b-vision-preview", "llama-3.3-70b-versatile"],
  custom: [],
};

const IMAGE_MODEL_HINTS = {
  openai: ["gpt-image-1"],
  qwen: ["wanx2.1-t2i-turbo", "wanx2.1-i2i-turbo"],
  siliconflow: ["black-forest-labs/FLUX.1-schnell"],
  custom: ["gpt-image-1"],
};

const PROVIDER_LINKS = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  qwen: "https://dashscope.console.aliyun.com/apiKey",
  siliconflow: "https://cloud.siliconflow.cn/account/ak",
  groq: "https://console.groq.com/keys"
};

const GROWTH_ACTIONS = {
  diagnose_store_growth: {
    label: "全店体检",
    skillId: "ozon_global_shop_optimizer",
    instruction: "一键体检当前 Ozon 店铺增长瓶颈。不能只凭截图下结论：请先读取平台属性、主营类目、价格带、目标客群、使用场景、店铺定位和视觉调性/格调，再结合 Seller API、Ozon 站内搜索/热卖榜、Yandex/Google RU 趋势，并打开 2-3 个同类高排名店铺或头部竞品页面做截屏学习；必须区分真实页面/API/搜索证据、AI推断和待验证假设。",
  },
  diagnose_sku_funnel: {
    label: "SKU 漏斗诊断",
    skillId: "ozon_operations_tracker",
    instruction: "诊断当前 Ozon SKU 的销售漏斗瓶颈。请区分曝光弱、点击弱、加购弱、付款弱、利润弱、履约风险和评论风险，并给出下一步实验动作。",
  },
  rewrite_listing: {
    label: "Listing 改版",
    skillId: "ozon_listing_generator",
    instruction: "基于当前 Ozon 页面或 Dashboard 选中的 SKU，生成俄语 SEO 标题、主图卖点文案、详情页描述和 Характеристики 补齐建议。",
  },
  diagnose_visual_conversion: {
    label: "首图诊断",
    skillId: "ozon_global_shop_optimizer",
    instruction: "诊断当前商品首图和画廊视觉转化力。请检查俄语卖点、中文残留、工厂图痕迹、规格表达、信任元素和竞品首图差距，并输出三种改版方向。",
  },
  scan_competitor_changes: {
    label: "竞品扫描",
    skillId: "ozon_global_shop_optimizer",
    instruction: "扫描当前竞品或店铺页面的价格、主图、评论、断货、促销和关键词变化，输出跟价、避战、抢量、反打评论痛点的机会卡。",
  },
  analyze_review_defects: {
    label: "评论缺陷",
    skillId: "ozon_review_analyzer",
    instruction: "分析俄罗斯买家评论与退换货风险，归因质量、包装、说明、规格、物流和预期差距，并生成产品改良任务。",
  },
  calculate_profit_guardrail: {
    label: "利润安全线",
    skillId: "ozon_sourcing_finder",
    instruction: "测算当前 Ozon 商品的建议售价、最低促销价、利润保护价、FBS/FBO 成本边界和是否需要独立寻源降本。",
  },
  filter_supplier_sources: {
    label: "货源筛选",
    skillId: "ozon_sourcing_finder",
    instruction: "基于当前 Ozon 商品、候选扩品方向或平台趋势机会筛选国内供应商货源。请重点验证同款/相似款图片匹配、规格一致、起批量、采购价、跨境物流、Ozon 佣金、关税和 RUB 净利润率；未获得真实供应商详情页时不得输出采购直达链接。",
  },
  detect_fulfillment_risk: {
    label: "履约风险",
    skillId: "ozon_operations_tracker",
    instruction: "扫描待发货倒计时、FBS/FBO 履约风险、断货风险、补货优先级和库存积压 SKU。",
  },
  find_expansion_opportunities: {
    label: "扩品机会",
    skillId: "ozon_product_opportunity_explorer",
    instruction: "从当前店铺、竞品、季节需求、差评痛点和供应链套利角度发现可上架或可小批测试的 Ozon 扩品机会。",
  },
  explore_platform_trends: {
    label: "平台趋势",
    skillId: "ozon_platform_trends",
    instruction: "扫描当前 Ozon 搜索、类目、品牌或热卖页面的平台商品机会和趋势窗口，识别价格带、评价门槛、头部商品共性、俄语关键词、季节性需求、Yandex/Google RU/Google Trends 证据或待验证假设；不要直接输出本店扩品执行清单。",
  },
  review_experiment_result: {
    label: "实验复盘",
    skillId: "ozon_operations_tracker",
    instruction: "复盘 Dashboard 增长实验，比较优化前后曝光、加购、订单、利润和履约指标，判断成功、无效或需二次优化；没有真实日期窗口时必须标注待验证。",
  },
};

// ── DOM refs ──
const $ = (id) => document.getElementById(id);

const views = {
  main: $("view-main"),
  settings: $("view-settings"),
  library: $("view-library"),
};

const SANITIZE_ALLOWED_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'DIV', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'CODE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BR', 'A', 'HR'];
const SANITIZE_ALLOWED_ATTR = ['href', 'class', 'target', 'rel', 'title', 'style'];
const SANITIZE_FORBID_TAGS = ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'MATH', 'TEMPLATE'];

function t(messageName, fallback = "") {
  try {
    return chrome.i18n?.getMessage(messageName) || fallback || messageName;
  } catch (_) {
    return fallback || messageName;
  }
}

function setElementText(selector, messageName, fallback) {
  const el = document.querySelector(selector);
  if (el) el.textContent = t(messageName, fallback);
}

function setButtonTextPreservingIcon(selector, messageName, fallback) {
  const el = document.querySelector(selector);
  if (!el) return;
  const label = t(messageName, fallback);
  const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) {
    textNode.textContent = ` ${label}`;
  } else {
    el.append(document.createTextNode(label));
  }
}

function applyI18n() {
  document.documentElement.lang = chrome.i18n?.getUILanguage?.() || "zh-CN";
  document.title = t("extName", "Ozon 增长 Agent");
  setElementText(".brand-name", "extName", "Ozon 增长 Agent");
  setElementText("#view-main > .section:nth-of-type(1) .section-label", "chooseSkill", "选择 Skill");
  setButtonTextPreservingIcon("#tipsBtn", "advancedTips", "高级玩法");
  const tipsBtn = $("tipsBtn");
  if (tipsBtn) tipsBtn.title = t("advancedTipsTitle", "指令高级玩法");
  const libraryBtn = $("libraryBtn");
  if (libraryBtn) libraryBtn.title = t("libraryTitle", "结果库");
  const dashboardBtn = $("dashboardBtn");
  if (dashboardBtn) dashboardBtn.title = t("dashboardTitle", "监控看板");
  const settingsBtn = $("settingsBtn");
  if (settingsBtn) settingsBtn.title = t("settingsTitle", "LLM 配置");
  setElementText(".run-btn-text", "runSkill", "执行 Skill");
  setElementText(".progress-title", "progressTitle", "Agent 运行中");
  setElementText("#cancelBtn", "cancel", "取消");
  setElementText(".result-title", "resultTitle", "执行结果");
  setElementText("#viewReportBtn", "report", "报告");
  setElementText("#viewDataBtn", "dataView", "数据视图");
  setElementText("#downloadBtn", "downloadPdf", "下载报告 (PDF)");
  setElementText("#downloadMdBtn", "exportMarkdown", "导出 Markdown");
  setElementText("#exportExcelBtn", "exportExcel", "导出 Excel");
  setElementText("#copyBtn", "copy", "复制");
  setElementText("#saveBtn", "save", "保存");
  setElementText("#clearBtn", "clear", "清除");
  setElementText("#backFromSettings", "back", "← 返回");
  setElementText("#backFromLibrary", "back", "← 返回");
  setElementText("#view-settings .view-title", "settingsTitle", "LLM 配置");
  setElementText("#view-library .view-title", "libraryTitle", "结果库");
  setElementText("#exportBtn", "exportJson", "导出 JSON");
}

function showView(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle("active", k === name);
  });
}

function createWorkflowSessionId() {
  return `workflow_session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getSessionTitle(checkpoint = {}) {
  const skillName = String(checkpoint.skillPath || checkpoint.skillId || "").split("/").pop()?.replace(".skill.md", "") || "Ozon workflow";
  const stage = checkpoint.lastStage || checkpoint.lastNode || checkpoint.status || "checkpoint";
  return `${skillName} · ${stage}`;
}

function updateSessionModeUI() {
  const modeText = $("sessionModeText");
  if (!modeText) return;
  if (sessionMode === "resume" && selectedResumeSessionKey) {
    modeText.textContent = `恢复历史会话：${getSessionTitle(selectedResumeSessionMeta || {})}`;
    modeText.classList.add("resume");
  } else {
    modeText.textContent = "新会话：不会沿用旧断点";
    modeText.classList.remove("resume");
  }
}

function startNewSessionMode() {
  sessionMode = "new";
  selectedResumeSessionKey = "";
  selectedResumeSessionMeta = null;
  updateSessionModeUI();
}

async function pickLatestResumableSessionForContinue() {
  const entries = await getWorkflowCheckpointEntries();
  const currentSkillId = selectedSkill?.id || "";
  const currentSkillPath = selectedSkill?.path || "";
  const actionId = activeGrowthAction?.id || "";
  const matched = entries.find(({ checkpoint }) => {
    const checkpointSkill = `${checkpoint.skillId || ""} ${checkpoint.skillPath || ""}`;
    const checkpointAction = String(checkpoint.growthActionId || "");
    if (actionId && checkpointAction === actionId) return true;
    if (currentSkillPath && checkpointSkill.includes(currentSkillPath)) return true;
    if (currentSkillId && checkpointSkill.includes(currentSkillId)) return true;
    return false;
  }) || entries[0];
  if (!matched) return null;
  sessionMode = "resume";
  selectedResumeSessionKey = matched.key;
  selectedResumeSessionMeta = matched.checkpoint;
  updateSessionModeUI();
  addLog("info", "↩", `已自动选择最近可恢复会话：${getSessionTitle(matched.checkpoint)}。`);
  return matched.key;
}

function getActiveResumeSessionKey() {
  return sessionMode === "resume" && selectedResumeSessionKey ? selectedResumeSessionKey : "";
}

async function getWorkflowCheckpointEntries() {
  const data = await new Promise((resolve) => chrome.storage.local.get([WORKFLOW_CHECKPOINTS_KEY], resolve));
  return Object.entries(data[WORKFLOW_CHECKPOINTS_KEY] || {})
    .map(([key, checkpoint]) => ({ key, checkpoint: checkpoint || {} }))
    .filter(({ checkpoint }) => !["completed", "cancelled"].includes(String(checkpoint.status || "")))
    .sort((a, b) => new Date(b.checkpoint.updatedAt || 0) - new Date(a.checkpoint.updatedAt || 0));
}

async function renderSessionHistory() {
  const list = $("sessionHistoryList");
  if (!list) return;
  const entries = await getWorkflowCheckpointEntries();
  if (!entries.length) {
    list.innerHTML = `<div class="session-empty">暂无可恢复会话。</div>`;
    return;
  }
  list.innerHTML = entries.slice(0, 12).map(({ key, checkpoint }) => {
    const updatedAt = checkpoint.updatedAt ? new Date(checkpoint.updatedAt).toLocaleString() : "未知时间";
    const status = checkpoint.status || "checkpoint";
    const step = checkpoint.step !== undefined ? ` · step ${checkpoint.step}` : "";
    return `
      <div class="session-history-item" data-session-key="${escapeHtml(key)}">
        <div class="session-history-title">${escapeHtml(getSessionTitle(checkpoint))}</div>
        <div class="session-history-meta">${escapeHtml(status)}${escapeHtml(step)} · ${escapeHtml(updatedAt)}</div>
        <div class="session-history-actions">
          <button type="button" class="session-resume-btn" data-session-key="${escapeHtml(key)}">恢复这个会话</button>
        </div>
      </div>
    `;
  }).join("");
  list.querySelectorAll(".session-resume-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sessionKey || "";
      const match = entries.find((entry) => entry.key === key);
      if (!match) return;
      sessionMode = "resume";
      selectedResumeSessionKey = key;
      selectedResumeSessionMeta = match.checkpoint;
      updateSessionModeUI();
      $("sessionHistoryPanel")?.classList.add("hidden");
      addLog("info", "↩", `已选择历史会话：${getSessionTitle(match.checkpoint)}。点击运行将从该断点恢复。`);
    });
  });
}

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  showView("main");
  applyI18n();
  await loadSkills();
  await loadGrowthActionQueue();
  await updatePageInfo();
  await loadSettings();
  updateSessionModeUI();
  bindEvents();
});

// ── Skills ──
async function loadSkills() {
  const skillList = $("skillList");
  const selectedContainer = $("selectedSkillContainer");
  
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_SKILLS" });
    if (!response?.ok || !response.skills?.length) {
      selectedContainer.innerHTML = `<div class="skill-loading">⚠ 未找到 skill 文件。请确认 skills/ 目录已包含 .skill.md 文件。</div>`;
      return;
    }

    availableSkills = response.skills;
    skillList.innerHTML = "";
    response.skills.forEach((skill) => {
      const card = document.createElement("div");
      card.className = "skill-card";
      card.dataset.skillPath = skill.path;
      card.innerHTML = `
        <span class="skill-icon">${skill.icon || "🤖"}</span>
        <div class="skill-info">
          <div class="skill-name">${skill.name}</div>
          <div class="skill-desc">${skill.description}</div>
        </div>
        <div class="skill-check">✓</div>
      `;
      card.addEventListener("click", (e) => {
        e.stopPropagation();
        activeGrowthAction = null;
        $("growthModeBadge").textContent = "手动 Skill";
        document.querySelectorAll(".growth-action-btn").forEach((btn) => btn.classList.remove("active"));
        selectSkill(skill, card);
        toggleDropdown(false);
      });
      skillList.appendChild(card);
    });

    // Auto-select first
    const firstCard = skillList.querySelector(".skill-card");
    if (firstCard) {
      selectSkill(response.skills[0], firstCard);
    }
  } catch (err) {
    selectedContainer.innerHTML = `<div class="skill-loading">⚠ ${err.message}</div>`;
  }
}

function findSkillById(skillId) {
  return availableSkills.find(skill => skill.id === skillId) || null;
}

function cssAttrEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function selectSkillById(skillId) {
  const skill = findSkillById(skillId);
  if (!skill) return false;
  const card = document.querySelector(`#skillList .skill-card[data-skill-path="${cssAttrEscape(skill.path)}"]`);
  selectSkill(skill, card);
  return true;
}

function selectSkill(skill, cardEl) {
  document.querySelectorAll("#skillList .skill-card").forEach((c) => c.classList.remove("selected"));
  if (cardEl) cardEl.classList.add("selected");
  
  selectedSkill = skill;
  
  if (cardEl) {
    const cloned = cardEl.cloneNode(true);
    cloned.classList.remove("selected");
    $("selectedSkillContainer").innerHTML = "";
    $("selectedSkillContainer").appendChild(cloned);
  }
  
  if (skill && skill.id === "omnichannel_traffic_planner") {
    $("trafficPlannerInputs").classList.remove("hidden");
    $("instruction").classList.add("hidden");
  } else {
    $("trafficPlannerInputs").classList.add("hidden");
    $("instruction").classList.remove("hidden");
  }

  const imageInputs = $("targetImageInputs");
  if (imageInputs) {
    imageInputs.classList.toggle("hidden", !isImageSourcingSkill(skill));
  }
  
  $("runBtn").disabled = false;
}

async function loadGrowthActionQueue() {
  const queue = $("growthActionQueue");
  if (!queue) return;
  const data = await new Promise((r) => chrome.storage.local.get(["growthActionRuns", "activeShopId", "ozonShops"], r));
  const shops = data.ozonShops || [];
  const activeShop = shops.find(shop => shop.id === data.activeShopId);
  const runs = (data.growthActionRuns || [])
    .filter(run => !run.shopId || !data.activeShopId || run.shopId === data.activeShopId)
    .slice(0, 4);

  $("sidepanelDataLedger").textContent = activeShop
    ? `活动店铺：${activeShop.name}；前台页面实时读取，Seller API 由 Dashboard 同步，AI 推断必须在报告证据账本中标注。`
    : "未绑定活动店铺；当前仅可读取前台页面，本地示例/推断不得作为真实经营证据。";

  if (!runs.length) {
    queue.innerHTML = `<div class="growth-queue-empty">Dashboard 创建的一键动作会出现在这里。</div>`;
    return;
  }
  queue.innerHTML = runs.map(run => `
    <button class="growth-queue-item" data-action="${escapeHtml(run.actionId)}" data-run-id="${escapeHtml(run.id)}">
      <span>${escapeHtml(run.title || "增长动作")}</span>
      <small>${escapeHtml(run.sku || "店铺级")} · ${new Date(run.createdAt || Date.now()).toLocaleTimeString()}</small>
    </button>
  `).join("");
  queue.querySelectorAll(".growth-queue-item").forEach((btn) => {
    btn.addEventListener("click", () => activateGrowthAction(btn.dataset.action, btn.dataset.runId));
  });
}

async function activateGrowthAction(actionId, runId = "") {
  const action = GROWTH_ACTIONS[actionId];
  if (!action) return;
  activeGrowthAction = { id: actionId, ...action, runId };

  selectSkillById(action.skillId);
  $("instruction").value = action.instruction;
  $("growthModeBadge").textContent = action.label;
  document.querySelectorAll(".growth-action-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.action === actionId);
  });
  $("runBtn").disabled = false;
  $("runBtn").querySelector(".run-btn-text").textContent = `运行：${action.label}`;

  if (runId) {
    const stored = await new Promise((r) => chrome.storage.local.get(["growthActionRuns"], r));
    const runs = stored.growthActionRuns || [];
    const match = runs.find(run => run.id === runId);
    if (match) {
      match.status = "selected_in_sidepanel";
      match.selectedAt = new Date().toISOString();
      await new Promise((r) => chrome.storage.local.set({ growthActionRuns: runs }, r));
    }
  }
}

function isImageSourcingSkill(skill) {
  return !!skill && [
    "domestic_sourcing_finder",
    "tiktok_shop_fastmoss_analyzer",
    "ozon_sourcing_finder"
  ].includes(skill.id);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function getTargetImageUrlForRun() {
  if (!isImageSourcingSkill(selectedSkill)) return "";

  const urlInput = $("targetImageUrl");
  const fileInput = $("targetImageFile");
  const status = $("targetImageStatus");
  const pastedUrl = urlInput?.value?.trim() || "";
  const file = fileInput?.files?.[0];

  if (pastedUrl) return pastedUrl;
  if (pastedTargetImageDataUrl) return pastedTargetImageDataUrl;
  if (!file) return "";

  if (status) {
    status.textContent = "已读取本地商品图，将优先用于以图搜源。";
    status.classList.remove("hidden");
  }
  return await readFileAsDataUrl(file);
}

function handleTargetImagePaste(event) {
  if (!isImageSourcingSkill(selectedSkill)) return;
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type && item.type.startsWith("image/"));
  if (!imageItem) return;

  const file = imageItem.getAsFile();
  if (!file) return;

  readFileAsDataUrl(file)
    .then((dataUrl) => {
      pastedTargetImageDataUrl = dataUrl;
      const status = $("targetImageStatus");
      if (status) {
        status.textContent = "已接收剪贴板商品图，将作为以图搜源兜底图。";
        status.classList.remove("hidden");
      }
    })
    .catch((err) => {
      const status = $("targetImageStatus");
      if (status) {
        status.textContent = `剪贴板图片读取失败：${err.message}`;
        status.classList.remove("hidden");
      }
    });
}

function toggleDropdown(forceState) {
  const trigger = $("skillDropdownTrigger");
  const menu = $("skillDropdownMenu");
  const isOpen = forceState !== undefined ? forceState : menu.classList.contains("hidden");
  
  if (isOpen) {
    menu.classList.remove("hidden");
    trigger.classList.add("open");
  } else {
    menu.classList.add("hidden");
    trigger.classList.remove("open");
  }
}

// ── Page Info ──
async function updatePageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.title) {
      $("pageInfo").textContent = `📄 ${tab.title.slice(0, 60)}${tab.title.length > 60 ? "…" : ""}`;
    }
  } catch (_) {}
}

// ── Run Skill ──
// ── Run Skill ──
let activePort = null;
let pingIntervalId = null;

function cleanupPort() {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
  if (activePort) {
    try {
      activePort.disconnect();
    } catch (_) {}
    activePort = null;
  }
  isRunning = false;
  const runBtn = $("runBtn");
  runBtn.innerHTML = `<span class="run-btn-icon">▶</span><span class="run-btn-text">${escapeHtml(t("runSkill", "执行 Skill"))}</span>`;
  runBtn.classList.remove("running");
  runBtn.disabled = false;
}

async function runSkill() {
  if (!selectedSkill || isRunning) return;

  isRunning = true;
  const runBtn = $("runBtn");
  runBtn.innerHTML = `<span class="spinner"></span><span class="run-btn-text">运行中...</span>`;
  runBtn.classList.add("running");
  runBtn.disabled = true;

  $("resultArea").classList.add("hidden");
  $("progressArea").classList.remove("hidden");
  $("progressLog").innerHTML = "";
  $("streamOutput").textContent = "";
  $("streamOutput").classList.add("hidden");

    addLog("start", "🚀", activeGrowthAction ? `执行增长动作: ${activeGrowthAction.label}` : `执行 Skill: ${selectedSkill.name}`);

  try {
    // Check API key first
    const settings = await new Promise((r) => chrome.storage.local.get(["apiKey", "llmModel"], r));
    if (!settings.apiKey) {
      throw new Error("未配置 API Key，请先前往设置页面填写。");
    }
    if (!settings.llmModel) {
      throw new Error("未配置 LLM 模型，请先前往设置页面填写。");
    }

    addLog("info", "📖", `建立 Agent 通信连接...`);
    
    // Connect to background Service Worker via Port
    activePort = chrome.runtime.connect({ name: "ozon-agent-loop" });

    // Start active pinging using one-time message (chrome.runtime.sendMessage) 
    // to reset MV3 Service Worker's idle timer, as port.postMessage does not count as activity in Chrome's idle timer.
    pingIntervalId = setInterval(() => {
      chrome.runtime.sendMessage({ type: "PING" }, () => {
        if (chrome.runtime.lastError) {
          // ignore or handle gracefully
        }
      });
    }, 8000); // ping every 8 seconds

    activePort.onMessage.addListener((message) => {
      if (message.type === "PROGRESS") {
        const msg = message.data;
        if (msg) {
          if (msg.type === "tool_call") {
            addLog("info", "⚙️", msg.message || `准备调用动作: ${msg.actionLabel || msg.toolName}`);
          } else if (msg.type === "tool_stage") {
            addLog("info", "↪", msg.message || `${msg.actionLabel || msg.toolName || "工具"} 正在执行`);
          } else if (msg.type === "checkpoint_restored") {
            addLog("info", "↩", msg.message || "已恢复上次中断的 workflow");
          } else if (msg.type === "tool_heartbeat") {
            addLog("info", "⏱", msg.message || `${msg.toolName || "工具"} 仍在执行`);
          } else if (msg.type === "tool_timeout") {
            addLog("warning", "⏸", msg.message || `${msg.actionLabel || msg.toolName || "工具"} 超时，已回收临时标签页`);
          } else if (msg.type === "stale_tool_result_discarded") {
            addLog("warning", "↩", msg.message || "已丢弃旧 workflow 的迟到结果");
          } else if (msg.type === "reflection" || msg.type === "thinking") {
            let emoji = "🕵️";
            const txt = msg.message || "";
            if (txt.includes("自动化") || txt.includes("流程")) emoji = "🔄";
            if (txt.includes("数据") || txt.includes("同步")) emoji = "💾";
            if (txt.includes("AI") || txt.includes("审计")) emoji = "🤖";
            addLog("warning", emoji, txt);
          } else if (msg.type === "streaming") {
            const streamEl = $("streamOutput");
            streamEl.classList.remove("hidden");
            if (msg.isReasoning) {
               streamEl.innerHTML = `<div style="color:var(--warning); font-size:12px;">🧠 深度推理中...<br>${escapeHtml(msg.fullText)}</div>`;
            } else {
               streamEl.innerHTML = `<div style="color:var(--text2); font-size:12px;">正在生成...<br>${escapeHtml(msg.fullText)}</div>`;
            }
            streamEl.scrollTop = streamEl.scrollHeight;
          }
        }
      } else if (message.type === "SUCCESS") {
        if (typeof removeCaptchaAlertBanner === "function") removeCaptchaAlertBanner();
        addLog("success", "✅", `完成 (${message.result.steps || "?"} 步)`);
        if (selectedSkill && (selectedSkill.id === "ecommerce_monitor" || selectedSkill.id === "tiktok_shop_monitor")) {
          addLog("success", "📊", "监控数据处理成功！您可以点击顶部监控大盘查看折线图与变动分析。");
        }
        showResult(message.result);
        cleanupPort();
      } else if (message.type === "ERROR") {
        if (typeof removeCaptchaAlertBanner === "function") removeCaptchaAlertBanner();
        addLog("error", "❌", `错误: ${message.error}`);
        showError(message.error);
        cleanupPort();
      }
    });

    activePort.onDisconnect.addListener(() => {
      if (isRunning) {
        addLog("info", "⏹", "连接已中断（任务已取消或 Service Worker 重启）");
        cleanupPort();
      }
    });

    addLog("info", "🌐", "发送指令并读取页面上下文...");
    
    let userInstruction = "";
    if (selectedSkill && selectedSkill.id === "omnichannel_traffic_planner") {
      const platforms = Array.from(document.querySelectorAll('.platform-cb:checked')).map(cb => cb.value).join(", ");
      const budget = $("trafficBudget").value.trim();
      const currency = $("trafficCurrency").value;
      const duration = $("trafficDuration").value.trim();
      const cost = $("trafficProductCost").value.trim();
      const proof = $("trafficSocialProof").value.trim();
      const extra = $("trafficExtra").value.trim();
      
      userInstruction = `【结构化投流参数】
投流平台: ${platforms || '自动智能分析分配'}
总预算: ${budget ? `${budget} ${currency}` : '使用默认测试预算'}
投放周期: ${duration ? `${duration}天` : '使用默认测试周期'}
产品采购单成本: ${cost ? `${cost} 元` : '未指定（由财务官根据类目均值推算）'}
店铺/单品销量背书: ${proof || '未指定'}
其它补充要求: ${extra || '无'}`;
    } else {
      userInstruction = $("instruction").value.trim();
    }

    const targetImageUrl = await getTargetImageUrlForRun();
    const legacyContinueInstruction = /^(继续|继续推进|恢复|resume|continue)$/i.test(userInstruction.trim());
    let resumeSessionKey = getActiveResumeSessionKey();
    if (!resumeSessionKey && legacyContinueInstruction) {
      resumeSessionKey = await pickLatestResumableSessionForContinue();
    }
    const shouldContinueSession = Boolean(resumeSessionKey || legacyContinueInstruction);
    const workflowSessionId = resumeSessionKey
      ? resumeSessionKey
      : createWorkflowSessionId();

    activePort.postMessage({
      type: "RUN_SKILL",
      skillPath: selectedSkill.path,
      growthActionId: activeGrowthAction?.id || "",
      workflowSessionId,
      userInstruction: userInstruction,
      targetImageUrl,
      continueSession: Boolean(shouldContinueSession),
      forceNewSession: !shouldContinueSession,
      highRandomness: $("highRandomnessCheckbox").checked,
      negativeFilter: $("negativeFilterCheckbox").checked,
    });

  } catch (err) {
    addLog("error", "❌", `错误: ${err.message}`);
    showError(err.message);
    cleanupPort();
  }
}

function addLog(type, icon, text) {
  const log = $("progressLog");
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  
  let formattedText = escapeHtml(maskApiKeys(text));
  if (text.startsWith("[阶段 1：智能选品]")) {
    formattedText = formattedText.replace("[阶段 1：智能选品]", `<span style="background:var(--warning); color:#000; padding:2px 6px; border-radius:3px; font-weight:bold; font-size:10px; margin-right:4px; border:1px solid rgba(0,0,0,0.1);">选品阶段</span>`);
  } else if (text.startsWith("[阶段 2：供应链寻源]")) {
    formattedText = formattedText.replace("[阶段 2：供应链寻源]", `<span style="background:var(--success); color:#fff; padding:2px 6px; border-radius:3px; font-weight:bold; font-size:10px; margin-right:4px;">寻源阶段</span>`);
  }
  
  entry.innerHTML = `<span class="log-icon">${icon}</span><span class="log-text">${formattedText}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function showResult(response) {
  $("resultArea").classList.remove("hidden");
  const content = $("resultContent");
  const grid = $("resultGrid");
  const report = $("resultReport");
  let jsonStr = "";
  
  // Store raw result for downloading
  currentResultObj = normalizeFinalOutput(response.result);

  if (response.type === "text") {
    jsonStr = response.result;
    content.textContent = jsonStr;
    grid.innerHTML = `<div class="empty-text">结果为纯文本，无表格数据。</div>`;
    const renderedReportHtml = renderMarkdown(jsonStr);
    report.innerHTML = sanitizeHtml(`<div class="report-text-wrapper">${renderedReportHtml}</div>`);
    
    if (renderedReportHtml.includes("<table")) {
      $("exportExcelBtn").classList.remove("hidden");
    } else {
      $("exportExcelBtn").classList.add("hidden");
    }
    
    $("viewReportBtn").click();
  } else {
    try {
      jsonStr = typeof response.result === "string"
        ? response.result
        : JSON.stringify(response.result, null, 2);
      const formatted = syntaxHighlightJSON(jsonStr);
      content.innerHTML = formatted;
      
      let rawData = normalizeFinalOutput(typeof response.result === "string" ? JSON.parse(response.result) : response.result);
      currentResultObj = rawData;
      
      // Check if there are guide overlays to render in active page
      if (rawData && Array.isArray(rawData.guides)) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: "RENDER_GUIDE_OVERLAYS",
              guides: rawData.guides
            }, (res) => {
              if (chrome.runtime.lastError) {
                console.warn("Guide overlay injection error:", chrome.runtime.lastError.message);
              } else if (res && res.ok) {
                addLog("info", "💡", `已在目标网页对应的 DOM 元素上成功绘制 ${res.count} 个 AI 新手投流引导浮层！`);
              }
            });
          }
        });
      }
      
      // Render Report
      let hasReport = false;
      for (const key in rawData) {
        if (rawData[key] !== null && typeof rawData[key] !== 'object') {
          hasReport = true;
          break;
        }
      }
      
      let reportHtml = "";
      if (hasReport) {
        reportHtml = renderReport(rawData);
        report.innerHTML = sanitizeHtml(reportHtml);
      } else {
        report.innerHTML = `<div class="empty-text">结果未包含标准报告字段，请查看 JSON 或 表格。</div>`;
      }
      
      let targetArray = null;
      if (Array.isArray(rawData)) {
        targetArray = rawData;
      } else if (rawData.data && Array.isArray(rawData.data)) {
        targetArray = rawData.data;
      } else if (rawData && typeof rawData === 'object') {
        for (const key in rawData) {
          if (Array.isArray(rawData[key])) {
            targetArray = rawData[key];
            break;
          }
        }
      }

      currentExcelData = targetArray;
      if (targetArray && targetArray.length > 0 && typeof targetArray[0] === 'object') {
        grid.innerHTML = sanitizeHtml(renderGrid(targetArray));
        $("exportExcelBtn").classList.remove("hidden");
        if (!hasReport) $("viewGridBtn").click();
      } else {
        if (reportHtml.includes("<table")) {
          $("exportExcelBtn").classList.remove("hidden");
        } else {
          $("exportExcelBtn").classList.add("hidden");
        }
        grid.innerHTML = `<div class="empty-text">当前结果没有结构化数组数据，无法显示为表格。</div>`;
      }
      
      if (hasReport) {
        if ($("viewReportBtn")) $("viewReportBtn").click();
      } else if (!hasReport && (!targetArray || targetArray.length === 0)) {
        if ($("viewDataBtn")) $("viewDataBtn").click();
      }
    } catch (_) {
      const fallback = normalizeFinalOutput(response.result);
      content.textContent = typeof fallback === "string" ? fallback : JSON.stringify(fallback, null, 2);
      grid.innerHTML = `<div style="padding: 12px; color: var(--text2);">解析失败。</div>`;
      if (fallback && typeof fallback === "object" && (fallback.overview || fallback.analysis || fallback.summary)) {
        report.innerHTML = sanitizeHtml(renderReport(fallback));
      } else {
        report.innerHTML = `<div style="padding: 12px; color: var(--text2);">解析失败。</div>`;
      }
      if ($("viewReportBtn")) $("viewReportBtn").click();
    }
  }
}

function normalizeFinalOutput(value) {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return { overview: current };
      }
      try {
        current = JSON.parse(trimmed);
        continue;
      } catch (_) {
        return { overview: current };
      }
    }
    if (current && typeof current === "object" && current.type === "final" && current.output && typeof current.output === "object") {
      current = current.output;
      continue;
    }
    if (current && typeof current === "object" && current.result && typeof current.result === "object") {
      current = current.result;
      continue;
    }
    break;
  }
  return current && typeof current === "object" ? current : { overview: String(current || "") };
}

function renderMarkdown(text) {
  if (!text) return "";
  if (typeof marked !== 'undefined') {
    return marked.parse(String(text));
  }
  let html = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.*$)/gim, '<h3 style="margin-top:12px;margin-bottom:8px;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="margin-top:16px;margin-bottom:10px;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="margin-bottom:12px;">$1</h1>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/`([^`]*)`/gim, '<code style="background:#eee;padding:2px 4px;border-radius:3px;color:#d63200;">$1</code>')
    .replace(/^\- (.*$)/gim, '<li style="margin-left:20px;">$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li style="margin-left:20px;">$1</li>');
    
  html = html.replace(/(<li.*<\/li>\n?)+/gim, '<ul style="margin-bottom:10px;">$&</ul>');
  
  html = html.split('\n\n').map(p => {
    p = p.trim();
    if (!p) return '';
    if (p.startsWith('<h') || p.startsWith('<ul')) return p;
    return `<p style="margin-bottom:10px;line-height:1.5;">${p}</p>`;
  }).join('\n');
  
  return html;
}

function renderReport(resultObj) {
  let html = '';
  const standardKeys = ['overview', 'analysis', 'summary'];
  const renderedKeys = new Set();
  
  const renderSection = (key, val) => {
    let title = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
    // Handle standard keys without titles if preferred, but adding title makes it robust for random keys
    let titleHtml = standardKeys.includes(key) ? '' : `<h3 style="margin-top:10px;margin-bottom:5px;font-size:1.1em;color:var(--text);">${escapeHtml(title)}</h3>`;
    return `${titleHtml}<div class="report-section" style="padding:10px;background:var(--bg3);border-radius:6px;margin-bottom:10px;">${renderMarkdown(String(val))}</div>`;
  };

  // Render standard keys first
  standardKeys.forEach(k => {
    if (resultObj[k] !== undefined && resultObj[k] !== null && typeof resultObj[k] !== 'object') {
      html += renderSection(k, resultObj[k]);
      renderedKeys.add(k);
    }
  });

  const skipKeys = ['type', 'output', 'guides', 'data'];
  // Render any remaining primitive keys (like verdict, total_score)
  for (const key in resultObj) {
    if (!renderedKeys.has(key) && !skipKeys.includes(key) && resultObj[key] !== undefined && resultObj[key] !== null && typeof resultObj[key] !== 'object') {
      html += renderSection(key, resultObj[key]);
    }
  }
  return html;
}

const KEY_TRANSLATIONS = {
  // Competitor & Review Keys
  "entity_type": "卡片类型",
  "product_name": "商品名称",
  "price_range_usd": "价格区间 (USD)",
  "rating_score": "评分分值",
  "review_count": "评论数量",
  "positive_rate": "好评占比",
  "negative_rate": "差评占比",
  "key_strengths": "核心优势",
  "key_weaknesses": "核心弱点/痛点",
  "target_user_profile": "目标客群画像",
  "usage_scenarios": "典型使用场景",
  "buyer_emotional_words": "买家情感高频词",
  "buyer_pain_quotes": "买家痛点真实引言",
  "improvement_blueprint": "产品改良蓝图",
  "estimated_bom_increase_usd": "估算 BOM 增加成本 (USD)",
  "certification_risks": "合规与认证风险",
  "differentiation_idea": "差异化商业模式/卖点",
  "risk_level": "风控评级",
  
  // Competitor General
  "positioning": "市场定位",
  "price_ratio_vs_oe": "原厂价格对比",
  "competitive_advantage": "竞争优势",
  "accessory_ecosystem": "配件生态",
  "estimated_annual_accessory_cost": "年配件估算成本",
  // Sourcing & Traffic Planner Keys
  "target_product": "目标商品",
  "target product": "目标商品",
  "supplier_name": "供应商名称",
  "supplier name": "供应商名称",
  "product_title": "货源商品标题",
  "product title": "货源商品标题",
  "price_rmb": "价格(RMB)",
  "price rmb": "价格(RMB)",
  "moq": "起批量",
  "rating": "商家信用/评级",
  "product_link": "货源直达链接",
  "product link": "货源直达链接",
  "audit_score": "采购推荐指数",
  "audit score": "采购推荐指数",
  "audit_comment": "审计建议/会审意见",
  "audit comment": "审计建议/会审意见",
  "role": "会审角色",
  "audit_status": "审计状态",
  "audit_item": "会审项目",
  "key_metrics": "核心指标",
  "risk_warning": "风控预警/警告",
  "actionable_tasks": "实操待办任务",
  "audience_and_marketing": "受众画像与营销卖点",
  "potential_score": "潜力评分",
  "trend_evidence": "爆发逻辑与得分依据",

  // Blueprint / Product General
  "product_blueprint_id": "产品蓝图 ID",
  "name": "名称",
  "title": "标题",
  "target_price": "目标售价",
  "estimated_bom_cost": "估算 BOM 成本",
  "gross_margin": "毛利率",
  "key_improvements": "关键改良建议",
  "warranty_recommendation": "质保推荐",
  "expected_lifespan": "预期寿命",
  "subscription_model": "订阅/增值模型",
  "risk_assessment": "风控评估",
  
  // Failure / Risk Details
  "failure_analysis": "潜在故障分析",
  "suspected_components": "疑似受影响部件",
  "component": "部件",
  "failure_mode": "故障模式",
  "confidence": "置信度",
  "user_mitigation_mentioned": "用户提及缓解方案",
  "design_flaw_indicator": "设计缺陷指标",
  
  // Common terms
  "description": "描述",
  "price": "价格",
  "item": "品类/项",
  "frequency": "使用频率",
  "cost_impact": "成本影响",
  "reliability_impact": "可靠性影响",
  "feature": "功能/改良点",
  "priority": "优先级",
  "cost": "成本",
  
  // Marketing & Timeline
  "pricing_strategy": "定价策略",
  "product_improvement_suggestions": "产品改良建议",
  "marketing_angles": "营销切入点",
  "competitive_timeline": "竞争时间线",
  "tiers": "定价梯队",
  "cost_structure": "成本结构",
  "angle": "营销卖点",
  "target": "受众痛点",
  "channel": "推广渠道",
  "phase_1_0_6months": "阶段一 (0-6个月)",
  "phase_2_6_12months": "阶段二 (6-12个月)",
  "phase_3_12_18months": "阶段三 (12-18个月)",
  "phase_4_18_24months": "阶段四 (18-24个月)"
};

function translateKey(key) {
  const normalized = String(key).toLowerCase().trim();
  if (KEY_TRANSLATIONS[normalized]) {
    return KEY_TRANSLATIONS[normalized];
  }
  const cleaned = normalized.replace(/_/g, ' ');
  if (KEY_TRANSLATIONS[cleaned]) {
    return KEY_TRANSLATIONS[cleaned];
  }
  return key.replace(/_/g, ' ').toUpperCase();
}

function formatValue(val, depth = 0) {
  if (val === undefined || val === null) return "";
  
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    if (typeof val[0] !== 'object') {
      return val.map(x => escapeHtml(String(x))).join(', ');
    }
    let html = '<ul style="margin: 4px 0; padding-left: 16px; list-style-type: disc; text-align: left;">';
    val.forEach(item => {
      html += `<li style="margin-bottom: 6px; text-align: left;">${formatValue(item, depth + 1)}</li>`;
    });
    html += '</ul>';
    return html;
  }
  
  if (typeof val === 'object') {
    let html = '<div style="margin: 2px 0; line-height: 1.4; text-align: left;">';
    const entries = Object.entries(val);
    entries.forEach(([k, v]) => {
      const translatedKey = translateKey(k);
      if (typeof v === 'object' && v !== null) {
        html += `<div style="margin-top: 4px; margin-bottom: 2px; text-align: left;"><strong>${escapeHtml(translatedKey)}:</strong></div>`;
        html += `<div style="padding-left: 10px; border-left: 2px solid var(--border); margin-bottom: 4px; text-align: left;">${formatValue(v, depth + 1)}</div>`;
      } else {
        html += `<div style="margin-bottom: 2px; text-align: left;"><strong>${escapeHtml(translatedKey)}:</strong> ${escapeHtml(String(v))}</div>`;
      }
    });
    html += '</div>';
    return html;
  }
  
  const textVal = String(val);
  if (typeof marked !== 'undefined' && depth === 0) {
    return marked.parseInline(textVal);
  }
  return escapeHtml(textVal);
}

function renderGrid(dataArray) {
  if (!dataArray || dataArray.length === 0) return "";
  
  let html = "";
  
  dataArray.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    
    const itemName = item.name || item.title || item.product_blueprint_id || item.item || `分析项 ${index + 1}`;
    
    html += `<div class="data-card" style="margin-bottom: 25px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg3); box-shadow: 0 1px 3px rgba(0,0,0,0.05); text-align: left;">`;
    
    // Card Header
    html += `<div style="background: var(--bg2); padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600; color: var(--text); font-size: 13px; display: flex; align-items: center; gap: 8px; text-align: left;">`;
    html += `<span style="color: var(--accent);">📦</span> ${escapeHtml(String(itemName))}</div>`;
    
    // Card Body (Vertical Property List Table)
    html += '<table style="width: 100%; border-collapse: collapse; margin: 0; font-size: 12px; table-layout: fixed; text-align: left;">';
    html += '<tbody>';
    
    Object.entries(item).forEach(([key, val]) => {
      const translatedKey = translateKey(key);
      
      html += `<tr style="border-bottom: 1px solid var(--border); text-align: left;">`;
      html += `<td style="width: 160px; padding: 10px 12px; background: var(--bg2); font-weight: 600; color: var(--text2); vertical-align: top; border-right: 1px solid var(--border); white-space: nowrap; text-align: left;">${escapeHtml(translatedKey)}</td>`;
      html += `<td style="padding: 10px 12px; color: var(--text); vertical-align: top; line-height: 1.5; text-align: left; word-break: break-all; word-wrap: break-word; overflow-wrap: break-word;">${formatValue(val)}</td>`;
      html += '</tr>';
    });
    
    html += '</tbody></table></div>';
  });
  
  return html;
}

function showError(msg) {
  $("resultArea").classList.remove("hidden");
  $("resultContent").innerHTML = `<span style="color:var(--danger)">❌ ${escapeHtml(maskApiKeys(msg))}</span>`;
}

function syntaxHighlightJSON(json) {
  return json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = "json-number";
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = "json-key";
          } else {
            cls = "json-string";
          }
        } else if (/true|false/.test(match)) {
          cls = "json-bool";
        } else if (/null/.test(match)) {
          cls = "json-null";
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
}

// ── Save Result ──
async function saveCurrentResult() {
  const content = $("resultContent");
  if (!content.textContent.trim() && !currentResultObj) return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    // Direct save via storage (removed broken runtime sendMessage call)
    const existing = await new Promise((r) => chrome.storage.local.get(["savedResults"], r));
    const savedResults = existing.savedResults || [];
    savedResults.unshift({
      id: Date.now(),
      createdAt: new Date().toISOString(),
      skillName: selectedSkill?.name || "Unknown Skill",
      skillId: selectedSkill?.id || selectedSkill?.path || "",
      url: tab?.url || "",
      pageTitle: tab?.title || "",
      result: maskSensitiveData(currentResultObj || content.textContent),
    });
    await new Promise((r) => chrome.storage.local.set({ savedResults: savedResults.slice(0, 100) }, r));

    const saveBtn = $("saveBtn");
    saveBtn.textContent = "已保存 ✓";
    saveBtn.style.background = "var(--success)";
    saveBtn.style.color = "white";
    setTimeout(() => {
      saveBtn.textContent = t("save", "保存");
      saveBtn.style.background = "";
      saveBtn.style.color = "";
    }, 2000);
  } catch (err) {
    alert("保存失败: " + err.message);
  }
}

// ── Library ──
async function loadLibrary() {
  const list = $("libraryList");
  list.innerHTML = `<div class="skill-loading"><span class="spinner"></span> 加载...</div>`;

  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SAVED_RESULTS", limit: 50 });
    const results = response.data || [];

    if (!results.length) {
      list.innerHTML = `<div class="empty-state">📭 暂无保存的结果</div>`;
      return;
    }

    list.innerHTML = "";
    results.forEach((item) => {
      const card = document.createElement("div");
      card.className = "library-card";
      const date = new Date(item.createdAt).toLocaleString("zh-CN");
      const preview = (typeof item.result === "string" ? item.result : JSON.stringify(item.result)).slice(0, 80);

      card.innerHTML = `
        <div class="library-card-header">
          <span class="library-card-title">${escapeHtml(item.skillName || "结果")}</span>
          <span class="library-card-date">${date}</span>
        </div>
        <div class="library-card-preview">${escapeHtml(item.pageTitle || item.url || "")} — ${escapeHtml(preview)}...</div>
        <div class="library-card-actions">
          <button class="lib-btn" data-action="copy" data-id="${item.id}">复制</button>
          <button class="lib-btn danger" data-action="delete" data-id="${item.id}">删除</button>
        </div>
      `;

      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        let parsedResult;
        try {
          parsedResult = JSON.parse(item.result);
        } catch (_) {
          parsedResult = item.result;
        }

        showResult({
          type: typeof parsedResult === "string" ? "text" : "json",
          result: parsedResult
        });
        showView("main");
      });

      card.querySelector('[data-action="copy"]').addEventListener("click", (e) => {
        e.stopPropagation();
        const text = typeof item.result === "string" ? item.result : JSON.stringify(item.result, null, 2);
        navigator.clipboard.writeText(text);
        e.target.textContent = "已复制 ✓";
        setTimeout(() => { e.target.textContent = "复制"; }, 1500);
      });

      card.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({ type: "DELETE_RESULT", id: item.id });
        card.remove();
        if (!list.querySelector(".library-card")) {
          list.innerHTML = `<div class="empty-state">📭 暂无保存的结果</div>`;
        }
      });

      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-state">⚠ ${err.message}</div>`;
  }
}

// ── Settings ──
async function loadSettings() {
  const s = await new Promise((r) =>
    chrome.storage.local.get(["apiKey", "llmProvider", "llmModel", "imageGenerationModel", "llmBaseUrl", "maxLoopSteps", "temperature", "helium10ApiKey", "sellerSpriteApiKey", "fastmossApiKey"], r)
  );

  if (s.llmProvider) $("llmProvider").value = s.llmProvider;
  if (s.llmModel) $("llmModel").value = s.llmModel;
  if (s.imageGenerationModel) $("imageGenerationModel").value = s.imageGenerationModel;
  if (s.apiKey) $("apiKey").value = s.apiKey;
  if (s.llmBaseUrl) $("llmBaseUrl").value = s.llmBaseUrl;
  if (s.maxLoopSteps) $("maxLoopSteps").value = s.maxLoopSteps;
  if (s.temperature !== undefined) {
    $("temperature").value = s.temperature;
    $("tempValue").textContent = s.temperature;
  }
  if (s.helium10ApiKey) $("helium10ApiKey").value = s.helium10ApiKey;
  if (s.sellerSpriteApiKey) $("sellerSpriteApiKey").value = s.sellerSpriteApiKey;
  if (s.fastmossApiKey) $("fastmossApiKey").value = s.fastmossApiKey;

  updateProviderUI(s.llmProvider || "openai");
  updateApiStatusUI(s.helium10ApiKey, s.sellerSpriteApiKey, s.fastmossApiKey);
  await loadUpdateStatus();
}

function formatUpdateTime(value) {
  if (!value) return "尚未检查";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "检查时间未知";
  return `上次检查：${parsed.toLocaleString()}`;
}

function renderUpdateStatus(status = {}) {
  const currentVersion = status.currentVersion || chrome.runtime.getManifest?.().version || "-";
  const latestVersion = status.latestVersion || currentVersion;
  const badge = $("updateStatusBadge");
  const text = $("updateStatusText");
  const current = $("currentVersionText");
  const latest = $("latestVersionText");
  const checkedAt = $("updateCheckedAt");
  const error = $("updateErrorText");
  const releaseLink = $("openReleasesLink");

  if (current) current.textContent = currentVersion;
  if (latest) latest.textContent = latestVersion;
  if (checkedAt) checkedAt.textContent = formatUpdateTime(status.checkedAt);
  if (releaseLink && status.releaseUrl) releaseLink.href = status.releaseUrl;

  if (error) {
    error.textContent = status.error ? `检查失败：${status.error}` : "";
    error.classList.toggle("hidden", !status.error);
  }

  if (!badge || !text) return;
  badge.classList.remove("available", "current", "failed");
  if (status.status === "update_available" || status.hasUpdate) {
    badge.textContent = "可更新";
    badge.classList.add("available");
    text.textContent = `发现新版本 ${latestVersion}，可前往 GitHub Releases 下载并重新加载扩展。`;
  } else if (status.status === "check_failed") {
    badge.textContent = "失败";
    badge.classList.add("failed");
    text.textContent = "暂时无法读取 GitHub 版本信息，插件本地功能不受影响。";
  } else if (status.status === "unknown") {
    badge.textContent = "未检查";
    text.textContent = "尚未完成 GitHub 版本检查。";
  } else {
    badge.textContent = "最新";
    badge.classList.add("current");
    text.textContent = "当前已是最新公开版本。";
  }
}

async function loadUpdateStatus({ force = false } = {}) {
  try {
    const type = force ? "CHECK_FOR_UPDATES" : "GET_UPDATE_STATUS";
    const response = await chrome.runtime.sendMessage({ type, force });
    if (response?.ok) {
      renderUpdateStatus(response.data || {});
    } else {
      renderUpdateStatus({
        currentVersion: chrome.runtime.getManifest?.().version || "-",
        status: "check_failed",
        error: response?.error || "更新状态读取失败",
      });
    }
  } catch (err) {
    renderUpdateStatus({
      currentVersion: chrome.runtime.getManifest?.().version || "-",
      status: "check_failed",
      error: err.message,
    });
  }
}

function updateApiStatusUI(h10Key, ssKey, fmKey) {
  const badge = $("apiStatusBadge");
  if (!badge) return;
  if (h10Key || ssKey || fmKey) {
    badge.textContent = "三方数据: 已激活";
    badge.style.background = "#d1fae5";
    badge.style.color = "#065f46";
  } else {
    badge.textContent = "三方数据: 未激活";
    badge.style.background = "#f1f5f9";
    badge.style.color = "#64748b";
  }
}

function updateProviderUI(provider) {
  $("customUrlGroup").style.display = provider === "custom" ? "block" : "none";
  
  const linkEl = $("providerLink");
  if (PROVIDER_LINKS[provider]) {
    linkEl.href = PROVIDER_LINKS[provider];
    linkEl.style.display = "inline";
  } else {
    linkEl.style.display = "none";
  }

  const hints = MODEL_HINTS[provider] || [];
  const hintContainer = $("modelHints");
  hintContainer.innerHTML = hints
    .map((m) => `<span class="model-hint-chip" data-model="${m}">${m}</span>`)
    .join("");
  hintContainer.querySelectorAll(".model-hint-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("llmModel").value = chip.dataset.model;
    });
  });

  const imageHints = IMAGE_MODEL_HINTS[provider] || [];
  const imageHintContainer = $("imageModelHints");
  if (imageHintContainer) {
    imageHintContainer.innerHTML = imageHints
      .map((m) => `<span class="model-hint-chip" data-model="${m}">${m}</span>`)
      .join("");
    imageHintContainer.querySelectorAll(".model-hint-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $("imageGenerationModel").value = chip.dataset.model;
      });
    });
  }
}

async function saveSettings() {
  const apiKey = $("apiKey").value.trim();
  const llmProvider = $("llmProvider").value;
  const llmModel = $("llmModel").value.trim();
  const imageGenerationModel = $("imageGenerationModel").value.trim();
  const llmBaseUrl = $("llmBaseUrl").value.trim();
  const maxLoopSteps = $("maxLoopSteps").value;
  const temperature = $("temperature").value;
  const helium10ApiKey = $("helium10ApiKey").value.trim();
  const sellerSpriteApiKey = $("sellerSpriteApiKey").value.trim();
  const fastmossApiKey = $("fastmossApiKey").value.trim();

  const msg = $("settingsMsg");

  if (!apiKey || !llmModel) {
    msg.textContent = "请填写 API Key 和模型名称";
    msg.className = "settings-msg error";
    msg.classList.remove("hidden");
    return;
  }

  await new Promise((r) =>
    chrome.storage.local.set({ 
      apiKey, 
      llmProvider, 
      llmModel, 
      imageGenerationModel,
      llmBaseUrl, 
      maxLoopSteps, 
      temperature,
      helium10ApiKey,
      sellerSpriteApiKey,
      fastmossApiKey
    }, r)
  );

  $("apiKey").type = "password";
  $("helium10ApiKey").type = "password";
  $("sellerSpriteApiKey").type = "password";
  $("fastmossApiKey").type = "password";
  document.activeElement?.blur?.();

  msg.textContent = "✓ 设置已保存";
  msg.className = "settings-msg success";
  msg.classList.remove("hidden");
  
  updateApiStatusUI(helium10ApiKey, sellerSpriteApiKey, fastmossApiKey);
  
  setTimeout(() => msg.classList.add("hidden"), 2000);
}

// ── Events ──
function bindEvents() {
  $("runBtn").addEventListener("click", runSkill);

  document.querySelectorAll(".growth-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateGrowthAction(btn.dataset.action));
  });
  
  $("skillDropdownTrigger").addEventListener("click", () => toggleDropdown());
  document.addEventListener("click", (e) => {
    const dropdown = $("skillDropdown");
    if (dropdown && !dropdown.contains(e.target)) {
      toggleDropdown(false);
    }
  });

  $("settingsBtn").addEventListener("click", () => showView("settings"));
  $("dashboardBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  });
  $("backFromSettings").addEventListener("click", () => showView("main"));

  $("libraryBtn").addEventListener("click", () => {
    showView("library");
    loadLibrary();
  });
  $("backFromLibrary").addEventListener("click", () => showView("main"));
  $("newSessionBtn")?.addEventListener("click", () => {
    startNewSessionMode();
    $("sessionHistoryPanel")?.classList.add("hidden");
    addLog("info", "+", "已切换为新会话：下一次运行不会沿用旧断点。");
  });
  $("sessionHistoryBtn")?.addEventListener("click", async () => {
    const panel = $("sessionHistoryPanel");
    if (!panel) return;
    const willShow = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !willShow);
    if (willShow) await renderSessionHistory();
  });

  $("saveSettings").addEventListener("click", saveSettings);
  $("checkUpdateBtn")?.addEventListener("click", async () => {
    const btn = $("checkUpdateBtn");
    const previousText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "检查中...";
    await loadUpdateStatus({ force: true });
    btn.disabled = false;
    btn.textContent = previousText;
  });

  $("llmProvider").addEventListener("change", (e) => updateProviderUI(e.target.value));

  if ($("targetImageFile")) {
    $("targetImageFile").addEventListener("change", () => {
      const status = $("targetImageStatus");
      const file = $("targetImageFile").files?.[0];
      if (!status) return;
      if (file) {
        pastedTargetImageDataUrl = "";
        status.textContent = `已选择：${file.name}`;
        status.classList.remove("hidden");
      } else {
        status.classList.add("hidden");
      }
    });
  }

  document.addEventListener("paste", handleTargetImagePaste);

  $("temperature").addEventListener("input", (e) => {
    $("tempValue").textContent = e.target.value;
  });

  $("toggleKey").addEventListener("click", () => {
    const input = $("apiKey");
    input.type = input.type === "password" ? "text" : "password";
  });

  $("copyBtn").addEventListener("click", () => {
    const text = currentResultObj
      ? convertResultToMarkdown(maskSensitiveData(currentResultObj)) || JSON.stringify(maskSensitiveData(currentResultObj), null, 2)
      : maskApiKeys($("resultContent").textContent);
    navigator.clipboard.writeText(text);
    $("copyBtn").textContent = "已复制 ✓";
    setTimeout(() => { $("copyBtn").textContent = t("copy", "复制"); }, 1500);
  });

  $("saveBtn").addEventListener("click", saveCurrentResult);

  $("clearBtn").addEventListener("click", () => {
    $("resultArea").classList.add("hidden");
    $("progressArea").classList.add("hidden");
    $("progressLog").innerHTML = "";
    $("resultContent").innerHTML = "";
    $("resultGrid").innerHTML = "";
  });

  // Tips Modal logic
  if ($("tipsBtn")) {
    $("tipsBtn").addEventListener("click", () => {
      $("tipsModal").classList.remove("hidden");
    });
    $("closeTipsBtn").addEventListener("click", () => {
      $("tipsModal").classList.add("hidden");
    });
    $("tipsModal").addEventListener("click", (e) => {
      if (e.target === $("tipsModal")) {
        $("tipsModal").classList.add("hidden");
      }
    });
  }

  $("exportExcelBtn").addEventListener("click", () => {
    let csvContent = "\uFEFF"; // UTF-8 BOM to prevent Chinese character corruption in Excel
    let headers = [];
    
    // 1. If we have cached JSON array, export it directly
    if (currentExcelData && currentExcelData.length > 0) {
      const rawHeaders = Object.keys(currentExcelData[0]);
      headers = rawHeaders;
      const translatedHeaders = rawHeaders.map(h => translateKey(h));
      csvContent += translatedHeaders.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\r\n";
      currentExcelData.forEach(row => {
        const line = headers.map(header => {
          let val = row[header];
          if (val === null || val === undefined) {
            val = "";
          } else {
            val = String(val);
          }
          return `"${val.replace(/"/g, '""')}"`;
        }).join(",");
        csvContent += line + "\r\n";
      });
    } else {
      // 2. Fallback: Parse any table visible in the side panel DOM
      const activeTable = document.querySelector("#resultReport table, #resultGrid table");
      if (!activeTable) {
        alert("无可导出的表格或数据！");
        return;
      }
      
      const ths = Array.from(activeTable.querySelectorAll("th"));
      headers = ths.map(th => th.innerText.trim());
      
      if (headers.length === 0) {
        const firstRowTds = Array.from(activeTable.querySelectorAll("tr:first-child td"));
        headers = firstRowTds.map((td, idx) => `列 ${idx + 1}`);
      }
      
      csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\r\n";
      
      const trs = Array.from(activeTable.querySelectorAll("tbody tr, tr"));
      // Filter out the header row if th was used to prevent duplication
      const dataTrs = trs.filter(tr => tr.querySelector("th") === null);
      
      dataTrs.forEach(tr => {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length === 0) return;
        const line = tds.map(td => `"${td.innerText.trim().replace(/"/g, '""')}"`).join(",");
        csvContent += line + "\r\n";
      });
    }
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `Data_${selectedSkill?.id || 'Export'}_${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("downloadMdBtn").addEventListener("click", () => {
    if (!currentResultObj) return;
    const mdContent = convertResultToMarkdown(maskSensitiveData(currentResultObj));
    const blob = new Blob([mdContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `Report_${selectedSkill?.id || 'Agent'}_${dateStr}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("downloadBtn").addEventListener("click", () => {
    if (!currentResultObj) return;

    // 2. Download PDF (via Native Print to PDF)
    let htmlContent = $("resultReport").innerHTML;
    const gridHtml = $("resultGrid").innerHTML;
    if (gridHtml && gridHtml.includes("<table")) {
      htmlContent += `<div class="section-divider"></div>
        <div class="landscape-section">
          <h2>数据结构化列表</h2>
          ${gridHtml}
        </div>`;
    }

    const dateStr = new Date().toISOString().split('T')[0];
    
    const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Skill_Report_${dateStr}</title>
  <style>
    :root {
      --bg2: #f1f5f9;
      --bg3: #f8fafc;
      --text: #0f172a;
      --text2: #475569;
      --border: #cbd5e1;
      --accent: #6366f1;
      --accent2: #8b5cf6;
    }
    
    @page { size: A4 portrait; margin: 25mm 20mm; }
    @page landscape-page { size: A4 landscape; margin: 20mm 25mm; }
    
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1a202c; line-height: 1.7; background: #fff; margin: 0 !important; padding: 0 !important; text-align: left; }
    
    .print-banner { background: #eff6ff; color: #1d4ed8; padding: 15px; text-align: center; font-weight: bold; border-bottom: 1px solid #bfdbfe; margin-bottom: 20px; }
    @media print { 
      .print-banner { display: none !important; } 
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0 !important; padding: 0 !important; }
    }
    
    .cover-page { padding-top: 60px; text-align: center !important; page-break-after: always; box-sizing: border-box; }
    .cover-title { font-size: 2.6em; color: #1e3a8a; font-weight: 800; letter-spacing: -0.02em; max-width: 80%; line-height: 1.3; margin-bottom: 20px; text-align: center !important; margin-left: auto; margin-right: auto; margin-top: 40px; }
    .cover-subtitle { font-size: 1.1em; color: #64748b; margin-top: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; text-align: center !important; }
    .cover-footer { margin-top: 180px; font-size: 1em; color: #94a3b8; text-align: center !important; }
    .cover-page p, .cover-page div, .cover-page span { text-align: center !important; }
    
    .report-container { max-width: 100%; font-size: 11pt; padding: 0 20px; text-align: left !important; }
    .report-container p, .report-container li, .report-container td, .report-container div { text-align: left !important; }
    
    h1 { color: #0f172a; font-size: 22pt; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-top: 30px; margin-bottom: 20px; text-align: center !important; }
    h2 { color: #1e3a8a; font-size: 16pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 30px; margin-bottom: 15px; padding-top: 15px; page-break-after: avoid; text-align: left !important; }
    h3 { color: #334155; font-size: 14pt; margin-top: 25px; margin-bottom: 10px; padding-top: 12px; page-break-after: avoid; text-align: left !important; }
    p { margin-bottom: 15px; color: #334155; orphans: 3; widows: 3; }
    strong { color: #0f172a; }
    
    .report-section { margin-bottom: 30px; border: none !important; padding: 0 !important; background-color: transparent !important; text-align: left !important; page-break-inside: avoid; }
    .data-card { page-break-inside: avoid !important; break-inside: avoid !important; margin-bottom: 25px; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background-color: #f8fafc; text-align: left !important; }
    .data-card td { padding: 8px 10px !important; font-size: 11px !important; }
    .data-card td:first-child { width: 140px !important; }
    .section-divider { page-break-before: always; }
    
    /* 智能横屏触发容器 */
    .landscape-section { page: landscape-page; width: 100%; text-align: left !important; }
    
    /* Table Styles */
    table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 30px; page-break-inside: avoid; font-size: 10pt; text-align: left !important; }
    th, td { border: 1px solid #cbd5e1 !important; padding: 12px !important; text-align: left !important; vertical-align: top; }
    th { background-color: #f8fafc !important; color: #0f172a !important; font-weight: 700; text-transform: uppercase; font-size: 9pt; }
    tr:nth-child(even) { background-color: #f8fafc; }
    
    /* Code blocks */
    code { background: #f1f5f9; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em; text-align: left !important; }
    pre { page-break-inside: avoid; text-align: left !important; }
    pre code { display: block; background: #0f172a; color: #f8fafc; padding: 15px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; text-align: left !important; }
    ul, ol { margin-bottom: 15px; padding-left: 20px; text-align: left !important; }
    li { margin-bottom: 8px; text-align: left !important; }
    img { max-width: 100%; height: auto; border-radius: 6px; margin: 15px 0; }
    a { color: #1e3a8a; text-decoration: none; border-bottom: 1px dashed #cbd5e1; }
    .empty-text { display: none; }
    
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0 !important; padding: 0 !important; }
    }
  </style>
</head>
<body>
  <div class="print-banner">
    🚀 正在生成原生数字版 PDF！请在弹出的对话框中选择【另存为 PDF】。如未弹出，请按 Ctrl+P 或 Cmd+P。
  </div>
  <div class="cover-page">
    <div class="cover-subtitle">AI Director Team</div>
    <div class="cover-title">Market Intelligence & Strategy Report</div>
    <div class="cover-subtitle">Generated Insights</div>
    <div class="cover-footer">
      <p>Report Date: ${dateStr}</p>
      <p>Confidential & Proprietary</p>
    </div>
  </div>
  <div class="report-container">
    ${htmlContent}
  </div>
</body>
</html>`;

    chrome.storage.local.set({ printHtml }, () => {
      window.open(chrome.runtime.getURL("print.html"), '_blank');
    });
  });

  $("viewReportBtn").addEventListener("click", () => {
    $("viewReportBtn").classList.add("active");
    $("viewDataBtn").classList.remove("active");
    $("resultReport").classList.remove("hidden");
    $("resultGrid").classList.add("hidden");
    $("resultContent").classList.add("hidden");
  });

  $("viewDataBtn").addEventListener("click", () => {
    $("viewDataBtn").classList.add("active");
    $("viewReportBtn").classList.remove("active");
    $("resultReport").classList.add("hidden");
    $("resultGrid").classList.remove("hidden");
    $("resultContent").classList.remove("hidden");
  });

  $("exportBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_RESULTS" });
    const data = maskSensitiveData(response.data || []);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `skill-runner-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("cancelBtn").addEventListener("click", () => {
    if (isRunning) {
      addLog("info", "⏹", "正在手动取消任务...");
      cleanupPort();
    }
  });

  // Refresh page info on focus
  window.addEventListener("focus", updatePageInfo);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeHtml(htmlString) {
  if (!htmlString) return "";
  const purifiedHtml = window.DOMPurify?.sanitize
    ? window.DOMPurify.sanitize(htmlString, {
      ALLOWED_TAGS: SANITIZE_ALLOWED_TAGS.map((tag) => tag.toLowerCase()),
      ALLOWED_ATTR: SANITIZE_ALLOWED_ATTR,
      FORBID_TAGS: SANITIZE_FORBID_TAGS.map((tag) => tag.toLowerCase()),
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: true,
      RETURN_TRUSTED_TYPE: false,
      SANITIZE_DOM: true,
    })
    : htmlString;

  return sanitizeHtmlFallback(purifiedHtml);
}

function sanitizeHtmlFallback(htmlString) {
  if (window.DOMPurify?.sanitize) {
    htmlString = String(htmlString || "");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const dropContentTags = new Set(SANITIZE_FORBID_TAGS);
  
  function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toUpperCase();
      if (!SANITIZE_ALLOWED_TAGS.includes(tagName)) {
        const parent = node.parentNode;
        if (parent && dropContentTags.has(tagName)) {
          parent.removeChild(node);
        } else if (parent) {
          while (node.firstChild) {
            parent.insertBefore(node.firstChild, node);
          }
          parent.removeChild(node);
        }
        return;
      }
      
      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        if (!SANITIZE_ALLOWED_ATTR.includes(attr.name.toLowerCase())) {
          node.removeAttribute(attr.name);
        } else if (attr.name.toLowerCase() === 'href') {
          const val = attr.value.trim().toLowerCase();
          if (!val.startsWith('http://') && !val.startsWith('https://') && !val.startsWith('#') && !val.startsWith('/')) {
            node.removeAttribute('href');
          }
        } else if (attr.name.toLowerCase() === 'target' && attr.value !== '_blank') {
          node.removeAttribute('target');
        } else if (attr.name.toLowerCase() === 'style') {
          const safeStyle = sanitizeStyleAttr(attr.value);
          if (safeStyle) {
            node.setAttribute('style', safeStyle);
          } else {
            node.removeAttribute('style');
          }
        }
      }

      if (tagName === 'A' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
      
      const children = Array.from(node.childNodes);
      children.forEach(sanitizeNode);
    }
  }
  
  doc.body.childNodes.forEach(sanitizeNode);
  return doc.body.innerHTML;
}

function sanitizeStyleAttr(styleValue) {
  if (!styleValue || /url\s*\(|expression\s*\(|javascript:|data:|@import|-moz-binding/i.test(styleValue)) return "";
  const allowedProps = new Set([
    'align-items', 'background', 'background-color', 'border', 'border-bottom', 'border-collapse', 'border-color',
    'border-left', 'border-radius', 'border-right', 'border-top', 'box-shadow', 'box-sizing', 'break-inside',
    'color', 'display', 'flex', 'font-family', 'font-size', 'font-style', 'font-weight', 'gap', 'height',
    'justify-content', 'letter-spacing', 'line-height', 'list-style-type', 'margin', 'margin-bottom',
    'margin-left', 'margin-right', 'margin-top', 'max-width', 'min-width', 'overflow', 'overflow-wrap',
    'padding', 'padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'page-break-inside',
    'text-align', 'text-decoration', 'text-transform', 'vertical-align', 'white-space', 'width',
    'word-break', 'word-wrap'
  ]);

  return styleValue
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf(':');
      if (separatorIndex <= 0) return "";
      const prop = part.slice(0, separatorIndex).trim().toLowerCase();
      const value = part.slice(separatorIndex + 1).trim();
      if (!allowedProps.has(prop) || !value || /[<>]/.test(value)) return "";
      return `${prop}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

function maskApiKeys(str) {
  if (!str || typeof str !== "string") return str;
  return str
    .replace(/(Bearer\s+)[a-zA-Z0-9\-_\.\~]+/gi, "$1sk-...****")
    .replace(/\b(sk-[a-zA-Z0-9]{8,})[a-zA-Z0-9_\-]+/g, "$1****")
    .replace(/\b(gho_[a-zA-Z0-9_]{8,})[a-zA-Z0-9_]+/g, "$1****")
    .replace(/\b(github_pat_[a-zA-Z0-9_]{8,})[a-zA-Z0-9_]+/g, "$1****")
    .replace(/((?:api[_-]?key|x-api-key|authorization|token|secret|password)["'\s:=]+)(["']?)[^"'\s,}]+/gi, "$1$2****");
}

function maskSensitiveData(value, depth = 0) {
  if (depth > 20) return "[Max depth]";
  if (typeof value === "string") return maskApiKeys(value);
  if (Array.isArray(value)) return value.map((item) => maskSensitiveData(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => {
      if (/api[_-]?key|authorization|token|secret|password/i.test(key)) {
        return [key, val ? "****" : val];
      }
      return [key, maskSensitiveData(val, depth + 1)];
    }));
  }
  return value;
}

function convertResultToMarkdown(obj) {
  if (!obj) return "";
  let md = "";
  if (obj.overview) {
    md += `# 📊 概述\n\n${obj.overview}\n\n`;
  }
  if (obj.analysis) {
    md += `## 💡 深度分析\n\n${obj.analysis}\n\n`;
  }
  if (obj.summary) {
    md += `## 🏁 核心结论\n\n${obj.summary}\n\n`;
  }
  
  let targetArray = null;
  if (Array.isArray(obj)) {
    targetArray = obj;
  } else if (obj.data && Array.isArray(obj.data)) {
    targetArray = obj.data;
  } else if (obj && typeof obj === 'object') {
    for (const key in obj) {
      if (Array.isArray(obj[key])) {
        targetArray = obj[key];
        break;
      }
    }
  }

  if (targetArray && targetArray.length > 0 && typeof targetArray[0] === 'object') {
    md += `## 📋 结构化数据列表\n\n`;
    const keys = new Set();
    targetArray.forEach(item => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(k => keys.add(k));
      }
    });
    const columns = Array.from(keys);
    
    md += `| ${columns.join(" | ")} |\n`;
    md += `| ${columns.map(() => "---").join(" | ")} |\n`;
    
    targetArray.forEach(item => {
      const row = columns.map(col => {
        let val = item[col];
        if (val === undefined || val === null) val = '';
        else if (typeof val === 'object') val = JSON.stringify(val);
        else val = String(val).replace(/\n/g, "<br>");
        return val;
      });
      md += `| ${row.join(" | ")} |\n`;
    });
    md += `\n`;
  }
  
  return md;
}

// ── Web Audio alert sound generator and Captcha Banner Alerting ──
let audioContextInstance = null;
function playAlertSound() {
  try {
    if (!audioContextInstance) {
      audioContextInstance = new (window.AudioContext || window.webkitAudioContext)();
    }
    const audioCtx = audioContextInstance;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    // Play a pleasant Ding-Dong tone
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, audioCtx.currentTime); // High A5
    gain1.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.35);
    
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5 note
      gain2.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      osc2.start(audioCtx.currentTime);
      osc2.stop(audioCtx.currentTime + 0.5);
    }, 150);
  } catch (e) {
    console.warn("Failed to play Web Audio sound:", e);
  }
}

function showCaptchaAlertBanner() {
  let banner = document.getElementById("captcha-alert-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "captcha-alert-banner";
    banner.style.cssText = `
      background: #ef4444;
      color: #ffffff;
      padding: 10px 14px;
      font-size: 11px;
      line-height: 1.4;
      font-weight: 600;
      border-radius: var(--radius, 8px);
      border: 1px solid #dc2626;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      font-family: system-ui, -apple-system, sans-serif;
      animation: pulse-banner 2s infinite;
    `;
    
    // Inject animation CSS rule if not present
    if (!document.getElementById("banner-animation-styles")) {
      const style = document.createElement("style");
      style.id = "banner-animation-styles";
      style.innerHTML = `
        @keyframes pulse-banner {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
          70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `;
      document.head.appendChild(style);
    }
    
    const progressArea = document.getElementById("progressArea");
    if (progressArea) {
      progressArea.insertBefore(banner, progressArea.firstChild);
    }
  }
  
  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="font-size:16px;">⚠️</span>
      <span><b>采购平台风控滑块！</b>请立刻前往新打开的浏览器页面完成验证或登录，完成后 Agent 将自动恢复运行。</span>
    </div>
    <span class="close-banner" style="cursor:pointer; font-size:14px; font-weight:bold; margin-left:8px; opacity:0.8;">&times;</span>
  `;
  
  banner.querySelector(".close-banner").addEventListener("click", () => {
    banner.remove();
  });
}

function removeCaptchaAlertBanner() {
  const banner = document.getElementById("captcha-alert-banner");
  if (banner) banner.remove();
}

// Listen for CAPTCHA_DETECTED one-off events
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "CAPTCHA_DETECTED") {
    playAlertSound();
    showCaptchaAlertBanner();
  }
});
