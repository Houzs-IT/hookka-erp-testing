// ---------------------------------------------------------------------------
// cheapest-binding.ts (pure) — which supplier a PO line defaults to (owner
// 2026-11-07: pick the Internal Code and the cheapest supplier comes up).
//
// A price only competes when it is above 0, in MYR and not past its valid-to
// date. Ties go to the Main supplier. With no such price, the Main supplier
// still comes up, as it did before.
// ---------------------------------------------------------------------------

type Binding = {
  unitPrice: number | string;
  currency?: string | null;
  priceValidTo?: string | null;
  isMainSupplier?: boolean | number | null;
};

const competes = (b: Binding, today: string): boolean => {
  const validTo = String(b.priceValidTo ?? "").slice(0, 10);
  return (
    Number(b.unitPrice) > 0 &&
    String(b.currency || "MYR").toUpperCase() === "MYR" &&
    (validTo === "" || validTo >= today)
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
