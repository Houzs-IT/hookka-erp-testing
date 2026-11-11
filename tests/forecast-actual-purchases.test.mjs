// Actual purchases beside the forecast (owner 2026-11-11 「我按edit forecast 时，我要
// 看到actual 的categories 的actual 那个月的purchase total罢了，主要是让我有一个refer
// to fill forecast P&L 的数额，这个可以确定」; then 「同时原有的forecast P&L 输入界面
// 也要做成一样，然后就是原有的forecast P&L 顺序…最新的month 在最左手边」 and
// 「然后我还要多一行accumulated」).
//   - Monthly P&L › Edit forecast: a material type's row shows that month's
//     actual PURCHASES (not the cost after stock) in the Actual columns; the
//     stock detail under it folds away until "Show detail".
//   - Forecast P&L page: newest month on the left, an Accumulated column, and
//     an "Actual purchases" line under each material.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPnlMatrix } from "../src/lib/pnl-matrix.ts";
import { rmTypeOf, sumPnlWindowLikes } from "../src/lib/pnl-forecast.ts";
import { foldMaterialDetail } from "../src/lib/pl-forecast-edit.ts";
import { foldStatementRows } from "../src/lib/finance-reports.ts";
import { actualPurchasesByMonth, sumActualPurchases } from "../src/lib/forecast-actuals.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const rg = (group, description, openingSen, purchasesSen, closingSen) => ({ group, description, openingSen, purchasesSen, closingSen });
const win = (netSalesSen, rmGroups) => ({ ...sumPnlWindowLikes([]), netSalesSen, rmGroups });

// Two months of actuals: fabric bought in three stock groups, plywood in one.
const OCT = win(1_000_000, [
  rg("BMF", "PURCHASE - B.M FABRIC", 50_000, 120_000, 60_000),
  rg("SF", "PURCHASE - S FABRIC", 0, 30_000, 10_000),
  rg("PLY", "PURCHASE - PLYWOOD", 20_000, 70_000, 25_000),
]);
const NOV = win(500_000, [
  rg("BMF", "PURCHASE - B.M FABRIC", 40_000, 60_000, 0),
  rg("SF", "PURCHASE - S FABRIC", 10_000, 0, 0),
  rg("PLY", "PURCHASE - PLYWOOD", 25_000, 45_000, 30_000),
]);

test("a material type's row carries its purchases per column — not the cost after stock — and their % of sales", () => {
  const m = buildPnlMatrix(
    [{ key: "2026-10", label: "Oct", accum: false, window: OCT }, { key: "2026-11", label: "Nov", accum: false, window: NOV }],
    { rmTypeOf },
  );
  const fabric = m.rows.find((r) => r.kind === "group" && r.fcKey === "cat:FABRIC");
  assert.ok(fabric, "the FABRIC type row");
  assert.deepEqual(fabric.purchaseValues, [150_000, 60_000]);
  assert.deepEqual(fabric.purchasePctValues, [15, 12]);
  // The row's own values stay the cost after stock (opening + purchases − closing).
  assert.deepEqual(fabric.values, [130_000, 110_000]);
  const ply = m.rows.find((r) => r.kind === "group" && r.fcKey === "cat:PLYWOOD");
  assert.deepEqual(ply.purchaseValues, [70_000, 45_000]);
  // Only the type rows carry them.
  assert.ok(m.rows.filter((r) => r.purchaseValues).every((r) => r.fcKey?.startsWith("cat:")));
});

test("Edit forecast folds the stock detail under each material type, and only that", () => {
  const m = buildPnlMatrix([{ key: "2026-10", label: "Oct", accum: false, window: OCT }], { rmTypeOf });
  const all = foldStatementRows(m.rows, new Set());
  const folded = foldMaterialDetail(all);
  const labels = (items) => items.map(({ row, close }) => (close ? `/${row.label}` : row.label));
  const f = labels(folded);
  assert.ok(f.includes("FABRIC") && f.includes("PLYWOOD"), "the type rows stay");
  for (const gone of ["PURCHASE - B.M FABRIC", "PURCHASE - S FABRIC", "OPENING STOCK", "CLOSING STOCK", "/FABRIC", "/PLYWOOD"]) {
    assert.ok(!f.includes(gone), `${gone} folds away`);
  }
  // Exactly the detail goes: FABRIC's two stock groups (heading, 3 lines,
  // total each) and its total line; PLYWOOD's one stock group and its total.
  assert.equal(all.length - folded.length, 5 + 5 + 1 + 5 + 1);
  for (const kept of ["SALES", "/SALES", "RAW MATERIALS", "/RAW MATERIALS", "OPENING STOCK - FINISHED GOODS", "CARRIAGE INWARDS", "DIRECT LABOUR", "GROSS PROFIT / (LOSS)", "NET PROFIT / (LOSS)"]) {
    assert.ok(f.includes(kept), `${kept} stays`);
  }
});

test("Forecast P&L page: each month's actual purchases by material type, and their sum over the months shown", () => {
  const by = actualPurchasesByMonth({ "2026-10": OCT, "2026-11": NOV, acc: win(0, []) });
  assert.deepEqual(by["2026-10"], { salesSen: 1_000_000, byType: { FABRIC: 150_000, PLYWOOD: 70_000 } });
  assert.deepEqual(by["2026-11"], { salesSen: 500_000, byType: { FABRIC: 60_000, PLYWOOD: 45_000 } });
  assert.equal(by.acc, undefined, "only month windows");
  // Accumulated over the months on the sheet that have actuals.
  assert.deepEqual(sumActualPurchases(by, ["2026-12", "2026-11", "2026-10"], "FABRIC"), { sen: 210_000, salesSen: 1_500_000, months: 2 });
  assert.deepEqual(sumActualPurchases(by, ["2027-01"], "FABRIC"), { sen: 0, salesSen: 0, months: 0 });
});

test("Edit forecast: Actual columns of a type row show its purchases; the detail comes back with Show detail", () => {
  const ed = read("src/pages/accounting/monthly-pl-forecast-editor.tsx");
  assert.match(ed, /const \[showDetail, setShowDetail\] = useState\(false\)/);
  assert.match(ed, /showDetail \? shown : foldMaterialDetail\(shown\)/);
  assert.match(ed, /r\.purchaseValues/);
  assert.match(ed, /\{showDetail \? "Hide detail" : "Show detail"\}/);
});

test("Forecast P&L page: newest month on the left, an Accumulated column, actual purchases under each material", () => {
  const pg = read("src/pages/forecast.tsx");
  assert.match(pg, /Object\.keys\(months\)\.sort\(\)\.reverse\(\)/);
  assert.match(pg, />Accumulated</);
  assert.match(pg, /Actual purchases/);
  assert.match(pg, /actualPurchasesByMonth\(/);
  assert.match(pg, /\/api\/accounting\/pl-monthly\?line=all&anchor=\$\{/);
});

test("the months on the sheet from an earlier financial year get their actuals too: one more request per year", async () => {
  const { nextActualsAnchor } = await import("../src/lib/forecast-actuals.ts");
  const sheet = ["2027-06", "2027-01", "2026-11", "2026-10", "2026-09", "2026-08"];
  // First this month (its year); future months never ask.
  assert.equal(nextActualsAnchor(sheet, "2026-11", {}, new Set()), "2026-11");
  // This year's answer covers Sep–Nov; Aug 2026 is the year before (prod 2026-11-11: FY 2026/27 starts in September).
  const got = { "2026-11": 1, "2026-10": 1, "2026-09": 1 };
  assert.equal(nextActualsAnchor(sheet, "2026-11", got, new Set(["2026-11"])), "2026-08");
  assert.equal(nextActualsAnchor(sheet, "2026-11", { ...got, "2026-08": 1 }, new Set(["2026-11", "2026-08"])), null);
  // A month asked for and still without actuals (before the books) is not asked again.
  assert.equal(nextActualsAnchor(sheet, "2026-11", got, new Set(["2026-11", "2026-08"])), null);
  const pg = readFileSync("src/pages/forecast.tsx", "utf8");
  assert.match(pg, /nextActualsAnchor\(/);
});

test("who the actual purchases were from (owner 「我看不到actual 的fabric 67559.67 是从谁买」): supplier documents' legs by month, type and supplier", async () => {
  const { supplierActualsFromLegs, supplierActualIds } = await import("../src/lib/forecast-pnl.ts");
  const typeOf = (code) => ({ "700-1000": "FABRIC", "700-1001": "FABRIC", "700-2000": "PLYWOOD" })[code];
  const acts = supplierActualsFromLegs(
    [
      { supplierId: "s1", accountCode: "700-1000", ym: "2026-09", debitSen: 40_000, creditSen: 0 },
      { supplierId: "s1", accountCode: "700-1001", ym: "2026-09", debitSen: 10_000, creditSen: 0 },
      { supplierId: "s2", accountCode: "700-1000", ym: "2026-09", debitSen: 17_559, creditSen: 0 },
      // A credit note nets against the supplier's month.
      { supplierId: "s2", accountCode: "700-1000", ym: "2026-09", debitSen: 0, creditSen: 2_000 },
      { supplierId: "s3", accountCode: "700-2000", ym: "2026-10", debitSen: 9_000, creditSen: 0 },
      // Not a material account, no month, or no supplier: not counted.
      { supplierId: "s1", accountCode: "400-0000", ym: "2026-09", debitSen: 0, creditSen: 50_000 },
      { supplierId: "s1", accountCode: "700-1000", ym: "", debitSen: 1, creditSen: 0 },
      { supplierId: "", accountCode: "700-1000", ym: "2026-09", debitSen: 1, creditSen: 0 },
      // A supplier netting to zero in a month drops out.
      { supplierId: "s4", accountCode: "700-1000", ym: "2026-09", debitSen: 500, creditSen: 500 },
    ],
    typeOf,
  );
  assert.deepEqual(acts, { "2026-09": { FABRIC: { s1: 50_000, s2: 15_559 } }, "2026-10": { PLYWOOD: { s3: 9_000 } } });
  assert.deepEqual(supplierActualIds(acts, "FABRIC").sort(), ["s1", "s2"]);
  assert.deepEqual(supplierActualIds(acts, "WEBBING"), []);
});

test("the route and Edit forecast: each supplier row's Actual cells, and what no supplier invoice explains", () => {
  const route = read("src/api/routes/accounting.ts");
  assert.match(route, /app\.get\("\/forecast\/supplier-actuals"/);
  assert.match(route, /supplierActualsFromLegs\(/);
  const ed = read("src/pages/accounting/monthly-pl-forecast-editor.tsx");
  assert.match(ed, /\/api\/accounting\/forecast\/supplier-actuals\?from=\$\{/);
  assert.match(ed, /supplierActualIds\(supplierActs, type\)/);
  assert.match(ed, /Other purchases \(no supplier invoice\)/);
});
