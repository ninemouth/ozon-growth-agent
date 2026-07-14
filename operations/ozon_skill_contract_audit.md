# Ozon 业务 Skill 工业级体检与收口审计

审计日期：2026-07-14

## 审计背景

本轮审计基于已完成的底层升级：

- workflow 断点恢复与任务 lease
- 页面稳定等待、Google Trends 稳定证据判断
- workflow-owned tab 生命周期管理
- Ozon 趋势任务源 tab / Ozon 页面保护
- Chrome debugger full-page evidence screenshot 与 viewport fallback
- 寻源图搜路径锁定、2 个以上供应商对比和 Critic 打回防循环
- 店铺体检不能只凭截图，必须读取平台属性、定位、Ozon 搜索和头部竞品

审计目标不是继续增加“菜单功能”，而是让每个业务 skill 都能变成首页增长工作流画布上的案件节点，具备可恢复、可阻断、可人工确认、可继续推进的工业级输出。

## 统一收口标准

所有 Ozon 业务 skill 的最终 `final.output` 必须至少具备：

- `report_status`: `completed`、`partial`、`blocked` 或 `assumption_only`
- `blocking_gaps`: 关键证据缺口，不能藏在正文一句“有局限”里
- `follow_up_tasks`: 可交给运营人员执行或确认的任务
- `workflow_nodes`: 可被首页画布渲染的节点
- `evidence_ledger`: 每个 data 项的结构化证据账本
- 人工确认节点：所有无法自动完成的动作必须显式标记为 `manual_confirm` 或 `requires_manual_confirmation`

## Skill 体检矩阵

| Skill | 体检结论 | 已收口能力 | 仍需真机业务流验证 |
|---|---|---|---|
| `ozon_global_shop_optimizer` | 主航道已较成熟，本轮补齐顶层 workflow 状态字段 | 店铺体检、定位重构、竞品学习、诊断矩阵、A/B/C 任务化 | 真实店铺 API 未授权、Ozon 页面阻断、竞品页面不足时的降级报告质量 |
| `ozon_platform_trends` | 已是最完整的工业级结构 | 趋势证据、Google Trends 降级、Ozon tab 保护、阻断/任务/节点 | 真实 Chrome 中关闭用户 Ozon tab 后的恢复体验仍建议人工 smoke |
| `ozon_sourcing_finder` | 供应链路径已强约束，本轮补齐画布回写字段 | 图搜优先、结果页锁定、详情页穿透、至少 2 个供应商、利润账本 | 1688/淘宝登录墙、图片搜索浮层和筛选项操作的真机稳定性 |
| `ozon_operations_tracker` | 原有归因门槛正确，本轮补齐报告状态与节点 | baseline/comparison/observation window，归因干扰项，复盘任务 | Seller API 指标缓存与历史人工执行确认的跨会话读取 |
| `ozon_listing_generator` | 原先偏“文案生成”，本轮收口为 Listing 工作流 | 俄语标题、属性、描述、关键词、人工上线确认、观察节点 | Ozon 属性字段真实映射与禁用词/合规策略联动 |
| `ozon_review_analyzer` | 原先偏“评论总结”，本轮收口为缺陷改良工作流 | 评论证据缺口、包装/说明书/履约/供应商质检任务 | 评论分页、图片评论和低星筛选在真实 Ozon 页面上的可读性 |
| `ozon_product_opportunity_explorer` | 原先偏“选品判断”，本轮收口为机会验证案件 | validated/assumption opportunities，趋势、竞品、合规、寻源后续节点 | 平台趋势 skill 与机会 skill 的职责边界和报告去重 |
| `ozon_compliance_auditor` | 原先风险判断清楚，本轮收口为发布前阻断工作流 | 合规阻断、官方来源缺口、补证任务、发布决策节点 | 官方政策/法规搜索证据质量，以及合规结果与 Listing/寻源节点联动 |

## 本轮已落地变更

1. `base_report_auditor.skill.md`
   - 新增统一的增长工作流回写字段要求。
   - 所有 Ozon skill 都通过基座继承 `report_status`、`blocking_gaps`、`follow_up_tasks`、`workflow_nodes`。

2. `ozon_compliance_auditor.skill.md`
   - 新增工业级交付状态。
   - 输出结构增加合规阻断、补证任务和发布决策节点。

3. `ozon_listing_generator.skill.md`
   - 从单纯文案生成升级为 Listing 优化工作流。
   - 明确生成不等于发布，必须有人工确认和上线观察节点。

4. `ozon_review_analyzer.skill.md`
   - 从评论总结升级为评论缺陷改良工作流。
   - 评论分页、图片评论和真实俄语原声缺失时必须阻断或降级。

5. `ozon_product_opportunity_explorer.skill.md`
   - 从机会判断升级为机会验证案件。
   - 机会必须区分 validated 与 assumption，后续可进入合规、寻源、Listing 或实验。

6. `ozon_operations_tracker.skill.md`
   - 从阶段复盘升级为可恢复的实验追踪节点。
   - 没有基线或 API 指标时不得归因，只能建立基线或阻断。

7. `ozon_sourcing_finder.skill.md`
   - 在已有强寻源约束上补齐 `report_status`、阻断、任务和画布节点。

8. `ozon_global_shop_optimizer.skill.md`
   - 补齐顶层 workflow 字段。
   - 明确定位重构属于店铺体检下的 P0 子节点，不是独立业务状态。

9. `scripts/skill-contract-smoke.mjs`
   - 新增 skill 契约回归测试。
   - 防止未来新增或修改 skill 时退回静态报告、缺少画布节点或丢失人工确认。

## 剩余风险

1. 真机 Ozon 页面差异
   - 提示词和运行时已经具备等待/截图/阻断逻辑，但 Ozon 页面结构、登录态、地区、验证码仍可能导致 DOM 薄弱。
   - 需要按真实页面执行一次多 skill 业务流 smoke：店铺体检 -> 机会/趋势 -> 合规 -> Listing -> 追踪。

2. workflow_nodes 的前端消费
   - skill 已要求输出节点，但前端画布是否完整消费所有 skill 的 `workflow_nodes` 还需要进一步端到端测试。

3. 运营追踪历史数据
   - `ozon_operations_tracker` 已要求基线/对比/观察窗口，但历史执行确认、API 缓存和人工动作记录仍需要业务流对齐。

4. 合规官方来源质量
   - 合规 skill 已禁止无证据下结论，但官方政策/法规搜索结果的可信度和来源分类仍需真实搜索验证。

5. 机会与趋势职责边界
   - `ozon_platform_trends` 负责平台级需求窗口；`ozon_product_opportunity_explorer` 负责把机会转成可验证案件。两者组合运行时需要避免重复搜索和重复报告。

## 下一步建议

优先做一轮真实业务流测试，不再只跑静态 smoke：

1. 在一个真实 Ozon 店铺首页运行店铺体检。
2. 从体检报告生成的任务中选择一个趋势/机会节点继续运行。
3. 对一个机会进入合规预审。
4. 对低风险机会进入 Listing 改写。
5. 对已执行的 Listing 改写建立运营追踪基线。
6. 中途关闭一个临时站外 tab 和一个非源 Ozon tab，确认 workflow 能阻断、恢复或保留正确页面。
