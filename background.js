// background.js — Service Worker for ecommerce-growth-agent (ES Modules)

import { runAgentLoop } from './modules/agentLoop.js';
import { tools } from './modules/toolRegistry.js';

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
      id: "taobao_homepage_explorer",
      path: "skills/taobao_homepage_explorer.skill.md",
      name: "淘宝全自动宏观爆品探索 (Auto)",
      description: "从首页捕捉趋势热词，自动跳转搜索页并过滤出最终爆品标的",
      icon: "🕵️",
    },
    {
      id: "ecommerce_page_analyzer",
      path: "skills/ecommerce_page_analyzer.skill.md",
      name: "电商当前页选品分析 (Vision)",
      description: "基于当前页面截图和DOM，提取商品结构化数据并生成数据报表",
      icon: "🛒",
    },
    {
      id: "etsy_crossborder_explorer",
      path: "skills/etsy_crossborder_explorer.skill.md",
      name: "Etsy 跨境全自动选品探索 (Auto)",
      description: "专为中国跨境卖家打造，结合 Etsy 手工与定制属性，自动挖掘高利润蓝海蓝图",
      icon: "🌍",
    },
    {
      id: "global_shop_optimizer",
      path: "skills/global_shop_optimizer.skill.md",
      name: "全平台竞品对比与店铺优化诊断",
      description: "深度扫描当前商品，自动跨平台(淘宝/Etsy/亚马逊等)搜索全网头部竞品进行多维对比，输出 SEO 与转化率升级方案",
      icon: "🏬",
    },
    {
      id: "amazon_listing_generator",
      path: "skills/amazon_listing_generator.skill.md",
      name: "亚马逊 Listing 智能生成器",
      description: "生成优化的 Amazon 商品 Listing，含标题、卖点和 SEO 标签",
      icon: "📦",
    },
    {
      id: "etsy_keyword_analysis",
      path: "skills/etsy_keyword_analysis.skill.md",
      name: "Etsy 关键词与流量机会分析",
      description: "分析 Etsy 商品关键词机会和搜索流量潜力",
      icon: "🔍",
    },
    {
      id: "competitor_review_analysis",
      path: "skills/competitor_review_analysis.skill.md",
      name: "全网竞品 Review 痛点分析",
      description: "分析竞争对手评论，提取痛点和差异化机会",
      icon: "⭐",
    },
    {
      id: "product_opportunity_scorer",
      path: "skills/product_opportunity_scorer.skill.md",
      name: "多维商品选品机会评分模型",
      description: "综合评分商品机会：市场容量、竞争度、利润潜力",
      icon: "📊",
    },
    {
      id: "tiktok_shop_trend_analyzer",
      path: "skills/tiktok_shop_trend_analyzer.skill.md",
      name: "TikTok Shop 爆款视频与产品趋势分析 (Auto)",
      description: "分析 TikTok 爆款视频与带货达人元素，挖掘快速跟卖贴牌爆品蓝图",
      icon: "🎵",
    },
    {
      id: "temu_semi_managed_evaluator",
      path: "skills/temu_semi_managed_evaluator.skill.md",
      name: "Temu 半托管低毛利风控评估模型",
      description: "针对半托管备货进行本地末端运费、仓储费与核价线低利润风控审计",
      icon: "🍊",
    },
    {
      id: "event_driven_trend_radar",
      path: "skills/event_driven_trend_radar.skill.md",
      name: "事件驱动型选品与趋势机会雷达 (Auto)",
      description: "输入突发宏观事件，全自动挖掘周边需求链、多语言长尾词及低风险替代品机会",
      icon: "📡",
    },
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
  if (port.name === "agent-loop") {
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

          // Step 1: Read current page context
          let pageContext = {};
          try {
            pageContext = await tools.read_current_page();
          } catch (err) {
            console.warn("Could not read page context:", err.message);
            // If it's a restricted page, tools.read_current_page will throw a clear error we should propagate
            if (err.message.includes("受 Chrome 安全策略限制") || err.message.includes("无法注入")) {
              throw err;
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

          // Step 3: Load base auditor skill & selected skill markdown
          let baseMarkdown = "";
          try {
            baseMarkdown = await loadSkill("skills/base_report_auditor.skill.md");
          } catch (err) {
            console.warn("Could not load base auditor skill:", err.message);
          }
          
          const selectedMarkdown = await loadSkill(
            message.skillPath || "skills/etsy_crossborder_explorer.skill.md"
          );
          
          const skillMarkdown = baseMarkdown 
            ? `${baseMarkdown}\n\n=========================================\n\n${selectedMarkdown}`
            : selectedMarkdown;

          if (isCancelled) return;

          const sendProgress = (progressData) => {
            if (isCancelled) return;
            port.postMessage({ type: "PROGRESS", data: progressData });
          };

          // Step 4: Run Agent Loop
          const result = await runAgentLoop({
            tabId: tab.id,
            skillId: message.skillPath,
            skillMarkdown,
            userInstruction: message.userInstruction,
            pageContext,
            sendProgress,
            continueSession: message.continueSession,
            highRandomness: message.highRandomness
          });

          if (!isCancelled) {
            port.postMessage({ type: "SUCCESS", result });
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
});
