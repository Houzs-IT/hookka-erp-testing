// ---------------------------------------------------------------------------
// wip-by-production-order.test.mjs — finance backlog item 12, the design's
// "Stock Summary: WIP total = sum of WIP by PO, and it feeds the Balance Sheet
// WIP line". The per-order list comes from the SAME pass as the WIP line
// (productionStockDetailAt), and the line is spread over the orders by largest
// remainder, so the orders add up to the line to the sen — the line Stock
// Summary shows and the Balance Sheet carries (src/lib/bs-stock.ts). A month
// whose WIP is keyed in Stock Take keeps the keyed figure and lists the orders
// for comparison. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const m = await import(pathToFileURL(resolve(process.cwd(), "src/lib/production-stock.ts")).href);
const { splitByLargestRemainder } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-engine.ts")).href);

const order = (id, extra = {}) => ({
  id, poNo: `PO-2610-${id}`, status: "IN_PROGRESS", completedDate: null, qty: 1, itemCategory: "SOFA", productCode: "P1", productName: "Sofa",
  salesOrderId: "so1", consignmentOrderId: null, lineNo: 1, ...extra,
});
const card = (po, status, completedDate, minutes) => ({ productionOrderId: po, status, completedDate, minutes });

// Awkward minutes and prices, so the shares are long fractions.
function world() {
  const orders = [
    order("001", { qty: 3 }),
    order("002", { productCode: "P2", productName: "Bed", itemCategory: "BEDFRAME", lineNo: 2 }),
    order("003", { qty: 2 }),
    order("004", {}),                                                   // not started
    order("005", { status: "COMPLETED", completedDate: "2026-10-04" }),  // FG, not WIP
    order("006", { productCode: "SERVICE CHARGE", productName: "SERVICE CHARGE" }),
    order("007", { poNo: null }),                                       // no PO no. → its id
  ];
  const jobCards = [
    card("001", "COMPLETED", "2026-10-02", 17), card("001", "WAITING", null, 23), card("001", "WAITING", null, 41),
    card("002", "TRANSFERRED", "2026-10-03", 37), card("002", "COMPLETED", "2026-10-09", 29), card("002", "WAITING", null, 13),
    card("003", "COMPLETED", "2026-10-05", 0), card("003", "WAITING", null, 0), card("003", "WAITING", null, 0),
    card("004", "WAITING", null, 50),
    card("005", "COMPLETED", "2026-10-04", 60),
    card("006", "COMPLETED", "2026-10-02", 10), card("006", "WAITING", null, 10),
    card("007", "COMPLETED", "2026-10-08", 11), card("007", "WAITING", null, 7),
  ];
  const soLines = [
    { orderId: "so1", lineNo: 1, productCode: "P1", unitPriceSen: 123457 },
    { orderId: "so1", lineNo: 2, productCode: "P2", unitPriceSen: 98761 },
    { orderId: "so1", lineNo: 1, productCode: "SERVICE CHARGE", unitPriceSen: 5000 },
  ];
  return m.prepareProduction({ orders, jobCards, soLines, coLines: [], dispatches: [], floorIso: "2026-05-01" });
}

test("the WIP orders come from the same pass as the WIP line — same orders, same values, bit for bit", () => {
  const p = world();
  const { at, wipRows } = m.productionStockDetailAt(p, "2026-10-10");
  assert.deepEqual(m.productionStockAt(p, "2026-10-10"), at, "the line itself is unchanged");
  assert.deepEqual(wipRows.map((r) => [r.orderId, r.poNo, r.itemCategory, r.qty]), [
    ["001", "PO-2610-001", "SOFA", 3],
    ["002", "PO-2610-002", "BEDFRAME", 1],
    ["003", "PO-2610-003", "SOFA", 2],
    ["007", null, "SOFA", 1],
  ], "open with work done; not the unstarted order, the closed one or the service charge");
  assert.equal(wipRows[0].completion, 17 / 81, "by standard minutes");
  assert.equal(wipRows[2].completion, 1 / 3, "no minutes set → by card count");
  assert.equal(wipRows[1].unitPriceSen, 98761);
  assert.equal(wipRows.reduce((s, r) => s + r.valueAtPriceSen, 0), at.wipPriceSen, "the rows add up to the line before rounding, exactly");
  assert.equal(wipRows.reduce((s, r) => s + r.qty, 0), at.wipUnits);
});

test("at cost: the line (round(at selling price × ratio)) is spread over the orders — they add up to it to the sen", () => {
  const p = world();
  for (const asOf of ["2026-10-03", "2026-10-10"]) {
    const { at, wipRows } = m.productionStockDetailAt(p, asOf);
    for (const ratio of [0, 0.37, 0.5813, 0.6131977, 1.07]) {
      const c = m.costedWipRows(wipRows, ratio, splitByLargestRemainder);
      assert.equal(c.totalSen, Math.round(at.wipPriceSen * ratio), `the WIP line, ${asOf} × ${ratio}`);
      assert.equal(c.rows.reduce((s, r) => s + r.wipSen, 0), c.totalSen, `Σ orders = line, ${asOf} × ${ratio}`);
      for (const r of c.rows) {
        assert.ok(Number.isInteger(r.wipSen), "whole sen");
        assert.ok(Math.abs(r.wipSen - r.valueAtPriceSen * ratio) < 1, `${r.orderId} within a sen of its share`);
      }
    }
  }
});

test("nothing in progress → no orders and a zero line", () => {
  const p = m.prepareProduction({ orders: [order("x")], jobCards: [card("x", "WAITING", null, 10)], soLines: [{ orderId: "so1", lineNo: 1, productCode: "P1", unitPriceSen: 1000 }], coLines: [], dispatches: [], floorIso: null });
  const { at, wipRows } = m.productionStockDetailAt(p, "2026-10-10");
  assert.deepEqual(wipRows, []);
  assert.deepEqual(m.costedWipRows(wipRows, 0.6, splitByLargestRemainder), { rows: [], totalSen: 0 });
  assert.equal(at.wipPriceSen, 0);
});

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const loader = read("src/api/lib/production-stock.ts");
const ui = read("src/pages/accounting/index.tsx");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); return src.slice(a, b === -1 ? undefined : b); };

test("server: the WIP line and its orders are one valuation (liveStockFor)", () => {
  assert.match(loader, /`SELECT id, poNo, status, completedDate, quantity, itemCategory, productCode, productName,/, "poNo → po_no via the rename map");
  assert.match(loader, /poNo: str\(pick\(r, "poNo", "po_no"\)\),/);
  const live = slice(api, "async function liveStockFor(", "// Which of a month-end's WIP / FG the Stock Take leaves blank");
  assert.match(live, /const \{ at, wipRows \} = productionStockDetailAt\(prepared, asOf\);\n\s*const wip = costedWipRows\(wipRows, ratio, splitByLargestRemainder\);/);
  assert.match(live, /return \{ fgSen: Math\.round\(at\.fgPriceSen \* ratio\), wipSen: wip\.totalSen, ratio, asOf, wipRows: wip\.rows \};/);
  // One month-range rule for the P&L / Stock Summary blanks and the list.
  assert.match(api, /function productionValuedMonth\(\n\s*ym: string \| null,\n\s*matData: MaterialCostData,\n\s*openingDate: string \| null,\n\): ym is string \{/);
  assert.match(api, /if \(!productionValuedMonth\(ym, matData, openingDate\)\) return null;/);
});

test("GET /wip-detail: the line's own orders; a keyed month keeps its figure and lists the orders for comparison", () => {
  const ep = slice(api, 'app.get("/wip-detail", async (c) => {', "// CLEANUP REPORT (Phase 4.7, 2026-06)");
  assert.match(ep, /requirePermission\(c, "accounting", "read"\)/);
  assert.match(ep, /const ym = \/\^\\d\{4\}-\\d\{2\}\$\/\.test\(q\) \? q : runningMonthYm\(\);/);
  assert.match(ep, /const windowSen = materialWindow\(data, ym, ym\)\.wipCloseSen;/);
  assert.match(ep, /const keyed = !!data\.stockTakeByGroupYm\.get\("WIP"\)\?\.has\(ym\);/);
  assert.match(ep, /if \(!productionValuedMonth\(ym, data, openingDate\)\) return c\.json\(\{ success: true, data: none \}\);/);
  assert.match(ep, /live = await liveStockFor\(db, orgId, ym, data, dc, override\);/);
  assert.match(ep, /basis: keyed \? "stock-take" : "production-orders",/);
  assert.match(ep, /lineSen: keyed \? windowSen : live\.wipSen,/);
  assert.match(ep, /totalSen: live\.wipSen,/);
  assert.doesNotMatch(ep, /cost_ledger/, "the old cost-ledger list is gone");
  // The Stock Summary's WIP closing is the same liveStockFor figure where the Stock Take is blank.
  assert.match(api, /return \{ wip: wipBlank \? v\.wipSen : null, fg: fgBlank \? v\.fgSen : null \};/);
});

test("screen: under the Stock Summary, TOTAL is the WIP line; a keyed month shows the difference", () => {
  assert.match(ui, /<WipDetailCard month=\{month\} reloadKey=\{0\} \/>/);
  const card = slice(ui, "function WipDetailCard(", "// =============== TAB: LABOUR MONTH-END POSTING");
  assert.match(card, /fetch\(`\/api\/accounting\/wip-detail\?asOf=\$\{month\}`\)/);
  assert.match(card, /if \(!wip \|\| wip\.asOf !== month \|\| wip\.basis === "none"\) return null;/, "never the last month's orders");
  assert.match(card, /Work in Progress by Production Order/);
  for (const h of ["PO No.", "Product", "Line", "Qty", "Done", "At selling price", "WIP value"]) assert.ok(card.includes(`>${h}</th>`), h);
  assert.match(card, /<td colSpan=\{4\}>TOTAL — WORK IN PROGRESS<\/td>\n\s*<td data-cell="num split">\{amt\(atPriceSen\)\}<\/td>\n\s*<td data-cell="num">\{amt\(wip\.lineSen\)\}<\/td>/);
  assert.match(card, /DIFFERENCE \(Stock Take − orders\)/);
  // No cost ratio (the books' first month): no difference row, and the note says why.
  assert.match(card, /const noRatio = wip\.ratio === 0;/);
  assert.match(card, /\{!noRatio && \(\n\s*<tr data-row="fin">\n\s*<td \/>\n\s*<td colSpan=\{4\}>DIFFERENCE/);
  assert.match(card, /no goods were completed the month before — so the orders show at selling price only\./);
  assert.match(card, /\{amt\(wip\.lineSen - wip\.totalSen\)\}/);
});
