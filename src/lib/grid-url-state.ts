// ---------------------------------------------------------------------------
// grid-url-state — mirror a DataGrid's search + column text filters into the
// URL query string, so a filtered view survives a reload and can be shared.
// Owner-approved item 23 (2026-11-08). Pure + tested.
//
// Keys are namespaced by the grid's `gridId` so two grids on one page (or a
// page's own params like ?tab= / ?page=) never collide:
//
//   ?<gridId>.q=ivory+151              global search text
//   ?<gridId>.f.<columnKey>=<filter>   one per active column TEXT filter
//
// Column VALUE filters (the checkbox lists) are NOT mirrored: they are sets
// that default to "every value except the excluded ones" and can run to
// hundreds of entries, which would bloat every URL — and restoring an
// invisible value filter is exactly how a grid used to open blank (see the
// sessionStorage note in data-grid.tsx). Text filters are short and visible.
// ---------------------------------------------------------------------------

export type GridUrlState = {
  search: string;
  columnFilters: Record<string, string>;
};

export function gridSearchParam(gridId: string): string {
  return `${gridId}.q`;
}

export function gridFilterPrefix(gridId: string): string {
  return `${gridId}.f.`;
}

/** Read this grid's state from the query string; absent keys → empty. */
export function readGridUrlState(params: URLSearchParams, gridId: string): GridUrlState {
  const search = params.get(gridSearchParam(gridId)) ?? "";
  const prefix = gridFilterPrefix(gridId);
  const columnFilters: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith(prefix) && value) columnFilters[key.slice(prefix.length)] = value;
  });
  return { search, columnFilters };
}

/** True when the URL carries any state for this grid. */
export function hasGridUrlState(params: URLSearchParams, gridId: string): boolean {
  const s = readGridUrlState(params, gridId);
  return !!s.search || Object.keys(s.columnFilters).length > 0;
}

/**
 * A copy of `params` with this grid's keys replaced by `state`. Every other
 * key (the page's own ?tab=, another grid's keys) is kept as-is. Blank values
 * are removed rather than written empty.
 */
export function writeGridUrlState(params: URLSearchParams, gridId: string, state: GridUrlState): URLSearchParams {
  const next = new URLSearchParams(params);
  const qKey = gridSearchParam(gridId);
  const prefix = gridFilterPrefix(gridId);
  for (const key of Array.from(next.keys())) {
    if (key === qKey || key.startsWith(prefix)) next.delete(key);
  }
  const search = state.search.trim() ? state.search : "";
  if (search) next.set(qKey, search);
  for (const [col, val] of Object.entries(state.columnFilters).sort(([a], [b]) => a.localeCompare(b))) {
    if (val) next.set(prefix + col, val);
  }
  return next;
}

/** Same query string? (order-insensitive) — used to skip no-op navigations. */
export function sameParams(a: URLSearchParams, b: URLSearchParams): boolean {
  const norm = (p: URLSearchParams) => Array.from(p.entries()).map(([k, v]) => `${k}=${v}`).sort().join("&");
  return norm(a) === norm(b);
}
