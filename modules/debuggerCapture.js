// CDP-backed page capture used only for explicit evidence workflows.
// The debugger is attached for one capture and detached immediately after it.

function callDebugger(debuggee, command, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee, command, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result || {});
    });
  });
}

function attachDebugger(debuggee) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee, "1.3", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function detachDebugger(debuggee) {
  return new Promise((resolve) => {
    chrome.debugger.detach(debuggee, () => resolve());
  });
}

export async function captureFullPageScreenshot(tabId) {
  if (!chrome.debugger?.attach || !tabId) throw new Error("Chrome debugger capture is unavailable");
  const debuggee = { tabId: Number(tabId) };
  let attached = false;
  try {
    await attachDebugger(debuggee);
    attached = true;
    await callDebugger(debuggee, "Page.enable");
    const metrics = await callDebugger(debuggee, "Page.getLayoutMetrics");
    const contentSize = metrics.cssContentSize || metrics.contentSize || {};
    const width = Math.max(1, Math.min(Math.ceil(Number(contentSize.width) || 1280), 16384));
    const height = Math.max(1, Math.min(Math.ceil(Number(contentSize.height) || 900), 16384));
    const result = await callDebugger(debuggee, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    if (!result.data) throw new Error("Chrome debugger returned an empty screenshot");
    return {
      dataUrl: `data:image/png;base64,${result.data}`,
      captureMode: "chrome_debugger_full_page",
      contentSize: { width, height },
    };
  } finally {
    if (attached) await detachDebugger(debuggee);
  }
}

export const __testInternals = { callDebugger };
