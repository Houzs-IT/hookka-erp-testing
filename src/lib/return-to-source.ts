/**
 * Review C2-6 (Conts#809, from Houzs#4975) — after saving a document raised
 * from another document, the result offers "Back to <source>" instead of
 * dumping you on the list:
 *   - a GRN raised from a PO (`/procurement/grn/create?poId=…`) → Back to PO
 *   - a PI raised from a GRN (`?grnId=…`) → Back to GRN; from a PO → Back to PO
 * A document keyed from scratch behaves exactly as before (list + toast).
 */
export type SourceKind = "PO" | "GRN";
export type SavedSource = { kind: SourceKind; id: string };

/** The source document named in the create page's query (GRN wins over PO). */
export function sourceFromParams(
  params: { get(name: string): string | null },
  allowed: SourceKind[],
): SavedSource | null {
  const grnId = (params.get("grnId") ?? "").trim();
  if (allowed.includes("GRN") && grnId) return { kind: "GRN", id: grnId };
  const poId = (params.get("poId") ?? "").trim();
  if (allowed.includes("PO") && poId) return { kind: "PO", id: poId };
  return null;
}

export function sourceHref(s: SavedSource): string {
  return s.kind === "GRN"
    ? `/procurement/grn/${encodeURIComponent(s.id)}`
    : `/procurement/${encodeURIComponent(s.id)}`;
}

export function sourceBackLabel(s: SavedSource): string {
  return `Back to ${s.kind}`;
}

/** Where the "open the new document" choice goes (the list when no id came back). */
export function savedDocHref(kind: "GRN" | "PI", id: string | null | undefined): string {
  const base = kind === "GRN" ? "/procurement/grn" : "/procurement/pi";
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}
