// ---------------------------------------------------------------------------
// Department completed — Floor Live (owner 2026-11-12).
//
// What each department finished, counted the way Active Jobs and Completed
// count: bedframe = units (every piece, production_orders.quantity —
// headboard / divan included), sofa = sets (1 order = 1 set, distinct order).
// A department finishes a production order when ITS last job card for that
// order closes (the per-(PO, department) gate of dept-revenue.ts).
//
// Owner rulings (2026-11-12):
//   - outsourced work IS counted, in the counts and in the value (owner first
//     said 「不算」, then 「outsource 也要算department revenue的」 / 「sofa set
//     也要include outsource」 and picked "Bedframe 和 Sofa 都算外包");
//   - a cancelled order's finished work stays counted ("做了的就不能取消了");
//   - the comparison is the department's average over the last 12 working
//     days (owner: 「我觉得你还是用12天工作天平均把 … 那个数据看起来太夸张了」 —
//     the best-day mark was too high; same 12-day window as capacity).
// Read-only.
// ---------------------------------------------------------------------------

import type { DeptRevenueRow } from "./dept-revenue";

type Db = {
  prepare(sql: string): { bind(...args: unknown[]): { all<T = unknown>(): Promise<{ results?: T[] }> } };
};

export type DeptDayCount = { dept: string; date: string; bedframeUnits: number; sofaSets: number };
export type DeptCompleted = {
  dept: string;
  bedframeUnits: number;
  sofaSets: number;
  /** Average per working day over the last USUAL_WORKING_DAYS (1 decimal). */
  usualBedframe: number;
  usualSofa: number;
};

const DONE = `jc.status IN ('COMPLETED','TRANSFERRED') AND jc.completedDate IS NOT NULL`;
const PER_PO_DEPT = `
  per_po_dept AS (
    SELECT jc.productionOrderId,
           jc.departmentCode,
           MAX(CASE WHEN ${DONE} THEN jc.completedDate END) AS done_at
      FROM job_cards jc
     WHERE jc.departmentCode IS NOT NULL
     GROUP BY jc.productionOrderId, jc.departmentCode
    HAVING COUNT(*) > 0
       AND SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) = COUNT(*)
  )`;
const ORDER_KEY = `COALESCE(po.salesOrderId, po.consignmentOrderId, po.id)`;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Per department per day, every day on record (for the best day and the drill).
 *  orgId null = every org (the worker portal is single-org, like the rest of worker.ts). */
export async function loadDeptCompletedByDay(db: Db, orgId: string | null): Promise<DeptDayCount[]> {
  const res = await db
    .prepare(
      `WITH ${PER_PO_DEPT}
       SELECT d.departmentCode AS "dept",
              substr(d.done_at::text, 1, 10) AS "day",
              SUM(CASE WHEN po.itemCategory = 'BEDFRAME' THEN po.quantity ELSE 0 END) AS "bed",
              COUNT(DISTINCT CASE WHEN po.itemCategory = 'SOFA' THEN ${ORDER_KEY} END) AS "sofa"
         FROM per_po_dept d
         JOIN production_orders po ON po.id = d.productionOrderId
        WHERE ${orgId === null ? "TRUE" : "po.orgId = ?"}
          AND d.done_at IS NOT NULL
        GROUP BY d.departmentCode, substr(d.done_at::text, 1, 10)`,
    )
    .bind(...(orgId === null ? [] : [orgId]))
    .all<{ dept: string | null; day: string | null; bed: unknown; sofa: unknown }>();
  const out: DeptDayCount[] = [];
  for (const r of res.results ?? []) {
    const date = String(r.day ?? "").slice(0, 10);
    if (!r.dept || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ dept: r.dept, date, bedframeUnits: num(r.bed), sofaSets: num(r.sofa) });
  }
  return out;
}

/** One day straight from the per-day rows (same numbers as the range query for a single day). */
export function dayCounts(days: DeptDayCount[], date: string): Map<string, { bedframeUnits: number; sofaSets: number }> {
  return new Map(days.filter((d) => d.date === date).map((d) => [d.dept, { bedframeUnits: d.bedframeUnits, sofaSets: d.sofaSets }]));
}

/** Per department over [from, to] — a sofa order finishing across two days counts once. */
export async function loadDeptCompletedRange(db: Db, orgId: string, from: string, to: string): Promise<Map<string, { bedframeUnits: number; sofaSets: number }>> {
  const res = await db
    .prepare(
      `WITH ${PER_PO_DEPT}
       SELECT d.departmentCode AS "dept",
              SUM(CASE WHEN po.itemCategory = 'BEDFRAME' THEN po.quantity ELSE 0 END) AS "bed",
              COUNT(DISTINCT CASE WHEN po.itemCategory = 'SOFA' THEN ${ORDER_KEY} END) AS "sofa"
         FROM per_po_dept d
         JOIN production_orders po ON po.id = d.productionOrderId
        WHERE po.orgId = ?
          AND d.done_at IS NOT NULL
          AND substr(d.done_at::text, 1, 10) >= ?
          AND substr(d.done_at::text, 1, 10) <= ?
        GROUP BY d.departmentCode`,
    )
    .bind(orgId, from, to)
    .all<{ dept: string | null; bed: unknown; sofa: unknown }>();
  const out = new Map<string, { bedframeUnits: number; sofaSets: number }>();
  for (const r of res.results ?? []) if (r.dept) out.set(r.dept, { bedframeUnits: num(r.bed), sofaSets: num(r.sofa) });
  return out;
}

export const USUAL_WORKING_DAYS = 12;

/** Each department's average per working day over the last USUAL_WORKING_DAYS
 *  before `today`. A working day = a date on which the plant completed
 *  anything (Sundays and holidays have none), so a department's quiet day
 *  counts as 0 — the average is what the department does on a plant day. */
export function usualDays(days: DeptDayCount[], today: string): Map<string, { bed: number; sofa: number }> {
  const dates = [...new Set(days.filter((d) => d.date < today && d.bedframeUnits + d.sofaSets > 0).map((d) => d.date))]
    .sort()
    .slice(-USUAL_WORKING_DAYS);
  const win = new Set(dates);
  const n = dates.length || 1;
  const sums = new Map<string, { bed: number; sofa: number }>();
  for (const d of days) {
    if (!win.has(d.date)) continue;
    const s = sums.get(d.dept) ?? { bed: 0, sofa: 0 };
    s.bed += d.bedframeUnits;
    s.sofa += d.sofaSets;
    sums.set(d.dept, s);
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return new Map([...sums].map(([k, v]) => [k, { bed: r1(v.bed / n), sofa: r1(v.sofa / n) }]));
}

/** The period's count plus each department's 12-working-day average, one row per department that has any. */
export function shapeDeptCompleted(
  range: Map<string, { bedframeUnits: number; sofaSets: number }>,
  days: DeptDayCount[],
  today: string,
): DeptCompleted[] {
  const usual = usualDays(days, today);
  const depts = new Set<string>([...range.keys(), ...usual.keys()]);
  return [...depts].map((dept) => {
    const r = range.get(dept) ?? { bedframeUnits: 0, sofaSets: 0 };
    const u = usual.get(dept) ?? { bed: 0, sofa: 0 };
    return { dept, bedframeUnits: r.bedframeUnits, sofaSets: r.sofaSets, usualBedframe: u.bed, usualSofa: u.sofa };
  });
}

// ---- Production value beside the counts (owner 2026-11-12) -----------------
// Department Revenue's own rows and rule (dept-revenue.ts loadDeptRevenue):
// an order's full value when this department's last card for it closes.
// Outsourced work counted, like the piece counts above.
export type CatSen = { bedframeSen: number; sofaSen: number };

export function valueByDept(rows: DeptRevenueRow[], from: string, to: string): Map<string, CatSen> {
  const out = new Map<string, CatSen>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const v = out.get(r.deptCode) ?? { bedframeSen: 0, sofaSen: 0 };
    if (r.category === "BEDFRAME") v.bedframeSen += r.totalSen;
    else if (r.category === "SOFA") v.sofaSen += r.totalSen;
    out.set(r.deptCode, v);
  }
  return out;
}

/** Key `${dept}|${date}`. */
export function valueByDay(rows: DeptRevenueRow[]): Map<string, CatSen> {
  const out = new Map<string, CatSen>();
  for (const r of rows) {
    const k = `${r.deptCode}|${r.date}`;
    const v = out.get(k) ?? { bedframeSen: 0, sofaSen: 0 };
    if (r.category === "BEDFRAME") v.bedframeSen += r.totalSen;
    else if (r.category === "SOFA") v.sofaSen += r.totalSen;
    out.set(k, v);
  }
  return out;
}
