// modules/agentLoop.js — The Agent reasoning & tool loop logic

import { callLLM, getSettings } from './llmClient.js';
import { tools } from './toolRegistry.js';

const globalSessionCache = {};

export function clearSessionCache(tabId) {
  const sessionKey = `${tabId}`;
  if (globalSessionCache[sessionKey]) {
    delete globalSessionCache[sessionKey];
  }
}

export async function runAgentLoop({ tabId, skillId, skillMarkdown, userInstruction, pageContext, sendProgress, continueSession, highRandomness }) {
  const settings = await getSettings();
  const maxSteps = Math.max(parseInt(settings.maxLoopSteps) || 15, 15);

  const systemPrompt = skillMarkdown;
  
  const isApiActive = !!(settings.helium10ApiKey || settings.sellerSpriteApiKey);
  const filteredToolList = Object.keys(tools).filter(name => {
    if (name === "query_market_data") return isApiActive;
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

## 🌍 跨平台区域与受众校准 (Global Audience Alignment)
请严格根据当前所在页面的 URL 或平台特征，自动精准匹配目标市场的区域与文化：
1. **跨境与海外平台 (如 Amazon, Etsy, Temu, Shopify)**：请根据具体域名后缀推断国家（如 .co.jp 为日本，.de 为德国，默认 .com 为美国/全球）。你的消费者画像、痛点挖掘、使用场景推演，**必须 100% 基于该目标站点的本地化文化背景、生活环境、节假日和价值观**。坚决禁止套用中国国内的网购习惯！
2. **国内平台 (如 Taobao, 1688)**：基于中国本土消费习惯和文化。
⚠️ **特例覆盖与指令绑定 (User Instruction Override)**：
如果在下方的【用户核心焦点】中，用户明确指定了具体的“目标客群、国家、文化背景”，则**无条件以用户的设定为准**。
如果用户的指令中包含了商品关键词、主题或是找寻意图（例如输入了"婚礼定制产品"），且当前页面并非该商品的搜索结果页，你**必须第一步就调用 \`search_web\` 工具去搜索该关键词**！
残留的中文关键词在调用 \`search_web\` 时，**你必须将其自动精准翻译为该平台对应的本地语言**（例如在 Etsy 等英文平台上搜索时，必须将"婚礼定制产品"翻译为英文，如 "wedding custom products"）。
如果用户的指令中包含了“翻页”、“下一页”、“筛选”、“排序”等意图，你必须首先调用 \`click_by_text\` 工具。
无论你脑海中模拟的是哪个国家的消费者，**最终报告必须始终使用【中文】输出**。

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
      if (!ctxForPrompt.__hasReflected && step < maxSteps - 1) {
        ctxForPrompt.__hasReflected = true;
        sendProgress({ type: "reflection", step, message: "Critic Agent 正在进行多维审查与自我反思..." });
        
        messages.push({ role: "assistant", content: assistantContent });
        messages.push({
          role: "user",
          content: `【Critic Agent 报告质量审计与反思】\n请根据本会话系统提示词（System Prompt）头部的【报告设计审计与规划基座 Skill】中的质量审计检查单（Auditor Checklist），对你刚才生成的最终报告进行最严苛的自检审查：\n1. 结构完整性：是否严格包含并对齐了该 Skill 要求的分析模块（如概述、推演、数据结构化卡片）？\n2. 深度审计：内容是否流于表面？是否对消费者痛点、产品改良策略进行了多维度的场景化推演？\n3. 格式规范性：数据视图（data 数组）中的键名和键值是否合规（无 [object Object] 等序列化错误，且已翻译为中文）？\n\n如果你发现可以改进的地方，请进行深度反思，并输出优化后的 \`{"type":"final", "output": {...}}\`。\n如果你确信当前版本已经完美无缺，请直接原样再次输出 \`{"type":"final", "output": {...}}\` 即可通过审查。`
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

      messages.push({ role: "assistant", content: assistantContent });
      messages.push({
        role: "user",
        content: JSON.stringify({
          type: "tool_result",
          tool: toolName,
          result: toolResult,
        }),
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

function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    try {
      // Basic repair: replace unescaped literal newlines inside double quotes
      const repaired = str.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
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
