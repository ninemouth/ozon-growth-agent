import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const skill = read("skills/ozon_global_shop_optimizer.skill.md");
const tools = read("modules/toolRegistry.js");
const agentLoop = read("modules/agentLoop.js");
const background = read("background.js");

assert.match(skill, /collect_ozon_competitor_shops/, "Ozon store diagnosis must require batch competitor collection");
assert.match(skill, /collect_ozon_shop_pages/, "Ozon store diagnosis must require single-page competitor collection");
assert.match(skill, /analyze_ozon_shop_crawl_screenshots/, "Ozon store diagnosis must require screenshot stage analysis");
assert.match(skill, /stage_observations/, "Ozon store diagnosis must require staged screenshot observations");
assert.match(skill, /stage_synthesis/, "Ozon store diagnosis must require staged competitor synthesis");
assert.match(skill, /stage_report_inputs/, "Ozon store diagnosis must feed report inputs from screenshot analysis");
assert.match(skill, /competitor_benchmarks/, "Ozon store diagnosis must require competitor_benchmarks");
assert.match(skill, /diagnostic_depth_matrix/, "Ozon store diagnosis must require diagnostic_depth_matrix");
assert.match(skill, /当前 viewport 截图/, "Ozon store diagnosis must state screenshot coverage limits");
assert.match(skill, /全店全部 SKU|完整 SKU 结构/, "Ozon store diagnosis must prevent visible samples from being claimed as full inventory");

assert.match(tools, /collect_ozon_shop_pages:\s*async/, "toolRegistry must expose collect_ozon_shop_pages");
assert.match(tools, /collect_ozon_competitor_shops:\s*async/, "toolRegistry must expose collect_ozon_competitor_shops");
assert.match(tools, /analyze_ozon_shop_crawl_screenshots:\s*async/, "toolRegistry must expose analyze_ozon_shop_crawl_screenshots");
assert.match(tools, /putDataUrlArtifact/, "Ozon competitor screenshots must be stored as artifacts");
assert.match(tools, /getArtifactDataUrl/, "Ozon screenshot analysis must read screenshot artifacts");
assert.match(tools, /captureVisibleTab/, "Ozon competitor collection must capture live page screenshots");
assert.match(tools, /nextStepInstruction/, "Ozon screenshot analysis must instruct the final report step");

assert.match(agentLoop, /validateOzonShopDiagnosisDepth/, "agentLoop must validate Ozon store diagnosis depth");
assert.match(agentLoop, /competitor_benchmarks/, "agentLoop must reject missing competitor_benchmarks");
assert.match(agentLoop, /diagnostic_depth_matrix/, "agentLoop must reject missing diagnostic_depth_matrix");
assert.match(agentLoop, /collect_ozon_competitor_shops/, "agentLoop must recognize Ozon competitor collection evidence");
assert.match(agentLoop, /analyze_ozon_shop_crawl_screenshots/, "agentLoop must require Ozon screenshot stage analysis");
assert.match(agentLoop, /urlWasCrawled/, "agentLoop must verify competitor URLs against crawled evidence");
assert.match(agentLoop, /Ozon 店铺体检额外强制结构/, "agentLoop prompt must explicitly allow required top-level diagnosis fields");

assert.match(background, /ozon_global_shop_optimizer/, "background must still route store diagnosis to the Ozon optimizer skill");

console.log("Ozon store diagnosis parity smoke passed.");
