// Monthly P&L: key the forecast in place (owner 2026-11-10 「我可以不可以把
// forecastP&L 自己做去现有的monthly P&L？因为我想要refer 数据」 → chose A, keying
// in the Monthly P&L: 「我想要A, 因为我的forecast cash flow 也是在cash flow 变动」
// → 「是不是我可以理解forecast的可以在monthly pnl 点开填资料保存？」 yes → 「做」).
// Spec: docs/superpowers/specs/2026-11-10-monthly-pl-forecast-edit-design.md.
//
// One sheet model for both pages (src/lib/forecast-sheet.ts), one column
// layout for the route and the browser (plForecastMatrix), and each row's
// forecast key (fcKey) so the editor knows what a Forecast cell keys.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const imp = (p) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const sh = await imp("src/lib/forecast-sheet.ts");
const fp = await imp("src/lib/forecast-pnl.ts");
const pf = await imp("src/lib/pnl-forecast.ts");
const ed = await imp("src/lib/pl-forecast-edit.ts");
const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// ── The shared sheet model ───────────────────────────────────────────────────
test("sheet: saved → sheet → payload keeps every cell in its own box, a legacy bare % as { bp }", () => {
  const saved = {
    "2026-12": {
      salesSen: 999, salesByCustomer: { c1: 20_000_000, c2: 15_000_000 },
      purchasesByType: { FABRIC: { s1: 3_000_000, s2: { bp: 500 } } },
      pct: { "cat:FABRIC": { bp: 1500 }, "900-0010": { amtSen: 450_000 }, "dept:PROD": 1200 },
    },
  };
  const sheet = sh.sheetFromSaved(saved);
  assert.deepEqual(sheet["2026-12"].customers, { c1: "200000.00", c2: "150000.00" });
  assert.deepEqual(sheet["2026-12"].suppliers, { FABRIC: { s1: { a: "30000.00" }, s2: { p: "5" } } });
  assert.deepEqual(sheet["2026-12"].pct, { "cat:FABRIC": { p: "15" }, "900-0010": { a: "4500" }, "dept:PROD": { p: "12" } });
  assert.deepEqual(sh.sheetPayload(sheet), {
    "2026-12": {
      salesSen: 35_000_000, salesByCustomer: { c1: 20_000_000, c2: 15_000_000 },
      pct: { "cat:FABRIC": { bp: 1500 }, "900-0010": { amtSen: 450_000 }, "dept:PROD": { bp: 1200 } },
      purchasesByType: { FABRIC: { s1: 3_000_000, s2: { bp: 500 } } },
    },
  });
});

test("sheet: a new month takes the previous month's percentages and no customer or supplier cells", () => {
  const months = { "2026-11": { salesStr: "1", pct: { a: { p: "10" } }, customers: { c: "5" }, suppliers: { F: { s: { a: "1" } } } }, "2027-01": { salesStr: "", pct: { a: { p: "30" } } } };
  assert.deepEqual(sh.newSheetMonth(months, "2026-12"), { salesStr: "", pct: { a: { p: "10" } }, customers: {}, suppliers: {} });
  assert.deepEqual(sh.newSheetMonth(months, "2026-10").pct, { a: { p: "30" } }, "before every month: the latest month's");
});

test("sheet: every money cell is checked before Save, labelled by month and line", () => {
  const fields = sh.sheetMoneyFields(
    { "2026-12": { salesStr: "x", pct: { "900-1": { a: "12" }, "cat:F": { p: "5" } }, customers: { c1: "7", c2: "" }, suppliers: { FABRIC: { s1: { a: "9" }, s2: { p: "3" } } } } },
    { customerName: (id) => `C-${id}`, supplierName: (id) => `S-${id}` },
  );
  assert.deepEqual(fields.map((f) => f.label), ["2026-12 sales", "2026-12 C-c1 sales", "2026-12 FABRIC S-s1 purchases", "2026-12 900-1 amount"]);
});

// ── One column layout for the route and the browser ─────────────────────────
const W = (o = {}) => ({
  netSalesSen: 0, revLines: [], rmGroups: [], rmConsumedSen: 0, carriageSen: 0, sstSen: 0,
  labourLines: [], labourSen: 0, overheadLines: [], overheadSen: 0,
  wipOpen: 0, wipClose: 0, fgOpen: 0, fgClose: 0, manufacturingSen: 0, cogsSen: 0, grossProfitSen: 0,
  otherIncomeSen: 0, otherIncomeLines: [], expenseLines: [], expenseSen: 0, netProfitSen: 0, ...o,
});

test("plForecastMatrix: Accumulated actual and forecast, the months ahead newest first, then each month's actual and forecast", () => {
  const actual = W({ netSalesSen: 100, revLines: [{ code: "500-1", name: "SALES SOFA", amountSen: 100 }] });
  const fc = (ym) => W({ netSalesSen: ym === "2026-11" ? 50 : 70, expenseLines: [{ code: "900-9", name: "NEW COST", amountSen: 5, salary: false }], expenseSen: 5 });
  const m = pf.plForecastMatrix({
    accWindow: actual,
    monthCols: [{ key: "2026-11", label: "Nov 2026", accum: false, window: actual }],
    futureYms: ["2026-12", "2027-01"],
    forecastOf: fc,
    labelOf: (ym) => ym,
  });
  assert.deepEqual(m.columns.map((c) => c.key), ["acc", "fc:acc", "fc:2027-01", "fc:2026-12", "2026-11", "fc:2026-11"]);
  assert.deepEqual(m.columns.map((c) => [c.forecast ?? false, c.ym ?? null, c.future ?? false]), [
    [false, null, false], [true, null, false], [true, "2027-01", true], [true, "2026-12", true], [false, "2026-11", false], [true, "2026-11", false],
  ]);
  const sales = m.rows.find((r) => r.label === "SALES");
  assert.equal(sales.fcKey, "sales");
  assert.deepEqual(sales.values, [100, 50, 70, 70, 100, 50], "Accumulated forecast = the year's months only");
  assert.ok(m.rows.some((r) => r.label === "NEW COST" && r.fcKey === "900-9"), "a line keyed only in the forecast still gets a row");
});

test("buildPnlMatrix tags what a row keys: sales, a material type, carriage, SST, each account line", () => {
  const w = W({
    rmGroups: [{ group: "type:FABRIC", description: "FABRIC", openingSen: 0, purchasesSen: 10, closingSen: 0 }],
    labourLines: [{ code: "750-0010", name: "SALARIES", amountSen: 1 }],
    overheadLines: [{ code: "800-1", name: "UPKEEP", amountSen: 1 }],
    otherIncomeLines: [{ code: "600-1", name: "RENT IN", amountSen: 1 }],
    expenseLines: [{ code: "900-S1", name: "OFFICE SALARY", amountSen: 1, salary: true }],
  });
  const m = pf.plForecastMatrix({ accWindow: w, monthCols: [], futureYms: [], forecastOf: () => w, labelOf: (ym) => ym });
  const key = (label) => m.rows.find((r) => r.label === label)?.fcKey;
  assert.equal(key("FABRIC"), "cat:FABRIC");
  assert.equal(key("CARRIAGE INWARDS"), "700-1015");
  assert.equal(key("SST CHARGES"), "706-0000");
  assert.equal(key("SALARIES"), "750-0010");
  assert.equal(key("UPKEEP"), "800-1");
  assert.equal(key("RENT IN"), "600-1");
  assert.equal(key("OFFICE SALARY"), "900-S1");
  assert.equal(key("WIP - OPENING"), undefined, "stock lines key nothing");
});

test("Edit forecast lists every line the forecast keys, figures or not (extraSpine)", () => {
  const g0 = fp.forecastLineGroups([
    { code: "701-0010", name: "PURCHASE - B.M FABRIC", type: "COST", isPostable: true },
    { code: "900-0077", name: "NEVER USED COST", type: "EXPENSE", isPostable: true },
  ], {}, [{ code: "OFFICE", bucket: "OPEX_SALARIES" }]);
  const o = { override: {}, mappedAccounts: new Set(), deptAccount: () => null, accountOf: (code) => (code === "900-0077" ? { name: "NEVER USED COST", type: "EXPENSE" } : undefined) };
  const lines = pf.forecastLinesWindow(g0, o);
  assert.deepEqual(lines.rmGroups.map((r) => [r.group, r.purchasesSen]), [["type:FABRIC", 0]]);
  assert.ok(lines.expenseLines.some((l) => l.code === "900-0077" && l.amountSen === 0));
  assert.ok(lines.expenseLines.some((l) => l.code === "dept:OFFICE" && l.amountSen === 0), "a department with no posting account on its own line");
  assert.equal(lines.netProfitSen, 0);
  const empty = W();
  const m = pf.plForecastMatrix({ accWindow: empty, monthCols: [], futureYms: [], forecastOf: () => empty, labelOf: (ym) => ym, extraSpine: lines });
  assert.ok(m.rows.some((r) => r.fcKey === "900-0077"), "the unused account has a row to key");
  assert.ok(m.rows.some((r) => r.fcKey === "cat:FABRIC"));
  const plain = pf.plForecastMatrix({ accWindow: empty, monthCols: [], futureYms: [], forecastOf: () => empty, labelOf: (ym) => ym });
  assert.ok(!plain.rows.some((r) => r.fcKey === "900-0077"), "the read-only view is unchanged");
});

// ── What a Forecast cell keys ────────────────────────────────────────────────
const acct = (code, type, name = code, isPostable = true) => ({ code, name, type, isPostable });
const g = fp.forecastLineGroups([
  acct("701-0010", "COST", "PURCHASE - B.M FABRIC"),
  acct("700-1015", "COST", "CARRIAGE INWARDS"),
  acct("750-0010", "COST", "PRODUCTION - SALARY"),
  acct("900-0010", "EXPENSE", "UPKEEP"),
], {}, [{ code: "PRODUCTION", bucket: "DIRECT_LABOUR" }, { code: "OFFICE", bucket: "OPEX_SALARIES" }]);

test("plEditKey: a row keys its forecast line, or nothing", () => {
  const row = (fcKey) => ({ kind: "line", depth: 1, label: "x", values: [], pctValues: [], ...(fcKey ? { fcKey } : {}) });
  assert.equal(ed.plEditKey(row("sales"), g), "sales");
  assert.equal(ed.plEditKey(row("cat:FABRIC"), g), "cat:FABRIC");
  assert.equal(ed.plEditKey(row("700-1015"), g), "700-1015");
  assert.equal(ed.plEditKey(row("900-0010"), g), "900-0010");
  assert.equal(ed.plEditKey(row("dept:PRODUCTION"), g), "dept:PRODUCTION", "a department with no posting account keys on its own line");
  assert.equal(ed.plEditKey(row("500-0001"), g), null, "a line the forecast does not list");
  assert.equal(ed.plEditKey(row(undefined), g), null);
});

test("deptsPostingTo: the departments ▸ opens under an account line are those whose wages post there", () => {
  const deptAccount = (d) => ({ PRODUCTION: "750-0010", OFFICE: "900-S1" })[d] ?? null;
  assert.deepEqual(ed.deptsPostingTo("750-0010", g, deptAccount).map((d) => d.code), ["dept:PRODUCTION"]);
  assert.deepEqual(ed.deptsPostingTo("900-0010", g, deptAccount), []);
});

// ── The route, the stored report copy, and the page ─────────────────────────
const api = read("src/api/routes/accounting.ts");
const plm = api.slice(api.indexOf("async function plMonthlyResponse("), api.indexOf("async function loadMonthlyPlForecast("));

test("/pl-monthly lays its forecast columns with the shared layout, and edit=1 adds what the browser rebuilds from", () => {
  assert.match(plm, /plForecastMatrix\(\{/);
  assert.match(plm, /c\.req\.query\("edit"\) === "1"/);
  assert.match(plm, /edit: \{ windows/);
});

test("a stored report copy served while it rebuilds says so beside data", () => {
  const rs = api.slice(api.indexOf("async function reportSnapshot("), api.indexOf("\n}\n", api.indexOf("async function reportSnapshot(")));
  assert.match(rs, /onServedStale:/);
  assert.match(rs, /stale/);
});

const page = read("src/pages/accounting/index.tsx");
const tab = page.slice(page.indexOf("function MonthlyPlTab("), page.indexOf("\nfunction ", page.indexOf("function MonthlyPlTab(") + 10));
const editor = read("src/pages/accounting/monthly-pl-forecast-editor.tsx");

test("Monthly P&L: Edit forecast with Forecast on opens the editor; a stale copy is asked for again", () => {
  assert.match(tab, /Edit forecast/);
  assert.match(tab, /<MonthlyPlForecastEditor/);
  assert.match(tab, /planStaleRetry\(/);
});

test("the editor keys the same sheet the Forecast P&L page saves, and refuses an unreadable amount first", () => {
  assert.match(editor, /sheetFromSaved\(/);
  assert.match(editor, /firstMoneyFieldError\(sheetMoneyFields\(/);
  assert.match(editor, /sheetPayload\(sheet\)/);
  assert.match(editor, /fetch\("\/api\/accounting\/forecast", \{\s*method: "PUT"/);
  assert.match(editor, /plForecastMatrix\(\{/, "every figure, total and % worked out the way the route does");
  assert.match(editor, /extraSpine: forecastLinesWindow\(groups, opts\)/, "every forecast line has a row to key");
  assert.match(editor, /forecastPnlWindow\(toFcMonth\(/);
  assert.match(editor, /useNavGuard\(dirty,/);
  assert.match(editor, /Add month/);
  assert.match(editor, /newSheetMonth\(/);
  assert.match(editor, /deptsPostingTo\(/);
  assert.match(editor, /invalidateCachePrefix\("\/api\/accounting\/cashflow-forecast"\)/, "the Cash Flow copy is dropped as on the Forecast P&L page");
});
