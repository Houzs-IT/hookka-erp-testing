// ---------------------------------------------------------------------------
// cn-convert-guards.test.mjs — POST /api/consignment-notes/:id/convert-to-invoice
// and /:id/return against the REAL handlers with a fake DB (CI has no
// Postgres). The fake's batch() plays the one Postgres behaviour the race
// fix leans on: the first-statement guard raises (CAST of non-numeric text)
// when the CN was converted / changed after the handler read it.
//   1. two concurrent converts made two invoices and doubled outstandingSen
//   2. RETURNED lines (qty kept) were billed; RETURNED/CLOSED notes converted
//   3. a CN spanning two COs priced the other CO's lines at 0
//   4. /return on an invoiced CN left the invoice billing the returned goods
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

const { default: cnApp } = await import(
  pathToFileURL(resolve(process.cwd(), "src/api/routes/consignment-notes.ts")).href
);
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

function makeState(over = {}) {
  return {
    cn: {
      id: "cn-1", noteNumber: "CN-0001", status: "PARTIALLY_SOLD", convertedInvoiceId: null,
      consignmentOrderId: "co-1", customerId: "cust-1", ...over.cn,
    },
    items: over.items ?? [
      { id: "ci-1", consignmentNoteId: "cn-1", productCode: "P1", productName: "P1", quantity: 2, unitPrice: 0, status: "AT_BRANCH", productionOrderId: "po-1" },
    ],
    coItems: over.coItems ?? [{ consignmentOrderId: "co-1", productCode: "P1", unitPriceSen: 100 }],
    pos: over.pos ?? [{ id: "po-1", consignmentOrderId: "co-1" }],
    moveOnBeforeBatch: over.moveOnBeforeBatch ?? null,
  };
}

function makeDb(state) {
  const batches = [];
  function prepare(sql) {
    const q = norm(sql);
    const stmt = {
      sql: q, args: [],
      bind(...a) { stmt.args = a; return stmt; },
      async first() {
        if (/FROM consignment_notes WHERE id = \?/.test(q)) return { ...state.cn };
        return null;
      },
      async all() {
        if (/FROM consignment_items/.test(q)) return { results: state.items };
        if (/FROM consignment_order_items/.test(q)) {
          const one = /WHERE consignmentOrderId = \?/.test(q); // the old header-CO-only lookup
          return { results: one ? state.coItems.filter((r) => r.consignmentOrderId === stmt.args[0]) : state.coItems };
        }
        if (/FROM production_orders/.test(q)) return { results: state.pos };
        return { results: [] };
      },
      async run() { return { success: true, meta: { changes: 0 } }; },
    };
    return stmt;
  }
  return {
    batches,
    db: {
      prepare,
      async batch(stmts) {
        if (state.moveOnBeforeBatch) Object.assign(state.cn, state.moveOnBeforeBatch);
        const g = stmts.find((s) => /CN_CONVERT_CONFLICT/.test(s.sql));
        if (g) {
          const ok = state.cn.convertedInvoiceId == null &&
            (!/status IS NOT DISTINCT FROM/.test(g.sql) || (state.cn.status ?? null) === g.args[0]);
          if (!ok) throw new Error('invalid input syntax for type integer: "CN_CONVERT_CONFLICT cn-1"');
        }
        batches.push(stmts.map((s) => ({ sql: s.sql, args: s.args })));
        return stmts.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
      },
    },
  };
}

function post(state, path, body = {}) {
  const { db, batches } = makeDb(state);
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db); c.set("orgId", "hookka"); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "user-1");
    await next();
  });
  parent.route("/", cnApp);
  return parent
    .request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((res) => ({ res, batches }));
}
const convert = (over) => post(makeState(over), "/cn-1/convert-to-invoice");
const invItems = (b) => b.filter((s) => /^INSERT INTO invoice_items/.test(s.sql));
const bump = (b) => b.find((s) => /^UPDATE customers/.test(s.sql));

test("race: convert's first batch statement is a row-locked guard", async () => {
  const { res, batches } = await convert();
  assert.equal(res.status, 201, await res.text());
  assert.match(batches[0][0].sql, /CN_CONVERT_CONFLICT/);
  assert.match(batches[0][0].sql, /FOR UPDATE$/);
});

test("race: a convert that lost to another convert gets 409, no invoice, no A/R bump", async () => {
  const { res, batches } = await post(
    makeState({ moveOnBeforeBatch: { convertedInvoiceId: "inv-other" } }),
    "/cn-1/convert-to-invoice",
  );
  assert.equal(res.status, 409, await res.text());
  assert.equal(batches.length, 0);
});

test("returned lines are not billed, A/R bump is the billed total", async () => {
  const { res, batches } = await convert({
    items: [
      { id: "ci-1", productCode: "P1", productName: "P1", quantity: 2, unitPrice: 0, status: "AT_BRANCH", productionOrderId: "po-1" },
      { id: "ci-2", productCode: "P1", productName: "P1", quantity: 5, unitPrice: 0, status: "RETURNED", productionOrderId: "po-1" },
    ],
  });
  assert.equal(res.status, 201, await res.text());
  const rows = invItems(batches[0]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].args[6], 2);
  assert.equal(bump(batches[0]).args[0], 200);
});

for (const status of ["RETURNED", "CLOSED"]) {
  test(`a ${status} note cannot convert (409)`, async () => {
    const { res, batches } = await convert({ cn: { status } });
    assert.equal(res.status, 409, await res.text());
    assert.equal(batches.length, 0);
  });
}

test("a CN spanning two COs prices each line from its own CO", async () => {
  const { res, batches } = await convert({
    items: [
      { id: "ci-1", productCode: "P1", productName: "P1", quantity: 1, unitPrice: 0, status: "AT_BRANCH", productionOrderId: "po-1" },
      { id: "ci-2", productCode: "P2", productName: "P2", quantity: 1, unitPrice: 0, status: "AT_BRANCH", productionOrderId: "po-2" },
    ],
    coItems: [
      { consignmentOrderId: "co-1", productCode: "P1", unitPriceSen: 100 },
      { consignmentOrderId: "co-2", productCode: "P2", unitPriceSen: 300 },
    ],
    pos: [{ id: "po-1", consignmentOrderId: "co-1" }, { id: "po-2", consignmentOrderId: "co-2" }],
  });
  assert.equal(res.status, 201, await res.text());
  assert.deepEqual(invItems(batches[0]).map((s) => s.args[7]), [100, 300]);
  assert.equal(bump(batches[0]).args[0], 400);
});

test("/return on an invoiced CN is refused (409), nothing written", async () => {
  const { res, batches } = await post(
    makeState({ cn: { convertedInvoiceId: "inv-1", status: "FULLY_SOLD" } }),
    "/cn-1/return",
    { items: [{ id: "ci-1", quantity: 1 }] },
  );
  assert.equal(res.status, 409, await res.text());
  assert.equal(batches.length, 0);
});
