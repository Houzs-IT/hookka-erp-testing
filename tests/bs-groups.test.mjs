// ---------------------------------------------------------------------------
// bs-groups.test.mjs — the Balance Sheet's parent accounts (owner 2026-10-21
// 「这个balance sheet 没有分父子account？」 → 「可以，做」): within a section the
// accounts that share a Chart of Accounts parent sit under it, the parent's row
// carrying their subtotal — the Cash Flow's rule (one level; a lone account
// adds no parent row). Display only: the accounts and totals are unchanged.
// The /pl entries carry parentCode / parentName; the sheet folds a parent like
// a section (L3 parents folded, L4 every account, L5 ledger lines); the
// download carries the parents too. Made-up figures only.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const { groupBsEntries } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/bs-groups.ts")).href);

const e = (accountCode, balance, parentCode = null, parentName = null, accountName = `ACCOUNT ${accountCode}`) =>
  ({ id: accountCode, accountCode, accountName, balance, parentCode, parentName });
const shape = (items) => items.map((it) => it.kind === "line"
  ? it.entry.accountCode
  : `${it.code} ${it.name} = ${it.totalSen} [${it.members.map((m) => m.accountCode).join(", ")}]`);

test("accounts sharing a parent sit under it with their subtotal; the rest stay where they are, in code order", () => {
  const items = groupBsEntries([
    e("300-0000", 50000),
    e("305-0000", 1200),
    e("310-0010", -8000, "310-0000", "CASH AT BANK"),
    e("310-0030", 9500, "310-0000", "CASH AT BANK"),
    e("320-0000", 700),
    e("330-8000", 3000, "330-0000", "STOCK"),
    e("330-9000", 4000, "330-0000", "STOCK"),
    e("350-0000", 100),
  ]);
  assert.deepEqual(shape(items), [
    "300-0000",
    "305-0000",
    "310-0000 CASH AT BANK = 1500 [310-0010, 310-0030]",
    "320-0000",
    "330-0000 STOCK = 7000 [330-8000, 330-9000]",
    "350-0000",
  ]);
});

test("a parent with one account in the section adds no row (the Cash Flow's rule)", () => {
  const items = groupBsEntries([
    e("310-0020", 9000, "310-0000", "CASH AT BANK"),
    e("400-0000", 30000),
    e("410-0010", 100, "410-0000", "ACCRUALS"),
    e("410-0020", 200, "410-0000", "ACCRUALS"),
    e("440-0030", 5000, "440-0000", "LOAN FROM RELATED PARTIES"),
    e("440-0040", 600),
  ]);
  assert.deepEqual(shape(items), ["310-0020", "400-0000", "410-0000 ACCRUALS = 300 [410-0010, 410-0020]", "440-0030", "440-0040"]);
});

test("nothing is lost or counted twice; the unclosed-earnings line stays last", () => {
  const entries = [
    e("500-0000", 100000),
    e("510-0010", 2000, "510-0000", "RESERVES"),
    e("510-0020", -500, "510-0000", "RESERVES"),
    { id: "NP-CURRENT", accountCode: "NP-CURRENT", accountName: "Current Year Earnings (unclosed)", balance: 7300 },
  ];
  const items = groupBsEntries(entries);
  assert.equal(items.at(-1).kind, "line");
  assert.equal(items.at(-1).entry.accountCode, "NP-CURRENT");
  const flat = items.flatMap((it) => (it.kind === "line" ? [it.entry] : it.members));
  assert.deepEqual(flat.map((x) => x.accountCode).sort(), entries.map((x) => x.accountCode).sort());
  const sum = items.reduce((s, it) => s + (it.kind === "line" ? it.entry.balance : it.totalSen), 0);
  assert.equal(sum, entries.reduce((s, x) => s + x.balance, 0));
});

test("a parent that carries a balance of its own is one of its members, not also in its own parent's group", () => {
  const items = groupBsEntries([
    e("330-0000", 250, "300-0000", "CURRENT ASSETS", "STOCK"),
    e("330-1000", 1000, "330-0000", "STOCK"),
    e("330-2000", 2000, "330-0000", "STOCK"),
    e("340-0010", 10, "300-0000", "CURRENT ASSETS"),
  ]);
  assert.deepEqual(shape(items), ["330-0000 STOCK = 3250 [330-0000, 330-1000, 330-2000]", "340-0010"]);
});

test("no parent information (an older copy) = every account on its own", () => {
  const items = groupBsEntries([e("300-0000", 1), e("310-0010", 2), e("310-0030", 3)]);
  assert.deepEqual(shape(items), ["300-0000", "310-0010", "310-0030"]);
});

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("/pl: every balance-sheet account carries its parent; the copies of the old shape retire", () => {
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /"SELECT code, name, type, specialAccountType, cashFlowCategory, parentCode FROM chart_of_accounts",/);
  assert.match(api, /parent: a\.parentCode \?\? \(a as \{ parent_code\?: string \| null \}\)\.parent_code \?\? null,/);
  assert.match(api, /const parent = acct\.parent \? resolveAcct\(acct\.parent\) : null;\n\s*const parentCode = parent && parent !== code \? parent : null;/);
  assert.match(api, /parentName: parentCode \? coa\.get\(parentCode\)\?\.name \?\? null : null,/);
  assert.match(api, /const REPORT_SNAPSHOT_V = "v2";/, "a stored copy without the parents is not served");
});

test("the sheet: parents fold like sections (L3 folded, L4 open), Edit Layout flat, the download grouped", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const bs = ui.slice(ui.indexOf("function BalanceSheetTab() {"), ui.indexOf("\n}\n", ui.indexOf("function BalanceSheetTab() {")));
  assert.match(bs, /const \[level, setLevel\] = useState\(4\);/);
  assert.match(bs, /\{open && \(edit \? entries\.map\(\(e\) => accountRow\(e, false\)\) : groupBsEntries\(entries\)\.map\(\(it\) => \{/);
  assert.match(bs, /const gOpen = openGrp\[gKey\] !== undefined \? openGrp\[gKey\] : level >= 4;/);
  assert.match(bs, /<tr data-row="grp" data-bs-parent=\{it\.code\} className="cursor-pointer select-none"/);
  assert.match(bs, /<td data-cell="num split" data-neg=\{it\.totalSen < 0 \? "" : undefined\}>\{fmtAmt\(it\.totalSen\)\}<\/td>/, "the parent's row carries the subtotal");
  assert.match(bs, /\{gOpen && it\.members\.map\(\(e\) => accountRow\(e, true\)\)\}/);
  assert.match(bs, /<td style=\{\{ paddingLeft: underParent \? 52 : 32 \}\}>/);
  assert.match(bs, /tips=\{\{ 1: "Totals only", 2: "Sections", 3: "Parent accounts", 4: "Every account", 5: "Every account with its ledger lines" \}\}/);
  assert.match(bs, /onChange=\{\(L\) => \{ setLevel\(L\); setOpenSec\(\{\}\); setOpenGrp\(\{\}\); setBsDrillOpen\(new Set\(\)\); \}\}/);
  // The download: the parent's row (bold in the PDF) with its subtotal, its accounts under it.
  assert.match(bs, /push\(\[it\.code, `  \$\{it\.name\}`, it\.totalSen \/ 100\], "group"\);/);
  assert.match(bs, /for \(const e of it\.members\) push\(\[e\.accountCode, `      \$\{e\.accountName\}`, e\.balance \/ 100\], undefined\);/);
  const pdf = read("src/lib/export-report.ts");
  assert.match(pdf, /export type PdfRowKind = "section" \| "subtotal" \| "grand" \| "group" \| undefined;/);
  assert.match(pdf, /\} else if \(k === "group"\) \{\n\s*d\.cell\.styles\.fontStyle = "bold";/);
});
