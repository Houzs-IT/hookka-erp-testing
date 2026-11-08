// Cash Flow forecast — the server side (spec:
// docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md). The routes
// it reuses must stay what they were: each serves its own JSON through the
// moved function, and the toggle-off statement route never sees a forecast.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "src/api/routes/accounting.ts"), "utf8");
const handler = (method, path) => {
  const start = src.indexOf(`app.${method}("${path}"`);
  assert.ok(start >= 0, `${method.toUpperCase()} ${path} not found`);
  const end = src.indexOf("\napp.", start + 1);
  return src.slice(start, end < 0 ? undefined : end);
};

test("GET /cashflow-forecast exists, reads only, and asks for the forecast", () => {
  const h = handler("get", "/cashflow-forecast");
  assert.match(h, /requirePermission\(c, "accounting", "read"\)/);
  assert.match(h, /computeCashflowStatement\(c\.var\.DB, period, false, getOrgId\(c\), \{ forecast: \{ today \} \}\)/);
  assert.match(h, /asOfQ <= realToday/, "an asOf can only replay an earlier day");
});

test("GET /cashflow-statement never builds a forecast", () => {
  const h = handler("get", "/cashflow-statement");
  assert.doesNotMatch(h, /forecast/i);
});

test("the reused routes serve their JSON through the moved functions", () => {
  assert.match(handler("get", "/aging"), /computeAgingData\(c\.var\.DB, orgId, asOf, coFilter\)/);
  assert.match(handler("get", "/aging"), /withSnapshot\(c\.var\.DB, snapshotConfig, orgId, buildAging, cacheKey\)/);
  assert.match(handler("get", "/other-party-aging"), /computeOtherPartyAging\(c\.var\.DB, orgId, type, asOf\)\)\.map\(\(\{ id: _id, \.\.\.b \}\) => b\)/);
  assert.match(handler("get", "/labor/departments"), /loadLabourDepartments\(c\.var\.DB, getOrgId\(c\)\)/);
  assert.match(handler("get", "/coa"), /loadCoaList\(c\.var\.DB, includeInactive\)/);
  assert.match(src, /const piWeightsFor = await loadPiMaterialWeights\(c\.var\.DB, piIds, sgOverride\);/);
});

test("POST /cash-position/planned/:id/paid sets done_at and nothing else", () => {
  const h = handler("post", "/cash-position/planned/:id/paid");
  assert.match(h, /requirePermission\(c, "accounting", "update"\)/);
  assert.match(h, /UPDATE planned_payments SET done_at = \? WHERE id = \?/);
  assert.match(h, /404/);
  assert.doesNotMatch(h, /DELETE|INSERT/);
});

test("opening-period customer receipts are split off every aging before the netting, and counted for the footnote", () => {
  const start = src.indexOf("async function loadCashflowForecast(");
  const body = src.slice(start, src.indexOf("\nasync function computeCashflowStatement(", start));
  assert.match(body, /const cutoffYm = openingCreditCutoffYm\(openingYm\);/);
  assert.match(body, /splitOpeningCredits\(toDocs\(s\), cutoffYm\)/);
  assert.match(body, /scheduleOpenDocs\(kept, termOf\)/);
  assert.doesNotMatch(body, /scheduleOpenDocs\(toDocs\(/, "no aging is scheduled without the split");
  assert.match(body, /openingCredits:/);
});

test("GET /cashflow-forecast-inputs reads the keyed amounts and the CAPEX / Loan accounts, writing nothing", () => {
  const h = handler("get", "/cashflow-forecast-inputs");
  assert.match(h, /requirePermission\(c, "accounting", "read"\)/);
  assert.match(h, /loadCfForecastInputs\(c\.var\.DB\)/);
  assert.match(h, /cfForecastInputAccounts\(c\.var\.DB\)/);
  assert.doesNotMatch(h, /\b(INSERT|UPDATE|DELETE)\b/);
});

test("PUT /cashflow-forecast-inputs keeps CAPEX / Loan accounts only, refuses the rest, and audits", () => {
  const h = handler("put", "/cashflow-forecast-inputs");
  assert.match(h, /requirePermission\(c, "accounting", "update"\)/);
  assert.match(h, /cleanKeyedInputs\(body\.months, new Set\(\(await cfForecastInputAccounts\(c\.var\.DB\)\)\.map\(\(a\) => a\.code\)\)\)/);
  assert.match(h, /is not a CAPEX or Loan account/);
  assert.match(h, /VALUES \('cashflow_forecast_inputs', \?, \?\)/);
  assert.match(h, /resourceId: "cashflow_forecast_inputs"/);
});

test("the forecast loader hands the keyed amounts to the engine, on the statement's account codes", () => {
  const start = src.indexOf("async function loadCashflowForecast(");
  const body = src.slice(start, src.indexOf("\nasync function computeCashflowStatement(", start));
  assert.match(body, /await loadCfForecastInputs\(db\)/);
  assert.match(body, /resolveAcct\(code\)/);
  assert.match(body, /buildForecastLegs\(\{ [^}]*\binputs\b[^}]*\}\)/);
});

test("the forecast loader reads master terms, Forecast P&L and planned payments, and writes nothing", () => {
  const start = src.indexOf("async function loadCashflowForecast(");
  const body = src.slice(start, src.indexOf("\nasync function computeCashflowStatement(", start));
  for (const s of ["creditTerms", "paymentTerms", "forecast_pnl", "planned_payments", "computeAgingData(", "computeOtherPartyAging("]) assert.ok(body.includes(s), s);
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE)\b/);
});
