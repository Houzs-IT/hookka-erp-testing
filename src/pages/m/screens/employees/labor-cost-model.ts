// labor-cost-model.ts — the costing and display rules behind Employees → Labor Cost (HK-0125 Phase 5b). Pure: no React, no clock.
//
// COSTING = DESKTOP'S LABOR COST TAB (`LaborCostTab`, src/pages/employees.tsx): every logged worker-day is priced by the shared
// `workerDayEntryCostsSen` (src/lib/labor-day-cost.ts — the same function the dashboard's Employees tab uses), so — unlike the
// Department Labor tab's own inline loop — hours after a worker's resignation date cost nothing. Entries are grouped into
// (department, category) buckets; the category filter keeps that category AND the uncategorised (non-production) entries. A
// monthly worker with no salary, and a worker id with no record, are skipped. The month's working days are those of the range's
// first month (desktop's rule). Revenue is NOT computed here: the server's `production-revenue` endpoint returns each (department,
// category) slice and the recognised unit rows; this file only shows them.
//
// Display, as in the approved HTML:
//   Production Breakdown — one row per (department, category) of a production department: Hours, Labor cost and, with revenue
//     access, Category revenue and Cost / Revenue (labor ÷ that department's revenue slice; > 30 % red, > 20 % amber, else green);
//     its header counts DISTINCT departments (owner 2026-11-17), not rows.
//   Overhead Breakdown — the non-production departments, each with its bucket: Overhead, Borrowed (Warehousing) or Shortfall.
//   Revenue Raw Data — the recognised units (needs `revenue-figures:read`), newest first.
import { workerDayEntryCostsSen } from "../../../../lib/labor-day-cost";
import { roundWithinGroups } from "../../../../lib/labour-to-payroll";
import { countElapsedWorkingDays, dailyPaidEntryCostSen, isDailyPaidWorker } from "../../../../lib/labor-engine";
import type { PayRuleVersion } from "../../../../lib/pay-rules";
import type { DlDept, DlEntry, DlWorker } from "./department-labor-model";

export type LcCategory = "" | "SOFA" | "BEDFRAME" | "ACCESSORY";
export const LC_PARAMS = ["lcc"] as const;

export function parseLcCategory(raw: string | null): LcCategory {
  const v = (raw ?? "").trim().toUpperCase();
  return v === "SOFA" || v === "BEDFRAME" || v === "ACCESSORY" ? v : "";
}

export type LcRow = {
  id: string;
  deptCode: string;
  deptName: string;
  category: LcCategory;
  hours: number;
  /** Whole sen; 0 and meaningless when the cost data is unavailable. */
  costSen: number;
  revenueSen: number;
  isProduction: boolean;
  isShortfall: boolean;
  isWarehousing: boolean;
};

export type LcResult = {
  /** "unavailable": the data the cost needs did not load — hours only. */
  mode: "ok" | "unavailable";
  production: LcRow[];
  overhead: LcRow[];
  productionSen: number;
  overheadSen: number;
};

const CAT_ORDER: Record<string, number> = { SOFA: 0, BEDFRAME: 1, ACCESSORY: 2, "": 3 };

export function computeLaborCost(input: {
  entries: readonly DlEntry[];
  workers: readonly (DlWorker & { resignedAt?: string | null })[];
  depts: readonly DlDept[];
  holidays: readonly string[];
  versions: readonly PayRuleVersion[];
  effSalary: Readonly<Record<string, number>>;
  range: { from: string; to: string };
  category: LcCategory;
  /** "DEPT|CATEGORY" → attributed revenue (sen), from the production-revenue endpoint; null = revenue not available. */
  byDeptCategory: Readonly<Record<string, number>> | null;
  costDataOk: boolean;
  /** Payroll basis (owner 2026-11-20, same as desktop and the dashboard): `worker|date|dept` → paid sen from
   *  use-labour-cost. Each worker-day-department's paid figure is split over its entries in the shape of their logged cost;
   *  a paid day with no entry here lands on its department's uncategorised line. null = logged-hours value. */
  paidByWdd?: ReadonlyMap<string, number> | null;
}): LcResult {
  const { entries, workers, depts, holidays, effSalary, range, category } = input;
  const versions = input.versions as PayRuleVersion[];
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const deptByCode = new Map(depts.map((d) => [d.code, d]));
  const prodCodes = new Set(depts.filter((d) => d.isProduction).map((d) => d.code));

  const [hYear, hMonth] = range.from.slice(0, 7).split("-").map(Number);
  const actualWorkingDays =
    hYear && hMonth ? Math.max(1, countElapsedWorkingDays(hYear, hMonth, new Date(hYear, hMonth, 0).getDate(), holidays as string[])) : 26;

  const segs = new Map<string, DlEntry[]>();
  for (const e of entries) {
    const k = `${e.workerId}|${e.date}`;
    const arr = segs.get(k) ?? [];
    arr.push(e);
    segs.set(k, arr);
  }
  const catOf = (e: DlEntry) => (typeof e.category === "string" ? e.category.trim().toUpperCase() : "") as LcCategory;

  const buckets = new Map<string, { hours: number; costSen: number }>();
  const put = (key: string, hours: number, cost: number) => {
    const cur = buckets.get(key) ?? { hours: 0, costSen: 0 };
    cur.hours += hours;
    cur.costSen += cost;
    buckets.set(key, cur);
  };
  // Every costed entry, keyed worker|date|department, before the category filter: the payroll scaling's key.
  const segList: { e: DlEntry; hours: number; cost: number; wdd: string }[] = [];
  const add = (e: DlEntry, hours: number, cost: number) => {
    segList.push({ e, hours, cost, wdd: `${e.workerId}|${e.date}|${e.departmentCode || ""}` });
  };

  for (const [k, day] of segs) {
    const [workerId, date] = k.split("|");
    const w = workerById.get(workerId);
    if (!w) continue;
    if (!input.costDataOk) {
      // hours only (a monthly worker with no salary is still skipped, as on desktop)
      if (!isDailyPaidWorker(w) && !w.basicSalarySen) continue;
      for (const e of day) add(e, Number(e.hours) || 0, 0);
      continue;
    }
    if (isDailyPaidWorker(w)) {
      const dayHours = day.reduce((s, e) => s + (Number(e.hours) || 0), 0);
      for (const e of day) {
        const hours = Number(e.hours) || 0;
        add(e, hours, dailyPaidEntryCostSen(w as Parameters<typeof dailyPaidEntryCostSen>[0], hours, dayHours));
      }
      continue;
    }
    if (!w.basicSalarySen) continue;
    const costs = workerDayEntryCostsSen({
      worker: w as Parameters<typeof workerDayEntryCostsSen>[0]["worker"],
      effSalarySen: typeof effSalary[w.id] === "number" ? effSalary[w.id] : (w.basicSalarySen as number),
      date,
      entryHours: day.map((e) => Number(e.hours) || 0),
      actualWorkingDays,
      holidays,
      payRuleVersions: versions,
    });
    day.forEach((e, i) => add(e, Number(e.hours) || 0, costs[i]));
  }

  const paid = input.costDataOk ? input.paidByWdd ?? null : null;
  const byWdd = new Map<string, typeof segList>();
  for (const s of segList) {
    const arr = byWdd.get(s.wdd) ?? [];
    arr.push(s);
    byWdd.set(s.wdd, arr);
  }
  for (const [wdd, list] of byWdd) {
    const target = paid ? paid.get(wdd) ?? 0 : null;
    const costSum = list.reduce((a, s) => a + s.cost, 0);
    const hourSum = list.reduce((a, s) => a + s.hours, 0);
    for (const s of list) {
      const cat = catOf(s.e);
      if (category && cat !== category && cat !== "") continue;
      const share = costSum > 0 ? s.cost / costSum : hourSum > 0 ? s.hours / hourSum : 1 / list.length;
      put(`${s.e.departmentCode}|${cat}`, s.hours, target == null ? s.cost : target * share);
    }
  }
  if (paid) {
    for (const [wdd, sen] of paid) {
      if (!sen || byWdd.has(wdd)) continue;
      put(`${wdd.split("|")[2] ?? ""}|`, 0, sen);
    }
  }

  const rows: LcRow[] = [];
  // Category lines of a department add up to the department's dashboard figure, to the sen.
  const bucketList = [...buckets.entries()];
  const rounded = roundWithinGroups(bucketList.map(([key, b]) => ({ group: key.split("|")[0], sen: b.costSen })));
  for (const [bi, [key, b]] of bucketList.entries()) {
    const [deptCode, cat] = key.split("|") as [string, LcCategory];
    const isProduction = prodCodes.has(deptCode);
    rows.push({
      id: key,
      deptCode,
      deptName: deptByCode.get(deptCode)?.name ?? deptCode,
      category: cat,
      hours: Math.round(b.hours * 100) / 100,
      costSen: input.costDataOk ? rounded[bi] : 0,
      revenueSen: isProduction && cat ? (input.byDeptCategory?.[`${deptCode}|${cat}`] ?? 0) : 0,
      isProduction,
      isShortfall: deptCode === "PRODUCTION_SHORTFALL",
      isWarehousing: deptCode === "WAREHOUSING",
    });
  }
  const order = (code: string) => depts.findIndex((d) => d.code === code);
  rows.sort((a, b) => order(a.deptCode) - order(b.deptCode) || (CAT_ORDER[a.category] ?? 99) - (CAT_ORDER[b.category] ?? 99));
  const production = rows.filter((r) => r.isProduction);
  const overhead = rows.filter((r) => !r.isProduction);
  return {
    mode: input.costDataOk ? "ok" : "unavailable",
    production,
    overhead,
    productionSen: production.reduce((s, r) => s + r.costSen, 0),
    overheadSen: overhead.reduce((s, r) => s + r.costSen, 0),
  };
}

// ---- display ---------------------------------------------------------------------------------------------------------------------

/** The Production Breakdown header counts DISTINCT departments, not (department, category) rows. */
export function productionDeptCount(rows: readonly LcRow[]): number {
  return new Set(rows.map((r) => r.deptCode)).size;
}

export const catLabel = (c: LcCategory | string) => (c ? c.charAt(0) + c.slice(1).toLowerCase() : "—");

export type Ratio = { text: string; fg: string };
/** Cost / Revenue: labor ÷ that department's revenue slice. Over 30 % red, over 20 % amber, else green; "—" without revenue. */
export function costRatio(laborSen: number, revenueSen: number): Ratio {
  if (!(revenueSen > 0)) return { text: "—", fg: "#1F1D1B" };
  const pct = (laborSen / revenueSen) * 100;
  return { text: pct ? `${pct.toFixed(1)}%` : "—", fg: pct > 30 ? "#9A3A2D" : pct > 20 ? "#85600F" : "#3D6229" };
}

export type OverheadBucket = { label: "Overhead" | "Borrowed (Warehousing)" | "Shortfall"; bg: string; fg: string };
export function overheadBucket(r: Pick<LcRow, "isShortfall" | "isWarehousing">): OverheadBucket {
  if (r.isShortfall) return { label: "Shortfall", bg: "#F6E2DE", fg: "#9A3A2D" };
  if (r.isWarehousing) return { label: "Borrowed (Warehousing)", bg: "#FAEFCB", fg: "#85600F" };
  return { label: "Overhead", bg: "#F0ECE9", fg: "#4D4630" };
}

// ---- revenue units ---------------------------------------------------------------------------------------------------------------

export type RevenueUnit = {
  date?: string;
  productCode?: string;
  productName?: string;
  category?: string;
  qty?: number;
  unitPriceSen?: number;
  totalPriceSen?: number;
  customerName?: string;
  soNo?: string;
};

/** The recognised units for the category (the same trim / upper-case normalisation as desktop), newest first. */
export function revenueUnits(rows: readonly RevenueUnit[], category: LcCategory): RevenueUnit[] {
  const norm = (u: RevenueUnit) => (typeof u.category === "string" ? u.category.trim().toUpperCase() : "");
  return rows.filter((u) => !category || norm(u) === category).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function filterUnits(rows: readonly RevenueUnit[], q: string): RevenueUnit[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...rows];
  return rows.filter((u) => `${u.productName ?? ""} ${u.productCode ?? ""} ${u.customerName ?? ""} ${u.soNo ?? ""}`.toLowerCase().includes(s));
}

export type UnitGroup = { date: string; units: number; totalSen: number; rows: RevenueUnit[] };
/** Grouped by date, newest first; each group carries its unit count and revenue. */
export function groupUnits(rows: readonly RevenueUnit[]): UnitGroup[] {
  const by = new Map<string, UnitGroup>();
  for (const u of rows) {
    const d = u.date ?? "";
    const g = by.get(d) ?? { date: d, units: 0, totalSen: 0, rows: [] };
    g.units += 1;
    g.totalSen += Number(u.totalPriceSen) || 0;
    g.rows.push(u);
    by.set(d, g);
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export const unitProduct = (u: RevenueUnit) => u.productName || u.productCode || "—";

export const CAT_TONE: Record<string, { bg: string; fg: string; rail: string }> = {
  SOFA: { bg: "#E0EDF0", fg: "#3E6570", rail: "#3E6570" },
  BEDFRAME: { bg: "#F4EFE6", fg: "#6B5C32", rail: "#8B7A4E" },
  ACCESSORY: { bg: "#F1E6F0", fg: "#6B4A6D", rail: "#6B4A6D" },
};
export const catTone = (c: string | undefined) => CAT_TONE[(c ?? "").trim().toUpperCase()] ?? { bg: "#F0ECE9", fg: "#4D4630", rail: "#9A9082" };
