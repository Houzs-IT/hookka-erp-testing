// ---------------------------------------------------------------------------
// finance-v2-einvoice.test.mjs — the e-Invoice page in the v2 look (plan
// 2026-10-17-finance-v2-einvoice-setup Task 1). Same reads and writes, same
// four figures; the tab strip becomes the v2 switch, the figures KPI cards,
// both lists the v2 list look. The standing "Not connected to LHDN" notice
// stays (BUG-2026-08-13-014: nothing is sent to LHDN from here).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = readFileSync("src/pages/invoices/e-invoice.tsx", "utf8").replace(/\r\n/g, "\n");

test("the tab strip is the v2 switch over the same three views", () => {
  assert.match(src, /<SegmentedSwitch\n\s*label="e-Invoice view"/);
  assert.match(src, /\{ key: "dashboard", label: "Dashboard" \}/);
  assert.match(src, /\{ key: "generate", label: availableInvoices\.length \? `Generate e-Invoice · \$\{availableInvoices\.length\}` : "Generate e-Invoice" \}/);
  assert.match(src, /\{ key: "xml", label: "XML Preview" \}/);
  assert.match(src, /value=\{activeTab\}\n\s*onChange=\{setActiveTab\}/);
  assert.match(src, /type TabId = "dashboard" \| "generate" \| "xml";/);
});

test("the four status figures as KPI cards, same values", () => {
  for (const [label, v] of [["Submitted (MTD)", "submittedMTD"], ["Validated", "validCount"], ["Pending", "pendingCount"], ["Invalid / Rejected", "invalidCount"]]) {
    assert.ok(src.includes(`{ label: "${label}", value: String(${v})`), label);
  }
  assert.doesNotMatch(src, /grid gap-4 grid-cols-1 sm:grid-cols-4/, "the old card row is gone");
});

test("both lists in the v2 list look; the virtual-scroll spacers never lift", () => {
  assert.equal((src.match(/<table data-fin-list className="w-full text-sm">\n\s*<thead className="sticky top-0 z-10">/g) ?? []).length, 2);
  assert.equal((src.match(/<tr aria-hidden="true" data-fin-nolift="">/g) ?? []).length, 4);
  assert.doesNotMatch(src, /<tr aria-hidden="true">/);
});

test("the notice and the writes are unchanged", () => {
  assert.match(src, /<span className="font-semibold">Not connected to LHDN\.<\/span>/);
  assert.match(src, /onClick=\{\(\) => submitToLHDN\(einv\.id\)\}/);
  assert.match(src, /onClick=\{\(\) => setCancelConfirmId\(einv\.id\)\}/);
  assert.match(src, /onClick=\{generateEInvoices\}/);
});
