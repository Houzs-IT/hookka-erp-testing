// Owner's marked-up review of the October 2026 Board Report (2026-11-15).
// Shaping is exercised with endpoint-shaped fixtures; page wiring by source
// pattern (house style for UI).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOARD_DATA_FROM,
  cashForecastMonths,
  productionHeadcount,
  shapeBoardReport,
  shapeCashForecast,
  shapeMatrix,
} from "../src/lib/board-report.ts";

const read = (p) => readFileSync(p, "utf8");
const fin = read("src/pages/board-report/pages-finance.tsx");
const biz = read("src/pages/board-report/pages-business.tsx");

const slice = (o = {}) => ({
  sales: 0, cogs: 0, gross: 0, otherIncome: 0, expenses: 0, net: 0, materials: 0, labour: 0, overhead: 0,
  stockMovement: 0, staffCost: 0, otherOpex: 0, estimated: 0, ...o,
});
const bs = (o = {}) => ({ assets: 0, liabilities: 0, equity: 0, currentAssets: 0, currentLiabilities: 0, inventory: 0, ...o });
const row = (key, o = {}) => ({
  key, label: key, partial: false, actual: null, forecast: null, balanceSheet: bs(),
  cashFlow: { operating: 0, investing: 0, financing: 0, net: 0, freeCashFlow: 0 }, ...o,
});
const ok = (data) => ({ ok: true, data });
const bad = (error) => ({ ok: false, error });

// A cash flow forecast statement: Oct actual, Nov Docs + P&L, Dec Docs only.
const cfForecast = () => ({
  today: "2026-11-15",
  columns: [
    { key: "2026-10", label: "Oct", ym: "2026-10" },
    { key: "fc:2026-11", label: "Nov F", ym: "2026-11", forecast: true },
    { key: "fp:2026-11", label: "Nov P", ym: "2026-11", forecast: true, forecastKind: "pnl" },
    { key: "fc:2026-12", label: "Dec F", ym: "2026-12", forecast: true, future: true },
  ],
  rows: [
    { kind: "line", depth: 2, label: "Sales receipts", section: "REVENUE_COLLECTION", values: [100, 200, 300, 400] },
    { kind: "result", depth: 0, label: "Net operation surplus / (deficit)", values: [50, 60, 70, 80] },
    { kind: "line", depth: 2, label: "Machine", section: "CAPEX", values: [-10, -20, -30, -40] },
    { kind: "line", depth: 2, label: "Loan repaid", section: "LOAN", values: [-5, -6, -7, -8] },
    { kind: "line", depth: 2, label: "TF drawn", section: "TRADE_FINANCE", values: [1, 2, 3, 4] },
    { kind: "total", depth: 0, label: "Cash Surplus / (Deficit)", values: [36, 36, 36, 36] },
    { kind: "cf", depth: 0, label: "Bank balance c/f", values: [1000, 1036, 1040, 1076] },
  ],
});

function sources() {
  const rows = [
    row("2026-04", { actual: slice({ sales: 1_000_00, net: 100_00 }) }),
    row("2026-05", { actual: slice({ sales: 5_000_00, net: 200_00 }), balanceSheet: bs({ assets: 50_000_00, liabilities: 30_000_00, equity: 20_000_00 }) }),
    row("2026-09", {
      actual: slice({ sales: 40_000_00, net: 3_000_00 }),
      balanceSheet: bs({ assets: 110_000_00, liabilities: 66_000_00, equity: 44_000_00 }),
      labourBase: { headcount: 60, unitsCompleted: 700 },
    }),
    row("2026-10", {
      actual: slice({ sales: 50_000_00, cogs: 33_000_00, gross: 17_000_00, expenses: 12_000_00, net: 5_000_00, materials: 23_900_00 }),
      forecast: slice({ sales: 45_000_00, gross: 14_000_00, net: 4_000_00 }),
      balanceSheet: bs({ assets: 130_000_00, liabilities: 70_000_00, equity: 60_000_00 }),
      labourBase: { headcount: 61, unitsCompleted: 800 },
      costStructure: {
        salesSplit: { bedframe: 1, sofa: 1 },
        categories: [
          { name: "FABRIC", line: "sofa", spend: 15_000_00, purchase: 16_000_00, closing: 5_000_00 },
          { name: "WOOD", line: "bedframe", spend: 8_335_00, purchase: 7_000_00, closing: 2_000_00 },
        ],
      },
      cashFlow: { operating: 5_000_00, investing: -2_000_00, financing: 1_000_00, net: 4_000_00, freeCashFlow: 3_000_00 },
    }),
    row("2026-11", { partial: true, actual: slice({ sales: 20_000_00, net: 1_000_00 }), forecast: slice({ sales: 48_000_00, gross: 15_000_00, net: 4_500_00 }) }),
    row("2026-12", { forecast: slice({ sales: 52_000_00, gross: 16_000_00, net: 5_000_00 }) }),
  ];
  const empty = { columns: [], rows: [] };
  return {
    dashboard: ok({ openingDate: "2026-05-01", rows }),
    plMonthly: ok(empty),
    plCur: ok({}),
    plPrev: ok({}),
    cashflow: ok(empty),
    cashForecast: ok(cfForecast()),
    overview: ok({ aovByCustomer: [], customerConcentration: { all: { totalSen: 0, customerCount: 0, largestName: null, largestPct: null, largestSen: 0, top10Pct: null, top10Sen: 0 } } }),
    revSplitCur: ok({ departments: [] }),
    revSplitPrev: ok({ departments: [] }),
    newModels: ok({ from: "", to: "", models: [] }),
    defects: ok({ month: [], prev: [], trend: [] }),
    workforce: bad("n/a"),
    stockTake: ok({ ym: "2026-10", hasLines: false, linesFile: null, linesSavedAt: null, rows: [] }),
    headcount: ok({ cur: 43, prev: 41, basis: "payslips" }),
    notes: { text: "", updatedAt: null, updatedBy: null },
  };
}
const build = (s = sources()) => shapeBoardReport(s, "2026-10", "2026-11-15", "x");

test("1. cover chart starts at June 2026 and the running month shows its forecast", () => {
  assert.equal(BOARD_DATA_FROM, "2026-06");
  const r = build();
  assert.ok(r.cover.ok);
  const t = r.cover.data.trend;
  assert.ok(t.every((p) => p.ym >= "2026-06"), t.map((p) => p.ym).join());
  const nov = t.find((p) => p.ym === "2026-11");
  assert.equal(nov.kind, "forecast");
  assert.equal(nov.forecastSales, 48_000_00);
  assert.match(fin, /values: \{ sales: t\.kind === "actual" \? t\.sales : t\.forecastSales, net: t\.kind === "actual" \? t\.net : t\.forecastNet/);
});

test("2. income: a revenue donut of COGS, operating expenses and net profit; GP and NP stated", () => {
  const r = build();
  assert.ok(r.income.ok);
  assert.deepEqual(r.income.data.revenueSplit, [
    { label: "Cost of goods sold", value: 33_000_00 },
    { label: "Operating expenses", value: 12_000_00 },
    { label: "Net profit", value: 5_000_00 },
  ]);
  const s = sources();
  s.dashboard.data.rows[3].actual.net = -1_000_00;
  const loss = build(s);
  assert.ok(!loss.income.data.revenueSplit.some((x) => x.label === "Net profit"), "a loss has no slice");
  assert.match(fin, /<h3>Where revenue went<\/h3>/);
  assert.match(fin, /<Donut items=\{d\.revenueSplit \?\? \[\]\}/);
  assert.match(fin, /<span>Gross profit<\/span>/);
  assert.doesNotMatch(fin, /Cost structure \(% of costs\)/);
});

test("4. materials: carriage inwards & SST make the table total equal the tile", () => {
  const r = build();
  assert.ok(r.materials.ok);
  assert.equal(r.materials.data.total, 23_900_00);
  assert.equal(r.materials.data.unsplit, 23_900_00 - (15_000_00 + 8_335_00));
  assert.match(fin, /Carriage inwards &amp; SST \(not by category\)/);
  assert.match(fin, /const spend = catSpend === null \? null : catSpend \+ \(d\.unsplit \?\? 0\);/);
  assert.match(fin, /the closing stock is deducted/);
});

test("5. trend page bars use the forecast for months after M", () => {
  assert.match(fin, /values: \{ s: p\.kind === "actual" \? p\.sales : p\.forecastSales, f: p\.forecastSales \}/);
  assert.match(fin, /values: \{ n: p\.kind === "actual" \? p\.net : p\.forecastNet, f: p\.forecastNet \}/);
});

test("6. balance sheet chart leaves out months with no balance sheet", () => {
  const r = build();
  assert.ok(r.balance.ok);
  // Owner 2026-11-17: months before BOARD_DATA_FROM (Jun 26) are left off every chart too.
  assert.deepEqual(r.balance.data.trend.map((x) => x.ym), ["2026-09", "2026-10"], "April's all-zero balance sheet and May are dropped");
});

test("7. cash flow: forecast months after M by activity, P&L forecast first", () => {
  const fc = cashForecastMonths(cfForecast(), "2026-10");
  assert.deepEqual(fc.map((x) => `${x.ym}:${x.basis}`), ["2026-11:pnl", "2026-12:docs"]);
  assert.deepEqual([fc[0].operating, fc[0].investing, fc[0].financing, fc[0].net, fc[0].fcf], [70, -30, -4, 36, 40]);
  assert.deepEqual([fc[1].operating, fc[1].investing, fc[1].financing], [80, -40, -4]);
  const r = build();
  assert.ok(r.cashFlow.ok);
  assert.equal(r.cashFlow.data.forecast.length, 2);
  assert.match(fin, /x\.basis === "pnl" \? "P&L forecast" : "Docs forecast"/);
});

test("8. cash flow forecast carries operating / investing / financing per column", () => {
  const s = shapeCashForecast(cfForecast(), "2026-10");
  assert.ok(s.ok);
  const oct = s.data.months.find((m) => m.ym === "2026-10");
  const nov = s.data.months.find((m) => m.ym === "2026-11");
  assert.deepEqual(oct.actualCf, { operating: 50, investing: -10, financing: -4, net: 36 });
  assert.deepEqual(nov.docsCf, { operating: 60, investing: -20, financing: -4, net: 36 });
  assert.deepEqual(nov.pnlCf, { operating: 70, investing: -30, financing: -4, net: 36 });
  assert.match(biz, /<h3>Cash flow by activity, RM<\/h3>/);
});

test("9. customers: bedframe vs sofa chart below the share charts", () => {
  assert.match(biz, /<h3>Bedframe vs sofa by customer, RM<\/h3>/);
  assert.match(biz, /values: \{ b: x\.bedframeTotal \?\? 0, s: x\.sofaTotal \?\? 0 \}/);
});

test("10a. efficiency ranks never print a raw worker id", () => {
  const ops = read("src/api/lib/operations-report.ts");
  assert.match(ops, /SELECT id, name, empNo FROM workers/);
  assert.match(ops, /name: nameById\.get\(workerId\) \?\? "Unknown worker"/);
  assert.doesNotMatch(ops, /nameById\.get\(workerId\) \?\? workerId/);
});

test("10b. headcount = production workers paid that month (hours before payslips exist)", () => {
  const nonProd = new Set(["OFFICE"]);
  const slips = [
    { period: "2026-10", departmentCode: "FAB_SEW", employeeId: "a" },
    { period: "2026-10", departmentCode: "FAB_SEW", employeeId: "a" },
    { period: "2026-10", departmentCode: "WOOD_CUT", employeeId: "b" },
    { period: "2026-10", departmentCode: "OFFICE", employeeId: "c" },
    { period: "2026-09", departmentCode: "WOOD_CUT", employeeId: "d" },
  ];
  assert.deepEqual(productionHeadcount("2026-10", slips, [], nonProd), { n: 2, basis: "payslips" });
  const hours = [
    { date: "2026-11-03", workerId: "a", departmentCode: "FAB_SEW", hours: 8 },
    { date: "2026-11-03", workerId: "c", departmentCode: "OFFICE", hours: 8 },
    { date: "2026-11-04", workerId: "e", departmentCode: "WOOD_CUT", hours: 0 },
  ];
  assert.deepEqual(productionHeadcount("2026-11", slips, hours, nonProd), { n: 1, basis: "hours" });
  assert.deepEqual(productionHeadcount("2026-12", slips, hours, nonProd), { n: null, basis: null });
  const r = build();
  assert.equal(r.operations.data.headcount, 43, "the source, not the worker-master count (61)");
  assert.equal(r.operations.data.prevHeadcount, 41);
  assert.equal(r.labour.data.headcount, 43);
  const s = sources();
  delete s.headcount;
  assert.equal(build(s).operations.data.headcount, 61, "a source set without it falls back");
  assert.match(read("src/api/lib/board-report-sources.ts"), /productionHeadcount\(month, slips\.results \?\? \[\], hours\.results \?\? \[\], nonProd\)/);
});

test("11. outlook: GP % row, a Difference column, gross profit on the chart", () => {
  const r = build();
  assert.ok(r.outlook.ok);
  const oct = r.outlook.data.quarter.rows[0];
  assert.equal(oct.kind, "actual");
  assert.deepEqual([oct.sales, oct.fcSales, oct.net, oct.fcNet], [50_000_00, 45_000_00, 5_000_00, 4_000_00]);
  assert.match(biz, /<tr><td>GP %<\/td>/);
  assert.match(biz, /<th>Difference, revenue<\/th>/);
  assert.match(biz, /\{ key: "g", label: "Gross profit forecast"/);
});

test("13. appendix keeps group rows and drops the stock detail lines under purchase groups", () => {
  const p = {
    columns: [{ key: "2026-10", label: "Oct", accum: false }],
    rows: [
      { kind: "group", depth: 0, label: "COST OF GOODS SOLD", values: [10] },
      { kind: "group", depth: 1, label: "RAW MATERIALS", values: [8] },
      { kind: "group", depth: 2, label: "PURCHASE - B.M FABRIC", values: [8] },
      { kind: "line", depth: 3, label: "OPENING STOCK", values: [1] },
      { kind: "line", depth: 3, label: "PURCHASE", values: [9] },
      { kind: "line", depth: 3, label: "CLOSING STOCK", values: [-2] },
      { kind: "line", depth: 1, label: "CARRIAGE INWARDS", values: [1] },
      { kind: "line", depth: 2, label: "WAGES", values: [1] },
    ],
  };
  assert.deepEqual(shapeMatrix(p, "2026-10").rows.map((r) => r.label), ["COST OF GOODS SOLD", "RAW MATERIALS", "PURCHASE - B.M FABRIC", "CARRIAGE INWARDS", "WAGES"]);
});

test("outlook chart: GP and NP as labelled bars, no month-to-date bar (owner 2026-11-17)", () => {
  const b = readFileSync("src/pages/board-report/pages-business.tsx", "utf8");
  assert.match(b, /<ComboChart w=\{w\} h=\{h\} labels/);
  assert.match(b, /\{ key: "g", label: "Gross profit forecast", color: C\.green, type: "bar" \}/);
  assert.match(b, /\{ key: "n", label: "Net profit forecast", color: C\.gold, type: "bar" \}/);
  assert.doesNotMatch(b, /label: "Revenue to date"/);
  assert.doesNotMatch(b, /<td>Revenue to date \(running month\)<\/td>/, "the table row goes too");
  const c = readFileSync("src/pages/board-report/charts.tsx", "utf8");
  assert.match(c, /labels = true/, "amounts are on by default since 2026-11-18");
});
