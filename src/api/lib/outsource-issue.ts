import { freshAll, freshFirst } from "./worker-penalties";
import type { IssueTarget, TargetLookup } from "./outsource-targets";

type Stmt = {
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  first<T = unknown>(): Promise<T | null>;
};

type BoundStmt = Stmt & { bind(...args: unknown[]): Stmt };

interface Runner {
  prepare(sql: string): BoundStmt;
  batch?(stmts: unknown[]): Promise<Array<{ results?: unknown[] }>>;
}

export const OUTSOURCE_ISSUE_DDL: string[] = [
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
  `ALTER TABLE outsource_issues ADD COLUMN IF NOT EXISTS department_code TEXT NOT NULL DEFAULT 'FAB_SEW'`,
  `CREATE TABLE IF NOT EXISTS outsource_issue_cards (
     issue_id    TEXT NOT NULL,
     job_card_id TEXT NOT NULL,
     piece_no    INTEGER,
     org_id      TEXT NOT NULL DEFAULT 'hookka',
     PRIMARY KEY (issue_id, job_card_id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_outsource_issue_cards_slot
     ON outsource_issue_cards (job_card_id, COALESCE(piece_no, 0))`,
  `CREATE INDEX IF NOT EXISTS idx_outsource_issue_cards_card
     ON outsource_issue_cards (job_card_id)`,
  `INSERT INTO outsource_issue_cards (issue_id, job_card_id, piece_no, org_id)
     SELECT oi.id, jc.id, oi.piece_no, oi.org_id
       FROM outsource_issues oi
       JOIN job_cards jc ON jc.productionOrderId = oi.production_order_id
        AND jc.departmentCode = 'FAB_SEW'
        AND (oi.wip_key IS NULL OR jc.wipKey = oi.wip_key)
      WHERE NOT EXISTS (SELECT 1 FROM outsource_issue_cards oc WHERE oc.issue_id = oi.id)
     ON CONFLICT DO NOTHING`,
];

const CONCURRENT_CREATE_ERROR_CODES = new Set(["23505", "42P07", "42710"]);
const UNIQUE_VIOLATION = "23505";
const MISSING_RELATION_CODES = new Set(["42P01", "42703"]);

let _applied = false;

export async function ensureOutsourceIssueTable(db: Runner): Promise<void> {
  if (_applied) return;
  for (const statement of OUTSOURCE_ISSUE_DDL) await runCreateStatement(db, statement);
  _applied = true;
}

async function runCreateStatement(db: Runner, statement: string): Promise<void> {
  try {
    await db.prepare(statement).run();
  } catch (error) {
    if (!CONCURRENT_CREATE_ERROR_CODES.has(errorCode(error))) throw error;
    await db.prepare(statement).run();
  }
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return String(error.code);
}

async function withTable<T>(db: Runner, run: () => Promise<T>): Promise<T> {
  if (_applied) return run();
  try {
    return await run();
  } catch (error) {
    if (!MISSING_RELATION_CODES.has(errorCode(error))) throw error;
    await ensureOutsourceIssueTable(db);
    return run();
  }
}

async function runBatch(db: Runner, statements: Stmt[]): Promise<void> {
  if (typeof db.batch !== "function") {
    throw new Error("outsource issue writes need a database that supports batch");
  }
  await db.batch(statements);
}

export const OUTSOURCE_ISSUE_ENFORCE_KEY = "outsource_issue.enforce";
export const ISSUE_LIST_CAP = 500;
const RECENT_COMPLETED_DAYS = 30;
const MALAYSIA_OFFSET = "+08:00";
const FINISHED_STATUSES: readonly string[] = ["COMPLETED", "TRANSFERRED"];
const DEFAULT_DEPARTMENT = "FAB_SEW";

export type IssueStatus = "INCOMPLETE" | "COMPLETED";

export interface OutsourceIssue {
  id: string;
  workerId: string;
  empNo: string;
  workerName: string;
  departmentCode: string;
  departmentName: string;
  productionOrderId: string;
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

export interface OutsourceIssueWithDone extends OutsourceIssue {
  workDone: boolean;
}

export interface IssueWorker {
  id: string;
  empNo: string;
  name: string;
  departmentCodes: string[];
}

export interface OutsourceWorkerSummary extends IssueWorker {
  departmentNames: string[];
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
  const departmentCode = text(row.departmentCode, row.department_code) || DEFAULT_DEPARTMENT;
  return {
    id: text(row.id),
    workerId: text(row.workerId, row.worker_id),
    empNo: text(row.empNo, row.emp_no),
    workerName: text(row.workerName, row.worker_name),
    departmentCode,
    departmentName: departmentCode,
    productionOrderId: text(row.productionOrderId, row.production_order_id),
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

const placeholders = (count: number): string => Array.from({ length: count }, () => "?").join(",");

export async function loadDepartmentNames(db: Runner): Promise<Map<string, string>> {
  const rows = await freshAll<Row>(db, db.prepare("SELECT code, name FROM departments"));
  return new Map(rows.map((row) => [text(row.code), text(row.name)]));
}

async function withDepartmentNames(db: Runner, issues: OutsourceIssue[]): Promise<OutsourceIssue[]> {
  if (issues.length === 0) return issues;
  const names = await loadDepartmentNames(db);
  return issues.map((issue) => ({
    ...issue,
    departmentName: names.get(issue.departmentCode) || issue.departmentCode,
  }));
}

export interface SlotRef {
  cardId: string;
  pieceNo: number | null;
}

export function slotKey(slot: SlotRef): string {
  return `${slot.cardId}|${slot.pieceNo ?? "*"}`;
}

export async function loadDoneSlots(db: Runner, slots: readonly SlotRef[]): Promise<Set<string>> {
  const done = new Set<string>();
  const cardIds = [...new Set(slots.map((slot) => slot.cardId))];
  if (cardIds.length === 0) return done;
  const cardRows = await freshAll<Row>(
    db,
    db
      .prepare(`SELECT id, status FROM job_cards WHERE id IN (${placeholders(cardIds.length)})`)
      .bind(...cardIds),
  );
  const finished = new Set(
    cardRows.filter((card) => FINISHED_STATUSES.includes(text(card.status))).map((card) => text(card.id)),
  );
  const pieceCardIds = [
    ...new Set(
      slots
        .filter((slot) => slot.pieceNo !== null && !finished.has(slot.cardId))
        .map((slot) => slot.cardId),
    ),
  ];
  const signed = new Set<string>();
  if (pieceCardIds.length > 0) {
    const slotRows = await freshAll<Row>(
      db,
      db
        .prepare(
          `SELECT jobCardId, pieceNo, pic1Id FROM piece_pics WHERE jobCardId IN (${placeholders(pieceCardIds.length)})`,
        )
        .bind(...pieceCardIds),
    );
    for (const row of slotRows) {
      if (row.pic1Id ?? row.pic1_id) {
        signed.add(
          slotKey({
            cardId: text(row.jobCardId, row.job_card_id),
            pieceNo: Number(row.pieceNo ?? row.piece_no),
          }),
        );
      }
    }
  }
  for (const slot of slots) {
    if (finished.has(slot.cardId) || signed.has(slotKey(slot))) done.add(slotKey(slot));
  }
  return done;
}

const piecesOverlap = (a: number | null, b: number | null): boolean => a === null || b === null || a === b;

async function findOverlappingIssues(
  db: Runner,
  orgId: string,
  target: IssueTarget,
): Promise<OutsourceIssue[]> {
  if (target.cardIds.length === 0) return [];
  const slotRows = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT issue_id, job_card_id, piece_no FROM outsource_issue_cards
          WHERE org_id = ? AND job_card_id IN (${placeholders(target.cardIds.length)})`,
      )
      .bind(orgId, ...target.cardIds),
  );
  const issueIds = [
    ...new Set(
      slotRows
        .filter((row) => piecesOverlap(optionalNumber(row.pieceNo, row.piece_no), target.pieceNo))
        .map((row) => text(row.issueId, row.issue_id)),
    ),
  ];
  if (issueIds.length === 0) return [];
  const issueRows = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT * FROM outsource_issues WHERE org_id = ? AND id IN (${placeholders(issueIds.length)})
          ORDER BY issued_at ASC`,
      )
      .bind(orgId, ...issueIds),
  );
  return issueRows.map(toIssue);
}

async function findIssueById(db: Runner, orgId: string, id: string): Promise<OutsourceIssue | null> {
  const row = await freshFirst<Row>(
    db,
    db.prepare("SELECT * FROM outsource_issues WHERE id = ? AND org_id = ?").bind(id, orgId),
  );
  return row ? toIssue(row) : null;
}

export type IssueOutcome =
  | { kind: "issued"; issue: OutsourceIssue }
  | { kind: "already-issued"; issue: OutsourceIssue }
  | { kind: "already-done" };

export async function issueItem(
  db: Runner,
  request: {
    orgId: string;
    worker: IssueWorker;
    lookup: Extract<TargetLookup, { kind: "found" }>;
    qrRaw: string;
    issuedBy: string;
  },
): Promise<IssueOutcome> {
  await ensureOutsourceIssueTable(db);
  const { orgId, worker, lookup, qrRaw, issuedBy } = request;
  const { target } = lookup;

  const existing = (await findOverlappingIssues(db, orgId, target))[0];
  if (existing) return { kind: "already-issued", issue: existing };
  if (lookup.isDone) return { kind: "already-done" };

  const orderRow = await freshFirst<Row>(
    db,
    db
      .prepare("SELECT productCode FROM production_orders WHERE id = ?")
      .bind(lookup.order.productionOrderId),
  );
  const id = `oi-${crypto.randomUUID()}`;
  const insertIssue = db
    .prepare(
      `INSERT INTO outsource_issues
         (id, org_id, worker_id, emp_no, worker_name, department_code, item_key, qr_raw,
          production_order_id, piece_no, total_pieces, po_no, product_code, product_name,
          item_label, status, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INCOMPLETE', ?)`,
    )
    .bind(
      id,
      orgId,
      worker.id,
      worker.empNo,
      worker.name,
      lookup.departmentCode,
      id,
      qrRaw,
      lookup.order.productionOrderId,
      target.pieceNo,
      lookup.totalPieces,
      lookup.order.poNo ?? "",
      text(orderRow?.productCode, orderRow?.product_code),
      lookup.order.productName,
      lookup.itemLabel,
      issuedBy,
    );
  const insertCards = target.cardIds.map((cardId) =>
    db
      .prepare(
        "INSERT INTO outsource_issue_cards (issue_id, job_card_id, piece_no, org_id) VALUES (?, ?, ?, ?)",
      )
      .bind(id, cardId, target.pieceNo, orgId),
  );
  try {
    await runBatch(db, [insertIssue, ...insertCards]);
  } catch (error) {
    if (errorCode(error) !== UNIQUE_VIOLATION) throw error;
    const winner = (await findOverlappingIssues(db, orgId, target))[0];
    if (!winner) throw error;
    return { kind: "already-issued", issue: winner };
  }
  const inserted = await findIssueById(db, orgId, id);
  if (!inserted) throw new Error(`outsource_issues row ${id} is missing right after its insert`);
  const [named] = await withDepartmentNames(db, [inserted]);
  return { kind: "issued", issue: named };
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
  const before = await findIssueById(db, request.orgId, request.id);
  if (!before) return { kind: "not-found" };
  if (before.status === "COMPLETED") return { kind: "already-completed", issue: before };
  await db
    .prepare(
      `WITH gone AS (
         DELETE FROM outsource_issues WHERE id = ? AND org_id = ? AND status = 'INCOMPLETE' RETURNING id
       )
       DELETE FROM outsource_issue_cards WHERE issue_id IN (SELECT id FROM gone)`,
    )
    .bind(request.id, request.orgId)
    .run();
  const remaining = await findIssueById(db, request.orgId, request.id);
  if (remaining) return { kind: "already-completed", issue: remaining };
  return { kind: "undone", issue: before };
}

export interface IssueFilter {
  workerId?: string;
  status?: IssueStatus;
  fromDate?: string;
  toDate?: string;
  search?: string;
}

async function loadIssueSlots(db: Runner, issueIds: string[]): Promise<Map<string, SlotRef[]>> {
  const byIssue = new Map<string, SlotRef[]>();
  if (issueIds.length === 0) return byIssue;
  const rows = await freshAll<Row>(
    db,
    db
      .prepare(
        `SELECT issue_id, job_card_id, piece_no FROM outsource_issue_cards
          WHERE issue_id IN (${placeholders(issueIds.length)})`,
      )
      .bind(...issueIds),
  );
  for (const row of rows) {
    const issueId = text(row.issueId, row.issue_id);
    const list = byIssue.get(issueId) ?? [];
    list.push({
      cardId: text(row.jobCardId, row.job_card_id),
      pieceNo: optionalNumber(row.pieceNo, row.piece_no),
    });
    byIssue.set(issueId, list);
  }
  return byIssue;
}

async function attachDone(db: Runner, issues: OutsourceIssue[]): Promise<OutsourceIssueWithDone[]> {
  if (issues.length === 0) return [];
  const slotsByIssue = await loadIssueSlots(db, issues.map((issue) => issue.id));
  const done = await loadDoneSlots(db, [...slotsByIssue.values()].flat());
  return issues.map((issue) => {
    const slots = slotsByIssue.get(issue.id) ?? [];
    return { ...issue, workDone: slots.length > 0 && slots.every((slot) => done.has(slotKey(slot))) };
  });
}

export type IssueStatusCounts = Record<IssueStatus | "ALL", number>;

export async function countIssuesByStatus(
  db: Runner,
  request: { orgId: string; filter: IssueFilter },
): Promise<IssueStatusCounts> {
  await ensureOutsourceIssueTable(db);
  const { conditions, params } = issueWhere(request.orgId, request.filter);
  const row = await freshFirst<Row>(
    db,
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'INCOMPLETE' THEN 1 ELSE 0 END) AS incomplete,
                SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed
           FROM outsource_issues WHERE ${conditions.join(" AND ")}`,
      )
      .bind(...params),
  );
  return {
    ALL: Number(row?.total ?? 0),
    INCOMPLETE: Number(row?.incomplete ?? 0),
    COMPLETED: Number(row?.completed ?? 0),
  };
}

export async function listIssues(
  db: Runner,
  request: { orgId: string; filter: IssueFilter },
): Promise<OutsourceIssueWithDone[]> {
  await ensureOutsourceIssueTable(db);
  const { conditions, params } = issueWhere(request.orgId, request.filter);
  if (request.filter.status) {
    conditions.push("status = ?");
    params.push(request.filter.status);
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
  return attachDone(db, await withDepartmentNames(db, rows.map(toIssue)));
}

/** Worker, date and search filters; the status filter is added by the caller. */
function issueWhere(orgId: string, filter: IssueFilter): { conditions: string[]; params: unknown[] } {
  const conditions = ["org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.workerId) {
    conditions.push("worker_id = ?");
    params.push(filter.workerId);
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
  return { conditions, params };
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
  return {
    incomplete: await withDepartmentNames(db, incomplete.map(toIssue)),
    completedRecent: await withDepartmentNames(db, completedRecent.map(toIssue)),
  };
}

export const truthy = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || value === "t" || value === "true";

export function workerDepartmentCodes(row: Row): string[] {
  const listed: unknown = row.departmentCodes ?? row.department_codes;
  let value: unknown = listed;
  if (typeof listed === "string" && listed) {
    try {
      value = JSON.parse(listed);
    } catch {
      value = null;
    }
  }
  const codes = Array.isArray(value)
    ? value.filter((code): code is string => typeof code === "string" && code.length > 0)
    : [];
  if (codes.length > 0) return codes;
  const single = text(row.departmentCode, row.department_code);
  return single ? [single] : [];
}

const WORKER_COLUMNS = "id, empNo, name, status, isOutsource, departmentCode, departmentCodes";

export async function loadOutsourceWorker(
  db: Runner,
  workerId: string,
): Promise<IssueWorker | null> {
  const row = await freshFirst<Row>(
    db,
    db.prepare(`SELECT ${WORKER_COLUMNS} FROM workers WHERE id = ?`).bind(workerId),
  );
  if (!row || !truthy(row.isOutsource ?? row.is_outsource) || text(row.status) !== "ACTIVE") {
    return null;
  }
  return {
    id: text(row.id),
    empNo: text(row.empNo, row.emp_no),
    name: text(row.name),
    departmentCodes: workerDepartmentCodes(row),
  };
}

export async function listOutsourceWorkers(
  db: Runner,
  orgId: string,
): Promise<OutsourceWorkerSummary[]> {
  await ensureOutsourceIssueTable(db);
  const workers = await freshAll<Row>(db, db.prepare(`SELECT ${WORKER_COLUMNS} FROM workers`));
  const counts = await freshAll<Row>(
    db,
    db
      .prepare(
        "SELECT worker_id, COUNT(*) AS n FROM outsource_issues WHERE org_id = ? AND status = 'INCOMPLETE' GROUP BY worker_id",
      )
      .bind(orgId),
  );
  const names = await loadDepartmentNames(db);
  const countByWorker = new Map(
    counts.map((row) => [text(row.workerId, row.worker_id), Number(row.n)]),
  );
  return workers
    .filter((row) => truthy(row.isOutsource ?? row.is_outsource) && text(row.status) === "ACTIVE")
    .map((row) => {
      const departmentCodes = workerDepartmentCodes(row);
      return {
        id: text(row.id),
        empNo: text(row.empNo, row.emp_no),
        name: text(row.name),
        departmentCodes,
        departmentNames: departmentCodes.map((code) => names.get(code) || code),
        incompleteCount: countByWorker.get(text(row.id)) ?? 0,
      };
    })
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

export type IssueHandover =
  | { kind: "none" }
  | { kind: "holder"; issueIds: string[] }
  | { kind: "refused"; code: "NOT_ISSUED_TO_YOU" | "ISSUED_TO_OTHER"; message: string };

async function findHeldIssues(
  db: Runner,
  request: { orgId: string; workerId: string; target: IssueTarget },
): Promise<IssueHandover> {
  const overlapping = await withTable(db, () =>
    findOverlappingIssues(db, request.orgId, request.target),
  );
  const mine = overlapping.filter(
    (issue) => issue.workerId === request.workerId && issue.status === "INCOMPLETE",
  );
  return mine.length > 0 ? { kind: "holder", issueIds: mine.map((issue) => issue.id) } : { kind: "none" };
}

async function readEnforced(db: Runner): Promise<boolean> {
  try {
    return await isEnforced(db);
  } catch (error) {
    console.error("[outsource-issue] enforce switch unreadable, not blocking the scan", error);
    return false;
  }
}

async function decideHandover(
  db: Runner,
  request: { orgId: string; workerId: string; target: IssueTarget; scannerIsOutsource: boolean },
): Promise<IssueHandover> {
  const { orgId, workerId, target, scannerIsOutsource } = request;
  const overlapping = await withTable(db, () => findOverlappingIssues(db, orgId, target));
  const open = overlapping.filter((issue) => issue.status === "INCOMPLETE");
  const heldByOther = open.find((issue) => issue.workerId !== workerId);
  if (heldByOther && (await readEnforced(db))) {
    return {
      kind: "refused",
      code: "ISSUED_TO_OTHER",
      message: `This item was issued to ${heldByOther.workerName || "another worker"}. Only that person can complete it.`,
    };
  }
  const mine = open.filter((issue) => issue.workerId === workerId);
  if (mine.length > 0) return { kind: "holder", issueIds: mine.map((issue) => issue.id) };
  const finishedMine = overlapping.some(
    (issue) => issue.workerId === workerId && issue.status === "COMPLETED",
  );
  if (scannerIsOutsource && !finishedMine && (await readEnforced(db))) {
    return {
      kind: "refused",
      code: "NOT_ISSUED_TO_YOU",
      message: "This item was not issued to you. Ask the office to issue it first.",
    };
  }
  return { kind: "none" };
}

export async function checkIssueHandover(
  db: Runner,
  request: { orgId: string; workerId: string; target: IssueTarget; scannerIsOutsource: boolean },
): Promise<IssueHandover> {
  try {
    return await decideHandover(db, request);
  } catch (error) {
    if (await readEnforced(db)) throw error;
    console.error("[outsource-issue] holder lookup failed, not blocking the scan", error);
    return { kind: "none" };
  }
}

async function closeDoneIssues(db: Runner, issueIds: readonly string[]): Promise<number> {
  const slotsByIssue = await loadIssueSlots(db, [...issueIds]);
  const done = await loadDoneSlots(db, [...slotsByIssue.values()].flat());
  let closed = 0;
  for (const issueId of issueIds) {
    const slots = slotsByIssue.get(issueId) ?? [];
    if (slots.length === 0 || !slots.every((slot) => done.has(slotKey(slot)))) continue;
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

export async function finishIssueHandover(
  db: Runner,
  handover: IssueHandover,
  context: { productionOrderId: string; workerId: string },
): Promise<void> {
  if (handover.kind !== "holder") return;
  try {
    await closeDoneIssues(db, handover.issueIds);
  } catch (error) {
    console.error(
      "[outsource-issue] the work was completed but the issue could not be closed; it still shows INCOMPLETE",
      { ...context, handover, error },
    );
  }
}

export async function closeHeldIssuesWhenDone(
  db: Runner,
  request: { orgId: string; workerId: string; loadTarget: () => Promise<IssueTarget> },
): Promise<void> {
  try {
    const target = await request.loadTarget();
    const held = await findHeldIssues(db, { orgId: request.orgId, workerId: request.workerId, target });
    if (held.kind === "holder") await closeDoneIssues(db, held.issueIds);
  } catch (error) {
    console.error(
      "[outsource-issue] the work was already done and the holder's issue could not be closed",
      { workerId: request.workerId, error },
    );
  }
}
