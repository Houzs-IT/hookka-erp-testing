// Forecast Balance Sheet (owner 2026-11-11 「既然我有forecast Cash Flow 和
// Forecast P&L？是不是可以做forecast balance sheet?」 → proposal, start point
// 「可以」 = last month-end's actual sheet). Each forecast month moves the
// sheet by double entries: what the Forecast P&L earns and spends, and when
// the money comes and goes by the Cash Flow forecast's own timing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FC_AR, FC_CASH, FC_DEPN, FC_PROFIT, forecastBsDeltas, forecastBsEntries } from "../src/lib/forecast-bs.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
// Debtors move on their own forecast line (the actual debtors sit on one account per customer);
// the P&L forecast's receipts are on the debtor control, its salaries on their own accounts.
const ACC = { ar: FC_AR, receipt: "300-0000", ap: "400-0000", salary: "410-0010" };
const SALARY_LEG_ACCOUNTS = ["410-0010", "900-S001"];
const leg = (ym, sen, extra) => ({ col: `fp:${ym}`, sen, item: { kind: "pnl", party: "", ref: "", expectedYm: ym, note: "" }, ...extra });
const doc = (kind, accountCode, sen, expectedYm) => ({ kind, partyId: "p", partyName: "P", no: "n", date: "2026-10-01", sen, accountCode, expectedYm, dueSen: sen, termFlagged: false });
const sumOf = (m) => Object.values(m).reduce((s, v) => s + v, 0);

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

test("a document past its term at the start is settled in the first month; one beyond the months stays open", () => {
  const d = forecastBsDeltas({
    ...BASE,
    openingDocs: [doc("invoice", ACC.receipt, 50_000, "2026-09"), doc("invoice", ACC.receipt, 7_000, "2027-03"), doc("pi", ACC.ap, 20_000, "2026-12")],
  });
  assert.equal(d["2026-11"][FC_AR], -50_000, "an opening invoice collected moves the debtors' forecast line");
  assert.equal(d["2026-11"][FC_CASH], 50_000);
  assert.equal(d["2026-12"][ACC.ap], 20_000, "paying a creditor debits it");
  assert.equal(d["2026-12"][FC_CASH], -20_000);
  assert.equal(sumOf(d["2026-11"]) + sumOf(d["2026-12"]), 0);
  assert.ok(!JSON.stringify(d).includes("7000"), "the March invoice is not collected inside the months shown");
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
});

test("the route and the Monthly Balance Sheet's Forecast switch", () => {
  const route = read("src/api/routes/accounting.ts");
  assert.match(route, /app\.get\("\/bs-forecast"/);
  assert.match(route, /forecastBsDeltas\(/);
  const mb = read("src/pages/accounting/monthly-balance-sheet.tsx");
  assert.match(mb, /\/api\/accounting\/bs-forecast/);
  assert.match(mb, /forecastBsEntries\(/);
});
