// Forecast columns in the statement engine (spec:
// docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md 3 and 8).
// The toggle-off statement must never change: the golden output below was
// captured from the engine before forecast columns existed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const cf = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-engine.ts")).href);
const fx = await import(pathToFileURL(resolve(process.cwd(), "tests/fixtures/cashflow-golden-input.mjs")).href);
const golden = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/cashflow-golden-output.json"), "utf8"));
const roundTrip = (v) => JSON.parse(JSON.stringify(v));

test("golden: without a forecast the statement is exactly what it was", () => {
  assert.deepEqual(roundTrip(cf.buildStatement(fx.statementOpts())), golden.plain);
  assert.deepEqual(roundTrip(cf.buildStatement(fx.statementOpts({ trace: true }))), golden.traced);
  assert.deepEqual(roundTrip(cf.buildStatement(fx.statementOpts({ editable: true }))), golden.editable);
});

const fcCols = [
  { ym: "2026-12", future: true, blank: false },
  { ym: "2026-11", future: false, blank: false },
  { ym: "2026-10", future: false, blank: false },
  { ym: "2026-09", future: false, blank: true },
];
const item = (ref) => ({ kind: "invoice", party: "C1", ref });
const run = (legs, extra = {}) => cf.buildStatement(fx.statementOpts({ forecast: { columns: fcCols, legs, rmSplit: extra.rmSplit ?? {} }, ...extra.opts }));
const col = (st, key) => st.columns.findIndex((c) => c.key === key);
const row = (st, pred) => st.rows.find(pred);

test("forecast columns: future months first, then each month's Actual beside its Forecast", () => {
  const st = run([]);
  assert.deepEqual(st.columns.map((c) => c.key), ["__accum__", "fc:2026-12", "2026-11", "fc:2026-11", "2026-10", "fc:2026-10", "2026-09", "fc:2026-09"]);
  const f12 = st.columns[1];
  assert.deepEqual([f12.forecast, f12.future, f12.ym, f12.label], [true, true, "2026-12", "Dec'26"]);
  assert.equal(st.columns[7].blank, true);
  assert.equal(st.columns[2].forecast, undefined);
});

test("a forecast receipt lands on the same line as the actual receipts, and never in Accumulated", () => {
  const st = run([{ col: "fc:2026-11", sen: 500, accountCode: "300-0000", item: item("INV-1") }]);
  const r = row(st, (x) => x.kind === "line" && x.lineKey === "REVENUE_COLLECTION|TRADE DEBTORS");
  assert.equal(r.values[col(st, "2026-11")], 300_000);
  assert.equal(r.values[col(st, "fc:2026-11")], 500);
  assert.equal(r.values[col(st, "__accum__")], 800_000);
  assert.deepEqual(st.forecastSources["REVENUE_COLLECTION|TRADE DEBTORS"]["fc:2026-11"], [{ ...item("INV-1"), sen: 500 }]);
});

test("an overdue raw-material amount is one flat line, not nested under a purchase parent", () => {
  const st = run([{ col: "fc:2026-11", sen: -700, accountCode: "400-0000", label: cf.OVERDUE_LABEL, order: 98, item: item("PI-1") }]);
  const r = row(st, (x) => x.lineKey === `RAW_MATERIALS|${cf.OVERDUE_LABEL}`);
  assert.equal(r.groupId, "RAW_MATERIALS");
  assert.equal(r.accountCode, undefined);
  assert.equal(r.values[col(st, "fc:2026-11")], -700);
  assert.equal(cf.rmLineOrder(cf.OVERDUE_LABEL), 98);
});

test("the past-term line sits after the trade line it belongs with (prod 2026-11-08: it sorted first)", async () => {
  const fcMod = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-forecast.ts")).href);
  const st = run([
    { col: "fc:2026-11", sen: 900, accountCode: "300-0000", label: cf.OVERDUE_LABEL, order: fcMod.OVERDUE_ORDER, item: item("OLD") },
    { col: "fc:2026-11", sen: 500, accountCode: "300-0000", item: item("NEW") },
  ]);
  const labels = st.rows.filter((r) => r.kind === "line" && r.section === "REVENUE_COLLECTION").map((r) => r.label);
  assert.deepEqual(labels, ["TRADE DEBTORS", cf.OVERDUE_LABEL]);
  const rm = run([{ col: "fc:2026-11", sen: -700, accountCode: "400-0000", label: cf.OVERDUE_LABEL, order: fcMod.OVERDUE_ORDER, item: item("PI-1") }]);
  const rmLines = rm.rows.filter((r) => r.kind === "line" && r.section === "RAW_MATERIALS").map((r) => r.label);
  assert.equal(rmLines[rmLines.length - 1], cf.OVERDUE_LABEL, "last under Raw Materials too");
  assert.equal(rm.rows.find((r) => r.lineKey === `RAW_MATERIALS|${cf.OVERDUE_LABEL}`).groupId, "RAW_MATERIALS", "and still flat");
});

test("a forecast purchase invoice splits by its materials like an actual payment", () => {
  const st = run(
    [{ col: "fc:2026-11", sen: -400, accountCode: "400-0000", splitKey: "fc:pi:1", item: item("PI-1") }],
    { rmSplit: { "fc:pi:1": [{ line: "FABRIC", weight: 3 }, { line: "FOAM", weight: 1 }] } },
  );
  const at = (label) => row(st, (x) => x.lineKey === `RAW_MATERIALS|${label}`).values[col(st, "fc:2026-11")];
  assert.equal(at("FABRIC"), -300);
  assert.equal(at("FOAM"), -100);
  assert.equal(st.forecastSources["RAW_MATERIALS|FABRIC"]["fc:2026-11"][0].ofSen, -400);
});

test("a department salary forecast sits on the department's line under Direct Labour", () => {
  const st = run([{ col: "fc:2026-12", sen: -50_000, accountCode: "410-0010", label: "PROD-A", item: { kind: "pnl", party: "PROD-A", ref: "dept:PROD-A" } }]);
  const r = row(st, (x) => x.lineKey === "DIRECT_LABOUR|PROD-A");
  assert.equal(r.values[col(st, "2026-11")], -60_000);
  assert.equal(r.values[col(st, "fc:2026-12")], -50_000);
});

test("bank chain: a month's forecast starts from its actual b/f; a future month from the month before's forecast c/f", () => {
  const st = run([
    { col: "fc:2026-11", sen: 500, accountCode: "300-0000", item: item("A") },
    { col: "fc:2026-11", sen: -200, accountCode: "900-0010", item: item("B") },
    { col: "fc:2026-12", sen: -100, accountCode: "900-0010", item: item("C") },
  ]);
  const v = (kind, key) => row(st, (x) => x.kind === kind).values[col(st, key)];
  assert.equal(v("bf", "2026-11"), 1_370_000);
  assert.deepEqual([v("bf", "fc:2026-11"), v("total", "fc:2026-11"), v("cf", "fc:2026-11")], [1_370_000, 300, 1_370_300]);
  assert.deepEqual([v("bf", "fc:2026-12"), v("total", "fc:2026-12"), v("cf", "fc:2026-12")], [1_370_300, -100, 1_370_200]);
  assert.equal(v("total", "2026-11"), 85_000, "the actual column is untouched");
  const blank = col(st, "fc:2026-09");
  assert.ok(st.rows.every((x) => x.values[blank] === null), "a blank month prints nothing in any row");
});

test("Planned payments is its own block after Loan, only when a plan lands in it", () => {
  const st = run([{ col: "fc:2026-11", sen: -1000, section: "PLANNED", label: cf.PLANNED_LABEL, item: { kind: "planned", party: "BANK", ref: "" } }]);
  const labels = st.rows.filter((x) => x.kind === "group" && x.depth === 1).map((x) => x.label);
  assert.ok(labels.indexOf("Planned payments") === labels.indexOf("Loan received / (repaid · lent)") + 1, labels.join(" / "));
  assert.equal(row(st, (x) => x.lineKey === "PLANNED|Planned payments").values[col(st, "fc:2026-11")], -1000);
  const none = run([], { opts: { editable: true } });
  assert.ok(!none.rows.some((x) => x.section === "PLANNED"));
});

test("a keyed capex or loan amount sits on its account's line beside the actual (spec 6.4)", () => {
  const st = run([
    { col: "fc:2026-12", sen: -40_000, accountCode: "200-0040", item: { kind: "input", party: "K", ref: "200-0040" } },
    { col: "fc:2026-11", sen: 25_000, accountCode: "440-0030", item: { kind: "input", party: "K", ref: "440-0030" } },
  ]);
  const capex = row(st, (x) => x.kind === "line" && x.section === "CAPEX" && x.accountCode === "200-0040");
  assert.equal(capex.values[col(st, "2026-11")], -50_000, "the actual on the same line");
  assert.equal(capex.values[col(st, "fc:2026-12")], -40_000);
  const loan = row(st, (x) => x.kind === "line" && x.section === "LOAN" && x.accountCode === "440-0030");
  assert.equal(loan.values[col(st, "fc:2026-11")], 25_000);
});

test("forecast lines feed the operating result in their own columns", () => {
  const st = run([{ col: "fc:2026-11", sen: 500, accountCode: "300-0000", item: item("A") }]);
  const res = row(st, (x) => x.kind === "result");
  assert.equal(res.values[col(st, "fc:2026-11")], 500);
  assert.equal(res.values[col(st, "2026-11")], 195_000);
});
