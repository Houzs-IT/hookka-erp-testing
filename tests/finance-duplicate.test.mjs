// ---------------------------------------------------------------------------
// Duplicate on Payment Vouchers, AP Payments and Receipts (owner 2026-10-20
// 「duplicate 可以做」 — the design's row menus; Journals already had it).
// A duplicate opens the NEW form seeded from the document, dated today:
// nothing is recorded until it is saved. Never copied: the reference, the
// bill no. / date, the notes, the attachments — and an AP payment's or a
// receipt's knock-offs (the design's rule: the bills are ticked again).
// Also BUG-2026-10-20-346: the other-party settle form stayed on "Loading
// bills…" after a post (the party stays picked; nothing reloaded its bills).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const page = read("src/pages/invoices/payments.tsx");
const block = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, `missing ${end} after ${start}`);
  return src.slice(i, j);
};
const pvTab = block(ui, "function PaymentsTab(", "// =============== TAB: ");
const hub = block(ui, "function ReceiptsHubTab(", "// =============== TAB: FUND TRANSFER");

test("Payment Vouchers: Duplicate on the row menu and the popup, for every voucher", () => {
  const menu = block(pvTab, "const pvRowMenu = (r: PvRow): RowMenuGroups => {", "const payRowMenu");
  assert.match(menu, /\{ label: "Duplicate", action: \(\) => startDuplicate\(r\) \},/);
  // Not gated by the ladder state or by Void: a cancelled voucher is a fine template.
  assert.doesNotMatch(menu, /live && \{ label: "Duplicate"/);
  assert.match(pvTab, /<Button variant="outline" size="sm" onClick=\{\(\) => \{ close\(\); startDuplicate\(r\); \}\}>Duplicate<\/Button>/);
  // The other doors' rows: a creditor payment becomes a NEW AP payment, a Fund Transfer a NEW transfer.
  const pay = block(pvTab, "const payRowMenu = (g: PayRow): RowMenuGroups => [", "];\n");
  assert.match(pay, /\{ label: g\.ft \? "Duplicate as a transfer" : "Duplicate as an AP payment", action: \(\) => startDuplicatePay\(g\) \},/);
  assert.match(pvTab, /onClick=\{\(\) => \{ close\(\); startDuplicatePay\(g\); \}\}>\{g\.ft \? "Duplicate as a transfer" : "Duplicate as an AP payment"\}<\/Button>/);
});

test("a copy is a NEW voucher: no editing id, dated today, the copy's source in the title", () => {
  const copy = block(pvTab, "const openCopy = (", "const selCls =");
  assert.match(copy, /resetForm\(\);/, "starts from a clean form (no knock-offs, no scans, no edit id)");
  assert.doesNotMatch(copy, /setEditingId\(/, "never re-states the original");
  assert.doesNotMatch(copy, /setApAlloc\(/, "the bills are ticked again");
  assert.doesNotMatch(copy, /setPendingScanFiles\(/, "attachments stay with the original");
  assert.match(copy, /setCopyOf\(no\.startsWith\("DRAFT-"\) \? "a draft" : no\);/);
  assert.match(pvTab, /const resetForm = \(\) => \{\n\s+setShowForm\(false\);\n\s+setEditingId\(null\);\n\s+setCopyOf\(null\);/);
  assert.match(pvTab, /copyOf \? `New AP payment · copy of \$\{copyOf\}` : "New AP payment"/);
  assert.match(pvTab, /`\$\{isTransfer \? "New transfer" : "New payment voucher"\}\$\{copyOf \? ` · copy of \$\{copyOf\}` : ""\}`/);
  // Esc closes an untouched copy at once, like an edit.
  assert.match(pvTab, /if \(editingId \|\| copyOf\) return JSON\.stringify\(formKind === "AP" \? \[apForm, apAlloc\] : \[form, lines\]\) !== editBaseline\.current;/);
  assert.match(copy, /editBaseline\.current = JSON\.stringify\(\[seed\.ap, \{\}\]\);/);
  assert.match(copy, /editBaseline\.current = JSON\.stringify\(\[f, ls\]\);/);
});

test("what a copy carries: an AP payment = creditor, paid from, description; never the knock-offs", () => {
  const copy = block(pvTab, "const openCopy = (", "const selCls =");
  assert.match(copy, /date: new Date\(\)\.toISOString\(\)\.slice\(0, 10\), payFrom, partyKind: party\.kind, partyId: party\.id,\n\s+reference: "", description, advance: "", tfDue: "", tfInterest: "",/);
  assert.match(copy, /openCopy\(r\.pvNo, "AP", \{ ap: copyApForm\(\{ kind: r\.partyKind === "OTHER" \? "OTHER" : "SUPPLIER", id: r\.partyId \?\? "" \}, r\.payFrom \?\? "", r\.description \?\? ""\) \}\);/);
  // Supplier / other-creditor payments recorded on their own pages.
  assert.match(copy, /if \(g\.sp\) \{ openCopy\(g\.no, "AP", \{ ap: copyApForm\(\{ kind: "SUPPLIER", id: g\.sp\.supplierId \}, g\.sp\.bankAccount \?\? "", ""\) \}\); return; \}/);
  assert.match(copy, /if \(g\.ocp\) \{ openCopy\(g\.no, "AP", \{ ap: copyApForm\(\{ kind: "OTHER", id: g\.ocp\.partyId \}, g\.ocp\.bankAccount \?\? "", ""\) \}\); return; \}/);
  assert.doesNotMatch(copy, /allocs|advanceSen|tfDueDate|tfInterestSen/, "no knock-off, advance or drawdown terms are copied");
});

test("what a copy carries: a voucher = payee, lines, paid from, accrual; a transfer = accounts and amount", () => {
  const dup = block(pvTab, "const startDuplicate = (r: PvRow) => {", "// A row from another door");
  assert.match(dup, /payee: r\.payee \?\? "", description: r\.description \?\? "", accrued: r\.accrued === 1,/);
  assert.match(dup, /payFrom: r\.payFrom \?\? "", accrualAccount: r\.accrualAccount \?\? "", productLine: r\.productLine \?\? "",/);
  assert.match(dup, /transferTo: isTransfer \? \(r\.lines\[0\]\?\.accountCode \?\? ""\) : "",/);
  assert.match(dup, /lines: isTransfer \? \[\] : r\.lines\.map\(\(l\) => \(\{ accountCode: l\.accountCode, description: l\.description \?\? "", amount: \(l\.amountSen \/ 100\)\.toFixed\(2\) \}\)\),/);
  // Its own facts stay with the original (the date comes from blankPvForm = today).
  assert.doesNotMatch(dup, /r\.reference|r\.billNo|r\.bill_no|r\.billDate|r\.notes|r\.date\b/);
  const ft = block(pvTab, "if (g.ft) {", "const selCls =");
  assert.match(ft, /mode: "TRANSFER", payFrom: g\.ft\.fromAccount, transferTo: g\.ft\.toAccount,/);
  assert.match(ft, /transferAmount: \(g\.ft\.amountSen \/ 100\)\.toFixed\(2\), description: g\.ft\.description \?\? "",/);
});

test("Receipts: Duplicate on the row menu and the popup opens the same door as a NEW receipt", () => {
  assert.match(hub, /\{ label: "Duplicate", action: \(\) => startDuplicate\(r\) \},/);
  assert.match(hub, /<Button variant="outline" size="sm" onClick=\{\(\) => \{ close\(\); startDuplicate\(r\); \}\}>Duplicate<\/Button>/);
  const dup = block(hub, "const startDuplicate = (r: ReceiptHubRow) => {", "const kindChip");
  assert.match(dup, /clearForms\(\);/, "never an edit and a copy at once");
  assert.match(dup, /if \(r\.cust\) \{ setCustCopy\(r\.cust\); setDoor\("CUSTOMER"\); \}/);
  assert.match(dup, /else if \(r\.od\) \{ setOdCopy\(r\.od\); setDoor\("OTHER"\); \}/);
  assert.match(dup, /else if \(r\.or\) \{ setOrCopy\(r\.or\); setDoor\("OFFICIAL"\); \}/);
  assert.match(hub, /const closeDoor = \(\) => \{ setDoor\(null\); clearForms\(\); \};/);
  // A new key per copy, so the form seeds from it (state seeds once).
  assert.match(hub, /key=\{custEditing\?\.id \?\? \(custCopy \? `copy:\$\{custCopy\.id\}` : "new"\)\}/);
  assert.match(hub, /key=\{odEditing\?\.paymentNo \?\? \(odCopy \? `copy:\$\{odCopy\.paymentNo\}` : "new"\)\}/);
  assert.match(hub, /key=\{orEditing\?\.id \?\? \(orCopy \? `copy:\$\{orCopy\.id\}` : "new"\)\}/);
});

test("a customer receipt copy: customer, method, amount — never the knock-offs, reference or date", () => {
  const form = block(page, "export function CustomerReceiptForm(", "// Save: create a new receipt");
  assert.match(form, /useState\(editing\?\.customerId \?\? copyFrom\?\.customerId \?\? ""\)/);
  assert.match(form, /useState<PaymentRecord\["method"\]>\(editing\?\.method \?\? copyFrom\?\.method \?\? "BANK_TRANSFER"\)/);
  assert.match(form, /const amountSeed = editing \?\? copyFrom;/);
  assert.match(form, /useState\(editing\?\.reference \?\? ""\)/, "the reference is the original's own");
  assert.match(form, /\(editing\?\.date \|\| ""\)\.slice\(0, 10\) \|\| new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, "a copy is dated today");
  assert.match(form, /\(\) => \(editing\?\.allocations \?\? \[\]\)\.map\(/, "allocations seed from an edit only");
  assert.doesNotMatch(form, /copyFrom\?\.allocations|copyFrom\?\.reference|copyFrom\?\.date/);
  assert.match(form, /afterWrite\(\);\n\s+if \(copyFrom\) onCancelEdit\(\);/, "the saved copy closes");
  // It saves as a NEW receipt (only an edit re-states).
  assert.match(page, /if \(!editingId\) \{ handleCreate\(\); return; \}/);
});

test("an other-debtor receipt copy: party and bank — never the bills it settled", () => {
  const form = block(ui, "function OtherPartyPaymentForm(", "\n  return (");
  assert.match(form, /useState\(editing\?\.partyId \?\? copyFrom\?\.partyId \?\? ""\)/);
  assert.match(form, /useState\(editing\?\.bankAccount \?\? copyFrom\?\.bankAccount \?\? ""\)/);
  assert.match(form, /for \(const l of editing\?\.lines \?\? \[\]\)/, "rows seed from an edit only");
  assert.doesNotMatch(form, /copyFrom\?\.lines|copyFrom\?\.reference|copyFrom\?\.date/);
  assert.match(form, /const url = editingNo\n\s+\? `\/api\/accounting\/other-party-payments\/\$\{encodeURIComponent\(editingNo\)\}\/restate`\n\s+: "\/api\/accounting\/other-party-payments";/, "a copy posts as a NEW payment");
  assert.match(form, /if \(editingNo \|\| copyFrom\) onCancelEdit\(\);/);
});

test("BUG-2026-10-20-346: after a post the picked party's bills reload", () => {
  const form = block(ui, "function OtherPartyPaymentForm(", "\n  return (");
  assert.match(form, /const \[billsVer, setBillsVer\] = useState\(0\);/);
  assert.match(form, /\}, \[partyId, side, editing, billsVer\]\);/);
  assert.match(form, /setOpenBills\(\{ forParty: "", bills: \[\] \}\);\n\s+setBillsVer\(\(v\) => v \+ 1\);/);
});

test("an official receipt copy: from, description, bank, lines — dated today, posted as new", () => {
  const form = block(ui, "function OfficialReceiptForm(", "// =============== TAB: RECEIPTS HUB");
  assert.match(form, /const seed = editing \?\? copyFrom;/);
  assert.match(form, /date: editing \? String\(editing\.date \?\? ""\)\.slice\(0, 10\) : new Date\(\)\.toISOString\(\)\.slice\(0, 10\),/);
  assert.match(form, /seed && seed\.lines\.length > 0\n\s+\? seed\.lines\.map\(/);
  assert.match(form, /fetch\(editing \? `\/api\/accounting\/official-receipts\/\$\{encodeURIComponent\(editing\.id\)\}\/restate` : "\/api\/accounting\/official-receipts"/);
  assert.match(form, /copyFrom \? `copy of \$\{copyFrom\.orNo\} — check the date and the amounts`/);
});
