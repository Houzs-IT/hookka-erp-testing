// ---------------------------------------------------------------------------
// pi-line-edit.test.mjs — purchase-invoice line edit keeps stable ids and PO / GRN links; a source document can be linked after create.
//
// The gaps (measured 2026-11-04, purchase-invoices.ts): the GET did not return a line's PO; a PUT with `items` re-created every
// line with a fresh id and put any line that did not name its PO on the HEADER PO (so a multi-PO invoice collapsed onto one PO on the
// first edit); a line's PO was not validated against the invoice's supplier; `sourceDocumentFileId` could only be set by the create.
// Now: the GET returns `poId`; a PUT pairs lines BY ID (kept lines keep id, PO, GRN link and creation order; a changed link is refused;
// new lines' links are validated; an id-less line that could be several stored lines is REFUSED, never guessed); and
// POST /:id/source-document links a file attached to THIS invoice in THIS organisation (retry-safe; replacing needs `replace:true`).
//
// Two layers: (1) the pure rules (src/api/lib/pi-line-edit.ts); (2) the REAL route handlers (src/api/routes/purchase-invoices.ts) over
// an in-memory stand-in for the database. That proves the handlers' logic and the values they bind; it does NOT prove Postgres accepts
// the SQL — nothing here touches a real database.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { planPiLines, validateNewPiLinks } from "../src/api/lib/pi-line-edit.ts";
import piApp from "../src/api/routes/purchase-invoices.ts";

// ---- 1. pure rules ----------------------------------------------------------------------------------------------------------
const STORED = [
  { id: "pii-a", material_code: "A", material_name: "Alpha", po_id: "po-1", grn_item_id: null, created_at: "t1" },
  { id: "pii-b", material_code: "B", material_name: "Bravo", po_id: "po-2", grn_item_id: null, created_at: "t2" },
  { id: "pii-c", material_code: "C", material_name: "Charlie", po_id: null, grn_item_id: "g-9", created_at: "t3" },
];

test("lines are matched by id, in the order sent; each keeps its stored id, PO, GRN link and created_at", () => {
  const p = planPiLines(STORED, [{ id: "pii-c" }, { id: "pii-a" }, { id: "pii-b" }], "po-hdr");
  assert.equal(p.ok, true);
  assert.deepEqual(p.lines.map((l) => [l.id, l.poId, l.grnItemId, l.createdAt]), [["pii-c", null, "g-9", "t3"], ["pii-a", "po-1", null, "t1"], ["pii-b", "po-2", null, "t2"]]);
});

test("a removed line is dropped; an unknown or repeated id is refused; a changed PO / GRN link is refused (an echo is fine)", () => {
  const p = planPiLines(STORED, [{ id: "pii-a" }], null);
  assert.deepEqual(p.removeIds, ["pii-b", "pii-c"]);
  assert.equal(planPiLines(STORED, [{ id: "nope" }], null).ok, false);
  assert.equal(planPiLines(STORED, [{ id: "pii-a" }, { id: "pii-a" }], null).ok, false);
  const moved = planPiLines(STORED, [{ id: "pii-a", poId: "po-2" }], null);
  assert.deepEqual([moved.ok, moved.status], [false, 409]);
  assert.equal(planPiLines(STORED, [{ id: "pii-c", grnItemId: "g-1" }], null).status, 409);
  assert.equal(planPiLines(STORED, [{ id: "pii-a", poId: "po-1" }, { id: "pii-c", grnItemId: "g-9" }], null).ok, true);
  assert.equal(planPiLines(STORED, [{ id: "pii-c", poId: "po-hdr" }], "po-hdr").ok, true, "a line with no stored PO is on the header PO");
});

test("an id-less line: a unique content match is accepted, nothing like it is a NEW line, and an ambiguous one is REFUSED, never guessed", () => {
  const ok = planPiLines(STORED, [{ materialCode: "B", materialName: "Bravo" }, { materialCode: "A", materialName: "Alpha" }], null);
  assert.deepEqual(ok.lines.map((l) => l.id), ["pii-b", "pii-a"]);
  const fresh = planPiLines(STORED, [{ materialCode: "Z", materialName: "Zulu", poId: "po-1" }], null);
  assert.deepEqual([fresh.lines[0].id, fresh.lines[0].claimed], [null, true]);
  const twins = [{ id: "x1", material_code: "A", material_name: "Alpha", po_id: "po-1" }, { id: "x2", material_code: "A", material_name: "Alpha", po_id: "po-2" }];
  const amb = planPiLines(twins, [{ materialCode: "A", materialName: "Alpha" }], null);
  assert.deepEqual([amb.ok, amb.status], [false, 409]);
  assert.match(amb.error, /could belong to several existing lines/);
  const dup = planPiLines(STORED, [{ materialCode: "A", materialName: "Alpha" }, { materialCode: "A", materialName: "Alpha" }], null);
  assert.equal(dup.ok, false, "one stored line, two lookalike requests: which is the original?");
});

test("new-line links: a real PO of the invoice's supplier, a line of the invoice's own goods receipt", () => {
  const pos = new Map([["po-1", { id: "po-1", supplierId: "s1" }], ["po-x", { id: "po-x", supplierId: "s2" }]]);
  const grn = new Map([["g-1", { id: "g-1", grnId: "grn-1" }], ["g-2", { id: "g-2", grnId: "grn-other" }]]);
  const inv = { supplierId: "s1", grnId: "grn-1" };
  assert.equal(validateNewPiLinks({ poId: "po-1", grnItemId: "g-1" }, inv, pos, grn, 0).ok, true);
  assert.equal(validateNewPiLinks({ poId: "po-x", grnItemId: null }, inv, pos, grn, 0).status, 400);
  assert.equal(validateNewPiLinks({ poId: "nope", grnItemId: null }, inv, pos, grn, 0).status, 404);
  assert.equal(validateNewPiLinks({ poId: null, grnItemId: "g-2" }, inv, pos, grn, 0).status, 400);
  assert.equal(validateNewPiLinks({ poId: null, grnItemId: "zz" }, inv, pos, grn, 0).status, 404);
  assert.equal(validateNewPiLinks({ poId: null, grnItemId: "g-1" }, { supplierId: "s1", grnId: null }, pos, grn, 0).status, 400, "not a goods-receipt invoice");
});

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
    { id: "pii-a", pi_id: "pi-1", material_code: "A", material_name: "Alpha", qty: 10, unit_price_sen: 100, line_total_sen: 1000, line_type: "STOCKED", po_id: "po-1", grn_item_id: null, created_at: "2026-11-01T01:00:00Z" },
    { id: "pii-b", pi_id: "pi-1", material_code: "B", material_name: "Bravo", qty: 5, unit_price_sen: 200, line_total_sen: 1000, line_type: "STOCKED", po_id: "po-2", grn_item_id: null, created_at: "2026-11-01T01:00:01Z" },
    { id: "pii-c", pi_id: "pi-1", material_code: "C", material_name: "Charlie", qty: 2, unit_price_sen: 300, line_total_sen: 600, line_type: "STOCKED", po_id: "po-1", grn_item_id: null, created_at: "2026-11-01T01:00:02Z" },
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
const L = (id, over = {}) => ({ ...(id ? { id } : {}), materialCode: "", materialName: "n", qty: 1, unitPriceSen: 100, lineType: "STOCKED", ...over });

test("GET returns each line's id and its PO", async () => {
  const h = harness();
  const r = await h.call("GET", "/pi-1");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data.items.map((i) => [i.id, i.poId]), [["pii-a", "po-1"], ["pii-b", "po-2"], ["pii-c", "po-1"]]);
});

test("multi-PO invoice: edit quantities, REORDERED → save → reopen: same ids, same POs, same order, nothing moved to the header PO", async () => {
  const h = harness();
  const before = (await h.call("GET", "/pi-1")).json.data.items;
  const r = await h.call("PUT", "/pi-1", { items: [
    L("pii-c", { materialCode: "C", materialName: "Charlie", qty: 3, poId: "po-1" }),
    L("pii-a", { materialCode: "A", materialName: "Alpha", qty: 11, poId: "po-1" }),
    L("pii-b", { materialCode: "B", materialName: "Bravo", qty: 6, poId: "po-2" }),
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = (await h.call("GET", "/pi-1")).json.data.items;
  assert.deepEqual(after.map((i) => [i.id, i.poId]), before.map((i) => [i.id, i.poId]), "same ids, same POs, same order");
  assert.deepEqual(after.map((i) => i.qty), [11, 6, 3], "each quantity landed on its own line");
  assert.deepEqual(h.db.unknown.filter((q) => /^(insert|update|delete)/i.test(q) && /purchase_invoice_items/.test(q)), []);
});

test("a client that sends NO poId (stale) still keeps every line on its own PO, because it is matched by id", async () => {
  const h = harness();
  const r = await h.call("PUT", "/pi-1", { items: [L("pii-a", { materialCode: "A", materialName: "Alpha", qty: 12 }), L("pii-b", { materialCode: "B", materialName: "Bravo", qty: 5 }), L("pii-c", { materialCode: "C", materialName: "Charlie", qty: 2 })] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(h.stored().map((s) => s.po), ["po-1", "po-2", "po-1"]);
});

test("a removed line and a new linked line: the others keep their ids / POs, the new line gets its validated PO", async () => {
  const h = harness();
  const r = await h.call("PUT", "/pi-1", { items: [L("pii-b", { materialCode: "B", materialName: "Bravo", qty: 5 }), L("pii-c", { materialCode: "C", materialName: "Charlie", qty: 2 }), L(null, { materialCode: "D", materialName: "Delta", qty: 4, poId: "po-2" })] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = h.stored();
  assert.deepEqual(s.map((x) => x.code), ["B", "C", "D"], "A removed; kept lines first, in their original order; the new line last");
  assert.deepEqual(s.map((x) => x.po), ["po-2", "po-1", "po-2"]);
  assert.deepEqual(s.slice(0, 2).map((x) => x.id), ["pii-b", "pii-c"], "kept ids are stable");
});

test("invalid links are refused and NOTHING is written: another supplier's PO, an unknown PO, a changed PO, an unknown / repeated line id", async () => {
  const bad = [
    [[L("pii-a", { materialCode: "A", materialName: "Alpha" }), L(null, { materialName: "N", poId: "po-x" })], 400],
    [[L("pii-a", { materialCode: "A", materialName: "Alpha" }), L(null, { materialName: "N", poId: "nope" })], 404],
    [[L("pii-a", { materialCode: "A", materialName: "Alpha", poId: "po-2" })], 409],
    [[L("pii-zzz", { materialName: "N" })], 400],
    [[L("pii-a", { materialName: "N" }), L("pii-a", { materialName: "N" })], 400],
    [[L(null, { materialName: "N", grnItemId: "g-1" })], 400],
  ];
  for (const [items, status] of bad) {
    const h = harness();
    const r = await h.call("PUT", "/pi-1", { items: items.map((i) => ({ ...i, qty: 99 })) });
    assert.equal(r.status, status, JSON.stringify(items));
    assert.deepEqual(h.stored().map((s) => [s.id, s.qty, s.po]), [["pii-a", 10, "po-1"], ["pii-b", 5, "po-2"], ["pii-c", 2, "po-1"]], "stored lines untouched");
  }
});

test("a legacy client with no ids: unique lines are matched (links kept); an ambiguous request is REFUSED, not guessed", async () => {
  const h = harness();
  const ok = await h.call("PUT", "/pi-1", { items: [L(null, { materialCode: "B", materialName: "Bravo", qty: 6 }), L(null, { materialCode: "A", materialName: "Alpha", qty: 11 }), L(null, { materialCode: "C", materialName: "Charlie", qty: 3 })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(h.stored().map((s) => [s.id, s.qty, s.po]), [["pii-a", 11, "po-1"], ["pii-b", 6, "po-2"], ["pii-c", 3, "po-1"]]);
  const twin = harness({ purchase_invoice_items: [
    { id: "t1", pi_id: "pi-1", material_code: "A", material_name: "Alpha", qty: 1, unit_price_sen: 100, line_total_sen: 100, line_type: "STOCKED", po_id: "po-1", grn_item_id: null, created_at: "2026-11-01T01:00:00Z" },
    { id: "t2", pi_id: "pi-1", material_code: "A", material_name: "Alpha", qty: 2, unit_price_sen: 100, line_total_sen: 200, line_type: "STOCKED", po_id: "po-2", grn_item_id: null, created_at: "2026-11-01T01:00:01Z" },
  ] });
  const amb = await twin.call("PUT", "/pi-1", { items: [L(null, { materialCode: "A", materialName: "Alpha", qty: 9 })] });
  assert.equal(amb.status, 409);
  assert.match(amb.json.error, /several existing lines/);
  assert.deepEqual(twin.stored().map((s) => [s.id, s.qty, s.po]), [["t1", 1, "po-1"], ["t2", 2, "po-2"]]);
});

// ---- B1: source document link ----------------------------------------------------------------------------------------------------
test("link a file attached to THIS invoice as its source; the same file again is a no-op; the GET then shows it", async () => {
  const h = harness();
  const a = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi" });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.data.unchanged, false);
  const b = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi" });
  assert.deepEqual([b.status, b.json.data.unchanged], [200, true], "a retry is safe");
  assert.equal((await h.call("GET", "/pi-1")).json.data.sourceDocumentFileId, "f-pi");
});

test("the file must belong to THIS invoice and THIS organisation, and be a PI attachment", async () => {
  const cases = [["f-other", 400], ["f-org2", 404], ["f-wrong-type", 400], ["f-none", 404]];
  for (const [fileId, status] of cases) {
    const h = harness();
    const r = await h.call("POST", "/pi-1/source-document", { fileId });
    assert.equal(r.status, status, fileId);
    assert.equal(h.db.t.purchase_invoices[0].source_document_file_id, null, "nothing linked");
  }
  assert.equal((await harness().call("POST", "/pi-1/source-document", {})).status, 400);
  assert.equal((await harness().call("POST", "/pi-nope/source-document", { fileId: "f-pi" })).status, 404);
});

test("replacing an existing source needs an explicit `replace: true`; a cancelled invoice takes none", async () => {
  const h = harness();
  await h.call("POST", "/pi-1/source-document", { fileId: "f-pi" });
  const refused = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi2" });
  assert.equal(refused.status, 409);
  assert.equal(h.db.t.purchase_invoices[0].source_document_file_id, "f-pi", "the old source stays");
  const ok = await h.call("POST", "/pi-1/source-document", { fileId: "f-pi2", replace: true });
  assert.equal(ok.status, 200);
  assert.equal(h.db.t.purchase_invoices[0].source_document_file_id, "f-pi2");
  const c = harness({ purchase_invoices: [{ ...SEED.purchase_invoices[0], status: "CANCELLED" }] });
  assert.equal((await c.call("POST", "/pi-1/source-document", { fileId: "f-pi" })).status, 409);
});

test("source: the route needs purchase-invoices:update, the PUT plans by id before the ceiling checks, the clients send ids", () => {
  const src = readFileSync(new URL("../src/api/routes/purchase-invoices.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const link = src.slice(src.indexOf('app.post("/:id/source-document"'), src.indexOf('app.delete("/:id"'));
  assert.match(link, /requirePermission\(c, "purchase-invoices", "update"\)/);
  assert.match(link, /orgId = \?/, "the file lookup is scoped to the organisation");
  const put = src.slice(src.indexOf('app.put("/:id", async'));
  assert.ok(put.indexOf("planPiLines") < put.indexOf("checkInvoicedQtyCeilingAfterEdit"), "links are settled before the ceilings are checked");
  const desktop = readFileSync(new URL("../src/pages/procurement/PurchaseInvoiceDetail.tsx", import.meta.url), "utf8");
  assert.match(desktop, /\.\.\.\(l\.id \? \{ id: l\.id \} : \{\}\)/);
  const mobile = readFileSync(new URL("../src/pages/m/lib/procurement-mobile.ts", import.meta.url), "utf8");
  assert.match(mobile, /\.\.\.\(l\.id \? \{ id: l\.id \} : \{\}\)/);
});

test("an id-less line billed against a goods-receipt line is THAT line even if renamed; with no stored match for its GRN line it is new; a GRN line twice is ambiguous", () => {
  const renamed = planPiLines(STORED, [{ materialCode: "", materialName: "Charlie (renamed)", grnItemId: "g-9" }], null);
  assert.deepEqual(renamed.lines.map((l) => [l.id, l.grnItemId, l.claimed]), [["pii-c", "g-9", false]]);
  const noMatch = planPiLines(STORED, [{ materialName: "X", grnItemId: "g-77" }], null);
  assert.deepEqual([noMatch.lines[0].id, noMatch.lines[0].claimed], [null, true]);
  const dupGrn = planPiLines(STORED, [{ materialName: "a", grnItemId: "g-9" }, { materialName: "b", grnItemId: "g-9" }], null);
  assert.deepEqual([dupGrn.ok, dupGrn.status], [false, 409]);
  // a request that drops the GRN link but keeps code + name still finds its line (and so keeps the stored link)
  const dropped = planPiLines(STORED, [{ materialCode: "C", materialName: "Charlie" }], null);
  assert.deepEqual([dropped.lines[0].id, dropped.lines[0].grnItemId], ["pii-c", "g-9"]);
});
