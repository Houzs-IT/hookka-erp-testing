// ---------------------------------------------------------------------------
// grn-draft-line-edit.test.mjs — editing the lines of a DRAFT goods receipt keeps each line's purchase-order link.
//
// The bug (measured in src/api/routes/grn.ts, PUT /:id, 2026-11-04): the DRAFT branch deleted every grn_items row and
// re-inserted only the columns the desktop form knew, so po_id / po_item_id (which PO line a line draws down — the
// multi-PO model) were erased by any quantity edit, the GET never returned them, and lines were paired with stored
// rows by POSITION (the GET sorts by poItemIndex, the PUT read by id). Now a line is identified by its row id, a kept
// line is UPDATED in place, a removed line is deleted, a new line is inserted, and a client cannot change a stored
// line's PO link through an edit.
//
// Two layers:
//   1. the pure matching rules (src/api/lib/grn-line-edit.ts);
//   2. the REAL route handler (src/api/routes/grn.ts, mounted in a Hono app) over a small in-memory stand-in for the
//      database that understands just the statements this path issues. That proves the handler's logic and the
//      parameters it binds. It does NOT prove Postgres accepts the SQL — nothing here touches a real database.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { alignCommittedLines, planGrnDraftLines, validateClaimedLinks } from "../src/api/lib/grn-line-edit.ts";
import grnApp from "../src/api/routes/grn.ts";

// ---- 1. pure rules -------------------------------------------------------------------------------------------------
const STORED = [
  { id: 1, poItemIndex: 0, materialCode: "A", po_id: "po-1", po_item_id: "poi-1" },
  { id: 2, poItemIndex: 0, materialCode: "B", po_id: "po-2", po_item_id: "poi-2" },
  { id: 3, poItemIndex: 1, materialCode: "C", po_id: "po-1", po_item_id: "poi-3" },
];

test("lines are matched by id, in the order the client sent them; links come from the STORED row", () => {
  const p = planGrnDraftLines(STORED, [{ id: 3, acceptedQty: 1 }, { id: 1, acceptedQty: 2 }, { id: 2, acceptedQty: 3 }]);
  assert.equal(p.ok, true);
  assert.deepEqual(p.lines.map((l) => [l.id, l.poId, l.poItemId]), [["3", "po-1", "poi-3"], ["1", "po-1", "poi-1"], ["2", "po-2", "poi-2"]]);
  assert.deepEqual(p.removeIds, []);
});

test("a line the client no longer sends is removed; a line without an id is NEW", () => {
  const p = planGrnDraftLines(STORED, [{ id: 1 }, { id: 3 }, { materialCode: "Z", poItemIndex: 9 }]);
  assert.equal(p.ok, true);
  assert.deepEqual(p.removeIds, ["2"]);
  assert.deepEqual(p.lines.map((l) => l.id), ["1", "3", null]);
});

test("an unknown id, a repeated id, or a changed PO link is refused (and a null / blank echo is not a change)", () => {
  assert.equal(planGrnDraftLines(STORED, [{ id: 99 }]).ok, false);
  assert.equal(planGrnDraftLines(STORED, [{ id: 1 }, { id: 1 }]).ok, false);
  const moved = planGrnDraftLines(STORED, [{ id: 1, poId: "po-2" }]);
  assert.equal(moved.ok, false);
  assert.equal(moved.status, 409);
  assert.equal(planGrnDraftLines(STORED, [{ id: 1, poId: "po-1", poItemId: "poi-1" }]).ok, true, "echoing the stored link is fine");
  assert.equal(planGrnDraftLines(STORED, [{ id: 1, poId: null, poItemId: "" }]).ok, true);
});

test("a client with no ids is matched on (material code, poItemIndex) when unique — never by position; ambiguous = new", () => {
  const reordered = planGrnDraftLines(STORED, [{ materialCode: "C", poItemIndex: 1 }, { materialCode: "A", poItemIndex: 0 }]);
  assert.equal(reordered.ok, true);
  assert.deepEqual(reordered.lines.map((l) => [l.id, l.poItemId]), [["3", "poi-3"], ["1", "poi-1"]]);
  assert.deepEqual(reordered.removeIds, ["2"]);
  const twin = [{ id: 1, materialCode: "A", poItemIndex: 0, po_item_id: "x" }, { id: 2, materialCode: "A", poItemIndex: 0, po_item_id: "y" }];
  const amb = planGrnDraftLines(twin, [{ materialCode: "A", poItemIndex: 0 }]);
  assert.deepEqual(amb.lines.map((l) => l.id), [null], "two stored lines look alike: do not guess");
});

test("claimed links on a NEW line: must be a real PO of this supplier and a line of that PO", () => {
  const pos = new Map([["po-1", { id: "po-1", supplierId: "s1" }], ["po-x", { id: "po-x", supplierId: "s2" }]]);
  const items = new Map([["poi-9", { id: "poi-9", purchaseOrderId: "po-1" }], ["poi-x", { id: "poi-x", purchaseOrderId: "po-x" }]]);
  const ok = validateClaimedLinks({ poId: null, poItemId: "poi-9" }, "s1", pos, items);
  assert.deepEqual([ok.ok, ok.poId, ok.poItemId], [true, "po-1", "poi-9"], "the PO is derived from the line");
  assert.equal(validateClaimedLinks({ poId: "po-x", poItemId: null }, "s1", pos, items).ok, false, "another supplier's order");
  assert.equal(validateClaimedLinks({ poId: "po-1", poItemId: "poi-x" }, "s1", pos, items).ok, false, "a line of a different order");
  assert.equal(validateClaimedLinks({ poId: null, poItemId: "nope" }, "s1", pos, items).status, 404);
  assert.equal(validateClaimedLinks({ poId: "nope", poItemId: null }, "s1", pos, items).status, 404);
  assert.deepEqual(validateClaimedLinks({ poId: null, poItemId: null }, "s1", pos, items), { ok: true, poId: null, poItemId: null });
});

test("a received receipt pairs by id when every line carries one (reordering is harmless), by position only when none does", () => {
  const stored = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const byId = alignCommittedLines(stored, [{ id: 3, acceptedQty: 30 }, { id: 1, acceptedQty: 10 }, { id: 2, acceptedQty: 20 }]);
  assert.deepEqual(byId.items.map((l) => l.acceptedQty), [10, 20, 30]);
  assert.equal(alignCommittedLines(stored, [{ acceptedQty: 1 }, { acceptedQty: 2 }, { acceptedQty: 3 }]).ok, true, "legacy positional");
  assert.equal(alignCommittedLines(stored, [{ id: 1 }, { acceptedQty: 2 }, { acceptedQty: 3 }]).ok, false, "mixed");
  assert.equal(alignCommittedLines(stored, [{ id: 1 }, { id: 2 }]).ok, false, "a line may not be dropped");
  assert.equal(alignCommittedLines(stored, [{ id: 1 }, { id: 2 }, { id: 9 }]).ok, false, "an unknown id");
});

// ---- 2. the real handler over an in-memory stand-in ------------------------------------------------------------------
class FakeDb {
  constructor(seed) { this.t = JSON.parse(JSON.stringify(seed)); this.seq = 100; this.unknown = []; }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) {
    const snap = JSON.stringify(this.t);
    try { const out = []; for (const s of stmts) out.push(await s.run()); return out; } catch (e) { this.t = JSON.parse(snap); throw e; }
  }
}
const lc = (s) => String(s).toLowerCase();
const col = (row, name) => { const k = Object.keys(row).find((x) => lc(x) === lc(name)); return k === undefined ? undefined : row[k]; };
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.p = []; }
  bind(...p) { this.p = p; return this; }
  _where(clause, params) {
    const conds = [];
    let i = 0;
    for (const part of clause.split(/ and /i)) {
      let m = /^(\w+) = \?$/i.exec(part.trim());
      if (m) { conds.push([m[1], [params[i++]]]); continue; }
      m = /^(\w+) in \(([?, ]+)\)$/i.exec(part.trim());
      if (m) { const n = m[2].split(",").length; conds.push([m[1], params.slice(i, i + n)]); i += n; continue; }
      return null;
    }
    return (row) => conds.every(([c, vals]) => vals.map(String).includes(String(col(row, c))));
  }
  _exec() {
    const t = this.db.t; const sql = this.sql;
    let m;
    if (/^(alter|create|drop|comment) /i.test(sql) || /^update grns set purchase_org_code = 'HOOKKA' where purchase_org_code is null/i.test(sql)) return { rows: [], changes: 0 };
    if ((m = /^select (.+?) from (\w+)(?: (?:\w+))?(?: where (.+?))?(?: order by \w+ (?:asc|desc))?(?: limit \d+)?$/i.exec(sql)) && t[lc(m[2])]) {
      const match = m[3] ? this._where(m[3], this.p) : () => true;
      if (!match) { this.db.unknown.push(sql); return { rows: [], changes: 0 }; }
      return { rows: t[lc(m[2])].filter(match).map((r) => ({ ...r })), changes: 0 };
    }
    if ((m = /^insert into (\w+) \((.+?)\) values/i.exec(sql))) {
      const cols = m[1] && m[2].split(",").map((s) => s.trim());
      const row = {}; cols.forEach((c, i) => { row[c] = this.p[i]; });
      if (lc(m[1]) === "grn_items") row.id = ++this.db.seq;
      (t[lc(m[1])] ??= []).push(row);
      return { rows: [], changes: 1 };
    }
    if ((m = /^update (\w+) set (.+?) where (.+)$/i.exec(sql)) && t[lc(m[1])]) {
      const setCols = m[2].split(",").map((s) => /^(\w+) = \?$/i.exec(s.trim())?.[1]);
      if (setCols.some((c) => !c)) { this.db.unknown.push(sql); return { rows: [], changes: 0 }; }
      const where = this._where(m[3], this.p.slice(setCols.length));
      let n = 0;
      for (const r of t[lc(m[1])]) if (where(r)) { setCols.forEach((c, i) => { const k = Object.keys(r).find((x) => lc(x) === lc(c)) ?? c; r[k] = this.p[i]; }); n++; }
      return { rows: [], changes: n };
    }
    if ((m = /^delete from (\w+) where (.+)$/i.exec(sql)) && t[lc(m[1])]) {
      const where = this._where(m[2], this.p);
      const before = t[lc(m[1])].length;
      t[lc(m[1])] = t[lc(m[1])].filter((r) => !where(r));
      return { rows: [], changes: before - t[lc(m[1])].length };
    }
    this.db.unknown.push(sql);
    return { rows: [], changes: 0 };
  }
  async first() { return this._exec().rows[0] ?? null; }
  async all() { return { results: this._exec().rows }; }
  async run() { const r = this._exec(); return { success: true, meta: { changes: r.changes } }; }
}

const SEED = {
  grns: [{ id: "grn-1", grnNumber: "GRN-1", poId: "po-1", poNumber: "PO-1", supplierId: "s1", supplierName: "S1", status: "DRAFT", arrival_state: "ARRIVED", qcStatus: "PENDING", totalAmount: 0, notes: "", receivedBy: "x", supplier_do_no: "DO-1", purchase_org_code: "HOOKKA" }],
  grn_items: [
    { id: 1, grnId: "grn-1", poItemIndex: 0, materialCode: "A", materialName: "Alpha", orderedQty: 10, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, unitPrice: 100, invoiced_qty: 0, po_id: "po-1", po_item_id: "poi-1" },
    { id: 2, grnId: "grn-1", poItemIndex: 0, materialCode: "B", materialName: "Bravo", orderedQty: 5, receivedQty: 5, acceptedQty: 5, rejectedQty: 0, unitPrice: 200, invoiced_qty: 0, po_id: "po-2", po_item_id: "poi-2" },
    { id: 3, grnId: "grn-1", poItemIndex: 1, materialCode: "C", materialName: "Charlie", orderedQty: 8, receivedQty: 8, acceptedQty: 8, rejectedQty: 0, unitPrice: 300, invoiced_qty: 0, po_id: "po-1", po_item_id: "poi-3" },
  ],
  purchase_orders: [{ id: "po-1", supplierId: "s1" }, { id: "po-2", supplierId: "s1" }, { id: "po-x", supplierId: "s2" }],
  purchase_order_items: [{ id: "poi-1", purchaseOrderId: "po-1" }, { id: "poi-2", purchaseOrderId: "po-2" }, { id: "poi-3", purchaseOrderId: "po-1" }, { id: "poi-4", purchaseOrderId: "po-2" }, { id: "poi-x", purchaseOrderId: "po-x" }],
};

function harness() {
  const db = new FakeDb(SEED);
  const root = new Hono();
  root.use("*", async (c, next) => { c.set("DB", db); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "u1"); await next(); });
  root.route("/", grnApp);
  const put = async (items, extra = {}) => {
    const res = await root.request("/grn-1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ items, ...extra }) });
    return { status: res.status, json: await res.json() };
  };
  const get = async () => (await (await root.request("/grn-1")).json()).data;
  const stored = () => db.t.grn_items.map((r) => ({ id: r.id, code: r.materialCode, acc: r.acceptedQty, po: r.po_id, poi: r.po_item_id, idx: r.poItemIndex })).sort((a, b) => a.id - b.id);
  return { db, put, get, stored };
}
const line = (id, over = {}) => ({ id, poItemIndex: 0, materialCode: "", materialName: "n", orderedQty: 10, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, rejectionReason: null, unitPrice: 100, ...over });

test("GET returns each line's id and its PO + PO-line links", async () => {
  const h = harness();
  const g = await h.get();
  assert.deepEqual(g.items.map((i) => [i.id, i.poId, i.poItemId]).sort((a, b) => a[0] - b[0]), [[1, "po-1", "poi-1"], [2, "po-2", "poi-2"], [3, "po-1", "poi-3"]]);
});

test("multi-PO draft: edit quantities, REORDERED → save → reopen: same ids, same links, each quantity on the right line", async () => {
  const h = harness();
  const before = await h.get();
  // the client sends the lines in a different order than stored, with the stored ids
  const r = await h.put([line(3, { materialCode: "C", poItemIndex: 1, acceptedQty: 7, receivedQty: 8, rejectedQty: 1 }), line(1, { materialCode: "A", acceptedQty: 9, receivedQty: 10, rejectedQty: 1 }), line(2, { materialCode: "B", acceptedQty: 5, receivedQty: 5 })]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(h.stored(), [
    { id: 1, code: "A", acc: 9, po: "po-1", poi: "poi-1", idx: 0 },
    { id: 2, code: "B", acc: 5, po: "po-2", poi: "poi-2", idx: 0 },
    { id: 3, code: "C", acc: 7, po: "po-1", poi: "poi-3", idx: 1 },
  ]);
  const after = await h.get();
  assert.deepEqual(after.items.map((i) => [i.id, i.poId, i.poItemId]), before.items.map((i) => [i.id, i.poId, i.poItemId]), "reopened: nothing about the links changed");
  assert.equal(after.poId, "po-1", "the header PO is untouched");
  assert.deepEqual(h.db.unknown.filter((q) => /^(insert|update|delete)/i.test(q) && /grn_items/.test(q)), [], "every write to grn_items was understood by the stand-in (the other unmatched statements are read-only lookups or schema maintenance, answered empty)");
});

test("removing a line deletes only that line; the others keep their ids and links", async () => {
  const h = harness();
  const r = await h.put([line(3, { materialCode: "C", poItemIndex: 1 }), line(1, { materialCode: "A" })]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(h.stored().map((s) => [s.id, s.po, s.poi]), [[1, "po-1", "poi-1"], [3, "po-1", "poi-3"]]);
});

test("a NEW line may link to a PO line of the same supplier; the links are stored and returned", async () => {
  const h = harness();
  const r = await h.put([line(1), line(2), line(3), { ...line(null), id: undefined, materialCode: "D", poId: "po-2", poItemId: "poi-4", poItemIndex: 1 }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const added = h.stored().find((s) => s.code === "D");
  assert.deepEqual([added.po, added.poi, added.idx], ["po-2", "poi-4", 1]);
  assert.deepEqual(h.stored().slice(0, 3).map((s) => s.poi), ["poi-1", "poi-2", "poi-3"]);
});

test("links that belong to the wrong record are refused and NOTHING is written", async () => {
  const cases = [
    [{ id: undefined, materialCode: "D", poId: "po-x", poItemId: "poi-x" }, 400],   // another supplier's order
    [{ id: undefined, materialCode: "D", poId: "po-1", poItemId: "poi-4" }, 400],   // a line of a different order
    [{ id: undefined, materialCode: "D", poItemId: "nope" }, 404],
    [{ id: undefined, materialCode: "D", poId: "nope" }, 404],
  ];
  for (const [extra, status] of cases) {
    const h = harness();
    const r = await h.put([line(1, { acceptedQty: 1 }), line(2), line(3), { ...line(null), ...extra }]);
    assert.equal(r.status, status, JSON.stringify(extra));
    assert.deepEqual(h.stored().map((s) => s.acc), [10, 5, 8], "the quantity edit in the same request did not land either");
  }
});

test("a kept line's PO link cannot be changed by an edit; an unknown or repeated line id is refused", async () => {
  const h = harness();
  assert.equal((await h.put([line(1, { poId: "po-2" })])).status, 409);
  assert.equal((await h.put([line(99)])).status, 400);
  assert.equal((await h.put([line(1), line(1)])).status, 400);
  assert.deepEqual(h.stored().map((s) => [s.po, s.poi]), [["po-1", "poi-1"], ["po-2", "poi-2"], ["po-1", "poi-3"]]);
});

test("a stale client that sends NO ids still keeps the links (matched on code + index, not position)", async () => {
  const h = harness();
  const r = await h.put([
    { poItemIndex: 1, materialCode: "C", materialName: "Charlie", orderedQty: 8, receivedQty: 8, acceptedQty: 6, rejectedQty: 0, unitPrice: 300 },
    { poItemIndex: 0, materialCode: "A", materialName: "Alpha", orderedQty: 10, receivedQty: 10, acceptedQty: 4, rejectedQty: 0, unitPrice: 100 },
    { poItemIndex: 0, materialCode: "B", materialName: "Bravo", orderedQty: 5, receivedQty: 5, acceptedQty: 5, rejectedQty: 0, unitPrice: 200 },
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(h.stored().map((s) => [s.id, s.acc, s.poi]), [[1, 4, "poi-1"], [2, 5, "poi-2"], [3, 6, "poi-3"]]);
});

test("billed quantity on a kept line survives the edit (the row is updated, not replaced)", async () => {
  const h = harness();
  h.db.t.grn_items[0].invoiced_qty = 4;
  assert.equal((await h.put([line(1, { materialCode: "A" }), line(2), line(3)])).status, 200);
  assert.equal(h.db.t.grn_items.find((r) => r.id === 1).invoiced_qty, 4);
});

test("the route no longer deletes every line of a draft, and PUT self-applies the PO columns before reading them", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/api/routes/grn.ts", import.meta.url), "utf8");
  const put = src.slice(src.indexOf('app.put("/:id", async'), src.indexOf('app.put("/:id/arrival"'));
  assert.doesNotMatch(put, /DELETE FROM grn_items WHERE grnId = \?/);
  assert.match(put, /await ensureGrnItemPoRef\(c\.var\.DB\)/);
  assert.match(put, /planGrnDraftLines/);
  assert.match(put, /alignCommittedLines/);
});
