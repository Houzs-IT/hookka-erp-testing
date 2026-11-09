// Monthly P&L with the Forecast beside the Actual (owner 2026-11-09 「我的 PNL
// 我也是想要把 forecast 和 live 的对比」; spec
// docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md section 6).
// A Forecast P&L month as a P&L window, and the matrix's material types.
// Made-up figures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPnlMatrix } from "../src/lib/pnl-matrix.ts";
import { forecastPnlWindow, sumPnlWindowLikes, rmTypeOf } from "../src/lib/pnl-forecast.ts";
import { forecastLineGroups, forecastMonthFigures, forecastMaterialType } from "../src/lib/forecast-pnl.ts";

const acct = (code, name, type) => ({ code, name, type, isPostable: true });
const accounts = [
  acct("701-0010", "PURCHASE - B.M FABRIC", "COST"),
  acct("701-0020", "PURCHASE - S FABRIC", "COST"),
  acct("702-0010", "PURCHASE - PLYWOOD", "COST"),
  acct("700-1015", "CARRIAGE INWARDS", "COST"),
  acct("706-0000", "SST CHARGES", "COST"),
  acct("750-0010", "PRODUCTION - SALARIES", "COST"),
  acct("780-0010", "FACTORY RENTAL", "COST"),
  acct("900-S002", "STAFFS' SALARIES", "EXPENSE"),
  acct("900-T003", "TRANSPORT EXPENSE", "EXPENSE"),
  acct("530-0010", "OTHER INCOME", "REVENUE"),
];
const byCode = new Map(accounts.map((a) => [a.code, a]));
const depts = [{ code: "PROD", bucket: "DIRECT_LABOUR" }, { code: "R_AND_D", bucket: "OPEX_SALARIES" }, { code: "WH", bucket: "OPEX_SALARIES" }];
const groups = forecastLineGroups(accounts, {}, depts);
const mapped = new Set(["750-0010", "900-S002"]);
const opts = {
  override: {},
  mappedAccounts: mapped,
  // Measured on production 2026-11-09: every department but one posts to the
  // production salaries account; one posts to the staff salaries account.
  deptAccount: (d) => ({ PROD: "750-0010", R_AND_D: "750-0010", WH: "900-S002" })[d] ?? null,
  accountOf: (code) => byCode.get(code),
};
const month = {
  salesSen: 100_000,
  pct: {
    "cat:FABRIC": { bp: 3000 }, "cat:PLYWOOD": { amtSen: 5_000 }, "700-1015": { amtSen: 1_000 }, "706-0000": { amtSen: 500 },
    "dept:PROD": { bp: 1000 }, "dept:R_AND_D": { amtSen: 2_000 }, "dept:WH": { amtSen: 3_000 },
    "750-0010": { bp: 500 }, "780-0010": { amtSen: 4_000 }, "900-S002": { bp: 100 }, "900-T003": { amtSen: 1_500 }, "530-0010": { amtSen: 700 },
  },
};

test("forecastMaterialType: a purchase account's material type, the Forecast P&L's way", () => {
  assert.equal(forecastMaterialType("PURCHASE - B.M FABRIC"), "FABRIC");
  assert.equal(forecastMaterialType("PURCHASE - S.FILLER"), "FILLER");
  assert.equal(forecastMaterialType("PURCHASE - WD STRIP"), "WD STRIP");
  assert.equal(forecastMaterialType("PURCHASE - PLYWOOD"), "PLYWOOD");
});

test("forecastPnlWindow: each Forecast P&L line on the P&L line its money is booked to", () => {
  const w = forecastPnlWindow(month, groups, opts);
  assert.equal(w.netSalesSen, 100_000);
  assert.deepEqual(w.rmGroups.map((g) => [g.group, g.purchasesSen]), [["type:FABRIC", 30_000], ["type:PLYWOOD", 5_000]]);
  assert.equal(w.rmConsumedSen, 35_000);
  assert.deepEqual([w.carriageSen, w.sstSen], [1_000, 500]);
  assert.deepEqual(w.labourLines, [{ code: "750-0010", name: "PRODUCTION - SALARIES", amountSen: 12_000 }], "both departments that post there; the superseded 750-x cell left out");
  assert.deepEqual(w.overheadLines, [{ code: "780-0010", name: "FACTORY RENTAL", amountSen: 4_000 }]);
  assert.deepEqual(w.expenseLines, [
    { code: "900-S002", name: "STAFFS' SALARIES", amountSen: 3_000, salary: true },
    { code: "900-T003", name: "TRANSPORT EXPENSE", amountSen: 1_500, salary: false },
  ], "the department posting to staff salaries sits beside the actual staff salaries");
  assert.deepEqual(w.otherIncomeLines, [{ code: "530-0010", name: "OTHER INCOME", amountSen: 700 }]);
  assert.deepEqual([w.manufacturingSen, w.cogsSen, w.grossProfitSen, w.expenseSen, w.netProfitSen], [52_500, 52_500, 47_500, 4_500, 43_700]);
});

test("parity: Net profit equals the Forecast P&L page; Gross profit differs by what posts outside COGS", () => {
  const w = forecastPnlWindow(month, groups, opts);
  const page = forecastMonthFigures(month, groups, mapped);
  assert.equal(w.netProfitSen, page.np);
  assert.equal(w.grossProfitSen, page.gp + 3_000, "the one department booked to staff salaries");
  assert.equal(w.netSalesSen, page.salesSen);
});

test("a month with no Forecast P&L is all zero", () => {
  const w = forecastPnlWindow(undefined, groups, opts);
  assert.deepEqual([w.netSalesSen, w.cogsSen, w.netProfitSen, w.rmGroups.length, w.expenseLines.length], [0, 0, 0, 0, 0]);
});

test("sumPnlWindowLikes adds months up, lines merged by code and name", () => {
  const a = forecastPnlWindow(month, groups, opts);
  const s = sumPnlWindowLikes([a, a]);
  assert.equal(s.netProfitSen, 87_400);
  assert.deepEqual(s.labourLines, [{ code: "750-0010", name: "PRODUCTION - SALARIES", amountSen: 24_000 }]);
  assert.deepEqual(s.rmGroups.map((g) => [g.group, g.purchasesSen]), [["type:FABRIC", 60_000], ["type:PLYWOOD", 10_000]]);
});

const W = (over = {}) => ({
  netSalesSen: 0, revLines: [], rmGroups: [], rmConsumedSen: 0, carriageSen: 0, sstSen: 0,
  labourLines: [], labourSen: 0, overheadLines: [], overheadSen: 0,
  wipOpen: 0, wipClose: 0, fgOpen: 0, fgClose: 0, manufacturingSen: 0,
  cogsSen: 0, grossProfitSen: 0, otherIncomeSen: 0, otherIncomeLines: [],
  expenseLines: [], expenseSen: 0, netProfitSen: 0, ...over,
});
const rg = (group, description, purchasesSen) => ({ group, description, openingSen: 0, purchasesSen, closingSen: 0 });

test("the matrix with material types: a type row over its purchase groups carries the actual sum and the type's forecast", () => {
  const actual = W({ rmGroups: [rg("BMF", "PURCHASE - B.M FABRIC", 70), rg("SF", "PURCHASE - S FABRIC", 30), rg("PLY", "PURCHASE - PLYWOOD", 50)], rmConsumedSen: 150 });
  const fc = W({ rmGroups: [rg("type:FABRIC", "FABRIC", 120), rg("type:FILLER", "FILLER", 10)], rmConsumedSen: 130 });
  const m = buildPnlMatrix(
    [{ key: "acc", label: "Accumulated", accum: true, window: actual }, { key: "fc:acc", label: "Accumulated", accum: true, window: fc }],
    { spine: sumPnlWindowLikes([actual, fc]), rmTypeOf },
  );
  const at = (label, depth) => m.rows.find((r) => r.label === label && r.depth === depth)?.values;
  assert.deepEqual(at("RAW MATERIALS", 1), [150, 130]);
  assert.deepEqual(at("FABRIC", 2), [100, 120]);
  assert.deepEqual(at("PURCHASE - B.M FABRIC", 3), [70, 0], "a purchase group keeps its actual; the forecast sits on its type");
  assert.deepEqual(at("PLYWOOD", 2), [50, 0]);
  assert.deepEqual(at("FILLER", 2), [0, 10], "a type forecast without purchases still has its row");
  assert.ok(!m.rows.some((r) => r.label === "FILLER" && r.depth === 3), "no synthetic purchase group under it");
});

test("the matrix without options is exactly as before", () => {
  const actual = W({ rmGroups: [rg("BMF", "PURCHASE - B.M FABRIC", 70)], rmConsumedSen: 70 });
  const m = buildPnlMatrix([{ key: "acc", label: "Accumulated", accum: true, window: actual }]);
  assert.deepEqual(m.rows.filter((r) => r.depth === 2 && r.kind === "group").map((r) => r.label), ["PURCHASE - B.M FABRIC"]);
});
