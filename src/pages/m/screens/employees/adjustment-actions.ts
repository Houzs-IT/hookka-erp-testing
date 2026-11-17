// adjustment-actions.ts — the pure rules of Approve / Reject for PENDING time-adjustment requests (HK-0125 Phase 2, owner-approved
// 2026-11-16); the network calls are in adjustment-calls.ts. Same endpoints, bodies and rules as desktop's Working Hours tab (employees.tsx `decide`); nothing new on the
// server. Needs `attendance:update` (the server enforces it; the UI hides the buttons without it).
//
//   Approve  POST /api/working-hour-entries/nonprod-requests/:id/approve   body { approvedHours? }
//            • full approval = no body (the server uses the requested hours exactly);
//            • partial = approvedHours (hours, 0 < x <= requested; the server rounds to 2 decimals);
//            • NONPROD  → writes a non-production hours row and moves the same hours OFF that day's production hours;
//            • ADD_PROD → writes no hours row; credits the efficiency numerator.
//   Reject   POST …/:id/reject   body { reason }  (required; the worker sees it)
//   Not here: Remove on an approved row (a separate plan).
import { fmtMin, shortDate } from "./employees-format";
import { requestedMin, type NonprodReq } from "./time-adjustments-model";

/** Caches to drop after a decision: the request lists, the hours lists and the efficiency figures built from them. */
export const REFRESH_PREFIXES = [
  "/api/working-hour-entries",
  "/api/department-performance",
  "/api/job-cards",
  "/api/reports/efficiency",
] as const;

/** Whole minutes between 1 and the requested minutes (the server refuses 0; it refuses more than requested). */
export function clampMinutes(raw: string | number, requested: number): number {
  const n = typeof raw === "number" ? Math.round(raw) : parseInt(String(raw ?? "").trim() || "0", 10);
  const v = Number.isFinite(n) ? n : 0;
  return Math.max(1, Math.min(requested, v));
}

/** Hours as the server stores them (2 decimals): 50 min → 0.83 h. */
export const recordedHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

/** A full approval sends no body so the requested hours are used exactly; a partial one sends approvedHours. */
export function approveBody(minutes: number, requested: number): { approvedHours: number } | undefined {
  return minutes >= requested ? undefined : { approvedHours: minutes / 60 };
}

/** What the approval REALLY does, per kind (the HTML's one sentence is only true for non-production). */
export function approveConfirm(r: NonprodReq, deptName: string, minutes: number): string {
  const req = requestedMin(r);
  const head = `Approve ${minutes} of ${req} min for ${r.workerName || r.workerId} (${deptName}, ${shortDate(r.date)})?`;
  const partial = minutes < req ? ` ${req - minutes} min will not be counted.` : "";
  const rounded = Math.abs(recordedHours(minutes) * 60 - minutes) > 0.01 ? ` It is stored as ${recordedHours(minutes)} h.` : "";
  if (r.kind === "ADD_PROD") {
    return `${head}${partial} This credits ${fmtMin(minutes)} of extra production time to their efficiency. It does not add a working-hours row or change the day's hours.${rounded}`;
  }
  return `${head}${partial} This records ${fmtMin(minutes)} under ${deptName} on ${shortDate(r.date)} and takes the same time off their production-department hours that day, so the day's total hours stay the same and their efficiency goes up.${rounded}`;
}

export type Outcome =
  | { kind: "ok"; message: string }
  /** Someone else already decided it (HTTP 409): nothing was changed by this tap, the lists are refreshed. */
  | { kind: "already"; message: string }
  | { kind: "error"; message: string };

/** Turn a mutateJson result into what the screen shows. Only "ok" and "already" refresh the lists. */
export function outcomeOf(
  res: { ok: boolean; status: number; error?: string },
  okMessage: string,
): Outcome {
  if (res.ok) return { kind: "ok", message: okMessage };
  if (res.status === 409) return { kind: "already", message: "Someone already decided this request. The list was refreshed." };
  return { kind: "error", message: res.error || "Could not update the request." };
}
