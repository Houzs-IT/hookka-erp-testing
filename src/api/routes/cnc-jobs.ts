// ---------------------------------------------------------------------------
// CNC fabric-cutting job feed (HK-0036).
//
//   GET  /api/cnc-jobs                   open FAB_CUT job cards + PO details
//                                        + whatever the CNC last reported
//   POST /api/cnc-jobs/:jobCardId/result {status, cutQty} the CNC's report
//
// Pull model on purpose: a PO is created at 4+ sites, so "send on create" would
// need a hook in each. A FAB_CUT card exists from the moment its PO does, so
// the feed covers every creation path. The CNC vendor/transport is UNKNOWN
// (owner question on HK-0036) - this is the seam, not a vendor adapter.
// The report is RECORDED only; the job card is not completed from it.
//
// SQL is snake_case; the adapter returns rows camelCase (see cnc-templates.ts).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { emitAudit } from "../lib/audit";
import { runSelfApply, memoizeSelfApply } from "../lib/self-apply";

export const CNC_STATUSES = ["CUTTING", "DONE"] as const;
export type CncStatus = (typeof CNC_STATUSES)[number];

const app = new Hono<Env>();

let ensured: Promise<void> | null = null;
function ensureTable(db: Parameters<typeof runSelfApply>[0]): Promise<void> {
  return memoizeSelfApply(
    () => ensured,
    (p) => (ensured = p),
    () =>
      runSelfApply(db, "cnc-cut-results", [
        `CREATE TABLE IF NOT EXISTS cnc_cut_results (
           job_card_id TEXT PRIMARY KEY,
           org_id TEXT NOT NULL DEFAULT 'hookka',
           status TEXT NOT NULL,
           cut_qty INTEGER NOT NULL DEFAULT 0,
           reported_by TEXT,
           reported_at TEXT NOT NULL
         )`,
      ]),
  );
}

/** Validate a CNC report body. Returns the clean value or an error string. */
export function parseCncReport(
  body: unknown,
): { status: CncStatus; cutQty: number } | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const status = String(b.status ?? "").toUpperCase() as CncStatus;
  if (!CNC_STATUSES.includes(status)) {
    return `status must be one of ${CNC_STATUSES.join(", ")}`;
  }
  const cutQty = b.cutQty;
  if (typeof cutQty !== "number" || !Number.isInteger(cutQty) || cutQty < 0) {
    return "cutQty must be a non-negative integer";
  }
  return { status, cutQty };
}

app.get("/", async (c) => {
  const denied = await requirePermission(c, "cnc-templates", "read");
  if (denied) return denied;
  await ensureTable(c.var.DB);
  const res = await c.var.DB.prepare(
    `SELECT jc.id AS job_card_id, jc.production_order_id,
            po.po_no, po.product_code, po.size_code, po.fabric_code,
            jc.wip_label, jc.wip_qty, jc.due_date, jc.status AS card_status,
            r.status AS cnc_status, r.cut_qty, r.reported_at
       FROM job_cards jc
       JOIN production_orders po ON po.id = jc.production_order_id
       LEFT JOIN cnc_cut_results r ON r.job_card_id = jc.id
      WHERE jc.org_id = ? AND jc.department_code = 'FAB_CUT'
        AND jc.status NOT IN ('COMPLETED','TRANSFERRED')
      ORDER BY jc.due_date, po.po_no`,
  )
    .bind(getOrgId(c))
    .all();
  return c.json({ success: true, data: res.results ?? [] });
});

app.post("/:jobCardId/result", async (c) => {
  const denied = await requirePermission(c, "cnc-templates", "update");
  if (denied) return denied;
  const parsed = parseCncReport(await c.req.json().catch(() => null));
  if (typeof parsed === "string") {
    return c.json({ success: false, error: parsed }, 400);
  }
  await ensureTable(c.var.DB);
  const orgId = getOrgId(c);
  const id = c.req.param("jobCardId");
  const card = await c.var.DB.prepare(
    `SELECT id FROM job_cards WHERE id = ? AND org_id = ? AND department_code = 'FAB_CUT'`,
  )
    .bind(id, orgId)
    .first();
  if (!card) return c.json({ success: false, error: "FAB_CUT job card not found" }, 404);

  const by = (c as unknown as { get: (k: string) => string | undefined }).get("userId") ?? null;
  await c.var.DB.prepare(
    `INSERT INTO cnc_cut_results (job_card_id, org_id, status, cut_qty, reported_by, reported_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (job_card_id) DO UPDATE SET status = excluded.status,
       cut_qty = excluded.cut_qty, reported_by = excluded.reported_by,
       reported_at = excluded.reported_at
     WHERE cnc_cut_results.status <> 'DONE' OR excluded.status = 'DONE'`,
  )
    .bind(id, orgId, parsed.status, parsed.cutQty, by, new Date().toISOString())
    .run();
  await emitAudit(c, {
    resource: "cnc-templates",
    resourceId: id,
    action: "update",
    after: parsed,
  });
  return c.json({ success: true, data: { jobCardId: id, ...parsed } });
});

export default app;
