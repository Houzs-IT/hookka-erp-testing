// ---------------------------------------------------------------------------
// compliance-so-no-invoice-consolidated-do.test.mjs — BUG-2026-11-03-419 (HK-0127).
//
// The Daily Report's "SO Without Invoice" tile read 611 on production while
// every one of them sat on an invoiced DO. checkSoNoInvoice mapped each DO to
// ONE owning SO, so on a consolidated DO (several SOs via
// delivery_order_items.salesOrderNo) every SO but the last one written never
// saw the DO's invoice. A DO must clear every SO it carries, and a DO item's
// SO number must reach every SO row that shares it (SO-2512-368 is two rows).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { collectComplianceData } from "../src/api/lib/compliance-report.ts";

// SO-A is the DO's lead SO (delivery_orders.salesOrderId); SO-B and SO-C ride
// on the same DO through its items; so-D1 and so-D2 share the number SO-D.
// One invoice on the DO bills all five.
const SOS = [
  ["so-A", "SO-A"],
  ["so-B", "SO-B"],
  ["so-C", "SO-C"],
  ["so-D1", "SO-D"],
  ["so-D2", "SO-D"],
];
function db({ invoiced }) {
  const rows = (sql) => {
    if (/FROM sales_orders[\s\S]*status = 'DELIVERED'/.test(sql)) {
      return SOS.map(([id, no]) => ({
        id,
        companySOId: no,
        customerName: "Houzs Century",
        status: "DELIVERED",
      }));
    }
    if (/SELECT DISTINCT salesOrderId FROM invoices/.test(sql)) return [];
    if (/SELECT id, salesOrderId, deliveredAt FROM delivery_orders/.test(sql)) {
      return [{ id: "do-1", salesOrderId: "so-A", deliveredAt: "2026-10-01" }];
    }
    if (/FROM delivery_order_items[\s\S]*salesOrderNo IN/.test(sql)) {
      return ["SO-A", "SO-B", "SO-C", "SO-D"].map((no) => ({ deliveryOrderId: "do-1", salesOrderNo: no }));
    }
    if (/SELECT DISTINCT deliveryOrderId FROM invoices/.test(sql)) {
      return invoiced ? [{ deliveryOrderId: "do-1" }] : [];
    }
    if (/SELECT id, deliveredAt FROM delivery_orders/.test(sql)) {
      return [{ id: "do-1", deliveredAt: "2026-10-01" }];
    }
    return [];
  };
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              return { results: rows(sql) };
            },
            async first() {
              return null;
            },
          };
        },
      };
    },
  };
}

test("an invoice on a consolidated DO bills every SO on it", async () => {
  const d = await collectComplianceData(db({ invoiced: true }), "2026-11-03");
  assert.deepEqual(
    d.groups.soNoInvoice.map((r) => r.companySOId),
    [],
    "SO-B, SO-C and both SO-D rows ride on the invoiced DO and must not be flagged",
  );
  assert.equal(d.counts.soNoInvoice, 0);
});

test("an uninvoiced consolidated DO still flags all of its SOs", async () => {
  const d = await collectComplianceData(db({ invoiced: false }), "2026-11-03");
  assert.deepEqual(
    d.groups.soNoInvoice.map((r) => r.id).sort(),
    ["so-A", "so-B", "so-C", "so-D1", "so-D2"],
  );
  for (const r of d.groups.soNoInvoice) {
    assert.equal(r.days, 33, `${r.id} takes the DO's delivered date`);
  }
});
