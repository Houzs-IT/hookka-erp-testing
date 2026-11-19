import { freshAll, freshFirst, loadLockedPayrollPeriods } from "./worker-penalties";
import {
  ensureOutsourcePieceTables,
  insertPieceRecord,
  loadPieceOrders,
  loadRateMap,
  loadSewLabels,
} from "./outsource-piece";
import { orderRate, pieceAmountSen, pieceItemsForOrder } from "../../lib/outsource-piece";

type Stmt = {
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  first<T = unknown>(): Promise<T | null>;
};

interface Runner {
  prepare(sql: string): Stmt & { bind(...args: unknown[]): Stmt };
  batch?(stmts: unknown[]): Promise<Array<{ results?: unknown[] }>>;
}

type Row = Record<string, unknown>;

const SEWING_DEPARTMENT = "FAB_SEW";
const FINISHED_STATUSES: readonly string[] = ["COMPLETED", "TRANSFERRED"];

const payrollMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur",
  year: "numeric",
  month: "2-digit",
});

export interface ApprovedIssue {
  productionOrderId: string;
  departmentCode: string;
  workerId: string;
  empNo: string;
  workerName: string;
}

export type ApprovedPayOutcome =
  | { kind: "recorded"; period: string; amountSen: number }
  | { kind: "not-sewing" }
  | { kind: "sewing-not-finished" }
  | { kind: "not-all-this-worker" }
  | { kind: "already-recorded" }
  | { kind: "month-locked"; period: string }
  | { kind: "missing-rate"; missing: string[] };

const text = (camel: unknown, snake?: unknown): string => String(camel ?? snake ?? "");

export function payrollMonthOf(moment: Date): string {
  return payrollMonthFormatter.format(moment).slice(0, 7);
}

interface CoverRow {
  jobCardId: string;
  pieceNo: number | null;
  workerId: string;
  status: string;
  totalPieces: number | null;
}

async function loadSewingCards(db: Runner, productionOrderId: string): Promise<Row[]> {
  return freshAll<Row>(
    db,
    db
      .prepare("SELECT id, status FROM job_cards WHERE productionOrderId = ? AND departmentCode = ?")
      .bind(productionOrderId, SEWING_DEPARTMENT),
  );
}

async function loadCoverRows(db: Runner, cardIds: readonly string[]): Promise<CoverRow[]> {
  const rows = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT oc.job_card_id, oc.piece_no, oi.worker_id, oi.status, oi.total_pieces
           FROM outsource_issue_cards oc JOIN outsource_issues oi ON oi.id = oc.issue_id
          WHERE oc.job_card_id IN (${cardIds.map(() => "?").join(",")})`,
      )
      .bind(...cardIds),
  );
  return rows.map((row) => {
    const pieceNo = row.pieceNo ?? row.piece_no;
    const totalPieces = row.totalPieces ?? row.total_pieces;
    return {
      jobCardId: text(row.jobCardId, row.job_card_id),
      pieceNo: pieceNo === null || pieceNo === undefined ? null : Number(pieceNo),
      workerId: text(row.workerId, row.worker_id),
      status: text(row.status),
      totalPieces: totalPieces === null || totalPieces === undefined ? null : Number(totalPieces),
    };
  });
}

function isCardCoveredBy(cover: readonly CoverRow[], cardId: string): boolean {
  const rows = cover.filter((row) => row.jobCardId === cardId);
  if (rows.length === 0) return false;
  if (rows.some((row) => row.pieceNo === null)) return true;
  const piecesNeeded = Math.max(...rows.map((row) => row.totalPieces ?? 1));
  return new Set(rows.map((row) => row.pieceNo)).size >= piecesNeeded;
}

function isWholeOrderThisWorkers(cover: readonly CoverRow[], cardIds: readonly string[], workerId: string): boolean {
  if (cover.some((row) => row.workerId !== workerId || row.status !== "COMPLETED")) return false;
  return cardIds.every((cardId) => isCardCoveredBy(cover, cardId));
}

export async function recordApprovedPieceWages(
  db: Runner,
  request: { orgId: string; issue: ApprovedIssue; createdBy: string | null; approvedAt: Date },
): Promise<ApprovedPayOutcome> {
  const { orgId, issue, createdBy, approvedAt } = request;
  if (issue.departmentCode !== SEWING_DEPARTMENT) return { kind: "not-sewing" };

  const cards = await loadSewingCards(db, issue.productionOrderId);
  if (cards.length === 0 || cards.some((card) => !FINISHED_STATUSES.includes(text(card.status)))) {
    return { kind: "sewing-not-finished" };
  }
  const cardIds = cards.map((card) => text(card.id));
  if (!isWholeOrderThisWorkers(await loadCoverRows(db, cardIds), cardIds, issue.workerId)) {
    return { kind: "not-all-this-worker" };
  }

  await ensureOutsourcePieceTables(db);
  const existing = await freshFirst<Row>(
    db,
    db.prepare("SELECT id FROM outsource_piece_records WHERE production_order_id = ?").bind(issue.productionOrderId),
  );
  if (existing) return { kind: "already-recorded" };

  const period = payrollMonthOf(approvedAt);
  if ((await loadLockedPayrollPeriods(db)).has(period)) return { kind: "month-locked", period };

  const [order] = await loadPieceOrders(db, orgId, [issue.productionOrderId]);
  if (!order) throw new Error(`production order ${issue.productionOrderId} vanished while recording its piece wages`);
  const sewLabels = await loadSewLabels(db, [order.id]);
  const items = pieceItemsForOrder(order.productCode, sewLabels.get(order.id) ?? []);
  const { rateSen, missing } = orderRate(items, await loadRateMap(db, issue.workerId));
  if (rateSen === null) return { kind: "missing-rate", missing };

  const amountSen = pieceAmountSen(order.quantity, rateSen);
  const landed = await insertPieceRecord(db, {
    worker: { id: issue.workerId, empNo: issue.empNo, name: issue.workerName },
    order,
    itemCode: items.join(" + "),
    rateSen,
    amountSen,
    period,
    orgId,
    createdBy,
  });
  return landed ? { kind: "recorded", period, amountSen } : { kind: "already-recorded" };
}
