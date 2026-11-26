// ---------------------------------------------------------------------------
// m-finance-aging.test.mjs — Debtor / Creditor Aging on the phone (plan
// 2026-10-17-finance-v2-mobile Task 1). The Outstanding card and the bucket
// chips are sums of the rows' five buckets — the desktop aging's Total — over
// the same /api/accounting/aging read. Made-up figures.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { AGING_BUCKETS, agingRowTotal, agingTotals, agingBarWidths, fmtMoney } from "../src/pages/m/screens/finance/m-finance-lib.ts";

const src = readFileSync("src/pages/m/screens/finance/AgingScreen.tsx", "utf8").replace(/\r\n/g, "\n");

const ROWS = [
  { currentSen: 100000, days30Sen: 20000, days60Sen: 0, days90Sen: 0, over90Sen: 5000 },
  { currentSen: 50000, days30Sen: 0, days60Sen: 7000, days90Sen: 0, over90Sen: -15000 },
];

test("a party's outstanding is its five buckets added up", () => {
  assert.deepEqual(AGING_BUCKETS.map((b) => b.key), ["currentSen", "days30Sen", "days60Sen", "days90Sen", "over90Sen"]);
  assert.equal(agingRowTotal(ROWS[0]), 125000);
  assert.equal(agingRowTotal(ROWS[1]), 42000, "money held ahead of a bill counts against it");
  assert.equal(agingRowTotal({}), 0);
});

test("the card: per-bucket sums and the grand total over every row", () => {
  const t = agingTotals(ROWS);
  assert.deepEqual(t.buckets, { currentSen: 150000, days30Sen: 20000, days60Sen: 7000, days90Sen: 0, over90Sen: -10000 });
  assert.equal(t.total, 167000);
  assert.equal(t.total, ROWS.reduce((s, r) => s + agingRowTotal(r), 0), "the card equals the rows");
});

test("the bar: a negative bucket takes no width; nothing to draw is all zeros", () => {
  const w = agingBarWidths({ currentSen: 150, days30Sen: 50, days60Sen: 0, days90Sen: 0, over90Sen: -100 });
  assert.deepEqual(w, [75, 25, 0, 0, 0]);
  assert.deepEqual(agingBarWidths({ currentSen: 0, days30Sen: 0, days60Sen: 0, days90Sen: 0, over90Sen: -5 }), [0, 0, 0, 0, 0]);
});

test("money in the report style", () => {
  assert.equal(fmtMoney(123456).replace(/\s/g, " "), "1,234.56");
  assert.equal(fmtMoney(-5000), "(50.00)");
});

test("the screen: the desktop reads, sums from the helper, words for loading / failure / nothing", () => {
  assert.match(src, /const agingUrl = `\/api\/accounting\/aging\$\{/);
  assert.match(src, /asOf=\$\{asOf\}/, "a past month-end reads the server's as-at aging");
  assert.match(src, /total: agingRowTotal\(r\),/);
  assert.match(src, /const totals = agingTotals\(parties\.map/);
  assert.match(src, /\(cred \? data\?\.data\?\.ap : data\?\.data\?\.ar\) \?\? \[\]/);
  assert.match(src, /t="Couldn't load the aging\."/, "a failed read says so — never a card of zeros");
  assert.match(src, /\/api\/accounting\/ar-control/);
  assert.match(src, /\/api\/accounting\/ap-control/);
  assert.doesNotMatch(src, /\/api\/invoices\/aging/, "the Invoices AR Aging stays a separate report");
});

test("debtor document → invoice: only a number that names exactly one sales invoice", async () => {
  const { uniqueInvoiceIds } = await import("../src/pages/m/screens/finance/m-finance-lib.ts");
  const m = uniqueInvoiceIds([
    { kind: "INV", id: "inv-1", no: "INV-1" },
    { kind: "INV", id: "inv-2", no: "INV-2" },
    { kind: "INV", id: "inv-2b", no: "INV-2" },
    { kind: "OD", id: "od-1", no: "INV-3" },
    { kind: "INV", id: "", no: "INV-4" },
  ]);
  assert.equal(m.get("INV-1"), "inv-1");
  assert.equal(m.has("INV-2"), false, "an ambiguous number opens nothing");
  assert.equal(m.has("INV-3"), false, "an other-debtor bill is not an invoice");
  assert.equal(m.has("INV-4"), false);
});
