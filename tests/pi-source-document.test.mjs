// ---------------------------------------------------------------------------
// pi-source-document.test.mjs — (1) POST /api/purchase-invoices/:id/source-document links a file attached to THIS invoice;
// (2) a Purchase Invoice edited from the phone keeps each line's PO, PO line, goods-receipt line and unit of measure.
//
// (1) The phone's PI scan follow-up and its "Add document" / "Use as the source" buttons call this route (`scan/attach-once.ts`).
//     Without it they get a 404 on main. Ported from staging (same handler); permission purchase-invoices:update, any status but
//     CANCELLED, the file must exist IN THIS ORGANISATION and be a PI attachment of THIS invoice, linking the file that is already the
//     source is a no-op (retry-safe), replacing a DIFFERENT source needs `replace: true`.
// (2) main's PUT /:id deletes every line and inserts the request's lines with new ids, but it gives a line the request leaves out
//     its OLD line's poId, poItemId (HK-0107 / T-006 R8, matched by the line's `id`, then by its goods-receipt line) and uom / poQty
//     (HK-0149). The phone sends each line's `id` (procurement-mobile.ts piEditLines / piEditBody) and echoes poId / grnItemId, so a
//     phone edit must leave every line's links where they were. The round trip below runs the REAL phone helpers into the REAL main
//     handler; the last test pins what the phone must keep sending for that to hold.
//
// The REAL handlers run over an in-memory stand-in for the database. That proves the handlers' logic and the values they bind; it does
// NOT prove Postgres accepts the SQL — nothing here touches a real database.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import piApp from "../src/api/routes/purchase-invoices.ts";
import { piEditBody, piEditLines } from "../src/pages/m/lib/procurement-mobile.ts";

// ---- 2. the real handlers over an in-memory stand-in -----------------------------------------------------------------------------
const lc = (s) => String(s).toLowerCase();
const col = (row, name) => { const k = Object.keys(row).find((x) => lc(x) === lc(name)); return k === undefined ? undefined : row[k]; };
class FakeDb {
  constructor(seed) { this.t = JSON.parse(JSON.stringify(seed)); this.unknown = []; this.failBatch = 0; }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) {
    const snap = JSON.stringify(this.t);
    try { const out = []; for (const s of stmts) out.push(await s.run()); return out; } catch (e) { this.t = JSON.parse(snap); throw e; }
  }
}
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.p = []; }
  bind(...p) { this.p = p; return this; }
  _where(clause, params) {
    const conds = []; let i = 0;
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
    const t = this.db.t; const sql = this.sql; let m;
    if (/^(alter|create|drop|comment) /i.test(sql)) return { rows: [], changes: 0 };
    if ((m = /^select (.+?) from (\w+)(?: where (.+?))?(?: order by (.+?))?(?: limit \d+)?$/i.exec(sql)) && t[lc(m[2])]) {
      const match = m[3] ? this._where(m[3], this.p) : () => true;
      if (!match) { this.db.unknown.push(sql); return { rows: [], changes: 0 }; }
      const rows = t[lc(m[2])].filter(match).map((r) => ({ ...r }));
      if (m[4]) {
        const keys = m[4].split(",").map((x) => x.trim().split(/\s+/)).map(([c, d]) => [c, /^desc$/i.test(d ?? "") ? -1 : 1]);
        rows.sort((x, y) => { for (const [c, dir] of keys) { const xv = String(col(x, c) ?? ""), yv = String(col(y, c) ?? ""); if (xv !== yv) return xv < yv ? -dir : dir; } return 0; });
      }
      return { rows, changes: 0 };
    }
    if ((m = /^insert into (\w+) \((.+?)\) values \((.+)\)$/i.exec(sql))) {
      const cols = m[2].split(",").map((s) => s.trim()); const toks = m[3].split(",").map((s) => s.trim()); let pi = 0;
      const row = {}; cols.forEach((c, i) => { const tk = toks[i]; row[c] = tk === "?" ? this.p[pi++] : /^null$/i.test(tk) ? null : /^-?\d+$/.test(tk) ? Number(tk) : tk; });
      (t[lc(m[1])] ??= []).push(row);
      return { rows: [], changes: 1 };
    }
    if ((m = /^update (\w+) set (.+?) where (.+)$/i.exec(sql)) && t[lc(m[1])]) {
      const setCols = m[2].split(",").map((s) => /^(\w+) = \?$/i.exec(s.trim())?.[1]);
      if (setCols.some((c) => !c)) { this.db.unknown.push(sql); return { rows: [], changes: 0 }; }
      const where = this._where(m[3], this.p.slice(setCols.length));
      if (!where) { this.db.unknown.push(sql); return { rows: [], changes: 0 }; }
      let n = 0;
      for (const r of t[lc(m[1])]) if (where(r)) { setCols.forEach((c, i) => { const k = Object.keys(r).find((x) => lc(x) === lc(c)) ?? c; r[k] = this.p[i]; }); n++; }
      return { rows: [], changes: n };
    }
    if ((m = /^delete from (\w+) where (.+)$/i.exec(sql)) && t[lc(m[1])]) {
      const where = this._where(m[2], this.p);
      if (!where) { this.db.unknown.push(sql); return { rows: [], changes: 0 }; }
      t[lc(m[1])] = t[lc(m[1])].filter((r) => !where(r));
      return { rows: [], changes: 1 };
    }
    this.db.unknown.push(sql);
    return { rows: [], changes: 0 };
  }
  async first() { return this._exec().rows[0] ?? null; }
  async all() { return { results: this._exec().rows }; }
  async run() { const r = this._exec(); return { success: true, meta: { changes: r.changes } }; }
}

const SEED = {
  purchase_invoices: [{ id: "pi-1", piNo: "PI-1", supplierId: "s1", supplierName: "S1", status: "DRAFT", purchaseOrderId: "po-1", amountSen: 0, currency: "MYR", invoiceDate: "2026-11-01", source_document_file_id: null, grn_id: null }],
  purchase_invoice_items: [
    { id: "pii-a", pi_id: "pi-1", material_code: "A", material_name: "Alpha", qty: 10, unit_price_sen: 100, line_total_sen: 1000, line_type: "STOCKED", po_id: "po-1", po_item_id: "poi-1", uom: "KG", po_qty: 10, grn_item_id: null, created_at: "2026-11-01T01:00:00Z" },
    { id: "pii-b", pi_id: "pi-1", material_code: "B", material_name: "Bravo", qty: 5, unit_price_sen: 200, line_total_sen: 1000, line_type: "STOCKED", po_id: "po-2", po_item_id: "poi-2", uom: null, po_qty: null, grn_item_id: null, created_at: "2026-11-01T01:00:01Z" },
    { id: "pii-c", pi_id: "pi-1", material_code: "C", material_name: "Charlie", qty: 2, unit_price_sen: 300, line_total_sen: 600, line_type: "STOCKED", po_id: "po-1", grn_item_id: null, created_at: "2026-11-01T01:00:02Z" },
  ],
  purchase_order_items: [
    { id: "poi-1", purchaseOrderId: "po-1", material_code: "A", materialName: "Alpha", quantity: 100, receivedQty: 0, unit: "ROLL" },
    { id: "poi-2", purchaseOrderId: "po-2", material_code: "B", materialName: "Bravo", quantity: 100, receivedQty: 0, unit: "PCS" },
    { id: "poi-3", purchaseOrderId: "po-1", material_code: "C", materialName: "Charlie", quantity: 100, receivedQty: 0, unit: "PCS" },
  ],
  purchase_orders: [{ id: "po-1", supplierId: "s1" }, { id: "po-2", supplierId: "s1" }, { id: "po-x", supplierId: "s2" }],
  file_assets: [
    { id: "f-pi", orgId: "org-1", resourceType: "PI", resourceId: "pi-1", filename: "scan.png" },
    { id: "f-pi2", orgId: "org-1", resourceType: "PI", resourceId: "pi-1", filename: "scan2.png" },
    { id: "f-other", orgId: "org-1", resourceType: "PI", resourceId: "pi-OTHER", filename: "x.png" },
    { id: "f-org2", orgId: "org-2", resourceType: "PI", resourceId: "pi-1", filename: "y.png" },
    { id: "f-wrong-type", orgId: "org-1", resourceType: "purchase-invoice-source", resourceId: "pi-1", filename: "z.png" },
  ],
};

function harness(over = {}) {
  const db = new FakeDb({ ...SEED, ...over });
  const root = new Hono();
  root.use("*", async (c, next) => { c.set("DB", db); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "u1"); c.set("orgId", "org-1"); await next(); });
  root.route("/", piApp);
  const call = async (method, path, body) => {
    const res = await root.request(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  const stored = () => db.t.purchase_invoice_items.map((r) => ({ id: r.id, code: r.material_code, qty: r.qty, po: r.po_id, created: r.created_at })).sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
  return { db, call, stored };
}
const SRC = readFileSync(new URL("../src/api/routes/purchase-invoices.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("GET returns each line's own PO, PO line and goods-receipt link (what the phone echoes back)", async () => {
  const h = harness();
  const r = await h.call("GET", "/pi-1");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.items.map((i) => [i.id, i.poId, i.poItemId]), [["pii-a", "po-1", "poi-1"], ["pii-b", "po-2", "poi-2"], ["pii-c", "po-1", null]]);
});

test("link a file attached to THIS invoice as its source; the same file again is a no-op; the GET then shows it", async () => {
  const h = harness();
  const a = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi" });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.data.unchanged, false);
  const b = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi" });
  assert.equal(b.status, 200);
  assert.equal(b.json.data.unchanged, true);
  assert.equal((await h.call("GET", "/pi-1")).json.data.sourceDocumentFileId, "f-pi");
});

test("the file must belong to THIS invoice and THIS organisation, and be a PI attachment", async () => {
  for (const fileId of ["f-other", "f-org2", "f-wrong-type", "nope"]) {
    const h = harness();
    const r = await h.call("POST", "/pi-1/source-document", { fileId });
    assert.ok([400, 404].includes(r.status), `${fileId}: ${r.status}`);
    assert.equal(h.db.t.purchase_invoices[0].source_document_file_id, null, `${fileId}: nothing linked`);
  }
  assert.equal((await harness().call("POST", "/pi-1/source-document", {})).status, 400);
  assert.equal((await harness().call("POST", "/pi-nope/source-document", { fileId: "f-pi" })).status, 404);
});

test("replacing an existing source needs an explicit `replace: true`; a cancelled invoice takes none", async () => {
  const h = harness();
  await h.call("POST", "/pi-1/source-document", { fileId: "f-pi" });
  const refused = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi2" });
  assert.equal(refused.status, 409);
  assert.equal(h.db.t.purchase_invoices[0].source_document_file_id, "f-pi");
  const ok = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi2", replace: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(h.db.t.purchase_invoices[0].source_document_file_id, "f-pi2");
  const c = harness({ purchase_invoices: [{ ...SEED.purchase_invoices[0], status: "CANCELLED" }] });
  assert.equal((await c.call("POST", "/pi-1/source-document", { fileId: "f-pi" })).status, 409);
});

test("source: the link route needs purchase-invoices:update, scopes the file to the caller's organisation, and audits", () => {
  const link = SRC.slice(SRC.indexOf('app.post("/:id/source-document"'), SRC.indexOf('app.delete("/:id"'));
  assert.match(link, /requirePermission\(c, "purchase-invoices", "update"\)/);
  assert.match(link, /orgId = \?/);
  assert.match(link, /emitAudit\(c,/);
});

test("a phone edit keeps every line's PO, PO line and unit of measure (main's PUT rewrites the lines from the request)", async () => {
  const h = harness();
  const got = (await h.call("GET", "/pi-1")).json.data;
  const lines = piEditLines(got).map((l) => (l.materialCode === "B" ? { ...l, qty: "7" } : l)); // edit one quantity
  const body = piEditBody({ invoiceDate: "2026-11-01", dueDate: "", remarks: "r", supplierInvoiceNo: "", supplierDoNo: "" }, lines);
  const put = await h.call("PUT", "/pi-1", body);
  assert.equal(put.status, 200, JSON.stringify(put.json));
  // The stand-in cannot answer the PO-ceiling / price look-ups (they return nothing, so those checks are not exercised here); it
  // must have understood every WRITE, which is what decides what is stored.
  assert.deepEqual(h.db.unknown.filter((q) => !/^select /i.test(q)), [], "every write the handler issued was applied");
  const after = h.db.t.purchase_invoice_items.filter((r) => r.pi_id === "pi-1").map((r) => ({ code: r.material_code, qty: r.qty, po: r.po_id, poItem: r.po_item_id ?? null, uom: r.uom ?? null, poQty: r.po_qty ?? null }));
  const byCode = Object.fromEntries(after.map((r) => [r.code, r]));
  assert.equal(after.length, 3);
  assert.deepEqual([byCode.A.po, byCode.A.poItem, byCode.A.uom, byCode.A.poQty], ["po-1", "poi-1", "KG", 10], "line A untouched");
  assert.deepEqual([byCode.B.po, byCode.B.poItem, byCode.B.qty], ["po-2", "poi-2", 7], "line B: new quantity, same PO and PO line");
  assert.equal(byCode.C.po, "po-1");
});

test("control: the same edit WITHOUT line ids loses the PO line and unit on main — which is why the phone must keep sending `id`", async () => {
  const h = harness();
  const got = (await h.call("GET", "/pi-1")).json.data;
  const body = piEditBody({ invoiceDate: "2026-11-01", dueDate: "", remarks: "r", supplierInvoiceNo: "", supplierDoNo: "" }, piEditLines(got));
  for (const it of body.items) delete it.id;
  const put = await h.call("PUT", "/pi-1", body);
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const a = h.db.t.purchase_invoice_items.find((r) => r.material_code === "A");
  assert.equal(a.po_id, "po-1", "poId is still echoed");
  assert.equal(a.po_item_id ?? null, null, "the PO line is lost without an id to inherit it from");
  assert.equal(a.uom ?? null, null, "so is the unit of measure");
});

test("the phone keeps sending what main inherits links by: every stored line's id, its goods-receipt line and its own PO; no invented keys", () => {
  const body = piEditBody({ invoiceDate: "", dueDate: "", remarks: "", supplierInvoiceNo: "", supplierDoNo: "" }, piEditLines({ items: [
    { id: "x1", materialCode: "A", materialName: "Alpha", qty: 1, unitPriceSen: 100 },
    { id: "x2", materialCode: "B", materialName: "Bravo", qty: 1, unitPriceSen: 100, poId: "po-2", grnItemId: "g-1" },
  ] }));
  const [bare, full] = body.items;
  assert.deepEqual([bare.id, full.id], ["x1", "x2"], "the line id main matches the old line by");
  assert.ok(!("poId" in bare), "no poId when the GET had none (an invented null would read as the header PO)");
  assert.deepEqual([full.poId, full.grnItemId], ["po-2", "g-1"]);
  // main must still inherit from the old line, or the phone has to start sending poItemId / uom / poQty itself
  const SRCP = SRC.slice(SRC.indexOf("// HK-0107: a line whose body omits poId keeps its OLD line's PO"), SRC.indexOf("const uomCheck = await resolvePiLineUoms(db, normalizedItems.rows);", SRC.indexOf("// HK-0149: a client that does not send")));
  assert.match(SRCP, /bodyId/);
  assert.match(SRCP, /r\.poItemId = old/);
  assert.match(SRCP, /r\.uom = old\?\.uom/);
});
