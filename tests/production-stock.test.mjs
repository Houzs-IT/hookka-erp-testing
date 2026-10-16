// ---------------------------------------------------------------------------
// production-stock.test.mjs — FG / WIP valued from the production orders for a
// month the Stock Take leaves blank (owner 2026-10-13: FG 1.A, WIP the same
// method, cost ratio = last month's materials + this month's labour, no
// factory overhead →「做」).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const m = await import(pathToFileURL(resolve(process.cwd(), "src/lib/production-stock.ts")).href);

const order = (id, extra = {}) => ({
  id, status: "IN_PROGRESS", completedDate: null, qty: 1, itemCategory: "SOFA", productCode: "P1", productName: "Sofa",
  salesOrderId: "so1", consignmentOrderId: null, lineNo: 1, ...extra,
});
const card = (po, status, completedDate, minutes) => ({ productionOrderId: po, status, completedDate, minutes });

test("selling price: the sales-order line for the same product (own line number first), else the consignment line, else the category average", () => {
  const orders = [
    order("a", { lineNo: 2 }),                                  // SO has P1 on lines 1 and 2
    order("b", { lineNo: 3 }),                                  // line 3 doesn't exist → first P1 line
    order("c", { salesOrderId: null, consignmentOrderId: "co1", productCode: "P2" }),
    order("d", { salesOrderId: "so9", productCode: "ZZ" }),    // no price anywhere → SOFA average
    order("e", { itemCategory: "ACCESSORY", salesOrderId: null, productCode: "X" }), // nothing in its category
  ];
  const so = [
    { orderId: "so1", lineNo: 1, productCode: "P1", unitPriceSen: 100000 },
    { orderId: "so1", lineNo: 2, productCode: "P1", unitPriceSen: 120000 },
  ];
  const co = [{ orderId: "co1", lineNo: 1, productCode: "P2", unitPriceSen: 80000 }];
  const p = m.priceOrders(orders, so, co);
  assert.equal(p.get("a"), 120000);
  assert.equal(p.get("b"), 100000);
  assert.equal(p.get("c"), 80000);
  assert.equal(p.get("d"), (120000 + 100000 + 80000) / 3);
  assert.equal(p.has("e"), false, "no price, no category average → not valued");
});

test("FG = closed by D and not out by D; WIP = open at D with work done, by standard minutes; all-done-but-open stays WIP", () => {
  const orders = [
    order("fg1", { status: "COMPLETED", completedDate: "2026-10-05" }),
    order("fg-out", { status: "COMPLETED", completedDate: "2026-10-03" }),
    order("fg-old", { status: "COMPLETED", completedDate: "2026-04-20" }),  // before the opening floor
    order("wip30", {}),
    order("wip-all", {}),
    order("not-started", {}),
    order("closed-later", { status: "COMPLETED", completedDate: "2026-10-20" }),
    order("svc", { productCode: "SERVICE CHARGE", productName: "SERVICE CHARGE" }),
    order("cancel", { status: "CANCELLED", completedDate: "2026-10-01" }),
  ];
  const jobCards = [
    card("wip30", "COMPLETED", "2026-10-02", 30), card("wip30", "WAITING", null, 70),
    card("wip-all", "TRANSFERRED", "2026-10-04", 50), card("wip-all", "COMPLETED", "2026-10-06", 50),
    card("not-started", "WAITING", null, 100),
    card("closed-later", "COMPLETED", "2026-10-07", 60), card("closed-later", "COMPLETED", "2026-10-20", 40),
    card("svc", "COMPLETED", "2026-10-02", 10), card("svc", "WAITING", null, 10),
  ];
  const so = [{ orderId: "so1", lineNo: 1, productCode: "P1", unitPriceSen: 100000 }, { orderId: "so1", lineNo: 1, productCode: "SERVICE CHARGE", unitPriceSen: 5000 }];
  const p = m.prepareProduction({
    orders, jobCards, soLines: so, coLines: [],
    dispatches: [{ productionOrderId: "fg-out", date: "2026-10-08T03:00:00Z" }, { productionOrderId: "fg1", date: "2026-10-15" }],
    floorIso: "2026-05-01",
  });
  const at = m.productionStockAt(p, "2026-10-10");
  // FG: fg1 (closed 05/10, out 15/10). fg-out left on 08/10; fg-old is pre-opening; cancel is cancelled.
  assert.equal(at.fgPriceSen, 100000);
  assert.equal(at.fgUnits, 1);
  // WIP: wip30 at 30%, wip-all at 100% (open), closed-later at 60% (closed after D); svc and not-started excluded.
  assert.equal(at.wipPriceSen, 100000 * 0.3 + 100000 + 100000 * 0.6);
  assert.equal(at.wipUnits, 3);
  assert.ok(Math.abs(at.wipEquivalentUnits - 1.9) < 1e-9);
  // Later: fg1 has left; closed-later is FG now.
  const later = m.productionStockAt(p, "2026-10-20");
  assert.equal(later.fgPriceSen, 100000);
  assert.equal(later.fgUnits, 1);
});

test("completed goods at selling price within a date range (service charges excluded)", () => {
  const orders = [
    order("x", { status: "COMPLETED", completedDate: "2026-09-30", qty: 2 }),
    order("y", { status: "COMPLETED", completedDate: "2026-10-01" }),
    order("s", { status: "COMPLETED", completedDate: "2026-09-15", productName: "Service Charge" }),
  ];
  const p = m.prepareProduction({ orders, jobCards: [], soLines: [{ orderId: "so1", lineNo: 1, productCode: "P1", unitPriceSen: 50000 }], coLines: [], dispatches: [], floorIso: null });
  assert.equal(m.completedPriceSen(p, "2026-09-01", "2026-09-30"), 100000);
  assert.equal(m.completedPriceSen(p, "2026-10-01", "2026-10-31"), 50000);
});

const API = (await import("node:fs")).readFileSync(resolve(process.cwd(), "src/api/routes/accounting.ts"), "utf8").replace(/\r\n/g, "\n");

test("the P&L takes FG / WIP from the production orders only where the Stock Take is blank", () => {
  // The window's opening (the month before it starts) and close (its last month).
  assert.match(API, /blankMonthStock\(db, orgId, startYm \? prevMonthYm\(startYm\) : null, matData, dc, override\),\n\s*blankMonthStock\(db, orgId, endYm \?\? matData\.lastYm, matData, dc, override\),/);
  assert.match(API, /const wipOpen = isAll \? matWipOpen : Math\.round\(matWipOpen \* R\);/);
  assert.match(API, /const fgClose = isAll \? matFgClose : Math\.round\(matFgClose \* R\);/);
  // Typed months keep theirs; FG only under "stock take only"; no months before the books or ahead; not the seed month.
  assert.match(API, /const wipBlank = !matData\.stockTakeByGroupYm\.get\("WIP"\)\?\.has\(ym\);/);
  assert.match(API, /const fgBlank = matData\.fgValuationMode === "stock_take_only" && !matData\.stockTakeByGroupYm\.get\("FG"\)\?\.has\(ym\);/);
  assert.match(API, /if \(!openingYm \|\| ym < openingYm \|\| ym > runningMonthYm\(\)\) return null;/);
  assert.match(API, /if \(matData\.fgSeedYm && ym <= matData\.fgSeedYm\) return null;/);
});

test("the Stock Summary (page and closing-stock post) carries the same blank-month FG / WIP (owner「Stock Summary 也一起改」)", () => {
  const fn = API.slice(API.indexOf("async function stockSummaryRange("), API.indexOf("async function stockSummaryRange(") + 3200);
  assert.match(fn, /if \(blankStockParts\(openYm, data, openingDate\) \|\| blankStockParts\(closeYm, data, openingDate\)\) \{/);
  assert.match(fn, /blankMonthStock\(db, orgId, openYm, data, dc, override\),\n\s*blankMonthStock\(db, orgId, closeYm, data, dc, override\),/);
  assert.match(fn, /wip: \{ openingSen: blankOpen\?\.wip \?\? w\.wipOpenSen, closingSen: blankClose\?\.wip \?\? w\.wipCloseSen \},/);
  assert.match(fn, /fg: \{ openingSen: blankOpen\?\.fg \?\? w\.fgOpenSen, closingSen: blankClose\?\.fg \?\? w\.fgCloseSen \},/);
  // One eligibility rule for both.
  assert.match(API, /const parts = blankStockParts\(ym, matData, dc\.openingDate\);/);
});

test("the valuation: as of today for the running month, last month's materials + this month's labour", () => {
  assert.match(API, /const asOf = ym === runningMonthYm\(\) \?/);
  assert.match(API, /prevMaterialsSen: prevMaterials,/);
  assert.match(API, /labourSen: labourOf\(glThis\),/);
  assert.match(API, /completedSen: completedPriceSen\(prepared, `\$\{ym\}-01`, asOf\),/);
  assert.match(API, /const DASH_PAYLOAD_V = "v(1[7-9]|[2-9]\d)";/); // v17 or later
  assert.match(API, /"delivery_order_items",\n\s*"consignment_notes",\n\s*"consignment_items",\n\s*"stock_take",/);
});

test("cost ratio: last month's materials share + this month's labour share; labour falls back to last month's before any completion", () => {
  assert.equal(m.costRatio({ prevMaterialsSen: 431, prevCompletedSen: 1000, prevLabourSen: 182, labourSen: 30, completedSen: 200 }), 0.431 + 0.15);
  assert.equal(m.costRatio({ prevMaterialsSen: 431, prevCompletedSen: 1000, prevLabourSen: 182, labourSen: 30, completedSen: 0 }), 0.431 + 0.182);
  assert.equal(m.costRatio({ prevMaterialsSen: 0, prevCompletedSen: 0, prevLabourSen: 0, labourSen: 0, completedSen: 0 }), 0);
});
