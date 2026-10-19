// ---------------------------------------------------------------------------
// datagrid-checkbox-select.test.mjs — `checkboxSelectOnly` (plan 2026-10-16-
// finance-v2-daily-a Task 3). The finance lists keep their rule (owner
// 2026-10-01 「我不要点一次打开」): only the checkbox changes the ticks — a row
// click, a right-click and the ⋮ leave them alone, Shift + right-click keeps
// the browser's menu, and double-clicking the checkbox or ⋮ cell does not open
// the record. Without the prop every grid behaves exactly as before.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const src = read("src/components/ui/data-grid.tsx");
const fn = (marker, len = 900) => {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `missing: ${marker}`);
  return src.slice(at, at + len);
};

test("the props exist and default off", () => {
  assert.match(src, /checkboxSelectOnly\?: boolean;/);
  assert.match(src, /searchPlaceholder\?: string;/);
  assert.match(src, /placeholder=\{searchPlaceholder \?\? "Search\.\.\."\}/);
});

test("a row click leaves the ticks alone when asked", () => {
  const h = fn("const handleRowClick = useCallback(");
  assert.match(h, /if \(checkboxSelectOnly\) \{\s*lastClickedIndex\.current = index;\s*onRowClick\?\.\(row\);\s*return;\s*\}/);
  assert.match(h, /next\.clear\(\);\s*next\.add\(key\);/, "the default path is unchanged");
});

test("right-click and the ⋮ open the menu without touching the ticks; Shift keeps the browser menu", () => {
  const cm = fn("const handleContextMenu = useCallback(", 500);
  assert.match(cm, /if \(checkboxSelectOnly && e\.shiftKey\) return;/);
  assert.match(cm, /if \(!checkboxSelectOnly\) setSelectedKeys\(new Set\(\[key\]\)\);/);
  const kb = fn("const handleKebabTap = useCallback(", 600);
  assert.match(kb, /if \(!checkboxSelectOnly\) setSelectedKeys\(new Set\(\[key\]\)\);/);
});

test("the row with its menu open is highlighted; double-click on the tick or ⋮ cell does not open the record", () => {
  assert.match(src, /checkboxSelectOnly && ctxMenu\?\.row === row && "bg-\[#F0ECE9\]"/);
  assert.match(src, /onDoubleClick=\{checkboxSelectOnly \? \(e\) => e\.stopPropagation\(\) : undefined\}/);
  assert.equal((src.match(/onDoubleClick=\{checkboxSelectOnly \? \(e\) => e\.stopPropagation\(\) : undefined\}/g) ?? []).length, 2,
    "the checkbox cell and the ⋮ cell");
});

test("row menus in groups flatten through one exported helper", () => {
  const rm = read("src/components/accounting/row-menu.tsx");
  assert.match(rm, /export function rowMenuItems\(groups: RowMenuGroups\): ContextMenuItem\[\]/);
  assert.match(rm, /const items = rowMenuItems\(groups\);/);
});
