# Ozon Growth Agent

Ozon Growth Agent 是面向 Ozon 卖家的开源 AI 增长工作流 Chrome 插件。它不是传统“数据看板 + 聊天框”，而是把店铺体检、平台趋势、竞品跟踪、商品机会、货源筛选、Listing 优化、执行任务、报告沉淀和断点恢复组织成可推进的运营工作流。

核心原则：AI 先围绕真实业务环节产出诊断、证据、任务和报告；运营人员再在关键节点确认、执行、复盘，而不是每次从一句空泛的“帮我分析店铺”开始。

## 本次重大更新

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
6. 在侧边栏设置中配置 LLM Provider、模型和 API Key

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
