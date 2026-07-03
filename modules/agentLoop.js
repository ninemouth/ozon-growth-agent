// modules/agentLoop.js — The Agent reasoning & tool loop logic

import { callLLM, getSettings } from './llmClient.js';
import { tools } from './toolRegistry.js';

const globalSessionCache = {};

function validateReport(parsed, userInstruction, skillId) {
  const errors = [];
  if (!parsed || parsed.type !== "final" || !parsed.output) {
    errors.push("未输出符合格式的 final 报告 JSON 结构");
    return errors;
  }
  const out = parsed.output;
  if (!out.overview || !out.analysis || !out.summary || !Array.isArray(out.data)) {
    errors.push("final 报告缺少必须的属性（overview, analysis, summary 或 data 数组）");
    return errors;
  }

  // 1. Check for technical jargon
  const jargonRegex = /read_current_page|open_new_tab|click_by_text|click_by_selector|input_text_and_search|agentic_web_search|DOM|xpath|GBK 编码|UTF-8|自愈程序|爬虫|人机拦截|验证码/i;
  const checkJargon = (str) => typeof str === "string" && jargonRegex.test(str);
  if (checkJargon(out.overview) || checkJargon(out.analysis) || checkJargon(out.summary)) {
    errors.push("报告正文中包含内部技术黑话或函数名（如 DOM, read_current_page, xpath 等），请过滤并替换为通俗易懂的商业/供应链分析术语！");
  }

  // 2. Check product quantity if specified in instruction
  const numMatch = (userInstruction || "").match(/(\d+)款/);
  if (numMatch) {
    const expectedNum = parseInt(numMatch[1]);
    if (out.data.length < expectedNum) {
      errors.push(`用户要求至少筛选 ${expectedNum} 款商品，但你当前的 data 列表中只有 ${out.data.length} 款，请调用翻页、滚动或抓取工具补充完整，达到 ${expectedNum} 款！`);
    }
  }

  // 3. Sourcing-specific details check (1688 / Taobao links, profiling, spec alignment, profit ledger)
  if ((skillId || "").includes("domestic_sourcing_finder")) {
    out.data.forEach((item, idx) => {
      const title = item.title || item.name || `商品 #${idx + 1}`;
      
      // A. Detail links check
      const link = item.product_link || item.link || "";
      if (!link) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 没有提供采购直达链接！`);
      } else if (link.includes("s.1688.com") || link.includes("search?") || link.includes("offer_search")) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 提供的链接是搜索列表页，必须替换为具体的单品详情页直达链接（格式如 detail.1688.com/offer/XXXX.html）！`);
      }

      // B. Category profiling check (target_profile)
      const profile = item.target_profile;
      if (!profile || typeof profile !== "object" || Object.keys(profile).length === 0) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少分类特征画像属性（target_profile 属性对象）！`);
      } else {
        if (!profile.visual_descriptors || typeof profile.visual_descriptors !== "string" || profile.visual_descriptors.trim().length < 5) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的 target_profile 必须包含多模态提取的外观特征描述（visual_descriptors，如松鼠打伞、材质颜色等）！`);
        }
        if (!profile.refined_query || typeof profile.refined_query !== "string" || profile.refined_query.trim().length < 2) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的 target_profile 必须包含最终构建的中文复合检索词（refined_query，如松鼠打伞喂鸟器）！`);
        }
        if (!profile.routing_decision || !["标品(文本检索)", "非标品(图片检索)"].includes(profile.routing_decision)) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的 target_profile 必须包含检索方式分流决策（routing_decision，取值必须为："标品(文本检索)" 或 "非标品(图片检索)"）！`);
        }
      }

      // C. Spec alignment check (spec_audit)
      const spec = item.spec_audit;
      if (!spec || typeof spec !== "object" || !spec.target_spec || !spec.sourced_spec || !spec.status) {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少规格审计比对参数（spec_audit 必须包含 target_spec、sourced_spec 和 status）！`);
      }

      // D. Profit ledger check (financial_ledger)
      const ledger = item.financial_ledger;
      if (!ledger || typeof ledger !== "object") {
        errors.push(`商品列表第 ${idx + 1} 项 (${title}) 缺少财务账本字段（financial_ledger 属性对象）！`);
      } else {
        const cost = ledger.sourcing_cost || ledger.cost || "";
        const shipping = ledger.shipping_cost || ledger.shipping || "";
        const price = ledger.target_price || ledger.price || "";
        const margin = ledger.margin_rate || ledger.margin || "";
        if (!cost || !shipping || !price || !margin) {
          errors.push(`商品列表第 ${idx + 1} 项 (${title}) 的财务账本不完整（financial_ledger 必须包含 sourcing_cost, shipping_cost, target_price 和 margin_rate）！`);
        }
      }
    });
  }

  // 4. Selection evidence validation (trend_evidence / selection_rationale must be at least 20 chars)
  out.data.forEach((item, idx) => {
    const evidence = item.trend_evidence || item.selection_rationale || "";
    if (!evidence || evidence.trim().length < 20) {
      errors.push(`商品列表第 ${idx + 1} 项 (${item.title || "未命名商品"}) 缺少充分的选品逻辑和证据链（trend_evidence 字段长度必须大于 20 字，需包含真实销量、竞品差评痛点或明确的利润率优势作为选品证据）！`);
    }
  });

  // 5. Inferred target market verification in report text
  const overviewText = out.overview || "";
  const analysisText = out.analysis || "";
  const combinedText = overviewText + analysisText;
  if (!combinedText.includes("市场") && !combinedText.includes("客群") && !combinedText.includes("定位")) {
    errors.push("报告概述 (overview) 或分析 (analysis) 中未体现自主判断的目标销售市场与目标客群定位（例如：‘中国大陆/国内电商’或‘俄罗斯/独联体市场’等），请予以明确陈述！");
  }

  return errors;
}

export function clearSessionCache(tabId) {
  const sessionKey = `${tabId}`;
  if (globalSessionCache[sessionKey]) {
    delete globalSessionCache[sessionKey];
  }
}

export async function runAgentLoop({ tabId, skillId, skillMarkdown, userInstruction, pageContext, sendProgress, continueSession, highRandomness, negativeFilter, maxLoopSteps }) {
  const settings = await getSettings();
  const maxSteps = maxLoopSteps || Math.max(parseInt(settings.maxLoopSteps) || 25, 25);

  let systemPrompt = skillMarkdown;
  if (negativeFilter === false) {
    systemPrompt += `\n\n=========================================\n\n⚠️ 【用户已手动关闭“不卖原则”过滤限制】：当前处于国内国内电商或不受限的宽容寻源环境，用户已手动取消了默认的“不卖原则”（Negative Filter）负面过滤。因此，你【无须】过滤服饰、鞋帽、内衣、大件重货、陶瓷玻璃易碎品、本地容易买到的普通日杂标品或医疗/成人等高风险品类。请完全根据当前页面商品的实际销量表现、货源品质以及用户指令，自由挖掘上述常规品类并推荐它们的源头供应商！`;
  }
  
  const isApiActive = !!(settings.helium10ApiKey || settings.sellerSpriteApiKey);
  const isFastMossActive = !!settings.fastmossApiKey;
  const filteredToolList = Object.keys(tools).filter(name => {
    if (name === "query_market_data") return isApiActive;
    if (name === "query_fastmoss_data") return isFastMossActive;
    return true;
  });
  const availableTools = filteredToolList.join(", ");

  const ctxForPrompt = { ...pageContext };
  const screenshotData = ctxForPrompt.screenshot;
  delete ctxForPrompt.screenshot;

  const userText = `请严格根据 skill 说明执行任务。

## 可用工具
${availableTools}

## 工具调用格式
当需要调用工具时，输出：
\`\`\`json
{"type":"tool_call","tool":"<tool_name>","arguments":{...}}
\`\`\`

## 最终结果格式
请将你最终构思出的结果，**统一组装为标准化的分析报告结构**，完成后输出：
\`\`\`json
{
  "type": "final",
  "output": {
    "overview": "全局概述（使用Markdown，简述你在本页面的核心发现）",
    "analysis": "深度分析过程与推演逻辑（使用Markdown，展示你的多维博弈和决策依据）",
    "summary": "最终核心结论（使用Markdown，提炼出最关键的建议或结论）",
    "data": [ ... ] // 具体的结构化数据（如具体的商品蓝图、筛选出的列表等，必须是数组）
  }
}
\`\`\`


## 当前页面上下文
${JSON.stringify(ctxForPrompt, null, 2)}

## 用户核心焦点 (User Core Focus)
${userInstruction ? `用户补充了以下核心探索方向。这是你的**最高优先级探索目标**。请你**必须将第一步的动作（search_web 或 click），以及后续的所有推演，全部紧紧围绕该主题展开**。但同时，仍需遵守 Skill 中定义的所有避坑与打分原则。\n用户的核心方向是：\n"${userInstruction}"` : "（无额外焦点。请严格按 skill 流程自主探索。）"}

${highRandomness ? `\n\n## ⚠️ [Anti-Cache] 强制发散与破局指令 (Nonce: ${Date.now()})\n用户要求进行**【全新视角的探索】**。请你**完全抛弃最常规、最容易想到的思路**。如果之前的方向是 A，这次请尝试 B 甚至是冷门的 C。突破固有套路，给我极具差异化的答案！` : ""}
`;

  let userContent = userText;
  if (screenshotData) {
    userContent = [
      { type: "text", text: userText },
      { type: "image_url", image_url: { url: screenshotData } }
    ];
  }

  let messages = [];
  const sessionKey = `${tabId}`;

  if (continueSession && globalSessionCache[sessionKey]) {
    messages = globalSessionCache[sessionKey];
    if (messages.length > 0 && messages[0].role === "system") {
      messages[0].content = systemPrompt;
    }

    const newCtx = { ...pageContext };
    delete newCtx.screenshot;
    const ctxString = JSON.stringify(newCtx, null, 2);

    let instructionText = userInstruction 
        ? `[追加指令] 用户对刚才的执行结果提出了新的要求或调整。请严格基于以上的上下文记忆，重新推演并输出最终的 JSON 报告。\n用户的最新要求是：\n"${userInstruction}"` 
        : `[追加指令] 请结合你最新的 System Prompt（你的目标任务可能已经发生了改变），并基于最新的页面上下文进行深度推演。`;
    
    instructionText += `\n\n【⚠️ 极其重要：禁止直接生成/必须调用浏览器工具真实寻源】\n如果你的最新 System Prompt 包含寻源任务（例如需要去 1688、淘宝等平台寻找货源或对比价格），**你绝对禁止直接从历史记忆中复制或凭空捏造虚假的 1688/淘宝 详情页链接！**\n你必须在第一步立即调用 'open_new_tab' 或 'input_text_and_search' 真实地在浏览器中打开 1688 或淘宝进行检索和详情页穿透审计！只有在通过工具真实获取并校验了详情页内容、价格和起批量后，才被允许在最后的报告中写入真实的 1688 详情页链接（格式如 'https://detail.1688.com/offer/XXXX.html'）并输出 final 报告！`;

    instructionText += `\n\n【极其重要：强制输出格式】\n无论你进行了多少轮推演，**你最后一次的输出必须，且只能是如下 JSON 格式**（请包裹在 \`\`\`json 中）：\n\`\`\`json\n{\n  "type": "final",\n  "output": {\n    "overview": "...",\n    "analysis": "...",\n    "summary": "...",\n    "data": [] \n  }\n}\n\`\`\`\n严禁把上述指令文字直接暴露在最终报告中！`;
    instructionText += `\n\n【注意：以下是你当前所处的最新页面上下文数据】\n${ctxString}`;

    let newUserContent = instructionText;
    if (pageContext.screenshot) {
      newUserContent = [
        { type: "text", text: instructionText },
        { type: "image_url", image_url: { url: pageContext.screenshot } }
      ];
    }

    messages.push({
      role: "user",
      content: newUserContent
    });
  } else {
    messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ];
  }

  sendProgress({ type: "start", step: 0, maxSteps });

  for (let step = 1; step <= maxSteps; step++) {
    sendProgress({ type: "thinking", step, maxSteps });

    let assistantContent = "";
    assistantContent = await callLLM(messages, ({ chunk, fullText, isReasoning }) => {
      sendProgress({ type: "streaming", step, chunk, fullText, isReasoning });
    }, highRandomness);

    sendProgress({ type: "llm_done", step, content: assistantContent });

    const parsed = extractJSONBlock(assistantContent);

    if (!parsed) {
      return {
        ok: true,
        type: "text",
        result: assistantContent,
        steps: step,
      };
    }

    if (parsed.type === "final") {
      const validationErrors = validateReport(parsed, userInstruction, skillId);
      if (validationErrors.length > 0) {
        const reflectionsCount = ctxForPrompt.__reflectionsCount || 0;
        if (reflectionsCount < 2 && step < maxSteps - 1) {
          ctxForPrompt.__reflectionsCount = reflectionsCount + 1;
          sendProgress({ type: "reflection", step, message: `Critic 自动审计拒绝：${validationErrors[0]} 正在打回重做...` });
          
          messages.push({ role: "assistant", content: assistantContent });
          messages.push({
            role: "user",
            content: `【Critic Agent 报告质量审计拒绝】\n你的报告未能通过系统的自动合规自检，发现了以下问题：\n${validationErrors.map((err, i) => `${i + 1}. ${err}`).join("\n")}\n\n请严格对照系统提示词规范，在脑海中进行深度反思（如补充筛选数量、使用真实详情单页链接、清除技术黑话等），并重新调用工具或重新输出一份完美修正了以上所有问题的 \`{"type":"final", "output": {...}}\` 报告！`
          });
          continue;
        }
      }

      if (!ctxForPrompt.__hasDeepReflected && step < maxSteps - 1) {
        ctxForPrompt.__hasDeepReflected = true;
        sendProgress({ type: "reflection", step, message: "Critic Agent 正在进行深层商业推演反思..." });
        
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({
          role: "user",
          content: `【Critic Agent 报告质量审计与反思】\n请根据本会话系统提示词（System Prompt）头部的【报告设计审计与规划基座 Skill】中的质量审计检查单（Auditor Checklist），对你刚才生成的最终报告进行最严苛的自检审查：\n1. 结构完整性：是否严格包含并对齐了该 Skill 要求的分析模块（如概述、推演、数据结构化卡片）？\n2. 深度审计：内容是否流于表面？是否对消费者痛点、产品改良策略进行了多维度的场景化推演？\n3. 格式规范性：数据视图（data 数组）中的键名和键值是否合规（无 [object Object] 等序列化错误，且已翻译为中文）？\n\n【重要要求】在输出优化后的 JSON 时，严禁在 output 内部的字段（如 overview, analysis, summary）中写入任何有关 AI 自我审计、自检表格或自评文字。报告正文必须纯净、专业，不留任何自检草稿痕迹，直接呈现面向跨境买家的供应链审计方案。\n\n如果你发现可以改进的地方，请进行深度反思，并输出优化后的 \`{"type":"final", "output": {...}}\`。\n如果你确信当前版本已经完美无缺，请直接原样再次输出 \`{"type":"final", "output": {...}}\` 即可通过审查。`
        });
        continue;
      } else {
        messages.push({ role: "assistant", content: assistantContent });
        globalSessionCache[sessionKey] = messages;
        return {
          ok: true,
          type: "final",
          result: parsed.output,
          steps: step,
        };
      }
    }

    if (parsed.type === "tool_call") {
      const toolName = parsed.tool;
      const toolArgs = parsed.arguments || {};

      sendProgress({ type: "tool_call", step, toolName, toolArgs });

      if (!tools[toolName]) {
        const errMsg = `Unknown tool: ${toolName}. Available: ${availableTools}`;
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({
          role: "user",
          content: JSON.stringify({ type: "tool_error", tool: toolName, error: errMsg }),
        });
        continue;
      }

      let toolResult;
      try {
        toolResult = await tools[toolName](toolArgs);
      } catch (err) {
        toolResult = { error: err.message };
      }

      sendProgress({ type: "tool_result", step, toolName, toolResult });

      if (toolResult && toolResult.isCaptcha) {
        sendProgress({
          type: "captcha_warning",
          step,
          message: "【采购平台人机拦截预警】：检测到当前页面被验证码（滑块）或登录限制卡住！请立刻前往打开的浏览器窗口，滑动通过验证或完成登录。操作完成后 Agent 将自动继续。"
        });
      }

      let nextScreenshot = null;
      const pageModifyingTools = ["open_new_tab", "navigate_to", "search_in_browser", "click_by_text", "input_text_and_search", "click_by_selector", "image_search_in_browser", "click_by_coordinate"];
      if (pageModifyingTools.includes(toolName)) {
        try {
          const tId = (toolResult && toolResult.tabId) ? toolResult.tabId : tabId;
          const t = await new Promise((resTab) => {
            chrome.tabs.get(tId, (tabInfo) => {
              if (chrome.runtime.lastError || !tabInfo) resTab(null);
              else resTab(tabInfo);
            });
          });
          if (t && t.windowId) {
            nextScreenshot = await new Promise((resScr) => {
              chrome.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 60 }, (dataUrl) => {
                if (chrome.runtime.lastError || !dataUrl) resScr(null);
                else resScr(dataUrl);
              });
            });
          }
        } catch (err) {
          console.warn("Could not capture real-time loop screenshot:", err.message);
        }
      }

      messages.push({ role: "assistant", content: assistantContent });

      const userResultObj = {
        type: "tool_result",
        tool: toolName,
        result: toolResult,
      };

      let userMsgContent;
      if (nextScreenshot) {
        userMsgContent = [
          { type: "text", text: JSON.stringify(userResultObj) },
          { type: "image_url", image_url: { url: nextScreenshot } }
        ];
      } else {
        userMsgContent = JSON.stringify(userResultObj);
      }

      messages.push({
        role: "user",
        content: userMsgContent,
      });

      continue;
    }

    messages.push({ role: "assistant", content: assistantContent });
    globalSessionCache[sessionKey] = messages;
    return {
      ok: true,
      type: "json",
      result: parsed,
      steps: step,
    };
  }

  throw new Error(`Agent loop exceeded maximum steps (${maxSteps})`);
}

function repairJSONQuotes(str) {
  if (!str) return str;
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') {
      if (i > 0 && str[i - 1] === '\\') {
        result += char;
        continue;
      }
      let beforeChar = "";
      for (let j = i - 1; j >= 0; j--) {
        if (!/\s/.test(str[j])) {
          beforeChar = str[j];
          break;
        }
      }
      let afterChar = "";
      for (let j = i + 1; j < str.length; j++) {
        if (!/\s/.test(str[j])) {
          afterChar = str[j];
          break;
        }
      }
      const isPrecededByStructure = ["{", "[", ",", ":"].includes(beforeChar);
      const isFollowedByStructure = [":", ",", "}", "]"].includes(afterChar);
      if (isPrecededByStructure || isFollowedByStructure) {
        result += char;
      } else {
        result += '\\"';
      }
    } else {
      result += char;
    }
  }
  return result;
}

function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    try {
      let repaired = repairJSONQuotes(str);
      repaired = repaired.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
        return '"' + p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
      });
      return JSON.parse(repaired);
    } catch (_) {
      throw e;
    }
  }
}

function extractJSONBlock(text) {
  if (!text || typeof text !== "string") return null;

  // 1. Scan code blocks (from last to first to match the final output block after reflections)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let matches = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    matches.push(match[1].trim());
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const parsed = tryParseJSON(matches[i]);
      if (parsed && (parsed.type === "final" || parsed.output || parsed.tool)) {
        return parsed;
      }
    } catch (_) {}
  }

  // 2. Fallback: Search for outer curly braces
  const braceRegex = /(\{[\s\S]*\})/g;
  const braceMatches = [];
  while ((match = braceRegex.exec(text)) !== null) {
    braceMatches.push(match[1].trim());
  }
  for (let i = braceMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = tryParseJSON(braceMatches[i]);
      if (parsed && (parsed.type === "final" || parsed.output || parsed.tool)) {
        return parsed;
      }
    } catch (_) {}
  }

  // 3. Fallback: Try raw parsing of the entire text
  try {
    return tryParseJSON(text.trim());
  } catch (_) {}

  return null;
}
