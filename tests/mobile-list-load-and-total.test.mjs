// ---------------------------------------------------------------------------
// mobile-list-load-and-total.test.mjs — the phone (/m) document lists get the
// desktop's G7 and G4 (WORK-TRACKER item 121, review 2026-11-10 §2b):
//
// G7  a failed list request (or a 200 with { success: false }) shows
//     "Couldn't load this list" + the server's reason + Retry, never an empty
//     list ("No records match.") that reads as "nothing here".
// G4  a total line above the cards on the lists with an amount (SO, PO, GRN,
//     PI, Invoices): cancelled rows are left out, and it says "loaded rows
//     only" when the phone holds part of the list — the same helpers and
//     wording as the desktop footer (src/lib/grid-layout.ts).
//
// Pure helpers are exercised directly; the wiring is pinned by source pattern
// (house style, see tests/fe-quality-batch-a.test.mjs).
// Run: node --import tsx/esm --test tests/mobile-list-load-and-total.test.mjs
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isCappedResponse, mobileListTotal, serverTotalOf } from "../src/pages/m/lib/list-total.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const SCREEN = read("src/pages/m/screens/ModuleListScreen.tsx");
const MODULES = read("src/pages/m/config/modules.ts");

const amt = (r) => r.totalSen;

test("G4 phone: cancelled rows are listed but not added up", () => {
  const rows = [
    { status: "CONFIRMED", totalSen: 10000 },
    { status: "cancelled", totalSen: 99999 },
    { status: "VOID", totalSen: 5 },
    { status: "DRAFT", totalSen: 2550 },
  ];
  const t = mobileListTotal({ rows, all: 4, amountSen: amt });
  assert.equal(t.sumSen, 12550);
  assert.equal(t.counted, 2);
  assert.equal(t.skipped, 2);
  assert.equal(t.loadedOnly, false);
  assert.equal(t.text, "Total · 4 shown of 4 · 2 cancelled not counted");
});

test("G4 phone: says 'loaded rows only' when the server has more rows", () => {
  const rows = [{ status: "CONFIRMED", totalSen: 100 }];
  const t = mobileListTotal({ rows, all: 200, amountSen: amt, serverTotal: 812 });
  assert.equal(t.loadedOnly, true);
  assert.equal(t.text, "Total · 1 shown of 200 · loaded rows only");
  const whole = mobileListTotal({ rows, all: 200, amountSen: amt, serverTotal: 200 });
  assert.equal(whole.loadedOnly, false);
});

test("G4 phone: a capped list without a count still says 'loaded rows only'", () => {
  const t = mobileListTotal({ rows: [{ status: "X", totalSen: 1 }], all: 500, amountSen: amt, capped: true });
  assert.equal(t.loadedOnly, true);
  assert.match(t.text, /loaded rows only$/);
});

test("G4 phone: a blank / non-numeric amount adds nothing (never NaN)", () => {
  const t = mobileListTotal({ rows: [{ totalSen: undefined }, { totalSen: "abc" }, { totalSen: 7 }], all: 3, amountSen: amt });
  assert.equal(t.sumSen, 7);
});

test("serverTotalOf / isCappedResponse read the list envelope", () => {
  assert.equal(serverTotalOf({ success: true, data: [], total: 42 }), 42);
  assert.equal(serverTotalOf({ data: [], pagination: { total: 9 } }), 9);
  assert.equal(serverTotalOf({ data: [] }), undefined);
  assert.equal(serverTotalOf([1, 2]), undefined);
  assert.equal(serverTotalOf(null), undefined);
  assert.equal(isCappedResponse({ truncated: true }), true);
  assert.equal(isCappedResponse({ capped: true }), true);
  assert.equal(isCappedResponse({ hasMore: true }), true);
  assert.equal(isCappedResponse({ truncated: false, data: [] }), false);
  assert.equal(isCappedResponse(null), false);
});

test("G4 phone: SO, PO, GRN, PI and Invoices sources carry an amount", () => {
  const sources = [
    ["/api/sales-orders", 'num(r, "totalSen")'],
    ["/api/invoices", 'num(r, "totalSen")'],
    ["/api/purchase-orders", 'num(r, "totalSen")'],
    ["/api/grn", 'num(r, "totalAmount")'],
    ["/api/purchase-invoices", 'num(r, "amountSen", "totalSen")'],
  ];
  for (const [url, expr] of sources) {
    const at = MODULES.indexOf(`  url: "${url}",\n  select: selectData,\n  amountSen: (r) => ${expr},`);
    assert.ok(at >= 0, `${url} source must declare amountSen = ${expr}`);
  }
});

test("G4 phone: the list screen draws the total line from mobileListTotal", () => {
  assert.match(SCREEN, /const amountSen = source\.amountSen;/);
  assert.match(SCREEN, /if \(!amountSen \|\| crossActive \|\| results\.length === 0\) return null;/);
  assert.match(SCREEN, /serverTotal: serverTotalOf\(data\),/);
  assert.match(SCREEN, /capped: isCappedResponse\(data\),/);
  assert.match(SCREEN, /\{listTotal \? <TotalLine total=\{listTotal\} \/> : null\}/);
});

test("G7 phone: a failed load is an error with the reason and Retry, not an empty list", () => {
  assert.match(SCREEN, /const \{ data, loading, error, refresh \} = useCachedJson<unknown>\(source\.url\);/);
  assert.match(SCREEN, /const loadError = listLoadError\(data, error\);/);
  assert.match(SCREEN, /loadError \? \(\s*<LoadErrorCard reason=\{loadError\} onRetry=\{refresh\} \/>/);
  assert.match(SCREEN, /<LoadErrorBanner reason=\{loadError\} onRetry=\{refresh\} \/>/);
  assert.match(SCREEN, /Couldn’t load this list/);
  assert.doesNotMatch(SCREEN, /pull to refresh or use the desktop app/, "the old dead-end message is gone");
});
