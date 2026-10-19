// ---------------------------------------------------------------------------
// The voucher print in the Finance v2 design (owner 2026-10-17, 「1a 但是签名
// 那边我要1b」): option 1a's layout with option 1b's boxed signatures, and an AP
// payment that prints the bills it settles with their dates and balances
// BEFORE the payment, plus the party's balance before / after.
//
// Also pins the three bugs found while building it:
//   BUG-2026-10-17-309 — GET /payment-vouchers read a transfer back as EXPENSE;
//   BUG-2026-10-17-310 — an other debtor's receipt printed as a payment voucher;
//   BUG-2026-10-17-311 — batch print dropped an AP voucher's bills.
// Made-up figures throughout.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildVouchersDocument } from "../src/lib/print-voucher.ts";
import { apBillsBlock, billOutstandingBefore, statementBalanceBefore } from "../src/lib/ap-payment-print.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const money = (sen) => `RM ${(sen / 100).toFixed(2)}`;

const base = {
  title: "PAYMENT VOUCHER",
  company: { name: "Acme Sdn Bhd", addressLines: ["1, Jalan Satu,", "Town"], regNo: "R1", tin: "T1", phone: "P1", email: "e@x" },
  docNo: "HPV-1", date: "01/10/2026", partyLabel: "Pay To", partyName: "Payee One",
  columns: [{ label: "Account" }, { label: "Amount", align: "right" }],
  lines: [{ cells: ["500-0000", "RM 10.00"] }],
  signatures: [{ label: "Prepared by", name: "Ann", on: "01/10/2026" }, { label: "Checked by" }, { label: "Approved by" }, { label: "Received by" }],
  printedOn: "02/10/2026",
};

test("the sheet: logo + company line, the party block, the boxed amount with the words inside", () => {
  const html = buildVouchersDocument([{
    ...base,
    partyDetails: [{ label: "Paid from", value: "310-0010 · Bank" }, { label: "Payee bank", value: "" }],
    amountBox: { label: "Amount paid", value: "RM 10.00" },
    amountWords: "Ringgit Ten Only",
  }]);
  assert.match(html, /<img class="logo" src="\/hookka-logo\.png"/, "the app's logo by default");
  assert.match(html, /<div class="co-meta">1, Jalan Satu, Town<br\/>Reg No: R1 · TIN: T1 · Tel: P1 · e@x<\/div>/, "address on one line");
  assert.match(html, /<div class="party-label">Pay To<\/div>\s*<div class="party-name">Payee One<\/div>/);
  assert.match(html, /Paid from <b>310-0010 · Bank<\/b>/);
  assert.doesNotMatch(html, /Payee bank/, "a detail with no value is not printed");
  assert.match(html, /<div class="amount-box"><div class="amount-label">Amount paid<\/div><div class="amount-value">RM 10\.00<\/div><div class="amount-words">Ringgit Ten Only<\/div><\/div>/);
  assert.doesNotMatch(html, /Amount in words:/, "the words sit in the box, not on their own line");
});

test("without an amount box the party block spans the row and the words keep their line", () => {
  const html = buildVouchersDocument([{ ...base, amountWords: "Ringgit Ten Only" }]);
  assert.match(html, /class="party-row solo"/);
  assert.match(html, /Amount in words:<\/span> Ringgit Ten Only/);
});

test("facts and the balance strip skip what has no value; signatures are boxes; the bottom line", () => {
  const html = buildVouchersDocument([{
    ...base,
    facts: [{ label: "Bill no.", value: "B-9" }, { label: "Bill date", value: "" }],
    balanceStrip: [{ label: "Supplier balance before", value: "RM 30.00" }, { label: "This payment", value: "− RM 10.00" }, { label: "Balance after", value: "RM 20.00" }],
  }]);
  assert.match(html, /<div class="facts"><span>Bill no\. <b>B-9<\/b><\/span><\/div>/);
  assert.match(html, /<div class="balance" style="grid-template-columns:repeat\(3,1fr\)">/);
  assert.equal((html.match(/class="bal"/g) || []).length, 3);
  assert.match(html, /<div class="sigs" style="grid-template-columns:repeat\(4,1fr\)">/);
  assert.equal((html.match(/<div class="sig">/g) || []).length, 4, "one box per signature");
  assert.match(html, /<div class="sig"><div class="sig-label">Prepared by<\/div><div class="sig-name">Ann<\/div><div class="sig-on">01\/10\/2026<\/div><\/div>/);
  assert.match(html, /<div class="bottom"><span>HPV-1 · computer-generated voucher<\/span><span>Printed on 02\/10\/2026<\/span><\/div>/);
  assert.match(html, /\.sig \{ border: 1px solid #E3DED6; border-radius: 8px;/, "1b's boxed signature style");
});

test("a bill's balance before = owed now + this payment + payments dated after it; same-day counts as before", () => {
  const bill = { totalSen: 100000, paidSen: 70000 }; // 300.00 still owed today
  const s = [
    { paymentNo: "HPV-OLD", date: "2026-09-01", sen: 10000 },   // before
    { paymentNo: "HPV-SAME", date: "2026-10-05", sen: 5000 },   // same day → before
    { paymentNo: "HPV-THIS", date: "2026-10-05", sen: 40000 },  // this payment
    { paymentNo: "HPV-LATER", date: "2026-10-20", sen: 15000 }, // after → added back
  ];
  assert.equal(billOutstandingBefore(bill, s, "HPV-THIS", "2026-10-05"), 30000 + 40000 + 15000);
  // A draft voucher has no rows of its own yet: owed now + later payments.
  assert.equal(billOutstandingBefore(bill, s.filter((x) => x.paymentNo !== "HPV-THIS"), "HPV-DRAFT", "2026-10-05"), 30000 + 15000);
});

test("a party's balance before = its statement at the payment date with this payment's own lines added back", () => {
  const lines = [
    { date: "2026-09-01", ref: "PI-1", type: "PURCHASE_INVOICE", debitSen: 0, creditSen: 100000 },
    { date: "2026-09-10", ref: "HPV-A", type: "PAYMENT", debitSen: 20000, creditSen: 0 },
    { date: "2026-10-05", ref: "HPV-THIS", type: "PAYMENT", debitSen: 30000, creditSen: 0 },
    { date: "2026-10-05", ref: "PI-2", type: "PURCHASE_INVOICE", debitSen: 0, creditSen: 5000 },
    { date: "2026-10-30", ref: "HPV-LATER", type: "PAYMENT", debitSen: 50000, creditSen: 0 },
  ];
  // 1,000 − 200 + 50 (same-day bill) = 850; this payment and the later one are not in it.
  assert.equal(statementBalanceBefore(lines, "HPV-THIS", "2026-10-05"), 85000);
});

test("the AP bills block: six columns, the advance and trade-finance rows, the strip", () => {
  const b = apBillsBlock(
    { bills: [{ docNo: "PI-1", supplierInvNo: "INV 7", billDate: "2026-08-12", dueDate: "", outstandingBeforeSen: 150000, paidSen: 150000 }], advanceSen: 5000, tfRepaySen: 2000, balanceBeforeSen: 400000 },
    { totalSen: 157000, money, docLabel: "Purchase invoice", refLabel: "Supplier inv no.", partyWord: "Supplier" },
  );
  assert.deepEqual(b.columns.map((c) => c.label), ["Purchase invoice", "Supplier inv no.", "Bill date", "Due", "Outstanding", "Paid"]);
  assert.deepEqual(b.lines[0].cells, ["PI-1", "INV 7", "12/08/2026", "—", "RM 1500.00", "RM 1500.00"]);
  assert.deepEqual(b.lines.map((l) => l.cells[0]), ["PI-1", "Trade finance repayment", "Advance / unallocated"]);
  assert.deepEqual(b.totalCells, ["", "", "", "", "Total", "RM 1570.00"]);
  assert.deepEqual(b.balanceStrip, [
    { label: "Supplier balance before", value: "RM 4000.00" },
    { label: "This payment", value: "− RM 1570.00" },
    { label: "Balance after", value: "RM 2430.00" },
  ]);
  // Unknown balance → no strip, and an unknown bill balance prints a dash.
  const u = apBillsBlock({ bills: [{ docNo: "B-1", supplierInvNo: "", billDate: "", dueDate: "", outstandingBeforeSen: null, paidSen: 100 }], advanceSen: 0, balanceBeforeSen: null },
    { totalSen: 100, money, docLabel: "Bill", refLabel: "Reference", partyWord: "Creditor" });
  assert.equal(u.balanceStrip, undefined);
  assert.deepEqual(u.lines[0].cells, ["B-1", "—", "—", "—", "—", "RM 1.00"]);
});

test("GET /ap-payment-print reads all three doors, leaves void payments out, uses the statement", () => {
  const api = read("src/api/routes/accounting.ts");
  const at = api.indexOf('app.get("/ap-payment-print"');
  assert.ok(at > 0, "the endpoint exists");
  assert.match(api.slice(at, at + 600), /requirePermission\(c, "accounting", "read"\)/);
  const fn = api.slice(api.indexOf("async function apPrintSource("), api.indexOf("async function loadApPaymentPrint("));
  assert.match(fn, /FROM payment_vouchers WHERE pvNo = \?/);
  assert.match(fn, /FROM supplier_payments\s*\n\s*WHERE payment_no = \? AND org_id = \? AND COALESCE\(method,''\) <> 'CREDIT_NOTE'/);
  assert.match(fn, /FROM other_party_payments WHERE paymentNo = \? AND orgId = \?/);
  const load = api.slice(api.indexOf("async function loadApPaymentPrint("), api.indexOf("async function loadApPaymentPrint(") + 7000);
  assert.match(load, /payment_no NOT IN \(SELECT sourceId FROM document_lifecycle WHERE sourceType = 'supplier_payment' AND state IN \('VOID','DELETED'\)\)/);
  assert.match(load, /dl\.sourceType = 'other_party_payment' AND dl\.sourceId = p\.paymentNo[\s\S]*?\(dl\.state IS NULL OR dl\.state = 'ACTIVE'\)/);
  assert.match(load, /supplierStatementLines\(db, src\.partyId\)/, "the supplier balance is the statement's");
  // The statement and the print share one line model.
  assert.match(api, /const \{ sup, lines \} = await supplierStatementLines\(c\.var\.DB, supplierId\);/);
});

test("BUG-2026-10-17-309: the voucher list keeps a transfer's kind", () => {
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /pvKind: isAp \? PV_KIND_AP : String\(r\.pvKind \?\? r\.pv_kind \?\? ""\) === PV_KIND_TRANSFER \? PV_KIND_TRANSFER : "EXPENSE",/);
  assert.doesNotMatch(api, /pvKind: isAp \? PV_KIND_AP : "EXPENSE",/);
});

test("BUG-2026-10-17-310: money in from an other debtor prints as a receipt", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const fn = ui.slice(ui.indexOf("function buildOtherPartyPaymentVoucher("), ui.indexOf("function buildFundTransferVoucher("));
  assert.match(fn, /const receipt = p\.partyType === "DEBTOR";/);
  assert.match(fn, /const title = receipt \? "OTHER-PARTY RECEIPT" : "OTHER-PARTY PAYMENT VOUCHER";/);
  assert.match(fn, /partyLabel: receipt \? "Received From" : "Pay To",/);
  assert.match(fn, /label: receipt \? "Deposited to" : "Paid from"/);
});

test("BUG-2026-10-17-311: every print of a bill-paying door loads its detail first, batch included", () => {
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /if \(r\.pvKind === "AP"\) \{\s*\n\s*const ap = \(await fetchApPrintDetail\(r\.pvNo\)\) \?\? pvApFallbackDetail\(r\);/);
  assert.match(ui, /row\.pv \? pvPrintSpec\(row\.pv\)/, "a batch prints a voucher through the same spec as a single print");
  assert.match(ui, /const printOtherPayments = async \(list: PaymentGroup\[\]\) => \{/);
  const sp = read("src/pages/invoices/supplier-payments.tsx");
  assert.match(sp, /const details = await Promise\.all\(list\.map\(\(p\) => fetchApPrintDetail\(p\.paymentNo\)\)\);/);
  assert.match(sp, /onPrint=\{\(\) => void printPayments\(sel\.selectedRows\)\}/);
});
