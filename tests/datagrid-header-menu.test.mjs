// ---------------------------------------------------------------------------
// datagrid-header-menu.test.mjs — the header right-click menu (finance v2 "PV
// table" rule: Export Excel / Export PDF / Print / Columns live on a header
// right-click menu, AutoCount style, so the toolbar is not crowded; plan
// 2026-10-16-finance-v2-foundation Task 5). Opt-in per grid (`headerMenu`), so
// every other grid keeps the browser's own menu on its headers.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const src = read("src/components/ui/data-grid.tsx");

test("only a grid that asks gets the header menu; Shift keeps the browser's", () => {
  assert.match(src, /headerMenu\?: boolean;/, "DataGridProps.headerMenu");
  assert.match(src, /onContextMenu=\{headerMenu \? \(e\) => openHeaderMenu\(e, col\.key\) : undefined\}/);
  const at = src.indexOf("const openHeaderMenu = ");
  assert.ok(at >= 0, "openHeaderMenu");
  const fn = src.slice(at, src.indexOf("};", at));
  assert.match(fn, /if \(e\.shiftKey\) return;/, "Shift + right-click keeps the browser menu");
  assert.match(fn, /e\.preventDefault\(\);/);
  assert.match(fn, /x: Math\.min\(e\.clientX, window\.innerWidth - 248\)/, "the design's x clamp");
});

test("the items come from headerMenuItems and each one does its job", () => {
  assert.match(src, /headerMenuItems\(\{\s*sorted: sortKey === hdrMenu\.key \? sortDir : null,/);
  for (const [label, action] of [
    ["Sort Ascending", /setSortKey\(key\); setSortDir\("asc"\);/],
    ["Sort Descending", /setSortKey\(key\); setSortDir\("desc"\);/],
    ["Clear Sorting", /setSortKey\(null\); setSortDir\("asc"\);/],
    ["Filter This Column…", /setFilterDropdown\(\{ key, rect: \{ left: at\.x, top: at\.y \} \}\)/],
    ["Clear All Filters", /setColumnFilters\(\{\}\); setColumnValueFilters\(\{\}\);/],
    ["Hide This Column", /if \(visibleColumns\.length <= 1\) \{ toast\.info\("Keep at least one column"\)/],
    ["Column Chooser…", /setShowCustomizer\(true\)/],
    ["Best Fit", /resetColumnWidth\(key\)/],
    ["Best Fit (All Columns)", /setColWidths\(\{\}\); persistColWidths\(\{\}\);/],
    ["Reset Layout", /void resetToOrgDefault\(\)/],
    ["Export to Excel", /runExport\("xlsx"\)/],
    ["Export to PDF", /runExport\("pdf"\)/],
    ["Print", /runExport\("print"\)/],
  ]) {
    const i = src.indexOf(`"${label}": `);
    assert.ok(i >= 0, `${label} has an action`);
    assert.match(src.slice(i, i + 400), action, `${label} action`);
  }
});

test("the menu reuses the grid's context menu (Esc, outside click, arrow keys) with a heading", () => {
  assert.match(src, /heading\?: \{ title: string; sub\?: string \};/, "ContextMenu heading prop");
  assert.match(src, /\{hdrMenu && \(\s*<ContextMenu/);
  assert.match(src, /sub: userGroupKey === hdrMenu\.key \? "grouped" : sortKey === hdrMenu\.key \? \(sortDir === "desc" \? "sorted Z → A" : "sorted A → Z"\) : "column"/);
});

test("exports carry the total row; Print opens the PDF for printing instead of saving it", () => {
  assert.match(src, /const exportSheet = \(\): \{ aoa: Aoa; subtotalRows: number\[\] \} => \{/);
  assert.match(src, /if \(showFooter\) aoa\.push\(/, "the total row goes into the file too");
  assert.match(src, /void exportReportXlsx\(exportFilename\(exportBase, "listing", "xlsx", today\), exportTitle, aoa\)/);
  assert.match(src, /void exportReportPdf\(exportFilename\(exportBase, "listing", "pdf", today\), exportTitle, `As at \$\{formatDateDMY\(today\)\}`, aoa, \{/);
  assert.match(src, /print: kind === "print",/);
  const pdf = read("src/lib/export-report.ts");
  assert.match(pdf, /print\?: boolean;/);
  assert.match(pdf, /if \(opts\?\.print\) \{\s*doc\.autoPrint\(\);/);
  assert.match(pdf, /window\.open\(doc\.output\("bloburl"\)/);
});
