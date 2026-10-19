// ---------------------------------------------------------------------------
// ap-invoices-cancelled-outstanding.test.mjs — BUG-2026-10-17-306.
//
// GET /api/accounting/ap-invoices gave every row outstandingSen = total − paid,
// whatever its status. A cancelled bill or purchase invoice therefore kept its
// face amount as "outstanding": the AP Invoices list showed it in the
// Outstanding column, and its "N shown · outstanding" line — the default All
// view — added every cancelled document in. The open totals on the cards only
// counted OPEN rows, so the two disagreed. Now only an open document owes
// anything; cancelled and paid rows carry 0. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}
register("./tests/_alias-loader.mjs", pathToFileURL("./"));

const src = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const { default: accountingApp } = await import(src("src/api/routes/accounting.ts"));

const BILLS = [
  { id: "b1", billNo: "OCB-1", partyId: "p1", partyName: "Lorry Co", billDate: "2026-05-01", referenceNo: "", description: "", totalSen: 100000, paidAmountSen: 0, status: "OPEN", lifecycleState: null },
  { id: "b2", billNo: "OCB-2", partyId: "p1", partyName: "Lorry Co", billDate: "2026-05-02", referenceNo: "", description: "", totalSen: 500000, paidAmountSen: 0, status: "OPEN", lifecycleState: "VOID" },
  { id: "b3", billNo: "OCB-3", partyId: "p1", partyName: "Lorry Co", billDate: "2026-05-03", referenceNo: "", description: "", totalSen: 70000, paidAmountSen: 70000, status: "PAID", lifecycleState: null },
];
const PIS = [
  { id: "pi1", pi_no: "PI-1", supplier_id: "s1", supplier_name: "Kayu Co", supplier_invoice_no: "K-1", invoice_date: "2026-05-04", due_date: null, amount_sen: 200000, paid_amount_sen: 50000, status: "APPROVED", is_opening: 0 },
  { id: "pi2", pi_no: "PI-2", supplier_id: "s1", supplier_name: "Kayu Co", supplier_invoice_no: "K-2", invoice_date: "2026-05-05", due_date: null, amount_sen: 700000, paid_amount_sen: 0, status: "CANCELLED", is_opening: 0 },
  { id: "pi3", pi_no: "PI-3", supplier_id: "s1", supplier_name: "Kayu Co", supplier_invoice_no: "K-3", invoice_date: "2026-05-06", due_date: null, amount_sen: 300000, paid_amount_sen: 300000, status: "PAID", is_opening: 0 },
];

function db() {
  return {
    prepare(sql) {
      const rows = () => (/FROM other_party_bills\b/i.test(sql) ? BILLS : /FROM purchase_invoices\b/i.test(sql) ? PIS : []);
      const obj = {
        bind() { return obj; },
        async first() { return rows()[0] ?? null; },
        async all() { return { results: rows() }; },
        async run() { return { success: true }; },
      };
      return obj;
    },
    batch: async () => [],
  };
}

function mount() {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db());
    c.set("orgId", "hookka");
    c.set("userRole", "SUPER_ADMIN");
    c.set("userId", "user-1");
    await next();
  });
  parent.route("/", accountingApp);
  return parent;
}

test("BUG-306: a cancelled bill or invoice owes nothing; open ones owe total − paid", async () => {
  const res = await mount().request("/ap-invoices");
  assert.equal(res.status, 200);
  const { data } = await res.json();
  const by = Object.fromEntries(data.rows.map((r) => [r.no, r]));
  assert.equal(by["OCB-2"].status, "CANCELLED");
  assert.equal(by["OCB-2"].outstandingSen, 0, "a voided bill is not owed");
  assert.equal(by["PI-2"].status, "CANCELLED");
  assert.equal(by["PI-2"].outstandingSen, 0, "a cancelled invoice is not owed");
  assert.equal(by["OCB-1"].outstandingSen, 100000);
  assert.equal(by["PI-1"].outstandingSen, 150000);
  assert.equal(by["OCB-3"].outstandingSen, 0);
  assert.equal(by["PI-3"].outstandingSen, 0);
  // The face amounts are still there for the Total column.
  assert.equal(by["PI-2"].totalSen, 700000);
});

test("BUG-306: the All view's outstanding equals the open total on the cards", async () => {
  const { data } = await (await mount().request("/ap-invoices")).json();
  const shown = data.rows.reduce((s, r) => s + r.outstandingSen, 0);
  assert.equal(data.totals.openSen, 250000);
  assert.equal(shown, data.totals.openSen);
  assert.equal(data.totals.apOpenSen, 100000);
  assert.equal(data.totals.piOpenSen, 150000);
  assert.equal(data.totals.openCount, 2);
});
