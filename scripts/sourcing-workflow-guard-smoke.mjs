import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getSourcingWorkflowGuardError,
  hasTechnicalJargonInBusinessReport,
  normalizeFinalReportEvidenceLedger,
  sanitizeFinalReportBeforeCritic,
  sanitizeFinalReportForBusinessAudience,
} from "../modules/agentLoop.js";

const sourcingSkillMarkdown = fs.readFileSync(new URL("../skills/ozon_sourcing_finder.skill.md", import.meta.url), "utf8");
const agentLoopSource = fs.readFileSync(new URL("../modules/agentLoop.js", import.meta.url), "utf8");

assert.match(sourcingSkillMarkdown, /至少 2 个可比供应商候选/, "Ozon sourcing skill should require at least two comparable suppliers");
assert.match(sourcingSkillMarkdown, /不足以形成供应商比价/, "Ozon sourcing skill should require shortage explanation when fewer than two suppliers pass");
assert.match(agentLoopSource, /默认必须返回至少 2 个可比供应商候选/, "agent loop critic should enforce two-supplier sourcing reports");
assert.match(agentLoopSource, /Critic 已自动清理报告中的内部技术措辞/, "agent loop should sanitize report jargon instead of blindly restarting evidence collection");

const completedImageSearchHistory = [
  {
    tool: "image_search_1688",
    arguments: { imageUrl: "https://img.ozon.ru/product.jpg" },
    result: {
      ok: true,
      tabId: 101,
      pageData: {
        url: "https://s.1688.com/youyuan/index.htm",
        productCards: [
          {
            index: 1,
            title: "金属置物架 工厂直供",
            price: "¥18.80",
            href: "https://detail.1688.com/offer/123.html",
            imageSrc: "https://cbu01.alicdn.com/img/ibank/123.jpg",
            cardRect: { x: 10, y: 100, width: 220, height: 320 },
          },
        ],
      },
    },
  },
];

const blockTaobaoSwitch = getSourcingWorkflowGuardError({
  skillId: "skills/ozon_sourcing_finder.skill.md",
  toolName: "image_search_taobao",
  toolArgs: { imageUrl: "https://img.ozon.ru/product.jpg" },
  userInstruction: "请为当前 Ozon 商品筛选供应商货源",
  toolHistory: completedImageSearchHistory,
});

assert.ok(blockTaobaoSwitch, "should block switching to Taobao after 1688 product cards exist");
assert.match(blockTaobaoSwitch.error, /productCards\/productLinks|打开 1-3 个最相似的详情页/);
assert.equal(blockTaobaoSwitch.previousSearch.tool, "image_search_1688");
assert.equal(blockTaobaoSwitch.previousSearch.productCards.length, 1);

const blockTextSearch = getSourcingWorkflowGuardError({
  skillId: "skills/ozon_sourcing_finder.skill.md",
  toolName: "input_text_and_search",
  toolArgs: { query: "金属置物架" },
  userInstruction: "请为当前 Ozon 商品筛选供应商货源",
  toolHistory: completedImageSearchHistory,
});

assert.ok(blockTextSearch, "should block keyword search after product cards exist");

const allowDetailOpen = getSourcingWorkflowGuardError({
  skillId: "skills/ozon_sourcing_finder.skill.md",
  toolName: "open_new_tab",
  toolArgs: { url: "https://detail.1688.com/offer/123.html" },
  userInstruction: "请为当前 Ozon 商品筛选供应商货源",
  toolHistory: completedImageSearchHistory,
});

assert.equal(allowDetailOpen, null, "should allow opening selected supplier detail page");

const allowSearchAfterDetailEvidence = getSourcingWorkflowGuardError({
  skillId: "skills/ozon_sourcing_finder.skill.md",
  toolName: "image_search_1688",
  toolArgs: { imageUrl: "https://img.ozon.ru/another.jpg" },
  userInstruction: "请继续对另一个商品筛选供应商货源",
  toolHistory: [
    ...completedImageSearchHistory,
    {
      tool: "open_new_tab",
      arguments: { url: "https://detail.1688.com/offer/123.html" },
      result: { ok: true, url: "https://detail.1688.com/offer/123.html" },
    },
  ],
});

assert.equal(allowSearchAfterDetailEvidence, null, "should allow later search once a supplier detail page was audited");

const allowExplicitTextFallback = getSourcingWorkflowGuardError({
  skillId: "skills/ozon_sourcing_finder.skill.md",
  toolName: "input_text_and_search",
  toolArgs: { query: "标准无线鼠标" },
  userInstruction: "这是标品，允许文本兜底",
  toolHistory: completedImageSearchHistory,
});

assert.equal(allowExplicitTextFallback, null, "should allow explicit standard-product text fallback");

const sanitizedFinal = sanitizeFinalReportForBusinessAudience({
  type: "final",
  output: {
    overview: "通过 read_current_page 和 DOM 信息完成初筛。",
    analysis: "search_in_browser 已获得 Ozon/Yandex 侧需求，close_tab 后整理报告。",
    summary: "不应暴露 xpath、验证码、人机拦截、自愈程序 等内部措辞。",
    data: [
      {
        title: "候选供应商 A",
        product_link: "https://detail.1688.com/offer/read_current_page.html",
        evidence: "调用指令: search_in_browser 后，基于 DOM 结果判断视觉相似。",
      },
    ],
  },
});

const sanitizedText = [
  sanitizedFinal.output.overview,
  sanitizedFinal.output.analysis,
  sanitizedFinal.output.summary,
  sanitizedFinal.output.data[0].evidence,
].join("\n");

assert.doesNotMatch(sanitizedText, /read_current_page|search_in_browser|close_tab|DOM|xpath|验证码|人机拦截|自愈程序/i, "business report text should not expose internal tool or browser automation jargon");
assert.equal(
  sanitizedFinal.output.data[0].product_link,
  "https://detail.1688.com/offer/read_current_page.html",
  "sanitizer should not mutate URL/link fields"
);

const preCriticInput = {
  type: "final",
  output: {
    overview: "通过 read_current_page 和 DOM 信息完成初筛。",
    analysis: "search_in_browser 已获得 Ozon/Yandex 侧需求，close_tab 后整理报告。",
    summary: "最终不应该让 Critic 才发现 xpath 和自愈程序。",
    data: [
      {
        title: "候选供应商 A",
        product_link: "https://detail.1688.com/offer/read_current_page.html",
        evidence: "调用指令: search_in_browser 后，基于 DOM 结果判断视觉相似。",
      },
    ],
  },
};
assert.equal(hasTechnicalJargonInBusinessReport(preCriticInput), true, "pre-critic hygiene should detect business-text jargon before validateReport");
const preCriticSanitized = sanitizeFinalReportBeforeCritic(preCriticInput);
assert.equal(preCriticSanitized.sanitized, true, "pre-critic hygiene should sanitize final reports before Critic validation");
assert.equal(hasTechnicalJargonInBusinessReport(preCriticSanitized.parsed), false, "pre-critic sanitized final should not expose internal tool terms in business text");
assert.equal(
  preCriticSanitized.parsed.output.data[0].product_link,
  "https://detail.1688.com/offer/read_current_page.html",
  "pre-critic sanitizer should not mutate URL/link fields"
);

const ledgerNormalization = normalizeFinalReportEvidenceLedger({
  type: "final",
  output: {
    overview: "证据来源别名规范化测试。",
    analysis: "不应因为 source_type 近义词进入 Critic 打回。",
    summary: "枚举口径应在审计前修正。",
    data: [
      {
        title: "清退低相关商品，重建垂直家居电器店",
        evidence_ledger: [
          {
            source_type: "page_text",
            source_ref: "当前 Ozon 店铺公开页面",
            observed_value: "店铺类目混杂，垂直度不足",
            used_for: "定位重构判断",
            confidence: "medium",
            limitation: "仅基于公开页面文本",
          },
          {
            source_type: "seller_api",
            source_ref: "已绑定店铺 API 快照",
            observed_value: "低相关 SKU 转化弱",
            used_for: "清退低相关商品优先级",
            confidence: "medium",
            limitation: "需结合最新周期复核",
          },
          {
            source_type: "competitor_page",
            source_ref: "同类头部店铺公开页面",
            observed_value: "头部店铺围绕单一场景组织商品",
            used_for: "垂直定位对标",
            confidence: "medium",
            limitation: "公开页面样本有限",
          },
          {
            source_type: "custom_ai_guess",
            source_ref: "模型推断",
            observed_value: "需要验证的定位假设",
            used_for: "后续人工确认",
            confidence: "low",
            limitation: "原始来源类型不稳定",
          },
        ],
      },
    ],
  },
});
assert.equal(ledgerNormalization.normalized, true, "pre-critic hygiene should normalize evidence ledger source aliases");
assert.deepEqual(
  ledgerNormalization.parsed.output.data[0].evidence_ledger.map((entry) => entry.source_type),
  ["page_dom", "ozon_api", "page_dom", "assumption"],
  "evidence source aliases should map to validator-safe source_type values"
);
assert.match(
  ledgerNormalization.parsed.output.data[0].evidence_ledger[3].limitation,
  /降级为待验证假设/,
  "unknown evidence source_type should be downgraded with an explicit limitation"
);

console.log("sourcing workflow guard smoke passed");
