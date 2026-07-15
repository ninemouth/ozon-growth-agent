# Ozon 增长插件产品级升级与底层 Skill Runtime 审计

日期：2026-07-14

## 1. 审计结论

当前插件已经不是“只有提示词的 AI 插件”，底层已经具备工业化浏览器执行骨架：

- 地址打开与搜索页跳转
- 模拟键盘输入与站内搜索
- 点击筛选、排序、翻页入口
- DOM 采集与多 frame fallback
- Chrome debugger full-page screenshot 与 viewport fallback
- 图片搜索上传、结果页读取和图搜防循环
- workflow-owned tab 生命周期管理
- source Ozon tab 保护
- workflow checkpoint、lease、取消、恢复和超时清理
- Seller API 缓存、报告保存、growthCases 回写

但从产品级角度，仍有一个关键问题：**业务 skill 的能力描述、运行时工具能力和前端产品入口之间还缺一层统一能力契约**。如果没有这层契约，模型可能知道工具名，但不清楚哪些环节可以自动完成、哪些只能阻断、哪些必须人工确认。

本轮已新增 `Browser Automation Capability Contract`，把底层能力显式化，并注入 agent prompt 与 smoke 测试。

## 2. 已新增能力契约

文件：

- `modules/browserAutomationCapabilities.js`
- `scripts/browser-capability-contract-smoke.mjs`

能力域：

| 能力域 | 运行时工具 | 当前结论 |
|---|---|---|
| 地址打开与页面跳转 | `open_url`, `open_new_tab`, `navigate_to`, `search_in_browser` | 已具备稳定等待和 owned tab 管理，本轮把 `open_url` 纳入 workflow-owned tab |
| 模拟键盘输入与站内搜索 | `input_text_and_search` | 已具备逐字输入、input/change/keyup、按钮/Enter 兜底和结果页轮询 |
| 筛选、排序与翻页 | `click_by_text`, `click_by_coordinate`, `scroll_page`, `read_current_page` | 中等健壮；可完成常见筛选/排序，但尚无专用 semantic pagination tool |
| DOM 采集、清洗与压缩 | `read_current_page`, `collect_ozon_shop_pages`, `collect_ozon_competitor_shops` | 强；content script + scripting fallback + pageEvidence |
| 多模态截图与视觉识别 | `collect_ozon_shop_pages`, `analyze_ozon_shop_crawl_screenshots`, `image_search_in_browser` | 中高；支持 full-page/viewport fallback，但视觉不得替代 DOM 文本 |
| 网页关闭与生命周期保护 | `close_tab`, `search_in_browser`, `open_new_tab` | 强；本轮把 `close_tab` 改为走 `closeOwnedTab` |
| Seller API 与本地档案 | `ozon_api_*`, `save_result`, `get_saved_results` | 中高；需要继续补利润/履约/库存字段 |

## 3. 业务 Skill 能力体检

| Skill | 底层能力依赖 | 当前健壮性 | 产品级缺口 |
|---|---|---|---|
| `ozon_global_shop_optimizer` | Ozon DOM、截图、竞品页打开、站内搜索、截图分析、tab 关闭 | 强 | 需要把利润、FBO/FBS、广告就绪、库存风险纳入店铺体检 P0 |
| `ozon_platform_trends` | Google Trends、Yandex/Google RU、Ozon 搜索、source tab 保护 | 中高 | Google Trends 仍受页面动态加载影响，需要真机长期样本 |
| `ozon_sourcing_finder` | 1688/淘宝图搜、文本兜底、详情页穿透、筛选点击、tab 管理 | 中高 | 筛选/翻页仍依赖通用点击，建议新增 semantic filter/pagination tool |
| `ozon_product_opportunity_explorer` | 趋势、Ozon 搜索、竞品、合规、寻源 | 中 | 需要和趋势 skill 去重，并加入利润/履约/库存四道门 |
| `ozon_listing_generator` | DOM 文本、截图视觉、合规审计、人工确认 | 中高 | 需要接 Ozon 属性字段真实映射与禁用词库 |
| `ozon_review_analyzer` | 评论 DOM、分页/滚动、截图、缺陷任务化 | 中 | 评论分页和图片评论需要真机验证，建议新增评论分页采集工具 |
| `ozon_compliance_auditor` | 官方搜索、页面证据、人工补证 | 中 | 官方政策/认证源质量需要白名单或来源分级 |
| `ozon_operations_tracker` | Seller API、历史快照、人工确认、观察窗口 | 中高 | 需要把人工执行记录和 API 指标更强绑定 |

## 4. 本轮产品级改造

### 4.1 能力契约进入运行时

`agentLoop` prompt 新增“浏览器自动化能力契约”，要求模型：

- 地址打开、键盘输入、筛选翻页、DOM 采集、截图、关页都必须通过工具完成。
- 页面动态加载时必须尊重 `loadState`、`evidenceOk`、`pageEvidence`。
- 证据不足时输出 `blocking_gaps`，不得伪造成已完成。
- 截图用于视觉和布局；标题、参数、价格、评论必须优先 DOM/API。

### 4.2 `open_url` 生命周期升级

旧状态：

- `open_url` 直接 `chrome.tabs.create`
- 不登记 workflow-owned tab
- 不等待页面稳定

新状态：

- 使用 `createBrowserTab`
- 绑定 `workflowId`
- 等待页面最小加载与稳定读取
- 返回 `tabId`、`pageData`、`evidenceOk`、`loadState`

### 4.3 `close_tab` 生命周期升级

旧状态：

- 直接 `chrome.tabs.remove`

新状态：

- 使用 `closeOwnedTab(workflowId, tabId)`
- 继续保护 source tab
- 继续保护趋势任务中的 Ozon 页面

## 5. 仍需补强的底层能力

### P0：Semantic Filter / Pagination Tool（基础版已完成）

本轮已新增基础版语义工具：

- `apply_page_filter`
- `go_next_page`

它们会在动作前后读取页面证据并返回：

```text
apply_page_filter({
  tabId,
  filterType: "price|rating|delivery|seller|sort|pagination",
  label,
  value,
  expectedChange: "url|productCards|visibleText"
})

go_next_page({
  tabId,
  strategy: "text|aria|coordinate|url",
  maxAttempts,
  requireProductCardChange
})
```

已完成验收：

- 能判断点击前后商品卡片是否变化。
- 能返回 filterEvidence，而不是只说 clicked。
- 翻页返回 paginationEvidence。
- 找不到筛选/下一页时返回 blockingGap。

后续仍需增强：

- Ozon/1688/淘宝各自的筛选控件语义映射基础版已加入 content script，会按站点补充排序、价格、评分、履约、供应商候选词，并返回 `candidateTexts` 供调试；仍需真实页面样本继续扩展。
- 组合筛选的多步骤计划。
- 虚拟列表不刷新 DOM 时的截图差异判断；基础版已通过商品标题/价格/链接/图片指纹识别“数量不变但内容变化”。
- 评论分页和低星评论筛选已有 `collect_reviews` 基础工具，但仍需真实 Ozon 评论页验证。

### P0：Review Collection Tool（基础版已完成）

本轮已新增：

```text
collect_reviews({
  tabId,
  ratingFilter: "1|2|3|all",
  maxPages,
  maxItems,
  includeImages
})
```

能力：

- 从当前 DOM 抽取可见评论文本、评分和评论图片。
- 尝试点击 1-3 星低星筛选。
- 支持少量分页采集。
- 返回 `blockingGaps`，明确评论区未展开、低星筛选失败或分页受阻。

后续仍需增强：

- Ozon 评论区真实选择器和低星筛选控件样本库。
- 评论图片大图打开与截图证据。
- 按“最新/有图/低星”组合筛选。
- 评论虚拟列表滚动加载识别。

### P0：Report Evidence Bundle（基础版已完成）

每次 workflow 完成后，自动组织：

- toolHistory
- pageEvidence
- screenshotRefs
- sellerApiSnapshot
- research_scope
- evidence_quality
- final report

这会支撑产品级导出和开源可信度。

本轮已新增：

- `modules/evidenceBundle.js`
- `scripts/evidence-bundle-smoke.mjs`
- `npm run test:evidence-bundle`

保存到 `savedResults` 的每份报告现在会包含 `evidence_bundle`：

- `toolTimeline`：压缩后的工具调用轨迹、参数和结果摘要。
- `screenshotRefs`：递归收集的截图 artifact 引用。
- `pageEvidence`：初始页面、打开页面、采集页面的页面证据摘要。
- `research_scope`：本轮业务上下文和店铺/页面范围。
- `evidence_quality`：证据等级、来源类型、阻断缺口、Seller API 新鲜度。
- `reportSummary`：报告状态、数据项数量、任务数量、阻断缺口数量。

仍需增强：

- 报告中心一键下载证据包 JSON 已完成，并新增 `EXPORT_EVIDENCE_BUNDLE` 后台端点。
- 报告中心已新增 `校验证据`、`下载证据包` 和 `下载 ZIP`；ZIP 会包含 `evidence_bundle.json` 与可读取的截图 artifact 文件。
- PDF 导出时已把 evidence bundle 摘要附到报告末尾，正文仍保持业务报告阅读体验。
- 证据包导出时会生成 `artifact_manifest`，逐个检查截图 artifact 是否仍可读取；本地 `savedResults` 只回写 manifest，不回写大体积 base64 payload。
- 对真实 Ozon/1688/淘宝/Google Trends 运行样本进行人工回放验收：已新增 `npm run test:real-browser-matrix` 生成验收矩阵，等待真机执行结果回填。

### P0：Real Browser Acceptance Matrix（矩阵已生成）

新增：

- `scripts/real-browser-acceptance-matrix.mjs`
- `operations/acceptance/real_browser_acceptance_matrix.md`
- `operations/acceptance/real_browser_acceptance_matrix.json`
- `npm run test:real-browser-matrix`

覆盖 6 条真实业务流：

1. Ozon 店铺体检
2. 平台趋势 / Google Trends
3. Ozon 商品诊断 / 评论采集
4. 供应商货源 / 1688 图搜
5. 供应商货源 / 淘宝兜底
6. 报告中心 / 证据归档

该矩阵不把静态测试伪装成真实验收；它用于真机 Chrome 环境逐项记录通过、阻断和证据留存状态。

### P1：评论分页与低星筛选工具

用于 `ozon_review_analyzer`：

```text
collect_reviews({
  tabId,
  ratingFilter: "1|2|3|all",
  maxPages,
  includeImages
})
```

### P1：广告就绪与履约利润工具

用于吸收运营文章方法论：

```text
compute_fulfillment_profit_matrix()
compute_ad_readiness_score()
compute_inventory_risk_radar()
```

### P1：真实浏览器验收脚本

当前 smoke 多为静态契约，下一步需要真机验收记录：

- Ozon 店铺页：店铺体检
- Ozon 搜索页：趋势/竞品
- Ozon 商品页：商品诊断/货源
- 1688/淘宝：图搜、筛选、翻页、详情页
- Google Trends：稳定等待、截图、关闭站外 tab

## 6. 产品级升级路线

本轮之后的产品主线应调整为：

```text
Browser Capability Contract
  -> Business Skill Contract
  -> Growth Ledger
  -> Growth Cases
  -> Evidence Bundle
  -> Report Center / Archive
  -> Real Browser Business QA
```

判断标准也要升级：

- 不是“AI 能不能回答”
- 而是“每个经营结论是否有数据源、页面证据、截图证据、API 证据、阻断缺口和人工确认节点”

## 7. 验收

新增：

```text
npm run test:browser-capabilities
```

建议把它加入未来完整回归矩阵：

```text
npm run test:browser-capabilities
npm run test:skills
npm run test:sourcing
npm run test:store-diagnosis
npm run test:trend-context
npm run test:business
npm run test:workflow
npm run test:etsy-parity
npm run lint
node scripts/qa-validator.mjs
```
