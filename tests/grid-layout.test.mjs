// ---------------------------------------------------------------------------
// grid-layout.test.mjs — pure helpers behind the finance v2 table rules
// (docs/superpowers/plans/2026-10-16-finance-v2-foundation.md, Task 1):
// column order, the number range filter, totals, the header menu, and which
// saved layout wins. Made-up numbers only (the repo is public).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import {
  moveColumn, RANGE_MODE, rangeTerm, decodeRange, inRange, parseAmount,
  columnTotals, headerMenuItems, pickLayoutSource,
} from "../src/lib/grid-layout.ts";

test("a dragged column lands just before the one it was dropped on", () => {
  assert.deepEqual(moveColumn(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveColumn(["a", "b", "c", "d"], "a", "d"), ["b", "c", "a", "d"]);
  assert.deepEqual(moveColumn(["a", "b"], "a", "a"), ["a", "b"]);
  const order = ["a", "b"];
  const same = moveColumn(order, "x", "a");
  assert.deepEqual(same, ["a", "b"], "an unknown key changes nothing");
  assert.notEqual(same, order, "always a new array");
});

test("a number range travels as range:<lo>..<hi>, either side optional", () => {
  assert.equal(RANGE_MODE, "range");
  assert.equal(rangeTerm(100, null), "100..");
  assert.equal(rangeTerm(null, 250), "..250");
  assert.equal(rangeTerm(100, 250), "100..250");
  assert.equal(rangeTerm(null, null), "");
  assert.deepEqual(decodeRange("range:100..250"), { lo: 100, hi: 250 });
  assert.deepEqual(decodeRange("range:..250"), { lo: null, hi: 250 });
  assert.deepEqual(decodeRange("range:-500..0"), { lo: -500, hi: 0 });
  assert.equal(decodeRange("equals:x"), null);
  assert.equal(decodeRange("100..250"), null, "only a range-mode filter decodes");
});

test("a value is in range with both bounds included; text never is", () => {
  const r = { lo: 100, hi: 250 };
  assert.equal(inRange(150, r), true);
  assert.equal(inRange(100, r), true);
  assert.equal(inRange(250, r), true);
  assert.equal(inRange(251, r), false);
  assert.equal(inRange("150", r), true);
  assert.equal(inRange("x", r), false);
  assert.equal(inRange(null, r), false);
  assert.equal(inRange(-5, { lo: null, hi: 0 }), true);
});

test("typed amounts: commas, brackets for negatives, blanks and text", () => {
  assert.equal(parseAmount("1,234.50"), 1234.5);
  assert.equal(parseAmount(" 2 500 "), 2500);
  assert.equal(parseAmount("(500)"), -500);
  assert.equal(parseAmount("(1,000.25)"), -1000.25);
  assert.equal(parseAmount("-12"), -12);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("  "), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount("12abc"), null);
});

test("totals add whole sen and only for columns that ask", () => {
  const rows = [{ a: 12345, b: "x" }, { a: 1, b: "y" }, { a: 99, b: "z" }, { a: "n/a", b: "w" }];
  const seen = [];
  const t = columnTotals(rows, [
    { key: "a", total: "sum" },
    { key: "c", total: (rs) => { seen.push(rs.length); return 7; } },
    { key: "b" },
  ], (row, key) => row[key]);
  assert.equal(t.a, 12445);
  assert.ok(Number.isInteger(t.a), "sen stay whole");
  assert.equal(t.c, 7);
  assert.deepEqual(seen, [4], "a function total receives the rows");
  assert.equal("b" in t, false);
});

test("the header menu lists the v2 items in order, dropping what does not apply", () => {
  const base = ["Sort Ascending", "Sort Descending", "-", "Filter This Column…", "-",
    "Hide This Column", "Column Chooser…", "Best Fit", "Best Fit (All Columns)", "-",
    "Save Layout", "Reset Layout", "-", "Export to Excel", "Export to PDF", "Print"];
  assert.deepEqual(headerMenuItems({ sorted: null, filterable: true, anyFilter: false }), base);
  assert.deepEqual(headerMenuItems({ sorted: "asc", filterable: true, anyFilter: true }), [
    "Sort Ascending", "Sort Descending", "Clear Sorting", "-", "Filter This Column…", "Clear All Filters", "-",
    "Hide This Column", "Column Chooser…", "Best Fit", "Best Fit (All Columns)", "-",
    "Save Layout", "Reset Layout", "-", "Export to Excel", "Export to PDF", "Print"]);
  assert.deepEqual(headerMenuItems({ sorted: "desc", filterable: false, anyFilter: false }), [
    "Sort Ascending", "Sort Descending", "Clear Sorting", "-",
    "Hide This Column", "Column Chooser…", "Best Fit", "Best Fit (All Columns)", "-",
    "Save Layout", "Reset Layout", "-", "Export to Excel", "Export to PDF", "Print"]);
  assert.deepEqual(headerMenuItems({ sorted: null, filterable: false, anyFilter: true }).slice(2, 5),
    ["-", "Clear All Filters", "-"], "clearing stays possible on a column that cannot filter");
});

test("a grid that groups adds Group By This Column after sorting; Clear Grouping while grouped", () => {
  const head = (grouped) => headerMenuItems({ sorted: null, filterable: true, anyFilter: false, grouped }).slice(0, 7);
  assert.deepEqual(head("none"), ["Sort Ascending", "Sort Descending", "-", "Group By This Column", "-", "Filter This Column…", "-"]);
  assert.deepEqual(head("this"), ["Sort Ascending", "Sort Descending", "-", "Group By This Column", "Clear Grouping", "-", "Filter This Column…"]);
  assert.deepEqual(head("other"), head("this"), "grouped by another column: this one can take over, or clear");
  assert.equal(headerMenuItems({ sorted: null, filterable: true, anyFilter: false }).includes("Group By This Column"), false,
    "a grid that does not pass `grouped` keeps the menu it had");
});

test("a saved layout wins only when it is newer than this browser's own", () => {
  assert.equal(pickLayoutSource(null, "2026-10-16T08:00:00Z"), "server");
  assert.equal(pickLayoutSource("2026-10-16T07:00:00Z", "2026-10-16T08:00:00Z"), "server");
  assert.equal(pickLayoutSource("2026-10-16T09:00:00Z", "2026-10-16T08:00:00Z"), "local");
  assert.equal(pickLayoutSource("2026-10-16T08:00:00Z", "2026-10-16T08:00:00Z"), "local");
  assert.equal(pickLayoutSource("2026-10-16T08:00:00Z", null), "local");
  assert.equal(pickLayoutSource(null, null), "none");
});
