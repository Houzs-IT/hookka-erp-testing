// Trade finance: tick the suppliers that "Fill from Forecast P&L" takes (owner
// 2026-11-10: 「我要能选，别太复杂，就是tick 可以吗？」, then a picker from
// another system as the look — a box that opens a small table — 「supplier 名字
// 和total amount，然后tick可以吗？这个amounts是forecast PNL 的 amount」, then
// 「做」; spec docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md
// section 5). Until now the fill took only the suppliers the facility had paid
// before; those stay the default ticks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fc = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-forecast.ts")).href);
const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// Supplier A on NET60, B and C on NET30; "other" is Other (new suppliers).
const months = {
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
  const by = fc.tfForecastDueBySupplier({ months, termMonths: term, fromYm: "2026-11" });
  assert.deepEqual(by, {
    "sup-a": { "2027-01": 3_000_000 + 2_000_000, "2027-02": 1_000_000 },
    "sup-b": { "2026-12": 500_000 },
  });
});

test("tfTickedDue: the ticked suppliers added up, one figure per due month (one supplier keyed in several places is one total)", () => {
  const by = fc.tfForecastDueBySupplier({ months, termMonths: term, fromYm: "2026-11" });
  const list = Object.entries(by).map(([id, dueBy]) => ({ id, dueBy }));
  assert.deepEqual(fc.tfTickedDue(list, new Set(["sup-a", "sup-b"])), { "2026-12": 500_000, "2027-01": 5_000_000, "2027-02": 1_000_000 });
  assert.deepEqual(fc.tfTickedDue(list, new Set(["sup-b"])), { "2026-12": 500_000 });
  assert.deepEqual(fc.tfTickedDue(list, new Set()), {});
});

test("tfTickedIds: the owner's ticks once changed, even none; until then the suppliers the facility has paid before", () => {
  assert.deepEqual([...fc.tfTickedIds(undefined, ["sup-b", "sup-a"])].sort(), ["sup-a", "sup-b"]);
  assert.deepEqual([...fc.tfTickedIds(["sup-c"], ["sup-a"])], ["sup-c"]);
  assert.deepEqual([...fc.tfTickedIds([], ["sup-a"])], [], "unticking them all is a choice too");
});

test("tfSupplierRows: the amount due in the months shown; listed when it has one or is ticked; biggest first; the ticked total", () => {
  const suppliers = [
    { id: "sup-a", name: "A TRADING SDN. BHD.", dueBy: { "2027-01": 5_000_000, "2027-02": 1_000_000, "2027-11": 9_000_000 } },
    { id: "sup-b", name: "B INDUSTRIES SDN BHD", dueBy: { "2026-12": 500_000 } },
    { id: "sup-c", name: "C SDN BHD", dueBy: {} },
    { id: "sup-d", name: "D SDN BHD", dueBy: { "2027-03": 2_000_000 } },
    { id: "sup-e", name: "E SDN BHD", dueBy: {} },
    { id: "sup-f", name: "AA SDN BHD", dueBy: { "2027-04": 500_000 } },
  ];
  // November 2026 to October 2027.
  const yms = Array.from({ length: 12 }, (_, i) => fc.addMonthsYm("2026-11", i));
  const r = fc.tfSupplierRows({ suppliers, ticked: new Set(["sup-a", "sup-c"]), yms });
  assert.deepEqual(r.rows.map((x) => [x.id, x.totalSen, x.ticked]), [
    ["sup-a", 6_000_000, true], // November 2027 is past the twelve months
    ["sup-d", 2_000_000, false],
    ["sup-f", 500_000, false], // the same amount as B: by name
    ["sup-b", 500_000, false],
    ["sup-c", 0, true], // ticked with nothing keyed: shown as "-"
  ]); // E: nothing keyed and not ticked, so not listed
  assert.equal(r.tickedTotalSen, 6_000_000);
  assert.equal(r.rows[0].name, "A TRADING SDN. BHD.", "the full name; the label shortens it");
});

test("tfSupplierRows: a kept supplier stays listed unticked, so it can be ticked again (BUG-2026-11-10-491)", () => {
  // Prod 2026-11-10: unticking a default supplier with no Forecast P&L figure made its row vanish,
  // with no way to tick it back. The facility's own suppliers and the saved ticks are kept.
  const suppliers = [
    { id: "sup-a", name: "A SDN BHD", dueBy: { "2027-01": 100 } },
    { id: "sup-b", name: "B SDN BHD", dueBy: {} },
    { id: "sup-c", name: "C SDN BHD", dueBy: {} },
  ];
  const yms = ["2026-11", "2026-12", "2027-01"];
  const r = fc.tfSupplierRows({ suppliers, ticked: new Set(["sup-a"]), yms, keep: new Set(["sup-b"]) });
  assert.deepEqual(r.rows.map((x) => [x.id, x.totalSen, x.ticked]), [["sup-a", 100, true], ["sup-b", 0, false]], "C: not kept, not ticked, nothing keyed");
  assert.equal(r.tickedTotalSen, 100);
});

test("tfSupplierLabel: the name without its SDN BHD", () => {
  assert.equal(fc.tfSupplierLabel("A TRADING SDN. BHD."), "A TRADING");
  assert.equal(fc.tfSupplierLabel("B INDUSTRIES SDN BHD"), "B INDUSTRIES");
  assert.equal(fc.tfSupplierLabel("C INDUSTRIES SDN. BHD"), "C INDUSTRIES");
  assert.equal(fc.tfSupplierLabel("D COMPONENTS (ASIA) SDN BHD"), "D COMPONENTS (ASIA)");
  assert.equal(fc.tfSupplierLabel("Acme Fabric Sdn Bhd"), "Acme Fabric");
  assert.equal(fc.tfSupplierLabel("PLAIN NAME"), "PLAIN NAME");
});

test("cleanTfPlans keeps the ticks: strings, trimmed, once each, sorted; an empty list stays (all unticked); absent stays absent", () => {
  const r = fc.cleanTfPlans({
    "310-0020": { months: { "2026-12": 100 }, supplierIds: [" sup-b ", "sup-a", "sup-b", "", 7, null] },
    "310-0030": { months: {}, supplierIds: [] },
    "310-0040": { months: {}, supplierIds: "sup-a" },
    "310-0050": { months: {} },
  }, null);
  assert.deepEqual(r.facilities["310-0020"], { months: { "2026-12": 100 }, supplierIds: ["sup-a", "sup-b"] });
  assert.deepEqual(r.facilities["310-0030"], { months: {}, supplierIds: [] });
  assert.deepEqual(r.facilities["310-0040"], { months: {} }, "not a list: no ticks kept");
  assert.deepEqual(r.facilities["310-0050"], { months: {} }, "the default keeps following the facility's payments");
});

const api = read("src/api/routes/accounting.ts");
const page = read("src/pages/accounting/index.tsx");
const picker = read("src/pages/accounting/tf-supplier-picker.tsx");

test("the inputs: every supplier's Forecast P&L dues with its name, each facility's paid-before suppliers, names for saved ticks", () => {
  const fn = api.slice(api.indexOf("async function cfForecastTfFacilities("), api.indexOf('app.get("/cashflow-forecast-inputs"'));
  assert.match(fn, /tfForecastDueBySupplier\(\{ months: fcMonths, termMonths: termMonthsOf, fromYm: curYm \}\)/);
  assert.match(fn, /paidSupplierIds,/);
  assert.match(fn, /\.\.\.Object\.values\(plans\)\.flatMap\(\(p\) => p\.supplierIds \?\? \[\]\)/, "a saved tick keeps its name with no figures");
  assert.match(fn, /return \{ facilities, forecastSuppliers \};/);
  assert.doesNotMatch(fn, /\b(INSERT|UPDATE|DELETE)\b/);
  const g = api.slice(api.indexOf('app.get("/cashflow-forecast-inputs"'), api.indexOf('app.put("/cashflow-forecast-inputs"'));
  assert.match(g, /tf: \{ facilities: tf\.facilities, plans: tfPlans, forecastSuppliers: tf\.forecastSuppliers \}/);
});

test("the popup: a Suppliers box per facility; the fill takes the ticked suppliers; a tick asks for the fill again; Save keeps the ticks", () => {
  const dlg = page.slice(page.indexOf("function CfForecastInputsDialog("), page.indexOf("\nfunction ", page.indexOf("function CfForecastInputsDialog(") + 10));
  assert.match(dlg, /<TfSupplierPicker /);
  assert.match(dlg, /const ticked = tfTickedIds\(p\.supplierIds, f\.paidSupplierIds \?\? \[\]\);/);
  // BUG-2026-11-10-491: the facility's own suppliers and the ticks it opened with stay listed unticked.
  assert.match(dlg, /keep: new Set\(\[\.\.\.\(f\.paidSupplierIds \?\? \[\]\), \.\.\.\(tfOpenedTicks\[f\.accountCode\] \?\? \[\]\)\]\)/);
  assert.match(dlg, /setTfOpenedTicks\(Object\.fromEntries\(Object\.entries\(j\.data\.tf\?\.plans \?\? \{\}\)\.map\(\(\[k, p\]\) => \[k, p\.supplierIds \?\? \[\]\]\)\)\);/);
  assert.match(dlg, /fillTf\(f, tfTickedDue\(tfSuppliers, ticked\), "forecast"\)/);
  assert.match(dlg, /fillTf\(f, f\.billsDue, "bills"\)/, "Fill from bills is unchanged");
  assert.match(dlg, /Ticks changed: press Fill from Forecast P&L/);
  // The ticks ride in the plan Save already sends.
  assert.match(dlg, /supplierIds: \[\.\.\.cur\]\.sort\(\)/);
  assert.match(dlg, /body: JSON\.stringify\(\{ months, \.\.\.\(tfFacilities\.length \? \{ tf \} : \{\}\) \}\)/);
});

test("the picker: a box that opens a table over the popup — tick, supplier, amount, the ticked total; Esc and a click outside close only it", () => {
  assert.match(picker, /createPortal\(/, "over the popup, not clipped by its scrolling table");
  assert.match(picker, /useEscapeClose\(\(\) => setOpen\(false\), open\)/, "Esc closes the table, not the popup");
  assert.match(picker, /document\.addEventListener\("mousedown", onDown\)/);
  assert.match(picker, /computeDropdownPlacement\(/, "opens upward when there is no room below");
  assert.match(picker, /type="checkbox"/);
  for (const w of ["Supplier", "Forecast P&L (RM)", "Ticked total", "Suppliers:"]) assert.ok(picker.includes(w), w);
  assert.match(picker, /tfSupplierLabel\(/);
});
