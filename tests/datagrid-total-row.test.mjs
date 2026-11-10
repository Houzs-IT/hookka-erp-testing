// ---------------------------------------------------------------------------
// datagrid-total-row.test.mjs — the sticky total row (finance v2 "PV table"
// rule: sticky footer total row; plan 2026-10-16-finance-v2-foundation Task 4).
// A column opts in with `total`; the footer sums what the filter SHOWS (all
// filtered rows, not just the ones the render cap paints), stays pinned to the
// bottom of the scroll box, and reads "Total · N shown of M" by default. A grid
// with no `total` column renders exactly as before.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = readFileSync("src/components/ui/data-grid.tsx", "utf8").replace(/\r\n/g, "\n");

test("columns and the grid can ask for a total row", () => {
  assert.match(src, /total\?: "sum" \| \(\(rows: T\[\]\) => number\);/, "Column.total");
  assert.match(src, /totalFormat\?: \(n: number\) => React\.ReactNode;/, "Column.totalFormat");
  assert.match(src, /footerLabel\?: \(shown: number, all: number\) => React\.ReactNode;/, "DataGridProps.footerLabel");
});

test("the totals cover every filtered row and the footer only exists when a column asks", () => {
  // 2026-11-10 (review G4): sortedData minus the rows `totalsSkipRow` leaves
  // out (cancelled documents), still never the render-capped displayedData.
  assert.match(src, /splitForTotals\(sortedData, totalsSkipRow\)/,
    "totals from sortedData (filtered + sorted), not displayedData (render-capped)");
  assert.match(src, /columnTotals\(totalsSplit\.counted, visibleColumns, \(row, key\) => getNestedValue\(row, key\)\)/);
  assert.match(src, /const showFooter = visibleColumns\.some\(\(c\) => c\.total\);/);
  assert.match(src, /\{showFooter && !loading && \(\s*<tfoot data-dg="foot" className="sticky bottom-0 z-30">/,
    "a sticky tfoot, only when a visible column has a total");
});

test("the footer label and the total formats", () => {
  // The default label moved into totalFooterText (grid-layout.ts) when it
  // learned "N cancelled not counted" and "loaded rows only" (review G4).
  assert.match(src, /totalFooterText\(\{\s*shown: sortedData\.length,\s*all: data\.length,/);
  const layout = readFileSync("src/lib/grid-layout.ts", "utf8");
  assert.match(layout, /`Total · \$\{o\.shown\.toLocaleString\(\)\} shown of \$\{o\.all\.toLocaleString\(\)\}`/);
  assert.match(src, /col\.totalFormat \? col\.totalFormat\(t\) : col\.type === "currency" \? formatRM\(t\) : formatNumber\(t\)/,
    "currency totals in RM from sen, other numbers plain, or the column's own format");
});
