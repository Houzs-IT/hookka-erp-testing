// FIFO pricing for a counted quantity (owner 2026-11-11 「要用fifo 定价」,
// WORK-TRACKER 136). The count is what is left, so it is valued at the most
// recent purchases: the newest purchase-invoice line's quantity at its price,
// then the one before, and so on. Pure rules in src/lib/stock-take-fifo.ts;
// wiring by source pattern (house style).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fifoSourceText, fifoValue, sortLayersNewestFirst } from "../src/lib/stock-take-fifo.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const L = (date, piNo, qty, unitSen, supplier = "S") => ({ date, piNo, supplier, qty, unitSen });

test("the newest purchase covers the count: its price", () => {
  const r = fifoValue(50, [L("2026-10-29", "PI-2611-005", 149.7, 1200), L("2026-08-06", "PI-2608-048", 962.4, 800)]);
  assert.equal(r.valueSen, 60000);
  assert.equal(r.unitSen, 1200);
  assert.deepEqual(r.used.map((u) => [u.piNo, u.qty]), [["PI-2611-005", 50]]);
  assert.equal(r.beyondQty, 0);
  assert.equal(r.skipped, 0);
});

test("a count larger than the newest purchase takes the next ones, newest first", () => {
  // PC151-02 at 30 Sep 2026: 962.4 m @ 8 in August, then 272 m @ 12 in July.
  const r = fifoValue(1170.3, [L("2026-08-06", "PI-2608-048", 962.4, 800), L("2026-07-16", "PI-2607-060", 272, 1200), L("2026-07-01", "PI-2607-044", 165.9, 1200)]);
  assert.equal(r.valueSen, Math.round(962.4 * 800 + 207.9 * 1200));
  assert.deepEqual(r.used.map((u) => [u.piNo, u.qty]), [["PI-2608-048", 962.4], ["PI-2607-060", 207.9]]);
  assert.equal(r.unitSen, Math.round((r.valueSen / 1170.3) * 10000) / 10000);
});

test("more counted than ever bought: the rest at the oldest price, and said so", () => {
  const r = fifoValue(68, [L("2026-07-14", "PI-2607-054", 7, 9840), L("2026-06-27", "PI-2606-103", 7, 10824)]);
  assert.equal(r.beyondQty, 54);
  assert.equal(r.valueSen, Math.round(7 * 9840 + 7 * 10824 + 54 * 10824));
});

test("a line priced more than 2× from the newest is skipped (a mis-coded size or unit)", () => {
  // NLY-D35-2.5": one line @ 30 among 78–98.
  const r = fifoValue(30, [L("2026-10-30", "PI-2611-011", 8, 7810), L("2026-05-21", "PI-2605-008", 40, 3000), L("2026-05-15", "PI-2605-010", 24, 9865)]);
  assert.deepEqual(r.used.map((u) => u.piNo), ["PI-2611-011", "PI-2605-010"]);
  assert.equal(r.skipped, 1);
  assert.equal(r.valueSen, Math.round(8 * 7810 + 22 * 9865));
});

test("a unit factor turns the purchase unit into the count unit (1 roll = 300 m)", () => {
  const r = fifoValue(1250, [L("2026-10-22", "PI-2610-106", 3, 24000), L("2026-09-24", "PI-2609-103", 3, 24000)], { factor: 300 });
  // 900 m @ 0.80 + 350 m @ 0.80
  assert.equal(r.valueSen, 100000);
  assert.equal(r.unitSen, 80);
  assert.deepEqual(r.used.map((u) => u.qty), [900, 350]);
});

test("zero counted is worth nothing; no purchase on file gives no FIFO price", () => {
  assert.equal(fifoValue(0, [L("2026-10-01", "PI-1", 5, 100)]).valueSen, 0);
  assert.equal(fifoValue(5, []), null);
  assert.equal(fifoValue(5, [L("2026-10-01", "PI-1", 0, 100)]), null, "a line without a quantity is not a layer");
});

test("sortLayersNewestFirst: by date, then purchase-invoice number, newest first", () => {
  const s = sortLayersNewestFirst([L("2026-09-02", "PI-2609-018", 1, 1), L("2026-09-02", "PI-2609-057", 1, 1), L("2026-10-15", "PI-2610-069", 1, 1)]);
  assert.deepEqual(s.map((l) => l.piNo), ["PI-2610-069", "PI-2609-057", "PI-2609-018"]);
});

test("fifoSourceText names each purchase used and the part beyond them", () => {
  const r = fifoValue(1170.3, [L("2026-08-06", "PI-2608-048", 962.4, 800), L("2026-07-16", "PI-2607-060", 272, 1200)]);
  assert.equal(fifoSourceText(r), "FIFO: PI-2608-048 962.4 @ 8.00 + PI-2607-060 207.9 @ 12.00");
  const b = fifoValue(68, [L("2026-07-14", "PI-2607-054", 7, 9840)]);
  assert.match(fifoSourceText(b), /^FIFO: PI-2607-054 7 @ 98\.40 \+ 61 beyond purchases on file @ 98\.40$/);
  const f = fifoValue(1, [L("2026-08-06", "PI-2608-055", 1, 1800)], { factor: 400 });
  assert.match(fifoSourceText(f), /@ 0\.045/, "fractional sen keep their decimals");
});

// ── Wiring ────────────────────────────────────────────────────────────────
test("purchase-prices returns every purchase line per item and the unit factors; Finance's count import prices FIFO", () => {
  const acc = read("src/api/routes/accounting.ts");
  const at = acc.indexOf('app.get("/stock-take/purchase-prices"');
  const block = acc.slice(at, at + 7000);
  assert.match(block, /layers\[key\]/);
  assert.match(block, /stock_count_uom_factors:\$\{orgId\}/);
  assert.match(block, /data: \{ asOf, prices, priceList, batchCost, layers, factors \}/);
  const page = read("src/pages/accounting/index.tsx");
  assert.match(page, /fifoValue\(r\.qty, layers, \{ factor/);
  assert.match(page, /fifoSourceText\(fifo\)/);
  assert.match(page, /i\.fifoValueSen != null && i\.unitStr\.trim\(\) === i\.piUnitStr/, "an untouched FIFO price keeps the exact FIFO value");
});
