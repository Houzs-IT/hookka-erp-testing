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
  assert.match(page, /\{ key: "fcPnlNet", name: "Forecast net \(P&L\)", color: CH\.fc, dashed: true \}/);
  assert.match(page, /\{ key: "fcDocsNet", name: "Forecast net \(documents\)", color: CH\.teal, dashed: true \}/);
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
