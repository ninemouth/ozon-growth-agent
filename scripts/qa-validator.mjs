// scripts/qa-validator.mjs — Automated Quality Assurance Validator for Ozon Assistant

import fs from 'fs';
import path from 'path';

console.log("🔍 Running Ozon AI Assistant QA Validation Suite...");

// Mock outputs to test the validator itself
const mockValidReport = {
  type: "final",
  output: {
    overview: "本报告评估了 Ozon 平台上的电动牙刷，目标销售市场为俄罗斯及独联体市场。",
    analysis: "消费者反馈良好，前台售价为 1290 ₽ 卢布。但在拿样时需注意俄罗斯 TR CU 技术法规所要求的 EAC 认证强制限制。物流成本按 FBS 集运重量 0.4kg 计费。",
    summary: "本款电动牙刷利润空间较大，建议启动 1688 图片开发并向供应商索要 EAC 声明书。",
    data: [
      {
        title: "Электрическая зубная щетка ультразвуковая",
        product_link: "https://detail.1688.com/offer/65489012.html",
        target_profile: {
          visual_descriptors: "蓝色磨砂手柄，附带4个欧标配头",
          refined_query: "超声波智能电动牙刷",
          routing_decision: "非标品(图片检索)"
        },
        spec_audit: {
          target_spec: "智能充电底座，5挡震动",
          sourced_spec: "USB直充底座，5挡震动",
          status: "完全一致"
        },
        financial_ledger: {
          sourcing_cost: "25",
          shipping_cost: "350",
          target_price: "1290",
          margin_rate: "32"
        },
        trend_evidence: "在 Ozon 上月销量超过 1500 件，俄罗斯买家对清洁模式非常满意。"
      }
    ]
  }
};

const mockInvalidReport = {
  type: "final",
  output: {
    overview: "测试报告（缺少市场和货币信息）",
    analysis: "使用 DOM 抓取工具提取到了 $25 的价格，决定使用 1688 关键词查找货源。",
    summary: "可以做，没有写 EAC 认证说明。",
    data: [
      {
        title: "电动牙刷",
        product_link: "https://s.1688.com/search?q=electric_toothbrush", // Search lists links not allowed!
        target_profile: {}, // Empty target profile
        spec_audit: {
          status: "材质缩水" // Rejected status should block!
        },
        financial_ledger: {
          sourcing_cost: "25",
          shipping_cost: "350",
          target_price: "25", // Rubles vs USD mismatch or low margin
          margin_rate: "0"
        },
        trend_evidence: "太短"
      }
    ]
  }
};

const mockValidShopOptimizerReport = {
  type: "final",
  output: {
    overview: "## Ozon 店铺诊断\n目标市场为俄罗斯及独联体市场，本轮判定为 B 级系统化整改。",
    analysis: "以 Ozon 页面视觉、Seller API 流量和俄区站外趋势为基础，输出 ABC 分级优化候选方案，所有金额均以 ₽ / RUB 表示。",
    summary: "第一优先级执行 B-1 主图俄语卖点改版，随后验证加购率变化。",
    data: [
      {
        plan_id: "B-1",
        title: "主图与画廊俄语卖点改版",
        diagnosis_level: "B",
        direction: "补齐首图俄语卖点、尺寸对比和包装承诺，提高点击后的信任转化。",
        evidence: "当前页面截图显示首图信息密度不足，Ozon API 加购率低于预期，趋势来源已标记为待验证。",
        evidence_ledger: [
          {
            source_type: "page_dom",
            source_ref: "当前 Ozon 商品页",
            observed_value: "标题和详情存在俄语卖点表达不足",
            used_for: "判断 B 级视觉与 SEO 整改",
            confidence: "medium",
            limitation: "仅基于当前页面上下文"
          },
          {
            source_type: "assumption",
            source_ref: "Google Trends RU 待验证",
            observed_value: "站外趋势尚未取得真实工具结果",
            used_for: "趋势判断仅列为待验证假设",
            confidence: "low",
            limitation: "趋势工具未访问，不得写成已验证事实"
          }
        ],
        expected_impact: "提升点击后的加购率和详情页停留信任。",
        first_actions: ["重做首图", "补充俄语规格图", "7 天后对账 API 加购率"],
        risk_guard: "不得伪造趋势和订单数据。"
      }
    ]
  }
};

const mockInvalidShopOptimizerReport = {
  type: "final",
  output: {
    overview: "## Ozon 店铺诊断\n目标市场为俄罗斯及独联体市场。",
    analysis: "建议直接推荐对齐货源，并输出采购直达链接。",
    summary: "货源 #1 可以立刻采购。",
    data: [
      {
        title: "1688 对齐货源",
        product_link: "https://detail.1688.com/offer/123.html",
        evidence: "看起来相似"
      }
    ]
  }
};

function runValidation(report, userInstruction, isOzonSpecific = true) {
  const errors = [];
  const out = report.output;

  if (!out || !out.overview || !out.analysis || !out.summary || !Array.isArray(out.data)) {
    return ["报告结构不完整，必须包含 overview, analysis, summary 和 data 数组！"];
  }

  const overviewText = out.overview || "";
  const analysisText = out.analysis || "";
  const combinedText = overviewText + analysisText + (out.summary || "");

  // 1. Technical Jargon Check
  const jargonRegex = /read_current_page|open_new_tab|click_by_text|DOM|xpath|自愈程序|爬虫/i;
  if (jargonRegex.test(combinedText)) {
    errors.push("报告正文中包含内部技术黑话或函数名（如 DOM, xpath, click 等），应当过滤翻译为通俗的商业术语！");
  }

  // 2. Ozon Specific checks
  if (isOzonSpecific) {
    // Target Market Check
    if (!combinedText.includes("俄罗斯") && !combinedText.includes("独联体") && !combinedText.includes("CIS")) {
      errors.push("未在全局概述或分析中明确判定目标销售目的地市场为“俄罗斯及独联体市场”！");
    }

    // Ruble Currency Sign Check
    const hasRubSign = combinedText.includes("₽") || combinedText.includes("RUB") || combinedText.includes("卢布");
    if (!hasRubSign) {
      errors.push("评估报告正文中未检测到卢布 (RUB/₽) 计价单位！");
    }
  }

  // 3. Data array items check
  out.data.forEach((item, idx) => {
    const title = item.title || `商品 #${idx + 1}`;
    
    // Sourcing details check
    const link = item.product_link || item.link || "";
    if (!link) {
      errors.push(`第 ${idx + 1} 项商品 (${title}) 没有提供采购直达链接！`);
    } else if (link.includes("s.1688.com") || link.includes("search?")) {
      errors.push(`第 ${idx + 1} 项商品 (${title}) 提供的链接是搜索列表页，必须是 detail.1688.com/offer/ 具体的详情单页！`);
    }

    // Profile check
    const profile = item.target_profile || {};
    if (!profile.visual_descriptors || !profile.refined_query || !profile.routing_decision) {
      errors.push(`第 ${idx + 1} 项商品 (${title}) 的 target_profile 分类特征对象不完整，缺少外观描述或分流决策！`);
    }

    // Spec Audit check
    const spec = item.spec_audit || {};
    if (spec.status === "材质缩水" || spec.status === "一票否决淘汰") {
      errors.push(`第 ${idx + 1} 项商品 (${title}) 的规格对比状态为一票否决/材质缩水，绝对禁止推荐为采购货源！`);
    }

    // Financial check
    const ledger = item.financial_ledger || {};
    if (isOzonSpecific) {
      const priceVal = parseFloat(ledger.target_price);
      if (priceVal && priceVal < 100) {
        errors.push(`第 ${idx + 1} 项商品 (${title}) 的售价为 ${priceVal}，怀疑是人民币/美元错乱，Ozon 卢布售价不应该低于 100₽！`);
      }
    }

    const margin = parseFloat(ledger.margin_rate);
    if (Number.isNaN(margin) || margin < 20) {
      errors.push(`第 ${idx + 1} 项商品 (${title}) 的利润率低于 20% 限值，不符合高毛利跨境套利策略！`);
    }

    // Evidence check
    const evidence = item.trend_evidence || item.selection_rationale || "";
    if (!evidence || evidence.trim().length < 20) {
      errors.push(`第 ${idx + 1} 项商品 (${title}) 的选品证据 (trend_evidence) 过短，必须提供至少 20 字的数据或差评支撑逻辑！`);
    }
  });

  // 4. EAC Certification warning check for specific goods
  if (isOzonSpecific) {
    const isToothbrush = userInstruction.includes("牙刷") || combinedText.includes("牙刷") || combinedText.includes("电器");
    if (isToothbrush && !combinedText.toLowerCase().includes("eac")) {
      errors.push("⚠️ 警告：该商品属于个护/通电类目，应在报告中发出“需取得俄罗斯 TR CU EAC 声明书”的合规性预警！");
    }
  }

  return errors;
}

function runShopOptimizerValidation(report) {
  const errors = [];
  const out = report.output || {};
  const combinedText = `${out.overview || ""}\n${out.analysis || ""}\n${out.summary || ""}`;
  if (/货源\s*#|推荐对齐货源|采购直达|detail\.1688\.com|s\.1688\.com/i.test(combinedText)) {
    errors.push("店铺优化报告不得输出货源编号、采购直达链接或 1688 推荐清单。");
  }
  if (!Array.isArray(out.data) || out.data.length === 0) {
    errors.push("店铺优化报告必须输出 A/B/C 分级优化方案。");
    return errors;
  }
  out.data.forEach((item, idx) => {
    const title = item.title || item.plan_id || `方案 #${idx + 1}`;
    const planText = `${item.plan_id || ""} ${item.diagnosis_level || ""} ${item.direction || ""} ${title}`;
    if (!/\b[ABC]-?\d*\b|A级|B级|C级|方案|优化|整改|诊断/i.test(planText)) {
      errors.push(`第 ${idx + 1} 项 (${title}) 不是 A/B/C 优化方案。`);
    }
    if (/1688\.com/i.test(String(item.product_link || item.link || ""))) {
      errors.push(`第 ${idx + 1} 项 (${title}) 包含 1688 采购链接。`);
    }
    const ledger = item.evidence_ledger;
    if (!Array.isArray(ledger) || ledger.length === 0) {
      errors.push(`第 ${idx + 1} 项 (${title}) 缺少 evidence_ledger。`);
    }
  });
  return errors;
}

// ── Execute QA Tests ──
console.log("\n🧪 Test Case 1: Validating a perfectly formatted Ozon Sourcing Report...");
const errors1 = runValidation(mockValidReport, "审计该电动牙刷的选品可行性与EAC认证风险");
if (errors1.length === 0) {
  console.log("  ✅ Test Case 1 PASSED: Perfect report validation succeeded!");
} else {
  console.error("  ❌ Test Case 1 FAILED:", errors1);
}

console.log("\n🧪 Test Case 2: Validating a broken/jargon-filled report...");
const errors2 = runValidation(mockInvalidReport, "审计该电动牙刷的选品可行性与EAC认证风险");
if (errors2.length > 0) {
  console.log(`  ✅ Test Case 2 PASSED: Successfully detected ${errors2.length} issues:`);
  errors2.forEach((err, idx) => console.log(`     ${idx + 1}. ${err}`));
} else {
  console.error("  ❌ Test Case 2 FAILED: Failed to detect critical issues in broken report!");
}

console.log("\n🧪 Test Case 3: Validating a properly structured Ozon Shop Optimizer report...");
const errors3 = runShopOptimizerValidation(mockValidShopOptimizerReport);
if (errors3.length === 0) {
  console.log("  ✅ Test Case 3 PASSED: Shop optimizer report validation succeeded!");
} else {
  console.error("  ❌ Test Case 3 FAILED:", errors3);
}

console.log("\n🧪 Test Case 4: Validating a shop optimizer report polluted by sourcing output...");
const errors4 = runShopOptimizerValidation(mockInvalidShopOptimizerReport);
if (errors4.length > 0) {
  console.log(`  ✅ Test Case 4 PASSED: Successfully detected ${errors4.length} shop optimizer issues:`);
  errors4.forEach((err, idx) => console.log(`     ${idx + 1}. ${err}`));
} else {
  console.error("  ❌ Test Case 4 FAILED: Failed to detect sourcing contamination in shop optimizer report!");
}

console.log("\n=========================================");
console.log("🎉 QA Validator Suite completed.");
