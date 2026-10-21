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

test("both lists in the Payment Vouchers table standard (owner 2026-10-20 「这个可以」): the grid, its header menu, draggable headers, windowing", () => {
  const grids = src.match(/<DataGrid\n[\s\S]*?\/>/g) ?? [];
  assert.equal(grids.length, 2);
  for (const g of grids) {
    for (const p of ["virtualize", "headerMenu", "reorderableHeaders", 'maxHeight="calc(100vh - 340px)"']) assert.ok(g.includes(p), p);
  }
  assert.match(grids[0], /gridId="e-invoice-submissions"[\s\S]*onDoubleClick=\{openXml\}[\s\S]*contextMenuItems=\{submissionMenu\}[\s\S]*exportName="e-Invoice Submissions"/);
  assert.match(grids[1], /gridId="e-invoice-candidates"[\s\S]*contextMenuItems=\{candidateMenu\}[\s\S]*exportName="Sales Invoices Without An e-Invoice"/);
  assert.doesNotMatch(src, /useVirtualizer/, "the grid windows the rows itself");
  assert.doesNotMatch(src, /<table data-fin-list/, "no hand-rolled tables left");
});

test("the notice stays; the writes are the three steps and Generate", () => {
  assert.match(src, /<span className="font-semibold">Not connected to LHDN\.<\/span>/);
  // The steps live in the row menu (right-click or ⋮), offered by the record's next step.
  assert.match(src, /next === "mark" \? \[\{ label: "Mark as Submitted", action: \(\) => openDialog\("mark", e\) \}\] : \[\]/);
  assert.match(src, /next === "record" \? \[\{ label: "Record Result", action: \(\) => openDialog\("record", e\) \}\] : \[\]/);
  assert.match(src, /next === "cancel" \? \[\{ label: "Cancel", danger: true, action: \(\) => openDialog\("cancel", e\) \}\] : \[\]/);
  assert.match(src, /\{ label: "Generate XML", disabled: !!generating, action: \(\) => void generate\(\[c\.id\]\) \}/);
});
