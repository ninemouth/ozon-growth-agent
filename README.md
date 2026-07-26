# Ozon Growth Agent

Ozon Growth Agent 是面向 Ozon 卖家的开源 AI 增长工作流 Chrome 插件。它不是传统“数据看板 + 聊天框”，而是把店铺体检、平台趋势、竞品跟踪、商品机会、货源筛选、Listing 优化、执行任务、报告沉淀和断点恢复组织成可推进的运营工作流。

核心原则：AI 先围绕真实业务环节产出诊断、证据、任务和报告；运营人员再在关键节点确认、执行、复盘，而不是每次从一句空泛的“帮我分析店铺”开始。

## v1.4.0 重大更新

`v1.4.0` 将平台趋势能力从“首页/全站默认分析”升级为“任意 Ozon 入口的上下文趋势分析”，重点修复专题/频道页报告单薄、入口边界不清、缺少商品层级/价格阶梯/人群场景拆解的问题。

- 入口上下文识别升级：Ozon `/highlight/` 专题页会识别为 `ozon_channel`，并输出 `channel_trend`，例如“中国商品专题页”不再被当成普通搜索页或全站趋势页。
- 新增 `trend_scope`：报告必须声明本轮是首页/全站发现、专题频道页、类目页、搜索页、商品页还是店铺页，并列出允许结论和禁止外推结论。
- 新增 `channel_structure`：专题/频道页报告必须拆出频道主题、至少 2 个可见商品簇、频道内机会假设和“不代表 Ozon 全站销量/全平台趋势”的边界。
- 新增 `product_level_map`：每个推荐机会必须拆商品形态层级，例如基础款、差异化款、组合款、场景款或高风险款，避免只输出一个商品名。
- 新增 `price_ladder`：报告必须按价格阶梯解释买家心智、竞争风险和中小卖家适配，当前页面若显示非卢布价格，会要求补 Ozon 卢布页和毛利验证。
- 新增 `audience_price_matrix`：报告必须从人群、场景、痛点、价格层和商品切口拆解趋势，不再只关注商品总量或单页评价数。
- 报告中心/PDF 展示升级：趋势范围声明、频道结构、商品层级、价格阶梯、人群/场景矩阵都会展开为业务可读章节。
- Critic 前置硬门槛：频道页单页证据只能支持“频道页可见信号”，不能被写成 Ozon 全站趋势或全平台销量增长；缺少分层字段会被要求补齐。

## v1.3.3 小修复

`v1.3.3` 前置修复平台趋势报告里的宏观证据降级问题，避免模型把未取证的宏观背景写成已验证证据后被 Critic 反复打回。

- 新增宏观/行业证据自动降级器：当 `macro_context.status=observed/used` 但本轮没有 CBR、Rosstat、AKIT、Data Insight、Yakov Partners、政策页或宏观相关搜索证据时，会在进入 Critic 前自动降级。
- 没有访问尝试时降级为 `assumption`；有访问尝试但页面不可用、验证码或未形成可用证据时降级为 `blocked`，并补入 `blocking_gaps`。
- 自动同步修正 `macro_context.evidence_ledger`、`data[].evidence_ledger` 和 `external_source_plan.layers.macro_context`，避免报告声称“已使用宏观来源”但证据包对不上。
- 如果宏观来源阻断且报告原本写 `completed`，会自动降为 `partial`，避免“有关键缺口却完成”的状态冲突。

## v1.3.2 小修复

`v1.3.2` 修复 Yandex 普通搜索入口和报告标签混用问题，避免把 `Yandex.ru` 当作 `Yandex.com` 搜索引擎的同义标签。

- 普通 Yandex 搜索入口改为 `https://yandex.com/search/?text=...`，内部仍保持 `engine="yandex"` / `yandex_search` 兼容历史证据类型。
- 报告中心、PDF、技能提示和审计基座统一使用“Yandex 搜索”作为用户可读标签，不再把普通搜索写成 `Yandex.ru 公开搜索`。
- 明确区分 Yandex 普通搜索、Yandex Wordstat 和 Yandex Market：Wordstat 只代表搜索需求/词族，Market 只代表价格与规格交叉验证，二者都不能替代普通搜索结果或 Ozon 站内证据。
- 增加 smoke 断言，防止普通 Yandex 搜索入口回退到 `yandex.ru/search`。

## v1.3.1 重大更新

`v1.3.1` 聚焦平台趋势报告的证据透明度、外部信源真实性和定性市场研究能力，适合需要向用户解释“到底查了哪些来源、哪些只是阻断或待验证”的测试与交付场景。

- 外部信源启用与采集对账：报告中心和 PDF 会展示 `external_source_plan` 声明的信源，与本轮证据包真实采集到的页面记录逐项对比，区分“已使用 / 阻断 / 未使用 / 未声明”。
- 外部信源声明硬门槛：平台趋势报告如果声明某个信源 `used`，必须有对应可用页面/搜索证据；声明 `blocked` 必须有访问尝试或 `blocking_gaps` 恢复说明。
- 自主扩展信源发现：新增 `adaptive_source_discovery`，允许围绕文化型、礼品型、评论型、本地语境需求自主发现补充来源，但发现来源必须进入页面取证，不能直接当作趋势证明。
- 定性市场洞察：新增 `qualitative_market_context`，用于承接买家语言、使用场景、内容主题、文化适配和异议模式；定性资料只能解释市场语境，不能单独证明某个 SKU 可卖。
- 俄罗斯定性来源入口扩展：新增 Otzovik、iRecommend、俄语论坛/讨论页、Data Insight 等采集入口，补充 VK、TGStat、Dzen、Yandex News、CBR、Rosstat、AKIT、Yakov Partners 等来源。
- 报告渲染修复：结构化风险护栏、定性上下文和自主扩源对象会展开为业务可读文本，避免 PDF 或报告中心出现 `[object Object]`。
- Provider 错误可见化：LLM Provider 的 429/502/网络失败、Responses API 降级和最终调用错误会直接进入侧边栏/网页浮窗和任务日志，用户不必打开控制台才能知道失败原因。

## v1.3.0 重大更新

`v1.3.0` 聚焦平台趋势智能、外部信源、证据可用性和 LLM Provider 稳定性，适合需要在俄罗斯及独联体市场做 Ozon 选品/趋势侦察的小微卖家使用。

- 平台趋势外部信源扩展：新增 Yandex Wordstat、Wildberries、Avito、Yandex Market、MegaMarket、CBR、Rosstat、AKIT、Yakov Partners 等公开信源入口，用于把“用户问题”先撒网成俄语候选词，再聚焦成可验证机会。
- 问题到关键词漏斗：平台趋势报告必须输出 `query_funnel`，保留原始问题、意图维度、6-12 个俄语候选、3-5 个轻量验证词、2-4 个聚焦词和查询调整记录。
- Google Trends 数据不足前置降级：已加载但没有足够数据的趋势页不会被当作有效趋势证据；插件会先执行退宽语义/同义词小循环，仍不足时写入 `blocking_gaps`。
- 父级 proxy 限分：`parent_proxy` / `adjacent_proxy` 只能说明大方向或相邻需求，不能直接证明细分商品增长；这类代理词的 `future_signal` 最高只能为 1。
- 证据可用性判定升级：页面打开不再等于业务证据可用。登录墙、验证码、壳页、无数据页会被标为“阻断 / 数据不足 / 待复核”，不会在 PDF 附录里误显示为“可用”。
- 外部信源计划与宏观边界展示：趋势报告和 PDF 会显式展示 `external_source_plan` 与 `macro_context`。宏观/行业资料只能解释价格敏感、汇率/通胀、履约和品类背景，不能单独证明某个 SKU 或商品机会可卖。
- 报告中心/PDF 证据附录升级：证据来源使用业务可读标签，例如“Yandex Wordstat 搜索需求”“Wildberries 平台交叉验证”“俄罗斯宏观背景”；搜索页 URL 会保留关键查询参数，便于复盘。
- Gemini Provider 支持：新增 Google Gemini 供应商，直连 Gemini Interactions API，并支持内置 Google Search 来源回传；Google Search 不会冒充 Google Trends。
- 自定义 API Endpoint 优先级：当用户填写自定义 API endpoint 时，插件优先使用该 endpoint；LLM Provider 只在 endpoint 为空时决定官方请求地址。
- 报告清洗前移：报告中心和 PDF 会过滤内部技术黑话或工具名，尽量以通俗的商业/供应链分析术语呈现。

## 历史重大更新

本次版本不是一次 UI 微调，而是一次从“传统插件”向“增长工作流操作系统”迁移的产品级升级，核心变化如下：

- 增长工作流画布：后台首页不再以传统菜单和表格为主，而是以可推进的工作流画布组织店铺体检、平台趋势、竞品跟踪、商品转化、供应商货源和执行复盘。
- 上下文感知的一键动作：右侧悬浮栏会根据当前页面识别可执行方向，减少让用户先构造提问，再等待 AI 理解意图的负担。
- 店铺体检证据升级：诊断不再允许只凭截图给结论，而是要求结合页面 DOM、Seller API、Ozon 搜索/榜单、2-3 个同类头部店铺和截图分析做综合判断。
- 浏览器运行时强化：补齐了 source tab 保护、workflow-owned tab 生命周期、断点恢复、稳定等待、语义筛选/排序/翻页、评论低星采集等底层能力。
- 全局 Workflow Engine：新增独立调度层，所有核心 `RUN_SKILL` 任务进入 `queued / running / interrupted / completed / failed` 状态机，默认单并发串行执行，避免多入口同时开页和重复采集。
- 供应链寻源强化：以图搜图优先，要求至少输出 2 个以上可比较供应商，并避免在已有结果页时无意义循环切换关键词搜索。
- 报告中心升级：支持 Markdown/JSON 安全渲染、PDF 导出、证据包 JSON 导出、证据包 ZIP 导出、artifact 健康校验和证据状态展示。
- 证据链可追溯：每次工作流完成后自动生成 `evidence_bundle`，沉淀工具轨迹、页面证据、截图 artifact、研究范围和证据等级；每次工具调用也带有 `toolRunId / startedAt / completedAt / durationMs / status`，便于复盘和归档。
- 真机验收矩阵：新增真实浏览器业务流验收矩阵，明确 Ozon 店铺体检、趋势、评论、1688/淘宝寻源、报告归档等关键流程的通过标准。
- 开源合规完善：补齐 MIT 中英文协议、使用规范、作者与邮箱信息，并为一方源码文件增加 SPDX / MIT 头部声明。

## 核心能力

- 店铺体检：读取 Ozon 页面、店铺属性、定位、调性、商品结构、Seller API 数据，并要求结合 Ozon 搜索/榜单与同类头部店铺证据，不只凭截图下结论。
- 平台机会/趋势：独立识别 Ozon 平台商品机会、价格带、评价门槛、季节窗口、俄语关键词和外部趋势信号，不与本店扩品执行清单混淆。
- 商品与 SKU 运营：诊断曝光、点击、加购、订单、利润、评论、履约等漏斗瓶颈，并生成可确认的增长任务。
- 竞品跟踪：围绕价格、主图、评论、断货、促销、关键词和页面变化形成事件流与应对建议。
- 货源筛选：优先支持以图搜图和供应商候选比较，要求输出至少两个以上可比较供应商，并校验同款/相似款、规格、起批量、采购价、物流、佣金、关税和 RUB 利润。
- 报告中心：保存、复制、删除、导出运营报告，并对 Markdown/JSON 结构化结果做安全渲染与脱敏。
- 断点恢复：长工作流会记录节点状态，中断后可从侧边栏历史会话恢复。
- 更新感知：插件会检查 GitHub 公开版本，提示当前版本、最新版本和下载入口。

## 项目结构

```text
ozon-growth-agent/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── dashboard.html
├── dashboard.css
├── dashboard.js
├── print.html
├── print.js
├── modules/
│   ├── agentLoop.js
│   ├── artifactStore.js
│   ├── browserAutomationCapabilities.js
│   ├── browserSessionManager.js
│   ├── evidenceBundle.js
│   ├── evidenceQuality.js
│   ├── llmClient.js
│   ├── researchScope.js
│   ├── toolRegistry.js
│   ├── workflowEngine.js
│   └── workflowRuntime.js
├── operations/
│   ├── acceptance/
│   └── ozon_product_grade_skill_runtime_audit.md
├── skills/
│   ├── ozon_global_shop_optimizer.skill.md
│   ├── ozon_platform_trends.skill.md
│   ├── ozon_product_opportunity_explorer.skill.md
│   ├── ozon_sourcing_finder.skill.md
│   ├── ozon_operations_tracker.skill.md
│   ├── ozon_listing_generator.skill.md
│   ├── ozon_review_analyzer.skill.md
│   └── ozon_compliance_auditor.skill.md
└── scripts/
```

## 安装

1. 获取源码：

```bash
git clone https://github.com/ninemouth/ozon-growth-agent.git
cd ozon-growth-agent
npm install
```

2. 打开 Chrome：`chrome://extensions/`
3. 开启“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本项目文件夹 `ozon-growth-agent`
6. 在侧边栏设置中配置 LLM Provider、模型和 API Key；如果填写了自定义 API Endpoint，插件会优先使用该 endpoint，Provider 只在 endpoint 为空时决定官方请求地址。

选择 Google Gemini 时，插件直连 Gemini Interactions API，并默认启用服务端 `google_search`。搜索查询和来源链接会进入本地证据轨迹；Google Search 公开网页结果不会被当作 Google Trends 数据。

## 更新机制说明

插件已经内置更新感知能力：

- 后台会定期检查 `github.com/ninemouth/ozon-growth-agent` 的最新 Release。
- 侧边栏设置页会显示当前版本、最新版本、检查时间和 Releases 入口。
- 检查失败不会影响本地运营工作流。

需要特别说明：Chrome 开发者模式加载的源码扩展无法静默自动安装更新。GitHub 开源安装方式只能做到“发现新版本并引导用户下载/重新加载”。真正由浏览器自动更新需要以下分发方式之一：

- Chrome Web Store 发布版本；
- 自托管 CRX，并配置固定 extension key 与 `update_url` 更新 XML。

因此本仓库不会在 `manifest.json` 中伪造 `update_url`。等有真实 CRX 托管与更新 XML 后，再启用浏览器级自动更新。

## 数据与隐私

- 本项目没有自建中间服务器收集用户业务数据。
- API Key、报告、Seller API 快照、断点、任务状态保存在用户浏览器 `chrome.storage.local`。
- 本地持久化 key 已在 `modules/storageKeys.js` 中登记 owner、分类、敏感度和保留策略，新增 key 应同步更新登记册并通过 `npm run test:storage-schema`。
- AI 分析请求直接发送给用户自己配置的 LLM Provider。
- 更新检查只访问 GitHub 公开版本信息，不上传 Ozon 页面数据、报告或 API Key。

更多说明见 [PrivacyPolicy.md](PrivacyPolicy.md)。

## 权限说明

插件当前仍保留 `host_permissions: ["<all_urls>"]`，原因是核心工作流需要在用户触发后跨站打开和采集 Ozon、Google/Yandex/Bing、Google Trends、1688、淘宝/天猫等页面，用于趋势、竞品、寻源和证据包回放。这个权限不代表插件会向自建服务器上传页面数据；页面证据保存在本地，AI 请求只发送给用户自己配置的模型服务。

当前暂不收窄 `<all_urls>`，避免趋势、外部搜索、寻源和证据回放在真实业务中因授权不足变慢或失败。后续如果发布 Chrome Web Store 或面向更严格的企业环境，再把 `<all_urls>` 迁移为 optional host permissions，让用户按业务场景授权。

## 开发与验证

常用验证命令：

```bash
npm run test:update
npm run test:business
npm run test:workflow-engine
npm run test:workflow
npm run test:store-diagnosis
npm run test:etsy-parity
npm run test:sourcing
npm run test:trend-query
npm run test:research-scope
npm run test:evidence-quality
npm run test:gemini
npm run test:browser-capabilities
npm run test:evidence-bundle
npm run test:storage-schema
npm run test:storage-local
npm run test:real-browser-matrix
npm run test:security
node scripts/qa-validator.mjs
npm run lint
```

如果你需要验证这次重大更新涉及的关键能力，建议优先执行：

- `npm run test:business`
- `npm run test:trend-query`
- `npm run test:research-scope`
- `npm run test:evidence-quality`
- `npm run test:gemini`
- `npm run test:workflow-engine`
- `npm run test:store-diagnosis`
- `npm run test:browser-capabilities`
- `npm run test:evidence-bundle`
- `npm run test:real-browser-matrix`

## 开源协议

本项目基于 [MIT License](LICENSE) 开源，并提供中文译文 [LICENSE.zh-CN](LICENSE.zh-CN) 便于阅读。

维护者：Yang Cao
邮箱：cao.x.yang@gmail.com

补充说明见 [OPEN_SOURCE_USAGE.md](OPEN_SOURCE_USAGE.md)：

- 允许商用、修改、分发和二次开发；
- 需要保留版权和 MIT 协议声明；
- 不得移除署名后将本项目整体冒充为完全原创作品；
- 使用本项目连接 Ozon、Google Trends、1688、淘宝等第三方平台时，仍需自行遵守对应平台条款、隐私和数据使用要求。
