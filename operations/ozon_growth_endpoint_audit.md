# Ozon Growth OS 功能与业务端点审计

## 结论

当前后台已经具备 Seller API、技能运行、监控任务、报告库和本地实验状态等基础能力。dashboard 画布动作已从“只写业务意图队列”升级为增长案件运行状态机：创建 `growthCases`，发起 `RUN_SKILL`，写入运行状态，成功后关联报告，失败时记录原因并降级到前台页面继续执行。

产品方向应收敛为：

- 首页只做增长工作流画布。
- 左侧只保留系统级入口：增长工作流、API 数据、报告中心、系统任务。
- 系统设置不进入左侧菜单，统一放在右下悬浮设置抽屉。
- 商品体检、竞品跟踪、平台趋势、扩品、供应商货源、利润线、实验、复盘都进入画布案件，而不是继续作为一级菜单；报告中心保留为跨案件归档入口，负责复制、删除、PDF 下载和历史追溯。

## 真实端点

| 能力 | 当前端点 | 数据落点 | 现状 |
| --- | --- | --- | --- |
| 店铺经营快照 | `GET_OZON_STORE_SNAPSHOT` | `ozonStoreSnapshotCache` | 真实调用 Ozon Seller API，并缓存本地 |
| SKU analytics | `GET_OZON_SKU_ANALYTICS` | `ozonSkuAnalyticsSnapshot` | 真实调用 Ozon Seller API，并作为全量轻体检输入 |
| AI 技能运行 | `RUN_SKILL` | `savedResults` / `growthActionRuns` / `growthCases` | background/sidepanel/content 可真实运行；dashboard 画布动作已通过 port 接入，并可记录运行状态 |
| 监控任务 | `monitorTasks` + `chrome.alarms` | `monitorTasks` / `monitorChangeEvents` / `monitorReports` | 可添加、删除、定时触发，属于系统任务能力 |
| 报告库 | `GET_SAVED_RESULTS` / `DELETE_RESULT` / `EXPORT_RESULTS` | `savedResults` | 本地真实报告数据 |

## 本地真实状态

| 能力 | 存储 | 说明 |
| --- | --- | --- |
| 增长实验 | `growthExperiments` | 可创建、推进、观察、复盘；真实效果仍需 Seller API 时间窗对比 |
| 工作流任务状态 | `growthWorkflowTaskState` | 可记录“已执行/观察/已复盘”等人工确认状态 |
| 增长案件 | `growthCases` | 统一承载案件类型、任务、报告、运行历史和状态 |
| 增长动作运行 | `growthActionRuns` | 已升级为可观察运行记录：`queued/running/completed/failed/needs_frontend_context` |

## 虚拟或半虚拟按钮

这些按钮目前调用 `dashboard.js::handleGrowthAction()`，主要行为是创建/更新 `growthCases` 与 `growthActionRuns`，并通过 `chrome.runtime.connect({ name: "ozon-agent-loop" })` 发起真实 `RUN_SKILL`：

- 店铺体检
- SKU 漏斗诊断
- 商品页改版
- 首图诊断
- 竞品扫描
- 利润线测算
- 履约风险扫描
- Ozon 平台商品机会/趋势
- 扩品机会发现
- 供应商货源筛选
- 实验复盘

它们不再只是虚拟按钮。需要注意：如果 dashboard 当前没有可注入的 Ozon 前台页面上下文，运行会进入 `needs_frontend_context`，提示用户打开对应 Ozon 页面后由右侧浮窗继续承接。

## 应并入画布的业务流

| 原入口 | 新归属 |
| --- | --- |
| 全量 SKU 体检 | 店铺体检案件 / SKU 风险任务 |
| 机会与扩品雷达 | 机会扩品案件 |
| Ozon 平台商品机会/趋势 | 平台趋势案件 |
| 供应商货源筛选 | 供应商货源案件 |
| 执行确认与复盘 | Scrum 状态列 / 实验复盘案件 |
| 供应链利润线 | 利润保护任务 / 扩品案件证据 |
| 阶段追踪与对比 | 案件复盘证据 |
| 竞品感知事件流 | 竞品跟踪案件证据 |
| AI 决策书档案 | 案件 PIP 报告/证据阅读 + 报告中心统一归档 |

## 下一步应补的真实端点

1. 让 Seller API 刷新可以按案件需要拉取窗口数据，例如“实验前 7 天 vs 实验后 7 天”。
2. 让监控事件进入对应竞品案件，而不是只进入系统任务表。
3. 把 `growthCases` 从 dashboard 内部结构沉淀为更稳定的数据合同：`caseId / type / evidence / tasks / experiments / reports / status / nextReviewAt / runHistory`。
4. 增加更多业务流测试：竞品跟踪、商品页转化、平台趋势、扩品机会、供应商货源、实验复盘和前台上下文失败降级。
