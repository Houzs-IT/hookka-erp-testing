// ---------------------------------------------------------------------------
// grid-keys — keyboard movement between a sheet's input cells (finance v2,
// Forecast P&L: "arrow keys and Enter move between cells").
//
// Up / Down / Enter always move: a number box's own Up / Down would otherwise
// nudge the figure by one step, a change nobody meant. Left / Right move only
// when the caret is already at that edge of the text, so the caret still walks
// inside a figure being edited. A box that cannot report its caret (a number
// input) counts as at both edges.
// ---------------------------------------------------------------------------

export type CellPos = { row: number; col: number };

/** The neighbouring cell for `key`, or null when the key does not move or the
 *  move would leave the sheet. */
export function nextCell(
  pos: CellPos,
  key: string,
  caret: { atStart: boolean; atEnd: boolean },
  rows: number,
  cols: number,
): CellPos | null {
  switch (key) {
    case "ArrowUp":
      return pos.row > 0 ? { row: pos.row - 1, col: pos.col } : null;
    case "ArrowDown":
    case "Enter":
      return pos.row < rows - 1 ? { row: pos.row + 1, col: pos.col } : null;
    case "ArrowLeft":
      return caret.atStart && pos.col > 0 ? { row: pos.row, col: pos.col - 1 } : null;
    case "ArrowRight":
      return caret.atEnd && pos.col < cols - 1 ? { row: pos.row, col: pos.col + 1 } : null;
    default:
      return null;
  }
}

/** Where the caret sits in a box. A box without a caret position (a number
 *  input reports null) or with its whole figure selected counts as at both edges. */
export function caretEdges(el: { value: string; selectionStart: number | null; selectionEnd: number | null }): {
  atStart: boolean;
  atEnd: boolean;
} {
  if (el.selectionStart === null || el.selectionEnd === null) return { atStart: true, atEnd: true };
  // A box just stepped into has its whole figure selected: either way leaves.
  const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
  return { atStart: all || el.selectionEnd === 0, atEnd: all || el.selectionStart === el.value.length };
}
