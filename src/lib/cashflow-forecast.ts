// ---------------------------------------------------------------------------
// Cash Flow forecast — pure. Turns as-at agings, master terms, Forecast P&L
// figures and planned payments into forecast pseudo-legs that the statement
// engine (buildStatement, src/lib/cashflow-engine.ts) places exactly like
// ledger legs, so a forecast lands on the same line as the actual money.
// No DB, no I/O. Spec: docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md.
// Tests: tests/cashflow-forecast.test.mjs.
// ---------------------------------------------------------------------------
import { OVERDUE_LABEL, splitByLargestRemainder, type ForecastItem, type ForecastLeg } from "./cashflow-engine";

export type TermInfo = { months: number; flagged: boolean };

/** A customer's `creditTerms` or a supplier's `paymentTerms` → months (spec 5).
 *  NETn and "n days" round to whole months; "n months" is n; C.O.D. / CASH is
 *  the same month. Anything else — blank included — is taken as one month and
 *  flagged, so the page can name it. */
export function parseTermMonths(raw: string | null | undefined): TermInfo {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return { months: 1, flagged: true };
  const compact = s.replace(/[.\s]/g, "");
  if (compact === "COD" || compact === "CASH") return { months: 0, flagged: false };
  let m = /^NET ?(\d{1,3})$/.exec(s);
  if (m) return { months: Math.round(Number(m[1]) / 30), flagged: false };
  m = /^(\d{1,3}) ?DAYS?$/.exec(s);
  if (m) return { months: Math.round(Number(m[1]) / 30), flagged: false };
  m = /^(\d{1,2}) ?MONTHS?$/.exec(s);
  if (m) return { months: Number(m[1]), flagged: false };
  return { months: 1, flagged: true };
}

/** "2026-11" + 2 → "2027-01". */
export function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** The forecast column key of a month. */
export const fcCol = (ym: string): string => `fc:${ym}`;

export type DocKind = "invoice" | "pi" | "ocb" | "odb" | "tf";

/** One line of an aging as at some date. `sen` > 0 is still owed; < 0 is a
 *  credit (an advance, a credit note, a trade-finance repayment not yet
 *  allocated). For `tf`, `date` is the draw's due date. */
export type OpenDoc = {
  kind: DocKind;
  partyId: string;
  partyName: string;
  no: string;
  date: string;
  sen: number;
  /** Where the money is placed: the debtor / creditor control, the facility
   *  account, or the bill's control when it has no item lines. */
  accountCode: string;
  /** Other-party bills: the item accounts the bill was spent on, weighted. */
  mix?: { accountCode: string; weight: number }[];
  /** Purchase invoices: the rmSplit key of the PI's material weights. */
  splitKey?: string;
  /** Trade finance: the line it repays ("Repaid to <lender>"). */
  label?: string;
};

export type ScheduledDoc = OpenDoc & { expectedYm: string; dueSen: number; termFlagged: boolean };

const family = (k: DocKind): string => (k === "invoice" ? "ar" : k === "pi" ? "ap" : k);

/** Owed lines with the month they are expected, after each party's credits
 *  are knocked off its OLDEST expected lines first (owner 2026-11-06: money
 *  received and recorded but not knocked off must not be counted again).
 *  Floored at zero; leftover credit is dropped, never a negative receipt. */
export function scheduleOpenDocs(docs: readonly OpenDoc[], termOf: (d: OpenDoc) => TermInfo): ScheduledDoc[] {
  const groups = new Map<string, OpenDoc[]>();
  for (const d of docs) {
    const k = `${family(d.kind)}|${d.partyId}`;
    const arr = groups.get(k) ?? [];
    arr.push(d);
    groups.set(k, arr);
  }
  const out: ScheduledDoc[] = [];
  for (const arr of groups.values()) {
    const owed: ScheduledDoc[] = [];
    let credit = 0;
    for (const d of arr) {
      if (d.sen < 0) { credit += -d.sen; continue; }
      if (d.sen === 0) continue;
      const t = termOf(d);
      // A line with no readable date (a draw without a due date) cannot be
      // placed in a month; it stays out rather than landing somewhere wrong.
      const expectedYm = /^\d{4}-\d{2}/.test(d.date) ? addMonthsYm(d.date.slice(0, 7), t.months) : "";
      owed.push({ ...d, expectedYm, dueSen: d.sen, termFlagged: t.flagged });
    }
    owed.sort((a, b) => a.expectedYm.localeCompare(b.expectedYm) || a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
    for (const o of owed) {
      if (credit <= 0) break;
      const take = Math.min(credit, o.dueSen);
      o.dueSen -= take;
      credit -= take;
    }
    out.push(...owed);
  }
  return out;
}

const splitMix = (sen: number, mix: { accountCode: string; weight: number }[]): [string, number][] =>
  Object.entries(splitByLargestRemainder(sen, mix.map((m) => ({ key: m.accountCode, weight: m.weight })))).filter(([, v]) => v !== 0);

/** The legs one aging puts in one forecast column.
 *  - "baseline" (the aging as at the column's 1st): lines expected that month
 *    are due; lines expected earlier are overdue and count in this month
 *    (owner: 单独一行但算这个月); later lines belong to later columns.
 *  - "future" (the aging as at today): only lines expected that month. */
export function docLegsForColumn(
  docs: readonly ScheduledDoc[],
  colYm: string,
  mode: "baseline" | "future",
  isCreditorControl: (code: string) => boolean,
): ForecastLeg[] {
  const legs: ForecastLeg[] = [];
  const col = fcCol(colYm);
  for (const d of docs) {
    if (d.dueSen <= 0 || !d.expectedYm) continue;
    const overdue = mode === "baseline" && d.expectedYm < colYm;
    if (!overdue && d.expectedYm !== colYm) continue;
    const sign = d.kind === "invoice" || d.kind === "odb" ? 1 : -1;
    const item: ForecastItem = { kind: d.kind, party: d.partyName, ref: d.no, date: d.date, expectedYm: d.expectedYm };
    const parts = (d.kind === "ocb" || d.kind === "odb") && d.mix?.length ? splitMix(d.dueSen, d.mix) : null;
    if (overdue) {
      if (parts) for (const [acct, sen] of parts) legs.push({ col, sen: sign * sen, accountCode: acct, label: OVERDUE_LABEL, order: 98, item });
      else legs.push({ col, sen: sign * d.dueSen, accountCode: d.accountCode, label: OVERDUE_LABEL, order: 98, item });
      continue;
    }
    switch (d.kind) {
      case "invoice":
        legs.push({ col, sen: d.dueSen, accountCode: d.accountCode, item });
        break;
      case "pi":
        legs.push({ col, sen: -d.dueSen, accountCode: d.accountCode, ...(d.splitKey ? { splitKey: d.splitKey } : {}), item });
        break;
      case "tf":
        legs.push({ col, sen: -d.dueSen, accountCode: d.accountCode, ...(d.label ? { label: d.label } : {}), item });
        break;
      case "ocb":
        // Same re-routing as an actual other-creditor payment: each part on
        // the account the bill was spent on; a part on a creditor control is
        // suppliers paid on our behalf; a bill with no items keeps its payee.
        if (parts) {
          for (const [acct, sen] of parts)
            legs.push({ col, sen: -sen, accountCode: acct, ...(isCreditorControl(acct) ? { label: `Suppliers settled via ${d.partyName}` } : {}), item });
        } else legs.push({ col, sen: -d.dueSen, accountCode: d.accountCode, label: `${d.partyName} (other creditor)`, item });
        break;
      case "odb":
        if (parts) for (const [acct, sen] of parts) legs.push({ col, sen, accountCode: acct, item });
        else legs.push({ col, sen: d.dueSen, accountCode: d.accountCode, item });
        break;
    }
  }
  return legs;
}

/** (supplier, PI number) → PI id. An aging line names its PI by number only;
 *  two PIs of one supplier sharing a number resolve to nothing, so neither
 *  borrows the other's materials. */
export function piIdIndex(rows: readonly { id: string; piNo: string; supplierId: string }[]): (supplierId: string, piNo: string) => string | null {
  const m = new Map<string, string | null>();
  for (const r of rows) {
    const k = `${r.supplierId}|${r.piNo}`;
    m.set(k, m.has(k) && m.get(k) !== r.id ? null : r.id);
  }
  return (supplierId, piNo) => m.get(`${supplierId}|${piNo}`) ?? null;
}
