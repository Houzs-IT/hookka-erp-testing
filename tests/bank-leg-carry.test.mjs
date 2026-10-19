// ---------------------------------------------------------------------------
// bank-leg-carry.test.mjs — the class tests for C31 (an edit re-posts a bank
// leg under a new id; the bank side must follow it) and the C5 unvoid rows
// fixed with it (an unvoid after an edit brings back the EDITED legs).
//
// The pure rules (planBankCarry, liveFamiliesAfterEdit), then a pin on EVERY
// edit that re-posts a bank / cash leg — official receipt, payment voucher,
// customer receipt, other-party payment, supplier payment — and every unvoid
// of an editable document. A new edit path that re-posts a bank leg without
// planEditBankCarry fails the inventory test at the bottom.
// Behaviour: tests/official-receipt-edit-flow.test.mjs,
// tests/edit-keeps-bank-match-flow.test.mjs. Made-up figures.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const carry = await import(pathToFileURL(resolve(process.cwd(), "src/lib/bank-leg-carry.ts")).href);
const machine = await import(pathToFileURL(resolve(process.cwd(), "src/lib/lifecycle-machine.ts")).href);

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const block = (src, from, to) => {
  const a = src.indexOf(from);
  assert.notEqual(a, -1, `${from} not found`);
  const b = src.indexOf(to, a + 1);
  return src.slice(a, b === -1 ? undefined : b);
};

const bank = { id: "old-bank", accountCode: "310-0001", debitSen: 0, creditSen: 30000 };
const exp = { id: "old-exp", accountCode: "900-0001", debitSen: 30000, creditSen: 0 };
const refs = (o = {}) => ({ matched: new Set(o.matched ?? []), split: new Set(o.split ?? []), ticked: new Set(o.ticked ?? []) });
const posted = (amount = 30000, account = "310-0001") => [
  { id: "new-exp", accountCode: "900-0002", debitSen: amount, creditSen: 0 },
  { id: "new-bank", accountCode: account, debitSen: 0, creditSen: amount },
];

test("planBankCarry: nothing held → nothing to move, whatever changed", () => {
  assert.deepEqual(carry.planBankCarry([bank, exp], refs(), posted(1, "310-0002"), "voucher"), { ok: true, moves: [] });
});

test("planBankCarry: a match, a split and a tick move to the re-posted leg with the same account and amounts", () => {
  for (const r of [refs({ matched: ["old-bank"] }), refs({ split: ["old-bank"] }), refs({ ticked: ["old-bank"] })]) {
    assert.deepEqual(carry.planBankCarry([bank, exp], r, posted(), "voucher"), { ok: true, moves: [{ from: "old-bank", to: "new-bank" }] });
  }
});

test("planBankCarry: a match or split with a new amount or bank account refuses, naming Cash Book", () => {
  for (const r of [refs({ matched: ["old-bank"] }), refs({ split: ["old-bank"] })]) {
    for (const p of [posted(25000), posted(30000, "310-0002")]) {
      const out = carry.planBankCarry([bank, exp], r, p, "voucher");
      assert.deepEqual(out, { ok: false, error: carry.bankMatchedEditError("voucher") });
    }
  }
  assert.equal(
    carry.bankMatchedEditError("receipt"),
    "This receipt is matched to a bank statement line in Cash Book, so its bank account and amount must stay the same. Unmatch it in Cash Book first to change them.",
  );
});

test("planBankCarry: a tick alone never blocks — it stays on the old leg", () => {
  assert.deepEqual(carry.planBankCarry([bank, exp], refs({ ticked: ["old-bank"] }), posted(25000), "voucher"), { ok: true, moves: [] });
});

test("planBankCarry: a renamed bank code still counts as the same account", () => {
  const old = { ...bank, accountCode: "310-0009" };
  const resolveCode = (c) => (c === "310-0009" ? "310-0001" : c);
  assert.deepEqual(carry.planBankCarry([old, exp], refs({ matched: ["old-bank"] }), posted(), "voucher", resolveCode), { ok: true, moves: [{ from: "old-bank", to: "new-bank" }] });
  assert.equal(carry.planBankCarry([old, exp], refs({ matched: ["old-bank"] }), posted(), "voucher").ok, false, "without the resolver it would refuse");
});

test("planBankCarry: two held legs never share one new leg", () => {
  const twin = { ...bank, id: "old-bank-2" };
  const out = carry.planBankCarry([bank, twin, exp], refs({ matched: ["old-bank", "old-bank-2"] }), posted(), "voucher");
  assert.equal(out.ok, false);
});

test("liveFamiliesAfterEdit: the newest edit plus whatever was posted after it; never edited → null", () => {
  const f = (sourceType, firstAt) => ({ sourceType, firstAt });
  assert.equal(machine.liveFamiliesAfterEdit([f("payment", "1"), f("payment_void", "2")], "payment"), null);
  assert.deepEqual(
    machine.liveFamiliesAfterEdit([
      f("payment", "001"), f("payment_restate_rev:10", "002"), f("payment_restate_post:10", "002"),
      f("payment_restate_rev:20", "003"), f("payment_restate_post:20", "003"),
      f("payment_bounce", "004"), f("payment_void", "005"),
    ], "payment"),
    ["payment_restate_post:20", "payment_bounce"],
  );
  // A family posted BEFORE the newest edit was reversed by it — stays hidden.
  assert.deepEqual(
    machine.liveFamiliesAfterEdit([f("payment_voucher", "001"), f("payment_voucher_settle", "002"), f("payment_voucher_restate_post:9", "003"), f("payment_voucher_restate_rev:9", "003")], "payment_voucher"),
    ["payment_voucher_restate_post:9"],
  );
});

const acc = read("src/api/routes/accounting.ts");
const pay = read("src/api/routes/payments.ts");
const sp = read("src/api/routes/supplier-payments.ts");

test("every edit that re-posts a bank leg runs the shared rule (C31 rows 1–5)", () => {
  const edits = [
    [block(acc, 'app.post("/official-receipts/:id/restate"', 'app.post("/official-receipts/:id/lifecycle"'), /planEditBankCarry\(db, cur, newLegs, "receipt"\)/],
    [block(acc, 'app.post("/payment-vouchers/:id/restate"', "// One document's ledger lines"), /planEditBankCarry\(c\.var\.DB, cur, newLegs, "voucher"\)/],
    [block(acc, "async function buildOtherPartyPaymentRestate(", 'app.post("/other-party-payments/:paymentNo/void"'), /planEditBankCarry\(db, cur, postLegs, "payment"\)/],
    [block(pay, "async function buildCustomerPaymentRestate(", "function parseAllocations("), /planEditBankCarry\(db, cur, postLegs, "receipt"\)/],
    [block(sp, "async function buildSupplierPaymentRestate(", "function bumpSupplierPaymentsRev("), /planEditBankCarry\(db, cur, newLegs, "payment"\)/],
  ];
  for (const [body, call] of edits) {
    assert.match(body, call);
    assert.match(body, /SELECT id, accountCode, debitSen, creditSen FROM ledger_journal_entries/, "the live legs carry their ids");
    assert.match(body, /\.\.\.carry\.statements/);
  }
  // A refused edit inside a builder is a 409 from its route.
  assert.match(acc, /if \(e instanceof BankMatchedEditRefused\) return c\.json\(\{ success: false, error: e\.message \}, 409\);/);
  assert.match(pay, /if \(err instanceof BankMatchedEditRefused\) return c\.json\(\{ success: false, error: msg \}, 409\);/);
  assert.match(sp, /if \(err instanceof BankMatchedEditRefused\) return c\.json\(\{ success: false, error: msg \}, 409\);/);
});

test("every unvoid of an editable document restores the edited family (C5 rows 7–10)", () => {
  assert.match(block(acc, 'app.post("/official-receipts/:id/lifecycle"', "// FUND TRANSFER"), /restoreEditedFamilyStatements\(c\.var\.DB, orgId, "official_receipt", id\)/);
  assert.match(block(acc, 'app.post("/payment-vouchers/:id/lifecycle"', "// Edit a payment voucher IN PLACE"), /restoreEditedFamilyStatements\(c\.var\.DB, orgId, "payment_voucher", id\)/);
  assert.match(block(acc, "async function buildOtherPartyPaymentLifecycle(", "// buildOtherPartyPaymentRestate"), /if \(reactivated\) statements\.push\(\.\.\.\(await restoreEditedFamilyStatements\(db, orgId, "other_party_payment", paymentNo\)\)\);/);
  assert.match(block(pay, "async function buildCustomerPaymentLifecycle(", "// buildCustomerPaymentRestate"), /if \(reactivated\) statements\.push\(\.\.\.\(await restoreEditedFamilyStatements\(db, orgId, "payment", id\)\)\);/);
  // Row 5 (supplier payments) keeps its own repair from 2026-07-24.
  assert.match(sp, /const live = latestRestatePostType\(/);
});

test("the server refuses to edit a cancelled document (the screens never offer it)", () => {
  assert.match(block(acc, 'app.post("/payment-vouchers/:id/restate"', "// One document's ledger lines"), /This voucher is cancelled — restore it before editing\./);
  assert.match(block(acc, "async function buildOtherPartyPaymentRestate(", 'app.post("/other-party-payments/:paymentNo/void"'), /if \(\(await getDocState\(db, orgId, "other_party_payment", paymentNo\)\) !== "ACTIVE"\)/);
  assert.match(block(pay, "async function buildCustomerPaymentRestate(", "function parseAllocations("), /if \(\(await getDocState\(db, orgId, "payment", id\)\) !== "ACTIVE"\)/);
  assert.match(block(sp, "async function buildSupplierPaymentRestate(", "function bumpSupplierPaymentsRev("), /const lcState = await getDocState\(db, orgId, "supplier_payment", paymentNo\);/);
});

test("inventory: every restate_post writer is one of the five covered edits", () => {
  // A NEW document type that re-posts under `<x>_restate_post:` must be
  // checked against this class before it is added here.
  const writers = new Set();
  for (const [name, src] of [["accounting", acc], ["payments", pay], ["supplier-payments", sp]]) {
    for (const m of src.matchAll(/`([a-z_]+)_restate_post:\$\{stamp\}`/g)) writers.add(`${name}:${m[1]}`);
  }
  assert.deepEqual([...writers].sort(), [
    "accounting:official_receipt",
    "accounting:other_party_bill",
    "accounting:other_party_payment",
    "accounting:payment_voucher",
    "accounting:purchase_credit_note",
    "payments:payment",
    "supplier-payments:supplier_payment",
  ], "other_party_bill and purchase_credit_note re-post no bank leg (expense / payable only)");
});
