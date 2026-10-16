// Per-line-item Detail Listing exports for PO / GRN / DO
// (src/lib/doc-detail-listings.ts). Same contract as the SO detail listing:
// one row per line item, document header repeated, money sen→RM as numbers.
// HK-0002: every listing leads with the shared column contract, so cells are
// read by HEADER NAME, never by position.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const d = await import(pathToFileURL(resolve(process.cwd(), "src/lib/doc-detail-listings.ts")).href);

const at = (aoa, row, name) => aoa[row][aoa[0].indexOf(name)];

test("PO detail: one row per item, header repeated, money sen→RM", () => {
  const aoa = d.buildPoDetailListingAoa([
    {
      poNo: "PO-1", orderDate: "2026-05-01T00:00:00Z", supplierId: "sup-1", supplierName: "Foam Co",
      status: "CONFIRMED", totalSen: 150000,
      items: [
        { id: "poi-1", materialCategory: "FOAM", materialCode: "F-1", supplierSKU: "SKU-1", materialName: "D40 Foam", unit: "SHEET", quantity: 10, unitPriceSen: 12000, totalSen: 120000, receivedQty: 4 },
        { id: "poi-2", materialCode: "F-2", materialName: "Spring", quantity: 2, unitPriceSen: 15000, totalSen: 30000, receivedQty: 0 },
      ],
    },
  ], new Map([["sup-1", "400-F001"]]));
  assert.deepEqual(aoa[0], [...d.PO_DETAIL_HEADERS]);
  assert.equal(aoa.length, 3);
  assert.equal(at(aoa, 1, "Doc Type"), "PO");
  assert.equal(at(aoa, 1, "Doc No."), "PO-1"); assert.equal(at(aoa, 2, "Doc No."), "PO-1");
  assert.equal(at(aoa, 1, "Doc Date"), "2026-05-01");
  assert.equal(at(aoa, 1, "Party Code"), "400-F001");
  assert.equal(at(aoa, 1, "Line ID"), "poi-1");
  assert.equal(at(aoa, 1, "Doc Total"), 1500);
  assert.equal(at(aoa, 1, "Unit Price"), 120);
  assert.equal(at(aoa, 1, "Discount"), "", "PO lines carry no discount — blank, not 0");
  assert.equal(at(aoa, 1, "Line Total"), 1200);
  assert.equal(at(aoa, 1, "Received Qty"), 4);
});

test("GRN detail: line total = accepted × unit price, sen→RM", () => {
  const aoa = d.buildGrnDetailListingAoa([
    {
      grnNumber: "GRN-1", receiveDate: "2026-05-02T00:00:00Z", poNumber: "PO-1", supplierName: "Foam Co", status: "POSTED",
      items: [
        { id: "gi-1", materialCode: "F-1", supplierSKU: "SKU-1", materialName: "D40 Foam", orderedQty: 10, receivedQty: 10, acceptedQty: 8, rejectedQty: 2, rejectionReason: "wet", unitPrice: 12000 },
      ],
    },
  ]);
  assert.deepEqual(aoa[0], [...d.GRN_DETAIL_HEADERS]);
  assert.equal(at(aoa, 1, "Doc No."), "GRN-1");
  assert.equal(at(aoa, 1, "Doc Date"), "2026-05-02");
  assert.equal(at(aoa, 1, "Ref Doc No."), "PO-1");
  assert.equal(at(aoa, 1, "Party Code"), "", "no lookup → blank, never invented");
  assert.equal(at(aoa, 1, "Qty"), 8, "Qty is the accepted quantity");
  assert.equal(at(aoa, 1, "Rejected Qty"), 2);
  assert.equal(at(aoa, 1, "Rejection Reason"), "wet");
  assert.equal(at(aoa, 1, "Unit Price"), 120);
  assert.equal(at(aoa, 1, "Line Total"), 960);
});

test("DO detail: per-line SO refs, no price = blank, item-less DO still yields a row", () => {
  const aoa = d.buildDoDetailListingAoa([
    {
      doNo: "DO-1", dispatchDate: "2026-05-03T00:00:00Z", customerId: "c-1", customerName: "Acme", status: "DISPATCHED",
      items: [
        { id: "doi-1", salesOrderNo: "SO-9", customerPOId: "CPO-9", productCode: "P-1", productName: "Sofa", sizeLabel: "3S", fabricCode: "FB-1", quantity: 1, itemM3: 1.2, rackingNumber: "R1" },
      ],
    },
    { doNo: "DO-2", status: "PENDING", items: [] },
  ], new Map([["c-1", "300-A001"]]));
  assert.deepEqual(aoa[0], [...d.DO_DETAIL_HEADERS]);
  assert.equal(aoa.length, 3, "header + DO-1 line + DO-2 placeholder");
  assert.equal(at(aoa, 1, "Ref Doc No."), "SO-9");
  assert.equal(at(aoa, 1, "Party Code"), "300-A001");
  assert.equal(at(aoa, 1, "Qty"), 1);
  assert.equal(at(aoa, 1, "M3"), 1.2);
  assert.equal(at(aoa, 1, "Unit Price"), "", "DO lines carry no price");
  assert.equal(at(aoa, 1, "Line Total"), "");
  assert.equal(at(aoa, 2, "Doc No."), "DO-2"); // placeholder row keeps the header
});

test("PI detail: shared block + PI columns", () => {
  const aoa = d.buildPiDetailListingAoa([
    {
      piNo: "PI-1", invoiceDate: "2026-05-04", dueDate: "2026-06-03T00:00:00Z", poRef: "PO-1", supplierId: "s1",
      supplierName: "Foam Co", supplierInvoiceNo: "INV-77", status: "POSTED", amountSen: 106000,
      items: [{ id: "pii-1", materialCode: "F-1", materialName: "D40", qty: 5, unitPriceSen: 20000, discountSen: 0, taxSen: 6000, lineTotalSen: 100000, lineType: "ITEM" }],
    },
  ], new Map([["s1", "400-F001"]]));
  assert.deepEqual(aoa[0], [...d.PI_DETAIL_HEADERS]);
  assert.equal(at(aoa, 1, "Doc Type"), "PI");
  assert.equal(at(aoa, 1, "Ref Doc No."), "PO-1");
  assert.equal(at(aoa, 1, "Party Code"), "400-F001");
  assert.equal(at(aoa, 1, "Discount"), 0, "a stored 0 discount is 0, not blank");
  assert.equal(at(aoa, 1, "Line Total"), 1000);
  assert.equal(at(aoa, 1, "Due Date"), "2026-06-03");
  assert.equal(at(aoa, 1, "Tax"), 60);
});
