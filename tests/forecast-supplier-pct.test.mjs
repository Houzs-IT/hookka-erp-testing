// Forecast P&L: each supplier under a material keyed as a % of sales OR as an
// RM amount (owner 2026-11-10, after #1274: 「这个我可以填percentage 算会上去
// 吗？就是每个supplier 填percentage 或amount」 → proposal → 「做」). The %
// is of the month's sales, like the material row's own %: typing one side
// clears the other, the empty box shows the derived value, and the material is
// the sum of its suppliers either way. Stored per supplier as whole sen (RM,
// as before) or `{ bp }` (%); every reader works the % out against the
// month's sales the same way (forecastTypeSupplierCells).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fp = await import(pathToFileURL(resolve(process.cwd(), "src/lib/forecast-pnl.ts")).href);
const fc = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-forecast.ts")).href);
const { forecastSnapshot } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/forecast-snapshot.ts")).href);

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const acct = (code, type, name = code, isPostable = true) => ({ code, name, type, isPostable });
const g = fp.forecastLineGroups([
  acct("701-0010", "COST", "PURCHASE - B.M FABRIC"),
  acct("703-0010", "COST", "PURCHASE - B.FILLER"),
  acct("700-1015", "COST", "CARRIAGE INWARDS"),
], {}, []);

// RM 350,000 of sales; FABRIC's own % is 15.
const SALES = 35_000_000;
const month = (o = {}) => ({ salesSen: SALES, pct: { "cat:FABRIC": { bp: 1500 }, "cat:FILLER": { bp: 1000 } }, ...o });

test("cleanPurchasesByType keeps a % cell as whole basis points beside RM cells; junk reads as nothing", () => {
  assert.deepEqual(
    fp.cleanPurchasesByType({
      FABRIC: { s1: { bp: 500 }, s2: 3_000_000, s3: { bp: 0 }, s4: { bp: -5 }, s5: { bp: "x" }, s6: {}, s7: { bp: 1234.6 }, s8: [7] },
      FILLER: { s1: { bp: 0 } },
    }),
    { FABRIC: { s1: { bp: 500 }, s2: 3_000_000, s7: { bp: 1235 } } },
  );
});

test("forecastTypeSupplierCells works a % cell out against the month's sales", () => {
  const m = month({ purchasesByType: { FABRIC: { s1: { bp: 500 }, s2: 3_000_000 } } });
  assert.deepEqual(fp.forecastTypeSupplierCells(m, "FABRIC"), [["s1", 1_750_000], ["s2", 3_000_000]]);
  assert.equal(fp.forecastTypeSupplierSen(m, "FABRIC"), 4_750_000);
  // Sales keyed per customer: the % is of their sum, as everywhere else.
  const byCustomer = month({ salesSen: 1, salesByCustomer: { c1: 20_000_000, c2: 15_000_000 }, purchasesByType: { FABRIC: { s1: { bp: 500 } } } });
  assert.deepEqual(fp.forecastTypeSupplierCells(byCustomer, "FABRIC"), [["s1", 1_750_000]]);
});

test("a material keyed by supplier % and RM is their sum; the example the owner was shown", () => {
  // Acacia 5%, MEDITEX RM 30,000 → FABRIC 47,500 (13.57%).
  const f = fp.forecastMonthFigures(month({ purchasesByType: { FABRIC: { acacia: { bp: 500 }, meditex: 3_000_000 } } }), g, new Set());
  assert.equal(f.amt("cat:FABRIC"), 4_750_000);
  assert.equal(f.supplierKeyed("cat:FABRIC"), true);
  assert.equal(f.amt("cat:FILLER"), 3_500_000, "FILLER keeps its 10%");
  assert.equal(f.cogs, 8_250_000);
});

test("a supplier % in a month without sales is 0, yet the material is still keyed by its suppliers", () => {
  const f = fp.forecastMonthFigures(
    { salesSen: 0, pct: { "cat:FABRIC": { amtSen: 900_000 } }, purchasesByType: { FABRIC: { s1: { bp: 500 } } } },
    g, new Set(),
  );
  assert.equal(f.supplierKeyed("cat:FABRIC"), true);
  assert.equal(f.amt("cat:FABRIC"), 0, "the suppliers' sum, not the material's own RM");
});

test("Cash Flow pays a % supplier the worked-out amount after its own term; a 0 cell pays nothing", () => {
  const base = {
    today: "2026-11-10", period: "2026-11", months: ["2026-11", "2026-10"], openingYm: "2026-05",
    groups: g, override: {}, mappedAccounts: new Set(), salaryAccount: "410-0010", arAcct: "300-0000",
    nonCash: () => false, customerTerm: () => 1, customerName: (id) => id,
    receiptMix: [{ months: 1, weight: 1 }], materialMix: () => [{ months: 1, weight: 1 }],
    supplierTerm: (id) => ({ s1: 2 })[id] ?? 1, supplierName: (id) => id.toUpperCase(),
  };
  const legs = (m) => fc.buildPnlForecastLegs({ ...base, fcMonths: { "2026-11": m } }).legs
    .filter((l) => l.section === "RAW_MATERIALS" && l.label === "FABRIC")
    .map((l) => [l.col, l.sen, l.item.party]).sort();
  assert.deepEqual(legs(month({ purchasesByType: { FABRIC: { s1: { bp: 500 }, other: 100_000 } } })), [
    ["fp:2026-12", -100_000, "Other (new suppliers)"],
    ["fp:2027-01", -1_750_000, "S1"],
  ]);
  assert.deepEqual(legs({ salesSen: 0, pct: {}, purchasesByType: { FABRIC: { s1: { bp: 500 } } } }), []);
});

test("snapshot: a supplier cell reads by the side that is keyed; clearing it is no change", () => {
  const base = { "2026-12": { salesStr: "", pct: {} } };
  const at = (cell) => forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { FABRIC: { s1: cell } } } });
  assert.notEqual(at({ p: "5" }), forecastSnapshot(base));
  assert.notEqual(at({ p: "5" }), at({ a: "5" }), "5% and RM 5 are different sheets");
  assert.equal(at({}), forecastSnapshot(base));
  assert.equal(at({ a: " " }), forecastSnapshot(base));
});

const page = read("src/pages/forecast.tsx");
const api = read("src/api/routes/accounting.ts");

test("the page: each supplier row has the material row's RM and % boxes, either side clears the other", () => {
  const rows = page.slice(page.indexOf("const supplierRowsFor = "), page.indexOf("\n  };\n", page.indexOf("const supplierRowsFor = ")));
  assert.match(rows, /setSupplierAmt\(ym, type, r\.id, /, "RM box");
  assert.match(rows, /setSupplierPct\(ym, type, r\.id, /, "% box");
  assert.match(page, /const setSupplierAmt = \(ym: string, type: string, id: string, v: string\) =>\s*setSupplierCell\(ym, type, id, v === "" \? \{\} : \{ a: v \}\);/);
  assert.match(page, /const setSupplierPct = \(ym: string, type: string, id: string, v: string\) =>\s*setSupplierCell\(ym, type, id, v === "" \? \{\} : \{ p: v \}\);/);
  assert.match(page, /suppliers\?: Record<string, Record<string, CellEntry>>;/, "a supplier cell is the same { a, p } as a line's");
});

test("the page: one conversion of supplier cells for the screen and for Save; saved % cells load back as %", () => {
  assert.match(page, /function supplierCells\(/);
  assert.equal((page.match(/supplierCells\(cells\)/g) ?? []).length, 2, "toFcMonth and save both use it");
  assert.match(page, /\{ p: bpToStr\(/, "a stored { bp } supplier cell loads into the % box");
});

test("the dashboard overlay counts a material as supplier-keyed by its keyed cells, as the page does", () => {
  const ov = api.slice(api.indexOf("const supplierTypesOf = "), api.indexOf("const fcLineAmt = "));
  assert.match(ov, /forecastTypeSupplierCells\(m, type\)\.length > 0/);
  assert.match(ov, /forecastTypeSupplierSen\(m, type\)/);
});
