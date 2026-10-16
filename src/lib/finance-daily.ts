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

export type FinStatus = { label: string; tone: FinTone; title?: string };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-15" (or an ISO timestamp) → "15 Oct 2026", the design's document
 *  date; blank or unreadable → "". */
export function fmtDocDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return "";
  const mon = MON[Number(m[2]) - 1];
  return mon ? `${m[3]} ${mon} ${m[1]}` : "";
}

/** The footer total of a money list: active rows only (void / deleted rows are
 *  shown but not counted), in whole sen. */
export function activeTotalSen(rows: { state: string; totalSen: number }[]): number {
  return rows.reduce((s, r) => (r.state === "ACTIVE" ? s + r.totalSen : s), 0);
}

/** A payment voucher's status pill: the approval ladder, then what an approved
 *  voucher still owes (an open advance, an accrual not yet paid). A legacy row
 *  with no ladder state was posted. */
export function pvStatus(v: {
  status?: string | null;
  approvalState?: string | null;
  advanceOpenSen?: number | null;
  accrued?: number | null;
  settledAt?: string | null;
  rejectReason?: string | null;
  pvNo?: string | null;
}): FinStatus {
  if (v.status === "VOID") return { label: "VOID", tone: "faint" };
  const st = v.approvalState ?? "APPROVED";
  if (st === "DRAFT") {
    return v.rejectReason ? { label: "Draft", tone: "neutral", title: `Rejected: ${v.rejectReason}` } : { label: "Draft", tone: "neutral" };
  }
  if (st === "PREPARED") return { label: "Prepared", tone: "info" };
  if (st === "CHECKED") {
    return { label: "Checked · awaiting approval", tone: "warn", title: `Formal No. ${v.pvNo ?? ""} — pending in Cash Position` };
  }
  if ((v.advanceOpenSen ?? 0) > 0) {
    return { label: `Approved · advance open ${formatCurrency(v.advanceOpenSen ?? 0)}`, tone: "warn" };
  }
  if (v.accrued === 1 && !v.settledAt) return { label: "Approved · accrued, unpaid", tone: "err" };
  return { label: "Approved · paid", tone: "ok" };
}

/** A payment recorded on another page (supplier payment, other-creditor
 *  payment, old fund transfer): it posted when it was saved. */
export function foreignPayStatus(state: string, advanceOpenSen: number, hint: string): FinStatus {
  if (state !== "ACTIVE") return { label: state, tone: "faint" };
  if (advanceOpenSen > 0) return { label: `Approved · advance open ${formatCurrency(advanceOpenSen)}`, tone: "warn" };
  return { label: "Approved · paid", tone: "ok", title: `Posted on save — ${hint}` };
}
