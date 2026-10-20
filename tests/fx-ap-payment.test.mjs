// ---------------------------------------------------------------------------
// fx-ap-payment.test.mjs — an AP Payment pays foreign-currency bills
// (Currency & FX step 3, owner 2026-10-20 「要」; plan
// docs/superpowers/plans/2026-10-20-currency-fx.md). Typed in the bill's
// currency, priced at the payment's rate (the month's rate from Setup is the
// form's default); AP is cleared at the bill's booked RM, the bank pays
// foreign × rate, the difference is realised FX on the Setup accounts. One
// currency per payment; no advance, no drawdown on one. The real functions
// run against the in-memory ledger. Made-up figures only.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { makeLedgerDb, DEFAULT_COA, ORG } from "./_ledger-mock.mjs";

const href = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const acc = await import(href("src/api/routes/accounting.ts"));
const apfx = await import(href("src/lib/ap-fx.ts"));
const print = await import(href("src/lib/ap-payment-print.ts"));

// ---------------------------------------------------------------------------
// The rule (shared by the form and the server)
// ---------------------------------------------------------------------------

test("a foreign bill: what is still payable in its currency; covering it is a full payment", () => {
  assert.equal(apfx.foreignAvailableSen(445000, 4.45), 100000);
  assert.equal(apfx.foreignAvailableSen(445000, 0), 0);
  assert.deepEqual(apfx.apForeignPay({ availableSen: 445000, bookingRate: 4.45, foreignSen: 100000, payRate: 4.4 }),
    { ok: true, full: true, bookedSen: 445000, bankSen: 440000, fxSen: 5000 }, "paid less RM than booked: a gain");
  assert.deepEqual(apfx.apForeignPay({ availableSen: 445000, bookingRate: 4.45, foreignSen: 50000, payRate: 4.5 }),
    { ok: true, full: false, bookedSen: 222500, bankSen: 225000, fxSen: -2500 }, "a part payment at a dearer rate: a loss");
  assert.deepEqual(apfx.apForeignPay({ availableSen: 445000, bookingRate: 4.45, foreignSen: 100001, payRate: 4.4 }), { ok: false, error: "more than is still payable" });
  assert.equal(apfx.apForeignPay({ availableSen: 445000, reservedSen: 100, bookingRate: 4.45, foreignSen: 100000, payRate: 4.4 }).full, false,
    "another unposted voucher holds part of the bill — never cleared in full from here");
  assert.match(apfx.apForeignPay({ availableSen: 445000, bookingRate: 4.45, foreignSen: 100000, payRate: 0 }).error, /rate/);
  assert.match(apfx.apForeignPay({ availableSen: 445000, bookingRate: 4.45, foreignSen: 0, payRate: 4.4 }).error, /amount/);
});

// ---------------------------------------------------------------------------
// The server: validation and the posting
// ---------------------------------------------------------------------------

const BANK = "310-0001";
const TF = "310-0020";
const COA = [
  ...DEFAULT_COA,
  { code: "400-0000", type: "LIABILITY", specialAccountType: "SCC", isPostable: 1 },
  { code: "530-0000", type: "REVENUE", specialAccountType: null, isPostable: 1 },
  { code: "905-0000", type: "EXPENSE", specialAccountType: null, isPostable: 1 },
  { code: TF, type: "LIABILITY", specialAccountType: null, isPostable: 1 },
];
const coaMap = () => new Map(COA.map((a) => [a.code, a]));

function world(kv = {}) {
  const db = makeLedgerDb({ coa: COA.map((a) => ({ ...a })), kv });
  db.st.suppliers.push({ id: "sup-usd", name: "AN OVERSEAS MILL" });
  db.st.pis.push(
    { id: "pi-usd", pi_no: "PI-2610-101", supplier_invoice_no: "OM-1", invoice_date: "2026-10-01", due_date: null, amount_sen: 445000, paid_amount_sen: 0, status: "CONFIRMED", currency: "USD", fx_rate: 4.45, supplier_id: "sup-usd", supplier_name: "AN OVERSEAS MILL", is_opening: 0 },
    { id: "pi-myr", pi_no: "PI-2610-102", supplier_invoice_no: "OM-2", invoice_date: "2026-10-02", due_date: null, amount_sen: 50000, paid_amount_sen: 0, status: "CONFIRMED", currency: "MYR", fx_rate: 1, supplier_id: "sup-usd", supplier_name: "AN OVERSEAS MILL", is_opening: 0 },
  );
  return db;
}
const body = (o = {}) => ({ partyKind: "SUPPLIER", partyId: "sup-usd", payFrom: BANK, date: "2026-10-20", fxRate: "4.40", allocations: [{ docKind: "PI", docId: "pi-usd", foreignSen: 100000 }], ...o });

test("validate: a USD bill in USD at the payment's rate — AP cleared at the booked RM, the bank pays foreign × rate", async () => {
  const r = await acc.validatePvAp(world(), ORG, coaMap(), body(), null);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.v.fxCurrency, "USD");
  assert.equal(r.v.fxRate, 4.4);
  assert.deepEqual(r.v.allocs, [{ docKind: "PI", docId: "pi-usd", amountSen: 445000, foreignSen: 100000, full: true }]);
  assert.equal(r.v.totalSen, 440000, "the money out is what the bank pays");
  const part = await acc.validatePvAp(world(), ORG, coaMap(), body({ allocations: [{ docKind: "PI", docId: "pi-usd", foreignSen: 25000 }] }), null);
  assert.deepEqual(part.v.allocs, [{ docKind: "PI", docId: "pi-usd", amountSen: 111250, foreignSen: 25000, full: false }]);
  // An RM payment is untouched: no currency, no rate.
  const rm = await acc.validatePvAp(world(), ORG, coaMap(), body({ fxRate: undefined, allocations: [{ docKind: "PI", docId: "pi-myr", amountSen: 50000 }] }), null);
  assert.equal(rm.ok, true);
  assert.equal(rm.v.fxCurrency, null);
  assert.equal(rm.v.totalSen, 50000);
});

test("validate: a rate is required; one currency per payment; no advance, no drawdown, never more than is payable", async () => {
  const noRate = await acc.validatePvAp(world(), ORG, coaMap(), body({ fxRate: "" }), null);
  assert.match(noRate.error, /Enter this payment's USD rate/);
  const mixed = await acc.validatePvAp(world(), ORG, coaMap(), body({ allocations: [{ docKind: "PI", docId: "pi-myr", amountSen: 50000 }, { docKind: "PI", docId: "pi-usd", foreignSen: 100000 }] }), null);
  assert.match(mixed.error, /One currency per payment/);
  const mixed2 = await acc.validatePvAp(world(), ORG, coaMap(), body({ allocations: [{ docKind: "PI", docId: "pi-usd", foreignSen: 100000 }, { docKind: "PI", docId: "pi-myr", amountSen: 50000 }] }), null);
  assert.match(mixed2.error, /One currency per payment/);
  const adv = await acc.validatePvAp(world(), ORG, coaMap(), body({ advanceSen: 1000 }), null);
  assert.match(adv.error, /no advance/);
  const over = await acc.validatePvAp(world(), ORG, coaMap(), body({ allocations: [{ docKind: "PI", docId: "pi-usd", foreignSen: 100001 }] }), null);
  assert.match(over.error, /PI-2610-101: more than is still payable — USD 1000\.00/);
  const tfWorld = world({ trade_finance_sources: JSON.stringify([{ accountCode: TF, lenderSupplierId: "sup-lender", lenderName: "A LENDER", tenorDays: 90 }]) });
  tfWorld.st.suppliers.push({ id: "sup-lender", name: "A LENDER" });
  const draw = await acc.validatePvAp(tfWorld, ORG, coaMap(), body({ payFrom: TF }), null);
  assert.match(draw.error, /trade-finance drawdown is in RM/);
});

test("posting: DR creditors at the booked RM · CR bank at foreign × rate · the gain to 530-0000", async () => {
  const db = world();
  const r = await acc.pvApSettlementStatements(db, ORG, "user-1", {
    id: "pv-1", pvNo: "HPV-2610-901", date: "2026-10-20", payFrom: BANK, partyKind: "SUPPLIER", partyId: "sup-usd",
    reference: "TT-1", advanceSen: 0, fxRate: 4.4,
  }, [{ docKind: "PI", docId: "pi-usd", amountSen: 445000, foreignSen: 100000, full: true }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.totalSen, 440000);
  const before = db.st.legs.length;
  await db.batch(r.statements);
  assert.deepEqual(db.st.legs.slice(before).map((l) => [l.accountCode, l.debitSen, l.creditSen]), [
    ["400-0000", 445000, 0],
    [BANK, 0, 440000],
    ["530-0000", 0, 5000],
  ]);
  assert.equal(db.st.pis[0].paid_amount_sen, 445000);
  assert.equal(db.st.pis[0].status, "PAID");
});

test("posting: a loss debits the loss account Setup names; no rate → refused", async () => {
  const db = world({ fx_settings: JSON.stringify({ currencies: [{ code: "USD", name: "US Dollar" }], rates: {}, gainAccount: "530-0000", lossAccount: "905-0000" }) });
  const r = await acc.pvApSettlementStatements(db, ORG, "user-1", {
    id: "pv-2", pvNo: "HPV-2610-902", date: "2026-10-20", payFrom: BANK, partyKind: "SUPPLIER", partyId: "sup-usd",
    reference: null, advanceSen: 0, fxRate: 4.5,
  }, [{ docKind: "PI", docId: "pi-usd", amountSen: 222500, foreignSen: 50000, full: false }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const before = db.st.legs.length;
  await db.batch(r.statements);
  assert.deepEqual(db.st.legs.slice(before).map((l) => [l.accountCode, l.debitSen, l.creditSen]), [
    ["400-0000", 222500, 0],
    [BANK, 0, 225000],
    ["905-0000", 2500, 0],
  ]);
  const noRate = await acc.pvApSettlementStatements(world(), ORG, "user-1", {
    id: "pv-3", pvNo: "HPV-2610-903", date: "2026-10-20", payFrom: BANK, partyKind: "SUPPLIER", partyId: "sup-usd", reference: null, advanceSen: 0,
  }, [{ docKind: "PI", docId: "pi-usd", amountSen: 445000, foreignSen: 100000, full: true }]);
  assert.equal(noRate.ok, false);
  assert.match(noRate.error, /no rate/);
});

// ---------------------------------------------------------------------------
// The print and the screen
// ---------------------------------------------------------------------------

test("print: each bill in its currency and in RM at the payment's rate; the strip moves by the booked RM and names the FX", () => {
  const b = print.apBillsBlock(
    { bills: [{ docNo: "PI-2610-101", supplierInvNo: "OM-1", billDate: "2026-10-01", dueDate: "", outstandingBeforeSen: 445000, paidSen: 445000, foreignPaidSen: 100000 }], advanceSen: 0, balanceBeforeSen: 500000, fx: { currency: "USD", rate: 4.4 } },
    { totalSen: 440000, money: (s) => (s / 100).toFixed(2), docLabel: "Purchase invoice", refLabel: "Supplier inv no.", partyWord: "Supplier", fxMoney: (s, c) => `${c} ${(s / 100).toFixed(2)}` },
  );
  assert.deepEqual(b.columns.map((c) => c.label), ["Purchase invoice", "Supplier inv no.", "Bill date", "Due", "Outstanding (RM)", "Paid (USD)", "Paid (RM @ 4.40)"]);
  assert.deepEqual(b.lines[0].cells, ["PI-2610-101", "OM-1", "01/10/2026", "—", "4450.00", "USD 1000.00", "4400.00"]);
  assert.deepEqual(b.totalCells, ["", "", "", "", "Total", "USD 1000.00", "4400.00"]);
  assert.deepEqual(b.balanceStrip, [
    { label: "Supplier balance before", value: "5000.00" },
    { label: "Cleared (booked RM)", value: "− 4450.00" },
    { label: "Balance after", value: "550.00" },
    { label: "Realised FX gain", value: "50.00" },
  ]);
  // An RM payment prints exactly as before.
  const rm = print.apBillsBlock({ bills: [{ docNo: "PI-1", supplierInvNo: "", billDate: "", dueDate: "", outstandingBeforeSen: 1000, paidSen: 1000 }], advanceSen: 0, balanceBeforeSen: null },
    { totalSen: 1000, money: (s) => String(s), docLabel: "Bill", refLabel: "Ref", partyWord: "Creditor" });
  assert.deepEqual(rm.columns.map((c) => c.label), ["Bill", "Ref", "Bill date", "Due", "Outstanding", "Paid"]);
});

test("screen: a foreign bill is ticked in its currency; the rate box defaults to Setup; one currency per payment", () => {
  const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(ui, /const payable = b\.foreign \? \(b\.foreignAvailableSen \?\? 0\) : b\.availableSen;/);
  assert.match(ui, /if \(e\.target\.checked && b\.foreign\) fillFxRate\(b\.currency\);/);
  assert.match(ui, /if \(apFxRate\.trim\(\) \|\| !fxSettings\) return;\n\s+const r = fxRateFor\(fxSettings, ccy, apForm\.date\);/, "never over a typed rate");
  assert.match(ui, /Rate · \{fxMonthLabel\(fxMonthOf\(apForm\.date\)\)\} · \{apSetupRate === null \? "not in Setup" : apPayRate === apSetupRate \? "from Setup" : "edited"\}/);
  assert.match(ui, /FX \{apFxSen > 0 \? "gain" : "loss"\} \{formatCurrency\(Math\.abs\(apFxSen\)\)\} vs the invoice rate/);
  assert.match(ui, /\? \{ docKind: b\.docKind, docId: b\.id, foreignSen: apSen\(apAlloc\[b\.id\] \?\? ""\) \}/);
  assert.match(ui, /\.\.\.\(apFxCcy \? \{ fxRate: apPayRate \} : \{\}\),/);
  assert.match(ui, /const apAdvanceSen = apTfLender \|\| apFxCcy \? 0 : apSen\(apForm\.advance\);/);
  const acc2 = readFileSync("src/api/routes/accounting.ts", "utf8");
  assert.doesNotMatch(acc2, /pay foreign-currency invoices on the Supplier Payment page/, "the old refusal is gone");
});
