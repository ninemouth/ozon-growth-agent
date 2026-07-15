/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// Browser automation capability contract for product-level workflow design.
// Keep this manifest conservative: it describes what the runtime can reliably
// attempt, where it degrades, and which tool names should be used.

export const BROWSER_AUTOMATION_CAPABILITIES = [
  {
    id: "address_navigation",
    label: "地址打开与页面跳转",
    tools: ["open_url", "open_new_tab", "navigate_to", "search_in_browser"],
    robustness: "strong",
    guarantees: [
      "新开标签页会进入 workflow-owned tab 管理",
      "会等待页面加载与 DOM 证据稳定后返回",
      "会保护来源 Ozon tab，避免业务中断",
    ],
    limitations: [
      "验证码、登录墙、浏览器系统页会返回阻断状态",
      "站点强跳转时只能返回最终 URL 与证据状态",
    ],
  },
  {
    id: "keyboard_input_search",
    label: "模拟键盘输入与站内搜索",
    tools: ["input_text_and_search"],
    robustness: "medium_high",
    guarantees: [
      "会模拟清空、逐字输入、input/change/keyup 事件",
      "会优先点击可见搜索按钮，找不到按钮时回退 Enter",
      "会轮询结果页，直到商品卡片、商品链接或超时状态出现",
    ],
    limitations: [
      "自定义 Shadow DOM 输入框、强登录态或验证码可能需要人工介入",
      "筛选条件复杂时应配合 click_by_text 或 click_by_coordinate",
    ],
  },
  {
    id: "filter_sort_pagination",
    label: "筛选、排序与翻页",
    tools: ["apply_page_filter", "go_next_page", "click_by_text", "click_by_coordinate", "scroll_page", "read_current_page"],
    robustness: "medium_high",
    guarantees: [
      "语义筛选/翻页会读取点击前后页面签名并返回变化证据",
      "支持按可见文字点击筛选/排序项",
      "支持坐标点击，并主动屏蔽文件上传/相机上传危险区域",
      "支持滚动后重新读取 DOM、商品卡片和截图证据",
    ],
    limitations: [
      "复杂组合筛选仍可能需要人工确认或多次点击",
      "平台虚拟列表不刷新 DOM 时，必须结合截图或人工确认",
    ],
  },
  {
    id: "dom_collection_cleaning",
    label: "DOM 采集、清洗与压缩",
    tools: ["read_current_page", "collect_ozon_shop_pages", "collect_ozon_competitor_shops"],
    robustness: "strong",
    guarantees: [
      "优先读取 content script 结构化结果",
      "content script 薄弱时回退 scripting.executeScript 多 frame DOM snapshot",
      "返回页面健康状态、商品卡片、商品链接、图片、可见文本摘要和 pageEvidence",
    ],
    limitations: [
      "DOM 文本只能代表当前可访问页面，不代表后台真实销量或全量库存",
      "虚拟列表或懒加载页面需要滚动/翻页后多次采集",
    ],
  },
  {
    id: "multimodal_screenshot",
    label: "多模态截图与视觉识别",
    tools: ["collect_ozon_shop_pages", "analyze_ozon_shop_crawl_screenshots", "image_search_in_browser", "click_by_coordinate"],
    robustness: "medium_high",
    guarantees: [
      "优先使用 Chrome debugger full-page screenshot，失败回退 visible viewport",
      "竞品截图会进入 artifactStore，并可被视觉模型阶段化解读",
      "图片搜索会优先走站内图搜，必要时使用 DOM 候选按钮提交",
    ],
    limitations: [
      "截图视觉不得替代 DOM 文本审计",
      "Google Trends/1688/淘宝动态模块需要等待稳定或降级为阻断",
    ],
  },
  {
    id: "review_collection",
    label: "评论分页与低星样本采集",
    tools: ["collect_reviews", "apply_page_filter", "go_next_page", "read_current_page"],
    robustness: "medium",
    guarantees: [
      "支持从当前 DOM 抽取可见评论文本、评分和评论图片",
      "支持尝试低星筛选和少量分页采集",
      "返回 blockingGaps，说明评论区、低星筛选或分页是否受阻",
    ],
    limitations: [
      "Ozon 评论区虚拟加载、登录墙、折叠区可能需要人工展开",
      "评论样本代表本轮可见 DOM，不代表全量评论分布",
    ],
  },
  {
    id: "tab_lifecycle",
    label: "网页关闭与生命周期保护",
    tools: ["close_tab", "search_in_browser", "open_new_tab", "collect_ozon_shop_pages"],
    robustness: "strong",
    guarantees: [
      "workflow 创建的标签页会登记为 owned tab",
      "来源 Ozon tab 和趋势任务中的 Ozon 页面会被保护",
      "工具超时会清理本轮新增的站外临时页，但不取消 workflow",
    ],
    limitations: [
      "用户手动关闭来源页时只能保存断点并提示恢复",
      "未由 workflow 创建的旧标签页只在明确 tabId 且非保护页时关闭",
    ],
  },
  {
    id: "seller_api_and_archive",
    label: "Seller API 与本地档案",
    tools: ["ozon_api_store_snapshot", "ozon_api_sku_analytics", "get_saved_results", "save_result"],
    robustness: "medium_high",
    guarantees: [
      "Seller API 调用有本地缓存和数据新鲜度",
      "AI 报告会写入 savedResults 与 growthCases",
      "workflow checkpoint 会保留断点、工具历史与研究范围",
    ],
    limitations: [
      "缺少 API 授权或字段不足时必须进入 blocking_gaps",
      "利润/履约/库存需要额外成本和库存字段才能工业级归因",
    ],
  },
];

export function summarizeBrowserAutomationCapabilities() {
  return BROWSER_AUTOMATION_CAPABILITIES.map((item) => ({
    id: item.id,
    label: item.label,
    tools: item.tools,
    robustness: item.robustness,
    guarantees: item.guarantees,
    limitations: item.limitations,
  }));
}

export function formatBrowserAutomationCapabilityPrompt() {
  return BROWSER_AUTOMATION_CAPABILITIES.map((item) => (
    `- ${item.label} (${item.robustness}): tools=${item.tools.join(", ")}; ` +
    `guarantees=${item.guarantees.join(" / ")}; limitations=${item.limitations.join(" / ")}`
  )).join("\n");
}
