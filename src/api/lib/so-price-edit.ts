// ---------------------------------------------------------------------------
// so-price-edit.ts — HK-0156. Price-only edit of a sales order's lines, for
// orders the full Edit page has locked (production started, or past
// IN_PRODUCTION). Only basePriceSen changes; qty, product, specs, surcharges
// and discount stay as stored, so production is never touched.
// ---------------------------------------------------------------------------
import { calculateUnitPrice, calculateLineTotal } from "../../lib/pricing";

/** Once invoiced the price is on a customer document; change it there. */
const PRICE_FROZEN_STATUSES = new Set(["INVOICED", "CLOSED", "CANCELLED"]);

export function soPriceEditBlock(status: string, hasInvoice: boolean): string | null {
  if (PRICE_FROZEN_STATUSES.has(status)) {
    return `This order is ${status} — prices can no longer be changed.`;
  }
  if (hasInvoice) {
    return "An invoice already exists for this order — change the price on the invoice instead.";
  }
  return null;
}

export interface StoredPriceItem {
  id: string;
  quantity: number | string | null;
  basePriceSen: number | string | null;
  divanPriceSen?: number | string | null;
  legPriceSen?: number | string | null;
  totalHeightPriceSen?: number | string | null;
  specialOrderPriceSen?: number | string | null;
  unitPriceSen: number | string | null;
  discountSen?: number | string | null;
  lineTotalSen: number | string | null;
}

export interface PriceChange {
  id: string;
  lineIndex: number;
  basePriceSen: number;
  unitPriceSen: number;
  lineTotalSen: number;
  oldUnitPriceSen: number;
}

export type RepriceResult =
  | { ok: true; changed: PriceChange[]; subtotalSen: number }
  | { ok: false; error: string };

const n = (v: unknown) => Number(v) || 0;

export function repriceSoItems(stored: StoredPriceItem[], edits: unknown): RepriceResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: "No price to change" };
  }
  const newBase = new Map<string, number>();
  for (const e of edits as { id?: unknown; basePriceSen?: unknown }[]) {
    const id = String(e?.id ?? "");
    const base = e?.basePriceSen;
    if (!stored.some((s) => s.id === id)) {
      return { ok: false, error: `Line ${id || "(blank)"} is not on this order` };
    }
    if (newBase.has(id)) return { ok: false, error: "A line is listed twice" };
    if (typeof base !== "number" || !Number.isInteger(base) || base < 0) {
      return { ok: false, error: "Base price must be a whole number of sen, 0 or more" };
    }
    newBase.set(id, base);
  }

  const changed: PriceChange[] = [];
  let subtotalSen = 0;
  stored.forEach((s, lineIndex) => {
    const base = newBase.get(s.id);
    if (base === undefined || base === n(s.basePriceSen)) {
      subtotalSen += n(s.lineTotalSen);
      return;
    }
    const unitPriceSen = calculateUnitPrice({
      basePriceSen: base,
      divanPriceSen: n(s.divanPriceSen),
      legPriceSen: n(s.legPriceSen),
      totalHeightPriceSen: n(s.totalHeightPriceSen),
      specialOrderPriceSen: n(s.specialOrderPriceSen),
    });
    // Same line-total rule as the SO PUT: qty × unit − discount, floored at 0.
    const lineTotalSen = Math.max(0, calculateLineTotal(unitPriceSen, n(s.quantity)) - n(s.discountSen));
    subtotalSen += lineTotalSen;
    changed.push({
      id: s.id,
      lineIndex,
      basePriceSen: base,
      unitPriceSen,
      lineTotalSen,
      oldUnitPriceSen: n(s.unitPriceSen),
    });
  });
  return { ok: true, changed, subtotalSen };
}
