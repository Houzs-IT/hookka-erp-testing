// ---------------------------------------------------------------------------
// hk0118-draft-do-delete-so-stamp.test.mjs — HK-0118.
//
// Siti deleted DRAFT DO-2610-110, but SV-2610-036 kept showing "Delivery Order
// DO-2610-110": DO create stamps sales_orders.hookkaDeliveryOrder and
// DELETE /:id never handed it back. The handback runs in the delete batch.
// (CI runs Node 20, which has no node:sqlite, so the SQL is pinned by shape.)
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const { SO_DO_STAMP_HANDBACK_SQL } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/routes/delivery-orders/_helpers.ts")).href
);
const sql = SO_DO_STAMP_HANDBACK_SQL.replace(/\s+/g, " ");

test("handback only touches an SO still carrying the deleted DO's number", () => {
  assert.match(sql, /UPDATE sales_orders SET hookkaDeliveryOrder = COALESCE\(/);
  assert.match(sql, /WHERE id = \? AND hookkaDeliveryOrder = \?$/);
});

test("the stamp goes to the newest remaining live DO of the same SO, else blank", () => {
  assert.match(
    sql,
    /SELECT d\.doNo FROM delivery_orders d WHERE d\.salesOrderId = \? AND d\.id <> \? AND d\.status <> 'CANCELLED' ORDER BY d\.created_at DESC LIMIT 1 \), ''\)/,
  );
  assert.match(sql, /updated_at = \?/, "bumps updated_at so list caches re-read the SO");
  assert.equal(sql.match(/\?/g).length, 5);
});

test("DELETE /:id runs the handback in the same batch, binds in the documented order", () => {
  const src = read("src/api/routes/delivery-orders.ts");
  const handler = src.slice(src.indexOf('app.delete("/:id"'));
  assert.match(handler, /SELECT id, status, doNo, salesOrderId FROM delivery_orders WHERE id = \?/);
  assert.match(
    handler,
    /prepare\(SO_DO_STAMP_HANDBACK_SQL\)\.bind\(\s*existing\.salesOrderId,\s*id,\s*new Date\(\)\.toISOString\(\),\s*existing\.salesOrderId,\s*existing\.doNo,\s*\)/,
  );
  assert.match(handler, /await c\.var\.DB\.batch\(statements\)/);
});
