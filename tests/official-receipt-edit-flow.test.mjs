// ---------------------------------------------------------------------------
// official-receipt-edit-flow.test.mjs — the official-receipt edit as
// BEHAVIOUR: the real routes (post, edit, void, unvoid) run against the
// in-memory ledger of tests/_ledger-mock.mjs. What the books must show after
// each step: exactly one live set of legs (the newest edit), the bank match
// and the daily tick on the re-posted bank leg, a matched receipt refusing a
// new bank account / amount, and an unvoid restoring the EDITED legs, never
// the pre-edit ones (class C5). Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { makeLedgerDb, mountAccounting, post, visible, balances, bankMatchedEditError } from "./_ledger-mock.mjs";

const receipt = (lines, payTo = "310-0001") => ({ date: "2026-07-05", receivedFrom: "A buyer", description: "Scrap sale", payTo, lines });

test("post → match → edit keeps the bank match → refused change → unmatch → edit → void → unvoid", async () => {
  const db = makeLedgerDb();
  const app = mountAccounting(db);

  // 1. Post.
  const created = await post(app, "/official-receipts", receipt([{ accountCode: "520-0001", description: "scrap", amountSen: 50000 }]));
  assert.equal(created.status, 201, await created.clone().text());
  const { id, orNo } = (await created.json()).data;
  assert.deepEqual(balances(db.st, id), { "310-0001": 50000, "520-0001": -50000 });
  const bankLeg = visible(db.st, id).find((l) => l.accountCode === "310-0001");
  // Cash Book matched it, the board ticked it.
  db.st.stmt.push({ id: "bsl-1", accountCode: "310-0001", txnDate: "2026-07-05", amountSen: 50000, matchedLegId: bankLeg.id });
  db.st.ticks.push({ leg_id: bankLeg.id, account_code: "310-0001", cleared_on: "2026-07-05" });

  // 2. Edit the income account and the text — bank side unchanged.
  const e1 = await post(app, `/official-receipts/${id}/restate`, { ...receipt([{ accountCode: "520-0002", description: "scrap metal", amountSen: 50000 }]), receivedFrom: "A buyer Sdn Bhd" });
  assert.equal(e1.status, 200, await e1.clone().text());
  assert.equal((await e1.json()).data.bankMatchMoved, true);
  assert.deepEqual(balances(db.st, id), { "310-0001": 50000, "520-0002": -50000 }, "the books show the edit only");
  const live1 = visible(db.st, id);
  assert.ok(live1.every((l) => l.sourceType.startsWith("official_receipt_restate_post:")), "exactly one live family");
  const newBank = live1.find((l) => l.accountCode === "310-0001");
  assert.notEqual(newBank.id, bankLeg.id);
  assert.equal(db.st.stmt[0].matchedLegId, newBank.id, "the statement line follows the re-posted bank leg");
  assert.equal(db.st.ticks[0].leg_id, newBank.id, "so does the daily tick");
  const r = db.st.receipts.find((x) => x.id === id);
  assert.equal(r.orNo, orNo, "same OR number");
  assert.equal(r.receivedFrom, "A buyer Sdn Bhd");
  assert.deepEqual(db.st.lines.filter((l) => l.receiptId === id).map((l) => [l.accountCode, l.amountSen]), [["520-0002", 50000]]);

  // 3. While matched, the amount can't change — nothing is written.
  const legsBefore = db.st.legs.length;
  const e2 = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0002", description: "scrap", amountSen: 40000 }]));
  assert.equal(e2.status, 409);
  assert.equal((await e2.json()).error, bankMatchedEditError("receipt"));
  assert.equal(db.st.legs.length, legsBefore);
  assert.deepEqual(balances(db.st, id), { "310-0001": 50000, "520-0002": -50000 });

  // 4. Unmatched in Cash Book → the bank account and amount can change.
  db.st.stmt[0].matchedLegId = null;
  const e3 = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0002", description: "scrap", amountSen: 40000 }], "310-0002"));
  assert.equal(e3.status, 200, await e3.clone().text());
  assert.equal((await e3.json()).data.bankMatchMoved, false);
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0002": -40000 });

  // 5. Void → nothing left in the books.
  const v = await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.equal(v.status, 200, await v.clone().text());
  assert.deepEqual(balances(db.st, id), {});
  assert.equal(visible(db.st, id).length, 0);

  // 6. Unvoid → the EDITED receipt comes back, not the original (C5).
  const u = await post(app, `/official-receipts/${id}/lifecycle`, { action: "unvoid" });
  assert.equal(u.status, 200, await u.clone().text());
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0002": -40000 });
  assert.equal(new Set(visible(db.st, id).map((l) => l.sourceType)).size, 1, "one live family after the unvoid");

  // 7. Void and unvoid again — same answer; then the restored receipt edits normally.
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.deepEqual(balances(db.st, id), {});
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "unvoid" });
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0002": -40000 });
  const e4 = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0001", description: "scrap", amountSen: 40000 }], "310-0002"));
  assert.equal(e4.status, 200, await e4.clone().text());
  assert.deepEqual(balances(db.st, id), { "310-0002": 40000, "520-0001": -40000 });
});

test("a cancelled receipt can't be edited; an unreadable edit writes nothing", async () => {
  const db = makeLedgerDb();
  const app = mountAccounting(db);
  const created = await post(app, "/official-receipts", receipt([{ accountCode: "520-0001", description: "", amountSen: 12345 }]));
  const { id } = (await created.json()).data;
  const bad = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0001", description: "", amountSen: 0 }]));
  assert.equal(bad.status, 400);
  assert.deepEqual(balances(db.st, id), { "310-0001": 12345, "520-0001": -12345 });
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  const r = await post(app, `/official-receipts/${id}/restate`, receipt([{ accountCode: "520-0002", description: "", amountSen: 12345 }]));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /cancelled — restore it before editing/);
  assert.deepEqual(balances(db.st, id), {});
});

test("a never-edited receipt voids and unvoids exactly as before", async () => {
  const db = makeLedgerDb();
  const app = mountAccounting(db);
  const created = await post(app, "/official-receipts", receipt([{ accountCode: "520-0001", description: "", amountSen: 777 }]));
  const { id } = (await created.json()).data;
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "void" });
  assert.deepEqual(balances(db.st, id), {});
  await post(app, `/official-receipts/${id}/lifecycle`, { action: "unvoid" });
  assert.deepEqual(balances(db.st, id), { "310-0001": 777, "520-0001": -777 });
  assert.ok(visible(db.st, id).every((l) => l.sourceType === "official_receipt"), "the original legs are the live set");
});

test("a receipt posted under an account code the chart later renamed edits under today's code (C32)", async () => {
  // 520-0009 was renamed 520-0002 after the receipt was posted.
  const db = makeLedgerDb({ aliases: [{ oldCode: "520-0009", newCode: "520-0002" }, { oldCode: "310-0009", newCode: "310-0001" }] });
  const app = mountAccounting(db);
  db.st.receipts.push({ id: "or-old", orNo: "HOR-2607-001", date: "2026-07-01", receivedFrom: "X", description: "", payTo: "310-0009", totalSen: 900, status: "POSTED" });
  db.st.lines.push({ id: "orl-1", receiptId: "or-old", accountCode: "520-0009", description: "", amountSen: 900, lineOrder: 0 });
  db.seedLegs("official_receipt", "or-old", [{ id: "lje-b", accountCode: "310-0009", debitSen: 900 }, { accountCode: "520-0009", creditSen: 900 }]);
  // The list (which fills the edit form, the popup and the print) reads today's codes.
  const list = await (await app.request("/official-receipts")).json();
  const row = list.data.find((x) => x.id === "or-old");
  assert.equal(row.payTo, "310-0001");
  assert.deepEqual(row.lines.map((l) => l.accountCode), ["520-0002"]);
  assert.equal(db.st.lines[0].accountCode, "520-0009", "the stored line is untouched");
  db.st.stmt.push({ id: "bsl-9", accountCode: "310-0001", txnDate: "2026-07-01", amountSen: 900, matchedLegId: "lje-b" });
  // Saved under today's codes (what the form now shows): the old bank leg
  // was 310-0009 = today's 310-0001, so the match moves instead of refusing.
  const e = await post(app, "/official-receipts/or-old/restate", { date: "2026-07-01", receivedFrom: "X", description: "", payTo: "310-0001", lines: [{ accountCode: "520-0002", description: "", amountSen: 900 }] });
  assert.equal(e.status, 200, await e.clone().text());
  const bank = visible(db.st, "or-old").find((l) => l.accountCode === "310-0001");
  assert.equal(db.st.stmt[0].matchedLegId, bank.id);
});
