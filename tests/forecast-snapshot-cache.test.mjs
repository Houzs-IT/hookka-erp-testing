// ---------------------------------------------------------------------------
// The Cash Flow forecast and the Forecast Balance Sheet kept as stored copies
// (owner 2026-11-23 「看没有forecast了？」 → 「Do it»). Measured on prod that day:
// built afresh they took 55–105 s (a dozen agings each), past the page's 30 s,
// so the Financial Dashboard and the Cash Flow page showed no forecast. Now:
// the reports' own copy (served at once, rebuilt behind when a source moves
// or after 15 minutes), no 30 s cut-off for the first build, and the pages ask
// again when they were handed an older copy.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");

test("both forecast routes answer from the reports' stored copy, rebuilt when what they read moves", () => {
  assert.match(api, /app\.get\("\/cashflow-forecast", \(c\) => reportSnapshot\(c, "cashflow-forecast", cashflowForecastResponse, false, FORECAST_SNAPSHOT_SOURCES\)\);/);
  assert.match(api, /app\.get\("\/bs-forecast", \(c\) => reportSnapshot\(c, "bs-forecast", bsForecastResponse, false, FORECAST_SNAPSHOT_SOURCES\)\);/);
  assert.match(api, /sourceTables: \[\.\.\.new Set\(\[\.\.\.reportSnapshotSourceTables\(\), \.\.\.extraSources\]\)\]/);
  const at = api.indexOf("const FORECAST_SNAPSHOT_SOURCES");
  const list = api.slice(at, api.indexOf("];", at));
  for (const t of ["payment_records", "supplier_payments", "credit_notes", "debit_notes", "planned_payments", "customers", "suppliers", "other_party_bills", "trade_finance_draws"]) {
    assert.match(list, new RegExp(`"${t}"`), t);
  }
  // kv_config (Forecast P&L, Capex & financing, the trade-finance plan) and the ledger are the statements' own sources.
  const base = api.slice(api.indexOf("const PNL_REPLAY_SOURCE_TABLES"), api.indexOf("];", api.indexOf("const PNL_REPLAY_SOURCE_TABLES")));
  assert.match(base, /"kv_config"/);
  assert.match(base, /"ledger_journal_entries"/);
});

test("no 30 s cut-off for the two forecasts (a first build may take a minute or two)", () => {
  const client = read("src/lib/api-client.ts");
  const m = /export const NO_TIMEOUT_PATH = (\/.*\/);/.exec(client);
  assert.ok(m);
  const re = new Function(`return ${m[1]}`)();
  assert.ok(re.test("/api/accounting/cashflow-forecast"));
  assert.ok(re.test("/api/accounting/bs-forecast"));
  assert.ok(!re.test("/api/accounting/cashflow-forecast-inputs"), "the inputs keep the limit");
  assert.ok(!re.test("/api/accounting/aging"));
});

test("the dashboard and the Cash Flow page ask again after an older copy, and say the forecast is loading", () => {
  const dash = read("src/pages/finance-dashboard.tsx");
  assert.match(dash, /if \(next\.retryInMs !== null\) timers\.push\(setTimeout\(\(\) => loadCash\(next\.run\), next\.retryInMs\)\);/);
  assert.match(dash, /if \(next\.retryInMs !== null\) timers\.push\(setTimeout\(\(\) => loadBs\(next\.run\), next\.retryInMs\)\);/);
  assert.equal((dash.match(/data-dash-fc-loading=""/g) ?? []).length, 2);
  const page = read("src/pages/accounting/index.tsx");
  assert.match(page, /const next = planStaleRetry\(fcStaleRun\.current, fcResp\);/);
  assert.match(page, /invalidateCachePrefix\("\/api\/accounting\/cashflow-forecast"\); fcRefresh\(\);/);
});
