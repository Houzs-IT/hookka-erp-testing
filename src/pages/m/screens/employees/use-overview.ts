// use-overview — the data behind the Employees Overview (HK-0125 Phase 3). Existing endpoints only, each gated by the
// permission the server already enforces:
//   /api/workers                                         workers:read     (Total Workers, the "/N" of logged hours)
//   /api/department-performance?view=summary&from&to     workers:read     (the cards' totals — desktop's own call)
//   /api/working-hour-entries/summary?from&to            (no gate)        (WORKERS WITH LOGGED HOURS numerator: hours in ANY
//                                                        department per worker, matched to the roster by worker id)
//   /api/attendance?from=<1st>&to=<today>                attendance:read  (Attendance exceptions; the SAME URL the
//                                                        Attendance screen fetches for the month-to-date Off-site list,
//                                                        so the two share one cached response)
// The pending list is NOT fetched here: the shell fetches it once and passes it down (it also drives the tab badge).
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { attendanceUrl, type AttRow } from "./attendance-model";
import { monthToDate, type HoursRow, type SourceState, type SummaryTotals, type WorkerLite } from "./overview-model";
import { rowsOf } from "./time-adjustments-model";
import { useCanReadAttendance } from "./use-time-adjustments";

/** Rows of a list response, or null when the body is not a list at all (a degraded `{success:false}` is "unavailable", not "empty"). */
function listOrNull<T>(resp: unknown): T[] | null {
  if (Array.isArray(resp)) return resp as T[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : null;
}

export type OverviewData = {
  range: { from: string; to: string };
  canWorkers: boolean;
  workers: { rows: WorkerLite[] | null; loading: boolean; error: boolean };
  totals: { value: SummaryTotals | null; loading: boolean; error: boolean };
  hours: { rows: HoursRow[] | null; loading: boolean; error: boolean };
  attendance: SourceState<AttRow>;
};

export function useOverview(today: string): OverviewData {
  const { hasPermission, loading: permLoading } = usePermissions();
  const canWorkers = !permLoading && hasPermission("workers", "read");
  const canAttendance = useCanReadAttendance();
  const range = monthToDate(today);

  const workersRes = useCachedJson<unknown>(canWorkers ? "/api/workers" : null, 300);
  const perfRes = useCachedJson<{ data?: { totals?: SummaryTotals } }>(
    canWorkers ? `/api/department-performance?view=summary&from=${range.from}&to=${range.to}` : null,
    120,
  );
  // Needs the roster too (workers:read), so it is only requested when the roster can be read.
  const hoursRes = useCachedJson<unknown>(canWorkers ? `/api/working-hour-entries/summary?from=${range.from}&to=${range.to}` : null, 120);
  const attRes = useCachedJson<unknown>(canAttendance ? attendanceUrl({ kind: "range", from: range.from, to: range.to }) : null, 120);

  return {
    range,
    canWorkers,
    workers: { rows: listOrNull<WorkerLite>(workersRes.data), loading: workersRes.loading, error: !!workersRes.error },
    totals: { value: perfRes.data?.data?.totals ?? null, loading: perfRes.loading, error: !!perfRes.error },
    hours: { rows: listOrNull<HoursRow>(hoursRes.data), loading: hoursRes.loading, error: !!hoursRes.error },
    attendance: {
      allowed: canAttendance,
      rows: attRes.data === null ? null : rowsOf<AttRow>(attRes.data),
      loading: attRes.loading,
      error: !!attRes.error,
    },
  };
}
