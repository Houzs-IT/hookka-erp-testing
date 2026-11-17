// Edit forecast: copy some boxes and paste them into another month, like Excel
// (owner 2026-11-17 "i only want to copy certain cell like excel").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTsv,
  cleanPasteCell,
  extendFocus,
  inRange,
  isBlockText,
  isMultiCell,
  parsePasteBlock,
  pastedSel,
  placePaste,
  selRange,
} from "../src/lib/forecast-sheet-clipboard.ts";

test("a selection is the rectangle between where it started and where it reaches", () => {
  const r = selRange({ anchor: { row: 4, col: 3 }, focus: { row: 1, col: 0 } });
  assert.deepEqual(r, { top: 1, left: 0, bottom: 4, right: 3 });
  assert.ok(inRange(r, 2, 2));
  assert.ok(!inRange(r, 5, 2));
  assert.ok(!isMultiCell(null));
  assert.ok(!isMultiCell({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } }));
  assert.ok(isMultiCell({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 2 } }));
});

test("Shift + arrow moves the reach one step, never off the sheet", () => {
  assert.deepEqual(extendFocus({ row: 0, col: 0 }, "ArrowDown", 5, 4), { row: 1, col: 0 });
  assert.deepEqual(extendFocus({ row: 0, col: 0 }, "ArrowUp", 5, 4), { row: 0, col: 0 });
  assert.deepEqual(extendFocus({ row: 2, col: 3 }, "ArrowRight", 5, 4), { row: 2, col: 3 });
  assert.deepEqual(extendFocus({ row: 2, col: 3 }, "ArrowLeft", 5, 4), { row: 2, col: 2 });
  assert.equal(extendFocus({ row: 2, col: 3 }, "Enter", 5, 4), null);
});

test("copy: tab-separated cells, newline-separated rows, plain numbers, blank where no box", () => {
  const boxes = { "0:0": "400,000.00", "0:1": null, "1:0": "", "1:1": "12.5", "2:0": "1,250.50", "2:1": "" };
  const tsv = buildTsv({ top: 0, left: 0, bottom: 2, right: 1 }, (r, c) => boxes[`${r}:${c}`] ?? null);
  assert.equal(tsv, "400000.00\t\n\t12.5\n1250.50\t");
});

test("a single value is not a block; tabs or several lines are", () => {
  assert.ok(!isBlockText("1234"));
  assert.ok(!isBlockText("1234\n"), "Excel adds a newline after one cell");
  assert.ok(isBlockText("1\t2"));
  assert.ok(isBlockText("1\r\n2\r\n"));
});

test("pasted cells from Excel / Google Sheets are cleaned like typed figures", () => {
  assert.equal(cleanPasteCell("RM 1,234.50"), "1234.50");
  assert.equal(cleanPasteCell(" 12.5% "), "12.5");
  assert.equal(cleanPasteCell("(1,000.00)"), "-1000.00");
  assert.equal(cleanPasteCell("-250"), "-250");
  assert.equal(cleanPasteCell("rm2,000"), "2000");
  assert.equal(cleanPasteCell(""), "", "a blank clears the box");
  assert.equal(cleanPasteCell("-"), "", "a dash (zero as shown) clears the box");
  assert.equal(cleanPasteCell("Fabric"), null, "a heading is left alone");
  assert.deepEqual(parsePasteBlock("RM 1,000\t5%\r\n\t2\r\n"), [["1000", "5"], ["", "2"]]);
});

test("paste spreads down the rows and across the columns from the box, dropping what falls off", () => {
  const grid = parsePasteBlock("1\t2\t3\n4\t5\t6\n7\t8\t9");
  const w = placePaste(grid, { row: 3, col: 2 }, 5, 4);
  assert.deepEqual(w, [
    { row: 3, col: 2, value: "1" },
    { row: 3, col: 3, value: "2" },
    { row: 4, col: 2, value: "4" },
    { row: 4, col: 3, value: "5" },
  ]);
  assert.deepEqual(pastedSel(grid, { row: 3, col: 2 }, 5, 4), { anchor: { row: 3, col: 2 }, focus: { row: 4, col: 3 } });
});

test("paste: a blank clears, a heading is skipped, and a blank beside a figure of the same month does not undo it", () => {
  // RM 500 with an empty % box (one month's pair at cols 0 / 1), then a row of blanks.
  const grid = parsePasteBlock("500\t\nFabric\t\n\t");
  const w = placePaste(grid, { row: 0, col: 0 }, 10, 4);
  assert.deepEqual(w, [
    { row: 0, col: 0, value: "500" },
    { row: 1, col: 1, value: "" },
    { row: 2, col: 0, value: "" },
    { row: 2, col: 1, value: "" },
  ]);
  // Starting on a % box, the pair is that box and the next month's RM — not the same figure.
  const w2 = placePaste(parsePasteBlock("7\t"), { row: 0, col: 1 }, 1, 4);
  assert.deepEqual(w2, [{ row: 0, col: 1, value: "7" }, { row: 0, col: 2, value: "" }]);
});

test("the Edit forecast wires the clipboard: range, highlight, copy, paste, Esc", () => {
  const editor = readFileSync("src/pages/accounting/monthly-pl-forecast-editor.tsx", "utf8");
  assert.match(editor, /from "@\/lib\/forecast-sheet-clipboard"/);
  assert.match(editor, /onCopy=\{onSheetCopy\}/);
  assert.match(editor, /onPaste=\{onSheetPaste\}/);
  assert.match(editor, /buildTsv\(/);
  assert.match(editor, /placePaste\(/);
  assert.match(editor, /extendFocus\(/);
  assert.match(editor, /e\.key === "Escape"/);
  assert.match(editor, /data-fc-sel/);
  // Pasted values go through the boxes' own setters (sheet state, saved on Save).
  assert.match(editor, /boxSetters\.get\(/);
});
