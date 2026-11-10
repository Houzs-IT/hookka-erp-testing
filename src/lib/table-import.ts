// ---------------------------------------------------------------------------
// table-import.ts — the ONE CSV / Excel table-import parser (O6).
//
// Before this, every importer carried its own copy of "find the column, read
// the cell": BatchImportDialog matched `label` / `label *` inline in the
// component, wip-times had a private findCol, stock-take its own header
// normaliser. Each copy drifted (one trimmed, one stripped the star, one did
// neither), so a file that one screen read was refused by another, and none
// of it could be unit-tested because it lived inside React handlers.
// Sister work: Houzs#4618, #4527, #4605, #4614.
//
// What it does:
//   * normalizeHeader — case, surrounding / doubled spaces, `_`, and the
//     required-field star ("Product Code *") never decide whether a column is
//     found.
//   * header ALIASES — a column can list other names it is known by
//     ("Code", "SKU"). A column's own label always wins over an alias, and an
//     alias never takes a column another field's label already claimed, so a
//     file that imported before maps exactly as before.
//   * parseImportRows / coerceImportCell — the BatchImportDialog schema rules
//     (required, enum, money via parse-money, number, boolean, blank = absent),
//     moved here VERBATIM so what an import writes does not change.
//   * buildExportAoa — the export side of the same schema, so "every table
//     that exports can import its own export" is one round-trip test.
//
// Pure: no React, no xlsx import (callers hand in the rows xlsx produced).
// ---------------------------------------------------------------------------
import { parseMoneyInput } from "./parse-money";

// "money" columns go through the ONE money parser (src/lib/parse-money.ts) so
// a spreadsheet cell reading "12,000" imports as twelve thousand rather than as
// twelve. Plain "number" columns keep `Number()` on purpose: they carry
// quantities, metres and days, where money syntax (a leading RM, accounting
// parentheses) would be wrong to accept.
export type ImportColumnType = "string" | "number" | "money" | "boolean";

export type ImportColumn = {
  /** Field name in the row object passed to onImport. */
  key: string;
  /** Column header shown in the downloaded template. */
  label: string;
  /** Other headers this column is recognised by on import (never exported). */
  aliases?: string[];
  /** Marks this as a required field — blank rows fail validation. */
  required?: boolean;
  /** Accepted values. Case-insensitive on input. */
  enum?: string[];
  /** Type coercion for the parsed value. Defaults to "string". */
  type?: ImportColumnType;
  /** Example value shown as the second row in the template. */
  example?: string | number;
  /** Free-text help shown below the field in the legend. */
  help?: string;
  /** Still written/read on export/import for matching, but never shown in
   *  the template legend, the preview table, or Excel (hidden column) —
   *  for system-managed fields like `id` users shouldn't see or edit. */
  hidden?: boolean;
};

export type ImportRow = Record<string, unknown>;

/** Header spelling that does not matter: case, spaces, `_`, a trailing `*`. */
export function normalizeHeader(h: unknown): string {
  if (h === null || h === undefined) return "";
  return String(h)
    .replace(/\u00a0/g, " ")
    .replace(/_/g, " ")
    .replace(/\s*\*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The header text a column is exported under ("Item Code *" when required). */
export function exportHeader(col: ImportColumn): string {
  return col.required ? `${col.label} *` : col.label;
}

/**
 * Map each header of the file to a column key, or nothing.
 * Pass 1: a column's own label (or key). Pass 2: aliases, only for columns
 * not already found and headers not already claimed. Within a pass the first
 * header wins; a later duplicate is ignored.
 */
export function buildHeaderMap(headers: unknown[], columns: ImportColumn[]): Map<number, string> {
  const norm = headers.map(normalizeHeader);
  const out = new Map<number, string>();
  const found = new Set<string>();
  const claim = (names: (col: ImportColumn) => string[]) => {
    for (const col of columns) {
      if (found.has(col.key)) continue;
      const wanted = new Set(names(col).map(normalizeHeader).filter(Boolean));
      const at = norm.findIndex((h, i) => h !== "" && wanted.has(h) && !out.has(i));
      if (at >= 0) {
        out.set(at, col.key);
        found.add(col.key);
      }
    }
  };
  claim((c) => [c.label]);
  claim((c) => [c.key, ...(c.aliases ?? [])]);
  return out;
}

/**
 * Index of the first header matching any of `names` (tried in order), or -1.
 * For array-of-arrays importers that pick a few columns by name.
 */
export function findHeaderIndex(headerRow: unknown[], ...names: string[]): number {
  const norm = headerRow.map(normalizeHeader);
  for (const n of names) {
    const i = norm.indexOf(normalizeHeader(n));
    if (i >= 0) return i;
  }
  return -1;
}

export type CoercedCell = { value: unknown; error?: string };

/** One cell through the column's schema. Blank optional = undefined (absent). */
export function coerceImportCell(col: ImportColumn, raw: unknown): CoercedCell {
  const str = raw === null || raw === undefined ? "" : String(raw).trim();

  if (col.required && !str) return { value: "", error: `${col.label} is required` };

  // Blank optional cell stays absent (not defaulted to 0/"") so
  // JSON.stringify omits it and a server merge doesn't overwrite.
  // A blank boolean is absent too (it used to become false = INACTIVE).
  if (!str) return { value: undefined };

  if (col.enum && col.enum.length > 0) {
    const match = col.enum.find((e) => e.toLowerCase() === str.toLowerCase());
    if (!match) {
      return { value: str, error: `${col.label} must be one of: ${col.enum.join(", ")} (got "${str}")` };
    }
    return { value: match };
  }

  if (col.type === "money") {
    // BUG-2026-08-13-095: an unreadable amount is an ERROR that blocks the
    // row — the value is NEVER silently defaulted into the ledger.
    const rm = parseMoneyInput(str);
    if (rm === null) return { value: 0, error: `${col.label} must be an amount (got "${str}")` };
    return { value: rm };
  }

  if (col.type === "number") {
    const n = Number(str.replace(/,/g, ""));
    if (Number.isNaN(n)) return { value: 0, error: `${col.label} must be a number (got "${str}")` };
    return { value: n };
  }

  if (col.type === "boolean") {
    const truthy = ["true", "yes", "y", "1", "active"].includes(str.toLowerCase());
    const falsy = ["false", "no", "n", "0", "inactive"].includes(str.toLowerCase());
    if (!truthy && !falsy) return { value: false, error: `${col.label} must be true/false (got "${str}")` };
    return { value: truthy };
  }

  return { value: str };
}

export type ParsedImportRow = {
  /** Spreadsheet row number (header = 1, first data row = 2). */
  idx: number;
  values: ImportRow;
  errors: string[];
};

/**
 * Header-keyed rows (xlsx `sheet_to_json(ws, { raw: false, defval: "" })`)
 * through the schema. Unknown headers are ignored.
 */
export function parseImportRows(rawRows: Record<string, unknown>[], columns: ImportColumn[]): ParsedImportRow[] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of rawRows) {
    for (const h of Object.keys(r)) {
      if (!seen.has(h)) {
        seen.add(h);
        headers.push(h);
      }
    }
  }
  const byIndex = buildHeaderMap(headers, columns);
  const headerToKey = new Map<string, string>();
  for (const [i, key] of byIndex) headerToKey.set(headers[i], key);

  return rawRows.map((row, i) => {
    const remapped: Record<string, unknown> = {};
    for (const [header, v] of Object.entries(row)) {
      const k = headerToKey.get(header);
      if (k) remapped[k] = v;
    }
    const values: ImportRow = {};
    const errors: string[] = [];
    for (const col of columns) {
      const { value, error } = coerceImportCell(col, remapped[col.key]);
      values[col.key] = value;
      if (error) errors.push(error);
    }
    return { idx: i + 2, values, errors };
  });
}

/** Header-first array-of-arrays (array-of-arrays xlsx output) → header-keyed rows. */
export function aoaToRecords(aoa: unknown[][]): Record<string, unknown>[] {
  const [head = [], ...body] = aoa;
  const headers = head.map((h) => (h === null || h === undefined ? "" : String(h)));
  return body.map((r) => {
    const o: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h !== "") o[h] = r?.[i] ?? "";
    });
    return o;
  });
}

/** True when a parsed row carries any value at all (blank lines are dropped). */
export function rowHasData(values: ImportRow): boolean {
  return Object.values(values).some((v) => v !== "" && v !== 0 && v !== false && v !== undefined);
}

/**
 * One CSV line → its cells. Double quotes wrap a cell that holds commas, and
 * `""` inside quotes is one literal quote. Cells are NOT trimmed or typed — the
 * caller decides what a cell means.
 *
 * Moved VERBATIM from the bank-statement CSV paste in the Cash Book tab
 * (`parseCsvLine`, src/pages/accounting/index.tsx) so that importer reads every
 * file exactly as before; pinned by tests/table-import-more-importers.test.mjs.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The export sheet for a schema: header row, then one row per record. */
export function buildExportAoa(columns: ImportColumn[], rows: ImportRow[]): (string | number | boolean)[][] {
  const headerRow = columns.map(exportHeader);
  const dataRows: (string | number | boolean)[][] = rows.map((row) =>
    columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return "";
      if (c.type === "boolean") return v ? "TRUE" : "FALSE";
      if (c.type === "number") {
        const n = Number(v);
        return Number.isFinite(n) ? n : "";
      }
      return String(v);
    }),
  );
  return [headerRow, ...dataRows];
}
