// modules/llmClient.js — LLM Connector with Exponential Backoff Retry

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["apiKey", "llmProvider", "llmModel", "imageGenerationModel", "llmBaseUrl", "maxLoopSteps", "temperature", "helium10ApiKey", "sellerSpriteApiKey", "fastmossApiKey"],
      resolve
    );
  });
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        if (i === maxRetries - 1) return response;
        console.warn(`LLM API returned HTTP ${response.status}. Retrying in ${delay}ms (Attempt ${i + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      return response;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.warn(`LLM API network failure: ${err.message}. Retrying in ${delay}ms (Attempt ${i + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

function resolveImageEditUrl(settings) {
  const provider = settings.llmProvider || "openai";
  if (provider === "openai") return "https://api.openai.com/v1/images/edits";
  if (provider === "custom") {
    if (!settings.llmBaseUrl) throw new Error("未配置自定义 API 地址，无法调用生图模型。");
    const raw = settings.llmBaseUrl.replace(/\/+$/, "");
    if (raw.endsWith("/images/edits") || raw.endsWith("/images/generations")) return raw;
    if (raw.endsWith("/v1")) return `${raw}/images/edits`;
    return `${raw}/v1/images/edits`;
  }
  if (provider === "siliconflow") return "https://api.siliconflow.cn/v1/images/edits";
  if (provider === "qwen") return "https://dashscope.aliyuncs.com/compatible-mode/v1/images/edits";
  throw new Error(`当前 Provider (${provider}) 暂未接入通用图片编辑接口，请使用 OpenAI、SiliconFlow 或自定义 OpenAI-compatible 图片接口。`);
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1] || "image/jpeg";
  const isBase64 = !!match[2];
  const raw = isBase64 ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function prepareCleanProductImage(imageUrl, promptOverride = "") {
  const settings = await getSettings();
  const { apiKey, imageGenerationModel } = settings;
  if (!imageGenerationModel) {
    return {
      ok: false,
      skipped: true,
      reason: "image_generation_model_not_configured",
      cleanedImageUrl: imageUrl,
      message: "未配置生图模型，继续使用原始目标图进行以图搜图。",
    };
  }
  if (!apiKey) throw new Error("未配置 API Key，无法调用生图模型。");
  if (!imageUrl) throw new Error("imageUrl is required");

  let sourceBlob;
  if (String(imageUrl).startsWith("data:")) {
    sourceBlob = dataUrlToBlob(imageUrl);
  } else {
    const sourceResponse = await fetch(imageUrl);
    if (!sourceResponse.ok) {
      throw new Error(`目标商品图下载失败 (${sourceResponse.status})`);
    }
    sourceBlob = await sourceResponse.blob();
  }
  if (!sourceBlob) throw new Error("目标商品图解析失败，无法准备干净搜图图。");

  const endpoint = resolveImageEditUrl(settings);
  const prompt = promptOverride || [
    "Create a clean product-search reference image from the provided product photo.",
    "Keep the exact product shape, proportions, color, material, decorative details, and distinctive silhouette.",
    "Remove busy background, lifestyle props, text, watermarks, hands, packaging, and irrelevant objects.",
    "Center the complete product subject on a plain light background with all edges visible.",
    "Do not redesign, stylize, add parts, crop the product, or change the product identity.",
  ].join(" ");

  const form = new FormData();
  form.append("model", imageGenerationModel);
  form.append("prompt", prompt);
  form.append("image", sourceBlob, "target-product.png");
  form.append("size", "1024x1024");

  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`生图模型调用失败 (${response.status}) [${endpoint}]: ${text}`);
  }

  const data = await response.json();
  const first = data.data?.[0] || {};
  const cleanedImageUrl = first.b64_json
    ? `data:image/png;base64,${first.b64_json}`
    : first.url;

  if (!cleanedImageUrl) {
    throw new Error("生图模型未返回可用于搜图的图片。");
  }

  return {
    ok: true,
    model: imageGenerationModel,
    cleanedImageUrl,
    sourceImageUrl: imageUrl,
    prompt,
    message: "已生成背景干净、主体完整的搜图参考图。",
  };
}

export async function callLLM(messages, streamCallback, isHighRandomness = false) {
  const settings = await getSettings();
  const { apiKey, llmProvider, llmModel, llmBaseUrl, temperature } = settings;

  if (!apiKey) throw new Error("未配置 API Key，请在设置页面填写。");
  if (!llmModel) throw new Error("未配置 LLM 模型，请在设置页面填写。");

  const endpoints = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1/messages",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    openrouter: "https://openrouter.ai/api/v1",
    thinktv: "https://www.thinktv.ai/v1",
  };

  const provider = llmProvider || "openai";
  
  let protocol = "chat";
  if (provider === "qwen" && (llmModel.includes("qwen3.") || llmModel.includes("reason"))) {
    protocol = "responses";
  } else if (provider === "openai" && (llmModel.includes("gpt-5") || llmModel.includes("gpt-6") || /^o\d/.test(llmModel))) {
    protocol = "responses";
  }

  let baseUrl;
  if (provider === "custom") {
    if (!llmBaseUrl) throw new Error("未配置自定义 API 地址，请在设置页面填写完整的 API 端点 URL。");
    const raw = llmBaseUrl.replace(/\/+$/, "");
    if (raw.endsWith("/chat/completions") || raw.endsWith("/responses") || raw.endsWith("/completions")) {
      baseUrl = raw;
    } else if (raw.endsWith("/v1")) {
      baseUrl = raw + (protocol === "responses" ? "/responses" : "/chat/completions");
    } else {
      baseUrl = raw + (protocol === "responses" ? "/v1/responses" : "/v1/chat/completions");
    }
  } else {
    let base = endpoints[provider] || endpoints.openai;
    if (provider === "anthropic") {
      baseUrl = base;
    } else {
      baseUrl = base + (protocol === "responses" ? "/responses" : "/chat/completions");
    }
  }

  if (!baseUrl) throw new Error("未能解析 API 地址，请检查设置。");

  const isStreaming = typeof streamCallback === "function";
  const finalTemperature = isHighRandomness ? 0.95 : (parseFloat(temperature) || 0.2);

  if (provider === "anthropic") {
    const systemMsg = messages.find((m) => m.role === "system")?.content || "";
    const userMessages = messages.filter((m) => m.role !== "system");

    const body = {
      model: llmModel,
      system: systemMsg,
      messages: userMessages,
      max_tokens: 8192,
      temperature: finalTemperature,
      stream: isStreaming,
    };

    let response;
    try {
      response = await fetchWithRetry(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`网络请求彻底失败 (Network Error)。\n请求地址: ${baseUrl}\n可能原因：\n1. 你的网络环境 (VPN/代理) 无法连通此地址。\n2. API 服务器宕机。\n3. Chrome 插件跨域拦截。\n原始错误: ${err.message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API 错误 (${response.status}) [${baseUrl}]: ${text}`);
    }

    if (isStreaming) {
      return await readSSEStream(response, streamCallback, "anthropic");
    }

    const data = await response.json();
    return data.content?.[0]?.text || "";
  }

  let body = {};
  if (protocol === "responses") {
    const mappedMessages = messages.map(m => {
      if (Array.isArray(m.content)) {
        return {
          ...m,
          content: m.content.map(c => {
            if (c.type === "text") return { type: "input_text", text: c.text };
            if (c.type === "image_url") {
              return { type: "input_image", image_url: c.image_url.url };
            }
            return c;
          })
        };
      }
      return m;
    });

    body = {
      model: llmModel,
      input: mappedMessages,
      temperature: finalTemperature,
      stream: isStreaming,
      enable_thinking: true,
    };
  } else {
    body = {
      model: llmModel,
      messages,
      temperature: finalTemperature,
      max_tokens: 8192,
      stream: isStreaming,
    };

    const isQwenModel = provider === "qwen" || llmModel.toLowerCase().includes("qwen") || (llmBaseUrl && llmBaseUrl.includes("dashscope"));
    const isGeminiModel = llmModel.toLowerCase().includes("gemini") || (llmBaseUrl && llmBaseUrl.includes("google"));
    const isGlmModel = llmModel.toLowerCase().includes("glm") || provider === "zhipu" || (llmBaseUrl && llmBaseUrl.includes("zhipu"));
    const isBaichuan = llmModel.toLowerCase().includes("baichuan") || provider === "baichuan";
    const isDoubaoModel = llmModel.toLowerCase().includes("doubao") || (llmBaseUrl && llmBaseUrl.includes("volcengine"));
    const isMinimaxModel = llmModel.toLowerCase().includes("minimax");
    const isHunyuanModel = llmModel.toLowerCase().includes("hunyuan") || llmModel.toLowerCase().includes("tencent");

    if (isQwenModel) {
      body.enable_search = true;
      body.tools = [{ type: "web_search" }];
    } else if (isGeminiModel) {
      body.tools = [{ googleSearch: {} }];
    } else if (isGlmModel) {
      body.tools = [{ type: "web_search", web_search: { enable: true } }];
    } else if (isBaichuan || isDoubaoModel || isMinimaxModel || isHunyuanModel) {
      body.tools = [{ type: "web_search" }];
    }
  }

  let response;
  try {
    response = await fetchWithRetry(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`网络请求彻底失败 (Network Error)。\n请求地址: ${baseUrl}\n可能原因：\n1. 你的网络环境 (VPN/代理) 无法连通此地址。\n2. 你在使用本地大模型或自定义 API 时，未开启跨域 (CORS) 支持。\n3. Ollama 必须设置 OLLAMA_ORIGINS="*" 环境变量。\n原始错误: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API 错误 (${response.status}) [${baseUrl}]: ${text}`);
  }

  if (isStreaming) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      let chunk = "";
      if (data.output && data.output.text) chunk = data.output.text;
      else if (data.choices && data.choices[0] && data.choices[0].message) chunk = data.choices[0].message.content;
      else chunk = JSON.stringify(data);
      streamCallback({ chunk, fullText: chunk });
      return chunk;
    }
    return await readSSEStream(response, streamCallback, "openai");
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function readSSEStream(response, callback, format) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (trimmed.startsWith(":")) {
        continue; // Ignore SSE comments (e.g., :HTTP_STATUS/200, :ping, keep-alive)
      }

      let payload = trimmed;
      if (trimmed.startsWith("data:")) {
        payload = trimmed.slice(5).trim();
      } else if (trimmed.startsWith("id:") || trimmed.startsWith("event:") || trimmed.startsWith("retry:")) {
        continue;
      }

      if (payload === "[DONE]") {
        continue; // Cleanly ignore standard EOF marker without logging parsing errors
      }
      
      let json;
      try {
        json = JSON.parse(payload);
      } catch (err) {
        console.error("SSE parse error", err, payload);
        continue;
      }
        
      if (json.code && json.message && !json.output && !json.choices) {
        throw new Error(`API 拒绝了请求: [${json.code}] ${json.message}`);
      }

      try {
        let chunk = "";
        let reasoningChunk = "";

        if (format === "anthropic") {
          chunk = json.delta?.text || "";
        } else if (json.type && json.type.startsWith("response.")) {
          if (json.type.includes("reasoning") && json.delta) {
             reasoningChunk = json.delta;
          } else if ((json.type.includes("text.delta") || json.type.includes("content_part.delta")) && json.delta) {
             chunk = json.delta;
          } else if (json.type === "response.message.delta" && json.delta?.text) {
             chunk = json.delta.text;
          } else if (json.type === "response.message.delta" && json.delta?.content) {
             chunk = json.delta.content;
          }
        } else {
          if (json.output) {
             if (json.output.type === "reasoning" && json.output.summary) {
                const s = json.output.summary;
                reasoningChunk = Array.isArray(s) ? s.map(x => x.text || "").join("") : (typeof s === "string" ? s : "");
             } else if (json.output.type === "message" && json.output.content) {
                const c = json.output.content;
                chunk = Array.isArray(c) ? c.map(x => x.text || "").join("") : (typeof c === "string" ? c : "");
             } else if (typeof json.output.text === "string") {
                 chunk = json.output.text;
             } else if (json.output.choices) {
                 const choice = json.output.choices[0];
                 if (choice) {
                    chunk = choice.delta?.content || choice.message?.content || "";
                    reasoningChunk = choice.delta?.reasoning_content || "";
                 }
             }
          } else {
             chunk = json.choices?.[0]?.delta?.content || "";
             reasoningChunk = json.choices?.[0]?.delta?.reasoning_content || "";
          }
        }

        if (reasoningChunk) {
           fullText += reasoningChunk;
           callback({ chunk: reasoningChunk, fullText, isReasoning: true });
        }
        if (chunk) {
          fullText += chunk;
          callback({ chunk, fullText });
        }
      } catch (err) {
        console.error("SSE parse error", err, payload);
      }
    }
  }

  return fullText;
}
