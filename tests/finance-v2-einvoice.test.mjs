// ---------------------------------------------------------------------------
// finance-v2-einvoice.test.mjs — the e-Invoice page in the v2 look (plan
// 2026-10-17-finance-v2-einvoice-setup Task 1). Same reads and writes, same
// four figures; the tab strip becomes the v2 switch, the figures KPI cards,
// both lists the v2 list look. The standing "Not connected to LHDN" notice
// stays (BUG-2026-08-13-014: nothing is sent to LHDN from here).
//
// 2026-10-19 (owner 「1 做」): the design's MyInvois tracking — the four cards
// are the design's, Generate lists the candidates with their buyer TIN, and
// the writes are the three steps (tests/einvoice-tracking.test.mjs).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = readFileSync("src/pages/invoices/e-invoice.tsx", "utf8").replace(/\r\n/g, "\n");

test("the tab strip is the v2 switch over the same three views", () => {
  assert.match(src, /<SegmentedSwitch\n\s*label="e-Invoice view"/);
  assert.match(src, /\{ key: "dashboard", label: "Dashboard" \}/);
  assert.match(src, /\{ key: "generate", label: candidates\.length \? `Generate e-Invoice · \$\{candidates\.length\}` : "Generate e-Invoice" \}/);
  assert.match(src, /\{ key: "xml", label: "XML Preview" \}/);
  assert.match(src, /value=\{activeTab\}\n\s*onChange=\{setActiveTab\}/);
  assert.match(src, /type TabId = "dashboard" \| "generate" \| "xml";/);
});

test("the design's four figures as KPI cards", () => {
  for (const [label, v] of [["Uploaded (MTD)", "kpi.uploadedMtd"], ["Validated by LHDN", "kpi.validated"], ["Waiting", "kpi.notSent + kpi.waitingLhdn"], ["Invalid / Rejected", "kpi.invalidRejected"]]) {
    assert.ok(src.includes(`{ label: "${label}", value: String(${v})`), label);
  }
  assert.doesNotMatch(src, /grid gap-4 grid-cols-1 sm:grid-cols-4/, "the old card row is gone");
});

test("both lists in the v2 list look; the virtual-scroll spacers never lift", () => {
  assert.equal((src.match(/<table data-fin-list className="w-full text-sm">\n\s*<thead className="sticky top-0 z-10">/g) ?? []).length, 2);
  assert.equal((src.match(/<tr aria-hidden="true" data-fin-nolift="">/g) ?? []).length, 4);
  assert.doesNotMatch(src, /<tr aria-hidden="true">/);
});

test("the notice stays; the writes are the three steps and Generate", () => {
  assert.match(src, /<span className="font-semibold">Not connected to LHDN\.<\/span>/);
  assert.match(src, /onClick=\{\(\) => openDialog\("mark", einv\)\}/);
  assert.match(src, /onClick=\{\(\) => openDialog\("record", einv\)\}/);
  assert.match(src, /onClick=\{\(\) => openDialog\("cancel", einv\)\}/);
  assert.match(src, /onClick=\{\(\) => generate\(\[inv\.id\]\)\}/);
});
