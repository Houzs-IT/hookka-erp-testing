// ---------------------------------------------------------------------------
// hk0118-draft-do-delete-so-stamp.test.mjs — HK-0118.
//
// Siti deleted DRAFT DO-2610-110, but SV-2610-036 kept showing "Delivery Order
// DO-2610-110": DO create stamps sales_orders.hookkaDeliveryOrder and
// DELETE /:id never handed it back. The handback runs in the delete batch,
// here against a real SQLite engine.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const { SO_DO_STAMP_HANDBACK_SQL } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/routes/delivery-orders/_helpers.ts")).href
);

function db(stamp, dos) {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE sales_orders (id TEXT, hookkaDeliveryOrder TEXT, updated_at TEXT);
          CREATE TABLE delivery_orders (id TEXT, doNo TEXT, salesOrderId TEXT, status TEXT, created_at TEXT);`);
  d.prepare("INSERT INTO sales_orders VALUES ('so-1', ?, 'old')").run(stamp);
  for (const r of dos) {
    d.prepare("INSERT INTO delivery_orders VALUES (?, ?, 'so-1', ?, ?)").run(r.id, r.doNo, r.status, r.created_at);
  }
  return d;
}

// Mirrors the route: the DO row is deleted first, then the handback runs.
function deleteDraft(d, id, doNo) {
  d.prepare("DELETE FROM delivery_orders WHERE id = ?").run(id);
  d.prepare(SO_DO_STAMP_HANDBACK_SQL).run("so-1", id, "now", "so-1", doNo);
  return d.prepare("SELECT hookkaDeliveryOrder AS s, updated_at AS u FROM sales_orders").get();
}

test("deleting the only DO blanks the SO's DO number", () => {
  const d = db("DO-2610-110", [{ id: "do-a", doNo: "DO-2610-110", status: "DRAFT", created_at: "2026-10-27T07:21" }]);
  assert.deepEqual({ ...deleteDraft(d, "do-a", "DO-2610-110") }, { s: "", u: "now" });
});

test("the stamp goes back to the newest remaining live DO, skipping cancelled ones", () => {
  const d = db("DO-3", [
    { id: "do-1", doNo: "DO-1", status: "DELIVERED", created_at: "2026-10-01" },
    { id: "do-2", doNo: "DO-2", status: "CANCELLED", created_at: "2026-10-02" },
    { id: "do-3", doNo: "DO-3", status: "DRAFT", created_at: "2026-10-03" },
  ]);
  assert.equal(deleteDraft(d, "do-3", "DO-3").s, "DO-1");
});

test("an SO already stamped with a different DO is left alone", () => {
  const d = db("DO-9", [
    { id: "do-3", doNo: "DO-3", status: "DRAFT", created_at: "2026-10-03" },
    { id: "do-9", doNo: "DO-9", status: "DRAFT", created_at: "2026-10-09" },
  ]);
  assert.deepEqual({ ...deleteDraft(d, "do-3", "DO-3") }, { s: "DO-9", u: "old" });
});

test("DELETE /:id runs the handback in the same batch as the delete", () => {
  const src = read("src/api/routes/delivery-orders.ts");
  const handler = src.slice(src.indexOf('app.delete("/:id"'));
  assert.match(handler, /SELECT id, status, doNo, salesOrderId FROM delivery_orders WHERE id = \?/);
  assert.match(handler, /prepare\(SO_DO_STAMP_HANDBACK_SQL\)/);
  assert.match(handler, /await c\.var\.DB\.batch\(statements\)/);
});
