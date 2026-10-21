// ---------------------------------------------------------------------------
// finance-daily.ts — pure mapping for the v2 Daily lists (owner 2026-10-16;
// spec docs/superpowers/specs/2026-10-16-finance-v2-design.md; plan
// 2026-10-16-finance-v2-daily-a Task 1): how a document date reads, what the
// footer total counts, and which status pill a payment gets. No React here, so
// tests import it directly.
// ---------------------------------------------------------------------------
import { formatCurrency } from "./utils";

/** A status pill's colour family (finance-v2 tokens; see FinPill). */
export type FinTone = "ok" | "warn" | "err" | "neutral" | "info" | "faint";

// `group`: the status without its amount — what a list groups it under
// ("Group By This Column"); absent = the label itself.
export type FinStatus = { label: string; tone: FinTone; title?: string; group?: string };

/** An open advance's status: the amount still open, grouped as one kind. */
const ADVANCE_OPEN = "Approved · advance open";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-15" (or an ISO timestamp) → "15 Oct 2026", the design's document
 *  date; blank or unreadable → "". */
export function fmtDocDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return "";
  const mon = MON[Number(m[2]) - 1];
  return mon ? `${m[3]} ${mon} ${m[1]}` : "";
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-10-15" → "Thursday" (the calendar day, whatever the browser's time
 *  zone); unreadable → "". */
export function weekdayOf(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? "" : WEEKDAY[d.getUTCDay()];
}

/** The footer total of a money list: active rows only (void / deleted rows are
 *  shown but not counted), in whole sen. */
export function activeTotalSen(rows: { state: string; totalSen: number }[]): number {
  return rows.reduce((s, r) => (r.state === "ACTIVE" ? s + r.totalSen : s), 0);
}

/** A payment voucher's status pill: the approval ladder, then what an approved
 *  voucher still owes (a bank amount to confirm, an open advance, an accrual
 *  not yet paid). A legacy row with no ladder state was posted. */
export function pvStatus(v: {
  status?: string | null;
  approvalState?: string | null;
  advanceOpenSen?: number | null;
  accrued?: number | null;
  settledAt?: string | null;
  rejectReason?: string | null;
  pvNo?: string | null;
  /** A foreign-currency AP payment posted at the estimated rate whose bank
   *  amount is not confirmed yet (Currency & FX step 4). */
  fxPending?: boolean | null;
}): FinStatus {
  if (v.status === "VOID") return { label: "VOID", tone: "faint" };
  const st = v.approvalState ?? "APPROVED";
  if (st === "DRAFT") {
    return v.rejectReason ? { label: "Draft", tone: "neutral", title: `Rejected: ${v.rejectReason}` } : { label: "Draft", tone: "neutral" };
  }
  if (st === "PREPARED") return { label: "Prepared", tone: "info" };
  if (st === "CHECKED") {
    return { label: "Checked · awaiting approval", tone: "warn", title: `Formal No. ${v.pvNo ?? ""} — pending in Daily Cash Position` };
  }
  if (v.fxPending) {
    return { label: "Approved · bank amount pending", tone: "warn", title: "Posted at the payment's rate — confirm the RM the bank debited (right-click → Confirm bank amount)" };
  }
  if ((v.advanceOpenSen ?? 0) > 0) {
    return { label: `${ADVANCE_OPEN} ${formatCurrency(v.advanceOpenSen ?? 0)}`, tone: "warn", group: ADVANCE_OPEN };
  }
  if (v.accrued === 1 && !v.settledAt) return { label: "Approved · accrued, unpaid", tone: "err" };
  return { label: "Approved · paid", tone: "ok" };
}

/** A receipt's status pill. A bounced cheque says so first; money still on
 *  account (not knocked off) is info-blue; a customer receipt that cleared
 *  the bank says so. Other debtor / official receipts read "Posted". */
export function receiptStatus(v: { state: string; custStatus?: string | null; unallocated?: boolean }): FinStatus {
  if (v.state !== "ACTIVE") return { label: v.state, tone: "faint" };
  if (v.custStatus === "BOUNCED") return { label: "Bounced", tone: "err" };
  if (v.unallocated) return { label: "Posted · unallocated", tone: "info", title: "Money still on account — not knocked off yet" };
  if (v.custStatus === "CLEARED") return { label: "Posted · cleared", tone: "ok" };
  return { label: "Posted", tone: "ok" };
}

/** Daily Cash Position pending lines (one signed amount: + in, − out):
 *  receipts first, then payments, each by day; ties keep their order. The
 *  screen, Get image and Print all use it (finance v2). */
export function pendingReceiptsFirst<T extends { day: string; amountSen: number }>(lines: T[]): T[] {
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ga = a.l.amountSen > 0 ? 0 : 1;
      const gb = b.l.amountSen > 0 ? 0 : 1;
      return ga - gb || a.l.day.localeCompare(b.l.day) || a.i - b.i;
    })
    .map((x) => x.l);
}

/** A payment recorded on another page (supplier payment, other-creditor
 *  payment, old fund transfer): it posted when it was saved. */
export function foreignPayStatus(state: string, advanceOpenSen: number, hint: string): FinStatus {
  if (state !== "ACTIVE") return { label: state, tone: "faint" };
  if (advanceOpenSen > 0) return { label: `${ADVANCE_OPEN} ${formatCurrency(advanceOpenSen)}`, tone: "warn", group: ADVANCE_OPEN };
  return { label: "Approved · paid", tone: "ok", title: `Posted on save — ${hint}` };
}
