// ---------------------------------------------------------------------------
// line-grid-nav — arrow keys and Enter move between the line fields of a
// document editor (SO, consignment, PO, GRN, PI), like a spreadsheet, so a
// column of quantities is typed without the mouse. Review pass 2 H1-4
// (Houzs#4491 `lineGridNav`). The movement rule is the Forecast sheet's
// (src/lib/grid-keys.ts):
//
//   Up / Down / Enter  the same field on the line above / below (lines with
//                      no such field are stepped over);
//   Left / Right       the previous / next field on the line, only once the
//                      caret is at that edge of the text.
//
// One keydown handler on the container (`data-line-grid`), so the editors
// need no per-input wiring. Lines are its `[data-line-row]` children (card
// editors) or else its `tbody > tr` rows (table editors). A field is a plain
// text / number input; dropdowns, product pickers (role=combobox), dates,
// checkboxes, textareas and anything inside `[data-no-line-nav]` keep their
// own keys. Up / Down never nudge a number box (an accidental change).
// ---------------------------------------------------------------------------
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { caretEdges, nextCell } from "./grid-keys";

const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]);
const SKIP_TYPES = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "hidden", "image",
  "date", "datetime-local", "month", "time", "week", "color", "range",
]);

type FieldLike = {
  tagName: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  getAttribute: (name: string) => string | null;
};

/** Does this element take part in line navigation? Pure. */
export function isLineGridField(el: FieldLike): boolean {
  if (el.tagName !== "INPUT") return false;
  if (SKIP_TYPES.has((el.type || "text").toLowerCase())) return false;
  if (el.disabled || el.readOnly) return false;
  // A picker uses the arrows for its own option list.
  if (el.getAttribute("role") === "combobox") return false;
  if (el.getAttribute("aria-autocomplete") || el.getAttribute("aria-expanded") !== null) return false;
  return true;
}

export type LineMove = { kind: "row"; row: number } | { kind: "col"; col: number } | null;

/** Where `key` goes from line `row` / field `col`. Pure. */
export function planLineMove(args: {
  key: string;
  caret: { atStart: boolean; atEnd: boolean };
  row: number;
  rows: number;
  col: number;
  cols: number;
}): LineMove {
  const { key, caret, row, rows, col, cols } = args;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const to = nextCell({ row: 0, col }, key, caret, 1, cols);
    return to ? { kind: "col", col: to.col } : null;
  }
  const to = nextCell({ row, col: 0 }, key, caret, rows, 1);
  return to ? { kind: "row", row: to.row } : null;
}

function fieldsOf(row: Element): HTMLInputElement[] {
  return Array.from(row.querySelectorAll("input")).filter(
    (f) => isLineGridField(f) && !f.closest("[data-no-line-nav]") && f.getClientRects().length > 0,
  );
}

function rowsOf(grid: HTMLElement): HTMLElement[] {
  const marked = Array.from(grid.querySelectorAll<HTMLElement>("[data-line-row]"));
  const rows = marked.length > 0 ? marked : Array.from(grid.querySelectorAll<HTMLElement>("tbody > tr"));
  return rows.filter((r) => fieldsOf(r).length > 0);
}

/** A field's column: its table cell, else its place among the line's fields
 *  (a `data-line-col` name wins, so differing card layouts still line up). */
function columnKey(field: HTMLInputElement, row: HTMLElement): string {
  if (field.dataset.lineCol) return `n:${field.dataset.lineCol}`;
  const td = field.closest("td");
  if (td && row.contains(td)) return `c:${(td as HTMLTableCellElement).cellIndex}`;
  return `i:${fieldsOf(row).indexOf(field)}`;
}

function fieldAt(row: HTMLElement, key: string): HTMLInputElement | null {
  return fieldsOf(row).find((f) => columnKey(f, row) === key) ?? null;
}

/** onKeyDown for a `data-line-grid` container. */
export function lineGridKeyDown(e: ReactKeyboardEvent<HTMLElement>): void {
  if (!MOVE_KEYS.has(e.key) || e.defaultPrevented) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !isLineGridField(el) || el.closest("[data-no-line-nav]")) return;
  const grid = e.currentTarget;
  const rows = rowsOf(grid);
  const rowIdx = rows.findIndex((r) => r.contains(el));
  if (rowIdx < 0) return;
  // A number box's own Up / Down would nudge the figure by a step.
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && el.type === "number") e.preventDefault();
  const caret = caretEdges(el);
  const row = rows[rowIdx];
  const fields = fieldsOf(row);

  let target: HTMLInputElement | null = null;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const move = planLineMove({ key: e.key, caret, row: 0, rows: 1, col: fields.indexOf(el), cols: fields.length });
    if (move?.kind === "col") target = fields[move.col] ?? null;
  } else {
    const key = columnKey(el, row);
    let at = rowIdx;
    for (let step = 0; step < rows.length && !target; step++) {
      const move = planLineMove({ key: e.key, caret, row: at, rows: rows.length, col: 0, cols: 1 });
      if (move?.kind !== "row") break;
      at = move.row;
      target = fieldAt(rows[at], key);
    }
  }
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.select();
}

/** Spread on the editor's container: `<tbody {...LINE_GRID_PROPS}>`. */
export const LINE_GRID_PROPS = { "data-line-grid": "", onKeyDown: lineGridKeyDown } as const;
