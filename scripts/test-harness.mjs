// scripts/test-harness.mjs — Offline dry-run test harness for Ozon AI Agent

import fs from 'fs';
import path from 'path';

// ── Mock Chrome API Environment ──
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const mockDb = {
          ozonClientId: 'mock-client-id-1234',
          ozonApiKey: 'mock-api-key-5678',
          ozonWarehouseType: 'FBS',
          ozonTargetMargin: '25',
          settings: {
            apiKey: process.env.DASHSCOPE_API_KEY || process.env.GEMINI_API_KEY || 'mock-llm-key',
            maxLoopSteps: '3' // Fast dry run limit
          }
        };
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { res[k] = mockDb[k]; });
        } else if (typeof keys === 'string') {
          res[keys] = mockDb[keys];
        } else {
          Object.assign(res, mockDb);
        }
        cb(res);
      },
      set: (data, cb) => { if (cb) cb(); }
    }
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://www.ozon.ru/product/elektricheskaya-zubnaya-schetka-123456/' }],
    get: (id, cb) => cb({ id: 1, windowId: 1, url: 'https://www.ozon.ru/product/elektricheskaya-zubnaya-schetka-123456/' }),
    captureVisibleTab: (windowId, options, cb) => cb('data:image/jpeg;base64,mock')
  },
  runtime: {
    getURL: (filePath) => filePath,
    onConnect: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  }
};

// ── Mock Fetch to load local skill files in Node ──
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (typeof url === 'string' && !url.startsWith('http')) {
    const filePath = path.resolve(url);
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      ok: true,
      text: async () => content,
      json: async () => JSON.parse(content),
      status: 200,
    };
  }
  return originalFetch(url, options);
};

// ── Import Agent Loop & Start Mock Run ──
async function main() {
  console.log("⚡ Starting Ozon AI Agent Offline Dry-Run Harness...");
  
  const { runAgentLoop } = await import('../modules/agentLoop.js');

  const mockPageContext = {
    url: "https://www.ozon.ru/product/elektricheskaya-zubnaya-schetka-123456/",
    title: "Электрическая зубная щетка Oral-B - купить по выгодной цене",
    h1: "Электрическая зубная щетка Oral-B Pro 500",
    price: "2 990 ₽",
    rating: "4.8",
    reviewCount: "420 отзывов",
    description: "Ультразвуковая зубная щетка с 5 режимами чистки, зарядной базой и чехлом.",
    images: [
      { src: "https://ir.ozone.ru/s3/multimedia-a/6001234.jpg", roleHint: "product_media", searchScore: 800 }
    ],
    productCards: []
  };

  const skillPath = "skills/ozon_product_opportunity_explorer.skill.md";
  const skillMarkdown = fs.readFileSync(skillPath, 'utf-8');

  console.log("🤖 Dispatching Agent Loop on Ozon toothbrush product page mock context...");
  
  try {
    const result = await runAgentLoop({
      tabId: 1,
      skillId: skillPath,
      skillMarkdown: skillMarkdown,
      userInstruction: "审计该电动牙刷的选品可行性与EAC认证风险",
      pageContext: mockPageContext,
      sendProgress: (progress) => {
        if (progress.type === 'thinking') {
          console.log(`  [Thinking] Step ${progress.step}: ${progress.message || ''}`);
        } else if (progress.type === 'tool_call') {
          console.log(`  [Tool Call] Executing: ${progress.toolName}`);
        } else if (progress.type === 'reflection') {
          console.log(`  [Critic Reflection] Audit Alert: ${progress.message}`);
        }
      },
      continueSession: false,
      highRandomness: false,
      negativeFilter: true,
      maxLoopSteps: 4 // Limit to 4 reasoning steps for testing
    });

    console.log("\n🎉 Harness Run Completed successfully!");
    console.log("=========================================");
    console.log(JSON.stringify(result, null, 2));
    
  } catch (err) {
    console.error("❌ Harness Run failed:", err.message);
    process.exit(1);
  }
}

main();
