// ---------------------------------------------------------------------------
// datagrid-user-default.test.mjs — dragging headers to reorder and "Save
// Layout" as the user's own default on the server (finance v2 "PV table" rule:
// drag headers to reorder; Columns picker with Set as default, which persists
// widths, order and visibility; plan 2026-10-16-finance-v2-foundation Task 6).
// Precedence on load: the saved default wins only when it is newer than this
// browser's own last change (pickLayoutSource), so a fresh PC gets the saved
// layout and a newer local tweak is never overwritten by an older save.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = readFileSync("src/components/ui/data-grid.tsx", "utf8").replace(/\r\n/g, "\n");
const slice = (marker, len = 1500) => {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `missing: ${marker}`);
  return src.slice(at, at + len);
};

test("only a grid that asks lets headers be dragged; a drop moves the column and persists", () => {
  assert.match(src, /reorderableHeaders\?: boolean;/);
  assert.match(src, /draggable=\{reorderableHeaders \|\| undefined\}/);
  const drop = slice("const dropHeader = ");
  assert.match(drop, /reorderColumns\(moveColumn\(effective, dragKey, key\)\)/, "the existing order setter, which saves");
  assert.match(src, /onDragStart=\{reorderableHeaders \? \(e\) => startHeaderDrag\(e, col\.key\) : undefined\}/);
  assert.match(src, /onDrop=\{reorderableHeaders \? \(e\) => \{ e\.preventDefault\(\); dropHeader\(col\.key\); \} : undefined\}/);
  assert.match(src, /dropKey === col\.key && "shadow-\[inset_2px_0_0_#6B5C32\]"/, "the drop target shows a 2px accent line");
});

test("every hand-made layout change stamps the time on this browser", () => {
  assert.match(src, /const markLocalLayout = useCallback\(\(\) => \{/);
  assert.match(src, /localStorage\.setItem\(`datagrid-layout-ts-\$\{gridId\}-\$\{userKey\(\)\}`, new Date\(\)\.toISOString\(\)\)/);
  for (const fn of ["const persistColWidths = useCallback(", "const toggleColumn = useCallback(", "const reorderColumns = useCallback("]) {
    assert.match(slice(fn, 700), /markLocalLayout\(\);/, `${fn} stamps the time`);
  }
});

test("Save Layout stores the user's own default on the server", () => {
  const save = slice("const saveUserDefault = async () => {");
  assert.match(save, /await putOrgLayout\(gridId, "user", \[\.\.\.visibleKeys\], columnOrder, colWidths\)/);
  assert.match(save, /markLocalLayout\(\);\s*toast\.success\("Layout saved as your default"\);/);
  assert.match(save, /toast\.error\("Could not save the layout"\)/);
  assert.match(src, /"Save Layout": \(\) => \{ void saveUserDefault\(\); \}/);
  assert.match(src, /kind: "org-default" \| "print" \| "user"/, "the save helpers accept the user kind");
});

test("on load the saved default applies only when it is newer; Reset Layout clears it", () => {
  const hyd = slice("if (remote.mine) {", 1400);
  assert.match(hyd, /pickLayoutSource\(localTs, remote\.mine\.updatedAt\) === "server"/);
  assert.match(hyd, /setVisibleKeys\(new Set\(remote\.mine\.visibleCols\)\);/);
  assert.match(hyd, /setColumnOrder\(remote\.mine\.colOrder\);/);
  assert.match(hyd, /setColWidths\(remote\.mine\.colWidths \?\? \{\}\);/);
  assert.match(src, /mine\?: \(ServerLayoutPreset & \{ updatedAt: string \| null \}\) \| null;/);
  const reset = slice('"Reset Layout": () => {', 400);
  assert.match(reset, /void deleteOrgLayout\(gridId, "user"\)/);
});
