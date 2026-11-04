// ---------------------------------------------------------------------------
// dashboard-service-sla.ts — the Overdue cases by stage board on the dashboard
// Service tab (GET /api/dashboard/prototype/service-sla).
//
// Built on the server so a role that may see the Service tab needs nothing else
// (owner 2026-11-04: QA sees the Service dashboard only): the Case Pipeline reads
// delivery orders and job cards, and QA holds no delivery-orders:read. Only the
// open cases' own dates and statuses leave here, never a delivery order's value.
// ---------------------------------------------------------------------------
import { caseDaysOpen, caseStageDays, computeCasePipeline, type CasePipelineInput } from "../../lib/case-pipeline";

// Measured on prod 2026-11-04 from the 124 closed cases, days from entering a
// stage to entering the next. Each target is the 75th percentile rounded up, so
// 3 in 4 past cases met it (owner delegated the numbers).
//   stage               cases  median  p75   p90   target
//   Opened               124     0.0   0.0   3.1     1 (floor: a day to pick it up)
//   Investigating         61     0.0   3.1  10.2     4
//   Service Order         59     2.7  10.0  16.1    10
//   Repair in progress    70     4.0   8.0  15.0     8
//   Repair done           55     3.1   5.1   9.1     6
//   Delivery arranged     22     1.3   2.8   5.0     3
//   Delivered             21     3.8   6.0  11.9     6
// Later stages rest on few cases: re-measure once there is more history.
export const STAGE_TARGET_DAYS: Record<string, number> = {
  Opened: 1,
  Investigating: 4,
  "Service Order": 10,
  "Repair in progress": 8,
  "Repair done": 6,
  "Delivery arranged": 3,
  Delivered: 6,
};

export type SlaCase = {
  id: string;
  caseNo: string | null;
  customerName: string | null;
  status: string;
  createdAt: string;
  investigatingAt: string | null;
  issue: string | null;
};
export type SlaOrder = { caseId: string; id: string; status: string; createdAt: string | null; isSv: boolean };
export type SlaDo = CasePipelineInput["dos"][number];
export type SlaPo = CasePipelineInput["pos"][number];

export type SlaRow = {
  id: string;
  caseNo: string | null;
  customerName: string | null;
  issue: string;
  stage: string;
  since: string;
  target: number;
  inStage: number;
  overdue: number;
  age: number;
};

/** Most overdue first, then oldest. Pure: the route below only loads the rows. */
export function buildSlaRows(cases: SlaCase[], orders: SlaOrder[], dos: SlaDo[], pos: SlaPo[], nowMs: number): SlaRow[] {
  return cases
    .map((c) => {
      const mine = orders.filter((o) => o.caseId === c.id);
      const svOrderIds = mine.filter((o) => o.isSv).map((o) => o.id);
      const sv = new Set(svOrderIds);
      const pipe = computeCasePipeline({
        caseStatus: c.status,
        createdAt: c.createdAt,
        investigatingAt: c.investigatingAt,
        closedAt: null,
        orders: mine.map((o) => ({ isSv: o.isSv, status: o.status, createdAt: o.createdAt })),
        dos: dos.filter((d) => d.salesOrderId && sv.has(d.salesOrderId)),
        pos: pos.filter((p) => p.salesOrderId && sv.has(p.salesOrderId)),
        svOrderIds,
      });
      const inStage = caseStageDays(pipe.enteredAt, null, nowMs);
      const target = STAGE_TARGET_DAYS[pipe.label] ?? 0;
      return {
        id: c.id,
        caseNo: c.caseNo,
        customerName: c.customerName,
        issue: (c.issue ?? "").slice(0, 200),
        stage: pipe.label as string,
        since: (pipe.enteredAt ?? "").slice(0, 10),
        target,
        inStage,
        overdue: Math.max(0, inStage - target),
        age: caseDaysOpen(c.createdAt, null, nowMs),
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.age - a.age);
}

const CHUNK = 300;

async function inChunks<T>(ids: string[], run: (chunk: string[], ph: string) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    out.push(...(await run(chunk, chunk.map(() => "?").join(", "))));
  }
  return out;
}

/** The board's rows: every open case, placed on the Case Pipeline. */
export async function loadServiceSla(db: D1Database, nowMs: number): Promise<SlaRow[]> {
  // investigatingat and sales_orders.caseid are runtime-added lowercase columns.
  const caseRes = await db
    .prepare(
      `SELECT id, case_no AS "caseNo", customer_name AS "customerName", status,
              created_at AS "createdAt", investigatingat AS "investigatingAt",
              issue_description AS "issue"
         FROM service_cases
        WHERE status IN ('OPEN', 'IN_PROGRESS')`,
    )
    .all<SlaCase>();
  const cases = caseRes.results ?? [];
  if (cases.length === 0) return [];
  const caseIds = cases.map((c) => c.id);

  const legacy = await inChunks(caseIds, async (chunk, ph) => {
    const r = await db
      .prepare(`SELECT id, caseId AS "caseId", status, created_at AS "createdAt" FROM service_orders WHERE caseId IN (${ph})`)
      .bind(...chunk)
      .all<Omit<SlaOrder, "isSv">>();
    return (r.results ?? []).map((o) => ({ ...o, isSv: false }));
  });
  const svOrders = await inChunks(caseIds, async (chunk, ph) => {
    const r = await db
      .prepare(`SELECT id, caseid AS "caseId", status, created_at AS "createdAt" FROM sales_orders WHERE caseid IN (${ph})`)
      .bind(...chunk)
      .all<Omit<SlaOrder, "isSv">>();
    return (r.results ?? []).map((o) => ({ ...o, isSv: true }));
  });
  const svIds = svOrders.map((o) => o.id);

  const dos = await inChunks(svIds, async (chunk, ph) => {
    const r = await db
      .prepare(
        `SELECT sales_order_id AS "salesOrderId", status, created_at AS "createdAt",
                dispatched_at AS "dispatchedAt", delivered_at AS "deliveredAt"
           FROM delivery_orders WHERE sales_order_id IN (${ph})`,
      )
      .bind(...chunk)
      .all<SlaDo>();
    return r.results ?? [];
  });
  const jobCards = await inChunks(svIds, async (chunk, ph) => {
    const r = await db
      .prepare(
        `SELECT po.sales_order_id AS "salesOrderId", jc.completed_date AS "completedDate"
           FROM production_orders po
           JOIN job_cards jc ON jc.production_order_id = po.id
          WHERE po.sales_order_id IN (${ph}) AND jc.completed_date IS NOT NULL`,
      )
      .bind(...chunk)
      .all<{ salesOrderId: string; completedDate: string }>();
    return r.results ?? [];
  });
  const pos: SlaPo[] = jobCards.map((j) => ({ salesOrderId: j.salesOrderId, jobCards: [{ completedDate: j.completedDate }] }));

  return buildSlaRows(cases, [...legacy, ...svOrders], dos, pos, nowMs);
}
