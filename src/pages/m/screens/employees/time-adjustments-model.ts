// time-adjustments-model.ts — the Time Adjustment Requests card, view-only (HK-0125 Phase 2). Pure.
//
// Data: `GET /api/working-hour-entries/nonprod-requests?status=PENDING|APPROVED|REJECTED`, exactly what desktop calls.
// The server has NO date parameter and returns the newest 200 per status, so (a) the Working Hours date filter never
// touches this list, and (b) a response of 200 rows means "there may be more": it is labelled "Showing latest 200", never
// presented as an exact total.
import { fmtMin, shortDate } from "./employees-format";

export type NonprodReq = {
  id: string;
  workerId: string;
  workerName?: string;
  /** The WORK date the request is for. */
  date: string;
  departmentCode: string;
  hours: number;
  note: string;
  status: string;
  createdAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  kind: "NONPROD" | "ADD_PROD";
  jobCardId?: string;
  rejectReason?: string;
  approvedHours?: number | null;
};

/** The server's per-status row cap. */
export const REQUEST_CAP = 200;

export const isCapped = (list: readonly unknown[] | null | undefined): boolean => (list?.length ?? 0) >= REQUEST_CAP;

/** The pending pill / tab badge: the same list the card shows; "200+" at the cap; null when none. */
export function pendingBadge(list: readonly NonprodReq[] | null | undefined): string | null {
  const n = list?.length ?? 0;
  if (n === 0) return null;
  return n >= REQUEST_CAP ? `${REQUEST_CAP}+` : String(n);
}

/** "Showing latest 200 approved" at the cap, else the exact count. */
export function historyCount(list: readonly unknown[], noun: string): string {
  return isCapped(list) ? `Showing latest ${REQUEST_CAP} ${noun}` : `${list.length} ${noun}`;
}

export const requestedMin = (r: NonprodReq): number => Math.round((Number(r.hours) || 0) * 60);
export const approvedMin = (r: NonprodReq): number =>
  Math.round(
    (r.approvedHours === null || r.approvedHours === undefined ? Number(r.hours) || 0 : Number(r.approvedHours) || 0) * 60,
  );

export const kindLabel = (r: NonprodReq): string => (r.kind === "ADD_PROD" ? "Extra production time" : "Non-production");

/** Desktop wording: "45 min (of 1h)" for a partial approval, else the minutes. */
export function approvedTitle(r: NonprodReq): string {
  const a = approvedMin(r);
  const q = requestedMin(r);
  return a < q ? `${fmtMin(a)} (of ${fmtMin(q)})` : fmtMin(a);
}

const jobOf = (r: NonprodReq) => (r.kind === "ADD_PROD" && r.jobCardId ? ` · Job: ${r.jobCardId}` : "");

/** Pending, as the HTML writes it: "2026-11-11 · Job: PO-… — note" (the work date, ISO; the department is in the heading). */
export function pendingSub(r: NonprodReq): string {
  return `${r.date}${jobOf(r)}${r.note ? ` — ${r.note}` : ""}`;
}

/** Approved: "2026-11-07 · Upholstery · Job: PO-…". */
export function approvedSub(r: NonprodReq, deptName: string): string {
  return `${r.date} · ${deptName}${jobOf(r)}`;
}

/** Rejected: "2026-10-14 — note" (the department is in the heading). */
export function rejectedSub(r: NonprodReq): string {
  return `${r.date}${r.note ? ` — ${r.note}` : ""}`;
}

export function matchesQuery(r: NonprodReq, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [r.workerName, r.date, shortDate(r.date), r.departmentCode, r.note, r.jobCardId, r.rejectReason]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(s);
}

export function rowsOf<T>(resp: unknown): T[] {
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}
