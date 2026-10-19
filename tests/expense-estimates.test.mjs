// ---------------------------------------------------------------------------
// expense-estimates.test.mjs — the running month's recurring costs with
// nothing recorded yet, shown at last month's amount (owner 2026-10-13: last
// month's amount, three months in a row, factory overhead too, a different
// font colour and row background →「做」). Display only — nothing is posted.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const m = await import(pathToFileURL(resolve(process.cwd(), "src/lib/expense-estimates.ts")).href);
const mx = await import(pathToFileURL(resolve(process.cwd(), "src/lib/pnl-matrix.ts")).href);

const BUCKET = {
  "900-S002": "OPEX_SALARIES",
  "900-W001": "OPERATING_EXPENSE",
  "900-M002": "OPERATING_EXPENSE",
  "900-0025": "OPERATING_EXPENSE",
  "780-0010": "FACTORY_OVERHEAD",
  "750-0010": "DIRECT_LABOUR",
  "701-0010": "RAW_MATERIALS",
  "500-0000": "REVENUE",
};
const bucketOf = (code) => BUCKET[code] ?? null;
const map = (o) => new Map(Object.entries(o));

test("previous months and windows: most recent first across a year end; open ends cover", () => {
  assert.deepEqual(m.previousMonths("2026-10", 3), ["2026-09", "2026-08", "2026-07"]);
  assert.deepEqual(m.previousMonths("2027-02", 3), ["2027-01", "2026-12", "2026-11"]);
  assert.equal(m.windowCoversYm("2026-10", "2026-10", "2026-10"), true);
  assert.equal(m.windowCoversYm("2026-09", "2026-10", "2026-10"), true);
  assert.equal(m.windowCoversYm("2026-09", "2026-09", "2026-10"), false);
  assert.equal(m.windowCoversYm(null, null, "2026-10"), true);
});

test("a cost in each of the last three months with nothing yet this month shows at last month's amount", () => {
  const est = m.recurringEstimates({
    current: map({ "900-0025": 5000000 }),
    previous: [
      map({ "900-S002": 4034248, "900-W001": 750805, "780-0010": 1250000, "900-M002": 285000, "750-0010": 7000000, "701-0010": 900000, "500-0000": -9000000, "900-0025": 1131605 }),
      map({ "900-S002": 3868392, "900-W001": 388669, "780-0010": 1250000, "900-M002": 50000, "750-0010": 7000000, "701-0010": 900000, "500-0000": -9000000, "900-0025": 1131605 }),
      map({ "900-S002": 3336339, "900-W001": 332460, "780-0010": 1250000, "750-0010": 7000000, "701-0010": 900000, "500-0000": -9000000, "900-0025": 1131605 }),
    ],
    bucketOf,
  });
  assert.deepEqual(Object.fromEntries(est), { "900-S002": 4034248, "900-W001": 750805, "780-0010": 1250000 });
  // MARKETING missed a month; DIRECTOR REMUNERATION already has this month's
  // figure; labour, purchases and sales are never estimated.
});

test("anything recorded this month wins; a reversed-out month counts as nothing; a refund month is not 'every month'", () => {
  const prev = [map({ "900-W001": 700000 }), map({ "900-W001": 600000 }), map({ "900-W001": 500000 })];
  assert.equal(m.recurringEstimates({ current: map({ "900-W001": 100 }), previous: prev, bucketOf }).size, 0, "a partial bill replaces the estimate");
  assert.equal(m.recurringEstimates({ current: map({ "900-W001": 0 }), previous: prev, bucketOf }).get("900-W001"), 700000, "posted then reversed = nothing yet");
  const refund = [map({ "900-W001": 700000 }), map({ "900-W001": -5000 }), map({ "900-W001": 500000 })];
  assert.equal(m.recurringEstimates({ current: new Map(), previous: refund, bucketOf }).size, 0);
  assert.equal(m.recurringEstimates({ current: new Map(), previous: prev.slice(0, 2), bucketOf }).size, 0, "needs three months of history");
});

test("Monthly P&L: the matrix marks the columns whose figure is (partly) an estimate", () => {
  const w = (expense, est) => ({
    netSalesSen: 1000000, revLines: [], rmGroups: [], rmConsumedSen: 0, carriageSen: 0, sstSen: 0, labourLines: [], labourSen: 0,
    overheadLines: [], overheadSen: 0, wipOpen: 0, wipClose: 0, fgOpen: 0, fgClose: 0, manufacturingSen: 0, cogsSen: 0,
    grossProfitSen: 1000000, otherIncomeSen: 0, otherIncomeLines: [],
    expenseLines: [{ code: "900-W001", name: "WATER & ELECTRICITY", amountSen: expense, salary: false, ...(est ? { estSen: est, estFrom: "2026-09" } : {}) }],
    expenseSen: expense, netProfitSen: 1000000 - expense,
  });
  const out = mx.buildPnlMatrix([
    { key: "acc", label: "Accumulated", accum: true, window: w(1500000, 750805) },
    { key: "2026-09", label: "Sep'26", accum: false, window: w(750000, 0) },
    { key: "2026-10", label: "Oct'26", accum: false, window: w(750805, 750805) },
  ]);
  const row = out.rows.find((r) => r.accountCode === "900-W001");
  assert.deepEqual(row.estValues, [750805, 0, 750805]);
  assert.equal(row.estFrom, "2026-09");
  assert.equal(out.rows.find((r) => r.label === "OPERATING EXPENSES").estValues, undefined, "group rows are left alone");
});

const API = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");
const UI = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const DASH = readFileSync("src/pages/finance-dashboard.tsx", "utf8").replace(/\r\n/g, "\n");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); return src.slice(a, b === -1 ? undefined : b); };

test("the estimates read the same one-month ledger windows the statement shows, before any estimate", () => {
  const fn = slice(API, "async function runningMonthEstimates(", "\nasync function computePnlWindow(");
  assert.match(fn, /const prevYms = previousMonths\(runYm, ESTIMATE_LOOKBACK\);/);
  assert.match(fn, /\[runYm, \.\.\.prevYms\]\.map\(\(ym\) => glWindowSigned\(db, orgId, ym, ym, dc\)\)/);
  assert.match(fn, /recurringEstimates\(\{ current: cur\.net, previous: prev\.map\(\(w\) => w\.net\), bucketOf \}\)/);
  assert.match(fn, /dc\.estimateMemo\.set\(runYm, hit\);/, "once per request");
});

test("only a window that reaches the running month carries them, added to a copy of the shared window", () => {
  const fn = slice(API, "async function computePnlWindow(", "\n// Window form of costByLine");
  assert.match(fn, /const est = windowCoversYm\(startYm, endYm, runningMonthYm\(\)\)\n\s*\? await runningMonthEstimates\(db, orgId, dc\)/);
  assert.match(fn, /const gl = est\.size \? \{ \.\.\.glLedger, net: new Map\(glLedger\.net\) \} : glLedger;/, "the memoised window is never mutated");
  assert.match(fn, /overheadLines\.push\(\{ code, name: meta\.name, amountSen: Math\.round\(v \* \(isAll \? 1 : R\)\), \.\.\.estPart\(code\) \}\);/);
  assert.match(fn, /salary: bucket === "OPEX_SALARIES", \.\.\.estPart\(code\) \}\);/);
  const rows = slice(API, "function buildPnlRows(", "\n}\n");
  assert.match(rows, /markEst\(p\.overheadLines\[i\]\);/);
  assert.equal((rows.match(/markEst\(l\);/g) ?? []).length, 2, "salary and other expense lines");
});

test("the drill lists the estimate as its own row, so it still adds up to the line", () => {
  const ep = slice(API, 'app.get("/pl-drill"', 'app.get("/pl-monthly"');
  assert.match(ep, /trace\.extra\.push\(\{ kind: "estimate", ym: runYm, sen: e\.sen, fromYm: e\.fromYm \}\);\n\s*netSen \+= e\.sen;/);
  assert.match(ep, /tied: debitSen - creditSen === netSen,/);
});

test("the dashboard says how much of a period is estimate", () => {
  assert.match(API, /estimated: \[\.\.\.w\.overheadLines, \.\.\.w\.expenseLines\]\.reduce\(\(sum, l\) => sum \+ \(\(l as \{ estSen\?: number \}\)\.estSen \?\? 0\), 0\),/);
  assert.match(API, /const DASH_PAYLOAD_V = "v(19|[2-9]\d)";/);
  assert.match(DASH, /incl\. estimates/);
});

test("the pages colour an estimate: amber text on a pale amber row, an est. tag and the month it came from", () => {
  // Finance v2: the amber is the finance sheet's (a row, or one month's cell).
  const sheet = readFileSync("src/styles/finance-v2.css", "utf8").replace(/\r\n/g, "\n");
  assert.match(sheet, /> tbody > tr > td\[data-cell~="est"\],\n\[data-fin-ui\] table\[data-fin-report\] > tbody > tr\[data-est\] > td \{\n  background-color: #FAEFCB;\n  color: #9C6F1E;/);
  const st = slice(UI, "function PLStatementTab(", "\nfunction ");
  // Finance v2: the statement's row is marked data-est and the finance sheet
  // paints it (pale amber, amber text) — a Tailwind class on the row would sit
  // under the cells' white.
  assert.match(st, /<tr data-row="line" data-est=\{row\.estSen \? "" : undefined\}/);
  assert.match(st, /\{row\.estSen \? <span className="ml-1\.5 text-\[10px\] font-semibold">· est\.<\/span> : null\}/);
  const css = readFileSync("src/styles/finance-v2.css", "utf8").replace(/\r\n/g, "\n");
  assert.match(css, /> tbody > tr\[data-est\] > td \{\n  background-color: #FAEFCB;\n  color: #9C6F1E;/);
  assert.match(st, /title=\{row\.estSen \? estTitle\(row\.estFrom\) : undefined\}/);
  assert.match(st, /Amber rows are estimates/);
  const mo = slice(UI, "function MonthlyPlTab(", "\nfunction ");
  assert.match(mo, /const est = \(r\.estValues\?\.\[j\] \?\? 0\) !== 0;/);
  assert.match(mo, /Amber cells are estimates/);
  assert.match(UI, /e\.kind === "estimate" \? estTitle\(e\.fromYm\)/, "the monthly drill names it");
});
