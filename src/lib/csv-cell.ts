// ---------------------------------------------------------------------------
// csv-cell.ts — one rule for every CSV cell Hookka writes.
//
// 1. Formula safety. Excel, Sheets and Numbers run a cell that starts with
//    = + - @ (or a tab / carriage return) as a formula, so a customer name or
//    remark like `=HYPERLINK(...)` would execute when Finance opens the export.
//    Such text gets a leading apostrophe, which spreadsheets show as plain text.
//    Real numbers, including negatives typed as text ("-12.50"), are left alone
//    so money columns stay numeric. Same guard Conts added (csvSafe, PR #165).
// 2. RFC 4180 quoting: a cell with a comma, quote or line break is quoted and
//    inner quotes doubled.
// 3. CSV_BOM: Excel needs the UTF-8 byte-order mark to read Chinese and Malay
//    names correctly when the file is double-clicked.
// ---------------------------------------------------------------------------

export const CSV_BOM = "﻿";

const NUMERIC = /^[-+]?(\d[\d,]*)?(\.\d+)?$/;

/** Neutralise text a spreadsheet would run as a formula. */
export function csvSafeText(s: string): string {
  if (s.length === 0) return s;
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (NUMERIC.test(s.trim()) && /\d/.test(s)) return s;
  return `'${s}`;
}

/** One CSV cell: formula-safe text, quoted when it needs to be. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = csvSafeText(value instanceof Date ? value.toISOString() : typeof value === "string" ? value : JSON.stringify(value));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to a CSV Blob with the BOM, CRLF line ends. */
export function csvBlob(rows: readonly (readonly unknown[])[]): Blob {
  const text = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Blob([CSV_BOM + text], { type: "text/csv;charset=utf-8" });
}
