/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */

export async function openExtensionSidePanel(chromeApi, tab = {}) {
  const tabId = Number(tab?.id);
  const hasTabId = Number.isInteger(tabId);
  let sidePanelError = null;

  if (hasTabId && typeof chromeApi?.sidePanel?.open === "function") {
    try {
      await chromeApi.sidePanel.open({ tabId });
      return { ok: true, mode: "side_panel", tabId };
    } catch (error) {
      sidePanelError = error;
    }
  }

  const fallbackUrl = chromeApi?.runtime?.getURL?.("sidepanel.html");
  if (!fallbackUrl || typeof chromeApi?.tabs?.create !== "function") {
    throw sidePanelError || new Error("Side panel and fallback tab APIs are unavailable");
  }

  const fallbackTab = await chromeApi.tabs.create({
    url: fallbackUrl,
    active: true,
  });
  return {
    ok: true,
    mode: "tab_fallback",
    tabId: fallbackTab?.id ?? null,
    sidePanelError: sidePanelError?.message || "",
  };
}
