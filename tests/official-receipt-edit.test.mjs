// ---------------------------------------------------------------------------
// official-receipt-edit.test.mjs — a POSTED official receipt can be edited
// (owner 2026-10-17 「可以」, finance backlog item 14). Same OR number; the
// live legs are reversed and the edited ones re-posted
// (official_receipt_restate_rev/post:<stamp>); the bank side follows the
// re-posted bank leg (the shared rule, tests/bank-leg-carry.test.mjs); void /
// unvoid follow the edited family (class C5). Source pins for the route and
// the screen; the behaviour is tests/official-receipt-edit-flow.test.mjs.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/index.tsx");
const block = (src, from, to) => {
  const a = src.indexOf(from);
  assert.notEqual(a, -1, `${from} not found`);
  const b = src.indexOf(to, a + 1);
  return src.slice(a, b === -1 ? undefined : b);
};

test("API: one validation and one leg builder for posting and editing", () => {
  const create = block(api, 'app.post("/official-receipts", async', 'app.post("/official-receipts/:id/restate"');
  const restate = block(api, 'app.post("/official-receipts/:id/restate"', 'app.post("/official-receipts/:id/lifecycle"');
  for (const r of [create, restate]) {
    assert.match(r, /await validateOfficialReceipt\(/);
    assert.match(r, /officialReceiptLegs\(v, \{ id, orNo, sourceType: /);
  }
  assert.match(create, /sourceType: "official_receipt", bankLegId:/);
  assert.match(restate, /sourceType: postSource, bankLegId \}/);
  assert.equal((api.match(/Deposit To must be a bank \(SBK\) or cash \(SCH\) account/g) ?? []).length, 1, "the rule lives once");
});

test("API: edit = same number, live legs reversed, edited legs posted, older families hidden", () => {
  const r = block(api, 'app.post("/official-receipts/:id/restate"', 'app.post("/official-receipts/:id/lifecycle"');
  assert.match(r, /requirePermission\(c, "accounting", "update"\)/);
  assert.match(r, /if \(state !== "ACTIVE" \|\| String\(or\.status \?\? ""\) === "VOID"\) \{\n\s*return c\.json\(\{ success: false, error: "This receipt is cancelled — restore it before editing\." \}, 400\);/);
  assert.match(r, /WHERE sourceId = \? AND orgId = \? AND hidden = 0 AND sourceType LIKE 'official_receipt%'/);
  assert.match(r, /sourceType: `official_receipt_restate_rev:\$\{stamp\}`/);
  assert.match(r, /debitSen: Number\(l\.creditSen\) \|\| 0, creditSen: Number\(l\.debitSen\) \|\| 0/, "a reversal swaps the sides");
  assert.match(r, /const postSource = `official_receipt_restate_post:\$\{stamp\}`;/);
  assert.match(r, /SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE 'official_receipt%' AND sourceType <> \?`,\n\s*\)\.bind\(id, orgId, postSource\)/);
  assert.match(r, /UPDATE official_receipts SET date = \?, receivedFrom = \?, description = \?, payTo = \?, totalSen = \?, updated_at = \? WHERE id = \?/);
  assert.doesNotMatch(r, /issueDocNumber/, "the OR number never changes");
  assert.match(r, /DELETE FROM official_receipt_lines WHERE receiptId = \?/);
  assert.match(r, /await emitAudit\(c, \{\n\s*resource: "accounting",\n\s*resourceId: orNo,\n\s*action: "update",/);
});

test("API: the bank side follows the re-posted bank leg through the shared rule; a refused edit is a 409", () => {
  const r = block(api, 'app.post("/official-receipts/:id/restate"', 'app.post("/official-receipts/:id/lifecycle"');
  assert.match(r, /const carry = await planEditBankCarry\(db, cur, newLegs, "receipt"\);\n\s*if \(!carry\.ok\) return c\.json\(\{ success: false, error: carry\.error \}, 409\);/);
  assert.match(r, /statements\.push\(\.\.\.carry\.statements\);/);
  assert.match(r, /bankMatchMoved: carry\.moved > 0/);
  // The bank leg is leg 1 with the id the match moves onto.
  const legs = block(api, "function officialReceiptLegs(", 'app.post("/official-receipts", async');
  assert.match(legs, /id: doc\.bankLegId,\n\s*sourceType: doc\.sourceType,\n\s*sourceId: doc\.id,\n\s*legNo: 1,\n\s*accountCode: v\.payTo,\n\s*debitSen: v\.totalSen,/);
});

test("API: void hides the whole family; unvoid restores the newest edit, not the pre-edit legs (C5)", () => {
  const lc = block(api, 'app.post("/official-receipts/:id/lifecycle"', "// FUND TRANSFER");
  assert.match(lc, /if \(lc\.newState !== "ACTIVE"\) \{\n\s*statements\.push\(\n\s*c\.var\.DB\.prepare\(`UPDATE ledger_journal_entries SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE 'official_receipt%'`\)\.bind\(id, orgId\),/);
  assert.match(lc, /statements\.push\(\.\.\.\(await restoreEditedFamilyStatements\(c\.var\.DB, orgId, "official_receipt", id\)\)\);/);
});

test("API: the receipts list reads today's account codes (C32)", () => {
  const g = block(api, 'app.get("/official-receipts"', 'type OfficialReceiptInput');
  assert.match(g, /const resolve = await loadAccountResolver\(c\.var\.DB\);/);
  assert.match(g, /payTo: row\.payTo \? resolve\(row\.payTo\) : row\.payTo,/);
  assert.match(g, /\.map\(\(l\) => \(\{ \.\.\.l, accountCode: resolve\(l\.accountCode\) \}\)\)/);
});

test("UI: the Official Receipt form edits too, through the restate endpoint", () => {
  const form = block(ui, "function OfficialReceiptForm(", "// =============== TAB: RECEIPTS HUB");
  assert.match(form, /function OfficialReceiptForm\(\{ accounts, editing, onSaved, onCancel, copyFrom = null \}: \{ accounts: ChartOfAccount\[\]; editing\?: OrRow \| null;/);
  assert.match(form, /amount: \(l\.amountSen \/ 100\)\.toFixed\(2\)/, "lines prefilled from the receipt");
  assert.match(form, /fetch\(editing \? `\/api\/accounting\/official-receipts\/\$\{encodeURIComponent\(editing\.id\)\}\/restate` : "\/api\/accounting\/official-receipts"/);
  assert.match(form, /Edit Official Receipt \{editing\.orNo\}/);
  assert.match(form, /editing \? "Save changes" : "Post receipt"/);
  // The money rules stay the same for an edit (one parser, unreadable → refuse).
  assert.match(form, /if \(orMoneyError\) \{ toast\.error\(orMoneyError\); return; \}/);
});

test("UI: every active receipt offers Edit — official receipts included", () => {
  const hub = block(ui, "function ReceiptsHubTab(", "// =============== TAB: FUND TRANSFER");
  assert.match(hub, /else if \(r\.or\) \{ setCustEditing\(null\); setOdEditing\(null\); setOrEditing\(r\.or\); setDoor\("OFFICIAL"\); \}/);
  assert.match(hub, /\.\.\.\(r\.lifecycleState === "ACTIVE" \? \[\{ label: "Edit", action: \(\) => startEdit\(r\) \}\] : \[\]\),/);
  assert.match(hub, /\{r\.lifecycleState === "ACTIVE" && <Button variant="outline" size="sm" onClick=\{\(\) => \{ close\(\); startEdit\(r\); \}\}>Edit<\/Button>\}/);
  assert.match(hub, /<OfficialReceiptForm key=\{orEditing\?\.id \?\? \(orCopy \? `copy:\$\{orCopy\.id\}` : "new"\)\} accounts=\{accounts\} editing=\{orEditing\}/);
});
