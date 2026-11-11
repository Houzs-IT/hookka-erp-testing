// Forecast Balance Sheet (owner 2026-11-11 「既然我有forecast Cash Flow 和
// Forecast P&L？是不是可以做forecast balance sheet?」 → proposal, start point
// 「可以」 = last month-end's actual sheet). Each forecast month moves the
// sheet by double entries: what the Forecast P&L earns and spends, and when
// the money comes and goes by the Cash Flow forecast's own timing.
// After seeing it (2026-11-11): the months stop at the Forecast P&L's last
// month (「可以」); customers' invoices are collected up to the trade debtors
// on the start's sheet (「就是这个…我不想要显示」, the debtors left below zero); the forecast columns
// follow the financial year picked (「根据fye 显示forecast 的数据可以吗？」).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FC_AR, FC_CASH, FC_DEPN, FC_PROFIT,
  capOpeningReceipts, forecastBsDeltas, forecastBsEntries, forecastBsMonths, forecastBsSheets, fyForecastMonths, openingReceiptsByYm,
} from "../src/lib/forecast-bs.ts";
import { forecastMonthHasFigures } from "../src/lib/forecast-pnl.ts";
import { buildBsMatrix } from "../src/lib/bs-monthly.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
// Debtors move on their own forecast line (the actual debtors sit on one account per customer);
// the P&L forecast's receipts are on the debtor control, its salaries on their own accounts.
const ACC = { ar: FC_AR, receipt: "300-0000", ap: "400-0000", salary: "410-0010" };
const SALARY_LEG_ACCOUNTS = ["410-0010", "900-S001"];
const leg = (ym, sen, extra) => ({ col: `fp:${ym}`, sen, item: { kind: "pnl", party: "", ref: "", expectedYm: ym, note: "" }, ...extra });
const doc = (kind, accountCode, sen, expectedYm) => ({ kind, partyId: "p", partyName: "P", no: "n", date: "2026-10-01", sen, accountCode, expectedYm, dueSen: sen, termFlagged: false });
const sumOf = (m) => Object.values(m).reduce((s, v) => s + v, 0);
const entry = (accountCode, category, balance) => ({ accountCode, accountName: `${accountCode} name`, category, balance });

const BASE = {
  months: ["2026-11", "2026-12"],
  openingDocs: [],
  pnlLegs: [],
  accruals: {},
  accounts: ACC,
  openingSalaryPayableSen: 0,
  inputs: {},
  salaryLegAccounts: SALARY_LEG_ACCOUNTS,
};

test("every forecast month is double entry: the movements add up to zero", () => {
  const d = forecastBsDeltas({
    ...BASE,
    openingDocs: [doc("invoice", ACC.receipt, 50_000, "2026-10"), doc("pi", ACC.ap, 20_000, "2026-12"), doc("tf", "460-0000", 7_000, "2026-11")],
    pnlLegs: [
      leg("2026-12", 80_000, { accountCode: ACC.receipt }),
      leg("2026-12", -30_000, { section: "RAW_MATERIALS" }),
      leg("2026-12", -9_000, { accountCode: "900-S001" }),
      leg("2026-11", -4_000, { accountCode: "900-0001" }),
      leg("2026-11", 1_000, { accountCode: "800-0001" }),
    ],
    accruals: {
      "2026-11": { salesSen: 80_000, materialsSen: 30_000, salariesSen: 9_000, nonCashSen: 500 },
      "2026-12": { salesSen: 60_000, materialsSen: 25_000, salariesSen: 9_000, nonCashSen: 500 },
    },
    openingSalaryPayableSen: 8_000,
    inputs: { "2026-12": { "150-0000": -12_000 } },
  });
  for (const ym of ["2026-11", "2026-12"]) assert.equal(sumOf(d[ym]), 0, ym);
});

test("a bill past its term at the start is paid in the first month; one beyond the months stays open", () => {
  const d = forecastBsDeltas({
    ...BASE,
    openingDocs: [doc("pi", ACC.ap, 50_000, "2026-09"), doc("pi", ACC.ap, 7_000, "2027-03"), doc("pi", ACC.ap, 20_000, "2026-12")],
  });
  assert.equal(d["2026-11"][ACC.ap], 50_000, "paying a creditor debits it");
  assert.equal(d["2026-11"][FC_CASH], -50_000);
  assert.equal(d["2026-12"][ACC.ap], 20_000);
  assert.ok(!JSON.stringify(d).includes("7000"), "the March bill is not paid inside the months shown");
});

test("customers' open invoices at the start are kept apart from the movements: their money by month, past-term ones in the first month", () => {
  const docs = [
    doc("invoice", ACC.receipt, 50_000, "2026-09"),
    doc("invoice", ACC.receipt, 4_000, "2026-11"),
    doc("invoice", ACC.receipt, 3_000, "2026-12"),
    doc("invoice", ACC.receipt, 7_000, "2027-03"),
    doc("invoice", ACC.receipt, 0, "2026-12"),
    doc("pi", ACC.ap, 20_000, "2026-12"),
  ];
  assert.deepEqual(openingReceiptsByYm(docs, "2026-11"), { "2026-11": 54_000, "2026-12": 3_000, "2027-03": 7_000 });
  const d = forecastBsDeltas({ ...BASE, openingDocs: docs });
  assert.equal(d["2026-11"][FC_AR], undefined, "collected on the page, up to the books' debtors");
  assert.equal(d["2026-12"][FC_AR], undefined);
  assert.equal(d["2026-12"][ACC.ap], 20_000);
});

test("customers' invoices are collected up to the trade debtors in the books: the earliest money is left out first", () => {
  const by = { "2026-11": 50_000, "2026-12": 30_000, "2027-01": 20_000 };
  assert.deepEqual(capOpeningReceipts(by, 100_000), by, "the books hold them all");
  assert.deepEqual(capOpeningReceipts(by, 120_000), by, "the books hold more: nothing extra is collected");
  assert.deepEqual(capOpeningReceipts(by, 70_000), { "2026-11": 20_000, "2026-12": 30_000, "2027-01": 20_000 });
  assert.deepEqual(capOpeningReceipts(by, 40_000), { "2026-12": 20_000, "2027-01": 20_000 });
  assert.deepEqual(capOpeningReceipts(by, 0), {});
  assert.deepEqual(capOpeningReceipts(by, -5_000), {}, "debtors in credit: nothing to collect");
});

test("a forecast month's sheet rolls forward from the start: the salaries owed then paid in the first month, customers' invoices collected only up to the trade debtors", () => {
  const opening = [
    entry("300-0000", "CURRENT_ASSET", 70_000),
    entry("310-0010", "CURRENT_ASSET", 10_000),
    entry("410-0010", "CURRENT_LIABILITY", 8_000),
    entry("NP-CURRENT", "EQUITY", 72_000),
  ];
  const fc = {
    startYm: "2026-10",
    months: ["2026-11", "2026-12"],
    deltas: { "2026-11": { [FC_CASH]: -1_000, "900-0001": 0, [FC_PROFIT]: 1_000 }, "2026-12": {} },
    accounts: {},
    salaryAccount: "410-0010",
    arAccounts: ["300-0000"],
    // 100,000 on the documents, 70,000 in the books: the oldest 30,000 is not money to come.
    openingReceipts: { "2026-11": 50_000, "2026-12": 30_000, "2027-01": 20_000 },
  };
  const sheets = forecastBsSheets(fc, opening);
  assert.deepEqual(Object.keys(sheets), ["2026-11", "2026-12"]);
  const bal = (ym) => Object.fromEntries(sheets[ym].map((x) => [x.accountCode, x.balance]));
  assert.equal(bal("2026-11")[FC_AR], -20_000);
  assert.equal(bal("2026-11")[FC_CASH], 20_000 - 8_000 - 1_000);
  assert.equal(bal("2026-11")["410-0010"], 0, "the salaries owed at the start are paid");
  assert.equal(bal("2026-11")[FC_PROFIT], -1_000);
  assert.equal(bal("2026-12")[FC_AR], -50_000);
  assert.equal(bal("2026-12")["300-0000"] + bal("2026-12")[FC_AR], 20_000, "what is left is January's, never below zero");
  const m = buildBsMatrix(["2026-11", "2026-12"], sheets);
  assert.deepEqual(m.diff, [0, 0], "every forecast month balances");
});

test("the forecast runs from this month to the last month the Forecast P&L has figures for", () => {
  const cols = ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-02"];
  assert.deepEqual(forecastBsMonths(cols, "2026-11", "2027-01"), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(forecastBsMonths(cols, "2026-11", null), [], "no figures ahead: no forecast");
  assert.deepEqual(forecastBsMonths(cols, "2026-11", "2026-10"), [], "figures only behind this month");
  assert.equal(forecastMonthHasFigures({ salesSen: 0, cogs: 0, oi: 0, exp: 0 }), false);
  assert.equal(forecastMonthHasFigures({ salesSen: 0, cogs: 0, oi: 0, exp: 1_500 }), true, "a cost keyed in RM counts");
  assert.equal(forecastMonthHasFigures({ salesSen: 9_000, cogs: 0, oi: 0, exp: 0 }), true);
});

test("the forecast columns follow the financial year picked: its months only, to its year end, newest first", () => {
  const fcMonths = ["2026-11", "2026-12", "2027-07", "2027-08", "2027-09", "2027-10"];
  assert.deepEqual(fyForecastMonths({ startYm: "2026-09", endYm: "2027-08" }, fcMonths), ["2027-08", "2027-07", "2026-12", "2026-11"]);
  assert.deepEqual(fyForecastMonths({ startYm: "2027-09", endYm: "2028-08" }, fcMonths), ["2027-10", "2027-09"]);
  assert.deepEqual(fyForecastMonths({ startYm: "2025-09", endYm: "2026-08" }, fcMonths), []);
});

test("a forecast month's sheet: the start's sheet plus the movements so far, each in its section's sign", () => {
  const opening = [
    { accountCode: "300-0000", accountName: "Trade debtors", category: "CURRENT_ASSET", balance: 100_000 },
    { accountCode: "400-0000", accountName: "Trade creditors", category: "CURRENT_LIABILITY", balance: 40_000 },
    { accountCode: "NP-CURRENT", accountName: "Current Year Earnings (unclosed)", category: "EQUITY", balance: 60_000 },
  ];
  const cum = { "300-0000": 30_000, "400-0000": -10_000, [FC_CASH]: 5_000, [FC_PROFIT]: -25_000, "460-0000": 3_000 };
  const out = forecastBsEntries(opening, cum, { "460-0000": { name: "Trade finance", section: "CURRENT_LIABILITY" } });
  const by = Object.fromEntries(out.map((e) => [e.accountCode, e]));
  assert.equal(by["300-0000"].balance, 130_000);
  assert.equal(by["400-0000"].balance, 50_000, "a credit raises a liability");
  assert.equal(by[FC_CASH].balance, 5_000);
  assert.equal(by[FC_CASH].category, "CURRENT_ASSET");
  assert.equal(by[FC_PROFIT].balance, 25_000);
  assert.equal(by[FC_PROFIT].category, "EQUITY");
  assert.equal(by["460-0000"].balance, -3_000, "an account new to the sheet takes its section from the route");
  assert.equal(FC_DEPN, "FC-DEPN");
});

test("the Forecast P&L earns and spends in its own month, whenever the money moves", () => {
  const d = forecastBsDeltas({
    ...BASE,
    pnlLegs: [leg("2026-12", 80_000, { accountCode: ACC.receipt }), leg("2026-11", -4_000, { accountCode: "900-0001" }), leg("2026-12", -9_000, { accountCode: "900-S001" })],
    accruals: { "2026-11": { salesSen: 80_000, materialsSen: 30_000, salariesSen: 9_000, nonCashSen: 500 } },
  });
  // Sales on account, materials owed, salaries owed, depreciation, an expense paid in the month.
  assert.equal(d["2026-11"][FC_AR], 80_000);
  assert.equal(d["2026-11"][ACC.ap], -30_000);
  assert.equal(d["2026-11"][ACC.salary], -9_000);
  assert.equal(d["2026-11"][FC_DEPN], -500);
  // Profit (credit) = 80,000 − 30,000 − 9,000 − 500 − 4,000.
  assert.equal(d["2026-11"][FC_PROFIT], -(80_000 - 30_000 - 9_000 - 500 - 4_000));
  // The sales money arrives in December.
  assert.equal(d["2026-12"][FC_AR], -80_000);
  // December: the sales money in, November's salaries paid (once — the salary leg itself is not counted again).
  assert.equal(d["2026-12"][FC_CASH], 80_000 - 9_000);
  assert.equal(d["2026-12"][ACC.salary], 9_000);
});

test("the salaries owed at the start are paid in the first month; keyed capex and loans move cash and their account", () => {
  const d = forecastBsDeltas({ ...BASE, openingSalaryPayableSen: 8_000, inputs: { "2026-12": { "150-0000": -12_000, "480-0000": 20_000 } } });
  assert.equal(d["2026-11"][ACC.salary], 8_000);
  assert.equal(d["2026-11"][FC_CASH], -8_000);
  assert.equal(d["2026-12"]["150-0000"], 12_000, "capex: the asset goes up");
  assert.equal(d["2026-12"]["480-0000"], -20_000, "a loan drawn: the liability goes up");
  assert.equal(d["2026-12"][FC_CASH], 8_000);
});

test("the route and the Monthly Balance Sheet's Forecast switch", () => {
  const route = read("src/api/routes/accounting.ts");
  assert.match(route, /app\.get\("\/bs-forecast"/);
  assert.match(route, /forecastBsDeltas\(/);
  // The months stop at the Forecast P&L's last month with figures.
  assert.match(route, /forecastBsMonths\(/);
  assert.match(route, /forecastMonthHasFigures\(/);
  // Customers' invoices go to the page, which collects them up to the books' debtors.
  assert.match(route, /openingReceipts: openingReceiptsByYm\(/);
  assert.match(route, /arAccounts/);
  const mb = read("src/pages/accounting/monthly-balance-sheet.tsx");
  assert.match(mb, /\/api\/accounting\/bs-forecast/);
  assert.match(mb, /forecastBsSheets\(/);
  // Columns by the year picked; this year and the years ahead can forecast.
  assert.match(mb, /fyForecastMonths\(/);
  assert.match(mb, /fy\.endYm >= curYm/);
});
