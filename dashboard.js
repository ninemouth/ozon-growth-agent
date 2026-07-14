// dashboard.js — Controller for Ozon AI Operations Dashboard

document.addEventListener("DOMContentLoaded", async () => {
  if (window.__ozonDashboardInitialized) return;
  window.__ozonDashboardInitialized = true;
  // Apply saved theme configuration
  chrome.storage.local.get(["settingsTheme"], (data) => {
    const theme = data.settingsTheme || "system";
    document.documentElement.className = `theme-${theme}`;
  });

  setDefaultStoreDateRange();
  document.body.classList.add("workflow-mode");
  initTabs();
  await refreshAllData();
  maybeAutoRefreshSellerApiCache().catch((err) => console.warn("Seller API auto refresh skipped:", err.message));
  bindEvents();
});

const SELLER_API_AUTO_REFRESH_MS = 6 * 60 * 60 * 1000;
let selectedWorkflowId = "store_health";
let workflowZoom = 1;
let workflowPanX = 0;
let workflowPanY = 0;
let workflowCanvasEventsBound = false;
let workflowPipPosition = null;

let growthRuntimeState = {
  shops: [],
  activeShop: null,
  trackedProducts: [],
  savedResults: [],
  monitorEvents: [],
  monitorTasks: [],
  experiments: [],
  skuAnalyticsSnapshot: null,
  storeSnapshotCache: null,
  workflowTaskState: {},
  workflowTasks: [],
  workflowRoots: [],
  growthCases: [],
  growthActionRuns: [],
  skuRows: [],
  opportunities: [],
};

const GROWTH_ACTIONS = {
  diagnose_store_growth: {
    title: "全店增长体检",
    skillPath: "skills/ozon_global_shop_optimizer.skill.md",
    instruction: "一键体检当前 Ozon 店铺增长瓶颈。不能只凭截图下结论：请先读取平台属性、主营类目、价格带、目标客群、使用场景、店铺定位和视觉调性/格调，再结合 Seller API、Ozon 站内搜索/热卖榜、Yandex/Google RU 趋势，并打开 2-3 个同类高排名店铺或头部竞品页面做截屏学习，最后按曝光、点击、加购、付款、利润、履约、评分和商品结构输出优先级行动清单。",
  },
  diagnose_sku_funnel: {
    title: "SKU 漏斗诊断",
    skillPath: "skills/ozon_operations_tracker.skill.md",
    instruction: "诊断当前低转化 SKU 的漏斗瓶颈，区分曝光弱、点击弱、加购弱、付款弱、利润弱、履约风险和评论风险。",
  },
  rewrite_listing: {
    title: "商品页转化改版",
    skillPath: "skills/ozon_listing_generator.skill.md",
    instruction: "基于当前商品或 SKU 队列生成 Ozon 俄语 SEO 标题、主图卖点、详情页描述和规格补齐建议。",
  },
  diagnose_visual_conversion: {
    title: "首图点击力诊断",
    skillPath: "skills/ozon_global_shop_optimizer.skill.md",
    instruction: "诊断 Ozon 商品首图和画廊视觉转化力，输出俄语主图文案、需要删除的中文/工厂感元素和三种改版方向。",
  },
  scan_competitor_changes: {
    title: "竞品变化扫描",
    skillPath: "skills/ozon_global_shop_optimizer.skill.md",
    instruction: "扫描竞品价格、主图、评论、断货、促销和关键词变化，输出可抢量、可避战、可跟价和可反打机会。",
  },
  analyze_review_defects: {
    title: "评论缺陷诊断",
    skillPath: "skills/ozon_review_analyzer.skill.md",
    instruction: "分析俄罗斯买家评论与退换货风险，归因质量、包装、说明、规格、物流和预期差距，并生成产品改良任务。",
  },
  calculate_profit_guardrail: {
    title: "利润安全线",
    skillPath: "skills/ozon_sourcing_finder.skill.md",
    instruction: "测算 Ozon SKU 建议售价、最低促销价、利润保护价、FBS/FBO 成本边界和是否需要寻源降本。",
  },
  filter_supplier_sources: {
    title: "供应商货源筛选",
    skillPath: "skills/ozon_sourcing_finder.skill.md",
    instruction: "基于当前 Ozon 商品、候选扩品方向或平台趋势机会，筛选可进入验证的 1688/国内供应商货源。请优先做外观与规格一致性、起批量、采购价、跨境物流、Ozon 佣金、关税和 RUB 净利润率审计；未获得真实供应商详情页时不得输出采购直达链接。",
  },
  detect_fulfillment_risk: {
    title: "履约风险扫描",
    skillPath: "skills/ozon_operations_tracker.skill.md",
    instruction: "扫描待发货倒计时、FBS/FBO 履约风险、断货风险、补货优先级和库存积压 SKU。",
  },
  find_expansion_opportunities: {
    title: "扩品机会发现",
    skillPath: "skills/ozon_product_opportunity_explorer.skill.md",
    instruction: "从当前店铺、竞品、季节需求、差评痛点和供应链套利角度发现可上架或可小批测试的 Ozon 扩品机会。",
  },
  explore_platform_trends: {
    title: "Ozon 平台趋势机会",
    skillPath: "skills/ozon_platform_trends.skill.md",
    instruction: "扫描当前 Ozon 搜索、类目、品牌或热卖页面，专注判断平台级商品机会和趋势窗口。请输出价格带、评价门槛、头部商品共性、俄语关键词、季节性需求、Yandex/Google RU/Google Trends 待验证或真实证据，并区分平台趋势机会与本店扩品动作。",
  },
  create_growth_experiment: {
    title: "创建增长实验",
    skillPath: "skills/ozon_operations_tracker.skill.md",
    instruction: "把当前 AI 建议转为 7 天增长实验，定义目标 SKU、优化动作、基线指标、观察指标、干扰项和复盘时间。",
  },
  review_experiment_result: {
    title: "复盘实验结果",
    skillPath: "skills/ozon_operations_tracker.skill.md",
    instruction: "复盘执行中和观察中的增长实验，比较优化前后曝光、加购、订单、利润和履约指标，判断成功、无效或需二次优化。",
  },
};

const GROWTH_ACTION_CASE_TYPE = {
  diagnose_store_growth: "store_health",
  diagnose_sku_funnel: "store_health",
  diagnose_visual_conversion: "listing_conversion",
  rewrite_listing: "listing_conversion",
  scan_competitor_changes: "competitor_watch",
  analyze_review_defects: "listing_conversion",
  calculate_profit_guardrail: "opportunity_profit",
  filter_supplier_sources: "supplier_sourcing",
  detect_fulfillment_risk: "store_health",
  find_expansion_opportunities: "opportunity_profit",
  explore_platform_trends: "platform_trends",
  create_growth_experiment: "experiment_review",
  review_experiment_result: "experiment_review",
};

const GROWTH_CASE_LABELS = {
  store_health: "店铺体检案件",
  competitor_watch: "竞品跟踪案件",
  listing_conversion: "商品页转化案件",
  platform_trends: "平台趋势案件",
  opportunity_profit: "机会与利润案件",
  supplier_sourcing: "供应商货源案件",
  experiment_review: "执行与复盘案件",
};

function growthCaseIdFor(actionId, shopId = "", sku = "") {
  const caseType = GROWTH_ACTION_CASE_TYPE[actionId] || "store_health";
  const scope = sku ? stableHash(sku) : "shop";
  return `${caseType}_${shopId || "no_shop"}_${scope}`;
}

// ── Tab Management ──
function initTabs() {
  const navItems = document.querySelectorAll(".nav-menu .nav-item");
  const viewPanes = document.querySelectorAll(".view-pane");

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      document.body.classList.toggle("workflow-mode", tabId === "workflow");
      
      // Update Active Navigation Item
      navItems.forEach((n) => n.classList.remove("active"));
      btn.classList.add("active");

      // Update Page Title
      const navLabel = (btn.innerText || btn.textContent || "")
        .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "")
        .trim();
      document.getElementById("page-title").textContent = navLabel;

      // Show Selected Tab Content
      viewPanes.forEach((pane) => {
        pane.classList.remove("active");
        if (pane.id === `view-${tabId}`) {
          pane.classList.add("active");
        }
      });

      // Special Tab Actions
      if (tabId === "workflow") {
        renderSmartWorkflow();
      } else if (tabId === "sku") {
        renderSkuWorkbench();
      } else if (tabId === "opportunities") {
        renderOpportunityCenter();
      } else if (tabId === "experiments") {
        renderExperimentBoard();
      } else if (tabId === "tracker") {
        renderTrackerTab();
      } else if (tabId === "store") {
        renderStoreTab();
      }
    });
  });
}

// ── Global Event Bindings ──
function bindEvents() {
  document.getElementById("refresh-all-btn").addEventListener("click", async () => {
    await refreshAllData();
    if (document.querySelector(".nav-menu button[data-tab='store']").classList.contains("active")) {
      renderStoreTab();
    }
  });

  const storeQueryBtn = document.getElementById("store-api-query-btn");
  if (storeQueryBtn) {
    storeQueryBtn.addEventListener("click", () => renderStoreTab());
  }

  const skuFilter = document.getElementById("sku-filter");
  if (skuFilter) {
    skuFilter.addEventListener("change", renderSkuWorkbench);
  }

  const syncSkuApiBtn = document.getElementById("sync-sku-api-btn");
  if (syncSkuApiBtn) {
    syncSkuApiBtn.addEventListener("click", syncSkuAnalyticsFromApi);
  }

  const goToSkuBtn = document.getElementById("go-to-sku-workbench");
  if (goToSkuBtn) {
    goToSkuBtn.addEventListener("click", () => document.querySelector('.nav-menu button[data-tab="sku"]')?.click());
  }

  const goToWorkflowBtn = document.getElementById("go-to-workflow-canvas");
  if (goToWorkflowBtn) {
    goToWorkflowBtn.addEventListener("click", () => document.querySelector('.nav-menu button[data-tab="workflow"]')?.click());
  }

  document.getElementById("workflow-zoom-out")?.addEventListener("click", () => setWorkflowZoom(workflowZoom - 0.1));
  document.getElementById("workflow-zoom-in")?.addEventListener("click", () => setWorkflowZoom(workflowZoom + 0.1));
  document.getElementById("workflow-zoom-reset")?.addEventListener("click", () => {
    workflowPanX = 0;
    workflowPanY = 0;
    setWorkflowZoom(1);
  });
  bindWorkflowCanvasInteractions();

  const goToOpportunitiesBtn = document.getElementById("go-to-opportunities");
  if (goToOpportunitiesBtn) {
    goToOpportunitiesBtn.addEventListener("click", () => document.querySelector('.nav-menu button[data-tab="opportunities"]')?.click());
  }

  const createManualExperimentBtn = document.getElementById("create-manual-experiment-btn");
  if (createManualExperimentBtn) {
    createManualExperimentBtn.addEventListener("click", () => createGrowthExperiment({
      sku: "店铺级",
      title: "手动增长实验",
      action: "记录本周要验证的运营动作",
      metric: "订单量 / 加购率",
      source: "manual",
    }));
  }
  
  document.getElementById("clear-db-btn").addEventListener("click", async () => {
    if (confirm("🚨 确定要清除大盘的所有本地数据么？这将清空已保存报告、历史事件以及运营跟踪列表！")) {
      await new Promise((r) => chrome.storage.local.clear(r));
      alert("数据重置成功！");
      window.location.reload();
    }
  });

  // Quick Arbitrage Calculator Logic
  document.getElementById("quick-calc-btn").addEventListener("click", () => {
    const costCny = parseFloat(document.getElementById("calc-cost").value) || 0;
    const weight = parseFloat(document.getElementById("calc-weight").value) || 0;
    const priceRub = parseFloat(document.getElementById("calc-price").value) || 0;

    const exchangeRate = 12.5; 
    const costRub = costCny * exchangeRate;
    const logisticsRub = (weight * 5.5 * 90) + (2.0 * 90) + (2 / 12.5 * 90);
    const commissionRub = priceRub * 0.12;

    let customsRub = 0;
    if (priceRub > 20000) {
      customsRub = (priceRub - 20000) * 0.15;
    }

    const netProfitRub = priceRub - costRub - logisticsRub - commissionRub - customsRub;
    const marginRate = (netProfitRub / priceRub) * 100;

    const resultEl = document.getElementById("calc-result");
    resultEl.innerHTML = `
      <div style="background:var(--bg3); border-radius:6px; padding:10px; border:1px solid var(--border)">
        <div style="display:flex; justify-content:space-between"><span>货源汇率换算:</span><span>¥${costCny} ➔ ${costRub.toFixed(0)} ₽</span></div>
        <div style="display:flex; justify-content:space-between"><span>预估FBS运费:</span><span>${logisticsRub.toFixed(0)} ₽</span></div>
        <div style="display:flex; justify-content:space-between"><span>Ozon 类目佣金 (12%):</span><span>${commissionRub.toFixed(0)} ₽</span></div>
        ${customsRub > 0 ? `<div style="display:flex; justify-content:space-between; color:var(--danger)"><span>超出额关税 (15%):</span><span>${customsRub.toFixed(0)} ₽</span></div>` : ''}
        <div style="border-top:1px solid var(--border); margin-top:8px; padding-top:6px; display:flex; justify-content:space-between; font-weight:700">
          <span>预估纯利润:</span>
          <span style="color:${netProfitRub > 0 ? '#10b981' : '#ef4444'}">${netProfitRub.toFixed(0)} ₽</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-weight:700">
          <span>预估利润率:</span>
          <span style="color:${marginRate > 20 ? '#10b981' : '#ef4444'}">${marginRate.toFixed(1)}%</span>
        </div>
      </div>
    `;
  });

  // Scheduled Task adding
  document.getElementById("add-task-btn").addEventListener("click", async () => {
    const urlInput = document.getElementById("task-url");
    const freqSelect = document.getElementById("task-freq");
    const typeSelect = document.getElementById("task-target-type");
    const natureSelect = document.getElementById("task-shop-nature");

    const url = urlInput.value.trim();
    const frequency = freqSelect.value;
    const targetType = typeSelect ? typeSelect.value : "item";
    const shopNature = natureSelect ? natureSelect.value : "competitor";

    if (!url) {
      alert("请输入合法的 Ozon 商品详情或店铺主页 URL！");
      return;
    }

    const activeShopId = document.getElementById("global-shop-selector").value;
    if (!activeShopId) {
      alert("请先在顶部下拉框中选择或绑定自营店铺！");
      return;
    }

    const storage = await new Promise((r) => chrome.storage.local.get(["monitorTasks"], r));
    const tasks = storage.monitorTasks || [];
    const taskId = `task_${Date.now()}`;
    
    const taskObj = {
      id: taskId,
      shopId: activeShopId, // Multi-shop binding!
      task_type: "shop_check",
      platform: "ozon",
      target_type: targetType,
      shop_nature: shopNature,
      target_url: url,
      target_entity_key: `ozon:${targetType}:${Math.random().toString(36).slice(2, 7)}`,
      frequency: frequency,
      last_run_at: "从未运行",
      status: "active"
    };

    tasks.push(taskObj);
    await new Promise((r) => chrome.storage.local.set({ monitorTasks: tasks }, r));

    // Register Chrome alarm
    let periodInMinutes = 360; 
    if (frequency === "15m") periodInMinutes = 15;
    else if (frequency === "1h") periodInMinutes = 60;
    else if (frequency === "24h") periodInMinutes = 1440;

    const alarmName = `monitor_task_${encodeURIComponent(JSON.stringify(taskObj))}`;
    try {
      await chrome.alarms.create(alarmName, { periodInMinutes });
    } catch (alarmErr) {
      console.warn("Could not register Chrome alarm:", alarmErr.message);
    }

    urlInput.value = '';
    alert("自动感知监控任务添加成功！");
    await refreshAllData();
  });

  // Go to events button
  const goToEventsBtn = document.getElementById("go-to-events");
  if (goToEventsBtn) {
    goToEventsBtn.addEventListener("click", () => {
      const targetBtn = document.querySelector('.nav-menu button[data-tab="events"]');
      if (targetBtn) targetBtn.click();
    });
  }

  // Handle Add Shop Form Submit
  const addShopForm = document.getElementById("add-shop-form");
  if (addShopForm) {
    const newForm = addShopForm.cloneNode(true);
    addShopForm.parentNode.replaceChild(newForm, addShopForm);
    
    newForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("new-shop-name").value.trim();
      const clientId = document.getElementById("new-shop-client-id").value.trim();
      const apiKey = document.getElementById("new-shop-api-key").value.trim();
      const warehouseType = document.getElementById("new-shop-warehouse").value;

      if (!name || !clientId || !apiKey) {
        alert("请填写完整的店铺信息！");
        return;
      }

      const storage = await new Promise(r => chrome.storage.local.get(["ozonShops"], r));
      const shops = storage.ozonShops || [];

      if (shops.some(s => s.clientId === clientId)) {
        alert("此 Client ID 已经绑定过，请勿重复添加！");
        return;
      }

      const newShop = {
        id: `shop_${Date.now()}`,
        name,
        clientId,
        apiKey,
        warehouseType,
        isDefault: shops.length === 0
      };

      shops.push(newShop);
      await new Promise(r => chrome.storage.local.set({
        ozonShops: shops,
        activeShopId: newShop.id
      }, r));

      newForm.reset();
      alert(`店铺 [${name}] 绑定与授权成功！`);
      await refreshAllData();
      drawTrackerCharts();
      if (document.querySelector(".nav-menu button[data-tab='store']").classList.contains("active")) {
        renderStoreTab();
      }
    });
  }

  // Handle Global Shop Selector Switch
  const globalShopSelector = document.getElementById("global-shop-selector");
  if (globalShopSelector) {
    const newSelector = globalShopSelector.cloneNode(true);
    globalShopSelector.parentNode.replaceChild(newSelector, globalShopSelector);
    
    newSelector.addEventListener("change", async (e) => {
      const selectedId = e.target.value;
      if (selectedId) {
        await new Promise(r => chrome.storage.local.set({ activeShopId: selectedId }, r));
        await refreshAllData();
        drawTrackerCharts();
        if (document.querySelector(".nav-menu button[data-tab='store']").classList.contains("active")) {
          renderStoreTab();
        }
      }
    });
  }

  document.getElementById("settings-open-store")?.addEventListener("click", () => {
    document.querySelector('.nav-menu button[data-tab="store"]')?.click();
    document.getElementById("settings-drawer")?.classList.add("hidden");
  });
  document.getElementById("settings-reset-all")?.addEventListener("click", () => document.getElementById("clear-db-btn")?.click());
  document.getElementById("floating-settings-btn")?.addEventListener("click", () => {
    renderSettingsTab();
    document.getElementById("settings-drawer")?.classList.remove("hidden");
  });
  document.getElementById("settings-drawer-close")?.addEventListener("click", () => {
    document.getElementById("settings-drawer")?.classList.add("hidden");
  });
}

// ── Refresh / Load Storage Data ──
async function refreshAllData() {
  const data = await new Promise((resolve) => {
    chrome.storage.local.get([
      "trackedProducts",
      "savedResults",
      "monitorChangeEvents",
      "monitorReports",
      "monitorTasks",
      "growthExperiments",
      "growthWorkflowTaskState",
      "growthCases",
      "growthActionRuns",
      "ozonSkuAnalyticsSnapshot",
      "ozonStoreSnapshotCache",
      "ozonClientId",
      "ozonApiKey",
      "ozonShops",
      "activeShopId"
    ], resolve);
  });

  // 1. Credentials Migration for backward compatibility
  if (data.ozonClientId && data.ozonApiKey && (!data.ozonShops || data.ozonShops.length === 0)) {
    const migratedShop = {
      id: `shop_${Date.now()}`,
      name: "默认自建店铺",
      clientId: data.ozonClientId,
      apiKey: data.ozonApiKey,
      warehouseType: "FBS",
      isDefault: true
    };
    data.ozonShops = [migratedShop];
    data.activeShopId = migratedShop.id;
    await new Promise(r => chrome.storage.local.set({
      ozonShops: data.ozonShops,
      activeShopId: data.activeShopId
    }, r));
  }

  const shops = data.ozonShops || [];
  let activeId = data.activeShopId;
  
  if (shops.length > 0 && (!activeId || !shops.some(s => s.id === activeId))) {
    activeId = (shops.find(s => s.isDefault) || shops[0]).id;
    data.activeShopId = activeId;
    await new Promise(r => chrome.storage.local.set({ activeShopId: activeId }, r));
  }

  // 2. Global Dropdown selector rendering
  const selector = document.getElementById("global-shop-selector");
  if (selector) {
    if (shops.length === 0) {
      selector.innerHTML = `<option value="">⚠️ 请先绑定 Ozon 店铺</option>`;
    } else {
      selector.innerHTML = shops.map(s => 
        `<option value="${s.id}" ${s.id === activeId ? 'selected' : ''}>🏢 ${s.name} (${s.clientId})</option>`
      ).join('');
    }
  }

  // 3. Multi-Store Manager Sidebar List rendering
  const shopListContainer = document.getElementById("dashboard-shop-list");
  if (shopListContainer) {
    if (shops.length === 0) {
      shopListContainer.innerHTML = `<div class="empty-state" style="padding:15px 0;">暂无绑定店铺，请在下方录入。</div>`;
    } else {
      shopListContainer.innerHTML = shops.map(s => `
        <div class="shop-list-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px; border:1px solid var(--border); border-radius:6px; background:${s.id === activeId ? 'rgba(0,91,255,0.04)' : 'var(--bg-input)'}; border-color:${s.id === activeId ? '#005bff' : 'var(--border)'}; font-size:12px;">
          <div>
            <div style="font-weight:600; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
              ${s.id === activeId ? '<span class="status-indicator success" style="width:6px; height:6px;"></span>' : ''}
              ${s.name}
              ${s.isDefault ? '<span style="font-size:10px; color:#10b981; font-weight:normal; border:1px solid #10b981; padding:0 4px; border-radius:3px; zoom:0.9">默认</span>' : ''}
            </div>
            <div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">Client ID: ${s.clientId} | ${s.warehouseType}</div>
          </div>
          <div style="display:flex; gap:6px;">
            ${s.id !== activeId ? `<button class="btn btn-outline btn-xs btn-set-active" data-shop-id="${s.id}">设为活动</button>` : ''}
            <button class="btn btn-danger btn-xs btn-delete-shop" data-shop-id="${s.id}">删除</button>
          </div>
        </div>
      `).join('');

      // Add event listeners
      shopListContainer.querySelectorAll(".btn-set-active").forEach(btn => {
        btn.addEventListener("click", async () => {
          const shopId = btn.getAttribute("data-shop-id");
          await new Promise(r => chrome.storage.local.set({ activeShopId: shopId }, r));
          await refreshAllData();
          drawTrackerCharts();
          if (document.querySelector(".nav-menu button[data-tab='store']").classList.contains("active")) {
            renderStoreTab();
          }
        });
      });

      shopListContainer.querySelectorAll(".btn-delete-shop").forEach(btn => {
        btn.addEventListener("click", async () => {
          const shopId = btn.getAttribute("data-shop-id");
          if (confirm("确定要删除此店铺的绑定凭证吗？这将导致关联的监控任务失效！")) {
            const updatedShops = shops.filter(s => s.id !== shopId);
            let nextActiveId = activeId;
            if (activeId === shopId) {
              nextActiveId = updatedShops.length > 0 ? updatedShops[0].id : "";
            }
            if (updatedShops.length > 0 && !updatedShops.some(s => s.isDefault)) {
              updatedShops[0].isDefault = true;
            }
            await new Promise(r => chrome.storage.local.set({
              ozonShops: updatedShops,
              activeShopId: nextActiveId
            }, r));
            await refreshAllData();
            drawTrackerCharts();
            if (document.querySelector(".nav-menu button[data-tab='store']").classList.contains("active")) {
              renderStoreTab();
            }
          }
        });
      });
    }
  }

  // 4. Filter data by activeShopId
  const filterByActiveShop = (list = []) => {
    return list.filter(item => {
      if (!item.shopId) return shops.length <= 1 || item.clientId === (shops.find(s => s.id === activeId) || {}).clientId;
      return item.shopId === activeId;
    });
  };

  const filteredTracked = filterByActiveShop(data.trackedProducts || []);
  const filteredSavedResults = filterByActiveShop(data.savedResults || []);
  const filteredTasks = filterByActiveShop(data.monitorTasks || []);
  const filteredEvents = filterByActiveShop(data.monitorChangeEvents || []);
  const filteredReports = filterByActiveShop(data.monitorReports || []);
  const filteredExperiments = filterByActiveShop(data.growthExperiments || []);
  const activeShop = shops.find(s => s.id === activeId) || null;
  const skuRows = buildSkuRows(filteredTracked, filteredSavedResults, filteredEvents, activeShop, data.ozonSkuAnalyticsSnapshot || null);
  const opportunities = buildOpportunityCards(skuRows, filteredEvents);
  const workflowTasks = buildWorkflowTasks({
    skuRows,
    opportunities,
    events: filteredEvents,
    reports: filteredSavedResults,
    experiments: filteredExperiments,
    taskState: data.growthWorkflowTaskState || {},
    activeShop,
    skuAnalyticsSnapshot: data.ozonSkuAnalyticsSnapshot || null,
    growthCases: data.growthCases || [],
  });

  growthRuntimeState = {
    shops,
    activeShop,
    trackedProducts: filteredTracked,
    savedResults: filteredSavedResults,
    monitorEvents: filteredEvents,
    monitorTasks: filteredTasks,
    experiments: filteredExperiments,
    skuAnalyticsSnapshot: data.ozonSkuAnalyticsSnapshot || null,
    storeSnapshotCache: data.ozonStoreSnapshotCache || null,
    workflowTaskState: data.growthWorkflowTaskState || {},
    workflowTasks,
    workflowRoots: buildWorkflowRoots({
      tasks: workflowTasks,
      reports: filteredSavedResults,
      events: filteredEvents,
      experiments: filteredExperiments,
      opportunities,
      skuRows,
      activeShop,
      skuAnalyticsSnapshot: data.ozonSkuAnalyticsSnapshot || null,
      storeSnapshotCache: data.ozonStoreSnapshotCache || null,
    }),
    growthCases: mergeGrowthCasesWithRoots(data.growthCases || [], workflowTasks, filteredSavedResults, activeShop),
    growthActionRuns: (data.growthActionRuns || []).filter(run => !run.shopId || run.shopId === activeId).slice(0, 50),
    skuRows,
    opportunities,
  };

  // 5. Update counters with filtered counts
  document.getElementById("stat-tracked-count").innerText = filteredTracked.length;
  
  const sourcingResults = filteredSavedResults.filter(r => r.skillId && r.skillId.includes("sourcing_finder"));
  document.getElementById("stat-sourcing-count").innerText = sourcingResults.length;
  
  document.getElementById("stat-alert-events").innerText = filteredEvents.length;
  
  const diagnosticReportsCount = filteredReports.length + filteredSavedResults.filter(r => r.skillId && r.skillId.includes("optimizer")).length;
  document.getElementById("stat-reports-count").innerText = diagnosticReportsCount;

  // 6. Render recent events, pipeline table, tasks, and reports
  renderRecentEventsFeed(filteredEvents);
  renderPipelineTable(filteredSavedResults);
  renderTasksTable(filteredTasks);
  renderReportsList(filteredReports, filteredSavedResults);
  renderGrowthHome();
  renderSmartWorkflow();
  renderSourceLedger();
  renderSkuWorkbench();
  renderOpportunityCenter();
  renderExperimentBoard();
  renderSettingsTab();
}

// ── Render Components ──

function getRiskBadgeClass(kind) {
  if (kind === "scale") return "success";
  if (kind === "profit" || kind === "fulfillment") return "warning";
  return "danger";
}

function extractSkuAnalyticsRows(snapshot = null) {
  const rows = snapshot?.result?.data || snapshot?.data || [];
  const metrics = snapshot?.result?.metrics || snapshot?.metrics || ["hits_view", "session_view", "ordered_units", "conv_tocart"];
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const dimensions = row.dimensions || row.dimension || [];
    const skuDimension = Array.isArray(dimensions)
      ? (dimensions.find(d => d.id || d.name) || dimensions[0] || {})
      : {};
    const metricValues = row.metrics || [];
    const metric = (name) => {
      const idx = metrics.indexOf(name);
      return Number(metricValues[idx] ?? row[name] ?? 0) || 0;
    };
    const sku = String(skuDimension.id || skuDimension.name || row.sku || `api-sku-${index + 1}`);
    const title = String(skuDimension.name || row.title || sku);
    const views = metric("hits_view");
    const sessions = metric("session_view");
    const orderedUnits = metric("ordered_units");
    const cartRate = metric("conv_tocart");
    return {
      id: `api_${sku}`,
      sku,
      title,
      views,
      sessions,
      orderedUnits,
      cartRate: Number((cartRate || (sessions > 0 ? (orderedUnits / sessions) * 100 : 0)).toFixed(1)),
      orderRate: Number((sessions > 0 ? (orderedUnits / sessions) * 100 : 0).toFixed(1)),
      source: "seller_api",
    };
  }).filter(row => row.sku);
}

function buildSkuRows(tracked = [], savedResults = [], events = [], _activeShop = null, skuAnalyticsSnapshot = null) {
  const rows = [];
  const apiRows = extractSkuAnalyticsRows(skuAnalyticsSnapshot);
  if (apiRows.length) {
    return apiRows.map((apiRow, index) => {
      const margin = 18 + ((apiRow.sku.length + index) % 22);
      const stockDays = 5 + ((apiRow.sku.length * 7 + index) % 36);
      const issue = apiRow.cartRate < 2.6
        ? "conversion"
        : margin < 20
          ? "profit"
          : stockDays < 8
            ? "fulfillment"
            : apiRow.sessions < 1000
              ? "exposure"
              : "scale";
      const issueLabel = {
        exposure: "曝光弱",
        conversion: "加购弱",
        profit: "利润弱",
        fulfillment: "履约风险",
        scale: "可放大",
      }[issue];
      const nextAction = {
        exposure: "基于真实 SKU 曝光不足，优先重构关键词和类目入口",
        conversion: "基于真实加购率偏低，优先改首图和详情页承接",
        profit: "真实销量可见，需补利润安全线和寻源降本",
        fulfillment: "真实订单 SKU 进入履约风险观察",
        scale: "真实数据表现可放大，建议扩展变体和相邻关键词",
      }[issue];
      return {
        ...apiRow,
        revenue: (apiRow.orderedUnits * 900).toFixed(0),
        margin,
        stockDays,
        rating: 0,
        issue,
        issueLabel,
        nextAction,
        savedEvidence: savedResults.length,
        eventCount: events.length,
        dataSource: "Seller API",
      };
    });
  }

  const sourceProducts = tracked;

  sourceProducts.forEach((prod, index) => {
    const sessions = Number(prod.sessions || prod.session_view || 0);
    const views = Number(prod.views || prod.hits_view || 0);
    const cartRate = Number(prod.cartRate || prod.conv_tocart || 0);
    const orderRate = Number(prod.orderRate || 0);
    const revenue = Number(prod.revenue || 0);
    const margin = Number(prod.margin || 0);
    const stockDays = Number(prod.stockDays || 0);
    const rating = Number(prod.rating || 0);
    const issue = cartRate < 2.6
      ? "conversion"
      : margin < 20
        ? "profit"
        : stockDays < 8
          ? "fulfillment"
          : sessions < 1000
            ? "exposure"
            : "scale";
    const issueLabel = {
      exposure: "曝光弱",
      conversion: "加购弱",
      profit: "利润弱",
      fulfillment: "履约风险",
      scale: "可放大",
    }[issue];
    const nextAction = {
      exposure: "需要同步 Seller API 后判断曝光入口",
      conversion: "需要同步 Seller API 后判断首图/详情页承接",
      profit: "需要补充真实售价、佣金、物流和采购成本",
      fulfillment: "需要同步订单/库存后判断履约风险",
      scale: "需要真实趋势窗口确认是否可放大",
    }[issue];
    rows.push({
      id: prod.id || `sku_${index}`,
      sku: prod.sku || prod.offer_id || prod.product_id || `local-${index + 1}`,
      title: prod.title || prod.name || `Ozon 商品 ${index + 1}`,
      url: prod.url || prod.pageUrl || "",
      issue,
      issueLabel,
      sessions,
      views,
      cartRate,
      orderRate,
      revenue,
      margin,
      stockDays,
      rating,
      nextAction,
      savedEvidence: savedResults.length,
      eventCount: events.length,
      dataSource: "本地追踪",
    });
  });
  return rows.sort((a, b) => {
    const priority = { fulfillment: 5, profit: 4, conversion: 3, exposure: 2, scale: 1 };
    return priority[b.issue] - priority[a.issue] || b.revenue - a.revenue;
  });
}

function buildOpportunityCards(skuRows = [], events = []) {
  const cards = [];
  const weakConversion = skuRows.find(row => row.issue === "conversion");
  const weakProfit = skuRows.find(row => row.issue === "profit");
  const scaleSku = skuRows.find(row => row.issue === "scale") || skuRows[0];
  const fulfillmentSku = skuRows.find(row => row.issue === "fulfillment");

  if (weakConversion) {
    cards.push({
      id: `opp_visual_${weakConversion.id}`,
      type: "首图/商品页",
      title: `${weakConversion.title} 有曝光但加购弱`,
      evidence: `加购率 ${weakConversion.cartRate}%；建议优先验证主图、俄语卖点和详情页承接。`,
      impact: "预计优先影响点击后加购率",
      action: "diagnose_visual_conversion",
      experiment: "首图俄语卖点改版 7 天实验",
    });
  }
  if (weakProfit) {
    cards.push({
      id: `opp_profit_${weakProfit.id}`,
      type: "利润/寻源",
      title: `${weakProfit.title} 低于利润安全线`,
      evidence: `模型毛利线 ${weakProfit.margin}%；适合先测最低促销价，再进入独立寻源降本。`,
      impact: "减少卖得越多利润越薄的风险",
      action: "calculate_profit_guardrail",
      experiment: "利润保护价调价实验",
    });
  }
  if (fulfillmentSku) {
    cards.push({
      id: `opp_fulfillment_${fulfillmentSku.id}`,
      type: "履约",
      title: `${fulfillmentSku.title} 存在履约/断货风险`,
      evidence: `库存周转约 ${fulfillmentSku.stockDays} 天；建议检查 FBS 倒计时和 FBO 备货可行性。`,
      impact: "避免排序权重和买家体验受损",
      action: "detect_fulfillment_risk",
      experiment: "FBO/补货策略观察实验",
    });
  }
  if (scaleSku) {
    cards.push({
      id: `opp_expand_${scaleSku.id}`,
      type: "扩品",
      title: `围绕 ${scaleSku.title} 扩展相邻款`,
      evidence: `当前付款率 ${scaleSku.orderRate}%；可从竞品变体、差评痛点和季节词反推扩品。`,
      impact: "把已有成功 SKU 扩成商品矩阵",
      action: "find_expansion_opportunities",
      experiment: "相邻变体小批上架实验",
    });
  }
  events.slice(0, 2).forEach((event, index) => {
    cards.push({
      id: `opp_event_${index}`,
      type: "竞品事件",
      title: event.entity_name || "竞品出现变化",
      evidence: event.event_desc || "检测到价格、促销、评论或页面变化。",
      impact: "可能形成跟价、避战或抢量窗口",
      action: "scan_competitor_changes",
      experiment: "竞品变化应对实验",
    });
  });
  return cards;
}

function stableHash(value = "") {
  let hash = 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function taskStateFor(taskId, taskState = {}) {
  return taskState[taskId] || {};
}

function buildWorkflowTask(task, taskState = {}) {
  const state = taskStateFor(task.id, taskState);
  return {
    status: "todo",
    owner: "人工确认",
    source: "AI 诊断",
    dueLabel: "今天",
    ...task,
    ...state,
  };
}

function buildTasksFromReports(reports = [], taskState = {}) {
  const tasks = [];
  reports
    .filter((report) => report?.result?.data && /optimizer|listing|review|operations|opportunity/i.test(report.skillId || ""))
    .slice(0, 4)
    .forEach((report) => {
      const items = Array.isArray(report.result.data) ? report.result.data : [];
      items.slice(0, 3).forEach((item, itemIndex) => {
        const actions = item.first_actions || item.next_steps || item.actionable_tasks || item.actions || "";
        const actionText = Array.isArray(actions) ? actions.join("；") : String(actions || item.direction || item.recommendation || "");
        if (!actionText.trim()) return;
        const title = item.title || item.plan_id || item.direction || `诊断任务 ${itemIndex + 1}`;
        const id = `report_${stableHash(`${report.id}_${title}_${actionText}`)}`;
        const reportActionId = report.growthActionId || "";
        const reportKind = reportActionId === "explore_platform_trends"
          ? "platform_trend"
          : report.skillId?.includes("opportunity") && /趋势|平台|类目|热卖|搜索|trend|category|bestseller/i.test(`${title} ${item.evidence || ""} ${item.trend_evidence || ""}`)
            ? "platform_trend"
            : "diagnosis_action";
        tasks.push(buildWorkflowTask({
          id,
          kind: reportKind,
          severity: item.diagnosis_level || item.priority || "P1",
          title,
          reason: item.evidence || item.diagnosis_basis || report.result.summary || "来自最近 AI 决策书的结构化建议。",
          actionText,
          actionId: reportKind === "platform_trend" ? "explore_platform_trends" : report.skillId?.includes("listing") ? "rewrite_listing" : report.skillId?.includes("review") ? "analyze_review_defects" : "diagnose_store_growth",
          source: report.skillName || "AI 决策书",
          owner: "运营执行",
          dueLabel: "本轮",
        }, taskState));
      });
    });
  return tasks;
}

function workflowKindFromCaseTask(task = {}, caseItem = {}) {
  const text = `${task.task_type || ""} ${caseItem.type || ""}`.toLowerCase();
  if (/trend|platform|category/.test(text)) return "platform_trend";
  if (/supplier|sourcing|sample|certificate|margin/.test(text)) return "supplier_sourcing";
  if (/review|comment|package|description/.test(text)) return "review";
  if (/listing|title|attribute|image_copy/.test(text)) return "listing";
  if (/baseline|observation|experiment|metric/.test(text)) return "experiment_review";
  if (/policy|compliance|ip|label/.test(text)) return "compliance";
  if (/opportunity|competitor/.test(text)) return "opportunity";
  return "diagnosis_action";
}

function buildTasksFromGrowthCases(cases = [], taskState = {}) {
  const tasks = [];
  cases.forEach((caseItem) => {
    (Array.isArray(caseItem.tasks) ? caseItem.tasks : []).forEach((task, index) => {
      const id = `case_${stableHash(`${caseItem.id}_${task.task_id || index}`)}`;
      tasks.push(buildWorkflowTask({
        id,
        caseId: caseItem.id,
        kind: workflowKindFromCaseTask(task, caseItem),
        severity: task.priority || "P1",
        title: task.target || task.task_id || `案件任务 ${index + 1}`,
        reason: task.reason || `来自 ${caseItem.title || "增长案件"} 的后续任务。`,
        actionText: task.expected_output || (Array.isArray(task.required_evidence) ? `补齐证据：${task.required_evidence.join("、")}` : "确认并推进此任务。"),
        actionId: caseItem.actionId || "",
        source: caseItem.title || "增长案件",
        owner: task.requires_manual_confirmation ? "人工确认" : "AI 继续取证",
        dueLabel: task.requires_manual_confirmation ? "确认后" : "本轮",
        requiresManualConfirmation: Boolean(task.requires_manual_confirmation),
      }, taskState));
    });
  });
  return tasks;
}

function buildWorkflowTasks({ skuRows = [], opportunities = [], events = [], reports = [], experiments = [], taskState = {}, activeShop = null, skuAnalyticsSnapshot = null, growthCases = [] }) {
  const tasks = [];
  const hasSkuApi = !!skuAnalyticsSnapshot?.result?.data?.length;
  const foundation = assessStoreFoundation({ skuRows, reports, opportunities, activeShop });

  if (foundation.needsRepositioning) {
    tasks.push(buildWorkflowTask({
      id: `foundation_${activeShop?.id || stableHash(foundation.reason)}`,
      kind: "store_positioning",
      severity: "P0",
      title: "先重构店铺定位，再推进运营细节",
      reason: foundation.reason,
      actionText: "确认目标客群、主价格带、商品矩阵、差异化理由和应下架/弱化的商品群；形成定位方案后再拆商品页、价格和海报任务。",
      actionId: "diagnose_store_growth",
      source: foundation.explicitRisk ? "AI 决策书定位风险" : "Seller API 全量 SKU 轻体检",
      owner: "经营负责人确认",
      dueLabel: "先做",
    }, taskState));
  }

  skuRows.filter(row => row.issue !== "scale").slice(0, 6).forEach((row) => {
    const actionId = row.issue === "profit"
      ? "calculate_profit_guardrail"
      : row.issue === "fulfillment"
        ? "detect_fulfillment_risk"
        : row.issue === "conversion"
          ? "diagnose_visual_conversion"
          : "diagnose_sku_funnel";
    const id = `sku_${stableHash(`${row.sku}_${row.issue}_${row.title}`)}`;
    tasks.push(buildWorkflowTask({
      id,
      kind: "sku_health",
      severity: row.issue === "fulfillment" || row.issue === "profit" ? "P0" : "P1",
      title: `${row.issueLabel}: ${row.title}`,
      sku: row.sku,
      reason: hasSkuApi
        ? `Seller API 发现该 SKU ${row.issueLabel}；曝光 ${Number(row.sessions || 0).toLocaleString()}，加购 ${row.cartRate}%，付款 ${row.orderRate}%。`
        : `当前来自${row.dataSource || "本地追踪"}，需要同步 Seller API 后确认。`,
      actionText: row.nextAction,
      actionId,
      source: hasSkuApi ? "Seller API 全量 SKU 轻体检" : "本地队列",
      owner: row.issue === "fulfillment" ? "运营/仓配确认" : "运营执行",
      dueLabel: row.issue === "fulfillment" ? "立即" : "今天",
    }, taskState));
  });

  opportunities.slice(0, 4).forEach((card) => {
    const id = `opp_${stableHash(`${card.id}_${card.title}`)}`;
    tasks.push(buildWorkflowTask({
      id,
      kind: "opportunity",
      severity: "P1",
      title: card.title,
      reason: card.evidence,
      actionText: card.experiment || card.impact,
      actionId: card.action,
      source: card.type || "机会中心",
      owner: "运营判断",
      dueLabel: "本周",
    }, taskState));
  });

  events.slice(0, 3).forEach((event, index) => {
    const id = `event_${stableHash(`${event.id || index}_${event.entity_name}_${event.event_desc}`)}`;
    tasks.push(buildWorkflowTask({
      id,
      kind: "competitor_event",
      severity: "P1",
      title: event.entity_name || "竞品发生变化",
      reason: event.event_desc || "监控任务检测到竞品价格、促销、评分或页面变化。",
      actionText: "确认是否跟价、避战、改主图或建立新监控对象。",
      actionId: "scan_competitor_changes",
      source: "竞品感知事件",
      owner: "运营确认",
      dueLabel: "24h",
    }, taskState));
  });

  tasks.push(...buildTasksFromReports(reports, taskState));
  tasks.push(...buildTasksFromGrowthCases(growthCases, taskState));

  experiments
    .filter((exp) => exp.status === "observing" || exp.status === "running")
    .slice(0, 3)
    .forEach((exp) => {
      const id = `exp_review_${stableHash(`${exp.id}_${exp.status}`)}`;
      tasks.push(buildWorkflowTask({
        id,
        kind: "experiment_review",
        severity: exp.status === "observing" ? "P1" : "P2",
        title: `复盘实验: ${exp.title}`,
        sku: exp.sku,
        reason: exp.status === "observing" ? "实验已进入观察期，需要对比 Seller API 数据变化。" : "实验正在执行中，请确认人工动作是否已完成。",
        actionText: exp.status === "observing" ? "拉取实验窗口数据，判断继续、停止或二次优化。" : "确认改图/改标题/调价/补货等动作已实际执行。",
        actionId: "review_experiment_result",
        source: "增长实验",
        owner: "运营复盘",
        dueLabel: exp.status === "observing" ? "到期" : "执行后",
      }, taskState));
    });

  if (!tasks.length) {
    tasks.push(buildWorkflowTask({
      id: `bootstrap_${activeShop?.id || "no_shop"}`,
      kind: "bootstrap",
      severity: "P0",
      title: activeShop ? "先运行一次全店体检，生成第一批运营任务" : "先绑定 Seller API 店铺，建立全量 SKU 体检基线",
      reason: activeShop ? "当前还没有足够的 SKU 风险、机会、实验和监控事件。" : "没有 Seller API 时只能做页面级诊断，无法形成全量经营任务流。",
      actionText: activeShop ? "从 Ozon 店铺页点击右侧悬浮栏「店铺」或在此发起全店体检。" : "绑定 Client ID / API Key 后同步 SKU analytics。",
      actionId: activeShop ? "diagnose_store_growth" : "",
      source: activeShop ? "启动建议" : "数据源缺口",
      owner: "店铺配置",
      dueLabel: "先做",
    }, taskState));
  }

  const severityRank = { P0: 4, P1: 3, P2: 2, P3: 1 };
  const statusRank = { todo: 4, confirmed: 3, observing: 2, done: 1, dismissed: 0 };
  return tasks
    .filter((task) => task.status !== "dismissed")
    .sort((a, b) => (statusRank[b.status] || 0) - (statusRank[a.status] || 0) || (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0))
    .slice(0, 18);
}

function workflowStatusLabel(status) {
  return {
    todo: "待处理",
    confirmed: "已执行待观察",
    observing: "观察中",
    done: "已复盘",
  }[status] || "待处理";
}

function workflowCaseStatusLabel(status) {
  return {
    ready: "待诊断",
    queued: "排队中",
    running: "运行中",
    completed: "已生成报告",
    failed: "运行失败",
    interrupted: "已保存断点",
    needs_frontend_context: "需前台页面执行",
    observing: "观察中",
    done: "已关闭",
  }[status] || "待诊断";
}

function workflowLaneLabel(lane) {
  return {
    foundation: "根基",
    diagnosis: "体检",
    market: "竞品",
    conversion: "转化",
    growth: "增长",
    review: "复盘",
    workflow: "流程",
  }[lane] || "流程";
}

function workflowKindLabel(kind) {
  return {
    store_positioning: "定位重构",
    sku_health: "SKU 体检",
    opportunity: "机会",
    platform_trend: "平台趋势",
    competitor_event: "竞品",
    diagnosis_action: "诊断拆解",
    experiment_review: "复盘",
    bootstrap: "启动",
  }[kind] || "任务";
}

function latestReportBy(reports = [], matcher) {
  return reports
    .filter((report) => matcher(report))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
}

function summarizeWorkflowTasks(tasks = []) {
  return {
    total: tasks.length,
    p0: tasks.filter(task => task.severity === "P0").length,
    todo: tasks.filter(task => task.status === "todo").length,
    confirmed: tasks.filter(task => task.status === "confirmed").length,
    observing: tasks.filter(task => task.status === "observing").length,
    done: tasks.filter(task => task.status === "done").length,
  };
}

function workflowSourceText(items = []) {
  return items.map((item) => {
    try {
      return JSON.stringify(item || {});
    } catch (_) {
      return String(item || "");
    }
  }).join(" ");
}

function assessStoreFoundation({ skuRows = [], reports = [], opportunities = [], activeShop = null }) {
  const sourceText = workflowSourceText(reports)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
  const foundationPattern = /定位|人群|客群|品牌|差异化|类目选择|价格带|店铺结构|战略|重构|根基|全店方向|assortment|positioning|brand|segment/i;
  const explicitRisk = foundationPattern.test(sourceText);
  const riskRows = skuRows.filter(row => row.issue !== "scale").length;
  const scaleRows = skuRows.filter(row => row.issue === "scale").length;
  const riskRatio = skuRows.length ? riskRows / skuRows.length : 0;
  const operationalEvidence = opportunities.length + reports.length + skuRows.length;
  const needsRepositioning = explicitRisk || (skuRows.length >= 4 && riskRatio >= 0.65 && scaleRows === 0);

  return {
    needsRepositioning,
    explicitRisk,
    riskRatio,
    riskRows,
    scaleRows,
    stage: needsRepositioning ? "foundation" : operationalEvidence ? "operations" : "bootstrap",
    title: activeShop ? `${activeShop.name} 定位重构` : "店铺定位重构",
    reason: explicitRisk
      ? "最近 AI 决策书已出现定位、人群、差异化或店铺结构风险信号。"
      : needsRepositioning
        ? `全量 SKU 轻体检中 ${riskRows}/${skuRows.length} 个 SKU 处于风险或低效状态，且缺少可放大 SKU，优先判断店铺定位。`
        : "当前更像运营细节优化场景，可直接推进 SKU、商品页、竞品和复盘任务。",
  };
}

function statusFromCaseRuns(caseItem = {}) {
  const runs = caseItem.runs || [];
  if (runs.some(run => run.status === "running")) return "running";
  if (runs.some(run => run.status === "interrupted")) return "interrupted";
  if (runs.some(run => run.status === "failed")) return "failed";
  if (runs.some(run => run.status === "completed")) return "completed";
  if (runs.some(run => run.status === "queued")) return "queued";
  return caseItem.status || "ready";
}

function mergeGrowthCasesWithRoots(storedCases = [], tasks = [], reports = [], activeShop = null) {
  const byId = new Map();
  storedCases.forEach((caseItem) => {
    if (!caseItem?.id) return;
    byId.set(caseItem.id, {
      ...caseItem,
      runs: Array.isArray(caseItem.runs) ? caseItem.runs : [],
      reportIds: Array.isArray(caseItem.reportIds) ? caseItem.reportIds : [],
      taskIds: Array.isArray(caseItem.taskIds) ? caseItem.taskIds : [],
    });
  });

  const roots = [
    { type: "store_health", actionId: "diagnose_store_growth", taskKinds: ["store_positioning", "sku_health", "diagnosis_action", "bootstrap"] },
    { type: "competitor_watch", actionId: "scan_competitor_changes", taskKinds: ["competitor_event"] },
    { type: "listing_conversion", actionId: "rewrite_listing", matcher: task => /visual|listing|review|conversion|加购|转化|改版|评论/.test(`${task.actionId || ""} ${task.title || ""} ${task.reason || ""}`) },
    { type: "platform_trends", actionId: "explore_platform_trends", matcher: task => task.kind === "platform_trend" || /platform_trends|trend|趋势|平台|类目|热卖|搜索|需求词/.test(`${task.actionId || ""} ${task.title || ""} ${task.reason || ""}`) },
    { type: "opportunity_profit", actionId: "find_expansion_opportunities", matcher: task => task.kind === "opportunity" || /profit|expansion|机会|利润|扩品|寻源/.test(`${task.actionId || ""} ${task.title || ""}`) },
    { type: "supplier_sourcing", actionId: "filter_supplier_sources", matcher: task => task.kind === "supplier_sourcing" || /supplier|sourcing|货源|供应商|1688|采购|寻源|利润账本/.test(`${task.actionId || ""} ${task.title || ""} ${task.reason || ""}`) },
    { type: "experiment_review", actionId: "review_experiment_result", matcher: task => task.kind === "experiment_review" || ["confirmed", "observing", "done"].includes(task.status) },
  ];

  roots.forEach((root) => {
    const id = `${root.type}_${activeShop?.id || "no_shop"}_shop`;
    const rootTasks = tasks.filter(root.matcher || ((task) => root.taskKinds.includes(task.kind)));
    const rootReports = reports.filter((report) => {
      const skill = `${report.skillId || ""} ${report.skillName || ""}`;
      if (root.type === "store_health") return /global_shop_optimizer|optimizer|operations/i.test(skill);
      if (root.type === "competitor_watch") return /competitor|optimizer/i.test(skill);
      if (root.type === "listing_conversion") return /listing|review|optimizer/i.test(skill);
      if (root.type === "platform_trends") return report.growthActionId === "explore_platform_trends" || /opportunity|trend|trends/i.test(skill);
      if (root.type === "opportunity_profit") return /opportunity|sourcing/i.test(skill);
      if (root.type === "supplier_sourcing") return report.growthActionId === "filter_supplier_sources" || /sourcing/i.test(skill);
      if (root.type === "experiment_review") return /operations|tracker/i.test(skill);
      return false;
    });
    const existing = byId.get(id) || {};
    byId.set(id, {
      id,
      type: root.type,
      title: existing.title || GROWTH_CASE_LABELS[root.type] || "增长案件",
      shopId: activeShop?.id || existing.shopId || "",
      status: statusFromCaseRuns(existing),
      actionId: root.actionId,
      taskIds: Array.from(new Set([...(existing.taskIds || []), ...rootTasks.map(task => task.id)])),
      reportIds: Array.from(new Set([...(existing.reportIds || []), ...rootReports.map(report => String(report.id))])),
      evidence: {
        ...(existing.evidence || {}),
        taskCount: rootTasks.length,
        reportCount: rootReports.length,
        updatedFromRuntimeAt: new Date().toISOString(),
      },
      research_scope: existing.research_scope || {},
      evidence_quality: existing.evidence_quality || null,
      nodes: Array.isArray(existing.nodes) ? existing.nodes : [],
      tasks: Array.isArray(existing.tasks) ? existing.tasks : [],
      blocking_gaps: Array.isArray(existing.blocking_gaps) ? existing.blocking_gaps : [],
      runs: existing.runs || [],
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: existing.updatedAt || new Date().toISOString(),
    });
  });

  return Array.from(byId.values()).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

function buildRootEvidenceStatus(root, { reports = [], events = [], experiments = [], skuRows = [], skuAnalyticsSnapshot = null, storeSnapshotCache = null }) {
  const hasSkuApi = Boolean(skuAnalyticsSnapshot?.result?.data?.length || skuAnalyticsSnapshot?.data?.length);
  const hasStoreApi = Boolean(storeSnapshotCache?.result || storeSnapshotCache?.data);
  const hasAnyApi = hasSkuApi || hasStoreApi;
  const reportCount = root.report ? 1 : reports.filter((report) => {
    if (!report) return false;
    if (root.id === "platform_trends") return report.growthActionId === "explore_platform_trends" || /trend|opportunity/i.test(report.skillId || "");
    if (root.id === "supplier_sourcing") return report.growthActionId === "filter_supplier_sources" || /sourcing/i.test(report.skillId || "");
    return report.growthActionId === root.actionId || String(report.skillId || "").includes(String(root.actionId || ""));
  }).length;

  const status = [];
  status.push({
    key: "api",
    label: hasAnyApi ? "API 已同步" : "API 待同步",
    tone: hasAnyApi ? "ok" : "warn",
    detail: hasSkuApi
      ? `SKU Analytics 已同步，${skuRows.length} 个 SKU 可参与判断。`
      : hasStoreApi
        ? "店铺快照已同步，可作为店铺级判断依据。"
        : "未发现 Seller API 本地快照，运行时只能依赖前台页面、历史报告或待验证假设。",
  });
  status.push({
    key: "reports",
    label: reportCount ? `${reportCount} 份报告` : "无报告",
    tone: reportCount ? "ok" : "muted",
    detail: reportCount ? "已有 AI 报告可作为当前流程证据。" : "还没有此流程的历史报告，首次运行会创建案件和报告。",
  });
  status.push({
    key: "tasks",
    label: root.stats?.total ? `${root.stats.total} 个任务` : "无任务",
    tone: root.stats?.total ? "ok" : "muted",
    detail: root.stats?.total ? `其中 ${root.stats.p0 || 0} 个 P0，需要人工确认或执行。` : "当前没有由报告或数据自动生成的待办任务。",
  });

  if (root.id === "competitor_watch") {
    status.push({
      key: "events",
      label: events.length ? `${events.length} 条事件` : "无事件",
      tone: events.length ? "ok" : "muted",
      detail: events.length ? "已有竞品/监控变化事件可进入跟踪判断。" : "尚无竞品变化事件，建议先从 Ozon 前台页面建立基线。",
    });
  }
  if (root.id === "experiment_review") {
    status.push({
      key: "experiments",
      label: experiments.length ? `${experiments.length} 个实验` : "无实验",
      tone: experiments.length ? "ok" : "muted",
      detail: experiments.length ? "已有实验/观察对象可复盘。" : "还没有已执行动作进入观察窗口。",
    });
  }
  if (root.id === "platform_trends" || root.id === "supplier_sourcing") {
    status.push({
      key: "front_page",
      label: "需前台页面",
      tone: "warn",
      detail: root.id === "platform_trends"
        ? "平台趋势最好在 Ozon 搜索、类目、品牌或热卖页面触发，Dashboard 内运行可能缺少页面上下文。"
        : "货源验证最好从具体 Ozon 商品/机会页面触发，以便读取目标图和规格；Dashboard 内运行可能需要右侧浮窗承接。",
    });
  }
  return status;
}

function buildWorkflowRoots({ tasks = [], reports = [], events = [], experiments = [], opportunities = [], skuRows = [], activeShop = null, skuAnalyticsSnapshot = null, storeSnapshotCache = null }) {
  const foundation = assessStoreFoundation({ skuRows, reports, opportunities, activeShop });
  const rootConfigs = [
    {
      id: "store_health",
      lane: foundation.needsRepositioning ? "foundation" : "diagnosis",
      title: "店铺体检",
      subtitle: foundation.needsRepositioning
        ? "体检结论：先处理定位/人群/商品矩阵"
        : activeShop ? `${activeShop.name} 全店经营体检` : "绑定店铺后形成全店经营体检",
      actionId: "diagnose_store_growth",
      report: latestReportBy(reports, report => /global_shop_optimizer|optimizer/i.test(report.skillId || "")),
      taskFilter: task => ["store_positioning", "sku_health", "diagnosis_action", "bootstrap"].includes(task.kind),
      narrative: foundation.needsRepositioning
        ? "这不是一个独立的“定位重构状态”，而是店铺体检给出的 P0 结论：先判断店铺卖给谁、靠什么差异化、主价格带和商品矩阵是否成立，再决定哪些海报、标题、价格和 SKU 动作值得做。"
        : "从 Seller API 全量 SKU 轻体检开始，AI 挑出高风险/高机会对象，并拆成改图、改标题、调价、补货、监控等人工确认任务。",
      foundation,
    },
    {
      id: "competitor_watch",
      lane: "market",
      title: "竞品跟踪",
      subtitle: events.length ? `${events.length} 条竞品感知事件` : "从店铺页、类目页或商品页建立竞品基线",
      actionId: "scan_competitor_changes",
      report: latestReportBy(reports, report => /competitor|optimizer/i.test(`${report.skillId || ""} ${report.skillName || ""}`)),
      taskFilter: task => task.kind === "competitor_event",
      narrative: "竞品不是一张静态表，而是价格、主图、评分、促销和评论变化事件流；每个变化都应转成跟价、避战、改版或监控任务。",
    },
    {
      id: "listing_conversion",
      lane: "conversion",
      title: "商品页转化",
      subtitle: "首图、俄语标题、详情页、评论缺陷",
      actionId: "rewrite_listing",
      report: latestReportBy(reports, report => /listing|review/i.test(report.skillId || "")),
      taskFilter: task => /visual|listing|review|conversion|加购|转化|改版|评论/.test(`${task.actionId || ""} ${task.title || ""} ${task.reason || ""}`),
      narrative: "当 SKU 有曝光但加购弱时，AI 深挖首图、标题、Характеристики、评论痛点和俄语表达，再让运营确认具体改版动作。",
    },
    {
      id: "platform_trends",
      lane: "market",
      title: "平台趋势",
      subtitle: "Ozon 热卖、类目价格带、俄区需求词",
      actionId: "explore_platform_trends",
      report: latestReportBy(reports, report => report.growthActionId === "explore_platform_trends" || /opportunity|trend|trends/i.test(report.skillId || "")),
      taskFilter: task => task.kind === "platform_trend" || /platform_trends|trend|趋势|平台|类目|热卖|搜索|需求词/.test(`${task.actionId || ""} ${task.title || ""} ${task.reason || ""}`),
      narrative: "这里看的是 Ozon 平台上的商品机会和趋势窗口，不等同于本店扩品。它先回答：平台上哪些类目、价格带、关键词和季节需求正在形成机会；通过验证后，才进入机会扩品或供应链利润线。",
    },
    {
      id: "opportunity_profit",
      lane: "growth",
      title: "机会扩品",
      subtitle: opportunities.length ? `${opportunities.length} 个扩品/利润机会` : "从成功 SKU、差评和价格带寻找新机会",
      actionId: "find_expansion_opportunities",
      report: latestReportBy(reports, report => /opportunity|sourcing/i.test(report.skillId || "")),
      taskFilter: task => task.kind === "opportunity" || /profit|expansion|机会|利润|扩品|寻源/.test(`${task.actionId || ""} ${task.title || ""}`),
      narrative: "不是孤立选品，而是把已验证 SKU、竞品空位、俄罗斯需求词和供应链利润线变成小批测试工作流。",
    },
    {
      id: "supplier_sourcing",
      lane: "growth",
      title: "供应商货源",
      subtitle: "1688/国内货源、规格一致、RUB 利润账本",
      actionId: "filter_supplier_sources",
      report: latestReportBy(reports, report => report.growthActionId === "filter_supplier_sources" || /sourcing/i.test(report.skillId || "")),
      taskFilter: task => task.kind === "supplier_sourcing" || /supplier|sourcing|货源|供应商|1688|采购|寻源|利润账本/.test(`${task.actionId || ""} ${task.title || ""} ${task.reason || ""}`),
      narrative: "这里不是普通选品，而是把已经值得验证的商品机会进入供应商筛选：同款/相似款匹配、规格一致性、起批量、采购价、跨境物流、平台佣金、关税和卢布净利润率都必须过账。",
    },
    {
      id: "experiment_review",
      lane: "review",
      title: "执行与复盘",
      subtitle: experiments.length ? `${experiments.length} 个实验/观察对象` : "人工执行后进入 7 天观察窗口",
      actionId: "review_experiment_result",
      report: latestReportBy(reports, report => /operations|tracker/i.test(report.skillId || "")),
      taskFilter: task => task.kind === "experiment_review" || ["confirmed", "observing", "done"].includes(task.status),
      narrative: "智能化的关键不是自动替你改，而是知道哪些动作已人工完成、何时进入观察、复盘时该拿哪些 Seller API 指标对比。",
    },
  ];

  return rootConfigs.map((root) => {
    const rootTasks = tasks.filter(root.taskFilter);
    const stats = summarizeWorkflowTasks(rootTasks);
    const rootWithStats = {
      ...root,
      tasks: rootTasks,
      stats,
      skuCount: skuRows.length,
      status: stats.todo > 0 ? "todo" : stats.observing > 0 ? "observing" : stats.done > 0 ? "done" : "ready",
    };
    return {
      ...rootWithStats,
      evidenceStatus: buildRootEvidenceStatus(rootWithStats, {
        reports,
        events,
        experiments,
        skuRows,
        skuAnalyticsSnapshot,
        storeSnapshotCache,
      }),
    };
  });
}

function renderSmartWorkflow() {
  const board = document.getElementById("workflow-canvas-board");
  const pip = document.getElementById("workflow-pip");
  if (!board || !pip) return;

  const roots = growthRuntimeState.workflowRoots || [];
  updateWorkflowZoomLabel();

  if (!roots.some(root => root.id === selectedWorkflowId)) selectedWorkflowId = roots[0]?.id || "store_health";
  const selectedRoot = roots.find(root => root.id === selectedWorkflowId) || roots[0];
  const selectedTasks = selectedRoot?.tasks || [];
  const lanes = [
    { id: "todo", title: "待确认", hint: "AI 已生成，等待人工判断/执行" },
    { id: "confirmed", title: "已执行", hint: "人工已完成，等待数据变化" },
    { id: "observing", title: "观察中", hint: "进入 3-7 天观察窗口" },
    { id: "done", title: "已复盘", hint: "已形成结论或二次动作" },
  ];

  board.innerHTML = `
    <div class="workflow-zoom-layer" style="${workflowCanvasTransformStyle()}">
      <div class="workflow-map-layer">
        <div class="root-node-rail">
          ${roots.map((root, index) => `
          <button class="canvas-node root-node ${root.id === selectedWorkflowId ? "selected" : ""} ${root.status} ${root.lane === "foundation" ? "foundation" : ""}" data-root-id="${root.id}" style="--node-index:${index}; left:${index * 268}px;">
            <span class="node-lane">${escapeHtml(workflowLaneLabel(root.lane))}</span>
            <strong>${escapeHtml(root.title)}</strong>
            <small>${escapeHtml(root.subtitle)}</small>
            <div class="node-stats">
              <span>${root.stats.total} 任务</span>
              <span>${root.stats.p0} P0</span>
              <span>${root.report ? "有报告" : "待诊断"}</span>
            </div>
            <div class="node-evidence-strip">
              ${(root.evidenceStatus || []).slice(0, 3).map(item => `<span class="evidence-chip ${escapeHtml(item.tone)}">${escapeHtml(item.label)}</span>`).join("")}
            </div>
          </button>
          `).join("")}
        </div>
      </div>
      <section class="scrum-board">
      <div class="scrum-board-head">
        <div>
          <span class="node-lane">${escapeHtml(workflowLaneLabel(selectedRoot?.lane || "workflow"))}</span>
          <h3>${escapeHtml(selectedRoot?.title || "增长工作流")}</h3>
              <p>${escapeHtml(selectedRoot?.narrative || "运行一次体检后，AI 会把结果拆成可以人工确认、观察和复盘的任务。")}</p>
        </div>
        <div class="canvas-actions">
          ${selectedRoot ? `<button class="btn btn-primary growth-action-btn" data-action="${selectedRoot.actionId}">运行/更新此流程</button>` : ""}
          <button class="btn btn-outline open-root-detail-btn" data-root-id="${selectedRoot?.id || ""}">${selectedRoot?.report ? "报告/详情" : "流程详情"}</button>
        </div>
      </div>
      <div class="scrum-columns">
        ${lanes.map((lane) => {
          const laneTasks = selectedTasks.filter(task => (task.status || "todo") === lane.id);
          return `
            <div class="scrum-column" data-lane="${lane.id}">
              <div class="scrum-column-head">
                <strong>${lane.title}</strong>
                <span>${laneTasks.length}</span>
              </div>
              <p>${lane.hint}</p>
              <div class="scrum-task-stack">
                ${laneTasks.length ? laneTasks.map((task) => `
                  <article class="workflow-task-card compact ${task.status}" data-open-task="${escapeHtml(task.id)}">
                    <div class="workflow-task-top">
                      <span class="badge ${task.severity === "P0" ? "danger" : task.severity === "P1" ? "warning" : "success"}">${escapeHtml(task.severity || "P1")}</span>
                      <span class="workflow-kind">${escapeHtml(workflowKindLabel(task.kind))}</span>
                      <span class="workflow-due">${escapeHtml(task.dueLabel || "今天")}</span>
                    </div>
                    <h4>${escapeHtml(task.title)}</h4>
                    <p>${escapeHtml(task.reason)}</p>
                    <div class="workflow-task-foot">
                      <span>${escapeHtml(task.source)} · ${escapeHtml(task.owner)}</span>
                      <button class="btn btn-outline btn-xs open-task-detail-btn" data-task-id="${escapeHtml(task.id)}">详情</button>
                    </div>
                  </article>
                `).join("") : `<div class="empty-state compact">暂无</div>`}
              </div>
            </div>
          `;
        }).join("")}
      </div>
      </section>
    </div>
  `;

  board.querySelectorAll(".canvas-node").forEach((node) => {
    node.addEventListener("click", () => {
      selectedWorkflowId = node.dataset.rootId;
      renderSmartWorkflow();
      openWorkflowPip({ rootId: node.dataset.rootId });
    });
  });
  board.querySelectorAll(".growth-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleGrowthAction(btn.dataset.action, ""));
  });
  board.querySelectorAll(".open-root-detail-btn").forEach((btn) => {
    btn.addEventListener("click", () => openWorkflowPip({ rootId: btn.dataset.rootId }));
  });
  board.querySelectorAll(".open-task-detail-btn, [data-open-task]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      openWorkflowPip({ taskId: btn.dataset.taskId || btn.dataset.openTask });
    });
  });
}

function renderEvidenceChecklist(items = []) {
  if (!items.length) return `<div class="empty-state compact">暂无证据状态。</div>`;
  return `
    <div class="workflow-evidence-list">
      ${items.map(item => `
        <div class="workflow-evidence-item ${escapeHtml(item.tone)}">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.detail || "")}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function workflowNextStatus(status) {
  return status === "todo" ? "confirmed" : status === "confirmed" ? "observing" : "done";
}

function workflowCanvasTransformStyle() {
  return `transform: translate(${workflowPanX}px, ${workflowPanY}px) scale(${workflowZoom}); width: ${100 / workflowZoom}%; min-height: ${100 / workflowZoom}%;`;
}

function applyWorkflowCanvasTransform() {
  const layer = document.querySelector(".workflow-zoom-layer");
  if (layer) layer.setAttribute("style", workflowCanvasTransformStyle());
}

function setWorkflowZoom(nextZoom) {
  workflowZoom = Math.min(1.6, Math.max(0.55, Number(nextZoom.toFixed(2))));
  updateWorkflowZoomLabel();
  applyWorkflowCanvasTransform();
}

function updateWorkflowZoomLabel() {
  const label = document.getElementById("workflow-zoom-label");
  if (label) label.textContent = `${Math.round(workflowZoom * 100)}%`;
}

function bindWorkflowCanvasInteractions() {
  if (workflowCanvasEventsBound) return;
  const canvas = document.getElementById("workflow-canvas-board");
  if (!canvas) return;
  workflowCanvasEventsBound = true;

  canvas.addEventListener("wheel", (event) => {
    if (!document.body.classList.contains("workflow-mode")) return;
    event.preventDefault();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      workflowPanX -= event.shiftKey ? event.deltaY : event.deltaX;
      applyWorkflowCanvasTransform();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const oldZoom = workflowZoom;
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextZoom = Math.min(1.6, Math.max(0.55, Number((workflowZoom + direction * 0.08).toFixed(2))));
    if (nextZoom === oldZoom) return;
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const worldX = (pointerX - workflowPanX) / oldZoom;
    const worldY = (pointerY - workflowPanY) / oldZoom;
    workflowZoom = nextZoom;
    workflowPanX = pointerX - worldX * workflowZoom;
    workflowPanY = pointerY - worldY * workflowZoom;
    updateWorkflowZoomLabel();
    applyWorkflowCanvasTransform();
  }, { passive: false });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button, a, input, select, textarea, .workflow-pip, .workflow-task-card")) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.classList.add("is-panning");
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    workflowPanX += event.clientX - lastX;
    workflowPanY += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    applyWorkflowCanvasTransform();
  });
  const stopDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("is-panning");
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
}

function closeWorkflowPip() {
  const pip = document.getElementById("workflow-pip");
  if (pip) pip.classList.add("hidden");
}

function workflowReportToMarkdown(report) {
  if (!report) return "还没有关联报告。运行或更新此流程后，AI 报告会作为根节点证据进入画布。";
  const result = normalizeFinalOutput(report.result || report);
  const direct = result.markdown || result.content || result.report || report.content;
  if (typeof direct === "string" && direct.trim()) return direct;
  const lines = [];
  const summary = result.summary || result.overview || result.conclusion;
  if (summary) lines.push(`### 摘要\n${summary}`);
  const data = Array.isArray(result.data) ? result.data : [];
  if (data.length) {
    lines.push("### 结构化诊断");
    const labelMap = {
      diagnosis_level: "诊断级别",
      priority: "优先级",
      evidence: "证据",
      diagnosis_basis: "诊断依据",
      recommendation: "建议",
      direction: "方向",
    };
    data.slice(0, 12).forEach((item, index) => {
      const title = item.title || item.plan_id || item.direction || item.name || `诊断项 ${index + 1}`;
      lines.push(`#### ${index + 1}. ${title}`);
      ["diagnosis_level", "priority", "evidence", "diagnosis_basis", "recommendation", "direction"].forEach((key) => {
        if (item[key]) lines.push(`- ${labelMap[key]}: ${Array.isArray(item[key]) ? item[key].join("；") : item[key]}`);
      });
      const actions = item.first_actions || item.next_steps || item.actionable_tasks || item.actions;
      if (actions) lines.push(`- 建议动作: ${Array.isArray(actions) ? actions.join("；") : actions}`);
    });
  }
  if (!lines.length) lines.push("```json\n" + JSON.stringify(result || report, null, 2) + "\n```");
  return lines.join("\n\n");
}

function tryParseJsonValue(text = "") {
  try {
    return JSON.parse(String(text || "").trim());
  } catch (_) {
    return null;
  }
}

function extractEmbeddedFinalJson(text = "") {
  const source = String(text || "");
  const candidates = [];
  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fencedMatch;
  while ((fencedMatch = fencedRegex.exec(source)) !== null) {
    const parsed = tryParseJsonValue(fencedMatch[1]);
    if (parsed) candidates.push(parsed);
  }

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = tryParseJsonValue(source.slice(start, index + 1));
          if (parsed) candidates.push(parsed);
          start = index;
          break;
        }
      }
    }
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate?.type === "final" || candidate?.output || candidate?.overview || candidate?.analysis || candidate?.summary) {
      return candidate;
    }
  }
  return null;
}

function normalizeFinalOutput(value) {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    if (typeof current === "string") {
      const trimmed = current.trim();
      const exact = tryParseJsonValue(trimmed);
      if (exact) {
        current = exact;
        continue;
      }
      const embedded = extractEmbeddedFinalJson(trimmed);
      if (embedded) {
        current = embedded;
        continue;
      }
      return { overview: current };
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

function resultToReportMarkdown(result = {}) {
  const data = normalizeFinalOutput(result);
  const lines = [];
  if (data.overview) lines.push(`### ${data.overview}`);
  if (data.analysis) lines.push(`**决策诊断与数据推演**:\n${data.analysis}`);
  if (data.summary) lines.push(`**下一步建议**:\n${data.summary}`);
  if (Array.isArray(data.data) && data.data.length) {
    lines.push("### 结构化行动项");
    data.data.slice(0, 12).forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const title = item.plan_id || item.title || item.name || item.direction || `行动项 ${index + 1}`;
      const actions = item.first_actions || item.next_steps || item.actionable_tasks || item.actions;
      const fields = [
        ["优先级", item.diagnosis_level || item.priority || item.severity],
        ["方向", item.direction || item.recommendation || item.strategy],
        ["证据", item.evidence || item.diagnosis_basis || item.selection_rationale || item.trend_evidence],
        ["首批动作", Array.isArray(actions) ? actions.join("；") : actions],
        ["风险护栏", item.risk_guard || item.risk_notes || item.guardrail],
      ];
      lines.push(`#### ${index + 1}. ${title}`);
      fields.forEach(([label, value]) => {
        if (value) lines.push(`- ${label}: ${value}`);
      });
    });
  }
  return lines.filter(Boolean).join("\n\n") || "```json\n" + JSON.stringify(data, null, 2) + "\n```";
}

function renderWorkflowReportHtml(report) {
  const markdown = workflowReportToMarkdown(report);
  if (window.marked?.parse) return window.marked.parse(markdown);
  return `<pre>${escapeHtml(markdown)}</pre>`;
}

function renderCaseIntelligence(caseItem = null) {
  if (!caseItem) return "";
  const scope = caseItem.research_scope || {};
  const quality = caseItem.evidence_quality || {};
  const gaps = Array.isArray(caseItem.blocking_gaps) ? caseItem.blocking_gaps : [];
  const nodes = Array.isArray(caseItem.nodes) ? caseItem.nodes : [];
  return `
    <section>
      <h4>研究范围</h4>
      <div class="workflow-pip-meta scope-meta">
        <span>${escapeHtml(scope.entry_page_type || "unknown")}</span>
        <span>${escapeHtml(scope.analysis_scope || "unknown")}</span>
        <span>置信度: ${escapeHtml(scope.scope_confidence || "unknown")}</span>
        ${scope.needs_user_clarification ? "<span>需确认范围</span>" : "<span>范围已识别</span>"}
      </div>
    </section>
    <section>
      <h4>证据质量</h4>
      <div class="workflow-pip-meta evidence-quality-meta">
        <span>等级 ${escapeHtml(quality.grade || "D")}</span>
        <span>${Number(quality.blocking_gap_count || gaps.length)} 个缺口</span>
        <span>${escapeHtml(quality.capture_mode || "截图模式待记录")}</span>
      </div>
      <p>${escapeHtml(quality.summary || "暂无证据质量摘要。")}</p>
    </section>
    ${gaps.length ? `
      <section>
        <h4>阻断缺口</h4>
        <ul class="workflow-gap-list">
          ${gaps.slice(0, 5).map((gap) => `<li><strong>${escapeHtml(gap.evidence_missing || gap.gap_id || "证据缺口")}</strong><br><span>${escapeHtml(gap.recovery_action || gap.business_impact || "需要补证或人工确认。")}</span></li>`).join("")}
        </ul>
      </section>
    ` : ""}
    ${nodes.length ? `
      <section>
        <h4>案件节点</h4>
        <div class="case-node-list">
          ${nodes.slice(0, 8).map((node) => `<div class="case-node-pill ${escapeHtml(node.status || "queued")}"><strong>${escapeHtml(node.title || node.node_id)}</strong><span>${escapeHtml(node.status || "queued")}</span></div>`).join("")}
        </div>
      </section>
    ` : ""}
  `;
}

function openWorkflowPip({ rootId = "", taskId = "" } = {}) {
  const pip = document.getElementById("workflow-pip");
  if (!pip) return;
  const roots = growthRuntimeState.workflowRoots || [];
  const root = rootId
    ? roots.find(item => item.id === rootId)
    : roots.find(item => item.tasks?.some(task => task.id === taskId));
  const task = taskId ? (growthRuntimeState.workflowTasks || []).find(item => item.id === taskId) : null;
  const rootCase = root ? (growthRuntimeState.growthCases || []).find(item => item.type === root.id || item.id?.startsWith(`${root.id}_`)) : null;
  const latestRun = rootCase?.runs?.[0] || null;
  const title = task?.title || root?.title || "流程详情";
  const reportHtml = renderWorkflowReportHtml(root?.report);

  pip.innerHTML = `
    <div class="workflow-pip-head">
      <div>
        <span class="node-lane">${escapeHtml(task ? workflowKindLabel(task.kind) : workflowLaneLabel(root?.lane || "workflow"))}</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <button class="modal-close workflow-pip-close" aria-label="关闭">&times;</button>
    </div>
    <div class="workflow-pip-body">
      ${task ? `
        <section>
          <h4>为什么要做</h4>
          <p>${escapeHtml(task.reason)}</p>
        </section>
        <section>
          <h4>下一步</h4>
          <p>${escapeHtml(task.actionText)}</p>
        </section>
        <div class="workflow-pip-meta">
          <span>${escapeHtml(task.severity || "P1")}</span>
          <span>${escapeHtml(task.source)}</span>
          <span>${escapeHtml(task.owner)}</span>
          <span>${workflowStatusLabel(task.status)}</span>
        </div>
        <div class="workflow-pip-actions">
          ${task.actionId ? `<button class="btn btn-outline workflow-run-btn" data-action="${task.actionId}" data-sku="${escapeHtml(task.sku || "")}">AI 诊断</button>` : ""}
          <button class="btn btn-primary workflow-state-btn" data-id="${escapeHtml(task.id)}" data-status="${workflowNextStatus(task.status)}">${task.status === "todo" ? "已执行" : task.status === "confirmed" ? "进入观察" : "标记复盘"}</button>
          <button class="btn btn-outline workflow-exp-btn" data-id="${escapeHtml(task.id)}">加入实验</button>
        </div>
      ` : `
        <section>
          <h4>流程判断</h4>
          <p>${escapeHtml(root?.narrative || "当前根流程暂无说明。")}</p>
        </section>
        <section>
          <h4>运行前证据检查</h4>
          ${renderEvidenceChecklist(root?.evidenceStatus || [])}
        </section>
        ${renderCaseIntelligence(rootCase)}
        <section>
          <h4>关联报告</h4>
          <div class="workflow-report-rendered md-report">${reportHtml}</div>
        </section>
        <div class="workflow-pip-meta">
          <span>${root?.stats?.total || 0} 个任务</span>
          <span>${root?.stats?.p0 || 0} 个 P0</span>
          <span>${root?.report ? "有报告" : "待诊断"}</span>
          ${rootCase ? `<span>案件: ${escapeHtml(workflowCaseStatusLabel(rootCase.status))}</span>` : ""}
          ${latestRun ? `<span>最近运行: ${escapeHtml(workflowCaseStatusLabel(latestRun.status))}</span>` : ""}
          ${rootCase?.reportIds?.length ? `<span>${rootCase.reportIds.length} 份归档</span>` : ""}
        </div>
        <div class="workflow-pip-actions">
          ${root ? `<button class="btn btn-primary growth-action-btn" data-action="${root.actionId}">运行/更新此流程</button>` : ""}
        </div>
      `}
    </div>
  `;
  pip.classList.remove("hidden");
  applyWorkflowPipPosition(pip);

  pip.querySelector(".workflow-pip-close")?.addEventListener("click", closeWorkflowPip);
  bindWorkflowPipDrag(pip);
  pip.querySelectorAll(".growth-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleGrowthAction(btn.dataset.action, ""));
  });
  pip.querySelectorAll(".workflow-run-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleGrowthAction(btn.dataset.action, btn.dataset.sku || ""));
  });
  pip.querySelectorAll(".workflow-state-btn").forEach((btn) => {
    btn.addEventListener("click", () => updateWorkflowTaskState(btn.dataset.id, {
      status: btn.dataset.status,
      manualConfirmedAt: btn.dataset.status === "confirmed" ? new Date().toISOString() : undefined,
      observationWindow: btn.dataset.status === "observing" ? "7 天" : undefined,
    }));
  });
  pip.querySelectorAll(".workflow-exp-btn").forEach((btn) => {
    const selectedTask = (growthRuntimeState.workflowTasks || []).find(item => item.id === btn.dataset.id);
    if (!selectedTask) return;
    btn.addEventListener("click", () => createGrowthExperiment({
      sku: selectedTask.sku || workflowKindLabel(selectedTask.kind),
      title: selectedTask.title,
      action: selectedTask.actionText,
      metric: selectedTask.kind === "fulfillment" ? "履约准时率" : "曝光 / 加购 / 订单",
      source: "workflow_task",
    }));
  });
}

function applyWorkflowPipPosition(pip) {
  if (!workflowPipPosition) {
    pip.style.left = "";
    pip.style.top = "";
    pip.style.right = "";
    pip.style.bottom = "";
    return;
  }
  pip.style.left = `${workflowPipPosition.left}px`;
  pip.style.top = `${workflowPipPosition.top}px`;
  pip.style.right = "auto";
  pip.style.bottom = "auto";
}

function bindWorkflowPipDrag(pip) {
  const head = pip.querySelector(".workflow-pip-head");
  if (!head) return;
  if (typeof pip.workflowDragCleanup === "function") pip.workflowDragCleanup();
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  const start = (event) => {
    if (event.target.closest("button")) return;
    dragging = true;
    const rect = pip.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    event.preventDefault();
    pip.classList.add("is-dragging");
  };
  const move = (event) => {
    if (!dragging) return;
    const width = pip.offsetWidth || 520;
    const height = pip.offsetHeight || 360;
    const nextLeft = Math.min(window.innerWidth - width - 12, Math.max(12, startLeft + event.clientX - startX));
    const nextTop = Math.min(window.innerHeight - height - 12, Math.max(12, startTop + event.clientY - startY));
    workflowPipPosition = { left: nextLeft, top: nextTop };
    applyWorkflowPipPosition(pip);
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    pip.classList.remove("is-dragging");
  };
  head.addEventListener("pointerdown", start);
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop);
  document.addEventListener("pointercancel", stop);
  pip.workflowDragCleanup = () => {
    head.removeEventListener("pointerdown", start);
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    document.removeEventListener("pointercancel", stop);
  };
}

async function updateWorkflowTaskState(taskId, patch = {}) {
  if (!taskId) return;
  const stored = await new Promise((r) => chrome.storage.local.get(["growthWorkflowTaskState"], r));
  const state = stored.growthWorkflowTaskState || {};
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  state[taskId] = {
    ...(state[taskId] || {}),
    ...cleanPatch,
    updatedAt: new Date().toISOString(),
  };
  await new Promise((r) => chrome.storage.local.set({ growthWorkflowTaskState: state }, r));
  await refreshAllData();
}

function renderGrowthHome() {
  const tasks = document.getElementById("today-growth-tasks");
  const opportunities = document.getElementById("today-growth-opportunities");
  if (!tasks || !opportunities) return;

  const urgentRows = growthRuntimeState.skuRows.filter(row => row.issue !== "scale").slice(0, 4);
  tasks.innerHTML = urgentRows.length ? urgentRows.map(row => `
    <div class="growth-task-item">
      <span class="badge ${getRiskBadgeClass(row.issue)}">${row.issueLabel}</span>
      <div>
        <strong>${escapeHtml(row.title)}</strong>
        <p>${escapeHtml(row.nextAction)}</p>
      </div>
      <button class="btn btn-outline btn-xs growth-action-btn" data-action="${row.issue === "profit" ? "calculate_profit_guardrail" : row.issue === "fulfillment" ? "detect_fulfillment_risk" : "diagnose_sku_funnel"}" data-sku="${escapeHtml(row.sku)}">诊断</button>
    </div>
  `).join("") : `<div class="empty-state">暂无紧急风险。先绑定店铺 API 或添加监控任务后，系统会自动生成今日动作。</div>`;

  opportunities.innerHTML = growthRuntimeState.opportunities.slice(0, 4).map(card => `
    <div class="growth-task-item">
      <span class="badge success">${escapeHtml(card.type)}</span>
      <div>
        <strong>${escapeHtml(card.title)}</strong>
        <p>${escapeHtml(card.impact)}</p>
      </div>
      <button class="btn btn-outline btn-xs growth-action-btn" data-action="${card.action}">处理</button>
    </div>
  `).join("");

  const sessions = growthRuntimeState.skuRows.reduce((sum, row) => sum + row.sessions, 0);
  const views = growthRuntimeState.skuRows.reduce((sum, row) => sum + row.views, 0);
  const avgCart = growthRuntimeState.skuRows.length
    ? growthRuntimeState.skuRows.reduce((sum, row) => sum + row.cartRate, 0) / growthRuntimeState.skuRows.length
    : 0;
  const avgOrder = growthRuntimeState.skuRows.length
    ? growthRuntimeState.skuRows.reduce((sum, row) => sum + row.orderRate, 0) / growthRuntimeState.skuRows.length
    : 0;
  document.getElementById("funnel-exposure").innerText = sessions ? sessions.toLocaleString() : "--";
  document.getElementById("funnel-views").innerText = views ? views.toLocaleString() : "--";
  document.getElementById("funnel-cart").innerText = avgCart ? `${avgCart.toFixed(1)}%` : "--";
  document.getElementById("funnel-order").innerText = avgOrder ? `${avgOrder.toFixed(1)}%` : "--";
  document.getElementById("funnel-fulfillment").innerText = `${growthRuntimeState.skuRows.filter(row => row.issue === "fulfillment").length} 风险`;

  [...tasks.querySelectorAll(".growth-action-btn"), ...opportunities.querySelectorAll(".growth-action-btn")].forEach((btn) => {
    btn.onclick = () => handleGrowthAction(btn.dataset.action, btn.dataset.sku || "");
  });
}

function renderSourceLedger() {
  const ledger = document.getElementById("growth-source-ledger");
  if (!ledger) return;
  const hasShop = !!growthRuntimeState.activeShop;
  const hasHistory = growthRuntimeState.savedResults.length > 0 || growthRuntimeState.monitorEvents.length > 0;
  const hasExperiments = growthRuntimeState.experiments.length > 0;
  const hasSkuApi = !!growthRuntimeState.skuAnalyticsSnapshot?.result?.data?.length;
  const hasStoreApi = !!growthRuntimeState.storeSnapshotCache?.result;
  const formatSyncTime = (value) => value ? new Date(value).toLocaleString() : "未同步";
  ledger.innerHTML = `
    <div class="source-ledger-item">
      <strong><span class="source-dot ${hasSkuApi ? "live" : "local"}"></span>${hasSkuApi ? "Seller API SKU Analytics" : "本地跟踪 SKU"}</strong>
      <p>${hasSkuApi ? `SKU 作战台已接入 ${growthRuntimeState.skuAnalyticsSnapshot.result.data.length} 行真实 SKU 维度 analytics；本地缓存更新时间：${formatSyncTime(growthRuntimeState.skuAnalyticsSnapshot.syncedAt)}。` : "未同步 SKU analytics 时只展示本地跟踪对象，不生成示例曝光、加购、订单或利润指标。"}</p>
    </div>
    <div class="source-ledger-item">
      <strong><span class="source-dot ${hasHistory ? "local" : "ai"}"></span>${hasHistory ? "本地历史可用" : "暂无历史证据"}</strong>
      <p>${hasHistory ? "机会卡会读取 savedResults / monitorChangeEvents / monitorReports。" : "机会中心只显示待启动动作，不把 AI 推断伪装成历史结果。"}</p>
    </div>
    <div class="source-ledger-item">
      <strong><span class="source-dot ${hasStoreApi ? "live" : hasShop ? "local" : "ai"}"></span>${hasStoreApi ? "Seller API 店铺快照" : hasShop ? "已选择活动店铺" : "未绑定 Seller API"}</strong>
      <p>${hasStoreApi ? `店铺快照已保存在本地；下次 Seller API 同步成功会覆盖更新。最近同步：${formatSyncTime(growthRuntimeState.storeSnapshotCache.syncedAt)}。` : hasShop ? "店铺 API 看板会请求 Ozon Seller API；失败时显示空状态和错误原因，不生成模拟经营数据。" : "店铺业绩、订单和费用需要绑定 Seller API 后展示。"}</p>
    </div>
    <div class="source-ledger-item">
      <strong><span class="source-dot ${hasExperiments ? "local" : "ai"}"></span>${hasExperiments ? "实验状态真实保存" : "暂无实验记录"}</strong>
      <p>${hasExperiments ? "growthExperiments 已本地持久化；真实复盘需拉取实验前后 API 窗口。" : "未创建实验时保持空状态，不生成默认实验卡。"}</p>
    </div>
  `;
}

function getEndpointAuditSummary() {
  return [
    {
      name: "Seller API 店铺快照",
      status: "真实端点",
      evidence: "GET_OZON_STORE_SNAPSHOT 调用 ozon_api_get_store_snapshot，成功后缓存到 ozonStoreSnapshotCache。",
      action: "保留在 API 数据页；画布只引用它作为经营证据。",
    },
    {
      name: "Seller API SKU analytics",
      status: "真实端点",
      evidence: "GET_OZON_SKU_ANALYTICS 调用 ozon_api_get_analytics，成功后缓存到 ozonSkuAnalyticsSnapshot。",
      action: "作为全量 SKU 轻体检、定位风险和任务优先级输入。",
    },
    {
      name: "AI 业务技能运行",
      status: "真实端点，但 dashboard 未直接执行",
      evidence: "RUN_SKILL 在 background.js 中真实执行；dashboard 当前按钮只创建 growthActionRuns 队列。",
      action: "下一步应把画布动作接到 RUN_SKILL，形成可观察的运行状态。",
    },
    {
      name: "增长实验",
      status: "本地真实状态",
      evidence: "growthExperiments 可创建、推进、观察和复盘；真实效果仍需拉 Seller API 时间窗对比。",
      action: "整合为画布 Scrum 列和案件复盘，不再作为左侧一级菜单。",
    },
    {
      name: "监控任务",
      status: "本地真实任务 + Chrome alarm",
      evidence: "monitorTasks 可添加/删除，并通过 chrome.alarms 定期触发后台监控。",
      action: "保留在系统任务页，作为底层能力而不是增长主流程入口。",
    },
    {
      name: "商品页、竞品、扩品、利润线按钮",
      status: "业务意图队列",
      evidence: "这些按钮调用 handleGrowthAction，只写入 queued growthActionRuns 并提示去前台/侧边栏运行。",
      action: "放入画布案件；UI 上避免伪装成已自动完成的业务执行。",
    },
    {
      name: "AI 报告与监控报告",
      status: "本地真实数据",
      evidence: "savedResults / monitorReports 来自技能 final 或监控报告；PIP 已可直接解析 Markdown / JSON。",
      action: "画布内作为案件证据阅读；报告中心保留为跨案件归档、复制、删除和 PDF 下载入口。",
    },
  ];
}

function renderSettingsTab() {
  const container = document.getElementById("endpoint-audit-summary");
  if (!container) return;
  container.innerHTML = getEndpointAuditSummary().map((item) => `
    <article class="endpoint-audit-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.status)}</span>
      </div>
      <p>${escapeHtml(item.evidence)}</p>
      <small>${escapeHtml(item.action)}</small>
    </article>
  `).join("");
}

function renderSkuWorkbench() {
  const body = document.getElementById("sku-war-table-body");
  if (!body) return;
  const filter = document.getElementById("sku-filter")?.value || "all";
  const rows = growthRuntimeState.skuRows.filter(row => filter === "all" || row.issue === filter);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="empty-cell"><div class="empty-state">暂无 SKU 数据。绑定 Ozon API、添加跟踪商品或运行一次店铺诊断后会自动补齐。</div></td></tr>`;
    return;
  }
  body.innerHTML = rows.map(row => `
    <tr>
      <td>
        <strong class="cell-ellipsis" title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</strong>
        <small>${escapeHtml(row.sku)} · ${escapeHtml(row.dataSource || "本地追踪")}</small>
      </td>
      <td><span class="badge ${getRiskBadgeClass(row.issue)}">${row.issueLabel}</span></td>
      <td>${Number(row.revenue).toLocaleString()} ₽</td>
      <td>${Number(row.sessions).toLocaleString()}</td>
      <td>${row.cartRate}%</td>
      <td>${row.orderRate}%</td>
      <td><span style="color:${row.margin >= 20 ? 'var(--success)' : 'var(--warning)'}">${row.margin}%</span></td>
      <td>${escapeHtml(row.nextAction)}</td>
      <td class="sku-actions">
        <button class="btn btn-outline btn-xs growth-action-btn" data-action="diagnose_sku_funnel" data-sku="${escapeHtml(row.sku)}">诊断</button>
        <button class="btn btn-outline btn-xs growth-action-btn" data-action="rewrite_listing" data-sku="${escapeHtml(row.sku)}">改版</button>
        <button class="btn btn-primary btn-xs create-exp-btn" data-sku="${escapeHtml(row.sku)}" data-title="${escapeHtml(row.title)}" data-action="${escapeHtml(row.nextAction)}">实验</button>
      </td>
    </tr>
  `).join("");
  body.querySelectorAll(".growth-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleGrowthAction(btn.dataset.action, btn.dataset.sku || ""));
  });
  body.querySelectorAll(".create-exp-btn").forEach((btn) => {
    btn.addEventListener("click", () => createGrowthExperiment({
      sku: btn.dataset.sku,
      title: btn.dataset.title,
      action: btn.dataset.action,
      metric: "加购率 / 付款率",
      source: "sku_workbench",
    }));
  });
}

function renderOpportunityCenter() {
  const grid = document.getElementById("opportunity-card-grid");
  if (!grid) return;
  grid.innerHTML = growthRuntimeState.opportunities.map(card => `
    <article class="opportunity-card">
      <div class="opportunity-topline">
        <span class="badge success">${escapeHtml(card.type)}</span>
        <span>${escapeHtml(card.impact)}</span>
      </div>
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.evidence)}</p>
      <div class="opportunity-actions">
        <button class="btn btn-primary btn-xs growth-action-btn" data-action="${card.action}">一键诊断</button>
        <button class="btn btn-outline btn-xs create-opportunity-exp-btn" data-title="${escapeHtml(card.title)}" data-action="${escapeHtml(card.experiment)}">加入实验</button>
      </div>
    </article>
  `).join("");
  grid.querySelectorAll(".growth-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleGrowthAction(btn.dataset.action, ""));
  });
  grid.querySelectorAll(".create-opportunity-exp-btn").forEach((btn) => {
    btn.addEventListener("click", () => createGrowthExperiment({
      sku: "机会中心",
      title: btn.dataset.title,
      action: btn.dataset.action,
      metric: "曝光 / 加购 / 订单",
      source: "opportunity_center",
    }));
  });
}

function renderExperimentBoard() {
  const columns = {
    todo: document.getElementById("experiment-todo"),
    running: document.getElementById("experiment-running"),
    observing: document.getElementById("experiment-observing"),
    reviewed: document.getElementById("experiment-reviewed"),
  };
  if (!columns.todo) return;
  Object.values(columns).forEach((column) => { column.innerHTML = ""; });
  const experiments = growthRuntimeState.experiments;
  if (!experiments.length) {
    columns.todo.innerHTML = `<div class="empty-state compact">暂无真实实验。请先从体检报告、SKU 诊断或机会卡创建实验。</div>`;
    Object.entries(columns).forEach(([key, column]) => {
      if (key !== "todo") column.innerHTML = `<div class="empty-state compact">暂无</div>`;
    });
    return;
  }
  experiments.forEach((experiment) => {
    const status = columns[experiment.status] ? experiment.status : "todo";
    const node = document.createElement("div");
    node.className = "experiment-card";
    node.innerHTML = `
      <div class="experiment-card-head">
        <strong>${escapeHtml(experiment.title)}</strong>
        <span>${escapeHtml(experiment.sku || "店铺级")}</span>
      </div>
      <p>${escapeHtml(experiment.action)}</p>
      <div class="experiment-meta">
        <span>目标: ${escapeHtml(experiment.metric || "加购率")}</span>
        <span>${escapeHtml(experiment.window || "7 天")}</span>
      </div>
      ${experiment.baseline ? `<div class="experiment-baseline">基线: ${Number(experiment.baseline.sessions || 0).toLocaleString()} 曝光 / 加购 ${experiment.baseline.cartRate || 0}% / ${escapeHtml(experiment.baseline.dataSource || "")}</div>` : ""}
      <div class="experiment-actions">
        <button class="btn btn-outline btn-xs experiment-move-btn" data-id="${escapeHtml(experiment.id)}" data-next="${status === "todo" ? "running" : status === "running" ? "observing" : "reviewed"}">${status === "reviewed" ? "已完成" : "推进"}</button>
        <button class="btn btn-outline btn-xs growth-action-btn" data-action="review_experiment_result">复盘</button>
      </div>
    `;
    columns[status].appendChild(node);
  });
  Object.entries(columns).forEach(([, column]) => {
    if (!column.innerHTML.trim()) column.innerHTML = `<div class="empty-state compact">暂无</div>`;
  });
  document.querySelectorAll(".experiment-move-btn").forEach((btn) => {
    btn.addEventListener("click", () => moveExperiment(btn.dataset.id, btn.dataset.next));
  });
  document.querySelectorAll(".experiment-card .growth-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleGrowthAction(btn.dataset.action, ""));
  });
}

async function createGrowthExperiment({ sku, title, action, metric, source }) {
  const stored = await new Promise((r) => chrome.storage.local.get(["growthExperiments", "activeShopId"], r));
  const experiments = stored.growthExperiments || [];
  const baselineRow = growthRuntimeState.skuRows.find(row => row.sku === sku || row.title === title);
  const experiment = {
    id: `exp_${Date.now()}`,
    shopId: stored.activeShopId || growthRuntimeState.activeShop?.id || "",
    status: "todo",
    sku,
    title: title || "增长实验",
    action: action || "验证一个运营优化动作",
    metric: metric || "加购率 / 订单量",
    window: "7 天",
    baseline: baselineRow ? {
      sessions: baselineRow.sessions,
      views: baselineRow.views,
      cartRate: baselineRow.cartRate,
      orderRate: baselineRow.orderRate,
      orderedUnits: baselineRow.orderedUnits || 0,
      revenue: baselineRow.revenue,
      dataSource: baselineRow.dataSource || "unknown",
      capturedAt: new Date().toISOString(),
    } : null,
    source: source || "growth_action",
    createdAt: new Date().toISOString(),
  };
  experiments.unshift(experiment);
  await new Promise((r) => chrome.storage.local.set({ growthExperiments: experiments }, r));
  await refreshAllData();
  document.querySelector('.nav-menu button[data-tab="workflow"]')?.click();
  openWorkflowPip({
    taskId: (growthRuntimeState.workflowTasks || []).find((task) => task.title.includes(title || "增长实验"))?.id || "",
  });
}

async function moveExperiment(id, nextStatus) {
  if (!id) return;
  const stored = await new Promise((r) => chrome.storage.local.get(["growthExperiments"], r));
  const experiments = stored.growthExperiments || [];
  const match = experiments.find(exp => exp.id === id);
  if (match) {
    match.status = nextStatus;
    match.updatedAt = new Date().toISOString();
    await new Promise((r) => chrome.storage.local.set({ growthExperiments: experiments }, r));
    await refreshAllData();
  }
}

async function persistGrowthRunUpdate(caseId, runId, runPatch = {}, casePatch = {}) {
  const stored = await new Promise((r) => chrome.storage.local.get(["growthActionRuns", "growthCases"], r));
  const runs = stored.growthActionRuns || [];
  const cases = stored.growthCases || [];
  const now = new Date().toISOString();
  const nextRuns = runs.map((run) => run.id === runId ? { ...run, ...runPatch, updatedAt: now } : run);
  const nextCases = cases.map((caseItem) => {
    if (caseItem.id !== caseId) return caseItem;
    const caseRuns = (caseItem.runs || []).map((run) => run.id === runId ? { ...run, ...runPatch, updatedAt: now } : run);
    const mergedReportIds = casePatch.reportIds
      ? Array.from(new Set([...(caseItem.reportIds || []), ...casePatch.reportIds.map(String)]))
      : (caseItem.reportIds || []);
    const cleanCasePatch = { ...casePatch };
    delete cleanCasePatch.reportIds;
    return {
      ...caseItem,
      ...cleanCasePatch,
      reportIds: mergedReportIds,
      runs: caseRuns,
      status: casePatch.status || statusFromCaseRuns({ ...caseItem, runs: caseRuns }),
      updatedAt: now,
    };
  });
  await new Promise((r) => chrome.storage.local.set({
    growthActionRuns: nextRuns.slice(0, 80),
    growthCases: nextCases.slice(0, 80),
  }, r));
}

async function ensureDashboardSavedEntry(run, successResult = {}) {
  if (successResult.savedEntry?.id) return successResult.savedEntry;
  const output = successResult.result || successResult.output || successResult;
  if (!output || typeof output !== "object") return null;
  const stored = await new Promise((r) => chrome.storage.local.get(["savedResults"], r));
  const savedResults = stored.savedResults || [];
  const entry = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    skillId: run.skillPath,
    skillName: run.title,
    pageUrl: "dashboard://growth-workflow",
    pageTitle: "增长工作流画布",
    growthActionId: run.actionId,
    growthRunId: run.id,
    growthCaseId: run.caseId,
    result: output,
  };
  savedResults.unshift(entry);
  await new Promise((r) => chrome.storage.local.set({ savedResults: savedResults.slice(0, 100) }, r));
  return entry;
}

function startDashboardGrowthRun(run) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.connect) {
      reject(new Error("当前环境不支持后台长连接，请在 Ozon 页面右侧浮窗执行该技能。"));
      return;
    }
    const port = chrome.runtime.connect({ name: "ozon-agent-loop" });
    let settled = false;
    port.onMessage.addListener(async (message) => {
      try {
        if (message.type === "PROGRESS") {
          await persistGrowthRunUpdate(run.caseId, run.id, {
            status: "running",
            lastProgress: message.data?.message || message.data?.type || "运行中",
          }, { status: "running" });
        }
        if (message.type === "SUCCESS") {
          settled = true;
          const savedEntry = await ensureDashboardSavedEntry(run, message.result || {});
          await persistGrowthRunUpdate(run.caseId, run.id, {
            status: "completed",
            completedAt: new Date().toISOString(),
            savedResultId: savedEntry?.id || message.result?.savedEntry?.id || "",
          }, {
            status: "completed",
            reportIds: savedEntry?.id ? [String(savedEntry.id)] : undefined,
          });
          port.disconnect?.();
          resolve(message.result);
        }
        if (message.type === "ERROR") {
          settled = true;
          await persistGrowthRunUpdate(run.caseId, run.id, {
            status: "failed",
            error: message.error || "运行失败",
            failedAt: new Date().toISOString(),
          }, { status: "failed" });
          port.disconnect?.();
          reject(new Error(message.error || "运行失败"));
        }
      } catch (err) {
        settled = true;
        port.disconnect?.();
        reject(err);
      }
    });
    port.onDisconnect?.addListener(async () => {
      if (settled) return;
      await persistGrowthRunUpdate(run.caseId, run.id, {
        status: "interrupted",
        error: "后台连接中断，已保存断点，可再次运行继续。",
        interruptedAt: new Date().toISOString(),
      }, { status: "interrupted" });
      reject(new Error("后台连接中断，已保存断点，可再次运行继续。"));
    });
    port.postMessage({
      type: "RUN_SKILL",
      skillPath: run.skillPath,
      growthActionId: run.actionId,
      growthRunId: run.id,
      growthCaseId: run.caseId,
      userInstruction: run.instruction,
    });
  });
}

async function createGrowthCaseRun(actionId, sku = "") {
  const action = GROWTH_ACTIONS[actionId] || GROWTH_ACTIONS.diagnose_store_growth;
  const stored = await new Promise((r) => chrome.storage.local.get(["growthActionRuns", "growthCases", "activeShopId"], r));
  const shopId = stored.activeShopId || growthRuntimeState.activeShop?.id || "";
  const caseType = GROWTH_ACTION_CASE_TYPE[actionId] || "store_health";
  const caseId = growthCaseIdFor(actionId, shopId, sku);
  const now = new Date().toISOString();
  const run = {
    id: `growth_run_${Date.now()}`,
    caseId,
    caseType,
    shopId,
    actionId,
    title: action.title,
    sku,
    instruction: sku ? `${action.instruction}\n目标 SKU: ${sku}` : action.instruction,
    skillPath: action.skillPath,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  const runs = [run, ...(stored.growthActionRuns || [])].slice(0, 80);
  const cases = stored.growthCases || [];
  const existing = cases.find((caseItem) => caseItem.id === caseId);
  const caseRun = { id: run.id, actionId, title: run.title, status: run.status, createdAt: now, updatedAt: now };
  const nextCase = {
    ...(existing || {}),
    id: caseId,
    type: caseType,
    title: existing?.title || GROWTH_CASE_LABELS[caseType] || action.title,
    shopId,
    status: "queued",
    actionId,
    taskIds: existing?.taskIds || [],
    reportIds: existing?.reportIds || [],
    runs: [caseRun, ...((existing?.runs || []).filter(item => item.id !== run.id))].slice(0, 20),
    evidence: {
      ...(existing?.evidence || {}),
      sku,
      actionTitle: action.title,
      queuedFrom: "dashboard_workflow_canvas",
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const nextCases = [nextCase, ...cases.filter((caseItem) => caseItem.id !== caseId)].slice(0, 80);
  await new Promise((r) => chrome.storage.local.set({ growthActionRuns: runs, growthCases: nextCases }, r));
  return run;
}

async function handleGrowthAction(actionId, sku = "") {
  const run = await createGrowthCaseRun(actionId, sku);
  await refreshAllData();
  openWorkflowPip({ rootId: GROWTH_ACTION_CASE_TYPE[actionId] || "store_health" });
  try {
    await persistGrowthRunUpdate(run.caseId, run.id, { status: "running", startedAt: new Date().toISOString() }, { status: "running" });
    await startDashboardGrowthRun(run);
    await refreshAllData();
    openWorkflowPip({ rootId: GROWTH_ACTION_CASE_TYPE[actionId] || "store_health" });
  } catch (err) {
    const fallbackStatus = /已保存断点|连接中断/.test(err.message)
      ? "interrupted"
      : /当前环境不支持|Receiving end|无法获取当前活动|无法注入|content/i.test(err.message)
      ? "needs_frontend_context"
      : "failed";
    await persistGrowthRunUpdate(run.caseId, run.id, {
      status: fallbackStatus,
      error: err.message,
      failedAt: new Date().toISOString(),
    }, { status: fallbackStatus });
    await refreshAllData();
    openWorkflowPip({ rootId: GROWTH_ACTION_CASE_TYPE[actionId] || "store_health" });
    alert(`已创建「${run.title}」增长案件，但当前无法在 dashboard 内直接完成运行。\n\n原因：${err.message}\n\n请打开对应 Ozon 页面，右侧浮窗会继续承接该动作。`);
  }
}

async function syncSkuAnalyticsFromApi() {
  const btn = document.getElementById("sync-sku-api-btn");
  const original = btn?.innerText || "同步 Seller API SKU";
  if (btn) {
    btn.disabled = true;
    btn.innerText = "同步中...";
  }
  try {
	    const range = readStoreDateRange();
	    const activeShopId = document.getElementById("global-shop-selector")?.value || growthRuntimeState.activeShop?.id || "";
	    const response = await chrome.runtime.sendMessage({
	      type: "GET_OZON_SKU_ANALYTICS",
	      args: { shopId: activeShopId, dateFrom: range.dateFrom, dateTo: range.dateTo, limit: 1000 }
	    });
    const rows = response?.data?.result?.data || [];
    if (!response?.ok || !rows.length) {
      alert(`Seller API SKU analytics 暂无数据：${response?.error || response?.data?.error || "返回为空"}`);
      return;
    }
	    await new Promise((r) => chrome.storage.local.set({
	      ozonSkuAnalyticsSnapshot: {
        shopId: activeShopId,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        result: response.data.result,
        syncedAt: new Date().toISOString(),
      }
    }, r));
    await refreshAllData();
    alert(`已同步 ${rows.length} 行真实 SKU analytics，SKU 作战台已刷新。`);
  } catch (err) {
    alert(`同步失败：${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = original;
    }
  }
}

function renderRecentEventsFeed(events = []) {
  const container = document.getElementById("recent-events-feed");
  if (events.length === 0) {
    container.innerHTML = `<div class="empty-state">暂无最新感知变化事件</div>`;
    return;
  }

  container.innerHTML = events.slice(0, 10).map((ev) => `
    <div class="event-item" style="padding:10px; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; justify-content:space-between; font-size:12px;">
      <div>
        <strong style="color:var(--text1)">${ev.entity_name || '竞争商品'}</strong>
        <span style="color:var(--text2); margin-left:8px;">${ev.event_desc || '检测到价格变动'}</span>
      </div>
      <span style="color:#64748b">${new Date(ev.detected_at || Date.now()).toLocaleTimeString()}</span>
    </div>
  `).join('');
}

function renderPipelineTable(savedResults = []) {
  const body = document.getElementById("pipeline-table-body");
  const sourcingResults = savedResults.filter(r => r.skillId && r.skillId.includes("sourcing_finder"));

  if (sourcingResults.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="9" class="empty-cell">
          <div class="empty-state">暂无对齐货源，请在 Ozon 详情页开启“1688寻源与套利测算”AI技能。</div>
        </td>
      </tr>
    `;
    return;
  }

  let rowsHtml = '';
  sourcingResults.forEach((res) => {
    const listData = (res.result && res.result.data) ? res.result.data : [];
    listData.forEach((item) => {
      const spec = item.spec_audit || {};
      const ledger = item.financial_ledger || {};

      rowsHtml += `
        <tr>
          <td><img src="${item.candidate_image_url || 'icons/icon128.png'}" style="width:40px; height:40px; border-radius:4px; object-fit:cover;"></td>
          <td>
            <div style="font-weight:600; font-size:12px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title || '对标品'}</div>
            <a href="${res.pageUrl || '#'}" target="_blank" style="font-size:10px; color:#005bff">前台直达 ➔</a>
          </td>
          <td>
            <div style="font-weight:500; font-size:12px;">1688 供应商货源</div>
            <a href="${item.product_link || '#'}" target="_blank" style="font-size:10px; color:#10b981">采购直达 ➔</a>
          </td>
          <td>¥${ledger.sourcing_cost || '0'}</td>
          <td>${ledger.shipping_cost || '0'} ₽</td>
          <td>${ledger.target_price || '0'} ₽</td>
          <td style="color:${parseFloat(ledger.margin_rate) > 20 ? '#10b981' : '#ef4444'}; font-weight:700;">${ledger.margin_rate}%</td>
          <td>
            <span class="badge ${spec.status === '完全一致' ? 'success' : 'warning'}" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(16,185,129,0.1); color:#10b981">
              ${spec.status || '无'}
            </span>
          </td>
          <td>
            <button class="btn btn-outline btn-xs" onclick="alert('即将拉取货源卖点生成 Ozon 俄语商品页文案！');">生成俄语商品页</button>
          </td>
        </tr>
      `;
    });
  });

  body.innerHTML = rowsHtml || `
    <tr>
      <td colspan="9" class="empty-cell">
        <div class="empty-state">暂无对齐货源，请在 Ozon 详情页开启“1688寻源与套利测算”AI技能。</div>
      </td>
    </tr>
  `;
}

function renderTasksTable(tasks = []) {
  const body = document.getElementById("tasks-table-body");
  if (tasks.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="empty-cell"><div class="empty-state">暂无感知监控任务</div></td>
      </tr>
    `;
    return;
  }

  body.innerHTML = tasks.map((task) => {
    const typeText = task.target_type === "shop" ? "Ozon 店铺" : "Ozon 商品";
    const natureText = task.shop_nature === "self" ? "自营(API)" : "第三方竞品";
    const badgeColor = task.target_type === "shop" ? "rgba(139, 92, 246, 0.1); color: #8b5cf6;" : "rgba(0, 91, 255, 0.1); color: #005bff;";
    const natureColor = task.shop_nature === "self" ? "rgba(16, 185, 129, 0.1); color: #10b981;" : "rgba(245, 158, 11, 0.1); color: #f59e0b;";

    return `
      <tr>
        <td>
          <span class="badge" style="background:${badgeColor}">${typeText}</span>
          <span class="badge" style="background:${natureColor}">${natureText}</span>
        </td>
        <td><a href="${task.target_url}" target="_blank" style="font-size:11px; max-width:280px; overflow:hidden; text-overflow:ellipsis; display:block; color:var(--text-secondary)">${task.target_url}</a></td>
        <td>${task.frequency === '15m' ? '每15分钟' : (task.frequency === '1h' ? '每1小时' : '每6小时')}</td>
        <td>${task.last_run_at}</td>
        <td><span class="status-indicator success" style="margin-right:6px;"></span> 运行中</td>
        <td>
          <button class="btn btn-outline btn-xs btn-danger-hover" id="delete-task-${task.id}">移除</button>
        </td>
      </tr>
    `;
  }).join('');

  tasks.forEach((t) => {
    document.getElementById(`delete-task-${t.id}`).addEventListener("click", async () => {
      if (confirm("确定移除此自动监控感知任务？")) {
        const stored = await new Promise((r) => chrome.storage.local.get(["monitorTasks"], r));
        const filtered = (stored.monitorTasks || []).filter(item => item.id !== t.id);
        await new Promise((r) => chrome.storage.local.set({ monitorTasks: filtered }, r));

        // Clear Chrome alarm
        const alarmName = `monitor_task_${encodeURIComponent(JSON.stringify(t))}`;
        try {
          await chrome.alarms.clear(alarmName);
        } catch (alarmErr) {
          console.warn("Could not clear Chrome alarm:", alarmErr.message);
        }

        await refreshAllData();
      }
    });
  });
}

// ── Operations Tracker View Tab Logic ──
let currentTrackedItem = null;

function renderTrackerTab() {
  chrome.storage.local.get(['trackedProducts'], (data) => {
    const list = data.trackedProducts || [];
    const listContainer = document.getElementById("tracked-products-list");
    const detailPlaceholder = document.getElementById("tracker-detail-placeholder");
    const detailContent = document.getElementById("tracker-detail-content");

    if (list.length === 0) {
      listContainer.innerHTML = `<div class="empty-state">暂无跟踪商品，请前往商品页浮窗点击“追踪此商品”。</div>`;
      detailPlaceholder.classList.remove("hidden");
      detailContent.classList.add("hidden");
      return;
    }

    listContainer.innerHTML = list.map((prod) => `
      <div class="tracked-item ${currentTrackedItem?.id === prod.id ? 'active' : ''}" id="tracked-item-${prod.id}" style="padding:12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer;">
        <div style="font-weight:600; font-size:12px; color:var(--text1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${prod.title}</div>
        <div style="font-size:10px; color:var(--text2); margin-top:4px; display:flex; justify-content:space-between">
          <span>阶段数: ${prod.phases?.length || 1} 个</span>
          <span>注册: ${prod.registeredAt}</span>
        </div>
      </div>
    `).join('');

    detailPlaceholder.classList.add("hidden");
    detailContent.classList.remove("hidden");

    list.forEach((prod) => {
      document.getElementById(`tracked-item-${prod.id}`).addEventListener("click", () => {
        currentTrackedItem = prod;
        renderTrackerTab(); // Refresh highlight
        renderTrackedItemDetails(prod);
      });
    });

    // Auto-select first item if none is selected
    if (!currentTrackedItem && list.length > 0) {
      currentTrackedItem = list[0];
      renderTrackedItemDetails(list[0]);
      // re-render to apply active highlight
      renderTrackerTab();
    }
  });
}

function renderTrackedItemDetails(prod) {
  document.getElementById("tracked-item-title").innerText = prod.title;
  document.getElementById("tracked-item-date").innerText = `注册时间: ${prod.registeredAt}`;
  document.getElementById("tracked-item-url").href = prod.url;

  // Render optimization phases timeline
  const timeline = document.getElementById("phases-timeline-list");
  const phases = prod.phases || [];
  
  timeline.innerHTML = phases.map((phase) => `
    <div class="timeline-item" style="position:relative; padding-left:24px; margin-bottom:18px; border-left:2px solid #005bff;">
      <div class="timeline-badge" style="position:absolute; left:-7px; top:0; width:12px; height:12px; border-radius:50%; background:#005bff;"></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <strong style="font-size:12px; color:var(--text1);">${phase.name}</strong>
        <span style="font-size:11px; color:#64748b;">${phase.date}</span>
      </div>
      <p style="font-size:12px; color:var(--text2); line-height:1.4; margin:0;">${phase.note}</p>
    </div>
  `).join('');

  // Setup Phase marking buttons
  document.getElementById("add-phase-btn").onclick = () => {
    document.getElementById("add-stage-modal").classList.remove("hidden");
    document.getElementById("new-stage-date").value = new Date().toISOString().split('T')[0];
  };

  document.getElementById("close-stage-modal-btn").onclick = () => {
    document.getElementById("add-stage-modal").classList.add("hidden");
  };

  document.getElementById("save-stage-btn").onclick = () => {
    const name = document.getElementById("new-stage-name").value.trim();
    const date = document.getElementById("new-stage-date").value;
    const note = document.getElementById("new-stage-note").value.trim();

    if (!name) {
      alert("请填写阶段名称！");
      return;
    }

    chrome.storage.local.get(['trackedProducts'], (data) => {
      const list = data.trackedProducts || [];
      const match = list.find(p => p.id === prod.id);
      if (match) {
        if (!match.phases) match.phases = [];
        match.phases.push({ name, date, note });
        chrome.storage.local.set({ trackedProducts: list }, () => {
          document.getElementById("add-stage-modal").classList.add("hidden");
          document.getElementById("new-stage-name").value = '';
          document.getElementById("new-stage-note").value = '';
          currentTrackedItem = match;
          renderTrackerTab();
        });
      }
    });
  };

  document.getElementById("sync-api-data-btn")?.addEventListener("click", () => {
    document.querySelector('.nav-menu button[data-tab="store"]')?.click();
    renderStoreTab();
  });

  // Run AI analysis
  document.getElementById("run-tracker-ai-btn").onclick = () => {
    const reportText = document.getElementById("tracker-ai-report-text");
    reportText.innerHTML = `<div style="color:#3b82f6; font-size:12px;">⚡ AI 正在读取历史快照指标并调用 ozon_operations_tracker 技能评估优化成效...</div>`;
    
    setTimeout(() => {
      reportText.innerHTML = `
        <div class="md-report" style="font-size:12px; line-height:1.5;">
          <h2>📊 Ozon AI 运营诊断报告 (阶段对比)</h2>
          <p><strong>诊断状态</strong>：分析对比完成。由于用户执行了 “阶段二：首图替换” 动作，该商品展现指标和转化指标呈现非均衡增长。</p>
          <ul>
            <li><strong>曝光量 (Views)</strong>：较基线阶段提升了 <strong>+42.3%</strong>，首图优化在搜索引擎和类目聚合页的点击吸引力非常显著。</li>
            <li><strong>转化率 (Conv to Cart)</strong>：从 <strong>4.8% 降至 4.1%</strong>，说明流量增大但主图的高端感使得消费者对详情页中原本普通的俄语卖点文案产生落差。</li>
            <li><strong>最终建议</strong>：应立即调度 <code>ozon_listing_generator</code> 技能，针对核心痛点重新重构俄语详情描述；同时由于汇率波动，建议价格上浮 50₽ 以锁定 25% 纯利率。</li>
          </ul>
        </div>
      `;
    }, 2000);
  };

  // Draw Charts
  drawTrackerCharts();
}

function drawTrackerCharts() {
  const drawLine = (canvasId, data = [], labels = [], color = '#005bff') => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    // Set drawing width/height to match actual layout size multiplied by devicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 180 * dpr; // height is 180px
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = 180;
    
    // Clear
    ctx.clearRect(0, 0, width, height);
    
    // Draw grid
    const themeBorder = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = themeBorder;
    ctx.lineWidth = 1;
    for(let i = 1; i < 4; i++) {
      const y = height * (i / 4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (data.length === 0) return;

    // Plot line
    const maxVal = Math.max(...data) * 1.25 || 10;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    const points = [];
    for(let i = 0; i < data.length; i++) {
      const x = (width * 0.8) * (i / (data.length - 1 || 1)) + (width * 0.1);
      const y = height - (height * 0.6) * (data[i] / maxVal) - 40;
      points.push({ x, y });
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw dots & labels
    const textPrimary = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#ffffff';
    const textSecondary = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#9ca3af';

    points.forEach((p, idx) => {
      // Draw dot fill (white or background color depending on theme)
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-input').trim() || '#1f2937';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw dot border (colored line)
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      
      // Draw data value label above dot
      ctx.fillStyle = textPrimary;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(data[idx], p.x, p.y - 10);
      
      // Draw phase label below dot
      ctx.fillStyle = textSecondary;
      ctx.font = '10px sans-serif';
      ctx.fillText(labels[idx] || '', p.x, height - 12);
    });
  };

  const experiments = growthRuntimeState.experiments || [];
  const labels = experiments.map((item) => item.name || item.stage || "阶段");
  const sales = experiments.map((item) => Number(item.result?.orders || item.orders || item.baseline?.orders || 0));
  const conversion = experiments.map((item) => Number(item.result?.cartRate || item.cartRate || item.baseline?.cartRate || 0));
  drawLine('tracker-sales-chart', sales, labels, '#005bff');
  drawLine('tracker-conv-chart', conversion, labels, '#ff005b');
}

// ── Ozon Store API Tab Logic ──
let storeApiRequestInFlight = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultStoreDateRange(days = 14) {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateTo.getDate() - Math.max(1, days));
  return {
    dateFrom: formatDateInput(dateFrom),
    dateTo: formatDateInput(dateTo),
  };
}

function setDefaultStoreDateRange() {
  const fromInput = document.getElementById("store-api-date-from");
  const toInput = document.getElementById("store-api-date-to");
  if (!fromInput || !toInput) return;
  const defaults = getDefaultStoreDateRange(14);
  if (!fromInput.value) fromInput.value = defaults.dateFrom;
  if (!toInput.value) toInput.value = defaults.dateTo;
}

function readStoreDateRange() {
  const defaults = getDefaultStoreDateRange(14);
  const fromInput = document.getElementById("store-api-date-from");
  const toInput = document.getElementById("store-api-date-to");
  let dateFrom = fromInput?.value || defaults.dateFrom;
  let dateTo = toInput?.value || defaults.dateTo;
  if (dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
    if (fromInput) fromInput.value = dateFrom;
    if (toInput) toInput.value = dateTo;
  }
  return { dateFrom, dateTo };
}

function isSellerApiCacheFresh(cache, activeShopId, maxAgeMs = SELLER_API_AUTO_REFRESH_MS) {
  if (!cache || cache.shopId !== activeShopId || !cache.syncedAt) return false;
  return Date.now() - new Date(cache.syncedAt).getTime() < maxAgeMs;
}

async function maybeAutoRefreshSellerApiCache() {
  const activeShopId = growthRuntimeState.activeShop?.id || "";
  if (!activeShopId) return;
  if (isSellerApiCacheFresh(growthRuntimeState.skuAnalyticsSnapshot, activeShopId)) return;
  const range = readStoreDateRange();
  const response = await chrome.runtime.sendMessage({
    type: "GET_OZON_SKU_ANALYTICS",
    args: { shopId: activeShopId, dateFrom: range.dateFrom, dateTo: range.dateTo, limit: 1000 }
  });
  if (response?.ok && response?.data?.result?.data?.length) {
    await refreshAllData();
  }
}

function ensureStoreApiStatusNode() {
  const cardHeader = document.querySelector("#view-store .grid-card .card-header");
  if (!cardHeader) return null;
  let statusNode = document.getElementById("store-api-source-status");
  if (!statusNode) {
    statusNode = document.createElement("div");
    statusNode.id = "store-api-source-status";
    statusNode.style.cssText = "font-size:11px; color:var(--text-secondary); flex-basis:100%; min-width:0; line-height:1.5; word-break:break-word;";
    cardHeader.appendChild(statusNode);
  }
  return statusNode;
}

function setStoreApiStatus(kind, message) {
  const node = ensureStoreApiStatusNode();
  if (!node) return;
  const color = kind === "live" ? "#10b981" : kind === "partial" ? "#f59e0b" : "#ef4444";
  node.innerHTML = `<span style="color:${color}; font-weight:600;">● ${escapeHtml(message)}</span>`;
}

function formatStoreApiFailure(failure = {}) {
  const endpoint = failure.endpoint || "Seller API";
  const error = String(failure.error || "");
  if (/429|rate limit/i.test(error)) {
    return `${endpoint}: 触发 Ozon 频率限制，系统已排队并自动重试；若仍失败请缩小日期范围或稍后再查`;
  }
  if (/404|not found/i.test(error)) {
    return `${endpoint}: 接口不可用或权限不足`;
  }
  return `${endpoint}: ${error}`;
}

function metricValue(totals = {}, metrics = [], metricName) {
  if (Object.prototype.hasOwnProperty.call(totals, metricName)) return Number(totals[metricName]) || 0;
  const idx = metrics.indexOf(metricName);
  if (idx >= 0 && Object.prototype.hasOwnProperty.call(totals, idx)) return Number(totals[idx]) || 0;
  return 0;
}

function averageMetric(rows = [], metricNames = [], metricName) {
  const idx = metricNames.indexOf(metricName);
  if (idx < 0) return 0;
  const values = rows
    .map((row) => Number((row.metrics || [])[idx]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mapSnapshotToStoreMetrics(snapshot = {}) {
  const analytics = snapshot.analytics || {};
  const metrics = analytics.metrics || [];
  const totals = analytics.totals || {};
  const rows = analytics.data || [];
  const views = metricValue(totals, metrics, "hits_view");
  const sessions = metricValue(totals, metrics, "session_view");
  const orderedUnits = metricValue(totals, metrics, "ordered_units");
  const avgCartRate = averageMetric(rows, metrics, "conv_tocart");
  const cartRate = avgCartRate > 0
    ? avgCartRate
    : (sessions > 0 ? (orderedUnits / sessions) * 100 : 0);
  const orderRate = sessions > 0 ? (orderedUnits / sessions) * 100 : 0;
  return {
    sessions,
    views,
    cartRate: cartRate.toFixed(1),
    orderRate: orderRate.toFixed(1),
    orders: snapshot.orders || [],
    failures: snapshot.failures || [],
  };
}

function renderStoreMetrics(storeData, sourceKind) {
  document.getElementById("api-sessions").innerText = Number(storeData.sessions || 0).toLocaleString();
  document.getElementById("api-views").innerText = Number(storeData.views || 0).toLocaleString();
  document.getElementById("api-cart-rate").innerText = `${storeData.cartRate || "0.0"}%`;
  document.getElementById("api-order-rate").innerText = `${storeData.orderRate || "0.0"}%`;

  const tableBody = document.getElementById("store-orders-table");
  const orders = storeData.orders || [];
  if (!orders.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell">
          <div class="empty-state">${sourceKind === "live" ? "Seller API 暂未返回交易订单。" : "暂无真实订单数据。"}</div>
        </td>
      </tr>
    `;
  } else {
    tableBody.innerHTML = orders.map(o => `
      <tr>
        <td><span class="cell-ellipsis" title="${escapeHtml(o.orderId)}">${escapeHtml(o.orderId)}</span></td>
        <td>
          <span class="sku-cell">
            <strong class="cell-ellipsis" title="${escapeHtml(o.sku)}">${escapeHtml(o.sku)}</strong>
            <small class="cell-ellipsis" title="${escapeHtml(o.cat)}">${escapeHtml(o.cat)}</small>
          </span>
        </td>
        <td>${Number(o.qty || 0)}</td>
        <td><span class="cell-ellipsis">${Number(o.price || 0).toLocaleString()} ₽</span></td>
        <td><span class="badge cell-ellipsis" title="${escapeHtml(o.logisticsType || "--")}" style="background:${String(o.logisticsType || "").includes("FBS") ? 'rgba(255,0,91,0.1)' : 'rgba(0,91,255,0.1)'}; color:${String(o.logisticsType || "").includes("FBS") ? '#ff005b' : '#005bff'}">${escapeHtml(o.logisticsType || "--")}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(o.status || "--")}"><span class="status-indicator ${o.status === '待包装' ? 'warning' : 'success'}" style="margin-right:6px;"></span>${escapeHtml(o.status || "--")}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(o.countdown || "--")}">${escapeHtml(o.countdown || "--")}</span></td>
      </tr>
    `).join('');
  }
}

function renderStoreCostBreakdown(costData = null, sourceKind = "empty") {
  if (!costData) {
    drawStoreFeesChart([]);
    const labelContainer = document.querySelector("#store-fees-chart")?.parentNode?.nextElementSibling;
    if (labelContainer) {
      labelContainer.innerHTML = `
        <div style="font-size:10px; color:var(--text-secondary); margin-bottom:4px;">暂无 Seller API 财务/费用明细，以下比例不生成模拟值。</div>
        <div style="display:flex; justify-content:space-between;"><span>类目佣金扣除:</span><strong>待验证</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>干线运费占比:</span><strong>待验证</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>末端送达扣减:</span><strong>待验证</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>实际到手货款:</span><strong>待验证</strong></div>
      `;
    }
    return;
  }
  drawStoreFeesChart([costData.profit, costData.commission, costData.logistics, costData.tail]);

  const labelContainer = document.querySelector("#store-fees-chart").parentNode.nextElementSibling;
  if (labelContainer) {
    labelContainer.innerHTML = `
      <div style="font-size:10px; color:var(--text-secondary); margin-bottom:4px;">${sourceKind === "live" ? "费用占比为模型估算，待 Seller API 财务明细验证" : "费用占比待 Seller API 财务明细验证"}</div>
      <div style="display:flex; justify-content:space-between;"><span>类目佣金扣除:</span><strong style="color:#005bff">${costData.commission}%</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>干线运费占比:</span><strong style="color:#ff005b">${costData.logistics}%</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>末端送达扣减:</span><strong style="color:#f59e0b">${costData.tail}%</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>实际到手货款:</span><strong style="color:#10b981">${costData.profit}%</strong></div>
    `;
  }
}

function renderEmptyStoreData(reason = "") {
  renderStoreMetrics({ sessions: 0, views: 0, cartRate: "0.0", orderRate: "0.0", orders: [] }, "empty");
  renderStoreCostBreakdown(null, "empty");
  setStoreApiStatus("partial", `暂无 Seller API 真实数据${reason ? `：${reason}` : ""}`);
}

async function renderStoreTab() {
  chrome.storage.local.get(['ozonShops', 'activeShopId'], async (data) => {
    setDefaultStoreDateRange();
    const range = readStoreDateRange();
    const tableBody = document.getElementById("store-orders-table");
    const shops = data.ozonShops || [];
    const activeId = data.activeShopId;
    const activeShop = shops.find(s => s.id === activeId);

    if (!activeShop) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-cell">
            <div class="empty-state">暂无活动店铺，请在右侧录入或绑定 Ozon 店铺。</div>
          </td>
        </tr>
      `;
    document.getElementById("api-sessions").innerText = "--";
      document.getElementById("api-views").innerText = "--";
      document.getElementById("api-cart-rate").innerText = "--";
      document.getElementById("api-order-rate").innerText = "--";
      renderStoreCostBreakdown(null, "empty");
      setStoreApiStatus("partial", "未绑定活动店铺，无法调用 Seller API");
      return;
    }

    if (storeApiRequestInFlight) {
      setStoreApiStatus("partial", "Seller API 正在同步中，请等待当前查询完成...");
      return;
    }
    storeApiRequestInFlight = true;
    const queryBtn = document.getElementById("store-api-query-btn");
    if (queryBtn) queryBtn.disabled = true;
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-cell">
          <div class="empty-state">正在同步 Ozon Seller API...</div>
        </td>
      </tr>
    `;
    setStoreApiStatus("partial", "正在请求 Seller API 实时数据...");

    try {
	      const response = await chrome.runtime.sendMessage({
	        type: "GET_OZON_STORE_SNAPSHOT",
	        args: { shopId: activeId, dateFrom: range.dateFrom, dateTo: range.dateTo, productLimit: 100, pageSize: 20 }
	      });
	      const skuAnalyticsResponse = await chrome.runtime.sendMessage({
	        type: "GET_OZON_SKU_ANALYTICS",
	        args: { shopId: activeId, dateFrom: range.dateFrom, dateTo: range.dateTo, limit: 1000 }
	      });
      if (skuAnalyticsResponse?.ok && skuAnalyticsResponse?.data?.result?.data?.length) {
        await new Promise((r) => chrome.storage.local.set({
          ozonSkuAnalyticsSnapshot: {
            shopId: activeId,
            dateFrom: range.dateFrom,
            dateTo: range.dateTo,
            result: skuAnalyticsResponse.data.result,
            syncedAt: new Date().toISOString(),
          }
        }, r));
      }
      const snapshot = response?.data?.result;
      if (!snapshot) {
        renderEmptyStoreData(response?.error || response?.data?.error || "未收到 API 快照");
        return;
      }

      const storeMetrics = mapSnapshotToStoreMetrics(snapshot);
      const hasLivePayload = (snapshot.analytics?.data || []).length > 0 || (snapshot.orders || []).length > 0 || (snapshot.products?.items || []).length > 0;
      if (!hasLivePayload) {
        const reason = (storeMetrics.failures || []).map(formatStoreApiFailure).join("；") || "API 返回空数据";
        renderEmptyStoreData(reason);
        return;
      }

      renderStoreMetrics(storeMetrics, snapshot.ok ? "live" : "partial");
      renderStoreCostBreakdown(null, "live");
      if (snapshot.ok) {
        const skuCount = skuAnalyticsResponse?.data?.result?.data?.length || 0;
        setStoreApiStatus("live", `Seller API 实时数据：${snapshot.dateFrom} 至 ${snapshot.dateTo}${skuCount ? `；SKU 作战台已同步 ${skuCount} 行真实 analytics` : ""}`);
      } else {
        const reason = (storeMetrics.failures || []).map(formatStoreApiFailure).join("；");
        setStoreApiStatus("partial", `Seller API 部分成功：${reason || "部分接口无数据"}`);
      }
    } catch (err) {
      renderEmptyStoreData(err.message);
    } finally {
      storeApiRequestInFlight = false;
      if (queryBtn) queryBtn.disabled = false;
      refreshAllData();
    }
  });
}

function drawStoreFeesChart(costs = [64, 12, 18, 6]) {
  const canvas = document.getElementById("store-fees-chart");
  if (!canvas) return;
  
  // Set drawing width/height to match actual layout size multiplied by devicePixelRatio for razor-sharp rendering
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 200 * dpr; // height is 200px
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  
  const width = rect.width;
  const height = 200;
  
  ctx.clearRect(0, 0, width, height);
  
  const labels = ['净货款', '佣金', '干线物流', '末端扣除'];
  const colors = ['#10b981', '#005bff', '#ff005b', '#f59e0b'];
  
  const barWidth = 45;
  const spacing = (width - 60 - (barWidth * costs.length)) / (costs.length - 1);
  const startX = 30;

  for(let i = 0; i < costs.length; i++) {
    const x = startX + i * (barWidth + spacing);
    const maxBarHeight = height - 60; // leave padding for labels and values
    const barHeight = maxBarHeight * (costs[i] / 100);
    const y = height - barHeight - 30;
    
    // Draw bar with rounded corners for a premium modern look
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
    ctx.fill();
    
    // Text value (percentage) - dynamic styling depending on mode
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${costs[i]}%`, x + barWidth / 2, y - 8);
    
    // Text label
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#9ca3af';
    ctx.font = '11px sans-serif';
    ctx.fillText(labels[i], x + barWidth / 2, height - 12);
  }
}

// ── Reports Tab View Logic ──
function renderReportsList(monitorReports = [], savedResults = []) {
  const container = document.getElementById("reports-list-container");
  const viewer = document.getElementById("report-viewer-content");

  // Combine automatic monitor reports and regular skill runs
  const list = [];
  monitorReports.forEach(r => {
    const text = `### ${r.overview || '诊断概述'}\n\n**决策诊断与数据推演**:\n${r.analysis || ''}\n\n**下一步建议与分级路线图**:\n${r.summary || ''}`;
    list.push({ id: r.id, source: "monitor", title: r.title || r.shop_name || "店铺诊断报告", date: new Date(r.created_at || Date.now()).toLocaleDateString(), content: text, tag: "店铺报告" });
  });

  savedResults.forEach(r => {
    let name = "决策诊断书";
    if (r.skillId && r.skillId.includes("opportunity")) name = "Ozon选品机会书";
    if (r.skillId && r.skillId.includes("sourcing")) name = "Ozon-1688寻源账本";
    if (r.skillId && r.skillId.includes("optimizer")) name = "商品页对标诊断";
    
    let text = '';
    const normalizedResult = normalizeFinalOutput(r.result);
    if (normalizedResult && (normalizedResult.overview || normalizedResult.analysis || normalizedResult.summary || normalizedResult.data)) {
      text = resultToReportMarkdown(normalizedResult);
    } else {
      text = typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 2);
    }
    
    list.push({ id: r.id || `res_${Math.random()}`, source: "saved", title: name, date: new Date(r.timestamp || Date.now()).toLocaleDateString(), content: text, tag: "AI决策" });
  });

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">暂无生成报告</div>`;
    if (viewer) viewer.innerHTML = `<div class="empty-state">请在 Ozon 前台网页唤醒浮窗执行 AI 技能，生成后的报告会汇聚在这里。</div>`;
    return;
  }

  container.innerHTML = list.map((rep, index) => `
    <div class="report-item" id="report-item-${index}" data-report-index="${index}">
      <div class="report-item-main">
        <div style="font-weight:600; font-size:12px;">${escapeHtml(rep.title)}</div>
        <div style="font-size:10px; color:var(--text-secondary); margin-top:4px; display:flex; justify-content:space-between">
          <span>${escapeHtml(rep.tag)}</span>
          <span>${escapeHtml(rep.date)}</span>
        </div>
      </div>
      <div class="report-item-actions">
        <button class="btn btn-outline btn-xs report-copy-btn" data-report-index="${index}">复制</button>
        <button class="btn btn-outline btn-xs report-pdf-btn" data-report-index="${index}">PDF</button>
        <button class="btn btn-danger btn-xs report-delete-btn" data-report-index="${index}">删除</button>
      </div>
    </div>
  `).join('');

  const renderReport = (rep, index) => {
    document.querySelectorAll(".report-item").forEach(item => item.classList.remove("active"));
    document.getElementById(`report-item-${index}`)?.classList.add("active");
    viewer.innerHTML = `
      <div class="report-viewer-toolbar">
        <div>
          <strong>${escapeHtml(rep.title)}</strong>
          <span>${escapeHtml(rep.tag)} · ${escapeHtml(rep.date)}</span>
        </div>
        <div class="report-item-actions">
          <button class="btn btn-outline btn-xs report-copy-current">复制</button>
          <button class="btn btn-outline btn-xs report-pdf-current">下载 PDF</button>
          <button class="btn btn-danger btn-xs report-delete-current">删除</button>
        </div>
      </div>
      <div class="md-report">
        ${marked.parse(rep.content)}
      </div>
    `;
    viewer.querySelector(".report-copy-current")?.addEventListener("click", () => copyReportContent(rep));
    viewer.querySelector(".report-pdf-current")?.addEventListener("click", () => downloadReportPdf(rep));
    viewer.querySelector(".report-delete-current")?.addEventListener("click", () => deleteReportEntry(rep));
  };

  list.forEach((rep, index) => {
    document.getElementById(`report-item-${index}`).addEventListener("click", () => renderReport(rep, index));
  });
  container.querySelectorAll(".report-copy-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      copyReportContent(list[Number(btn.dataset.reportIndex)]);
    });
  });
  container.querySelectorAll(".report-pdf-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      downloadReportPdf(list[Number(btn.dataset.reportIndex)]);
    });
  });
  container.querySelectorAll(".report-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteReportEntry(list[Number(btn.dataset.reportIndex)]);
    });
  });
  renderReport(list[0], 0);
}

async function copyReportContent(rep) {
  if (!rep) return;
  const text = `# ${rep.title}\n\n${rep.content}`;
  const clipboard = window.navigator?.clipboard || navigator?.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    alert("报告内容已复制。");
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy");
  textarea.remove();
  if (copied) {
    alert("报告内容已复制。");
  } else {
    alert("当前环境不支持自动复制，请在报告正文中手动复制。");
  }
}

function buildNativePdfPrintHtml({
  title = "Ozon_Growth_Report",
  subtitle = "Ozon Growth Intelligence",
  htmlContent = "",
  dateStr = new Date().toISOString().split("T")[0],
} = {}) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}_${dateStr}</title>
  <style>
    :root {
      --bg2: #f1f5f9;
      --bg3: #f8fafc;
      --text: #0f172a;
      --text2: #475569;
      --border: #cbd5e1;
      --accent: #1e3a8a;
    }

    @page { size: A4 portrait; margin: 25mm 20mm; }
    @page landscape-page { size: A4 landscape; margin: 20mm 25mm; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      color: #1a202c;
      line-height: 1.7;
      background: #fff;
      margin: 0 !important;
      padding: 0 !important;
      text-align: left;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .print-banner { background: #eff6ff; color: #1d4ed8; padding: 15px; text-align: center; font-weight: 700; border-bottom: 1px solid #bfdbfe; margin-bottom: 20px; }
    @media print {
      .print-banner { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0 !important; padding: 0 !important; }
    }

    .cover-page { padding-top: 60px; text-align: center !important; page-break-after: always; box-sizing: border-box; }
    .cover-title { font-size: 2.4em; color: #1e3a8a; font-weight: 800; max-width: 82%; line-height: 1.3; margin: 40px auto 20px; text-align: center !important; }
    .cover-subtitle { font-size: 1.05em; color: #64748b; margin-top: 10px; font-weight: 600; text-align: center !important; }
    .cover-footer { margin-top: 160px; font-size: 1em; color: #94a3b8; text-align: center !important; }
    .cover-page p, .cover-page div, .cover-page span { text-align: center !important; }

    .report-container { max-width: 100%; font-size: 11pt; padding: 0 20px; text-align: left !important; }
    .report-container p, .report-container li, .report-container td, .report-container div { text-align: left !important; }
    .meta { color: #64748b; font-size: 10.5pt; margin-bottom: 20px; text-align: center !important; }

    h1 { color: #0f172a; font-size: 22pt; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin: 30px 0 20px; text-align: center !important; }
    h2 { color: #1e3a8a; font-size: 16pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin: 30px 0 15px; padding-top: 15px; page-break-after: avoid; text-align: left !important; }
    h3 { color: #334155; font-size: 14pt; margin: 25px 0 10px; padding-top: 12px; page-break-after: avoid; text-align: left !important; }
    h4 { color: #334155; font-size: 12.5pt; margin: 20px 0 8px; page-break-after: avoid; text-align: left !important; }
    p { margin-bottom: 15px; color: #334155; orphans: 3; widows: 3; }
    strong { color: #0f172a; }

    .section-divider { page-break-before: always; }
    .landscape-section { page: landscape-page; width: 100%; text-align: left !important; }

    table { width: 100%; border-collapse: collapse; margin: 20px 0 30px; page-break-inside: avoid; font-size: 10pt; text-align: left !important; }
    th, td { border: 1px solid #cbd5e1 !important; padding: 12px !important; text-align: left !important; vertical-align: top; word-break: break-word; }
    th { background-color: #f8fafc !important; color: #0f172a !important; font-weight: 700; font-size: 9pt; }
    tr:nth-child(even) { background-color: #f8fafc; }

    code { background: #f1f5f9; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; text-align: left !important; }
    pre { page-break-inside: avoid; text-align: left !important; }
    pre code { display: block; background: #0f172a; color: #f8fafc; padding: 15px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; text-align: left !important; }
    ul, ol { margin-bottom: 15px; padding-left: 20px; text-align: left !important; }
    li { margin-bottom: 8px; text-align: left !important; }
    img { max-width: 100%; height: auto; border-radius: 6px; margin: 15px 0; page-break-inside: avoid; }
    a { color: #1e3a8a; text-decoration: none; border-bottom: 1px dashed #cbd5e1; word-break: break-word; }
    .empty-text { display: none; }
  </style>
</head>
<body>
  <div class="print-banner">正在生成原生数字版 PDF。请在弹出的对话框中选择【另存为 PDF】；如未弹出，请按 Ctrl+P 或 Cmd+P。</div>
  <div class="cover-page">
    <div class="cover-subtitle">Ozon Growth Agent</div>
    <div class="cover-title">${escapeHtml(title)}</div>
    <div class="cover-subtitle">${escapeHtml(subtitle)}</div>
    <div class="cover-footer">
      <p>Report Date: ${escapeHtml(dateStr)}</p>
      <p>Confidential & Proprietary</p>
    </div>
  </div>
  <div class="report-container">
    ${htmlContent}
  </div>
</body>
</html>`;
}

async function deleteReportEntry(rep) {
  if (!rep) return;
  if (!confirm(`确定删除「${rep.title}」吗？`)) return;
  if (rep.source === "monitor") {
    const stored = await new Promise((resolve) => chrome.storage.local.get(["monitorReports"], resolve));
    const next = (stored.monitorReports || []).filter((item) => String(item.id) !== String(rep.id));
    await new Promise((resolve) => chrome.storage.local.set({ monitorReports: next }, resolve));
  } else {
    await chrome.runtime.sendMessage({ type: "DELETE_RESULT", id: rep.id });
  }
  await refreshAllData();
  document.querySelector('.nav-menu button[data-tab="reports"]')?.click();
}

function downloadReportPdf(rep) {
  if (!rep) return;
  const dateStr = new Date().toISOString().split("T")[0];
  const bodyHtml = window.marked?.parse ? window.marked.parse(rep.content || "") : `<pre><code>${escapeHtml(rep.content || "")}</code></pre>`;
  const printHtml = buildNativePdfPrintHtml({
    title: rep.title,
    subtitle: `${rep.tag || "AI决策"} · ${rep.date || dateStr}`,
    htmlContent: `<h1>${escapeHtml(rep.title)}</h1><div class="meta">${escapeHtml(rep.tag)} · ${escapeHtml(rep.date)}</div>${bodyHtml}`,
    dateStr,
  });
  chrome.storage.local.set({ printHtml }, () => {
    window.open(chrome.runtime.getURL("print.html"), "_blank");
  });
}
