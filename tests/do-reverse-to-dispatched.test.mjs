// ---------------------------------------------------------------------------
// do-reverse-to-dispatched.test.mjs — HK-0111.
//
// Siti (Hookka office): a DO gets marked DELIVERED while some pieces never
// reached the customer. Until now the only way out was void the invoice +
// cancel the DO + raise a NEW DO, so the DO number changed. Reverse to
// Dispatched steps the DO back to LOADED under the same number.
//
// What this file pins:
//   • the un-delivery undoes only the DELIVERED leg (fg_units stay on the DO,
//     COGS comes back, SO back to SHIPPED, DO back to LOADED);
//   • the COGS ledger is read NET of earlier reversals, so deliver → reverse →
//     deliver → reverse (or → cancel) never credits or skips a slice twice;
//   • the route voids the unpaid invoice in the same batch and refuses, writing
//     nothing, when it cannot (payment, issued note, e-invoice, return).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ROUTE = read("src/api/routes/delivery-orders.ts");
const INVOICES = read("src/api/routes/invoices.ts");
const MENU = read("src/pages/delivery/index.tsx");

const mod = (p) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const { buildDoUndeliverStatements } = await mod("src/api/routes/delivery-orders/_helpers.ts");
const { consumeFGBatchesForDO, reverseFGForDoUndeliver, reverseFGForDoCancel } = await mod(
  "src/api/lib/do-cost-cascade.ts",
);
const { SYSTEM_ACTOR: ACTOR } = await mod("src/api/lib/fg-stock-events.ts");

function fakeDb({
  deliveryOrders = [],
  salesOrders = [],
  doItems = [],
  prodOrders = [],
  fgUnits = [],
  costLedger = [],
  invoices = [],
} = {}) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    prepare(sql) {
      const q = norm(sql);
      return {
        async run() {
          return { success: true };
        },
        bind(...args) {
          return {
            sql: q,
            args,
            async first() {
              if (/COUNT\(\*\) AS n FROM cost_ledger WHERE refType = 'DELIVERY_ORDER_CANCEL'/.test(q)) {
                return { n: costLedger.filter((r) => r.refType === "DELIVERY_ORDER_CANCEL" && r.refId === args[0]).length };
              }
              if (/FROM sales_orders WHERE id = \?/.test(q)) {
                return salesOrders.find((s) => s.id === args[0]) ?? null;
              }
              if (/FROM delivery_orders WHERE id IN .* status IN \('DELIVERED','INVOICED'\)/.test(q)) {
                return deliveryOrders.find((d) => args.includes(d.id) && ["DELIVERED", "INVOICED"].includes(d.status)) ?? null;
              }
              throw new Error("unexpected first() query: " + q);
            },
            async all() {
              if (/FROM fg_units WHERE doId = \? AND status = 'DELIVERED'/.test(q)) {
                return { results: fgUnits.filter((u) => u.doId === args[0] && u.status === "DELIVERED") };
              }
              if (/FROM cost_ledger WHERE refType = 'DELIVERY_ORDER' AND refId = \? AND type = 'FG_DELIVERED'/.test(q)) {
                return {
                  results: costLedger.filter(
                    (r) => r.refType === "DELIVERY_ORDER" && r.refId === args[0] && r.type === "FG_DELIVERED",
                  ),
                };
              }
              if (/FROM cost_ledger WHERE refType = 'DELIVERY_ORDER_UNDELIVER' AND refId = \?/.test(q)) {
                return {
                  results: costLedger.filter((r) => r.refType === "DELIVERY_ORDER_UNDELIVER" && r.refId === args[0]),
                };
              }
              if (/po\.salesOrderId AS soId/.test(q)) {
                const ids = new Set();
                for (const di of doItems.filter((d) => d.deliveryOrderId === args[0])) {
                  const po = prodOrders.find((p) => p.id === di.productionOrderId);
                  if (po?.salesOrderId) ids.add(po.salesOrderId);
                }
                return { results: [...ids].map((soId) => ({ soId })) };
              }
              if (/SELECT id AS "doId" FROM delivery_orders WHERE salesOrderId = \?/.test(q)) {
                return { results: deliveryOrders.filter((d) => d.salesOrderId === args[0]).map((d) => ({ doId: d.id })) };
              }
              if (/SELECT DISTINCT di\.deliveryOrderId AS "doId"/.test(q)) {
                const ids = new Set();
                for (const po of prodOrders.filter((p) => p.salesOrderId === args[0])) {
                  for (const di of doItems.filter((d) => d.productionOrderId === po.id)) {
                    if (di.deliveryOrderId) ids.add(di.deliveryOrderId);
                  }
                }
                return { results: [...ids].map((doId) => ({ doId })) };
              }
              if (/FROM invoices WHERE status != 'CANCELLED' AND \(salesOrderId = \? OR deliveryOrderId = \?\)/.test(q)) {
                return {
                  results: invoices.filter(
                    (i) => i.status !== "CANCELLED" && (i.salesOrderId === args[0] || i.deliveryOrderId === args[1]),
                  ),
                };
              }
              throw new Error("unexpected all() query: " + q);
            },
          };
        },
      };
    },
  };
}

// One DO carrying one PO of one SO, delivered and auto-invoiced (unpaid).
const invoiced = (over = {}) => ({
  deliveryOrders: [{ id: "do-1", doNo: "DO-2610-001", status: "INVOICED", salesOrderId: "so-1" }],
  salesOrders: [{ id: "so-1", status: "INVOICED" }],
  doItems: [{ deliveryOrderId: "do-1", productionOrderId: "po-1" }],
  prodOrders: [{ id: "po-1", salesOrderId: "so-1" }],
  fgUnits: [
    { id: "fgu-1", doId: "do-1", poId: "po-1", status: "DELIVERED", productCode: "BF-A", batchId: "b-1" },
    { id: "fgu-2", doId: "do-1", poId: "po-1", status: "DELIVERED", productCode: "BF-A", batchId: "b-1" },
  ],
  costLedger: [
    { refType: "DELIVERY_ORDER", refId: "do-1", type: "FG_DELIVERED", itemId: "prod-a", batchId: "b-1", qty: 2, unitCostSen: 15000 },
  ],
  invoices: [{ id: "inv-1", deliveryOrderId: "do-1", salesOrderId: "so-1", status: "SENT" }],
  ...over,
});

const doArgs = { id: "do-1", doNo: "DO-2610-001", salesOrderId: "so-1" };
const NOW = "2026-10-22T00:00:00.000Z";
const sqlOf = (stmts) => stmts.map((s) => s.sql);

// ── The un-delivery itself ─────────────────────────────────────────────────

test("fg_units go DELIVERED → LOADED and stay on the DO — the goods did leave", async () => {
  const r = await buildDoUndeliverStatements(fakeDb(invoiced()), doArgs, ["inv-1"], ACTOR, NOW);
  const stmt = r.statements.find((s) => /UPDATE fg_units/.test(s.sql));
  assert.match(stmt.sql, /status = 'LOADED', deliveredAt = NULL/);
  assert.match(stmt.sql, /WHERE doId = \? AND status = 'DELIVERED'/);
  assert.doesNotMatch(stmt.sql, /doId = NULL/, "dispatch stands; only cancel releases the units");
  const events = r.statements.filter((s) => /INSERT INTO fg_stock_events/.test(s.sql));
  assert.equal(events.length, 2, "one append-only event per unit");
});

test("the FIFO COGS comes back as DELIVERY_ORDER_UNDELIVER rows", async () => {
  const r = await buildDoUndeliverStatements(fakeDb(invoiced()), doArgs, ["inv-1"], ACTOR, NOW);
  const back = r.statements.find((s) => /UPDATE fg_batches SET remainingQty = remainingQty \+ \?/.test(s.sql));
  assert.deepEqual(back.args, [2, "b-1"]);
  const rev = r.statements.find((s) => /INSERT INTO cost_ledger/.test(s.sql));
  assert.ok(rev.args.includes("DELIVERY_ORDER_UNDELIVER"));
  assert.equal(r.reversedCogsSen, 30000);
});

test("the SO goes back to SHIPPED — what dispatch left it at — audited", async () => {
  const r = await buildDoUndeliverStatements(fakeDb(invoiced()), doArgs, ["inv-1"], ACTOR, NOW);
  assert.ok(
    sqlOf(r.statements).some((s) =>
      /UPDATE sales_orders SET status = 'SHIPPED'.*status IN \('DELIVERED','INVOICED'\)/.test(s),
    ),
  );
  const audit = r.statements.find((s) => /INSERT INTO so_status_changes/.test(s.sql));
  assert.ok(audit.args.includes("INVOICED") && audit.args.includes("SHIPPED"));
  assert.deepEqual(r.releasedSoIds, ["so-1"]);
});

test("the DO goes back to LOADED with its delivery stamps cleared, written last", async () => {
  const r = await buildDoUndeliverStatements(fakeDb(invoiced()), doArgs, ["inv-1"], ACTOR, NOW);
  const last = r.statements[r.statements.length - 1];
  assert.match(last.sql, /UPDATE delivery_orders SET status = 'LOADED'/);
  assert.match(last.sql, /deliveredAt = NULL/);
  assert.match(last.sql, /deliveredEmailAt = NULL/, "the corrected invoice must be able to email again");
  assert.match(last.sql, /WHERE id = \? AND status IN \('DELIVERED','INVOICED'\)/);
});

test("an SO still billed by an invoice this reversal does not void keeps its status", async () => {
  const d = invoiced();
  d.invoices.push({ id: "inv-2", deliveryOrderId: "do-9", salesOrderId: "so-1", status: "SENT" });
  const r = await buildDoUndeliverStatements(fakeDb(d), doArgs, ["inv-1"], ACTOR, NOW);
  assert.deepEqual(r.releasedSoIds, []);
  assert.equal(sqlOf(r.statements).filter((s) => /UPDATE sales_orders/.test(s)).length, 0);
});

test("an SO with another delivered DO keeps its status", async () => {
  const d = invoiced();
  d.deliveryOrders.push({ id: "do-2", doNo: "DO-2610-002", status: "DELIVERED", salesOrderId: "so-1" });
  const r = await buildDoUndeliverStatements(fakeDb(d), doArgs, ["inv-1"], ACTOR, NOW);
  assert.deepEqual(r.releasedSoIds, []);
});

// ── The ledger is read net of earlier reversals ────────────────────────────

const afterReversal = () => {
  const d = invoiced();
  d.costLedger.push({ refType: "DELIVERY_ORDER_UNDELIVER", refId: "do-1", type: "ADJUSTMENT", itemId: "prod-a", batchId: "b-1", qty: 2 });
  return d;
};

test("a second reversal of the same delivery credits nothing", async () => {
  const r = await reverseFGForDoUndeliver(fakeDb(afterReversal()), "do-1", "DO-2610-001", NOW);
  assert.equal(r.reversedCogsSen, 0);
  assert.equal(r.statements.length, 0);
});

test("re-delivering a reversed DO consumes FG again instead of skipping", async () => {
  const before = await consumeFGBatchesForDO(fakeDb(invoiced()), "do-1", "DO-2610-001", [], NOW);
  assert.equal(before.skipped, true, "a delivered DO is not consumed twice");
  const after = await consumeFGBatchesForDO(fakeDb(afterReversal()), "do-1", "DO-2610-001", [], NOW);
  assert.equal(after.skipped, false, "the corrected delivery must carry its own COGS");
});

test("cancelling after a reversal does not credit the reversed slices again", async () => {
  const r = await reverseFGForDoCancel(fakeDb(afterReversal()), "do-1", "DO-2610-001", NOW);
  assert.equal(r.reversedCogsSen, 0);
});

test("deliver → reverse → deliver again: the next reversal hands back only the live delivery", async () => {
  const d = afterReversal();
  d.costLedger.push({ refType: "DELIVERY_ORDER", refId: "do-1", type: "FG_DELIVERED", itemId: "prod-a", batchId: "b-2", qty: 1, unitCostSen: 16000 });
  const r = await reverseFGForDoUndeliver(fakeDb(d), "do-1", "DO-2610-001", NOW);
  assert.equal(r.reversedCogsSen, 16000);
  const back = r.statements.find((s) => /UPDATE fg_batches/.test(s.sql));
  assert.deepEqual(back.args, [1, "b-2"]);
});

// ── The route: one batch, and refusals that write nothing ──────────────────

const routeBody = ROUTE.slice(
  ROUTE.indexOf('app.post("/:id/reverse-to-dispatched"'),
  ROUTE.indexOf("// GET /api/delivery-orders/:id/qr-token"),
);

test("only a delivered DO can be reversed", () => {
  assert.match(routeBody, /existing\.status !== "DELIVERED" && existing\.status !== "INVOICED"/);
});

test("it refuses on a payment, an issued note, an e-invoice at LHDN or a Delivery Return", () => {
  assert.match(routeBody, /PAID.*PARTIAL_PAID.*paidAmount/s);
  assert.match(routeBody, /issuedNotesOnInvoice/);
  assert.match(routeBody, /FROM e_invoices WHERE invoiceId = \? AND status IN \('SUBMITTED','VALID'\)/);
  assert.match(routeBody, /FROM delivery_returns WHERE delivery_order_id = \?/);
  assert.ok(
    routeBody.indexOf("409") < routeBody.indexOf("c.var.DB.batch"),
    "every refusal returns before the batch",
  );
});

test("voiding needs invoices:void, on top of delivery-orders:update", () => {
  assert.match(routeBody, /requirePermission\(c, "delivery-orders", "update"\)/);
  assert.match(routeBody, /requirePermission\(c, "invoices", "void"\)/);
});

test("the invoice void and the un-delivery land in ONE batch, void first", () => {
  const voidAt = routeBody.indexOf("buildInvoiceVoidStatements(");
  const undoAt = routeBody.indexOf("buildDoUndeliverStatements(");
  assert.ok(voidAt > 0 && undoAt > voidAt);
  assert.equal(routeBody.match(/c\.var\.DB\.batch\(/g).length, 1);
});

test("the invoice page's void and the reversal share one void builder", () => {
  assert.match(INVOICES, /export async function buildInvoiceVoidStatements/);
  assert.match(INVOICES, /const voided = await buildInvoiceVoidStatements\(c, existing, afterSnapshot, now\)/);
});

test("the row menu offers it on DELIVERED / INVOICED rows", () => {
  const item = MENU.slice(MENU.indexOf('label: "Reverse to Dispatched"'));
  assert.match(item, /\/reverse-to-dispatched/);
  assert.match(item.slice(0, 2600), /row\.status !== "DELIVERED" && row\.status !== "INVOICED"/);
});
