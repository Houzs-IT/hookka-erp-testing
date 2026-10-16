// ---------------------------------------------------------------------------
// finance-reports.ts — pure helpers behind the v2 report shell (owner
// 2026-10-16; spec docs/superpowers/specs/2026-10-16-finance-v2-design.md;
// plan 2026-10-16-finance-v2-reports Task 1): the period stepper, the as-at
// date, the link into the General Ledger, Trial Balance sections, the GL
// "By Code Range" tick and ledger balances. No React here, so tests import it
// directly. Figures are never computed here — the reports keep their engines.
// ---------------------------------------------------------------------------
import { formatCurrency } from "./utils";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The period keys the reports already read: a month `2026-10`, a calendar
 *  quarter `2026-Q4`, a calendar year `2026` (what /pl-statement understands). */
export type PeriodKind = "month" | "quarter" | "year";

export function periodKind(key: string): PeriodKind | null {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return "month";
  if (/^\d{4}-Q[1-4]$/.test(key)) return "quarter";
  if (/^\d{4}$/.test(key)) return "year";
  return null;
}

const ymOf = (y: number, m0: number) => {
  const d = new Date(Date.UTC(y, m0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** The period `delta` steps away, of the same kind (months by months,
 *  quarters by quarters, years by years). An unreadable key is returned as is. */
export function stepPeriod(key: string, delta: number): string {
  const kind = periodKind(key);
  const y = Number(key.slice(0, 4));
  if (kind === "month") return ymOf(y, Number(key.slice(5, 7)) - 1 + delta);
  if (kind === "quarter") {
    const q = y * 4 + (Number(key.slice(6)) - 1) + delta;
    return `${Math.floor(q / 4)}-Q${(((q % 4) + 4) % 4) + 1}`;
  }
  if (kind === "year") return String(y + delta);
  return key;
}

/** First and last month of a period key. */
function monthsOf(key: string): [string, string] | null {
  const kind = periodKind(key);
  const y = Number(key.slice(0, 4));
  if (kind === "month") return [key, key];
  if (kind === "quarter") {
    const q = Number(key.slice(6));
    return [ymOf(y, (q - 1) * 3), ymOf(y, (q - 1) * 3 + 2)];
  }
  if (kind === "year") return [`${y}-01`, `${y}-12`];
  return null;
}

/** "Oct 2026", "Q4 2026", "Full Year 2026"; the period holding today reads
 *  "· so far" (the design's running-period label). */
export function periodLabel(key: string, todayYmd: string): string {
  const kind = periodKind(key);
  const y = key.slice(0, 4);
  const base =
    kind === "month" ? `${MON[Number(key.slice(5, 7)) - 1]} ${y}`
    : kind === "quarter" ? `${key.slice(5)} ${y}`
    : kind === "year" ? `Full Year ${y}`
    : key;
  const span = monthsOf(key);
  const now = todayYmd.slice(0, 7);
  return span && span[0] <= now && now <= span[1] ? `${base} · so far` : base;
}

/** "2026-02" → "2026-02-28". */
export function monthEnd(ym: string): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
}

/** The date a month-end report reads as at: a closed month is its last day;
 *  the running month (or a later one) is today. */
export function asAtDate(ym: string, todayYmd: string): string {
  return ym >= todayYmd.slice(0, 7) ? todayYmd : monthEnd(ym);
}

/** `count` months ending at `lastYm`, newest first. */
export function monthOptions(lastYm: string, count: number): string[] {
  const y = Number(lastYm.slice(0, 4));
  const m0 = Number(lastYm.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => ymOf(y, m0 - i));
}

/** The General Ledger filtered to one account, from the first of `fromYm` to
 *  `toDate` (YYYY-MM-DD) — the URL GeneralLedgerTab reads. */
export function glLink(o: { account: string; fromYm: string; toDate: string }): string {
  return `/accounting?tab=gl&account=${encodeURIComponent(o.account)}&from=${o.fromYm}-01&to=${o.toDate}`;
}

export type TbSectionKey = "NCA" | "CA" | "CL" | "NCL" | "EQ" | "REV" | "COGS" | "OI" | "EXP" | "OTHER";

/** Chart of Accounts sections in the chart's own order, plus Other for an
 *  account the chart no longer has (it still carries a balance). */
export const TB_SECTIONS: readonly { key: TbSectionKey; label: string }[] = [
  { key: "NCA", label: "Non-Current Assets" },
  { key: "CA", label: "Current Assets" },
  { key: "CL", label: "Current Liabilities" },
  { key: "NCL", label: "Non-Current Liabilities" },
  { key: "EQ", label: "Equity" },
  { key: "REV", label: "Revenue" },
  { key: "COGS", label: "Cost of Goods Sold" },
  { key: "OI", label: "Other Income" },
  { key: "EXP", label: "Expenses" },
  { key: "OTHER", label: "Other Accounts" },
];

/** The Chart of Accounts rule (type + code band): assets below 300 are
 *  non-current, liabilities 480–489 are non-current, revenue from 530 is other
 *  income. Mirrors `sectionOf` on the Chart of Accounts tab. */
export function tbSectionOf(code: string, type: string): TbSectionKey {
  const p = parseInt(code.split("-")[0], 10) || 0;
  switch (type) {
    case "ASSET": return p < 300 ? "NCA" : "CA";
    case "LIABILITY": return p >= 480 && p < 490 ? "NCL" : "CL";
    case "EQUITY": return "EQ";
    case "REVENUE": return p >= 530 ? "OI" : "REV";
    case "COST": return "COGS";
    case "EXPENSE": return "EXP";
    default: return "OTHER";
  }
}

export type TbSection<T> = { key: TbSectionKey; label: string; rows: T[]; debitSen: number; creditSen: number };

/** Trial Balance rows grouped by section, in section order (rows keep their
 *  order); a section with no rows is left out. */
export function tbSections<T extends { accountCode: string; type: string; debitSen: number; creditSen: number }>(rows: T[]): TbSection<T>[] {
  const by = new Map<TbSectionKey, T[]>();
  for (const r of rows) {
    const k = tbSectionOf(r.accountCode, r.type);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return TB_SECTIONS.filter((s) => by.has(s.key)).map((s) => {
    const xs = by.get(s.key)!;
    return {
      key: s.key,
      label: s.label,
      rows: xs,
      debitSen: xs.reduce((t, r) => t + r.debitSen, 0),
      creditSen: xs.reduce((t, r) => t + r.creditSen, 0),
    };
  });
}

/** The GL picker's "By Code Range": codes from `from` to `to`, where each end
 *  is a prefix ("310" covers every 310-xxxx). A blank end is open; swapped
 *  ends still tick the range. Order follows `codes`. */
export function codesInRange(codes: string[], from: string, to: string): string[] {
  let lo = from.trim();
  let hi = to.trim();
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  return codes.filter((c) => (!lo || c >= lo) && (!hi || c <= hi + "￿"));
}

/** A ledger balance, debit minus credit in sen: debit plain, credit in
 *  brackets — "(RM 1,000.00)". */
export function fmtLedgerBal(sen: number): string {
  return sen < 0 ? `(${formatCurrency(-sen)})` : formatCurrency(sen);
}
