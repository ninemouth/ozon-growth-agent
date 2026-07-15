/* SPDX-License-Identifier: MIT | Copyright (c) 2026 Yang Cao <cao.x.yang@gmail.com> */
function levelForSource(sourceType = "") {
  const normalized = String(sourceType || "").toLowerCase();
  if (["ozon_api", "supplier_page", "official_policy", "official_regulation"].includes(normalized)) return "A";
  if (["ozon_search", "yandex_search", "google_search", "google_trends"].includes(normalized)) return "B";
  if (["page_dom", "screenshot_visual", "sourcing_search"].includes(normalized)) return "C";
  return "D";
}

function flattenLedgers(output = {}) {
  const ledgers = [];
  const addLedger = (entry, owner = "") => {
    if (entry && typeof entry === "object") ledgers.push({ ...entry, owner });
  };
  (Array.isArray(output.data) ? output.data : []).forEach((item, index) => {
    (Array.isArray(item?.evidence_ledger) ? item.evidence_ledger : []).forEach((entry) => addLedger(entry, item?.title || item?.name || item?.opportunity_id || `data-${index + 1}`));
  });
  (Array.isArray(output.competitor_benchmarks) ? output.competitor_benchmarks : []).forEach((item, index) => {
    (Array.isArray(item?.evidence_ledger) ? item.evidence_ledger : []).forEach((entry) => addLedger(entry, item?.competitor_name || `competitor-${index + 1}`));
  });
  return ledgers;
}

export function summarizeEvidenceQuality({ output = {}, pageContext = {}, researchScope = {} } = {}) {
  const ledgers = flattenLedgers(output);
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  const sourceTypes = new Set();
  ledgers.forEach((entry) => {
    const type = String(entry.source_type || "assumption").toLowerCase();
    sourceTypes.add(type);
    counts[levelForSource(type)] += 1;
  });
  const reportStatus = String(output.report_status || "");
  const blockingGaps = Array.isArray(output.blocking_gaps) ? output.blocking_gaps : [];
  const hasApi = sourceTypes.has("ozon_api") || Boolean(pageContext.ozonApiSnapshot || pageContext.apiSnapshot);
  const hasSearch = ["ozon_search", "yandex_search", "google_search", "google_trends"].some((type) => sourceTypes.has(type));
  const hasPage = ["page_dom", "screenshot_visual"].some((type) => sourceTypes.has(type)) || Boolean(pageContext.url || pageContext.screenshot);
  const grade = counts.A > 0 ? "A" : counts.B > 0 ? "B" : counts.C > 0 ? "C" : "D";
  const freshness = pageContext.apiSyncedAt || pageContext.syncedAt || "";
  return {
    grade,
    counts,
    source_types: Array.from(sourceTypes),
    has_api_evidence: hasApi,
    has_search_evidence: hasSearch,
    has_page_evidence: hasPage,
    report_status: reportStatus,
    blocking_gap_count: blockingGaps.length,
    data_freshness: freshness ? { seller_api_synced_at: freshness } : {},
    capture_mode: output.screenshotCaptureMode || pageContext.screenshotCaptureMode || "",
    research_scope_confidence: researchScope.scope_confidence || "",
    summary: `证据等级 ${grade}；${ledgers.length} 条证据账本；${blockingGaps.length} 个阻断缺口。`,
  };
}
