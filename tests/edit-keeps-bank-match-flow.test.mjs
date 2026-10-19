// ---------------------------------------------------------------------------
// edit-keeps-bank-match-flow.test.mjs — the payment-voucher edit and its
// void / unvoid as BEHAVIOUR, on the in-memory ledger of
// tests/_ledger-mock.mjs (the real accounting routes):
//   · class C31 — an edit re-posts the bank leg under a new id; the Cash Book
//     match, a split and the daily tick move with it; a matched voucher
//     cannot change its bank account or amount (409, nothing written);
//   · class C5 row 8 — an unvoid after an edit brings back the EDITED legs,
//     not the pre-edit ones;
//   · a cancelled voucher can't be edited (the server refuses, not only the
//     screen).
// Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { makeLedgerDb, mountAccounting, post, visible, balances, bankMatchedEditError } from "./_ledger-mock.mjs";

function seedPostedVoucher(db, { id = "pv-1", pvNo = "HPV-2607-001", payFrom = "310-0001", expense = "900-0001", totalSen = 30000 } = {}) {
  db.st.vouchers.push({ id, pvNo, status: "POSTED", approvalState: "APPROVED", pvKind: null, payFrom, totalSen, date: "2026-07-10", payee: "Vendor" });
  db.st.pvLines.push({ id: `pvl-${id}`, voucherId: id, accountCode: expense, description: "", amountSen: totalSen, lineOrder: 0 });
  db.seedLegs("payment_voucher", id, [
    { accountCode: expense, debitSen: totalSen },
    { id: `lje-bank-${id}`, accountCode: payFrom, creditSen: totalSen },
  ]);
  return { id, bankLegId: `lje-bank-${id}` };
}
const edit = (lines, payFrom = "310-0001") => ({ date: "2026-07-10", payee: "Vendor", description: "Repairs", payFrom, lines });

test("voucher: edit moves the bank match, split and tick; a matched voucher keeps its bank side; unvoid brings back the edit", async () => {
  const db = makeLedgerDb();
  const app = mountAccounting(db);
  const { id, bankLegId } = seedPostedVoucher(db);
  db.st.stmt.push({ id: "bsl-1", accountCode: "310-0001", txnDate: "2026-07-10", amountSen: -30000, matchedLegId: bankLegId });
  db.st.splits.push({ line_id: "bsl-2", leg_id: bankLegId, amount_sen: -30000 });
  db.st.ticks.push({ leg_id: bankLegId, account_code: "310-0001", cleared_on: "2026-07-10" });

  // 1. Another expense account, same bank and amount → the bank side follows.
  const e1 = await post(app, `/payment-vouchers/${id}/restate`, edit([{ accountCode: "900-0002", description: "", amountSen: 30000 }]));
  assert.equal(e1.status, 200, await e1.clone().text());
  assert.deepEqual(balances(db.st, id), { "900-0002": 30000, "310-0001": -30000 });
  const newBank = visible(db.st, id).find((l) => l.accountCode === "310-0001");
  assert.notEqual(newBank.id, bankLegId);
  assert.equal(db.st.stmt[0].matchedLegId, newBank.id, "statement line → re-posted bank leg");
  assert.equal(db.st.splits[0].leg_id, newBank.id, "split → re-posted bank leg");
  assert.equal(db.st.ticks[0].leg_id, newBank.id, "daily tick → re-posted bank leg");

  // 2. Matched: a new amount is refused and nothing is written.
  const legsBefore = db.st.legs.length;
  const e2 = await post(app, `/payment-vouchers/${id}/restate`, edit([{ accountCode: "900-0002", description: "", amountSen: 25000 }]));
  assert.equal(e2.status, 409);
  assert.equal((await e2.json()).error, bankMatchedEditError("voucher"));
  assert.equal(db.st.legs.length, legsBefore);

  // 3. Unmatched (statement and split) → the amount can change.
  db.st.stmt[0].matchedLegId = null;
  db.st.splits.length = 0;
  const e3 = await post(app, `/payment-vouchers/${id}/restate`, edit([{ accountCode: "900-0002", description: "", amountSen: 25000 }]));
  assert.equal(e3.status, 200, await e3.clone().text());
  assert.deepEqual(balances(db.st, id), { "900-0002": 25000, "310-0001": -25000 });

  // 4. Void → nothing in the books; unvoid → the EDITED voucher (25,000), not
  //    the original (30,000) — C5 row 8.
  const v = await post(app, `/payment-vouchers/${id}/lifecycle`, { action: "void" });
  assert.equal(v.status, 200, await v.clone().text());
  assert.deepEqual(balances(db.st, id), {});
  const u = await post(app, `/payment-vouchers/${id}/lifecycle`, { action: "unvoid" });
  assert.equal(u.status, 200, await u.clone().text());
  assert.deepEqual(balances(db.st, id), { "900-0002": 25000, "310-0001": -25000 });
  assert.equal(new Set(visible(db.st, id).map((l) => l.sourceType)).size, 1, "one live family");
});

test("voucher: a cancelled voucher can't be edited — the server refuses and writes nothing", async () => {
  const db = makeLedgerDb();
  const app = mountAccounting(db);
  const { id } = seedPostedVoucher(db, { id: "pv-2", pvNo: "HPV-2607-002", totalSen: 4000 });
  await post(app, `/payment-vouchers/${id}/lifecycle`, { action: "void" });
  assert.deepEqual(balances(db.st, id), {});
  const legsBefore = db.st.legs.length;
  const r = await post(app, `/payment-vouchers/${id}/restate`, edit([{ accountCode: "900-0001", description: "", amountSen: 4000 }]));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /cancelled — restore it before editing/);
  assert.equal(db.st.legs.length, legsBefore);
  assert.deepEqual(balances(db.st, id), {}, "still nothing in the books");
});

test("voucher: never edited → void / unvoid exactly as before", async () => {
  const db = makeLedgerDb();
  const app = mountAccounting(db);
  const { id } = seedPostedVoucher(db, { id: "pv-3", pvNo: "HPV-2607-003", totalSen: 1500 });
  await post(app, `/payment-vouchers/${id}/lifecycle`, { action: "void" });
  await post(app, `/payment-vouchers/${id}/lifecycle`, { action: "unvoid" });
  assert.deepEqual(balances(db.st, id), { "900-0001": 1500, "310-0001": -1500 });
  assert.ok(visible(db.st, id).every((l) => l.sourceType === "payment_voucher"));
});
