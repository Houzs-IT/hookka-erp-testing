// use-time-adjustments — the Time Adjustment Requests lists, read-only (HK-0125 Phase 2).
//
// The same three GETs desktop's Working Hours tab makes (`attendance:read`). They carry NO date: the Working Hours date
// filter must never reach these URLs (tests/m-employees-working-hours.test.mjs pins that).
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { rowsOf, type NonprodReq } from "./time-adjustments-model";

const URL_BASE = "/api/working-hour-entries/nonprod-requests?status=";
const TTL_SEC = 60;

export type AdjustmentList = {
  /** null until the first response; [] once loaded with nothing. */
  rows: NonprodReq[] | null;
  loading: boolean;
  error: string | null;
};

/** False while permissions load or when the role lacks `attendance:read` (then nothing is requested). */
export function useCanReadAttendance(): boolean {
  const { hasPermission, loading } = usePermissions();
  return !loading && hasPermission("attendance", "read");
}

function useList(status: "PENDING" | "APPROVED" | "REJECTED", enabled: boolean): AdjustmentList {
  const { data, loading, error } = useCachedJson<unknown>(enabled ? `${URL_BASE}${status}` : null, TTL_SEC);
  return { rows: data === null ? null : rowsOf<NonprodReq>(data), loading, error };
}

/** The pending list — fetched once by the shell, so the tab badge and the card are the SAME data. */
export function usePendingAdjustments(): AdjustmentList & { allowed: boolean } {
  const allowed = useCanReadAttendance();
  return { ...useList("PENDING", allowed), allowed };
}

/** Approved / rejected history, fetched only while the Working Hours section is open. */
export function useAdjustmentHistory(status: "APPROVED" | "REJECTED", enabled: boolean): AdjustmentList {
  return useList(status, enabled);
}
