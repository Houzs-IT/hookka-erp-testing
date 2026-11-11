// ---------------------------------------------------------------------------
// dept-revenue.ts — /dashboard "Department Revenue" + the Revenue chart's
// Bedframe / Sofa split (owner 2026-10-15).
//
// DEPARTMENT REVENUE uses the Production Revenue rule (production-revenue.ts,
// which is the UPHOLSTERY rule) with the department swapped in: department X
// books a production order's FULL value — SO line → CO line → product master
// price, × qty — on the day the LAST of that order's department-X job cards
// completes, and only once every one of them is COMPLETED/TRANSFERRED with a
// completedDate. Every department books the full value, so a RM 2,000 sofa
// through 9 departments shows RM 18,000 across the departments; equal rows
// mean balanced output. An order with no card in a department books nothing
// there. The UPHOLSTERY row therefore equals the chart's Production line.
//
// This is NOT the Labor Cost tab's "category revenue" (working-hour-entries.ts),
// which splits one order's value across departments by minutes so the slices
// sum to the order value. Both exist on purpose.
//
// CATEGORY SPLIT of the Revenue chart's three lines:
//   Production   — po.itemCategory, exact.
//   Sales Orders — each SO's totalSen allocated over its lines' item_category
//                  in proportion to line_total_sen (last bucket absorbs the
//                  rounding), so Bedframe + Sofa + Accessory + Unclassified
//                  equals the existing All line to the sen.
//   Invoices     — same allocation of totalSen, a line's category read from
//                  products.category by product code (the invoice posting in
//                  routes/invoices.ts splits sales accounts the same way).
//   A document whose lines carry no category / no positive total books under
//   `unclassified`: it counts in All only, never guessed into Bedframe.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";

type Db = Env["Variables"]["DB"];

export type RevCategory = "BEDFRAME" | "SOFA" | "ACCESSORY";
export type CatSplit = { bedframe: number; sofa: number; accessory: number; unclassified: number; total: number };

export const emptyCatSplit = (): CatSplit => ({ bedframe: 0, sofa: 0, accessory: 0, unclassified: 0, total: 0 });

/** Production departments in flow order, with the labels the app shows. */
export const DEPT_REVENUE_ORDER: { code: string; label: string }[] = [
  { code: "FAB_CUT", label: "Fabric Cutting" },
  { code: "FAB_SEW", label: "Fabric Sewing" },
  { code: "WOOD_CUT", label: "Wood Cutting" },
  { code: "FOAM_CUTTING", label: "Foam Cutting" },
  { code: "FOAM", label: "Foam Bonding" },
  { code: "FIBRE", label: "Fibre" },
  { code: "FRAMING", label: "Framing" },
  { code: "WEBBING", label: "Webbing" },
  { code: "UPHOLSTERY", label: "Upholstery" },
  { code: "PACKING", label: "Packing" },
];

function addTo(split: CatSplit, cat: string | null | undefined, sen: number): void {
  if (cat === "BEDFRAME") split.bedframe += sen;
  else if (cat === "SOFA") split.sofa += sen;
  else if (cat === "ACCESSORY") split.accessory += sen;
  else split.unclassified += sen;
  split.total += sen;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** YYYY-MM-DD of a date/timestamp value, or null. */
export function isoDay(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ""));
  return m ? m[1] : null;
}

/** Monday (YYYY-MM-DD) of the ISO week containing `day` — Postgres date_trunc('week'). */
export function weekMonday(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Department revenue
// ---------------------------------------------------------------------------

export type DeptRevenueRow = { deptCode: string; date: string; category: RevCategory; totalSen: number };

/**
 * One row per (production order, department) whose department cards ALL
 * completed, with the last completion inside [from, to] (YYYY-MM-DD,
 * inclusive). The per-PO gate is production-revenue.ts's, grouped by
 * department as well.
 */
export async function loadDeptRevenue(db: Db, orgId: string, from: string, to: string): Promise<DeptRevenueRow[]> {
  const res = await db
    .prepare(
      `WITH per_po_dept AS (
         SELECT productionOrderId,
                departmentCode,
                MAX(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completedDate IS NOT NULL
                         THEN completedDate END) AS done_at
           FROM job_cards
          WHERE departmentCode IS NOT NULL
          GROUP BY productionOrderId, departmentCode
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN status IN ('COMPLETED','TRANSFERRED')
                              AND completedDate IS NOT NULL
                         THEN 1 ELSE 0 END) = COUNT(*)
       )
       SELECT d.departmentCode AS "deptCode",
              substr(d.done_at::text, 1, 10) AS "day",
              po.itemCategory AS "category",
              COALESCE(
                soi.unitPriceSen,
                coi.unitPriceSen,
                (SELECT COALESCE(p.basePriceSen, p.price1Sen)
                   FROM products p
                  WHERE p.code = po.productCode
                  ORDER BY p.basePriceSen DESC NULLS LAST, p.id
                  LIMIT 1),
                0
              ) * po.quantity AS "totalSen"
         FROM per_po_dept d
         JOIN production_orders po ON po.id = d.productionOrderId
         LEFT JOIN sales_order_items soi
                ON soi.salesOrderId = po.salesOrderId AND soi.lineNo = po.lineNo
         LEFT JOIN consignment_order_items coi
                ON coi.consignmentOrderId = po.consignmentOrderId AND coi.lineNo = po.lineNo
        WHERE po.orgId = ?
          AND po.itemCategory IN ('SOFA','BEDFRAME','ACCESSORY')
          AND d.done_at IS NOT NULL
          AND substr(d.done_at::text, 1, 10) >= ?
          AND substr(d.done_at::text, 1, 10) <= ?`,
    )
    .bind(orgId, from, to)
    .all<{ deptCode: string | null; day: string | null; category: string | null; totalSen: number | string | null }>();
  const out: DeptRevenueRow[] = [];
  for (const r of res.results ?? []) {
    const date = isoDay(r.day);
    if (!date || !r.deptCode) continue;
    if (r.category !== "SOFA" && r.category !== "BEDFRAME" && r.category !== "ACCESSORY") continue;
    out.push({ deptCode: r.deptCode, date, category: r.category, totalSen: Math.round(num(r.totalSen)) });
  }
  return out;
}

export type DeptRevenueSummary = {
  code: string;
  label: string;
  period: CatSplit;
  /** Same order as `buckets`. */
  byBucket: CatSplit[];
};

/**
 * Group department rows into the dashboard's buckets. `bucketOf` maps a day
 * to its bucket key (the day itself for a month, the week's Monday for
 * all-time); a day outside every bucket still counts in `period`. Departments
 * in DEPT_REVENUE_ORDER always appear (a zero row is information); any other
 * department code that booked revenue is appended after them.
 */
export function summarizeDeptRevenue(
  rows: DeptRevenueRow[],
  buckets: string[],
  bucketOf: (day: string) => string,
): DeptRevenueSummary[] {
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const byDept = new Map<string, DeptRevenueSummary>();
  const ensure = (code: string, label: string) => {
    let s = byDept.get(code);
    if (!s) {
      s = { code, label, period: emptyCatSplit(), byBucket: buckets.map(() => emptyCatSplit()) };
      byDept.set(code, s);
    }
    return s;
  };
  for (const d of DEPT_REVENUE_ORDER) ensure(d.code, d.label);
  for (const r of rows) {
    const s = ensure(r.deptCode, r.deptCode);
    addTo(s.period, r.category, r.totalSen);
    const i = idx.get(bucketOf(r.date));
    if (i !== undefined) addTo(s.byBucket[i], r.category, r.totalSen);
  }
  return [...byDept.values()];
}

// ---------------------------------------------------------------------------
// Sales Orders / Invoices split by category
// ---------------------------------------------------------------------------

export type DocLine = { docId: string; day: string; docTotalSen: number; category: string | null; lineSen: number };

/**
 * Allocate each document's total over its lines' categories in proportion to
 * the line amounts; the last category absorbs the rounding so the parts sum
 * to the document total exactly. No usable line → all of it is unclassified.
 * Returns one split per bucket (same order as `buckets`).
 */
export function allocateDocsByCategory(
  lines: DocLine[],
  buckets: string[],
  bucketOf: (day: string) => string,
): CatSplit[] {
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const out = buckets.map(() => emptyCatSplit());
  const docs = new Map<string, { day: string; total: number; byCat: Map<string, number> }>();
  for (const l of lines) {
    let d = docs.get(l.docId);
    if (!d) {
      d = { day: l.day, total: l.docTotalSen, byCat: new Map() };
      docs.set(l.docId, d);
    }
    const cat = l.category === "BEDFRAME" || l.category === "SOFA" || l.category === "ACCESSORY" ? l.category : "";
    if (l.lineSen > 0) d.byCat.set(cat, (d.byCat.get(cat) ?? 0) + l.lineSen);
  }
  for (const d of docs.values()) {
    const i = idx.get(bucketOf(d.day));
    if (i === undefined) continue;
    const parts = [...d.byCat.entries()];
    const base = parts.reduce((s, [, v]) => s + v, 0);
    if (base <= 0) {
      addTo(out[i], null, d.total);
      continue;
    }
    let allocated = 0;
    parts.forEach(([cat, v], k) => {
      const amt = k === parts.length - 1 ? d.total - allocated : Math.round((v / base) * d.total);
      allocated += amt;
      addTo(out[i], cat || null, amt);
    });
  }
  return out;
}

/** Sales-order lines for SOs dated in [from, to] — the Revenue chart's SO filter. */
export async function loadSoLines(db: Db, orgId: string, from: string, to: string): Promise<DocLine[]> {
  const res = await db
    .prepare(
      `SELECT so.id AS "docId",
              substr(so.companySODate::text, 1, 10) AS "day",
              so.totalSen AS "docTotalSen",
              si.itemCategory AS "category",
              si.lineTotalSen AS "lineSen"
         FROM sales_orders so
         LEFT JOIN sales_order_items si ON si.salesOrderId = so.id
        WHERE so.orgId = ? AND so.status NOT IN ('DRAFT','CANCELLED','ON_HOLD')
          AND so.companySODate IS NOT NULL
          AND substr(so.companySODate::text, 1, 10) >= ?
          AND substr(so.companySODate::text, 1, 10) <= ?`,
    )
    .bind(orgId, from, to)
    .all<{ docId: string; day: string | null; docTotalSen: unknown; category: string | null; lineSen: unknown }>();
  return toLines(res.results ?? []);
}

/** Invoice lines for invoices dated in [from, to], excluding CANCELLED — the Revenue chart's Invoices filter. */
export async function loadInvoiceLines(db: Db, orgId: string, from: string, to: string): Promise<DocLine[]> {
  const res = await db
    .prepare(
      `SELECT inv.id AS "docId",
              substr(inv.invoiceDate::text, 1, 10) AS "day",
              inv.totalSen AS "docTotalSen",
              (SELECT p.category FROM products p WHERE p.code = ii.productCode ORDER BY p.id LIMIT 1) AS "category",
              ii.totalSen AS "lineSen"
         FROM invoices inv
         LEFT JOIN invoice_items ii ON ii.invoiceId = inv.id
        WHERE inv.orgId = ? AND inv.status != 'CANCELLED' AND inv.invoiceDate IS NOT NULL
          AND substr(inv.invoiceDate::text, 1, 10) >= ?
          AND substr(inv.invoiceDate::text, 1, 10) <= ?`,
    )
    .bind(orgId, from, to)
    .all<{ docId: string; day: string | null; docTotalSen: unknown; category: string | null; lineSen: unknown }>();
  return toLines(res.results ?? []);
}

function toLines(
  rows: { docId: string; day: string | null; docTotalSen: unknown; category: string | null; lineSen: unknown }[],
): DocLine[] {
  const out: DocLine[] = [];
  for (const r of rows) {
    const day = isoDay(r.day);
    if (!day || !r.docId) continue;
    out.push({
      docId: r.docId,
      day,
      docTotalSen: Math.round(num(r.docTotalSen)),
      category: r.category,
      lineSen: Math.round(num(r.lineSen)),
    });
  }
  return out;
}

/** Production line by category: the UPHOLSTERY department's rows, bucketed. */
export function productionByCategory(
  rows: DeptRevenueRow[],
  buckets: string[],
  bucketOf: (day: string) => string,
): CatSplit[] {
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const out = buckets.map(() => emptyCatSplit());
  for (const r of rows) {
    if (r.deptCode !== "UPHOLSTERY") continue;
    const i = idx.get(bucketOf(r.date));
    if (i !== undefined) addTo(out[i], r.category, r.totalSen);
  }
  return out;
}

/**
 * The Revenue chart's buckets, exactly as dashboard-overview.ts builds them:
 * a month → every day from the 1st to `end` (today for the running month);
 * all-time → the 12 ISO-week Mondays ending this week.
 */
export function revenueBuckets(
  period: string,
  todayISO: string,
): { from: string; to: string; buckets: string[]; bucketOf: (day: string) => string } {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const yr = Number(period.slice(0, 4));
    const mo = Number(period.slice(5, 7));
    const first = `${period}-01`;
    const lastDay = new Date(Date.UTC(yr, mo, 0)).toISOString().slice(0, 10);
    const end = todayISO >= first && todayISO < lastDay ? todayISO : lastDay;
    const buckets: string[] = [];
    const cur = new Date(`${first}T00:00:00Z`);
    for (let g = 0; g < 40 && cur.toISOString().slice(0, 10) <= end; g++) {
      buckets.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return { from: first, to: end, buckets, bucketOf: (d) => d };
  }
  // Quarter (YYYY-Qn): Monday-anchored weeks inside the quarter. Year (YYYY):
  // one bucket per month, keyed YYYY-MM-01. Both stop at today.
  const q = period.match(/^(\d{4})-Q([1-4])$/);
  const yr = period.match(/^(\d{4})$/);
  if (q || yr) {
    const y = Number((q ?? yr)![1]);
    const m1 = q ? (Number(q[2]) - 1) * 3 + 1 : 1;
    const months = q ? 3 : 12;
    const first = `${y}-${String(m1).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(y, m1 - 1 + months, 0)).toISOString().slice(0, 10);
    const end = todayISO >= first && todayISO < lastDay ? todayISO : lastDay;
    const buckets: string[] = [];
    if (yr) {
      for (let i = 0; i < 12; i++) {
        const b = `${y}-${String(i + 1).padStart(2, "0")}-01`;
        if (b <= end) buckets.push(b);
      }
      return { from: first, to: end, buckets, bucketOf: (d) => `${d.slice(0, 7)}-01` };
    }
    const cur = new Date(`${weekMonday(first)}T00:00:00Z`);
    for (let g = 0; g < 20 && cur.toISOString().slice(0, 10) <= end; g++) {
      buckets.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
    return { from: first, to: end, buckets, bucketOf: weekMonday };
  }
  const mon = weekMonday(todayISO);
  const buckets: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(`${mon}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    buckets.push(d.toISOString().slice(0, 10));
  }
  const sunday = new Date(`${mon}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { from: buckets[0], to: sunday.toISOString().slice(0, 10), buckets, bucketOf: weekMonday };
}
