// ---------------------------------------------------------------------------
// T-006 R6 on main (BUG-2026-10-20-360, -361). Runs the real create /
// delete / guard functions against a small in-memory book, not regexes.
//
// R6: a purchase return gives the PO line back its receivedQty (PO 100,
//     receive 100, return 20 → 80 → 30 more may come in, 31 may not), the PO
//     status is recomputed, deleting the return restores it, and a GRN with a
//     live return on its lines cannot be cancelled / deleted / un-posted.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = (p) => import(pathToFileURL(resolve(process.cwd(), p)).href);
const { createPurchaseReturn, purchaseReturnRestoreStatements } = await load("src/api/lib/purchase-return-create.ts");
const { recomputePoStatusFromReceipts, findOverReceipt, findLivePurchaseReturnOnGrn } = await load("src/api/routes/grn.ts");

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
