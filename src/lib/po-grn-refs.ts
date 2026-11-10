/**
 * Review H2-3 / C2-7 (Houzs#5045, Conts#810) — the PO list shows each PO's
 * GRN number(s) and the date the goods actually arrived, so nobody has to
 * open the PO, then its map, then the GRN. Display only.
 *
 * A GRN belongs to a PO by its header `poId`, or — for a receipt covering
 * several POs — by any of its lines' `po_id` (same rule as GRN_OF_PO_SQL in
 * src/api/routes/grn.ts). Cancelled receipts are left out.
 */
export type GrnHeaderLite = {
  id: string;
  grnNumber: string;
  poId?: string | null;
  receiveDate?: string | null;
  status?: string | null;
};
export type GrnLineLink = { grnId: string; poId: string };
export type PoGrnRef = { id: string; grnNumber: string; receiveDate: string };
export type PoGrnSummary = {
  grnRefs: PoGrnRef[];
  /** "GRN-2611-001, GRN-2611-004" — sortable / searchable text. */
  grnNumbers: string;
  /** Latest receive date (YYYY-MM-DD) among the PO's GRNs, "" if none. */
  grnDate: string;
};

const day = (v: string | null | undefined) => String(v ?? "").slice(0, 10);

/** Build each PO's GRN summary. Pure — the route feeds it two small reads. */
export function summarizePoGrns(
  poIds: string[],
  grns: GrnHeaderLite[],
  lineLinks: GrnLineLink[],
): Map<string, PoGrnSummary> {
  const live = grns.filter((g) => String(g.status ?? "").toUpperCase() !== "CANCELLED");
  const byId = new Map(live.map((g) => [g.id, g]));
  const perPo = new Map<string, Map<string, GrnHeaderLite>>();
  const add = (poId: string, g: GrnHeaderLite | undefined) => {
    if (!poId || !g) return;
    const m = perPo.get(poId) ?? perPo.set(poId, new Map()).get(poId)!;
    m.set(g.id, g);
  };
  for (const g of live) add(String(g.poId ?? ""), g);
  for (const l of lineLinks) add(l.poId, byId.get(l.grnId));

  const out = new Map<string, PoGrnSummary>();
  for (const poId of poIds) {
    const refs = [...(perPo.get(poId)?.values() ?? [])]
      .map((g) => ({ id: g.id, grnNumber: String(g.grnNumber ?? ""), receiveDate: day(g.receiveDate) }))
      .sort((a, b) => a.grnNumber.localeCompare(b.grnNumber));
    const dates = refs.map((r) => r.receiveDate).filter(Boolean).sort();
    out.set(poId, {
      grnRefs: refs,
      grnNumbers: refs.map((r) => r.grnNumber).join(", "),
      grnDate: dates.length ? dates[dates.length - 1] : "",
    });
  }
  return out;
}
