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
