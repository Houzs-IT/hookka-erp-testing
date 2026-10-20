// ---------------------------------------------------------------------------
// T-006 R6 + R7 on main (BUG-2026-10-20-360..364). Runs the real create /
// delete / guard functions against a small in-memory book, not regexes.
//
// R6: a purchase return gives the PO line back its receivedQty (PO 100,
//     receive 100, return 20 → 80 → 30 more may come in, 31 may not), the PO
//     status is recomputed, deleting the return restores it, and a GRN with a
//     live return on its lines cannot be cancelled / deleted / un-posted.
// R7 / HK-0110: a DO line can only be returned up to what it delivered,
//     summed across every DO line of a production order, and the cap is
//     re-checked under a lock in the insert's own transaction.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = (p) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const { createPurchaseReturn, purchaseReturnRestoreStatements } = await load("src/api/lib/purchase-return-create.ts");
const { recomputePoStatusFromReceipts, findOverReceipt, findLivePurchaseReturnOnGrn } = await load("src/api/routes/grn.ts");
const { createDeliveryReturnRecord, findDeliveryReturnOverCap } = await load("src/api/lib/delivery-return-create.ts");
const { applyDeliveryReturnsToDoLines } = await load("src/api/routes/delivery-orders/_helpers.ts");

const norm = (s) => s.replace(/\s+/g, " ").trim();

// ── R6: purchase side ──────────────────────────────────────────────────────
function poBook(grnStatus = "POSTED") {
  return {
    poItems: [{ id: "poi-1", purchaseOrderId: "po-1", materialName: "Foam", quantity: 100, receivedQty: 100 }],
    pos: [{ id: "po-1", status: "RECEIVED" }],
    // grn_items.id is BIGINT; purchase_return_items.grn_item_id is TEXT.
    grnLines: [{ id: 7, grnId: "grn-1", linePoId: "po-1", poItemId: "poi-1", grnPoId: "po-1", status: grnStatus }],
    returns: [],
    returnItems: [],
    statements: [],
  };
}

function poDb(b) {
  const first = (q, a) => {
    if (/FROM purchase_returns WHERE return_no LIKE/.test(q)) return null;
    if (/SELECT pr\.return_no AS "returnNo" FROM purchase_return_items pri/.test(q)) {
      const ids = b.grnLines.filter((g) => g.grnId === a[0]).map((g) => String(g.id));
      const hit = b.returnItems.find((ri) => ids.includes(ri.grn_item_id) &&
        b.returns.find((r) => r.id === ri.purchase_return_id)?.status !== "CANCELLED");
      return hit ? { returnNo: b.returns.find((r) => r.id === hit.purchase_return_id).return_no } : null;
    }
    throw new Error("unexpected first(): " + q);
  };
  const all = (q, a) => {
    if (/FROM grn_items gi JOIN grns g ON g\.id = gi\.grnId WHERE gi\.id::text IN/.test(q)) {
      return { results: b.grnLines.filter((g) => a.includes(String(g.id))) };
    }
    if (/SELECT quantity, receivedQty FROM purchase_order_items WHERE purchaseOrderId = \?/.test(q)) {
      return { results: b.poItems.filter((p) => p.purchaseOrderId === a[0]) };
    }
    if (/FROM purchase_order_items WHERE id IN/.test(q)) {
      return { results: b.poItems.filter((p) => a.includes(p.id)) };
    }
    if (/FROM purchase_return_items WHERE purchase_return_id = \?/.test(q)) {
      return { results: b.returnItems.filter((r) => r.purchase_return_id === a[0]).map((r) => ({ grnItemId: r.grn_item_id, quantity: r.quantity })) };
    }
    throw new Error("unexpected all(): " + q);
  };
  const exec = (q, a) => {
    b.statements.push(q);
    let m;
    if (/^INSERT INTO purchase_returns /.test(q)) b.returns.push({ id: a[0], return_no: a[1], status: "OPEN" });
    else if (/^INSERT INTO purchase_return_items /.test(q)) b.returnItems.push({ purchase_return_id: a[1], grn_item_id: a[6], quantity: a[7] });
    else if (/^UPDATE purchase_order_items SET receivedQty = GREATEST\(0, receivedQty - \?\) WHERE id = \?$/.test(q)) {
      const p = b.poItems.find((x) => x.id === a[1]); p.receivedQty = Math.max(0, p.receivedQty - a[0]);
    } else if (/^UPDATE purchase_order_items SET receivedQty = receivedQty \+ \? WHERE id = \?$/.test(q)) {
      b.poItems.find((x) => x.id === a[1]).receivedQty += a[0];
    } else if (/^DELETE FROM purchase_return_items WHERE purchase_return_id = \?$/.test(q)) {
      b.returnItems = b.returnItems.filter((r) => r.purchase_return_id !== a[0]);
    } else if (/^DELETE FROM purchase_returns WHERE id = \?$/.test(q)) {
      b.returns = b.returns.filter((r) => r.id !== a[0]);
    } else if ((m = /^UPDATE purchase_orders SET status = '(\w+)'/.exec(q))) {
      const po = b.pos.find((x) => x.id === a[a.length - 1]);
      const onlyReceived = /status IN \('RECEIVED','PARTIAL_RECEIVED'\)/.test(q);
      const notClosed = /status NOT IN \('CLOSED','CANCELLED'\)/.test(q);
      if (onlyReceived && !["RECEIVED", "PARTIAL_RECEIVED"].includes(po.status)) return { success: true, meta: { changes: 0 } };
      if (notClosed && ["CLOSED", "CANCELLED"].includes(po.status)) return { success: true, meta: { changes: 0 } };
      po.status = m[1];
    } else if (!/^(ALTER|CREATE|DELETE FROM goods_in_transit)/.test(q)) throw new Error("unexpected write: " + q);
    return { success: true, meta: { changes: 1 } };
  };
  return {
    prepare(sql) {
      const q = norm(sql);
      return {
        run: async () => exec(q, []),
        bind: (...a) => ({ q, a, run: async () => exec(q, a), first: async () => first(q, a), all: async () => all(q, a) }),
      };
    },
    batch: async (stmts) => stmts.map((s) => exec(s.q, s.a)),
  };
}

const returnTwenty = (db) =>
  createPurchaseReturn(db, {
    grnId: "grn-1",
    items: [{ grnItemId: "7", materialCode: "FOAM", materialName: "Foam", quantity: 20, unitCostSen: 100 }],
  });

test("R6: PO 100 / receive 100 / return 20 → received 80, 30 more fits, 31 does not, PO reopens", async () => {
  const b = poBook();
  const db = poDb(b);
  const created = await returnTwenty(db);
  assert.equal(created.ok, true);
  assert.deepEqual(created.poIds, ["po-1"]);
  assert.equal(b.poItems[0].receivedQty, 80);
  for (const poId of created.poIds) await recomputePoStatusFromReceipts(db, poId);
  assert.equal(b.pos[0].status, "PARTIAL_RECEIVED");
  assert.equal(await findOverReceipt(db, [{ poItemId: "poi-1", qty: 30 }]), null);
  assert.match(await findOverReceipt(db, [{ poItemId: "poi-1", qty: 31 }]), /Over-receipt/);
  // BUG-2026-09-24-184: the invoice still bills these units — never re-open them.
  assert.ok(!b.statements.some((s) => /invoiced_qty/.test(s)));
});

test("R6: deleting the return restores receivedQty and the PO status", async () => {
  const b = poBook();
  const db = poDb(b);
  const created = await returnTwenty(db);
  for (const poId of created.poIds) await recomputePoStatusFromReceipts(db, poId);
  const restore = await purchaseReturnRestoreStatements(db, created.id);
  await db.batch(restore.statements);
  for (const poId of restore.poIds) await recomputePoStatusFromReceipts(db, poId);
  assert.equal(b.poItems[0].receivedQty, 100);
  assert.equal(b.pos[0].status, "RECEIVED");
});

test("R6: returning everything puts the PO back to CONFIRMED", async () => {
  const b = poBook();
  const db = poDb(b);
  b.poItems[0].receivedQty = 20;
  const created = await returnTwenty(db);
  for (const poId of created.poIds) await recomputePoStatusFromReceipts(db, poId);
  assert.equal(b.poItems[0].receivedQty, 0);
  assert.equal(b.pos[0].status, "CONFIRMED");
});

test("R6: a return on a short-closed PO gives qty back but never reopens it", async () => {
  const b = poBook();
  const db = poDb(b);
  b.pos[0].status = "CLOSED";
  const created = await returnTwenty(db);
  for (const poId of created.poIds) await recomputePoStatusFromReceipts(db, poId);
  assert.equal(b.poItems[0].receivedQty, 80);
  assert.equal(b.pos[0].status, "CLOSED");
  const restore = await purchaseReturnRestoreStatements(db, created.id);
  await db.batch(restore.statements);
  for (const poId of restore.poIds) await recomputePoStatusFromReceipts(db, poId);
  assert.equal(b.pos[0].status, "CLOSED");
});

test("R6: a return off an un-posted GRN is refused and writes nothing", async () => {
  const b = poBook("DRAFT");
  const created = await returnTwenty(poDb(b));
  assert.equal(created.ok, false);
  assert.equal(b.returns.length, 0);
  assert.equal(b.poItems[0].receivedQty, 100);
});

test("R6: a live return blocks the GRN (BIGINT id matched as text); a deleted one does not", async () => {
  const b = poBook();
  const db = poDb(b);
  assert.equal(await findLivePurchaseReturnOnGrn(db, "grn-1"), null);
  const created = await returnTwenty(db);
  assert.equal(await findLivePurchaseReturnOnGrn(db, "grn-1"), created.returnNo);
  await db.batch((await purchaseReturnRestoreStatements(db, created.id)).statements);
  b.returns = [];
  b.returnItems = [];
  assert.equal(await findLivePurchaseReturnOnGrn(db, "grn-1"), null);
});

test("R6: GRN cancel, delete and un-post all ask the guard before restoring the PO", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/grn.ts"), "utf8");
  for (const route of ['app.put("/:id"', 'app.post("/:id/cancel"', 'app.delete("/:id"']) {
    const body = src.slice(src.indexOf(route));
    const guard = body.indexOf("findLivePurchaseReturnOnGrn(");
    const restore = body.indexOf("restorePOReceivedQtyForGRN(");
    assert.ok(guard > 0 && guard < restore, `${route}: guard must run before the PO restore`);
  }
});

// ── R7: delivery side ──────────────────────────────────────────────────────
test("R7: the 20 Oct case — a qty-1 DO line already returned cannot be returned again", () => {
  const err = findDeliveryReturnOverCap(
    [{ poId: "po-095-01", quantity: 1 }],
    [{ poId: "po-095-01", qty: 1 }],
    [{ productionOrderId: "po-095-01", quantity: 1 }],
  );
  assert.match(err, /already returned 1 \+ this return 1 > delivered 1/);
});

test("R7: delivered qty is summed across every DO line of one production order", () => {
  // Two DO lines of 1 each for the same production order — a Map built from
  // the rows kept only the last line and capped this at 1.
  const lines = [{ poId: "po-1", quantity: 1 }, { poId: "po-1", quantity: 1 }];
  assert.equal(findDeliveryReturnOverCap(lines, [], [{ productionOrderId: "po-1", quantity: 2 }]), null);
  assert.match(findDeliveryReturnOverCap(lines, [], [{ productionOrderId: "po-1", quantity: 3 }]), /> delivered 2/);
  // Two lines of one return against the same production order count together.
  assert.match(
    findDeliveryReturnOverCap([{ poId: "po-1", quantity: 2 }], [{ poId: "po-1", qty: 1 }],
      [{ productionOrderId: "po-1", quantity: 1 }, { productionOrderId: "po-1", quantity: 1 }]),
    /already returned 1 \+ this return 2/,
  );
});

function drDb({ doLines, prior = [], headerChanges = 1 }) {
  const calls = { batches: [] };
  const db = {
    prepare(sql) {
      const q = norm(sql);
      const stmt = (a) => ({
        q, a,
        run: async () => ({ success: true }),
        first: async () => (/FROM delivery_orders WHERE id = \?/.test(q) ? { doNo: "DO-2610-071", customerName: "C" } : null),
        all: async () => {
          if (/FROM delivery_order_items WHERE deliveryOrderId = \?/.test(q)) return { results: doLines };
          if (/FROM delivery_return_items dri/.test(q)) return { results: prior };
          return { results: [] };
        },
      });
      return { ...stmt([]), bind: (...a) => stmt(a) };
    },
    batch: async (stmts) => {
      calls.batches.push(stmts);
      return stmts.map((s, i) => ({ success: true, meta: { changes: i === 1 ? headerChanges : 1 } }));
    },
  };
  return { db, calls };
}

const line = (quantity, productionOrderId = "po-095-01") => ({ productionOrderId, productCode: "BED", quantity });

test("R7: a duplicate return is refused with 409 before anything is written", async () => {
  const { db, calls } = drDb({ doLines: [{ poId: "po-095-01", quantity: 1 }], prior: [{ poId: "po-095-01", qty: 1 }] });
  const r = await createDeliveryReturnRecord(db, "hookka", { doId: "do-071", items: [line(1)] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(calls.batches.length, 0);
});

test("R7: zero, negative or missing quantity is a 400, never stored as 1", async () => {
  for (const quantity of [0, -1, undefined, "abc"]) {
    const { db, calls } = drDb({ doLines: [{ poId: "po-095-01", quantity: 1 }] });
    const r = await createDeliveryReturnRecord(db, "hookka", { doId: "do-071", items: [line(quantity)] });
    assert.equal(r.status, 400, `quantity ${quantity}`);
    assert.equal(calls.batches.length, 0);
  }
});

test("R7: a line with no production order is refused when the DO's lines have one", async () => {
  const { db } = drDb({ doLines: [{ poId: "po-095-01", quantity: 1 }] });
  const r = await createDeliveryReturnRecord(db, "hookka", { doId: "do-071", items: [line(1, "")] });
  assert.equal(r.status, 400);
});

test("R7: the insert takes a per-DO lock, then re-checks the cap inside the same batch", async () => {
  const { db, calls } = drDb({ doLines: [{ poId: "po-095-01", quantity: 1 }] });
  const r = await createDeliveryReturnRecord(db, "hookka", { doId: "do-071", items: [line(1)] });
  assert.equal(r.ok, true);
  const [lock, header, item] = calls.batches[0];
  assert.match(lock.q, /pg_advisory_xact_lock\(hashtext\('delivery_return:' \|\| \?\)::bigint\)/);
  assert.deepEqual(lock.a, ["do-071"]);
  assert.match(header.q, /^INSERT INTO delivery_returns .* SELECT .* WHERE \(SELECT COALESCE\(SUM\(dri\.quantity\), 0\)/);
  assert.deepEqual(header.a.slice(-5), ["do-071", "po-095-01", 1, "do-071", "po-095-01"]);
  // Items go in only if their header did.
  assert.match(item.q, /FROM delivery_returns WHERE id = \?$/);
  assert.equal(item.a[item.a.length - 1], header.a[0]);
});

test("R7: two returns at once — the one whose guarded header loses gets a 409", async () => {
  // Both passed the pre-check; under the lock the second sees the first.
  const { db } = drDb({ doLines: [{ poId: "po-095-01", quantity: 1 }], headerChanges: 0 });
  const r = await createDeliveryReturnRecord(db, "hookka", { doId: "do-071", items: [line(1)] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.error, /at the same time/);
});

test("R7: billing nets returned qty per line, used up once across lines of one production order", () => {
  const lines = [
    { id: "a", productionOrderId: "po-1", quantity: 3 },
    { id: "b", productionOrderId: "po-1", quantity: 2 },
    { id: "c", productionOrderId: "po-2", quantity: 1 },
  ];
  const out = applyDeliveryReturnsToDoLines(lines, new Map([["po-1", 4], ["po-2", 0]]));
  // 4 returned against po-1: line a 3 → 0 (dropped), line b 2 → 1.
  assert.deepEqual(out.map((l) => [l.id, l.quantity]), [["b", 1], ["c", 1]]);
  assert.deepEqual(applyDeliveryReturnsToDoLines([{ id: "a", productionOrderId: "po-1", quantity: 3 }], new Map([["po-1", 1]])).map((l) => l.quantity), [2]);
});

test("R7: a RETURNED_TO_STOCK return cannot be cancelled", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/delivery-returns.ts"), "utf8");
  const cancel = src.slice(src.indexOf('app.post("/:id/cancel"'));
  assert.match(cancel, /\["CLOSED", "REDELIVERED", "CN_ISSUED", "RETURNED_TO_STOCK"\]\.includes\(h\.status\)/);
});
