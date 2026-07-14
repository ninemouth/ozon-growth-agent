import assert from "node:assert/strict";
import { summarizeEvidenceQuality } from "../modules/evidenceQuality.js";

const high = summarizeEvidenceQuality({
  output: {
    report_status: "completed",
    blocking_gaps: [],
    data: [{
      evidence_ledger: [{
        source_type: "ozon_api",
        source_ref: "ozon_api_get_store_snapshot",
        observed_value: "SKU snapshot",
        used_for: "店铺底账",
        confidence: "high",
        limitation: "仅当前授权店铺",
      }],
    }],
  },
  pageContext: { apiSyncedAt: "2026-07-14T00:00:00.000Z" },
});

assert.equal(high.grade, "A");
assert.equal(high.has_api_evidence, true);
assert.equal(high.data_freshness.seller_api_synced_at, "2026-07-14T00:00:00.000Z");

const low = summarizeEvidenceQuality({
  output: {
    report_status: "assumption_only",
    blocking_gaps: [{ gap_id: "G-1" }],
    data: [{
      evidence_ledger: [{
        source_type: "assumption",
        source_ref: "待验证",
        observed_value: "缺少页面",
        used_for: "阻断",
        confidence: "low",
        limitation: "无真实证据",
      }],
    }],
  },
});

assert.equal(low.grade, "D");
assert.equal(low.blocking_gap_count, 1);
assert.equal(low.has_page_evidence, false);

console.log("evidence-quality-smoke: ok");
