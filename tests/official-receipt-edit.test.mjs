// ---------------------------------------------------------------------------
// official-receipt-edit.test.mjs — a POSTED official receipt can be edited
// (owner 2026-10-17 「可以」, finance backlog item 14). Same OR number; the
// live legs are reversed and the edited ones re-posted
// (official_receipt_restate_rev/post:<stamp>); a bank match moves onto the
// re-posted bank leg when the bank account and amount are unchanged, and a
// matched receipt cannot change them. Void / unvoid follow the edited family
// (class C5 — never resurrect the pre-edit legs).
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const edit = await import(pathToFileURL(resolve(process.cwd(), "src/lib/official-receipt-edit.ts")).href);
const machine = await import(pathToFileURL(resolve(process.cwd(), "src/lib/lifecycle-machine.ts")).href);

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/index.tsx");
const block = (src, from, to) => {
  const a = src.indexOf(from);
  assert.notEqual(a, -1, `${from} not found`);
  const b = src.indexOf(to, a + 1);
  return src.slice(a, b === -1 ? undefined : b);
};

// Made-up figures.
const bankLeg = { id: "lje-bank", accountCode: "310-0001", debitSen: 50000, creditSen: 0 };
const incomeLeg = { id: "lje-inc", accountCode: "520-0001", debitSen: 0, creditSen: 50000 };
const none = { matched: new Set(), ticked: new Set() };

test("orBankCarry: nothing on the bank side → edit freely, nothing to move", () => {
  assert.deepEqual(edit.orBankCarry([bankLeg, incomeLeg], none, { payTo: "310-0002", totalSen: 1 }), { ok: true, carryFrom: null });
});

test("orBankCarry: matched, bank account and amount unchanged → the match moves to the new bank leg", () => {
  const refs = { matched: new Set(["lje-bank"]), ticked: new Set() };
  assert.deepEqual(edit.orBankCarry([bankLeg, incomeLeg], refs, { payTo: "310-0001", totalSen: 50000 }), { ok: true, carryFrom: "lje-bank" });
});

test("orBankCarry: matched and the amount or the bank account changes → refused with the Cash Book message", () => {
  const refs = { matched: new Set(["lje-bank"]), ticked: new Set() };
  for (const next of [{ payTo: "310-0001", totalSen: 40000 }, { payTo: "310-0002", totalSen: 50000 }]) {
    const r = edit.orBankCarry([bankLeg, incomeLeg], refs, next);
    assert.equal(r.ok, false);
    assert.equal(r.error, edit.OR_MATCHED_EDIT_ERR);
  }
  assert.match(edit.OR_MATCHED_EDIT_ERR, /Unmatch it in Cash Book first/);
});

test("orBankCarry: only a daily tick → moves when unchanged, never blocks when changed", () => {
  const refs = { matched: new Set(), ticked: new Set(["lje-bank"]) };
  assert.deepEqual(edit.orBankCarry([bankLeg, incomeLeg], refs, { payTo: "310-0001", totalSen: 50000 }), { ok: true, carryFrom: "lje-bank" });
  assert.deepEqual(edit.orBankCarry([bankLeg, incomeLeg], refs, { payTo: "310-0001", totalSen: 1 }), { ok: true, carryFrom: null });
});

test("orBankCarry: two held legs can't both move onto one → refused when either is a statement match", () => {
  const second = { ...bankLeg, id: "lje-bank-2" };
  const refs = { matched: new Set(["lje-bank", "lje-bank-2"]), ticked: new Set() };
  assert.equal(edit.orBankCarry([bankLeg, second, incomeLeg], refs, { payTo: "310-0001", totalSen: 50000 }).ok, false);
});

test("liveRestatePostType: the newest edit wins; never edited → null; rev families never live", () => {
  assert.equal(
    machine.liveRestatePostType([
      "official_receipt", "official_receipt_void",
      "official_receipt_restate_rev:1700000000001", "official_receipt_restate_post:1700000000001",
      "official_receipt_restate_post:1700000000999",
    ], "official_receipt"),
    "official_receipt_restate_post:1700000000999",
  );
  assert.equal(machine.liveRestatePostType(["official_receipt", "official_receipt_void"], "official_receipt"), null);
  assert.equal(machine.liveRestatePostType(["official_receipt_restate_rev:5"], "official_receipt"), null);
  // Another document's families are not this one's.
  assert.equal(machine.liveRestatePostType(["payment_voucher_restate_post:9"], "official_receipt"), null);
});

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

test("API: the bank match, split and daily tick follow the re-posted bank leg; a blocked edit is a 409", () => {
  const r = block(api, 'app.post("/official-receipts/:id/restate"', 'app.post("/official-receipts/:id/lifecycle"');
  assert.match(r, /SELECT matchedLegId FROM bank_statement_lines WHERE matchedLegId IN/);
  assert.match(r, /SELECT leg_id FROM bank_line_leg_splits WHERE leg_id IN/);
  assert.match(r, /SELECT leg_id FROM bank_board_cleared WHERE leg_id IN/);
  assert.match(r, /const carry = orBankCarry\(cur, \{ matched, ticked \}, \{ payTo: v\.payTo, totalSen: v\.totalSen \}\);\n\s*if \(!carry\.ok\) return c\.json\(\{ success: false, error: carry\.error \}, 409\);/);
  assert.match(r, /UPDATE bank_statement_lines SET matchedLegId = \? WHERE matchedLegId = \?"\)\.bind\(bankLegId, carry\.carryFrom\)/);
  assert.match(r, /UPDATE bank_line_leg_splits SET leg_id = \? WHERE leg_id = \?"\)\.bind\(bankLegId, carry\.carryFrom\)/);
  assert.match(r, /UPDATE bank_board_cleared SET leg_id = \? WHERE leg_id = \?"\)\.bind\(bankLegId, carry\.carryFrom\)/);
  // The bank leg is leg 1 with the id the match moves onto.
  const legs = block(api, "function officialReceiptLegs(", 'app.post("/official-receipts", async');
  assert.match(legs, /id: doc\.bankLegId,\n\s*sourceType: doc\.sourceType,\n\s*sourceId: doc\.id,\n\s*legNo: 1,\n\s*accountCode: v\.payTo,\n\s*debitSen: v\.totalSen,/);
});

test("API: void hides the whole family; unvoid restores the newest edit, not the pre-edit legs (C5)", () => {
  const lc = block(api, 'app.post("/official-receipts/:id/lifecycle"', "// FUND TRANSFER");
  assert.match(lc, /if \(lc\.newState !== "ACTIVE"\) \{\n\s*statements\.push\(\n\s*c\.var\.DB\.prepare\(`UPDATE ledger_journal_entries SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE 'official_receipt%'`\)\.bind\(id, orgId\),/);
  assert.match(lc, /const live = liveRestatePostType\(fams\.map\(\(f\) => String\(f\.sourceType\)\), "official_receipt"\);/);
  assert.match(lc, /UPDATE ledger_journal_entries SET hidden = 0 WHERE sourceId = \? AND orgId = \? AND sourceType = \?"\)\.bind\(id, orgId, live\)/);
});

test("UI: the Official Receipt form edits too, through the restate endpoint", () => {
  const form = block(ui, "function OfficialReceiptForm(", "// =============== TAB: RECEIPTS HUB");
  assert.match(form, /function OfficialReceiptForm\(\{ accounts, editing, onSaved, onCancel \}: \{ accounts: ChartOfAccount\[\]; editing\?: OrRow \| null;/);
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
  assert.match(hub, /<OfficialReceiptForm key=\{orEditing\?\.id \?\? "new"\} accounts=\{accounts\} editing=\{orEditing\}/);
});
