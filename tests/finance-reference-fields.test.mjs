// ---------------------------------------------------------------------------
// finance-reference-fields.test.mjs — the Reference on payment vouchers and
// journal entries (owner 2026-10-19 「先做 Reference 栏」): the TT / cheque no.
// (or, on an AP Payment drawn on trade finance, the bank's drawdown no.), its
// own field — the description stays the printed text. Stored on every write
// path, shown on the lists, the popups and the prints.
// Made-up values only (the repo is public).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_MAX, normaliseReference, settlementReference } from "../src/lib/doc-reference.ts";
import { groupSupplierPaymentRows } from "../src/lib/supplier-payment-alloc.ts";
import { buildVoucherSheet } from "../src/lib/print-voucher.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/index.tsx");
const slice = (src, from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `marker ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `marker ${to}`);
  return src.slice(a, b);
};

test("the stored Reference: trimmed, capped, blank = none", () => {
  assert.equal(normaliseReference("  TT 0101  "), "TT 0101");
  assert.equal(normaliseReference(""), null);
  assert.equal(normaliseReference("   "), null);
  assert.equal(normaliseReference(undefined), null);
  assert.equal(normaliseReference(null), null);
  assert.equal(normaliseReference(12345), "12345");
  assert.equal(normaliseReference("x".repeat(REFERENCE_MAX + 50)).length, REFERENCE_MAX);
});

test("an AP Payment hands its settlement the Reference; an older voucher settles as before", () => {
  assert.equal(settlementReference("CHQ 555", "Made-up fabric invoices"), "CHQ 555");
  // Keyed before the field existed: the TT no. sat in the description.
  assert.equal(settlementReference(null, "TT 777"), "TT 777");
  assert.equal(settlementReference("", "  TT 778 "), "TT 778");
  assert.equal(settlementReference("  ", "  "), null);
  assert.equal(settlementReference(undefined, undefined), null);
});

test("the voucher stores its Reference on every write path", () => {
  assert.match(api, /"tf_due_date TEXT", "tf_interest_sen INTEGER", "reference TEXT"\]\) \{/, "self-applied before the first write");
  assert.match(api, /reference: normaliseReference\(body\.reference\) \};\n\}/, "the form's fields include it");
  const post = slice(api, 'app.post("/payment-vouchers", async (c) => {', 'app.put("/payment-vouchers/:id"');
  // AP Payment: two fields; a client that sends only the description (the
  // form before 2026-10-19) still lands its text where it always did.
  assert.match(post, /const description = String\(body\.description \?\? body\.reference \?\? ""\);\n\s+const \{ reference \} = pvExtraFields\(body as Record<string, unknown>\);/);
  assert.match(post, /pv_kind, party_kind, party_id, advance_sen, tf_due_date, tf_interest_sen, reference\n/);
  assert.match(post, /ap\.v\.tf\?\.dueDate \?\? null, ap\.v\.tf \? ap\.v\.tf\.interestSen : null, reference,\n/);
  assert.match(post, /reference: settlementReference\(reference, description\), advanceSen: ap\.v\.advanceSen,/, "Post now");
  // Payment / Transfer.
  assert.match(post, /pv_kind, notes, bill_no, bill_date, reference\n\s+\) VALUES/);
  const put = slice(api, 'app.put("/payment-vouchers/:id"', "// The four-tier ladder.");
  assert.match(put, /tf_interest_sen = \?, reference = \?, updated_at = \? WHERE id = \?/);
  assert.match(put, /pvExtraFields\(body as Record<string, unknown>\)\.reference, now, id\),/);
  assert.match(put, /bill_date = \?, reference = \?, updated_at = \? WHERE id = \?`,\n\s+\)\.bind\([^\n]*extra\.billDate, extra\.reference, now, id\),/);
  const restate = slice(api, 'app.post("/payment-vouchers/:id/restate"', 'app.get("/doc-trail"');
  assert.match(restate, /bill_date = \?, reference = \?, status = 'POSTED'[^\n]*extra\.billDate, extra\.reference, now, id\)\);/);
  // Approve: the settlement document is born with the voucher's Reference.
  const core = slice(api, "async function pvApprovalCore(", 'app.post("/payment-vouchers/:id/approval"');
  assert.match(core, /reference: settlementReference\(pv\.reference, pv\.description\),/);
  // The change log's before / after carries it.
  assert.match(api, /SELECT date, payee, description, reference, payFrom, totalSen FROM payment_vouchers WHERE id = \?/);
  assert.match(api, /description: h\.description \?\? null,\n\s+reference: h\.reference \?\? null,/);
});

test("a journal keeps a Reference of its own (create, draft edit, read)", () => {
  assert.match(api, /db\.prepare\("ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reference TEXT"\)\.run\(\)/);
  const post = slice(api, 'app.post("/journals", async (c) => {', 'app.get("/journals/:id"');
  assert.match(post, /await ensureJournalReferenceColumn\(c\.var\.DB\);/);
  assert.match(post, /INSERT INTO journal_entries \(id, entryNo, date, description, reference, status, createdBy, orgId\)/);
  assert.match(post, /\.bind\(id, entryNo, date, description, normaliseReference\(body\.reference\), createdBy, orgId\)/);
  const put = slice(api, 'app.put("/journals/:id"', 'app.post("/journals/:id/lifecycle"');
  assert.match(put, /if \(body\.date !== undefined \|\| body\.description !== undefined \|\| body\.reference !== undefined\) \{\n\s+await ensureJournalReferenceColumn\(c\.var\.DB\);/);
  assert.match(put, /"UPDATE journal_entries SET date = \?, description = \?, reference = \? WHERE id = \?"/);
  // An edit that sends no reference keeps the stored one.
  assert.match(put, /body\.reference !== undefined \? normaliseReference\(body\.reference\) : \(entry\.reference \?\? null\)/);
  assert.match(api, /description: e\.description,\n\s+reference: e\.reference \?\? null,/, "every journal read returns it");
});

test("a supplier payment's reference reaches the Payment Vouchers list", () => {
  const sp = read("src/api/routes/supplier-payments.ts");
  assert.match(sp, /sp\.reference    AS reference,/);
  const groups = groupSupplierPaymentRows([
    { id: "a", paymentNo: "SP-0001", supplierId: "s1", supplierName: "Made-up Supplier", purchaseInvoiceId: "pi1", date: "2026-01-02", amountSen: 1000, bookedSen: 1000, reference: "" },
    { id: "b", paymentNo: "SP-0001", supplierId: "s1", supplierName: "Made-up Supplier", purchaseInvoiceId: "pi2", date: "2026-01-02", amountSen: 500, bookedSen: 500, reference: " TT 0202 " },
    { id: "c", paymentNo: "SP-0002", supplierId: "s1", supplierName: "Made-up Supplier", purchaseInvoiceId: "pi3", date: "2026-01-03", amountSen: 700, bookedSen: 700 },
  ]);
  assert.equal(groups.find((g) => g.paymentNo === "SP-0001")?.reference, "TT 0202", "the first line that has one");
  assert.equal(groups.find((g) => g.paymentNo === "SP-0002")?.reference, undefined, "none typed = none shown");
});

test("the voucher forms: a Reference on Payment / Transfer; AP Payment's Reference and Description are two fields", () => {
  const tab = slice(ui, "function PaymentsTab(", "// =============== TAB: OFFICIAL RECEIPT");
  assert.match(tab, /<label className=\{fieldLabel\}>Reference <span className="normal-case font-normal text-\[#9CA3AF\]">\(TT \/ cheque no\.\)<\/span><\/label>\n\s+<input type="text" maxLength=\{120\} placeholder="e\.g\. TT ref, cheque no" value=\{form\.reference\}/);
  assert.match(tab, /description: form\.description,\n\s+reference: form\.reference,\n\s+notes: form\.notes,/, "sent with the voucher (payment and transfer)");
  assert.match(tab, /notes: r\.notes \?\? "", reference: r\.reference \?\? "",/, "an edit opens with it");
  // The internal notes moved to the end: a full row on a payment, beside the description on a transfer.
  assert.match(tab, /<div className=\{isTransfer \? "" : "sm:col-span-2"\}>\n\s+<label className=\{fieldLabel\}>Notes /);
  // AP Payment.
  assert.match(tab, /description: apForm\.description,\n\s+reference: apForm\.reference,/);
  assert.match(tab, /reference: r\.reference \?\? "", description: r\.description \?\? "",/);
  assert.match(tab, /placeholder=\{apTfDraw \? "Bank's drawdown no\." : "e\.g\. TT ref, cheque no"\} value=\{apForm\.reference\}/);
  assert.match(tab, /value=\{apForm\.description\} onChange=\{\(e\) => setApForm\(\{ \.\.\.apForm, description: e\.target\.value \}\)\}/);
  assert.doesNotMatch(tab, /Reference \/ remarks/, "one field, one meaning");
});

test("the list: a Reference column, searchable, each door's own reference", () => {
  assert.match(ui, /descText = r\.description \?\? "";\n\s+refText = r\.reference \?\? "";/);
  assert.match(ui, /refText = row\.sp\.reference \?\? "";/);
  assert.match(ui, /refText = row\.ocp\.reference \?\? "";/, "an other-creditor payment's cheque / transfer no. moves to its column");
  assert.match(ui, /\{ key: "refText", label: "Reference", width: "150px",/);
  assert.match(ui, /alwaysSearchKeys=\{\["no", "payeeText", "descText", "refText", "billNos"\]\}/);
});

test("the popups and the prints show it", () => {
  assert.match(ui, /<DetailField label="Reference">\{r\.reference \|\| "—"\}<\/DetailField>\n\s+<DetailField label="Description \(printed\)" span=\{3\}>\{r\.description \|\| "—"\}<\/DetailField>/);
  assert.match(ui, /\(g\.ft \? g\.ft\.description : g\.sp \? g\.sp\.reference : g\.ocp\?\.reference\) \|\| "—"/);
  assert.match(ui, /facts: \[\{ label: "Reference", value: pv\.reference \?\? "" \}, \.\.\.\(billNo \? \[/);
  assert.match(ui, /facts: \[\{ label: "Reference", value: je\.reference \?\? "" \}\],/);
  // Journals: the form, the list, the popup.
  assert.match(ui, /const \[reference, setReference\] = useState\(editing\?\.reference \?\? ""\);/);
  assert.match(ui, /body: JSON\.stringify\(\{ date, description, reference: reference\.trim\(\), lines: payloadLines \}\),/);
  assert.match(ui, /key: "reference",\n\s+label: "Reference",/);
  assert.match(ui, /<p className="text-\[#9CA3AF\] text-xs">Reference<\/p><p className="font-medium">\{je\.reference \|\| "—"\}<\/p>/);
});

test("a print leaves a blank Reference out and prints a filled one", () => {
  const spec = {
    title: "PAYMENT VOUCHER",
    company: { name: "Made-up Co", addressLines: [], regNo: "", tin: "", phone: "", email: "" },
    docNo: "PV-0001", date: "01/01/2026", partyLabel: "Pay To", partyName: "Made-up Supplier",
    columns: [{ label: "Account" }], lines: [], signatures: [], printedOn: "01/01/2026",
  };
  assert.match(buildVoucherSheet({ ...spec, facts: [{ label: "Reference", value: "TT 0101" }] }), /Reference <b>TT 0101<\/b>/);
  assert.doesNotMatch(buildVoucherSheet({ ...spec, facts: [{ label: "Reference", value: "" }] }), /Reference <b>/);
});
