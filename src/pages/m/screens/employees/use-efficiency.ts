// use-efficiency — the data behind Employees → Efficiency Overview (HK-0125 Phase 4, step 1). Existing endpoints only, each
// gated by the permission the server already enforces; every request follows the shared period (from / to):
//   /api/workers                                       workers:read           names, employee numbers, helper flag
//   /api/working-hour-entries/summary?from&to          (no gate)              per worker: hours by department + days with entries
//   /api/job-cards/summary?from&to                     production-orders:read per worker: Earned time (job cards + approved extra
//                                                      production time, added once by the server)
//   /api/departments                                   (no gate)              which departments are production
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { EffDept, EffEarned, EffHours, EffWorker } from "./efficiency-model";
import type { YmdRange } from "./employees-dates";

/** Rows of a list response, or null when the body is not a list at all (a degraded `{success:false}` is "unavailable", not "empty"). */
function listOrNull<T>(resp: unknown): T[] | null {
  if (Array.isArray(resp)) return resp as T[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as T[]) : null;
}

export type SourceStatus<T> = { rows: T[] | null; loading: boolean; error: boolean };

export type EfficiencyData = {
  permLoading: boolean;
  canWorkers: boolean;
  canEarned: boolean;
  workers: SourceStatus<EffWorker>;
  hours: SourceStatus<EffHours>;
  earned: SourceStatus<EffEarned>;
  depts: SourceStatus<EffDept>;
};

export function useEfficiency(range: YmdRange): EfficiencyData {
  const { hasPermission, loading: permLoading } = usePermissions();
  const canWorkers = !permLoading && hasPermission("workers", "read");
  const canEarned = !permLoading && hasPermission("production-orders", "read");
  const { from, to } = range;

  const workersRes = useCachedJson<unknown>(canWorkers ? "/api/workers" : null, 300);
  const hoursRes = useCachedJson<unknown>(canWorkers ? `/api/working-hour-entries/summary?from=${from}&to=${to}` : null, 120);
  const earnedRes = useCachedJson<unknown>(canWorkers && canEarned ? `/api/job-cards/summary?from=${from}&to=${to}` : null, 120);
  const deptsRes = useCachedJson<unknown>(canWorkers ? "/api/departments" : null, 300);

  return {
    permLoading,
    canWorkers,
    canEarned,
    workers: { rows: listOrNull<EffWorker>(workersRes.data), loading: workersRes.loading, error: !!workersRes.error },
    hours: { rows: listOrNull<EffHours>(hoursRes.data), loading: hoursRes.loading, error: !!hoursRes.error },
    earned: { rows: listOrNull<EffEarned>(earnedRes.data), loading: earnedRes.loading, error: !!earnedRes.error },
    depts: { rows: listOrNull<EffDept>(deptsRes.data), loading: deptsRes.loading, error: !!deptsRes.error },
  };
}

/**
 * What the Efficiency Overview and Employee Performance both need to decide before they draw: still loading, failed, or ready (and
 * whether Earned time is missing — locked or failed — so that every efficiency reads "—"). One definition for both screens.
 */
export function efficiencyState(data: EfficiencyData): { loading: boolean; failed: boolean; earnedMissing: boolean; ready: boolean } {
  const earnedWanted = data.canWorkers && data.canEarned;
  const loading =
    data.permLoading ||
    (data.canWorkers &&
      ((data.workers.rows === null && data.workers.loading) ||
        (data.hours.rows === null && data.hours.loading) ||
        (data.depts.rows === null && data.depts.loading) ||
        (earnedWanted && data.earned.rows === null && data.earned.loading)));
  const failed = data.canWorkers && !loading && (data.workers.rows === null || data.hours.rows === null || data.depts.rows === null);
  const earnedMissing = data.canWorkers && !loading && !failed && data.earned.rows === null; // locked, or its request failed
  return { loading, failed, earnedMissing, ready: data.canWorkers && !loading && !failed };
}
