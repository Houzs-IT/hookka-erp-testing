import { freshAll, freshFirst } from "./worker-penalties";
import { isScopeSewn } from "./sewing-scope";
import type {
  PieceSlotState,
  SewingCardState,
  SewingScope,
  SewingScopeLookup,
} from "./sewing-scope";

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
  `CREATE TABLE IF NOT EXISTS outsource_issues (
     id                  TEXT PRIMARY KEY,
     org_id              TEXT NOT NULL DEFAULT 'hookka',
     worker_id           TEXT NOT NULL,
     emp_no              TEXT,
     worker_name         TEXT,
     item_key            TEXT NOT NULL,
     qr_raw              TEXT NOT NULL,
     production_order_id TEXT NOT NULL,
     wip_key             TEXT,
     piece_no            INTEGER,
     total_pieces        INTEGER,
     po_no               TEXT NOT NULL,
     product_code        TEXT,
     product_name        TEXT,
     item_label          TEXT,
     status              TEXT NOT NULL DEFAULT 'INCOMPLETE' CHECK (status IN ('INCOMPLETE', 'COMPLETED')),
     issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
     issued_by           TEXT,
     completed_at        TIMESTAMPTZ
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_issues_item
     ON outsource_issues (org_id, item_key)`,
  `CREATE INDEX IF NOT EXISTS idx_outsource_issues_worker_status
     ON outsource_issues (worker_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_outsource_issues_order
     ON outsource_issues (production_order_id) WHERE status = 'INCOMPLETE'`,
  `CREATE INDEX IF NOT EXISTS idx_outsource_issues_issued_at
     ON outsource_issues (issued_at DESC)`,
];

const CONCURRENT_CREATE_ERROR_CODES = new Set(["23505", "42P07", "42710"]);

let _applied = false;

export async function ensureOutsourceIssueTable(db: Runner): Promise<void> {
  if (_applied) return;
  for (const statement of DDL) await runCreateStatement(db, statement);
  _applied = true;
}

async function runCreateStatement(db: Runner, statement: string): Promise<void> {
  try {
    await db.prepare(statement).run();
  } catch (error) {
    if (!isConcurrentCreateError(error)) throw error;
    await db.prepare(statement).run();
  }
}

function isConcurrentCreateError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return CONCURRENT_CREATE_ERROR_CODES.has(String(error.code));
}

export const OUTSOURCE_ISSUE_ENFORCE_KEY = "outsource_issue.enforce";
export const ISSUE_LIST_CAP = 500;
const RECENT_COMPLETED_DAYS = 30;
const MALAYSIA_OFFSET = "+08:00";

export type IssueStatus = "INCOMPLETE" | "COMPLETED";

export interface OutsourceIssue {
  id: string;
  workerId: string;
  empNo: string;
  workerName: string;
  itemKey: string;
  productionOrderId: string;
  wipKey: string | null;
  pieceNo: number | null;
  totalPieces: number | null;
  poNo: string;
  productCode: string;
  productName: string;
  itemLabel: string;
  status: IssueStatus;
  issuedAt: string;
  issuedBy: string;
  completedAt: string | null;
}

export interface OutsourceIssueWithSewing extends OutsourceIssue {
  sewingDone: boolean;
}

export interface IssueWorker {
  id: string;
  empNo: string;
  name: string;
}

export interface OutsourceWorkerSummary extends IssueWorker {
  incompleteCount: number;
}

type Row = Record<string, unknown>;

const text = (camel: unknown, snake?: unknown): string => String(camel ?? snake ?? "");
const optionalNumber = (camel: unknown, snake?: unknown): number | null => {
  const value = camel ?? snake;
  return value === null || value === undefined ? null : Number(value);
};

function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toIssue(row: Row): OutsourceIssue {
  return {
    id: text(row.id),
    workerId: text(row.workerId, row.worker_id),
    empNo: text(row.empNo, row.emp_no),
    workerName: text(row.workerName, row.worker_name),
    itemKey: text(row.itemKey, row.item_key),
    productionOrderId: text(row.productionOrderId, row.production_order_id),
    wipKey: (row.wipKey ?? row.wip_key ?? null) as string | null,
    pieceNo: optionalNumber(row.pieceNo, row.piece_no),
    totalPieces: optionalNumber(row.totalPieces, row.total_pieces),
    poNo: text(row.poNo, row.po_no),
    productCode: text(row.productCode, row.product_code),
    productName: text(row.productName, row.product_name),
    itemLabel: text(row.itemLabel, row.item_label),
    status: text(row.status) === "COMPLETED" ? "COMPLETED" : "INCOMPLETE",
    issuedAt: toIso(row.issuedAt ?? row.issued_at) ?? "",
    issuedBy: text(row.issuedBy, row.issued_by),
    completedAt: toIso(row.completedAt ?? row.completed_at),
  };
}

export function itemKeyOf(scope: SewingScope): string {
  return `${scope.productionOrderId}|${scope.wipKey ?? "*"}|${scope.pieceNo ?? "*"}`;
}

export function scopesOverlap(
  issue: { wipKey: string | null; pieceNo: number | null },
  scope: SewingScope,
): boolean {
  const sameWip =
    issue.wipKey === null || scope.wipKey === null || issue.wipKey === scope.wipKey;
  const samePiece =
    issue.pieceNo === null || scope.pieceNo === null || issue.pieceNo === scope.pieceNo;
  return sameWip && samePiece;
}

async function findByItemKey(
  db: Runner,
  orgId: string,
  itemKey: string,
): Promise<OutsourceIssue | null> {
  const row = await freshFirst<Row>(
    db,
    db
      .prepare("SELECT * FROM outsource_issues WHERE org_id = ? AND item_key = ?")
      .bind(orgId, itemKey),
  );
  return row ? toIssue(row) : null;
}

async function loadOrderIssues(
  db: Runner,
  orgId: string,
  productionOrderId: string,
): Promise<OutsourceIssue[]> {
  const rows = await freshAll<Row>(
    db,
    db
      .prepare("SELECT * FROM outsource_issues WHERE org_id = ? AND production_order_id = ?")
      .bind(orgId, productionOrderId),
  );
  return rows.map(toIssue);
}

export type IssueOutcome =
  | { kind: "issued"; issue: OutsourceIssue }
  | { kind: "already-issued"; issue: OutsourceIssue }
  | { kind: "already-sewn" };

export async function issueItem(
  db: Runner,
  request: {
    orgId: string;
    worker: IssueWorker;
    lookup: Extract<SewingScopeLookup, { kind: "found" }>;
    qrRaw: string;
    issuedBy: string;
  },
): Promise<IssueOutcome> {
  await ensureOutsourceIssueTable(db);
  const { orgId, worker, lookup, qrRaw, issuedBy } = request;
  const itemKey = itemKeyOf(lookup.scope);

  const onOrder = await loadOrderIssues(db, orgId, lookup.scope.productionOrderId);
  const overlapping = onOrder.filter((issue) => scopesOverlap(issue, lookup.scope));
  const existing = overlapping.find((issue) => issue.itemKey === itemKey) ?? overlapping[0];
  if (existing) return { kind: "already-issued", issue: existing };
  if (lookup.isSewn) return { kind: "already-sewn" };

  const orderRow = await freshFirst<Row>(
    db,
    db
      .prepare("SELECT productCode FROM production_orders WHERE id = ?")
      .bind(lookup.scope.productionOrderId),
  );
  const inserted = await db
    .prepare(
      `INSERT INTO outsource_issues
         (id, org_id, worker_id, emp_no, worker_name, item_key, qr_raw, production_order_id,
          wip_key, piece_no, total_pieces, po_no, product_code, product_name, item_label,
          status, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INCOMPLETE', ?)
       ON CONFLICT (org_id, item_key) DO NOTHING
       RETURNING *`,
    )
    .bind(
      `oi-${crypto.randomUUID()}`,
      orgId,
      worker.id,
      worker.empNo,
      worker.name,
      itemKey,
      qrRaw,
      lookup.scope.productionOrderId,
      lookup.scope.wipKey,
      lookup.scope.pieceNo,
      lookup.totalPieces,
      lookup.order.poNo ?? "",
      text(orderRow?.productCode, orderRow?.product_code),
      lookup.order.productName,
      lookup.itemLabel,
      issuedBy,
    )
    .first<Row>();
  if (inserted) return { kind: "issued", issue: toIssue(inserted) };

  const winner = await findByItemKey(db, orgId, itemKey);
  if (!winner) {
    throw new Error(`outsource_issues insert hit a conflict but no row exists for ${itemKey}`);
  }
  return { kind: "already-issued", issue: winner };
}

export type UndoOutcome =
  | { kind: "undone"; issue: OutsourceIssue }
  | { kind: "not-found" }
  | { kind: "already-completed"; issue: OutsourceIssue };

export async function undoIssue(
  db: Runner,
  request: { orgId: string; id: string },
): Promise<UndoOutcome> {
  await ensureOutsourceIssueTable(db);
  const deleted = await db
    .prepare(
      "DELETE FROM outsource_issues WHERE id = ? AND org_id = ? AND status = 'INCOMPLETE' RETURNING *",
    )
    .bind(request.id, request.orgId)
    .first<Row>();
  if (deleted) return { kind: "undone", issue: toIssue(deleted) };
  const remaining = await freshFirst<Row>(
    db,
    db
      .prepare("SELECT * FROM outsource_issues WHERE id = ? AND org_id = ?")
      .bind(request.id, request.orgId),
  );
  if (!remaining) return { kind: "not-found" };
  return { kind: "already-completed", issue: toIssue(remaining) };
}

export interface IssueFilter {
  workerId?: string;
  status?: IssueStatus;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

async function attachSewingStatus(
  db: Runner,
  issues: OutsourceIssue[],
): Promise<OutsourceIssueWithSewing[]> {
  if (issues.length === 0) return [];
  const orderIds = [...new Set(issues.map((issue) => issue.productionOrderId))];
  const cards = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT id, productionOrderId, wipKey, status FROM job_cards
          WHERE departmentCode = 'FAB_SEW' AND productionOrderId IN (${orderIds.map(() => "?").join(",")})`,
      )
      .bind(...orderIds),
  );
  const cardsByOrder = new Map<string, SewingCardState[]>();
  for (const card of cards) {
    const orderId = text(card.productionOrderId, card.production_order_id);
    const list = cardsByOrder.get(orderId) ?? [];
    list.push({
      id: text(card.id),
      wipKey: (card.wipKey ?? card.wip_key ?? null) as string | null,
      status: (card.status ?? null) as string | null,
    });
    cardsByOrder.set(orderId, list);
  }
  const openCardIds = cards
    .filter((card) => !["COMPLETED", "TRANSFERRED"].includes(text(card.status)))
    .map((card) => text(card.id));
  const slots: PieceSlotState[] = [];
  if (openCardIds.length > 0) {
    const slotRows = await freshAll<Row>(
      db,
      db
        .prepare(
          `SELECT jobCardId, pieceNo, pic1Id FROM piece_pics
            WHERE jobCardId IN (${openCardIds.map(() => "?").join(",")})`,
        )
        .bind(...openCardIds),
    );
    for (const slot of slotRows) {
      slots.push({
        jobCardId: text(slot.jobCardId, slot.job_card_id),
        pieceNo: Number(slot.pieceNo ?? slot.piece_no),
        pic1Id: (slot.pic1Id ?? slot.pic1_id ?? null) as string | null,
      });
    }
  }
  return issues.map((issue) => ({
    ...issue,
    sewingDone: isScopeSewn(
      {
        productionOrderId: issue.productionOrderId,
        wipKey: issue.wipKey,
        pieceNo: issue.pieceNo,
      },
      cardsByOrder.get(issue.productionOrderId) ?? [],
      slots,
    ),
  }));
}

export async function listIssues(
  db: Runner,
  request: { orgId: string; filter: IssueFilter },
): Promise<OutsourceIssueWithSewing[]> {
  await ensureOutsourceIssueTable(db);
  const { filter } = request;
  const conditions = ["org_id = ?"];
  const params: unknown[] = [request.orgId];
  if (filter.workerId) {
    conditions.push("worker_id = ?");
    params.push(filter.workerId);
  }
  if (filter.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter.fromDate) {
    conditions.push("issued_at >= ?");
    params.push(`${filter.fromDate}T00:00:00${MALAYSIA_OFFSET}`);
  }
  if (filter.toDate) {
    conditions.push("issued_at <= ?");
    params.push(`${filter.toDate}T23:59:59.999${MALAYSIA_OFFSET}`);
  }
  const search = (filter.search ?? "").trim().toLowerCase();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      `(LOWER(po_no) LIKE ? OR LOWER(COALESCE(product_name, '')) LIKE ? OR LOWER(COALESCE(product_code, '')) LIKE ? OR LOWER(COALESCE(item_label, '')) LIKE ? OR LOWER(COALESCE(worker_name, '')) LIKE ?)`,
    );
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  const rows = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT * FROM outsource_issues WHERE ${conditions.join(" AND ")}
          ORDER BY issued_at DESC LIMIT ${ISSUE_LIST_CAP + 1}`,
      )
      .bind(...params),
  );
  return attachSewingStatus(db, rows.map(toIssue));
}

export async function listWorkerIssues(
  db: Runner,
  request: { orgId: string; workerId: string },
): Promise<{ incomplete: OutsourceIssue[]; completedRecent: OutsourceIssue[] }> {
  await ensureOutsourceIssueTable(db);
  const incomplete = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT * FROM outsource_issues WHERE org_id = ? AND worker_id = ? AND status = 'INCOMPLETE'
          ORDER BY issued_at ASC LIMIT ${ISSUE_LIST_CAP}`,
      )
      .bind(request.orgId, request.workerId),
  );
  const completedRecent = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT * FROM outsource_issues WHERE org_id = ? AND worker_id = ? AND status = 'COMPLETED'
            AND completed_at >= now() - interval '${RECENT_COMPLETED_DAYS} days'
          ORDER BY completed_at DESC LIMIT ${ISSUE_LIST_CAP}`,
      )
      .bind(request.orgId, request.workerId),
  );
  return { incomplete: incomplete.map(toIssue), completedRecent: completedRecent.map(toIssue) };
}

const truthy = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || value === "t" || value === "true";

export async function loadOutsourceWorker(
  db: Runner,
  workerId: string,
): Promise<IssueWorker | null> {
  const row = await freshFirst<Row>(
    db,
    db
      .prepare("SELECT id, empNo, name, status, isOutsource FROM workers WHERE id = ?")
      .bind(workerId),
  );
  if (!row || !truthy(row.isOutsource ?? row.is_outsource) || text(row.status) !== "ACTIVE") {
    return null;
  }
  return { id: text(row.id), empNo: text(row.empNo, row.emp_no), name: text(row.name) };
}

export async function listOutsourceWorkers(
  db: Runner,
  orgId: string,
): Promise<OutsourceWorkerSummary[]> {
  await ensureOutsourceIssueTable(db);
  const workers = await freshAll<Row>(
    db,
    db.prepare("SELECT id, empNo, name, status, isOutsource FROM workers"),
  );
  const counts = await freshAll<Row>(
    db,
    db
      .prepare(
        "SELECT worker_id, COUNT(*) AS n FROM outsource_issues WHERE org_id = ? AND status = 'INCOMPLETE' GROUP BY worker_id",
      )
      .bind(orgId),
  );
  const countByWorker = new Map(
    counts.map((row) => [text(row.workerId, row.worker_id), Number(row.n)]),
  );
  return workers
    .filter((row) => truthy(row.isOutsource ?? row.is_outsource) && text(row.status) === "ACTIVE")
    .map((row) => ({
      id: text(row.id),
      empNo: text(row.empNo, row.emp_no),
      name: text(row.name),
      incompleteCount: countByWorker.get(text(row.id)) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function isEnforced(db: Runner): Promise<boolean> {
  const row = await freshFirst<Row>(
    db,
    db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(OUTSOURCE_ISSUE_ENFORCE_KEY),
  );
  if (!row?.value) return false;
  try {
    return JSON.parse(String(row.value)) === true;
  } catch (error) {
    console.error("[outsource-issue] enforce switch is not valid JSON, treating as off", error);
    return false;
  }
}

export type SewingHandover =
  | { kind: "none" }
  | { kind: "holder"; issueIds: string[] }
  | { kind: "refused"; code: "NOT_ISSUED_TO_YOU" | "ISSUED_TO_OTHER"; message: string };

async function findHeldIssues(
  db: Runner,
  request: { orgId: string; workerId: string; scope: SewingScope },
): Promise<SewingHandover> {
  await ensureOutsourceIssueTable(db);
  const onOrder = await loadOrderIssues(db, request.orgId, request.scope.productionOrderId);
  const mine = onOrder.filter(
    (issue) =>
      issue.workerId === request.workerId &&
      issue.status === "INCOMPLETE" &&
      scopesOverlap(issue, request.scope),
  );
  return mine.length > 0 ? { kind: "holder", issueIds: mine.map((issue) => issue.id) } : { kind: "none" };
}

export async function checkSewingHandover(
  db: Runner,
  request: { orgId: string; workerId: string; scope: SewingScope },
): Promise<SewingHandover> {
  const { orgId, workerId, scope } = request;
  let enforced: boolean;
  try {
    enforced = await isEnforced(db);
  } catch (error) {
    console.error("[outsource-issue] enforce switch unreadable, not blocking the scan", error);
    return { kind: "none" };
  }
  if (!enforced) {
    try {
      return await findHeldIssues(db, request);
    } catch (error) {
      console.error("[outsource-issue] holder lookup failed, not blocking the scan", error);
      return { kind: "none" };
    }
  }

  await ensureOutsourceIssueTable(db);
  const onOrder = await loadOrderIssues(db, orgId, scope.productionOrderId);
  const overlapping = onOrder.filter((issue) => scopesOverlap(issue, scope));
  const heldByOther = overlapping.find(
    (issue) => issue.status === "INCOMPLETE" && issue.workerId !== workerId,
  );
  if (heldByOther) {
    return {
      kind: "refused",
      code: "ISSUED_TO_OTHER",
      message: `This item was issued to ${heldByOther.workerName || "another worker"}. Only that person can complete it.`,
    };
  }
  const mine = overlapping.filter(
    (issue) => issue.workerId === workerId && issue.status === "INCOMPLETE",
  );
  if (mine.length > 0) return { kind: "holder", issueIds: mine.map((issue) => issue.id) };
  if (overlapping.some((issue) => issue.workerId === workerId && issue.status === "COMPLETED")) {
    return { kind: "none" };
  }
  const worker = await loadOutsourceWorker(db, workerId);
  if (worker) {
    return {
      kind: "refused",
      code: "NOT_ISSUED_TO_YOU",
      message: "This item was not issued to you. Ask the office to issue it first.",
    };
  }
  return { kind: "none" };
}

export async function closeSewingHandover(
  db: Runner,
  handover: SewingHandover,
): Promise<number> {
  if (handover.kind !== "holder") return 0;
  let closed = 0;
  for (const issueId of handover.issueIds) {
    const row = await db
      .prepare(
        "UPDATE outsource_issues SET status = 'COMPLETED', completed_at = now() WHERE id = ? AND status = 'INCOMPLETE' RETURNING id",
      )
      .bind(issueId)
      .first<Row>();
    if (row) closed += 1;
  }
  return closed;
}

export async function finishSewingHandover(
  db: Runner,
  handover: SewingHandover,
  context: { productionOrderId: string; workerId: string },
  shouldClose?: () => Promise<boolean>,
): Promise<void> {
  try {
    if (shouldClose && !(await shouldClose())) return;
    await closeSewingHandover(db, handover);
  } catch (error) {
    console.error(
      "[outsource-issue] Fabric Sewing completed but the issue could not be closed; it still shows INCOMPLETE",
      { ...context, handover, error },
    );
  }
}

export async function closeIssuesHeldOnFinishedSewing(
  db: Runner,
  request: { orgId: string; workerId: string; scope: SewingScope },
): Promise<void> {
  try {
    await closeSewingHandover(db, await findHeldIssues(db, request));
  } catch (error) {
    console.error(
      "[outsource-issue] sewing was already done and the holder's issue could not be closed",
      { workerId: request.workerId, scope: request.scope, error },
    );
  }
}
