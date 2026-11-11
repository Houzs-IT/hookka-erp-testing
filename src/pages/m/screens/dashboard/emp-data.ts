// Data layer of the /m Home Employees view. The desktop's own endpoints and response shapes
// (dashboards/EmployeesDashboard.tsx); nothing new on the server. A section the reader may not see reads DENIED
// (a client permission is missing, or the server answered 401 / 403) - never empty, never a quiet zero.
import { useEffect, useMemo, useState } from "react";
import { cachedFetchJsonResult, useCachedJson } from "@/lib/cached-fetch";
import { useLabourCost } from "../../../dashboards/use-labour-cost";
import { shiftMonth, ymd } from "../../../dashboards/dashboard-shared-lib";
import { slotStatus, sectionStatus, type Avail, type Status } from "./ops-lib";
import { labourStateOf, type EmpSlice, type LabourState } from "./emp-lib";

/** What this user may read, from usePermissions (client-side; the server still decides). */
export type EmpAccess = {
  /** The Employees view itself (tab list, or workers:read for an unrestricted role). */
  view: boolean;
  workers: boolean;       // the feed's employee section; GET /api/workers
  payroll: boolean;       // desktop salary gate
  payslips: boolean;      // GET /api/pay-rules (labour inputs)
  revenueFigures: boolean;// GET /api/working-hour-entries/production-revenue (department output)
};

export const FEED_URL = "/api/dashboard/prototype";
export type EmpFeed = {
  success?: boolean;
  meta?: { config?: { efficiencyTargetPct?: number }; months?: string[]; monthsWithSales?: string[] };
  availability?: { employee?: Avail };
  employee?: EmpSlice | null;
};
type SplitLite = { revenue?: { bucket: string; production?: { total?: number } }[] };
type Slot = { data: unknown; loading: boolean; failure: { status: number } | null };
const EMPTY = new Map<string, { total: number }>();

/** Production revenue per day (the Upholstery rule), month by month, with a real denied / error status. */
function useDailyRevenue(months: readonly string[], enabled: boolean) {
  const key = enabled ? months.join(",") : "";
  const [st, setSt] = useState<{ key: string; status: Status; byDay: Map<string, { total: number }> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(key.split(",").map((ym) => cachedFetchJsonResult<SplitLite>(`/api/dashboard/overview/revenue-split?period=${ym}`))).then((rs) => {
      if (!live) return;
      const bad = rs.find((r) => !r.ok);
      if (bad && !bad.ok) { setSt({ key, status: bad.status === 401 || bad.status === 403 ? "denied" : "error", byDay: EMPTY }); return; }
      const byDay = new Map<string, { total: number }>();
      for (const r of rs) if (r.ok) for (const b of r.data?.revenue ?? []) byDay.set(b.bucket, { total: b.production?.total ?? 0 });
      setSt({ key, status: "ready", byDay });
    });
    return () => { live = false; };
  }, [key]);
  const cur = st && st.key === key ? st : null;
  return { status: (cur?.status ?? "loading") as Status, byDay: cur?.byDay ?? EMPTY };
}

export function useEmpFeed(access: EmpAccess) {
  const on = access.view;
  const feed = useCachedJson<EmpFeed>(on ? FEED_URL : null);
  const feedStatus = slotStatus(feed as Slot, on);
  const section = sectionStatus(feedStatus, feed.data?.employee, feed.data?.availability?.employee);
  return {
    status: section.status, reason: section.reason, employee: feed.data?.employee ?? null,
    target: feed.data?.meta?.config?.efficiencyTargetPct ?? 100,
    months: feed.data?.meta?.monthsWithSales ?? feed.data?.meta?.months ?? [],
    refresh: feed.refresh,
  };
}

export type { LabourState } from "./emp-lib";

const monthsOfRange = (from: string, to: string): string[] => {
  if (!from || !to) return [];
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
};

/**
 * Whether the salary RATES the desktop hook (useLabourCost) used were really answered. That hook quietly falls back
 * to each worker's basic salary when /api/workers/salary/effective fails, so a failure there is invisible in its
 * output. The same URL is asked here (the in-flight request is shared) and a failure is reported, never ignored.
 */
function useSalaryRates(months: readonly string[], enabled: boolean) {
  const key = enabled ? months.join(",") : "";
  const [st, setSt] = useState<{ key: string; ok: boolean; status: number } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(key.split(",").map((ym) => cachedFetchJsonResult<unknown>(`/api/workers/salary/effective?period=${ym}`))).then((rs) => {
      if (!live) return;
      const bad = rs.find((r) => !r.ok);
      setSt({ key, ok: !bad, status: bad && !bad.ok ? bad.status : 0 });
    });
    return () => { live = false; };
  }, [key]);
  const cur = st && st.key === key ? st : null;
  return { ready: !!cur?.ok, failStatus: cur && !cur.ok ? (cur.status || 500) : 0 };
}

/** Salary, revenue and department output for the window. Each part has its own status. */
export function useEmpMoney(a: { access: EmpAccess; from: string; to: string; anchor: string; winFrom: string; winTo: string; revMonths: readonly string[]; today: string }) {
  const { access, from, to, anchor, winFrom, winTo, revMonths } = a;
  // Salary: the desktop gate is payroll:read, but its inputs are gated by workers:read and payslips:read on the server.
  // Without all three the salary is DENIED (stated), never quietly zero or wrong (the same rule as Operations Costing).
  const canSalary = access.payroll && access.workers && access.payslips;
  const labour = useLabourCost(from, to, canSalary);
  const prevYm = anchor ? shiftMonth(anchor.slice(0, 7), -1) : "";
  const prevTo = prevYm ? ymd(new Date(Number(prevYm.slice(0, 4)), Number(prevYm.slice(5, 7)), 0)) : "";
  const prevLabour = useLabourCost(prevYm ? `${prevYm}-01` : "", prevTo, canSalary);
  const on = canSalary && !!from && !!to;
  const wk = useCachedJson<{ data?: unknown[] }>(on ? "/api/workers" : null);
  const he = useCachedJson<{ data?: unknown[] }>(on ? `/api/working-hour-entries?from=${from}&to=${to}` : null);
  // The pay rules and the public holidays feed the same calculation. useLabourCost treats a missing answer as
  // "default rules / no holidays", so a salary can be computed from fallbacks without anyone being told.
  const rules = useCachedJson<{ data?: unknown }>(on ? "/api/pay-rules" : null);
  const hol = useCachedJson<{ data?: unknown }>(on ? "/api/kv-config/public_holidays" : null);
  const rateMonths = useMemo(() => [...new Set([...monthsOfRange(from, to), ...(prevYm ? [prevYm] : [])])], [from, to, prevYm]);
  const rates = useSalaryRates(rateMonths, on);
  const rulesFail = !rules.data && rules.failure ? rules.failure.status : 0;
  const holFail = !hol.data && hol.failure ? hol.failure.status : 0;
  const failed: { what: string; status: number }[] = [
    ...(wk.failure ? [{ what: "workers", status: wk.failure.status }] : []),
    ...(he.failure ? [{ what: "hour entries", status: he.failure.status }] : []),
    ...(rulesFail ? [{ what: "pay rules", status: rulesFail }] : []),
    ...(holFail ? [{ what: "public holidays", status: holFail }] : []),
    ...(rates.failStatus ? [{ what: "salary rates", status: rates.failStatus }] : []),
  ];
  const labourState: LabourState = labourStateOf({
    canSalary, failureStatuses: failed.map((f) => f.status), ready: labour.ready,
    wkRows: wk.data ? (wk.data.data ?? []).length : null, heRows: he.data ? (he.data.data ?? []).length : null,
    inputsReady: !!rules.data && !!hol.data && rates.ready,
  });
  const labourWhy = failed.length ? failed.map((f) => f.what).join(", ") : "";

  const revenue = useDailyRevenue(revMonths, revMonths.length > 0);

  // Department output: each department's progressive revenue (Labor Cost report's Category Revenue).
  const prog = useCachedJson<{ data?: { byDeptCategory?: Record<string, number> } }>(access.revenueFigures && winFrom ? `/api/working-hour-entries/production-revenue?from=${winFrom}&to=${winTo}` : null);
  const progStatus = slotStatus(prog as Slot, access.revenueFigures);
  const progByDeptRaw = useMemo(() => prog.data?.data?.byDeptCategory, [prog.data]);
  return {
    canSalary, labour, prevLabour, labourState, labourWhy,
    revenue,
    prog: { status: winFrom ? progStatus : ("loading" as Status), byDeptCategory: progByDeptRaw },
    prevYm,
  };
}
