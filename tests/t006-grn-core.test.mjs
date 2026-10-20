// ---------------------------------------------------------------------------
// t006-grn-core.test.mjs — T-006 R2 + R3 and HK-0108, through the REAL
// grn.ts handlers against a REAL SQL engine (node:sqlite), so the counter
// guard, the EXISTS-based PO status recompute and the transaction rollback
// all actually execute.
//
// The shim is D1-shaped like SupabaseAdapter: batch() is one transaction
// (BEGIN … COMMIT / ROLLBACK), and result keys are camelCased like db-pg.ts.
// The one Postgres behaviour SQLite lacks is a failing CAST: SQLite turns
// CAST('text' AS REAL) into 0. The shim maps that single expression to a
// function that raises Postgres' error, so the guard's raise path is real.
//
//   R3   a born-POSTED create is ONE batch; a failure inside it leaves nothing
//   R3   DRAFT → POSTED posts stock + counter + status in the flip's batch
//   R2   a receipt committed between the pre-check and the save → 409, nothing
//   R2   POSTED edit checks each line against its OWN PO line (multi-PO)
//   R2   POSTED edit: a raced raise on any line rolls the whole edit back
//   HK-0108 a POSTED edit lands on the line the screen showed, by id
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  /* older Node — every case below skips */
}
const needsSqlite = DatabaseSync
  ? {}
  : { skip: "node:sqlite requires Node 22+ (this runtime is older)" };

const { default: grnApp } = await import("../src/api/routes/grn.ts");
const { translateSql } = await import("../src/api/lib/supabase-compat.ts");

const toCamel = (s) => s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
const camelRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

const SCHEMA = `
CREATE TABLE grns (id TEXT PRIMARY KEY, grnNumber TEXT, poId TEXT, poNumber TEXT,
  supplierId TEXT, supplierName TEXT, receiveDate TEXT, receivedBy TEXT,
  totalAmount REAL, qcStatus TEXT, status TEXT, notes TEXT, arrival_state TEXT,
  shipping_method TEXT, carrier_name TEXT, tracking_number TEXT, container_number TEXT,
  expected_arrival TEXT, shipped_date TEXT, actual_arrival TEXT, customs_status TEXT,
  customs_clearance_date TEXT, shipping_cost_sen REAL, customs_duty_sen REAL,
  exchange_rate REAL, currency TEXT, landed_cost_sen REAL, supplier_do_no TEXT,
  purchase_org_code TEXT, cancelled_at TEXT, cancelled_reason TEXT);
CREATE TABLE grn_items (id INTEGER PRIMARY KEY AUTOINCREMENT, grnId TEXT,
  poItemIndex INTEGER, po_id TEXT, po_item_id TEXT, materialCode TEXT,
  materialName TEXT, orderedQty REAL, receivedQty REAL, acceptedQty REAL,
  rejectedQty REAL, rejectionReason TEXT, unitPrice REAL, invoiced_qty REAL DEFAULT 0);
CREATE TABLE purchase_orders (id TEXT PRIMARY KEY, poNo TEXT, supplierId TEXT,
  supplierName TEXT, purchase_org_code TEXT, status TEXT, receivedDate TEXT, updated_at TEXT);
CREATE TABLE purchase_order_items (id TEXT PRIMARY KEY, purchaseOrderId TEXT,
  line_no INTEGER, materialName TEXT, material_code TEXT, supplierSKU TEXT,
  quantity REAL, unitPriceSen REAL, receivedQty REAL NOT NULL DEFAULT 0);
CREATE TABLE goods_in_transit (id TEXT PRIMARY KEY, poId TEXT);
CREATE TABLE rm_batches (id TEXT PRIMARY KEY, rmId TEXT, source TEXT, sourceRefId TEXT,
  receivedDate TEXT, originalQty REAL, remainingQty REAL, unitCostSen REAL,
  created_at TEXT, notes TEXT);
CREATE TABLE cost_ledger (id TEXT PRIMARY KEY, date TEXT, type TEXT, itemType TEXT,
  itemId TEXT, batchId TEXT, qty REAL, direction TEXT, unitCostSen REAL,
  totalCostSen REAL, refType TEXT, refId TEXT, notes TEXT);
CREATE TABLE raw_materials (id TEXT PRIMARY KEY, itemCode TEXT, description TEXT, balanceQty REAL);
CREATE TABLE supplier_material_bindings (id TEXT, supplierId TEXT, materialCode TEXT,
  materialName TEXT, supplierSku TEXT, supplierDescription TEXT, unitPrice REAL, unitPriceSen REAL,
  currency TEXT, leadTimeDays INTEGER, paymentTerms TEXT, moq REAL, isMainSupplier INTEGER);
CREATE TABLE suppliers (id TEXT PRIMARY KEY, purchaseOrgCode TEXT);
`;

function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  // Postgres raises on CAST('po_line_over_receipt:…' AS DOUBLE PRECISION).
  sqlite.function("pg_cast_double", (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error(`invalid input syntax for type double precision: "${v}"`);
    return n;
  });
  const toSqlite = (sql) =>
    sql
      .replace(/CAST\(('[^']*' \|\| \w+) AS DOUBLE PRECISION\)/g, "pg_cast_double($1)")
      .replace(/NULLS LAST/g, "");
  // Schema self-apply is Postgres DDL; this schema already has every column.
  const isDdl = (sql) => /^\s*(ALTER TABLE|CREATE (UNIQUE )?INDEX|CREATE TABLE)/i.test(sql);

  let batches = 0;
  let afterRead = null; // (sql) => void — simulates a writer committing right after a read

  function prepare(rawSql) {
    const sql = toSqlite(rawSql);
    let params = [];
    const stmt = () => sqlite.prepare(sql);
    const api = {
      sql,
      bind(...args) {
        params = args.map((a) => (a === undefined ? null : a));
        return api;
      },
      async run() {
        if (isDdl(sql)) return { success: true, meta: { changes: 0 } };
        const r = stmt().run(...params);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      async all() {
        // Postgres catalog probes (unit-price precision) — nothing to widen here.
        if (isDdl(sql) || /information_schema/i.test(sql)) return { results: [] };
        const rows = stmt().all(...params).map(camelRow);
        afterRead?.(sql);
        return { results: rows };
      },
      async first() {
        return (await api.all()).results[0] ?? null;
      },
    };
    return api;
  }

  async function batch(stmts) {
    batches++;
    sqlite.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  }

  const rows = (sql, ...p) => sqlite.prepare(sql).all(...p).map((r) => ({ ...r }));
  return {
    prepare,
    batch,
    sqlite,
    rows,
    get batches() {
      return batches;
    },
    afterRead(fn) {
      afterRead = fn;
    },
  };
}

function mount(db) {
  const root = new Hono();
  root.use("*", async (c, next) => {
    c.set("DB", db);
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "test-user");
    c.set("orgId", "org-test");
    await next();
  });
  root.route("/", grnApp);
  return root;
}

const json = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// Two POs from one supplier. PO-1 line A (10 ordered), PO-2 line B (100).
function seedPos(db, { aReceived = 0, bReceived = 0 } = {}) {
  const s = db.sqlite;
  s.prepare("INSERT INTO suppliers VALUES ('sup-1', 'HOOKKA')").run();
  s.prepare("INSERT INTO purchase_orders (id, poNo, supplierId, supplierName, status) VALUES (?, ?, 'sup-1', 'ACME', ?)").run("po-1", "PO-1", aReceived ? "PARTIAL_RECEIVED" : "CONFIRMED");
  s.prepare("INSERT INTO purchase_orders (id, poNo, supplierId, supplierName, status) VALUES (?, ?, 'sup-1', 'ACME', ?)").run("po-2", "PO-2", bReceived ? "PARTIAL_RECEIVED" : "CONFIRMED");
  s.prepare("INSERT INTO purchase_order_items VALUES ('poi-a', 'po-1', 1, 'RM-X - Foam', 'RM-X', '', 10, 100, ?)").run(aReceived);
  s.prepare("INSERT INTO purchase_order_items VALUES ('poi-b', 'po-2', 1, 'RM-Y - Fabric', 'RM-Y', '', 100, 200, ?)").run(bReceived);
  s.prepare("INSERT INTO raw_materials VALUES ('rm-x', 'RM-X', 'Foam', 0), ('rm-y', 'RM-Y', 'Fabric', 0)").run();
}

const poi = (db, id) => db.rows("SELECT * FROM purchase_order_items WHERE id = ?", id)[0];
const po = (db, id) => db.rows("SELECT * FROM purchase_orders WHERE id = ?", id)[0];
const rm = (db, id) => db.rows("SELECT * FROM raw_materials WHERE id = ?", id)[0];

const createBody = (lines) => ({
  poId: "po-1",
  arrival_state: "ARRIVED",
  items: lines.map(([poId, poItemId, qty]) => ({
    poId,
    poItemId,
    poItemIndex: 0,
    receivedQty: qty,
    acceptedQty: qty,
    rejectedQty: 0,
  })),
});

// ---------------------------------------------------------------------------
test("R2 guard SQL survives translateSql with its marker intact", () => {
  const out = translateSql(
    "UPDATE purchase_order_items SET receivedQty = CASE WHEN receivedQty + ? <= quantity * 1.1 THEN receivedQty + ? ELSE CAST('po_line_over_receipt:' || id AS DOUBLE PRECISION) END WHERE id = ?",
  );
  assert.match(out, /received_qty = CASE WHEN received_qty \+ \$1 <= quantity \* 1\.1 THEN received_qty \+ \$2/);
  assert.match(out, /CAST\('po_line_over_receipt:' \|\| id AS DOUBLE PRECISION\)/);
});

test("R3 a born-POSTED multi-PO create is ONE batch: receipt, stock, both counters, both statuses", needsSqlite, async () => {
  const db = makeDb();
  seedPos(db);
  const res = await mount(db).request("/", json("POST", createBody([["po-1", "poi-a", 10], ["po-2", "poi-b", 40]])));
  assert.equal(res.status, 201, await res.clone().text());
  const grnId = (await res.json()).data.id;

  assert.equal(db.batches, 1, "header, lines, stock and PO counters must commit together");
  assert.equal(db.rows("SELECT * FROM grns").length, 1);
  assert.equal(db.rows("SELECT * FROM rm_batches WHERE sourceRefId = ?", grnId).length, 2);
  assert.equal(rm(db, "rm-x").balanceQty, 10);
  assert.equal(rm(db, "rm-y").balanceQty, 40);
  assert.equal(poi(db, "poi-a").receivedQty, 10);
  assert.equal(poi(db, "poi-b").receivedQty, 40);
  assert.equal(po(db, "po-1").status, "RECEIVED");
  assert.equal(po(db, "po-2").status, "PARTIAL_RECEIVED");
});

test("R3 a failure inside the create batch leaves no receipt, no stock, no counter", needsSqlite, async () => {
  const db = makeDb();
  seedPos(db);
  db.sqlite.exec("DROP TABLE cost_ledger"); // the stock write fails mid-batch
  const res = await mount(db).request("/", json("POST", createBody([["po-1", "poi-a", 5]])));
  assert.equal(res.status, 500);
  assert.equal(db.rows("SELECT * FROM grns").length, 0, "no POSTED receipt without stock");
  assert.equal(db.rows("SELECT * FROM grn_items").length, 0);
  assert.equal(db.rows("SELECT * FROM rm_batches").length, 0);
  assert.equal(rm(db, "rm-x").balanceQty, 0);
  assert.equal(poi(db, "poi-a").receivedQty, 0);
  assert.equal(po(db, "po-1").status, "CONFIRMED");
});

test("R2 a receipt committed after the pre-check makes this one a 409 that writes nothing", needsSqlite, async () => {
  const db = makeDb();
  seedPos(db);
  // Another GRN takes 8 of PO line A's 10 right after this request's
  // findOverReceipt read it as 0 — the classic read-then-write race.
  let raced = false;
  db.afterRead((sql) => {
    if (!raced && /SELECT id, materialName, quantity, receivedQty FROM purchase_order_items/.test(sql)) {
      raced = true;
      db.sqlite.prepare("UPDATE purchase_order_items SET receivedQty = 8 WHERE id = 'poi-a'").run();
    }
  });
  const res = await mount(db).request("/", json("POST", createBody([["po-1", "poi-a", 5]])));
  assert.equal(res.status, 409, await res.clone().text());
  assert.match((await res.json()).error, /just received by another GRN/);
  assert.equal(db.rows("SELECT * FROM grns").length, 0);
  assert.equal(db.rows("SELECT * FROM rm_batches").length, 0);
  assert.equal(rm(db, "rm-x").balanceQty, 0);
  assert.equal(poi(db, "poi-a").receivedQty, 8, "only the other receipt's draw-down remains");
});

test("R3 DRAFT → POSTED posts stock, counter and status in the flip's own batch", needsSqlite, async () => {
  const db = makeDb();
  seedPos(db);
  const app = mount(db);
  const draft = await app.request("/", json("POST", { ...createBody([["po-1", "poi-a", 6]]), status: "DRAFT" }));
  assert.equal(draft.status, 201);
  const grnId = (await draft.json()).data.id;
  assert.equal(poi(db, "poi-a").receivedQty, 0, "a DRAFT draws nothing down");

  const before = db.batches;
  const res = await app.request(`/${grnId}`, json("PUT", { status: "POSTED" }));
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(db.batches - before, 1);
  assert.equal(rm(db, "rm-x").balanceQty, 6);
  assert.equal(poi(db, "poi-a").receivedQty, 6);
  assert.equal(po(db, "po-1").status, "PARTIAL_RECEIVED");
});

test("R2 posting a DRAFT over a line another receipt filled meanwhile rolls back whole", needsSqlite, async () => {
  const db = makeDb();
  seedPos(db);
  const app = mount(db);
  const grnId = (await (await app.request("/", json("POST", { ...createBody([["po-1", "poi-a", 6]]), status: "DRAFT" }))).json()).data.id;
  let raced = false;
  db.afterRead((sql) => {
    if (!raced && /SELECT id, materialName, quantity, receivedQty FROM purchase_order_items/.test(sql)) {
      raced = true;
      db.sqlite.prepare("UPDATE purchase_order_items SET receivedQty = 10 WHERE id = 'poi-a'").run();
    }
  });
  const res = await app.request(`/${grnId}`, json("PUT", { status: "POSTED" }));
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(db.rows("SELECT status FROM grns WHERE id = ?", grnId)[0].status, "DRAFT");
  assert.equal(db.rows("SELECT * FROM rm_batches").length, 0);
  assert.equal(poi(db, "poi-a").receivedQty, 10);
});

test("R3 two DRAFT → POSTED flips at once: only one commits, the counter moves once", needsSqlite, async () => {
  const db = makeDb();
  seedPos(db);
  const app = mount(db);
  const grnId = (await (await app.request("/", json("POST", { ...createBody([["po-1", "poi-a", 4]]), status: "DRAFT" }))).json()).data.id;
  // No line resolves to a raw material, so no rm_batches key can clash and
  // stop the second flip — only the status compare-and-set can.
  db.sqlite.exec("DELETE FROM raw_materials");
  // The other flip commits right after this request read the GRN as DRAFT.
  let raced = false;
  db.afterRead((sql) => {
    if (!raced && /FROM grns/i.test(sql)) {
      raced = true;
      db.sqlite.prepare("UPDATE grns SET status = 'POSTED' WHERE id = ?").run(grnId);
      db.sqlite.prepare("UPDATE purchase_order_items SET receivedQty = receivedQty + 4 WHERE id = 'poi-a'").run();
    }
  });
  const res = await app.request(`/${grnId}`, json("PUT", { status: "POSTED" }));
  assert.ok(raced, "the race hook must have fired");
  assert.equal(res.status, 409, await res.clone().text());
  assert.match((await res.json()).error, /status was just changed/);
  assert.equal(poi(db, "poi-a").receivedQty, 4, "counted once, not twice");
  assert.equal(db.rows("SELECT * FROM rm_batches").length, 0);
});

// A POSTED two-PO receipt whose id order differs from its screen order:
// stored id 1 = PO-2 line B (poItemIndex 1), id 2 = PO-1 line A (index 0).
// GET lists A first; batches were keyed by id order (B → "-1", A → "-2").
function seedPostedMultiPo(db, { aReceived = 5, bReceived = 5 } = {}) {
  seedPos(db, { aReceived, bReceived });
  const s = db.sqlite;
  s.prepare(`INSERT INTO grns (id, grnNumber, poId, poNumber, supplierId, supplierName,
    receiveDate, totalAmount, qcStatus, status, arrival_state)
    VALUES ('grn-m', 'GRN-M', 'po-1', 'PO-1', 'sup-1', 'ACME', '2026-10-01', 0, 'PASSED', 'POSTED', 'ARRIVED')`).run();
  const line = s.prepare(`INSERT INTO grn_items (id, grnId, poItemIndex, po_id, po_item_id, materialCode,
    materialName, orderedQty, receivedQty, acceptedQty, rejectedQty, unitPrice)
    VALUES (?, 'grn-m', ?, ?, ?, ?, ?, ?, 5, 5, 0, ?)`);
  line.run(1, 1, "po-2", "poi-b", "RM-Y", "RM-Y - Fabric", 100, 200);
  line.run(2, 0, "po-1", "poi-a", "RM-X", "RM-X - Foam", 10, 100);
  const batch = s.prepare(`INSERT INTO rm_batches VALUES (?, ?, 'GRN', 'grn-m', '2026-10-01', 5, 5, ?, '2026-10-01', '')`);
  batch.run("rmb-grn-grn-m-1", "rm-y", 200);
  batch.run("rmb-grn-grn-m-2", "rm-x", 100);
  s.prepare("UPDATE raw_materials SET balanceQty = 5").run();
}

async function editPosted(app, edits) {
  const grn = (await (await app.request("/grn-m")).json()).data;
  const items = grn.items.map((it) => ({
    id: it.id,
    poItemIndex: it.poItemIndex,
    acceptedQty: edits[it.materialCode] ?? it.acceptedQty,
  }));
  return { grn, res: await app.request("/grn-m", json("PUT", { items })) };
}

test("HK-0108 a POSTED edit lands on the line the screen showed, not the stored position", needsSqlite, async () => {
  const db = makeDb();
  seedPostedMultiPo(db);
  const app = mount(db);
  const { grn, res } = await editPosted(app, { "RM-X": 3 });
  assert.equal(grn.items[0].materialCode, "RM-X", "screen line 1 is PO-1 line A");
  assert.equal(res.status, 200, await res.clone().text());

  const items = db.rows("SELECT id, acceptedQty FROM grn_items ORDER BY id");
  assert.deepEqual(items.map((r) => r.acceptedQty), [5, 3], "only the RM-X row (id 2) changes");
  assert.equal(rm(db, "rm-x").balanceQty, 3);
  assert.equal(rm(db, "rm-y").balanceQty, 5);
  const batchRem = (id) => db.rows("SELECT remainingQty FROM rm_batches WHERE id = ?", id)[0].remainingQty;
  assert.equal(batchRem("rmb-grn-grn-m-2"), 3, "RM-X's own batch (id order 2) shrinks");
  assert.equal(batchRem("rmb-grn-grn-m-1"), 5);
  assert.equal(poi(db, "poi-a").receivedQty, 3, "PO-1 line A follows the edit");
  assert.equal(poi(db, "poi-b").receivedQty, 5);
});

test("HK-0108 an id that is not on this GRN is refused", needsSqlite, async () => {
  const db = makeDb();
  seedPostedMultiPo(db);
  const res = await mount(db).request("/grn-m", json("PUT", { items: [{ id: 2, acceptedQty: 5 }, { id: 99, acceptedQty: 5 }] }));
  assert.equal(res.status, 409);
  assert.equal(rm(db, "rm-x").balanceQty, 5);
});

test("R2 a POSTED edit checks the line against its OWN PO line, not the header PO's line", needsSqlite, async () => {
  const db = makeDb();
  // PO-1 line A is already full (10/10). The raised line is PO-2's line B,
  // which has 95 of 100 left. Header PO + poItemIndex would point B's raise
  // at A and refuse it; worse, a permitted raise would bump A.
  seedPostedMultiPo(db, { aReceived: 10, bReceived: 5 });
  db.sqlite.prepare("UPDATE grn_items SET poItemIndex = 0").run();
  const app = mount(db);
  const { res } = await editPosted(app, { "RM-Y": 8 });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(poi(db, "poi-b").receivedQty, 8);
  assert.equal(poi(db, "poi-a").receivedQty, 10, "PO-1 line A untouched");
  assert.equal(po(db, "po-2").status, "PARTIAL_RECEIVED");
});

test("R2 POSTED edit: a raced raise on ANY line rolls the whole edit back", needsSqlite, async () => {
  const db = makeDb();
  seedPostedMultiPo(db);
  const app = mount(db);
  let raced = false;
  db.afterRead((sql) => {
    if (!raced && /SELECT id, materialName, quantity, receivedQty FROM purchase_order_items/.test(sql)) {
      raced = true;
      // The SMALL raise (A: +1) is the one that no longer fits.
      db.sqlite.prepare("UPDATE purchase_order_items SET receivedQty = 11 WHERE id = 'poi-a'").run();
    }
  });
  const { res } = await editPosted(app, { "RM-X": 6, "RM-Y": 50 });
  assert.equal(res.status, 409, await res.clone().text());
  assert.deepEqual(db.rows("SELECT acceptedQty FROM grn_items ORDER BY id").map((r) => r.acceptedQty), [5, 5]);
  assert.equal(rm(db, "rm-x").balanceQty, 5);
  assert.equal(rm(db, "rm-y").balanceQty, 5);
  assert.equal(poi(db, "poi-b").receivedQty, 5, "B's raise rolled back with A's");
});
