# Ozon 增长插件阶段 1-6 升级完成记录

日期：2026-07-14

## 完成概览

本轮按 `operations/ozon_growth_agent_upgrade_plan.md` 推进了 Phase 1-6 的可执行落地。重点不是继续堆功能按钮，而是把趋势、店铺体检、机会、寻源、Listing、复盘统一收口到：

```text
research_scope
  -> evidence_quality
  -> report_status / blocking_gaps
  -> follow_up_tasks / workflow_nodes
  -> growthCases
  -> dashboard 画布与 PIP 消费
```

## Phase 1：Research Scope 与页面角色识别

已完成：

- 新增 `modules/researchScope.js`
- 支持识别：
  - `owned_store`
  - `owned_product`
  - `ozon_home`
  - `ozon_search`
  - `ozon_category`
  - `competitor_store`
  - `competitor_product`
  - `supplier_page`
  - `unknown`
- 输出：
  - `entry_page_type`
  - `source_page_role`
  - `analysis_scope`
  - `trend_context_type`
  - `scope_confidence`
  - `needs_user_clarification`
  - `allowed_conclusions`
  - `forbidden_conclusions`
- `background.js` 在技能运行前构建并冻结 `pageContext.research_scope`。
- checkpoint 保存 `research_scope`，断点恢复时优先沿用旧范围，避免 active tab 漂移。

验证：

- `npm run test:research-scope`

## Phase 2：趋势上下文分流

已完成：

- `ozon_platform_trends.skill.md` 新增趋势上下文契约。
- 趋势报告必须输出：
  - `trend_context_type`
  - `research_scope`
  - `platform_signal`
  - `store_fit`
- 支持趋势上下文：
  - `store_trend_fit`
  - `platform_trend`
  - `category_opportunity`
  - `product_opportunity`
  - `competitor_learning`
  - `sourcing_validation`
  - `unknown`
- `agentLoop` validator 强制检查趋势上下文字段。
- 弱上下文或需要用户确认时，`report_status` 不能是 `completed`。

验证：

- `npm run test:trend-context`
- `npm run test:etsy-parity`

## Phase 3：画布案件模型与前端消费

已完成：

- 新增 `modules/growthCaseStore.js`
- AI 成功运行后，`background.js` 同步保存：
  - `savedResults`
  - `growthCases`
- `growthCases` 现在包含：
  - `research_scope`
  - `evidence_quality`
  - `nodes`
  - `tasks`
  - `blocking_gaps`
  - `reportIds`
  - `runs`
- `dashboard.js` 合并后端案件任务到 Scrum board。
- `mergeGrowthCasesWithRoots` 保留后端案件的节点、任务、证据质量和研究范围。
- PIP 弹窗显示：
  - 研究范围
  - 证据质量
  - 阻断缺口
  - 案件节点

验证：

- `npm run test:growth-case`
- `npm run test:business`

## Phase 4：证据质量与数据新鲜度产品化

已完成：

- 新增 `modules/evidenceQuality.js`
- 根据 `evidence_ledger` 生成证据等级：
  - A：Seller API、供应商详情页、官方政策/法规
  - B：Ozon 搜索、Yandex、Google RU、Google Trends
  - C：页面文本、截图、采购搜索结果
  - D：assumption / blocked / 无真实证据
- 保存到 `savedResults.evidence_quality` 和 `growthCases.evidence_quality`
- Dashboard PIP 展示证据等级、缺口数量、截图模式和摘要。

验证：

- `npm run test:evidence-quality`

## Phase 5：人工确认、观察窗口与复盘归因

已完成：

- `follow_up_tasks` 被映射成画布任务。
- `requires_manual_confirmation=true` 的任务在画布中标记为人工确认。
- 点击任务状态按钮时记录：
  - `manualConfirmedAt`
  - `observationWindow`
- 兼容现有 `growthWorkflowTaskState`。
- 运营追踪 skill 已要求 baseline/comparison/observation window；无基线不得归因。

验证：

- `npm run test:workflow`
- `npm run test:business`
- `npm run test:skills`

## Phase 6：真实业务流测试矩阵

已完成静态与契约层测试矩阵：

- `scripts/research-scope-smoke.mjs`
- `scripts/trend-context-smoke.mjs`
- `scripts/growth-case-contract-smoke.mjs`
- `scripts/evidence-quality-smoke.mjs`

已通过现有完整回归：

- `npm run test:business`
- `npm run test:workflow`
- `npm run test:store-diagnosis`
- `npm run test:sourcing`
- `npm run test:etsy-parity`
- `npm run test:security`
- `npm run test:no-mock`
- `npm run test:update`
- `npm run lint`
- `node scripts/qa-validator.mjs`
- `git diff --check`

仍需后续真机人工验证：

- 在真实 Ozon 首页无关键词触发趋势，确认输出范围确认节点而不是 completed 报告。
- 在真实 Ozon 搜索页触发趋势，确认类目/关键词趋势分流。
- 在真实商品页触发商品机会/寻源，确认不会误判为自营商品。
- 在真实竞品店铺页触发竞品学习，确认不会写成自营店铺。
- 人工点击“已执行”后，真实观察窗口和运营追踪链路需要再跑一轮 UI 验证。

## 风险边界

本轮已经完成 Phase 1-6 的工程落地和静态/契约回归，但真实网页动态性仍需要真机验收。尤其是 Ozon 登录态、地区、验证码、页面结构变动和 Google Trends 加载状态，仍可能影响最终业务报告质量。

这些风险不会回退到“模型臆断”，因为现在会进入：

- `report_status=partial|blocked|assumption_only`
- `blocking_gaps`
- `follow_up_tasks`
- `workflow_nodes`
- `evidence_quality=D`

## 后续建议

下一轮优先做真实 Chrome 业务流验收，并把真机结果补进 `operations`：

1. Ozon 首页趋势
2. Ozon 搜索页趋势
3. Ozon 商品页机会
4. 竞品店铺学习
5. 货源图搜与 2 供应商比价
6. 人工确认 -> 观察窗口 -> 运营追踪复盘
