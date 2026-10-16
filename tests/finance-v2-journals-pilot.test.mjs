// ---------------------------------------------------------------------------
// finance-v2-journals-pilot.test.mjs — Journal Entries is the first list on
// the v2 table rules (plan 2026-10-16-finance-v2-foundation Task 9): header
// right-click menu, drag headers, a total row for the debit and credit
// columns, and the amount columns filterable / sortable / exportable as money.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const tab = ui.slice(ui.indexOf("function JournalsTab("), ui.indexOf("\nfunction ", ui.indexOf("function JournalsTab(") + 10));

test("each row carries its debit and credit totals in sen, from its lines", () => {
  assert.match(tab, /const gridRows = useMemo\(\s*\(\) => rows\.map\(\(r\) => \(\{\s*\.\.\.r,\s*totalDebit: r\.lines\.reduce\(\(s, l\) => s \+ l\.debitSen, 0\),\s*totalCredit: r\.lines\.reduce\(\(s, l\) => s \+ l\.creditSen, 0\),\s*\}\)\),/);
});

test("the amount columns are money columns with a total", () => {
  for (const key of ["totalDebit", "totalCredit"]) {
    const at = tab.indexOf(`key: "${key}"`);
    assert.ok(at >= 0, key);
    const col = tab.slice(at, at + 300);
    assert.match(col, /type: "currency",/, `${key} is money (sort, number filter, export in RM)`);
    assert.match(col, /total: "sum",/, `${key} has a total`);
  }
});

test("the grid uses the v2 table rules", () => {
  const at = tab.indexOf("<DataGrid");
  const grid = tab.slice(at, tab.indexOf("/>", at));
  assert.match(grid, /data=\{gridRows\}/);
  assert.match(grid, /headerMenu/);
  assert.match(grid, /reorderableHeaders/);
  assert.match(grid, /exportName="Journal Entries"/);
});

test("a grid with the header menu keeps Export off its toolbar", () => {
  const grid = read("src/components/ui/data-grid.tsx");
  assert.match(grid, /\{exportName && !headerMenu && \(/);
});
