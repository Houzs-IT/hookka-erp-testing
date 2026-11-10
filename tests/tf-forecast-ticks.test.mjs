// Trade finance: a tick per supplier per month, shown after "Fill from Forecast
// P&L" (owner 2026-11-10, second round). With a screenshot of the first
// round's Suppliers table: 「有点乱，我如何选这个月哪里有个supplier 要用trade
// finance?」 → a mockup → 「可以我按了fill from forecast pnl 才可以勾选吗？不然直接
// 显示会让人误会」, 「也会和原本的手动输入对冲」, 「如果存了，我untick 不就可以了吗？」
// → 「做」. Amounts are the figures keyed per supplier (「到时我会按supplier 来填」).
// Spec docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md section 5.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fc = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-forecast.ts")).href);
const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// Supplier A on NET60, B and C on NET30; "other" is Other (new suppliers).
const fcMonths = {
  // RM 400,000 of sales in November: A's 5% under FILLER is RM 20,000.
  "2026-11": {
    salesSen: 40_000_000, pct: {},
    purchasesByType: { FABRIC: { "sup-a": 3_000_000, "sup-b": 500_000, other: 900_000 }, FILLER: { "sup-a": { bp: 500 } } },
  },
  // A again in December, under a third material: due February.
  "2026-12": { salesSen: 40_000_000, pct: {}, purchasesByType: { FOAM: { "sup-a": 1_000_000 } } },
  // Bought in September on NET30: due October, before the table starts.
  "2026-09": { salesSen: 40_000_000, pct: {}, purchasesByType: { FABRIC: { "sup-c": 700_000 } } },
};
const term = (id) => ({ "sup-a": 2, "sup-b": 1, "sup-c": 1 })[id] ?? 1;

test("tfForecastDueBySupplier: each supplier's figures, every material, RM or %, in its own due months; history and Other left out", () => {
  assert.deepEqual(fc.tfForecastDueBySupplier({ months: fcMonths, termMonths: term, fromYm: "2026-11" }), {
    "sup-a": { "2027-01": 3_000_000 + 2_000_000, "2027-02": 1_000_000 },
    "sup-b": { "2026-12": 500_000 },
  });
});

// November 2026 to October 2027.
const yms = Array.from({ length: 12 }, (_, i) => fc.addMonthsYm("2026-11", i));
const suppliers = [
  { id: "sup-a", name: "A TRADING SDN. BHD.", term: "NET60", dueBy: { "2027-01": 5_000_000, "2027-02": 1_000_000, "2027-11": 9_000_000 } },
  { id: "sup-b", name: "B INDUSTRIES SDN BHD", term: "NET30", dueBy: { "2026-12": 500_000 } },
  { id: "sup-c", name: "C SDN BHD", term: "NET30", dueBy: {} },
  { id: "sup-d", name: "D SDN BHD", term: "NET30", dueBy: { "2027-03": 2_000_000 } },
  { id: "sup-f", name: "AA SDN BHD", term: "NET60", dueBy: { "2027-04": 500_000 } },
];

test("tfTickRows: every supplier with a figure due in the months shown, biggest first then by name; nothing due, no row", () => {
  const rows = fc.tfTickRows(suppliers, yms);
  assert.deepEqual(rows.map((r) => [r.id, r.totalSen]), [["sup-a", 6_000_000], ["sup-d", 2_000_000], ["sup-f", 500_000], ["sup-b", 500_000]], "November 2027 is past the twelve months");
  assert.equal(rows[0].term, "NET60");
  assert.equal(rows[0].name, "A TRADING SDN. BHD.");
});

test("tfDefaultTicks: Fill from Forecast P&L starts with the facility's own suppliers, every month they have an amount", () => {
  assert.deepEqual(fc.tfDefaultTicks(suppliers, ["sup-a", "sup-c", "sup-z"], yms), { "2027-01": ["sup-a"], "2027-02": ["sup-a"] });
  assert.deepEqual(fc.tfDefaultTicks(suppliers, [], yms), {});
});

test("tfTickedDue: each month the ticked suppliers' amounts that month; nothing ticked, nothing due", () => {
  assert.deepEqual(fc.tfTickedDue(suppliers, { "2027-01": ["sup-a"], "2027-02": ["sup-a", "sup-b"], "2026-12": ["sup-b"] }), { "2027-01": 5_000_000, "2027-02": 1_000_000, "2026-12": 500_000 });
  assert.deepEqual(fc.tfTickedDue(suppliers, {}), {});
});

test("tfToggleTick and tfToggleRow: one month on or off; the name ticks the whole row, or clears it when every month is ticked", () => {
  let t = {};
  t = fc.tfToggleTick(t, "sup-a", "2027-01");
  assert.deepEqual(t, { "2027-01": ["sup-a"] });
  t = fc.tfToggleTick(t, "sup-b", "2027-01");
  assert.deepEqual(t, { "2027-01": ["sup-a", "sup-b"] });
  t = fc.tfToggleTick(t, "sup-a", "2027-01");
  assert.deepEqual(t, { "2027-01": ["sup-b"] });
  const rowA = fc.tfTickRows(suppliers, yms).find((r) => r.id === "sup-a");
  t = fc.tfToggleRow(t, rowA, yms);
  assert.deepEqual(t, { "2027-01": ["sup-a", "sup-b"], "2027-02": ["sup-a"] }, "every month A has an amount in the months shown");
  t = fc.tfToggleRow(t, rowA, yms);
  assert.deepEqual(t, { "2027-01": ["sup-b"] }, "all ticked: the name clears the row, and an emptied month goes");
  assert.deepEqual(fc.tfToggleTick({ "2027-01": ["sup-b"] }, "sup-b", "2027-01"), {});
});

test("tfTickedPlan: each month's ticked amounts as far as the limit lets, and what does not fit", () => {
  const input = { yms: ["2026-11", "2026-12", "2027-01", "2027-02"], currentYm: "2026-11", rateBp: 100, tenorDays: 90, owedNowSen: 154_251, drawnThisMonthSen: 0, dueBy: { "2026-12": 30_377, "2027-01": 123_874 }, limitSen: 300_000 };
  const sup = [{ id: "sup-a", dueBy: { "2026-11": 122_926, "2026-12": 106_543, "2027-01": 11_650 } }];
  const r = fc.tfTickedPlan(input, sup, { "2026-11": ["sup-a"], "2026-12": ["sup-a"], "2027-01": ["sup-a"] });
  assert.deepEqual(r.months, { "2026-11": 122_926, "2026-12": 51_456, "2027-01": 11_650 });
  assert.deepEqual(r.shortSen, { "2026-12": 106_543 - 51_456 });
  assert.deepEqual(fc.tfTickedPlan(input, sup, {}).months, {}, "nothing ticked, nothing drawn");
});

test("tfSupplierLabel: the name without its SDN BHD", () => {
  assert.equal(fc.tfSupplierLabel("A TRADING SDN. BHD."), "A TRADING");
  assert.equal(fc.tfSupplierLabel("B INDUSTRIES SDN BHD"), "B INDUSTRIES");
  assert.equal(fc.tfSupplierLabel("C INDUSTRIES SDN. BHD"), "C INDUSTRIES");
  assert.equal(fc.tfSupplierLabel("D COMPONENTS (ASIA) SDN BHD"), "D COMPONENTS (ASIA)");
  assert.equal(fc.tfSupplierLabel("Acme Fabric Sdn Bhd"), "Acme Fabric");
  assert.equal(fc.tfSupplierLabel("PLAIN NAME"), "PLAIN NAME");
});

test("cleanTfPlans keeps the ticks per month: ids trimmed, once each, sorted; an emptied month goes; an empty set stays; the first round's supplierIds is dropped", () => {
  const r = fc.cleanTfPlans({
    "310-0020": { months: { "2027-01": 100 }, ticks: { "2027-01": [" sup-b ", "sup-a", "sup-b", "", 7], "2027-13": ["sup-a"], "2027-02": [], "2027-03": "sup-a" } },
    "310-0030": { months: {}, ticks: {} },
    "310-0040": { months: {}, ticks: "junk" },
    "310-0050": { months: {}, supplierIds: ["sup-a"] },
  }, null);
  assert.deepEqual(r.facilities["310-0020"], { months: { "2027-01": 100 }, ticks: { "2027-01": ["sup-a", "sup-b"] } });
  assert.deepEqual(r.facilities["310-0030"], { months: {}, ticks: {} }, "every tick cleared: the plan still follows the ticks");
  assert.deepEqual(r.facilities["310-0040"], { months: {} });
  assert.deepEqual(r.facilities["310-0050"], { months: {} });
});

const api = read("src/api/routes/accounting.ts");
const page = read("src/pages/accounting/index.tsx");
const slice = (src, start, end) => { const a = src.indexOf(start); assert.ok(a >= 0, start); return src.slice(a, src.indexOf(end, a + start.length)); };

test("the inputs: each supplier's Forecast P&L dues with its name and term, and each facility's own suppliers", () => {
  const fn = slice(api, "async function cfForecastTfFacilities(", 'app.get("/cashflow-forecast-inputs"');
  assert.match(fn, /tfForecastDueBySupplier\(\{ months: fcMonths, termMonths: termMonthsOf, fromYm: curYm \}\)/);
  assert.match(fn, /paidSupplierIds,/);
  assert.match(fn, /\{ id, name: nameOf\.get\(id\) \|\| id, term: supTerm\.get\(id\), dueBy \}/);
  assert.match(fn, /\.\.\.tfFacilityNow\(sec, curYm\)/, "what is owed, drawn and due, as the forecast loader reads it");
  assert.match(fn, /return \{ facilities, forecastSuppliers \};/);
  assert.doesNotMatch(fn, /\b(INSERT|UPDATE|DELETE)\b/);
  const g = slice(api, 'app.get("/cashflow-forecast-inputs"', 'app.put("/cashflow-forecast-inputs"');
  assert.match(g, /cfForecastTfFacilities\(c\.var\.DB, getOrgId\(c\)\)/);
  assert.match(g, /tf: \{ facilities: tf\.facilities, plans: tfPlans, forecastSuppliers: tf\.forecastSuppliers \}/);
});

test("the Cash Flow forecast works a ticked plan out afresh from today's figures; months before this one keep what was saved", () => {
  const body = slice(api, "async function loadCashflowForecast(", "\nasync function computeCashflowStatement(");
  assert.match(body, /if \(st\.ticks\) \{/);
  assert.match(body, /tfTickedPlan\(\{ yms: tfYms, currentYm: curYm, rateBp, tenorDays: tenor, \.\.\.tfFacilityNow\(sec, curYm\), limitSen: tfSrc\?\.limitSen \?\? null \}, tfDues, st\.ticks\)\.months/);
  assert.match(body, /Object\.entries\(st\.months\)\.filter\(\(\[ym\]\) => ym < curYm\)/);
});

test("the popup: ticks only after Fill from Forecast P&L; the ticked row decides the Drawdown; Clear ticks goes back to typing; Save keeps them", () => {
  const dlg = slice(page, "function CfForecastInputsDialog(", "\nfunction ");
  assert.doesNotMatch(dlg, /TfSupplierPicker/, "the first round's Suppliers box is gone");
  assert.ok(!existsSync(resolve(process.cwd(), "src/pages/accounting/tf-supplier-picker.tsx")));
  assert.match(dlg, /ticks: tfDefaultTicks\(tfSuppliers, f\.paidSupplierIds \?\? \[\], yms\)/, "the facility's own suppliers start ticked");
  assert.match(dlg, /const ticking = p\.ticks !== undefined;/);
  assert.match(dlg, /const tickFill = ticking \? tfTickedPlan\(inp, tfSuppliers, p\.ticks \?\? \{\}\) : null;/);
  assert.match(dlg, /tfPlanSchedule\(\{ \.\.\.inp, plan: planMonths \}\)/);
  assert.match(dlg, /\{ticking && tickRows\.map\(/, "the supplier rows only while ticking");
  assert.match(dlg, /tfToggleTick\(/);
  assert.match(dlg, /tfToggleRow\(/);
  assert.match(dlg, /Clear ticks/);
  assert.match(dlg, /const tf = Object\.fromEntries\(tfFacilities\.map\(\(f\) => \[f\.accountCode, tfPlanForSave\(f\)\]\)\);/);
  assert.match(dlg, /Over the limit:/);
  assert.match(dlg, /fillTf\(f, f\.billsDue\)/, "Fill from bills unchanged, and it ends ticking");
});
