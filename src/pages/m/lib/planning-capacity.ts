// ===========================================================================
// Planning (mobile) — Capacity Overview + Capacity Loading maths.
//
// There is NO capacity API: the desktop Planning page computes everything in
// the browser from the production-orders list (job cards, `jobCards-lite`), so
// this file is a faithful port of src/pages/planning/index.tsx:
//   • recentWorkingDays / upcomingWorkingDays / countWorkingDays   (L399-439)
//   • scopeRange                                                   (L896-918)
//   • capacityData (daily capacity, backlog, scope load)           (L936-1067)
//   • dailyLoadingByDept (past production + future load)           (L1104-1268)
// Only the worker headcount is left out (the mobile cards never show it, and
// it is the one input that needs `workers:read`). tests/m-planning.test.mjs
// pins every rule here against hand-computed fixtures AND greps the desktop
// source for the constants and filters, so a desktop change fails the test.
//
// Pure functions, `now` injectable, no React.
// ===========================================================================
import { jcMinutesTotal } from "../../../lib/job-card-minutes";

export type PlanJobCard = {
  id?: string;
  departmentCode: string;
  status: string;
  dueDate?: string | null;
  completedDate?: string | null;
  estMinutes?: number | null;
  actualMinutes?: number | null;
  wipLabel?: string | null;
  wipQty?: number | null;
};

export type PlanOrder = {
  id: string;
  poNo: string;
  lineNo?: number | null;
  companySOId?: string | null;
  salesOrderNo?: string | null;
  customerPOId?: string | null;
  productCode?: string | null;
  productName?: string | null;
  fabricCode?: string | null;
  customerName?: string | null;
  itemCategory?: string | null;
  status: string;
  currentDepartment?: string | null;
  targetEndDate?: string | null;
  customerDeliveryDate?: string | null;
  jobCards: PlanJobCard[];
};

// Same list and order as desktop `DEPARTMENTS` (index.tsx:138).
export const PLAN_DEPARTMENTS = [
  { code: "FAB_CUT", name: "Fabric Cutting", shortName: "Fab Cut" },
  { code: "FAB_SEW", name: "Fabric Sewing", shortName: "Fab Sew" },
  { code: "WOOD_CUT", name: "Wood Cutting", shortName: "Wood Cut" },
  { code: "FOAM_CUTTING", name: "Foam Cutting", shortName: "Foam Cut" },
  { code: "FOAM", name: "Foam Bonding", shortName: "Foam Bonding" },
  { code: "FIBRE", name: "Fibre", shortName: "Fibre" },
  { code: "FRAMING", name: "Framing", shortName: "Framing" },
  { code: "WEBBING", name: "Webbing", shortName: "Webbing" },
  { code: "UPHOLSTERY", name: "Upholstery", shortName: "Upholstery" },
  { code: "PACKING", name: "Packing", shortName: "Packing" },
] as const;

export const ROLLING_WINDOW_DAYS = 14;
export const LOADING_PAST_DAYS = 14;
export const LOADING_FUTURE_DAYS = 21;

export type CapacityScope = "today" | "week" | "month";
export type LoadingCategory = "ALL" | "BEDFRAME" | "SOFA";

export function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** A working day = Mon-Sat and not a public holiday. Walks back from YESTERDAY. */
export function recentWorkingDays(count: number, holidays: Set<string>, now: Date = new Date()): string[] {
  const days: string[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - 1);
  let guard = 0;
  while (days.length < count && guard < count * 10 + 60) {
    guard++;
    const iso = fmtISO(cursor);
    if (cursor.getDay() !== 0 && !holidays.has(iso)) days.unshift(iso);
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

/** Working days starting TODAY (today included). */
export function upcomingWorkingDays(count: number, holidays: Set<string>, now: Date = new Date()): string[] {
  const days: string[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  let guard = 0;
  while (days.length < count && guard < count * 10 + 60) {
    guard++;
    const iso = fmtISO(cursor);
    if (cursor.getDay() !== 0 && !holidays.has(iso)) days.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function countWorkingDays(from: Date, to: Date, holidays: Set<string>): number {
  let n = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d <= end) {
    if (d.getDay() !== 0 && !holidays.has(fmtISO(d))) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export type ScopeRange = { from: string; to: string; workingDays: number; label: string };

export function scopeRange(scope: CapacityScope, holidays: Set<string>, now: Date = new Date()): ScopeRange {
  const today = fmtISO(now);
  if (scope === "today") return { from: today, to: today, workingDays: 1, label: "Today" };
  if (scope === "week") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    return {
      from: fmtISO(monday),
      to: fmtISO(saturday),
      workingDays: countWorkingDays(monday, saturday, holidays),
      label: "This Week",
    };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: fmtISO(first), to: fmtISO(last), workingDays: countWorkingDays(first, last, holidays), label: "This Month" };
}

const jcMinutes = (jc: PlanJobCard, useActual: boolean): number => {
  const perUnit = useActual ? jc.actualMinutes ?? jc.estMinutes ?? 0 : jc.estMinutes ?? 0;
  return jcMinutesTotal(perUnit, jc);
};

const isDoneStatus = (s: string) => s === "COMPLETED" || s === "TRANSFERRED";
const isOpenOrder = (o: PlanOrder) => o.status === "IN_PROGRESS" || o.status === "PENDING";

/** Rolling daily capacity of one department (desktop capacityData, L981-995). */
export function dailyCapacityOf(orders: PlanOrder[], deptCode: string, holidays: Set<string>, now: Date = new Date()): number {
  const windowSet = new Set(recentWorkingDays(ROLLING_WINDOW_DAYS, holidays, now));
  let total = 0;
  for (const order of orders) {
    for (const jc of order.jobCards) {
      if (jc.departmentCode !== deptCode) continue;
      if (!isDoneStatus(jc.status)) continue;
      if (!jc.completedDate) continue;
      if (!windowSet.has(jc.completedDate)) continue;
      total += jcMinutes(jc, true);
    }
  }
  return Math.round(total / ROLLING_WINDOW_DAYS);
}

export type DeptCapacity = {
  code: string;
  name: string;
  dailyCapacity: number;
  sofaBacklog: number;
  bfBacklog: number;
  totalBacklog: number;
  totalBacklogDays: number;
  sofaScopeLoad: number;
  bfScopeLoad: number;
  totalScopeLoad: number;
  sofaScopeUtilization: number;
  bfScopeUtilization: number;
  totalScopeUtilization: number;
  scopeCapacity: number;
  /** Active SOFA/BEDFRAME job cards counted in the scope load (dueDate <= scope end). */
  jobsInScope: number;
  /** Active SOFA/BEDFRAME job cards whose dept due date is before today. */
  overdueCount: number;
};

export type CapacitySummary = {
  scope: ScopeRange;
  depts: DeptCapacity[];
  totalCapacity: number;
  totalScopeCapacity: number;
  totalBacklog: number;
  totalBacklogDays: number;
  totalScopeLoad: number;
  totalSofaScopeLoad: number;
  totalBfScopeLoad: number;
  sofaScopeUtilization: number;
  bfScopeUtilization: number;
  totalScopeUtilization: number;
  /** Departments sorted by pressure (highest first) are in `depts` already. */
};

export function buildCapacity(
  orders: PlanOrder[],
  scope: CapacityScope,
  holidays: Set<string>,
  now: Date = new Date(),
): CapacitySummary {
  const range = scopeRange(scope, holidays, now);
  const today = fmtISO(now);
  const scopeDays = Math.max(range.workingDays, 1);

  const depts = PLAN_DEPARTMENTS.map((dept): DeptCapacity => {
    const dailyCapacity = dailyCapacityOf(orders, dept.code, holidays, now);

    const sofaActive: PlanJobCard[] = [];
    const bfActive: PlanJobCard[] = [];
    for (const order of orders) {
      if (!isOpenOrder(order)) continue;
      for (const jc of order.jobCards) {
        if (jc.departmentCode !== dept.code) continue;
        if (jc.status === "COMPLETED" || jc.status === "CANCELLED" || jc.status === "TRANSFERRED") continue;
        if (order.itemCategory === "SOFA") sofaActive.push(jc);
        else if (order.itemCategory === "BEDFRAME") bfActive.push(jc);
      }
    }

    const sofaBacklog = sofaActive.reduce((s, jc) => s + jcMinutes(jc, false), 0);
    const bfBacklog = bfActive.reduce((s, jc) => s + jcMinutes(jc, false), 0);
    const totalBacklog = sofaBacklog + bfBacklog;
    const safeDays = (mins: number) => (dailyCapacity > 0 ? Math.round((mins / dailyCapacity) * 10) / 10 : 0);

    const inScope = (jc: PlanJobCard) => !!jc.dueDate && jc.dueDate <= range.to;
    const sofaScopeLoad = sofaActive.filter(inScope).reduce((s, jc) => s + jcMinutes(jc, false), 0);
    const bfScopeLoad = bfActive.filter(inScope).reduce((s, jc) => s + jcMinutes(jc, false), 0);
    const totalScopeLoad = sofaScopeLoad + bfScopeLoad;

    const scopeCapacity = dailyCapacity * scopeDays;
    const denomScope = scopeCapacity > 0 ? scopeCapacity : 1;

    const active = [...sofaActive, ...bfActive];
    return {
      code: dept.code,
      name: dept.name,
      dailyCapacity,
      sofaBacklog,
      bfBacklog,
      totalBacklog,
      totalBacklogDays: safeDays(totalBacklog),
      sofaScopeLoad,
      bfScopeLoad,
      totalScopeLoad,
      sofaScopeUtilization: Math.round((sofaScopeLoad / denomScope) * 100),
      bfScopeUtilization: Math.round((bfScopeLoad / denomScope) * 100),
      totalScopeUtilization: Math.round((totalScopeLoad / denomScope) * 100),
      scopeCapacity,
      jobsInScope: active.filter(inScope).length,
      overdueCount: active.filter((jc) => !!jc.dueDate && jc.dueDate < today).length,
    };
  });

  const totalCapacity = depts.reduce((s, d) => s + d.dailyCapacity, 0);
  const totalScopeCapacity = depts.reduce((s, d) => s + d.scopeCapacity, 0);
  const totalBacklog = depts.reduce((s, d) => s + d.sofaBacklog + d.bfBacklog, 0);
  const totalSofaScopeLoad = depts.reduce((s, d) => s + d.sofaScopeLoad, 0);
  const totalBfScopeLoad = depts.reduce((s, d) => s + d.bfScopeLoad, 0);
  const totalScopeLoad = totalSofaScopeLoad + totalBfScopeLoad;
  const pct = (n: number) => (totalScopeCapacity > 0 ? Math.round((n / totalScopeCapacity) * 100) : 0);

  return {
    scope: range,
    depts,
    totalCapacity,
    totalScopeCapacity,
    totalBacklog,
    totalBacklogDays: totalCapacity > 0 ? Math.round((totalBacklog / totalCapacity) * 10) / 10 : 0,
    totalScopeLoad,
    totalSofaScopeLoad,
    totalBfScopeLoad,
    sofaScopeUtilization: pct(totalSofaScopeLoad),
    bfScopeUtilization: pct(totalBfScopeLoad),
    totalScopeUtilization: pct(totalScopeLoad),
  };
}

/** Desktop `utilizationColor` bands (index.tsx:441): >90 red, >=70 amber, else green. */
export type PressureBand = "high" | "busy" | "normal";
export function pressureBand(pct: number): PressureBand {
  if (pct > 90) return "high";
  if (pct >= 70) return "busy";
  return "normal";
}

/** Desktop Capacity Loading levels (index.tsx:1217-1221): >100, >90, >70. */
export type LoadingLevel = "critical" | "high" | "medium" | "low";
export function loadingLevel(utilization: number): LoadingLevel {
  if (utilization > 100) return "critical";
  if (utilization > 90) return "high";
  if (utilization > 70) return "medium";
  return "low";
}

export type LoadingJob = {
  orderId: string;
  poNo: string;
  productName: string;
  customerName: string;
  category: string;
  wipLabel: string | null;
  minutes: number;
};

export type LoadingDay = {
  date: string;
  minutes: number;
  utilization: number;
  level: LoadingLevel;
  jobs: LoadingJob[];
};

export type DeptLoading = {
  deptCode: string;
  /** Effective daily capacity under the category filter (minutes). */
  dailyCapacityMinutes: number;
  fullDailyCapacity: number;
  past: LoadingDay[];
  future: LoadingDay[];
};

export function buildLoading(
  orders: PlanOrder[],
  deptCode: string,
  category: LoadingCategory,
  holidays: Set<string>,
  now: Date = new Date(),
): DeptLoading {
  const pastDays = recentWorkingDays(LOADING_PAST_DAYS, holidays, now);
  const pastIndex = new Set(pastDays);
  const futureDays = upcomingWorkingDays(LOADING_FUTURE_DAYS, holidays, now);
  const futureIndex = new Set(futureDays);

  const futureMins = new Map<string, number>();
  const futureJobs = new Map<string, LoadingJob[]>();
  const pastMins = new Map<string, number>();
  const catPast = { bedframe: 0, sofa: 0 };

  for (const order of orders) {
    const isBedframe = order.itemCategory === "BEDFRAME";
    const isSofa = order.itemCategory === "SOFA";
    const passesFilter = category === "ALL" || order.itemCategory === category;
    for (const jc of order.jobCards) {
      if (jc.departmentCode !== deptCode) continue;
      if (
        passesFilter &&
        isOpenOrder(order) &&
        jc.dueDate &&
        futureIndex.has(jc.dueDate) &&
        jc.status !== "COMPLETED" &&
        jc.status !== "CANCELLED" &&
        jc.status !== "TRANSFERRED"
      ) {
        const mins = jcMinutesTotal(jc.estMinutes || 0, jc);
        futureMins.set(jc.dueDate, (futureMins.get(jc.dueDate) ?? 0) + mins);
        const list = futureJobs.get(jc.dueDate) ?? [];
        list.push({
          orderId: order.id,
          poNo: order.poNo,
          productName: order.productName ?? "",
          customerName: order.customerName ?? "",
          category: order.itemCategory ?? "",
          wipLabel: jc.wipLabel ?? null,
          minutes: jcMinutesTotal(jc.estMinutes ?? 0, jc),
        });
        futureJobs.set(jc.dueDate, list);
      }
      if (isDoneStatus(jc.status) && jc.completedDate && pastIndex.has(jc.completedDate)) {
        const mins = jcMinutesTotal(jc.actualMinutes ?? jc.estMinutes ?? 0, jc);
        if (passesFilter) pastMins.set(jc.completedDate, (pastMins.get(jc.completedDate) ?? 0) + mins);
        if (isBedframe) catPast.bedframe += mins;
        else if (isSofa) catPast.sofa += mins;
      }
    }
  }

  const fullDailyCapacity = dailyCapacityOf(orders, deptCode, holidays, now);
  const totalCatPast = catPast.bedframe + catPast.sofa;
  let share = 1;
  if (category === "BEDFRAME") share = totalCatPast > 0 ? catPast.bedframe / totalCatPast : 1;
  else if (category === "SOFA") share = totalCatPast > 0 ? catPast.sofa / totalCatPast : 1;
  const dailyCap = fullDailyCapacity * share;
  const denom = dailyCap > 0 ? dailyCap : 1;
  const util = (m: number) => (dailyCap > 0 ? Math.round((m / denom) * 100) : 0);

  return {
    deptCode,
    dailyCapacityMinutes: dailyCap,
    fullDailyCapacity,
    past: pastDays.map((date) => {
      const minutes = pastMins.get(date) ?? 0;
      const utilization = util(minutes);
      return { date, minutes, utilization, level: loadingLevel(utilization), jobs: [] };
    }),
    future: futureDays.map((date) => {
      const minutes = futureMins.get(date) ?? 0;
      const utilization = util(minutes);
      const jobs = (futureJobs.get(date) ?? []).slice().sort((a, b) => b.minutes - a.minutes);
      return { date, minutes, utilization, level: loadingLevel(utilization), jobs };
    }),
  };
}

/** Desktop `formatHours` look: minutes → "7.5h" / "12h" (one decimal under 10h). */
export function hoursLabel(minutes: number): string {
  const h = minutes / 60;
  if (!Number.isFinite(h) || h <= 0) return "0h";
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

/**
 * Capacity Loading bar colours (desktop index.tsx L2523-2537). They are NOT the
 * overview bands: past production reads as "good" when it meets the average
 * (>=80 green, >=50 amber, else red); planned load is "bad" when it exceeds it
 * (>120 red, >=90 amber, else green).
 */
export type BarTone = "success" | "warning" | "danger";
export function pastBarTone(utilization: number): BarTone {
  if (utilization >= 80) return "success";
  if (utilization >= 50) return "warning";
  return "danger";
}
export function futureBarTone(utilization: number): BarTone {
  if (utilization > 120) return "danger";
  if (utilization >= 90) return "warning";
  return "success";
}
