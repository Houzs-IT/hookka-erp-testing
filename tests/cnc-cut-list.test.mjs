// ---------------------------------------------------------------------------
// cnc-cut-list.test.mjs — HK-0036 CNC cut list (behaviour).
//
// Three seams, agreed in the HK-0036 decision note:
//   1. parseMetresFromName — the trailing "NNMTR" the ETMark operator types
//      into a .plt file name is the fabric metres used.
//   2. groupCutList — BEDFRAME by fabric (colour) code, SOFA by model + fabric,
//      each group sorted by due date.
//   3. exportCutList / loadCutBatch — each export stamps its cards, the next
//      export takes only new cards, a past batch can be re-exported, and a PO
//      cancelled or edited after export comes back once as a "changed" line.
// All fixtures are made up (the repo is public).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";

const {
  parseMetresFromName,
  groupCutList,
  exportCutList,
  loadCutBatch,
  listCutBatches,
  ensureCutListTables,
} = await import("../src/api/lib/cnc-cut-list.ts");

// ── 1. NNMTR parser ─────────────────────────────────────────────────────────
test("metres come from the trailing NNMTR in the file name", () => {
  assert.equal(parseMetresFromName("(B) DEMO-01 13-11 46MTR.plt"), 46);
  assert.equal(parseMetresFromName("9999 2S 10MTR.plt"), 10);
  assert.equal(parseMetresFromName("9999 2S 12.5mtr.PLT"), 12.5);
  assert.equal(parseMetresFromName("9999 2S 8 MTR.plt"), 8);
  assert.equal(parseMetresFromName("9999 2S 30MTR"), 30);
});

test("no trailing NNMTR → blank (null), never a guess", () => {
  assert.equal(parseMetresFromName("9999 2S.plt"), null);
  assert.equal(parseMetresFromName("46MTR copy.plt"), null);
  assert.equal(parseMetresFromName("MTR.plt"), null);
  assert.equal(parseMetresFromName(""), null);
});

// ── 2. grouping ─────────────────────────────────────────────────────────────
const row = (o) => ({
  jobCardId: o.id,
  category: o.cat,
  fabricCode: o.fab ?? "",
  productCode: o.model ?? "",
  productName: "",
  sizeLabel: o.size ?? "",
  wipLabel: "",
  qty: o.qty ?? 1,
  poNo: o.po ?? o.id,
  dueDate: o.due ?? "",
});

test("bedframes group by fabric code only; sofas by model + fabric", () => {
  const groups = groupCutList([
    row({ id: "a", cat: "BEDFRAME", fab: "FAB-RED", model: "B100" }),
    row({ id: "b", cat: "BEDFRAME", fab: "FAB-RED", model: "B200" }),
    row({ id: "c", cat: "SOFA", fab: "FAB-RED", model: "S500" }),
    row({ id: "d", cat: "SOFA", fab: "FAB-RED", model: "S600" }),
    row({ id: "e", cat: "SOFA", fab: "FAB-BLUE", model: "S500" }),
  ]);
  const shape = groups.map((g) => [g.category, g.model, g.fabricCode, g.rows.map((r) => r.jobCardId).join("")]);
  assert.deepEqual(shape, [
    ["BEDFRAME", "", "FAB-RED", "ab"],
    ["SOFA", "S500", "FAB-BLUE", "e"],
    ["SOFA", "S500", "FAB-RED", "c"],
    ["SOFA", "S600", "FAB-RED", "d"],
  ]);
});

test("rows sort by due date inside a group; undated rows go last", () => {
  const [g] = groupCutList([
    row({ id: "late", cat: "BEDFRAME", fab: "F1", due: "2026-12-05" }),
    row({ id: "none", cat: "BEDFRAME", fab: "F1", due: "" }),
    row({ id: "early", cat: "BEDFRAME", fab: "F1", due: "2026-12-01" }),
  ]);
  assert.deepEqual(g.rows.map((r) => r.jobCardId), ["early", "late", "none"]);
});

test("a sofa row shows its library layout (model + size) and metres", () => {
  const groups = groupCutList(
    [
      row({ id: "s1", cat: "SOFA", fab: "F1", model: "S500", size: "2S" }),
      row({ id: "s2", cat: "SOFA", fab: "F1", model: "S500", size: "3S" }),
    ],
    [{ id: "t1", productCode: "S500", sizeLabel: "2 S", displayName: "S500 2S", pltMetres: 10 }],
  );
  const [r1, r2] = groups[0].rows;
  assert.deepEqual(r1.layout, { templateId: "t1", name: "S500 2S", metres: 10 });
  assert.equal(r2.layout, null);
});

// ── 3. export stamp / only-new / changed-since-export (node:sqlite) ─────────
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  /* older Node */
}
const needsSqlite = DatabaseSync ? {} : { skip: "node:sqlite requires Node 22+" };

const toCamel = (s) => s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
const camelRow = (r) =>
  r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v])) : null;

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE production_orders (id TEXT PRIMARY KEY, org_id TEXT, po_no TEXT,
      product_code TEXT, product_name TEXT, item_category TEXT, size_label TEXT,
      fabric_code TEXT, quantity INTEGER, status TEXT);
    CREATE TABLE job_cards (id TEXT PRIMARY KEY, org_id TEXT, production_order_id TEXT,
      department_code TEXT, status TEXT, due_date TEXT, wip_label TEXT);
    CREATE TABLE cnc_templates (id TEXT PRIMARY KEY, org_id TEXT, product_code TEXT,
      size_label TEXT, display_name TEXT, plt_key TEXT, plt_metres REAL);
  `);
  const stmt = (sql) => {
    let bound = [];
    const api = {
      bind(...a) {
        bound = a;
        return api;
      },
      async first() {
        return camelRow(db.prepare(sql).get(...bound));
      },
      async all() {
        return { results: db.prepare(sql).all(...bound).map(camelRow) };
      },
      async run() {
        const info = db.prepare(sql).run(...bound);
        return { meta: { changes: Number(info.changes) } };
      },
    };
    return api;
  };
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    addPo(id, o = {}) {
      db.prepare(
        "INSERT INTO production_orders VALUES (?, 'org1', ?, ?, '', ?, ?, ?, ?, ?)",
      ).run(id, `PO-${id}`, o.model ?? "B100", o.cat ?? "BEDFRAME", o.size ?? "Q", o.fab ?? "FAB-RED", o.qty ?? 2, o.status ?? "PENDING");
    },
    addCard(id, po, o = {}) {
      db.prepare("INSERT INTO job_cards VALUES (?, 'org1', ?, ?, ?, ?, '')").run(
        id, po, o.dept ?? "FAB_CUT", o.status ?? "WAITING", o.due ?? "2026-12-01",
      );
    },
  };
}

async function freshDb() {
  const db = makeDb();
  await ensureCutListTables(db);
  return db;
}

const ids = (payload) => payload.groups.flatMap((g) => g.rows.map((r) => r.jobCardId)).sort();

test("first export stamps every open FAB_CUT card, and only those", needsSqlite, async () => {
  const db = await freshDb();
  db.addPo("p1");
  db.addPo("p2", { status: "CANCELLED" });
  db.addCard("c1", "p1");
  db.addCard("c2", "p1", { dept: "FAB_SEW" });
  db.addCard("c3", "p1", { status: "COMPLETED" });
  db.addCard("c4", "p2");
  const out = await exportCutList(db, "org1", "u1", "2026-11-27T01:00:00Z");
  assert.ok(out);
  assert.deepEqual(ids(out), ["c1"]);
  assert.equal(out.batch.exportedAt, "2026-11-27T01:00:00Z");
});

test("the next export shows only new cards; nothing new → null", needsSqlite, async () => {
  const db = await freshDb();
  db.addPo("p1");
  db.addCard("c1", "p1");
  await exportCutList(db, "org1", "u1", "2026-11-27T01:00:00Z");
  assert.equal(await exportCutList(db, "org1", "u1", "2026-11-27T02:00:00Z"), null);
  db.addPo("p2");
  db.addCard("c2", "p2");
  const second = await exportCutList(db, "org1", "u1", "2026-11-27T03:00:00Z");
  assert.deepEqual(ids(second), ["c2"]);
});

test("a past batch re-exports with its own cards", needsSqlite, async () => {
  const db = await freshDb();
  db.addPo("p1");
  db.addCard("c1", "p1");
  const first = await exportCutList(db, "org1", "u1", "2026-11-27T01:00:00Z");
  db.addPo("p2");
  db.addCard("c2", "p2");
  await exportCutList(db, "org1", "u1", "2026-11-27T02:00:00Z");
  const again = await loadCutBatch(db, "org1", first.batch.id);
  assert.deepEqual(ids(again), ["c1"]);
  const list = await listCutBatches(db, "org1");
  assert.equal(list.length, 2);
  assert.equal(await loadCutBatch(db, "org2", first.batch.id), null);
});

test("a PO edited after export comes back once as a changed line", needsSqlite, async () => {
  const db = await freshDb();
  db.addPo("p1", { qty: 2 });
  db.addPo("p2");
  db.addCard("c1", "p1");
  db.addCard("c2", "p2");
  await exportCutList(db, "org1", "u1", "2026-11-27T01:00:00Z");
  db.raw.exec("UPDATE production_orders SET quantity = 3, fabric_code = 'FAB-BLUE' WHERE id = 'p1'");
  db.raw.exec("UPDATE production_orders SET status = 'CANCELLED' WHERE id = 'p2'");

  const next = await exportCutList(db, "org1", "u1", "2026-11-27T02:00:00Z");
  assert.ok(next, "changes alone still make a batch");
  assert.deepEqual(ids(next), []);
  const notes = Object.fromEntries(next.changed.map((c) => [c.jobCardId, c.note]));
  assert.equal(notes.c1, "qty 2 → 3; fabric FAB-RED → FAB-BLUE");
  assert.equal(notes.c2, "PO cancelled");

  // Reported once; the batch it was reported in still shows it on re-export.
  assert.equal(await exportCutList(db, "org1", "u1", "2026-11-27T03:00:00Z"), null);
  const again = await loadCutBatch(db, "org1", next.batch.id);
  assert.equal(again.changed.length, 2);
});

test("a card already cut is not flagged when its PO changes", needsSqlite, async () => {
  const db = await freshDb();
  db.addPo("p1");
  db.addCard("c1", "p1");
  await exportCutList(db, "org1", "u1", "2026-11-27T01:00:00Z");
  db.raw.exec("UPDATE job_cards SET status = 'COMPLETED' WHERE id = 'c1'");
  db.raw.exec("UPDATE production_orders SET quantity = 9 WHERE id = 'p1'");
  assert.equal(await exportCutList(db, "org1", "u1", "2026-11-27T02:00:00Z"), null);
});

test("sofa rows pick up the .plt layout from the template library", needsSqlite, async () => {
  const db = await freshDb();
  db.addPo("p1", { cat: "SOFA", model: "S500", size: "2S" });
  db.addCard("c1", "p1");
  db.raw.exec(
    "INSERT INTO cnc_templates VALUES ('t1','org1','S500','2S','S500 2S','cnc-templates/S500/S500 2S.plt',10)",
  );
  const out = await exportCutList(db, "org1", "u1", "2026-11-27T01:00:00Z");
  assert.deepEqual(out.groups[0].rows[0].layout, { templateId: "t1", name: "S500 2S", metres: 10 });
});
