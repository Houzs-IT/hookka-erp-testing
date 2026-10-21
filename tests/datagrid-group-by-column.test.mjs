// ---------------------------------------------------------------------------
// datagrid-group-by-column.test.mjs — "Group By This Column" on the DataGrid's
// header right-click menu (finance v2 design; owner 2026-10-20 「可以」). The
// user's grouping wins over a page's own `groupBy` while set: each group has a
// header (a click folds it), its rows, and — when the grid has totals — a
// subtotal row that stays when the group is folded. A long list opens folded.
// The export carries the subtotal rows. Pure parts: tests/grid-group.test.mjs.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const src = read("src/components/ui/data-grid.tsx");
const between = (start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `missing ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j > i, `missing ${end} after ${start}`);
  return src.slice(i, j);
};

test("the menu offers it, ticks the grouped column and names it in the heading", () => {
  assert.match(src, /grouped: userGroupKey === hdrMenu\.key \? "this" : groupOn \? "other" : "none",/);
  assert.match(src, /checked: label === "Group By This Column" && userGroupKey === hdrMenu\.key/);
  assert.match(src, /sub: userGroupKey === hdrMenu\.key \? "grouped" :/);
  assert.match(src, /checked\?: boolean;/, "ContextMenuItem.checked");
  assert.match(src, /\{item\.checked && <span className="ml-auto text-\[#6B5C32\]" aria-label="on">✓<\/span>\}/);
});

test("picking it groups by that column; a long list opens folded; Clear / Reset undo it", () => {
  const act = between(`"Group By This Column": () => {`, `"Filter This Column…"`);
  assert.match(act, /setUserGroupKey\(key\);/);
  assert.match(act, /setUserFolded\(sortedData\.length > USER_GROUP_OPEN_MAX/);
  assert.match(src, /const USER_GROUP_OPEN_MAX = 500;/);
  assert.match(act, /"Clear Grouping": \(\) => \{ setUserGroupKey\(null\); setUserFolded\(new Set\(\)\); setGroupEnabled\(false\); \},/);
  const reset = between(`"Reset Layout": () => {`, `"Export to Excel"`);
  assert.match(reset, /setUserGroupKey\(null\);/);
  assert.match(between("const resetAllFilters = useCallback(", "}, [groupBy, autoGroup]);"), /setUserGroupKey\(null\);/);
  // The toolbar says what it is grouped by, with ✕ to stop.
  assert.match(src, /Grouped by \{userGroupCol\.label\}/);
  assert.match(src, /title="Clear grouping"\n\s+onClick=\{\(\) => \{ setUserGroupKey\(null\); setUserFolded\(new Set\(\)\); \}\}/);
  assert.match(src, /\{groupBy && !userGroupCol && \(/, "the page's own Group toggle steps aside meanwhile");
});

test("rows sort by their group first (read once per row), the user's sort inside", () => {
  assert.match(src, /const groupOn = !!userGroupCol \|\| \(!!groupBy && groupEnabled\);/);
  assert.match(src, /const ug = userGroupCol \? new Map\(result\.map\(\(r\) => \[r, userGroupValue\(r\)\]\)\) : null;/);
  assert.match(src, /const gc = compareGroupValues\(ug\.get\(a\) \?\? "", ug\.get\(b\) \?\? ""\);/);
  assert.match(src, /const virtualizationActive = virtualize && !groupOn;/, "a grouped grid is not virtualised");
  assert.match(src, /if \(!userGroupCol && groupBy && groupEnabled && groupFilter\) \{/, "the page's group filter is its own");
});

test("the body: a header per group that folds it, the rows, a subtotal row kept when folded", () => {
  const body = between("if (userGroupCol) {\n                  const span =", "// ── Legacy / grouped path");
  assert.match(body, /data-dg="group"/);
  assert.match(body, /onClick=\{\(\) => toggleUserFold\(key\)\}/);
  assert.match(body, /if \(!userFolded\.has\(key\)\) out\.push\(renderDataRow\(row, index\)\);/);
  assert.match(body, /data-dg="subtotal"/);
  assert.match(body, /if \(!g \|\| !showFooter\) return;/, "no totals on the grid → no subtotal row");
  assert.match(body, /const t = columnTotals\(g\.rows, visibleColumns, \(row, k\) => getNestedValue\(row, k\)\);/, "over the group's every row, not the painted ones");
  assert.match(body, /\{name\} subtotal <span className="font-normal text-\[#6B7280\]">· \{g\.rows\.length\} \{g\.rows\.length === 1 \? "row" : "rows"\}<\/span>/);
  // The label spans the empty columns after it, so it never widens its column.
  assert.match(body, /while \(i \+ span < visibleColumns\.length && t\[visibleColumns\[i \+ span\]\.key\] === undefined && !stickyOffsets\.has\(visibleColumns\[i \+ span\]\.key\)\) span\+\+;/);
});

test("a column can name its own group; the Payment Vouchers status groups by its kind", () => {
  assert.match(src, /groupAccessor\?: \(row: T\) => string \| number \| null;/, "Column.groupAccessor");
  assert.match(src, /columnGroupValue\(userGroupCol as unknown as GroupColumn<T>, row\)/);
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /\{ key: "statusLabel", label: "Status", width: "250px", noClip: true,\n(?:\s+\/\/.*\n)*\s+groupAccessor: \(r\) => r\.status\.group \?\? r\.status\.label,/);
});

test("the export carries each group's subtotal row; the PDF bands them", () => {
  const sheet = between("const exportSheet = (): { aoa: Aoa; subtotalRows: number[] } => {", "const exportBase");
  assert.match(sheet, /buildGroupedListingAoa\(/);
  assert.match(sheet, /groupRows\(sortedData, userGroupValue\)\.map\(\(g\) => \(\{ label: groupValueLabel\(userGroupCol\.type, g\.value\), rows: g\.rows \}\)\)/);
  assert.match(src, /const \{ aoa, subtotalRows \} = exportSheet\(\);/);
  assert.match(src, /\(_row, idx\) => \(showFooter && idx === lastBody \? "grand" : subtotal\.has\(idx\) \? "subtotal" : undefined\)/);
});
