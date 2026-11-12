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
//   - the comparison is the department's best day, not an average — over the
//     last 30 days, leaving out a day above 3x that department's usual (the
//     median of its working days) so a bulk back-entry day (Packing 256 on
//     2026-05-05) can't set an unreachable mark (owner 「A」 + 「近一个月就可以了」).
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

export const BEST_WINDOW_DAYS = 30;
export const OUTLIER_X = 3;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** Best day per department within the last BEST_WINDOW_DAYS up to `today`,
 *  a day above OUTLIER_X x the median of the department's non-zero days left
 *  out. Ties keep the earliest day. */
export function bestDays(days: DeptDayCount[], today: string): Map<string, { bed: DeptBest; sofa: DeptBest }> {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (BEST_WINDOW_DAYS - 1));
  const fromYmd = from.toISOString().slice(0, 10);
  const inWin = days.filter((d) => d.date >= fromYmd && d.date <= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDept = new Map<string, DeptDayCount[]>();
  for (const d of inWin) byDept.set(d.dept, [...(byDept.get(d.dept) ?? []), d]);
  const out = new Map<string, { bed: DeptBest; sofa: DeptBest }>();
  for (const [dept, list] of byDept) {
    const pick = (f: (d: DeptDayCount) => number): DeptBest => {
      const cap = OUTLIER_X * median(list.map(f).filter((n) => n > 0));
      let best: DeptBest = { n: 0, date: null };
      for (const d of list) {
        const n = f(d);
        if (n > best.n && n <= cap) best = { n, date: d.date };
      }
      return best;
    };
    out.set(dept, { bed: pick((d) => d.bedframeUnits), sofa: pick((d) => d.sofaSets) });
  }
  return out;
}

/** The period's count plus each department's best day, one row per department that has any. */
export function shapeDeptCompleted(
  range: Map<string, { bedframeUnits: number; sofaSets: number }>,
  days: DeptDayCount[],
  today: string,
): DeptCompleted[] {
  const best = bestDays(days, today);
  const depts = new Set<string>([...range.keys(), ...best.keys()]);
  return [...depts].map((dept) => {
    const r = range.get(dept) ?? { bedframeUnits: 0, sofaSets: 0 };
    const b = best.get(dept) ?? { bed: { n: 0, date: null }, sofa: { n: 0, date: null } };
    return { dept, bedframeUnits: r.bedframeUnits, sofaSets: r.sofaSets, bestBedframe: b.bed, bestSofa: b.sofa };
  });
}
