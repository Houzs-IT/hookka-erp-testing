// ---------------------------------------------------------------------------
// grid-return — pressing Back from a record returns the list to the row you
// opened, scrolled into view and briefly marked, instead of the top. Review
// pass 2 C1-8 (Conts#406 / #205); extends the URL-kept filters / sort of
// grid-url-state (#1251), which bring the same rows back but not the place.
//
// The DataGrid remembers the last row clicked or double-clicked, per page path
// and grid, in sessionStorage (this tab only; survives a reload). When the grid
// mounts on a Back / Forward (history POP) it looks the row up once the data is
// there and scrolls to it. A row that is gone (filtered out, deleted) is
// simply not found — the list opens as before.
// ---------------------------------------------------------------------------

type ReadStore = Pick<Storage, "getItem"> | null | undefined;
type WriteStore = Pick<Storage, "setItem"> | null | undefined;

export function gridReturnKey(pathname: string, gridId: string | undefined): string {
  return `hookka-grid-return:${pathname}|${gridId ?? ""}`;
}

/** Remember the row just opened. Storage may be blocked — never throws. */
export function rememberGridRow(store: WriteStore, key: string, rowKey: string): void {
  if (!store || !rowKey) return;
  try {
    store.setItem(key, rowKey);
  } catch {
    /* private mode / quota — the list just opens at the top */
  }
}

/** The row to return to, or null. Never throws. */
export function recallGridRow(store: ReadStore, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key) || null;
  } catch {
    return null;
  }
}

/** Only a Back / Forward returns to the row; a fresh visit opens at the top. */
export function shouldReturnToRow(navigationType: string): boolean {
  return navigationType === "POP";
}

/** Safe for a CSS attribute selector. */
export function rowKeySelector(rowKey: string): string {
  return `tr[data-row-key="${rowKey.replace(/["\\]/g, "\\$&")}"]`;
}
