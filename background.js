/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// background.js — Service Worker for ozon-growth-agent (ES Modules)

import { runAgentLoop } from './modules/agentLoop.js';
import { tools, resetSessionData, waitForPageCaptureReady } from './modules/toolRegistry.js';
import { callLLM } from './modules/llmClient.js';
import { cleanupOwnedTabs, closeOwnedTab, createOwnedTab, protectWorkflowTab } from './modules/browserSessionManager.js';
import { buildResearchScope } from './modules/researchScope.js';
import { summarizeEvidenceQuality } from './modules/evidenceQuality.js';
import { buildEvidenceBundle } from './modules/evidenceBundle.js';
import { upsertGrowthCaseFromResult } from './modules/growthCaseStore.js';
import { getArtifactDataUrl } from './modules/artifactStore.js';
import { getLocal, getLocalSafe, setLocal } from './modules/storageLocal.js';
import { workflowEngine } from './modules/workflowEngine.js';
import {
  acquireWorkflowLease,
  appendWorkflowEvent,
  appendTaskLog,
  clearWorkflowCancellation,
  listTaskLogs,
  loadWorkflowSnapshot,
  pruneTaskLogs,
  recoverStaleWorkflows,
  releaseWorkflowLease,
  renewWorkflowLease,
  requestWorkflowCancellation,
  saveWorkflowSnapshot,
} from './modules/workflowRuntime.js';

const activePorts = new Map();

// ── Keep Service Worker Alive in MV3 ──
// Calling any Chrome API resets the 30-second idle timer in Manifest V3.
// Only active workflow ports request a light keep-alive; checkpoint recovery is
// still the primary protection when MV3 suspends the worker.
setInterval(() => {
  if (activePorts.size === 0) return;
  getLocalSafe(["keepAlive"], {}).catch(() => {});
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
  "skills/ozon_platform_trends.skill.md",
  "skills/ozon_sourcing_finder.skill.md",
  "skills/ozon_global_shop_optimizer.skill.md",
  "skills/ozon_operations_tracker.skill.md",
  "skills/ozon_listing_generator.skill.md",
  "skills/ozon_review_analyzer.skill.md",
  "skills/ozon_compliance_auditor.skill.md",
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
  explore_platform_trends: ["skills/ozon_platform_trends.skill.md"],
  create_growth_experiment: ["skills/ozon_operations_tracker.skill.md"],
  review_experiment_result: ["skills/ozon_operations_tracker.skill.md"],
  audit_compliance: ["skills/ozon_compliance_auditor.skill.md"],
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
  const data = await getLocal(["activeShopId"]);
  return data.activeShopId || "";
}

async function getBoundShops() {
  const data = await getLocal(["ozonShops"]);
  return Array.isArray(data.ozonShops) ? data.ozonShops : [];
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
  await setLocal({ [key]: payload });
  return payload;
}

const UPDATE_STATUS_KEY = "ozonUpdateStatus";
const UPDATE_CHECK_ALARM = "ozon_update_check";
const UPDATE_CHECK_INTERVAL_MINUTES = 12 * 60;
const TASK_LOG_PRUNE_ALARM = "ozon_task_log_prune";
const TASK_LOG_PRUNE_INTERVAL_MINUTES = 24 * 60;
const WORKFLOW_RECOVERY_ALARM = "ozon_workflow_recovery_sweep";
const WORKFLOW_RECOVERY_INTERVAL_MINUTES = 5;
const WORKFLOW_RECOVERY_STALE_AFTER_MS = 2 * 60 * 1000;
const GITHUB_RELEASES_URL = "https://github.com/ninemouth/ozon-growth-agent/releases";
const GITHUB_LATEST_RELEASE_API = "https://api.github.com/repos/ninemouth/ozon-growth-agent/releases/latest";
const GITHUB_MANIFEST_URL = "https://raw.githubusercontent.com/ninemouth/ozon-growth-agent/main/manifest.json";

function summarizeTaskLogDetails(value = {}) {
  const safe = value && typeof value === "object" ? value : {};
  return {
    step: Number(safe.step || 0),
    toolName: safe.toolName || "",
    actionKind: safe.actionKind || "",
    actionLabel: safe.actionLabel || "",
    stage: safe.stage || "",
    errorCode: safe.errorCode || "",
    tabId: Number.isInteger(Number(safe.tabId)) ? Number(safe.tabId) : undefined,
    elapsedSeconds: Number(safe.elapsedSeconds || 0) || undefined,
  };
}

function taskLogSeverityForProgress(progress = {}) {
  if ([
    "tool_timeout",
    "captcha_warning",
    "paused_for_verification",
    "reflection",
    "workflow_timeout",
    "trend_query_guard",
    "trend_query_refinement_exhausted",
    "trend_evidence_downgrade_required",
  ].includes(progress.type)) return "warning";
  if (["error", "failed"].includes(progress.type)) return "error";
  return "info";
}

function hasClarificationInput(input = {}) {
  if (!input || typeof input !== "object") return false;
  return Boolean(String(input.seedKeyword || input.keyword || input.query || input.seedCategory || input.category || input.targetShop || input.shop || input.note || "").trim());
}

function buildClarificationRequest(researchScope = {}, message = {}) {
  const actionKind = message.growthActionId || "manual";
  const needsCategory = ["platform_trend", "category_opportunity", "store_trend_fit"].includes(researchScope.analysis_scope);
  return {
    actionKind,
    researchScope,
    title: "需要补充分析范围",
    message: "当前页面缺少足够的商品、类目或店铺线索。请补充一个关键词、目标类目或店铺方向后再启动正式分析，避免生成空报告。",
    fields: [
      { id: "seedKeyword", label: "探索关键词", placeholder: "例如：электрическая зубная щетка / 电动牙刷" },
      ...(needsCategory ? [{ id: "seedCategory", label: "目标类目", placeholder: "例如：3C / 家居 / 母婴 / 汽配" }] : []),
      { id: "targetShop", label: "关联店铺或 SKU", placeholder: "可选：店铺名、SKU、商品链接或经营目标" },
    ],
  };
}

async function recordTaskLog(input = {}) {
  try {
    return await appendTaskLog(input);
  } catch (err) {
    console.warn("Task log persistence failed:", err.message);
    return null;
  }
}

async function runWorkflowRecoverySweep(reason = "alarm") {
  const result = await recoverStaleWorkflows({
    staleAfterMs: WORKFLOW_RECOVERY_STALE_AFTER_MS,
    reason,
  });
  if (result.recovered?.length) {
    await recordTaskLog({
      category: "maintenance",
      severity: "warning",
      event: "workflow_recovery_sweep",
      message: `后台自愈巡检释放 ${result.recovered.length} 个过期 workflow，已保留为可恢复断点。`,
      details: result,
      source: "alarm",
    });
  }
  return result;
}

function getExtensionVersion() {
  return chrome.runtime.getManifest().version || "0.0.0";
}

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split(/[+-]/)[0]
    .replace(/[^0-9.]/g, "");
}

function compareSemver(a, b) {
  const left = normalizeVersion(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length, 3);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function readCachedUpdateStatus() {
  const cached = await getLocal([UPDATE_STATUS_KEY]);
  const currentVersion = getExtensionVersion();
  return cached[UPDATE_STATUS_KEY] || {
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    status: "unknown",
    checkedAt: "",
    releaseUrl: GITHUB_RELEASES_URL,
    source: "local_manifest",
  };
}

async function fetchLatestReleaseMetadata() {
  const releaseResponse = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (releaseResponse.ok) {
    const release = await releaseResponse.json();
    return {
      latestVersion: normalizeVersion(release.tag_name || release.name || ""),
      releaseUrl: release.html_url || GITHUB_RELEASES_URL,
      releaseName: release.name || release.tag_name || "",
      releaseNotes: release.body || "",
      source: "github_release",
    };
  }

  if (releaseResponse.status !== 404) {
    throw new Error(`GitHub Release 检查失败: HTTP ${releaseResponse.status}`);
  }

  const manifestResponse = await fetch(GITHUB_MANIFEST_URL, { cache: "no-store" });
  if (!manifestResponse.ok) {
    throw new Error(`GitHub manifest 检查失败: HTTP ${manifestResponse.status}`);
  }
  const manifest = await manifestResponse.json();
  return {
    latestVersion: normalizeVersion(manifest.version || ""),
    releaseUrl: GITHUB_RELEASES_URL,
    releaseName: "GitHub main manifest",
    releaseNotes: "",
    source: "github_manifest",
  };
}

async function checkForUpdates({ force = false } = {}) {
  const currentVersion = getExtensionVersion();
  const cached = await readCachedUpdateStatus();
  const checkedAt = cached.checkedAt ? Date.parse(cached.checkedAt) : 0;
  const isFresh = checkedAt && Date.now() - checkedAt < 60 * 60 * 1000;
  if (!force && isFresh) {
    return { ...cached, currentVersion };
  }

  try {
    const latest = await fetchLatestReleaseMetadata();
    const latestVersion = latest.latestVersion || currentVersion;
    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
    const status = {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate,
      status: hasUpdate ? "update_available" : "up_to_date",
      checkedAt: new Date().toISOString(),
      releaseUrl: latest.releaseUrl || GITHUB_RELEASES_URL,
      releaseName: latest.releaseName || "",
      releaseNotes: latest.releaseNotes || "",
      source: latest.source || "github",
      installMode: "source_or_unpacked",
    };
    await setLocal({ [UPDATE_STATUS_KEY]: status });
    return status;
  } catch (err) {
    const status = {
      ok: false,
      currentVersion,
      latestVersion: cached.latestVersion || currentVersion,
      hasUpdate: false,
      status: "check_failed",
      checkedAt: new Date().toISOString(),
      releaseUrl: cached.releaseUrl || GITHUB_RELEASES_URL,
      error: err.message,
      source: "github",
      installMode: "source_or_unpacked",
    };
    await setLocal({ [UPDATE_STATUS_KEY]: status });
    return status;
  }
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
    /选品|开发|类目|爆品|机会|牙刷|扩品/.test(inst);
  const hasPlatformTrendIntent =
    /平台趋势|趋势|大盘|热卖榜|排行榜|搜索趋势|季节性|yandex|google trends|google ru|站外需求|平台机会/.test(inst);
  const hasComplianceIntent =
    /合规|法规|认证|证书|侵权|商标|版权|eac|tr cu|欧亚经济联盟|禁售|安全审查|发布前审查|准入/.test(inst);

  if (hasComplianceIntent) {
    pushUnique(matched, "skills/ozon_compliance_auditor.skill.md");
  }

  if (hasPlatformTrendIntent && !hasShopOptimizationIntent) {
    pushUnique(matched, "skills/ozon_platform_trends.skill.md");
  }
  
  if (hasShopOptimizationIntent) {
    pushUnique(matched, "skills/ozon_global_shop_optimizer.skill.md");
  }

  if (hasProductOpportunityIntent && !hasShopOptimizationIntent && !hasPlatformTrendIntent && !hasComplianceIntent) {
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
          content: `你是一个 Ozon 跨境电商运营智能路由器。请根据用户的输入需求，从以下 8 个专有 AI 技能路径中选择所有最相关的技能路径：
1. "skills/ozon_product_opportunity_explorer.skill.md" (Ozon选品、类目需求分析、合规性风险审计)
2. "skills/ozon_platform_trends.skill.md" (Ozon平台公开搜索、Yandex.ru、Google RU/Trends 和趋势机会分析)
3. "skills/ozon_sourcing_finder.skill.md" (1688货源开发、卢布跨境利润套利测算、运费关税核算)
4. "skills/ozon_global_shop_optimizer.skill.md" (Ozon店铺经营诊断、Seller API对账、ABC分级优化)
5. "skills/ozon_operations_tracker.skill.md" (监控数据、对比优化阶段、流量曝光转化效果)
6. "skills/ozon_listing_generator.skill.md" (俄语 SEO Title/Description 商品详情文案生成)
7. "skills/ozon_review_analyzer.skill.md" (买家原声差评剖析、退换货与商品缺陷分析)
8. "skills/ozon_compliance_auditor.skill.md" (Ozon商品发布前合规、IP、产品安全与俄罗斯/欧亚经济联盟法规审查)

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
  const existing = await getLocal(["savedResults"]);
  const filtered = (existing.savedResults || []).filter((r) => r.id !== id);
  await setLocal({ savedResults: filtered });
}

async function exportResults() {
  const existing = await getLocal(["savedResults"]);
  return existing.savedResults || [];
}

function sanitizeBundleFileName(value = "", fallback = "artifact") {
  const cleaned = String(value || fallback)
    .replace(/^artifact:\/\//, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function extensionFromMimeType(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "bin";
}

async function exportEvidenceBundle(reportId, { includeArtifactPayloads = false } = {}) {
  if (!reportId) throw new Error("reportId is required");
  const existing = await getLocal(["savedResults"]);
  const saved = (existing.savedResults || []).find((item) => String(item.id) === String(reportId));
  if (!saved) throw new Error("saved report not found");
  const bundle = saved.evidence_bundle || null;
  if (!bundle) throw new Error("evidence bundle not found for this report");
  const refs = Array.isArray(bundle.screenshotRefs) ? bundle.screenshotRefs : [];
  const artifacts = [];
  const artifactPayloads = [];
  for (const ref of refs) {
    const dataUrl = await getArtifactDataUrl(ref);
    const mimeType = dataUrl?.match(/^data:([^;]+);/)?.[1] || "";
    artifacts.push({
      ref,
      available: Boolean(dataUrl),
      bytesApprox: dataUrl ? Math.round((String(dataUrl).length * 3) / 4) : 0,
      mimeType,
    });
    if (includeArtifactPayloads && dataUrl) {
      artifactPayloads.push({
        ref,
        filename: `${sanitizeBundleFileName(ref, "artifact")}.${extensionFromMimeType(mimeType)}`,
        mimeType,
        dataUrl,
      });
    }
  }
  const exported = {
    ...bundle,
    artifact_manifest: {
      checkedAt: new Date().toISOString(),
      total: refs.length,
      available: artifacts.filter((item) => item.available).length,
      missing: artifacts.filter((item) => !item.available).length,
      artifacts,
    },
  };
  if (includeArtifactPayloads) exported.artifact_payloads = artifactPayloads;
  return exported;
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
      id: "ozon_platform_trends",
      path: "skills/ozon_platform_trends.skill.md",
      name: "Ozon 平台趋势与公开需求研究专家",
      description: "基于 Ozon 搜索、Yandex.ru、Google RU/Trends 和公开竞品页面分析平台级需求窗口，不把自营 API 数据冒充平台大盘",
      icon: "📊",
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
    },
    {
      id: "ozon_compliance_auditor",
      path: "skills/ozon_compliance_auditor.skill.md",
      name: "Ozon 商品合规与发布风险审查专家",
      description: "审查 Ozon 商品在俄罗斯/欧亚经济联盟法规、IP、标签、材质安全和履约包装方面的发布风险",
      icon: "🛡️",
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
const WORKFLOW_CHECKPOINTS_KEY = "agentWorkflowCheckpoints";

function buildWorkflowCheckpointKey({ tabId, matchedSkills = [], message = {} } = {}) {
  if (message.workflowSessionId) return String(message.workflowSessionId);
  if (message.growthCaseId) return `growth_case:${message.growthCaseId}`;
  const skillPart = matchedSkills.join("+") || normalizeSkillPath(message.skillPath) || "auto";
  const actionPart = message.growthActionId || "manual";
  return `tab:${tabId || "unknown"}:${actionPart}:${skillPart}`;
}

async function getWorkflowCheckpoints() {
  const data = await getLocal([WORKFLOW_CHECKPOINTS_KEY]);
  return data[WORKFLOW_CHECKPOINTS_KEY] || {};
}

async function getWorkflowCheckpoint(key) {
  if (!key) return null;
  const runtimeRecord = await loadWorkflowSnapshot(key).catch(() => null);
  if (runtimeRecord?.snapshot) return { ...runtimeRecord.snapshot, runtimeStatus: runtimeRecord.status, workflowSequence: runtimeRecord.sequence };
  const checkpoints = await getWorkflowCheckpoints();
  return checkpoints[key] || null;
}

async function setWorkflowCheckpoint(key, patch = {}) {
  if (!key) return;
  await saveWorkflowSnapshot(key, {
    status: patch.status || "running",
    snapshot: {
      ...(patch || {}),
      key,
      updatedAt: new Date().toISOString(),
    },
  });
  await appendWorkflowEvent(key, patch.lastStage || patch.status || "checkpoint", {
    status: patch.status || "running",
    step: patch.step || 0,
    currentTool: patch.currentTool || "",
    lastStage: patch.lastStage || "",
  });

  const checkpoints = await getWorkflowCheckpoints();
  const previous = checkpoints[key] || {};
  checkpoints[key] = {
    ...previous,
    ...patch,
    key,
    updatedAt: new Date().toISOString(),
  };
  const entries = Object.entries(checkpoints)
    .sort((a, b) => new Date(b[1].updatedAt || 0) - new Date(a[1].updatedAt || 0))
    .slice(0, 30);
  await setLocal({ [WORKFLOW_CHECKPOINTS_KEY]: Object.fromEntries(entries) });
}

function isResumableCheckpoint(checkpoint) {
  return checkpoint && !["completed", "cancelled"].includes(checkpoint.status);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "ozon-agent-loop") {
    const portId = Date.now().toString();
    activePorts.set(portId, port);
    let isCancelled = false;
    let activeCheckpointKey = "";
    let runInFlight = false;
    let leaseRenewTimer = null;
    const cleanupActiveWorkflowTabs = (checkpointKey = activeCheckpointKey) => {
      if (!checkpointKey) return Promise.resolve();
      return cleanupOwnedTabs(checkpointKey);
    };

    port.onDisconnect.addListener(() => {
      isCancelled = true;
      activePorts.delete(portId);
      if (activeCheckpointKey) {
        workflowEngine.cancel(activeCheckpointKey, "port_disconnected").catch((err) => console.warn("Could not cancel workflow engine job:", err.message));
        recordTaskLog({
          workflowId: activeCheckpointKey,
          category: "workflow",
          severity: "warning",
          event: "port_disconnected",
          message: "前台连接断开，工作流已保存为可恢复断点。",
          source: "background",
        });
        requestWorkflowCancellation(activeCheckpointKey, "port_disconnected").catch((err) => console.warn("Could not request workflow cancellation:", err.message));
        setWorkflowCheckpoint(activeCheckpointKey, {
          status: "interrupted",
          lastStage: "port_disconnected",
          interruptedAt: new Date().toISOString(),
        }).catch((err) => console.warn("Could not persist interrupted checkpoint:", err.message));
        cleanupActiveWorkflowTabs(activeCheckpointKey).catch((err) => console.warn("Could not cleanup owned tabs:", err.message));
        releaseWorkflowLease(activeCheckpointKey, portId, "interrupted").catch((err) => console.warn("Could not release workflow lease:", err.message));
      }
      if (leaseRenewTimer) clearInterval(leaseRenewTimer);
      console.log(`Port ${portId} disconnected.`);
    });

    port.onMessage.addListener(async (message) => {
      if (message.type === "CANCEL_WORKFLOW") {
        if (!activeCheckpointKey) {
          try {
            port.postMessage({
              type: "ERROR",
              error: "当前没有可暂停的运行中 workflow。",
              resumable: false,
            });
          } catch (_) {}
          return;
        }
        try {
          await recordTaskLog({
            workflowId: activeCheckpointKey,
            category: "workflow",
            severity: "warning",
            event: "pause_requested",
            message: "用户请求暂停工作流，正在保存断点。",
            source: "background",
          });
          await workflowEngine.cancel(activeCheckpointKey, message.reason || "user_paused");
          await requestWorkflowCancellation(activeCheckpointKey, message.reason || "user_paused");
          await setWorkflowCheckpoint(activeCheckpointKey, {
            status: "interrupted",
            lastStage: "user_paused",
            pausedAt: new Date().toISOString(),
            interruptionReason: "user_paused",
          });
          port.postMessage({
            type: "PROGRESS",
            data: {
              type: "workflow_timeout",
              step: 0,
              message: "已收到暂停请求，正在保存当前断点。当前工具或 AI 请求完成边界后会停止，可发送“继续”恢复。",
            },
          });
        } catch (err) {
          try {
            port.postMessage({
              type: "ERROR",
              error: `暂停失败：${err.message}`,
              resumable: true,
              resumeHint: "如已保存断点，可发送“继续”恢复。",
            });
          } catch (_) {}
        }
        return;
      }

      if (message.type === "RUN_SKILL") {
        if (runInFlight) {
          port.postMessage({
            type: "ERROR",
            error: "当前已有 workflow 正在执行。请等待当前任务完成，或发送“继续”恢复已保存断点，避免并发任务重复开页和重复调用 AI。",
            resumable: true,
          });
          return;
        }
        runInFlight = true;
        try {
          const tab = port.sender?.tab?.id ? port.sender.tab : await getCurrentTab();
          if (!tab) throw new Error("无法获取当前活动的标签页，请确保浏览器焦点在目标网页上。");

          // Reset the session data cache at the start of a new run
          resetSessionData();
          // Step 1: Read current page context
          let pageContext = {};
          try {
            pageContext = await tools.read_current_page({ __sourceTabId: tab.id });
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
          const [activeShopId, boundShops] = await Promise.all([getActiveShopId(), getBoundShops()]);
          const researchScope = buildResearchScope({
            pageContext,
            tab,
            userInstruction: message.userInstruction || "",
            growthActionId: message.growthActionId || "",
            matchedSkills,
            activeShopId,
            boundShops,
            clarificationInput: message.clarificationInput || {},
          });
          if (researchScope.needs_user_clarification && !researchScope.auto_discovery_required && !hasClarificationInput(message.clarificationInput) && !message.continueSession) {
            const request = buildClarificationRequest(researchScope, message);
            await recordTaskLog({
              workflowId: buildWorkflowCheckpointKey({ tabId: tab.id, matchedSkills, message }),
              category: "workflow",
              severity: "warning",
              event: "clarification_required",
              message: "页面上下文不足，已暂停正式工作流并请求用户补充关键词、类目或店铺范围。",
              details: { actionKind: message.growthActionId || "manual", sourcePageRole: researchScope.source_page_role },
              source: "background",
            });
            port.postMessage({
              type: "CLARIFICATION_REQUIRED",
              data: request,
              originalMessage: {
                ...message,
                matchedSkills,
              },
            });
            return;
          }
          if (researchScope.diagnosis_mode === "outer_visitor_diagnosis") {
            port.postMessage({
              type: "PROGRESS",
              data: {
                type: "workflow_scope_notice",
                step: 0,
                message: "当前未匹配到已绑定 Seller API 店铺，本轮将按外围诊断执行：只使用公开页面、搜索、竞品和趋势证据，不伪造后台流量/订单数据。",
              },
            });
          }
          if (researchScope.auto_discovery_required) {
            port.postMessage({
              type: "PROGRESS",
              data: {
                type: "auto_discovery_scope",
                step: 0,
                message: "当前未指定关键词，平台趋势将自动从当前页面公开线索、Ozon 首页推荐、热词/排行/类目入口和 Yandex/Google RU 公开趋势生成候选研究范围。",
              },
            });
          }
          console.log("Matched Ozon skills:", matchedSkills);
          const checkpointKey = buildWorkflowCheckpointKey({ tabId: tab.id, matchedSkills, message });
          activeCheckpointKey = checkpointKey;
          port.postMessage({
            type: "PROGRESS",
            data: {
              type: "workflow_queued",
              step: 0,
              actionKind: message.growthActionId || "manual",
              message: "工作流已提交到全局调度器，将按队列串行执行，避免多个任务同时开页和重复采集。",
            },
          });
          await workflowEngine.submit({
            workflowId: checkpointKey,
            ownerId: portId,
            actionKind: message.growthActionId || "manual",
            source: "background.RUN_SKILL",
            metadata: {
              tabId: tab.id,
              pageUrl: tab.url || "",
              pageTitle: tab.title || "",
              matchedSkills,
              growthRunId: message.growthRunId || "",
              growthCaseId: message.growthCaseId || "",
            },
          }, async () => {
          protectWorkflowTab(checkpointKey, tab.id);
          const lease = await acquireWorkflowLease(checkpointKey, portId);
          if (!lease.ok) {
            throw new Error("该 workflow 当前已由另一个执行实例占用，请等待其结束或断点过期后再恢复。");
          }
          await clearWorkflowCancellation(checkpointKey);
          leaseRenewTimer = setInterval(() => {
            renewWorkflowLease(checkpointKey, portId).catch((err) => console.warn("Could not renew workflow lease:", err.message));
          }, 15_000);
          const existingCheckpoint = await getWorkflowCheckpoint(checkpointKey);
          const hasExplicitWorkflowSession = Boolean(message.workflowSessionId);
          const forceNewSession = Boolean(message.forceNewSession);
          const shouldResumeFromCheckpoint = !forceNewSession && isResumableCheckpoint(existingCheckpoint) && (
            Boolean(message.continueSession) ||
            (!hasExplicitWorkflowSession && (Boolean(message.userInstruction) || Boolean(message.growthCaseId)))
          );
          await recordTaskLog({
            workflowId: checkpointKey,
            category: "workflow",
            severity: "info",
            event: shouldResumeFromCheckpoint ? "workflow_resumed" : "workflow_started",
            message: shouldResumeFromCheckpoint ? "工作流从已保存断点恢复执行。" : "工作流已开始执行。",
            details: {
              actionKind: message.growthActionId || "manual",
              tabId: tab.id,
              matchedSkills,
              sourcePageRole: researchScope.source_page_role,
            },
            source: "background",
          });
          pageContext.research_scope = shouldResumeFromCheckpoint
            ? existingCheckpoint?.research_scope || existingCheckpoint?.snapshot?.research_scope || researchScope
            : researchScope;
          pageContext.trend_context_type = pageContext.research_scope.trend_context_type;

          if (shouldResumeFromCheckpoint) {
            port.postMessage({
              type: "PROGRESS",
              data: {
                type: "reflection",
                step: existingCheckpoint.step || 0,
                message: `🔁 已找到可恢复工作流：${existingCheckpoint.lastStage || existingCheckpoint.status || "checkpoint"}。将沿用 ${existingCheckpoint.toolHistory?.length || 0} 条工具证据继续执行。`
              }
            });
          }

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
            recordTaskLog({
              workflowId: checkpointKey,
              category: progressData.toolName ? "tool" : "workflow",
              severity: taskLogSeverityForProgress(progressData),
              event: progressData.type || "progress",
              message: String(progressData.message || progressData.actionLabel || progressData.toolName || "工作流进度更新"),
              details: summarizeTaskLogDetails(progressData),
              source: "agent_loop",
            });
            port.postMessage({ type: "PROGRESS", data: progressData });
          };

          const result = await runAgentLoop({
            tabId: tab.id,
            skillId: matchedSkills.join("+"),
            skillMarkdown: combinedSkillsMarkdown,
            userInstruction: message.userInstruction,
            pageContext,
            sendProgress,
            continueSession: Boolean(message.continueSession || shouldResumeFromCheckpoint),
            highRandomness: message.highRandomness,
            negativeFilter: message.negativeFilter,
            resumeState: shouldResumeFromCheckpoint ? existingCheckpoint : null,
            workflowId: checkpointKey,
            workflowGeneration: lease.generation,
            onCheckpoint: async (checkpoint) => {
              await setWorkflowCheckpoint(checkpointKey, {
                ...checkpoint,
                matchedSkills,
                skillPath: matchedSkills.join("+"),
                growthActionId: message.growthActionId || "",
                growthRunId: message.growthRunId || "",
                growthCaseId: message.growthCaseId || "",
                pageUrl: tab.url || "",
                pageTitle: tab.title || "",
                research_scope: pageContext.research_scope,
                workflowGeneration: lease.generation,
              });
              await recordTaskLog({
                workflowId: checkpointKey,
                category: "checkpoint",
                severity: "info",
                event: checkpoint.lastStage || checkpoint.status || "checkpoint",
                message: `工作流检查点已保存：${checkpoint.lastStage || checkpoint.status || "running"}。`,
                details: { step: checkpoint.step, toolName: checkpoint.currentTool, stage: checkpoint.lastStage },
                source: "workflow_runtime",
              });
            },
          });

          if (!isCancelled) {
            // Automatically save successful runs to savedResults
            let savedEntry = null;
            try {
              const existing = await getLocal(["savedResults"]);
              const savedResults = existing.savedResults || [];
              
              const evidenceQuality = summarizeEvidenceQuality({
                output: result.result || {},
                pageContext,
                researchScope: pageContext.research_scope,
              });
              const newEntry = {
                id: Date.now(),
                createdAt: new Date().toISOString(),
                skillId: matchedSkills.join("+"),
                skillName: matchedNames.map(name => name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())).join(" + "),
                pageUrl: tab.url || "",
                pageTitle: tab.title || "",
                shopId: pageContext.research_scope?.active_shop_id || "",
                growthActionId: message.growthActionId || "",
                growthRunId: message.growthRunId || "",
                growthCaseId: message.growthCaseId || "",
                research_scope: pageContext.research_scope,
                evidence_quality: evidenceQuality,
                result: result.result // The parsed final output object containing overview, analysis, and data items
              };
              newEntry.evidence_bundle = buildEvidenceBundle({
                savedEntry: newEntry,
                output: result.result || {},
                pageContext,
                researchScope: pageContext.research_scope,
                evidenceQuality,
                toolHistory: result.toolHistory || [],
                workflowId: checkpointKey,
              });
              
              savedResults.unshift(newEntry);
              await setLocal({ savedResults: savedResults.slice(0, 100) });
              await upsertGrowthCaseFromResult({
                savedEntry: newEntry,
                output: result.result || {},
                researchScope: pageContext.research_scope,
                pageContext,
              });
              savedEntry = newEntry;
              console.log("Successfully saved run results to savedResults database for dashboard.");
              await recordTaskLog({
                workflowId: checkpointKey,
                category: "report",
                severity: "info",
                event: "report_saved",
                message: "工作流报告与证据包已保存到本地归档。",
                details: { actionKind: message.growthActionId || "manual" },
                source: "background",
              });
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
            await setWorkflowCheckpoint(checkpointKey, {
              status: "completed",
              completedAt: new Date().toISOString(),
              lastStage: "success_delivered",
            });
            if (leaseRenewTimer) clearInterval(leaseRenewTimer);
            leaseRenewTimer = null;
            await cleanupActiveWorkflowTabs(checkpointKey);
            await releaseWorkflowLease(checkpointKey, portId, "completed");
            await recordTaskLog({
              workflowId: checkpointKey,
              category: "workflow",
              severity: "info",
              event: "workflow_completed",
              message: "工作流已完成并释放运行租约。",
              source: "background",
            });
            pruneTaskLogs().catch((err) => console.warn("Task log prune skipped:", err.message));
            activeCheckpointKey = "";
          }
          if (isCancelled) {
            throw new Error("workflow cancellation requested");
          }
          });
        } catch (err) {
          const verificationPaused = /workflow verification required|paused_for_verification/i.test(String(err.message || ""));
          const workflowPaused = verificationPaused || /workflow cancellation requested|user_paused|cancelled before start/i.test(String(err.message || ""));
          if (workflowPaused && activeCheckpointKey) {
            const interruptionReason = verificationPaused ? "paused_for_verification" : "user_paused";
            await recordTaskLog({
              workflowId: activeCheckpointKey,
              category: "workflow",
              severity: "warning",
              event: verificationPaused ? "workflow_paused_for_verification" : "workflow_interrupted",
              message: verificationPaused ? "工作流已暂停等待人工完成验证码/登录验证，断点可恢复。" : "工作流已暂停，断点可恢复。",
              source: "background",
            });
            await setWorkflowCheckpoint(activeCheckpointKey, {
              status: "interrupted",
              error: "",
              lastStage: interruptionReason,
              interruptedAt: new Date().toISOString(),
              interruptionReason,
            });
            if (!verificationPaused) {
              cleanupActiveWorkflowTabs(activeCheckpointKey).catch((cleanupErr) => console.warn("Could not cleanup owned tabs:", cleanupErr.message));
            }
            releaseWorkflowLease(activeCheckpointKey, portId, "interrupted").catch((leaseErr) => console.warn("Could not release interrupted workflow lease:", leaseErr.message));
            if (leaseRenewTimer) clearInterval(leaseRenewTimer);
            leaseRenewTimer = null;
            try {
              port.postMessage({
                type: "INTERRUPTED",
                result: {
                  type: "interrupted",
                  result: verificationPaused
                    ? "工作流已暂停等待人工验证。请在打开的货源页面完成验证码/登录后发送“继续”。"
                    : "工作流已暂停并保存断点。",
                },
                resumable: true,
                resumeHint: verificationPaused
                  ? "完成验证/登录后发送“继续”，系统会从验证码阻断点后的上下文恢复。"
                  : "发送“继续”或从历史会话选择该断点即可恢复。",
              });
            } catch (_) {}
            activeCheckpointKey = "";
            return;
          }
          if (activeCheckpointKey) {
            await setWorkflowCheckpoint(activeCheckpointKey, {
              status: "failed",
              error: err.message,
              lastStage: "error",
              failedAt: new Date().toISOString(),
            });
          }
          await recordTaskLog({
            workflowId: activeCheckpointKey,
            category: "workflow",
            severity: "error",
            event: "workflow_failed",
            message: `工作流失败：${err.message}`,
            details: { errorCode: err.code || "WORKFLOW_ERROR" },
            source: "background",
          });
          if (activeCheckpointKey) {
            cleanupActiveWorkflowTabs(activeCheckpointKey).catch((cleanupErr) => console.warn("Could not cleanup owned tabs:", cleanupErr.message));
            releaseWorkflowLease(activeCheckpointKey, portId, "failed").catch((leaseErr) => console.warn("Could not release failed workflow lease:", leaseErr.message));
          }
          if (leaseRenewTimer) clearInterval(leaseRenewTimer);
          leaseRenewTimer = null;
          if (!isCancelled) {
            port.postMessage({
              type: "ERROR",
              error: err.message,
              errorCode: err.code || "WORKFLOW_ERROR",
              resumable: true,
              resumeHint: "本次 workflow 已尽量保存断点。可输入“继续”恢复上次中断节点。",
            });
          }
        } finally {
          runInFlight = false;
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

  if (message.type === "GET_TASK_LOGS") {
    listTaskLogs({
      workflowId: message.workflowId || "",
      severity: message.severity || "",
      limit: message.limit || 200,
    }).then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_WORKFLOW_ENGINE_STATE") {
    sendResponse({ ok: true, data: workflowEngine.getState() });
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

  if (message.type === "EXPORT_EVIDENCE_BUNDLE") {
    exportEvidenceBundle(message.reportId, { includeArtifactPayloads: Boolean(message.includeArtifactPayloads) })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_UPDATE_STATUS") {
    readCachedUpdateStatus()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "CHECK_FOR_UPDATES") {
    checkForUpdates({ force: Boolean(message.force) })
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
          
          const storage = await getLocal(["monitorTasks"]);
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
            await setLocal({ monitorTasks: tasks });
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
  if (alarm.name === TASK_LOG_PRUNE_ALARM) {
    const result = await pruneTaskLogs();
    await recordTaskLog({
      category: "maintenance",
      severity: "info",
      event: "task_logs_pruned",
      message: `任务日志定期清理完成，删除 ${result.deleted || 0} 条过期或超限记录。`,
      details: result,
      source: "alarm",
    });
    return;
  }
  if (alarm.name === UPDATE_CHECK_ALARM) {
    await checkForUpdates({ force: true });
    return;
  }
  if (alarm.name === WORKFLOW_RECOVERY_ALARM) {
    await runWorkflowRecoverySweep("alarm");
    return;
  }

  if (alarm.name.startsWith("monitor_task_")) {
    const taskJson = alarm.name.slice("monitor_task_".length);
    try {
      const task = JSON.parse(decodeURIComponent(taskJson));
      if (task && task.target_url) {
        await recordTaskLog({
          workflowId: `monitor:${task.id || "unknown"}`,
          category: "monitor",
          severity: "info",
          event: "monitor_started",
          message: "定时监控任务已启动。",
          details: { actionKind: task.task_type || "monitor", tabId: undefined },
          source: "alarm",
        });
        const monitorWorkflowId = `monitor:${task.id || "unknown"}`;
        let monitorTab = null;
        try {
          console.log("Triggering scheduled background monitoring check for:", task.target_url);
          monitorTab = await createOwnedTab({
            workflowId: monitorWorkflowId,
            url: task.target_url,
            active: false,
          });
          await recordTaskLog({
            workflowId: monitorWorkflowId,
            category: "monitor",
            severity: "info",
            event: "monitor_tab_opened",
            message: "定时监控页面已打开，正在等待动态内容稳定。",
            details: { tabId: monitorTab.id },
            source: "alarm",
          });
          const ready = await waitForPageCaptureReady(monitorTab.id, {
            workflowId: monitorWorkflowId,
            expectedUrl: task.target_url,
            label: "scheduled_monitor",
            progressLabel: task.target_type === "shop" ? "店铺监控页面" : "商品监控页面",
            timeoutMs: 22_000,
            maxAttempts: 34,
            pollMs: 650,
            minQuietMs: 1800,
            minStableReads: 2,
            requireEvidence: false,
            progress: (stage, message, extra = {}) => recordTaskLog({
              workflowId: monitorWorkflowId,
              category: "monitor",
              severity: stage === "tab_readiness_ready" ? "info" : "debug",
              event: stage,
              message,
              details: extra,
              source: "alarm",
            }),
          });
          const pageData = ready.pageData || {};
          if (!ready.ok && !pageData.url && !pageData.title) {
            throw new Error(ready.readError || "定时监控页面没有形成可读证据");
          }
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
                  id: p.id || p.product_link || globalThis.crypto?.randomUUID?.() || Math.random().toString(),
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
            const stored = await getLocal(["monitorTasks"]);
            const storedTasks = stored.monitorTasks || [];
            const matchTask = storedTasks.find(t => t.id === task.id);
            if (matchTask) {
              matchTask.last_run_at = new Date().toLocaleString();
              await setLocal({ monitorTasks: storedTasks });
            }
          } catch (err) {
            console.warn("Failed to update last_run_at for alarm task:", err.message);
          }

          console.log("Scheduled monitor check processed successfully for:", task.target_url);
          await recordTaskLog({
            workflowId: monitorWorkflowId,
            category: "monitor",
            severity: ready.ok ? "info" : "warning",
            event: "monitor_completed",
            message: ready.ok ? "定时监控任务已完成页面采集与变化比对。" : "定时监控任务使用超时前的最后可读页面证据完成比对。",
            details: {
              tabId: monitorTab.id,
              readiness: ready.readiness,
              readyReason: ready.readyReason,
              elapsedSeconds: Math.round((ready.elapsedMs || 0) / 1000),
              itemCount: items.length,
            },
            source: "alarm",
          });
        } catch (monitorErr) {
          console.error("Scheduled check page extraction failed:", monitorErr);
          await recordTaskLog({
            workflowId: monitorWorkflowId,
            category: "monitor",
            severity: "error",
            event: "monitor_failed",
            message: `定时监控任务失败：${monitorErr.message}`,
            details: { tabId: monitorTab?.id },
            source: "alarm",
          });
        } finally {
          if (monitorTab?.id) await closeOwnedTab(monitorWorkflowId, monitorTab.id);
        }
      }
    } catch (err) {
      console.error("Error running alarm task:", err);
      await recordTaskLog({
        workflowId: `monitor:${String(alarm.name || "unknown")}`,
        category: "monitor",
        severity: "error",
        event: "monitor_failed",
        message: `定时监控任务失败：${err.message}`,
        source: "alarm",
      });
    }
  }
});

// ── Initialize Default Settings on Installation ──
chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    const data = await getLocal(["llmProvider"]);
    if (!data.llmProvider) {
      await setLocal({
        llmProvider: "qwen",
        llmModel: "qwen-max",
        temperature: "0.2",
        maxLoopSteps: "25",
        ozonTargetMargin: "20",
        ozonWarehouseType: "FBS",
        ozonLogisticsCostProfile: {
          warehouseType: "FBS",
          baseFeeCny: 2,
          cnyPerKg: 5.5,
          packagingFeeCny: 2,
          source: "default_profile",
          updatedAt: new Date().toISOString(),
        }
      });
    }
  })().catch((err) => console.warn("Default settings initialization skipped:", err.message));
  chrome.alarms.create(UPDATE_CHECK_ALARM, { periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES });
  chrome.alarms.create(TASK_LOG_PRUNE_ALARM, { periodInMinutes: TASK_LOG_PRUNE_INTERVAL_MINUTES });
  chrome.alarms.create(WORKFLOW_RECOVERY_ALARM, { periodInMinutes: WORKFLOW_RECOVERY_INTERVAL_MINUTES });
  pruneTaskLogs().catch((err) => console.warn("Initial task log prune skipped:", err.message));
  runWorkflowRecoverySweep("installed").catch((err) => console.warn("Initial workflow recovery sweep skipped:", err.message));
  checkForUpdates({ force: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(UPDATE_CHECK_ALARM, { periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES });
  chrome.alarms.create(TASK_LOG_PRUNE_ALARM, { periodInMinutes: TASK_LOG_PRUNE_INTERVAL_MINUTES });
  chrome.alarms.create(WORKFLOW_RECOVERY_ALARM, { periodInMinutes: WORKFLOW_RECOVERY_INTERVAL_MINUTES });
  pruneTaskLogs().catch((err) => console.warn("Startup task log prune skipped:", err.message));
  runWorkflowRecoverySweep("startup").catch((err) => console.warn("Startup workflow recovery sweep skipped:", err.message));
});
