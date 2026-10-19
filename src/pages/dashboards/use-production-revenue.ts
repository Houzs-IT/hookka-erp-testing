import { useEffect, useState } from "react";
import { cachedFetchJson } from "@/lib/cached-fetch";
import type { RevenueSplitResp } from "../dashboard-b/revenue-split";

// Production revenue per day, read month by month from Department Revenue's
// endpoint (GET /api/dashboard/overview/revenue-split?period=YYYY-MM, daily
// buckets). `total` is the Upholstery rule (an order's value on the day its
// Upholstery cards complete) — the figure the Command Center, Costing and
// Employees all use; `dept` carries every department's own daily value under
// the same rule, split Bedframe / Sofa. Months are fetched in parallel and
// cached; `null` until every month has answered.
export type DaySplit = { total: number; bedframe: number; sofa: number };
export type ProductionRevenue = { byDay: Map<string, DaySplit>; dept: Map<string, Map<string, DaySplit>> };

export function useProductionRevenue(months: readonly string[]): ProductionRevenue | null {
  const key = months.join(",");
  const [state, setState] = useState<{ key: string; data: ProductionRevenue } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const ms = key.split(",");
    void Promise.all(ms.map((ym) => cachedFetchJson<RevenueSplitResp>(`/api/dashboard/overview/revenue-split?period=${ym}`))).then((rs) => {
      if (!live) return;
      const byDay = new Map<string, DaySplit>();
      const dept = new Map<string, Map<string, DaySplit>>();
      for (const r of rs) {
        const buckets = r?.revenue ?? [];
        buckets.forEach((b) => {
          byDay.set(b.bucket, { total: b.production?.total ?? 0, bedframe: b.production?.bedframe ?? 0, sofa: b.production?.sofa ?? 0 });
        });
        for (const d of r?.departments ?? []) {
          const m = dept.get(d.code) ?? new Map<string, DaySplit>();
          d.byBucket.forEach((s, i) => {
            const day = buckets[i]?.bucket;
            if (day) m.set(day, { total: s.total, bedframe: s.bedframe, sofa: s.sofa });
          });
          dept.set(d.code, m);
        }
      }
      setState({ key, data: { byDay, dept } });
    });
    return () => { live = false; };
  }, [key]);
  return state && state.key === key ? state.data : null;
}

/** Calendar months touched by a period, capped at the current month. */
export function monthsOf(p: { mode: string; month: string; from?: string; to?: string }, today: string): string[] {
  const cap = today.slice(0, 7);
  let first: string;
  let last: string;
  if (p.mode === "ytd") { first = `${p.month.slice(0, 4)}-01`; last = `${p.month.slice(0, 4)}-12`; }
  else if (p.mode === "range" && p.from && p.to) { first = p.from.slice(0, 7); last = p.to.slice(0, 7); }
  else { first = p.month; last = p.month; }
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  for (let guard = 0; guard < 36; guard++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > last || ym > cap) break;
    out.push(ym);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
