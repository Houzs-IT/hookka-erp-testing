// Forecast P&L materials by supplier, under each material (owner 2026-11-10
// 「可以不可以这样，就是让他在每个categories 出现相关的supplier, 我从那边填」→「做」;
// spec docs/superpowers/specs/2026-11-10-forecast-suppliers-design.md). Each
// material row lists the suppliers that sold us that material lately; a
// material with any supplier figure in a month is their sum, one without keeps
// its %. The arithmetic every reader shares, then the page, the PUT, and the
// three server readers.
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

test("the material rows are the types the material purchase accounts fold into", () => {
  assert.deepEqual(g.materials.map((a) => a.code), TYPES.map((t) => `cat:${t}`));
  const types = fp.forecastMaterialAccountTypes(accounts, {});
  assert.deepEqual([...types.entries()].sort(), [
    ["701-0010", "FABRIC"], ["701-0020", "FABRIC"], ["702-0010", "PLYWOOD"], ["703-0010", "FILLER"], ["705-0010", "OTHERS"],
  ], "the same accounts as the rows: no parent, no carriage, no SST, no salary");
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
});

test("forecastTypeSuppliers: the suppliers that sold us a material lately", () => {
  const mix = { bySupplier: { s1: { FABRIC: 300, FILLER: 100 }, s2: { PLYWOOD: 50 }, s3: { FABRIC: 7 } }, all: {} };
  assert.deepEqual(fp.forecastTypeSuppliers(mix, "FABRIC").sort(), ["s1", "s3"]);
  assert.deepEqual(fp.forecastTypeSuppliers(mix, "OTHERS"), []);
});

test("cleanPurchasesByType: per material, whole sen, positive only, real keys; junk reads as nothing", () => {
  assert.deepEqual(
    fp.cleanPurchasesByType({ FABRIC: { s1: 1000.4, s2: 0, s3: -5, " ": 9, other: "250" }, " ": { s1: 5 }, FILLER: { s4: -1 }, BAD: "x" }),
    { FABRIC: { s1: 1000, other: 250 } },
  );
  assert.deepEqual(fp.cleanPurchasesByType(null), {});
  assert.deepEqual(fp.cleanPurchasesByType("x"), {});
});

const month = (o = {}) => ({
  salesSen: 100_000,
  pct: { "cat:FABRIC": { bp: 4000 }, "cat:FILLER": { bp: 1000 }, "700-1015": { amtSen: 700 } },
  ...o,
});

test("forecastMonthFigures: a material with supplier figures is their sum; one without keeps its %; carriage stays", () => {
  const m = month({ purchasesByType: { FABRIC: { s1: 30_000, s2: 20_000 } } });
  const f = fp.forecastMonthFigures(m, g, new Set());
  assert.equal(f.amt("cat:FABRIC"), 50_000, "the suppliers' sum, not 40% of sales");
  assert.equal(f.amt("cat:FILLER"), 10_000, "no supplier figure: its 10%");
  assert.equal(f.amt("700-1015"), 700);
  assert.equal(f.supplierKeyed("cat:FABRIC"), true);
  assert.equal(f.supplierKeyed("cat:FILLER"), false);
  assert.equal(f.cogs, 60_700);
  assert.equal(f.gp, 39_300);
  // Cleared again, the material reads its % again.
  const back = fp.forecastMonthFigures(month({ purchasesByType: { FABRIC: { s1: 0 } } }), g, new Set());
  assert.equal(back.amt("cat:FABRIC"), 40_000);
  assert.equal(back.supplierKeyed("cat:FABRIC"), false);
});

test("forecastMonthFigures: supplier figures under a material the page has no row for count nowhere", () => {
  const f = fp.forecastMonthFigures(month({ purchasesByType: { GONE: { s1: 9_999 } } }), g, new Set());
  assert.equal(f.cogs, 50_700, "40% + 10% + carriage, as without the stray figure");
});

test("forecastSupplierRows: active suppliers that sold the material lately and any keyed one, by name; Other last", () => {
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
  materialMix: (type) => (type === "FILLER" ? [{ months: 2, weight: 1 }] : [{ months: 1, weight: 1 }]),
  supplierTerm: (id) => ({ s1: 2, s2: 0 })[id] ?? 1,
  supplierName: (id) => id.toUpperCase(),
  ...o,
});

test("P&L forecast: a material keyed by supplier pays each one after its own term on that material's line; Other a month later; the rest by ratio", () => {
  const r = fc.buildPnlForecastLegs(pBase({
    fcMonths: { "2026-11": month({ purchasesByType: { FABRIC: { s1: 30_000, s2: 4_000, other: 1_000 } } }) },
  }));
  const mat = r.legs.filter((l) => l.section === "RAW_MATERIALS").map((l) => [l.col, l.label, l.sen, l.item.party]).sort();
  assert.deepEqual(mat, [
    ["fp:2026-11", "FABRIC", -4_000, "S2"],
    ["fp:2026-12", "FABRIC", -1_000, "Other (new suppliers)"],
    ["fp:2027-01", "FABRIC", -30_000, "S1"],
    ["fp:2027-01", "FILLER", -10_000, "FILLER"],
  ]);
});

test("P&L forecast: a month keyed by ratio pays as before, by each material's category term mix", () => {
  const r = fc.buildPnlForecastLegs(pBase({ fcMonths: { "2026-11": month() } }));
  const mat = r.legs.filter((l) => l.section === "RAW_MATERIALS").map((l) => [l.col, l.label, l.sen, l.item.party]).sort();
  assert.deepEqual(mat, [["fp:2026-12", "FABRIC", -40_000, "FABRIC"], ["fp:2027-01", "FILLER", -10_000, "FILLER"]]);
});

// ---- Monthly P&L forecast ----------------------------------------------------

test("Monthly P&L forecast: a material keyed by supplier is their sum; the others keep their %", () => {
  const w = pf.forecastPnlWindow(
    month({ purchasesByType: { FABRIC: { s1: 30_000, s2: 5_000 } } }),
    g,
    { override: {}, mappedAccounts: new Set(), deptAccount: () => null, accountOf: () => undefined },
  );
  assert.deepEqual(w.rmGroups.map((r) => [r.description, r.purchasesSen]), [["FABRIC", 35_000], ["FILLER", 10_000]]);
});

// ---- The sheet, the page, the PUT and the server readers ----------------------

test("snapshot: a supplier figure under a material is a change; keying and clearing it again is not", () => {
  const base = { "2026-12": { salesStr: "", pct: {} } };
  const snap = forecastSnapshot(base);
  // A supplier cell is { a } (RM) or { p } (%) since 2026-11-10 (tests/forecast-supplier-pct.test.mjs).
  assert.notEqual(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { FABRIC: { s1: { a: "5000" } } } } }), snap);
  assert.notEqual(
    forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { FABRIC: { s1: { a: "5000" } } } } }),
    forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { FILLER: { s1: { a: "5000" } } } } }),
    "the same supplier under another material is a different sheet",
  );
  assert.equal(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { FABRIC: { s1: { a: "" } } } } }), snap);
  assert.equal(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, suppliers: { FABRIC: { s1: { a: " " } } } } }), snap);
});

// The Forecast P&L page is the Monthly P&L's Edit forecast since 2026-11-11 (one editor).
const page = read("src/pages/accounting/monthly-pl-forecast-editor.tsx");
const api = read("src/api/routes/accounting.ts");
const put = api.slice(api.indexOf('app.put("/forecast"'), api.indexOf("\n});\n", api.indexOf('app.put("/forecast"')));

test("PUT /forecast keeps the supplier figures per material, positive whole sen only", () => {
  assert.match(put, /const purchasesByType = cleanPurchasesByType\(m\.purchasesByType\);/);
  assert.match(put, /\.\.\.\(Object\.keys\(purchasesByType\)\.length \? \{ purchasesByType \} : \{\}\)/, "a month without suppliers is stored as before");
  assert.doesNotMatch(put, /purchasesBySupplier/, "the first build's flat supplier cells are gone");
});

test("the page: suppliers under each material row, from GET /forecast/suppliers; no flat By supplier block", () => {
  assert.match(page, /fetch\("\/api\/accounting\/forecast\/suppliers"\)/);
  assert.match(page, /forecastSupplierRows\(/);
  assert.match(page, /forecastTypeSuppliers\(/);
  assert.doesNotMatch(page, /By supplier/, "the first build's flat block is gone");
  // Since 2026-11-10 the sheet's rules live in src/lib/forecast-sheet.ts, shared with the Monthly P&L.
  const sheet = read("src/lib/forecast-sheet.ts");
  assert.match(sheet, /purchasesByType/);
  assert.match(sheet, /\{ salesStr: "", pct: inherited, customers: \{\}, suppliers: \{\} \}/, "a new month copies neither customers nor suppliers");
  assert.match(sheet, /label: `\$\{ym\} \$\{type\} \$\{names\.supplierName\(id\)\} purchases`/, "every supplier figure is checked before Save");
});

test("the server readers: Cash Flow pays by each supplier's term; none of them needs the purchase weights any more", () => {
  assert.match(api, /app\.get\("\/forecast\/suppliers"/);
  const cf = api.slice(api.indexOf("async function loadCashflowForecast("), api.indexOf("async function computeCashflowStatement("));
  assert.match(cf, /supplierTerm: /);
  assert.doesNotMatch(cf, /loadForecastSupplierMix/);
  const mpl = api.slice(api.indexOf("async function loadMonthlyPlForecast("), api.indexOf("// Finance Overview, month by month"));
  assert.doesNotMatch(mpl, /loadForecastSupplierMix/);
  assert.doesNotMatch(api, /forecastSupplierSplit/);
  assert.match(api, /forecastTypeSupplierSen\(m, /, "the dashboard's forecast overlay reads a supplier-keyed material the same way");
});
