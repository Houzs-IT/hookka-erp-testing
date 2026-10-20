// ---------------------------------------------------------------------------
// grid-group — "Group By This Column" on the shared DataGrid (the finance v2
// design's header right-click menu; owner 2026-10-20 「可以」).
//
// A row is grouped under what its column shows: the day for a date (so the
// groups read in date order), the number for money or a count, else the text
// the column exports (its exportValue / filterAccessor / raw value — the same
// value its funnel and its export use). Each group's rows keep their own order
// (the user's sort). The Listing export of a grouped grid carries each group's
// subtotal row after its rows, as the design's export does.
//
// Pure, no React, so tests import it directly.
// ---------------------------------------------------------------------------

import type { Aoa } from "./export-report";
import { cellExportValue, type ExportColumn } from "./grid-export";

/** The group of the rows whose column is empty. */
export const BLANK_GROUP = "(blank)";

// One collator for every comparison (a sort runs this n·log n times; a fresh
// localeCompare with options resolves a collator per call — the DataGrid's
// own comparator does the same, tests/data-grid-collator.test.mjs).
const COLLATOR = new Intl.Collator(undefined, { numeric: true });

/** What a row is grouped under when the user groups by `col`. */
export function columnGroupValue<T>(col: ExportColumn<T>, row: T): string | number {
  const v = cellExportValue(col, row);
  if (typeof v === "number") return Number.isFinite(v) ? v : BLANK_GROUP;
  const s = v.trim();
  if (!s) return BLANK_GROUP;
  return col.type === "date" ? s.slice(0, 10) : s;
}

/** Group order: numbers by value, text A → Z (with the numbers inside it in
 *  order: "INV-9" before "INV-10"), the blank group last. */
export function compareGroupValues(a: string | number, b: string | number): number {
  if (a === b) return 0;
  if (a === BLANK_GROUP) return 1;
  if (b === BLANK_GROUP) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return COLLATOR.compare(a, b);
}

/** How a group's name reads: a day as DD/MM/YYYY, money with two decimals. */
export function groupValueLabel(type: ExportColumn<unknown>["type"], v: string | number): string {
  if (typeof v === "number") {
    return type === "currency"
      ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v.toLocaleString("en-US");
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return v;
}

export type RowGroup<T> = { key: string; value: string | number; rows: T[] };

/** The rows split into their groups, in group order; inside a group the rows
 *  keep the order they came in. */
export function groupRows<T>(rows: T[], valueOf: (row: T) => string | number): RowGroup<T>[] {
  const byKey = new Map<string, RowGroup<T>>();
  for (const row of rows) {
    const value = valueOf(row);
    const key = String(value);
    let g = byKey.get(key);
    if (!g) {
      g = { key, value, rows: [] };
      byKey.set(key, g);
    }
    g.rows.push(row);
  }
  return [...byKey.values()].sort((a, b) => compareGroupValues(a.value, b.value));
}

/** A grouped grid's Listing sheet: the header, then each group's rows followed
 *  by its subtotal row — "<group> subtotal (N)" in the first column without a
 *  total, the group's totals in the total columns (money in RM, as the rows).
 *  `subtotalRows` = the BODY indexes of those rows (the PDF bands them). */
export function buildGroupedListingAoa<T>(
  columns: ExportColumn<T>[],
  groups: { label: string; rows: T[] }[],
  totalsOf: (rows: T[]) => Record<string, number>,
): { aoa: Aoa; subtotalRows: number[] } {
  const cols = columns.filter((c) => c.key !== "__select__" && c.key !== "__actions__");
  const aoa: Aoa = [cols.map((c) => c.label)];
  const subtotalRows: number[] = [];
  for (const g of groups) {
    for (const row of g.rows) aoa.push(cols.map((c) => cellExportValue(c, row)));
    const t = totalsOf(g.rows);
    const labelAt = Math.max(0, cols.findIndex((c) => t[c.key] === undefined));
    subtotalRows.push(aoa.length - 1);
    aoa.push(cols.map((c, i) => {
      const v = t[c.key];
      if (v !== undefined) return c.type === "currency" ? Math.round(v) / 100 : v;
      return i === labelAt ? `${g.label} subtotal (${g.rows.length})` : "";
    }));
  }
  return { aoa, subtotalRows };
}
