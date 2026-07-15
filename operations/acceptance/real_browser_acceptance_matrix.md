# Ozon Growth Agent 真实浏览器业务流验收矩阵

生成时间：2026-07-15T09:42:23.236Z

说明：该矩阵用于真实 Chrome/Ozon/1688/淘宝/Google Trends 环境验收。脚本本身不访问外网，也不把静态检查伪装成真机通过。

## 验收项

### RB-01 Ozon 店铺体检
- 起始页面：Ozon seller/store page
- 触发入口：右侧悬浮栏：店铺体检
- 必须留存证据：
  - [ ] 平台属性、店铺定位、调性/格调读取
  - [ ] Ozon 搜索/榜单证据
  - [ ] 2-3 个同类高排名店铺/页面截图与 DOM 证据
  - [ ] diagnostic_depth_matrix 与 competitor_benchmarks
  - [ ] savedResults.evidence_bundle.screenshotRefs 非空
- 通过标准：
  - [ ] 不会只凭当前截图输出结论
  - [ ] 不关闭 source Ozon tab
  - [ ] 报告中心可阅读报告、下载 PDF、下载证据包
  - [ ] PDF 尾页包含证据包摘要
- 结论：未执行 / 通过 / 阻断
- 阻断说明：

### RB-02 平台趋势 / Google Trends
- 起始页面：Ozon seller/store page or Ozon category/search page
- 触发入口：右侧悬浮栏：平台趋势
- 必须留存证据：
  - [ ] trend_context_type 标记店铺页/平台页/搜索页语境
  - [ ] Google Trends RU 页面稳定等待后截图/DOM 证据
  - [ ] Google/Yandex/Ozon 搜索证据分工清晰
  - [ ] 临时站外 tab 完成后可关闭，source Ozon tab 保留
- 通过标准：
  - [ ] 关闭当前 Ozon 主 tab 时任务可中断并保留 checkpoint
  - [ ] 打开新会话不会恢复旧 checkpoint
  - [ ] 历史会话恢复只恢复用户选择的 checkpoint
  - [ ] 报告不得把加载失败的 Google Trends 当作趋势结论
- 结论：未执行 / 通过 / 阻断
- 阻断说明：

### RB-03 Ozon 商品诊断 / 评论采集
- 起始页面：Ozon product detail page
- 触发入口：右侧悬浮栏：商品分析/评论分析
- 必须留存证据：
  - [ ] 商品标题、价格、参数、图片、评论 DOM 证据
  - [ ] collect_reviews 低星评论尝试记录
  - [ ] 评论分页/滚动受阻时 blockingGaps 明确
  - [ ] review_dom evidence ledger
- 通过标准：
  - [ ] 不能仅凭商品首屏截图推导买家痛点
  - [ ] 低星评论失败必须降级为待验证，不伪造评价结论
- 结论：未执行 / 通过 / 阻断
- 阻断说明：

### RB-04 供应商货源 / 1688 图搜
- 起始页面：Ozon product page with target image
- 触发入口：右侧悬浮栏：供应商货源
- 必须留存证据：
  - [ ] 以图搜图进入 1688 结果页
  - [ ] 结果页 productCards 包含候选主图、价格、链接
  - [ ] apply_page_filter 返回 candidateTexts 与 filterEvidence
  - [ ] 打开 2 个以上供应商详情页比较
  - [ ] 货源报告 data 至少 2 个供应商候选
- 通过标准：
  - [ ] 拿到图搜结果后不循环切换关键词搜索
  - [ ] 文本搜索只在图片搜索明确阻断或用户允许时使用
  - [ ] 详情页 tab 生命周期受 workflow 管理
- 结论：未执行 / 通过 / 阻断
- 阻断说明：

### RB-05 供应商货源 / 淘宝兜底
- 起始页面：Ozon product page with target image
- 触发入口：右侧悬浮栏：供应商货源，1688 受阻后兜底
- 必须留存证据：
  - [ ] 淘宝/天猫结果页 DOM 与截图证据
  - [ ] 排序/价格/销量语义筛选 candidateTexts
  - [ ] go_next_page 翻页 evidence diff
  - [ ] 2 个以上供应商或明确阻断缺口
- 通过标准：
  - [ ] 不能把搜索列表页伪装成供应商详情页
  - [ ] 不能推荐规格/材质明显不一致的货源
- 结论：未执行 / 通过 / 阻断
- 阻断说明：

### RB-06 报告中心 / 证据归档
- 起始页面：dashboard.html reports tab
- 触发入口：打开报告中心
- 必须留存证据：
  - [ ] 报告正文 Markdown/JSON 正常格式化
  - [ ] 复制按钮复制业务报告正文
  - [ ] PDF 中文不乱码
  - [ ] PDF 含证据包摘要尾页
  - [ ] 证据包 JSON 含 artifact_manifest
- 通过标准：
  - [ ] 删除只删除目标报告
  - [ ] 证据包 missing artifact 明确显示，不静默失败
- 结论：未执行 / 通过 / 阻断
- 阻断说明：
