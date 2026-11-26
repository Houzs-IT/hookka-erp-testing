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
  bsForecastByBucket, bsTotals, cashForecastByBucket, dashAheadRows, dashBsForecast, dashBucketOf, dashCashForecast, dashForecastRatios,
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
  assert.deepEqual(bsTotals(opening), { assets: 1_500, liabilities: 600, debtPct: 40, currentAssets: 500, currentLiabilities: 600, inventory: 0, equity: 900 });
  // November: 200 cash paid to the creditors.
  const fc = {
    startYm: "2026-10", months: ["2026-11"], deltas: { "2026-11": { "400-0000": 200, [FC_CASH]: -200 } },
    accounts: {}, salaryAccount: "410-0010", arAccounts: [], bankAccounts: [], stockAccounts: [], openingReceipts: {},
  };
  assert.deepEqual(dashBsForecast(fc, opening), { "2026-11": { assets: 1_300, liabilities: 400, debtPct: 30.77, currentAssets: 300, currentLiabilities: 400, inventory: 0, equity: 900 } });
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
  // Owner 2026-11-24: 6 / 12 months = actual only — no forecast periods
  // appended; a future period shows only when picked in From / To.
  assert.doesNotMatch(page, /dashAheadRows\(/);
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

test("Balance Sheet: this month's actual beside its Forecast Balance Sheet, and the gap (owner 2026-11-23)", () => {
  const page = read("src/pages/finance-dashboard.tsx");
  // Only a month that has happened and that the forecast sheet covers; by month only.
  assert.match(page, /const vs = !ahead && granularity === "month" \? \(f \?\? pastBs\[r\.key\] \?\? null\) : null;/); // + past months since 2026-11-24
  assert.match(page, /fcAssets: vs \? vs\.assets : null,/);
  for (const k of ["fc-assets", "fc-liab", "fc-debt"]) assert.match(page, new RegExp(`data-dash-bs-vs="${k}"`));
  assert.match(page, /\["assets", "fcAssets", "vs Forecast \(assets\)"\], \["liabilities", "fcLiabilities", "vs Forecast \(liabilities\)"\]/);
  assert.match(page, /const gap = d\[f\] === null \? null : d\[a\] - \(d\[f\] as number\);/);
  // A month to date says its forecast is the month-end.
  assert.match(page, /A month marked \* is to date; its forecast is the month-end/);
});

test("past months beside a forecast worked out from the month-end before (owner 2026-11-24 「要补」)", () => {
  const api = read("src/api/routes/accounting.ts");
  // ?start=YYYY-MM before this month: that one month, as it would have been then.
  assert.match(api, /const past = \/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\/\.test\(startQ\) && startQ < realToday\.slice\(0, 7\) \? startQ : null;/);
  assert.match(api, /const today = past \? `\$\{past\}-01` : realToday;/);
  assert.match(api, /const months = past \? \(pastHasPnl \? monthsAll\.filter\(\(ym\) => ym === past\) : \[\]\) : monthsAll;/);
  // A past month with no Forecast P&L figures gets no forecast: the dashboard shows "-".
  assert.match(api, /const pastHasPnl = past \? !!fcMonths\[past\] && forecastMonthHasFigures\(forecastMonthFigures\(fcMonths\[past\], groups, mapped\)\) : true;/);
  const page = read("src/pages/finance-dashboard.tsx");
  // Only shown months that happened and that the forward forecast does not cover; one at a time.
  assert.match(page, /shownRows\.filter\(\(r\) => r\.balanceSheet && !bsFc\[r\.key\]\)\.map\(\(r\) => r\.key\)/);
  assert.match(page, /for \(const ym of want\) \{/);
  assert.match(page, /fetch\(`\/api\/accounting\/bs-forecast\?start=\$\{ym\}`, \{ cache: "no-store" \}\)/);
  assert.match(page, /const vs = !ahead && granularity === "month" \? \(f \?\? pastBs\[r\.key\] \?\? null\) : null;/);
  assert.match(page, /A past month's forecast is worked out from the month-end before it with that month's Forecast P&L\./);
});

// ---- Financial Ratios with their forecast (owner 2026-11-24 「financial ratio
// 也可以放 forecast的进去」 → 「Build it」). Made-up figures only.

test("a sheet's totals carry current assets, current liabilities and stock for the ratios", () => {
  const t = bsTotals([
    { accountCode: "200-0050", accountName: "Renovation", category: "FIXED_ASSET", balance: 1_000 },
    { accountCode: "300-0000", accountName: "Debtors", category: "CURRENT_ASSET", balance: 6_000 },
    { accountCode: "330-0001", accountName: "Stock", category: "CURRENT_ASSET", balance: 3_000 },
    { accountCode: "400-0000", accountName: "Creditors", category: "CURRENT_LIABILITY", balance: 4_000 },
    { accountCode: "500-0000", accountName: "Loan", category: "LONG_TERM_LIABILITY", balance: 2_000 },
  ]);
  assert.deepEqual(t, { assets: 10_000, liabilities: 6_000, debtPct: 60, currentAssets: 9_000, currentLiabilities: 4_000, inventory: 3_000, equity: 4_000 });
});

test("the forecast ratios are worked out as the route works out the actual ones", () => {
  const bs = { assets: 10_000, liabilities: 6_000, debtPct: 60, currentAssets: 9_000, currentLiabilities: 4_000, inventory: 3_000, equity: 4_000 };
  const pl = { sales: 20_000, gross: 6_000, net: 1_000 };
  assert.deepEqual(dashForecastRatios(pl, bs), {
    grossMarginPct: 30, netMarginPct: 5, currentRatio: 2.25, quickRatio: 1.5,
    roePct: 25, // net / (assets - liabilities)
    roaPct: 10,
  });
  // No Forecast P&L (July 2026): the margins and the returns read "-"; the sheet's own ratios stand.
  const noPl = dashForecastRatios(null, bs);
  assert.equal(noPl.grossMarginPct, null);
  assert.equal(noPl.roePct, null);
  assert.equal(noPl.currentRatio, 2.25);
  // No sheet: only the margins.
  const noBs = dashForecastRatios(pl, null);
  assert.equal(noBs.grossMarginPct, 30);
  assert.equal(noBs.currentRatio, null);
  assert.equal(noBs.roaPct, null);
  // Nothing to divide by: "-", never Infinity.
  assert.equal(dashForecastRatios({ sales: 0, gross: 0, net: 0 }, { ...bs, currentLiabilities: 0 }).grossMarginPct, null);
  assert.equal(dashForecastRatios(pl, { ...bs, currentLiabilities: 0 }).currentRatio, null);
});

test("the Financial Ratios card: a month that happened beside its forecast, and the gap", () => {
  const page = read("src/pages/finance-dashboard.tsx");
  assert.match(page, /const fc = !ahead && granularity === "month" \? dashForecastRatios\(r\.forecast, fcBs\)\[ratioTab\] : null;/);
  assert.match(page, /const fcBs = bsFcB\[r\.key\] \?\? pastBs\[r\.key\] \?\? null;/);
  assert.match(page, /data=\{ratioData\}\n\s+fadeKey="ahead"/);
  assert.match(page, /data-dash-ratio-vs="fc"/);
  assert.match(page, /data-dash-ratio-vs="gap"/);
  assert.match(page, /data-dash-ratio-fc-note=""/);
});

test("owner 2026-11-24: a picked future range shows its periods; ratios get forecast values", async () => {
  const look = await import("../src/lib/finance-chart-look.ts");
  const rows = [
    { key: "2026-10", actual: {}, forecast: {} },
    { key: "2026-11", actual: {}, forecast: {} },
    { key: "2026-12", actual: null, forecast: {} },
    { key: "2027-01", actual: null, forecast: null },
  ];
  assert.deepEqual(look.dashPeriods(rows, { span: 6, granularity: "month", explicit: true }).map((r) => r.key), ["2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(look.dashPeriods(rows, { span: 6, granularity: "month", explicit: false }).map((r) => r.key), ["2026-10", "2026-11"]);
  const { dashForecastRatios } = await import("../src/lib/dashboard-forecast.ts");
  const r = dashForecastRatios({ sales: 1000, gross: 300, net: 100 }, { assets: 2000, liabilities: 1500, debtPct: 75, currentAssets: 1800, currentLiabilities: 1200, inventory: 300, equity: 500 });
  assert.deepEqual(r, { grossMarginPct: 30, netMarginPct: 10, currentRatio: 1.5, quickRatio: 1.25, roePct: 20, roaPct: 5 });
  assert.equal(dashForecastRatios(null, null).currentRatio, null);
  assert.equal(dashForecastRatios({ sales: 1, gross: 1, net: 1 }, { assets: 1, liabilities: 2, debtPct: 200, currentAssets: 1, currentLiabilities: 2, inventory: 0, equity: -1 }).roePct, null);
});

test("owner 2026-11-24: the running quarter reads actual so far + forecast for the rest (A+F)", async () => {
  const { quarterActualPlusForecast } = await import("../src/lib/dashboard-forecast.ts");
  const rows = [
    { key: "2026-10", actual: { sales: 100, net: 10 }, forecast: { sales: 90, net: 9 } },
    { key: "2026-11", actual: { sales: 80, net: 5 }, forecast: { sales: 120, net: 12 } },
    { key: "2026-12", actual: null, forecast: { sales: 150, net: 20 } },
    { key: "2027-01", actual: null, forecast: { sales: 70, net: 3 } },
  ];
  assert.deepEqual(quarterActualPlusForecast("2026-Q4", rows), { sales: 330, net: 35 });
  assert.equal(quarterActualPlusForecast("2027-Q1", rows), null, "no month has happened → plain forecast");
  assert.equal(quarterActualPlusForecast("2026-Q3", rows), null, "no month ahead → plain actual");
  assert.equal(quarterActualPlusForecast("2026-Q4", rows.map((r) => (r.key === "2026-12" ? { ...r, forecast: null } : r))), null, "a month ahead without a forecast → actual only");
  const page = readFileSync(new URL("../src/pages/finance-dashboard.tsx", import.meta.url), "utf8");
  assert.match(page, /label: af \? `\$\{dashPeriodLabel\(r\.label, false\)\} \(A\+F\)` : dashRowLabel\(r\)/);
  assert.match(page, /data-dash-af=""/);
});

test("owner 2026-11-24 「全部有资料的都补齐」: every card draws a period ahead from its forecast", () => {
  const page = readFileSync(new URL("../src/pages/finance-dashboard.tsx", import.meta.url), "utf8");
  // salary cards, cost structure: bars read __bar__ (actual, or forecast ahead), faded
  assert.match(page, /dataKey=\{`__bar__\$\{dept\}`\}/);
  assert.match(page, /dataKey=\{`__bar__\$\{cat\}`\}/);
  assert.match(page, /point\[`__bar__\$\{cat\}`\] = csAhead \? fc : amt;/);
  // material trend: actual "-" ahead, bar = plan
  assert.match(page, /amount: trAhead \? null : amt,/);
  // cash flow: money in / out ahead from the forecast statement lines
  assert.match(page, /inflow: ahead \? fin : r\.cashFlow\?\.inflow \?\? null,/);
});
