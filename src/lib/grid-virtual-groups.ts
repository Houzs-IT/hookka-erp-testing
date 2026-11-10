// ---------------------------------------------------------------------------
// grid-virtual-groups.ts — pure helpers behind two DataGrid speed-ups from the
// 2026-11-10 cross-system review. Display only: neither changes which rows,
// groups, subtotals or cell values the grid shows, only how many DOM nodes it
// paints at once and how often.
//
// G8 (Houzs#4912) — a grouped list keeps virtual scrolling. Windowing used to
//   switch OFF the moment a grid was grouped (`virtualizationActive =
//   virtualize && !groupOn`), so expanding the groups of a long list painted
//   every row again. The grouped body is now flattened into ONE list of group
//   headers, data rows and subtotal rows, in exactly the order the old
//   render-everything path emitted them, and the virtualizer windows that.
//   Folded groups contribute only their header (and subtotal), as before.
//
// G9 (Houzs#4823) — rows that did not change are not re-drawn. The cells of a
//   row are a memoised component; `rowRangeCols` gives each row the slice of
//   the copy/range-sum rectangle that touches it as two numbers, so a row
//   outside the rectangle keeps identical props while the range moves.
// ---------------------------------------------------------------------------
import type { CellRect } from "./grid-clipboard";

export type FlatGroupItem =
  | { kind: "group"; key: string }
  | { kind: "row"; index: number }
  | { kind: "sub"; key: string };

/**
 * The grouped body as one flat list. `rows` arrive already sorted so each
 * group's rows are contiguous (sortRows puts the group key first). A group
 * header precedes its first row; a folded group keeps its header but not its
 * rows; with `withSubtotals` each group ends with a subtotal item (shown even
 * when folded, as the grid always did).
 */
export function flattenGroupedRows<T>(
  rows: readonly T[],
  groupOf: (row: T) => string,
  folded: ReadonlySet<string>,
  withSubtotals: boolean,
): FlatGroupItem[] {
  const out: FlatGroupItem[] = [];
  let open: string | null = null;
  rows.forEach((row, index) => {
    const key = groupOf(row);
    if (key !== open) {
      if (open !== null && withSubtotals) out.push({ kind: "sub", key: open });
      open = key;
      out.push({ kind: "group", key });
    }
    if (!folded.has(key)) out.push({ kind: "row", index });
  });
  if (open !== null && withSubtotals) out.push({ kind: "sub", key: open });
  return out;
}

/**
 * Painted height of a group header row while the grouped body is windowed.
 * The header cell is pinned to this height (its natural height is ~28.5 px:
 * 11 px text + py-1.5), so the virtualizer's arithmetic is exact.
 */
export const GROUP_ROW_PX = 30;

export function flatItemHeight(item: FlatGroupItem, rowPx: number, groupPx = GROUP_ROW_PX): number {
  return item.kind === "group" ? groupPx : rowPx;
}

/** Sum of the item heights — the body's full scroll height, same pass. */
export function flatTotalHeight(items: readonly FlatGroupItem[], rowPx: number, groupPx = GROUP_ROW_PX): number {
  let h = 0;
  for (const it of items) h += flatItemHeight(it, rowPx, groupPx);
  return h;
}

/**
 * The columns of the copy / range-sum rectangle that fall on row `index`, as
 * [first, last]; [-1, -1] when the row is outside it (or no range shows).
 */
export function rowRangeCols(rect: CellRect | null, show: boolean, index: number): [number, number] {
  if (!show || !rect || index < rect.r0 || index > rect.r1) return [-1, -1];
  return [rect.c0, rect.c1];
}
