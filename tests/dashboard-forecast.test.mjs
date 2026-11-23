// ---------------------------------------------------------------------------
// Financial Dashboard: the Cash Flow and Balance Sheet cards with their
// forecasts (owner 2026-11-23 「dashboard那边的balance sheet 和 cash flow 可以
// 显示forecast的相对应数据」, 「不可以都显示吗？」 → 「Build it」): both Cash Flow
// forecasts (P&L and documents), the Forecast Balance Sheet, and the periods
// ahead with the forecast only. Made-up figures only.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  bsForecastByBucket, bsTotals, cashForecastByBucket, dashAheadRows, dashBsForecast, dashBucketOf, dashCashForecast,
} from "../src/lib/dashboard-forecast.ts";
import { FC_CASH } from "../src/lib/forecast-bs.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// A Cash Flow statement as the page gets it: a column per actual / Docs / P&L month.
const columns = [{ key: "__accum__" }, { key: "fc:2026-12" }, { key: "fp:2026-12" }, { key: "2026-11" }, { key: "fc:2026-11" }, { key: "fp:2026-11" }];
const rows = [
  { kind: "result", label: "Net operation surplus / (deficit)", values: [0, 100, 90, 70, 60, 50] },
  { kind: "line", label: "Machine", section: "CAPEX", values: [0, -10, -10, 0, 0, -5] },
  { kind: "line", label: "Draws", section: "TRADE_FINANCE", values: [0, 30, 20, 0, 10, 0] },
  { kind: "total", label: "Cash Surplus / (Deficit)", values: [0, 120, 100, 70, 70, 45] },
];

test("each month's two Cash Flow forecasts, read with the card's own split", () => {
  const fc = dashCashForecast({ columns, rows });
  assert.deepEqual(Object.keys(fc).sort(), ["2026-11", "2026-12"]);
  assert.deepEqual(fc["2026-12"].docs, { operating: 100, investing: -10, financing: 30, net: 120, freeCashFlow: 90 });
  assert.deepEqual(fc["2026-12"].pnl, { operating: 90, investing: -10, financing: 20, net: 100, freeCashFlow: 80 });
  assert.deepEqual(fc["2026-11"].pnl, { operating: 50, investing: -5, financing: 0, net: 45, freeCashFlow: 45 });
});

test("a quarter adds up its months' cash forecasts; the balance sheet reads its last month-end", () => {
  const fc = dashCashForecast({ columns, rows });
  const q = cashForecastByBucket(fc, "quarter");
  assert.deepEqual(q["2026-Q4"].docs, { operating: 160, investing: -10, financing: 40, net: 190, freeCashFlow: 150 });
  assert.equal(dashBucketOf("2027-01", "quarter"), "2027-Q1");
  assert.equal(dashBucketOf("2026-12", "month"), "2026-12");
  const bs = bsForecastByBucket({ "2026-11": { assets: 1, liabilities: 1, debtPct: 100 }, "2026-12": { assets: 4, liabilities: 1, debtPct: 25 } }, "quarter");
  assert.deepEqual(bs, { "2026-Q4": { assets: 4, liabilities: 1, debtPct: 25 } });
});

const entry = (accountCode, category, balance) => ({ accountCode, accountName: accountCode, category, balance });

test("the Forecast Balance Sheet's totals, added up as the card adds up the actual sheet", () => {
  const opening = [entry("200-1", "FIXED_ASSET", 1_000), entry("310-1", "CURRENT_ASSET", 500), entry("400-0000", "CURRENT_LIABILITY", 600), entry("500-1", "EQUITY", 900)];
  assert.deepEqual(bsTotals(opening), { assets: 1_500, liabilities: 600, debtPct: 40 });
  // November: 200 cash paid to the creditors.
  const fc = {
    startYm: "2026-10", months: ["2026-11"], deltas: { "2026-11": { "400-0000": 200, [FC_CASH]: -200 } },
    accounts: {}, salaryAccount: "410-0010", arAccounts: [], bankAccounts: [], stockAccounts: [], openingReceipts: {},
  };
  assert.deepEqual(dashBsForecast(fc, opening), { "2026-11": { assets: 1_300, liabilities: 400, debtPct: 30.77 } });
});

test("the periods ahead: those not yet happened that a forecast covers, in order, up to the first gap", () => {
  const r = (key, actual) => ({ key, actual });
  const all = [r("2026-10", {}), r("2026-11", {}), r("2026-12", null), r("2027-01", null), r("2027-02", null), r("2027-03", null)];
  const shown = all.slice(0, 2);
  assert.deepEqual(dashAheadRows(all, shown, new Set(["2026-12", "2027-01", "2027-03"])).map((x) => x.key), ["2026-12", "2027-01"]);
  assert.deepEqual(dashAheadRows(all, shown, new Set()), []);
});

test("the dashboard: two dashed forecast lines and their rows on Cash Flow, the forecast sheet ahead on Balance Sheet", () => {
  const page = read("src/pages/finance-dashboard.tsx");
  assert.match(page, /fetch\("\/api\/accounting\/cashflow-forecast", \{ cache: "no-store" \}\)/);
  assert.match(page, /fetch\("\/api\/accounting\/bs-forecast", \{ cache: "no-store" \}\)/);
  assert.match(page, /fetch\(`\/api\/accounting\/pl\?period=\$\{j\.data\.startYm\}`\)/);
  // Since 2026-11-23 「Both follow the tab」: the chart's lines are the tab picked, actual and both forecasts.
  assert.match(page, /line=\{\{ key: "value", name: CF_TAB_LABEL\[cfTab\], color: CH\.net \}\}/);
  assert.match(page, /\{ key: "fcPnl", name: `\$\{CF_TAB_LABEL\[cfTab\]\} forecast \(P&L\)`, color: CH\.fc, dashed: true \}/);
  assert.match(page, /\{ key: "fcDocs", name: `\$\{CF_TAB_LABEL\[cfTab\]\} forecast \(documents\)`, color: CH\.teal, dashed: true \}/);
  assert.doesNotMatch(page, /fcPnlNet|fcDocsNet/, "no net-only forecast lines left beside a tab's table");
  assert.match(page, /data-dash-cf-fc="pnl"/);
  assert.match(page, /data-dash-cf-fc="docs"/);
  assert.match(page, /vs Forecast \(\{k === "fcPnl" \? "P&L" : "documents"\}\)/);
  assert.match(page, /dashAheadRows\(rows \?\? \[\], shownRows, new Set\(Object\.keys\(cashFcB\)\)\)/);
  assert.match(page, /dashAheadRows\(rows \?\? \[\], shownRows, new Set\(Object\.keys\(bsFcB\)\)\)/);
  assert.match(page, /fadeKey="ahead"/);
  assert.match(page, /fillOpacity=\{d\[fadeKey\] \? 0\.4 : 1\}/);
  assert.match(page, /data-dash-bs-fc-note=""/);
  // The Income Statement card is as it was: it still reads only the periods that have happened.
  assert.match(page, /const plData = useMemo\(\n\s+\(\) =>\n\s+shownRows\.map\(/);
});

test("a period ahead is named like the others, with (F): Dec 2026 (F), not 2026-12 (F)", () => {
  const page = read("src/pages/finance-dashboard.tsx");
  assert.equal((page.match(/label: ahead \? `\$\{dashPeriodLabel\(r\.label, false\)\} \(F\)` : dashPeriodLabel\(r\.label, r\.partial\),/g) ?? []).length, 2);
  assert.doesNotMatch(page, /`\$\{r\.label\} \(F\)`/);
});

// ---- Cash Flow Detail: Actual | Forecast (owner 2026-11-23 「Actual + Forecast」) ----
import { cashDetailSections, cashLinesByBucket, dashCashForecastLines } from "../src/lib/dashboard-forecast.ts";

test("the forecast's lines per month and basis, keyed as the card's actual lines", () => {
  const lines = dashCashForecastLines({ columns, rows });
  assert.deepEqual(lines["2026-12"], { docs: { "CAPEX||Machine": -10, "TRADE_FINANCE||Draws": 30 }, pnl: { "CAPEX||Machine": -10, "TRADE_FINANCE||Draws": 20 } });
  assert.deepEqual(cashLinesByBucket(lines, "quarter")["2026-Q4"].pnl, { "CAPEX||Machine": -15, "TRADE_FINANCE||Draws": 20 });
});

test("Detail: sections in the statement's order, each period Actual and Forecast, nothing-anywhere rows dropped", () => {
  const secs = cashDetailSections([
    { actual: [{ section: "RAW_MATERIALS", label: "FABRIC", value: -100 }, { section: "REVENUE_COLLECTION", label: "TRADE DEBTORS", value: 500 }], forecast: { "RAW_MATERIALS||FABRIC": -90, "CAPEX||Machine": -10 } },
    { actual: null, forecast: { "RAW_MATERIALS||FABRIC": -80, "REVENUE_COLLECTION||TRADE DEBTORS": 400, "LOAN||Ghost": 0 } }, // a period ahead
    { actual: [{ section: "RAW_MATERIALS", label: "FABRIC", value: -70 }], forecast: null }, // the forecast does not reach it
  ]);
  assert.deepEqual(secs.map((s) => s.section), ["REVENUE_COLLECTION", "RAW_MATERIALS", "CAPEX"]);
  assert.equal(secs[0].label, "REVENUE COLLECTION");
  const raw = secs[1];
  assert.deepEqual(raw.totals, [{ actual: -100, forecast: -90 }, { actual: null, forecast: -80 }, { actual: -70, forecast: null }]);
  assert.deepEqual(raw.lines.map((l) => l.label), ["FABRIC"]);
  assert.deepEqual(secs[2].totals[0], { actual: 0, forecast: -10 }, "a line only the forecast has still shows");
});

test("the page: Actual | Forecast detail with a basis switch; faded forecast bars really fade", () => {
  const page = read("src/pages/finance-dashboard.tsx");
  assert.match(page, /data-dash-cf-detail=""/);
  assert.match(page, /<thead>\{periodHeadSplit\(cfData\.map\(\(d\) => d\.label\)\)\}<\/thead>/);
  assert.match(page, /options=\{\[\{ key: "pnl", label: "Forecast P&L" \}, \{ key: "docs", label: "Open documents" \}\]\}/);
  assert.match(page, /forecast: cashLinesB\[r\.key\]\?\.\[cfDetailBasis\] \?\? null/);
  assert.match(page, /actual: r\.actual === null \|\| r\.actual === undefined \? null : r\.cashFlow\?\.lines \?\? \[\]/);
  const look = read("src/components/finance/chart-look.tsx");
  assert.match(look, /const \{ x = 0, y = 0, width = 0, height = 0, fill, fillOpacity, index \} = props;/);
  assert.match(look, /fillOpacity=\{fillOpacity\}/);
});

// ---- Detail grouped by the statement's own groups (owner 2026-11-23 「这里很杂乱，可以整理一下吗？」) ----
import { dashCashLineGroups } from "../src/lib/dashboard-forecast.ts";

test("Detail: a section with the statement's groups opens to them; actual and forecast lines of one group add up together", () => {
  const groups = dashCashLineGroups({ rows: [
    { kind: "group", label: "Raw Materials", section: "RAW_MATERIALS", groupId: "RAW_MATERIALS", values: [] },
    { kind: "group", label: "PURCHASE - FABRIC", section: "RAW_MATERIALS", groupId: "RAW_MATERIALS>701-0000", values: [] },
    { kind: "line", label: "B.M-FABR", section: "RAW_MATERIALS", groupId: "RAW_MATERIALS>701-0000", values: [] },
    { kind: "line", label: "FABRIC", section: "RAW_MATERIALS", groupId: "RAW_MATERIALS>701-0000", values: [] },
    { kind: "line", label: "Opening creditors — SUNMAT", section: "RAW_MATERIALS", groupId: "RAW_MATERIALS>701-0000", values: [] },
    { kind: "group", label: "PURCHASE - WOODEN", section: "RAW_MATERIALS", groupId: "RAW_MATERIALS>702-0000", values: [] },
    { kind: "line", label: "PLYWOOD", section: "RAW_MATERIALS", groupId: "RAW_MATERIALS>702-0000", values: [] },
    { kind: "line", label: "TRADE DEBTORS", section: "REVENUE_COLLECTION", values: [] },
  ] });
  assert.deepEqual(groups["RAW_MATERIALS||FABRIC"], { id: "RAW_MATERIALS>701-0000", label: "PURCHASE - FABRIC" });
  assert.equal(groups["REVENUE_COLLECTION||TRADE DEBTORS"], undefined, "no sub-group: none");
  const [rev, raw] = cashDetailSections([
    {
      actual: [{ section: "RAW_MATERIALS", label: "B.M-FABR", value: -100 }, { section: "RAW_MATERIALS", label: "PLYWOOD", value: -30 }, { section: "RAW_MATERIALS", label: "Stray", value: -5 }, { section: "REVENUE_COLLECTION", label: "TRADE DEBTORS", value: 500 }],
      forecast: { "RAW_MATERIALS||FABRIC": -90, "RAW_MATERIALS||Opening creditors — SUNMAT": -20, "RAW_MATERIALS||PLYWOOD": -25 },
    },
  ], groups);
  assert.deepEqual(rev.groups, [], "a section without groups lists its lines");
  assert.deepEqual(raw.groups.map((g) => [g.label, g.totals[0]]), [
    ["PURCHASE - FABRIC", { actual: -100, forecast: -110 }],
    ["PURCHASE - WOODEN", { actual: -30, forecast: -25 }],
    ["Other", { actual: -5, forecast: 0 }],
  ]);
  // Inside a group: the actuals' lines, then the forecast's own, then the per-party catch-alls.
  assert.deepEqual(raw.groups[0].lines.map((l) => l.label), ["B.M-FABR", "FABRIC", "Opening creditors — SUNMAT"]);
});

test("Detail row names sit on the left", () => {
  const page = read("src/pages/finance-dashboard.tsx");
  assert.match(page, /const tdName = "px-2 py-1 text-left text-\[12px\] whitespace-nowrap";/);
  assert.match(page, /data-dash-cf-group=""/);
  assert.match(page, /cashDetailSections\(cfRows\.map[\s\S]*?\}\)\), lineGroups\)/);
});
