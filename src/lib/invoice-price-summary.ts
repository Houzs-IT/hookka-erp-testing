// ---------------------------------------------------------------------------
// invoice-price-summary — the rules behind the Invoice Price Summary page
// (HK-0158): which invoice lines a month or date range covers, and how a new
// UNIT price on one line becomes the `priceEdits` entry PUT /api/invoices/:id
// already accepts from the invoice's own price editor.
//
// The page edits the charge only. The add-ons on the line (Divan / Leg /
// T.Height / Special) are kept and Base absorbs the difference, so the
// build-up still sums to the charge (invoice-line-price.ts rule 5). The seed
// is `invoicePriceEditSeed`, so a line whose stored components don't
// reconcile is treated as "the charge is all Base" — never a made-up split.
// ---------------------------------------------------------------------------
import { invoicePriceEditSeed, type InvoicePriceComponents } from "./invoice-line-price";
import type { PriceEditPayloadLine } from "./invoice-price-edit-payload";

/** First and last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

export type SummaryLine = {
  id: string;
  unitPriceSen: number;
  discountSen: number;
  basePriceSen: number;
  divanPriceSen: number;
  legPriceSen: number;
  specialOrderPriceSen: number;
  totalHeightPriceSen: number;
};

/**
 * The priceEdits entry that charges `newUnitSen` for this line, or an error
 * when the new price is below the line's own add-ons (Base would go negative —
 * that line needs its build-up edited on the invoice itself).
 */
export function unitPriceEdit(
  line: SummaryLine,
  newUnitSen: number,
): { edit: PriceEditPayloadLine } | { error: string } {
  const unit = Math.round(newUnitSen);
  if (!Number.isFinite(unit) || unit < 0) return { error: "Price must be 0 or more." };
  const stored: InvoicePriceComponents = {
    baseSen: line.basePriceSen,
    divanSen: line.divanPriceSen,
    legSen: line.legPriceSen,
    specialSen: line.specialOrderPriceSen,
    totalHeightSen: line.totalHeightPriceSen,
  };
  const seed = invoicePriceEditSeed(stored, line.unitPriceSen);
  const addOns = seed.divanSen + seed.legSen + seed.specialSen + seed.totalHeightSen;
  if (unit < addOns) {
    return {
      error: `Below this line's add-ons (RM ${(addOns / 100).toFixed(2)}). Edit it on the invoice.`,
    };
  }
  return {
    edit: {
      id: line.id,
      baseSen: unit - addOns,
      divanSen: seed.divanSen,
      legSen: seed.legSen,
      specialSen: seed.specialSen,
      totalHeightSen: seed.totalHeightSen,
      discountSen: line.discountSen,
      // The operator typed this price; a typed 0 is a deliberate free line.
      allowZero: unit === 0,
    },
  };
}

/** Group edits by invoice, dropping lines whose price did not change. */
export function editsByInvoice(
  lines: Array<SummaryLine & { invoiceId: string }>,
  draftSen: Record<string, number | undefined>,
): { groups: Map<string, PriceEditPayloadLine[]>; errors: Array<{ id: string; error: string }> } {
  const groups = new Map<string, PriceEditPayloadLine[]>();
  const errors: Array<{ id: string; error: string }> = [];
  for (const l of lines) {
    const d = draftSen[l.id];
    if (d === undefined || Math.round(d) === l.unitPriceSen) continue;
    const r = unitPriceEdit(l, d);
    if ("error" in r) {
      errors.push({ id: l.id, error: r.error });
      continue;
    }
    groups.set(l.invoiceId, [...(groups.get(l.invoiceId) ?? []), r.edit]);
  }
  return { groups, errors };
}
