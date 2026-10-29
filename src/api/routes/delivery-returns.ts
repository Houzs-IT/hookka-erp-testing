// ---------------------------------------------------------------------------
// Delivery Returns route.
//
// A Delivery Return is raised when delivered goods have a problem. Header +
// item lines, linking back to the source DO/SO and forward to either a
// Service Order (repair & re-deliver) or a Credit Note (pure return).
//
// Phase 1 (this file): the document itself — runtime-ensured tables + list /
// get / create / cancel. The accounting + inventory cascade (stock reversal,
// CN convert, service-order spawn, re-deliver) land as additional endpoints in
// later phases. Deploy does NOT replay migration files, so the tables are
// self-applied at runtime (see 0207_delivery_returns.sql for the record copy).
// ---------------------------------------------------------------------------
import { Hono, type Context } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { idempotent } from "../lib/idempotency";
import { customerScopeSql } from "../lib/customer-scope";
import { getOrgId } from "../lib/tenant";
import { reverseFGForDeliveryReturn, undoFGForDeliveryReturn } from "../lib/do-cost-cascade";
import {
  buildFgStockEventStatements,
  ensureFgStockEventsSchema,
  loadFgUnitsForEvent,
  SYSTEM_ACTOR,
} from "../lib/fg-stock-events";
import {
  createDeliveryReturnRecord,
  ensureDeliveryReturnTables,
  loadDoItemsForReturn,
  loadReturnedQtyByPo,
} from "../lib/delivery-return-create";
import { returnableByLine } from "../../lib/delivery-return-qty";

const app = new Hono<Env>();
export default app;

// -- types + row builders ----------------------------------------------------
type ReturnHeaderRow = {
  id: string;
  returnNo: string;
  deliveryOrderId: string | null;
  doNo: string | null;
  salesOrderId: string | null;
  companySOId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPOId: string | null;
  returnType: string | null;
  status: string;
  serviceCaseId: string | null;
  serviceOrderId: string | null;
  creditNoteId: string | null;
  creditNoteStatus?: string | null;
  reason: string | null;
  notes: string | null;
  returnedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
type ReturnItemRow = {
  id: string;
  deliveryReturnId: string;
  productionOrderId: string | null;
  poNo: string | null;
  productCode: string | null;
  productName: string | null;
  wipLabel: string | null;
  quantity: number;
  problem: string | null;
  disposition: string | null;
  fgUnitId: string | null;
  wasInvoiced: number;
  fabricCode: string | null;
  sizeLabel: string | null;
  specialOrder: string | null;
  salesOrderNo: string | null;
  customerPO: string | null;
  customerSO: string | null;
  reference: string | null;
  itemCategory: string | null;
  divanHeightInches: number | null;
  legHeightInches: number | null;
  gapInches: number | null;
};

const HEADER_COLS = `id, return_no AS "returnNo", delivery_order_id AS "deliveryOrderId",
  do_no AS "doNo", sales_order_id AS "salesOrderId", company_so_id AS "companySOId",
  customer_id AS "customerId", customer_name AS "customerName", customer_po_id AS "customerPOId",
  return_type AS "returnType", status, service_case_id AS "serviceCaseId",
  service_order_id AS "serviceOrderId", credit_note_id AS "creditNoteId",
  (SELECT cn.status FROM credit_notes cn WHERE cn.id = delivery_returns.credit_note_id) AS "creditNoteStatus",
  reason, notes, returned_at AS "returnedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

const ITEM_COLS = `id, delivery_return_id AS "deliveryReturnId", production_order_id AS "productionOrderId",
  po_no AS "poNo", product_code AS "productCode", product_name AS "productName",
  wip_label AS "wipLabel", quantity, problem, disposition, fg_unit_id AS "fgUnitId",
  was_invoiced AS "wasInvoiced", fabric_code AS "fabricCode", size_label AS "sizeLabel",
  special_order AS "specialOrder", sales_order_no AS "salesOrderNo",
  customer_po AS "customerPO", customer_so AS "customerSO", reference AS "reference",
  item_category AS "itemCategory", divan_height_inches AS "divanHeightInches",
  leg_height_inches AS "legHeightInches", gap_inches AS "gapInches"`;

function rowToItem(r: ReturnItemRow) {
  return {
    id: r.id,
    productionOrderId: r.productionOrderId ?? "",
    poNo: r.poNo ?? "",
    productCode: r.productCode ?? "",
    productName: r.productName ?? "",
    wipLabel: r.wipLabel ?? "",
    quantity: Number(r.quantity ?? 0),
    problem: r.problem ?? "",
    disposition: r.disposition ?? "",
    fgUnitId: r.fgUnitId ?? "",
    wasInvoiced: Boolean(r.wasInvoiced),
    fabricCode: r.fabricCode ?? "",
    sizeLabel: r.sizeLabel ?? "",
    specialOrder: r.specialOrder ?? "",
    salesOrderNo: r.salesOrderNo ?? "",
    customerPO: r.customerPO ?? "",
    customerSO: r.customerSO ?? "",
    reference: r.reference ?? "",
    itemCategory: r.itemCategory ?? "",
    divanHeightInches: r.divanHeightInches ?? null,
    legHeightInches: r.legHeightInches ?? null,
    gapInches: r.gapInches ?? null,
  };
}
function rowToReturn(h: ReturnHeaderRow, items: ReturnItemRow[] = []) {
  return {
    id: h.id,
    returnNo: h.returnNo,
    deliveryOrderId: h.deliveryOrderId ?? "",
    doNo: h.doNo ?? "",
    salesOrderId: h.salesOrderId ?? "",
    companySOId: h.companySOId ?? "",
    customerId: h.customerId ?? "",
    customerName: h.customerName ?? "",
    customerPOId: h.customerPOId ?? "",
    returnType: h.returnType ?? "",
    status: h.status ?? "OPEN",
    serviceCaseId: h.serviceCaseId ?? "",
    serviceOrderId: h.serviceOrderId ?? "",
    creditNoteId: h.creditNoteId ?? "",
    // The linked note's own status: CN_ISSUED is set when "Return to stock"
    // is pressed, before any note exists (BUG-2026-10-17-318), so the pages
    // label the return from this (src/lib/delivery-return-status.ts).
    creditNoteStatus: h.creditNoteStatus ?? "",
    reason: h.reason ?? "",
    notes: h.notes ?? "",
    returnedAt: h.returnedAt ?? "",
    items: items.map(rowToItem),
  };
}

async function loadItems(
  db: D1Database,
  drId: string,
): Promise<ReturnItemRow[]> {
  const res = await db
    .prepare(
      `SELECT ${ITEM_COLS} FROM delivery_return_items WHERE delivery_return_id = ?`,
    )
    .bind(drId)
    .all<ReturnItemRow>();
  return res.results ?? [];
}

// -- GET / — list ------------------------------------------------------------
app.get("/", async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "read");
  if (denied) return denied;
  await ensureDeliveryReturnTables(c.var.DB);
  const orgId = getOrgId(c);
  // A delivery return narrows to its customer like the delivery order it
  // reverses (owner 2026-08-05).
  const scope = await customerScopeSql(c, "customer_id");
  const scopeClause = scope.clause ? ` AND ${scope.clause}` : "";
  const res = await c.var.DB
    .prepare(
      `SELECT ${HEADER_COLS} FROM delivery_returns
        WHERE org_id = ?${scopeClause} ORDER BY created_at DESC LIMIT 500`,
    )
    .bind(orgId, ...scope.binds)
    .all<ReturnHeaderRow>();
  const headers = res.results ?? [];
  // Attach a lightweight item summary per row (count + first problem).
  const data = [] as ReturnType<typeof rowToReturn>[];
  for (const h of headers) {
    const items = await loadItems(c.var.DB, h.id);
    data.push(rowToReturn(h, items));
  }
  return c.json({ success: true, data, total: data.length });
});

// -- GET /:id — detail -------------------------------------------------------
app.get("/:id", async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "read");
  if (denied) return denied;
  await ensureDeliveryReturnTables(c.var.DB);
  const id = c.req.param("id");
  const h = await c.var.DB
    .prepare(`SELECT ${HEADER_COLS} FROM delivery_returns WHERE id = ?`)
    .bind(id)
    .first<ReturnHeaderRow>();
  if (!h) return c.json({ success: false, error: "Delivery return not found" }, 404);
  const items = await loadItems(c.var.DB, id);
  // The credit note raised from this return (2026-10-17) by its number, so
  // the page names it instead of showing an id.
  let creditNoteNo = "";
  if (h.creditNoteId) {
    const cn = await c.var.DB.prepare("SELECT * FROM credit_notes WHERE id = ?").bind(h.creditNoteId)
      .first<Record<string, unknown>>().catch(() => null);
    creditNoteNo = String((cn?.noteNumber ?? cn?.note_number) ?? "");
  }
  return c.json({ success: true, data: { ...rowToReturn(h, items), creditNoteNo } });
});

// -- POST / — create a return from a delivered DO's problem lines -----------
// Body: { deliveryOrderId, reason?, items: [{ productionOrderId, poNo,
//   productCode, productName, wipLabel, quantity, problem, fgUnitId?,
//   wasInvoiced? }] }. Header snapshot (SO/customer) resolved from the DO.
// -- GET /do-items?doId= — a DO's lines, ENRICHED, for the "New return" picker --
// The picker used to read the DO API's own items, which carry neither the line's
// customer PO nor its Reference — so two identical products on one DO looked
// identical and the operator could not tell which to tick (owner 2026-07-16:
// "要不然我怎麼知道要選那個"). This returns the same enriched lines the create
// path persists, from the one loader, so the picker and the record agree.
app.get("/do-items", async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "read");
  if (denied) return denied;
  const doId = String(c.req.query("doId") ?? "").trim();
  if (!doId) return c.json({ success: false, error: "doId is required" }, 400);
  try {
    await ensureDeliveryReturnTables(c.var.DB);
    const items = await loadDoItemsForReturn(c.var.DB, doId);
    // HK-0110: partial returns — the picker defaults each line to (and caps it
    // at) what is still returnable. The create cap stays the authority.
    const returnable = returnableByLine(items, await loadReturnedQtyByPo(c.var.DB, doId));
    return c.json({
      success: true,
      data: items.map((it, i) => ({ ...it, returnableQty: returnable[i] })),
    });
  } catch (err) {
    console.error("[delivery-returns/do-items] failed:", err);
    return c.json({ success: false, error: "Failed to load the delivery order's items" }, 500);
  }
});

app.post("/", idempotent(), async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "update");
  if (denied) return denied;
  await ensureDeliveryReturnTables(c.var.DB);
  const orgId = getOrgId(c);
  try {
    const body = await c.req.json();
    const doId = String(body.deliveryOrderId ?? "").trim();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!doId || items.length === 0) {
      return c.json(
        { success: false, error: "deliveryOrderId and at least one item are required" },
        400,
      );
    }

    // Header snapshot + item insert live in the shared helper so the office
    // "New return" flow and the driver "Not received" flow write an identical
    // record (see lib/delivery-return-create.ts).
    const created = await createDeliveryReturnRecord(c.var.DB, orgId, {
      doId,
      items,
      reason: String(body.reason ?? ""),
      notes: String(body.notes ?? ""),
    });
    if (!created.ok) {
      return c.json({ success: false, error: created.error }, created.status ?? 409);
    }

    const header = await c.var.DB
      .prepare(`SELECT ${HEADER_COLS} FROM delivery_returns WHERE id = ?`)
      .bind(created.id)
      .first<ReturnHeaderRow>();
    const itemRows = await loadItems(c.var.DB, created.id);
    return c.json(
      { success: true, data: header ? rowToReturn(header, itemRows) : null },
      201,
    );
  } catch (err) {
    console.error("[delivery-returns] POST failed:", err);
    return c.json({ success: false, error: "Failed to create delivery return" }, 400);
  }
});

// -- POST /:id/return-to-stock ----------------------------------------------
// Puts the returned goods back into stock: (1) reverses the COGS / inventory
// value — for each returned line, adds the qty back to the fg_batches it was
// delivered from + writes a reversing ADJUSTMENT (IN) cost_ledger row
// (idempotent per DR via refType='DELIVERY_RETURN'); (2) flags the returned
// fg_units RETURNED; (3) moves the DR to RETURNED_TO_STOCK. All in one batch so
// it rolls back together.
// Builds the "put returned goods back into sellable stock" statements:
//   (1) reverse the COGS / FG value — add qty back to fg_batches + one reversing
//       ADJUSTMENT (IN) cost_ledger row per slice, idempotent per DR;
//   (2) flag the physical fg_units RETURNED.
// SHARED by the "Return to stock" outcome AND the "Pure return → CN" outcome (a
// pure return = the good comes back to sellable stock AND the money is refunded
// via a Credit Note), so inventory is credited in ONE step from either. It is
// safe against double-count: reverseFGForDeliveryReturn no-ops if this DR has
// already reversed (guard on refType='DELIVERY_RETURN' AND refId=drId).
async function buildReturnToStockStatements(
  db: D1Database,
  drId: string,
  doId: string | null,
  items: ReturnItemRow[],
  now: string,
): Promise<{ statements: D1PreparedStatement[]; reversedCogsSen: number }> {
  const statements: D1PreparedStatement[] = [];
  let reversedCogsSen = 0;
  if (doId) {
    const rev = await reverseFGForDeliveryReturn(
      db,
      drId,
      doId,
      items.map((it) => ({ productCode: it.productCode, quantity: it.quantity })),
      now,
    );
    statements.push(...rev.statements);
    reversedCogsSen = rev.reversedCogsSen;
  }
  const unitIds = items.map((it) => it.fgUnitId).filter((x): x is string => !!x);
  if (unitIds.length) {
    const marks = unitIds.map(() => "?").join(",");
    // FG stock ledger — an IN counter-row per returned piece, paired with the
    // FIFO credit reverseFGForDeliveryReturn just built above. Read the FROM
    // side first: the same id list, so the two agree by construction.
    await ensureFgStockEventsSchema(db);
    const returnedUnits = await loadFgUnitsForEvent(
      db,
      `id IN (${marks})`,
      unitIds,
    );
    statements.push(
      db
        .prepare(
          `UPDATE fg_units SET status='RETURNED', returnedAt=? WHERE id IN (${marks})`,
        )
        .bind(now, ...unitIds),
      ...buildFgStockEventStatements(db, returnedUnits, {
        toStatus: "RETURNED",
        doc: { docType: "DELIVERY_RETURN", docId: drId, docNo: null },
        actor: SYSTEM_ACTOR,
        occurredAt: now,
        note: "Delivery return — returned to stock",
        reverses: doId
          ? { docType: "DELIVERY_ORDER", docId: doId }
          : null,
      }),
    );
  }
  return { statements, reversedCogsSen };
}

// HK-0110 — undo buildReturnToStockStatements, for cancelling a
// RETURNED_TO_STOCK return: FG batches + COGS back via
// undoFGForDeliveryReturn, the returned fg_units back to DELIVERED (with their
// stock-event counter-rows), the return to CANCELLED — one batch. Refused
// (nothing written) if a unit is no longer RETURNED or a batch no longer holds
// the returned qty. Race-safe: a per-return lock first, then a guard that the
// return is still RETURNED_TO_STOCK, and a last guard that no batch went
// negative; either guard failing divides by zero and rolls the batch back.
export async function buildUndoReturnToStockStatements(
  db: D1Database,
  drId: string,
  items: ReturnItemRow[],
  now: string,
): Promise<
  | { ok: true; statements: D1PreparedStatement[]; undoneCogsSen: number }
  | { ok: false; error: string }
> {
  const unitIds = items.map((it) => it.fgUnitId).filter((x): x is string => !!x);
  const marks = unitIds.map(() => "?").join(",");
  let units: Awaited<ReturnType<typeof loadFgUnitsForEvent>> = [];
  if (unitIds.length) {
    await ensureFgStockEventsSchema(db);
    units = await loadFgUnitsForEvent(db, `id IN (${marks})`, unitIds);
    const moved = units.find((u) => u.status !== "RETURNED");
    if (moved) {
      return {
        ok: false,
        error: `Cannot undo: FG unit ${moved.id} is now ${moved.status ?? "missing"}, not RETURNED — it was re-used since this return. Fix the stock with a stock adjustment instead.`,
      };
    }
  }
  const fg = await undoFGForDeliveryReturn(db, drId, now);
  if (!fg.ok) return fg;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(`SELECT pg_advisory_xact_lock(hashtext('delivery_return_undo:' || ?)::bigint)`)
      .bind(drId),
    db
      .prepare(
        `SELECT 1 / CASE WHEN EXISTS (
           SELECT 1 FROM delivery_returns WHERE id = ? AND status = 'RETURNED_TO_STOCK'
         ) THEN 1 ELSE 0 END AS "stillReturned"`,
      )
      .bind(drId),
    ...fg.statements,
  ];
  if (unitIds.length) {
    statements.push(
      db
        .prepare(
          `UPDATE fg_units SET status='DELIVERED', returnedAt=NULL
            WHERE id IN (${marks}) AND status='RETURNED'`,
        )
        .bind(...unitIds),
      ...buildFgStockEventStatements(db, units, {
        toStatus: "DELIVERED",
        doc: { docType: "DELIVERY_RETURN", docId: drId, docNo: null },
        actor: SYSTEM_ACTOR,
        occurredAt: now,
        note: "Delivery return cancelled — return to stock undone",
        reverses: { docType: "DELIVERY_RETURN", docId: drId },
      }),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE delivery_returns SET status='CANCELLED', updated_at=?
          WHERE id=? AND status='RETURNED_TO_STOCK'`,
      )
      .bind(now, drId),
  );
  if (fg.batchIds.length) {
    statements.push(
      db
        .prepare(
          `SELECT 1 / CASE WHEN EXISTS (
             SELECT 1 FROM fg_batches WHERE id IN (${fg.batchIds.map(() => "?").join(",")}) AND remainingQty < 0
           ) THEN 0 ELSE 1 END AS "batchesOk"`,
        )
        .bind(...fg.batchIds),
    );
  }
  return { ok: true, statements, undoneCogsSen: fg.undoneCogsSen };
}

// Status flip that fails loudly: the UPDATE only matches the status the caller
// read, and the trailing check raises (division by zero) when it matched
// nothing, so a batch holding stock changes rolls back instead of committing
// next to a return that someone else already resolved.
const STATUS_RACE_ERROR = "This return was changed by someone else just now. Reload and check.";
function flipStatus(db: D1Database, sql: string, binds: unknown[], id: string, to: string, now: string) {
  return [
    db.prepare(sql).bind(...binds),
    db
      .prepare(
        `SELECT 1 / CASE WHEN EXISTS (
           SELECT 1 FROM delivery_returns WHERE id = ? AND status = ? AND updated_at = ?
         ) THEN 1 ELSE 0 END AS "flipped"`,
      )
      .bind(id, to, now),
  ];
}
async function runFlip(c: Context<Env>, statements: D1PreparedStatement[]) {
  try {
    await c.var.DB.batch(statements);
    return null;
  } catch (err) {
    if (/division by zero/i.test(err instanceof Error ? err.message : String(err))) {
      return c.json({ success: false, error: STATUS_RACE_ERROR }, 409);
    }
    throw err;
  }
}

app.post("/:id/return-to-stock", async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "update");
  if (denied) return denied;
  await ensureDeliveryReturnTables(c.var.DB);
  const id = c.req.param("id");
  const now = new Date().toISOString();

  const header = await c.var.DB
    .prepare(`SELECT delivery_order_id AS "doId", status FROM delivery_returns WHERE id = ?`)
    .bind(id)
    .first<{ doId: string | null; status: string }>();
  if (!header) return c.json({ success: false, error: "Not found" }, 404);
  // One-and-done: an outcome can only be chosen from OPEN. This is what makes
  // "restock" and "repair" MUTUALLY EXCLUSIVE — you cannot return-to-stock (+1
  // good stock) and then also repair-&-remake (produce a replacement), which
  // would double-count inventory + COGS. Repair leaves the returned unit OUT of
  // sellable stock; only restock / pure-return credit it back.
  if (header.status !== "OPEN") {
    return c.json(
      { success: false, error: `This return is already resolved (${header.status}).` },
      409,
    );
  }
  const items = await loadItems(c.var.DB, id);

  const { statements, reversedCogsSen } = await buildReturnToStockStatements(
    c.var.DB,
    id,
    header.doId,
    items,
    now,
  );
  statements.push(
    ...flipStatus(
      c.var.DB,
      `UPDATE delivery_returns SET status='RETURNED_TO_STOCK', returned_at=?, updated_at=? WHERE id=? AND status='OPEN'`,
      [now, now, id],
      id,
      "RETURNED_TO_STOCK",
      now,
    ),
  );

  const lost = await runFlip(c, statements);
  if (lost) return lost;
  return c.json({ success: true, reversedCogsSen });
});

// -- POST /:id/set-outcome — record repair-vs-pure-return + status ----------
// Body: { returnType: 'REPAIR_REDELIVER' | 'PURE_RETURN', serviceOrderId?,
// creditNoteId? }. The actual Service Order / Credit Note are created via the
// existing (tested) service-case and credit-note flows; this records the
// decision + any resulting doc id + advances the DR status.
app.post("/:id/set-outcome", async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "update");
  if (denied) return denied;
  await ensureDeliveryReturnTables(c.var.DB);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const type = body.returnType === "PURE_RETURN" ? "PURE_RETURN" : "REPAIR_REDELIVER";
  const now = new Date().toISOString();

  const header = await c.var.DB
    .prepare(`SELECT delivery_order_id AS "doId", status FROM delivery_returns WHERE id = ?`)
    .bind(id)
    .first<{ doId: string | null; status: string }>();
  if (!header) return c.json({ success: false, error: "Not found" }, 404);
  // Mutual exclusivity (see return-to-stock): an outcome is settable only from
  // OPEN, so REPAIR can never follow a RESTOCK (which would book the defective
  // unit as good stock AND produce a replacement — a double count).
  if (header.status !== "OPEN") {
    return c.json(
      { success: false, error: `This return is already resolved (${header.status}).` },
      409,
    );
  }

  const status = type === "PURE_RETURN" ? "CN_ISSUED" : "SERVICE_SPAWNED";
  const statements: D1PreparedStatement[] = [];
  // PURE_RETURN = the good comes back to sellable stock (reverse COGS + fg_units)
  // AND the customer is refunded via a Credit Note. Do the inventory half here so
  // it is one step, not two. REPAIR_REDELIVER touches NO inventory — the unit is
  // repaired / remade for the same customer and never re-enters sellable stock.
  if (type === "PURE_RETURN") {
    const items = await loadItems(c.var.DB, id);
    const rts = await buildReturnToStockStatements(c.var.DB, id, header.doId, items, now);
    statements.push(...rts.statements);
  }
  statements.push(
    ...flipStatus(
      c.var.DB,
      `UPDATE delivery_returns
          SET return_type=?, status=?, service_case_id=?, service_order_id=?, credit_note_id=?,
              returned_at=COALESCE(?, returned_at), updated_at=?
        WHERE id=? AND status='OPEN'`,
      [
        type,
        status,
        String(body.serviceCaseId ?? ""),
        String(body.serviceOrderId ?? ""),
        String(body.creditNoteId ?? ""),
        type === "PURE_RETURN" ? now : null,
        now,
        id,
      ],
      id,
      status,
      now,
    ),
  );
  const lost = await runFlip(c, statements);
  if (lost) return lost;
  return c.json({ success: true });
});

// -- POST /:id/mark-redelivered ---------------------------------------------
app.post("/:id/mark-redelivered", async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "update");
  if (denied) return denied;
  await ensureDeliveryReturnTables(c.var.DB);
  const id = c.req.param("id");
  const now = new Date().toISOString();
  const h = await c.var.DB
    .prepare(`SELECT status FROM delivery_returns WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();
  if (!h) return c.json({ success: false, error: "Not found" }, 404);
  // Only a repair that was handed to service can come back as re-delivered.
  if (h.status !== "SERVICE_SPAWNED") {
    return c.json({ success: false, error: `Cannot mark a ${h.status} return as re-delivered` }, 409);
  }
  const lost = await runFlip(
    c,
    flipStatus(
      c.var.DB,
      `UPDATE delivery_returns SET status='REDELIVERED', updated_at=? WHERE id=? AND status='SERVICE_SPAWNED'`,
      [now, id],
      id,
      "REDELIVERED",
      now,
    ),
  );
  if (lost) return lost;
  return c.json({ success: true });
});

// -- POST /:id/cancel --------------------------------------------------------
app.post("/:id/cancel", async (c) => {
  const denied = await requirePermission(c, "delivery-returns", "update");
  if (denied) return denied;
  await ensureDeliveryReturnTables(c.var.DB);
  const id = c.req.param("id");
  const h = await c.var.DB
    .prepare(`SELECT status FROM delivery_returns WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();
  if (!h) return c.json({ success: false, error: "Not found" }, 404);
  if (h.status === "CLOSED" || h.status === "REDELIVERED" || h.status === "CN_ISSUED") {
    return c.json(
      { success: false, error: `Cannot cancel a ${h.status} return` },
      409,
    );
  }
  // HK-0110: RETURNED_TO_STOCK already credited stock back. Cancelling it
  // (which also frees its qty under the return cap) must take that back first.
  if (h.status === "RETURNED_TO_STOCK") {
    const now = new Date().toISOString();
    const undo = await buildUndoReturnToStockStatements(
      c.var.DB,
      id,
      await loadItems(c.var.DB, id),
      now,
    );
    if (!undo.ok) return c.json({ success: false, error: undo.error }, 409);
    try {
      await c.var.DB.batch(undo.statements);
    } catch (err) {
      if (/division by zero/i.test(err instanceof Error ? err.message : String(err))) {
        return c.json(
          { success: false, error: "Not undone: this return was already cancelled, or its stock was used while undoing. Reload and check." },
          409,
        );
      }
      throw err;
    }
    return c.json({ success: true, undoneCogsSen: undo.undoneCogsSen });
  }
  const now = new Date().toISOString();
  const lost = await runFlip(
    c,
    flipStatus(
      c.var.DB,
      `UPDATE delivery_returns SET status='CANCELLED', updated_at=? WHERE id=? AND status=?`,
      [now, id, h.status],
      id,
      "CANCELLED",
      now,
    ),
  );
  if (lost) return lost;
  return c.json({ success: true });
});
