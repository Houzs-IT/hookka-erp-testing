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

test("the office route passes the refusal through; cancel refuses a RETURNED_TO_STOCK return", () => {
  const api = read("src/api/routes/delivery-returns.ts");
  assert.match(api, /if \(!created\.ok\) \{\n\s*return c\.json\(\{ success: false, error: created\.error \}, created\.status \?\? 409\);/);
  const cancel = api.slice(api.indexOf('app.post("/:id/cancel"'));
  assert.match(cancel, /h\.status === "RETURNED_TO_STOCK"\n\s*\) \{\n\s*return c\.json\(\n\s*\{ success: false, error: `Cannot cancel a \$\{h\.status\} return` \},\n\s*409,/);
});
