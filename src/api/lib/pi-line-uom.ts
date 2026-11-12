// HK-0149 — a purchase-invoice line may be billed in another unit than the PO
// line it bills (Violet 2026-11-12: fabric ordered in ROLL, received in MTR).
//
// `purchase_invoice_items.uom` is stored ONLY when it differs from that PO
// line's unit; NULL means "in the PO line's own unit", which is every legacy
// row. There is no ROLL→MTR factor anywhere in the system, so a line with a
// unit of its own cannot be compared with the PO: it is left out of every
// quantity counter (the PO invoicing ceiling, PI auto stock-in, overdue and
// outstanding coverage) and counts for money only. The PO line is never written.
import { sameUom, isUomAllowed } from "../../lib/material-variants";
import { loadUomConfig, uomNotAllowedMsg } from "../routes/raw-materials";

/** The unit to store: null when blank or the same as the PO line's unit. */
export function piLineUom(sent: unknown, poLineUnit: string | null | undefined): string | null {
  const u = typeof sent === "string" ? sent.trim().toUpperCase() : "";
  if (!u || !poLineUnit || sameUom(u, poLineUnit)) return null;
  return u;
}

/**
 * Resolve each row's `uom` in place. Only a line picked off a PO line (and not
 * received through a GRN — the GRN line already counted its quantity, and
 * `grn_items.invoiced_qty <= accepted_qty` would compare MTR with ROLL) may
 * carry a unit of its own; every other row is set to null.
 */
export async function resolvePiLineUoms(
  db: D1Database,
  rows: Array<{ uom?: string | null; poItemId: string | null; grnItemId: string | null }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const wanted = rows.filter((r) => r.uom && r.poItemId && !r.grnItemId);
  const ids = [...new Set(wanted.map((r) => String(r.poItemId)))];
  const unitById = new Map<string, string | null>();
  if (ids.length > 0) {
    const res = await db
      .prepare(`SELECT id, unit FROM purchase_order_items WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ id: string; unit: string | null }>();
    for (const r of res.results ?? []) unitById.set(String(r.id), r.unit);
    const units = (await loadUomConfig(db)).units;
    for (const r of wanted) {
      if (!isUomAllowed(String(r.uom), units)) return { ok: false, error: uomNotAllowedMsg(String(r.uom), units) };
    }
  }
  for (const r of rows) {
    r.uom = wanted.includes(r) ? piLineUom(r.uom, unitById.get(String(r.poItemId))) : null;
  }
  return { ok: true };
}
