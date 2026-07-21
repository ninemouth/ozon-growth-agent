/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
// modules/negativeFilters.js — Dynamic "do-not-sell" negative filter for small/micro sellers on Ozon

export const DEFAULT_NEGATIVE_FILTERS = [
  {
    id: "nf_capital_chain",
    title: "高资金占用与长回款周期",
    rationale: "中小微/个体经营者现金流有限，应避免账期长、库存周转慢、一次性投入高的品类。",
    examples: ["高 MOQ 定制款", "需预付大额定金的生产订单", "季节性尾货", "长周期预售众筹款"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend", "shop_optimizer"],
  },
  {
    id: "nf_logistics_oversized",
    title: "超大/超重/易碎/高运费占比",
    rationale: "跨境履约成本对小微卖家是硬约束。体积重高、易碎、需冷链或特殊包装的品类会侵蚀利润并提高破损率。",
    examples: ["大件家具", "大型健身器材", "陶瓷玻璃制品", "液体/膏体/粉末", "超长异形件"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend"],
  },
  {
    id: "nf_compliance_barrier",
    title: "EAC/TR CU 等强制认证壁垒",
    rationale: "俄罗斯对婴童、电器、化妆品、食品接触、医疗器械、电池等品类有强制认证。小微卖家若无稳定供应链配合取证，应回避或标注为高风险待验证。",
    examples: ["儿童玩具", "直插式家电", "个护化妆品", "食品接触材料", "医疗器械", "含电池产品"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend", "compliance"],
  },
  {
    id: "nf_after_sales_risk",
    title: "高退货/高纠纷/尺码敏感",
    rationale: "跨境退货成本高、周期长。尺码、颜色、主观感受差异大的品类容易引发纠纷和差评。",
    examples: ["服装", "鞋靴", "内衣", "珠宝配饰", "假发", "主观审美依赖的装饰品"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend", "review_analyzer"],
  },
  {
    id: "nf_ip_brand_risk",
    title: "IP/品牌/版权侵权风险",
    rationale: "小微卖家法律抗风险能力弱。任何明显仿牌、角色/IP、外观复制、未授权商标词都应直接阻断。",
    examples: ["知名品牌仿品", "动漫/影视角色周边", "专利外观近似款", "未授权商标关键词"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend", "listing_generator", "compliance"],
  },
  {
    id: "nf_platform_restricted",
    title: "Ozon 平台禁限售或需特殊资质",
    rationale: "即使法律允许，Ozon 平台也可能禁售或要求特殊类目资质。必须在平台政策层面做二次确认。",
    examples: ["成人用品", "医疗器械", "药品/保健品", "危险品", "虚拟货币相关", "政治敏感品"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend", "compliance"],
  },
  {
    id: "nf_local_commodity",
    title: "俄罗斯本地易购普通日杂标品",
    rationale: "本地易购、物流成本低、无差异化的普通标品很难在跨境场景建立优势。",
    examples: ["普通纸巾", "基础调味品", "低端日杂", "本地品牌主导的日用品"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend"],
  },
  {
    id: "nf_price_war_dominated",
    title: "大品牌垄断/价格战红海",
    rationale: "头部品牌或大量同质化卖家已经把价格压到微利，小微卖家没有供应链优势时难以切入。",
    examples: ["手机壳膜红海款", "数据线/充电器通用款", "标准化3C配件", "平台自营强势品类"],
    appliesTo: ["product_opportunity", "platform_trend", "shop_optimizer"],
  },
  {
    id: "nf_short_lifecycle",
    title: "短生命周期/强季节性",
    rationale: "流行趋势变化快、季节窗口短的品类要求快速反应和清货能力，中小卖家容易积压。",
    examples: ["快时尚配饰", "节日限定款", "短期网红款", "强季节但无反季销售的品类"],
    appliesTo: ["product_opportunity", "platform_trend"],
  },
  {
    id: "nf_local_service",
    title: "需本地安装/售后/保修服务",
    rationale: "跨境卖家难以提供俄罗斯本地安装、维修、质保服务，这类商品售后风险极高。",
    examples: ["大型家电", "需要安装的家具", "需本地调试的电子设备", "汽车配件"],
    appliesTo: ["sourcing", "product_opportunity", "platform_trend"],
  },
];

const DYNAMIC_FILTER_PATTERNS = [
  /(?:增加|新增|补充|添加).*不卖原则[：:]?\s*(.+?)(?:\n|$)/i,
  /(?:不卖原则|negative filter).*?[:：]\s*(.+?)(?:\n|$)/i,
  /(?:排除|避开|不要推荐|禁止).*?(?:品类|类目|商品|产品)[：:]?\s*(.+?)(?:\n|$)/i,
];

export function extractDynamicNegativeFilters(userInstruction = "") {
  const text = String(userInstruction || "");
  const filters = [];
  for (const pattern of DYNAMIC_FILTER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const raw = match[1].trim();
      if (!raw) continue;
      const items = raw.split(/[,，;；|]/).map((s) => s.trim()).filter(Boolean);
      for (const item of items) {
        filters.push({
          id: `nf_dynamic_${filters.length + 1}`,
          title: item,
          rationale: "用户动态增加的自定义不卖原则。",
          examples: [item],
          appliesTo: ["all"],
          dynamic: true,
        });
      }
    }
  }
  return filters;
}

export function buildNegativeFilterPrompt(skillId = "", userInstruction = "") {
  const dynamicFilters = extractDynamicNegativeFilters(userInstruction);
  const normalizedSkill = String(skillId || "").toLowerCase();

  const relevantDefault = DEFAULT_NEGATIVE_FILTERS.filter((filter) =>
    filter.appliesTo.includes("all") ||
    filter.appliesTo.some((scope) => normalizedSkill.includes(scope)) ||
    normalizedSkill.includes("ozon_")
  );

  const allFilters = [...relevantDefault, ...dynamicFilters];
  if (allFilters.length === 0) return "";

  const lines = allFilters.map((filter, idx) => {
    const examples = filter.examples.length > 0 ? `例如：${filter.examples.join("、")}。` : "";
    return `${idx + 1}. 【${filter.title}】${filter.rationale}${examples}`;
  });

  return `\n\n=========================================\n\n🚫 【平台趋势与经营决策：中小微/个体卖家不卖原则】\n你是服务于中小微/个体经营者的 Ozon 跨境运营助手。在平台趋势分析、选品、寻源、店铺优化和 Listing 生成中，必须默认过滤以下高风险方向；除非用户明确反对某一单项并要求说明理由，否则不得推荐为"可执行机会"。\n\n${lines.join("\n")}\n\n执行要求：\n- 涉及上述原则时，优先在报告中标记为 "高风险/不建议小微卖家进入"，并写入 \`blocking_gaps\` 或 \`risk_guard\`。\n- 如果用户提供的页面/关键词命中上述原则，必须明确提示风险，而不是为了完成报告强行包装成机会。\n- 平台趋势任务中，命中不卖原则的方向只进入 \`rejected_directions\` 简短记录，禁止进入主报告 \`data\`、\`recommended_opportunities\` 或行动项；不要继续花费主要搜索预算深挖已淘汰方向。\n- 如果趋势候选全部被淘汰，必须继续从不同品类扩展候选池，优先轻小件、低认证、低退货、可差异化、适合小批测试的方向，直到找到至少 1 个可卖候选，或真实页面整体阻断并输出 \`blocked\`。\n- 用户可通过指令"增加不卖原则：xxx、yyy"动态追加自定义过滤项；本次已追加的自定义原则见上文。`;
}
