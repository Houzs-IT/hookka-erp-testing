// ---------------------------------------------------------------------------
// Debtor / Creditor Aging as at a chosen month-end (owner 2026-10-17, Finance
// v2 「要」). Every open item is rolled BACK from today: what it owes now plus
// what was settled on it after the as-at date (receipts; supplier payments,
// supplier credit-note knock-offs included; other-party payments; trade-
// finance repayments), notes issued after it put back the other way, items
// dated after it left out. Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  asAtNow,
  notesAfter,
  otherPartyPaymentsAfter,
  owedAt,
  receiptsAfter,
  receiptsAheadOf,
  supplierPaymentsAfter,
  supplierPaymentsAheadOf,
} from "../src/api/lib/aging-as-at.ts";
import { loadTfDrawsAt } from "../src/api/lib/trade-finance.ts";
import { monthsOverdue } from "../src/lib/terms.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// A database that answers each query by a matcher on its SQL; records binds.
function fakeDb(answers) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const st = {
        sql, args: [],
        bind(...a) { st.args = a; return st; },
        async all() {
          calls.push({ sql, args: st.args });
          const hit = answers.find(([re]) => re.test(sql));
          return { results: hit ? hit[1](st.args) : [] };
        },
      };
      return st;
    },
  };
}

test("an item owed at the date = owed now + settled after; ages are measured at the date", () => {
  assert.equal(owedAt(0, 50000), 50000, "paid in full after the date: fully open then");
  assert.equal(owedAt(30000, 20000), 50000);
  assert.equal(owedAt(10000, -5000), 5000, "a debit note added after the date is taken back off");
  assert.equal(monthsOverdue("2026-07-15", asAtNow("2026-09-30")), 2);
  assert.equal(monthsOverdue("2026-09-01", asAtNow("2026-09-30")), 0);
});

test("receipts after the date: live receipts' allocations per invoice; a bounced one counts for nothing", async () => {
  const db = fakeDb([[/FROM payment_records p/, () => [
    { allocations: JSON.stringify([{ invoiceId: "i-1", amount: 30000 }, { invoiceId: "i-2", amount: 5000 }]), status: "CLEARED" },
    { allocations: JSON.stringify([{ invoiceId: "i-1", amount: 1000 }]), status: "BOUNCED" },
    { allocations: "not json", status: "CLEARED" },
  ]]]);
  const m = await receiptsAfter(db, "2026-09-30");
  assert.deepEqual([...m], [["i-1", 30000], ["i-2", 5000]]);
  assert.match(db.calls[0].sql, /WHERE p\.date > \?/);
  assert.match(db.calls[0].sql, /dl\.source_type = 'payment' AND dl\.source_id = p\.id AND dl\.state <> 'ACTIVE'/);
  assert.deepEqual(db.calls[0].args, ["2026-09-30"]);
});

test("notes after the date: a credit note goes back on (+), a debit note comes off (−)", async () => {
  const db = fakeDb([
    [/FROM credit_notes/, () => [{ invoiceId: "i-1", totalAmount: 20000 }]],
    [/FROM debit_notes/, () => [{ invoice_id: "i-1", total_amount: 5000 }, { invoiceId: "i-2", totalAmount: 700 }]],
  ]);
  const m = await notesAfter(db, "2026-09-30");
  assert.deepEqual([...m], [["i-1", 15000], ["i-2", -700]]);
  assert.match(db.calls[0].sql, /status IN \('APPROVED','POSTED'\) AND date > \?/);
  assert.match(db.calls[1].sql, /status = 'POSTED' AND date > \?/);
});

test("supplier payments after the date: the booked amount per bill (a credit-note knock-off books with no bank amount)", async () => {
  const db = fakeDb([[/FROM supplier_payments sp/, () => [
    { purchase_invoice_id: "p-1", booked_sen: 13678, amount_sen: 13678 },
    { purchase_invoice_id: "p-1", booked_sen: 8414, amount_sen: 0 },   // CREDIT_NOTE marker
    { purchase_invoice_id: "p-2", booked_sen: 9000, amount_sen: 9100 }, // foreign: bank differs
    { purchase_invoice_id: "p-3", booked_sen: null, amount_sen: 400 },  // legacy row
  ]]]);
  const m = await supplierPaymentsAfter(db, "org", "2026-09-30");
  assert.deepEqual([...m], [["p-1", 22092], ["p-2", 9000], ["p-3", 400]]);
  assert.match(db.calls[0].sql, /LEFT JOIN purchase_credit_notes pcn ON sp\.method = 'CREDIT_NOTE' AND pcn\.note_number = sp\.payment_no/);
  assert.match(db.calls[0].sql, /sp\.purchase_invoice_id IS NOT NULL AND COALESCE\(pcn\.date, sp\.date\) > \?/, "a credit note's knock-off is dated by the note");
  assert.match(db.calls[0].sql, /dl\.source_type = 'supplier_payment' AND dl\.source_id = sp\.payment_no AND dl\.state <> 'ACTIVE'/);
});

test("other-party payments after the date, per bill", async () => {
  const db = fakeDb([[/FROM other_party_payments pp/, () => [{ bill_id: "b-1", amount_sen: 600 }, { billId: "b-1", amountSen: 400 }]]]);
  const m = await otherPartyPaymentsAfter(db, "org", "2026-09-30");
  assert.deepEqual([...m], [["b-1", 1000]]);
  assert.match(db.calls[0].sql, /dl\.sourceType = 'other_party_payment' AND dl\.sourceId = pp\.paymentNo/);
});

test("trade finance as at the date: the draws rebuilt from the ledger lines dated by then", async () => {
  // D-1 drawn 10/09 (31,000), interest 4.50 charged 02/09 on D-1 and 5.00 on 02/10,
  // repaid 10,000 on 05/10 (after) and 3,000 on 20/09 (before). An interest
  // line of 3.20 sat on P-6 at the date and was moved onto D-2 on 05/10.
  const db = fakeDb([
    [/FROM ledger_journal_entries/, () => [
      { sourceType: "supplier_payment", sourceId: "D-1", debitSen: 0, creditSen: 3100000, postedAt: "2026-09-10" },
      { sourceType: "tf_interest", sourceId: "tfint-2026-09-02-D-1", debitSen: 0, creditSen: 450, postedAt: "2026-09-02" },
      { sourceType: "tf_interest", sourceId: "tfint-2026-10-02-D-1", debitSen: 0, creditSen: 500, postedAt: "2026-10-02" },
      { sourceType: "supplier_payment", sourceId: "D-2", debitSen: 0, creditSen: 3000000, postedAt: "2026-09-14" },
      { sourceType: "tf_interest", sourceId: "tfint-2026-09-15-P-6", debitSen: 0, creditSen: 320, postedAt: "2026-09-15" },
      { sourceType: "tf_interest", sourceId: "tfint-2026-10-05-P-6", debitSen: 320, creditSen: 0, postedAt: "2026-10-05" },
      { sourceType: "tf_interest", sourceId: "tfint-2026-10-05-D-2", debitSen: 0, creditSen: 320, postedAt: "2026-10-05" },
      { sourceType: "supplier_payment", sourceId: "D-3", debitSen: 0, creditSen: 999, postedAt: "2026-10-03" }, // drawn after
      { sourceType: "supplier_payment", sourceId: "R-1", debitSen: 1000000, creditSen: 0, postedAt: "2026-10-05" },
      { sourceType: "supplier_payment", sourceId: "R-2", debitSen: 300000, creditSen: 0, postedAt: "2026-09-20" },
    ]],
    [/FROM trade_finance_repay_allocs/, () => [
      { repay_payment_no: "R-1", draw_source_id: "D-1", amount_sen: 1000000 },
      { repay_payment_no: "R-2", draw_source_id: "D-1", amount_sen: 300000 },
    ]],
    [/FROM supplier_payments WHERE payment_no IN/, () => [
      { payment_no: "D-1", pay_date: "2026-09-10" }, { payment_no: "D-2", pay_date: "2026-09-14" }, { payment_no: "D-3", pay_date: "2026-10-03" },
      { payment_no: "R-1", pay_date: "2026-10-05" }, { payment_no: "R-2", pay_date: "2026-09-20" },
    ]],
    [/FROM trade_finance_draws/, () => [{ draw_source_id: "D-1", draw_date: "2026-09-10", due_date: "2026-12-09" }]],
    [/SELECT DISTINCT paymentNo FROM supplier_payments WHERE method = 'TF_REPAYMENT'/, () => [{ paymentNo: "R-1" }, { paymentNo: "R-2" }]],
  ]);
  db.prepare = ((orig) => (sql) => { const st = orig(sql); st.run = async () => ({}); return st; })(db.prepare);
  const at = await loadTfDrawsAt(db, { accountCode: "TF", lenderName: "L", tenorDays: 90 }, "2026-09-30");
  const by = new Map(at.draws.map((d) => [d.drawSourceId, d]));
  assert.equal(by.get("D-1").outstandingSen, 3100000 + 450 - 300000, "the October interest and repayment are not in yet");
  assert.equal(by.get("D-2").outstandingSen, 3000000, "the moved interest is not on D-2 yet");
  assert.equal(by.get("P-6").outstandingSen, 320, "…it sat on P-6 at the date, as the ledger has it");
  assert.equal(by.has("D-3"), false, "drawn after the date");
  assert.equal(at.accountNetSen, 3100000 + 450 + 3000000 + 320 - 300000, "the account as at the date");
});

test("/aging: a past asOf builds fresh; PAID items count, later items don't; ages measured at the date", () => {
  const api = read("src/api/routes/accounting.ts");
  const at = api.indexOf('app.get("/aging"');
  const block = api.slice(at, api.indexOf('app.post("/aging"', at));
  assert.match(block, /const asOf = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(asOfQ\) && asOfQ < new Date\(\)\.toISOString\(\)\.slice\(0, 10\) \? asOfQ : null;/);
  assert.match(block, /const data = asOf\n\s*\? await buildAging\(\)\n\s*: await withSnapshot\(c\.var\.DB, snapshotConfig, orgId, buildAging, cacheKey\);/);
  assert.equal((block.match(/\["DRAFT", "CANCELLED", \.\.\.\(asOf \? \[\] : \["PAID"\]\)\]\.includes/g) ?? []).length, 2, "invoices and purchase invoices");
  assert.match(block, /\(arBack\?\.get\(i\.id\) \?\? 0\) \+ \(notesBack\?\.get\(i\.id\) \?\? 0\)/);
  assert.match(block, /apBack\?\.get\(p\.id\) \?\? 0/);
  assert.equal((block.match(/const advItems = asOf \? adv\.items\.filter\(\(it\) => it\.date <= asOf\) : adv\.items;/g) ?? []).length, 2);
  assert.match(block, /monthsOverdue\(i\.invoiceDate \?\? i\.dueDate, nowRef\)/);
  assert.match(block, /monthsOverdue\(p\.invoiceDate \?\? p\.dueDate, nowRef\)/);
  assert.match(block, /if \(asOf && String\(n\.date \?\? ""\)\.slice\(0, 10\) > asOf\) continue;/);
  assert.match(block, /const derived = asOf \? await loadTfDrawsAt\(c\.var\.DB, s, asOf\) : await loadTfDraws\(c\.var\.DB, s\);/);
  // The other two reads the aging page makes take the date too.
  assert.match(api, /owedAt\(pre \? 0 : r\.amt, paidBack\?\.get\(r\.id\) \?\? 0\)/, "a pre-opening bill counts for what was paid after the date");
  assert.match(api, /\.filter\(\(r\) => asOf \|\| !rowBeforeOpening\(r\.billDate, obDateOpa, r\.isOpening \?\? r\.is_opening\)\)/);
  assert.match(api, /b\.billDate <= \?/);
  assert.equal((api.match(/const derived = asOf \? await loadTfDrawsAt\(c\.var\.DB, s, asOf\) : await loadTfDraws\(c\.var\.DB, s\);/g) ?? []).length, 2, "/aging and /trade-finance");
});

test("the pages: a month stepper; a past month reads ?asOf= and the trial balance as at then", () => {
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /function useAgingAsAt\(\) \{/);
  assert.match(ui, /const asOf = asAtDate\(ym, today\);\n\s*const isPast = asOf < today;/);
  assert.match(ui, /function useControlsAsAt\(asOf: string \| null, codes: string\[\], company: string, side: "debit" \| "credit"\)/);
  assert.equal((ui.match(/<PeriodStepper value=\{at\.ym\} options=\{at\.ymOptions\} onChange=\{at\.setYm\} today=\{at\.today\} \/>/g) ?? []).length, 2, "Debtor and Creditor Aging");
  assert.equal((ui.match(/fetch\(`\/api\/accounting\/aging\?asOf=\$\{at\.asOf\}/g) ?? []).length, 2);
  assert.match(ui, /other-party-aging\?type=DEBTOR\$\{at\.isPast \? `&asOf=\$\{at\.asOf\}` : ""\}/);
  assert.match(ui, /other-party-aging\?type=CREDITOR\$\{q \? `&\$\{q\}` : ""\}/);
  assert.match(ui, /`\/api\/accounting\/trade-finance\$\{q \? `\?\$\{q\}` : ""\}`/);
  assert.match(ui, /const pastCtl = useControlsAsAt\(at\.isPast \? at\.asOf : null, arCodes, company, "debit"\);/);
  assert.match(ui, /const pastCtl = useControlsAsAt\(at\.isPast \? at\.asOf : null, apCodes, company, "credit"\);/);
  assert.match(ui, /\{ctl\.data && !at\.isPast && \(/, "the counter rebuild is a today-only action");
  assert.match(ui, /\/\/ Ages, Next Due and Overdue are measured at the as-at date\.\n\s*const today = at\.asOf;/);
});

test("money received / paid by the date but knocked off a document dated after it is an advance at the date", async () => {
  const ar = fakeDb([[/FROM payment_records p/, () => [
    { customer_id: "c-1", customer_name: "A", receipt_number: "OR-1", date: "2026-09-25", status: "CLEARED",
      allocations: JSON.stringify([{ invoiceId: "i-late", amount: 7000 }, { invoiceId: "i-early", amount: 3000 }]) },
    { customer_id: "c-1", customer_name: "A", receipt_number: "OR-2", date: "2026-09-26", status: "BOUNCED",
      allocations: JSON.stringify([{ invoiceId: "i-late", amount: 500 }]) },
  ]]]);
  const invDate = new Map([["i-late", "2026-10-02"], ["i-early", "2026-09-01"]]);
  const a = await receiptsAheadOf(ar, "2026-09-30", invDate);
  assert.deepEqual(a.get("c-1"), { name: "A", items: [{ no: "OR-1", date: "2026-09-25", sen: 7000 }] });
  assert.match(ar.calls[0].sql, /WHERE p\.date <= \?/);

  const ap = fakeDb([[/FROM supplier_payments sp/, () => [
    { supplier_id: "s-1", supplier_name: "S", payment_no: "PV-1", date: "2026-09-28", purchase_invoice_id: "p-late", booked_sen: 4000, amount_sen: 4000 },
    { supplier_id: "s-1", supplier_name: "S", payment_no: "PV-1", date: "2026-09-28", purchase_invoice_id: "p-late2", booked_sen: 1000, amount_sen: 1000 },
    { supplier_id: "s-1", supplier_name: "S", payment_no: "PV-2", date: "2026-09-28", purchase_invoice_id: "p-early", booked_sen: 9000, amount_sen: 9000 },
  ]]]);
  const piDate = new Map([["p-late", "2026-10-03"], ["p-late2", "2026-10-09"], ["p-early", "2026-09-10"]]);
  const b = await supplierPaymentsAheadOf(ap, "org", "2026-09-30", piDate);
  assert.deepEqual(b.get("s-1"), { name: "S", items: [{ no: "PV-1", date: "2026-09-28", sen: 5000 }] }, "one advance per payment");
  // The aging merges them into the advance lines.
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /for \(const \[id, a\] of await supplierPaymentsAheadOf\(c\.var\.DB, orgId, asOf, piDate\)\)/);
  assert.match(api, /for \(const \[id, a\] of await receiptsAheadOf\(c\.var\.DB, asOf, invDate\)\)/);
  assert.match(api, /for \(const \[supplierId, adv\] of supAdv\) \{/);
  assert.match(api, /for \(const \[customerId, adv\] of custAdv\) \{/);
});
