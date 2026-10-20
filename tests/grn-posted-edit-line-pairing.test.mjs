// ---------------------------------------------------------------------------
// grn-posted-edit-line-pairing.test.mjs — HK-0108 / BUG-2026-10-20-347.
//
// Editing a POSTED GRN read the stored lines ORDER BY id but paired them with
// the body lines by position, while GET returns lines sorted by poItemIndex.
// On a multi-PO receipt (ids and poItemIndex in different orders) correcting
// one line's accepted qty landed on another line. Now paired by line id, else
// by position in GET order — same as the draft path since HK-0107.
// Driven through the real Hono handler against a small stateful mock D1.
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

const grnApp = (await import(pathToFileURL(resolve(process.cwd(), "src/api/routes/grn.ts")).href)).default;

function makeDb() {
  const t = { grns: [], grn_items: [] };
  function exec(sql, b) {
    const m = sql.match(/^UPDATE grn_items SET acceptedQty = \?, receivedQty = \? WHERE id = \?/i);
    if (m) {
      const row = t.grn_items.find((r) => String(r.id) === String(b[2]));
      if (row) Object.assign(row, { acceptedQty: b[0], receivedQty: b[1] });
    }
  }
  function query(sql, b) {
    if (/FROM grns WHERE id = \?/i.test(sql)) return t.grns.filter((r) => r.id === b[0]);
    if (/FROM grn_items WHERE grnId = \?/i.test(sql)) return t.grn_items.filter((r) => r.grnId === b[0]);
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
    c.set("DB", db);
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "u1");
    c.set("orgId", "org-test");
    await next();
  });
  root.route("/", grnApp);
  return root;
}

const put = (root, body) =>
  root.request("/grn-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function seed() {
  const db = makeDb();
  db.t.grns.push({ id: "grn-1", grnNumber: "GRN-1", poId: "po-1", status: "POSTED", qcStatus: "PASSED", totalAmount: 1000, notes: "" });
  const line = (id, poItemIndex, code) => ({
    id, grnId: "grn-1", poItemIndex, materialCode: code, materialName: code,
    orderedQty: 10, receivedQty: 5, acceptedQty: 5, rejectedQty: 0,
    rejectionReason: null, unitPrice: 100, invoiced_qty: 0,
  });
  // id order A, B — GET (poItemIndex) order B, A.
  db.t.grn_items.push(line(1, 1, "A"), line(2, 0, "B"));
  return db;
}

const qtys = (db) => db.t.grn_items.map((l) => [l.materialCode, l.acceptedQty]);

test("POSTED GRN edit applies the qty to the line with that id", async () => {
  const db = seed();
  const root = mount(db);
  // Body in GET order (B, A); only B changes.
  const res = await put(root, {
    items: [
      { id: 2, materialCode: "B", acceptedQty: 3 },
      { id: 1, materialCode: "A", acceptedQty: 5 },
    ],
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(qtys(db), [["A", 5], ["B", 3]]);
});

test("POSTED GRN edit without line ids pairs by GET order", async () => {
  const db = seed();
  const root = mount(db);
  const res = await put(root, {
    items: [
      { materialCode: "B", acceptedQty: 3 },
      { materialCode: "A", acceptedQty: 5 },
    ],
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(qtys(db), [["A", 5], ["B", 3]]);
});
