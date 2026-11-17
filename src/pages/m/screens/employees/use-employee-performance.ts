// use-employee-performance — the data behind Employees → Employee Performance (HK-0125 Phase 4, step 2). Existing endpoints only,
// each gated by the permission the server already enforces. The first four are EXACTLY the Efficiency Overview's requests (same
// URLs, same cache), so a worker opened from the ranking costs nothing extra for them and shows the same figures:
//   /api/workers                                        workers:read
//   /api/working-hour-entries/summary?from&to           (no gate)
//   /api/job-cards/summary?from&to                      production-orders:read   (the efficiency numerator, approved extra time included once)
//   /api/departments                                    (no gate)
// and for this one worker:
//   /api/job-cards?picId=<id>&from&to                   production-orders:read   (Daily Breakdown rows)
//   /api/attendance?employeeId=<id>&from&to             attendance:read          (Total OT)
//   /api/working-hour-entries/nonprod-requests?status=APPROVED   attendance:read (Extra Production Time tile ONLY, never efficiency)
import { useCachedJson } from "@/lib/cached-fetch";
import type { AttendanceOt, ExtraClaim, JobCardRow } from "./employee-performance-model";
import type { YmdRange } from "./employees-dates";
import type { EfficiencyData, SourceStatus } from "./use-efficiency";
import { useCanReadAttendance } from "./use-time-adjustments";

function listOrNull<T>(resp: unknown): T[] | null {
  if (Array.isArray(resp)) return resp as T[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : null;
}

export type EmployeeExtras = {
  canAttendance: boolean;
  cards: SourceStatus<JobCardRow>;
  attendance: SourceStatus<AttendanceOt>;
  claims: SourceStatus<ExtraClaim>;
};

/** `base` is the Efficiency Overview's own data (useEfficiency) — the caller already has it, so it is not requested twice. */
export function useEmployeeExtras(base: EfficiencyData, range: YmdRange, workerId: string): EmployeeExtras {
  const canAttendance = useCanReadAttendance();
  const { from, to } = range;
  const id = workerId ? encodeURIComponent(workerId) : "";
  const wantCards = base.canWorkers && base.canEarned && !!workerId;

  const cardsRes = useCachedJson<unknown>(wantCards ? `/api/job-cards?picId=${id}&from=${from}&to=${to}` : null, 120);
  const attRes = useCachedJson<unknown>(canAttendance && workerId ? `/api/attendance?employeeId=${id}&from=${from}&to=${to}` : null, 120);
  const claimsRes = useCachedJson<unknown>(canAttendance && base.canWorkers ? "/api/working-hour-entries/nonprod-requests?status=APPROVED" : null, 120);

  return {
    canAttendance,
    cards: { rows: listOrNull<JobCardRow>(cardsRes.data), loading: cardsRes.loading, error: !!cardsRes.error },
    attendance: { rows: listOrNull<AttendanceOt>(attRes.data), loading: attRes.loading, error: !!attRes.error },
    claims: { rows: listOrNull<ExtraClaim>(claimsRes.data), loading: claimsRes.loading, error: !!claimsRes.error },
  };
}
