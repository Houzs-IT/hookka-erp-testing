// ---------------------------------------------------------------------------
// lead-sheet.ts — one sheet of a bought contact list → the rows
// POST /api/sales-leads/import takes (RawLeadRow, src/lib/lead-import.ts).
//
// The column finding goes through the shared table-import parser (O6,
// src/lib/table-import.ts): the Google-Maps export headers ("Business Name",
// "Business Phone", …) are each column's label, so a file with those headers
// maps EXACTLY as the old inline mapping in scripts/import-leads-from-xlsx.mjs
// did (pinned by tests/table-import-more-importers.test.mjs). What is new: case,
// spacing, `_` and a trailing `*` no longer matter, and a list that calls the
// columns "Company" / "Phone" / "Email" / "Website" / "Address" is read too
// instead of every row being skipped as "no company" / "no phone".
//
// Cell values pass through untouched (a phone typed as a number stays a
// number) — planImport does the cleaning.
// ---------------------------------------------------------------------------
import type { RawLeadRow } from "./lead-import";
import { buildHeaderMap, type ImportColumn } from "./table-import";

export const LEAD_SHEET_COLUMNS: ImportColumn[] = [
  { key: "company", label: "Business Name", aliases: ["Company", "Company Name"] },
  { key: "phone", label: "Business Phone", aliases: ["Phone", "Phone Number", "Tel"] },
  { key: "email", label: "Business Email", aliases: ["Email", "E-mail"] },
  { key: "website", label: "Business Website", aliases: ["Website"] },
  { key: "location", label: "Location", aliases: ["Address"] },
];

/**
 * Header-keyed records of one sheet (xlsx `sheet_to_json(ws, { defval: null })`)
 * → lead rows, with `industry` set for every row. Wholly blank rows are dropped.
 */
export function leadRowsFromSheet(records: Record<string, unknown>[], industry: string): RawLeadRow[] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    for (const h of Object.keys(r ?? {})) {
      if (!seen.has(h)) {
        seen.add(h);
        headers.push(h);
      }
    }
  }
  const keyToHeader = new Map<string, string>();
  for (const [i, key] of buildHeaderMap(headers, LEAD_SHEET_COLUMNS)) keyToHeader.set(key, headers[i]);
  const cell = (r: Record<string, unknown>, key: string) => {
    const h = keyToHeader.get(key);
    return (h === undefined ? null : (r[h] ?? null)) as string | null;
  };

  const rows: RawLeadRow[] = [];
  for (const r of records) {
    if (!r || Object.values(r).every((v) => v === null || v === "")) continue;
    rows.push({
      company: cell(r, "company"),
      phone: cell(r, "phone"),
      email: cell(r, "email"),
      website: cell(r, "website"),
      location: cell(r, "location"),
      industry,
    });
  }
  return rows;
}
