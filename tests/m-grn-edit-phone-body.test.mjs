// ---------------------------------------------------------------------------
// m-grn-edit-phone-body.test.mjs — a draft goods receipt edited from the phone ("Edit Quantities") against main's REAL PUT /api/grn/:id.
//
// main's draft-GRN PUT deletes every line and inserts the request's lines, so each save gives the lines NEW ids; it hands a line the
// request leaves without a poItemId its OLD line's po_id / po_item_id, matched by the line `id` (HK-0107). The phone sends each line's
// `id` and no PO fields (grn-mobile.ts grnQtyBody), then reloads. This runs the real phone body builder into the real handler:
//   · the PO and PO line of every line survive an edit, in any line order, and a second edit built from the reloaded receipt works;
//   · a body built from the receipt BEFORE the first save (stale ids) is refused with 409 and writes nothing — why the phone reloads.
// An in-memory stand-in for the database; it proves the handler's logic, not that Postgres accepts the SQL.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";
import { grnQtyBody } from "../src/pages/m/lib/grn-mobile.ts";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
const grnApp = (await import(pathToFileURL(resolve(process.cwd(), "src/api/routes/grn.ts")).href)).default;

function makeDb() {
  const t = { grns: [], grn_items: [] };
  let autoId = 100;
  const col = (r, c) => r[c] ?? r[c.replace(/[A-Z]/g, (x) => "_" + x.toLowerCase())];
  function exec(sql, b) {
    let m = sql.match(/^INSERT INTO grn_items \(([^)]+)\)/i);
    if (m) {
      const row = {};
      m[1].split(",").forEach((c, i) => (row[c.trim()] = b[i]));
      if (row.id == null) row.id = autoId++;
      t.grn_items.push(row);
      return;
    }
    m = sql.match(/^DELETE FROM grn_items WHERE (\w+) = \?/i);
    if (m) t.grn_items = t.grn_items.filter((r) => String(col(r, m[1])) !== String(b[0]));
  }
  function query(sql, b) {
    if (/FROM grns WHERE id = \?/i.test(sql)) return t.grns.filter((r) => r.id === b[0]);
    if (/FROM grn_items WHERE grnId = \?/i.test(sql)) return t.grn_items.filter((r) => r.grnId === b[0]);
    if (/FROM grn_items WHERE id = \?/i.test(sql)) return t.grn_items.filter((r) => String(r.id) === String(b[0]));
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

function mount(db) {
  const root = new Hono();
  root.use("*", async (c, next) => {
    c.set("DB", db); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "u1"); c.set("orgId", "org-test");
    await next();
  });
  root.route("/", grnApp);
  return root;
}
const put = (root, body) => root.request("/grn-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** What the phone holds after GET /api/grn/:id: camelCase lines with their ids and PO links. */
const asGet = (db) => ({
  id: "grn-1", status: "DRAFT",
  items: db.t.grn_items.map((l) => ({
    id: l.id, poItemIndex: l.poItemIndex, poId: l.po_id, poItemId: l.po_item_id, materialCode: l.materialCode, materialName: l.materialName,
    orderedQty: l.orderedQty, receivedQty: l.receivedQty, acceptedQty: l.acceptedQty, rejectedQty: l.rejectedQty, rejectionReason: l.rejectionReason,
    unitPrice: l.unitPrice, invoicedQty: 0,
  })),
});
const seed = () => {
  const db = makeDb();
  db.t.grns.push({ id: "grn-1", grnNumber: "GRN-1", poId: "po-1", status: "DRAFT", qcStatus: "PENDING", totalAmount: 0, notes: "" });
  const line = (id, idx, po, poi, code) => ({ id, grnId: "grn-1", poItemIndex: idx, po_id: po, po_item_id: poi, materialCode: code, materialName: code, orderedQty: 10, receivedQty: 6, acceptedQty: 6, rejectedQty: 0, rejectionReason: null, unitPrice: 100 });
  db.t.grn_items.push(line(1, 0, "po-1", "poi-1a", "A"), line(2, 1, "po-2", "poi-2a", "B"));
  return db;
};
const links = (db) => db.t.grn_items.map((l) => [l.materialCode, l.po_id, l.po_item_id, Number(l.acceptedQty)]);

test("a phone quantity edit keeps every line's PO and PO line; a second edit from the reloaded receipt works", async () => {
  const db = seed();
  const root = mount(db);
  const before = asGet(db);
  let res = await put(root, grnQtyBody(before, ["5", "6"]));
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(links(db), [["A", "po-1", "poi-1a", 5], ["B", "po-2", "poi-2a", 6]]);
  assert.ok(db.t.grn_items.every((l) => ![1, 2].includes(l.id)), "the lines have NEW ids after a save");
  // the phone reloads (new ids), then edits again
  res = await put(root, grnQtyBody(asGet(db), ["5", "4"]));
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(links(db), [["A", "po-1", "poi-1a", 5], ["B", "po-2", "poi-2a", 4]]);
});

test("a body built from the receipt before the first save (stale ids) is refused with 409 and writes nothing", async () => {
  const db = seed();
  const root = mount(db);
  const stale = asGet(db);
  assert.equal((await put(root, grnQtyBody(stale, ["5", "6"]))).status, 200);
  const snapshot = JSON.stringify(db.t.grn_items);
  const res = await put(root, grnQtyBody(stale, ["1", "1"]));
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(JSON.stringify(db.t.grn_items), snapshot, "nothing was written");
});
