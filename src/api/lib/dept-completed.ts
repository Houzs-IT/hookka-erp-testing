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
//   - outsourced work is not counted, neither in the day nor in the best day
//     (a (PO, department) with any card done by an is_outsource worker drops);
//   - a cancelled order's finished work stays counted ("做了的就不能取消了");
//   - the comparison is the department's best day on record, not an average.
// Read-only.
// ---------------------------------------------------------------------------

type Db = {
  prepare(sql: string): { bind(...args: unknown[]): { all<T = unknown>(): Promise<{ results?: T[] }> } };
};

export type DeptDayCount = { dept: string; date: string; bedframeUnits: number; sofaSets: number };
export type DeptBest = { n: number; date: string | null };
export type DeptCompleted = {
  dept: string;
  bedframeUnits: number;
  sofaSets: number;
  bestBedframe: DeptBest;
  bestSofa: DeptBest;
};

const DONE = `jc.status IN ('COMPLETED','TRANSFERRED') AND jc.completedDate IS NOT NULL`;
const PER_PO_DEPT = `
  per_po_dept AS (
    SELECT jc.productionOrderId,
           jc.departmentCode,
           MAX(CASE WHEN ${DONE} THEN jc.completedDate END) AS done_at
      FROM job_cards jc
      LEFT JOIN workers w ON w.id = jc.pic1Id
     WHERE jc.departmentCode IS NOT NULL
     GROUP BY jc.productionOrderId, jc.departmentCode
    HAVING COUNT(*) > 0
       AND SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) = COUNT(*)
       AND SUM(CASE WHEN COALESCE(w.isOutsource, FALSE) = TRUE THEN 1 ELSE 0 END) = 0
  )`;
const ORDER_KEY = `COALESCE(po.salesOrderId, po.consignmentOrderId, po.id)`;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Per department per day, every day on record (for the best day and the drill). */
export async function loadDeptCompletedByDay(db: Db, orgId: string): Promise<DeptDayCount[]> {
  const res = await db
    .prepare(
      `WITH ${PER_PO_DEPT}
       SELECT d.departmentCode AS "dept",
              substr(d.done_at::text, 1, 10) AS "day",
              SUM(CASE WHEN po.itemCategory = 'BEDFRAME' THEN po.quantity ELSE 0 END) AS "bed",
              COUNT(DISTINCT CASE WHEN po.itemCategory = 'SOFA' THEN ${ORDER_KEY} END) AS "sofa"
         FROM per_po_dept d
         JOIN production_orders po ON po.id = d.productionOrderId
        WHERE po.orgId = ?
          AND d.done_at IS NOT NULL
        GROUP BY d.departmentCode, substr(d.done_at::text, 1, 10)`,
    )
    .bind(orgId)
    .all<{ dept: string | null; day: string | null; bed: unknown; sofa: unknown }>();
  const out: DeptDayCount[] = [];
  for (const r of res.results ?? []) {
    const date = String(r.day ?? "").slice(0, 10);
    if (!r.dept || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ dept: r.dept, date, bedframeUnits: num(r.bed), sofaSets: num(r.sofa) });
  }
  return out;
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

/** Best day per department (ties keep the earliest day). */
export function bestDays(days: DeptDayCount[]): Map<string, { bed: DeptBest; sofa: DeptBest }> {
  const out = new Map<string, { bed: DeptBest; sofa: DeptBest }>();
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const d of sorted) {
    const b = out.get(d.dept) ?? { bed: { n: 0, date: null }, sofa: { n: 0, date: null } };
    if (d.bedframeUnits > b.bed.n) b.bed = { n: d.bedframeUnits, date: d.date };
    if (d.sofaSets > b.sofa.n) b.sofa = { n: d.sofaSets, date: d.date };
    out.set(d.dept, b);
  }
  return out;
}

/** The period's count plus each department's best day, one row per department that has any. */
export function shapeDeptCompleted(
  range: Map<string, { bedframeUnits: number; sofaSets: number }>,
  days: DeptDayCount[],
): DeptCompleted[] {
  const best = bestDays(days);
  const depts = new Set<string>([...range.keys(), ...best.keys()]);
  return [...depts].map((dept) => {
    const r = range.get(dept) ?? { bedframeUnits: 0, sofaSets: 0 };
    const b = best.get(dept) ?? { bed: { n: 0, date: null }, sofa: { n: 0, date: null } };
    return { dept, bedframeUnits: r.bedframeUnits, sofaSets: r.sofaSets, bestBedframe: b.bed, bestSofa: b.sofa };
  });
}
