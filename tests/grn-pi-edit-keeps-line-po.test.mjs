// ---------------------------------------------------------------------------
// grn-pi-edit-keeps-line-po.test.mjs — HK-0107 / BUG-2026-10-19-340.
//
// A GRN or a PI may carry lines from several POs; each line records its own
// po_id (+ po_item_id on GRN lines). Editing used to drop that link:
//   • GRN PUT (DRAFT) did DELETE + INSERT grn_items without po_id/po_item_id,
//     so every line fell back to the header PO + positional poItemIndex.
//   • PI PUT wrote line po_id = body poId ?? header PO, and the editor never
//     sent poId — every line collapsed onto the header PO.
// Both are driven through the real Hono handlers against a small stateful mock
// D1. Without the fix the PO-2 line comes back as null / PO-1.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}

const load = async (p) =>
  (await import(pathToFileURL(resolve(process.cwd(), p)).href)).default;
const grnApp = await load("src/api/routes/grn.ts");
const piApp = await load("src/api/routes/purchase-invoices.ts");

function makeDb() {
  const t = { grns: [], grn_items: [], purchase_invoices: [], purchase_invoice_items: [] };
  let autoId = 100;
  const col = (r, c) => r[c] ?? r[c.replace(/[A-Z]/g, (x) => "_" + x.toLowerCase())];
  function exec(sql, b) {
    let m = sql.match(/^INSERT INTO (grn_items|purchase_invoice_items) \(([^)]+)\)/i);
    if (m) {
      const row = {};
      m[2].split(",").forEach((c, i) => (row[c.trim()] = b[i]));
      if (row.id == null) row.id = autoId++;
      t[m[1]].push(row);
      return;
    }
    m = sql.match(/^DELETE FROM (grn_items|purchase_invoice_items) WHERE (\w+) = \?/i);
    if (m) t[m[1]] = t[m[1]].filter((r) => String(col(r, m[2])) !== String(b[0]));
  }
  function query(sql, b) {
    if (/FROM grns WHERE id = \?/i.test(sql)) return t.grns.filter((r) => r.id === b[0]);
    if (/FROM grn_items WHERE grnId = \?/i.test(sql)) return t.grn_items.filter((r) => r.grnId === b[0]);
    if (/FROM grn_items WHERE id = \?/i.test(sql)) return t.grn_items.filter((r) => String(r.id) === String(b[0]));
    if (/FROM purchase_invoices WHERE id = \?/i.test(sql)) return t.purchase_invoices.filter((r) => r.id === b[0]);
    if (/FROM purchase_invoice_items WHERE pi_id = \?/i.test(sql)) {
      return t.purchase_invoice_items.filter((r) => r.pi_id === b[0]);
    }
    return [];
  }
  function prepare(raw) {
    const sql = raw.trim().replace(/\s+/g, " ");
    let b = [];
    const s = {
      bind: (...a) => ((b = a), s),
      run: async () => (exec(sql, b), { success: true, meta: { changes: 1 } }),
      first: async () => query(sql, b)[0] ?? null,
      all: async () => ({ results: query(sql, b) }),
    };
    return s;
  }
  return { t, prepare, batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) };
}

function mount(app, db) {
  const root = new Hono();
  root.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "u1");
    c.set("orgId", "org-test");
    await next();
  });
  root.route("/", app);
  return root;
}

const put = (root, path, body) =>
  root.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("GRN PUT (DRAFT) keeps each line's own PO link", async () => {
  const db = makeDb();
  db.t.grns.push({ id: "grn-1", grnNumber: "GRN-1", poId: "po-1", status: "DRAFT", qcStatus: "PENDING", totalAmount: 0, notes: "" });
  const line = (id, poItemIndex, po, poi, code) => ({
    id, grnId: "grn-1", poItemIndex, po_id: po, po_item_id: poi, materialCode: code,
    materialName: code, orderedQty: 10, receivedQty: 5, acceptedQty: 5, rejectedQty: 0,
    rejectionReason: null, unitPrice: 100,
  });
  db.t.grn_items.push(line(1, 0, "po-1", "poi-1a", "A"), line(2, 0, "po-2", "poi-2a", "B"));
  const root = mount(grnApp, db);

  // Old-shape client: no id / poId / poItemId — position match (GET order).
  const items = db.t.grn_items.map((l) => ({ ...l, id: undefined, po_id: undefined, po_item_id: undefined, acceptedQty: 4 }));
  let res = await put(root, "/grn-1", { items });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(
    db.t.grn_items.map((l) => [l.materialCode, l.po_id, l.po_item_id]),
    [["A", "po-1", "poi-1a"], ["B", "po-2", "poi-2a"]],
  );

  // New client sends line ids — matched by id even when the order changes.
  const byId = [...db.t.grn_items].reverse().map((l) => ({ id: l.id, materialCode: l.materialCode, materialName: l.materialName, acceptedQty: 3 }));
  res = await put(root, "/grn-1", { items: byId });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(
    db.t.grn_items.map((l) => [l.materialCode, l.po_id, l.po_item_id]),
    [["B", "po-2", "poi-2a"], ["A", "po-1", "poi-1a"]],
  );
});

test("GRN PUT (DRAFT): a sent line id that is no longer stored is a 409, a blank id is 'missing'", async () => {
  const db = makeDb();
  db.t.grns.push({ id: "grn-1", grnNumber: "GRN-1", poId: "po-1", status: "DRAFT", qcStatus: "PENDING", totalAmount: 0, notes: "" });
  db.t.grn_items.push({
    id: 7, grnId: "grn-1", poItemIndex: 0, po_id: "po-2", po_item_id: "poi-2a", materialCode: "A",
    materialName: "A", orderedQty: 10, receivedQty: 5, acceptedQty: 5, rejectedQty: 0, rejectionReason: null, unitPrice: 100,
  });
  const root = mount(grnApp, db);
  // Another user's save replaced the lines: id 3 is gone.
  let res = await put(root, "/grn-1", { items: [{ id: 3, materialCode: "A", materialName: "A", acceptedQty: 4 }] });
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(db.t.grn_items[0].po_id, "po-2");
  // Blank id = no id: position match while the count is unchanged.
  res = await put(root, "/grn-1", { items: [{ id: "", materialCode: "A", materialName: "A", acceptedQty: 4 }] });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(db.t.grn_items[0].po_id, "po-2");
});

test("GRN PUT (DRAFT): no ids and a changed line count does not match PO links by position", async () => {
  const db = makeDb();
  db.t.grns.push({ id: "grn-1", grnNumber: "GRN-1", poId: "po-1", status: "DRAFT", qcStatus: "PENDING", totalAmount: 0, notes: "" });
  db.t.grn_items.push({
    id: 7, grnId: "grn-1", poItemIndex: 0, po_id: "po-2", po_item_id: "poi-2a", materialCode: "A",
    materialName: "A", orderedQty: 10, receivedQty: 5, acceptedQty: 5, rejectedQty: 0, rejectionReason: null, unitPrice: 100,
  });
  const root = mount(grnApp, db);
  // A new line is inserted first: new line 0 is not old line 0.
  const res = await put(root, "/grn-1", {
    items: [
      { materialCode: "N", materialName: "N", acceptedQty: 1 },
      { materialCode: "A", materialName: "A", acceptedQty: 5 },
    ],
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.notEqual(db.t.grn_items.find((l) => l.materialCode === "N")?.po_id, "po-2");
});

test("PI PUT keeps each line's own PO when the body omits poId", async () => {
  const db = makeDb();
  db.t.purchase_invoices.push({ id: "pi-1", piNo: "PI-1", purchaseOrderId: "po-1", status: "DRAFT", currency: "MYR", amountSen: 0 });
  db.t.grn_items.push({ id: 7, grnId: "grn-x", acceptedQty: 100, invoiced_qty: 1 });
  const line = (id, po, grnItemId, code) => ({
    id, pi_id: "pi-1", material_code: code, material_name: code, qty: 1,
    unit_price_sen: 100, line_total_sen: 100, line_type: "STOCKED", grn_item_id: grnItemId, po_id: po,
  });
  db.t.purchase_invoice_items.push(line("pii-a", "po-1", null, "A"), line("pii-b", "po-2", "7", "B"));
  const root = mount(piApp, db);

  // Line A matched by id, line B by grn_item_id; neither sends poId.
  const res = await put(root, "/pi-1", {
    items: [
      { id: "pii-a", materialCode: "A", materialName: "A", qty: 2, unitPriceSen: 100 },
      { materialCode: "B", materialName: "B", qty: 2, unitPriceSen: 100, grnItemId: "7" },
    ],
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(
    db.t.purchase_invoice_items.map((l) => [l.material_code, l.po_id]),
    [["A", "po-1"], ["B", "po-2"]],
  );

  // GET returns the line's poId so the editor can send it back.
  const got = await (await root.request("/pi-1")).json();
  assert.deepEqual(got.data.items.map((i) => i.poId), ["po-1", "po-2"]);
});
