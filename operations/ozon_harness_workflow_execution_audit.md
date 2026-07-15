# Ozon Harness Workflow Execution Audit

> 结论日期：2026-07-15  
> 目标：审计 Ozon 插件中“任务 workflow 在 harness 指挥下生成”与“实际底层代码执行链”是否一致、可靠、可恢复、可审计。  
> 参考对象：Etsy growth-agent 最新 harness 诊断结论。

## 总体结论

当前 Ozon 插件的 workflow 链路已经从“LLM 直接回答”升级为带独立调度层的执行架构：

```text
sidepanel / content / dashboard
  -> background RUN_SKILL harness
  -> research_scope + skill routing + WorkflowSpec
  -> modules/workflowEngine.js 全局队列 / 状态机 / 单并发调度
  -> checkpoint + workflow lease
  -> runAgentLoop 编排 LLM / tool_call / Critic / validators
  -> toolRegistry 执行真实浏览器动作、等待、采集、截图、关页
  -> evidence_bundle / savedResults / growthCases / taskLogs / checkpoint
```

这条链路总体是合理的，且与 Etsy 的工业级雏形基本对齐。它不是把用户指令直接交给模型，而是把任务放进带全局调度、断点、租约、工具白名单、证据门禁、标签页归属、超时回收、迟到结果丢弃、报告校验和日志记录的运行框架里。

本轮已经补上第一版 `WorkflowEngine`，核心任务会进入 `queued / running / interrupted / completed / failed / cancelled` 状态机，并默认单并发串行执行。当前剩余风险从“没有全局调度器”收敛为：统一工具上下文还不完整、真实取消传播仍依赖工具主动检查、UI 状态还没有完全从 engine 订阅。

## 当前执行链路

### 1. 入口层

入口包括：

- 右侧浮层业务按钮
- 侧边栏任务对话
- 后台画布与系统任务入口

这些入口最终会把业务意图提交给 `background.js` 的 `RUN_SKILL`。入口层的职责应该只负责选择任务、传递上下文、显示状态；不应该自己决定底层流程是否完成。

当前状态：基本合理，但 UI 仍有少量本地状态，后续应继续减少入口层对运行态的判断。

### 2. Harness 指挥层

`background.js` 仍是 Ozon 的 harness 指挥层，但不再亲自承担所有调度职责。它的核心职责包括：

- 读取当前页 DOM 与页面上下文
- 捕获来源页截图
- 自动匹配 Ozon skill
- 构建 `research_scope`
- 生成 workflow checkpoint key
- 生成可交给 engine 的 workflow spec
- 把执行函数提交给 `workflowEngine.submit()`

合理点：

- Harness 不再直接让多个入口同时推进底层工具链；核心执行段已交给全局 engine 串行调度。
- `WorkflowSpec` 携带 `workflowId`、`actionKind`、来源页面、skill、增长案件等元数据。
- `forceNewSession` 可以避免“用户选择新会话但实际恢复旧会话”的问题。
- 断点会携带 `research_scope`、skill、页面、工具历史和报告上下文。
- 成功结果会写入 `savedResults`，并同步生成 `evidence_bundle` 和 `growthCases`。

风险点：

- Harness 预处理阶段仍会读取当前页和截图；真正的工具执行已进入 engine，但预处理还不是完全纯 spec 构建。
- UI 与 background/engine 之间还不是严格的状态订阅模型。

### 3. Workflow Engine 调度层

`modules/workflowEngine.js` 是本轮新增的全局调度层，职责包括：

- 接收 harness 生成的 workflow spec
- 维护 `queued / running / cancellation_requested / interrupted / completed / failed / cancelled`
- 默认 `maxConcurrent = 1`，防止多个业务任务同时开页、搜索、采集和调用 AI
- 对 queued job 支持取消
- 对 running job 通过 `requestWorkflowCancellation()` 触发 runtime cancellation
- 将 engine 状态写入 workflow snapshot、workflow events 和 task logs
- 通过 `GET_WORKFLOW_ENGINE_STATE` 暴露运行态给 UI 后续订阅

合理点：

- 多入口并发风险从“入口自己挡”升级为“全局调度器挡”。
- queued job 不会进入底层工具链。
- running job 的取消会进入 runtime，agentLoop 在 step 边界和 generation 检查中感知。
- 每个 engine job 都有 `jobId`、`workflowId`、`actionKind`、`queuedAt`、`startedAt`、`completedAt/failedAt`。

风险点：

- 当前还是内存队列 + runtime snapshot 的轻量 engine；Service Worker 被系统回收时，已经 running 的底层执行仍依赖 checkpoint 恢复，而不是自动后台续跑。
- 目前默认单并发更稳，但没有优先级队列、资源配额或多队列 lanes。
- UI 尚未完整消费 `GET_WORKFLOW_ENGINE_STATE`。

### 4. Agent Loop 编排层

`modules/agentLoop.js` 是任务编排层，职责包括：

- 构造系统提示和页面上下文
- 注入浏览器自动化能力契约
- 维护 messages、`toolHistory` 和轻量 tool-run ledger
- 从断点恢复历史消息和工具证据
- 解析 LLM 输出的 `tool_call` / `final`
- 对工具调用做业务 guard
- 执行工具超时控制
- 处理 stale generation 迟到结果
- 执行 Critic 与报告校验
- 形成可进入画布的 `workflow_nodes`

合理点：

- Ozon 业务报告必须输出 `workflow_nodes`，这让报告可以继续进入增长画布，而不是停留在一次性文档。
- 趋势报告会校验 Google Trends、Google Search、Ozon 竞品详情、Yandex 证据来源，防止报告把未取证信息写成结论。
- 店铺体检有深度校验，要求店铺页、竞品页、截图分析、`competitor_benchmarks` 和 `diagnostic_depth_matrix`。
- 寻源流程有视觉路径 guard：一旦进入以图搜图，不能被 Critic 打回后随意退回关键词搜索。
- 工具运行后会检查 workflow generation，旧 workflow 的迟到结果会被丢弃。
- 每次工具调用都会生成 `toolRunId`，并记录 `startedAt / completedAt / durationMs / status / actionKind / actionLabel`，为后续 execution ledger UI 打基础。

风险点：

- 工具超时是外层 `Promise.race` 级别，不是真正杀掉底层 Chrome API 操作。
- `ToolExecutionContext` 已有雏形字段，但还不是一个统一对象；目前通过 `workflowId`、`workflowGeneration`、`__sourceTabId`、`__progress`、`__toolRunId` 等运行时参数拼装。
- `toolHistory` 已带 tool-run 元数据，但还不是完整的节点级 execution ledger UI。

### 5. Tool Registry 底层动作层

`modules/toolRegistry.js` 是实际执行层，覆盖：

- 地址打开
- 搜索引擎检索
- Google Trends / Google / Yandex / Ozon / 1688 / Taobao 页面访问
- 键盘输入
- 筛选
- 翻页
- DOM 采集
- 多模态截图
- 商品卡片抽取
- 详情页读取
- 临时 tab 关闭

合理点：

- 多个高风险工具已统一使用 `waitForPageCaptureReady()` 等待页面稳定，而不是立即读空 DOM。
- 临时 tab 通过 `browserSessionManager` 建立归属关系。
- 趋势任务会保留 Ozon 页面，避免把来源页面或关键 Ozon 取证页误关。
- `agentic_web_search`、`input_text_and_search`、`image_search_in_browser` 等关键搜索工具已经接入 readiness 等待。
- 监控 alarm 也使用 owned tab + readiness + close，避免隐式开页残留。

风险点：

- 部分工具仍保留 legacy callback 风格。
- 并非所有工具内部都主动检查 cancellation。
- 真实站点的验证码、登录墙、反爬页面仍只能通过 evidence_quality / blocking 反馈，不应被报告当成成功证据。

### 6. Runtime / 日志 / 证据层

`modules/workflowRuntime.js` 当前提供：

- workflow snapshot
- workflow events
- workflow lease
- cancellation request
- generation check
- task logs
- log prune

当前新增/强化的可靠性底座包括：

- `modules/storageKeys.js`：本地存储 key 注册表。
- `modules/storageLocal.js`：`chrome.storage.local` 可靠包装，支持 key 校验、lastError、超时、重试和安全 fallback。
- `modules/workflowEngine.js`：全局 job queue、状态机、单并发调度、取消入口和 engine 状态查询。
- `taskLogs`：可记录 workflow、tool、checkpoint、report 等运行事件，并定期清理。
- `evidence_bundle`：保存工具链、截图、页面证据、研究范围和证据质量，便于复盘。

合理点：

- 任务失败、暂停、断线、完成都有日志。
- saved report 不再只有最终文本，也能导出证据包。
- storage hot path 开始从裸 `chrome.storage.local` 向可靠包装层迁移。

风险点：

- task logs 与 toolHistory 已具备 toolRunId 生命周期基础，但 UI 还没有完整按 ledger 渲染。
- 目前 `background.js` 热路径已迁移，UI 和部分工具模块仍有直接 storage 调用。
- IndexedDB 事件可追踪，但产品 UI 中还没有完整展示“每个工具运行节点”的时间轴。

## 与 Etsy 诊断的横向对比

| 维度 | Etsy 当前判断 | Ozon 当前判断 |
| --- | --- | --- |
| Harness 指挥层 | 合理，已具工业级雏形 | 基本对齐，并已加入 Ozon research_scope / growthCases / evidence_bundle |
| 断点续跑 | 有 checkpoint、lease、generation | 已具备 checkpoint、lease、generation、取消请求 |
| 新会话/历史会话 | 已修复历史误恢复风险 | 已支持 `forceNewSession`，仍需继续观察 UI 入口一致性 |
| 标签页生命周期 | 源 tab 保护、临时 tab 清理 | 已强化趋势任务不误关 Ozon 页，临时页 owned cleanup |
| Google Trends | 证据门禁和 auto repair | 已有趋势上下文、证据校验、browser capability 契约 |
| 工具等待 | readiness/stable read | 已复用 `waitForPageCaptureReady()`，但仍需覆盖所有工具 |
| 日志 | 有运行日志方向 | Ozon 已新增 taskLogs，但还不是完整 ledger |
| 全局调度器 | 尚未完全工业级 | 已新增 `workflowEngine.js` 轻量全局调度器，后续升级优先级/多队列/状态订阅 |

## 评分

以“业务 workflow 是否由 harness 合理生成并落到真实执行链”为标准：

- 当前 Ozon：约 84-88 分。
- 已不是 prompt-first 的传统插件。
- 已具备独立 workflow engine 的第一版关键骨架。
- 还未达到完整后端式 workflow engine。

扣分主要来自：

- 无统一 `ToolExecutionContext`
- 无强 cancel token 贯穿所有工具
- 无可视化结构化 tool-run ledger
- UI 状态还未完全由 background runtime 派生

## 下一步收口优先级

### P0：保持快速可靠

- 暂不收窄 `<all_urls>`，优先保障 Ozon、Google、Yandex、Google Trends、1688、Taobao 等跨站取证链路稳定。
- 所有新工具必须接入页面 readiness、证据质量和 owned tab 清理。
- 所有报告必须可追溯到 `evidence_bundle`。

### P1：继续收敛 ToolExecutionContext

当前已落地 `toolRunId`，下一步继续把运行参数收敛成统一上下文：

```text
toolRunId
workflowId
workflowGeneration
sourceTabId
skillId
startedAt
progress()
isCancelled()
logger()
```

再逐步把工具从零散 runtime 参数迁移到 context。

### P2：Execution Ledger UI

把当前已经记录的 `toolRunId + toolHistory + taskLogs` 渲染为结构化 ledger：

```text
planned -> started -> tab_opened -> dom_ready -> screenshot_saved
-> evidence_validated -> tab_closed -> completed / failed / timed_out
```

这样用户和开发者都能看清楚：任务到底卡在哪里，是页面没加载、验证码、DOM 不足、截图失败，还是报告校验失败。

### P3：Workflow Engine 第二阶段

在现有 `WorkflowEngine` 上继续补：

- 优先级队列
- job lane：趋势/店铺体检/监控/寻源分 lane
- 最大运行时限
- 可恢复 job 的自动重入策略
- engine state 到 UI 的订阅式推送

### P4：UI 状态同源

侧边栏、浮层、后台画布都只订阅 background runtime：

- 是否运行中
- 当前工具
- 当前 tab
- 当前证据质量
- 是否可恢复
- 是否需要人工确认
- 最近一次失败点

入口层不再自行猜测任务状态。

## 当前验证结果

本轮验证已经覆盖：

- `node --check background.js`
- `node --check modules/workflowRuntime.js`
- `node --check modules/storageLocal.js`
- `node --check scripts/storage-local-smoke.mjs`
- `npm run test:storage-local`
- `npm run test:workflow-engine`
- `npm run test:storage-schema`
- `npm run test:business`
- `npm run test:workflow`
- `npm run test:browser-capabilities`
- `npm run test:sourcing`
- `npm run test:trend-context`
- `npm run test:evidence-bundle`
- `npm run test:store-diagnosis`
- `npm run test:etsy-parity`
- `npm run test:update`
- `npm run test:security`
- `npm run lint`
- `node scripts/qa-validator.mjs`
- `npm run test:real-browser-matrix`
- `git diff --check`

结论：当前代码状态通过静态、业务、workflow engine、workflow runtime、浏览器能力、证据包、安全、Etsy 对齐和真实浏览器矩阵 smoke。下一步可以在此基础上继续推进统一 `ToolExecutionContext`、execution ledger UI 和 engine state UI 订阅，而不是再回到 prompt 层面修补。
