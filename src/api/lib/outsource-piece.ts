// ---------------------------------------------------------------------------
// outsource-piece.ts — piece-rate wages for outsourced workers (HK-0130).
//
// Each worker has their own rate per item. The office imports finished
// production orders against a worker and a payroll month; the rate is copied
// onto the record, so a later rate change cannot move a wage already imported.
//
// Shape of the money, and why:
//  1. The wage rides INSIDE payslips.allowances_sen, with piece_wages_sen
//     saying how much of that bucket it is. The Payroll tab derives proration
//     as Basic - Absence - (Gross - OT - allowances), so a gross that grew
//     outside the bucket would show as a negative part-month adjustment.
//  2. Like the allowances it sits beside, it is added after calcStatutory:
//     EPF / SOCSO / EIS / PCB do not move.
//  3. A production order can be imported once, whoever it went to. The unique
//     index on production_order_id is what enforces it.
//
// Tables reach prod ONLY through `ensureOutsourcePieceTables` — migration files
// are inert on deploy in this repo.
// ---------------------------------------------------------------------------
import { freshAll, freshFirst } from "./worker-penalties";

type Stmt = {
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  first<T = unknown>(): Promise<T | null>;
};

interface Runner {
  prepare(sql: string): Stmt & { bind(...args: unknown[]): Stmt };
  batch?(stmts: unknown[]): Promise<Array<{ results?: unknown[] }>>;
}

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS outsource_piece_rates (
     id         TEXT PRIMARY KEY,
     worker_id  TEXT NOT NULL,
     item_code  TEXT NOT NULL,
     rate_sen   INTEGER NOT NULL,
     org_id     TEXT NOT NULL DEFAULT 'hookka',
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_piece_rates_worker_item
     ON outsource_piece_rates (worker_id, item_code)`,
  `CREATE TABLE IF NOT EXISTS outsource_piece_records (
     id                  TEXT PRIMARY KEY,
     worker_id           TEXT NOT NULL,
     emp_no              TEXT,
     worker_name         TEXT,
     production_order_id TEXT NOT NULL,
     po_no               TEXT,
     sales_order_no      TEXT,
     customer_po_id      TEXT,
     product_code        TEXT,
     item_code           TEXT NOT NULL,
     quantity            INTEGER NOT NULL,
     rate_sen            INTEGER NOT NULL,
     amount_sen          INTEGER NOT NULL,
     payroll_period      TEXT NOT NULL,
     payslip_id          TEXT,
     org_id              TEXT NOT NULL DEFAULT 'hookka',
     created_by          TEXT,
     created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_piece_records_order
     ON outsource_piece_records (production_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_outsource_piece_records_period
     ON outsource_piece_records (payroll_period)`,
  `CREATE INDEX IF NOT EXISTS idx_outsource_piece_records_worker
     ON outsource_piece_records (worker_id)`,
  `ALTER TABLE payslips ADD COLUMN IF NOT EXISTS piece_wages_sen INTEGER NOT NULL DEFAULT 0`,
];

let _applied = false;

/** Memoised as a BOOLEAN: a cached rejected promise would disable this for the isolate. */
export async function ensureOutsourcePieceTables(db: Runner): Promise<void> {
  if (_applied) return;
  for (const sql of DDL) await db.prepare(sql).run();
  _applied = true;
}

const PERIOD_RE = /^\d{4}-\d{2}$/;

export type PieceDrift = {
  workerId: string;
  employeeName: string;
  expectedSen: number;
  onPayslipSen: number;
};

/**
 * Workers whose stored payslip disagrees with the wages imported for the month.
 * Unlike a penalty, a wage with no payslip at all IS a disagreement: there is
 * no next month for it to roll into, so it would simply never be paid.
 */
export function computePieceDrift(
  expectedByWorker: ReadonlyMap<string, number>,
  payslips: { employeeId: string; employeeName: string; pieceWagesSen: number }[],
): PieceDrift[] {
  const out: PieceDrift[] = [];
  const seen = new Set<string>();
  for (const p of payslips) {
    seen.add(p.employeeId);
    const expected = expectedByWorker.get(p.employeeId) ?? 0;
    const onSlip = Number(p.pieceWagesSen) || 0;
    if (expected !== onSlip) {
      out.push({ workerId: p.employeeId, employeeName: p.employeeName, expectedSen: expected, onPayslipSen: onSlip });
    }
  }
  for (const [workerId, expected] of expectedByWorker) {
    if (!seen.has(workerId) && expected !== 0) {
      out.push({ workerId, employeeName: "", expectedSen: expected, onPayslipSen: 0 });
    }
  }
  return out;
}

/**
 * Per-worker piece wages for a payroll month — used by generate AND projected.
 * Resilient like the penalty read: a missing table must not stop payroll.
 */
export async function loadPeriodPieceSen(db: Runner, period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!PERIOD_RE.test(period)) return out;
  try {
    const rows = await freshAll<{ workerId?: string; worker_id?: string; amountSen?: unknown; amount_sen?: unknown }>(
      db,
      db
        .prepare("SELECT worker_id, amount_sen FROM outsource_piece_records WHERE payroll_period = ?")
        .bind(period),
    );
    for (const r of rows) {
      const id = String(r.workerId ?? r.worker_id ?? "");
      if (id) out.set(id, (out.get(id) ?? 0) + (Number(r.amountSen ?? r.amount_sen) || 0));
    }
  } catch (e) {
    console.warn("[outsource-piece] period read skipped:", e);
  }
  return out;
}

/** Drift for a month. No payslips yet means nothing to disagree with. */
export async function findPieceDrift(db: Runner, period: string): Promise<PieceDrift[]> {
  const rows = await freshAll<Record<string, unknown>>(
    db,
    db.prepare("SELECT employeeId, employeeName, piece_wages_sen FROM payslips WHERE period = ?").bind(period),
  );
  if (rows.length === 0) return [];
  const slips = rows.map((r) => ({
    employeeId: String(r.employeeId ?? r.employee_id ?? ""),
    employeeName: String(r.employeeName ?? r.employee_name ?? ""),
    pieceWagesSen: Number(r.pieceWagesSen ?? r.piece_wages_sen) || 0,
  }));
  return computePieceDrift(await loadPeriodPieceSen(db, period), slips);
}

const text = (camel: unknown, snake?: unknown): string => String(camel ?? snake ?? "");

export async function loadRateMap(db: Runner, workerId: string): Promise<Map<string, number>> {
  const rows = await freshAll<Record<string, unknown>>(
    db,
    db.prepare("SELECT item_code, rate_sen FROM outsource_piece_rates WHERE worker_id = ?").bind(workerId),
  );
  return new Map(rows.map((row) => [text(row.itemCode, row.item_code), Number(row.rateSen ?? row.rate_sen) || 0]));
}

/** Fab Sew WIP labels per order: the price list is a sewing list. */
export async function loadSewLabels(db: Runner, orderIds: readonly string[]): Promise<Map<string, string[]>> {
  const labelsByOrder = new Map<string, string[]>();
  if (orderIds.length === 0) return labelsByOrder;
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = await freshAll<Record<string, unknown>>(
    db,
    db
      .prepare(
        `SELECT production_order_id, wip_label FROM job_cards
          WHERE department_code = 'FAB_SEW' AND production_order_id IN (${placeholders})`,
      )
      .bind(...orderIds),
  );
  for (const row of rows) {
    const orderId = text(row.productionOrderId, row.production_order_id);
    labelsByOrder.set(orderId, [...(labelsByOrder.get(orderId) ?? []), text(row.wipLabel, row.wip_label)]);
  }
  return labelsByOrder;
}

export async function loadRecordedPeriods(db: Runner, orderIds: readonly string[]): Promise<Map<string, string>> {
  const periodByOrder = new Map<string, string>();
  if (orderIds.length === 0) return periodByOrder;
  await ensureOutsourcePieceTables(db);
  const rows = await freshAll<Record<string, unknown>>(
    db,
    db
      .prepare(
        `SELECT production_order_id, payroll_period FROM outsource_piece_records
          WHERE production_order_id IN (${orderIds.map(() => "?").join(",")})`,
      )
      .bind(...orderIds),
  );
  for (const row of rows) {
    periodByOrder.set(text(row.productionOrderId, row.production_order_id), text(row.payrollPeriod, row.payroll_period));
  }
  return periodByOrder;
}

export interface PieceOrder {
  id: string;
  poNo: string;
  salesOrderNo: string;
  customerPoId: string;
  productCode: string;
  quantity: number;
}

export async function loadPieceOrders(db: Runner, orgId: string, orderIds: readonly string[]): Promise<PieceOrder[]> {
  if (orderIds.length === 0) return [];
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = await freshAll<Record<string, unknown>>(
    db,
    db
      .prepare(
        `SELECT id, po_no, sales_order_no, customer_po_id, product_code, quantity
           FROM production_orders WHERE org_id = ? AND id IN (${placeholders})`,
      )
      .bind(orgId, ...orderIds),
  );
  return rows.map((row) => ({
    id: text(row.id),
    poNo: text(row.poNo, row.po_no),
    salesOrderNo: text(row.salesOrderNo, row.sales_order_no),
    customerPoId: text(row.customerPoId ?? row.customerPOId, row.customer_po_id),
    productCode: text(row.productCode, row.product_code),
    quantity: Number(row.quantity) || 0,
  }));
}

export interface PieceRecordInput {
  worker: { id: string; empNo: string; name: string };
  order: PieceOrder;
  itemCode: string;
  rateSen: number;
  amountSen: number;
  period: string;
  orgId: string;
  createdBy: string | null;
}

/** True when the row landed; false when the order already had a record. */
export async function insertPieceRecord(db: Runner, record: PieceRecordInput): Promise<boolean> {
  const { worker, order } = record;
  const id = `opc-${crypto.randomUUID().slice(0, 8)}`;
  await db
    .prepare(
      `INSERT INTO outsource_piece_records
         (id, worker_id, emp_no, worker_name, production_order_id, po_no, sales_order_no, customer_po_id,
          product_code, item_code, quantity, rate_sen, amount_sen, payroll_period, org_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (production_order_id) DO NOTHING`,
    )
    .bind(
      id, worker.id, worker.empNo, worker.name, order.id, order.poNo, order.salesOrderNo, order.customerPoId,
      order.productCode, record.itemCode, order.quantity, record.rateSen, record.amountSen, record.period,
      record.orgId, record.createdBy,
    )
    .run();
  const landed = await freshFirst<{ id: string }>(
    db,
    db.prepare("SELECT id FROM outsource_piece_records WHERE id = ?").bind(id),
  );
  return landed !== null;
}

/** Stamp the generated payslip id on the worker's records for the month. */
export async function linkPieceRecordsToPayslip(
  db: Runner,
  period: string,
  workerId: string,
  payslipId: string,
): Promise<void> {
  try {
    await db
      .prepare("UPDATE outsource_piece_records SET payslip_id = ? WHERE payroll_period = ? AND worker_id = ?")
      .bind(payslipId, period, workerId)
      .run();
  } catch (e) {
    console.warn("[outsource-piece] payslip link skipped:", e);
  }
}
