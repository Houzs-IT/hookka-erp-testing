// ---------------------------------------------------------------------------
// Shared Purchase Return creation (owner 2026-07-30). The supplier-side mirror
// of delivery-return-create.ts: one place that writes a Purchase Return header
// + item snapshot from a source Purchase Invoice (PI). Slice 1 is header +
// items ONLY — status stays OPEN and NO inventory / AP ledger moves yet (those
// are slices 2 + 3, owner-verified). See docs/plans/2026-07-30-purchase-return.md.
//
// Tables are self-applied at runtime (deploy does not replay migration files).
// snake_case columns; every write is org-scoped by the caller.
// ---------------------------------------------------------------------------
import {
  buildJournalEntryStatements,
  ledgerHasSource,
  type LedgerEntryInput,
} from "./journal-hash";
import { roundUnitPriceSen } from "../../lib/unit-price";

export type PRCreateItem = {
  purchaseInvoiceItemId?: string;
  materialCode?: string | null;
  materialName?: string;
  supplierSku?: string | null;
  grnItemId?: string | null;
  quantity?: number;
  // Owner chose "negotiated return" — the return can post at a cost DIFFERENT
  // from the original PI line (a renegotiated credit). Defaults to the PI line's
  // unit cost; the operator may edit it. line_total_sen is derived qty × unit.
  unitCostSen?: number;
  problem?: string;
};

export type PRCreateInput = {
  // Source is EITHER a PI or a GRN (goods receipt). A GRN-sourced return reverses
  // stock but can't issue a supplier Debit Note (nothing invoiced yet).
  purchaseInvoiceId?: string;
  piNo?: string;
  grnId?: string;
  grnNo?: string;
  supplierId?: string;
  supplierName?: string;
  reason?: string;
  notes?: string;
  // Owner: a Purchase Return against an ALREADY-PAID PI is a supplier refund.
  // Recorded on the header so slice 3 knows to raise a refund claim vs a credit
  // carried to the next PI. Slice 1 just stores it.
  resolution?: string; // "REFUND" | "CREDIT_NEXT_PI"
  createdBy?: string | null;
  orgId?: string | null;
  items: PRCreateItem[];
};

let tablesEnsured = false;
export async function ensurePurchaseReturnTables(db: D1Database): Promise<void> {
  if (tablesEnsured) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS purchase_returns (
           id TEXT PRIMARY KEY, return_no TEXT NOT NULL,
           purchase_invoice_id TEXT, pi_no TEXT,
           supplier_id TEXT, supplier_name TEXT,
           status TEXT NOT NULL DEFAULT 'OPEN',
           resolution TEXT,
           debit_note_id TEXT, supplier_cn_ref TEXT,
           reason TEXT, notes TEXT, returned_at TEXT,
           created_by TEXT, created_at TEXT, updated_at TEXT, org_id TEXT )`,
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS purchase_return_items (
           id TEXT PRIMARY KEY, purchase_return_id TEXT NOT NULL,
           purchase_invoice_item_id TEXT,
           material_code TEXT, material_name TEXT, supplier_sku TEXT,
           grn_item_id TEXT,
           quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
           unit_cost_sen INTEGER NOT NULL DEFAULT 0,
           line_total_sen INTEGER NOT NULL DEFAULT 0,
           problem TEXT )`,
      )
      .run();
    // A return can also be sourced from a Goods Receipt (GRN) — owner 2026-07-30
    // "convert from PI or GR". These columns are self-applied on the existing
    // table. A GRN-sourced return reverses stock but issues NO supplier Debit
    // Note (nothing was invoiced yet → no AP to debit).
    for (const col of ["grn_id TEXT", "grn_no TEXT"]) {
      try {
        await db.prepare(`ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS ${col}`).run();
      } catch {
        /* column already exists */
      }
    }
    // T-006 R6 reads a GRN line's PO link; grn.ts self-applies these too,
    // but only when its own routes have run in this isolate.
    for (const col of ["po_id TEXT", "po_item_id TEXT"]) {
      try {
        await db.prepare(`ALTER TABLE grn_items ADD COLUMN IF NOT EXISTS ${col}`).run();
      } catch {
        /* column already exists */
      }
    }
    tablesEnsured = true;
  } catch (err) {
    console.warn(
      "[purchase-return-create] ensure tables:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function genPurchaseReturnId(): string {
  return `pr-${crypto.randomUUID().slice(0, 8)}`;
}
function genItemId(): string {
  return `pri-${crypto.randomUUID().slice(0, 8)}`;
}

// PR-YYMM-NNN, sequential within the current year-month (mirrors DR numbering).
export async function nextPurchaseReturnNo(db: D1Database): Promise<string> {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `PR-${yy}${mm}-`;
  const row = await db
    .prepare(
      `SELECT return_no AS "returnNo" FROM purchase_returns
        WHERE return_no LIKE ? ORDER BY return_no DESC LIMIT 1`,
    )
    .bind(`${prefix}%`)
    .first<{ returnNo: string }>();
  let n = 1;
  if (row?.returnNo) {
    const tail = Number(row.returnNo.slice(prefix.length));
    if (Number.isFinite(tail)) n = tail + 1;
  }
  return `${prefix}${String(n).padStart(3, "0")}`;
}

// A PI line with a per-line discount (DEV-14) was billed at line_total / qty,
// not at its list unit price — seed the return at what was actually paid.
function netUnitCostSen(
  r: Record<string, unknown>,
  pick: (r: Record<string, unknown>, snake: string, camel: string) => unknown,
): number {
  const unit = Number(pick(r, "unit_price_sen", "unitPriceSen") ?? 0);
  const discount = Number(pick(r, "discount_sen", "discountSen") ?? 0);
  const qty = Number(pick(r, "qty", "qty") ?? 0);
  if (!(discount > 0) || !(qty > 0)) return unit;
  return roundUnitPriceSen(Number(pick(r, "line_total_sen", "lineTotalSen") ?? 0) / qty);
}

// Load a PI's stocked lines as return candidates. Only STOCKED lines (a real
// raw_material) can be physically returned — fee / tax / rebate lines are
// excluded. unitCostSen seeds the editable return cost.
export async function loadPiItemsForReturn(
  db: D1Database,
  piId: string,
): Promise<PRCreateItem[]> {
  // SELECT * and read dual-keyed (snake ?? camel) in JS — the PI item table has
  // runtime-added columns whose casing varies, so naming columns explicitly in
  // the SELECT risks referencing one that doesn't exist (a hard SQL error).
  const res = await db
    .prepare(
      `SELECT * FROM purchase_invoice_items WHERE pi_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .bind(piId)
    .all<Record<string, unknown>>();
  const pick = (r: Record<string, unknown>, snake: string, camel: string): unknown =>
    r[snake] ?? r[camel];
  const out: PRCreateItem[] = [];
  for (const r of res.results ?? []) {
    const lineType = String(pick(r, "line_type", "lineType") ?? "STOCKED");
    const materialCode = (pick(r, "material_code", "materialCode") ?? null) as string | null;
    // Only physical stocked lines are returnable.
    if (lineType !== "STOCKED" && !materialCode) continue;
    out.push({
      purchaseInvoiceItemId: String(r.id ?? ""),
      materialCode,
      materialName: String(pick(r, "material_name", "materialName") ?? ""),
      supplierSku: (pick(r, "supplier_sku", "supplierSku") ?? null) as string | null,
      grnItemId: (pick(r, "grn_item_id", "grnItemId") ?? null) as string | null,
      quantity: Number(pick(r, "qty", "qty") ?? 0),
      unitCostSen: netUnitCostSen(r, pick),
      problem: "",
    });
  }
  return out;
}

// Load a GRN's received lines as return candidates (owner 2026-07-30 — "convert
// from PI or GR"). SELECT * + dual-keyed read (runtime-added columns). Any line
// with a material code is returnable; qty seeds from the accepted/received qty.
export async function loadGrnItemsForReturn(
  db: D1Database,
  grnId: string,
): Promise<PRCreateItem[]> {
  const res = await db
    .prepare(`SELECT * FROM grn_items WHERE grnId = ? ORDER BY id ASC`)
    .bind(grnId)
    .all<Record<string, unknown>>();
  const pick = (r: Record<string, unknown>, ...keys: string[]): unknown => {
    for (const k of keys) if (r[k] != null) return r[k];
    return undefined;
  };
  const out: PRCreateItem[] = [];
  for (const r of res.results ?? []) {
    const materialCode = (pick(r, "material_code", "materialCode") ?? null) as string | null;
    if (!materialCode) continue;
    out.push({
      grnItemId: String(r.id ?? ""),
      materialCode,
      materialName: String(pick(r, "material_name", "materialName") ?? ""),
      supplierSku: (pick(r, "supplier_sku", "supplierSku", "supplierSKU") ?? null) as string | null,
      quantity: Number(pick(r, "accepted_qty", "acceptedQty", "received_qty", "receivedQty") ?? 0),
      unitCostSen: Number(pick(r, "unit_cost_sen", "unitCostSen", "unit_price_sen", "unitPriceSen") ?? 0),
      problem: "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slice 2 — inventory reversal. On confirm, the returned goods LEAVE stock: for
// each item we FIFO-consume the material's rm_batches (oldest first — same
// costing basis as normal consumption), drop raw_materials.balanceQty, and emit
// one cost_ledger OUT row per layer. This mirrors stock-adjustments.ts's RM-OUT
// path exactly so sum(rm_batches.remainingQty) stays in lockstep with
// balanceQty. The whole thing runs in ONE db.batch (atomic) and is idempotent:
// it only fires while status = 'OPEN', flipping to 'STOCK_OUT'. The supplier
// Debit Note + AP posting (at the negotiated price) is slice 3 — this slice
// values the stock leaving at its FIFO batch cost only.
export async function applyPurchaseReturnStockOut(
  db: D1Database,
  returnId: string,
  orgId: string | null,
): Promise<{ ok: boolean; error?: string; reversedItems?: number }> {
  await ensurePurchaseReturnTables(db);
  const header = await db
    .prepare(
      "SELECT id, status FROM purchase_returns WHERE id = ? AND (org_id = ? OR org_id IS NULL)",
    )
    .bind(returnId, orgId)
    .first<{ id: string; status: string | null }>();
  if (!header) return { ok: false, error: "not found" };
  if ((header.status ?? "OPEN") !== "OPEN") {
    return { ok: false, error: "already processed — stock reverses only once" };
  }
  const itemsRes = await db
    .prepare("SELECT * FROM purchase_return_items WHERE purchase_return_id = ?")
    .bind(returnId)
    .all<Record<string, unknown>>();
  const items = itemsRes.results ?? [];
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const stmts: D1PreparedStatement[] = [];
  let ledgerN = 0;
  let reversedItems = 0;
  for (const it of items) {
    const materialCode = String((it.material_code ?? it.materialCode) ?? "").trim();
    const qty = Number(it.quantity ?? 0);
    if (!materialCode || !(qty > 0)) continue;
    const rm = await db
      .prepare("SELECT id FROM raw_materials WHERE itemCode = ? LIMIT 1")
      .bind(materialCode)
      .first<{ id: string }>();
    if (!rm) continue; // unresolvable material — skip (never guess which stock to move)

    // FIFO plan: oldest batches first, same as consumption.
    const batchesRes = await db
      .prepare(
        "SELECT id, remainingQty, unitCostSen FROM rm_batches WHERE rmId = ? AND remainingQty > 0 ORDER BY receivedDate ASC, id ASC",
      )
      .bind(rm.id)
      .all<{ id: string; remainingQty: number; unitCostSen: number }>();
    const plan: { batchId: string; qty: number; unitCostSen: number; totalCostSen: number }[] = [];
    let still = qty;
    for (const b of batchesRes.results ?? []) {
      if (still <= 0) break;
      const take = Math.min(b.remainingQty, still);
      if (take <= 0) continue;
      plan.push({ batchId: b.id, qty: take, unitCostSen: b.unitCostSen, totalCostSen: Math.round(take * b.unitCostSen) });
      still -= take;
    }
    // Residual (stock drifted below the return qty) — ledger-only, no batch
    // mutation, valued at the return's own unit cost. Mirrors stock-adjustments.
    if (still > 0) {
      const unit = roundUnitPriceSen(Number(it.unit_cost_sen ?? it.unitCostSen ?? 0));
      plan.push({ batchId: "", qty: still, unitCostSen: unit, totalCostSen: Math.round(still * unit) });
    }

    for (const layer of plan) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO cost_ledger (id, date, type, itemType, itemId, batchId,
               qty, direction, unitCostSen, totalCostSen, refType, refId, notes)
             VALUES (?, ?, 'ADJUSTMENT', 'RM', ?, ?, ?, 'OUT', ?, ?, 'PURCHASE_RETURN', ?, ?)`,
          )
          .bind(
            `cl-pr-${returnId}-${ledgerN++}`,
            today,
            rm.id,
            layer.batchId || null,
            layer.qty,
            layer.unitCostSen,
            layer.totalCostSen,
            returnId,
            `Purchase Return — goods returned to supplier${layer.batchId ? "" : " (residual, no batch)"}`,
          ),
      );
    }
    stmts.push(
      db.prepare("UPDATE raw_materials SET balanceQty = balanceQty - ? WHERE id = ?").bind(qty, rm.id),
    );
    for (const layer of plan) {
      if (!layer.batchId) continue;
      stmts.push(
        db.prepare("UPDATE rm_batches SET remainingQty = remainingQty - ? WHERE id = ?").bind(layer.qty, layer.batchId),
      );
    }
    reversedItems++;
  }
  // Idempotency + status flip in the SAME atomic batch as the stock moves.
  stmts.push(
    db.prepare("UPDATE purchase_returns SET status = 'STOCK_OUT', updated_at = ? WHERE id = ?").bind(now, returnId),
  );
  await db.batch(stmts);
  return { ok: true, reversedItems };
}

// ---------------------------------------------------------------------------
// Slice 3 — supplier Debit Note + AP. Owner 2026-07-30. Once a return's stock is
// reversed (STOCK_OUT), issuing the DN debits the supplier: it reduces our AP
// AND posts a balanced GL journal. The GL posting is the SAFE kind — it reuses
// the source PI's OWN accounts: DR the PI's AP-control account, CR the PI's main
// expense/inventory account, both = the DN amount. Because it uses the accounts
// the PI actually posted to and both legs equal the same amount, the journal is
// balanced by construction (no invented accounts, no rounding drift). If the PI
// never hit the GL (e.g. a DRAFT PI), the GL step is skipped and only the AP
// subledger + DN record move. Idempotent: fires only from STOCK_OUT, flips to
// DN_ISSUED, and the journal is guarded by ledgerHasSource. All in one db.batch.
async function ensureSupplierDebitNoteTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS supplier_debit_notes (
         id TEXT PRIMARY KEY, note_number TEXT, purchase_return_id TEXT,
         supplier_id TEXT, supplier_name TEXT, purchase_invoice_id TEXT,
         amount_sen INTEGER, status TEXT NOT NULL DEFAULT 'ISSUED',
         created_by TEXT, org_id TEXT, created_at TEXT )`,
    )
    .run();
}

async function nextSupplierDnNo(db: D1Database): Promise<string> {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `SDN-${yy}${mm}-`;
  const row = await db
    .prepare(
      `SELECT note_number AS "noteNumber" FROM supplier_debit_notes
        WHERE note_number LIKE ? ORDER BY note_number DESC LIMIT 1`,
    )
    .bind(`${prefix}%`)
    .first<{ noteNumber: string }>();
  let n = 1;
  if (row?.noteNumber) {
    const tail = Number(row.noteNumber.slice(prefix.length));
    if (Number.isFinite(tail)) n = tail + 1;
  }
  return `${prefix}${String(n).padStart(3, "0")}`;
}

export async function issuePurchaseReturnDebitNote(
  db: D1Database,
  returnId: string,
  orgId: string | null,
  actorUserId: string | null,
): Promise<{ ok: boolean; error?: string; noteNumber?: string; amountSen?: number }> {
  await ensurePurchaseReturnTables(db);
  await ensureSupplierDebitNoteTable(db);
  const header = await db
    .prepare(
      "SELECT * FROM purchase_returns WHERE id = ? AND (org_id = ? OR org_id IS NULL)",
    )
    .bind(returnId, orgId)
    .first<Record<string, unknown>>();
  if (!header) return { ok: false, error: "not found" };
  if (String(header.status ?? "OPEN") !== "STOCK_OUT") {
    return { ok: false, error: "confirm the stock reversal first (must be STOCK_OUT)" };
  }
  if (header.debit_note_id) return { ok: false, error: "a debit note was already issued" };
  // A GRN-sourced return (no PI) was never invoiced — there is no supplier AP to
  // debit, so no Debit Note is issued (the stock reversal already happened).
  if (!String(header.purchase_invoice_id ?? "").trim()) {
    return { ok: false, error: "this return is from a Goods Receipt (not invoiced) — no supplier Debit Note to issue" };
  }

  const agg = await db
    .prepare("SELECT COALESCE(SUM(line_total_sen),0) AS total FROM purchase_return_items WHERE purchase_return_id = ?")
    .bind(returnId)
    .first<{ total: number }>();
  const amountSen = Math.round(Number(agg?.total ?? 0));
  if (!(amountSen > 0)) return { ok: false, error: "nothing to debit (0 amount)" };

  const piId = String(header.purchase_invoice_id ?? "");
  const supplierId = String(header.supplier_id ?? "");
  const supplierName = String(header.supplier_name ?? "");
  const org = orgId ?? "";
  const now = new Date().toISOString();
  const dnId = `sdn-${crypto.randomUUID().slice(0, 8)}`;
  const noteNumber = await nextSupplierDnNo(db);
  const stmts: D1PreparedStatement[] = [];

  // GL — reverse the PI's posting via its OWN accounts (balanced by construction).
  if (piId && !(await ledgerHasSource(db, org, "purchase_return", returnId))) {
    const piLegs =
      (
        await db
          .prepare(
            "SELECT accountCode, debitSen, creditSen FROM ledger_journal_entries WHERE sourceType = 'purchase_invoice' AND sourceId = ? AND orgId = ? AND (hidden IS NULL OR hidden = 0)",
          )
          .bind(piId, org)
          .all<{ accountCode: string; debitSen: number; creditSen: number }>()
      ).results ?? [];
    let apCode = "";
    let expenseCode = "";
    let maxDebit = -1;
    for (const l of piLegs) {
      if (Number(l.creditSen) > 0 && !apCode) apCode = String(l.accountCode); // AP-control = the PI's credit leg
      if (Number(l.debitSen) > maxDebit) { maxDebit = Number(l.debitSen); expenseCode = String(l.accountCode); }
    }
    if (apCode && expenseCode && apCode !== expenseCode) {
      const legs: LedgerEntryInput[] = [
        { id: `lje-${crypto.randomUUID().slice(0, 12)}`, sourceType: "purchase_return", sourceId: returnId, legNo: 1, accountCode: apCode, debitSen: amountSen, creditSen: 0, description: `${noteNumber} · AP debit (goods returned)`, actorUserId, orgId: org },
        { id: `lje-${crypto.randomUUID().slice(0, 12)}`, sourceType: "purchase_return", sourceId: returnId, legNo: 2, accountCode: expenseCode, debitSen: 0, creditSen: amountSen, description: `${noteNumber} · purchase return`, actorUserId, orgId: org },
      ];
      const { statements: ls } = await buildJournalEntryStatements(db, org, legs, { docDate: now.slice(0, 10) });
      stmts.push(...ls);
    }
  }

  // AP subledger — reduce what we owe the supplier by the DN amount.
  if (supplierId) {
    stmts.push(
      db.prepare("UPDATE suppliers SET outstandingSen = outstandingSen - ? WHERE id = ?").bind(amountSen, supplierId),
    );
  }
  // The DN document.
  stmts.push(
    db
      .prepare(
        `INSERT INTO supplier_debit_notes
           (id, note_number, purchase_return_id, supplier_id, supplier_name,
            purchase_invoice_id, amount_sen, status, created_by, org_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?)`,
      )
      .bind(dnId, noteNumber, returnId, supplierId, supplierName, piId, amountSen, actorUserId, org, now),
  );
  // Stamp the return + flip status (idempotency).
  stmts.push(
    db.prepare("UPDATE purchase_returns SET debit_note_id = ?, status = 'DN_ISSUED', updated_at = ? WHERE id = ?").bind(dnId, now, returnId),
  );

  await db.batch(stmts);
  return { ok: true, noteNumber, amountSen };
}

// HK-0096 — a return can never send back more than came in. Cumulative across
// every return already raised on the same source line:
//   • per GRN line : returns made from the GRN <= its UNBILLED part (accepted -
//                    invoiced); billed goods go back from the invoice, else
//                    loadGrnReturnedBeforeBilling would shrink what the PI may bill
//   • per PI line  : all returns on it <= the qty that invoice line billed
// Lines with no source id (a free-typed line) have nothing to cap against.
// Returns the error text, or null when every line fits.
export async function checkPurchaseReturnQty(
  db: D1Database,
  items: PRCreateItem[],
): Promise<string | null> {
  const sum = (key: "grnItemId" | "purchaseInvoiceItemId") => {
    const m = new Map<string, { qty: number; name: string }>();
    for (const it of items) {
      const id = it[key];
      const qty = Number(it.quantity) || 0;
      if (!id || qty <= 0) continue;
      const prev = m.get(String(id));
      m.set(String(id), { qty: (prev?.qty ?? 0) + qty, name: prev?.name ?? (it.materialName || "line") });
    }
    return m;
  };
  const checks: Array<[Map<string, { qty: number; name: string }>, string, string, string, string]> = [
    [sum("grnItemId"), "SELECT acceptedQty - COALESCE(invoiced_qty, 0) AS cap FROM grn_items WHERE id = ?", "grn_item_id", "received and not yet billed (return billed goods from the invoice)", " AND purchase_return_id IN (SELECT id FROM purchase_returns WHERE COALESCE(purchase_invoice_id, '') = '')"],
    [sum("purchaseInvoiceItemId"), "SELECT qty AS cap FROM purchase_invoice_items WHERE id = ?", "purchase_invoice_item_id", "invoiced", ""],
  ];
  for (const [want, capSql, col, label, priorFilter] of checks) {
    for (const [id, { qty, name }] of want) {
      const src = await db.prepare(capSql).bind(id).first<{ cap: number | null }>();
      if (!src) continue; // unknown source line — nothing to cap against
      const prior = await db
        .prepare(`SELECT COALESCE(SUM(quantity), 0) AS qty FROM purchase_return_items WHERE ${col} = ?${priorFilter}`)
        .bind(id)
        .first<{ qty: number | null }>();
      const cap = Number(src.cap) || 0;
      const already = Number(prior?.qty) || 0;
      if (already + qty > cap) {
        return `Line "${name}": returning ${qty} would exceed what was ${label} (${cap}, already returned ${already}).`;
      }
    }
  }
  return null;
}

// HK-0096 — grn_items.id → qty returned off the GRN BEFORE it was billed (a
// return with no purchase invoice). issuePurchaseReturnDebitNote refuses a DN
// for such a return ("never invoiced"), so the only place the supplier's
// credit can land is a smaller invoice: these units come off what a PI may
// still bill. Fails soft to "nothing returned" before the tables exist.
export async function loadGrnReturnedBeforeBilling(
  db: D1Database,
  grnItemIds: Array<string | number>,
): Promise<Map<string, number>> {
  const ids = [...new Set(grnItemIds.map(String).filter(Boolean))];
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  try {
    const res = await db
      .prepare(
        `SELECT pri.grn_item_id AS "grnItemId", COALESCE(SUM(pri.quantity), 0) AS "qty"
           FROM purchase_return_items pri
           JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
          WHERE COALESCE(pr.purchase_invoice_id, '') = ''
            AND pri.grn_item_id IN (${ids.map(() => "?").join(", ")})
          GROUP BY pri.grn_item_id`,
      )
      .bind(...ids)
      .all<{ grnItemId: string; qty: number }>();
    for (const r of res.results ?? []) out.set(String(r.grnItemId), Number(r.qty) || 0);
  } catch {
    /* purchase_return tables not created yet — nothing returned */
  }
  return out;
}

// T-006 R6 — the PO line each GRN line received against (explicit po_item_id;
// a legacy line without one has no PO link to give back to) and whether its
// GRN is posted (only a posted receipt added to the PO's receivedQty).
async function loadGrnLinePoLinks(
  db: D1Database,
  grnItemIds: string[],
): Promise<Map<string, { poId: string | null; poItemId: string | null; posted: boolean }>> {
  const out = new Map<string, { poId: string | null; poItemId: string | null; posted: boolean }>();
  if (grnItemIds.length === 0) return out;
  const res = await db
    .prepare(
      `SELECT gi.id AS "id", gi.po_id AS "linePoId", gi.po_item_id AS "poItemId",
              g.poId AS "grnPoId", g.status AS "status"
         FROM grn_items gi JOIN grns g ON g.id = gi.grnId
        WHERE gi.id::text IN (${grnItemIds.map(() => "?").join(", ")})`,
    )
    .bind(...grnItemIds)
    .all<{ id: string | number; linePoId?: string | null; poItemId?: string | null; grnPoId?: string | null; status?: string | null }>();
  for (const r of res.results ?? []) {
    out.set(String(r.id), {
      poId: (r.linePoId || r.grnPoId || "").trim() || null,
      poItemId: (r.poItemId ?? "").trim() || null,
      posted: ["POSTED", "CONFIRMED"].includes(String(r.status ?? "").toUpperCase()),
    });
  }
  return out;
}

export type CreatePurchaseReturnResult =
  | { ok: true; id: string; returnNo: string; poIds: string[] }
  | { ok: false; error: string };

// Write a Purchase Return header + its item snapshot, and (T-006 R6) give the
// PO line back what the return sends out, so replacement goods can be
// received against it (PO 100, receive 100, return 20 → received 80 → 30
// more may come in under the 110% ceiling). No ledger movement (slice 1).
// `poIds` are the purchase orders whose status the caller must recompute.
//
// grn_items.invoiced_qty is deliberately NOT written back: the invoice still
// bills these units and the supplier's credit is the debit note, so lowering
// it let the same goods be billed twice (BUG-2026-09-24-184, staging).
export async function createPurchaseReturn(
  db: D1Database,
  input: PRCreateInput,
): Promise<CreatePurchaseReturnResult> {
  await ensurePurchaseReturnTables(db);
  const items = input.items.filter((it) => {
    const q = Number(it.quantity);
    return Number.isFinite(q) && q > 0; // skip zero/blank lines
  });
  const links = await loadGrnLinePoLinks(db, [
    ...new Set(items.map((it) => String(it.grnItemId ?? "")).filter(Boolean)),
  ]);
  // A return off a receipt that never posted would take back a receivedQty
  // that was never added — and goods that never arrived cannot go back.
  if ([...links.values()].some((l) => !l.posted)) {
    return { ok: false, error: "Only a received (POSTED) goods receipt can be returned." };
  }
  const id = genPurchaseReturnId();
  const returnNo = await nextPurchaseReturnNo(db);
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  const poIds = new Set<string>();
  stmts.push(db
    .prepare(
      `INSERT INTO purchase_returns
         (id, return_no, purchase_invoice_id, pi_no, grn_id, grn_no,
          supplier_id, supplier_name, status, resolution, reason, notes,
          returned_at, created_by, created_at, updated_at, org_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      returnNo,
      input.purchaseInvoiceId ?? "",
      input.piNo ?? "",
      input.grnId ?? "",
      input.grnNo ?? "",
      input.supplierId ?? "",
      input.supplierName ?? "",
      input.resolution ?? "REFUND",
      input.reason ?? "",
      input.notes ?? "",
      now,
      input.createdBy ?? null,
      now,
      now,
      input.orgId ?? null,
    ));
  for (const it of items) {
    const qty = Number(it.quantity);
    const unit = roundUnitPriceSen(Number(it.unitCostSen ?? 0));
    stmts.push(db
      .prepare(
        `INSERT INTO purchase_return_items
           (id, purchase_return_id, purchase_invoice_item_id, material_code,
            material_name, supplier_sku, grn_item_id, quantity, unit_cost_sen,
            line_total_sen, problem)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        genItemId(),
        id,
        it.purchaseInvoiceItemId ?? null,
        it.materialCode ?? null,
        it.materialName ?? "",
        it.supplierSku ?? null,
        it.grnItemId ?? null,
        qty,
        unit,
        Math.round(qty * unit),
        it.problem ?? "",
      ));
    const link = links.get(String(it.grnItemId ?? ""));
    if (link?.poItemId) {
      // Clamped so an edge never drives the counter negative.
      stmts.push(db
        .prepare("UPDATE purchase_order_items SET receivedQty = GREATEST(0, receivedQty - ?) WHERE id = ?")
        .bind(qty, link.poItemId));
      if (link.poId) poIds.add(link.poId);
    }
  }
  // One batch: the return and the PO counter it moves land together.
  await db.batch(stmts);
  return { ok: true, id, returnNo, poIds: [...poIds] };
}

/**
 * The inverse of createPurchaseReturn's give-back, for deleting an OPEN
 * return: put back the receivedQty each GRN-linked line took off its PO line.
 * Without it a deleted return left the PO line under-received, so the same
 * goods could be received (and stocked) again. Append the statements to the
 * delete's own batch; recompute the status of `poIds` after it.
 */
export async function purchaseReturnRestoreStatements(
  db: D1Database,
  returnId: string,
): Promise<{ statements: D1PreparedStatement[]; poIds: string[] }> {
  const res = await db
    .prepare("SELECT grn_item_id AS \"grnItemId\", quantity FROM purchase_return_items WHERE purchase_return_id = ?")
    .bind(returnId)
    .all<{ grnItemId: string | null; quantity: number }>();
  const rows = (res.results ?? []).filter((r) => r.grnItemId && Number(r.quantity) > 0);
  const links = await loadGrnLinePoLinks(db, [...new Set(rows.map((r) => String(r.grnItemId)))]);
  const statements: D1PreparedStatement[] = [];
  const poIds = new Set<string>();
  for (const r of rows) {
    const link = links.get(String(r.grnItemId));
    if (!link?.poItemId) continue;
    statements.push(db
      .prepare("UPDATE purchase_order_items SET receivedQty = receivedQty + ? WHERE id = ?")
      .bind(Number(r.quantity), link.poItemId));
    if (link.poId) poIds.add(link.poId);
  }
  return { statements, poIds: [...poIds] };
}
