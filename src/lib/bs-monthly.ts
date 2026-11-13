// ---------------------------------------------------------------------------
// Monthly Balance Sheet (owner 2026-11-11 「balance sheet 我也想要看monthly 的
// 可以吗？」): each month-end's sheet side by side, newest first. Every month's
// entries are the Balance Sheet's own for that month (GET /api/accounting/pl
// ?period=YYYY-MM, `balanceSheet`), so a column always equals the single
// sheet; this lines the accounts up by code and adds the sheet's own totals.
// Pure; tests: tests/bs-monthly.test.mjs.
// ---------------------------------------------------------------------------
import type { BsSection } from "./bs-section";

export type BsMonthEntry = {
  accountCode: string;
  accountName: string;
  category: string;
  balance: number;
  parentCode?: string | null;
  parentName?: string | null;
};

export const BS_SECTIONS: readonly BsSection[] = ["FIXED_ASSET", "CURRENT_ASSET", "CURRENT_LIABILITY", "EQUITY", "LONG_TERM_LIABILITY"];

export type BsMatrixRow = { accountCode: string; accountName: string; parentCode: string | null; parentName: string | null; values: number[] };
export type BsMatrix = {
  months: string[];
  sections: Record<BsSection, { rows: BsMatrixRow[]; totals: number[] }>;
  /** Current assets less current liabilities, per month. */
  netCurrent: number[];
  /** Fixed assets + net current assets (what the business holds). */
  left: number[];
  /** Equity + non-current liabilities (how it is financed). */
  right: number[];
  /** left − right: 0 when the month balances. */
  diff: number[];
};

/** The Balance Sheet's unclosed-earnings line: last in Equity. */
const CURRENT_EARNINGS = "NP-CURRENT";

export function buildBsMatrix(months: readonly string[], byMonth: Readonly<Record<string, readonly BsMonthEntry[] | undefined>>): BsMatrix {
  const sections = Object.fromEntries(BS_SECTIONS.map((s) => [s, { rows: [] as BsMatrixRow[], totals: months.map(() => 0) }])) as BsMatrix["sections"];
  for (const s of BS_SECTIONS) {
    const rows = new Map<string, BsMatrixRow>();
    months.forEach((ym, i) => {
      for (const e of byMonth[ym] ?? []) {
        if (e.category !== s) continue;
        let r = rows.get(e.accountCode);
        if (!r) {
          // Months run newest first: the first month that has the account names it.
          r = { accountCode: e.accountCode, accountName: e.accountName, parentCode: e.parentCode ?? null, parentName: e.parentName ?? null, values: months.map(() => 0) };
          rows.set(e.accountCode, r);
        }
        r.values[i] += e.balance;
      }
    });
    const list = [...rows.values()].sort((a, b) =>
      a.accountCode === CURRENT_EARNINGS ? 1 : b.accountCode === CURRENT_EARNINGS ? -1 : a.accountCode.localeCompare(b.accountCode),
    );
    sections[s].rows = list;
    sections[s].totals = months.map((_, i) => list.reduce((t, r) => t + r.values[i], 0));
  }
  const at = (s: BsSection, i: number) => sections[s].totals[i];
  const netCurrent = months.map((_, i) => at("CURRENT_ASSET", i) - at("CURRENT_LIABILITY", i));
  const left = months.map((_, i) => at("FIXED_ASSET", i) + netCurrent[i]);
  const right = months.map((_, i) => at("EQUITY", i) + at("LONG_TERM_LIABILITY", i));
  return { months: [...months], sections, netCurrent, left, right, diff: months.map((_, i) => left[i] - right[i]) };
}

/** The month-ends of a financial year shown: its first month up to this
 *  month at most, newest first (a year still ahead shows none). */
export function fyMonthsShown(fy: { startYm: string; endYm: string }, curYm: string): string[] {
  const last = fy.endYm < curYm ? fy.endYm : curYm;
  const out: string[] = [];
  for (let ym = fy.startYm; ym <= last; ) {
    out.push(ym);
    const [y, m] = ym.split("-").map(Number);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return out.reverse();
}
