// sidepanel.js — Skill Runner UI Controller

// ── State ──
let selectedSkill = null;
let isRunning = false;
let currentResultObj = null;

const MODEL_HINTS = {
  openai: ["gpt-5.2-omni", "gpt-4o", "gpt-4o-mini", "o1-mini", "o3-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
  qwen: ["qwen3.7-max", "qwen3.6-plus", "qwen3.5-plus", "qwen-vl-max"],
  siliconflow: ["Qwen/Qwen2.5-VL-72B-Instruct", "Pro/deepseek-ai/DeepSeek-R1"],
  groq: ["llama-3.2-90b-vision-preview", "llama-3.3-70b-versatile"],
  custom: [],
};

const PROVIDER_LINKS = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  qwen: "https://dashscope.console.aliyun.com/apiKey",
  siliconflow: "https://cloud.siliconflow.cn/account/ak",
  groq: "https://console.groq.com/keys"
};

// ── DOM refs ──
const $ = (id) => document.getElementById(id);

const views = {
  main: $("view-main"),
  settings: $("view-settings"),
  library: $("view-library"),
};

function showView(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle("active", k === name);
  });
}

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  showView("main");
  await loadSkills();
  await updatePageInfo();
  await loadSettings();
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
  
  $("runBtn").disabled = false;
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

function cleanupPort() {
  if (activePort) {
    try {
      activePort.disconnect();
    } catch (_) {}
    activePort = null;
  }
  isRunning = false;
  const runBtn = $("runBtn");
  runBtn.innerHTML = `<span class="run-btn-icon">▶</span><span class="run-btn-text">执行 Skill</span>`;
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

  addLog("start", "🚀", `执行 Skill: ${selectedSkill.name}`);

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
    activePort = chrome.runtime.connect({ name: "agent-loop" });

    activePort.onMessage.addListener((message) => {
      if (message.type === "PROGRESS") {
        const msg = message.data;
        if (msg) {
          if (msg.type === "tool_call") {
            addLog("info", "⚙️", `调用工具: ${msg.toolName}`);
          } else if (msg.type === "reflection") {
            addLog("warning", "🕵️", msg.message);
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
        addLog("success", "✅", `完成 (${message.result.steps || "?"} 步)`);
        showResult(message.result);
        cleanupPort();
      } else if (message.type === "ERROR") {
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
    
    activePort.postMessage({
      type: "RUN_SKILL",
      skillPath: selectedSkill.path,
      userInstruction: $("instruction").value.trim(),
      continueSession: $("continueSessionCheckbox").checked,
      highRandomness: $("highRandomnessCheckbox").checked,
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
  entry.innerHTML = `<span class="log-icon">${icon}</span><span class="log-text">${escapeHtml(maskApiKeys(text))}</span>`;
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
  currentResultObj = typeof response.result === "string" ? { overview: response.result } : response.result;

  if (response.type === "text") {
    jsonStr = response.result;
    content.textContent = jsonStr;
    grid.innerHTML = `<div class="empty-text">结果为纯文本，无表格数据。</div>`;
    report.innerHTML = sanitizeHtml(`<div class="report-text-wrapper">${renderMarkdown(jsonStr)}</div>`);
    $("viewReportBtn").click();
  } else {
    try {
      jsonStr = typeof response.result === "string"
        ? response.result
        : JSON.stringify(response.result, null, 2);
      const formatted = syntaxHighlightJSON(jsonStr);
      content.innerHTML = formatted;
      
      let rawData = typeof response.result === "string" ? JSON.parse(response.result) : response.result;
      
      // Render Report
      let hasReport = false;
      for (const key in rawData) {
        if (rawData[key] !== null && typeof rawData[key] !== 'object') {
          hasReport = true;
          break;
        }
      }
      
      if (hasReport) {
        report.innerHTML = sanitizeHtml(renderReport(rawData));
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

      if (targetArray && targetArray.length > 0 && typeof targetArray[0] === 'object') {
        grid.innerHTML = sanitizeHtml(renderGrid(targetArray));
        if (!hasReport) $("viewGridBtn").click();
      } else {
        grid.innerHTML = `<div class="empty-text">当前结果没有结构化数组数据，无法显示为表格。</div>`;
      }
      
      if (hasReport) {
        $("viewReportBtn").click();
      } else if (!hasReport && (!targetArray || targetArray.length === 0)) {
        $("viewJsonBtn").click();
      }
    } catch (_) {
      content.textContent = JSON.stringify(response.result, null, 2);
      grid.innerHTML = `<div style="padding: 12px; color: var(--text2);">解析失败。</div>`;
      report.innerHTML = `<div style="padding: 12px; color: var(--text2);">解析失败。</div>`;
      $("viewJsonBtn").click();
    }
  }
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

  // Render any remaining primitive keys (like verdict, total_score)
  for (const key in resultObj) {
    if (!renderedKeys.has(key) && resultObj[key] !== undefined && resultObj[key] !== null && typeof resultObj[key] !== 'object') {
      html += renderSection(key, resultObj[key]);
    }
  }
  return html;
}

function renderGrid(dataArray) {
  if (!dataArray || dataArray.length === 0) return "";
  
  // Collect all unique keys
  const keys = new Set();
  dataArray.forEach(item => {
    if (item && typeof item === 'object') {
      Object.keys(item).forEach(k => keys.add(k));
    }
  });
  const columns = Array.from(keys);
  
  let html = '<table><thead><tr>';
  columns.forEach(col => {
    html += `<th>${escapeHtml(col)}</th>`;
  });
  html += '</tr></thead><tbody>';
  
  dataArray.forEach(item => {
    html += '<tr>';
    columns.forEach(col => {
      let val = item[col];
      if (val === undefined || val === null) val = '';
      else if (typeof val === 'object') val = JSON.stringify(val);
      else val = String(val);
      // If the text contains markdown characters (like **), parse it. Otherwise just escape.
      if (typeof marked !== 'undefined') {
          html += `<td>${marked.parseInline(val)}</td>`;
      } else {
          html += `<td>${escapeHtml(val)}</td>`;
      }
    });
    html += '</tr>';
  });
  
  html += '</tbody></table>';
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
  if (!content.textContent.trim()) return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    await chrome.runtime.sendMessage({
      type: "RUN_SKILL",
      skillPath: "save_only",
    });

    // Direct save via storage
    const existing = await new Promise((r) => chrome.storage.local.get(["savedResults"], r));
    const savedResults = existing.savedResults || [];
    savedResults.unshift({
      id: Date.now(),
      createdAt: new Date().toISOString(),
      skillName: selectedSkill?.name || "Unknown Skill",
      url: tab?.url || "",
      pageTitle: tab?.title || "",
      result: content.textContent,
    });
    await new Promise((r) => chrome.storage.local.set({ savedResults: savedResults.slice(0, 100) }, r));

    const saveBtn = $("saveBtn");
    saveBtn.textContent = "已保存 ✓";
    saveBtn.style.background = "var(--success)";
    saveBtn.style.color = "white";
    setTimeout(() => {
      saveBtn.textContent = "保存";
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
    chrome.storage.local.get(["apiKey", "llmProvider", "llmModel", "llmBaseUrl", "maxLoopSteps", "temperature", "helium10ApiKey", "sellerSpriteApiKey"], r)
  );

  if (s.llmProvider) $("llmProvider").value = s.llmProvider;
  if (s.llmModel) $("llmModel").value = s.llmModel;
  if (s.apiKey) $("apiKey").value = s.apiKey;
  if (s.llmBaseUrl) $("llmBaseUrl").value = s.llmBaseUrl;
  if (s.maxLoopSteps) $("maxLoopSteps").value = s.maxLoopSteps;
  if (s.temperature !== undefined) {
    $("temperature").value = s.temperature;
    $("tempValue").textContent = s.temperature;
  }
  if (s.helium10ApiKey) $("helium10ApiKey").value = s.helium10ApiKey;
  if (s.sellerSpriteApiKey) $("sellerSpriteApiKey").value = s.sellerSpriteApiKey;

  updateProviderUI(s.llmProvider || "openai");
  updateApiStatusUI(s.helium10ApiKey, s.sellerSpriteApiKey);
}

function updateApiStatusUI(h10Key, ssKey) {
  const badge = $("apiStatusBadge");
  if (!badge) return;
  if (h10Key || ssKey) {
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
}

async function saveSettings() {
  const apiKey = $("apiKey").value.trim();
  const llmProvider = $("llmProvider").value;
  const llmModel = $("llmModel").value.trim();
  const llmBaseUrl = $("llmBaseUrl").value.trim();
  const maxLoopSteps = $("maxLoopSteps").value;
  const temperature = $("temperature").value;
  const helium10ApiKey = $("helium10ApiKey").value.trim();
  const sellerSpriteApiKey = $("sellerSpriteApiKey").value.trim();

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
      llmBaseUrl, 
      maxLoopSteps, 
      temperature,
      helium10ApiKey,
      sellerSpriteApiKey
    }, r)
  );

  msg.textContent = "✓ 设置已保存";
  msg.className = "settings-msg success";
  msg.classList.remove("hidden");
  
  updateApiStatusUI(helium10ApiKey, sellerSpriteApiKey);
  
  setTimeout(() => msg.classList.add("hidden"), 2000);
}

// ── Events ──
function bindEvents() {
  $("runBtn").addEventListener("click", runSkill);
  
  $("skillDropdownTrigger").addEventListener("click", () => toggleDropdown());
  document.addEventListener("click", (e) => {
    const dropdown = $("skillDropdown");
    if (dropdown && !dropdown.contains(e.target)) {
      toggleDropdown(false);
    }
  });

  $("settingsBtn").addEventListener("click", () => showView("settings"));
  $("backFromSettings").addEventListener("click", () => showView("main"));

  $("libraryBtn").addEventListener("click", () => {
    showView("library");
    loadLibrary();
  });
  $("backFromLibrary").addEventListener("click", () => showView("main"));

  $("saveSettings").addEventListener("click", saveSettings);

  $("llmProvider").addEventListener("change", (e) => updateProviderUI(e.target.value));

  $("temperature").addEventListener("input", (e) => {
    $("tempValue").textContent = e.target.value;
  });

  $("toggleKey").addEventListener("click", () => {
    const input = $("apiKey");
    input.type = input.type === "password" ? "text" : "password";
  });

  $("copyBtn").addEventListener("click", () => {
    const text = $("resultContent").textContent;
    navigator.clipboard.writeText(text);
    $("copyBtn").textContent = "已复制 ✓";
    setTimeout(() => { $("copyBtn").textContent = "复制"; }, 1500);
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

  $("downloadMdBtn").addEventListener("click", () => {
    if (!currentResultObj) return;
    const mdContent = convertResultToMarkdown(currentResultObj);
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
    @page { size: portrait; margin: 20mm; }
    @page landscape-page { size: landscape; margin: 20mm; }
    
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a202c; line-height: 1.7; background: #fff; margin: 0; padding: 0; }
    
    .print-banner { background: #eff6ff; color: #1d4ed8; padding: 15px; text-align: center; font-weight: bold; border-bottom: 1px solid #bfdbfe; margin-bottom: 20px; }
    @media print { .print-banner { display: none !important; } }
    
    .cover-page { height: 90vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
    .cover-title { font-size: 2.8em; color: #1e3a8a; font-weight: 800; letter-spacing: -0.02em; max-width: 80%; line-height: 1.3; margin-bottom: 20px; text-align: center; }
    .cover-subtitle { font-size: 1.2em; color: #64748b; margin-top: 10px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; text-align: center; }
    .cover-footer { margin-top: auto; font-size: 1em; color: #94a3b8; text-align: center; }
    
    .report-container { max-width: 100%; font-size: 11pt; padding: 0 20px; }
    
    h1 { color: #0f172a; font-size: 22pt; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-top: 30px; margin-bottom: 20px; text-align: center; }
    h2 { color: #1e3a8a; font-size: 16pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 25px; margin-bottom: 15px; page-break-after: avoid; text-align: center; }
    h3 { color: #334155; font-size: 14pt; margin-top: 20px; margin-bottom: 10px; page-break-after: avoid; }
    p { margin-bottom: 15px; color: #334155; orphans: 3; widows: 3; }
    strong { color: #0f172a; }
    
    .report-section { margin-bottom: 30px; }
    .section-divider { page-break-before: always; }
    
    /* 智能横屏触发容器 */
    .landscape-section { page: landscape-page; width: 100%; }
    
    /* Table Styles */
    table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 30px; page-break-inside: avoid; font-size: 10pt; }
    th, td { border: 1px solid #cbd5e1; padding: 12px; text-align: left; vertical-align: top; }
    th { background-color: #f8fafc; color: #0f172a; font-weight: 700; text-transform: uppercase; font-size: 9pt; }
    tr:nth-child(even) { background-color: #f1f5f9; }
    
    /* Code blocks */
    code { background: #f1f5f9; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
    pre { page-break-inside: avoid; }
    pre code { display: block; background: #0f172a; color: #f8fafc; padding: 15px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
    ul, ol { margin-bottom: 15px; padding-left: 20px; }
    li { margin-bottom: 8px; }
    .empty-text { display: none; }
    
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
  <script>
    window.onload = function() {
      setTimeout(() => { window.print(); }, 500);
    };
  </script>
</body>
</html>`;

    const blob = new Blob([printHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    
    // Revoke the URL after it opens
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    const data = response.data || [];
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
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const allowedTags = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'SPAN', 'DIV', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'CODE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BR', 'A', 'HR'];
  const allowedAttrs = ['href', 'style', 'class', 'target'];
  
  function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName.toUpperCase();
      if (!allowedTags.includes(tagName)) {
        const parent = node.parentNode;
        if (parent) {
          while (node.firstChild) {
            parent.insertBefore(node.firstChild, node);
          }
          parent.removeChild(node);
        }
        return;
      }
      
      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        if (!allowedAttrs.includes(attr.name.toLowerCase())) {
          node.removeAttribute(attr.name);
        } else if (attr.name.toLowerCase() === 'href') {
          const val = attr.value.trim().toLowerCase();
          if (val.startsWith('javascript:') || val.startsWith('data:')) {
            node.removeAttribute('href');
          }
        }
      }
      
      const children = Array.from(node.childNodes);
      children.forEach(sanitizeNode);
    }
  }
  
  doc.body.childNodes.forEach(sanitizeNode);
  return doc.body.innerHTML;
}

function maskApiKeys(str) {
  if (!str || typeof str !== "string") return str;
  return str
    .replace(/(Bearer\s+)[a-zA-Z0-9\-_\.\~]+/gi, "$1sk-...****")
    .replace(/\b(sk-[a-zA-Z0-9]{12})[a-zA-Z0-9]+/g, "$1****")
    .replace(/(x-api-key["'\s:]+)[a-zA-Z0-9\-]+/gi, "$1****");
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
