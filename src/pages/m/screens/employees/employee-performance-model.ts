// employee-performance-model.ts — the rules behind Employees → Employee Performance (HK-0125 Phase 4, step 2). Pure.
//
// One worker over the shared period. The efficiency figure, Hours worked, Non-Production Hours and Days Present are NOT
// recomputed here: the screen builds that worker's row with the SAME `buildEfficiencyRows` the Efficiency Overview ranking uses,
// from the same cached requests, so the percentage on the ranking card and on this screen cannot differ.
//
// Extra Production Time is a SEPARATE, display-only tile. It never feeds the efficiency calculation (the job-cards summary the
// ranking reads already contains approved extra time, once). `extraProduction` shows the approved amount only when it can be
// VERIFIED, otherwise "—": see its comment.

import { addDaysYmd, monthRange, thisMonthRange, type YmdRange } from "./employees-dates";

// ---- navigation: ranking <-> Employee Performance ----------------------------------------------------------------------

export const EP_PARAMS = ["worker", "ref"] as const;

/** Ranking → Employee Performance: same range (`from` / `to` untouched) and the ranking's search (`eq`) carried along. */
export function toEmployeePerformance(prev: URLSearchParams, workerId: string): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.set("section", "employee-performance");
  next.set("worker", workerId);
  next.set("ref", "efficiency");
  return next;
}

/** Back link: the ranking with the current range and the search it was left with. */
export function backToEfficiency(prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.set("section", "efficiency");
  for (const k of EP_PARAMS) next.delete(k);
  return next;
}

// ---- period chips (HTML `EP` chips: Today · 7d · 30d · This month · Last month) --------------------------------------------

export type EpChip = { key: "today" | "7d" | "30d" | "month" | "last"; label: string; range: YmdRange };

export function epChips(today: string): EpChip[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return [
    { key: "today", label: "Today", range: { from: today, to: today } },
    { key: "7d", label: "7d", range: { from: addDaysYmd(today, -6), to: today } },
    { key: "30d", label: "30d", range: { from: addDaysYmd(today, -29), to: today } },
    { key: "month", label: "This month", range: thisMonthRange(today) },
    { key: "last", label: "Last month", range: m === 1 ? monthRange(y - 1, 12) : monthRange(y, m - 1) },
  ];
}

export function activeChip(range: YmdRange, today: string): EpChip["key"] | null {
  return epChips(today).find((c) => c.range.from === range.from && c.range.to === range.to)?.key ?? null;
}

// ---- the worker picker -------------------------------------------------------------------------------------------------

export type EpWorker = {
  id: string;
  empNo?: string;
  name?: string;
  status?: string;
  departmentCode?: string;
  position?: string;
  joinDate?: string;
  isHelper?: boolean;
  is_helper?: boolean;
};

const isTest = (w: EpWorker) => /^TEST/i.test(w.empNo || "");
const byEmpNo = (a: EpWorker, b: EpWorker) => (a.empNo || "~").localeCompare(b.empNo || "~") || a.id.localeCompare(b.id);

/** Active, non-test workers in employee-number order, plus the selected worker even when inactive (so a ranking tap always lands). */
export function pickerWorkers(workers: readonly EpWorker[], selectedId: string): EpWorker[] {
  const list = workers.filter((w) => w.id && ((w.status === "ACTIVE" && !isTest(w)) || w.id === selectedId));
  return list.sort(byEmpNo);
}

/** The worker asked for in the URL when it exists (any status), else the first available one; null when there is none. */
export function resolveWorker(param: string | null, workers: readonly EpWorker[]): EpWorker | null {
  const hit = param ? workers.find((w) => w.id === param) : undefined;
  if (hit) return hit;
  return pickerWorkers(workers, "")[0] ?? null;
}

export function workerLabel(w: EpWorker): string {
  return w.empNo ? `${w.empNo} — ${w.name || w.id}` : w.name || w.id;
}

export function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

// ---- Daily Breakdown: the worker's completed job cards ------------------------------------------------------------------

export type JobCardRow = {
  id?: string;
  productCode?: string;
  wipCode?: string;
  wipLabel?: string;
  wipQty?: number;
  departmentCode?: string;
  completedDate?: string | null;
  /** The card's TOTAL time (per-unit minutes × quantity). */
  productionTimeMinutes?: number;
  status?: string;
  hasBothPics?: boolean;
};

export type BreakdownRow = {
  key: string;
  primary: string;
  secondary: string;
  /** The card's completion date (the only date the job-card response carries). */
  date: string;
  completedDate: string;
  dept: string;
  deptName: string;
  qty: number | null;
  /** This worker's credited time: half of the card when two people share it, the whole card otherwise. */
  creditedMin: number;
  totalMin: number;
  shared: boolean;
  status: "COMPLETED" | "TRANSFERRED" | "OTHER";
  statusLabel: string;
};

/** Desktop's rule (employees.tsx Daily Breakdown): only cards with a completion date; newest first. */
export function breakdownRows(cards: readonly JobCardRow[], deptName: (code: string) => string): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  cards.forEach((jc, i) => {
    if (!jc.completedDate) return;
    const total = Number(jc.productionTimeMinutes) || 0;
    const shared = Boolean(jc.hasBothPics);
    const code = jc.productCode || jc.wipCode || "—";
    const primary = jc.wipLabel || code;
    const status = jc.status === "COMPLETED" ? "COMPLETED" : jc.status === "TRANSFERRED" ? "TRANSFERRED" : "OTHER";
    rows.push({
      key: jc.id || `jc-${i}`,
      primary,
      secondary: jc.wipLabel && code !== "—" && jc.wipLabel !== code ? code : "",
      date: jc.completedDate,
      completedDate: jc.completedDate,
      dept: jc.departmentCode || "—",
      deptName: jc.departmentCode ? deptName(jc.departmentCode) : "—",
      qty: jc.wipQty && jc.wipQty > 0 ? jc.wipQty : null,
      creditedMin: shared ? total / 2 : total,
      totalMin: total,
      shared,
      status,
      statusLabel: status === "COMPLETED" ? "Completed" : status === "TRANSFERRED" ? "Transferred" : String(jc.status || "—"),
    });
  });
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export function filterBreakdown(rows: readonly BreakdownRow[], q: string): BreakdownRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...rows];
  return rows.filter((r) => `${r.primary} ${r.secondary} ${r.dept} ${r.deptName}`.toLowerCase().includes(s));
}

export const sumCredited = (rows: readonly BreakdownRow[]) => rows.reduce((s, r) => s + r.creditedMin, 0);

export type StatCell =
  | { k: string; kind: "date"; v: string }
  | { k: string; kind: "text"; v: string }
  | { k: string; kind: "minutes"; minutes: number }
  | { k: string; kind: "credited"; minutes: number };

/**
 * The cells of one card, two columns: Date · Department, then Qty · Total JC Time. Following desktop, there is ONE date: the
 * job-card response carries only `completedDate`, and desktop's Date and Completion Date columns both read it, so the duplicate
 * "Completion Date" is not shown. "Total JC Time" is the card's FULL duration (`productionTimeMinutes` = per-unit minutes ×
 * quantity). A shared job adds "Credited time" (this worker's half, with a ½ marker) on a third row, so the full duration and the
 * worker's share are never mistaken for each other.
 */
export function breakdownStats(r: BreakdownRow): StatCell[] {
  const cells: StatCell[] = [
    { k: "Date", kind: "date", v: r.date },
    { k: "Department", kind: "text", v: r.deptName },
    { k: "Qty", kind: "text", v: r.qty === null ? "—" : String(r.qty) },
    { k: "Total JC Time", kind: "minutes", minutes: r.totalMin },
  ];
  if (r.shared) cells.push({ k: "Credited time", kind: "credited", minutes: r.creditedMin });
  return cells;
}

// ---- Extra Production Time tile (separate from efficiency) ---------------------------------------------------------------

export type ExtraClaim = {
  workerId?: string;
  kind?: string;
  status?: string;
  date?: string;
  hours?: number | string | null;
  approvedHours?: number | string | null;
};

/** The server caps these two lists; a list at its cap may be missing rows, so it can't prove anything. */
export const CLAIMS_CAP = 200;
export const JOB_CARDS_CAP = 5000;

export type ExtraResult = { state: "ok"; minutes: number } | { state: "unverified" };

/**
 * The approved extra production time of one worker in the period — shown ONLY when it can be verified, otherwise "—".
 * It is verified when ALL of these hold:
 *   1. the approved-claims list loaded and is below its 200-row cap (a full list may be missing older rows);
 *   2. the worker's job-card list loaded and is below its 5,000-row cap;
 *   3. the job-cards summary figure (the efficiency numerator) is available;
 *   4. the claims total AGREES (within 1 minute) with what the summary says is left after the job cards:
 *        summary minutes − the worker's credited job-card minutes.
 * The claims amount uses the approved hours (partly approved claims count what was approved, as the server does), only
 * APPROVED extra-time claims dated inside the period. The amount is only displayed; it is never added to anything.
 */
export function extraProduction(input: {
  workerId: string;
  range: YmdRange;
  claims: readonly ExtraClaim[] | null;
  cards: readonly JobCardRow[] | null;
  summaryMin: number | null;
}): ExtraResult {
  const { workerId, range, claims, cards, summaryMin } = input;
  if (claims === null || cards === null || summaryMin === null) return { state: "unverified" };
  if (claims.length >= CLAIMS_CAP || cards.length >= JOB_CARDS_CAP) return { state: "unverified" };
  let claimed = 0;
  for (const c of claims) {
    if (c.workerId !== workerId || c.kind !== "ADD_PROD" || c.status !== "APPROVED") continue;
    const d = (c.date ?? "").slice(0, 10);
    if (!d || d < range.from || d > range.to) continue;
    const h = Number(c.approvedHours ?? c.hours) || 0;
    claimed += Math.round(h * 60);
  }
  const credited = breakdownRows(cards, () => "").reduce((s, r) => s + r.creditedMin, 0);
  const left = summaryMin - credited;
  if (Math.abs(left - claimed) > 1) return { state: "unverified" };
  return { state: "ok", minutes: claimed };
}

// ---- Total OT ----------------------------------------------------------------------------------------------------------

export type AttendanceOt = { employeeId?: string; overtimeMinutes?: number | string | null };

export function totalOtMinutes(rows: readonly AttendanceOt[], workerId: string): number {
  return rows.reduce((s, r) => (r.employeeId === workerId ? s + (Number(r.overtimeMinutes) || 0) : s), 0);
}

// ---- Info card -----------------------------------------------------------------------------------------------------------

export function statusTone(status: string | undefined): { label: string; bg: string; fg: string } {
  const s = (status || "").toUpperCase();
  if (s === "ACTIVE") return { label: "Active", bg: "#EEF3E4", fg: "#3D6229" };
  const label = s ? s.charAt(0) + s.slice(1).toLowerCase() : "—";
  return { label, bg: "#F0ECE9", fg: "#4D4630" };
}

