// ---------------------------------------------------------------------------
// outsource_piece route — HK-0130 outsource piece-rate wages.
//
//   GET    /api/outsource-piece/rates?workerId=            — one worker's rates
//   PUT    /api/outsource-piece/rates                      — upsert a worker's rates
//   DELETE /api/outsource-piece/rates/:id                  — remove one rate
//   GET    /api/outsource-piece/importable?workerId=&from=&to=&department=&q=
//   POST   /api/outsource-piece/import                     — orders -> records
//   GET    /api/outsource-piece/records?period=            — records + payslip drift
//   DELETE /api/outsource-piece/records/:id                — undo an import
//
// Gated on `payroll`: this is payroll data, and HR already holds that right.
// The order list lives here for the same reason as the penalty order lookup —
// HR holds no production-orders right.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { emitAudit } from "../lib/audit";
import { freshAll, freshFirst, loadLockedPayrollPeriods } from "../lib/worker-penalties";
import { ensureOutsourcePieceTables, findPieceDrift } from "../lib/outsource-piece";
import { pieceAmountSen, pieceItemCode } from "../../lib/outsource-piece";

const app = new Hono<Env>();
const RES = "payroll";
const PERIOD_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const s = (a: unknown, b?: unknown): string => String(a ?? b ?? "");
const ctxGet = (c: Context<Env>, k: string): string =>
  (c as unknown as { get: (k: string) => string | undefined }).get(k) ?? "";

type WorkerSnap = { id: string; empNo: string; name: string };

/** Only an active outsourced person can hold rates or be paid by the piece. */
async function loadOutsourceWorker(c: Context<Env>, workerId: string): Promise<WorkerSnap | null> {
  const w = await c.var.DB.prepare("SELECT id, empNo, name, status, isOutsource FROM workers WHERE id = ?")
    .bind(workerId)
    .first<Record<string, unknown>>();
  if (!w || !(w.isOutsource ?? w.is_outsource) || s(w.status) !== "ACTIVE") return null;
  return { id: s(w.id), empNo: s(w.empNo, w.emp_no), name: s(w.name) };
}

async function loadRateMap(c: Context<Env>, workerId: string): Promise<Map<string, number>> {
  const rows = await freshAll<Record<string, unknown>>(
    c.var.DB,
    c.var.DB.prepare("SELECT item_code, rate_sen FROM outsource_piece_rates WHERE worker_id = ?").bind(workerId),
  );
  return new Map(rows.map((r) => [s(r.itemCode, r.item_code), Number(r.rateSen ?? r.rate_sen) || 0]));
}

app.get("/rates", async (c) => {
  const denied = await requirePermission(c, RES, "read");
  if (denied) return denied;
  await ensureOutsourcePieceTables(c.var.DB);
  const workerId = c.req.query("workerId") ?? "";
  const rows = await freshAll<Record<string, unknown>>(
    c.var.DB,
    c.var.DB.prepare(
      "SELECT id, item_code, rate_sen FROM outsource_piece_rates WHERE worker_id = ? ORDER BY item_code",
    ).bind(workerId),
  );
  const data = rows.map((r) => ({
    id: s(r.id),
    itemCode: s(r.itemCode, r.item_code),
    rateSen: Number(r.rateSen ?? r.rate_sen) || 0,
  }));
  return c.json({ success: true, data });
});

app.put("/rates", async (c) => {
  const denied = await requirePermission(c, RES, "update");
  if (denied) return denied;
  await ensureOutsourcePieceTables(c.var.DB);
  const body = (await c.req.json().catch(() => ({}))) as { workerId?: unknown; rates?: unknown };
  const worker = await loadOutsourceWorker(c, s(body.workerId));
  if (!worker) return c.json({ success: false, error: "Select an active outsourced worker" }, 400);
  const rates = Array.isArray(body.rates) ? (body.rates as Array<Record<string, unknown>>) : [];
  if (rates.length === 0) return c.json({ success: false, error: "No rates to save" }, 400);
  const parsed: { itemCode: string; rateSen: number }[] = [];
  for (const r of rates) {
    const itemCode = pieceItemCode(s(r.itemCode));
    const rateSen = Number(r.rateSen);
    if (!itemCode || !Number.isInteger(rateSen) || rateSen <= 0) {
      return c.json({ success: false, error: `Invalid rate for ${itemCode || "an item"}` }, 400);
    }
    parsed.push({ itemCode, rateSen });
  }
  const userId = ctxGet(c, "userId");
  for (const r of parsed) {
    await c.var.DB.prepare(
      `INSERT INTO outsource_piece_rates (id, worker_id, item_code, rate_sen, org_id, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (worker_id, item_code)
       DO UPDATE SET rate_sen = EXCLUDED.rate_sen, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    )
      .bind(`opr-${crypto.randomUUID().slice(0, 8)}`, worker.id, r.itemCode, r.rateSen, getOrgId(c), userId || null)
      .run();
  }
  await emitAudit(c, { resource: RES, resourceId: worker.id, action: "update", after: { pieceRates: parsed } });
  return c.json({ success: true, saved: parsed.length });
});

app.delete("/rates/:id", async (c) => {
  const denied = await requirePermission(c, RES, "update");
  if (denied) return denied;
  await ensureOutsourcePieceTables(c.var.DB);
  await c.var.DB.prepare("DELETE FROM outsource_piece_rates WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ success: true });
});

// With a department, "finished" means that department's job card is done: an
// outsourced worker's stage ends before the whole order does. Without one it
// means the order itself is COMPLETED.
app.get("/importable", async (c) => {
  const denied = await requirePermission(c, RES, "read");
  if (denied) return denied;
  await ensureOutsourcePieceTables(c.var.DB);
  const workerId = c.req.query("workerId") ?? "";
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  const department = (c.req.query("department") ?? "").trim();
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return c.json({ success: false, error: "From and To dates are required" }, 400);
  }
  const toEnd = `${to}T23:59:59.999Z`;
  const binds: string[] = [getOrgId(c)];
  let finished: string;
  if (department) {
    finished = `EXISTS (SELECT 1 FROM job_cards jc
                         WHERE jc.production_order_id = po.id AND jc.department_code = ?
                           AND jc.status IN ('COMPLETED', 'TRANSFERRED')
                           AND jc.completed_date >= ? AND jc.completed_date <= ?)`;
    binds.push(department, from, toEnd);
  } else {
    finished = "po.status = 'COMPLETED' AND po.completed_date >= ? AND po.completed_date <= ?";
    binds.push(from, toEnd);
  }
  let search = "";
  if (q) {
    const like = `%${q}%`;
    search = `AND (LOWER(COALESCE(po.po_no, '')) LIKE ? OR LOWER(COALESCE(po.sales_order_no, '')) LIKE ?
                OR LOWER(COALESCE(po.customer_po_id, '')) LIKE ? OR LOWER(COALESCE(po.product_code, '')) LIKE ?)`;
    binds.push(like, like, like, like);
  }
  const rows = await freshAll<Record<string, unknown>>(
    c.var.DB,
    c.var.DB.prepare(
      `SELECT po.id, po.po_no, po.sales_order_no, po.customer_po_id, po.customer_name, po.product_code,
              po.product_name, po.quantity, po.completed_date,
              r.worker_name AS imported_to, r.payroll_period AS imported_period
         FROM production_orders po
         LEFT JOIN outsource_piece_records r ON r.production_order_id = po.id
        WHERE po.org_id = ? AND ${finished} ${search}
        ORDER BY po.completed_date DESC NULLS LAST, po.po_no DESC
        LIMIT 300`,
    ).bind(...binds),
  );
  const rateMap = await loadRateMap(c, workerId);
  const data = rows.map((o) => {
    const productCode = s(o.productCode, o.product_code);
    const itemCode = pieceItemCode(productCode);
    const quantity = Number(o.quantity) || 0;
    const rateSen = rateMap.get(itemCode) ?? null;
    return {
      id: s(o.id),
      poNo: s(o.poNo, o.po_no),
      salesOrderNo: s(o.salesOrderNo, o.sales_order_no),
      customerPoId: s(o.customerPoId ?? o.customerPOId, o.customer_po_id),
      customerName: s(o.customerName, o.customer_name),
      productCode,
      productName: s(o.productName, o.product_name),
      itemCode,
      quantity,
      completedDate: s(o.completedDate, o.completed_date).slice(0, 10),
      rateSen,
      amountSen: rateSen === null ? null : pieceAmountSen(quantity, rateSen),
      importedTo: s(o.importedTo, o.imported_to),
      importedPeriod: s(o.importedPeriod, o.imported_period),
    };
  });
  return c.json({ success: true, data });
});

app.post("/import", async (c) => {
  const denied = await requirePermission(c, RES, "update");
  if (denied) return denied;
  await ensureOutsourcePieceTables(c.var.DB);
  const body = (await c.req.json().catch(() => ({}))) as {
    workerId?: unknown;
    period?: unknown;
    productionOrderIds?: unknown;
  };
  const period = s(body.period);
  if (!PERIOD_RE.test(period)) return c.json({ success: false, error: "Payroll month is required" }, 400);
  const worker = await loadOutsourceWorker(c, s(body.workerId));
  if (!worker) return c.json({ success: false, error: "Select an active outsourced worker" }, 400);
  const ids = Array.isArray(body.productionOrderIds) ? [...new Set(body.productionOrderIds.map((v) => s(v)))] : [];
  if (ids.length === 0) return c.json({ success: false, error: "Select at least one production order" }, 400);
  if ((await loadLockedPayrollPeriods(c.var.DB)).has(period)) {
    return c.json({ success: false, error: `Payroll for ${period} is already approved` }, 409);
  }

  const placeholders = ids.map(() => "?").join(",");
  const orders = await freshAll<Record<string, unknown>>(
    c.var.DB,
    c.var.DB.prepare(
      `SELECT id, po_no, sales_order_no, customer_po_id, product_code, quantity
         FROM production_orders WHERE org_id = ? AND id IN (${placeholders})`,
    ).bind(getOrgId(c), ...ids),
  );
  if (orders.length !== ids.length) {
    return c.json({ success: false, error: "A selected production order no longer exists" }, 400);
  }
  // All or nothing: a partial import would leave the office unable to tell
  // which orders in their selection were paid.
  const rateMap = await loadRateMap(c, worker.id);
  const missing = [
    ...new Set(
      orders
        .map((o) => pieceItemCode(s(o.productCode, o.product_code)))
        .filter((code) => !rateMap.has(code)),
    ),
  ];
  if (missing.length > 0) {
    return c.json({ success: false, error: `No rate set for ${worker.name}: ${missing.join(", ")}`, missing }, 400);
  }

  const userId = ctxGet(c, "userId");
  let imported = 0;
  for (const o of orders) {
    const productCode = s(o.productCode, o.product_code);
    const itemCode = pieceItemCode(productCode);
    const quantity = Number(o.quantity) || 0;
    const rateSen = rateMap.get(itemCode) as number;
    const id = `opc-${crypto.randomUUID().slice(0, 8)}`;
    await c.var.DB.prepare(
      `INSERT INTO outsource_piece_records
         (id, worker_id, emp_no, worker_name, production_order_id, po_no, sales_order_no, customer_po_id,
          product_code, item_code, quantity, rate_sen, amount_sen, payroll_period, org_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (production_order_id) DO NOTHING`,
    )
      .bind(
        id, worker.id, worker.empNo, worker.name, s(o.id), s(o.poNo, o.po_no), s(o.salesOrderNo, o.sales_order_no),
        s(o.customerPoId ?? o.customerPOId, o.customer_po_id), productCode, itemCode, quantity, rateSen,
        pieceAmountSen(quantity, rateSen), period, getOrgId(c), userId || null,
      )
      .run();
    const landed = await freshFirst<{ id: string }>(
      c.var.DB,
      c.var.DB.prepare("SELECT id FROM outsource_piece_records WHERE id = ?").bind(id),
    );
    if (landed) imported++;
  }
  await emitAudit(c, { resource: RES, resourceId: worker.id, action: "update", after: { pieceImport: ids, period } });
  return c.json({ success: true, imported, skipped: ids.length - imported });
});

app.get("/records", async (c) => {
  const denied = await requirePermission(c, RES, "read");
  if (denied) return denied;
  await ensureOutsourcePieceTables(c.var.DB);
  const period = c.req.query("period") ?? "";
  if (!PERIOD_RE.test(period)) return c.json({ success: false, error: "Payroll month is required" }, 400);
  const rows = await freshAll<Record<string, unknown>>(
    c.var.DB,
    c.var.DB.prepare(
      `SELECT id, worker_id, emp_no, worker_name, po_no, sales_order_no, customer_po_id, product_code,
              item_code, quantity, rate_sen, amount_sen, payroll_period, payslip_id
         FROM outsource_piece_records WHERE payroll_period = ?
        ORDER BY worker_name, po_no`,
    ).bind(period),
  );
  const data = rows.map((r) => ({
    id: s(r.id),
    workerId: s(r.workerId, r.worker_id),
    empNo: s(r.empNo, r.emp_no),
    workerName: s(r.workerName, r.worker_name),
    poNo: s(r.poNo, r.po_no),
    salesOrderNo: s(r.salesOrderNo, r.sales_order_no),
    customerPoId: s(r.customerPoId ?? r.customerPOId, r.customer_po_id),
    productCode: s(r.productCode, r.product_code),
    itemCode: s(r.itemCode, r.item_code),
    quantity: Number(r.quantity) || 0,
    rateSen: Number(r.rateSen ?? r.rate_sen) || 0,
    amountSen: Number(r.amountSen ?? r.amount_sen) || 0,
    payslipId: s(r.payslipId, r.payslip_id),
  }));
  const locked = (await loadLockedPayrollPeriods(c.var.DB)).has(period);
  const drift = await findPieceDrift(c.var.DB, period);
  return c.json({ success: true, data, locked, drift });
});

app.delete("/records/:id", async (c) => {
  const denied = await requirePermission(c, RES, "update");
  if (denied) return denied;
  await ensureOutsourcePieceTables(c.var.DB);
  const id = c.req.param("id");
  const row = await freshFirst<Record<string, unknown>>(
    c.var.DB,
    c.var.DB.prepare("SELECT * FROM outsource_piece_records WHERE id = ?").bind(id),
  );
  if (!row) return c.json({ success: false, error: "Record not found" }, 404);
  const period = s(row.payrollPeriod, row.payroll_period);
  if ((await loadLockedPayrollPeriods(c.var.DB)).has(period)) {
    return c.json({ success: false, error: `Payroll for ${period} is already approved` }, 409);
  }
  await c.var.DB.prepare("DELETE FROM outsource_piece_records WHERE id = ?").bind(id).run();
  await emitAudit(c, { resource: RES, resourceId: id, action: "delete", before: row });
  return c.json({ success: true });
});

export default app;
