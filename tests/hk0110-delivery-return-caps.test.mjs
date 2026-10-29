// ---------------------------------------------------------------------------
// BUG-2026-10-20-349 / HK-0110 — one delivered item could be returned twice.
// Creating a delivery return never checked the returned quantity against the
// DO line or earlier returns, a missing quantity was saved as 1 and zero /
// negative went through, and a RETURNED_TO_STOCK return could be cancelled
// with no reversal. Drives the real createDeliveryReturnRecord on a stateful
// fake DB (made-up data, shaped like DO-2610-071 / SO-2610-095-01 qty 1).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryReturnRecord } from "../src/api/lib/delivery-return-create.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// doLines: delivery_order_items of do-1. returned: stored delivery_return_items.
function fakeDb({ doLines = [{ poId: "po-1", quantity: 1 }], batchError = null } = {}) {
  const returned = [];
  const batches = [];
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async run() { return { success: true }; },
    async first() {
      if (/SELECT COUNT\(\*\) AS n FROM delivery_order_items/.test(sql)) return { n: doLines.length };
      return null; // DO / SO snapshot, last return number
    },
    async all() {
      if (/FROM delivery_order_items WHERE deliveryOrderId = \? AND productionOrderId IN/.test(sql)) {
        return { results: doLines.filter((l) => args.slice(1).includes(l.poId)) };
      }
      if (/FROM delivery_return_items dri/.test(sql)) {
        const by = new Map();
        for (const r of returned) by.set(r.poId, (by.get(r.poId) ?? 0) + r.quantity);
        return { results: [...by].map(([poId, qty]) => ({ poId, qty })) };
      }
      return { results: [] }; // production_orders enrichment
    },
  });
  return {
    returned,
    batches,
    prepare: (sql) => stmt(sql.replace(/\s+/g, " ").trim()),
    async batch(stmts) {
      batches.push(stmts.map((s) => s.sql));
      if (batchError) throw new Error(batchError);
      for (const s of stmts) {
        if (/INSERT INTO delivery_return_items/.test(s.sql)) {
          returned.push({ poId: s.args[2], quantity: s.args[7] });
        }
      }
      return stmts.map(() => ({ success: true }));
    },
  };
}

const create = (db, items) => createDeliveryReturnRecord(db, "org-1", { doId: "do-1", items });
const line = (extra) => ({ productionOrderId: "po-1", productCode: "BED", ...extra });

test("a DO line of qty 1 can be returned once, not twice", async () => {
  const db = fakeDb();
  const first = await create(db, [line({ quantity: 1 })]);
  assert.equal(first?.ok, true);
  const second = await create(db, [line({ quantity: 1 })]);
  assert.equal(second?.ok, false, "the second return of the same item must be refused");
  assert.match(second.error, /Return exceeds what was delivered/);
  assert.equal(db.returned.length, 1);
});

test("a return larger than the DO line is refused", async () => {
  const db = fakeDb();
  const out = await create(db, [line({ quantity: 2 })]);
  assert.equal(out?.ok, false);
  assert.deepEqual(db.returned, []);
});

test("missing, zero, negative and non-numeric quantities are refused with 400; nothing is written", async () => {
  for (const quantity of [undefined, null, 0, -1, "abc", Infinity]) {
    const db = fakeDb();
    const out = await create(db, [line({ quantity })]);
    assert.equal(out?.ok, false, `quantity ${String(quantity)}`);
    assert.equal(out.status, 400, `quantity ${String(quantity)}`);
    assert.match(out.error, /quantity greater than 0/);
    assert.deepEqual(db.returned, [], `quantity ${String(quantity)}`);
  }
});

test("the stored quantity is the one the cap measured (no silent default of 1)", async () => {
  const db = fakeDb({ doLines: [{ poId: "po-1", quantity: 3 }] });
  const out = await create(db, [line({ quantity: "2" })]);
  assert.equal(out?.ok, true);
  assert.deepEqual(db.returned, [{ poId: "po-1", quantity: 2 }]);
});

test("two DO lines with the same production order: the cap is their SUM, not the last line", async () => {
  const db = fakeDb({ doLines: [{ poId: "po-1", quantity: 1 }, { poId: "po-1", quantity: 1 }] });
  assert.equal((await create(db, [line({ quantity: 1 }), line({ quantity: 1 })]))?.ok, true, "both delivered units can come back");
  const third = await create(db, [line({ quantity: 1 })]);
  assert.equal(third?.ok, false, "a third unit was never delivered");
  assert.equal(db.returned.length, 2);
});

test("a line naming no production order cannot slip past the cap", async () => {
  const db = fakeDb();
  const out = await create(db, [{ productCode: "BED", quantity: 1 }]);
  assert.equal(out?.ok, false);
  assert.equal(out.status, 400);
  assert.deepEqual(db.returned, []);
});

test("race-safe: the write batch locks the DO first and re-checks the cap last, in the same transaction", async () => {
  const db = fakeDb();
  await create(db, [line({ quantity: 1 })]);
  const sqls = db.batches[0];
  assert.match(sqls[0], /^SELECT pg_advisory_xact_lock\(hashtext\('delivery_return:' \|\| \?\)::bigint\)$/);
  assert.match(sqls.at(-1), /^SELECT 1 \/ CASE WHEN EXISTS \(.*HAVING SUM\(dri\.quantity\) > \(.*SELECT COALESCE\(SUM\(doi\.quantity\),0\) FROM delivery_order_items doi/);
});

test("a return that loses the race comes back as an over-return refusal, not a generic failure", async () => {
  const db = fakeDb({ batchError: "division by zero" });
  const out = await create(db, [line({ quantity: 1 })]);
  assert.equal(out?.ok, false);
  assert.match(out.error, /Return exceeds what was delivered/);
});

test("the office route passes the refusal through", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  assert.match(api, /if \(!created\.ok\) \{\n\s*return c\.json\(\{ success: false, error: created\.error \}, created\.status \?\? 409\);/);
});

// ===========================================================================
// Undo a return-to-stock (cancel of a RETURNED_TO_STOCK return). The route
// module is loaded per test so a missing export fails each test on its own.
// ===========================================================================

const undoBuilder = async () =>
  (await import("../src/api/routes/delivery-returns.ts")).buildUndoReturnToStockStatements;

// dr-1 put 1 unit (u-1) back on batch b-1 at 5000 sen.
function undoDb({ undone = 0, batchLeft = 1, unitStatus = "RETURNED" } = {}) {
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    async run() { return { success: true }; },
    async first() {
      if (/refType = 'DELIVERY_RETURN_UNDO'/.test(sql)) return { n: undone };
      return null;
    },
    async all() {
      if (/FROM cost_ledger WHERE refType = 'DELIVERY_RETURN' AND refId = \?/.test(sql)) {
        return { results: [{ itemId: "prod-1", batchId: "b-1", qty: 1, unitCostSen: 5000 }] };
      }
      if (/FROM fg_batches WHERE id IN/.test(sql)) return { results: [{ id: "b-1", remainingQty: batchLeft }] };
      if (/FROM fg_units WHERE id IN/.test(sql)) {
        return { results: [{ id: "u-1", status: unitStatus, productCode: "BED", batchId: "b-1", poId: "po-1", poNo: "", doId: "do-1", cnId: null }] };
      }
      return { results: [] };
    },
  });
  return { prepare: (sql) => stmt(sql.replace(/\s+/g, " ").trim()) };
}
const drItems = [{ id: "dri-1", productCode: "BED", quantity: 1, fgUnitId: "u-1" }];
const NOW = "2026-10-20T00:00:00Z";

test("undo reverses exactly what return-to-stock did, in one batch", async () => {
  const out = await (await undoBuilder())(undoDb(), "dr-1", drItems, NOW);
  assert.equal(out.ok, true);
  const sql = out.statements.map((x) => x.sql);
  assert.match(sql[0], /^SELECT pg_advisory_xact_lock\(hashtext\('delivery_return_undo:' \|\| \?\)::bigint\)$/);
  assert.match(sql[1], /status = 'RETURNED_TO_STOCK' \) THEN 1 ELSE 0 END/);
  const batch = out.statements.find((x) => /^UPDATE fg_batches SET remainingQty = remainingQty - \?/.test(x.sql));
  assert.deepEqual(batch.args, [1, "b-1"]);
  const ledger = out.statements.find((x) => /INSERT INTO cost_ledger/.test(x.sql));
  assert.match(ledger.sql, /'ADJUSTMENT', 'FG', \?, \?, \?, 'OUT', \?, \?, 'DELIVERY_RETURN_UNDO'/);
  assert.deepEqual(ledger.args.slice(2, 8), ["prod-1", "b-1", 1, 5000, 5000, "dr-1"]);
  const units = out.statements.find((x) => /^UPDATE fg_units/.test(x.sql));
  assert.match(units.sql, /SET status='DELIVERED', returnedAt=NULL WHERE id IN \(\?\) AND status='RETURNED'/);
  assert.ok(out.statements.some((x) => /INSERT INTO fg_stock_events/.test(x.sql) && x.args.includes("DELIVERED")));
  const dr = out.statements.find((x) => /^UPDATE delivery_returns/.test(x.sql));
  assert.match(dr.sql, /SET status='CANCELLED'.*WHERE id=\? AND status='RETURNED_TO_STOCK'/);
  assert.match(sql.at(-1), /FROM fg_batches WHERE id IN \(\?\) AND remainingQty < 0 \) THEN 0 ELSE 1 END/);
  assert.equal(out.undoneCogsSen, 5000);
});

test("undo cannot run twice", async () => {
  const out = await (await undoBuilder())(undoDb({ undone: 1 }), "dr-1", drItems, NOW);
  assert.equal(out.ok, false);
  assert.match(out.error, /already been undone/);
});

test("undo is refused when the batch no longer holds the returned qty (sold or used since)", async () => {
  const out = await (await undoBuilder())(undoDb({ batchLeft: 0 }), "dr-1", drItems, NOW);
  assert.equal(out.ok, false);
  assert.match(out.error, /holds 0 but this return put 1 on it/);
});

test("undo is refused when a returned unit was re-used", async () => {
  const out = await (await undoBuilder())(undoDb({ unitStatus: "LOADED" }), "dr-1", drItems, NOW);
  assert.equal(out.ok, false);
  assert.match(out.error, /is now LOADED, not RETURNED/);
});

test("cancel of a RETURNED_TO_STOCK return runs the undo and maps a lost race to 409; the page offers it", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  const cancel = api.slice(api.indexOf('app.post("/:id/cancel"'));
  assert.match(cancel, /if \(h\.status === "RETURNED_TO_STOCK"\) \{[\s\S]*?buildUndoReturnToStockStatements\([\s\S]*?if \(!undo\.ok\) return c\.json\(\{ success: false, error: undo\.error \}, 409\);[\s\S]*?division by zero/);
  const detail = read("src/pages/delivery-returns/detail.tsx");
  assert.match(detail, /\{dr\.status === "RETURNED_TO_STOCK" && \([\s\S]*?call\("\/cancel"\);[\s\S]*?Undo return to stock/);
});

// ===========================================================================
// Partial returns: a qty per line in the picker, and billing net of returns.
// ===========================================================================

test("returnable per line: already-returned qty is split across lines of the same production order", async () => {
  const { returnableByLine } = await import("../src/lib/delivery-return-qty.ts");
  assert.deepEqual(returnableByLine([{ productionOrderId: "po-1", quantity: 3 }], new Map([["po-1", 1]])), [2]);
  assert.deepEqual(
    returnableByLine(
      [{ productionOrderId: "po-1", quantity: 1 }, { productionOrderId: "po-1", quantity: 1 }, { productionOrderId: "", quantity: 4 }],
      new Map([["po-1", 1]]),
    ),
    [0, 1, 4],
  );
});

function invoiceDb(returnedQty) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    prepare(sql) {
      const s = norm(sql);
      return {
        async run() { return { success: true }; },
        bind() {
          return {
            async first() {
              if (/FROM delivery_orders WHERE id = \?/.test(s)) return { orgId: "hookka", salesOrderId: "so-1" };
              return null;
            },
            async all() {
              if (/FROM delivery_order_items WHERE deliveryOrderId = \?/.test(s)) {
                return { results: [{ id: "di-1", deliveryOrderId: "do-1", productionOrderId: "po-1", productCode: "CHAIR", productName: "Chair", sizeLabel: "", fabricCode: "", quantity: 3, invoicedQty: 0 }] };
              }
              if (/FROM delivery_return_items dri/.test(s)) return { results: returnedQty ? [{ poId: "po-1", qty: returnedQty }] : [] };
              if (/FROM production_orders WHERE orgId = \?/.test(s)) {
                return { results: [{ id: "po-1", salesOrderId: "so-1", productCode: "CHAIR", sizeCode: "", fabricCode: "" }] };
              }
              if (/FROM sales_order_items/.test(s)) {
                return { results: [{ id: "si-1", salesOrderId: "so-1", productCode: "CHAIR", sizeCode: "", fabricCode: "", unitPriceSen: 10000, quantity: 3, lineTotalSen: 30000 }] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

test("a partial return bills the rest of the line: delivered 3, returned 1, invoice qty 2", async () => {
  const { computeDoInvoiceLines } = await import("../src/api/routes/delivery-orders/_helpers.ts");
  const none = await computeDoInvoiceLines(invoiceDb(0), "do-1", ["so-1"], null);
  assert.equal(none.invItems[0]?.quantity, 3, "fake DB sanity: no return bills all 3");
  const { invItems } = await computeDoInvoiceLines(invoiceDb(1), "do-1", ["so-1"], null);
  assert.equal(invItems.length, 1, "the line must stay on the invoice");
  assert.equal(invItems[0].quantity, 2);
});

test("the picker gets each line's returnable qty and sends the qty the user entered", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  assert.match(api, /data: items\.map\(\(it, i\) => \(\{ \.\.\.it, returnableQty: returnable\[i\] \}\)\)/);
  const page = read("src/pages/delivery-returns/index.tsx");
  assert.match(page, /quantity: qtyOf\(it\),/);
  assert.doesNotMatch(page, /quantity: it\.quantity,/);
  assert.match(page, /type="number"\n\s*min=\{1\}\n\s*max=\{returnableOf\(it\)\}/);
  assert.match(page, /q > 0 && q <= returnableOf\(it\)/);
});

// ===========================================================================
// Review follow-ups: a DB failure is a 500, and the driver flow logs a refusal.
// ===========================================================================

test("a database failure on create comes back as 500, not 400", async () => {
  const db = fakeDb({ batchError: "connection reset" });
  const out = await create(db, [line({ quantity: 1 })]);
  assert.equal(out?.ok, false);
  assert.equal(out.status, 500);
});

test("the driver QR flow does not drop a refused delivery return silently", () => {
  const qr = read("src/api/routes/public-do-qr.ts");
  assert.match(qr, /const dr = await createDeliveryReturnRecord\(c\.var\.DB, orgId, \{[\s\S]*?\}\);\n\s*if \(!dr\.ok\) throw new Error\(dr\.error\);[^\n]*\n\s*\}\n\s*\} catch \(drErr\) \{\n\s*console\.warn\(/);
});

// ===========================================================================
// Status flips are guarded: restock + cancel at once on the same OPEN return
// must not leave a CANCELLED return whose stock was credited.
// ===========================================================================
test("every status UPDATE carries the from-status, and a lost flip rolls the batch back with 409", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  assert.match(api, /status='RETURNED_TO_STOCK', returned_at=\?, updated_at=\? WHERE id=\? AND status='OPEN'/);
  assert.match(api, /credit_note_id=\?,\s+returned_at=COALESCE\(\?, returned_at\), updated_at=\?\s+WHERE id=\? AND status='OPEN'/);
  assert.match(api, /status='CANCELLED', updated_at=\? WHERE id=\? AND status=\?/);
  assert.match(api, /status='REDELIVERED', updated_at=\? WHERE id=\? AND status='SERVICE_SPAWNED'/);
  // the check statement raises when the UPDATE matched nothing, inside the same batch
  assert.match(api, /SELECT 1 \/ CASE WHEN EXISTS \(\s+SELECT 1 FROM delivery_returns WHERE id = \? AND status = \? AND updated_at = \?\s+\) THEN 1 ELSE 0 END AS "flipped"/);
  assert.match(api, /division by zero[\s\S]*?\{ success: false, error: STATUS_RACE_ERROR \}, 409/);
  const rts = api.slice(api.indexOf('app.post("/:id/return-to-stock"'), api.indexOf('app.post("/:id/set-outcome"'));
  assert.match(rts, /\.\.\.flipStatus\([\s\S]*?\);\s+const lost = await runFlip\(c, statements\)/);
});

test("mark-redelivered is allowed only from SERVICE_SPAWNED", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  const mr = api.slice(api.indexOf('app.post("/:id/mark-redelivered"'), api.indexOf('app.post("/:id/cancel"'));
  assert.match(mr, /if \(h\.status !== "SERVICE_SPAWNED"\) \{[\s\S]*?, 409\)/);
});
