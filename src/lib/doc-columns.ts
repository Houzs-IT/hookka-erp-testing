// ---------------------------------------------------------------------------
// doc-columns — the ONE column contract every document Detail Listing leads
// with (HK-0002, owner YH 2026-10-16).
//
// Before this, each document invented its own header words ("Doc. No." vs
// "GRN No." vs "DO No.", "Date" vs "Dispatch Date") and only invoices carried a
// line key, so nothing could be imported back. Now every listing (SO, PO, GRN,
// DO, DI/SI, PI) starts with the SAME block, in the SAME order, with the SAME
// names, and only then adds its own columns. The shared importer
// (src/lib/doc-import/core.ts) reads exactly these names, so an export goes
// back in unchanged.
//
//   Doc Type | Doc No. | Doc Date | Party Code | Party Name | [Ref Doc No.] |
//   Line ID | Item Code | Description | Qty | UOM | Unit Price | Discount |
//   Line Total
//
// `Ref Doc No.` is present only for documents that have a parent (GRN → PO,
// DO → SO, DI → DO, PI → PO). Money is ringgit as a NUMBER (not "RM 1.00"),
// dates are YYYY-MM-DD, a value the document does not carry is "" (blank),
// never an invented 0.
// ---------------------------------------------------------------------------

export const COMMON_HEAD = ["Doc Type", "Doc No.", "Doc Date", "Party Code", "Party Name"] as const;
export const REF_HEADER = "Ref Doc No." as const;
export const COMMON_LINE = [
  "Line ID", "Item Code", "Description", "Qty", "UOM", "Unit Price", "Discount", "Line Total",
] as const;

/** The leading header block. `withRef` adds `Ref Doc No.` after Party Name. */
export function commonHeaders(withRef: boolean): string[] {
  return [...COMMON_HEAD, ...(withRef ? [REF_HEADER] : []), ...COMMON_LINE];
}

export type Cell = string | number;

/** One line of any document, in the contract's own terms. Money is SEN. */
export type CommonLine = {
  docType: string;
  docNo?: string | null;
  docDate?: string | null;
  partyCode?: string | null;
  partyName?: string | null;
  refDocNo?: string | null;
  lineId?: string | null;
  itemCode?: string | null;
  description?: string | null;
  qty?: number | null;
  uom?: string | null;
  /** null/undefined = the document does not carry a price → blank cell. */
  unitPriceSen?: number | null;
  discountSen?: number | null;
  lineTotalSen?: number | null;
};

/** Sen → ringgit number. */
export const rm = (sen: number | null | undefined): number => Math.round(Number(sen) || 0) / 100;
/** Sen → ringgit, or blank when the value is absent (not the same as 0). */
export const rmOrBlank = (sen: number | null | undefined): Cell =>
  sen === null || sen === undefined ? "" : rm(sen);
/** ISO timestamp → YYYY-MM-DD; anything that is not ISO passes through. */
export const day = (iso: string | null | undefined): string => {
  const s = String(iso ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
};
export const num = (v: number | null | undefined): number => Number(v) || 0;

/** UOM per the owner's AutoCount listing: bedframes/sofas ship as SET,
 *  accessories as UNIT; unknown category = blank. */
export function uomFor(category: string | null | undefined): string {
  const c = String(category ?? "").toUpperCase();
  if (!c) return "";
  return c === "ACCESSORY" ? "UNIT" : "SET";
}

/** The leading cells for one line, matching `commonHeaders(withRef)`. */
export function commonCells(l: CommonLine, withRef: boolean): Cell[] {
  return [
    l.docType,
    l.docNo ?? "",
    day(l.docDate),
    l.partyCode ?? "",
    l.partyName ?? "",
    ...(withRef ? [l.refDocNo ?? ""] : []),
    l.lineId ?? "",
    l.itemCode ?? "",
    l.description ?? "",
    l.qty === null || l.qty === undefined ? "" : num(l.qty),
    l.uom ?? "",
    rmOrBlank(l.unitPriceSen),
    rmOrBlank(l.discountSen),
    rmOrBlank(l.lineTotalSen),
  ];
}
