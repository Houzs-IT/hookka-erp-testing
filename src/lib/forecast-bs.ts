// ---------------------------------------------------------------------------
// Forecast Balance Sheet (owner 2026-11-11 「既然我有forecast Cash Flow 和
// Forecast P&L？是不是可以做forecast balance sheet?」 → proposal given; start
// point 「可以」: last month-end's actual sheet). Pure; tests:
// tests/forecast-bs.test.mjs.
//
// From the last month-end's actual sheet, each forecast month moves it by
// double entries (debit-positive sen per account, adding up to zero):
//   - the Forecast P&L month earns and spends: sales on account (debtors),
//     materials owed (creditors), salaries owed (the salary accrual, paid the
//     month after), depreciation and the like (fixed assets), every other cost
//     and other income straight against cash in its month;
//   - the money moves when the Cash Flow forecast says it does: the documents
//     open at the 1st of the first month by their parties' terms (one past its
//     term in the first month), the Forecast P&L's own money by the P&L
//     forecast's legs (buildPnlForecastLegs, fed only the months from the first
//     forecast month on — the actual documents stand for the months before);
//   - the salaries owed at the start are paid in the first month;
//   - capex and financing keyed on the Cash Flow page move cash and their account.
// The profit, the cash and the depreciation land on three lines of their own
// (FC_PROFIT in Equity, FC_CASH in Current Assets, FC_DEPN in Fixed Assets);
// stock and every other balance stay as at the start.
// ---------------------------------------------------------------------------
import type { ForecastLeg } from "./cashflow-engine";
import type { ScheduledDoc } from "./cashflow-forecast";
import type { BsMonthEntry } from "./bs-monthly";

export const FC_CASH = "FC-CASH";
export const FC_AR = "FC-AR";
export const FC_PROFIT = "FC-PROFIT";
export const FC_DEPN = "FC-DEPN";

/** The three forecast lines' names and sections on the sheet. */
export const FORECAST_BS_LINES: Record<string, { name: string; section: string }> = {
  [FC_CASH]: { name: "Forecast cash in / out (since the start)", section: "CURRENT_ASSET" },
  [FC_AR]: { name: "Trade debtors — forecast movement (since the start)", section: "CURRENT_ASSET" },
  [FC_PROFIT]: { name: "Forecast profit (since the start)", section: "EQUITY" },
  [FC_DEPN]: { name: "Forecast depreciation (since the start)", section: "FIXED_ASSET" },
};

/** One Forecast P&L month's amounts that sit on the sheet before money moves. */
export type ForecastBsAccrual = { salesSen: number; materialsSen: number; salariesSen: number; nonCashSen: number };

export type ForecastBsInput = {
  /** The forecast months, oldest first; the first is the current month. */
  months: readonly string[];
  /** The documents open at the 1st of the first month, scheduled by terms. */
  openingDocs: readonly ScheduledDoc[];
  /** The P&L forecast's legs (column "fp:YYYY-MM"), from Forecast P&L months
   *  in `months` only; sen + money in, − money out. */
  pnlLegs: readonly ForecastLeg[];
  /** Per forecast month: the Forecast P&L's sales, materials, salaries and
   *  non-cash costs. */
  accruals: Readonly<Record<string, ForecastBsAccrual | undefined>>;
  /** Where debtors move on the sheet (FC_AR: the actual debtors sit on one
   *  account per customer), the account the P&L forecast's receipts carry
   *  (default `ar`), the creditor control, the salary accrual. */
  accounts: { ar: string; receipt?: string; ap: string; salary: string };
  /** The accounts the P&L forecast's salary legs carry (paid the month after):
   *  their timing is posted here from the accruals, so those legs are skipped. */
  salaryLegAccounts?: readonly string[];
  /** The salary accrual's credit balance at the start (owed, paid in the first month). */
  openingSalaryPayableSen: number;
  /** Keyed capex & financing: month → account → sen (+ money in, − money out). */
  inputs: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

/** Month → account → debit-positive sen. Every month adds up to zero. */
export type ForecastBsDeltas = Record<string, Record<string, number>>;

export function forecastBsDeltas(input: ForecastBsInput): ForecastBsDeltas {
  const { months, accounts } = input;
  const inMonths = new Set(months);
  const out: ForecastBsDeltas = Object.fromEntries(months.map((ym) => [ym, {} as Record<string, number>]));
  // A debit to one account and the same credit to another.
  const post = (ym: string, debit: string, credit: string, sen: number) => {
    if (!sen || !inMonths.has(ym)) return;
    const m = out[ym];
    m[debit] = (m[debit] ?? 0) + sen;
    m[credit] = (m[credit] ?? 0) - sen;
  };
  const first = months[0];

  // The documents open at the start, when their money moves.
  for (const d of input.openingDocs) {
    if (!d.dueSen || !d.expectedYm) continue;
    const ym = d.expectedYm < first ? first : d.expectedYm;
    if (d.kind === "invoice") post(ym, FC_CASH, accounts.ar, d.dueSen); // money in from a customer
    else if (d.kind === "odb") post(ym, FC_CASH, d.accountCode, d.dueSen); // money in from an other debtor
    else post(ym, d.accountCode, FC_CASH, d.dueSen); // a bill or a draw paid
  }

  // The salaries owed at the start, paid in the first month.
  if (input.openingSalaryPayableSen > 0) post(first, accounts.salary, FC_CASH, input.openingSalaryPayableSen);

  // The Forecast P&L month: what it earns and spends, before the money moves.
  for (const ym of months) {
    const a = input.accruals[ym];
    if (!a) continue;
    post(ym, accounts.ar, FC_PROFIT, a.salesSen);
    post(ym, FC_PROFIT, accounts.ap, a.materialsSen);
    post(ym, FC_PROFIT, accounts.salary, a.salariesSen);
    // Paid the month after (the P&L forecast's own rule), when that month is shown.
    const next = months[months.indexOf(ym) + 1];
    if (next) post(next, accounts.salary, FC_CASH, a.salariesSen);
    post(ym, FC_PROFIT, FC_DEPN, a.nonCashSen);
  }

  // Its money, by the P&L forecast's timing.
  const salaryLegs = new Set(input.salaryLegAccounts ?? [accounts.salary]);
  const receipt = accounts.receipt ?? accounts.ar;
  for (const l of input.pnlLegs) {
    if (!l.col.startsWith("fp:") || !l.sen) continue;
    if (l.accountCode && salaryLegs.has(l.accountCode)) continue; // posted from the accruals above
    const ym = l.col.slice(3);
    // Which account the money settles: debtors, creditors, the salary
    // accrual — or, for a cost or other income paid in its month, the profit.
    const against = l.accountCode === receipt ? accounts.ar
      : l.section === "RAW_MATERIALS" ? accounts.ap
      : FC_PROFIT;
    if (l.sen > 0) post(ym, FC_CASH, against, l.sen);
    else post(ym, against, FC_CASH, -l.sen);
  }

  // Capex and financing keyed on the Cash Flow page.
  for (const ym of months) {
    for (const [code, sen] of Object.entries(input.inputs[ym] ?? {})) {
      if (sen > 0) post(ym, FC_CASH, code, sen);
      else post(ym, code, FC_CASH, -sen);
    }
  }

  // Accounts a month nets to zero on drop out.
  for (const ym of months) for (const [code, sen] of Object.entries(out[ym])) if (!sen) delete out[ym][code];
  return out;
}

/** A forecast month's sheet: the start's entries with the movements so far
 *  (debit-positive) added in each section's sign — an asset up by a debit,
 *  a liability or equity up by a credit. An account new to the sheet takes
 *  its name and section from `accounts`; the three forecast lines from
 *  FORECAST_BS_LINES. */
export function forecastBsEntries(
  opening: readonly BsMonthEntry[],
  cumulative: Readonly<Record<string, number>>,
  accounts: Readonly<Record<string, { name: string; section: string } | undefined>>,
): BsMonthEntry[] {
  const isAsset = (section: string) => section === "FIXED_ASSET" || section === "CURRENT_ASSET";
  const out = opening.map((e) => ({ ...e }));
  const byCode = new Map(out.map((e) => [e.accountCode, e] as const));
  for (const [code, debit] of Object.entries(cumulative)) {
    if (!debit) continue;
    let e = byCode.get(code);
    if (!e) {
      const meta = FORECAST_BS_LINES[code] ?? accounts[code];
      if (!meta) continue;
      e = { accountCode: code, accountName: meta.name, category: meta.section, balance: 0 };
      out.push(e);
      byCode.set(code, e);
    }
    e.balance += isAsset(e.category) ? debit : -debit;
  }
  return out;
}
