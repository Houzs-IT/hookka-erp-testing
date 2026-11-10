/**
 * Review H1-5 (Houzs#4387 / #4762) — one goods receipt can cover several POs.
 * The server names the PO on every GRN line (`poId` / `poNumber`, filled by
 * `fillGrnLinePoNumbers` in src/api/routes/grn.ts); these pure helpers turn
 * that into what the detail page and the list's side panel show.
 */
export type GrnLinePoLike = { poId?: string | null; poNumber?: string | null };
export type GrnPoHeaderLike = {
  poId?: string | null;
  poNumber?: string | null;
  items?: GrnLinePoLike[] | null;
};
export type GrnPoRef = { poId: string; poNumber: string };

/** Every distinct PO the receipt draws from, header PO first, in line order. */
export function grnPoRefs(grn: GrnPoHeaderLike): GrnPoRef[] {
  const out: GrnPoRef[] = [];
  const seen = new Set<string>();
  const add = (poId?: string | null, poNumber?: string | null) => {
    const id = String(poId ?? "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ poId: id, poNumber: String(poNumber ?? "").trim() || id });
  };
  add(grn.poId, grn.poNumber);
  for (const it of grn.items ?? []) add(it.poId, it.poNumber);
  return out;
}

/** True when the lines come from more than one PO — then each line names its PO. */
export function isMultiPoGrn(grn: GrnPoHeaderLike): boolean {
  return grnPoRefs(grn).length > 1;
}

/** The PO label for one line: its own PO, else the header PO, else "". */
export function grnLinePoLabel(line: GrnLinePoLike, grn: GrnPoHeaderLike): string {
  const own = String(line.poNumber ?? "").trim() || String(line.poId ?? "").trim();
  if (own) return own;
  return String(grn.poNumber ?? "").trim() || String(grn.poId ?? "").trim();
}
