// board-report.test.mjs — the monthly Board Report (owner 2026-11-10: "every
// figure from live ERP data; nobody should have to ask Claude each month").
// The shaping is pure (src/lib/board-report.ts) and is exercised directly
// with endpoint-shaped fixtures; the server and page wiring is pinned by
// source pattern (house style for UI).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  addMonths,
  boardFlags,
  boardWindows,
  bankCloseAt,
  capRows,
  cleanNotesInput,
  lastClosedMonth,
  notesKey,
  paginate,
  parseNotes,
  resolveBoardMonth,
  shapeBoardReport,
  shapeBsAppendix,
  shapeCashForecast,
  shapeMatrix,
  stockTakeFlags,
} from "../src/lib/board-report.ts";
import { compareStockTake, isStockTakeMismatch } from "../src/lib/stock-take-check.ts";
import { countEfficiencyBands, efficiencyBand, EFFICIENCY_WARN_LOW, EFFICIENCY_WARN_HIGH, EFFICIENCY_MIN_RANK_MINUTES } from "../src/lib/efficiency-bands.ts";
import { workerEfficiencyPcts } from "../src/api/lib/workforce-perf.ts";

const read = (p) => readFileSync(p, "utf8");

const slice = (o = {}) => ({
  sales: 0, cogs: 0, gross: 0, otherIncome: 0, expenses: 0, net: 0, materials: 0, labour: 0, overhead: 0,
  stockMovement: 0, staffCost: 0, otherOpex: 0, estimated: 0, ...o,
});
const bs = (o = {}) => ({ assets: 0, liabilities: 0, equity: 0, currentAssets: 0, currentLiabilities: 0, inventory: 0, ...o });
const row = (key, o = {}) => ({
  key, label: key, partial: false, actual: null, forecast: null, balanceSheet: null,
  cashFlow: { operating: 0, investing: 0, financing: 0, net: 0, freeCashFlow: 0 }, ...o,
});
const ok = (data) => ({ ok: true, data });
const bad = (error) => ({ ok: false, error });

function fixture() {
  const rows = [
    row("2026-08", { actual: slice({ sales: 30_000_00, gross: 9_000_00, net: 2_000_00, staffCost: 5_000_00, labour: 8_000_00 }), balanceSheet: bs({ assets: 100_000_00, liabilities: 60_000_00, equity: 40_000_00 }) }),
    row("2026-09", {
      actual: slice({ sales: 40_000_00, cogs: 28_000_00, gross: 12_000_00, net: 3_000_00, materials: 15_000_00, labour: 10_000_00, overhead: 3_000_00, staffCost: 6_000_00, otherOpex: 3_000_00, expenses: 9_000_00 }),
      forecast: slice({ sales: 38_000_00, net: 2_500_00 }),
      balanceSheet: bs({ assets: 110_000_00, liabilities: 66_000_00, equity: 44_000_00, currentAssets: 70_000_00, currentLiabilities: 50_000_00, inventory: 20_000_00 }),
      salaryByDept: [{ dept: "FAB_SEW", costSen: 6_000_00 }, { dept: "WOOD_CUT", costSen: 4_000_00 }],
      costStructure: { salesSplit: { bedframe: 1, sofa: 1 }, categories: [{ name: "FABRIC", line: "sofa", spend: 9_000_00, purchase: 10_000_00, closing: 4_000_00 }] },
    }),
    row("2026-10", {
      actual: slice({ sales: 50_000_00, cogs: 33_000_00, gross: 17_000_00, net: -1_000_00, materials: 20_000_00, labour: 9_000_00, overhead: 4_000_00, staffCost: 1_000_00, otherOpex: 17_000_00, expenses: 18_000_00, estimated: 50_000 }),
      forecast: slice({ sales: 45_000_00, gross: 14_000_00, net: 4_000_00, labour: 9_500_00 }),
      balanceSheet: bs({ assets: 130_000_00, liabilities: 70_000_00, equity: 60_000_00, currentAssets: 85_000_00, currentLiabilities: 52_000_00, inventory: 25_000_00 }),
      ratios: { grossMarginPct: 34, netMarginPct: -2, currentRatio: 1.63, quickRatio: 1.15, debtToAssetPct: 53.85, roePct: -1.67, roaPct: -0.77 },
      labourBase: { headcount: 40, unitsCompleted: 800 },
      productionRevenue: { bedframe: 30_000_00, sofa: 25_000_00, accessory: 5_000_00, total: 60_000_00 },
      salaryByDept: [
        { dept: "FAB_SEW", costSen: 5_000_00, forecastSen: 5_200_00 },
        { dept: "WOOD_CUT", costSen: 4_000_00, forecastSen: 4_300_00 },
        { dept: "OFFICE", costSen: 3_000_00, nonProd: true },
      ],
      costStructure: {
        salesSplit: { bedframe: 1, sofa: 1 },
        forecast: { FABRIC: 11_000_00 },
        categories: [
          { name: "FABRIC", line: "sofa", spend: 8_000_00, purchase: 9_000_00, closing: 5_000_00 },
          { name: "FABRIC", line: "bedframe", spend: 4_000_00, purchase: 4_000_00, closing: 1_000_00 },
          { name: "WOOD", line: "bedframe", spend: 8_000_00, purchase: 7_000_00, closing: 2_000_00 },
        ],
      },
      cashFlow: { operating: 5_000_00, investing: -2_000_00, financing: 1_000_00, net: 4_000_00, freeCashFlow: 3_000_00 },
    }),
    row("2026-11", { partial: true, actual: slice({ sales: 20_000_00, net: 1_000_00 }), forecast: slice({ sales: 48_000_00, net: 4_500_00 }) }),
    row("2026-12", { forecast: slice({ sales: 52_000_00, net: 5_000_00 }) }),
  ];
  return {
    dashboard: ok({ openingDate: "2026-08-01", rows }),
    plMonthly: ok({ fyLabel: "FY2026", columns: [{ key: "acc", label: "Accumulated", accum: true }, { key: "2026-10", label: "Oct 2026", accum: false }, { key: "2026-09", label: "Sep 2026", accum: false }], rows: [{ kind: "line", depth: 0, label: "Sales", values: [120_000_00, 50_000_00, 40_000_00] }, { kind: "gap", depth: 0, label: "", values: [] }] }),
    plCur: ok({ totals: { netProfit: 4_000_00 }, balanceSheet: [{ accountCode: "300-0000", accountName: "Debtors", category: "CURRENT_ASSET", balance: 50_000_00 }, { accountCode: "200-0000", accountName: "Machinery", category: "FIXED_ASSET", balance: 45_000_00 }] }),
    plPrev: ok({ balanceSheet: [{ accountCode: "300-0000", accountName: "Debtors", category: "CURRENT_ASSET", balance: 40_000_00 }] }),
    cashflow: ok({ columns: [{ key: "acc", label: "FY", accum: true }, { key: "2026-10", label: "Oct'26", ym: "2026-10" }, { key: "2026-09", label: "Sep'26", ym: "2026-09" }], rows: [{ kind: "bf", depth: 0, label: "Bank b/f", values: [0, 10_000_00, 7_000_00] }, { kind: "cf", depth: 0, label: "Bank c/f", values: [14_000_00, 14_000_00, 10_000_00] }] }),
    cashForecast: ok({ today: "2026-11-10", columns: [{ key: "2026-10", label: "Oct", ym: "2026-10" }, { key: "fc:2026-10", label: "Oct F", ym: "2026-10", forecast: true }, { key: "2026-11", label: "Nov", ym: "2026-11" }, { key: "fc:2026-11", label: "Nov F", ym: "2026-11", forecast: true }, { key: "fp:2026-11", label: "Nov P", ym: "2026-11", forecast: true, forecastKind: "pnl" }, { key: "fc:2026-12", label: "Dec F", ym: "2026-12", forecast: true, future: true }], rows: [{ kind: "cf", depth: 0, label: "c/f", values: [14_000_00, 13_500_00, 9_000_00, 16_000_00, 15_000_00, 18_000_00] }] }),
    overview: ok({
      aovByCustomer: Array.from({ length: 12 }, (_, i) => ({ customerName: `C${i + 1}`, bedframeAvgSen: 500_00, bedframeUnits: i, sofaAvgSen: 0, sofaSets: 0, totalSen: (12 - i) * 1_000_00 })),
      aovCompany: { bedframeAvgSen: 500_00, bedframeUnits: 66, sofaAvgSen: 0, sofaSets: 0, totalSen: 100_000_00 },
      customerConcentration: { all: { totalSen: 100_000_00, customerCount: 20, largestName: "C1", largestPct: 12, largestSen: 12_000_00, top10Pct: 75, top10Sen: 75_000_00 } },
    }),
    revSplitCur: ok({ departments: [{ code: "FAB_SEW", label: "Fabric Sewing", period: { bedframe: 0, sofa: 0, accessory: 0, unclassified: 0, total: 25_000_00 } }, { code: "WOOD_CUT", label: "Wood Cutting", period: { bedframe: 0, sofa: 0, accessory: 0, unclassified: 0, total: 0 } }] }),
    revSplitPrev: ok({ departments: [{ code: "FAB_SEW", label: "Fabric Sewing", period: { bedframe: 0, sofa: 0, accessory: 0, unclassified: 0, total: 20_000_00 } }] }),
    newModels: ok({ from: "2026-08-01", to: "2026-10-31", priceNote: "note", models: Array.from({ length: 11 }, (_, i) => ({ code: `M${i}`, category: "SOFA", name: `Model ${i}`, added: `2026-10-${String(10 + i).padStart(2, "0")}`, skus: 1, sizes: "", price: "RM 1", price2: "", hasPhoto: false, photo: null })) }),
    defects: ok({ month: [{ category: "BEDFRAME", cases: 4, units: 200, rate: 2 }], prev: [], trend: [] }),
    workforce: bad("Not available to your role (needs workers read)"),
    stockTake: ok({ ym: "2026-10", hasLines: true, linesFile: "count.xlsx", linesSavedAt: "2026-11-01T00:00:00Z", rows: [] }),
    notes: { text: "Finance note", updatedAt: "2026-11-09T02:00:00Z", updatedBy: "Lim" },
  };
}

// ── month helpers ─────────────────────────────────────────────────────────
test("month maths and the default month (last closed, Malaysia date)", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(lastClosedMonth("2026-11-10"), "2026-10");
  assert.equal(resolveBoardMonth(null, "2026-11-10"), "2026-10");
  assert.equal(resolveBoardMonth("2026-08", "2026-11-10"), "2026-08");
  assert.equal(resolveBoardMonth("2026-12", "2026-11-10"), "2026-10", "a future month falls back");
  assert.equal(resolveBoardMonth("2026-13", "2026-11-10"), "2026-10");
  const w = boardWindows("2026-10", "2026-11-10");
  assert.deepEqual([w.prev, w.quarterAgo, w.running, w.dashFrom, w.dashTo], ["2026-09", "2026-07", "2026-11", "2025-11", "2027-02"]);
  assert.deepEqual([w.newModelsFrom, w.newModelsTo], ["2026-08-01", "2026-10-31"]);
});

test("capRows folds the tail into one Other (n more) row", () => {
  const rows = [1, 2, 3, 4, 5].map((v) => ({ label: String(v), v }));
  const merge = (rest, label) => ({ label, v: rest.reduce((t, x) => t + x.v, 0) });
  assert.equal(capRows(rows, 5, merge).length, 5);
  const capped = capRows(rows, 3, merge);
  assert.deepEqual(capped.map((x) => x.label), ["1", "2", "Other (3 more)"]);
  assert.equal(capped[2].v, 12);
  assert.deepEqual(paginate([1, 2, 3], 2), [[1, 2], [3]]);
  assert.deepEqual(paginate([], 2), [[]]);
});

// ── shaping ───────────────────────────────────────────────────────────────
test("cover + income statement read the dashboard row, forecast and since-opening", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "2026-11-10T00:00:00Z");
  assert.equal(r.monthLabel, "October 2026");
  assert.ok(r.cover.ok);
  const [rev, , net, cash] = r.cover.data.tiles;
  assert.equal(rev.value, 50_000_00);
  assert.equal(rev.prev, 40_000_00);
  assert.equal(rev.forecast, 45_000_00);
  assert.equal(net.value, -1_000_00);
  assert.equal(cash.value, 14_000_00, "bank c/f at October's actual column");
  assert.equal(cash.prev, 10_000_00);
  assert.ok(r.income.ok);
  const sales = r.income.data.rows.find((x) => x.key === "sales");
  assert.equal(sales.since, 120_000_00, "Aug + Sep + Oct");
  assert.equal(r.income.data.sinceLabel, "Since opening");
  assert.equal(r.income.data.rows.find((x) => x.key === "materials").pctOfSales, 40);
  assert.equal(r.income.data.estimated, 50_000);
});

test("labour: production departments only, shares and both production-revenue bases", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "x");
  assert.ok(r.labour.ok);
  const d = r.labour.data;
  assert.deepEqual(d.depts.map((x) => x.dept), ["FAB_SEW", "WOOD_CUT"], "OFFICE (non-production) is left out");
  assert.equal(d.total, 9_000_00);
  const sew = d.depts[0];
  assert.equal(sew.share, 55.56);
  assert.equal(sew.pctTotalProdRev, 8.33);
  assert.equal(sew.pctOwnProdRev, 20, "5,000 of FAB_SEW's own 25,000");
  assert.equal(sew.prev, 6_000_00);
  assert.equal(d.depts[1].pctOwnProdRev, null, "no own production revenue → no ratio, never 0");
  assert.equal(d.forecastTotal, 9_500_00);
});

test("materials merge a category across lines and keep the forecast", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "x");
  assert.ok(r.materials.ok);
  const fabric = r.materials.data.cats.find((x) => x.name === "FABRIC");
  assert.equal(fabric.spend, 12_000_00);
  assert.equal(fabric.forecast, 11_000_00);
  assert.equal(fabric.prev, 9_000_00);
});

test("trend: closed months, the running month to date, next month's forecast", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "x");
  assert.ok(r.trend.ok);
  assert.deepEqual(r.trend.data.points.map((p) => `${p.ym}:${p.kind}`), ["2026-08:actual", "2026-09:actual", "2026-10:actual", "2026-11:mtd", "2026-12:forecast"]);
  assert.equal(r.trend.data.summary.at(-1).sales, 52_000_00);
  assert.equal(r.trend.data.last3.length, 3);
});

test("balance sheet: change, three months ago, equity movement against profit", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "x");
  assert.ok(r.balance.ok);
  const eq = r.balance.data.rows.find((x) => x.label === "Equity (net assets)");
  assert.equal(eq.change, 16_000_00);
  assert.equal(eq.quarterAgo, null, "July is not in the fixture");
  assert.deepEqual(r.balance.data.equity, { opening: 44_000_00, net: -1_000_00, other: 17_000_00, closing: 60_000_00 });
});

test("cash forecast splits Actual, Docs and P&L columns; bank month end reads the c/f row", () => {
  const f = fixture();
  const s = shapeCashForecast(f.cashForecast.data, "2026-10");
  assert.ok(s.ok);
  assert.deepEqual(s.data.months.map((m) => [m.ym, m.actual, m.docs, m.pnl]), [
    ["2026-10", 14_000_00, 13_500_00, null],
    ["2026-11", 9_000_00, 16_000_00, 15_000_00],
    ["2026-12", null, 18_000_00, null],
  ]);
  assert.equal(bankCloseAt(f.cashflow.data, "2026-09"), 10_000_00);
  assert.equal(bankCloseAt(f.cashflow.data, "2026-07"), null);
});

test("customers cap at ten plus Other; new models cap at nine cards", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "x");
  assert.ok(r.customers.ok);
  assert.equal(r.customers.data.rows.length, 11);
  assert.equal(r.customers.data.rows.at(-1).name, "Other (10 more)");
  assert.equal(r.customers.data.rows[0].share, 12);
  assert.ok(r.newModels.ok);
  assert.equal(r.newModels.data.models.length, 9);
  assert.deepEqual(r.newModels.data.more, ["M1", "M0"]);
});

test("outlook lists forecast months after M and the next quarter", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "x");
  assert.ok(r.outlook.ok);
  assert.deepEqual(r.outlook.data.months.map((m) => m.ym), ["2026-11", "2026-12"]);
  assert.equal(r.outlook.data.quarter.label, "Q4 2026");
  assert.equal(r.outlook.data.quarter.rows[0].kind, "actual");
  assert.equal(r.outlook.data.quarter.rows[1].kind, "mtd");
  assert.equal(r.outlook.data.quarter.sales, 50_000_00 + 48_000_00 + 52_000_00);
});

test("operations: department production value against last month, defects, workforce reason", () => {
  const r = shapeBoardReport(fixture(), "2026-10", "2026-11-10", "x");
  assert.ok(r.operations.ok);
  const d = r.operations.data;
  assert.equal(d.prodMix[0].change, 25);
  assert.equal(d.prodTotal, 60_000_00);
  assert.equal(d.defects[0].rate, 2);
  assert.equal(d.workforce, null);
  assert.match(d.workforceNote, /workers read/);
});

test("a failed source is a section error, never zeros", () => {
  const f = fixture();
  f.dashboard = bad("HTTP 500");
  f.overview = bad("Not available to your role (Forbidden)");
  const r = shapeBoardReport(f, "2026-10", "2026-11-10", "x");
  for (const k of ["cover", "income", "labour", "materials", "trend", "balance", "cashFlow", "operations", "outlook"]) {
    assert.equal(r[k].ok, false, k);
    assert.equal(r[k].error, "HTTP 500");
  }
  assert.equal(r.customers.ok, false);
  assert.ok(r.notes.flags.some((x) => x.text.startsWith("Financial Dashboard could not be loaded")));
});

test("flags: staff cost drop, equity vs profit, net loss, estimates, ledger P&L mismatch", () => {
  const flags = boardFlags(fixture(), "2026-10").map((x) => x.text);
  assert.ok(flags.some((t) => /^Staff cost RM 1,000 is 83% below September 2026/.test(t)), flags.join("\n"));
  assert.ok(flags.some((t) => /^Equity moved RM 16,000 but net profit was RM -1,000/.test(t)));
  assert.ok(flags.some((t) => /^October 2026: net loss of RM 1,000/.test(t)));
  assert.ok(flags.some((t) => /RM 500 of estimates/.test(t)));
  assert.ok(flags.some((t) => /Monthly P&L \(RM -1,000\) and the ledger P&L report \(RM 4,000\)/.test(t)));
  assert.ok(flags.some((t) => /Workforce efficiency left out/.test(t)));
});

test("appendices: matrix picks months up to M then year to date; balance sheet by section", () => {
  const f = fixture();
  const m = shapeMatrix(f.plMonthly.data, "2026-10");
  assert.deepEqual(m.columns, ["Oct 26", "Sep 26", "Year to date"]);
  assert.deepEqual(m.rows.map((x) => x.values), [[50_000_00, 40_000_00, 120_000_00]], "gap rows dropped");
  const b = shapeBsAppendix(f.plCur.data, f.plPrev.data);
  assert.deepEqual(b.rows.map((x) => x.label), ["Fixed asset", "200-0000 Machinery", "Total fixed asset", "Current asset", "300-0000 Debtors", "Total current asset"]);
  assert.deepEqual(b.rows[4].values, [50_000_00, 40_000_00, 10_000_00]);
});

test("notes: key, parse and write validation", () => {
  assert.equal(notesKey("2026-10"), "board_report_notes:2026-10");
  assert.deepEqual(parseNotes(null), { text: "", updatedAt: null, updatedBy: null });
  assert.equal(parseNotes('{"text":"a","updatedAt":"t","updatedBy":"u"}').text, "a");
  assert.deepEqual(cleanNotesInput({ month: "2026-10", text: "line  \r\nnext\n\n" }), { ok: true, month: "2026-10", text: "line\nnext" });
  assert.equal(cleanNotesInput({ month: "2026-1", text: "x" }).ok, false);
  assert.equal(cleanNotesInput({ month: "2026-10" }).ok, false);
  assert.equal(cleanNotesInput({ month: "2026-10", text: "x".repeat(4001) }).ok, false);
});

// ── wiring (source patterns) ──────────────────────────────────────────────
test("the endpoint is accounting:read, notes need accounting:update, sources are in-process", () => {
  const src = read("src/api/routes/reports.ts");
  const board = src.slice(src.indexOf('app.get("/board"'), src.indexOf('app.put("/board/notes"'));
  assert.match(board, /requirePermission\(c, "accounting", "read"\)/);
  const notes = src.slice(src.indexOf('app.put("/board/notes"'));
  assert.match(notes.slice(0, 400), /requirePermission\(c, "accounting", "update"\)/);
  assert.match(notes, /board_report_notes|notesKey\(/);
  assert.match(notes, /emitAudit\(/);
  const sources = read("src/api/lib/board-report-sources.ts");
  for (const p of ["/dashboard?granularity=month", "/pl-monthly?anchor=", "/pl?period=", "/cashflow-statement?period=", "/cashflow-forecast?period=", "/revenue-split?period=", "/new-models?from=", "defectRates(", "collectWorkforce("]) {
    assert.ok(sources.includes(p), p);
  }
  assert.match(sources, /hasPermission\(c, "workers", "read"\)/, "worker names only for workers:read");
  const helper = read("src/api/lib/in-process-get.ts");
  assert.match(helper, /ic\.set\(k as never, v as never\)/, "copies the caller's context so each route checks the real caller");
  assert.match(helper, /method: "GET"/);
});

test("menu, route and gate: Forecasting › Board Report for accounting:read", async () => {
  const side = read("src/components/layout/sidebar.tsx");
  const forecasting = side.slice(side.indexOf('label: "FORECASTING"'), side.indexOf('label: "HR & OPERATIONS"'));
  assert.match(forecasting, /\{ name: "Board Report", href: "\/board-report"/);
  const { resourceForNav } = await import("../src/api/lib/nav-permissions.ts");
  assert.equal(resourceForNav("/board-report?month=2026-10"), "accounting");
  const routes = read("src/dashboard-routes.tsx");
  assert.match(routes, /path: '\/board-report'/);
  assert.match(routes, /'\/board-report': \(\) => import\('\.\/pages\/board-report'\)/);
});

test("the page prints as A4: one page per section, page breaks, Download PDF = window.print()", () => {
  const css = read("src/pages/board-report/board-report.css");
  assert.match(css, /@page \{ size: A4 portrait; margin: 0; \}/);
  assert.match(css, /\.brp-page \{[^}]*width: 210mm; height: 297mm;/);
  assert.match(css, /break-after: page/);
  assert.match(css, /\.brp-body \{[^}]*overflow: hidden/);
  const page = read("src/pages/board-report/index.tsx");
  assert.match(page, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(page, /\/api\/reports\/board\?month=/);
  assert.match(page, /\/api\/reports\/board\/notes/);
  for (const p of ["CoverPage", "IncomePage", "LabourPage", "MaterialsPage", "TrendPage", "BalancePage", "CashFlowPage", "CashForecastPage", "CustomersPage", "NewModelsPage", "OperationsPage", "OutlookPage", "NotesPage", "Appendices"]) {
    assert.ok(page.includes(`<${p} r={data} />`), p);
  }
  // Every page has exactly one elastic chart at most, so each fills its sheet without overflowing.
  for (const f of ["pages-finance.tsx", "pages-business.tsx"]) {
    const s = read(`src/pages/board-report/${f}`);
    for (const chunk of s.split(/export function /).slice(1)) {
      const n = (chunk.match(/<Elastic>/g) ?? []).length;
      assert.ok(n <= 2, `${chunk.slice(0, 20)} has ${n} elastic charts`);
    }
  }
});

test("the board call is exempt from the 30 s client abort", () => {
  assert.match(read("src/lib/api-client.ts"), /NO_TIMEOUT_PATH = .*reports\\\/board/);
});

// ── stock-take: stored vs its counted lines (page 13) ─────────────────────
test("stock-take check: stored per group vs the sum of its counted lines", () => {
  const stored = [{ itemGroup: "FABRIC", valueSen: 14_877_00 }, { itemGroup: "WOOD", valueSen: 20_000_00 }, { itemGroup: "FOAM", valueSen: 5_000_00 }];
  const record = {
    file: "oct.xlsx", savedAt: "2026-11-01T01:00:00Z",
    lines: [
      { group: "FABRIC", valueSen: 90_000_00, counted: true },
      { group: "fabric ", valueSen: 7_660_00, counted: true },
      { group: "FABRIC", valueSen: 1_000_00, counted: false },
      { group: "WOOD", valueSen: 20_050_00, counted: true },
      { group: "SPONGE", valueSen: 3_000_00, counted: true },
      { group: "FOAM", valueSen: 9_999_00, counted: false },
    ],
  };
  const r = compareStockTake("2026-10", stored, record);
  assert.equal(r.hasLines, true);
  assert.equal(r.linesFile, "oct.xlsx");
  const by = Object.fromEntries(r.rows.map((x) => [x.group, x]));
  assert.deepEqual(by.FABRIC, { group: "FABRIC", storedSen: 14_877_00, linesSen: 97_660_00, countedLines: 2, diffSen: 82_783_00, mismatch: true });
  assert.equal(by.WOOD.mismatch, false, "RM 50 apart is under RM 100");
  assert.equal(by.FOAM.linesSen, null, "a group left out of the count is not compared");
  assert.equal(by.FOAM.mismatch, false);
  assert.equal(by.SPONGE.storedSen, null, "counted but nothing stored: the P&L uses the automatic figure");
  assert.equal(by.SPONGE.mismatch, true);
  assert.equal(compareStockTake("2026-10", stored, null).hasLines, false);
});

test("stock-take mismatch needs more than RM 100 AND more than 1%", () => {
  assert.equal(isStockTakeMismatch(1_000_000_00, 1_000_500_00), false, "RM 500 on RM 1m is under 1%");
  assert.equal(isStockTakeMismatch(5_000_00, 5_100_00), false, "exactly RM 100 is not more than RM 100");
  assert.equal(isStockTakeMismatch(5_000_00, 5_101_00), true);
  assert.equal(isStockTakeMismatch(14_877_00, 97_660_00), true);
});

test("page 13 flags a stock-take group whose stored value differs from its lines", () => {
  const f = fixture();
  f.stockTake = ok(compareStockTake("2026-10", [{ itemGroup: "FABRIC", valueSen: 14_877_00 }], { lines: [{ group: "FABRIC", valueSen: 97_660_00, counted: true }] }));
  const flags = boardFlags(f, "2026-10");
  const st = flags.find((x) => x.text.startsWith("Fabric stock take"));
  assert.ok(st, flags.map((x) => x.text).join("\n"));
  assert.equal(st.level, "alert");
  assert.equal(st.text, "Fabric stock take: RM 14,877 stored, RM 97,660 from its lines — which is right changes raw-material cost.");
  assert.equal(stockTakeFlags(ok(compareStockTake("2026-10", [{ itemGroup: "FABRIC", valueSen: 1 }], null)), "2026-10")[0].level, "info", "no lines saved: says it cannot check");
  assert.deepEqual(stockTakeFlags(ok(compareStockTake("2026-10", [], null)), "2026-10"), [], "no stock take at all: nothing to say");
  f.stockTake = bad("Forbidden");
  assert.ok(boardFlags(f, "2026-10").some((x) => x.text === "Stock-take check could not be loaded: Forbidden"));
});

test("stock-take check wiring: accounting:read, both stored and lines read, in-process from the board", () => {
  const acc = read("src/api/routes/accounting.ts");
  const at = acc.indexOf('app.get("/stock-take/check"');
  assert.ok(at > 0);
  const body = acc.slice(at, acc.indexOf("\n});", at));
  assert.match(body, /requirePermission\(c, "accounting", "read"\)/);
  assert.match(body, /FROM stock_take WHERE org_id = \? AND ym = \?/);
  assert.match(body, /stockTakeLinesKey\(orgId, ym\)/);
  assert.match(body, /compareStockTake\(/);
  assert.doesNotMatch(body, /INSERT|UPDATE |DELETE/, "read-only");
  assert.match(read("src/api/lib/board-report-sources.ts"), /\/stock-take\/check\?ym=\$\{month\}/);
});

// ── efficiency bands (page 11) ────────────────────────────────────────────
test("efficiency bands: one shared definition, the Employees page's inclusive 90–150", () => {
  assert.equal(EFFICIENCY_WARN_LOW, 90);
  assert.equal(EFFICIENCY_WARN_HIGH, 150);
  assert.equal(EFFICIENCY_MIN_RANK_MINUTES, 60);
  assert.equal(efficiencyBand(89.99), "below");
  assert.equal(efficiencyBand(90), "within");
  assert.equal(efficiencyBand(150), "within");
  assert.equal(efficiencyBand(150.01), "above");
  assert.deepEqual(countEfficiencyBands([50, 95, 120, 150, 151, NaN]), { below: 1, within: 3, above: 1, ranked: 5, low: 90, high: 150 });
  const page = read("src/pages/dashboards/EmployeesInsights.tsx");
  assert.match(page, /from "@\/lib\/efficiency-bands"/);
  assert.match(page, /const WARN_LOW = EFFICIENCY_WARN_LOW;/);
  assert.match(page, /const WARN_HIGH = EFFICIENCY_WARN_HIGH;/);
  assert.doesNotMatch(page, /const WARN_LOW = 90/, "no second definition");
});

test("workerEfficiencyPcts = the Employees page's per-person ratio of sums", () => {
  const days = [
    { date: "2026-10-01", workingMinutes: 0, productionMinutes: 0, allDeptMinutes: 0, workers: [
      { workerId: "a", workingMinutes: 480, productionMinutes: 240, allDeptMinutes: 480 },
      { workerId: "b", workingMinutes: 480, productionMinutes: 960, allDeptMinutes: 480 },
      { workerId: "t", workingMinutes: 480, productionMinutes: 480, allDeptMinutes: 480 },
      { workerId: "c", workingMinutes: 30, productionMinutes: 30, allDeptMinutes: 30 },
    ] },
    { date: "2026-10-02", workingMinutes: 0, productionMinutes: 0, allDeptMinutes: 0, workers: [
      { workerId: "a", workingMinutes: 480, productionMinutes: 480, allDeptMinutes: 480 },
    ] },
    { date: "2026-09-30", workingMinutes: 0, productionMinutes: 0, allDeptMinutes: 0, workers: [
      { workerId: "a", workingMinutes: 480, productionMinutes: 4800, allDeptMinutes: 480 },
    ] },
  ];
  const r = workerEfficiencyPcts(days, (d) => d.startsWith("2026-10"), (id) => id !== "t", 60);
  assert.deepEqual(r.map((x) => [x.workerId, x.pct]), [["b", 200], ["a", 75]], "c under an hour and t not headcount are dropped; September ignored");
  assert.deepEqual(countEfficiencyBands(r.map((x) => x.pct)), { below: 1, within: 0, above: 1, ranked: 2, low: 90, high: 150 });
});

test("page 11 shows the bands next to the existing top / bottom workers, behind workers:read", () => {
  const src = read("src/api/lib/board-report-sources.ts");
  const wf = src.slice(src.indexOf("const workforce = guarded"), src.indexOf("const notes ="));
  assert.ok(wf.indexOf('hasPermission(c, "workers", "read")') < wf.indexOf("loadMonthPerfDays("), "gate first");
  assert.match(wf, /workerEfficiencyPcts\(/);
  assert.match(wf, /countsToHeadcount\(/);
  assert.match(wf, /EFFICIENCY_MIN_RANK_MINUTES/);
  assert.match(wf, /topEfficiency: wf\.topEfficiency/);
  const page = read("src/pages/board-report/pages-business.tsx");
  const ops = page.slice(page.indexOf("export function OperationsPage"), page.indexOf("export function OutlookPage"));
  assert.match(ops, /Workers by efficiency band/);
  assert.match(ops, /bands\.below/);
  assert.match(ops, /bands\.within/);
  assert.match(ops, /bands\.above/);
  assert.match(ops, /Highest efficiency/);
});
