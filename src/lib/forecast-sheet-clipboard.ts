// ---------------------------------------------------------------------------
// forecast-sheet-clipboard — copy and paste a block of the Edit forecast's
// boxes like Excel (owner 2026-11-17 "i only want to copy certain cell like
// excel"). Pure logic only; the editor (src/pages/accounting/
// monthly-pl-forecast-editor.tsx) reads and writes the boxes.
//
// The sheet's grid: a row is a table row that has keyed boxes (rows with none —
// totals, computed lines — are not in it, so a paste skips them); a column is
// the box's `data-fc-col`: 2 × the month column's place for the RM box, + 1 for
// the % box. A place with no box (Sales has no % box, a month not on the sheet)
// copies as blank and takes nothing on paste.
// ---------------------------------------------------------------------------

export type GridPos = { row: number; col: number };
/** A selection: where it started (stays put) and where it reaches. */
export type GridSel = { anchor: GridPos; focus: GridPos };
export type GridRange = { top: number; left: number; bottom: number; right: number };
/** One box to set: `value` "" clears it. */
export type PasteWrite = { row: number; col: number; value: string };

export function selRange(sel: GridSel): GridRange {
  const { anchor: a, focus: f } = sel;
  return { top: Math.min(a.row, f.row), left: Math.min(a.col, f.col), bottom: Math.max(a.row, f.row), right: Math.max(a.col, f.col) };
}

export function inRange(r: GridRange, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
}

/** More than one box selected (a single box copies and pastes as the browser does). */
export function isMultiCell(sel: GridSel | null): sel is GridSel {
  return !!sel && (sel.anchor.row !== sel.focus.row || sel.anchor.col !== sel.focus.col);
}

/** Shift + an arrow: the selection's reach one step on, kept on the sheet. */
export function extendFocus(focus: GridPos, key: string, rows: number, cols: number): GridPos | null {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max - 1, n));
  switch (key) {
    case "ArrowUp": return { row: clamp(focus.row - 1, rows), col: focus.col };
    case "ArrowDown": return { row: clamp(focus.row + 1, rows), col: focus.col };
    case "ArrowLeft": return { row: focus.row, col: clamp(focus.col - 1, cols) };
    case "ArrowRight": return { row: focus.row, col: clamp(focus.col + 1, cols) };
    default: return null;
  }
}

/** A box's figure as copied: the plain number, no grouping commas, no % sign. */
export function copyCellText(v: string | null | undefined): string {
  return (v ?? "").replace(/,/g, "").replace(/%/g, "").trim();
}

/** The selection as tab-separated cells and newline-separated rows. `read`
 *  gives a box's shown value, or null where there is no box. */
export function buildTsv(r: GridRange, read: (row: number, col: number) => string | null): string {
  const lines: string[] = [];
  for (let row = r.top; row <= r.bottom; row++) {
    const cells: string[] = [];
    for (let col = r.left; col <= r.right; col++) cells.push(copyCellText(read(row, col)));
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** Clipboard text that is a block (more than one cell), not a single value. */
export function isBlockText(text: string): boolean {
  const t = text.replace(/(\r?\n)+$/, "");
  return /[\t\r\n]/.test(t);
}

const NUM = /^-?(\d+\.?\d*|\.\d+)$/;
/** One pasted cell, cleaned the way a figure from Excel / Google Sheets needs:
 *  "RM 1,234.50" → "1234.50", "12.5%" → "12.5", "(1,000)" → "-1000".
 *  "" (or a lone dash) clears the box; null = not a figure (a heading cell), left alone. */
export function cleanPasteCell(raw: string): string | null {
  let s = raw.replace(/\u00a0/g, " ").trim();
  if (s === "" || s === "-" || s === "—" || s === "–") return "";
  s = s.replace(/RM/gi, "").replace(/[,\s%]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (!NUM.test(s)) return null;
  if (neg) s = s.startsWith("-") ? s.slice(1) : `-${s}`;
  return s;
}

/** The clipboard block as rows of cleaned cells (one trailing newline ignored). */
export function parsePasteBlock(text: string): (string | null)[][] {
  const t = text.replace(/(\r?\n)+$/, "");
  return t.split(/\r?\n/).map((line) => line.split("\t").map(cleanPasteCell));
}

/** Where each pasted cell goes, from `start` down the sheet's rows and across its
 *  columns; cells past the sheet's edge, and non-figures, are dropped. A box's
 *  RM and % are one figure (keying one clears the other), so a blank pasted
 *  beside a figure for the same month does not clear it again. */
export function placePaste(grid: (string | null)[][], start: GridPos, rows: number, cols: number): PasteWrite[] {
  const out: PasteWrite[] = [];
  grid.forEach((line, i) =>
    line.forEach((value, j) => {
      const row = start.row + i;
      const col = start.col + j;
      if (value === null || row >= rows || col >= cols) return;
      out.push({ row, col, value });
    }),
  );
  const keyed = new Set(out.filter((w) => w.value !== "").map((w) => `${w.row}:${w.col >> 1}`));
  return out.filter((w) => w.value !== "" || !keyed.has(`${w.row}:${w.col >> 1}`));
}

/** The block the paste covered on the sheet, to show it selected. */
export function pastedSel(grid: (string | null)[][], start: GridPos, rows: number, cols: number): GridSel {
  const width = Math.max(1, ...grid.map((l) => l.length));
  return {
    anchor: start,
    focus: { row: Math.min(rows - 1, start.row + grid.length - 1), col: Math.min(cols - 1, start.col + width - 1) },
  };
}
