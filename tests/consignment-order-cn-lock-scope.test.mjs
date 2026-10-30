// ---------------------------------------------------------------------------
// consignment-order-cn-lock-scope.test.mjs
//
// HK-0123 — CO-2610-022 (Houzs Century, CONFIRMED, no CN of its own) refused
// every edit with "Consignment Note CGN-2610-001 already exists". That CN
// belongs to CO-2610-002. checkConsignmentOrderLocked looked CNs up by the
// CO's customerId, a proxy from before consignment_notes.consignmentOrderId
// existed (mig 0066), so one CN for a customer locked all its later COs.
//
// Pinned against a fake DB holding two COs for the same customer, with a CN
// only on the first:
//   1. the CO with no CN is editable;
//   2. the CO the CN belongs to is still locked;
//   3. the same holds for the PO-side check.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));

const { checkConsignmentOrderLocked, checkProductionOrderLocked } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/lib/lock-helpers.ts")).href
);

const consignmentOrders = [
  { id: "co-002", customerId: "cust-1" },
  { id: "co-022", customerId: "cust-1" },
];
const consignmentNotes = [
  { noteNumber: "CGN-2610-001", customerId: "cust-1", consignmentOrderId: "co-002" },
];
const productionOrders = [
  { id: "po-a", salesOrderId: null, consignmentOrderId: "co-002", status: "PENDING" },
  { id: "po-b", salesOrderId: null, consignmentOrderId: "co-022", status: "PENDING" },
];

// Answers each lookup by what its WHERE clause names, so a query that keys on
// customerId gets the customer's CNs and one that keys on the CO gets the CO's.
function makeDb() {
  function prepare(sql) {
    const s = String(sql).replace(/\s+/g, " ");
    let bound = [];
    const rows = () => {
      if (/FROM production_orders WHERE id = \?/i.test(s)) {
        return productionOrders.filter((p) => p.id === bound[0]);
      }
      if (/FROM production_orders/i.test(s)) return [];
      if (/FROM consignment_notes WHERE consignmentOrderId = \?/i.test(s)) {
        return consignmentNotes.filter((n) => n.consignmentOrderId === bound[0]);
      }
      if (/FROM consignment_notes WHERE customerId IN/i.test(s)) {
        const co = consignmentOrders.find((o) => o.id === bound[0]);
        return consignmentNotes.filter((n) => n.customerId === co?.customerId);
      }
      throw new Error(`unexpected SQL: ${s}`);
    };
    const obj = {
      bind(...a) {
        bound = a;
        return obj;
      },
      async first() {
        return rows()[0] ?? null;
      },
    };
    return obj;
  }
  return { prepare };
}

test("a CO with no CN of its own is editable even when a sibling CO has one", async () => {
  assert.equal(await checkConsignmentOrderLocked(makeDb(), "co-022"), null);
});

test("the CO the CN belongs to stays locked", async () => {
  const msg = await checkConsignmentOrderLocked(makeDb(), "co-002");
  assert.match(msg ?? "", /CGN-2610-001/);
});

test("PO-side check follows the same CO scope", async () => {
  assert.equal(await checkProductionOrderLocked(makeDb(), "po-b"), null);
  assert.match((await checkProductionOrderLocked(makeDb(), "po-a")) ?? "", /CGN-2610-001/);
});
