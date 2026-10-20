// ---------------------------------------------------------------------------
// Pure helpers behind the finance v2 table rules (owner 2026-10-16 「照 README
// 把这些设计做进现有的 Hookka repo」; docs/superpowers/plans/
// 2026-10-16-finance-v2-foundation.md, Task 1). DataGrid uses them for:
//   - dragging a header to a new place (moveColumn);
//   - the "Number Filters" tab of a column funnel — a range travels through the
//     grid's existing text-filter slot as "range:<lo>..<hi>" in the column's
//     raw units (a currency column's sen);
//   - the sticky total row (columnTotals);
//   - the header right-click menu (headerMenuItems — the design's exact list);
//   - which saved layout wins on load (pickLayoutSource).
// No React here, so tests import it directly.
// ---------------------------------------------------------------------------

/** `order` with `from` moved to sit just before `to`. Unknown keys or the same
 *  key → an unchanged copy. */
export function moveColumn(order: string[], from: string, to: string): string[] {
  if (from === to || !order.includes(from) || !order.includes(to)) return [...order];
  const rest = order.filter((k) => k !== from);
  rest.splice(rest.indexOf(to), 0, from);
  return rest;
}

/** The text-filter mode a range filter is stored under. */
export const RANGE_MODE = "range";

/** "<lo>..<hi>", a blank side meaning open-ended; "" when both are blank. */
export function rangeTerm(lo: number | null, hi: number | null): string {
  if (lo == null && hi == null) return "";
  return `${lo ?? ""}..${hi ?? ""}`;
}

export type NumRange = { lo: number | null; hi: number | null };

/** Reads a "range:<lo>..<hi>" column filter; null for any other filter. */
export function decodeRange(filter: string): NumRange | null {
  const prefix = `${RANGE_MODE}:`;
  if (!filter.startsWith(prefix)) return null;
  const body = filter.slice(prefix.length);
  const at = body.indexOf("..");
  if (at < 0) return null;
  const side = (s: string): number | null => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  return { lo: side(body.slice(0, at)), hi: side(body.slice(at + 2)) };
}

/** Bounds included. A blank or non-numeric value is never in range. */
export function inRange(value: unknown, r: NumRange): boolean {
  if (value == null || value === "") return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (r.lo != null && n < r.lo) return false;
  if (r.hi != null && n > r.hi) return false;
  return true;
}

/** A typed amount: "1,234.50" → 1234.5, "(500)" → -500 (ledger brackets),
 *  blank or not a number → null. */
export function parseAmount(text: string): number | null {
  let s = text.replace(/[\s,]/g, "");
  if (s === "") return null;
  let sign = 1;
  const br = /^\((.*)\)$/.exec(s);
  if (br) {
    s = br[1];
    sign = -1;
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s) * sign;
  return Number.isFinite(n) ? n : null;
}

/** Totals for the columns that ask for one: "sum" adds the column's finite
 *  values (whole sen stay whole); a function gets every row it is shown. */
export function columnTotals<T>(
  rows: T[],
  cols: { key: string; total?: "sum" | ((rows: T[]) => number) }[],
  get: (row: T, key: string) => unknown,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const col of cols) {
    if (!col.total) continue;
    if (typeof col.total === "function") {
      out[col.key] = col.total(rows);
      continue;
    }
    let sum = 0;
    for (const row of rows) {
      const n = Number(get(row, col.key));
      if (Number.isFinite(n)) sum += n;
    }
    out[col.key] = sum;
  }
  return out;
}

/** The header right-click menu, in the design's order ("-" = a separator).
 *  `grouped` (a grid that can group its rows): "this" = grouped by this
 *  column, "other" = by another one, "none" = not grouped. */
export function headerMenuItems(o: {
  sorted: "asc" | "desc" | null;
  filterable: boolean;
  anyFilter: boolean;
  grouped?: "this" | "other" | "none";
}): string[] {
  const groups: string[][] = [
    ["Sort Ascending", "Sort Descending", ...(o.sorted ? ["Clear Sorting"] : [])],
    ...(o.grouped ? [["Group By This Column", ...(o.grouped !== "none" ? ["Clear Grouping"] : [])]] : []),
    [...(o.filterable ? ["Filter This Column…"] : []), ...(o.anyFilter ? ["Clear All Filters"] : [])],
    ["Hide This Column", "Column Chooser…", "Best Fit", "Best Fit (All Columns)"],
    ["Save Layout", "Reset Layout"],
    ["Export to Excel", "Export to PDF", "Print"],
  ];
  return groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? g : ["-", ...g]));
}

/** Which layout to load: the user's saved default from the server, or this
 *  browser's own — whichever was saved later (a tie keeps this browser's). */
export function pickLayoutSource(
  localSavedAt: string | null,
  serverUpdatedAt: string | null,
): "local" | "server" | "none" {
  const local = localSavedAt ? Date.parse(localSavedAt) : NaN;
  const server = serverUpdatedAt ? Date.parse(serverUpdatedAt) : NaN;
  const hasLocal = Number.isFinite(local);
  const hasServer = Number.isFinite(server);
  if (!hasLocal && !hasServer) return "none";
  if (!hasLocal) return "server";
  if (!hasServer) return "local";
  return server > local ? "server" : "local";
}
