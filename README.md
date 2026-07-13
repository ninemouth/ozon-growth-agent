# Ozon Growth Agent

Ozon Growth Agent 是面向 Ozon 卖家的开源 AI 增长工作流 Chrome 插件。它不是传统“数据看板 + 聊天框”，而是把店铺体检、平台趋势、竞品跟踪、商品机会、货源筛选、Listing 优化、执行任务、报告沉淀和断点恢复组织成可推进的运营工作流。

核心原则：AI 先围绕真实业务环节产出诊断、证据、任务和报告；运营人员再在关键节点确认、执行、复盘，而不是每次从一句空泛的“帮我分析店铺”开始。

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
├── modules/
│   ├── agentLoop.js
│   ├── artifactStore.js
│   ├── llmClient.js
│   ├── toolRegistry.js
│   └── workflowRuntime.js
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
- AI 分析请求直接发送给用户自己配置的 LLM Provider。
- 更新检查只访问 GitHub 公开版本信息，不上传 Ozon 页面数据、报告或 API Key。

更多说明见 [PrivacyPolicy.md](PrivacyPolicy.md)。

## 开发与验证

常用验证命令：

```bash
npm run test:update
npm run test:business
npm run test:workflow
npm run test:store-diagnosis
npm run test:etsy-parity
npm run test:sourcing
npm run test:security
node scripts/qa-validator.mjs
npm run lint
```

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
