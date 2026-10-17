// ---------------------------------------------------------------------------
// Credit / debit notes can be posted and put back to draft (owner 2026-10-17,
// Finance v2: CN Post 「修」, CN / DN Back to Draft + CN as its own aging line
// 「做」). Posting a note moves its invoice's stored total (the note cascade),
// so every report that lists the note as its own line shows the invoice at
// the amount it was issued at (BUG-2026-10-17-315); a posted debit note can
// no longer be charged twice through a plain status edit
// (BUG-2026-10-17-316). Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  invoiceIssuedSen,
  noteIsIssued,
  splitOutstandingByNotes,
  sumIssuedNotesByInvoice,
} from "../src/lib/invoice-notes.ts";
import {
  buildNoteUnpostStatements,
  invoiceAfterNoteReversal,
  noteLedgerSourceType,
} from "../src/api/lib/note-ledger.ts";
import { planInvoicePriceImport } from "../src/lib/invoice-price-import.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// A ledger with the given legs for one note; records what the code asks.
function fakeLedger(legs) {
  return {
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...a) { stmt.args = a; return stmt; },
        async all() {
          if (/SELECT hidden FROM ledger_journal_entries/.test(sql)) return { results: legs.map((l) => ({ hidden: l.hidden })) };
          if (/SELECT accountCode, debitSen, creditSen FROM ledger_journal_entries/.test(sql)) return { results: legs.filter((l) => !l.hidden) };
          return { results: [] };
        },
        async first() { return null; },
      };
      return stmt;
    },
  };
}

test("which notes count: a credit note once APPROVED / POSTED, a debit note once POSTED", () => {
  assert.equal(noteIsIssued("CN", "DRAFT"), false);
  assert.equal(noteIsIssued("CN", "APPROVED"), true);
  assert.equal(noteIsIssued("CN", "POSTED"), true);
  assert.equal(noteIsIssued("DN", "APPROVED"), false);
  assert.equal(noteIsIssued("DN", "POSTED"), true);
  assert.equal(noteIsIssued("DN", null), false);
});

test("an invoice is shown at what it was issued at: its stored total with the notes worked back out", () => {
  const sums = sumIssuedNotesByInvoice(
    [
      { invoiceId: "inv-1", status: "POSTED", totalAmount: 12000 },
      { invoice_id: "inv-1", status: "APPROVED", total_amount: 3000 }, // snake_case row
      { invoiceId: "inv-1", status: "DRAFT", totalAmount: 99999 },      // drafts move nothing
      { invoiceId: "", status: "POSTED", totalAmount: 500 },            // no invoice → ignored
    ],
    [
      { invoiceId: "inv-1", status: "POSTED", totalAmount: 5000 },
      { invoiceId: "inv-2", status: "APPROVED", totalAmount: 7000 },    // not charged yet
    ],
  );
  assert.deepEqual(sums.get("inv-1"), { creditSen: 15000, debitSen: 5000 });
  assert.equal(sums.has("inv-2"), false);
  // Issued at 100,000; credit notes 15,000 off, debit note 5,000 on → stored 90,000.
  assert.equal(invoiceIssuedSen(90000, sums.get("inv-1")), 100000);
  assert.equal(invoiceIssuedSen(90000, undefined), 90000);
});

test("Debtor Aging: a note is its own line; the invoice shows what was owed before its notes", () => {
  // Issued 100,000, paid 30,000, credit note 20,000 → still owed 50,000.
  assert.equal(splitOutstandingByNotes(50000, [{ sen: -20000 }]), 70000);
  // Issued 100,000, debit note 10,000, paid 60,000 → still owed 50,000.
  assert.equal(splitOutstandingByNotes(50000, [{ sen: 10000 }]), 40000);
  // Debit note 10,000 already paid (paid 105,000 of 110,000): the split would
  // leave the invoice line at −5,000 → keep the one combined line.
  assert.equal(splitOutstandingByNotes(5000, [{ sen: 10000 }]), null);
  // The lines still add up to what is owed.
  const notes = [{ sen: -20000 }, { sen: 10000 }];
  assert.equal(splitOutstandingByNotes(50000, notes) + notes.reduce((s, n) => s + n.sen, 0), 50000);
});

test("Back to Draft puts the invoice back: a credit note's amount returns, a debit note's comes off", () => {
  // Issued 100,000, credit note 20,000 → 80,000 with 80,000 paid = PAID.
  assert.deepEqual(
    invoiceAfterNoteReversal({ totalSen: 80000, subtotalSen: 80000, paidAmount: 80000, status: "PAID" }, "credit_note", 20000),
    { totalSen: 100000, subtotalSen: 100000, status: "PARTIAL_PAID" },
  );
  // Nothing paid: a PAID-looking status cannot survive, SENT stays SENT.
  assert.equal(invoiceAfterNoteReversal({ totalSen: 80000, subtotalSen: 80000, paidAmount: 0, status: "SENT" }, "credit_note", 20000).status, "SENT");
  // Debit note 10,000 on 100,000 paid 100,000 → back to 100,000 fully paid.
  assert.deepEqual(
    invoiceAfterNoteReversal({ totalSen: 110000, subtotalSen: 110000, paidAmount: 100000, status: "PARTIAL_PAID" }, "debit_note", 10000),
    { totalSen: 100000, subtotalSen: 100000, status: "PAID" },
  );
});

test("the ledger source a post takes: first post, none while live, a fresh restate source after Back to Draft", async () => {
  assert.equal(await noteLedgerSourceType(fakeLedger([]), "org", "credit_note", "cn-1"), "credit_note");
  assert.equal(await noteLedgerSourceType(fakeLedger([{ hidden: 0 }, { hidden: 0 }]), "org", "credit_note", "cn-1"), null);
  assert.match(await noteLedgerSourceType(fakeLedger([{ hidden: 1 }, { hidden: 1 }]), "org", "debit_note", "dn-1"), /^debit_note_restate_post:\d+$/);
});

test("Back to Draft mirrors the live legs under a restate source, then hides the whole family", async () => {
  const live = [
    { accountCode: "510-0000", debitSen: 20000, creditSen: 0, hidden: 0 },
    { accountCode: "300-0000", debitSen: 0, creditSen: 20000, hidden: 0 },
    { accountCode: "520-0000", debitSen: 999, creditSen: 0, hidden: 1 }, // an earlier, hidden post
  ];
  const stmts = await buildNoteUnpostStatements(fakeLedger(live), "org", "credit_note", { id: "cn-1", noteNumber: "CN-0001" }, "u-1");
  const inserts = stmts.filter((s) => /INSERT INTO ledger_journal_entries/.test(s.sql));
  assert.equal(inserts.length, 2, "one mirror per live leg");
  // [id, sourceType, sourceId, legNo, accountCode, debitSen, creditSen, ...]
  assert.match(inserts[0].args[1], /^credit_note_restate_rev:\d+$/);
  assert.deepEqual(inserts.map((s) => [s.args[2], s.args[4], s.args[5], s.args[6]]), [
    ["cn-1", "510-0000", 0, 20000],
    ["cn-1", "300-0000", 20000, 0],
  ]);
  const hide = stmts[stmts.length - 1];
  assert.match(hide.sql, /UPDATE ledger_journal_entries SET hidden = 1 WHERE orgId = \? AND sourceId = \? AND sourceType LIKE \?/);
  assert.deepEqual(hide.args, ["org", "cn-1", "credit_note%"]);
  // Nothing live → nothing to undo in the books.
  assert.deepEqual(await buildNoteUnpostStatements(fakeLedger([]), "org", "debit_note", { id: "dn-1", noteNumber: "DN-0001" }, null), []);
});

test("the restate sources date on the note and show in Corrections", () => {
  const dd = read("src/lib/doc-date.ts");
  // The resolver strips _restate_rev / _restate_post back to the note's family.
  assert.match(dd, /_\(restate_rev\|restate_post\|reversal\|unvoid\|void\|bounce\|settle\)\$/);
  assert.match(dd, /credit_note: \{ table: "credit_notes"/);
  assert.match(dd, /debit_note: \{ table: "debit_notes"/);
});

test("the routes: Post keeps the issue rules, Back to Draft reverses in one batch, a posted DN can't be charged twice", () => {
  const cn = read("src/api/routes/credit-notes.ts");
  const dn = read("src/api/routes/debit-notes.ts");
  for (const [src, kind] of [[cn, "credit_note"], [dn, "debit_note"]]) {
    assert.doesNotMatch(src, /ledgerHasSource/, `${kind}: the live-set check replaces the bare source check`);
    assert.match(src, new RegExp(`noteLedgerSourceType\\(c\\.var\\.DB, orgId, "${kind}", id\\)`));
    assert.match(src, /app\.post\("\/:id\/unpost"/);
    assert.match(src, new RegExp(`buildNoteUnpostStatements\\(\\n\\s*c\\.var\\.DB,\\n\\s*orgId,\\n\\s*"${kind}",`));
    assert.match(src, /action: "unpost"/);
  }
  assert.equal((cn.match(/noteLedgerSourceType\(c\.var\.DB, orgId, "credit_note", id\)/g) ?? []).length, 2, "created-issued and PUT");
  // DN revert guard (BUG-2026-10-17-316).
  assert.match(dn, /if \(existing\.status === "POSTED" && status !== "POSTED"\) \{/);
  // A DN the customer already paid can't go back to draft.
  assert.match(dn, /\(Number\(inv\.paidAmount\) \|\| 0\) > \(Number\(inv\.totalSen\) \|\| 0\) - amount/);
  // Notes only move an issued invoice.
  assert.match(cn, /function noteInvoiceBlock\(invoiceNo: string, status: string \| null \| undefined\)/);
  assert.match(dn, /inv && \(inv\.status === "DRAFT" \|\| inv\.status === "CANCELLED"\)/);
});

test("an invoice with an issued note is locked: no edit, no cancel, no price import, no void-and-reissue", () => {
  const lock = read("src/api/lib/lock-helpers.ts");
  assert.match(lock, /const notes = await issuedNotesOnInvoice\(db, invoiceId\);\n\s*if \(notes\.length\) return issuedNotesLockMessage\("edit"/);
  assert.match(lock, /FROM credit_notes WHERE invoiceId = \? AND status IN \('APPROVED','POSTED'\)/);
  assert.match(lock, /FROM debit_notes WHERE invoiceId = \? AND status = 'POSTED'/);
  const inv = read("src/api/routes/invoices.ts");
  assert.match(inv, /issuedNotesLockMessage\("cancel", existing\.invoiceNo, notes\)/);
  assert.match(inv, /l\.invoiceNotes = notes;/);
  assert.match(read("src/api/routes/delivery-orders.ts"), /noteLocked \|\|/);
  // The price import refuses a line whose invoice carries a note.
  const plan = planInvoicePriceImport(
    [{ lineId: "l-1", invoiceNo: "INV-1", exportedUnit: 100, base: 120 }],
    new Map([["l-1", {
      id: "l-1", invoiceNo: "INV-1", invoiceId: "i-1", invoiceStatus: "SENT", invoicePaidSen: 0, invoiceNotes: ["CN-0001"],
      quantity: 1, unitPriceSen: 10000, basePriceSen: 10000, divanPriceSen: 0, legPriceSen: 0,
      totalHeightPriceSen: 0, specialOrderPriceSen: 0, discountSen: 0,
    }]]),
  );
  assert.equal(plan.changes.length, 0);
  assert.match(plan.rejections[0].reason, /CN-0001 has been issued against this invoice/);
});

test("statement, debtor ledger and aging show the invoice as issued and the notes as their own lines", () => {
  const acc = read("src/api/routes/accounting.ts");
  assert.match(acc, /debitSen: invoiceIssuedSen\(Number\(i\.totalSen\) \|\| 0, noteSums\.get\(i\.id\)\),/);
  assert.match(acc, /debitSen: invoiceIssuedSen\(Number\(i\.totalSen\) \|\| 0, noteSumsDl\.get\(i\.id\)\)/);
  assert.match(acc, /const invoiceSen = notesAr\.length \? splitOutstandingByNotes\(outstanding, notesAr\) : null;/);
  assert.match(acc, /"credit_notes", "debit_notes",/);
  // The invoice page and its print work the issued amount back the same way.
  assert.match(read("src/pages/invoices/detail.tsx"), /Invoice as issued \{formatCurrency\(invoiceIssuedSen\(invoice\.totalSen,/);
  assert.match(read("src/api/lib/invoice-print-extras.ts"), /return \{ customerSO, customerRef, priceByCode, items, noteAdjustSen \};/);
  const pdf = read("src/lib/generate-invoice-pdf.ts");
  assert.match(pdf, /sumLine\("TOTAL", fmtRM\(\(Number\(invoice\.totalSen\) \|\| 0\) \+ noteAdjustSen\), true, true\);/);
  assert.match(pdf, /amountInWords\(\(Number\(invoice\.totalSen\) \|\| 0\) \+ noteAdjustSen\)/);
});

test("the lists: Post on a draft, Back to Draft on an issued note; the phone list reads the real fields", () => {
  const cnPage = read("src/pages/invoices/credit-notes.tsx");
  assert.match(cnPage, /row\.status === "DRAFT"\n\s*\? \[\{ label: "Post", action: \(r: CreditNote\) => void postNote\(r\) \}\]\n\s*: \[\{ label: "Back to Draft", danger: true, action: \(r: CreditNote\) => void unpostNote\(r\) \}\]/);
  assert.match(cnPage, /\/api\/credit-notes\/\$\{encodeURIComponent\(cn\.id\)\}\/unpost/);
  const dnPage = read("src/pages/invoices/debit-notes.tsx");
  assert.match(dnPage, /row\.status !== "POSTED" \? \[\{ label: "Post"/);
  assert.match(dnPage, /row\.status !== "DRAFT" \? \[\{ label: "Back to Draft", danger: true/);
  const m = read("src/pages/m/config/modules.ts");
  assert.match(m, /code: str\(r, "noteNumber", "cnNo", "creditNoteNo"\)/);
  assert.match(m, /code: str\(r, "noteNumber", "dnNo", "debitNoteNo"\)/);
  assert.equal((m.match(/numCol\("amount", "Amount", \(r\) => num\(r, "totalAmount", "totalSen"\)\)/g) ?? []).length, 2);
});
