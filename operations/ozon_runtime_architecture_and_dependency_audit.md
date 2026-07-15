# Ozon 增长插件底层运行时与第三方能力审计

日期：2026-07-15

## 1. 结论

当前 Ozon 增长插件已经具备工业化运行时骨架：业务 skill 通过 `background.js` 生成 workflow spec，核心任务进入 `modules/workflowEngine.js` 全局队列和状态机，agent loop 负责 LLM/tool_call 编排，浏览器操作通过 `modules/toolRegistry.js` 执行，长任务通过 `modules/workflowRuntime.js` 持久化断点、事件和 lease，截图与证据通过 `modules/artifactStore.js` 和 evidence bundle 保存，报告进入本地报告中心。

本轮审计后的判断是：插件可以继续向“可完整业务流测试”的方向推进，但还不能把所有业务输出都视为生产级真实结论。真正需要收口的不是再增加按钮，而是统一以下四条线：

- 任务运行事实：每个 workflow 的开始、工具调用、等待、失败、恢复、报告保存和清理都要有可查询日志。
- 证据事实：报告必须能回放使用过的页面、截图、Seller API、本地缓存和外部搜索证据。
- 页面生命周期：新开 tab、source tab 保护、等待加载、关闭页面必须使用统一底层能力。
- 第三方数据边界：没有正式 provider adapter 的数据源必须 fail closed，不能生成随机或推测指标。

## 2. 本轮已完成修正

| 项目 | 状态 | 说明 |
|---|---|---|
| Durable task logs | 已完成 | 新增 `taskLogs` IndexedDB store、内存 fallback、脱敏、截断、筛选和清理 |
| 日志自动清理 | 已完成 | background 启动、安装和每日 alarm 触发 `pruneTaskLogs()` |
| 运行日志产品入口 | 已完成 | 系统任务页新增“运行日志”，支持全部/警告/错误筛选和 JSON 详情展开 |
| 伪造第三方市场指标 | 已修复 | `query_market_data` 不再返回 `Math.random()` 生成的搜索量/销量/竞争指数 |
| 定时监控 tab 生命周期 | 已修复 | monitor alarm 改为 `createOwnedTab` + `waitForPageCaptureReady` + `closeOwnedTab` |
| 外部搜索兜底 tab 生命周期 | 已修复 | `agentic_web_search` 的 Bing tab fallback 改为 owned tab + 统一 ready 等待 |
| 寻源搜索等待 | 已修复 | `input_text_and_search` 与 `image_search_in_browser` 改为共享 ready 等待，减少图搜后循环改走文本搜索 |
| Workflow engine | 已完成基础版 | 新增 `modules/workflowEngine.js`，核心 `RUN_SKILL` 执行段进入全局单并发队列和状态机 |
| MV3 keep-alive | 已缓解 | keep-alive 仅在存在活动 workflow port 时触发，断点恢复仍是主保护 |
| Storage schema registry | 已完成 | 新增 `modules/storageKeys.js`，登记 owner、分类、敏感度、保留策略，并加入 `test:storage-schema` |
| Storage local 可靠网关 | 已完成基础版 | 新增 `modules/storageLocal.js`，为后台热路径提供 key 校验、lastError 处理、超时和一次重试 |
| all_urls 权限策略 | 暂不收窄 | 为保证跨站趋势、搜索、寻源和证据回放快速可靠，本轮保留 `<all_urls>`，仅记录后续 optional permissions 方向 |
| 回归测试 | 已补齐 | 新增 `test:task-logs`，并把日志端点/清理闹钟/非伪造数据纳入 business smoke |

## 3. 架构地图

| 层级 | 关键文件 | 当前职责 |
|---|---|---|
| 前台浮窗 / 侧边栏 | `sidepanel.js`, `content.js` | 页面识别、按钮触发、对话框进度展示、DOM 抽取入口 |
| 后台控制器 | `background.js` | skill 路由、RUN_SKILL、断点恢复、报告保存、Chrome alarms、消息端点 |
| Agent loop | `modules/agentLoop.js` | LLM 工具循环、Critic 审计、进度事件、checkpoint 回调、最终报告校验 |
| 工具注册表 | `modules/toolRegistry.js` | 浏览器打开/搜索/筛选/翻页/截图、Seller API、本地保存、外部搜索、寻源工具 |
| 浏览器会话 | `modules/browserSessionManager.js` | workflow-owned tab、source tab 保护、owned tab 清理 |
| Workflow engine | `modules/workflowEngine.js` | 全局 job queue、单并发调度、queued/running/completed/failed 状态、取消入口 |
| Workflow runtime | `modules/workflowRuntime.js` | IndexedDB workflow snapshot、event stream、lease、cancel、task logs |
| Artifact runtime | `modules/artifactStore.js` | 截图/证据 blob 的 IndexedDB 保存与 TTL 清理 |
| 证据包 | `modules/evidenceBundle.js` | 报告证据压缩、截图 artifact 引用、工具时间线和 pageEvidence |
| Dashboard | `dashboard.html`, `dashboard.js`, `dashboard.css` | 增长工作流画布、报告中心、API 数据、系统任务、系统设置 |

## 4. 数据所有权

| 数据 | 存储位置 | 风险判断 |
|---|---|---|
| `savedResults` | `chrome.storage.local` | 适合短期本地报告；长期建议迁移 metadata 到 IndexedDB，仅保留索引 |
| `growthCases` / `growthActionRuns` | `chrome.storage.local` | 适合当前规模；已纳入 storage key registry，后续案件流扩大后再迁移 typed gateway |
| `agentWorkflowCheckpoints` | `chrome.storage.local` | 兼容性索引可接受；完整 workflow snapshot 已进 IndexedDB |
| workflow snapshots/events | `modules/workflowRuntime.js` IndexedDB | 正确，适合断点续跑和事件回放 |
| `taskLogs` | `modules/workflowRuntime.js` IndexedDB | 本轮新增，适合运行审计和问题定位 |
| screenshot/artifact blob | `modules/artifactStore.js` IndexedDB | 正确，避免把大图塞进 storage.local |
| Seller API cache | `chrome.storage.local` | 可接受；已纳入 storage key registry，后续应拆成 shop-scoped cache 并声明 freshness |

## 5. 主要发现

| 级别 | 发现 | 当前状态 | 建议 |
|---|---|---|---|
| P0 | `query_market_data` 曾在有 API Key 时返回随机市场指标，容易让报告误称第三方真实数据 | 已修复 | 接入正式 SellerSprite/Helium10 adapter 前继续 fail closed |
| P1 | 定时监控仍有局部 `chrome.tabs.create` 和 setInterval 轮询，没有完全走 `browserSessionManager` + 统一等待能力 | 已修复 | 已改为 owned tab、共享页面 ready、finally 关闭和运行日志记录 |
| P1 | `agentic_web_search` 仍包含 HTML 正则解析和原始 tab 创建路径 | 部分修复 | raw tab fallback 已改为 owned tab；HTML 正则 fetch 解析仍只应作为弱证据 |
| P1 | MV3 keep-alive 仍有 10 秒 `setInterval` | 已缓解 | 现在仅活动 workflow port 存在时轻触发；后续仍可评估完全依赖 port/alarm/checkpoint |
| P1 | `<all_urls>` host permission 较宽 | 暂不收窄 | README/使用规范已解释；当前优先保证速度和可靠性；后续可迁移 optional host permissions |
| P1 | UI 状态还未完全订阅 workflow engine | 待处理 | 已新增 `GET_WORKFLOW_ENGINE_STATE`，下一步把侧边栏/浮层/画布按钮状态改为从 engine state 派生 |
| P2 | `chrome.storage.local` key 较分散，缺少统一 schema registry | 已完成基础版 | 已建立 registry、可靠网关和 smoke；下一步逐步迁移更多 UI 读写入口 |
| P2 | `dashboard.js` 仍是大文件，直接读写 storage 较多 | 待处理 | 抽 `dashboardDataGateway` 和 `workflowCanvasPresenter`，降低回归成本 |
| P2 | Durable ID 仍有多处 `Math.random()` | 待处理 | durable 对象优先 `crypto.randomUUID()`；UI 临时 ref 可保留 |

## 6. 第三方库与自建边界

| 能力 | 当前做法 | 审计判断 |
|---|---|---|
| Markdown 渲染 | `marked` | 正确，继续使用成熟库 |
| HTML 消毒 | `DOMPurify` / npm `dompurify` 测试依赖 | 正确，不能自建 sanitizer |
| IndexedDB wrapper | 自建薄封装 | 当前可接受；数据量小且 MV3 约束明确，暂不需要为了形式引入 `idb` |
| 页面语义抽取 | 自建 Ozon/1688/Taobao 站点感知逻辑 | 正确，通用库无法替代业务语义 |
| 浏览器等待 | 自建 `waitForPageCaptureReady` | 已共享给 monitor、agentic search、站内文本搜索、图片搜索和详情页打开 |
| 外部搜索解析 | fetch HTML 正则 + owned tab DOM fallback | 风险中等；fetch 正则只作弱证据，强结论应依赖 DOM/截图/来源分级 |
| 市场数据 provider | 暂无正式 adapter | 必须保持 fail closed，不能输出推测数据 |
| PDF 导出 | 本地 print bridge + 字体/UTF-8 修复 | 当前可接受，继续沿用 ecommerce/etsy 已验证经验 |

## 7. 新任务日志设计

任务日志不是替代 workflow events，而是面向产品和运维的可读审计层。

记录范围：

- workflow start / resume / complete / interrupted / failed
- agent progress、工具调用、checkpoint、报告保存
- port disconnect、暂停请求、取消请求
- scheduled monitor start / complete / failed
- task log cleanup

保留策略：

- 默认保留 30 天
- 全局最多 5000 条
- 单 workflow 最多 500 条
- 每日自动清理
- secret-like 字段脱敏，长字符串截断

产品入口：

- `系统任务 -> 运行日志`
- 支持全部、警告、错误筛选
- 展开可读 JSON 详情

## 8. 后续收口路线

1. 统一外部搜索证据：搜索结果按来源、时间、URL、截图、页面抽取质量分级，弱证据不能直接支撑强结论。
2. 统一 storage gateway：在 registry 基础上逐步迁移读写入口，补 schema migration、导出和清理策略。
3. 统一业务案件：所有报告、任务、实验、日志、证据都归属 `growthCaseId`，画布只呈现案件和子工作流。
4. 真实 provider adapter：只有完成请求签名、限流、错误处理、字段映射和 contract test 后，才能把第三方市场数据标为真实证据。

## 9. 验收门槛

本类底层改造至少需要通过：

```bash
node --check background.js
node --check modules/workflowEngine.js
node --check modules/workflowRuntime.js
node --check modules/toolRegistry.js
npm run test:workflow-engine
npm run test:task-logs
npm run test:workflow
npm run test:business
npm run test:no-mock
npm run test:browser-capabilities
npm run test:storage-schema
npm run test:storage-local
npm run lint
git diff --check
```

涉及 Ozon/1688/Taobao 页面语义时，还需要补真实浏览器验收记录，因为 smoke 只能证明合约存在，不能证明活网站行为稳定。
