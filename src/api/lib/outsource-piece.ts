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
import { freshAll, freshFirst, loadLockedPayrollPeriods } from "./worker-penalties";
import { orderRate, pieceAmountSen, pieceItemsForOrder, workerShareBp, type SewCard } from "../../lib/outsource-piece";

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
  `ALTER TABLE outsource_piece_records ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'IMPORT'`,
  `ALTER TABLE outsource_piece_records ADD COLUMN IF NOT EXISTS share_bp INTEGER NOT NULL DEFAULT 10000`,
  `ALTER TABLE outsource_piece_records ADD COLUMN IF NOT EXISTS completed_date TEXT`,
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

export type PendingPiece = {
  kind: "NO_RATE" | "TWO_OUTSOURCE";
  productionOrderId: string;
  poNo: string;
  productCode: string;
  quantity: number;
  completedDate: string;
  workerIds: string[];
  missing: string[];
};

type Row = Record<string, unknown>;
const text = (a: unknown, b?: unknown): string => String(a ?? b ?? "");
const marks = (n: number): string => Array.from({ length: n }, () => "?").join(",");

export const PAYABLE_WORKERS_WHERE =
  "(status = 'ACTIVE' OR (status = 'RESIGNED' AND resignedAt LIKE ?)) AND empNo NOT LIKE 'TEST%'";

const FINISHED_STATUSES = new Set(["COMPLETED", "TRANSFERRED"]);

export async function syncScannedPieceRecords(
  db: Runner,
  period: string,
): Promise<{ added: number; removed: number; pending: PendingPiece[] }> {
  const result = { added: 0, removed: 0, pending: [] as PendingPiece[] };
  if (!PERIOD_RE.test(period)) return result;
  await ensureOutsourcePieceTables(db);

  const workerRows = await freshAll<Row>(
    db,
    db
      .prepare(`SELECT id, empNo, name, isOutsource FROM workers WHERE ${PAYABLE_WORKERS_WHERE}`)
      .bind(`${period}-%`),
  );
  const outsource = new Map<string, { empNo: string; name: string }>();
  for (const w of workerRows) {
    if (w.isOutsource ?? w.is_outsource) outsource.set(text(w.id), { empNo: text(w.empNo, w.emp_no), name: text(w.name) });
  }

  const touchedRows = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT DISTINCT production_order_id FROM job_cards
          WHERE department_code = 'FAB_SEW' AND status IN ('COMPLETED', 'TRANSFERRED')
            AND SUBSTR(CAST(completed_date AS TEXT), 1, 7) = ?`,
      )
      .bind(period),
  );
  const touchedIds = touchedRows.map((r) => text(r.productionOrderId, r.production_order_id));

  const cardRows =
    touchedIds.length === 0
      ? []
      : await freshAll<Row>(
          db,
          db
            .prepare(
              `SELECT id, production_order_id, status, pic1_id, pic2_id, wip_label, completed_date FROM job_cards
                WHERE department_code = 'FAB_SEW' AND production_order_id IN (${marks(touchedIds.length)})`,
            )
            .bind(...touchedIds),
        );
  const cardIds = cardRows.map((r) => text(r.id));
  const pieceRows =
    cardIds.length === 0
      ? []
      : await freshAll<Row>(
          db,
          db
            .prepare(`SELECT job_card_id, pic1_id, pic2_id FROM piece_pics WHERE job_card_id IN (${marks(cardIds.length)})`)
            .bind(...cardIds),
        );
  const piecesByCard = new Map<string, { pic1Id: string | null; pic2Id: string | null }[]>();
  for (const r of pieceRows) {
    const cardId = text(r.jobCardId, r.job_card_id);
    const list = piecesByCard.get(cardId) ?? [];
    list.push({ pic1Id: text(r.pic1Id, r.pic1_id) || null, pic2Id: text(r.pic2Id, r.pic2_id) || null });
    piecesByCard.set(cardId, list);
  }

  type OrderCards = { cards: SewCard[]; labels: string[]; completedDate: string; allFinished: boolean };
  const byOrder = new Map<string, OrderCards>();
  for (const r of cardRows) {
    const orderId = text(r.productionOrderId, r.production_order_id);
    const entry = byOrder.get(orderId) ?? { cards: [], labels: [], completedDate: "", allFinished: true };
    entry.cards.push({
      pic1Id: text(r.pic1Id, r.pic1_id) || null,
      pic2Id: text(r.pic2Id, r.pic2_id) || null,
      pieces: piecesByCard.get(text(r.id)) ?? [],
    });
    entry.labels.push(text(r.wipLabel, r.wip_label));
    if (!FINISHED_STATUSES.has(text(r.status))) entry.allFinished = false;
    const done = text(r.completedDate, r.completed_date).slice(0, 10);
    if (done > entry.completedDate) entry.completedDate = done;
    byOrder.set(orderId, entry);
  }
  for (const [orderId, entry] of byOrder) {
    if (!entry.allFinished || entry.completedDate.slice(0, 7) !== period) byOrder.delete(orderId);
  }

  const existingRows = await freshAll<Row>(
    db,
    touchedIds.length === 0
      ? db.prepare("SELECT * FROM outsource_piece_records WHERE payroll_period = ?").bind(period)
      : db
          .prepare(
            `SELECT * FROM outsource_piece_records
              WHERE payroll_period = ? OR production_order_id IN (${marks(touchedIds.length)})`,
          )
          .bind(period, ...touchedIds),
  );
  const recordByOrder = new Map(existingRows.map((r) => [text(r.productionOrderId, r.production_order_id), r]));
  const isThisMonthsScan = (r: Row | undefined): r is Row =>
    r !== undefined && text(r.source) === "SCAN" && text(r.payrollPeriod, r.payroll_period) === period;
  const monthScans = existingRows.filter(isThisMonthsScan);

  const wantedOrderIds = [...byOrder.keys()].filter((orderId) => {
    const existing = recordByOrder.get(orderId);
    if (existing) return isThisMonthsScan(existing);
    return byOrder
      .get(orderId)!
      .cards.some((card) =>
        [card, ...(card.pieces ?? [])].some((pair) =>
          [pair.pic1Id, pair.pic2Id].some((id) => id && outsource.has(id)),
        ),
      );
  });
  const orderRows =
    wantedOrderIds.length === 0
      ? []
      : await freshAll<Row>(
          db,
          db
            .prepare(
              `SELECT id, po_no, sales_order_no, customer_po_id, product_code, quantity, org_id
                 FROM production_orders WHERE id IN (${marks(wantedOrderIds.length)})`,
            )
            .bind(...wantedOrderIds),
        );
  const orders = new Map(orderRows.map((o) => [text(o.id), o]));

  type Derived = {
    order: Row;
    workerId: string;
    itemCode: string;
    quantity: number;
    rateSen: number;
    shareBp: number;
    completedDate: string;
  };
  const toDelete: { id: string; orderId: string }[] = [];
  const toUpdate: { id: string; quantity: number; shareBp: number; amountSen: number }[] = [];

  for (const r of monthScans) {
    const orderId = text(r.productionOrderId, r.production_order_id);
    const entry = byOrder.get(orderId);
    const order = orders.get(orderId);
    const workerId = text(r.workerId, r.worker_id);
    const shareBp = entry ? workerShareBp(entry.cards, workerId) : 0;
    if (!entry || shareBp === 0) {
      toDelete.push({ id: text(r.id), orderId });
      continue;
    }
    if (!order) continue;
    const quantity = Number(order.quantity) || 0;
    const amountSen = pieceAmountSen(quantity, Number(r.rateSen ?? r.rate_sen) || 0, shareBp);
    if (
      quantity !== (Number(r.quantity) || 0) ||
      shareBp !== (Number(r.shareBp ?? r.share_bp) || 0) ||
      amountSen !== (Number(r.amountSen ?? r.amount_sen) || 0)
    ) {
      toUpdate.push({ id: text(r.id), quantity, shareBp, amountSen });
    }
  }

  const derived: Derived[] = [];
  const ratesByWorker = new Map<string, Map<string, number>>();
  const newOrders: { orderId: string; workers: Map<string, number> }[] = [];
  for (const [orderId, entry] of byOrder) {
    if (!orders.has(orderId)) continue;
    const existing = recordByOrder.get(orderId);
    if (existing && !toDelete.some((d) => d.id === text(existing.id))) continue;
    const workers = new Map<string, number>();
    for (const workerId of outsource.keys()) {
      const shareBp = workerShareBp(entry.cards, workerId);
      if (shareBp > 0) workers.set(workerId, shareBp);
    }
    if (workers.size > 0) newOrders.push({ orderId, workers });
  }
  const rateWorkerIds = [...new Set(newOrders.flatMap((o) => [...o.workers.keys()]))];
  if (rateWorkerIds.length > 0) {
    const rateRows = await freshAll<Row>(
      db,
      db
        .prepare(
          `SELECT worker_id, item_code, rate_sen FROM outsource_piece_rates WHERE worker_id IN (${marks(rateWorkerIds.length)})`,
        )
        .bind(...rateWorkerIds),
    );
    for (const r of rateRows) {
      const id = text(r.workerId, r.worker_id);
      const rates = ratesByWorker.get(id) ?? new Map<string, number>();
      rates.set(text(r.itemCode, r.item_code), Number(r.rateSen ?? r.rate_sen) || 0);
      ratesByWorker.set(id, rates);
    }
  }
  for (const { orderId, workers } of newOrders) {
    const entry = byOrder.get(orderId) as OrderCards;
    const order = orders.get(orderId) as Row;
    const productCode = text(order.productCode, order.product_code);
    const quantity = Number(order.quantity) || 0;
    const base = {
      productionOrderId: orderId,
      poNo: text(order.poNo, order.po_no),
      productCode,
      quantity,
      completedDate: entry.completedDate,
      workerIds: [...workers.keys()],
    };
    if (workers.size > 1) {
      result.pending.push({ kind: "TWO_OUTSOURCE", ...base, missing: [] });
      continue;
    }
    const [[workerId, shareBp]] = [...workers];
    const items = pieceItemsForOrder(productCode, entry.labels);
    const { rateSen, missing } = orderRate(items, ratesByWorker.get(workerId) ?? new Map());
    if (rateSen === null) {
      result.pending.push({ kind: "NO_RATE", ...base, missing });
      continue;
    }
    derived.push({ order, workerId, itemCode: items.join(" + "), quantity, rateSen, shareBp, completedDate: entry.completedDate });
  }

  if ((await loadLockedPayrollPeriods(db)).has(period)) return result;

  for (const { id } of toDelete) {
    await db.prepare("DELETE FROM outsource_piece_records WHERE id = ?").bind(id).run();
    result.removed++;
  }
  for (const u of toUpdate) {
    await db
      .prepare("UPDATE outsource_piece_records SET quantity = ?, share_bp = ?, amount_sen = ? WHERE id = ?")
      .bind(u.quantity, u.shareBp, u.amountSen, u.id)
      .run();
  }
  for (const want of derived) {
    const worker = outsource.get(want.workerId);
    const id = `opc-${crypto.randomUUID().slice(0, 8)}`;
    await db
      .prepare(
        `INSERT INTO outsource_piece_records
           (id, worker_id, emp_no, worker_name, production_order_id, po_no, sales_order_no, customer_po_id,
            product_code, item_code, quantity, rate_sen, amount_sen, payroll_period, org_id,
            source, share_bp, completed_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCAN', ?, ?)
         ON CONFLICT (production_order_id) DO NOTHING`,
      )
      .bind(
        id, want.workerId, worker?.empNo ?? "", worker?.name ?? "", text(want.order.id),
        text(want.order.poNo, want.order.po_no), text(want.order.salesOrderNo, want.order.sales_order_no),
        text(want.order.customerPoId ?? want.order.customerPOId, want.order.customer_po_id),
        text(want.order.productCode, want.order.product_code), want.itemCode, want.quantity, want.rateSen,
        pieceAmountSen(want.quantity, want.rateSen, want.shareBp), period,
        text(want.order.orgId, want.order.org_id) || "hookka", want.shareBp, want.completedDate,
      )
      .run();
    const landed = await freshFirst<{ id: string }>(
      db,
      db.prepare("SELECT id FROM outsource_piece_records WHERE id = ?").bind(id),
    );
    if (landed) result.added++;
  }
  return result;
}

export type WorkerPieceLine = {
  completedDate: string;
  poNo: string;
  itemCode: string;
  quantity: number;
  rateSen: number;
  shareBp: number;
  amountSen: number;
};

export async function loadWorkerPieceLines(db: Runner, workerId: string, period: string): Promise<WorkerPieceLine[]> {
  await ensureOutsourcePieceTables(db);
  const rows = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT completed_date, po_no, item_code, quantity, rate_sen, share_bp, amount_sen
           FROM outsource_piece_records WHERE worker_id = ? AND payroll_period = ?
          ORDER BY completed_date, po_no`,
      )
      .bind(workerId, period),
  );
  return rows.map((r) => ({
    completedDate: text(r.completedDate, r.completed_date),
    poNo: text(r.poNo, r.po_no),
    itemCode: text(r.itemCode, r.item_code),
    quantity: Number(r.quantity) || 0,
    rateSen: Number(r.rateSen ?? r.rate_sen) || 0,
    shareBp: Number(r.shareBp ?? r.share_bp) || 10000,
    amountSen: Number(r.amountSen ?? r.amount_sen) || 0,
  }));
}

/** Payroll month already recorded per order, for the Outsource Work Payroll column. */
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
