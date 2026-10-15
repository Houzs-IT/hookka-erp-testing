// ---------------------------------------------------------------------------
// CNC fabric-cutting job feed (HK-0036).
//
//   GET  /api/cnc-jobs?limit=&offset=    open FAB_CUT job cards + PO details
//                                        + whatever the CNC last reported
//                                        (default 200, max 500 per page)
//   POST /api/cnc-jobs/:jobCardId/result {status, cutQty} the CNC's report
//
// Pull model on purpose: a PO is created at 4+ sites, so "send on create" would
// need a hook in each. A FAB_CUT card exists from the moment its PO does, so
// the feed covers every creation path. The CNC vendor/transport is UNKNOWN
// (owner question on HK-0036) - this is the seam, not a vendor adapter.
// The report is RECORDED only; the job card is not completed from it.
//
// Permission: its own `cnc-jobs` resource, NOT `cnc-templates` (which is open
// to every role). Who the CNC machine authenticates as is an OWNER decision
// (HK-0036); until then only roles holding `cnc-jobs` (admins, Office) reach it.
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
// Upper bound on one report's cut count: a single PO is a handful of pieces,
// so this only exists to refuse a typo / runaway integer. [my guess: owner may tune]
export const MAX_CUT_QTY = 100000;
const FEED_DEFAULT_LIMIT = 200;
const FEED_MAX_LIMIT = 500;

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
  if (cutQty > MAX_CUT_QTY) {
    return `cutQty must be at most ${MAX_CUT_QTY}`;
  }
  return { status, cutQty };
}

app.get("/", async (c) => {
  const denied = await requirePermission(c, "cnc-jobs", "read");
  if (denied) return denied;
  await ensureTable(c.var.DB);
  const limit = Math.min(
    FEED_MAX_LIMIT,
    Math.max(1, Math.floor(Number(c.req.query("limit"))) || FEED_DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Math.floor(Number(c.req.query("offset"))) || 0);
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
      ORDER BY jc.due_date, po.po_no, jc.id
      LIMIT ? OFFSET ?`,
  )
    .bind(getOrgId(c), limit, offset)
    .all();
  return c.json({ success: true, data: res.results ?? [], limit, offset });
});

app.post("/:jobCardId/result", async (c) => {
  const denied = await requirePermission(c, "cnc-jobs", "update");
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
  // RETURNING yields a row only when the upsert actually wrote: the guard
  // below skips a late CUTTING after DONE, which must not look like success.
  const written = await c.var.DB.prepare(
    `INSERT INTO cnc_cut_results (job_card_id, org_id, status, cut_qty, reported_by, reported_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (job_card_id) DO UPDATE SET status = excluded.status,
       cut_qty = excluded.cut_qty, reported_by = excluded.reported_by,
       reported_at = excluded.reported_at
     WHERE cnc_cut_results.status <> 'DONE' OR excluded.status = 'DONE'
     RETURNING job_card_id`,
  )
    .bind(id, orgId, parsed.status, parsed.cutQty, by, new Date().toISOString())
    .first();
  if (!written) {
    return c.json({
      success: true,
      ignored: true,
      reason: "job card already reported DONE; a later CUTTING report was not applied",
      data: { jobCardId: id },
    });
  }
  await emitAudit(c, {
    resource: "cnc-jobs",
    resourceId: id,
    action: "update",
    after: parsed,
  });
  return c.json({ success: true, data: { jobCardId: id, ...parsed } });
});

export default app;
