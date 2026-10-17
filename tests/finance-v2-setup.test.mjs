// ---------------------------------------------------------------------------
// finance-v2-setup.test.mjs — the Setup pages in the v2 look (plan
// 2026-10-17-finance-v2-einvoice-setup Task 2). Same reads and writes. Main
// buttons on the title row (Add Account, Save, Post opening balance with the
// same guard), the opening balance's DR / CR line as the check strip, every
// list in the v2 list look with input rows not lifted, and the shared
// virtual-scroll spacer rows never lift.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const fn = (name) => {
  const a = ui.indexOf(`function ${name}(`);
  assert.ok(a > 0, `${name} exists`);
  return ui.slice(a, ui.indexOf("\n}\n", a));
};
const bar = (body) => body.slice(body.indexOf("<FinanceTitleActions>"), body.indexOf("</FinanceTitleActions>"));

test("virtual-scroll spacer rows never lift (both shared hooks)", () => {
  for (const f of ["src/components/ui/virtual-rows.tsx", "src/components/ui/virtual-groups.tsx"]) {
    assert.match(read(f), /<tr key=\{key\} aria-hidden="true" data-fin-nolift="">/, f);
  }
});

test("Chart of Accounts: Add Account on the title row, same toggle", () => {
  const coa = fn("COATab");
  assert.match(bar(coa), /<Button variant="primary" size="sm" onClick=\{\(\) => setShowForm\(!showForm\)\}>\n\s*<Plus className="h-4 w-4" \/> Add Account/);
  assert.doesNotMatch(coa, /<span aria-hidden="true" \/>/, "the empty spacer beside the old button is gone");
});

test("Stock Mapping and Opening Stock: Save on the title row; every row holds inputs and stays put", () => {
  const map = fn("StockMapCard");
  assert.match(bar(map), /<Button variant="primary" size="sm" onClick=\{save\} disabled=\{saving \|\| !rows\}>/);
  assert.equal((map.match(/onClick=\{save\}/g) ?? []).length, 1, "one Save");
  assert.match(map, /<table data-fin-list className="text-sm">/);
  assert.equal((map.match(/<tr (key=\{r\.group\} )?data-fin-nolift=""/g) ?? []).length, 4, "the groups, Default, WIP, FG");
  const os = fn("OpeningStockTab");
  assert.match(bar(os), /<Button variant="primary" size="sm" onClick=\{save\} disabled=\{saving \|\| !rows\}>/);
  assert.equal((os.match(/onClick=\{save\}/g) ?? []).length, 1);
  assert.match(os, /<table data-fin-list className="text-sm w-full">/);
  assert.match(os, /<tr key=\{r\.id\} data-fin-nolift="" className="border-b border-\[#F0ECE9\]" style=\{\{ height: OPENING_STOCK_ROW_PX \}\}>/);
});

test("Opening Balance: Post on the title row with the same guard and label; the check strip; lists v2", () => {
  const ob = fn("OpeningBalanceTab");
  const b = bar(ob);
  assert.match(b, /disabled=\{posting \|\| diff !== 0 \|\| !openingDate \|\| !!openingMoneyError\} onClick=\{handlePost\}/);
  assert.match(b, /\{posting \? "Posting…" : data\?\.posted \? "Re-post opening balance" : "Post opening balance"\}/);
  assert.equal((ob.match(/onClick=\{handlePost\}/g) ?? []).length, 1, "one Post");
  assert.match(ob, /<CheckStrip ok=\{diff === 0\} label=\{diff === 0 \? "Balanced ✓" : `Difference \$\{formatCurrency\(Math\.abs\(diff\)\)\} \$\{diff > 0 \? "DR" : "CR"\}`\}>/);
  assert.match(ob, /Total DR <b className="tabular-nums">\{formatCurrency\(totalDr\)\}<\/b>/);
  assert.match(ob, /Total CR <b className="tabular-nums">\{formatCurrency\(totalCr\)\}<\/b>/);
  assert.equal((ob.match(/<table data-fin-list className="w-full text-sm">/g) ?? []).length, 5, "AR, AP, the two pre-opening lists, the account grid");
  assert.match(ob, /<tr key=\{it\.code\} data-fin-nolift="" className="border-b border-\[#F0ECE9\]" style=\{\{ height: OPENING_BALANCE_ROW_PX \}\}>/);
  assert.match(ob, /onClick=\{saveOpeningDate\}/, "the date's own Save stays with the date");
});

test("Audit Log: no repeated heading; the list in the v2 look; Unvoid unchanged", () => {
  const al = read("src/pages/accounting/tabs/AuditLogTab.tsx");
  assert.doesNotMatch(al, /<h2[^>]*>Audit Log<\/h2>/);
  assert.match(al, /<table data-fin-list className="w-full text-sm">/);
  assert.match(al, /onClick=\{\(\) => unvoid\(r\)\}/);
});

test("Settings: Document Numbering and Landed Cost lists in the v2 look; their buttons stay in their cards", () => {
  const dn = fn("DocNumberingCard");
  assert.match(dn, /<table data-fin-list className="w-full text-sm">/);
  assert.match(dn, /<tr key=\{a\.code\} data-fin-nolift="" className="border-t border-\[#F0ECE9\]">/);
  assert.doesNotMatch(dn, /FinanceTitleActions/, "several cards share the Settings page — each keeps its own Save");
  const lc = fn("LandedCostCard");
  assert.match(lc, /<table data-fin-list className="w-full text-sm">/);
  assert.doesNotMatch(lc, /FinanceTitleActions/);
});
