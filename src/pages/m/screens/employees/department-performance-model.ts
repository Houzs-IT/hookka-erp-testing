// department-performance-model.ts — Employees → Department Performance (HK-0125 Phase 5a). Pure: no React, no clock.
//
// The figures are the API's own (GET /api/department-performance, `workers:read`): the server computes every efficiency, so nothing
// here re-derives one. This file only decides how a figure is SHOWN, following desktop's Department Performance tab:
//   • efficiency text: "—" when no hours were clocked (workingMinutes <= 0) or, for a worker, when the API flags a helper (杂工);
//     the day / average figure has one decimal, a worker's figure none (desktop's drill-down), colours >= 80 green, >= 60 amber,
//     otherwise red, grey when there is no efficiency;
//   • a helper worker carries a "Helper" tag and "—" for efficiency, where the API flags it. (Desktop's "Overall x% (incl. helpers)"
//     line and its provenance caption are NOT shown on the phone — owner 2026-11-17.)
import { fmtHM } from "./efficiency-model";

export type DpCategory = "" | "SOFA" | "BEDFRAME";
export const DP_PARAMS = ["dpd", "dpc"] as const;

export type DpJob = { jobCardId: string; productCode?: string; productName?: string; wipLabel?: string | null; poNo?: string | null; productionMinutes: number };
export type DpWorker = {
  workerId: string;
  workerName?: string;
  workingMinutes: number;
  productionMinutes: number;
  efficiencyPct: number;
  isHelper?: boolean;
  jobs?: DpJob[];
};
export type DpDaily = {
  date: string;
  workingMinutes: number;
  productionMinutes: number;
  efficiencyPct: number;
  overallPct?: number;
  helperWorkingMinutes?: number;
  workers?: DpWorker[];
};
export type DpTotals = {
  workingMinutes: number;
  productionMinutes: number;
  efficiencyPct: number;
  workerCount: number;
  cards?: number;
  measuredCards?: number;
  overallPct?: number;
  helperWorkingMinutes?: number;
};
export type DpData = { range?: { from: string; to: string }; departmentCode?: string | null; category?: string | null; totals: DpTotals; daily: DpDaily[] };

/** Only SOFA and BEDFRAME exist on the API; anything else means "all". */
export function parseCategory(raw: string | null): DpCategory {
  const v = (raw ?? "").trim().toUpperCase();
  return v === "SOFA" || v === "BEDFRAME" ? v : "";
}

/** The list request: the SUMMARY view (totals + one row per day, no worker / job arrays — the full payload is ~9.5 MB for 61 days). */
export function listUrl(range: { from: string; to: string }, dept: string, cat: DpCategory): string {
  return `/api/department-performance?view=summary&from=${range.from}&to=${range.to}&departmentCode=${encodeURIComponent(dept)}&category=${cat}`;
}

/** One tapped day: the SAME endpoint and filters for that single date, full payload (workers and their job cards). */
export function dayUrl(date: string, dept: string, cat: DpCategory): string {
  return `/api/department-performance?from=${date}&to=${date}&departmentCode=${encodeURIComponent(dept)}&category=${cat}`;
}

/**
 * The PRINT request: the same endpoint and filters over the whole period, full payload (every day with its workers) — what desktop's
 * Print Report walks. Large for a long period (the summary view exists for that reason), so it is requested only once the "..." menu
 * has been opened, never to draw the list.
 */
export function fullUrl(range: { from: string; to: string }, dept: string, cat: DpCategory): string {
  return `/api/department-performance?from=${range.from}&to=${range.to}&departmentCode=${encodeURIComponent(dept)}&category=${cat}`;
}

export const dmy = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd);

export const GREY = "#9A9082";
/** Desktop's thresholds for this tab: >= 80 green, >= 60 amber, else red; grey when there is no efficiency. */
export function effColor(pct: number, hasEfficiency: boolean): string {
  if (!hasEfficiency) return GREY;
  return pct >= 80 ? "#4F7C3A" : pct >= 60 ? "#9C6F1E" : "#9A3A2D";
}

const minutes = (m: number) => (m > 0 ? fmtHM(m) : "—");

export type Kpi = { l: string; v: string; fg: string };
export function kpiCells(t: DpTotals | null): Kpi[] {
  const has = !!t && t.workingMinutes > 0;
  return [
    { l: "Workers", v: t ? String(t.workerCount) : "—", fg: "#1F1D1B" },
    { l: "Hours worked", v: t ? minutes(t.workingMinutes) : "—", fg: "#1F1D1B" },
    { l: "Earned time", v: t ? minutes(t.productionMinutes) : "—", fg: "#1F1D1B" },
    { l: "Avg Efficiency", v: has ? `${t.efficiencyPct.toFixed(1)}%` : "—", fg: effColor(t?.efficiencyPct ?? 0, has) },
  ];
}

export type DayCard = { date: string; label: string; hours: string; earned: string; eff: string; fg: string };
/** Newest day first (the approved HTML; the API sends oldest first). */
export function dayCards(daily: readonly DpDaily[]): DayCard[] {
  return [...daily]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => {
      const has = d.workingMinutes > 0;
      return { date: d.date, label: dmy(d.date), hours: minutes(d.workingMinutes), earned: minutes(d.productionMinutes), eff: has ? `${d.efficiencyPct.toFixed(1)}%` : "—", fg: effColor(d.efficiencyPct, has) };
    });
}

export type JobView = { id: string; title: string; code: string; po: string; earned: string };
export type WorkerView = { id: string; name: string; isHelper: boolean; hours: string; earned: string; eff: string; fg: string; jobs: JobView[] };

/** The day's workers, most hours first; jobs, most earned time first (desktop's order). */
export function dayWorkers(day: DpDaily | null): WorkerView[] {
  return [...(day?.workers ?? [])]
    .sort((a, b) => b.workingMinutes - a.workingMinutes)
    .map((w) => {
      const none = w.workingMinutes <= 0 || !!w.isHelper;
      return {
        id: w.workerId,
        name: w.workerName || w.workerId,
        isHelper: !!w.isHelper,
        hours: minutes(w.workingMinutes),
        earned: minutes(w.productionMinutes),
        eff: none ? "—" : `${w.efficiencyPct.toFixed(0)}%`,
        fg: effColor(w.efficiencyPct, !none),
        jobs: [...(w.jobs ?? [])]
          .sort((a, b) => b.productionMinutes - a.productionMinutes)
          .map((j) => ({ id: j.jobCardId, title: j.wipLabel || j.productName || j.productCode || "—", code: j.productCode || "", po: j.poNo || "", earned: fmtHM(j.productionMinutes) })),
      };
    });
}

/** The day page title: the department (or "All departments") with the category when one is chosen. The date goes underneath. */
export function scopeTitle(deptName: string | null, cat: DpCategory): string {
  return `${deptName || "All departments"}${cat ? ` · ${cat === "SOFA" ? "Sofa" : "Bedframe"}` : ""}`;
}

export function filterCount(dept: string, cat: DpCategory): number {
  return (dept ? 1 : 0) + (cat ? 1 : 0);
}
