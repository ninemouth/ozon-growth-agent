// background.js — Service Worker for ecommerce-growth-agent (ES Modules)

import { runAgentLoop } from './modules/agentLoop.js';
import { tools, resetSessionData } from './modules/toolRegistry.js';
import { callLLM } from './modules/llmClient.js';

// ── Keep Service Worker Alive in MV3 ──
// Calling any Chrome API resets the 30-second idle timer in Manifest V3.
// We query storage every 10 seconds to keep the background service worker alive during long tasks.
setInterval(() => {
  chrome.storage.local.get(["keepAlive"], () => {
    if (chrome.runtime.lastError) {} // ignore
  });
}, 10000);

// ── Open side panel when toolbar icon is clicked ──
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Helper Utilities ──
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadSkill(skillPath) {
  const url = chrome.runtime.getURL(skillPath);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load skill: ${skillPath} (${response.status})`);
  }
  return await response.text();
}

const OZON_SKILL_PATHS = new Set([
  "skills/ozon_product_opportunity_explorer.skill.md",
  "skills/ozon_sourcing_finder.skill.md",
  "skills/ozon_global_shop_optimizer.skill.md",
  "skills/ozon_operations_tracker.skill.md",
  "skills/ozon_listing_generator.skill.md",
  "skills/ozon_review_analyzer.skill.md",
]);

const GROWTH_ACTION_SKILL_MAP = {
  diagnose_store_growth: ["skills/ozon_global_shop_optimizer.skill.md"],
  diagnose_sku_funnel: ["skills/ozon_operations_tracker.skill.md", "skills/ozon_global_shop_optimizer.skill.md"],
  rewrite_listing: ["skills/ozon_listing_generator.skill.md"],
  diagnose_visual_conversion: ["skills/ozon_global_shop_optimizer.skill.md", "skills/ozon_listing_generator.skill.md"],
  scan_competitor_changes: ["skills/ozon_global_shop_optimizer.skill.md"],
  analyze_review_defects: ["skills/ozon_review_analyzer.skill.md"],
  calculate_profit_guardrail: ["skills/ozon_sourcing_finder.skill.md"],
  filter_supplier_sources: ["skills/ozon_sourcing_finder.skill.md"],
  detect_fulfillment_risk: ["skills/ozon_operations_tracker.skill.md"],
  find_expansion_opportunities: ["skills/ozon_product_opportunity_explorer.skill.md", "skills/ozon_sourcing_finder.skill.md"],
  explore_platform_trends: ["skills/ozon_product_opportunity_explorer.skill.md"],
  create_growth_experiment: ["skills/ozon_operations_tracker.skill.md"],
  review_experiment_result: ["skills/ozon_operations_tracker.skill.md"],
};

function normalizeSkillPath(skillPath) {
  if (!skillPath || typeof skillPath !== "string") return "";
  const normalized = skillPath.replace(/^\/+/, "");
  return OZON_SKILL_PATHS.has(normalized) ? normalized : "";
}

function pushUnique(list, item) {
  if (item && !list.includes(item)) list.push(item);
}

async function getActiveShopId() {
  const data = await new Promise((resolve) => chrome.storage.local.get(["activeShopId"], resolve));
  return data.activeShopId || "";
}

async function cacheOzonApiSnapshot(kind, args = {}, result = {}) {
  const shopId = args.shopId || await getActiveShopId();
  const payload = {
    shopId,
    dateFrom: args.dateFrom || result.dateFrom || "",
    dateTo: args.dateTo || result.dateTo || "",
    result,
    syncedAt: new Date().toISOString(),
    source: "ozon_seller_api",
  };
  const key = kind === "sku_analytics" ? "ozonSkuAnalyticsSnapshot" : "ozonStoreSnapshotCache";
  await new Promise((resolve) => chrome.storage.local.set({ [key]: payload }, resolve));
  return payload;
}

// ── Ozon Intent Router & Dispatcher ──
async function dispatchOzonSkills(userInstruction) {
  const inst = String(userInstruction).toLowerCase();
  
  // Keyword mapping to detect which Ozon skills to load
  const matched = [];

  for (const [actionId, skillPaths] of Object.entries(GROWTH_ACTION_SKILL_MAP)) {
    if (inst.includes(actionId.replace(/_/g, " ")) || inst.includes(actionId)) {
      skillPaths.forEach((path) => pushUnique(matched, path));
      return matched;
    }
  }

  const hasShopOptimizationIntent =
    /店铺|卖家主页|seller|store|shop|运营方案|优化方案|店铺优化|店铺分析|店铺诊断|全店|abc|a\/b\/c|a-b-c|分级|整改|改版|增长方案|运营诊断|转化率|加购率|曝光|流量/.test(inst);
  const hasExplicitSourcingIntent =
    /1688|寻源|货源|采购|供应商|源头|工厂|拿样|比价|套利|采购直达|供货|批发|起批/.test(inst);
  const hasProductOpportunityIntent =
    /选品|开发|类目|爆品|机会|牙刷|合规|eac|准入/.test(inst);
  
  if (hasShopOptimizationIntent) {
    pushUnique(matched, "skills/ozon_global_shop_optimizer.skill.md");
  }

  if (hasProductOpportunityIntent && !hasShopOptimizationIntent) {
    pushUnique(matched, "skills/ozon_product_opportunity_explorer.skill.md");
  }

  if (hasExplicitSourcingIntent) {
    pushUnique(matched, "skills/ozon_sourcing_finder.skill.md");
  }

  if (!hasShopOptimizationIntent && /ozon.*(店铺|卖家|运营|转化|流量|加购|整改|abc)|listing\s*诊断|标题诊断|主图诊断/.test(inst)) {
    pushUnique(matched, "skills/ozon_global_shop_optimizer.skill.md");
  }

  if (inst.includes("追踪") || inst.includes("监控") || inst.includes("阶段") || inst.includes("指标") || inst.includes("曝光") || inst.includes("转化") || inst.includes("成效")) {
    pushUnique(matched, "skills/ozon_operations_tracker.skill.md");
  }
  if (inst.includes("俄语") || inst.includes("listing") || inst.includes("生成") || inst.includes("seo") || inst.includes("标题") || inst.includes("描述") || inst.includes("文案")) {
    pushUnique(matched, "skills/ozon_listing_generator.skill.md");
  }
  if (inst.includes("评论") || inst.includes("差评") || inst.includes("缺陷") || inst.includes("买家") || inst.includes("反馈") || inst.includes("退换")) {
    pushUnique(matched, "skills/ozon_review_analyzer.skill.md");
  }
  
  // If nothing matched, use LLM to classify or load a default set
  if (matched.length === 0) {
    try {
      const classificationPrompt = [
        {
          role: "system",
          content: `你是一个 Ozon 跨境电商运营智能路由器。请根据用户的输入需求，从以下 6 个专有 AI 技能路径中选择所有最相关的技能路径：
1. "skills/ozon_product_opportunity_explorer.skill.md" (Ozon选品、类目需求分析、合规性风险审计)
2. "skills/ozon_sourcing_finder.skill.md" (1688货源开发、卢布跨境利润套利测算、运费关税核算)
3. "skills/ozon_global_shop_optimizer.skill.md" (Ozon店铺经营诊断、Seller API对账、ABC分级优化)
4. "skills/ozon_operations_tracker.skill.md" (监控数据、对比优化阶段、流量曝光转化效果)
5. "skills/ozon_listing_generator.skill.md" (俄语 SEO Title/Description 商品详情文案生成)
6. "skills/ozon_review_analyzer.skill.md" (买家原声差评剖析、退换货与商品缺陷分析)

请直接输出一个包含路径字符串的 JSON 数组（例如：["skills/ozon_sourcing_finder.skill.md"]），不要包含任何其他说明字符，格式必须是标准的 JSON 数组。`
        },
        {
          role: "user",
          content: `用户的输入指令是: "${userInstruction}"`
        }
      ];
      
      const response = await callLLM(classificationPrompt);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const arr = JSON.parse(jsonMatch[0].trim());
        if (Array.isArray(arr) && arr.length > 0) {
          return arr;
        }
      }
    } catch (e) {
      console.warn("LLM classification routing failed, falling back to default:", e.message);
    }
    
    // Default fallback
    pushUnique(matched, "skills/ozon_product_opportunity_explorer.skill.md");
  }
  
  return matched;
}

async function deleteResult(id) {
  const existing = await new Promise((resolve) =>
    chrome.storage.local.get(["savedResults"], resolve)
  );
  const filtered = (existing.savedResults || []).filter((r) => r.id !== id);
  await new Promise((resolve) => chrome.storage.local.set({ savedResults: filtered }, resolve));
}

async function exportResults() {
  const existing = await new Promise((resolve) =>
    chrome.storage.local.get(["savedResults"], resolve)
  );
  return existing.savedResults || [];
}

async function listSkills() {
  const knownSkills = [
    {
      id: "ozon_product_opportunity_explorer",
      path: "skills/ozon_product_opportunity_explorer.skill.md",
      name: "Ozon 多维智能选品决策专家 (Auto)",
      description: "一键分析当前商品或搜索页，提取俄罗斯本土需求、EAC合规准入、泡货运费风险及痛点，输出高胜率爆品蓝图",
      icon: "🇷🇺",
    },
    {
      id: "ozon_sourcing_finder",
      path: "skills/ozon_sourcing_finder.skill.md",
      name: "Ozon ➔ 1688 跨境选品供应链与套利审计专家 (Auto)",
      description: "自动对齐国内 1688 货源，精确核算中俄国际段运费（FBS）、关税及平台扣款，输出精确卢布利润账本",
      icon: "💵",
    },
    {
      id: "ozon_global_shop_optimizer",
      path: "skills/ozon_global_shop_optimizer.skill.md",
      name: "Ozon 店铺运营多维对标与诊断优化专家 (Vision)",
      description: "分析 Ozon 店铺视觉陈列、商品结构、Seller API 指标、Ozon 大盘与俄区趋势，输出 ABC 分级优化方案",
      icon: "🏬",
    },
    {
      id: "ozon_operations_tracker",
      path: "skills/ozon_operations_tracker.skill.md",
      name: "Ozon 运营优化追踪与分析诊断专家 (Auto)",
      description: "分析已绑定商品的历史指标快照（价格/转化率/评论），判定优化阶段，追踪改善情况并输出二次迭代意见",
      icon: "📈",
    },
    {
      id: "ozon_listing_generator",
      path: "skills/ozon_listing_generator.skill.md",
      name: "Ozon 俄语 SEO Listing 智能生成专家",
      description: "基于当前 Ozon 页面、竞品搜索词或用户提供的供应商资料，生成符合 Ozon 规则的俄语 Title、Description 和 Rich-Content",
      icon: "📦",
    },
    {
      id: "ozon_review_analyzer",
      path: "skills/ozon_review_analyzer.skill.md",
      name: "Ozon 俄语评论痛点与缺陷审计专家",
      description: "深度解析 Ozon 页面上俄罗斯买家的真实原声差评，归纳核心质量/包装/物流问题，提供备货改良指导",
      icon: "⭐",
    }
  ];

  const available = [];
  for (const skill of knownSkills) {
    try {
      const url = chrome.runtime.getURL(skill.path);
      const resp = await fetch(url);
      if (resp.ok) available.push(skill);
    } catch (_) {}
  }

  return { ok: true, skills: available };
}

// ── Port Connection Handling (Streaming Progress) ──
const activePorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "ozon-agent-loop") {
    const portId = Date.now().toString();
    activePorts.set(portId, port);
    let isCancelled = false;

    port.onDisconnect.addListener(() => {
      isCancelled = true;
      activePorts.delete(portId);
      console.log(`Port ${portId} disconnected.`);
    });

    port.onMessage.addListener(async (message) => {
      if (message.type === "RUN_SKILL") {
        try {
          const tab = await getCurrentTab();
          if (!tab) throw new Error("无法获取当前活动的标签页，请确保浏览器焦点在目标网页上。");

          // Reset the session data cache at the start of a new run
          resetSessionData();

          // Step 1: Read current page context
          let pageContext = {};
          try {
            pageContext = await tools.read_current_page();
          } catch (err) {
            console.warn("Could not read page context:", err.message);
            if (err.message.includes("Receiving end does not exist") || err.message.toLowerCase().includes("connection") || err.message.toLowerCase().includes("context invalidated")) {
              throw new Error("检测到插件后台已重载或连接中断，请【刷新当前网页（按 F5）】后再次运行监控！");
            }
            if (err.message.includes("受 Chrome 安全策略限制") || err.message.includes("无法注入")) {
              throw err;
            }
          }

          if (message.targetImageUrl) {
            pageContext.targetImageUrl = message.targetImageUrl;
          }
          if (Array.isArray(pageContext.images) && pageContext.images.length > 0) {
            pageContext.targetImageCandidates = pageContext.images
              .map((img) => img.src)
              .filter(Boolean)
              .slice(0, 8);
            pageContext.targetImageCandidateDetails = pageContext.images
              .filter((img) => img.src)
              .slice(0, 8)
              .map((img) => ({
                src: img.src,
                alt: img.alt || "",
                roleHint: img.roleHint || "",
                searchScore: img.searchScore,
                displayScore: img.score,
                rect: img.rect,
              }));
            if (!pageContext.targetImageUrl) {
              pageContext.targetImageUrl = pageContext.targetImageCandidates[0];
            }
          }

          if (isCancelled) return;

          // Step 2: Capture screenshot for Vision models
          try {
            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
            if (dataUrl) {
              pageContext.screenshot = dataUrl;
            }
          } catch (err) {
            console.warn("Could not capture screenshot:", err.message);
          }

          if (isCancelled) return;

          // Step 3: Load base auditor skill & dynamically dispatch Ozon skills
          let baseMarkdown = "";
          try {
            baseMarkdown = await loadSkill("skills/base_report_auditor.skill.md");
          } catch (err) {
            console.warn("Could not load base auditor skill:", err.message);
          }

          if (isCancelled) return;

          // ── Automatic Routing ──
          console.log(`🤖 Auto-routing user instruction: "${message.userInstruction}"`);
          const selectedSkillPath = normalizeSkillPath(message.skillPath);
          const growthActionSkills = Array.isArray(GROWTH_ACTION_SKILL_MAP[message.growthActionId])
            ? GROWTH_ACTION_SKILL_MAP[message.growthActionId]
            : null;
          const matchedSkills = growthActionSkills
            ? growthActionSkills
            : selectedSkillPath
            ? [selectedSkillPath]
            : await dispatchOzonSkills(message.userInstruction);
          console.log("Matched Ozon skills:", matchedSkills);

          // Notify user via progress stream
          const matchedNames = matchedSkills.map(p => {
            const parts = p.split("/");
            return parts[parts.length - 1].replace(".skill.md", "");
          });
          port.postMessage({
            type: "PROGRESS",
            data: {
              type: "thinking",
              step: 0,
              message: `🤖 [AI 智脑分流] 自动分析意图，调集底层运营能力: ${matchedNames.join(" + ")}`
            }
          });

          // Combine the system prompts of all matched skills
          let combinedSkillsMarkdown = baseMarkdown ? `${baseMarkdown}\n\n` : "";
          for (const skillPath of matchedSkills) {
            try {
              const content = await loadSkill(skillPath);
              combinedSkillsMarkdown += `\n\n=========================================\n\n${content}`;
            } catch (err) {
              console.warn(`Could not load matched skill: ${skillPath}`, err.message);
            }
          }

          const sendProgress = (progressData) => {
            if (isCancelled) return;
            port.postMessage({ type: "PROGRESS", data: progressData });
          };

          const result = await runAgentLoop({
            tabId: tab.id,
            skillId: matchedSkills.join("+"),
            skillMarkdown: combinedSkillsMarkdown,
            userInstruction: message.userInstruction,
            pageContext,
            sendProgress,
            continueSession: message.continueSession,
            highRandomness: message.highRandomness,
            negativeFilter: message.negativeFilter
          });

          if (!isCancelled) {
            // Automatically save successful runs to savedResults
            let savedEntry = null;
            try {
              const existing = await new Promise((r) => chrome.storage.local.get(["savedResults"], r));
              const savedResults = existing.savedResults || [];
              
              const newEntry = {
                id: Date.now(),
                createdAt: new Date().toISOString(),
                skillId: matchedSkills.join("+"),
                skillName: matchedNames.map(name => name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(" + "),
                pageUrl: tab.url || "",
                pageTitle: tab.title || "",
                growthActionId: message.growthActionId || "",
                growthRunId: message.growthRunId || "",
                growthCaseId: message.growthCaseId || "",
                result: result.result // The parsed final output object containing overview, analysis, and data items
              };
              
              savedResults.unshift(newEntry);
              await new Promise((r) => chrome.storage.local.set({ savedResults: savedResults.slice(0, 100) }, r));
              savedEntry = newEntry;
              console.log("Successfully saved run results to savedResults database for dashboard.");
            } catch (saveErr) {
              console.error("Auto-saving run results to database failed:", saveErr.message);
            }

            port.postMessage({
              type: "SUCCESS",
              result: {
                ...result,
                skillId: matchedSkills.join("+"),
                skillName: matchedNames.join(" + "),
                savedEntry,
              }
            });
          }
        } catch (err) {
          if (!isCancelled) {
            port.postMessage({ type: "ERROR", error: err.message });
          }
        }
      }
    });
  }
});

// ── Standard Message Handlers (One-off Actions) ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    chrome.runtime.getPlatformInfo(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "LIST_SKILLS") {
    listSkills().then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (message.type === "GET_SAVED_RESULTS") {
    tools
      .get_saved_results({ limit: message.limit || 20 })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "DELETE_RESULT") {
    deleteResult(message.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "EXPORT_RESULTS") {
    exportResults()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "OPEN_DASHBOARD") {
    const dashboardUrl = chrome.runtime.getURL("dashboard.html");
    chrome.tabs.query({ url: dashboardUrl }, (existingTabs) => {
      if (existingTabs.length > 0) {
        chrome.tabs.update(existingTabs[0].id, { active: true });
        sendResponse({ ok: true, message: "Activated existing dashboard tab" });
      } else {
        chrome.tabs.create({ url: dashboardUrl, active: true }, () => {
          sendResponse({ ok: true, message: "Opened dashboard in new tab" });
        });
      }
    });
    return true;
  }

  if (message.type === "GET_OZON_STORE_SNAPSHOT") {
    const args = message.args || {};
    tools
      .ozon_api_get_store_snapshot(args)
      .then(async (data) => {
        let cache = null;
        if (data?.result) {
          cache = await cacheOzonApiSnapshot("store_snapshot", args, data.result);
        }
        sendResponse({ ok: data.ok, data, cache });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_OZON_SKU_ANALYTICS") {
    const args = {
      ...(message.args || {}),
      dimension: ["sku"],
      metrics: ["hits_view", "session_view", "ordered_units", "conv_tocart"]
    };
    tools
      .ozon_api_get_analytics(args)
      .then(async (data) => {
        let cache = null;
        if (data?.result) {
          cache = await cacheOzonApiSnapshot("sku_analytics", args, data.result);
        }
        sendResponse({ ok: data.ok, data, cache });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "PROCESS_OZON_MONITOR_BASELINE") {
    tools
      .monitor_process_page_data({
        ...(message.args || {}),
        platform: "ozon"
      })
      .then((data) => sendResponse({ ok: data.ok, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "TRIGGER_IMMEDIATE_MONITOR_RUN") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: "READ_CURRENT_PAGE" }, async (res) => {
        if (res && res.ok && res.data) {
          const pageData = res.data;
          let items = [];
          if (pageData.productCards && pageData.productCards.length > 0) {
            items = pageData.productCards;
          }
          
          let creatorInfo = pageData.creatorInfo || null;
          if (!creatorInfo && pageData.url && pageData.url.includes("tiktok.com")) {
            const usernameMatch = pageData.url.match(/tiktok\.com\/@([a-zA-Z0-9._-]+)/);
            if (usernameMatch) {
              creatorInfo = {
                username: usernameMatch[1],
                fansCount: pageData.reviewCount || "0",
                likesCount: pageData.rating || "0",
                url: pageData.url
              };
            }
          }
          
          await tools.monitor_process_page_data({
            items,
            creatorInfo,
            platform: "tiktok"
          });
          
          const storage = await new Promise(r => chrome.storage.local.get(["monitorTasks"], r));
          const tasks = storage.monitorTasks || [];
          const taskExists = tasks.some(t => t.target_url === pageData.url);
          if (!taskExists) {
            const taskId = `task_${Date.now()}`;
            tasks.push({
              id: taskId,
              task_type: "shop_check",
              platform: "tiktok",
              target_type: creatorInfo ? "creator" : "shop",
              target_url: pageData.url,
              target_entity_key: creatorInfo ? `tiktok:creator:${creatorInfo.username}` : `tiktok:shop:${pageData.title}`,
              frequency: "6h",
              last_run_at: new Date().toISOString(),
              status: "active"
            });
            await new Promise(r => chrome.storage.local.set({ monitorTasks: tasks }, r));
          }
          
          const dashboardUrl = chrome.runtime.getURL("dashboard.html");
          chrome.tabs.create({ url: dashboardUrl, active: true }, () => {
            sendResponse({ ok: true, message: "Added to monitor and opened dashboard" });
          });
        } else {
          sendResponse({ ok: false, error: "Failed to read page" });
        }
      });
      return true;
    }
  }
});

// ── Alarms Listener for Scheduled Background Monitoring Checks ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("monitor_task_")) {
    const taskJson = alarm.name.slice("monitor_task_".length);
    try {
      const task = JSON.parse(decodeURIComponent(taskJson));
      if (task && task.target_url) {
        console.log("Triggering scheduled background monitoring check for:", task.target_url);
        chrome.tabs.create({ url: task.target_url, active: false }, (newTab) => {
          let attempts = 0;
          const maxAttempts = 20; // 10 seconds timeout
          const checkInterval = setInterval(() => {
            attempts++;
            chrome.tabs.get(newTab.id, async (tabInfo) => {
              if (chrome.runtime.lastError || !tabInfo) {
                clearInterval(checkInterval);
                return;
              }
              if (tabInfo.status === "complete" || attempts >= maxAttempts) {
                clearInterval(checkInterval);
                try {
                  chrome.tabs.sendMessage(newTab.id, { type: "READ_CURRENT_PAGE" }, async (res) => {
                    if (res && res.ok && res.data) {
                      const pageData = res.data;
                      let items = [];
                      let creatorInfo = null;
                      let shopInfo = null;

                      const isOzon = task.platform === "ozon";

                      if (isOzon) {
                        if (task.target_type === "item") {
                          // Single Ozon product page check
                          items = [{
                            id: pageData.sku || pageData.id || pageData.url || task.target_url,
                            title: pageData.title || pageData.name || "Ozon Product",
                            price: pageData.price || 0,
                            sales: pageData.salesCount || pageData.sales || 0,
                            rating: pageData.rating || 0,
                            reviews: pageData.reviewCount || pageData.reviews || 0,
                            imgUrl: pageData.imageUrl || pageData.img || ""
                          }];
                        } else {
                          // Ozon shop check
                          if (pageData.productCards && pageData.productCards.length > 0) {
                            items = pageData.productCards.map(p => ({
                              id: p.id || p.product_link || Math.random().toString(),
                              title: p.title || p.name || "Ozon Product",
                              price: p.price || 0,
                              sales: p.sales || 0,
                              rating: p.rating || 0,
                              reviews: p.reviews || 0,
                              imgUrl: p.candidate_image_url || p.imgUrl || ""
                            }));
                          }
                          shopInfo = {
                            id: pageData.shopId || pageData.title || "Ozon Seller",
                            name: pageData.title || "Ozon Seller",
                            url: pageData.url || task.target_url
                          };
                        }
                      } else {
                        // Legacy TikTok handling
                        if (pageData.productCards && pageData.productCards.length > 0) {
                          items = pageData.productCards;
                        }
                        if (pageData.url && pageData.url.includes("tiktok.com")) {
                          const usernameMatch = pageData.url.match(/tiktok\.com\/@([a-zA-Z0-9._-]+)/);
                          if (usernameMatch) {
                            creatorInfo = {
                              username: usernameMatch[1],
                              fansCount: pageData.reviewCount || "0",
                              likesCount: pageData.rating || "0",
                              url: pageData.url
                            };
                          }
                        }
                      }

                      // Run data comparisons and trigger change events
                      await tools.monitor_process_page_data({
                        items,
                        creatorInfo,
                        shopInfo,
                        platform: task.platform || "tiktok"
                      });

                      // Update last execution time for task
                      try {
                        const stored = await new Promise(r => chrome.storage.local.get(["monitorTasks"], r));
                        const storedTasks = stored.monitorTasks || [];
                        const matchTask = storedTasks.find(t => t.id === task.id);
                        if (matchTask) {
                          matchTask.last_run_at = new Date().toLocaleString();
                          await new Promise(r => chrome.storage.local.set({ monitorTasks: storedTasks }, r));
                        }
                      } catch (err) {
                        console.warn("Failed to update last_run_at for alarm task:", err.message);
                      }

                      console.log("Scheduled monitor check processed successfully for:", task.target_url);
                    }
                    chrome.tabs.remove(newTab.id);
                  });
                } catch (e) {
                  console.error("Scheduled check page extraction failed:", e);
                  chrome.tabs.remove(newTab.id);
                }
              }
            });
          }, 500);
        });
      }
    } catch (err) {
      console.error("Error running alarm task:", err);
    }
  }
});

// ── Initialize Default Settings on Installation ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["llmProvider"], (data) => {
    if (!data.llmProvider) {
      chrome.storage.local.set({
        llmProvider: "qwen",
        llmModel: "qwen-max",
        temperature: "0.2",
        maxLoopSteps: "25",
        ozonTargetMargin: "20",
        ozonWarehouseType: "FBS"
      });
    }
  });
});
