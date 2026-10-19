// ---------------------------------------------------------------------------
// finance-v2-monthly.test.mjs — Monthly P&L and Cost Structure in the v2 look
// (plan 2026-10-16-finance-v2-reports Task 6). Same data calls and figures;
// column order as the server sends it (owner: Accumulated first, newest month
// first); the month reports keep to their content's width (owner 2026-10-01).
// New: the report toolbar, the frame, Accumulated shading, open groups on
// their total line, drill rows as detail rows with "Open In GL →", Cost
// Structure section frames and a Total-to-date row.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const ui = read("src/pages/accounting/index.tsx");
const slice = (from, to = "\nfunction ") => { const a = ui.indexOf(from); return ui.slice(a, ui.indexOf(to, a + 10)); };
const mo = slice("function MonthlyPlTab(");
const drill = slice("function PlMonthlyDrillRows(");
const cs = slice("function CostStructureTab(");
const css = read("src/styles/finance-v2.css");

test("Monthly P&L: same call, the server's columns in their order, figures and % as sent", () => {
  assert.match(mo, /fetch\(`\/api\/accounting\/pl-monthly\?line=\$\{line\}&anchor=\$\{anchor\}`\)/);
  assert.match(mo, /const cols = data\?\.columns \?\? \[\];/);
  assert.doesNotMatch(mo, /cols\.(sort|reverse)\(/, "the column order is the server's (Accumulated first, newest month first)");
  assert.match(mo, /const shown = foldStatementRows\(rows, collapsed\);/);
  assert.match(mo, /\{show \? pctTxt\(r\.pctValues\[j\] \?\? 0\) : ""\}/, "the % is the server's");
  assert.match(mo, /const est = \(r\.estValues\?\.\[j\] \?\? 0\) !== 0;/);
});

test("Monthly P&L: toolbar, frame, Accumulated shaded, content width", () => {
  assert.match(mo, /<PeriodStepper value=\{anchor\} options=\{anchorOptions\} onChange=\{setAnchor\} today=\{today\} \/>/);
  assert.match(mo, /<DetailLevels levels=\{Array\.from\(\{ length: maxLevel \}, \(_, i\) => i \+ 1\)\} value=\{level \?\? -1\} onChange=\{applyLevel\} \/>/);
  for (const l of ["Export to Excel", "Print / PDF"]) assert.ok(mo.includes(`label: "${l}"`), l);
  assert.doesNotMatch(mo, /CSV/, "no CSV (owner 2026-10-17)");
  assert.match(mo, /company=\{COMPANY\.HOOKKA\.name\}/, "the legal name (owner 2026-10-17)");
  assert.match(mo, /<table data-col-resize="first" data-fin-report data-fin-fit>/);
  assert.match(mo, /data-cell=\{`split center\$\{c\.accum \? " acc" : ""\}`\}/);
  assert.match(css, /table\[data-fin-report\]\[data-fin-fit\] \{\n  width: auto;\n\}/);
  assert.match(css, /> thead > tr > th\[data-cell~="acc"\] \{\n  background-color: #D9E1EA;/);
});

test("Monthly drill: detail rows, the last one counts them and opens the ledger for account lines", () => {
  assert.match(drill, /<tr key=\{e\.key\} data-row="det"/);
  assert.match(drill, /<tr data-row="detsum">/);
  assert.match(drill, /const tied = line !== "all" \|\| cols\.every\(/, "each month's lines still make the row");
  assert.match(drill, /\{glOk && <> · <Link to=\{glHref\(account, from, to\)\}/);
});

test("Cost Structure: section frames, the server's months, a Total-to-date row", () => {
  assert.match(cs, /fetch\(`\/api\/accounting\/cost-structure\$\{fy !== null \? `\?fy=\$\{fy\}` : ""\}`\)/);
  assert.match(cs, /const toDate = data \? data\.cols\.map\(\(m, i\) => \(m <= thisMonth \? i : -1\)\)\.filter\(\(i\) => i >= 0\) : \[\];/);
  assert.match(cs, /<td data-cell="num split">\{n\(g\.months\[first\]\.opening\)\}<\/td>/, "opening from the first month");
  assert.match(cs, /<td data-cell="num">\{n\(g\.months\[last\]\.closing\)\}<\/td>/, "closing from the latest month");
  assert.match(cs, /<td data-cell="stick">Total to date<\/td>/);
  for (const t of ["Bedframe Cost Structure", "Sofa Cost Structure", "Shared / Common Materials"]) assert.ok(cs.includes(`"${t}"`), t);
  for (const l of ["Export to Excel", "Print / PDF"]) assert.ok(cs.includes(`label: "${l}"`), l);
  assert.doesNotMatch(cs, /CSV/);
});
