import { useEffect, useMemo, useState } from "react";
import { cachedFetchJson, useCachedJson } from "@/lib/cached-fetch";
import { costByWorkerDaySen, type CostWorker } from "@/lib/labor-day-cost";
import type { PayRuleVersion } from "@/lib/pay-rules";

// Logged labour cost by the Labor Cost rule over a date range, one entry per
// worker-day (`workerId|date` → sen). Used by the merged dashboard's Employees
// tab and the Output & Cost ratios so both print the same labour figure.
// Fetches nothing unless `enabled` (callers pass the payroll permission).
type Entry = { workerId: string; date: string; hours: number | string };

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (let guard = 0; guard < 36; guard++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > end) break;
    out.push(ym);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function useLabourCost(from: string, to: string, enabled: boolean): { byWorkerDay: Map<string, number>; ready: boolean } {
  const on = enabled && !!from && !!to;
  const { data: workersResp } = useCachedJson<{ data?: (CostWorker & { id: string })[] }>(on ? "/api/workers" : null);
  const { data: entriesResp } = useCachedJson<{ data?: Entry[] }>(on ? `/api/working-hour-entries?from=${from}&to=${to}` : null);
  const { data: holResp } = useCachedJson<{ data?: string[] }>(on ? "/api/kv-config/public_holidays" : null);
  const { data: rulesResp } = useCachedJson<{ data?: { versions?: PayRuleVersion[] } }>(on ? "/api/pay-rules" : null);
  const monthsKey = on ? monthsBetween(from, to).join(",") : "";
  const [eff, setEff] = useState<{ key: string; byMonth: Record<string, Record<string, number>> } | null>(null);
  useEffect(() => {
    if (!monthsKey) return;
    let live = true;
    const months = monthsKey.split(",");
    void Promise.all(
      months.map((ym) => cachedFetchJson<{ data?: Record<string, number> }>(`/api/workers/salary/effective?period=${ym}`)),
    ).then((rs) => {
      if (!live) return;
      const byMonth: Record<string, Record<string, number>> = {};
      months.forEach((ym, i) => { byMonth[ym] = rs[i]?.data ?? {}; });
      setEff({ key: monthsKey, byMonth });
    });
    return () => { live = false; };
  }, [monthsKey]);

  const byWorkerDay = useMemo(() => {
    const workers = workersResp?.data ?? [];
    const entries = entriesResp?.data ?? [];
    if (!on || !eff || eff.key !== monthsKey || workers.length === 0 || entries.length === 0) return new Map<string, number>();
    return costByWorkerDaySen({
      workers,
      entries,
      effSalaryByMonth: eff.byMonth,
      holidays: Array.isArray(holResp?.data) ? holResp!.data! : [],
      payRuleVersions: rulesResp?.data?.versions ?? [],
    });
  }, [on, eff, monthsKey, workersResp, entriesResp, holResp, rulesResp]);
  return { byWorkerDay, ready: byWorkerDay.size > 0 };
}
