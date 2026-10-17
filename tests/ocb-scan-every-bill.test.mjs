// ---------------------------------------------------------------------------
// Scan Bill on Other Creditor / Debtor Bills reads every bill in a file
// (owner 2026-10-17 「scan bill 要改」). One PDF often bundles several bills;
// the form used to take the first and warn that the rest were ignored. Now
// the form is filled with bill 1 of N, Save & Post fills it with the next,
// Skip / Stop are offered, and the last save closes the form. Every bill
// keeps the scanned file as its attachment.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const start = ui.indexOf("function OtherPartyBillsManager(");
const mgr = ui.slice(start, ui.indexOf("\nfunction ", start + 10));

test("the bill scan uses every bill in the file (no 'only the first was used' warning)", () => {
  assert.match(mgr, /<ScanPrefillButton label="Scan Bill" allDocs onResult=\{applyScan\} \/>/);
  assert.match(mgr, /const docs = d\.docs && d\.docs\.length > 1 \? d\.docs : null;\n\s*setScanQueue\(docs \? \{ docs, file, index: 0 \} : null\);\n\s*await prefillFromDoc\(docs \? docs\[0\] : d, file\);/);
});

test("Save & Post on bill k of N saves it and fills the form with bill k+1; the last one closes", () => {
  assert.match(mgr, /const hasNext = !editingBillNo && !!q && q\.index \+ 1 < q\.docs\.length;\n\s*const saved = await submit\(hasNext\);\n\s*if \(!saved\) return;\n\s*if \(hasNext && q\) await startQueuedBill\(q, q\.index \+ 1\);\n\s*else setScanQueue\(null\);/);
  // submit keeps the form up only while bills remain, and reports success.
  assert.match(mgr, /const submit = async \(keepOpen = false\): Promise<boolean> => \{/);
  // (Since 2026-10-17 the Add New Asset hand-off — never mid-scan — sits
  // between closing the form and reporting success; tests/fixed-asset-from-voucher.test.mjs.)
  assert.match(mgr, /if \(!keepOpen\) \{\n\s*setShowForm\(false\);\n\s*formOnly\?\.onDone\(\);\n\s*\}\n(\s*const faFresh = [^\n]*\n\s*if \(putFaQueue\(sessionStore\(\), faFresh\)\) \{\n[^\n]*\n[^\n]*\n\s*\}\n)?\s*return true;/);
  // The next bill starts on a clean form, with the same file attached.
  assert.match(mgr, /setScanQueue\(\{ \.\.\.q, index \}\);\n\s*setForm\(\{ partyId: "", billDate: today,[^\n]*\);\n\s*await prefillFromDoc\(q\.docs\[index\], q\.file\);/);
  assert.match(mgr, /setPendingBillFiles\(\[file\]\); \/\/ the scanned bill is the new bill's evidence/);
});

test("the form says which bill it is, and offers Skip / Stop", () => {
  assert.match(mgr, /Bill \{scanQueue\.index \+ 1\} of \{scanQueue\.docs\.length\} in \{scanQueue\.file\.name\}/);
  assert.match(mgr, />\n\s*Skip this one\n/);
  assert.match(mgr, />\n\s*Stop after this one\n/);
  // Cancel and Esc drop the rest of the file.
  assert.match(mgr, /setShowForm\(false\); setEditingBillNo\(null\); setScanQueue\(null\); formOnly\?\.onDone\(\);/);
  assert.match(mgr, /setEditingBillNo\(null\);\n\s*setScanQueue\(null\);\n\s*formOnly\?\.onDone\(\);\n\s*\};\n\s*useEscapeClose/);
});
