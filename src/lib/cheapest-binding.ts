// ---------------------------------------------------------------------------
// cheapest-binding.ts (pure) — which supplier a PO line defaults to (owner
// 2026-11-07: pick the Internal Code and the cheapest supplier comes up).
//
// A price only competes when it is above 0, in MYR, not past its valid-to date,
// and the supplier was ordered from for this code in the last 4 months: past
// that, the owner counts them as no longer supplying it (2026-11-07). Ties go to
// the Main supplier. With no such price, the Main supplier still comes up.
// ---------------------------------------------------------------------------

type Binding = {
  unitPrice: number | string;
  currency?: string | null;
  priceValidTo?: string | null;
  isMainSupplier?: boolean | number | null;
  /** Latest PI or PO for this supplier and code, YYYY-MM-DD. */
  lastOrderedAt?: string | null;
};

export const RECENT_ORDER_MONTHS = 4;

/** The date `months` calendar months before a YYYY-MM-DD date, clamped to the month's end. */
export function monthsBefore(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

const competes = (b: Binding, today: string): boolean => {
  const validTo = String(b.priceValidTo ?? "").slice(0, 10);
  return (
    Number(b.unitPrice) > 0 &&
    String(b.currency || "MYR").toUpperCase() === "MYR" &&
    (validTo === "" || validTo >= today) &&
    String(b.lastOrderedAt ?? "").slice(0, 10) >= monthsBefore(today, RECENT_ORDER_MONTHS)
  );
};

/** Cheapest first; the bindings that cannot compete follow, Main first. */
export function sortCheapestFirst<T extends Binding>(bindings: readonly T[], today: string): T[] {
  return [...bindings].sort((a, b) => {
    const [ca, cb] = [competes(a, today), competes(b, today)];
    if (ca !== cb) return ca ? -1 : 1;
    if (ca) {
      const diff = Number(a.unitPrice) - Number(b.unitPrice);
      if (diff !== 0) return diff;
    }
    return Number(!!b.isMainSupplier) - Number(!!a.isMainSupplier);
  });
}

export function cheapestBinding<T extends Binding>(bindings: readonly T[], today: string): T | undefined {
  return sortCheapestFirst(bindings, today)[0];
}

type SkuBinding = { id: string; supplierId: string; supplierSku?: string | null };

/**
 * One option per supplier + supplier SKU. A supplier can sell one Internal Code
 * under two SKUs at two prices, and each must stay pickable; a pair stored twice
 * with the same SKU is one option (BUG-2026-10-12-276). Keeps the order given.
 */
export function uniqueSkuOptions<T extends SkuBinding>(bindings: readonly T[]): T[] {
  const seen = new Set<string>();
  return bindings.filter((b) => {
    const key = `${b.supplierId}|${b.supplierSku ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Which option a PO line is on: its exact SKU, else the first for its supplier. */
export function bindingIdForLine(
  bindings: readonly SkuBinding[],
  line: { supplierId: string; supplierSku?: string | null },
): string {
  const same = bindings.filter((b) => b.supplierId === line.supplierId);
  return (same.find((b) => (b.supplierSku ?? "") === (line.supplierSku ?? "")) ?? same[0])?.id ?? "";
}
