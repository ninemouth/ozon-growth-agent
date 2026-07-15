# Ozon 增长插件升级计划：从工业化骨架到经营案件操作系统

日期：2026-07-14

## 1. 升级目标

当前插件已经完成了第一轮工业化骨架建设：

- 业务 skill 统一要求 `evidence_ledger`
- 报告输出统一要求 `report_status`、`blocking_gaps`、`follow_up_tasks`、`workflow_nodes`
- 运行时支持断点恢复、workflow lease、tab 生命周期管理
- 趋势任务保护 Ozon 源 tab 和 Ozon 页面
- 新 tab 等待、Google Trends 稳定读取、full-page screenshot fallback 已增强
- 店铺体检不再允许只凭截图，必须结合平台属性、定位、Ozon 搜索、竞品学习和 Seller API
- 寻源已具备图搜路径锁定、结果页防循环、2 个以上供应商比价和详情页穿透要求

下一阶段目标是把这些底层能力产品化，形成真正的 **Ozon 经营案件操作系统**：

```text
页面角色识别
  -> 研究范围确认
  -> 证据采集
  -> 报告与阻断
  -> 工作流节点
  -> 人工确认
  -> 观察窗口
  -> 复盘归因
```

用户进入插件后不应该感觉自己在选择一堆功能，而应该看到当前店铺正在推进的增长案件、阻断节点和下一步动作。

## 2. 核心判断

### 2.1 当前主要不足

1. **缺少统一 `research_scope` 层**
   - 当前趋势、店铺体检、机会、竞品、寻源都会读取当前页面，但没有统一结构化判断“当前页面到底是什么业务现场”。
   - 同一个“趋势分析”按钮在自营店铺、Ozon 首页、搜索页、商品页、竞品页、供应商页下应该产生不同分析边界。

2. **趋势分析容易受当前页面上下文影响，但影响没有显式建模**
   - 在自营店铺页运行趋势，应该输出店铺趋势适配。
   - 在 Ozon 首页运行趋势，应该输出平台公开需求窗口或先要求范围确认。
   - 在搜索页运行趋势，应该输出类目/关键词趋势。
   - 在商品页运行趋势，应该输出单品机会。
   - 在竞品页运行趋势，必须标注 competitor reference，不能误当成自营店铺。

3. **报告已经结构化，但前端还没有完全案件化消费**
   - Skill 已要求 `workflow_nodes` 和 `follow_up_tasks`，但前端画布还需要进一步把它们渲染为案件、任务、阻断、人工确认、复盘节点。

4. **证据质量还没有产品化展示**
   - 底层已有稳定读取、capture mode、Google Trends evidence 状态、Seller API 缓存等信息。
   - 用户侧仍缺少统一的证据等级、数据新鲜度、阻断原因展示。

5. **人工确认闭环还不够硬**
   - 改图、改标题、调价、补库存、报名活动、上传证书、向供应商要样等不能自动完成。
   - 这些必须变成可点击的人工确认节点，确认后进入观察窗口。

6. **真实业务流测试不足**
   - 静态 smoke 已比较完整，但还需要真实 Ozon 页面上的端到端业务流测试。

### 2.2 Etsy 分析对 Ozon 的关键借鉴

Etsy 的横向分析最值得 Ozon 借鉴的是：**先定义研究范围，再执行任务**。

对于 Ozon，这意味着所有业务任务前置一个统一结构：

```json
{
  "entry_page_type": "owned_store|owned_product|ozon_home|ozon_search|ozon_category|competitor_store|competitor_product|supplier_page|unknown",
  "source_page_role": "self_store|self_product|platform_discovery|category_research|competitor_reference|sourcing_reference|unknown",
  "seed_keywords": [],
  "seed_category": "",
  "seed_store_positioning": "",
  "analysis_scope": "store_trend_fit|platform_trend|category_opportunity|product_opportunity|competitor_learning|sourcing_validation|unknown",
  "scope_confidence": "high|medium|low",
  "allowed_conclusions": [],
  "forbidden_conclusions": [],
  "needs_user_clarification": false
}
```

这个结构应该同时影响：

- skill 分流
- 工具调用顺序
- 报告允许结论
- 阻断与降级规则
- 画布节点渲染
- 断点恢复时的上下文延续

## 3. 分阶段升级路线

## Phase 1：统一 Research Scope 与页面角色识别

### 目标

让所有业务任务在开始前先识别当前页面角色、研究范围和结论边界。

### 主要改造

1. 新增 `researchScope` 构建函数
   - 输入：`pageContext`、`tab.url`、`userInstruction`、`growthActionId`、`selectedSkillPath`、历史 checkpoint。
   - 输出：统一 `research_scope` 对象。

2. 页面类型识别规则
   - `ozon.ru/seller` 或店铺结构：`owned_store` / `competitor_store`，需要结合是否绑定/当前店铺 ID 判断。
   - `ozon.ru/product`：`owned_product` / `competitor_product`，需要结合自营商品或用户意图判断。
   - `ozon.ru/search`：`ozon_search`
   - 类目页：`ozon_category`
   - `ozon.ru` 首页：`ozon_home`
   - `1688.com` / `taobao.com`：`supplier_page`
   - 其他页面：`unknown`

3. 用户意图仲裁
   - 用户明确指令优先于当前页面。
   - 当前页面只作为上下文，不自动等同于目标。
   - 页面和指令冲突时，报告必须声明页面只是参考或竞品样本。

4. 将 `research_scope` 注入 agent loop
   - 放入 prompt context。
   - 写入 checkpoint。
   - 写入最终报告顶层字段。

### 验收标准

- 在 Ozon 首页点趋势且没有关键词时，不直接输出 `completed` 平台趋势报告。
- 在竞品页运行店铺体检，不把竞品页误认为自营店铺。
- 在商品页运行趋势，输出 `product_opportunity` 而非泛平台大盘。
- 断点恢复后沿用原 `research_scope`，不因当前 active tab 改变而漂移。

### 建议文件

- `modules/researchScope.js`
- `scripts/research-scope-smoke.mjs`
- `background.js`
- `modules/agentLoop.js`
- `skills/base_report_auditor.skill.md`

## Phase 2：趋势上下文分流升级

### 目标

让“趋势分析”根据当前页面自动分流为不同业务任务，而不是所有入口都生成同一种趋势报告。

### 趋势入口类型

| 当前页面 | trend_context_type | 分析重点 | 禁止结论 |
|---|---|---|---|
| 自营店铺页 | `store_trend_fit` | 当前店铺是否适合追某趋势 | 未验证就给采购或上架建议 |
| Ozon 首页 | `platform_trend` | 平台公开需求窗口 | 直接说当前店铺应该做 |
| 搜索/类目页 | `category_opportunity` | 类目价格带、评价门槛、关键词、竞品结构 | 声称全平台完整销量 |
| 商品详情页 | `product_opportunity` | 单品机会、竞品、评论、合规、寻源路径 | 不读竞品就说蓝海 |
| 竞品页 | `competitor_learning` | 竞品定位、视觉、SKU、价格、评价门槛 | 当成自营店铺 |
| 1688/淘宝页 | `sourcing_validation` | 供应商可行性与毛利 | 当作 Ozon 平台趋势 |
| 未知页 | `unknown` | 研究范围确认 | 输出确定趋势结论 |

### 主要改造

1. 升级 `ozon_platform_trends.skill.md`
   - 强制输出 `trend_context_type`
   - 强制输出 `platform_signal` 与 `store_fit`
   - 弱上下文时必须 `partial`、`blocked` 或 `assumption_only`

2. 趋势报告新增结构

```json
{
  "trend_context_type": "store_trend_fit|platform_trend|category_opportunity|product_opportunity|competitor_learning|sourcing_validation|unknown",
  "research_scope": {},
  "platform_signal": {},
  "store_fit": {
    "fit": "fit|partial_fit|not_fit|unknown",
    "fit_reason": "",
    "required_store_changes": [],
    "recommended_next_case": "listing_experiment|sourcing_validation|compliance_precheck|positioning_rebuild|observe_only"
  }
}
```

3. 弱上下文研究计划预览
   - Ozon 首页或 unknown 页面无关键词时，先生成 `research_plan` 节点。
   - 如果无法推断范围，输出 `manual_confirm` 节点。

### 验收标准

- 同一个趋势按钮在店铺页、首页、搜索页、商品页、竞品页下输出不同 `trend_context_type`。
- 店铺页趋势必须包含 `store_fit`。
- Ozon 首页无关键词不得输出确定性机会结论。
- 竞品页趋势必须标记为 `competitor_reference`。

## Phase 3：画布案件模型与前端消费

### 目标

把所有报告输出真正转成首页工作流画布上的增长案件，而不是保存在报告中心的一份静态文档。

### 核心对象

```json
{
  "case_id": "CASE-...",
  "case_type": "store_diagnosis|platform_trend|product_opportunity|listing_experiment|sourcing_validation|compliance_review|operations_review",
  "shop_id": "",
  "title": "",
  "status": "queued|running|blocked|manual_confirm|observing|completed|archived",
  "research_scope": {},
  "evidence_summary": {},
  "nodes": [],
  "tasks": [],
  "reports": [],
  "updated_at": ""
}
```

### 前端改造

1. 首页画布优先渲染 `growthCases`
   - 根节点：店铺体检 / 平台趋势 / 商品机会 / 合规 / 寻源 / Listing / 复盘
   - 子节点：来自 `workflow_nodes`
   - 任务卡：来自 `follow_up_tasks`

2. PIP 报告弹窗
   - 不跳转页面。
   - 支持拖拽。
   - Markdown/JSON 格式化。
   - 显示 `report_status`、证据等级、阻断缺口。

3. 人工确认节点
   - 按钮：`已完成`
   - 填写：执行时间、执行备注、截图/链接可选
   - 完成后进入观察窗口或下一节点。

4. 报告中心升级
   - 由“报告列表”升级为“案件档案”。
   - 支持按店铺、商品、案件、状态、证据等级筛选。
   - 支持删除、复制、下载 PDF。

### 验收标准

- 一份趋势报告能自动生成后续合规/寻源/Listing/复盘节点。
- 一份店铺体检能生成定位重构、竞品学习、Listing 改版、运营追踪等子节点。
- 用户完成“已改标题”人工确认后，系统生成观察窗口节点。

## Phase 4：证据质量与数据新鲜度产品化

### 目标

让用户清楚知道每个结论来自什么证据、证据是否稳定、API 是否新鲜、哪些结论只是待验证假设。

### 证据等级

| 等级 | 来源 | 可执行性 |
|---|---|---|
| A | Seller API、Ozon 商品/店铺详情页、供应商详情页、官方政策 | 可直接进入执行或强判断 |
| B | Ozon 搜索可见样本、Yandex、Google RU、Google Trends 有效截图 | 可作为趋势或对标依据 |
| C | 当前截图、搜索页首屏、评论片段、页面可见样本 | 只能做局部判断 |
| D | assumption、blocked、数据不足、页面阻断 | 只能生成补证任务 |

### 显示内容

1. Seller API 数据状态
   - 店铺 ID
   - 最近同步时间
   - 覆盖日期
   - SKU 数量
   - 缺失指标
   - 使用缓存还是新同步

2. 页面采集质量
   - `loadState`
   - `stableReads`
   - `readinessElapsedMs`
   - `screenshotCaptureMode`
   - 是否 Google Trends 数据不足

3. 结论证据摘要
   - 每个关键结论显示证据等级。
   - 每个阻断显示恢复动作。

### 验收标准

- 用户能在报告顶部看到“本报告证据质量”。
- Google Trends 只加载壳页时，报告明确降级，不能输出趋势证明。
- Seller API 使用缓存时，报告显示缓存时间。

## Phase 5：人工确认、观察窗口与复盘归因

### 目标

把 AI 建议变成可追踪执行的运营闭环。

### 业务闭环

```text
AI 诊断
  -> 生成任务
  -> 人工执行
  -> 用户确认已执行
  -> 建立观察窗口
  -> Seller API / 页面状态同步
  -> 复盘归因
  -> 下一轮任务
```

### 改造项

1. `manual_confirmations` 统一存储
   - 任务 ID
   - 确认人
   - 确认时间
   - 执行动作
   - 备注
   - 附件/截图可选

2. 观察窗口
   - 7 天 / 14 天 / 自定义
   - baseline window
   - comparison window
   - observation window

3. 复盘归因
   - 没有基线不得归因。
   - 干扰项必须声明：价格、广告、库存、促销、评价、履约、季节性。
   - 输出下一轮任务。

### 验收标准

- Listing 改写任务确认后，自动生成 7 天观察节点。
- 没有优化前快照时，运营追踪只能输出“建立基线”，不能说优化成功。
- 复盘报告生成下一轮 `follow_up_tasks`。

## Phase 6：真实业务流测试矩阵

### 目标

从静态 smoke 升级到真实页面端到端业务流验证。

### 必测场景

1. **自营店铺页 -> 店铺体检**
   - 读取当前店铺定位。
   - 拉取 Seller API。
   - 搜索 Ozon 同类竞品。
   - 输出 A/B/C 方案、竞品矩阵和任务节点。

2. **Ozon 首页 -> 趋势分析**
   - 无关键词时不输出确定趋势。
   - 生成研究范围确认节点。

3. **Ozon 搜索页 -> 类目趋势**
   - 抽取搜索词、价格带、评价门槛和竞品链接。
   - 打开 2 个详情页。

4. **Ozon 商品页 -> 商品机会**
   - 分析单品机会、评论、合规、寻源路径。

5. **竞品店铺页 -> 竞品学习**
   - 标注 competitor reference。
   - 不误用为自营店铺。

6. **Ozon 商品页 -> 货源筛选**
   - 优先图搜。
   - 结果页有 productCards 后不重复搜索。
   - 打开 2 个详情页。
   - 输出至少 2 个供应商或明确不足原因。

7. **Listing 改写 -> 人工确认 -> 运营追踪**
   - 生成改写建议。
   - 用户确认已执行。
   - 建立观察窗口。
   - 复盘归因。

8. **中断恢复**
   - 关闭站外临时 tab。
   - 关闭非源 Ozon tab。
   - 暂停任务。
   - 选择历史会话恢复。

### 验收标准

- 每条场景有记录：开始页面、触发动作、生成报告、节点状态、阻断恢复、最终结果。
- 不依赖 mock 数据。
- 每个报告有证据等级和数据新鲜度。

## 4. 技术实施建议

### 4.1 新增模块

```text
modules/researchScope.js
modules/evidenceQuality.js
modules/growthCaseStore.js
```

### 4.2 修改重点

```text
background.js
  - 读取页面后构建 research_scope
  - skill 分流前做页面角色与用户意图仲裁
  - checkpoint 保存 research_scope

modules/agentLoop.js
  - prompt 注入 research_scope
  - validator 检查报告是否声明页面角色和结论边界

modules/toolRegistry.js
  - 工具结果统一返回 evidenceQuality
  - Seller API 返回数据新鲜度

dashboard.js / dashboard.css / dashboard.html
  - 画布消费 workflow_nodes
  - 人工确认节点
  - 证据等级 UI
  - 案件档案入口

sidepanel.js / content.js
  - 右侧浮栏根据 research_scope 自动显示可调用方向
```

### 4.3 测试新增

```text
scripts/research-scope-smoke.mjs
scripts/trend-context-smoke.mjs
scripts/growth-case-contract-smoke.mjs
scripts/evidence-quality-smoke.mjs
```

## 5. 优先级

### P0：必须先做

1. `research_scope` 页面角色识别
2. 趋势上下文分流
3. 弱上下文阻断 / 研究计划预览
4. skill 输出加入页面角色与结论边界
5. smoke 防回退

### P1：紧接着做

1. 画布消费 `workflow_nodes`
2. 人工确认节点
3. 证据等级 UI
4. Seller API 数据新鲜度展示
5. 报告中心升级为案件档案

### P2：完善体验

1. 真实业务流测试矩阵
2. 调试面板显示 stable reads / load state
3. 多店铺案件筛选
4. PDF 报告加入证据摘要和案件节点

## 6. 预期产品效果

升级完成后，用户体验应从：

```text
我点一个按钮，让 AI 帮我分析。
```

变成：

```text
插件知道我当前站在店铺、商品、搜索页、竞品页还是供应商页。
它先判断研究范围，再采集证据。
它告诉我哪些结论可执行，哪些还缺证据。
它把报告变成任务节点。
我人工确认执行后，它自动进入观察和复盘。
```

这才是 Ozon 增长插件真正区别于传统后台和普通 AI 对话框的地方。

## 7. 运营文章带来的业务方法论补充

补充日期：2026-07-14

本次补充来自用户提供的 Ozon 运营文章截图，以及前一轮对开源归档/导出型工具的架构分析。两者合并后的判断是：

- 架构层面，插件需要从“AI 任务执行器”升级为“经营数据归档、证据包、报告导出、隐私可信、开放接口”的增长操作系统。
- 运营层面，插件不能只优化标题、主图、价格和关键词，而要把利润结构、履约模型、广告质量分、库存断崖、季节性、本地化信任和合规/证书作为店铺体检的一等对象。

文章的业务启发可以概括为四条：

1. **FBO 不是天然利润放大器**
   - FBO 会提升履约体验和部分转化，但也引入入库、仓储、尾程、周转、滞销和活动备货风险。
   - 正确策略不是“全量 FBO”，而是根据 SKU 周转、季节性、价格带、区域履约和毛利结构动态分配 FBO/FBS。

2. **Ozon 广告不是简单低价竞价**
   - 俄罗斯消费者和 Ozon 广告系统都不只奖励低价。
   - 广告效率受评价数量、评分、买家秀、物流时效、历史销量、页面质量、关键词相关性和本地化内容共同影响。
   - 插件不能只给 CPC/预算建议，必须先判断商品是否具备“值得投”的质量分基础。

3. **库存与物流会直接摧毁排名和现金流**
   - 季节性商品、认证品类、区域仓储和入库时效都会影响是否断货、是否下架、是否错过需求窗口。
   - 店铺体检需要把库存周转、备货天数、滞销风险、缺货风险、区域履约风险纳入 P0 诊断。

4. **2026 后的生存法则是反脆弱经营**
   - 平台会继续挤压低质量、低客单、低信任、低履约稳定性的卖家。
   - 真正可持续的卖家需要组合能力：FBO/FBS 混合履约、质量分广告、证据化选品、本地化内容、合规证书、供应链弹性和现金流控制。

这意味着我们的产品升级方向要从：

```text
分析当前页面 -> 生成建议
```

升级为：

```text
识别经营现场
  -> 建立经营账本
  -> 判断利润/履约/广告/库存/合规/本地化风险
  -> 生成案件和任务
  -> 人工执行确认
  -> 观察指标
  -> 复盘归因
```

## 8. 新增经营对象：Ozon Growth Ledger

为了吸收上述运营方法论，下一轮需要新增统一经营账本 `Ozon Growth Ledger`。它不是一张财务表，而是所有业务报告、任务和画布案件的底层经营结构。

### 8.1 账本核心字段

```json
{
  "shop_id": "",
  "sku_id": "",
  "ledger_scope": "shop|sku|category|competitor|trend|supplier",
  "price_band": "",
  "gross_margin_estimate": null,
  "net_margin_estimate": null,
  "fbo_costs": {
    "inbound": null,
    "storage": null,
    "last_mile": null,
    "return_risk": null,
    "stale_inventory_risk": null
  },
  "fbs_costs": {
    "cross_border_shipping": null,
    "handling": null,
    "delivery_time_risk": null
  },
  "fulfillment_recommendation": {
    "mode": "fbo|fbs|hybrid|unknown",
    "reason": "",
    "risk_level": "low|medium|high|blocked"
  },
  "ad_quality_readiness": {
    "rating": null,
    "review_count": null,
    "content_quality": "good|partial|weak|unknown",
    "logistics_signal": "good|partial|weak|unknown",
    "ready_to_scale_ads": false
  },
  "inventory_health": {
    "turnover_days": null,
    "stockout_risk": "low|medium|high|unknown",
    "seasonality_risk": "low|medium|high|unknown",
    "stale_inventory_risk": "low|medium|high|unknown"
  },
  "localization_trust": {
    "russian_title_quality": "good|partial|weak|unknown",
    "buyer_use_case_fit": "good|partial|weak|unknown",
    "review_language_signal": "good|partial|weak|unknown",
    "visual_localization": "good|partial|weak|unknown"
  },
  "compliance_and_certification": {
    "required_docs": [],
    "missing_docs": [],
    "publish_risk": "low|medium|high|blocked|unknown"
  }
}
```

### 8.2 对现有业务流的影响

| 业务流 | 新增判断 | 输出变化 |
|---|---|---|
| 店铺体检 | FBO/FBS 结构、广告质量分、库存断崖、定位与利润模型 | 不再只输出页面/商品优化，必须给经营优先级 |
| 商品分析 | 单 SKU 净利、履约方式、广告可投性、库存窗口 | 判断“先投广告、先改页面、先改履约、还是先停售” |
| 平台趋势 | 趋势机会是否适合当前店铺利润和履约能力 | 区分“市场有机会”和“本店适合做” |
| 机会扩品 | 先算履约/证书/库存/毛利，再进入寻源 | 不再把热卖当机会 |
| 货源筛选 | 供应商对比必须连接 Ozon 净利和履约模型 | 至少 2 个供应商，并输出 landed cost 假设 |
| 广告优化 | 先判断质量分基础，再给投放建议 | 缺评分/评论/物流/页面质量时先生成修复任务 |
| 运营复盘 | 复盘广告、库存、价格、履约和页面变更的组合影响 | 不把销量变化简单归因给标题或主图 |

## 9. Phase 7：利润与履约诊断引擎

### 目标

把文章里强调的 FBO/FBS 利润陷阱变成插件的一键诊断能力。

### 主要改造

1. 新增 `fulfillment_profit_diagnosis`
   - 对店铺和 SKU 计算 FBO、FBS、混合履约的成本/风险假设。
   - 如果缺少 Seller API 或成本字段，输出 `blocking_gaps`，要求用户补充采购价、物流费、佣金、仓储假设。

2. 店铺体检新增 `fulfillment_profit_matrix`
   - SKU 周转快、需求稳定、毛利足够：候选 FBO。
   - 季节性、长尾、低毛利、区域不稳定：倾向 FBS 或混合。
   - 滞销/低评分/低信任：禁止盲目 FBO。

3. 工作流画布新增节点
   - `履约利润体检`
   - `FBO/FBS 策略确认`
   - `补充成本假设`
   - `库存/仓储风险观察`

### 验收标准

- 店铺体检报告必须明确：是否存在 FBO 误用风险。
- 没有成本数据时不能编造净利，必须进入阻断或假设模式。
- 每个 FBO 建议必须带 SKU 周转、毛利、季节性和库存风险理由。

## 10. Phase 8：广告质量分与投放就绪诊断

### 目标

把广告建议从“预算/CPC/关键词”升级为“是否具备投放资格”的诊断。

### 主要改造

1. 新增 `ad_readiness_score`
   - 评分、评论数、买家秀、物流时效、页面完整度、关键词相关性、历史销量。
   - 输出 `ready_to_scale_ads`，而不是默认建议加预算。

2. 广告任务分层
   - `不可投放`: 评分/评论/页面/履约基础不足。
   - `小预算验证`: 基础合格但证据不足。
   - `可放量`: 质量分和履约稳定。

3. 报告输出新增

```json
{
  "ad_quality_readiness": {
    "score": 0,
    "blocking_factors": [],
    "recommended_campaign_type": "none|test|scale|brand_defense",
    "required_pre_ad_tasks": []
  }
}
```

### 验收标准

- 插件不得在低评分、低评论、页面弱、本地化弱时直接建议放量广告。
- 广告建议必须说明是“修基础”“测关键词”还是“放量”。
- 趋势/机会报告如果建议投放，必须引用 `ad_quality_readiness`。

## 11. Phase 9：库存断崖与季节性风险雷达

### 目标

把库存、下架、错过季节窗口和现金流风险纳入经营案件。

### 主要改造

1. 新增 `inventory_risk_radar`
   - 识别库存不足、滞销、季节性、认证周期、入库时效、区域履约风险。

2. Seller API 同步增强
   - 能读取库存/订单/退货/发货数据时，建立 SKU 级库存健康状态。
   - 无 API 时允许用户输入人工假设，但必须标记 `evidence_quality=C/D`。

3. 画布新增观察节点
   - `补货确认`
   - `库存风险观察`
   - `季节窗口倒计时`
   - `滞销处理`

### 验收标准

- 趋势机会必须判断是否赶得上季节窗口。
- 机会扩品必须输出库存/认证/入库周期风险。
- 店铺体检必须列出 P0 库存断崖风险。

## 12. Phase 10：反脆弱经营案件系统

### 目标

把文章里的“反脆弱生存法则”落成产品概念：插件不只给优化建议，而是生成抗风险经营案件。

### 新增案件类型

```text
profit_repair_case        利润修复案件
fulfillment_rebalance_case 履约重平衡案件
ad_readiness_case         广告就绪案件
inventory_defense_case    库存防线案件
localization_trust_case   本地化信任案件
compliance_blocker_case   合规阻断案件
cashflow_protection_case  现金流保护案件
```

### 案件规则

- 如果店铺定位不清，先进入 `localization_trust_case` 或 `positioning_rebuild`。
- 如果净利不清，禁止直接进入广告放量。
- 如果履约不稳，优先进入 `fulfillment_rebalance_case`。
- 如果库存断崖，优先级高于 Listing 改版。
- 如果合规缺证，必须阻断发布/扩品。

### 验收标准

- 画布根节点不再固定为单一路径，而是根据店铺诊断自动生成不同案件。
- 低毛利/履约不稳店铺不会优先生成“改标题/改主图”任务。
- 商品机会必须先通过利润、履约、合规和库存四道门。

## 13. Phase 11：增长档案库、导出与证据包

### 目标

吸收前一轮开源归档工具分析，把 Ozon 插件变成可沉淀、可导出、可审计、可私有化的数据产品。

### 主要改造

1. 新增 `Growth Archive`
   - 店铺档案
   - 商品档案
   - 竞品档案
   - 趋势档案
   - 货源档案
   - 报告档案
   - 实验档案

2. 多格式导出
   - HTML
   - Markdown
   - JSON
   - PDF
   - Excel
   - ZIP 证据包

3. 证据包结构

```text
ozon-growth-case.zip
  report.pdf
  report.html
  report.md
  data.json
  seller_api_snapshot.json
  screenshots/
  workflow_log.json
  evidence_ledger.json
```

4. 隐私与数据控制中心
   - 查看本地保存了什么。
   - 查看哪些数据会发送给 AI。
   - 单店铺删除。
   - 单报告删除。
   - 一键清空本地档案。
   - 导出全部本地档案。

### 验收标准

- 每份工业级报告都能导出证据包。
- 报告中心支持筛选、搜索、批量删除、批量导出。
- 用户能明确看到数据来源和数据新鲜度。

## 14. Phase 12：真实运营业务流测试矩阵

### 目标

把插件验收从静态 smoke 升级为真实经营任务验收。

### 测试场景

1. **店铺体检 -> 利润/履约阻断**
   - 输入真实店铺页。
   - 输出是否需要定位重构、FBO/FBS 重平衡、广告就绪、库存防线。

2. **趋势 -> 本店适配**
   - 在店铺页运行趋势。
   - 输出平台有无机会，以及本店是否适合做。

3. **机会 -> 货源 -> 利润**
   - 从趋势机会进入寻源。
   - 至少 2 个供应商。
   - 输出 landed cost、净利假设和履约风险。

4. **广告就绪**
   - 对低评分/低评论商品运行广告诊断。
   - 必须先生成修基础任务，而不是放量建议。

5. **库存断崖**
   - 对季节性商品运行机会诊断。
   - 必须输出季节窗口和库存/入库风险。

6. **人工确认 -> 观察 -> 复盘**
   - 用户确认完成一个手工任务。
   - 插件进入观察窗口。
   - 复盘时不得无基线归因。

### 验收命令与人工验证

```text
npm run test:business
npm run test:workflow
npm run test:store-diagnosis
npm run test:sourcing
npm run test:etsy-parity
npm run test:security
npm run test:no-mock
npm run lint
node scripts/qa-validator.mjs
```

人工真机验证必须补充：

- Ozon 店铺页
- Ozon 搜索/类目页
- Ozon 商品详情页
- 竞品店铺页
- 1688/淘宝供应商页
- Google Trends 页面

## 15. 更新后的总优先级

### 新 P0

1. 利润与履约诊断引擎
2. 广告质量分与投放就绪诊断
3. 库存断崖与季节性风险雷达
4. 反脆弱经营案件模型
5. Growth Archive 与证据包基础结构

### 新 P1

1. 报告中心筛选、搜索、批量导出
2. 多格式导出，重点是 PDF/HTML/JSON/ZIP
3. 隐私与本地数据控制中心
4. 内部 workflow API contract
5. 真机业务流验收脚本与验收记录

### 新 P2

1. 本地 worker / 私有化服务形态
2. Docker 或本地桌面版归档服务
3. 开源 README、Roadmap、隐私说明和开发者 API 文档
4. 多店铺经营档案对比
5. 经营指标趋势图和现金流模拟
