// adjustment-calls.ts — the two writes behind the pending-request buttons (HK-0125 Phase 2). Rules and wording live in
// adjustment-actions.ts (pure, unit-tested); this file only sends them. Same endpoints and bodies as desktop's `decide`.
//   POST /api/working-hour-entries/nonprod-requests/:id/approve   (no body = the requested hours; { approvedHours } = partial)
//   POST /api/working-hour-entries/nonprod-requests/:id/reject    { reason }
// Both need `attendance:update` on the server. Remove on an approved row is NOT here.
import { mutateJson, refreshList } from "../../config/mutate";
import { REFRESH_PREFIXES, approveBody, outcomeOf, type Outcome } from "./adjustment-actions";
import { requestedMin, type NonprodReq } from "./time-adjustments-model";

const BASE = "/api/working-hour-entries/nonprod-requests";

/** Drop the caches a decision touches, so the pending / approved / rejected lists, the tab badge and efficiency refetch. */
export function refreshAfterDecision(): void {
  refreshList(...REFRESH_PREFIXES);
}

export async function approveRequest(r: NonprodReq, minutes: number): Promise<Outcome> {
  const req = requestedMin(r);
  const res = await mutateJson(`${BASE}/${encodeURIComponent(r.id)}/approve`, "POST", approveBody(minutes, req));
  const out = outcomeOf(res, `${r.workerName || r.workerId} — ${minutes} of ${req} min approved`);
  // "ok" and "someone already decided" (409) both change what the lists should show; an error changes nothing.
  if (out.kind !== "error") refreshAfterDecision();
  return out;
}

export async function rejectRequest(r: NonprodReq, reason: string): Promise<Outcome> {
  const why = reason.trim();
  if (!why) return { kind: "error", message: "Enter a reason to reject." };
  const res = await mutateJson(`${BASE}/${encodeURIComponent(r.id)}/reject`, "POST", { reason: why });
  const out = outcomeOf(res, `${r.workerName || r.workerId} rejected`);
  if (out.kind !== "error") refreshAfterDecision();
  return out;
}
