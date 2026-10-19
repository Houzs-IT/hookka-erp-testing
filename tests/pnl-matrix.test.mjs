import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPnlMatrix } from "../src/lib/pnl-matrix.ts";

const W = (over = {}) => ({
  netSalesSen: 0, revLines: [], rmGroups: [], rmConsumedSen: 0, carriageSen: 0, sstSen: 0,
  labourLines: [], labourSen: 0, overheadLines: [], overheadSen: 0,
  wipOpen: 0, wipClose: 0, fgOpen: 0, fgClose: 0, manufacturingSen: 0,
  cogsSen: 0, grossProfitSen: 0, otherIncomeSen: 0, otherIncomeLines: [],
  expenseLines: [], expenseSen: 0, netProfitSen: 0, ...over,
});

test("columns echo input meta", () => {
  const m = buildPnlMatrix([
    { key: "acc", label: "Accumulated", accum: true, window: W() },
    { key: "2026-09", label: "Sep", accum: false, window: W() },
  ]);
  assert.deepEqual(m.columns, [
    { key: "acc", label: "Accumulated", accum: true },
    { key: "2026-09", label: "Sep", accum: false },
  ]);
});

test("rows align across columns; revenue line looked up by code; pct of net sales", () => {
  const acc = W({ netSalesSen: 40000, revLines: [{ code: "500-0020", name: "Sofa income", amountSen: 40000 }], grossProfitSen: 16000, netProfitSen: 8000 });
  const sep = W({ netSalesSen: 15000, revLines: [{ code: "500-0020", name: "Sofa income", amountSen: 15000 }], grossProfitSen: 6000, netProfitSen: 3000 });
  const m = buildPnlMatrix([
    { key: "acc", label: "Accumulated", accum: true, window: acc },
    { key: "2026-09", label: "Sep", accum: false, window: sep },
  ]);
  const sales = m.rows.find((r) => r.kind === "group" && r.label === "SALES");
  assert.deepEqual(sales.values, [40000, 15000]);
  assert.deepEqual(sales.pctValues, [100, 100]);
  const revLine = m.rows.find((r) => r.accountCode === "500-0020");
  assert.deepEqual(revLine.values, [40000, 15000]);
  const np = m.rows.find((r) => r.kind === "grandtotal" && r.label.startsWith("NET PROFIT"));
  assert.deepEqual(np.values, [8000, 3000]);
  assert.deepEqual(np.pctValues, [20, 20]);
  const gp = m.rows.find((r) => r.kind === "grandtotal" && r.label.startsWith("GROSS PROFIT"));
  assert.deepEqual(gp.values, [16000, 6000]);
});

test("month missing a spine line yields 0 for that column; netSales 0 -> pct 0", () => {
  const acc = W({ netSalesSen: 100, revLines: [{ code: "A", name: "a", amountSen: 60 }, { code: "B", name: "b", amountSen: 40 }] });
  const m1 = W({ netSalesSen: 0, revLines: [{ code: "A", name: "a", amountSen: 0 }] });
  const mtx = buildPnlMatrix([
    { key: "acc", label: "Acc", accum: true, window: acc },
    { key: "m1", label: "M1", accum: false, window: m1 },
  ]);
  const lineB = mtx.rows.find((r) => r.accountCode === "B");
  assert.deepEqual(lineB.values, [40, 0]);
  assert.deepEqual(lineB.pctValues, [40, 0]);
});

test("salary expense lines grouped under SALARIES & CONTRIBUTION", () => {
  const w = W({ netSalesSen: 1000, expenseSen: 300, expenseLines: [
    { code: "900-S001", name: "Wages", amountSen: 200, salary: true },
    { code: "910-0000", name: "Rent", amountSen: 100, salary: false },
  ], netProfitSen: 700 });
  const m = buildPnlMatrix([{ key: "acc", label: "Acc", accum: true, window: w }]);
  assert.ok(m.rows.some((r) => r.kind === "group" && r.label === "SALARIES & CONTRIBUTION"));
  const wages = m.rows.find((r) => r.accountCode === "900-S001");
  assert.equal(wages.depth, 2);
  const rent = m.rows.find((r) => r.accountCode === "910-0000");
  assert.equal(rent.depth, 1);
});

// Regression (2026-07-02): month columns must look up empty-coded historical
// lines by NAME — a pure-code lookup returned the FIRST ""-coded line of each
// month for every row (Monthly P&L showed wrong per-month expense splits).
test("buildPnlMatrix — empty-coded lines resolve month values by name", async () => {
  const mkW = (expenseLines) => ({
    netSalesSen: 0, revLines: [], rmGroups: [], rmConsumedSen: 0, carriageSen: 0, sstSen: 0,
    labourLines: [], labourSen: 0, overheadLines: [], overheadSen: 0,
    wipOpen: 0, wipClose: 0, fgOpen: 0, fgClose: 0, manufacturingSen: 0,
    cogsSen: 0, grossProfitSen: 0, otherIncomeSen: 0, otherIncomeLines: [],
    expenseLines, expenseSen: expenseLines.reduce((s, l) => s + l.amountSen, 0), netProfitSen: 0,
  });
  const acc = mkW([
    { code: "", name: "Bank Charges", amountSen: 5150, salary: false },
    { code: "", name: "Factory - Rental", amountSen: 2500000, salary: false },
  ]);
  const apr = mkW([
    { code: "", name: "Bank Charges", amountSen: 50, salary: false },
    { code: "", name: "Factory - Rental", amountSen: 1250000, salary: false },
  ]);
  const { rows } = buildPnlMatrix([
    { key: "acc", label: "Accumulated", accum: true, window: acc },
    { key: "2026-04", label: "Apr 2026", accum: false, window: apr },
  ]);
  const bank = rows.find((r) => r.label === "Bank Charges");
  const rent = rows.find((r) => r.label === "Factory - Rental");
  assert.deepEqual(bank.values, [5150, 50], "bank row picks the BANK line per month, not the first empty-coded line");
  assert.deepEqual(rent.values, [2500000, 1250000]);
});

test("every group carries the statement's total label (finance v2: an open group's total line)", async () => {
  const w = W({
    rmGroups: [{ group: "B.FAB", description: "B.M FABRIC", openingSen: 1, purchasesSen: 2, closingSen: 1 }],
    otherIncomeLines: [{ code: "530-0010", name: "Discount", amountSen: 5 }], otherIncomeSen: 5,
    expenseLines: [{ code: "900-S001", name: "Salary", amountSen: 9, salary: true }], expenseSen: 9,
  });
  const m = buildPnlMatrix([{ key: "2026-09", label: "Sep", accum: false, window: w }]);
  const labels = Object.fromEntries(m.rows.filter((r) => r.kind === "group").map((r) => [r.label, r.totalLabel]));
  assert.deepEqual(labels, {
    "SALES": "NET SALES",
    "COST OF GOODS SOLD": "TOTAL COST OF GOODS SOLD",
    "RAW MATERIALS": "TOTAL RAW MATERIALS",
    "B.M FABRIC": "TOTAL B.M FABRIC",
    "DIRECT LABOUR": "TOTAL DIRECT LABOUR",
    "FACTORY OVERHEAD": "TOTAL FACTORY OVERHEAD",
    "WORK IN PROGRESS": "WIP MOVEMENT (net)",
    "OTHER INCOME": "TOTAL OTHER INCOME",
    "OPERATING EXPENSES": "TOTAL EXPENSES",
    "SALARIES & CONTRIBUTION": "TOTAL SALARIES & CONTRIBUTION",
  });
  // Same words as the statement's own builder.
  const api = (await import("node:fs")).readFileSync("src/api/routes/accounting.ts", "utf8");
  for (const l of ["NET SALES", "TOTAL COST OF GOODS SOLD", "TOTAL RAW MATERIALS", "TOTAL DIRECT LABOUR", "TOTAL FACTORY OVERHEAD", "WIP MOVEMENT (net)", "TOTAL OTHER INCOME", "TOTAL EXPENSES", "TOTAL SALARIES & CONTRIBUTION"]) {
    assert.ok(api.includes(`"${l}"`), l);
  }
});
