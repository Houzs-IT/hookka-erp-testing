// ---------------------------------------------------------------------------
// do-removed-order-unship.test.mjs — an order taken off a delivery order at or
// after dispatch goes back to READY_TO_SHIP, never SHIPPED.
//
// Prod, 10 Nov 2026: DO-2611-026 was dispatched from the scan page with three
// orders unticked under "Adjust load". The dispatch cascade read the DO's OLD
// item rows (the DELETE/INSERT only rides the batch), so SO-2610-074/-077/-189
// went SHIPPED while on no delivery order. Owner, 11 Nov 2026: "Should go back".
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HELPERS_PATH = resolve(process.cwd(), "src/api/routes/delivery-orders/_helpers.ts");
const { buildDoItemEditSoStatements } = await import(pathToFileURL(HELPERS_PATH).href);

// A fake D1 answering the reads the builder makes, from plain arrays.
// doItems are the rows in the DB BEFORE the save (the edit is not applied yet).
function fakeDb({ deliveryOrders = [], salesOrders = [], doItems = [], prodOrders = [] }) {
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
              if (/FROM sales_orders WHERE id = \?/.test(q)) {
                return salesOrders.find((s) => s.id === args[0]) ?? null;
              }
              if (/FROM delivery_orders WHERE id IN/.test(q)) {
                return (
                  deliveryOrders.find(
                    (d) => args.includes(d.id) && ["LOADED", "IN_TRANSIT", "DELIVERED", "INVOICED"].includes(d.status),
                  ) ?? null
                );
              }
              throw new Error("unexpected first(): " + q);
            },
            async all() {
              if (/po\.salesOrderId AS soId/.test(q)) {
                const ids = new Set();
                for (const di of doItems.filter((d) => d.deliveryOrderId === args[0])) {
                  const po = prodOrders.find((p) => p.id === di.productionOrderId);
                  if (po?.salesOrderId) ids.add(po.salesOrderId);
                }
                return { results: [...ids].map((soId) => ({ soId })) };
              }
              if (/SELECT DISTINCT salesOrderId AS "soId" FROM production_orders WHERE id IN/.test(q)) {
                const ids = new Set(prodOrders.filter((p) => args.includes(p.id)).map((p) => p.salesOrderId));
                return { results: [...ids].map((soId) => ({ soId })) };
              }
              if (/SELECT id AS "doId" FROM delivery_orders WHERE salesOrderId = \?/.test(q)) {
                return { results: deliveryOrders.filter((d) => d.salesOrderId === args[0]).map((d) => ({ doId: d.id })) };
              }
              if (/SELECT DISTINCT di\.deliveryOrderId AS "doId"/.test(q)) {
                const ids = new Set();
                for (const po of prodOrders.filter((p) => p.salesOrderId === args[0])) {
                  for (const di of doItems.filter((d) => d.productionOrderId === po.id)) ids.add(di.deliveryOrderId);
                }
                return { results: [...ids].map((doId) => ({ doId })) };
              }
              throw new Error("unexpected all(): " + q);
            },
          };
        },
      };
    },
  };
}

const NOW = "2026-11-11T00:00:00.000Z";
const DO = { id: "do-1", doNo: "DO-2611-026", salesOrderId: null };

// SO ids each statement moves, by target status.
function moves(stmts) {
  const out = { SHIPPED: [], READY_TO_SHIP: [] };
  for (const s of stmts) {
    const m = /^UPDATE sales_orders SET status = '(\w+)'/.exec(s.sql);
    if (m) out[m[1]].push(s.args[1]);
  }
  return out;
}
const audits = (stmts) => stmts.filter((s) => /INSERT INTO so_status_changes/.test(s.sql)).map((s) => s.args.slice(1, 4));

// Two orders on one DO: so-a (po-a) and so-b (po-b).
const twoOrders = (doStatus, soStatus) => ({
  deliveryOrders: [{ id: "do-1", doNo: "DO-2611-026", status: doStatus, salesOrderId: null }],
  salesOrders: [
    { id: "so-a", status: soStatus },
    { id: "so-b", status: soStatus },
  ],
  doItems: [
    { deliveryOrderId: "do-1", productionOrderId: "po-a" },
    { deliveryOrderId: "do-1", productionOrderId: "po-b" },
  ],
  prodOrders: [
    { id: "po-a", salesOrderId: "so-a" },
    { id: "po-b", salesOrderId: "so-b" },
  ],
});

test("dispatch with one order unticked ships only the order still on the DO", async () => {
  const db = fakeDb(twoOrders("DRAFT", "READY_TO_SHIP"));
  const stmts = await buildDoItemEditSoStatements(db, DO, "DRAFT", "LOADED", ["po-a"], NOW);
  assert.deepEqual(moves(stmts), { SHIPPED: ["so-a"], READY_TO_SHIP: [] });
  assert.deepEqual(audits(stmts), [["so-a", "READY_TO_SHIP", "SHIPPED"]]);
});

test("dispatch with no item edit still ships every order on the DO", async () => {
  const db = fakeDb(twoOrders("DRAFT", "READY_TO_SHIP"));
  const stmts = await buildDoItemEditSoStatements(db, DO, "DRAFT", "LOADED", null, NOW);
  assert.deepEqual(moves(stmts).SHIPPED.sort(), ["so-a", "so-b"]);
});

test("office removal of an order from a LOADED DO sends it back to READY_TO_SHIP, audited", async () => {
  const db = fakeDb(twoOrders("LOADED", "SHIPPED"));
  const stmts = await buildDoItemEditSoStatements(db, DO, "LOADED", "LOADED", ["po-a"], NOW);
  assert.deepEqual(moves(stmts), { SHIPPED: [], READY_TO_SHIP: ["so-b"] });
  assert.deepEqual(audits(stmts), [["so-b", "SHIPPED", "READY_TO_SHIP"]]);
  const upd = stmts.find((s) => /READY_TO_SHIP/.test(s.sql) && /^UPDATE/.test(s.sql));
  assert.match(upd.sql, /AND status = 'SHIPPED'/, "a concurrent writer that got there first must win");
});

test("an order with pieces on two dispatched DOs stays SHIPPED when taken off one", async () => {
  const base = twoOrders("LOADED", "SHIPPED");
  // so-b also has po-b2 on do-2, already dispatched.
  base.deliveryOrders.push({ id: "do-2", doNo: "DO-2611-027", status: "LOADED", salesOrderId: null });
  base.prodOrders.push({ id: "po-b2", salesOrderId: "so-b" });
  base.doItems.push({ deliveryOrderId: "do-2", productionOrderId: "po-b2" });
  const stmts = await buildDoItemEditSoStatements(fakeDb(base), DO, "LOADED", "LOADED", ["po-a"], NOW);
  assert.deepEqual(moves(stmts), { SHIPPED: [], READY_TO_SHIP: [] });

  // …but if that other DO is still DRAFT, nothing of so-b has left: back it goes.
  base.deliveryOrders[1].status = "DRAFT";
  const stmts2 = await buildDoItemEditSoStatements(fakeDb(base), DO, "LOADED", "LOADED", ["po-a"], NOW);
  assert.deepEqual(moves(stmts2).READY_TO_SHIP, ["so-b"]);
});

test("an order with another piece still on THIS DO stays SHIPPED", async () => {
  const base = twoOrders("LOADED", "SHIPPED");
  base.prodOrders.push({ id: "po-b2", salesOrderId: "so-b" });
  base.doItems.push({ deliveryOrderId: "do-1", productionOrderId: "po-b2" });
  const stmts = await buildDoItemEditSoStatements(fakeDb(base), DO, "LOADED", "LOADED", ["po-a", "po-b2"], NOW);
  assert.deepEqual(moves(stmts), { SHIPPED: [], READY_TO_SHIP: [] });
});

test("DELIVERED / INVOICED / CLOSED orders are never touched by a removal", async () => {
  for (const st of ["DELIVERED", "INVOICED", "CLOSED"]) {
    const stmts = await buildDoItemEditSoStatements(fakeDb(twoOrders("DELIVERED", st)), DO, "DELIVERED", "DELIVERED", ["po-a"], NOW);
    assert.deepEqual(stmts, [], st);
  }
});

test("a DRAFT edit and an un-dispatch leave SO status to their own paths", async () => {
  const db = fakeDb(twoOrders("DRAFT", "READY_TO_SHIP"));
  assert.deepEqual(await buildDoItemEditSoStatements(db, DO, "DRAFT", "DRAFT", ["po-a"], NOW), []);
  const db2 = fakeDb(twoOrders("LOADED", "SHIPPED"));
  assert.deepEqual(await buildDoItemEditSoStatements(db2, DO, "LOADED", "DRAFT", ["po-a"], NOW), []);
});

test("the shared DO update core feeds the builder the NEW item set", () => {
  const src = readFileSync(HELPERS_PATH, "utf8");
  assert.match(
    src,
    /buildDoItemEditSoStatements\(\s*c\.var\.DB,\s*existing,\s*existing\.status,\s*nextStatus,\s*newItems \? newItems\.map\(\(i\) => i\.productionOrderId\) : null,/,
    "applyDeliveryOrderUpdate (office PUT + QR dispatch) must cascade from the post-edit items",
  );
});
