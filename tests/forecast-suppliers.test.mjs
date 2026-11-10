// Forecast P&L materials by supplier — by ratio, or one by one (owner
// 2026-11-10 「supplier 那边还是你可以 set 根据 ratio 也可以，一个个也可以」;
// spec docs/superpowers/specs/2026-11-10-forecast-suppliers-design.md).
// The arithmetic every reader shares, then the page, the PUT, and the three
// server readers that must take the same spread.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fp = await import(pathToFileURL(resolve(process.cwd(), "src/lib/forecast-pnl.ts")).href);
const fc = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-forecast.ts")).href);
const pf = await import(pathToFileURL(resolve(process.cwd(), "src/lib/pnl-forecast.ts")).href);
const { forecastSnapshot } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/forecast-snapshot.ts")).href);

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const acct = (code, type, name = code, isPostable = true) => ({ code, name, type, isPostable });
const accounts = [
  acct("701-0010", "COST", "PURCHASE - B.M FABRIC"),
  acct("701-0020", "COST", "PURCHASE - S FABRIC"),
  acct("701-0000", "COST", "PURCHASE - FABRIC", false),
  acct("702-0010", "COST", "PURCHASE - PLYWOOD"),
  acct("703-0010", "COST", "PURCHASE - B.FILLER"),
  acct("705-0010", "COST", "PURCHASE - OTHERS"),
  acct("700-1015", "COST", "CARRIAGE INWARDS"),
  acct("706-0000", "COST", "SST"),
  acct("750-0010", "COST", "PRODUCTION - SALARY"),
  acct("900-0010", "EXPENSE", "UPKEEP"),
];
const g = fp.forecastLineGroups(accounts, {}, []);
const TYPES = ["FABRIC", "FILLER", "OTHERS", "PLYWOOD"];
const mix = {
  bySupplier: { s1: { FABRIC: 300, FILLER: 100 }, s2: { PLYWOOD: 50 }, s3: { BOGUS: 10 } },
  all: { FABRIC: 300, FILLER: 100, PLYWOOD: 100 },
};

test("the material rows are the types the material purchase accounts fold into", () => {
  assert.deepEqual(g.materials.map((a) => a.code), TYPES.map((t) => `cat:${t}`));
  const types = fp.forecastMaterialAccountTypes(accounts, {});
  assert.deepEqual([...types.entries()].sort(), [
    ["701-0010", "FABRIC"], ["701-0020", "FABRIC"], ["702-0010", "PLYWOOD"], ["703-0010", "FILLER"], ["705-0010", "OTHERS"],
  ], "the same accounts as the rows: no parent, no carriage, no SST, no salary");
});

test("cleanPurchasesBySupplier: whole sen, positive only, a real key; junk reads as nothing", () => {
  assert.deepEqual(fp.cleanPurchasesBySupplier({ s1: 1000.4, s2: 0, s3: -5, " ": 9, other: "250" }), { s1: 1000, other: 250 });
  assert.deepEqual(fp.cleanPurchasesBySupplier(null), {});
  assert.deepEqual(fp.cleanPurchasesBySupplier("x"), {});
  assert.equal(fp.forecastPurchasesSen({ purchasesBySupplier: { s1: 100, s2: 250 } }), 350);
  assert.equal(fp.forecastPurchasesSen({ salesSen: 5 }), 0);
});

test("supplierMixFromLegs: net debit on the material accounts, by supplier and type; nothing else", () => {
  const types = fp.forecastMaterialAccountTypes(accounts, {});
  const m = fp.supplierMixFromLegs([
    { supplierId: "s1", accountCode: "701-0010", debitSen: 1000, creditSen: 0 },
    { supplierId: "s1", accountCode: "701-0020", debitSen: 500, creditSen: 0 },
    { supplierId: "s1", accountCode: "703-0010", debitSen: 400, creditSen: 0 },
    { supplierId: "s1", accountCode: "706-0000", debitSen: 90, creditSen: 0 },
    { supplierId: "s1", accountCode: "400-0000", debitSen: 0, creditSen: 1990 },
    { supplierId: "s2", accountCode: "702-0010", debitSen: 300, creditSen: 0 },
    { supplierId: "s2", accountCode: "702-0010", debitSen: 0, creditSen: 300 },
    { supplierId: "s3", accountCode: "705-0010", debitSen: 70, creditSen: 0 },
  ], (code) => types.get(code));
  assert.deepEqual(m.bySupplier, { s1: { FABRIC: 1500, FILLER: 400 }, s3: { OTHERS: 70 } }, "a voided purchase nets to nothing and drops out");
  assert.deepEqual(m.all, { FABRIC: 1500, FILLER: 400, OTHERS: 70 });
});

test("forecastSupplierSplit: none in a month keyed the ratio way", () => {
  assert.equal(fp.forecastSupplierSplit({ salesSen: 100, pct: { "cat:FABRIC": { bp: 3000 } } }, TYPES, mix), null);
  assert.equal(fp.forecastSupplierSplit(undefined, TYPES, mix), null);
});

test("forecastSupplierSplit: each supplier by what it sold us lately; Other and an unknown by everyone's; the parts add up", () => {
  const s = fp.forecastSupplierSplit({ purchasesBySupplier: { s1: 10_001, s2: 5_000, s4: 1_000, other: 2_000 } }, TYPES, mix);
  assert.equal(s.totalSen, 18_001);
  const by = Object.fromEntries(s.suppliers.map((x) => [x.id, x.byType]));
  assert.deepEqual(by.s1, { FABRIC: 7_501, FILLER: 2_500 }, "three to one, the odd sen to the larger remainder");
  assert.deepEqual(by.s2, { PLYWOOD: 5_000 });
  assert.deepEqual(by.s4, { FABRIC: 600, FILLER: 200, PLYWOOD: 200 }, "no purchases lately: everyone's mix");
  assert.deepEqual(by.other, { FABRIC: 1_200, FILLER: 400, PLYWOOD: 400 });
  assert.deepEqual(s.byType, { FABRIC: 9_301, FILLER: 3_100, PLYWOOD: 5_600 });
  for (const x of s.suppliers) assert.equal(Object.values(x.byType).reduce((a, b) => a + b, 0), x.sen);
});

test("forecastSupplierSplit: a type no row carries is ignored; nothing to go by = the OTHERS row, else the first", () => {
  const s = fp.forecastSupplierSplit({ purchasesBySupplier: { s3: 900 } }, TYPES, mix);
  assert.deepEqual(s.suppliers[0].byType, { FABRIC: 540, FILLER: 180, PLYWOOD: 180 }, "its only type is not a row: everyone's mix");
  const none = fp.forecastSupplierSplit({ purchasesBySupplier: { s1: 900 } }, TYPES, { bySupplier: {}, all: {} });
  assert.deepEqual(none.byType, { OTHERS: 900 });
  const noOthers = fp.forecastSupplierSplit({ purchasesBySupplier: { s1: 900 } }, ["FABRIC", "PLYWOOD"], { bySupplier: {}, all: {} });
  assert.deepEqual(noOthers.byType, { FABRIC: 900 });
  assert.equal(fp.forecastSupplierSplit({ purchasesBySupplier: { s1: 900 } }, [], mix), null, "no material rows at all: nothing to spread over");
});

test("forecastMonthFigures: a supplier month's materials are the suppliers' sum, spread; the rows' own % sets aside; carriage stays", () => {
  const m = {
    salesSen: 100_000,
    purchasesBySupplier: { s1: 20_000, s2: 4_000 },
    pct: { "cat:FABRIC": { bp: 5000 }, "cat:OTHERS": { bp: 1000 }, "700-1015": { amtSen: 700 } },
  };
  const f = fp.forecastMonthFigures(m, g, new Set(), mix);
  assert.equal(f.amt("cat:FABRIC"), 15_000);
  assert.equal(f.amt("cat:FILLER"), 5_000);
  assert.equal(f.amt("cat:PLYWOOD"), 4_000);
  assert.equal(f.amt("cat:OTHERS"), 0, "its keyed 10% is set aside this month");
  assert.equal(f.amt("700-1015"), 700);
  assert.equal(f.cogs, 24_700);
  assert.equal(f.gp, 75_300);
  assert.equal(f.supplierSplit?.totalSen, 24_000);
  // The same month without its supplier cells reads by ratio again.
  const back = fp.forecastMonthFigures({ ...m, purchasesBySupplier: {} }, g, new Set(), mix);
  assert.equal(back.amt("cat:FABRIC"), 50_000);
  assert.equal(back.amt("cat:OTHERS"), 10_000);
  assert.equal(back.supplierSplit, null);
});

test("forecastMonthFigures without the weights keeps a supplier month's total, on the OTHERS row", () => {
  const f = fp.forecastMonthFigures({ salesSen: 100_000, purchasesBySupplier: { s1: 20_000 } }, g, new Set());
  assert.equal(f.amt("cat:OTHERS"), 20_000);
  assert.equal(f.cogs, 20_000);
});

test("forecastSupplierRows: active suppliers bought from lately and any keyed one, by name; Other last", () => {
  const rows = fp.forecastSupplierRows(
    [
      { id: "s1", name: "Zeta", isActive: true },
      { id: "s2", name: "alpha", isActive: true },
      { id: "s3", name: "Beta", isActive: true },
      { id: "s4", name: "Gone", isActive: false },
      { id: "s5", name: "Old", isActive: false },
    ],
    ["s1", "s2", "s4"],
    ["s5", "s9", "other"],
  );
  assert.deepEqual(rows.map((r) => r.id), ["s2", "s5", "s9", "s1", "other"]);
  assert.equal(rows.find((r) => r.id === "s9").name, "Unknown supplier (s9)");
  assert.equal(rows[rows.length - 1].name, "Other (new suppliers)");
});

// ---- Cash Flow: the P&L forecast column -------------------------------------

const pBase = (o = {}) => ({
  today: "2026-11-10", period: "2026-11", months: ["2026-11", "2026-10"], openingYm: "2026-05",
  fcMonths: {}, groups: g, override: {}, mappedAccounts: new Set(),
  salaryAccount: "410-0010", arAcct: "300-0000",
  nonCash: () => false,
  customerTerm: () => 1, customerName: (id) => id,
  receiptMix: [{ months: 1, weight: 1 }],
  materialMix: () => [{ months: 1, weight: 1 }],
  supplierMix: mix,
  supplierTerm: (id) => ({ s1: 2, s2: 0 })[id] ?? 1,
  supplierName: (id) => id.toUpperCase(),
  ...o,
});

test("P&L forecast: a supplier month pays each supplier after its own term, on its types' lines; Other a month later", () => {
  const r = fc.buildPnlForecastLegs(pBase({
    fcMonths: { "2026-11": { salesSen: 100_000, purchasesBySupplier: { s1: 20_000, s2: 4_000, other: 1_000 }, pct: { "cat:FABRIC": { bp: 5000 } } } },
  }));
  const mat = r.legs.filter((l) => l.section === "RAW_MATERIALS").map((l) => [l.col, l.label, l.sen, l.item.party]).sort();
  assert.deepEqual(mat, [
    ["fp:2026-11", "PLYWOOD", -4_000, "S2"],
    ["fp:2026-12", "FABRIC", -600, "Other (new suppliers)"],
    ["fp:2026-12", "FILLER", -200, "Other (new suppliers)"],
    ["fp:2026-12", "PLYWOOD", -200, "Other (new suppliers)"],
    ["fp:2027-01", "FABRIC", -15_000, "S1"],
    ["fp:2027-01", "FILLER", -5_000, "S1"],
  ]);
});

test("P&L forecast: a month keyed by ratio pays as before, by its category's term mix", () => {
  const r = fc.buildPnlForecastLegs(pBase({
    fcMonths: { "2026-11": { salesSen: 100_000, pct: { "cat:FABRIC": { bp: 3000 } } } },
    materialMix: (type) => (type === "FABRIC" ? [{ months: 2, weight: 1 }] : [{ months: 1, weight: 1 }]),
  }));
  const mat = r.legs.filter((l) => l.section === "RAW_MATERIALS").map((l) => [l.col, l.label, l.sen, l.item.party]);
  assert.deepEqual(mat, [["fp:2027-01", "FABRIC", -30_000, "FABRIC"]]);
});

// ---- Monthly P&L forecast ----------------------------------------------------

test("Monthly P&L forecast: a supplier month's purchase groups are the spread", () => {
  const w = pf.forecastPnlWindow(
    { salesSen: 100_000, purchasesBySupplier: { s1: 20_000 } },
    g,
    { override: {}, mappedAccounts: new Set(), deptAccount: () => null, accountOf: () => undefined, supplierMix: mix },
  );
  assert.deepEqual(w.rmGroups.map((r) => [r.description, r.purchasesSen]), [["FABRIC", 15_000], ["FILLER", 5_000]]);
  assert.equal(w.rmConsumedSen, 20_000);
});

// ---- The sheet, the page, the PUT and the server readers ----------------------

test("snapshot: a supplier cell is a change; keying and clearing it again is not", () => {
  const base = { "2026-12": { salesStr: "", pct: {} } };
  const snap = forecastSnapshot(base);
  assert.notEqual(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { s1: "5000" } } }), snap);
  assert.equal(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { s1: "" } } }), snap);
  assert.equal(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { s1: " " } } }), snap);
});

const page = read("src/pages/forecast.tsx");
const api = read("src/api/routes/accounting.ts");
const put = api.slice(api.indexOf('app.put("/forecast"'), api.indexOf("\n});\n", api.indexOf('app.put("/forecast"')));

test("PUT /forecast keeps the supplier cells, positive whole sen only, and stores nothing derived", () => {
  assert.match(put, /const purchasesBySupplier = cleanPurchasesBySupplier\(m\.purchasesBySupplier\);/);
  assert.match(put, /\.\.\.\(Object\.keys\(purchasesBySupplier\)\.length \? \{ purchasesBySupplier \} : \{\}\)/, "a month without suppliers is stored as before");
});

test("the page: a By supplier block in Raw Materials, the weights from GET /forecast/suppliers, the cells saved", () => {
  assert.match(page, /fetch\("\/api\/accounting\/forecast\/suppliers"\)/);
  assert.match(page, /forecastSupplierRows\(/);
  assert.match(page, /purchasesBySupplier/);
  assert.match(page, /forecastMonthFigures\(toFcMonth\(months\[ym\]\), lines, mappedAccounts, supplierMix\)/, "the page's figures take the weights");
  assert.match(page, /\{ salesStr: "", pct: inherited, customers: \{\}, suppliers: \{\} \}/, "a new month copies neither customers nor suppliers");
  assert.match(page, /label: `\$\{ym\} \$\{supplierName\(id\)\} purchases`/, "every supplier cell is checked before Save");
});

test("the server readers take the same spread: Cash Flow, Monthly P&L, the dashboard; and the endpoint the page reads", () => {
  assert.match(api, /app\.get\("\/forecast\/suppliers"/);
  const cf = api.slice(api.indexOf("async function loadCashflowForecast("), api.indexOf("async function computeCashflowStatement("));
  assert.match(cf, /supplierMix,/);
  assert.match(cf, /supplierTerm: /);
  const mpl = api.slice(api.indexOf("async function loadMonthlyPlForecast("), api.indexOf("// Finance Overview, month by month"));
  assert.match(mpl, /supplierMix/);
  assert.match(api, /forecastSupplierSplit\(m, /, "the dashboard's forecast overlay spreads a supplier month the same way");
});
