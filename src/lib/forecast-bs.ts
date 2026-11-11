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
//
// After seeing it (owner 2026-11-11):
//   - 「可以」: the months stop at the last month the Forecast P&L has figures
//     for — after it a column would only collect and pay (forecastBsMonths);
//   - 「就是这个…我不想要显示」 (the debtors left below zero): customers' open invoices are collected only up
//     to the trade debtors on the start's sheet — the books owed less than the
//     documents (receipts not knocked off yet), so the earliest money beyond the
//     books is not counted as money to come, as a receipt not knocked off
//     settles a customer's oldest lines (scheduleOpenDocs). The debtors never
//     go below zero (capOpeningReceipts, on the page, which holds the sheet);
//   - 「根据fye 显示forecast 的数据可以吗？」: the forecast columns follow the
//     financial year picked, to its year end (fyForecastMonths).
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
  /** The documents open at the 1st of the first month, scheduled by terms.
   *  Customers' invoices are left to openingReceiptsByYm (collected on the
   *  page up to the books' debtors). */
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

  // The documents open at the start, when their money moves — customers'
  // invoices apart (openingReceiptsByYm: collected up to the books' debtors).
  for (const d of input.openingDocs) {
    if (!d.dueSen || !d.expectedYm || d.kind === "invoice") continue;
    const ym = d.expectedYm < first ? first : d.expectedYm;
    if (d.kind === "odb") post(ym, FC_CASH, d.accountCode, d.dueSen); // money in from an other debtor
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

/** Customers' invoices open at the start: the month their money is expected
 *  (one past its term in `firstYm`) → sen, every month, also those beyond the
 *  months shown — the cap is on all of them. */
export function openingReceiptsByYm(openingDocs: readonly ScheduledDoc[], firstYm: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of openingDocs) {
    if (d.kind !== "invoice" || d.dueSen <= 0 || !d.expectedYm) continue;
    const ym = d.expectedYm < firstYm ? firstYm : d.expectedYm;
    out[ym] = (out[ym] ?? 0) + d.dueSen;
  }
  return out;
}

/** The customers' money the forecast collects: no more than the trade debtors
 *  in the books (`capSen`). What the documents hold beyond them is left out
 *  from the earliest month on, as a receipt not knocked off settles the
 *  oldest lines first. A month left with nothing drops out. */
export function capOpeningReceipts(byYm: Readonly<Record<string, number>>, capSen: number): Record<string, number> {
  const yms = Object.keys(byYm).filter((ym) => byYm[ym] > 0).sort();
  let over = yms.reduce((t, ym) => t + byYm[ym], 0) - Math.max(0, capSen);
  const out: Record<string, number> = {};
  for (const ym of yms) {
    const leftOut = Math.min(Math.max(0, over), byYm[ym]);
    over -= leftOut;
    if (byYm[ym] - leftOut > 0) out[ym] = byYm[ym] - leftOut;
  }
  return out;
}

/** What GET /bs-forecast answers. */
export type BsForecastPayload = {
  /** Last month-end: the actual sheet the forecast starts from. */
  startYm: string;
  /** The forecast months, oldest first (forecastBsMonths). */
  months: string[];
  deltas: ForecastBsDeltas;
  /** Name and section of an account the movements bring to the sheet. */
  accounts: Record<string, { name: string; section: string }>;
  /** The salary accrual: what it owes at the start is paid in the first month. */
  salaryAccount: string;
  /** The trade debtor accounts: customers' invoices are collected up to their total at the start. */
  arAccounts: string[];
  /** The bank accounts: the forecast cash moves their total, not one of them. */
  bankAccounts: string[];
  /** The accounts the sheet keeps stock on (the Balance Sheet's stock lines). */
  stockAccounts: string[];
  /** openingReceiptsByYm. */
  openingReceipts: Record<string, number>;
};

/** The sheet's own line for this year's earnings. */
const NP_CURRENT = "NP-CURRENT";

/** The forecast columns, ready for the sheet (owner 2026-11-11 「为什么都是一样
 *  数额啊？不能根据forecast P&L 算？」 → proposal → 「做出来先吧」):
 *  - `sheets`: every forecast month's entries, rolled forward from the start's
 *    sheet — the month's movements, the salaries owed at the start paid in the
 *    first month, the customers' invoices collected up to the trade debtors on
 *    the start's sheet (capOpeningReceipts). Each movement sits on the line it
 *    belongs to: the debtors on Trade Debtors, the profit on Current Year
 *    Earnings; the cash inside the bank accounts' group (its total moves) and
 *    the depreciation inside the fixed assets (their total moves);
 *  - `dash`: the lines a forecast column shows as "—" — each bank account, each
 *    stock line, each fixed asset: the forecast does not say which bank the
 *    money goes through, the Forecast P&L has no stock (what it buys is used
 *    in the month, so stock stays as at the start) nor depreciation per asset;
 *  - `hidden`: the cash and depreciation movements, counted in their totals
 *    without a line of their own.
 *  Bank accounts that do not share one parent on the sheet have no total to
 *  carry the cash: the cash then keeps its own line and the banks their
 *  figures; stock lines likewise. A line missing from the start's sheet keeps
 *  its forecast line (FORECAST_BS_LINES). */
export type ForecastBsView = { sheets: Record<string, BsMonthEntry[]>; dash: Set<string>; hidden: Set<string> };

export function forecastBsView(fc: BsForecastPayload, opening: readonly BsMonthEntry[]): ForecastBsView {
  const owed = opening.find((e) => e.accountCode === fc.salaryAccount && e.category === "CURRENT_LIABILITY")?.balance ?? 0;
  const arAccounts = new Set(fc.arAccounts);
  const arLines = opening.filter((e) => arAccounts.has(e.accountCode) && e.category === "CURRENT_ASSET");
  const booksDebtors = arLines.reduce((t, e) => t + e.balance, 0);
  const receipts = capOpeningReceipts(fc.openingReceipts, booksDebtors);
  // The one parent a set of current-asset lines shares on the sheet, if any.
  const sharedParent = (codes: readonly string[] | undefined) => {
    const set = new Set(codes ?? []);
    const lines = opening.filter((e) => set.has(e.accountCode) && e.category === "CURRENT_ASSET");
    const parents = new Set(lines.map((e) => e.parentCode ?? ""));
    return lines.length && parents.size === 1 && lines[0].parentCode ? { lines, code: lines[0].parentCode, name: lines[0].parentName ?? null } : null;
  };
  const cashGroup = sharedParent(fc.bankAccounts);
  const stockGroup = sharedParent(fc.stockAccounts);
  const fixed = opening.filter((e) => e.category === "FIXED_ASSET");
  // Where a forecast line's movement lands.
  const lineOf: Record<string, string> = {};
  if (arLines.length) lineOf[FC_AR] = arLines[0].accountCode;
  lineOf[FC_PROFIT] = NP_CURRENT;
  const accounts = { ...fc.accounts, [NP_CURRENT]: { name: "Current Year Earnings (unclosed)", section: "EQUITY" } };

  const cum: Record<string, number> = {};
  const add = (code: string, sen: number) => {
    const to = lineOf[code] ?? code;
    if (sen) cum[to] = (cum[to] ?? 0) + sen;
  };
  const sheets: Record<string, BsMonthEntry[]> = {};
  fc.months.forEach((ym, i) => {
    for (const [code, sen] of Object.entries(fc.deltas[ym] ?? {})) add(code, sen);
    if (i === 0 && owed > 0) {
      add(fc.salaryAccount, owed);
      add(FC_CASH, -owed);
    }
    const r = receipts[ym] ?? 0;
    add(FC_CASH, r);
    add(FC_AR, -r);
    const entries = forecastBsEntries(opening, cum, accounts);
    if (cashGroup) {
      for (const e of entries) if (e.accountCode === FC_CASH) Object.assign(e, { parentCode: cashGroup.code, parentName: cashGroup.name });
    }
    sheets[ym] = entries;
  });

  const dash = new Set<string>([
    ...(cashGroup ? cashGroup.lines.map((e) => e.accountCode) : []),
    ...(stockGroup ? stockGroup.lines.map((e) => e.accountCode) : []),
    ...fixed.map((e) => e.accountCode),
  ]);
  const hidden = new Set<string>([...(cashGroup ? [FC_CASH] : []), ...(fixed.length ? [FC_DEPN] : [])]);
  return { sheets, dash, hidden };
}

/** The forecast months: the Forecast P&L columns from this month to the last
 *  month it has figures for (`lastFigureYm`), oldest first; none without
 *  figures from this month on. */
export function forecastBsMonths(columnYms: readonly string[], curYm: string, lastFigureYm: string | null): string[] {
  if (!lastFigureYm || lastFigureYm < curYm) return [];
  return [...new Set(columnYms.filter((ym) => ym >= curYm && ym <= lastFigureYm))].sort();
}

/** The forecast months inside the financial year picked, to its year end, newest first. */
export function fyForecastMonths(fy: { startYm: string; endYm: string }, months: readonly string[]): string[] {
  return months.filter((ym) => ym >= fy.startYm && ym <= fy.endYm).sort().reverse();
}
