// ---------------------------------------------------------------------------
// BUG-2026-10-17-314 — the P&L, Monthly P&L and Cash Flow drew an empty 10px
// strip between sections (a spacer row), which read as a hole in the table
// under NET SALES (owner's screenshot, 2026-10-17). The design separates
// groups with a line, not an empty row: the gap row stays in the DOM as a
// marker, is hidden, and the row after it carries the strong line.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("the three reports mark a gap row instead of drawing a 10px strip", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const gaps = ui.match(/kind === "gap"\) return <tr [^\n]*\n/g) ?? [];
  assert.equal(gaps.length, 3, "P&L statement, Monthly P&L, Cash Flow");
  for (const g of gaps) {
    assert.match(g, /aria-hidden="true" data-row="gap"><td colSpan=\{[^}]+\} \/><\/tr>;/);
    assert.doesNotMatch(g, /height/);
  }
  assert.doesNotMatch(ui, /height: 10, border: 0/);
});

test("the stylesheet hides the marker and draws the strong line on the next row", () => {
  const css = read("src/styles/finance-v2.css");
  assert.match(css, /\[data-fin-ui\] table\[data-fin-report\] > tbody > tr\[data-row="gap"\] \{\n\s*display: none;\n\}/);
  assert.match(css, /\[data-fin-ui\] table\[data-fin-report\] > tbody > tr\[data-row="gap"\] \+ tr > td \{\n\s*border-top: 1\.5px solid #7A6E5E;\n\}/);
});
