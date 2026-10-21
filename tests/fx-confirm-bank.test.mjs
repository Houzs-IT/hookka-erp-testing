// ---------------------------------------------------------------------------
// fx-confirm-bank.test.mjs — Confirm bank amount (Currency & FX step 4, owner
// 2026-10-20 「三步都做」; plan docs/superpowers/plans/2026-10-20-currency-fx.md).
// A foreign-currency AP payment posts at approval at the payment's rate; when
// Finance keys the RM the bank actually debited, the settlement is re-stated
// under the same number: each bill keeps the booked RM it cleared, the bank
// leg becomes exactly that RM (shared over the bills by their foreign
// amounts), the rest is realised FX on the Setup accounts. The real route and
// builders run against the in-memory ledger. Made-up figures only.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { makeLedgerDb, mountAccounting, post, balances, bankMatchedEditError, DEFAULT_COA, ORG } from "./_ledger-mock.mjs";

const href = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const acc = await import(href("src/api/routes/accounting.ts"));
const apfx = await import(href("src/lib/ap-fx.ts"));
const alloc = await import(href("src/lib/supplier-payment-alloc.ts"));
const daily = await import(href("src/lib/finance-daily.ts"));
const print = await import(href("src/lib/ap-payment-print.ts"));

// ---------------------------------------------------------------------------
// The maths (shared by the server and the confirm box)
// ---------------------------------------------------------------------------

test("the bank's RM is shared over the bills by their foreign amounts, to the sen", () => {
  assert.deepEqual(apfx.splitBankAmount(441235, [33333, 66667]), [147077, 294158]);
  assert.deepEqual(apfx.splitBankAmount(2, [1, 1, 1, 1]), [1, 1, 0, 0], "never negative, never more than the total");
  assert.deepEqual(apfx.splitBankAmount(500, [100000]), [500]);
  assert.deepEqual(apfx.splitBankAmount(500, []), []);
  for (const [total, w] of [[441235, [33333, 66667]], [100001, [7, 11, 13]], [99, [1, 2, 3, 4, 5, 6, 7]]]) {
    const parts = apfx.splitBankAmount(total, w);
    assert.equal(parts.reduce((s, x) => s + x, 0), total);
    assert.ok(parts.every((x) => x >= 0));
  }
});

test("the plan: rate = RM ÷ foreign to six decimals; the part already in RM is not re-priced", () => {
  assert.deepEqual(apfx.confirmBankPlan({ bankSen: 441235, foreignSens: [100000] }), { ok: true, rate: 4.41235, parts: [441235], foreignBankSen: 441235 });
  const withRm = apfx.confirmBankPlan({ bankSen: 490000, fixedSen: 50000, foreignSens: [100000] });
  assert.deepEqual(withRm, { ok: true, rate: 4.4, parts: [440000], foreignBankSen: 440000 });
  for (const bad of [0, -1, 12.5, Number.NaN]) assert.match(apfx.confirmBankPlan({ bankSen: bad, foreignSens: [100000] }).error, /Enter the RM the bank debited/);
  assert.match(apfx.confirmBankPlan({ bankSen: 40000, fixedSen: 50000, foreignSens: [100000] }).error, /already in RM/);
  assert.match(apfx.confirmBankPlan({ bankSen: 40000, foreignSens: [] }).error, /no foreign-currency bill/);
});

test("computeAlloc: the bank's RM and the booked RM, when given, win; otherwise nothing changes", () => {
  const base = { outstandingBookedSen: 445000, isForeign: true, fxRate: 4.45, foreignSen: 100000, payRate: 4.4, full: true };
  assert.deepEqual(alloc.computeAlloc(base), { ok: true, bookedSen: 445000, bankSen: 440000, fxDiffSen: 5000 });
  assert.deepEqual(alloc.computeAlloc({ ...base, payRate: 4.41235, bankSen: 441235, bookedSen: 445000 }), { ok: true, bookedSen: 445000, bankSen: 441235, fxDiffSen: 3765 });
  assert.deepEqual(alloc.computeAlloc({ ...base, full: false, bookedSen: 300000, bankSen: 290000 }), { ok: true, bookedSen: 300000, bankSen: 290000, fxDiffSen: 10000 });
  assert.equal(alloc.computeAlloc({ ...base, bookedSen: 445001 }).ok, false, "never more than is outstanding");
  // An RM bill ignores them.
  assert.deepEqual(alloc.computeAlloc({ outstandingBookedSen: 50000, isForeign: false, fxRate: 1, payMyrSen: 50000, full: false, bankSen: 1, bookedSen: 2 }), { ok: true, bookedSen: 50000, bankSen: 50000, fxDiffSen: 0 });
});

test("the list: a posted foreign payment reads 'Approved · bank amount pending' until it is confirmed", () => {
  const pending = daily.pvStatus({ approvalState: "APPROVED", fxPending: true });
  assert.equal(pending.label, "Approved · bank amount pending");
  assert.equal(pending.tone, "warn");
  assert.equal(daily.pvStatus({ approvalState: "APPROVED", fxPending: false }).label, "Approved · paid");
  assert.equal(daily.pvStatus({ approvalState: "CHECKED", fxPending: true }).label, "Checked · awaiting approval");
  assert.equal(daily.pvStatus({ status: "VOID", fxPending: true }).label, "VOID");
});

test("the print: each bill's RM is what the bank paid for it once posted, foreign × rate before", () => {
  const money = (s) => (s / 100).toFixed(2);
  const opts = { money, docLabel: "Bill", refLabel: "Ref", partyWord: "Supplier" };
  const bill = { docNo: "PI-1", supplierInvNo: "", billDate: "", dueDate: "", outstandingBeforeSen: 445000, paidSen: 445000, foreignPaidSen: 100000 };
  const posted = print.apBillsBlock({ bills: [{ ...bill, bankPaidSen: 441235 }], advanceSen: 0, balanceBeforeSen: null, fx: { currency: "USD", rate: 4.41235 } }, { ...opts, totalSen: 441235 });
  assert.equal(posted.lines[0].cells[6], "4412.35");
  assert.deepEqual(posted.balanceStrip, [{ label: "Realised FX gain", value: "37.65" }]);
  const draft = print.apBillsBlock({ bills: [bill], advanceSen: 0, balanceBeforeSen: null, fx: { currency: "USD", rate: 4.4 } }, { ...opts, totalSen: 440000 });
  assert.equal(draft.lines[0].cells[6], "4400.00");
});

// ---------------------------------------------------------------------------
// The route, end to end on the in-memory ledger
// ---------------------------------------------------------------------------

const BANK = "310-0001";
const COA = [
  ...DEFAULT_COA,
  { code: "400-0000", type: "LIABILITY", specialAccountType: "SCC", isPostable: 1 },
  { code: "530-0000", type: "REVENUE", specialAccountType: null, isPostable: 1 },
  { code: "905-0000", type: "EXPENSE", specialAccountType: null, isPostable: 1 },
];
const PV_NO = "HPV-2610-901";

// An approved AP payment of USD bills, posted at 4.40 exactly the way Approve
// posts it (pvApSettlementStatements), plus the voucher row.
async function world({ bills = [{ id: "pi-usd", foreignSen: 100000 }], kv = {} } = {}) {
  const db = makeLedgerDb({ coa: COA.map((a) => ({ ...a })), kv });
  db.st.suppliers.push({ id: "sup-usd", name: "AN OVERSEAS MILL" });
  db.st.pis.push(
    { id: "pi-usd", pi_no: "PI-2610-101", supplier_invoice_no: "OM-1", invoice_date: "2026-10-01", due_date: null, amount_sen: 445000, paid_amount_sen: 0, status: "CONFIRMED", currency: "USD", fx_rate: 4.45, supplier_id: "sup-usd", supplier_name: "AN OVERSEAS MILL", is_opening: 0 },
    { id: "pi-usd2", pi_no: "PI-2610-103", supplier_invoice_no: "OM-3", invoice_date: "2026-10-03", due_date: null, amount_sen: 300000, paid_amount_sen: 0, status: "CONFIRMED", currency: "USD", fx_rate: 4.5, supplier_id: "sup-usd", supplier_name: "AN OVERSEAS MILL", is_opening: 0 },
  );
  const allocs = bills.map((b) => {
    const pi = db.st.pis.find((p) => p.id === b.id);
    const r = apfx.apForeignPay({ availableSen: pi.amount_sen - pi.paid_amount_sen, bookingRate: pi.fx_rate, foreignSen: b.foreignSen, payRate: 4.4 });
    return { docKind: "PI", docId: b.id, amountSen: r.bookedSen, foreignSen: b.foreignSen, full: r.full };
  });
  const built = await acc.pvApSettlementStatements(db, ORG, "user-1", {
    id: "pv-1", pvNo: PV_NO, date: "2026-10-20", payFrom: BANK, partyKind: "SUPPLIER", partyId: "sup-usd",
    reference: "TT-1", advanceSen: 0, fxRate: 4.4,
  }, allocs);
  assert.equal(built.ok, true, JSON.stringify(built));
  await db.batch(built.statements);
  db.st.vouchers.push({
    id: "pv-1", pvNo: PV_NO, date: "2026-10-20", status: "POSTED", approvalState: "APPROVED", pvKind: "AP",
    partyKind: "SUPPLIER", partyId: "sup-usd", payFrom: BANK, payee: "AN OVERSEAS MILL", description: "", reference: "TT-1",
    fxCurrency: "USD", fxRate: 4.4, totalSen: built.totalSen, fxBankConfirmedAt: null, fxBankConfirmedBy: null,
  });
  return { db, app: mountAccounting(db) };
}
const confirmBank = (app, bankSen, id = "pv-1") => post(app, `/payment-vouchers/${id}/confirm-bank`, { bankSen });
const rowsOf = (db) => db.st.supplierPayments.filter((p) => p.paymentNo === PV_NO);

test("confirm: the bank's RM replaces the estimate — same number, AP still at the booked RM, the gain on 530-0000", async () => {
  const { db, app } = await world();
  assert.deepEqual(balances(db.st, PV_NO), { "400-0000": 445000, [BANK]: -440000, "530-0000": -5000 });
  const res = await confirmBank(app, 441235);
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.deepEqual(j.data, { pvNo: PV_NO, bankSen: 441235, rate: 4.41235, fxSen: 3765, reposted: true });
  assert.deepEqual(balances(db.st, PV_NO), { "400-0000": 445000, [BANK]: -441235, "530-0000": -3765 });
  assert.deepEqual(rowsOf(db).map((p) => [p.purchaseInvoiceId, p.amountSen, p.bookedSen, p.foreignSen, p.payFxRate, p.reference]),
    [["pi-usd", 441235, 445000, 100000, 4.41235, "TT-1"]]);
  assert.deepEqual([db.st.pis[0].paid_amount_sen, db.st.pis[0].status], [445000, "PAID"], "the bill stays paid at its booked RM");
  const v = db.st.vouchers[0];
  assert.deepEqual([v.totalSen, v.fxRate, v.fxBankConfirmedBy], [441235, 4.41235, "user-1"]);
  assert.ok(v.fxBankConfirmedAt);
});

test("confirm: dearer than the invoices — the loss on the Setup loss account", async () => {
  const { db, app } = await world({ kv: { fx_settings: JSON.stringify({ currencies: [{ code: "USD", name: "US Dollar" }], rates: {}, gainAccount: "530-0000", lossAccount: "905-0000" }) } });
  const res = await confirmBank(app, 446000);
  assert.equal(res.status, 200);
  assert.deepEqual(balances(db.st, PV_NO), { "400-0000": 445000, [BANK]: -446000, "905-0000": 1000 });
});

test("confirm: two bills share the bank's RM by their USD; each keeps the RM it cleared", async () => {
  const { db, app } = await world({ bills: [{ id: "pi-usd", foreignSen: 33333 }, { id: "pi-usd2", foreignSen: 66667 }] });
  const booked = rowsOf(db).map((p) => [p.purchaseInvoiceId, p.bookedSen]);
  assert.deepEqual(booked, [["pi-usd", 148332], ["pi-usd2", 300000]]);
  const res = await confirmBank(app, 441235);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(rowsOf(db).map((p) => [p.purchaseInvoiceId, p.bookedSen]), booked);
  assert.deepEqual(rowsOf(db).map((p) => p.amountSen), [147077, 294158]);
  assert.deepEqual(balances(db.st, PV_NO), { "400-0000": 448332, [BANK]: -441235, "530-0000": -7097 });
  assert.deepEqual(db.st.pis.map((p) => [p.id, p.paid_amount_sen, p.status]), [["pi-usd", 148332, "PARTIAL_PAID"], ["pi-usd2", 300000, "PAID"]]);
});

test("confirm: the estimate was right to the sen — nothing re-posted, only the stamp", async () => {
  const { db, app } = await world();
  const legs = db.st.legs.length;
  const j = await (await confirmBank(app, 440000)).json();
  assert.equal(j.success, true);
  assert.equal(j.data.reposted, false);
  assert.equal(db.st.legs.length, legs);
  assert.equal(db.st.vouchers[0].totalSen, 440000);
  assert.ok(db.st.vouchers[0].fxBankConfirmedAt);
});

test("confirm: keyed again corrects it — only the newest posting counts", async () => {
  const { db, app } = await world();
  assert.equal((await confirmBank(app, 441235)).status, 200);
  assert.equal((await confirmBank(app, 441000)).status, 200);
  assert.deepEqual(balances(db.st, PV_NO), { "400-0000": 445000, [BANK]: -441000, "530-0000": -4000 });
  assert.deepEqual(rowsOf(db).map((p) => p.amountSen), [441000]);
  assert.equal(db.st.pis[0].paid_amount_sen, 445000);
});

test("confirm: a bank leg matched in Cash Book refuses (unmatch it first); nothing is written", async () => {
  const { db, app } = await world();
  const bankLeg = db.st.legs.find((l) => l.sourceId === PV_NO && l.accountCode === BANK && l.hidden === 0);
  db.st.stmt.push({ id: "bsl-1", matchedLegId: bankLeg.id });
  const legs = db.st.legs.length;
  const res = await confirmBank(app, 441235);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, bankMatchedEditError("payment"));
  assert.equal(db.st.legs.length, legs);
  assert.equal(db.st.vouchers[0].fxBankConfirmedAt, null);
  assert.equal(db.st.vouchers[0].totalSen, 440000);
});

test("confirm: only a posted, live, foreign-currency supplier AP payment; a whole positive RM", async () => {
  const { db, app } = await world();
  for (const bad of [0, -5, 12.5, "abc", null]) {
    const r = await confirmBank(app, bad);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Enter the RM the bank debited/);
  }
  assert.equal((await confirmBank(app, 441235, "pv-x")).status, 404);
  const base = db.st.vouchers[0];
  db.st.vouchers.push({ ...base, id: "pv-rm", pvNo: "HPV-2610-902", fxCurrency: null });
  assert.match((await (await confirmBank(app, 441235, "pv-rm")).json()).error, /Only a foreign-currency AP payment/);
  db.st.vouchers.push({ ...base, id: "pv-oc", pvNo: "HPV-2610-903", partyKind: "OTHER" });
  assert.match((await (await confirmBank(app, 441235, "pv-oc")).json()).error, /Only a foreign-currency AP payment/);
  db.st.vouchers.push({ ...base, id: "pv-chk", pvNo: "HPV-2610-904", approvalState: "CHECKED" });
  assert.match((await (await confirmBank(app, 441235, "pv-chk")).json()).error, /Not posted yet/);
  db.st.lifecycle.push({ orgId: ORG, sourceType: "supplier_payment", sourceId: PV_NO, state: "VOID" });
  assert.match((await (await confirmBank(app, 441235)).json()).error, /is voided — restore it first/);
  assert.deepEqual(balances(db.st, PV_NO), { "400-0000": 445000, [BANK]: -440000, "530-0000": -5000 }, "nothing changed");
});

// ---------------------------------------------------------------------------
// The screens and the wiring
// ---------------------------------------------------------------------------

test("the screens: row menu and popup offer it, the list says pending, the cash board flags it", () => {
  const ui = readFileSync("src/pages/accounting/index.tsx", "utf8");
  assert.match(ui, /label: r\.fxBankConfirmedAt \? "Change bank amount" : "Confirm bank amount", action: \(\) => setConfirmBankId\(r\.id\)/);
  assert.match(ui, /function PvConfirmBankModal\(/);
  assert.match(ui, /\/confirm-bank`/);
  assert.match(ui, /fxPending: pvFxPending\(r\)/);
  assert.match(ui, /BANK AMOUNT PENDING — foreign-currency payments at the estimated rate/);
  // BUG-2026-10-20-350: an AP voucher's ledger entry is its settlement's, under its number.
  assert.match(ui, /family=\{r\.pvKind === "AP" \? \(r\.partyKind === "OTHER" \? "other_party_payment" : "supplier_payment"\) : "payment_voucher"\}/);
  assert.match(ui, /sourceId=\{r\.pvKind === "AP" \? r\.pvNo : r\.id\}/);
  const api = readFileSync("src/api/routes/accounting.ts", "utf8");
  assert.match(api, /app\.post\("\/payment-vouchers\/:id\/confirm-bank"/);
  assert.match(api, /awaitingCheckedSen, fxBankPending, tradeFinance/);
  assert.match(api, /"fx_bank_confirmed_at TEXT", "fx_bank_confirmed_by TEXT"/);
  // The Supplier Payment page's own edit never carries the confirm-only fields.
  const sp = readFileSync("src/api/routes/supplier-payments.ts", "utf8");
  assert.match(sp, /body\.allocations = body\.allocations\.map\(\(\{ piId, payMyrSen, foreignSen, payRate, full \}\) => \(\{ piId, payMyrSen, foreignSen, payRate, full \}\)\);/);
});
