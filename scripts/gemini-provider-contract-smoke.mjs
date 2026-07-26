import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildGeminiInteractionRequest,
  callLLM,
  getEffectiveLlmProvider,
  parseGeminiInteractionResponse,
} from "../modules/llmClient.js";
import { collectPageEvidenceFromToolHistory } from "../modules/evidenceBundle.js";

const settings = {
  apiKey: "gemini-test-key",
  llmProvider: "gemini",
  llmModel: "gemini-3.6-flash",
  temperature: 0.2,
};

global.chrome = {
  storage: {
    local: {
      get: (_keys, callback) => callback(settings),
    },
  },
};

const request = buildGeminiInteractionRequest([
  { role: "system", content: "Return structured Ozon business evidence." },
  {
    role: "user",
    content: [
      { type: "text", text: "Find current Russian market evidence." },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ],
  },
], { model: settings.llmModel, temperature: 0.2 });

assert.equal(request.model, "gemini-3.6-flash");
assert.equal(request.system_instruction, "Return structured Ozon business evidence.");
assert.deepEqual(request.tools, [{ type: "google_search" }]);
assert.equal(request.store, false);
assert.equal(request.stream, false);
assert.equal(request.input[0].type, "user_input");
assert.deepEqual(request.input[0].content[1], {
  type: "image",
  mime_type: "image/png",
  data: "AAAA",
});

const completedInteraction = {
  id: "interaction-1",
  status: "completed",
  steps: [
    {
      type: "google_search_call",
      arguments: { query: "Ozon Russia market trend" },
      id: "search-1",
    },
    {
      type: "google_search_result",
      call_id: "search-1",
      result: {
        search_suggestions: "<div>Google Search suggestions</div>",
      },
    },
    {
      type: "model_output",
      content: [{
        type: "text",
        text: '{"type":"final","output":{"report_status":"partial"}}',
        annotations: [
          { type: "url_citation", title: "Ozon market source", url: "https://example.com/ozon-market" },
          { type: "url_citation", title: "Second source", url: "https://example.com/source-2" },
        ],
      }],
    },
  ],
};

const parsed = parseGeminiInteractionResponse(completedInteraction);
assert.match(parsed.text, /"type":"final"/);
assert.deepEqual(parsed.searchEvidence.queries, ["Ozon Russia market trend"]);
assert.deepEqual(parsed.searchEvidence.sources, [
  { title: "Ozon market source", url: "https://example.com/ozon-market" },
  { title: "Second source", url: "https://example.com/source-2" },
]);

let capturedRequest = null;
global.fetch = async (url, options) => {
  capturedRequest = { url, options };
  return {
    ok: true,
    status: 200,
    json: async () => completedInteraction,
    text: async () => JSON.stringify(completedInteraction),
  };
};

const callbackEvents = [];
const result = await callLLM(
  [{ role: "user", content: "Search first and answer." }],
  (event) => callbackEvents.push(event),
);
assert.equal(result, parsed.text);
assert.equal(capturedRequest.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
assert.equal(capturedRequest.options.headers["x-goog-api-key"], "gemini-test-key");
assert.equal(capturedRequest.options.headers.Authorization, undefined);
assert.deepEqual(JSON.parse(capturedRequest.options.body).tools, [{ type: "google_search" }]);
assert.ok(callbackEvents.some((event) => event.fullText === parsed.text));
assert.ok(callbackEvents.some((event) => event.searchEvidence?.sources?.length === 2));

settings.llmProvider = "gemini";
settings.llmBaseUrl = "https://proxy.example/v1";
settings.llmModel = "proxy-chat";
assert.equal(getEffectiveLlmProvider(settings), "custom");
capturedRequest = null;
global.fetch = async (url, options) => {
  capturedRequest = { url, options };
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "custom endpoint response" } }] }),
    text: async () => "custom endpoint response",
    headers: { get: () => "application/json" },
  };
};
const customEndpointResult = await callLLM([{ role: "user", content: "Use custom endpoint." }]);
assert.equal(customEndpointResult, "custom endpoint response");
assert.equal(capturedRequest.url, "https://proxy.example/v1/chat/completions");
assert.equal(capturedRequest.options.headers.Authorization, "Bearer gemini-test-key");
assert.equal(capturedRequest.options.headers["x-goog-api-key"], undefined);

settings.llmProvider = "qwen";
settings.llmBaseUrl = "https://www.thinktv.ai/v1";
settings.llmModel = "qwen3.5-plus";
capturedRequest = null;
const qwenSelectedCustomEndpointResult = await callLLM([{ role: "user", content: "Use endpoint over provider." }]);
assert.equal(qwenSelectedCustomEndpointResult, "custom endpoint response");
assert.equal(capturedRequest.url, "https://www.thinktv.ai/v1/chat/completions");

settings.llmProvider = "qwen";
settings.llmBaseUrl = "https://www.thinktv.ai/v1";
settings.llmModel = "gpt-5.5";
capturedRequest = null;
global.fetch = async (url, options) => {
  capturedRequest = { url, options };
  return {
    ok: true,
    status: 200,
    json: async () => ({ output_text: "responses endpoint response" }),
    text: async () => "responses endpoint response",
    headers: { get: () => "application/json" },
  };
};
const responsesEndpointResult = await callLLM([{ role: "user", content: "Use responses endpoint." }]);
assert.equal(responsesEndpointResult, "responses endpoint response");
assert.equal(capturedRequest.url, "https://www.thinktv.ai/v1/responses");

const fallbackRequests = [];
global.fetch = async (url, options) => {
  fallbackRequests.push({ url, options });
  if (String(url).endsWith("/responses")) {
    return {
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: { message: "Upstream request failed", type: "upstream_error" } }),
      headers: { get: () => "application/json" },
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "fallback chat response" } }] }),
    text: async () => "fallback chat response",
    headers: { get: () => "application/json" },
  };
};
const fallbackEvents = [];
const fallbackResult = await callLLM(
  [{ role: "user", content: "Responses proxy unsupported, please fallback." }],
  (event) => fallbackEvents.push(event),
);
assert.equal(fallbackResult, "fallback chat response");
assert.ok(fallbackRequests.length >= 2, "responses-compatible custom proxies should retry with chat completions when responses is unsupported");
assert.equal(fallbackRequests[0].url, "https://www.thinktv.ai/v1/responses");
assert.equal(fallbackRequests.at(-1).url, "https://www.thinktv.ai/v1/chat/completions");
assert.ok(JSON.parse(fallbackRequests[0].options.body).input, "first attempt should use Responses API input payload");
assert.ok(JSON.parse(fallbackRequests.at(-1).options.body).messages, "fallback attempt should use Chat Completions messages payload");
assert.ok(fallbackEvents.some((event) => event.warning === "responses_api_fallback_to_chat_completions"));

const pageEvidence = collectPageEvidenceFromToolHistory([{
  tool: "gemini_google_search",
  result: {
    ok: true,
    provider: "gemini",
    source_type: "google_search",
    interactionId: parsed.searchEvidence.interactionId,
    queries: parsed.searchEvidence.queries,
    sources: parsed.searchEvidence.sources,
  },
}]);
assert.equal(pageEvidence.length, 2);
assert.ok(pageEvidence.every((item) => item.tool === "gemini_google_search"));
assert.ok(pageEvidence.every((item) => item.evidenceOk === true));
assert.ok(pageEvidence.every((item) => item.pageEvidence.provider === "gemini"));
assert.ok(pageEvidence.some((item) => item.url === "https://example.com/ozon-market"));

assert.throws(
  () => parseGeminiInteractionResponse({
    status: "failed",
    error: { code: "PERMISSION_DENIED", message: "API key rejected" },
  }),
  /PERMISSION_DENIED.*API key rejected/,
);
assert.throws(
  () => parseGeminiInteractionResponse({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
  }),
  /incomplete.*max_output_tokens/i,
);
assert.throws(
  () => parseGeminiInteractionResponse({
    status: "completed",
    steps: [{ type: "model_output", content: [] }],
  }),
  /空正文/,
);

const content = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const sidepanel = fs.readFileSync(new URL("../sidepanel.html", import.meta.url), "utf8");
const agentLoop = fs.readFileSync(new URL("../modules/agentLoop.js", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const evidenceBundle = fs.readFileSync(new URL("../modules/evidenceBundle.js", import.meta.url), "utf8");
assert.match(content, /option value="gemini"/);
assert.match(sidepanel, /option value="gemini"/);
assert.match(content, /自定义 API Endpoint（可选，填写后优先）/);
assert.match(sidepanel, /填写后优先于 Provider/);
assert.match(agentLoop, /gemini_google_search/);
assert.match(agentLoop, /LLM 返回空响应/);
assert.match(agentLoop, /invalid_text_response/);
assert.match(background, /assertDeliverableWorkflowResult\(result, matchedSkills\)/);
assert.match(evidenceBundle, /result\.sources/);

console.log("gemini-provider-contract-smoke: ok");
