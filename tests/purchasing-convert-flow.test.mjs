// ---------------------------------------------------------------------------
// purchasing-convert-flow.test.mjs — behavioral test of the PO→GRN→PI convert
// chain's per-line availability tracking, driven through the REAL grn.ts and
// purchase-invoices.ts Hono route handlers against a stateful in-memory mock
// D1.
//
// The mock D1 is a tiny SQL interpreter scoped to exactly the statements these
// routes issue against the convert-chain tables (grns / grn_items /
// purchase_orders / purchase_order_items / purchase_invoices /
// purchase_invoice_items). It stores rows in plain JS arrays and mutates them,
// so the increment / decrement / restore behaviour is exercised end-to-end —
// not re-implemented in the test.
//
// Asserts:
//   • GRN→PI consume decrements a GRN line's availableQty
//   • deleting the PI RESTORES the GRN line's availableQty
//   • the line-level guard BLOCKS over-invoicing a GRN line ...
//   • ... but ALLOWS a 2nd PI for the remaining qty (the old PO-level 409
//     wrongly blocked this)
//   • un-posting a GRN restores the parent PO line's availableQty
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";
import { execPoReceiptSql, runAtomic } from "./_po-receipt-mock.mjs";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}

const grnApp = (
  await import(pathToFileURL(resolve(process.cwd(), "src/api/routes/grn.ts")).href)
).default;
const piApp = (
  await import(
    pathToFileURL(resolve(process.cwd(), "src/api/routes/purchase-invoices.ts")).href
  )
).default;
const prApp = (
  await import(
    pathToFileURL(resolve(process.cwd(), "src/api/routes/purchase-returns.ts")).href
  )
).default;

// ---------------------------------------------------------------------------
// Stateful in-memory mock D1. Implements just enough SQL for the two routes.
// Identifiers are written camelCase in route SQL; here we read both camelCase
// and snake_case keys off the seeded rows so the dual-key reads work.
// ---------------------------------------------------------------------------
function makeDb() {
  const tables = {
    grns: [],
    grn_items: [],
    purchase_orders: [],
    purchase_order_items: [],
    purchase_invoices: [],
    purchase_invoice_items: [],
    goods_in_transit: [],
    rm_batches: [],
    cost_ledger: [],
    raw_materials: [],
    suppliers: [],
    supplier_material_bindings: [],
    audit_events: [],
  };
  let autoId = 1;

  const norm = (s) => s.trim().replace(/\s+/g, " ");

  function prepare(rawSql) {
    const sql = norm(rawSql);
    let binds = [];
    const api = {
      bind(...args) {
        binds = args;
        return this;
      },
      async run() {
        exec(sql, binds);
        return { success: true, meta: { changes: 1 } };
      },
      async first() {
        const rows = query(sql, binds);
        return rows[0] ?? null;
      },
      async all() {
        return { results: query(sql, binds) };
      },
    };
    return api;
  }

  async function batch(stmts) {
    // T-006 R5: `db.beforeBatch` stands in for another invoice committing
    // between a route's check and its write.
    if (db.beforeBatch) {
      const hook = db.beforeBatch;
      db.beforeBatch = null;
      hook(tables);
    }
    // One transaction, as on Postgres: a raising statement rolls back all.
    return runAtomic(tables, stmts);
  }

  // Prod's chk_grn_items_invoiced_qty (migration 0246): the error postgres.js
  // throws, code and constraint name included.
  function checkInvoiced(gi) {
    const inv = Number(gi.invoiced_qty) || 0;
    if (inv < 0 || inv > (Number(getCol(gi, "acceptedQty")) || 0)) {
      const err = new Error(
        'new row for relation "grn_items" violates check constraint "chk_grn_items_invoiced_qty"',
      );
      err.code = "23514";
      err.constraint_name = "chk_grn_items_invoiced_qty";
      throw err;
    }
  }

  // ---- write side -----------------------------------------------------------
  function exec(sql, binds) {
    if (execPoReceiptSql(sql, binds, tables)) return;
    // ALTER / CREATE INDEX — no-op in the mock (all columns already present).
    if (/^ALTER TABLE/i.test(sql) || /^CREATE (UNIQUE )?INDEX/i.test(sql) || /^CREATE TABLE/i.test(sql)) {
      return;
    }
    // INSERT INTO <table> (cols) VALUES (?...)
    let m = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]*)\)/i);
    if (m) {
      const table = m[1];
      const cols = m[2].split(",").map((c) => c.trim());
      const row = {};
      cols.forEach((col, i) => {
        row[col] = binds[i];
      });
      if (table === "grn_items" && row.id == null) row.id = autoId++;
      // Prod's idx_lje_idempotent: one leg per (org, sourceType, sourceId, legNo).
      if (
        table === "ledger_journal_entries" &&
        (tables.ledger_journal_entries ?? []).some(
          (l) => l.orgId === row.orgId && l.sourceType === row.sourceType && l.sourceId === row.sourceId && Number(l.legNo) === Number(row.legNo),
        )
      ) {
        throw new Error('duplicate key value violates unique constraint "idx_lje_idempotent"');
      }
      (tables[table] ??= []).push(row);
      return;
    }
    // UPDATE grn_items SET invoiced_qty = COALESCE(invoiced_qty,0) + ? WHERE id = ?
    m = sql.match(/^UPDATE grn_items SET invoiced_qty = COALESCE\(invoiced_qty, 0\) \+ \? WHERE id = \?/i);
    if (m) {
      const [delta, id] = binds;
      const gi = tables.grn_items.find((r) => String(r.id) === String(id));
      if (gi) {
        gi.invoiced_qty = (Number(gi.invoiced_qty) || 0) + Number(delta);
        checkInvoiced(gi);
      }
      return;
    }
    // UPDATE grn_items SET invoiced_qty = invoiced_qty ± ? WHERE id = ?
    // (+ is the unvoid re-consume, − the delete / re-line restore)
    m = sql.match(/^UPDATE grn_items SET invoiced_qty = invoiced_qty ([+-]) \? WHERE id = \?/i);
    if (m) {
      const [delta, id] = binds;
      const gi = tables.grn_items.find((r) => String(r.id) === String(id));
      if (gi) {
        gi.invoiced_qty = (Number(gi.invoiced_qty) || 0) + (m[1] === "+" ? 1 : -1) * Number(delta);
        checkInvoiced(gi);
      }
      return;
    }
    // UPDATE purchase_order_items SET receivedQty = receivedQty + ? WHERE id = ?
    m = sql.match(/^UPDATE purchase_order_items SET receivedQty = receivedQty \+ \? WHERE id = \?/i);
    if (m) {
      const [delta, id] = binds;
      const poi = tables.purchase_order_items.find((r) => String(r.id) === String(id));
      if (poi) poi.receivedQty = (Number(poi.receivedQty) || 0) + Number(delta);
      return;
    }
    // UPDATE purchase_order_items SET receivedQty = receivedQty - ? WHERE id = ?
    m = sql.match(/^UPDATE purchase_order_items SET receivedQty = receivedQty - \? WHERE id = \?/i);
    if (m) {
      const [delta, id] = binds;
      const poi = tables.purchase_order_items.find((r) => String(r.id) === String(id));
      if (poi) poi.receivedQty = (Number(poi.receivedQty) || 0) - Number(delta);
      return;
    }
    // UPDATE grns SET ... WHERE id = ?  (status / qc / etc — last bind is id)
    m = sql.match(/^UPDATE grns SET (.+) WHERE id = \?/i);
    if (m) {
      const id = binds[binds.length - 1];
      const g = tables.grns.find((r) => String(r.id) === String(id));
      if (g) applySet(g, m[1], binds.slice(0, -1));
      return;
    }
    // UPDATE purchase_invoices SET ... WHERE id = ?  (last bind is id)
    m = sql.match(/^UPDATE purchase_invoices SET (.+) WHERE id = \?$/i);
    if (m) {
      const id = binds[binds.length - 1];
      const pi = tables.purchase_invoices.find((r) => String(r.id) === String(id));
      if (pi) applySet(pi, m[1], binds.slice(0, -1));
      return;
    }
    // UPDATE purchase_orders SET ... WHERE id = ? [AND status IN (...)]
    m = sql.match(/^UPDATE purchase_orders SET (.+) WHERE id = \?( AND status IN \([^)]*\))?/i);
    if (m) {
      // id is the bind right after the SET binds; trailing status filter has
      // no binds (literal). Count placeholders in the SET clause.
      const setClause = m[1];
      const nSet = (setClause.match(/\?/g) || []).length;
      const id = binds[nSet];
      const po = tables.purchase_orders.find((r) => String(r.id) === String(id));
      if (po) {
        if (m[2]) {
          const allowed = m[2].match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, "")) ?? [];
          if (!allowed.includes(po.status)) return;
        }
        applySet(po, setClause, binds.slice(0, nSet));
      }
      return;
    }
    // DELETE FROM <table> WHERE <col> = ?
    m = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/i);
    if (m) {
      const [table, col] = [m[1], m[2]];
      const val = binds[0];
      const before = tables[table];
      tables[table] = before.filter((r) => String(getCol(r, col)) !== String(val));
      // FK cascade: deleting a grn removes its grn_items; deleting a pi removes its items.
      if (table === "grns") {
        tables.grn_items = tables.grn_items.filter((r) => String(getCol(r, "grnId")) !== String(val));
      }
      if (table === "purchase_invoices") {
        tables.purchase_invoice_items = tables.purchase_invoice_items.filter(
          (r) => String(getCol(r, "pi_id")) !== String(val),
        );
      }
      return;
    }
    // Anything else (audit inserts use the INSERT path above) — ignore.
  }

  // Apply "col = ?, col2 = expr, ..." assignments. Only handles `col = ?`,
  // `col = NULL`, and ignores function exprs we don't need to track.
  function applySet(row, setClause, setBinds) {
    let bi = 0;
    for (const part of setClause.split(",")) {
      const seg = part.trim();
      const eq = seg.match(/^(\w+) = (.+)$/);
      if (!eq) continue;
      const col = eq[1];
      const rhs = eq[2].trim();
      if (rhs === "?") {
        row[col] = setBinds[bi++];
      } else if (/^NULL$/i.test(rhs)) {
        row[col] = null;
      } else if (/^'[^']*'$/.test(rhs)) {
        // string literal, e.g. status = 'CONFIRMED'
        row[col] = rhs.slice(1, -1);
      } else {
        // expression with a placeholder, e.g. amount_sen — consume a bind if present
        if (rhs.includes("?")) bi++;
      }
    }
  }

  // ---- read side ------------------------------------------------------------
  function getCol(row, col) {
    // dual-key: try the literal col, its camel/snake twin
    if (row[col] !== undefined) return row[col];
    const snake = col.replace(/[A-Z]/g, (x) => "_" + x.toLowerCase());
    const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return row[snake] ?? row[camel];
  }

  function query(sql, binds) {
    // SELECT poNo / piNo generators — return empty so seq starts at 001.
    if (/FROM grns WHERE grnNumber LIKE/i.test(sql)) return [];
    if (/FROM purchase_invoices WHERE piNo LIKE/i.test(sql)) return [];
    if (/FROM purchase_orders WHERE poNo LIKE/i.test(sql)) return [];

    // HK-0096 — PO lines by id, for the cumulative over-receipt ceiling.
    if (/SELECT id, materialName, quantity, receivedQty FROM purchase_order_items WHERE id IN/i.test(sql)) {
      const ids = binds.map(String);
      return tables.purchase_order_items
        .filter((r) => ids.includes(String(r.id)))
        .map((r) => ({
          id: r.id,
          materialName: getCol(r, "materialName"),
          quantity: getCol(r, "quantity"),
          receivedQty: Number(getCol(r, "receivedQty")) || 0,
        }));
    }
    // HK-0096 — returned-before-billing per GRN line (returns with no PI).
    if (/FROM purchase_return_items pri JOIN purchase_returns pr/i.test(sql)) {
      const ids = binds.map(String);
      const byLine = new Map();
      for (const it of tables.purchase_return_items ?? []) {
        const pr = (tables.purchase_returns ?? []).find((h) => h.id === it.purchase_return_id);
        if (!pr || String(pr.purchase_invoice_id ?? "") !== "") continue;
        const gi = String(it.grn_item_id ?? "");
        if (!ids.includes(gi)) continue;
        byLine.set(gi, (byLine.get(gi) ?? 0) + (Number(it.quantity) || 0));
      }
      return [...byLine].map(([grnItemId, qty]) => ({ grnItemId, qty }));
    }
    // HK-0096 — return caps: the source line's qty, and what was already returned.
    if (/SELECT acceptedQty - COALESCE\(invoiced_qty, 0\) AS cap FROM grn_items WHERE id = \?/i.test(sql)) {
      return tables.grn_items
        .filter((r) => String(r.id) === String(binds[0]))
        .map((r) => ({ cap: (Number(getCol(r, "acceptedQty")) || 0) - (Number(r.invoiced_qty) || 0) }));
    }
    if (/SELECT qty AS cap FROM purchase_invoice_items WHERE id = \?/i.test(sql)) {
      return tables.purchase_invoice_items
        .filter((r) => String(r.id) === String(binds[0]))
        .map((r) => ({ cap: r.qty }));
    }
    {
      const m = sql.match(/SELECT COALESCE\(SUM\(quantity\), 0\) AS qty FROM purchase_return_items WHERE (\w+) = \?/i);
      if (m) {
        const qty = (tables.purchase_return_items ?? [])
          .filter((r) => String(r[m[1]] ?? "") === String(binds[0]))
          .reduce((n, r) => n + (Number(r.quantity) || 0), 0);
        return [{ qty }];
      }
    }

    // The invoice's posted legs, and the highest leg number per source.
    if (/FROM ledger_journal_entries WHERE sourceId = \? AND hidden = 0 AND sourceType LIKE 'purchase_invoice%'/i.test(sql)) {
      return (tables.ledger_journal_entries ?? []).filter(
        (l) => l.sourceId === binds[0] && !Number(l.hidden) && String(l.sourceType).startsWith("purchase_invoice"),
      );
    }
    if (/SELECT COALESCE\(MAX\(legNo\), 0\) AS m FROM ledger_journal_entries WHERE sourceType = \? AND sourceId = \?/i.test(sql)) {
      const legs = (tables.ledger_journal_entries ?? []).filter((l) => l.sourceType === binds[0] && l.sourceId === binds[1]);
      return [{ m: legs.reduce((mx, l) => Math.max(mx, Number(l.legNo) || 0), 0) }];
    }

    // RBAC role_permissions join — short-circuited by SUPER_ADMIN, but answer empty.
    if (/FROM role_permissions/i.test(sql)) return [];

    // SELECT * FROM grns WHERE id = ?
    if (/FROM grns WHERE id = \?/i.test(sql)) {
      return tables.grns.filter((r) => String(r.id) === String(binds[0]));
    }
    // SELECT poId FROM grns WHERE id = ?
    if (/SELECT poId FROM grns WHERE id = \?/i.test(sql)) {
      return tables.grns
        .filter((r) => String(r.id) === String(binds[0]))
        .map((r) => ({ poId: getCol(r, "poId") }));
    }
    // SELECT id, poId, poNumber FROM grns WHERE id = ?
    if (/SELECT id, poId, poNumber FROM grns WHERE id = \?/i.test(sql)) {
      return tables.grns
        .filter((r) => String(r.id) === String(binds[0]))
        .map((r) => ({ id: r.id, poId: getCol(r, "poId"), poNumber: getCol(r, "poNumber") }));
    }
    // SELECT * FROM grn_items WHERE grnId = ?  (and ORDER BY variants)
    if (/FROM grn_items WHERE grnId = \?/i.test(sql)) {
      return tables.grn_items.filter((r) => String(getCol(r, "grnId")) === String(binds[0]));
    }
    // SELECT * FROM grn_items  (list-all in GET /)
    if (/^SELECT \* FROM grn_items$/i.test(sql)) {
      return tables.grn_items.slice();
    }
    // SELECT poItemIndex, acceptedQty[, po_id, po_item_id] FROM grn_items WHERE grnId = ?
    // A GRN line may now name its OWN purchase order (a receipt can span
    // several POs), with the positional poItemIndex kept as the legacy path.
    if (/SELECT poItemIndex, acceptedQty.* FROM grn_items WHERE grnId = \?/i.test(sql)) {
      return tables.grn_items
        .filter((r) => String(getCol(r, "grnId")) === String(binds[0]))
        .map((r) => ({
          poItemIndex: getCol(r, "poItemIndex"),
          acceptedQty: getCol(r, "acceptedQty"),
          po_id: getCol(r, "po_id") ?? null,
          po_item_id: getCol(r, "po_item_id") ?? null,
        }));
    }
    // SELECT acceptedQty, invoiced_qty FROM grn_items WHERE id = ?  (re-line ceiling)
    if (/SELECT acceptedQty, invoiced_qty FROM grn_items WHERE id = \?/i.test(sql)) {
      return tables.grn_items
        .filter((r) => String(r.id) === String(binds[0]))
        .map((r) => ({
          acceptedQty: getCol(r, "acceptedQty"),
          invoiced_qty: Number(r.invoiced_qty) || 0,
        }));
    }
    // SELECT invoiced_qty FROM grn_items WHERE id = ?
    if (/SELECT invoiced_qty FROM grn_items WHERE id = \?/i.test(sql)) {
      return tables.grn_items
        .filter((r) => String(r.id) === String(binds[0]))
        .map((r) => ({ invoiced_qty: Number(r.invoiced_qty) || 0 }));
    }
    // SELECT id, quantity, receivedQty FROM purchase_order_items WHERE purchaseOrderId = ? ORDER BY id
    if (/SELECT id, quantity, receivedQty FROM purchase_order_items WHERE purchaseOrderId = \?/i.test(sql)) {
      return tables.purchase_order_items
        .filter((r) => String(getCol(r, "purchaseOrderId")) === String(binds[0]))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((r) => ({ id: r.id, quantity: getCol(r, "quantity"), receivedQty: Number(getCol(r, "receivedQty")) || 0 }));
    }
    // SELECT quantity, receivedQty FROM purchase_order_items WHERE purchaseOrderId = ?
    if (/SELECT quantity, receivedQty FROM purchase_order_items WHERE purchaseOrderId = \?/i.test(sql)) {
      return tables.purchase_order_items
        .filter((r) => String(getCol(r, "purchaseOrderId")) === String(binds[0]))
        .map((r) => ({ quantity: getCol(r, "quantity"), receivedQty: Number(getCol(r, "receivedQty")) || 0 }));
    }
    // SELECT material_code, materialName, quantity, receivedQty FROM purchase_order_items WHERE purchaseOrderId = ?
    if (/FROM purchase_order_items WHERE purchaseOrderId = \?/i.test(sql)) {
      return tables.purchase_order_items
        .filter((r) => String(getCol(r, "purchaseOrderId")) === String(binds[0]))
        .map((r) => ({
          id: r.id,
          material_code: getCol(r, "material_code"),
          materialName: getCol(r, "materialName"),
          quantity: getCol(r, "quantity"),
          receivedQty: Number(getCol(r, "receivedQty")) || 0,
        }));
    }
    // SELECT id, materialName, acceptedQty, invoiced_qty FROM grn_items WHERE grnId = ?
    // (already covered by the generic grn_items WHERE grnId above — returns full rows)

    // SELECT * FROM purchase_invoices WHERE id = ?
    if (/FROM purchase_invoices WHERE id = \?/i.test(sql)) {
      return tables.purchase_invoices.filter((r) => String(r.id) === String(binds[0]));
    }
    // SELECT piNo FROM purchase_invoices WHERE grn_id = ? AND status != 'CANCELLED'
    if (/SELECT piNo FROM purchase_invoices WHERE grn_id = \? AND status != 'CANCELLED'/i.test(sql)) {
      return tables.purchase_invoices
        .filter((r) => String(getCol(r, "grn_id")) === String(binds[0]) && r.status !== "CANCELLED")
        .map((r) => ({ piNo: r.piNo }));
    }
    // SELECT grn_item_id, qty FROM purchase_invoice_items WHERE pi_id = ?
    if (/SELECT grn_item_id, qty FROM purchase_invoice_items WHERE pi_id = \?/i.test(sql)) {
      return tables.purchase_invoice_items
        .filter((r) => String(getCol(r, "pi_id")) === String(binds[0]))
        .map((r) => ({ grn_item_id: getCol(r, "grn_item_id"), qty: getCol(r, "qty") }));
    }
    // SELECT * FROM purchase_invoice_items WHERE pi_id = ?
    if (/FROM purchase_invoice_items WHERE pi_id = \?/i.test(sql)) {
      return tables.purchase_invoice_items.filter((r) => String(getCol(r, "pi_id")) === String(binds[0]));
    }
    // Already-invoiced against a PO, per material code:
    //   SELECT pii.material_code AS mc, COALESCE(SUM(pii.qty),0) AS qty
    //     FROM purchase_invoice_items pii JOIN purchase_invoices pi ...
    //    WHERE COALESCE(pii.po_id, pi.purchaseOrderId) = ? AND pi.status != 'CANCELLED'
    // A GRN-sourced line counts here through its own po_id — which is exactly
    // why the GRN-then-PO order was already blocked while PO-then-GRN was not.
    if (/FROM purchase_invoice_items pii JOIN purchase_invoices/i.test(sql)) {
      // grn_items.id is BIGINT, grn_item_id TEXT: Postgres refuses the uncast
      // join (BUG-2026-09-24-182) — and so does this mock.
      if (/JOIN grn_items gi ON gi\.id = /i.test(sql)) {
        throw new Error("operator does not exist: bigint = text");
      }
      const wanted = String(binds[0]);
      // The re-line path excludes the invoice being edited (AND pii.pi_id != ?)
      // — its current lines are about to be replaced.
      const excluded = /pii\.pi_id != \?/.test(sql) ? String(binds[1]) : null;
      const byCode = new Map();
      for (const it of tables.purchase_invoice_items) {
        if (excluded && String(getCol(it, "pi_id")) === excluded) continue;
        const pi = tables.purchase_invoices.find(
          (p) => String(p.id) === String(getCol(it, "pi_id")),
        );
        if (!pi || pi.status === "CANCELLED") continue;
        const effectivePo =
          getCol(it, "po_id") ?? getCol(pi, "purchaseOrderId") ?? null;
        if (effectivePo == null || String(effectivePo) !== wanted) continue;
        // T-006 R8: COALESCE(pii.po_item_id, gi.po_item_id), grouped with the code.
        const gi = tables.grn_items.find((g) => String(g.id) === String(getCol(it, "grn_item_id") ?? ""));
        const poItemId = getCol(it, "po_item_id") ?? (gi ? getCol(gi, "po_item_id") : null) ?? null;
        const mc = getCol(it, "material_code") ?? null;
        const k = JSON.stringify([poItemId, mc]);
        byCode.set(k, (byCode.get(k) ?? 0) + (Number(getCol(it, "qty")) || 0));
      }
      return [...byCode].map(([k, qty]) => {
        const [poItemId, mc] = JSON.parse(k);
        return { poItemId, mc, qty };
      });
    }
    // SELECT id, po_item_id FROM grn_items WHERE id IN (...)  (re-line, R8)
    if (/SELECT id, po_item_id FROM grn_items WHERE id IN/i.test(sql)) {
      const ids = binds.map(String);
      return tables.grn_items
        .filter((r) => ids.includes(String(r.id)))
        .map((r) => ({ id: r.id, po_item_id: getCol(r, "po_item_id") ?? null }));
    }
    // suppliers / poNo lookups not used here
    if (/FROM purchase_orders WHERE id = \?/i.test(sql)) {
      return tables.purchase_orders.filter((r) => String(r.id) === String(binds[0]));
    }
    return [];
  }

  const db = { tables, prepare, batch, beforeBatch: null };
  return db;
}

// Wrap a route sub-app so c.var.DB + userRole are injected (SUPER_ADMIN
// short-circuits RBAC). Mirrors what worker.ts middleware does in prod.
function mount(routeApp, db) {
  const root = new Hono();
  root.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "test-user");
    c.set("orgId", "org-test");
    await next();
  });
  root.route("/", routeApp);
  return root;
}

function seed(db) {
  // A PO with one line (10 units), already received via a POSTED GRN.
  db.tables.suppliers.push({ id: "sup-1", code: "S1", name: "ACME", email: null });
  db.tables.purchase_orders.push({
    id: "po-1", poNo: "PO-1", supplierId: "sup-1", supplierName: "ACME",
    subtotalSen: 100000, totalSen: 100000, status: "RECEIVED", orderDate: "2026-06-01",
    expectedDate: "", receivedDate: "2026-06-02", notes: "", orgId: "org-test",
  });
  db.tables.purchase_order_items.push({
    id: "poi-1", purchaseOrderId: "po-1", materialCategory: "FOAM",
    material_code: "FOAM-1", materialName: "FOAM-1 - Foam block", supplierSKU: "",
    quantity: 10, unitPriceSen: 10000, totalSen: 100000, receivedQty: 10, unit: "pcs",
    orgId: "org-test",
  });
  // A POSTED GRN that received all 10, one line. invoiced_qty starts 0.
  db.tables.grns.push({
    id: "grn-1", grnNumber: "GRN-1", poId: "po-1", poNumber: "PO-1",
    supplierId: "sup-1", supplierName: "ACME", receiveDate: "2026-06-02",
    receivedBy: "x", totalAmount: 100000, qcStatus: "PASSED", status: "POSTED",
    notes: "", arrival_state: "ARRIVED",
  });
  db.tables.grn_items.push({
    id: 101, grnId: "grn-1", poItemIndex: 0, materialCode: "FOAM-1",
    materialName: "FOAM-1 - Foam block", orderedQty: 10, receivedQty: 10,
    acceptedQty: 10, rejectedQty: 0, rejectionReason: null, unitPrice: 10000,
    invoiced_qty: 0,
  });
}

async function getGrnItem(grnRoot, grnId, grnItemId) {
  const res = await grnRoot.request(`/${grnId}`);
  const body = await res.json();
  return body.data.items.find((i) => String(i.id) === String(grnItemId));
}

// ---------------------------------------------------------------------------
test("GRN→PI consume decrements availableQty; deleting the PI restores it", async () => {
  const db = makeDb();
  seed(db);
  const grnRoot = mount(grnApp, db);
  const piRoot = mount(piApp, db);

  // before: GRN line 101 has 10 accepted, 0 invoiced → 10 available
  let gi = await getGrnItem(grnRoot, "grn-1", 101);
  assert.equal(gi.acceptedQty, 10);
  assert.equal(gi.invoicedQty, 0);
  assert.equal(gi.availableQty, 10);

  // create a PI from the GRN, billing 6 of 10 on that line
  const createRes = await piRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grnId: "grn-1",
      supplierId: "sup-1",
      supplierName: "ACME",
      items: [
        { materialCode: "FOAM-1", materialName: "FOAM-1 - Foam block", qty: 6, unitPriceSen: 10000, grnItemId: 101 },
      ],
    }),
  });
  assert.equal(createRes.status, 200);
  const created = (await createRes.json()).data;
  assert.equal(created.grnId, "grn-1");

  // available dropped to 4
  gi = await getGrnItem(grnRoot, "grn-1", 101);
  assert.equal(gi.invoicedQty, 6);
  assert.equal(gi.availableQty, 4);

  // delete the PI → availability restored to 10
  const delRes = await piRoot.request(`/${created.id}`, { method: "DELETE" });
  assert.equal(delRes.status, 200);

  gi = await getGrnItem(grnRoot, "grn-1", 101);
  assert.equal(gi.invoicedQty, 0);
  assert.equal(gi.availableQty, 10);
});

test("line guard BLOCKS over-invoicing but ALLOWS a 2nd PI for remaining qty", async () => {
  const db = makeDb();
  seed(db);
  const piRoot = mount(piApp, db);

  // PI #1 bills 6 of 10
  const r1 = await piRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grnId: "grn-1", supplierId: "sup-1", supplierName: "ACME",
      items: [{ materialName: "FOAM-1 - Foam block", qty: 6, unitPriceSen: 10000, grnItemId: 101 }],
    }),
  });
  assert.equal(r1.status, 200);

  // PI #2 tries to bill 5 more (only 4 remain) → 409 line-level block
  const rOver = await piRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grnId: "grn-1", supplierId: "sup-1", supplierName: "ACME",
      items: [{ materialName: "FOAM-1 - Foam block", qty: 5, unitPriceSen: 10000, grnItemId: 101 }],
    }),
  });
  assert.equal(rOver.status, 409);
  const overBody = await rOver.json();
  assert.equal(overBody.success, false);
  assert.match(overBody.error, /exceeds available 4/);

  // PI #2' bills exactly the remaining 4 → ALLOWED (the old PO-level 409
  // would have wrongly blocked any 2nd PI)
  const r2 = await piRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grnId: "grn-1", supplierId: "sup-1", supplierName: "ACME",
      items: [{ materialName: "FOAM-1 - Foam block", qty: 4, unitPriceSen: 10000, grnItemId: 101 }],
    }),
  });
  assert.equal(r2.status, 200);

  // GRN line now fully consumed (10 of 10).
  const gi = db.tables.grn_items.find((r) => r.id === 101);
  assert.equal(Number(gi.invoiced_qty), 10);
});

test("a POSTED (received) GRN is LOCKED — un-post is blocked (owner option A)", async () => {
  const db = makeDb();
  seed(db);
  const grnRoot = mount(grnApp, db);

  // before: PO line fully received (receivedQty 10) → 0 available
  const poi = db.tables.purchase_order_items.find((r) => r.id === "poi-1");
  assert.equal(poi.receivedQty, 10);

  // try to un-post the GRN: POSTED → DRAFT — must be REJECTED (stock is in;
  // un-posting would free the PO line while the stock stays. Reverse via a
  // stock adjustment instead).
  const res = await grnRoot.request("/grn-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "DRAFT" }),
  });
  assert.equal(res.status, 409);

  // receivedQty stays consumed (NOT restored) — the received GRN is locked
  assert.equal(poi.receivedQty, 10);
  const po = db.tables.purchase_orders.find((r) => r.id === "po-1");
  assert.equal(po.status, "RECEIVED");
});

test("a POSTED (received) GRN is LOCKED — delete is blocked (owner option A)", async () => {
  const db = makeDb();
  seed(db);
  const grnRoot = mount(grnApp, db);

  const res = await grnRoot.request("/grn-1", { method: "DELETE" });
  assert.equal(res.status, 409);

  // GRN still exists, PO line still consumed
  assert.ok(db.tables.grns.find((r) => r.id === "grn-1"));
  const poi = db.tables.purchase_order_items.find((r) => r.id === "poi-1");
  assert.equal(poi.receivedQty, 10);
});

// ---------------------------------------------------------------------------
// No-Draft create-status mapping (owner ruling 2026-06-21).
//
// Manual create is a REAL document, not a throwaway draft:
//   • OCR/scan (body.ocrUsed)                 → DRAFT  (parked for review)
//   • local goods arrived (default ARRIVED)   → POSTED (stock in now)
//   • import in transit (arrival_state set)   → DRAFT  (arrival-pipeline tracked)
// Posting to stock happens ONLY when arrival === ARRIVED — the arrival gate is
// never bypassed at create time.
// ---------------------------------------------------------------------------

// Seed an open PO (CONFIRMED, nothing received) the create endpoint can receive.
function seedOpenPo(db) {
  db.tables.suppliers.push({ id: "sup-9", code: "S9", name: "OPEN CO", email: null });
  db.tables.purchase_orders.push({
    id: "po-9", poNo: "PO-9", supplierId: "sup-9", supplierName: "OPEN CO",
    subtotalSen: 50000, totalSen: 50000, status: "CONFIRMED", orderDate: "2026-06-01",
    expectedDate: "", receivedDate: "", notes: "", orgId: "org-test",
  });
  db.tables.purchase_order_items.push({
    id: "poi-9", purchaseOrderId: "po-9", materialCategory: "FOAM",
    material_code: "FOAM-9", materialName: "FOAM-9 - Foam block", supplierSKU: "",
    quantity: 5, unitPriceSen: 10000, totalSen: 50000, receivedQty: 0, unit: "pcs",
    orgId: "org-test",
  });
}

test("manual GRN (goods in hand) is born POSTED and posts to stock", async () => {
  const db = makeDb();
  const grnRoot = mount(grnApp, db);

  // Manual receipt: no poId, no arrival override → backend default ARRIVED →
  // status POSTED (No-Draft: a real document, stock in immediately).
  const res = await grnRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      supplierId: "sup-9",
      supplierName: "OPEN CO",
      receivedBy: "Ahmad",
      items: [
        { materialName: "Loose foam", materialCode: "F-LOOSE", receivedQty: 3, acceptedQty: 3, rejectedQty: 0 },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const data = (await res.json()).data;
  assert.equal(data.status, "POSTED", "manual arrived GRN must be born POSTED, not DRAFT");
  assert.equal(data.arrival_state, "ARRIVED");
});

test("OCR/scan GRN lands as DRAFT for review (not posted)", async () => {
  const db = makeDb();
  const grnRoot = mount(grnApp, db);

  const res = await grnRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      supplierId: "sup-9",
      supplierName: "OPEN CO",
      receivedBy: "Ahmad",
      ocrUsed: true, // built from a scanned supplier document
      items: [
        { materialName: "Scanned foam", materialCode: "F-SCAN", receivedQty: 3, acceptedQty: 3, rejectedQty: 0 },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const data = (await res.json()).data;
  assert.equal(data.status, "DRAFT", "scanned GRN must be DRAFT for review");
});

test("import in transit (PO-linked, not arrived) is DRAFT and does NOT post to stock", async () => {
  const db = makeDb();
  seedOpenPo(db);
  const grnRoot = mount(grnApp, db);

  // PO-linked receipt with goods still en-route: defaults NOT_ARRIVED → DRAFT.
  const res = await grnRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      poId: "po-9",
      receivedBy: "Ahmad",
      arrival_state: "NOT_ARRIVED",
      items: [{ poItemIndex: 0, receivedQty: 5, acceptedQty: 5, rejectedQty: 0 }],
    }),
  });
  assert.equal(res.status, 201);
  const data = (await res.json()).data;
  assert.equal(data.status, "DRAFT", "in-transit import must stay DRAFT (arrival-pipeline tracked)");
  assert.equal(data.arrival_state, "NOT_ARRIVED");

  // NOT posted to stock → the parent PO line's receivedQty stays 0 (no cascade).
  const poi = db.tables.purchase_order_items.find((r) => r.id === "poi-9");
  assert.equal(Number(poi.receivedQty) || 0, 0, "in-transit GRN must not bump PO receivedQty");
});

test("PO-linked + arrival ARRIVED at create → POSTED + receivedQty cascades", async () => {
  const db = makeDb();
  seedOpenPo(db);
  const grnRoot = mount(grnApp, db);

  // Goods physically arrived against the PO at receipt time → arrival ARRIVED →
  // born POSTED → postGRNToStock + cascadePOStatusAfterGRNPost run.
  const res = await grnRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      poId: "po-9",
      receivedBy: "Ahmad",
      arrival_state: "ARRIVED",
      items: [{ poItemIndex: 0, receivedQty: 5, acceptedQty: 5, rejectedQty: 0 }],
    }),
  });
  assert.equal(res.status, 201);
  const data = (await res.json()).data;
  assert.equal(data.status, "POSTED");

  // receivedQty cascade fired: PO line went 0 → 5 and the PO is now RECEIVED.
  const poi = db.tables.purchase_order_items.find((r) => r.id === "poi-9");
  assert.equal(Number(poi.receivedQty), 5, "post-on-create must cascade receivedQty");
  const po = db.tables.purchase_orders.find((r) => r.id === "po-9");
  assert.equal(po.status, "RECEIVED");
});

// ---------------------------------------------------------------------------
// BUG-2026-08-07-003 — a purchase order could be invoiced TWICE for the same
// goods.
//
// A GRN-sourced invoice was validated ONLY against grn_items.invoiced_qty. It
// never looked at the purchase order's own remaining quantity, so:
//   1. bill 100 straight off the PO   → passes (PO ceiling: 100 remaining)
//   2. goods arrive, GRN POSTED, accepted 100, invoiced_qty 0
//   3. bill the same 100 off the GRN  → passed (GRN ceiling: 100 accepted)
// = 200 of payable against a 100 PO, with no 409 anywhere.
//
// The REVERSE order was already caught: the PO ceiling counts a GRN-sourced
// line through COALESCE(pii.po_id, pi.purchaseOrderId), so a GRN invoice
// consumed the PO's remaining and the later PO-direct invoice hit the wall.
// One-directional, which is exactly why it survived.
// ---------------------------------------------------------------------------
function seedPoAndReceipt(db, { ordered = 100, accepted = 100 } = {}) {
  db.tables.suppliers.push({ id: "sup-2", code: "S2", name: "ADD WOOD", email: null });
  db.tables.purchase_orders.push({
    id: "po-2", poNo: "PO-2", supplierId: "sup-2", supplierName: "ADD WOOD",
    subtotalSen: ordered * 10000, totalSen: ordered * 10000, status: "RECEIVED",
    orderDate: "2026-08-01", expectedDate: "", receivedDate: "2026-08-02",
    notes: "", orgId: "org-test",
  });
  db.tables.purchase_order_items.push({
    id: "poi-2", purchaseOrderId: "po-2", materialCategory: "WOOD",
    material_code: "WOOD-2", materialName: "WOOD-2 - Pine plank", supplierSKU: "",
    quantity: ordered, unitPriceSen: 10000, totalSen: ordered * 10000,
    receivedQty: accepted, unit: "pcs", orgId: "org-test",
  });
  db.tables.grns.push({
    id: "grn-2", grnNumber: "GRN-2", poId: "po-2", poNumber: "PO-2",
    supplierId: "sup-2", supplierName: "ADD WOOD", receiveDate: "2026-08-02",
    receivedBy: "x", totalAmount: accepted * 10000, qcStatus: "PASSED",
    status: "POSTED", notes: "", arrival_state: "ARRIVED",
  });
  db.tables.grn_items.push({
    id: 201, grnId: "grn-2", poItemIndex: 0, po_id: "po-2", po_item_id: "poi-2",
    materialCode: "WOOD-2", materialName: "WOOD-2 - Pine plank",
    orderedQty: ordered, receivedQty: accepted, acceptedQty: accepted,
    rejectedQty: 0, rejectionReason: null, unitPrice: 10000, invoiced_qty: 0,
  });
}

const poDirectPI = (qty) => ({
  purchaseOrderId: "po-2",
  supplierId: "sup-2",
  supplierName: "ADD WOOD",
  items: [
    {
      materialCode: "WOOD-2",
      materialName: "WOOD-2 - Pine plank",
      qty,
      unitPriceSen: 10000,
      poId: "po-2",
    },
  ],
});

const grnSourcedPI = (qty, extra = {}) => ({
  grnId: "grn-2",
  supplierId: "sup-2",
  supplierName: "ADD WOOD",
  ...extra,
  items: [
    {
      materialCode: "WOOD-2",
      materialName: "WOOD-2 - Pine plank",
      qty,
      unitPriceSen: 10000,
      grnItemId: 201,
    },
  ],
});

const post = (root, payload) =>
  root.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

test("PO-direct 100 then GRN-sourced 100 is REJECTED — one PO, one lot of goods", async () => {
  const db = makeDb();
  seedPoAndReceipt(db);
  const piRoot = mount(piApp, db);

  // 1. bill all 100 straight off the purchase order
  assert.equal((await post(piRoot, poDirectPI(100))).status, 200);

  // 2. bill the SAME 100 off the receipt — the GRN line still shows 100
  //    accepted / 0 invoiced, so only the PO ceiling can stop this.
  const res = await post(piRoot, grnSourcedPI(100, { purchaseOrderId: "po-2" }));
  assert.equal(res.status, 409, "a GRN-sourced invoice must also honour the PO ceiling");
  const body = await res.json();
  assert.equal(body.success, false);
  // Actionable: the material, what was asked for, what is actually left.
  assert.match(body.error, /WOOD-2/, "the error must name the material code");
  assert.match(body.error, /requested 100/, "the error must state what was requested");
  assert.match(body.error, /remaining 0/, "the error must state what the PO has left");
  assert.match(body.error, /PO-2/, "the error must name the purchase order");

  // Nothing was consumed by the rejected attempt.
  const gi = db.tables.grn_items.find((r) => r.id === 201);
  assert.equal(Number(gi.invoiced_qty) || 0, 0);
  assert.equal(db.tables.purchase_invoices.length, 1);
});

test("the PO ceiling is found through grn_items.po_id when the body names no PO", async () => {
  const db = makeDb();
  seedPoAndReceipt(db);
  const piRoot = mount(piApp, db);

  assert.equal((await post(piRoot, poDirectPI(100))).status, 200);

  // No purchaseOrderId, no per-line poId — the GRN's own lines resolve it.
  const res = await post(piRoot, grnSourcedPI(100));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /remaining 0/);
});

test("a legitimate split still passes: 60 off the PO, then 40 off the GRN", async () => {
  const db = makeDb();
  seedPoAndReceipt(db);
  const piRoot = mount(piApp, db);

  assert.equal((await post(piRoot, poDirectPI(60))).status, 200);

  // 40 remain on the PO and 100 on the receipt — over-blocking this would be
  // its own bug (the same line must not be counted twice against the PO).
  const res = await post(piRoot, grnSourcedPI(40, { purchaseOrderId: "po-2" }));
  assert.equal(res.status, 200, "the remaining 40 must still be invoiceable");

  // 100 billed in total, and the GRN line drew down by the 40.
  const gi = db.tables.grn_items.find((r) => r.id === 201);
  assert.equal(Number(gi.invoiced_qty), 40);

  // The 101st unit is refused.
  const over = await post(piRoot, grnSourcedPI(1, { purchaseOrderId: "po-2" }));
  assert.equal(over.status, 409);
});

test("two GRN-sourced invoices split 60/40 without double-counting the PO", async () => {
  const db = makeDb();
  seedPoAndReceipt(db);
  const piRoot = mount(piApp, db);

  assert.equal((await post(piRoot, grnSourcedPI(60, { purchaseOrderId: "po-2" }))).status, 200);
  assert.equal((await post(piRoot, grnSourcedPI(40, { purchaseOrderId: "po-2" }))).status, 200);

  const gi = db.tables.grn_items.find((r) => r.id === 201);
  assert.equal(Number(gi.invoiced_qty), 100);
});

test("a GRN with no purchase order behind it (direct receipt) still invoices", async () => {
  const db = makeDb();
  db.tables.suppliers.push({ id: "sup-3", code: "S3", name: "WALK IN", email: null });
  db.tables.grns.push({
    id: "grn-3", grnNumber: "GRN-3", poId: null, poNumber: null,
    supplierId: "sup-3", supplierName: "WALK IN", receiveDate: "2026-08-02",
    receivedBy: "x", totalAmount: 50000, qcStatus: "PASSED", status: "POSTED",
    notes: "", arrival_state: "ARRIVED",
  });
  db.tables.grn_items.push({
    id: 301, grnId: "grn-3", poItemIndex: null, po_id: null, po_item_id: null,
    materialCode: "LOOSE-1", materialName: "LOOSE-1 - Loose foam",
    orderedQty: 0, receivedQty: 5, acceptedQty: 5, rejectedQty: 0,
    rejectionReason: null, unitPrice: 10000, invoiced_qty: 0,
  });
  const piRoot = mount(piApp, db);

  const res = await post(piRoot, {
    grnId: "grn-3",
    supplierId: "sup-3",
    supplierName: "WALK IN",
    items: [
      { materialCode: "LOOSE-1", materialName: "LOOSE-1 - Loose foam", qty: 5, unitPriceSen: 10000, grnItemId: 301 },
    ],
  });
  assert.equal(res.status, 200, "a receipt with no PO must stay invoiceable");
  const gi = db.tables.grn_items.find((r) => r.id === 301);
  assert.equal(Number(gi.invoiced_qty), 5);
});

test("re-lining an invoice cannot walk around the PO ceiling", async () => {
  const db = makeDb();
  seedPoAndReceipt(db);
  const piRoot = mount(piApp, db);

  // 80 already billed straight off the PO; 20 left.
  assert.equal((await post(piRoot, poDirectPI(80))).status, 200);
  const created = (await (await post(piRoot, grnSourcedPI(1, { purchaseOrderId: "po-2" }))).json()).data;

  const relineTo = (qty) =>
    piRoot.request(`/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            materialCode: "WOOD-2",
            materialName: "WOOD-2 - Pine plank",
            qty,
            unitPriceSen: 10000,
            grnItemId: 201,
            poId: "po-2",
          },
        ],
      }),
    });

  // Raise-1-then-edit-to-100 is the obvious way around a create-time guard.
  const over = await relineTo(100);
  assert.equal(over.status, 409);
  assert.match((await over.json()).error, /remaining 20/);

  // The edit that FITS still goes through — this invoice's own line must not
  // be counted against it (19 more on top of its own 1 = the 20 that remain).
  assert.equal((await relineTo(20)).status, 200);
  const gi = db.tables.grn_items.find((r) => r.id === 201);
  assert.equal(Number(gi.invoiced_qty), 20);

  // And an edit that REDUCES is never blocked.
  assert.equal((await relineTo(5)).status, 200);
});

test("an accepted over-receipt stays invoiceable — the ceiling follows the goods", async () => {
  // grn.ts allows a receipt to run over the order within tolerance. Those
  // goods are in stock and WILL be billed; capping the invoice at the ordered
  // quantity would leave a real liability un-recordable.
  const db = makeDb();
  seedPoAndReceipt(db, { ordered: 100, accepted: 110 });
  const piRoot = mount(piApp, db);

  const res = await post(piRoot, grnSourcedPI(110, { purchaseOrderId: "po-2" }));
  assert.equal(res.status, 200);

  // ... but not a unit beyond what was actually received.
  const over = await post(piRoot, grnSourcedPI(1, { purchaseOrderId: "po-2" }));
  assert.equal(over.status, 409);
});

test("explicit body.status DRAFT forces DRAFT even for arrived goods", async () => {
  const db = makeDb();
  const grnRoot = mount(grnApp, db);

  const res = await grnRoot.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      supplierId: "sup-9",
      supplierName: "OPEN CO",
      receivedBy: "Ahmad",
      status: "DRAFT", // caller forces review even though goods are in hand
      items: [
        { materialName: "Loose foam", materialCode: "F-LOOSE", receivedQty: 1, acceptedQty: 1, rejectedQty: 0 },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const data = (await res.json()).data;
  assert.equal(data.status, "DRAFT");
});

test("BUG-2026-10-14-286 — void, unvoid, void again: each reversal gets new leg numbers", async () => {
  const db = makeDb();
  seedOpenPo(db);
  const piRoot = mount(piApp, db);
  const send = (path, method, body) =>
    piRoot.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const created = await post(piRoot, {
    purchaseOrderId: "po-9", supplierId: "sup-9", supplierName: "OPEN CO",
    items: [{ materialCode: "FOAM-9", materialName: "FOAM-9 - Foam block", qty: 5, unitPriceSen: 10000, poId: "po-9" }],
  });
  assert.equal(created.status, 200, await created.clone().text());
  const pi = (await created.json()).data;
  const confirm = await send(`/${pi.id}`, "PUT", { status: "CONFIRMED" });
  assert.equal(confirm.status, 200, await confirm.clone().text());
  for (const step of ["void", "unvoid", "void", "unvoid"]) {
    const r = await send(`/${pi.id}/${step}`, "POST");
    assert.equal(r.status, 200, `${step}: ${await r.clone().text()}`);
  }
  const voidLegs = (db.tables.ledger_journal_entries ?? []).filter((l) => l.sourceType === "purchase_invoice_void");
  assert.ok(voidLegs.length >= 4, "two voids posted legs");
  assert.equal(new Set(voidLegs.map((l) => l.legNo)).size, voidLegs.length, "no leg number reused");
});

// ---------------------------------------------------------------------------
// HK-0096 (HK-0003 parts 2 and 3) — cumulative receipt and invoice-qty guards.
//
// Part 2: the 110% over-receipt ceiling was checked per DOCUMENT, so two
// receipts could each take the full PO qty. It is now (already received on the
// PO line + this receipt) at create, at the DRAFT → POSTED flip, and on a qty
// increase to a POSTED receipt.
// Part 3: a PI could be raised off a DRAFT/CANCELLED receipt, goods returned
// off a GRN before billing stayed billable (and such a return gets no DN), and
// a purchase return had no cap — the same line could be returned twice.
// ---------------------------------------------------------------------------
const json = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("HK-0096 two receipts cannot each take the full PO qty (create)", async () => {
  const db = makeDb();
  seedOpenPo(db); // poi-9: ordered 5, received 0
  const grnRoot = mount(grnApp, db);
  const receipt = {
    poId: "po-9", receivedBy: "Ahmad", arrival_state: "ARRIVED",
    items: [{ poItemIndex: 0, poId: "po-9", poItemId: "poi-9", receivedQty: 5, acceptedQty: 5, rejectedQty: 0 }],
  };
  assert.equal((await grnRoot.request("/", json("POST", receipt))).status, 201);
  const second = await grnRoot.request("/", json("POST", receipt));
  assert.equal(second.status, 400, "5 already received + 5 more > 110% of 5");
  assert.match((await second.json()).error, /already received 5 \+ this receipt 5/);
  const poi = db.tables.purchase_order_items.find((r) => r.id === "poi-9");
  assert.equal(Number(poi.receivedQty), 5, "the refused receipt drew nothing down");
});

test("HK-0096 two lines of one receipt against the same PO line count together", async () => {
  const db = makeDb();
  seedOpenPo(db);
  const grnRoot = mount(grnApp, db);
  const line = { poItemIndex: 0, poId: "po-9", poItemId: "poi-9", receivedQty: 3, acceptedQty: 3, rejectedQty: 0 };
  const res = await grnRoot.request(
    "/",
    json("POST", { poId: "po-9", receivedBy: "Ahmad", arrival_state: "ARRIVED", items: [line, line] }),
  );
  assert.equal(res.status, 400, "3 + 3 on one PO line > 110% of 5");
});

test("HK-0096 two DRAFT receipts: only the first to post may take the PO qty", async () => {
  const db = makeDb();
  seedOpenPo(db);
  for (const id of ["grn-d1", "grn-d2"]) {
    db.tables.grns.push({
      id, grnNumber: id.toUpperCase(), poId: "po-9", poNumber: "PO-9",
      supplierId: "sup-9", supplierName: "OPEN CO", receiveDate: "2026-10-19",
      receivedBy: "x", totalAmount: 50000, qcStatus: "PENDING", status: "DRAFT",
      notes: "", arrival_state: "ARRIVED",
    });
    db.tables.grn_items.push({
      id: id === "grn-d1" ? 901 : 902, grnId: id, poItemIndex: 0, po_id: "po-9", po_item_id: "poi-9",
      materialCode: "FOAM-9", materialName: "FOAM-9 - Foam block", orderedQty: 5,
      receivedQty: 5, acceptedQty: 5, rejectedQty: 0, rejectionReason: null,
      unitPrice: 10000, invoiced_qty: 0,
    });
  }
  const grnRoot = mount(grnApp, db);
  assert.equal((await grnRoot.request("/grn-d1", json("PUT", { status: "POSTED" }))).status, 200);
  const second = await grnRoot.request("/grn-d2", json("PUT", { status: "POSTED" }));
  assert.equal(second.status, 400);
  assert.equal(db.tables.grns.find((g) => g.id === "grn-d2").status, "DRAFT", "the refused post left it DRAFT");
  assert.equal(Number(db.tables.purchase_order_items.find((r) => r.id === "poi-9").receivedQty), 5);
});

test("HK-0096 raising a POSTED receipt's qty past the ceiling is refused", async () => {
  const db = makeDb();
  seed(db); // poi-1 ordered 10, received 10 via grn-1
  const grnRoot = mount(grnApp, db);
  const res = await grnRoot.request("/grn-1", json("PUT", { items: [{ acceptedQty: 12 }] }));
  assert.equal(res.status, 400, "10 received + 2 more > 110% of 10");
  assert.equal(Number(db.tables.grn_items.find((r) => r.id === 101).acceptedQty), 10);
  // ...but a correction inside the tolerance still goes through.
  assert.equal((await grnRoot.request("/grn-1", json("PUT", { items: [{ acceptedQty: 11 }] }))).status, 200);
});

test("HK-0096 a CANCELLED or DRAFT receipt cannot be invoiced", async () => {
  for (const status of ["CANCELLED", "DRAFT"]) {
    const db = makeDb();
    seed(db);
    db.tables.grns.find((g) => g.id === "grn-1").status = status;
    const piRoot = mount(piApp, db);
    const res = await piRoot.request("/", json("POST", {
      grnId: "grn-1", supplierId: "sup-1", supplierName: "ACME",
      items: [{ materialCode: "FOAM-1", materialName: "FOAM-1 - Foam block", qty: 1, unitPriceSen: 10000, grnItemId: 101 }],
    }));
    assert.equal(res.status, 409, `${status} receipt must not be billable`);
    assert.equal(Number(db.tables.grn_items.find((r) => r.id === 101).invoiced_qty), 0);
  }
});

test("HK-0096 goods returned off the GRN before billing come off what a PI may bill", async () => {
  const db = makeDb();
  seed(db); // grn line 101: accepted 10
  db.tables.purchase_returns = [{ id: "pr-1", purchase_invoice_id: "", grn_id: "grn-1" }];
  db.tables.purchase_return_items = [{ id: "pri-1", purchase_return_id: "pr-1", grn_item_id: "101", quantity: 4 }];
  const piRoot = mount(piApp, db);
  const bill = (qty) => piRoot.request("/", json("POST", {
    grnId: "grn-1", supplierId: "sup-1", supplierName: "ACME",
    items: [{ materialCode: "FOAM-1", materialName: "FOAM-1 - Foam block", qty, unitPriceSen: 10000, grnItemId: 101 }],
  }));
  assert.equal((await bill(10)).status, 409, "4 of 10 went back unbilled — only 6 can be invoiced");
  assert.equal((await bill(6)).status, 200);
});

test("HK-0096 a GRN line cannot be returned twice over", async () => {
  const db = makeDb();
  seed(db); // grn line 101: accepted 10
  const prRoot = mount(prApp, db);
  const ret = (quantity) => prRoot.request("/", json("POST", {
    grnId: "grn-1",
    items: [{ grnItemId: "101", materialCode: "FOAM-1", materialName: "FOAM-1 - Foam block", quantity, unitCostSen: 10000 }],
  }));
  assert.equal((await ret(6)).status, 200);
  const over = await ret(6);
  assert.equal(over.status, 409, "6 already returned + 6 > 10 received");
  assert.match((await over.json()).error, /already returned 6/);
  assert.equal((await ret(4)).status, 200, "the remaining 4 can still go back");
});

// ---------------------------------------------------------------------------
// T-006 R5 / R8 / R9 (ported from staging, BUG-2026-10-20-355..357).
// ---------------------------------------------------------------------------

// A PO whose only line has NO material code (PO lines raised from a free-text
// description), fully received on a GRN that records the PO line id.
function seedBlankCodePo(db, { ordered = 10 } = {}) {
  db.tables.suppliers.push({ id: "sup-4", code: "S4", name: "BLANK CO", email: null });
  db.tables.purchase_orders.push({
    id: "po-4", poNo: "PO-4", supplierId: "sup-4", supplierName: "BLANK CO",
    subtotalSen: ordered * 1000, totalSen: ordered * 1000, status: "RECEIVED",
    orderDate: "2026-10-01", expectedDate: "", receivedDate: "2026-10-02",
    notes: "", orgId: "org-test",
  });
  db.tables.purchase_order_items.push({
    id: "poi-4", purchaseOrderId: "po-4", materialCategory: "OTHER",
    material_code: null, materialName: "Hand-cut panel", supplierSKU: "",
    quantity: ordered, unitPriceSen: 1000, totalSen: ordered * 1000,
    receivedQty: ordered, unit: "pcs", orgId: "org-test",
  });
  db.tables.grns.push({
    id: "grn-4", grnNumber: "GRN-4", poId: "po-4", poNumber: "PO-4",
    supplierId: "sup-4", supplierName: "BLANK CO", receiveDate: "2026-10-02",
    receivedBy: "x", totalAmount: ordered * 1000, qcStatus: "PASSED",
    status: "POSTED", notes: "", arrival_state: "ARRIVED",
  });
  db.tables.grn_items.push({
    id: 401, grnId: "grn-4", poItemIndex: 0, po_id: "po-4", po_item_id: "poi-4",
    materialCode: "", materialName: "Hand-cut panel",
    orderedQty: ordered, receivedQty: ordered, acceptedQty: ordered,
    rejectedQty: 0, rejectionReason: null, unitPrice: 1000, invoiced_qty: 0,
  });
}

const blankLine = (qty, extra = {}) => ({
  materialCode: null, materialName: "Hand-cut panel", qty, unitPriceSen: 1000, ...extra,
});
const blankHeader = { supplierId: "sup-4", supplierName: "BLANK CO" };

test("T-006 R8: a blank-code PO line billed straight off the PO is capped by its PO line id", async () => {
  const db = makeDb();
  seedBlankCodePo(db);
  const piRoot = mount(piApp, db);
  const bill = (qty) => post(piRoot, {
    ...blankHeader, purchaseOrderId: "po-4",
    items: [blankLine(qty, { poId: "po-4", poItemId: "poi-4" })],
  });

  assert.equal((await bill(10)).status, 200);
  // Before R8 the blank code matched no PO line and this sailed through.
  const over = await bill(1);
  assert.equal(over.status, 409);
  const err = (await over.json()).error;
  assert.match(err, /remaining 0/);
  assert.match(err, /PO-4/);
  assert.doesNotMatch(err, /poi-4|item:/, "never print a bucket key or a raw PO-line id");
  // The PO line is stored on the invoice line, so the NEXT check can count it.
  assert.equal(db.tables.purchase_invoice_items[0].po_item_id, "poi-4");
});

test("T-006 R8: a blank-code GRN line is capped through grn_items.po_item_id", async () => {
  const db = makeDb();
  seedBlankCodePo(db);
  const piRoot = mount(piApp, db);

  // All 10 billed off the PO first...
  assert.equal((await post(piRoot, {
    ...blankHeader, purchaseOrderId: "po-4",
    items: [blankLine(10, { poId: "po-4", poItemId: "poi-4" })],
  })).status, 200);
  // ...so the receipt, which still shows 10 un-invoiced, may not bill them again.
  const res = await post(piRoot, { ...blankHeader, grnId: "grn-4", items: [blankLine(10, { grnItemId: 401 })] });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /remaining 0/);
  assert.equal(Number(db.tables.grn_items.find((g) => g.id === 401).invoiced_qty), 0);
});

test("T-006 R8: the GRN line's PO line is stored, and counts against a later PO-direct bill", async () => {
  const db = makeDb();
  seedBlankCodePo(db);
  const piRoot = mount(piApp, db);

  assert.equal((await post(piRoot, { ...blankHeader, grnId: "grn-4", items: [blankLine(6, { grnItemId: 401 })] })).status, 200);
  assert.equal(db.tables.purchase_invoice_items[0].po_item_id, "poi-4");
  const bill = (qty) => post(piRoot, {
    ...blankHeader, purchaseOrderId: "po-4",
    items: [blankLine(qty, { poId: "po-4", poItemId: "poi-4" })],
  });
  assert.equal((await bill(5)).status, 409, "6 billed off the receipt leaves 4");
  assert.equal((await bill(4)).status, 200);
});

test("T-006 R8: a PO-linked stocked line with neither a PO line nor a code is refused, not skipped", async () => {
  const db = makeDb();
  seedBlankCodePo(db);
  const piRoot = mount(piApp, db);
  const res = await post(piRoot, {
    ...blankHeader, purchaseOrderId: "po-4",
    items: [blankLine(500, { poId: "po-4" })],
  });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /matches none of its lines/);
  assert.equal(db.tables.purchase_invoices.length, 0);
});

test("T-006 R8: fee lines and hand-added lines with no PO link of their own stay allowed", async () => {
  const db = makeDb();
  seedBlankCodePo(db);
  const piRoot = mount(piApp, db);
  const res = await post(piRoot, {
    ...blankHeader, purchaseOrderId: "po-4",
    items: [
      blankLine(10, { poId: "po-4", poItemId: "poi-4" }),
      // Inherits the header PO only — e.g. a line typed in by hand.
      { materialCode: null, materialName: "Pallet", qty: 2, unitPriceSen: 500 },
      // A fee line, even one stamped with the PO.
      { materialCode: null, materialName: "Transport", qty: 1, unitPriceSen: 5000, lineType: "FEE", poId: "po-4" },
    ],
  });
  assert.equal(res.status, 200, await res.clone().text());
});

test("T-006 R8: a blank-code GRN line from before R8 (no po_item_id) is still billable", async () => {
  const db = makeDb();
  seedBlankCodePo(db);
  db.tables.grn_items.find((g) => g.id === 401).po_item_id = null;
  const piRoot = mount(piApp, db);
  // The GRN modal sends the line's PO too; the receipt still caps it.
  const res = await post(piRoot, {
    ...blankHeader, grnId: "grn-4", purchaseOrderId: "po-4",
    items: [blankLine(10, { grnItemId: 401, poId: "po-4" })],
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await post(piRoot, { ...blankHeader, grnId: "grn-4", items: [blankLine(1, { grnItemId: 401 })] })).status, 409);
});

test("T-006 R8: a line re-coded after picking counts under its new code, not its old PO line", async () => {
  const db = makeDb();
  seedOpenPo(db); // poi-9: FOAM-9, 5 ordered
  db.tables.purchase_order_items.push({
    id: "poi-10", purchaseOrderId: "po-9", materialCategory: "FOAM",
    material_code: "FOAM-10", materialName: "FOAM-10 - Foam slab", supplierSKU: "",
    quantity: 5, unitPriceSen: 10000, totalSen: 50000, receivedQty: 0, unit: "pcs",
    orgId: "org-test",
  });
  const piRoot = mount(piApp, db);
  const line = (code, qty) => ({ materialCode: code, materialName: code, qty, unitPriceSen: 10000, poId: "po-9", poItemId: "poi-9" });
  // FOAM-9 fully billed...
  assert.equal((await post(piRoot, { supplierId: "sup-9", supplierName: "OPEN CO", purchaseOrderId: "po-9", items: [line("FOAM-9", 5)] })).status, 200);
  // ...a line picked on FOAM-9 then re-coded to FOAM-10 bills FOAM-10's 5.
  assert.equal((await post(piRoot, { supplierId: "sup-9", supplierName: "OPEN CO", purchaseOrderId: "po-9", items: [line("FOAM-10", 5)] })).status, 200);
  assert.equal((await post(piRoot, { supplierId: "sup-9", supplierName: "OPEN CO", purchaseOrderId: "po-9", items: [line("FOAM-10", 1)] })).status, 409);
});

test("T-006 R8: a material ordered on two PO lines is billable for both lines together (f740d53c)", async () => {
  const db = makeDb();
  seedOpenPo(db); // poi-9: FOAM-9, 5 ordered
  db.tables.purchase_order_items.push({
    id: "poi-9b", purchaseOrderId: "po-9", materialCategory: "FOAM",
    material_code: "FOAM-9", materialName: "FOAM-9 - Foam block", supplierSKU: "",
    quantity: 5, unitPriceSen: 10000, totalSen: 50000, receivedQty: 0, unit: "pcs",
    orgId: "org-test",
  });
  const piRoot = mount(piApp, db);
  const bill = (qty, poItemId) => post(piRoot, {
    purchaseOrderId: "po-9", supplierId: "sup-9", supplierName: "OPEN CO",
    items: [{ materialCode: "FOAM-9", materialName: "FOAM-9 - Foam block", qty, unitPriceSen: 10000, poId: "po-9", poItemId }],
  });
  // Billed against ONE of the two lines, it still draws on the shared 10.
  assert.equal((await bill(10, "poi-9")).status, 200, "both lines' 10 are billable");
  const over = await bill(1, "poi-9b");
  assert.equal(over.status, 409, "but not an 11th");
  assert.match((await over.json()).error, /FOAM-9/);
});

test("T-006 R8: re-lining keeps the PO line and cannot walk a blank-code line past the PO", async () => {
  const db = makeDb();
  seedBlankCodePo(db);
  const piRoot = mount(piApp, db);
  assert.equal((await post(piRoot, {
    ...blankHeader, purchaseOrderId: "po-4",
    items: [blankLine(8, { poId: "po-4", poItemId: "poi-4" })],
  })).status, 200);
  const small = (await (await post(piRoot, {
    ...blankHeader, purchaseOrderId: "po-4",
    items: [blankLine(1, { poId: "po-4", poItemId: "poi-4" })],
  })).json()).data;
  // The editor sends the stored poId back but (an older client) no poItemId:
  // the line inherits it from the stored line.
  const reline = (qty) => piRoot.request(`/${small.id}`, json("PUT", {
    items: [{ ...blankLine(qty, { poId: "po-4" }), id: db.tables.purchase_invoice_items.find((l) => l.pi_id === small.id).id }],
  }));
  const over = await reline(5);
  assert.equal(over.status, 409);
  assert.match((await over.json()).error, /remaining 2/);
  assert.equal((await reline(2)).status, 200);
  assert.equal(db.tables.purchase_invoice_items.find((l) => l.pi_id === small.id).po_item_id, "poi-4");
});

test("T-006 R9: a line's own poId is capped even when the header names no PO and no GRN", async () => {
  const db = makeDb();
  seedOpenPo(db); // poi-9: FOAM-9, 5 ordered
  const piRoot = mount(piApp, db);
  const res = await post(piRoot, {
    supplierId: "sup-9", supplierName: "OPEN CO",
    items: [{ materialCode: "FOAM-9", materialName: "FOAM-9 - Foam block", qty: 6, unitPriceSen: 10000, poId: "po-9" }],
  });
  assert.equal(res.status, 409, "before R9 this skipped the ceiling entirely");
  assert.match((await res.json()).error, /requested 6 exceeds PO PO-9 remaining 5/);
  assert.equal(db.tables.purchase_invoices.length, 0);
});

// R5: `beforeBatch` commits a rival invoice's consumption between the route's
// availability check and its own write — the window the CHECK exists for.
const rivalTakes = (grnItemId, qty) => (tables) => {
  const gi = tables.grn_items.find((g) => String(g.id) === String(grnItemId));
  gi.invoiced_qty = (Number(gi.invoiced_qty) || 0) + qty;
};

test("T-006 R5: a create that loses the race for a GRN line gets a 409 and writes nothing", async () => {
  const db = makeDb();
  seedPoAndReceipt(db); // grn line 201: accepted 100
  const piRoot = mount(piApp, db);
  db.beforeBatch = rivalTakes(201, 50);
  const res = await post(piRoot, grnSourcedPI(60, { purchaseOrderId: "po-2" }));
  assert.equal(res.status, 409, await res.clone().text());
  assert.match((await res.json()).error, /just billed by another invoice/);
  assert.equal(db.tables.purchase_invoices.length, 0, "the transaction rolled back");
  assert.equal(Number(db.tables.grn_items.find((g) => g.id === 201).invoiced_qty), 50);
});

test("T-006 R5: a re-line that loses the race gets a 409", async () => {
  const db = makeDb();
  seedPoAndReceipt(db);
  const piRoot = mount(piApp, db);
  const pi = (await (await post(piRoot, grnSourcedPI(10, { purchaseOrderId: "po-2" }))).json()).data;
  db.beforeBatch = rivalTakes(201, 80); // 10 ours + 80 theirs; we ask for 30
  const res = await piRoot.request(`/${pi.id}`, json("PUT", {
    items: [{ materialCode: "WOOD-2", materialName: "WOOD-2 - Pine plank", qty: 30, unitPriceSen: 10000, grnItemId: 201, poId: "po-2" }],
  }));
  assert.equal(res.status, 409, await res.clone().text());
  assert.match((await res.json()).error, /just billed by another invoice/);
});

test("T-006 R5: an unvoid that loses the race gets a 409, not a 500", async () => {
  const db = makeDb();
  seedPoAndReceipt(db);
  const piRoot = mount(piApp, db);
  const pi = (await (await post(piRoot, grnSourcedPI(40, { purchaseOrderId: "po-2" }))).json()).data;
  assert.equal((await piRoot.request(`/${pi.id}`, json("PUT", { status: "CONFIRMED" }))).status, 200);
  assert.equal((await piRoot.request(`/${pi.id}/void`, json("POST", {}))).status, 200);
  db.beforeBatch = rivalTakes(201, 70); // 70 of 100 gone; re-taking our 40 overshoots
  const res = await piRoot.request(`/${pi.id}/unvoid`, json("POST", {}));
  assert.equal(res.status, 409, await res.clone().text());
  assert.match((await res.json()).error, /just billed by another invoice/);
  assert.equal(db.tables.purchase_invoices.find((p) => p.id === pi.id).status, "CANCELLED");
});
