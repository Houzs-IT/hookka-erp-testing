// ---------------------------------------------------------------------------
// do-reinvoice-keeps-number.test.mjs — HK-0126.
//
// DO-2610-124 was billed as INV-2610-084, reversed to dispatched (which voids
// the invoice), edited and delivered again. The re-bill came out as a new
// number, INV-2611-013, so the customer held two invoice numbers for one DO.
// The re-bill now takes the voided invoice's number back and moves the voided
// row to INV-2610-084-V1.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { reclaimVoidedInvoiceNo } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/routes/delivery-orders/_helpers.ts")).href
);
const { nextAfter } = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/doc-number.ts")).href
);

const NOW = "2026-11-02T03:00:00.000Z";
const doRow = { id: "do-124", customerId: "cust-1" };

function fakeDb({ invoices, eInvoices = [] }) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    prepare(sql) {
      const q = norm(sql);
      return {
        bind(...args) {
          return {
            sql: q,
            args,
            async first() {
              if (/FROM e_invoices WHERE invoiceId = \?/.test(q)) {
                return eInvoices.find((e) => e.invoiceId === args[0]) ?? null;
              }
              if (/SELECT COUNT\(\*\) AS c FROM invoices WHERE invoiceNo LIKE \?/.test(q)) {
                const head = args[0].replace(/%$/, "");
                return { c: invoices.filter((v) => v.invoiceNo.startsWith(head)).length };
              }
              throw new Error("unexpected first(): " + q);
            },
            async all() {
              if (/FROM invoices WHERE deliveryOrderId = \? ORDER BY updated_at DESC/.test(q)) {
                return {
                  results: invoices
                    .filter((v) => v.deliveryOrderId === args[0])
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
                };
              }
              throw new Error("unexpected all(): " + q);
            },
          };
        },
      };
    },
  };
}

const voided084 = {
  id: "inv-084",
  invoiceNo: "INV-2610-084",
  deliveryOrderId: "do-124",
  customerId: "cust-1",
  status: "CANCELLED",
  updatedAt: "2026-11-01T09:00:00.000Z",
};

test("a reversed DO re-bills under its voided invoice's number", async () => {
  const r = await reclaimVoidedInvoiceNo(fakeDb({ invoices: [voided084] }), doRow, NOW);
  assert.equal(r.invoiceNo, "INV-2610-084");
  assert.match(r.release.sql, /^UPDATE invoices SET invoiceNo = \?, updated_at = \? WHERE id = \?$/);
  assert.deepEqual(r.release.args, ["INV-2610-084-V1", NOW, "inv-084"]);
});

test("a second reversal moves the voided row to the next -V suffix", async () => {
  const invoices = [
    { ...voided084, id: "inv-084a", invoiceNo: "INV-2610-084-V1", updatedAt: "2026-11-02T03:00:00.000Z" },
    { ...voided084, id: "inv-084b", updatedAt: "2026-11-03T02:00:00.000Z" },
  ];
  const r = await reclaimVoidedInvoiceNo(fakeDb({ invoices }), doRow, NOW);
  assert.equal(r.invoiceNo, "INV-2610-084");
  assert.deepEqual(r.release.args, ["INV-2610-084-V2", NOW, "inv-084b"]);
});

test("no reuse while the DO still has a live invoice", async () => {
  const invoices = [voided084, { ...voided084, id: "inv-090", invoiceNo: "INV-2610-090", status: "SENT" }];
  assert.equal(await reclaimVoidedInvoiceNo(fakeDb({ invoices }), doRow, NOW), null);
});

test("no reuse when the DO moved to another customer", async () => {
  const r = await reclaimVoidedInvoiceNo(
    fakeDb({ invoices: [voided084] }),
    { ...doRow, customerId: "cust-2990" },
    NOW,
  );
  assert.equal(r, null);
});

test("no reuse when the voided number went to LHDN", async () => {
  const r = await reclaimVoidedInvoiceNo(
    fakeDb({ invoices: [voided084], eInvoices: [{ id: "einv-1", invoiceId: "inv-084" }] }),
    doRow,
    NOW,
  );
  assert.equal(r, null);
});

test("a DO never billed gets no reclaimed number", async () => {
  assert.equal(await reclaimVoidedInvoiceNo(fakeDb({ invoices: [] }), doRow, NOW), null);
});

test("the -V row does not disturb the next invoice number", () => {
  assert.equal(nextAfter("INV", "2610", "INV-2610-084-V1"), "INV-2610-085");
});
