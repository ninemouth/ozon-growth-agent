// modules/llmClient.js — LLM Connector with Exponential Backoff Retry

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["apiKey", "llmProvider", "llmModel", "llmBaseUrl", "maxLoopSteps", "temperature", "helium10ApiKey", "sellerSpriteApiKey"],
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

export async function callLLM(messages, streamCallback, isHighRandomness = false) {
  const settings = await getSettings();
  const { apiKey, llmProvider, llmModel, llmBaseUrl, temperature } = settings;

  if (!apiKey) throw new Error("未配置 API Key，请在设置页面填写。");
  if (!llmModel) throw new Error("未配置 LLM 模型，请在设置页面填写。");

  const endpoints = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1/messages",
    qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    siliconflow: "https://api.siliconflow.cn/v1",
    groq: "https://api.groq.com/openai/v1",
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
      messages: mappedMessages,
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
      enable_search: true,
    };
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
      
      let payload = trimmed;
      if (trimmed.startsWith("data:")) {
        payload = trimmed.slice(5).trim();
      } else if (trimmed.startsWith("id:") || trimmed.startsWith("event:") || trimmed.startsWith("retry:")) {
        continue;
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
