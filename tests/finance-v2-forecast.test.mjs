// ---------------------------------------------------------------------------
// finance-v2-forecast.test.mjs — the Forecast P&L's editing comfort (plan
// 2026-10-17-finance-v2-forecasting Task 2). Same reads and save payload; a
// removed month still goes only on Save; keying one side still clears the
// other. New: picking a month adds it, the ✕ asks first, arrow keys / Enter
// move between the keyed boxes, an unsaved-changes banner and leave guard,
// warm keyed boxes.
// Since 2026-11-11 the Forecast P&L page is the Monthly P&L's Edit forecast
// (owner 「两边都应该是一样的view」, tests/forecast-page-same-view.test.mjs):
// all of this lives in the one editor both pages show.
// Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { nextCell, caretEdges } from "../src/lib/grid-keys.ts";
import { forecastSnapshot } from "../src/lib/forecast-snapshot.ts";

const src = readFileSync("src/pages/accounting/monthly-pl-forecast-editor.tsx", "utf8").replace(/\r\n/g, "\n");

test("keys: Up / Down / Enter move a row; Left / Right only from the edge of the text", () => {
  const at = { row: 1, col: 1 };
  const edges = { atStart: true, atEnd: true };
  assert.deepEqual(nextCell(at, "ArrowUp", edges, 3, 4), { row: 0, col: 1 });
  assert.deepEqual(nextCell(at, "ArrowDown", edges, 3, 4), { row: 2, col: 1 });
  assert.deepEqual(nextCell(at, "Enter", edges, 3, 4), { row: 2, col: 1 });
  assert.deepEqual(nextCell(at, "ArrowLeft", edges, 3, 4), { row: 1, col: 0 });
  assert.deepEqual(nextCell(at, "ArrowRight", edges, 3, 4), { row: 1, col: 2 });
  assert.equal(nextCell(at, "ArrowLeft", { atStart: false, atEnd: true }, 3, 4), null, "the caret walks inside the figure");
  assert.equal(nextCell(at, "ArrowRight", { atStart: true, atEnd: false }, 3, 4), null);
  assert.equal(nextCell({ row: 0, col: 0 }, "ArrowUp", edges, 3, 4), null, "never off the sheet");
  assert.equal(nextCell({ row: 2, col: 3 }, "ArrowRight", edges, 3, 4), null);
  assert.equal(nextCell(at, "Tab", edges, 3, 4), null, "Tab keeps its own job");
});

test("keys: a box that cannot report its caret counts as at both edges", () => {
  assert.deepEqual(caretEdges({ value: "12.5", selectionStart: null, selectionEnd: null }), { atStart: true, atEnd: true });
  assert.deepEqual(caretEdges({ value: "12.5", selectionStart: 0, selectionEnd: 0 }), { atStart: true, atEnd: false });
  assert.deepEqual(caretEdges({ value: "12.5", selectionStart: 4, selectionEnd: 4 }), { atStart: false, atEnd: true });
  assert.deepEqual(caretEdges({ value: "12.5", selectionStart: 0, selectionEnd: 4 }), { atStart: true, atEnd: true }, "a box just stepped into (all selected) leaves either way");
  assert.deepEqual(caretEdges({ value: "12.5", selectionStart: 2, selectionEnd: 2 }), { atStart: false, atEnd: false }, "mid-figure: the caret walks");
});

test("snapshot: clearing a figure again, or adding then removing a month, is not a change", () => {
  const base = { "2026-05": { salesStr: "50000", pct: { "600-0001": { p: "10" } } } };
  const snap = forecastSnapshot(base);
  assert.equal(forecastSnapshot({ "2026-05": { salesStr: "50000", pct: { "600-0001": { p: "10" }, "600-0002": {} } } }), snap, "a cleared cell");
  assert.equal(forecastSnapshot({ "2026-05": { salesStr: " 50000 ", pct: { "600-0001": { p: "10" } } } }), snap, "stray spaces in sales");
  const added = { ...base, "2026-06": { salesStr: "", pct: { "600-0001": { p: "10" } } } };
  assert.notEqual(forecastSnapshot(added), snap, "a new month with inherited % is a change");
  const removedAgain = { ...added };
  delete removedAgain["2026-06"];
  assert.equal(forecastSnapshot(removedAgain), snap);
  // The side Save keeps wins: an amount over a %.
  assert.notEqual(forecastSnapshot({ "2026-05": { salesStr: "50000", pct: { "600-0001": { a: "5000" } } } }), snap);
});

test("the month control: picking a month adds it; the × asks first and still waits for Save", () => {
  assert.match(src, /aria-label="Add month"/);
  assert.match(src, /onChange=\{\(e\) => \{ const ym = e\.target\.value; if \(ym\) setSheet\(\(prev\) => \(prev\[ym\] \? prev : \{ \.\.\.prev, \[ym\]: newSheetMonth\(prev, ym\) \}\)\); \}\}/);
  // Since 2026-11-10 the rule lives in src/lib/forecast-sheet.ts (newSheetMonth), shared by both pages.
  assert.match(readFileSync("src/lib/forecast-sheet.ts", "utf8").replace(/\r\n/g, "\n"), /const prevYm = \[\.\.\.yms\]\.filter\(\(k\) => k < ym\)\.pop\(\) \?\? \[\.\.\.yms\]\.pop\(\);/, "a new month starts from the month before it");
  assert.doesNotMatch(src, /type="month"/);
  assert.match(src, /if \(!\(await confirm\(\{ title: "Remove month\?", message: `Remove \$\{labelOfYm\(ym\)\}'s forecast\? It goes when you Save\.`, danger: true \}\)\)\) return;/);
  assert.match(src, /onClick=\{\(\) => void removeMonth\(ym\)\}/);
});

test("unsaved changes: a banner and a leave guard against the last loaded or saved sheet", () => {
  assert.match(src, /setSheet\(next\);\n\s*setSavedSnap\(forecastSnapshot\(next\)\);/, "the loaded sheet is the baseline");
  const ok = src.slice(src.indexOf("if (res.ok && j?.success) {"), src.indexOf("} else toast.error", src.indexOf("if (res.ok && j?.success) {")));
  assert.match(ok, /toast\.success\("Forecast saved"\);\n\s*setSavedSnap\(snap\);/, "a save is the new baseline");
  assert.match(ok, /invalidateCachePrefix\("\/api\/accounting\/cashflow-forecast"\)/);
  assert.match(src, /const dirty = savedSnap !== null && snap !== savedSnap;/);
  assert.match(src, /useNavGuard\(dirty, "You have unsaved forecast changes\. Leave without saving\?"\);/);
  assert.match(src, /\{dirty && \(\n\s*<div data-fin-banner="todo"/);
  // The save payload itself is unchanged.
  assert.match(src, /body: JSON\.stringify\(\{ months: payload \}\),/);
});

test("keyed boxes carry their column and the key handler; Up / Down never nudge a number", () => {
  assert.match(src, /if \(e\.key === "ArrowUp" \|\| e\.key === "ArrowDown"\) e\.preventDefault\(\);/);
  assert.equal((src.match(/onKeyDown=\{onCellKey\}/g) ?? []).length, 4, "a line's RM and % boxes (a supplier's too), the sales box, a customer's sales box");
  assert.match(src, /col=\{colOf\(c\)\}/);
  assert.match(src, /col=\{colOf\(c\) \+ 1\}/);
  assert.equal((src.match(/data-fc-col=\{col\}/g) ?? []).length, 2, "the RM box and the % box forward their column");
});

test("calm cells: the keyed boxes are warm", () => {
  assert.match(src, /const BOX = "inline-flex items-center rounded border border-\[#E2DDD8\] bg-\[#FFFBF2\] px-1";/);
  assert.equal((src.match(/className=\{`\$\{BOX\} w-/g) ?? []).length, 2, "the RM box and the % box");
});
