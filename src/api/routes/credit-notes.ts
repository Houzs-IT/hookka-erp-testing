// ---------------------------------------------------------------------------
// D1-backed credit-notes route.
//
// Mirrors the old src/api/routes/credit-notes.ts shape so the SPA frontend
// doesn't need any changes. The `items` column is stored as JSON TEXT in D1
// and is parsed back to an array of line items on read / stringified on write.
//
// GET / returns { success, data, total } — note the extra `total` field that
// the frontend expects (same for debit-notes).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { emitAudit } from "../lib/audit";
import {
  buildJournalEntryStatements,
  ledgerHasSource,
} from "../lib/journal-hash";
import { buildCreditNoteLedgerLegs } from "../lib/note-ledger";
import { ensureDeliveryReturnTables } from "../lib/delivery-return-create";
import { priceReturnLines, type InvoiceLineOfReturn, type InvoiceOfReturn, type ReturnLine } from "../../lib/cn-from-return";

const app = new Hono<Env>();

type CreditNoteRow = {
  id: string;
  noteNumber: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerId: string;
  customerName: string;
  date: string;
  reason: string | null;
  reasonDetail: string | null;
  totalAmount: number;
  status: string | null;
  approvedBy: string | null;
  items: string | null;
};

// PR 0 (2026-05-20, owner-confirmed) — rename to make the unit explicit.
// Original `unitPrice` / `total` were ambiguous — frontend stored in sen
// but the API accepted either sen or RM-decimal silently, so a caller
// posting `unitPrice: 4800.00` (meaning RM 4800) would land RM 48 in the
// outstandingSen cascade (100× off). New names force the unit at the
// contract surface, and the POST handler now validates the value is an
// integer (decimal RM values get rejected at the boundary).
type CNItem = {
  description: string;
  quantity: number;
  unitPriceSen: number;
  totalSen: number;
};

// Backward-compat shape for reading legacy CN rows whose JSON was written
// before the rename. Read-only — never written back in this shape.
type LegacyCNItem = {
  description: string;
  quantity: number;
  unitPrice?: number;
  total?: number;
  unitPriceSen?: number;
  totalSen?: number;
};

function parseItems(raw: string | null): CNItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LegacyCNItem[];
    // Promote legacy {unitPrice, total} → {unitPriceSen, totalSen}. The
    // numeric value is already in sen on every existing row (the column
    // total_amount is integer sen and items JSON mirrored that), the
    // rename is name-only.
    return parsed.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceSen: item.unitPriceSen ?? item.unitPrice ?? 0,
      totalSen: item.totalSen ?? item.total ?? 0,
    }));
  } catch {
    return [];
  }
}

function rowToCreditNote(row: CreditNoteRow) {
  return {
    id: row.id,
    noteNumber: row.noteNumber,
    invoiceId: row.invoiceId ?? "",
    invoiceNumber: row.invoiceNumber ?? "",
    customerId: row.customerId,
    customerName: row.customerName,
    date: row.date,
    reason: row.reason ?? "OTHER",
    reasonDetail: row.reasonDetail ?? "",
    items: parseItems(row.items),
    totalAmount: row.totalAmount,
    status: row.status ?? "DRAFT",
    approvedBy: row.approvedBy,
  };
}

function genId(): string {
  return `cn-${crypto.randomUUID().slice(0, 8)}`;
}

// A credit note is considered "issued" (i.e. applied against the invoice)
// when it's in any terminal-ish state. The D1 schema only has DRAFT /
// APPROVED / POSTED — treat both APPROVED and POSTED as issued. DRAFT is
// pending and does not mutate the invoice.
function isIssuedStatus(status: string | null | undefined): boolean {
  return status === "APPROVED" || status === "POSTED";
}

// Compose the statements that apply a CN's amount against the linked
// invoice:
//   * totalSen / subtotalSen are reduced by the CN's amountSen (floored at 0);
//   * paidAmount is left alone (we never over-credit);
//   * status is re-evaluated:
//       paidAmount >= new totalSen  → PAID
//       paidAmount >  0             → PARTIAL_PAID
//       (else retain existing status)
//
// Returns [] when the CN has no linked invoice or when amountSen <= 0.
async function buildInvoiceCascadeForCN(
  db: D1Database,
  invoiceId: string,
  amountSen: number,
  nowIso: string,
): Promise<D1PreparedStatement[]> {
  if (!invoiceId || amountSen <= 0) return [];
  const inv = await db
    .prepare(
      "SELECT id, totalSen, subtotalSen, paidAmount, status FROM invoices WHERE id = ?",
    )
    .bind(invoiceId)
    .first<{
      id: string;
      totalSen: number;
      subtotalSen: number;
      paidAmount: number;
      status: string;
    }>();
  if (!inv) return [];

  const newTotal = Math.max(0, inv.totalSen - amountSen);
  const newSubtotal = Math.max(0, inv.subtotalSen - amountSen);
  // paidAmount stays as-is — a credit note does NOT convert into a payment.
  const nextStatus =
    inv.paidAmount >= newTotal && newTotal >= 0 && inv.paidAmount > 0
      ? "PAID"
      : inv.paidAmount > 0
        ? "PARTIAL_PAID"
        : inv.status;

  return [
    db
      .prepare(
        `UPDATE invoices
            SET totalSen = ?, subtotalSen = ?, status = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(newTotal, newSubtotal, nextStatus, nowIso, invoiceId),
  ];
}

async function nextCNNo(db: D1Database): Promise<string> {
  // CN-YYMM-NNN sequential. Bug fix 2026-04-28: previous Math.random()*900+100
  // collision-prone and not monotonic. Pulls max-existing-suffix+1 in the
  // (year, month) bucket so new credit notes always increment.
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(2)}${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}`;
  const prefix = `CN-${yymm}-`;
  const res = await db
    .prepare(
      "SELECT noteNumber FROM credit_notes WHERE noteNumber LIKE ? ORDER BY noteNumber DESC LIMIT 1",
    )
    .bind(`${prefix}%`)
    .first<{ noteNumber: string }>();
  if (!res) return `${prefix}001`;
  const tail = res.noteNumber.replace(prefix, "");
  const seq = parseInt(tail, 10);
  if (!Number.isFinite(seq)) return `${prefix}001`;
  return `${prefix}${String(seq + 1).padStart(3, "0")}`;
}

// GET /api/credit-notes — list all
app.get("/", async (c) => {
  // RBAC gate (P3.3-followup) — credit-notes:read.
  const denied = await requirePermission(c, "credit-notes", "read");
  if (denied) return denied;
  const orgId = getOrgId(c);
  const res = await c.var.DB.prepare(
    "SELECT * FROM credit_notes WHERE orgId = ? ORDER BY date DESC",
  )
    .bind(orgId)
    .all<CreditNoteRow>();
  const data = (res.results ?? []).map(rowToCreditNote);
  return c.json({ success: true, data, total: data.length });
});

// ---------------------------------------------------------------------------
// GET /api/credit-notes/from-returns[?returnId=] — the delivery returns a
// credit note can be raised from (owner 2026-10-17, Finance v2: "create a
// Credit Note from a Delivery Return"). Each return with its customer, the
// invoice that billed its delivery order and its returned lines priced from
// that invoice (priceReturnLines). A return already turned into a note
// carries it — linked by delivery_return_id, or, for notes raised before the
// link existed, by the "Delivery Return <no>" detail the old prefill wrote.
// Read-only.
// ---------------------------------------------------------------------------
app.get("/from-returns", async (c) => {
  const denied = await requirePermission(c, "credit-notes", "create");
  if (denied) return denied;
  const db = c.var.DB;
  await ensureDeliveryReturnTables(db);
  const orgId = getOrgId(c);
  const returnId = c.req.query("returnId") || "";
  const heads = (await db.prepare(
    `SELECT id, return_no, delivery_order_id, customer_id, customer_name, status, returned_at, created_at
       FROM delivery_returns WHERE org_id = ? AND status <> 'CANCELLED'${returnId ? " AND id = ?" : ""}
      ORDER BY created_at DESC LIMIT 200`,
  ).bind(...(returnId ? [orgId, returnId] : [orgId])).all<Record<string, unknown>>()).results ?? [];
  if (!heads.length) return c.json({ success: true, data: [] });
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
  const str = (r: Record<string, unknown>, a: string, b: string) => String((r[a] ?? r[b]) ?? "");
  const ids = heads.map((h) => String(h.id));
  const doIds = [...new Set(heads.map((h) => str(h, "deliveryOrderId", "delivery_order_id")).filter(Boolean))];
  const [itemRes, invRes, cnRes] = await Promise.all([
    db.prepare(
      `SELECT delivery_return_id, production_order_id, product_code, product_name, quantity
         FROM delivery_return_items WHERE delivery_return_id IN (${marks(ids.length)})`,
    ).bind(...ids).all<Record<string, unknown>>(),
    doIds.length
      ? db.prepare(
          `SELECT id, invoiceNo, totalSen, paidAmount, delivery_order_id FROM invoices
            WHERE delivery_order_id IN (${marks(doIds.length)}) AND status NOT IN ('DRAFT','CANCELLED')`,
        ).bind(...doIds).all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
    db.prepare("SELECT * FROM credit_notes").all<Record<string, unknown>>(),
  ]);
  const invRows = invRes.results ?? [];
  const invIds = invRows.map((r) => String(r.id));
  // production_order_id on invoice lines is runtime-ensured elsewhere; an
  // engine without it simply prices nothing.
  const lineRows = invIds.length
    ? ((await db.prepare(
        `SELECT invoice_id, production_order_id, quantity, total_sen FROM invoice_items WHERE invoice_id IN (${marks(invIds.length)})`,
      ).bind(...invIds).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }))).results ?? [])
    : [];
  const invLines: InvoiceLineOfReturn[] = lineRows.map((l) => ({
    invoiceId: str(l, "invoiceId", "invoice_id"),
    productionOrderId: str(l, "productionOrderId", "production_order_id") || null,
    quantity: Number(l.quantity) || 0,
    totalSen: Math.round(Number(l.totalSen ?? l.total_sen) || 0),
  }));
  const notes = cnRes.results ?? [];
  const data = heads.map((h) => {
    const id = String(h.id);
    const returnNo = str(h, "returnNo", "return_no");
    const doId = str(h, "deliveryOrderId", "delivery_order_id");
    const invoices: InvoiceOfReturn[] = invRows
      .filter((r) => str(r, "deliveryOrderId", "delivery_order_id") === doId)
      .map((r) => ({
        id: String(r.id),
        invoiceNo: str(r, "invoiceNo", "invoice_no"),
        outstandingSen: Math.max(0, Math.round(Number(r.totalSen ?? r.total_sen) || 0) - Math.round(Number(r.paidAmount ?? r.paid_amount) || 0)),
      }));
    const lines: ReturnLine[] = (itemRes.results ?? [])
      .filter((i) => str(i, "deliveryReturnId", "delivery_return_id") === id)
      .map((i) => ({
        productionOrderId: str(i, "productionOrderId", "production_order_id") || null,
        productCode: str(i, "productCode", "product_code"),
        productName: str(i, "productName", "product_name"),
        quantity: Number(i.quantity) || 0,
      }));
    const draft = priceReturnLines(lines, invoices, invLines);
    const note = notes.find((n) => str(n, "deliveryReturnId", "delivery_return_id") === id)
      ?? (returnNo ? notes.find((n) => str(n, "reasonDetail", "reason_detail").trim() === `Delivery Return ${returnNo}`) : undefined);
    return {
      id, returnNo,
      date: (str(h, "returnedAt", "returned_at") || str(h, "createdAt", "created_at")).slice(0, 10),
      customerId: str(h, "customerId", "customer_id"),
      customerName: str(h, "customerName", "customer_name"),
      status: str(h, "status", "status"),
      ...draft,
      creditNote: note ? { id: String(note.id), noteNumber: str(note, "noteNumber", "note_number") } : null,
    };
  });
  return c.json({ success: true, data });
});

// The link from a note to the return it was raised from (2026-10-17).
// Self-applied before the first write; the flag is set only once it exists.
let cnReturnColEnsured = false;
async function ensureCreditNoteReturnColumn(db: Env["Variables"]["DB"]): Promise<void> {
  if (cnReturnColEnsured) return;
  await db.prepare("ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS delivery_return_id TEXT").run();
  cnReturnColEnsured = true;
}

// POST /api/credit-notes — create
app.post("/", async (c) => {
  // RBAC gate (P3.3-followup) — credit-notes:create.
  const denied = await requirePermission(c, "credit-notes", "create");
  if (denied) return denied;
  try {
    const body = await c.req.json();
    const { invoiceId, reason, reasonDetail, items } = body;
    // A note raised from a delivery return (2026-10-17): one note per return.
    const deliveryReturnId = typeof body.deliveryReturnId === "string" ? body.deliveryReturnId.trim() : "";
    await ensureCreditNoteReturnColumn(c.var.DB);
    if (deliveryReturnId) {
      const used = await c.var.DB.prepare("SELECT noteNumber FROM credit_notes WHERE delivery_return_id = ?")
        .bind(deliveryReturnId).first<{ noteNumber?: string; note_number?: string }>();
      if (used) {
        return c.json({ success: false, error: `This delivery return already has credit note ${used.noteNumber ?? used.note_number ?? ""}.` }, 409);
      }
    }
    if (!invoiceId || !reason || !items || items.length === 0) {
      return c.json(
        {
          success: false,
          error: "invoiceId, reason, and items are required",
        },
        400,
      );
    }
    // PR 5 (2026-05-20) — also pull the customer-block fields from the
    // invoice so the CN can snapshot them. Migration 0119 added these
    // columns to the invoices table; from this PR forward they're
    // populated at invoice-create time.
    const invoice = await c.var.DB.prepare(
      `SELECT id, invoiceNo, customerId, customerName, customerState,
              customerAddress, attention, customerPhone, totalSen, paidAmount
         FROM invoices WHERE id = ?`,
    )
      .bind(invoiceId)
      .first<{
        id: string;
        invoiceNo: string;
        customerId: string;
        customerName: string;
        customerState: string | null;
        customerAddress: string | null;
        attention: string | null;
        customerPhone: string | null;
        totalSen: number;
        paidAmount: number;
      }>();
    if (!invoice) {
      return c.json({ success: false, error: "Invoice not found" }, 404);
    }

    // PR 0 (2026-05-20) — require unitPriceSen and validate it's an integer.
    // Original code accepted `unitPrice` with no validation, so a caller
    // sending RM-decimal (e.g. 4800.00) would land 4800 in outstandingSen
    // = RM 48 instead of RM 4800 (100× discrepancy). Frontend was already
    // storing in sen; this just makes the contract explicit and fails
    // closed when a caller forgets.
    const rawItems = items as Array<{
      description?: string;
      quantity?: number;
      unitPriceSen?: number;
      unitPrice?: number; // legacy — rejected below if used
    }>;
    const parsedItems: CNItem[] = [];
    for (const item of rawItems) {
      if (item.unitPriceSen === undefined && item.unitPrice !== undefined) {
        return c.json(
          {
            success: false,
            error: `Credit note item must send 'unitPriceSen' (integer sen), not 'unitPrice'. Use Math.round(rm * 100) on the client.`,
          },
          400,
        );
      }
      const unitPriceSen = Number(item.unitPriceSen);
      if (!Number.isInteger(unitPriceSen) || unitPriceSen < 0) {
        return c.json(
          {
            success: false,
            error: `Credit note unitPriceSen must be a non-negative integer (got ${item.unitPriceSen}). Convert RM to sen with Math.round(rm * 100).`,
          },
          400,
        );
      }
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return c.json(
          {
            success: false,
            error: `Credit note quantity must be > 0 (got ${item.quantity}).`,
          },
          400,
        );
      }
      parsedItems.push({
        description: String(item.description ?? ""),
        quantity,
        unitPriceSen,
        totalSen: quantity * unitPriceSen,
      });
    }
    const totalAmount = parsedItems.reduce((sum, item) => sum + item.totalSen, 0);

    const id = genId();
    const noteNumber = await nextCNNo(c.var.DB);
    const date = new Date().toISOString().split("T")[0];
    const now = new Date().toISOString();

    // Allow the client to create a CN already in APPROVED/POSTED (e.g. from
    // an admin tool). If so, apply the invoice cascade atomically with the
    // insert. DRAFT CNs skip the cascade — they mutate nothing.
    const requestedStatus =
      typeof body.status === "string" &&
      ["DRAFT", "APPROVED", "POSTED"].includes(body.status)
        ? (body.status as string)
        : "DRAFT";
    const approvedBy =
      isIssuedStatus(requestedStatus) && typeof body.approvedBy === "string"
        ? body.approvedBy
        : null;

    // Phase 1 (2026-06) — a CN must not exceed what is still uncollected on
    // the linked invoice. Without this cap, an oversized CN floors the
    // invoice at 0 but still decrements customer A/R by the FULL amount,
    // driving outstandingSen negative and splitting the control account
    // from the subledger. Validated at creation for ANY status (a DRAFT CN
    // that could never be issued is a data-entry error worth failing fast).
    const uncollectedSen = Math.max(
      0,
      (Number(invoice.totalSen) || 0) - (Number(invoice.paidAmount) || 0),
    );
    if (totalAmount > uncollectedSen) {
      return c.json(
        {
          success: false,
          error: `Credit note amount (${totalAmount} sen) exceeds the invoice's uncollected balance (${uncollectedSen} sen) on ${invoice.invoiceNo}. Reduce the CN amount or issue a refund instead.`,
        },
        400,
      );
    }

    const statements: D1PreparedStatement[] = [
      c.var.DB.prepare(
        // PR 5 — INSERT carries customerState / customerAddress /
        // attention / customerPhone snapshotted from the invoice.
        `INSERT INTO credit_notes (id, noteNumber, invoiceId, invoiceNumber, customerId,
           customerName, customerState, customerAddress, attention, customerPhone,
           date, reason, reasonDetail, totalAmount, status, approvedBy, items, delivery_return_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        noteNumber,
        invoice.id,
        invoice.invoiceNo,
        invoice.customerId,
        invoice.customerName,
        invoice.customerState,
        invoice.customerAddress,
        invoice.attention,
        invoice.customerPhone,
        date,
        reason,
        reasonDetail || "",
        totalAmount,
        requestedStatus,
        approvedBy,
        JSON.stringify(parsedItems),
        deliveryReturnId || null,
      ),
    ];
    // The return points back at its note, so its page shows "Credit note".
    if (deliveryReturnId) {
      statements.push(
        c.var.DB.prepare(
          "UPDATE delivery_returns SET credit_note_id = ? WHERE id = ? AND COALESCE(credit_note_id, '') = ''",
        ).bind(id, deliveryReturnId),
      );
    }

    if (isIssuedStatus(requestedStatus) && totalAmount > 0) {
      // Mirror the PUT-POSTED path: decrement customer A/R and, if a specific
      // invoice is pinned, re-evaluate invoice totals + status.
      statements.push(
        c.var.DB.prepare(
          `UPDATE customers SET outstandingSen = GREATEST(0, outstandingSen - ?) WHERE id = ?`,
        ).bind(totalAmount, invoice.customerId),
      );
      const invStmts = await buildInvoiceCascadeForCN(
        c.var.DB,
        invoice.id,
        totalAmount,
        now,
      );
      statements.push(...invStmts);

      // Phase 1 (2026-06) — GL legs land in the SAME batch as the cascade:
      // DR 510/520 (+ DR 350 tax) / CR debtor control. A build failure
      // ABORTS the request — the subledger must never move without the GL.
      try {
        const orgId = getOrgId(c);
        const actorUserId =
          (
            c as unknown as { get: (k: string) => string | undefined }
          ).get("userId") ?? null;
        if (!(await ledgerHasSource(c.var.DB, orgId, "credit_note", id))) {
          const legs = await buildCreditNoteLedgerLegs(
            c.var.DB,
            orgId,
            {
              id,
              noteNumber,
              customerId: invoice.customerId,
              reason: String(reason),
            },
            totalAmount,
            actorUserId,
          );
          const { statements: ledgerStmts } =
            await buildJournalEntryStatements(c.var.DB, orgId, legs);
          statements.push(...ledgerStmts);
        }
      } catch (e) {
        console.error(`[ledger] CN ${id} GL build failed — aborting:`, e);
        return c.json(
          {
            success: false,
            error:
              "Failed to build the GL posting for this credit note — nothing was saved. Retry, and report if it persists.",
          },
          500,
        );
      }
    }

    await c.var.DB.batch(statements);

    const created = await c.var.DB.prepare(
      "SELECT * FROM credit_notes WHERE id = ?",
    )
      .bind(id)
      .first<CreditNoteRow>();
    if (!created) {
      return c.json(
        { success: false, error: "Failed to create credit note" },
        500,
      );
    }
    // Audit emit (P3.4) — CN create. Sensitive because issuing a CN
    // decrements customer A/R and can flip an invoice's totals.
    await emitAudit(c, {
      resource: "credit-notes",
      resourceId: id,
      action: "create",
      after: rowToCreditNote(created),
    });
    return c.json({ success: true, data: rowToCreditNote(created) }, 201);
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

// GET /api/credit-notes/:id — single
app.get("/:id", async (c) => {
  const denied = await requirePermission(c, "credit-notes", "read");
  if (denied) return denied;
  const id = c.req.param("id");
  const row = await c.var.DB.prepare(
    "SELECT * FROM credit_notes WHERE id = ?",
  )
    .bind(id)
    .first<CreditNoteRow>();
  if (!row) {
    return c.json({ success: false, error: "Credit note not found" }, 404);
  }
  return c.json({ success: true, data: rowToCreditNote(row) });
});

// PUT /api/credit-notes/:id — update status / approvedBy.
//
// The invoice/customer cascade fires on the first transition out of DRAFT
// (DRAFT → APPROVED or DRAFT → POSTED). Once the CN is "issued" (APPROVED
// or POSTED) the invoice totals + customer A/R have already absorbed the
// amount, so a later APPROVED → POSTED (or the reverse) must NOT fire the
// cascade again. Idempotent: repeated PUTs with the same status are a
// no-op beyond the status/approvedBy column update.
app.put("/:id", async (c) => {
  // RBAC gate (P3.3-followup) — credit-notes:update.
  const denied = await requirePermission(c, "credit-notes", "update");
  if (denied) return denied;
  const id = c.req.param("id");
  try {
    const existing = await c.var.DB.prepare(
      "SELECT * FROM credit_notes WHERE id = ?",
    )
      .bind(id)
      .first<CreditNoteRow>();
    if (!existing) {
      return c.json({ success: false, error: "Credit note not found" }, 404);
    }
    const body = await c.req.json();
    let status = existing.status;
    let approvedBy = existing.approvedBy;
    if (body.status) {
      status = body.status;
      if (body.status === "APPROVED" || body.status === "POSTED") {
        approvedBy = body.approvedBy || "Admin";
      }
    }

    // An issued credit note is terminal. Its customer-credit (A/R reduction) +
    // invoice-total cascade fire on the DRAFT→issued transition and are NOT
    // idempotent (only the GL leg is guarded by ledgerHasSource). Allowing
    // issued→DRAFT→issued would apply the credit TWICE and drift customer A/R +
    // invoice total off the GL. Reverting an issued CN needs a dedicated contra
    // flow (none exists yet), so block any transition back out of an issued
    // status. issued→issued (APPROVED→POSTED) and the first DRAFT→issued stay
    // allowed.
    if (
      isIssuedStatus(existing.status) &&
      status !== existing.status &&
      !isIssuedStatus(status)
    ) {
      return c.json(
        {
          success: false,
          error: `Credit note ${existing.noteNumber} is already issued and can't be reverted to ${status}. The customer credit has already been applied.`,
        },
        409,
      );
    }

    // Fire cascade only on the first DRAFT → issued transition. Once the
    // existing row is already APPROVED or POSTED, the invoice cascade has
    // already been applied (either here on the earlier transition, or via
    // POST if the CN was created directly in an issued state).
    const transitionedToIssued =
      !isIssuedStatus(existing.status) && isIssuedStatus(status);

    const statements: D1PreparedStatement[] = [
      c.var.DB.prepare(
        "UPDATE credit_notes SET status = ?, approvedBy = ? WHERE id = ?",
      ).bind(status, approvedBy, id),
    ];

    if (transitionedToIssued && existing.totalAmount > 0) {
      // Phase 1 (2026-06) — cap at issue time: the CN must not exceed the
      // invoice's uncollected balance (totalSen − paidAmount). Without this
      // an oversized CN floors the invoice at 0 but still strips the FULL
      // amount off customer A/R → negative outstanding + control-account
      // drift.
      if (existing.invoiceId) {
        const inv = await c.var.DB.prepare(
          "SELECT invoiceNo, totalSen, paidAmount FROM invoices WHERE id = ?",
        )
          .bind(existing.invoiceId)
          .first<{ invoiceNo: string; totalSen: number; paidAmount: number }>();
        if (inv) {
          const uncollectedSen = Math.max(
            0,
            (Number(inv.totalSen) || 0) - (Number(inv.paidAmount) || 0),
          );
          if (existing.totalAmount > uncollectedSen) {
            return c.json(
              {
                success: false,
                error: `Credit note amount (${existing.totalAmount} sen) exceeds the invoice's uncollected balance (${uncollectedSen} sen) on ${inv.invoiceNo}. Reduce the CN amount or issue a refund instead.`,
              },
              400,
            );
          }
        }
      }

      // Customer A/R: a credit note reduces what the customer owes.
      statements.push(
        c.var.DB.prepare(
          `UPDATE customers SET outstandingSen = GREATEST(0, outstandingSen - ?) WHERE id = ?`,
        ).bind(existing.totalAmount, existing.customerId),
      );
      // If pinned to a specific invoice, reduce that invoice's totalSen and
      // re-evaluate its status (PAID / PARTIAL_PAID) so aging math stays
      // correct. `buildInvoiceCascadeForCN` floors the invoice totals at 0
      // and preserves paidAmount (never over-credits).
      if (existing.invoiceId) {
        const now = new Date().toISOString();
        const invStmts = await buildInvoiceCascadeForCN(
          c.var.DB,
          existing.invoiceId,
          existing.totalAmount,
          now,
        );
        statements.push(...invStmts);
      }

      // Phase 1 (2026-06) — GL legs in the SAME batch as the cascade.
      // Build failure ABORTS the request (no silent skip).
      try {
        const orgId = getOrgId(c);
        const actorUserId =
          (
            c as unknown as { get: (k: string) => string | undefined }
          ).get("userId") ?? null;
        if (!(await ledgerHasSource(c.var.DB, orgId, "credit_note", id))) {
          const legs = await buildCreditNoteLedgerLegs(
            c.var.DB,
            orgId,
            {
              id,
              noteNumber: existing.noteNumber,
              customerId: existing.customerId,
              reason: existing.reason,
            },
            existing.totalAmount,
            actorUserId,
          );
          const { statements: ledgerStmts } =
            await buildJournalEntryStatements(c.var.DB, orgId, legs);
          statements.push(...ledgerStmts);
        }
      } catch (e) {
        console.error(`[ledger] CN ${id} GL build failed — aborting:`, e);
        return c.json(
          {
            success: false,
            error:
              "Failed to build the GL posting for this credit note — nothing was saved. Retry, and report if it persists.",
          },
          500,
        );
      }
    }

    await c.var.DB.batch(statements);

    const updated = await c.var.DB.prepare(
      "SELECT * FROM credit_notes WHERE id = ?",
    )
      .bind(id)
      .first<CreditNoteRow>();
    if (!updated) {
      return c.json({ success: false, error: "Credit note not found" }, 404);
    }
    // Create was audited; the update was not — yet this handler owns the
    // DRAFT → APPROVED/POSTED transition that fires the non-idempotent
    // customer-credit (A/R reduction) and invoice-total cascade and posts the
    // GL legs. Snapshot both sides so the approval is attributable.
    await emitAudit(c, {
      resource: "credit-notes",
      resourceId: id,
      action: "update",
      before: rowToCreditNote(existing),
      after: rowToCreditNote(updated),
    });
    return c.json({ success: true, data: rowToCreditNote(updated) });
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }
});

export default app;
