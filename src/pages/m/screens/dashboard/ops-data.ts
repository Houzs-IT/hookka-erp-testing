// Data layer of the /m Home Operations view. The desktop's own endpoints and response
// shapes (dashboards/OperationsView.tsx and the cards it mounts); nothing new on the
// server. Every fetch is skipped (URL = null) when the client permission set says the
// section is not the reader's, and the section then reads DENIED - never empty. The
// server stays the authority: a 401 / 403 answer is DENIED too. Loading / error come
// from the real request lifecycle, never from a timer.
import { useCallback, useEffect, useMemo, useState } from "react";
import { cachedFetchJsonResult, useCachedJson, type CachedFetchFailure } from "@/lib/cached-fetch";
import { useLabourCost } from "../../../dashboards/use-labour-cost";
import { ymd, type Period } from "../../../dashboards/dashboard-shared-lib";
import {
  costingMonths, labourPerDay, pnlMaterials, purchasingMonths, sectionStatus, slotStatus,
  type ComplianceData, type CostStructure, type OpsFeed, type OpsOverview, type Pi, type SplitResp, type Status,
} from "./ops-lib";
import { costingFocusMonth } from "./home-lib";

/** What this user may read, from usePermissions (client-side; the server still decides). */
export type OpsAccess = {
  /** The Operations view itself (tab list, or production-orders:read for an unrestricted role). */
  view: boolean;
  salesOrders: boolean;   // Daily Report (compliance.json)
  accounting: boolean;    // P&L cost structure: Costing materials, Purchasing stock
  invoices: boolean;      // D1: Purchasing spend, share, chart, suppliers
  purchaseOrders: boolean;// the outstanding-PO drill
  payroll: boolean;       // desktop Costing labour gate
  workers: boolean;       // GET /api/workers (labour inputs)
  payslips: boolean;      // GET /api/pay-rules (labour inputs)
};

export const FEED_URL = "/api/dashboard/prototype";
type Slot<T> = { data: T | null; loading: boolean; failure: CachedFetchFailure | null };
const EMPTY_REV = new Map<string, { total: number }>();

function useMonthlyRevenue(months: readonly string[], enabled: boolean) {
  const key = enabled ? months.join(",") : "";
  const [tick, setTick] = useState(0);
  const [st, setSt] = useState<{ key: string; tick: number; status: Status; byDay: Map<string, { total: number }> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(key.split(",").map((ym) => cachedFetchJsonResult<SplitResp>(`/api/dashboard/overview/revenue-split?period=${ym}`))).then((rs) => {
      if (!live) return;
      const bad = rs.find((r) => !r.ok);
      if (bad && !bad.ok) {
        setSt({ key, tick, status: bad.status === 401 || bad.status === 403 ? "denied" : "error", byDay: EMPTY_REV });
        return;
      }
      const byDay = new Map<string, { total: number }>();
      for (const r of rs) if (r.ok) for (const b of r.data?.revenue ?? []) byDay.set(b.bucket, { total: b.production?.total ?? 0 });
      setSt({ key, tick, status: "ready", byDay });
    });
    return () => { live = false; };
  }, [key, tick]);
  const cur = st && st.key === key && st.tick === tick ? st : null;
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { status: (cur?.status ?? "loading") as Status, byDay: cur?.byDay ?? EMPTY_REV, refresh };
}

export type LabourState = "denied" | "loading" | "error" | "ready" | "none";

export function useOpsData(a: { periodKey: string; period: Period; sub: "overview" | "production"; access: OpsAccess; today: string }) {
  const { periodKey, period, sub, access, today } = a;
  const on = access.view && periodKey !== "";
  const overviewSub = sub === "overview";

  // ---- the shared feed (also read by useProblemTiles; one cache entry) ------
  const feed = useCachedJson<OpsFeed>(on ? FEED_URL : null);
  const feedStatus = slotStatus(feed as Slot<OpsFeed>, on);
  const production = sectionStatus(feedStatus, feed.data?.production, feed.data?.availability?.production);
  const lim = sectionStatus(feedStatus, feed.data?.lim, feed.data?.availability?.lim);
  const inventory = sectionStatus(feedStatus, feed.data?.inventory, feed.data?.availability?.inventory);

  // ---- overview (Plant Load, Backlog, Purchasing, Fabric) -------------------
  const overview = useCachedJson<OpsOverview>(on ? `/api/dashboard/overview?period=${periodKey}` : null);
  const overviewS = slotStatus(overview as Slot<OpsOverview>, on);

  // ---- Department Revenue ---------------------------------------------------
  const split = useCachedJson<SplitResp>(on && overviewSub ? `/api/dashboard/overview/revenue-split?period=${periodKey}` : null);
  const splitS = slotStatus(split as Slot<SplitResp>, on);

  // ---- Daily Report (compliance.json needs sales-orders:read) ---------------
  const compOn = on && overviewSub && access.salesOrders;
  const compliance = useCachedJson<{ success?: boolean; data?: ComplianceData }>(compOn ? "/api/reports/compliance.json" : null);
  const complianceS = slotStatus({ data: compliance.data?.data ?? null, loading: compliance.loading, failure: compliance.failure }, access.salesOrders);

  // ---- Output & Cost --------------------------------------------------------
  const outOn = on && !overviewSub;
  const focusMonth = useMemo(() => costingFocusMonth(period, today), [period, today]);
  const ytd = period.mode === "ytd";
  const costMonths = useMemo(() => costingMonths(focusMonth, ytd, today), [focusMonth, ytd, today]);
  const pm = useMemo(() => purchasingMonths(periodKey || today.slice(0, 7), today), [periodKey, today]);
  const revMonths = useMemo(() => [...new Set([...costMonths, ...pm.revMonths])].sort(), [costMonths, pm]);
  const revenue = useMonthlyRevenue(revMonths, outOn);

  const csNow = useCachedJson<CostStructure>(outOn && access.accounting ? "/api/accounting/cost-structure" : null);
  const firstFyCol = csNow.data?.data?.cols?.[0] ?? "";
  const needPrevFy = !!firstFyCol && (costMonths[0] ?? "9999") < firstFyCol;
  const csPrev = useCachedJson<CostStructure>(outOn && access.accounting && needPrevFy ? `/api/accounting/cost-structure?fy=${Number(firstFyCol.slice(0, 4)) - 1}` : null);
  const costS = slotStatus(csNow as Slot<CostStructure>, access.accounting);
  // The previous financial year only matters when it is needed; its failure is a gap in the 3-month window.
  const prevS: Status = !needPrevFy ? "ready" : slotStatus(csPrev as Slot<CostStructure>, access.accounting);
  const pnl = useMemo(() => pnlMaterials([csPrev.data, csNow.data], today), [csPrev.data, csNow.data, today]);

  // Labour: the desktop gate is payroll:read, but its inputs are gated by workers:read and payslips:read on the
  // server. Without all three the labour is DENIED (cost is materials only, stated), never quietly zero.
  const canLabour = access.payroll && access.workers && access.payslips;
  const from = `${costMonths[0] ?? today.slice(0, 7)}-01`;
  const lastMonth = costMonths[costMonths.length - 1] ?? today.slice(0, 7);
  const lastOfMonth = ymd(new Date(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0));
  const to = lastOfMonth < today ? lastOfMonth : today;
  const labourOn = outOn && canLabour;
  const labour = useLabourCost(from, to, labourOn);
  // The same URLs the hook reads (one shared request each): they let a settled empty answer be told from "still loading".
  const wk = useCachedJson<{ data?: unknown[] }>(labourOn ? "/api/workers" : null);
  const he = useCachedJson<{ data?: unknown[] }>(labourOn ? `/api/working-hour-entries?from=${from}&to=${to}` : null);
  const labourState: LabourState = !canLabour ? "denied"
    : wk.failure || he.failure ? (wk.failure?.status === 403 || he.failure?.status === 403 ? "denied" : "error")
      : labour.ready ? "ready"
        : wk.data && he.data && ((wk.data.data ?? []).length === 0 || (he.data.data ?? []).length === 0) ? "none"
          : "loading";
  const labourByDay = useMemo(() => labourPerDay(labour.byWorkerDay), [labour.byWorkerDay]);

  // ---- Purchasing -----------------------------------------------------------
  const pis = useCachedJson<{ data?: Pi[] }>(outOn && access.invoices ? "/api/purchase-invoices" : null);
  const pisS = slotStatus(pis as Slot<{ data?: Pi[] }>, access.invoices);

  const refresh = () => {
    feed.refresh(); overview.refresh(); split.refresh(); compliance.refresh(); csNow.refresh(); pis.refresh(); revenue.refresh();
  };

  return {
    feedStatus, feed: feed.data, production, lim, inventory,
    overview: { status: overviewS, data: overview.data },
    split: { status: splitS, data: split.data },
    compliance: { status: complianceS, data: compliance.data?.data ?? null, retry: compliance.refresh },
    revenue,
    cost: { status: costS, prevStatus: prevS, pnl, sets: [csPrev.data, csNow.data] as (CostStructure | null)[] },
    labour: { state: labourState, byDay: labourByDay },
    pis: { status: pisS, rows: pis.data?.data ?? [] },
    focusMonth, costMonths, pm, from, to,
    refresh, retryFeed: feed.refresh, retryOverview: overview.refresh, retrySplit: split.refresh,
  };
}
export type OpsData = ReturnType<typeof useOpsData>;
