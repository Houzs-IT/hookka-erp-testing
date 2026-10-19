// ---------------------------------------------------------------------------
// coa-new-account-form.test.mjs — the New Account form (finance backlog item
// 15, owner 2026-10-17 「可以，但前提不要碰现在的」): section chips with the
// normal-balance hint, the parent first (only accounts that are already
// groups — creating under a posting account would turn it into a group, i.e.
// change an existing account), the parent's cash-flow / P&L category carried
// over, a suggested next free code checked for format, duplicates and the
// section's code band. Same POST /api/accounting/coa. Made-up accounts.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const f = await import(pathToFileURL(resolve(process.cwd(), "src/lib/coa-form.ts")).href);

const acc = (code, type, parentCode, extra = {}) => ({ code, name: code, type, ...(parentCode ? { parentCode } : {}), ...extra });
const COA = [
  acc("900-0000", "EXPENSE", undefined, { isPostable: false }),
  acc("900-0010", "EXPENSE", "900-0000", { cashFlowCategory: "O", pnlCategory: "FIXED" }),
  acc("900-0020", "EXPENSE", "900-0000"),
  acc("900-A001", "EXPENSE", "900-0000"),
  acc("901-0000", "EXPENSE", undefined, { cashFlowCategory: "O", pnlCategory: "VARIABLE" }),
  acc("901-0010", "EXPENSE", "901-0000"),
  acc("902-0050", "EXPENSE"), // a top-level posting account — never offered as a parent
  acc("310-0000", "ASSET", undefined, { isPostable: false }),
  acc("310-0010", "ASSET", "310-0000"),
  acc("480-0000", "LIABILITY"),
  acc("530-0000", "REVENUE"),
];

test("sections: the owner's nine, each a type plus a code band", () => {
  assert.deepEqual(f.COA_SECTIONS.map((s) => s.key), ["NCA", "CA", "CL", "NCL", "EQ", "REV", "COGS", "OI", "EXP"]);
  assert.equal(f.coaSectionOf("200-1000", "ASSET"), "NCA");
  assert.equal(f.coaSectionOf("310-0010", "ASSET"), "CA");
  assert.equal(f.coaSectionOf("480-0050", "LIABILITY"), "NCL");
  assert.equal(f.coaSectionOf("440-0000", "LIABILITY"), "CL");
  assert.equal(f.coaSectionOf("530-0010", "REVENUE"), "OI");
  assert.equal(f.coaSectionOf("500-0040", "REVENUE"), "REV");
});

test("normal balance and where the account shows", () => {
  assert.equal(f.normalBalanceOf("ASSET"), "Debit");
  assert.equal(f.normalBalanceOf("EXPENSE"), "Debit");
  assert.equal(f.normalBalanceOf("COST"), "Debit");
  assert.equal(f.normalBalanceOf("LIABILITY"), "Credit");
  assert.equal(f.normalBalanceOf("EQUITY"), "Credit");
  assert.equal(f.normalBalanceOf("REVENUE"), "Credit");
  assert.equal(f.isPnlType("COST"), true);
  assert.equal(f.isPnlType("ASSET"), false);
  assert.equal(f.defaultCashFlowFor("NCA"), "I");
  assert.equal(f.defaultCashFlowFor("NCL"), "F");
  assert.equal(f.defaultCashFlowFor("EXP"), "O");
});

test("parents: only existing groups of the section — never a posting account", () => {
  assert.deepEqual(f.groupParentsIn(COA, "EXP").map((a) => a.code), ["900-0000", "901-0000"]);
  assert.ok(!f.groupParentsIn(COA, "EXP").some((a) => a.code === "902-0050"), "a leaf would be promoted — not offered");
  assert.deepEqual(f.groupParentsIn(COA, "CA").map((a) => a.code), ["310-0000"]);
  assert.deepEqual(f.groupParentsIn(COA, "NCL"), [], "480-0000 is a posting account");
});

test("next free code: under a parent, the next step of 10; at the top, the next prefix; always free and in band", () => {
  assert.equal(f.nextFreeCode(COA, "EXP", "900-0000"), "900-0030", "after 900-0020; 900-A001 is not numbered");
  assert.equal(f.nextFreeCode(COA, "EXP", "901-0000"), "901-0020");
  assert.equal(f.nextFreeCode(COA, "CA", "310-0000"), "310-0020");
  assert.equal(f.nextFreeCode(COA, "EXP", ""), "903-0000", "after the highest top-level expense prefix (902)");
  assert.equal(f.nextFreeCode(COA, "NCL", ""), "481-0000", "stays inside 480–489");
  assert.equal(f.nextFreeCode(COA, "NCA", ""), "200-0000", "an empty section starts at its band");
  const full = Array.from({ length: 10 }, (_, i) => acc(`48${i}-0000`, "LIABILITY"));
  assert.equal(f.nextFreeCode(full, "NCL", ""), "", "the band is full — the user types one");
});

test("code check: format, duplicate, section band; auto vs typed", () => {
  assert.deepEqual(f.codeCheck("903-0000", COA, "EXP", true), { tone: "muted", text: "next free code — change it if you like" });
  assert.deepEqual(f.codeCheck("903-0010", COA, "EXP", false), { tone: "ok", text: "✓ available" });
  assert.equal(f.codeCheck("9030010", COA, "EXP", false).text, "format 901-0010");
  assert.equal(f.codeCheck("900-0010", COA, "EXP", false).text, "900-0010 already exists");
  assert.equal(f.codeCheck("250-0000", COA, "CA", false).text, "250-0000 lands in Non-Current Assets — Current Assets uses codes 300 and above");
  assert.equal(f.codeCheck("900-B002", COA, "EXP", false).tone, "ok", "letters in the last four are fine");
});

const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const coa = (() => { const a = ui.indexOf("function COATab("); return ui.slice(a, ui.indexOf("\n}\n", a)); })();

test("screen: section chips, parent first, the code line, the reporting block; same POST", () => {
  assert.match(coa, /<div className="text-sm font-semibold text-\[#1F1D1B\]">New Account<\/div>/);
  assert.match(coa, /\{SECTIONS\.map\(\(x\) => \(\n\s*<button key=\{x\.key\} type="button" onClick=\{\(\) => setSection\(x\.key\)\}/);
  assert.match(coa, /Normal balance: \{normalBalanceOf\(sec\.type\)\} · shows on the \{pnl \? "P&L" : "Balance Sheet"\}/);
  assert.match(coa, /const groups = groupParentsIn\(accounts, sec\.key\);/);
  assert.match(coa, /Only existing groups — a posting account is never turned into a group\./);
  assert.match(coa, /const chk = codeCheck\(formData\.code, accounts, sec\.key, formData\.codeAuto\);/);
  assert.match(coa, /\{pnl && \(/, "P&L category only for P&L sections");
  assert.match(coa, /disabled=\{chk\.tone === "err" \|\| !formData\.name\.trim\(\)\} onClick=\{handleAdd\}/);
  // Picking a parent carries its reporting over; the code follows while it is still the suggestion.
  assert.match(coa, /cashFlowCategory: p\?\.cashFlowCategory \?\? f\.cashFlowCategory,\n\s*pnlCategory: p\?\.pnlCategory \?\? f\.pnlCategory,\n\s*\.\.\.\(f\.codeAuto \? \{ code: nextFreeCode\(accounts, f\.section, parentCode\) \} : \{\}\),/);
  const add = coa.slice(coa.indexOf("const handleAdd = async"), coa.indexOf("// Phase 1 — quick per-row P&L category tagging"));
  assert.match(add, /fetch\("\/api\/accounting\/coa", \{\n\s*method: "POST",/);
  assert.match(add, /if \(chk\.tone === "err"\) \{ toast\.error\(chk\.text\); return; \}/);
  assert.doesNotMatch(add, /method: "PUT"/, "adding never edits an existing account");
});

test("existing accounts keep their own paths (edit name, P&L tag, move, rename, deactivate) unchanged", () => {
  assert.match(coa, /const handleEdit = async \(code: string\) => \{/);
  assert.match(coa, /const handleSetPnl = async \(code: string, value: string\) => \{/);
  assert.match(coa, /const handleMove = async \(srcCode: string, dstCode: string\) => \{/);
  assert.match(coa, /const handleRenameCode = async \(node: ChartOfAccount\) => \{/);
  assert.match(coa, /const handleDeactivate = async \(code: string\) => \{/);
});
