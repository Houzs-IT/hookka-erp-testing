// WIP names are stored with {PLACEHOLDER} tokens ({SIZE}, {DIVAN_HEIGHT}…).
type LabelProduct = {
  code?: string;
  category?: string;
  baseModel?: string;
  sizeCode?: string;
  sizeLabel?: string;
  defaultVariants?: { fabricCode?: string; divanHeight?: string; legHeight?: string; seatHeight?: string } | null;
};

/** A WIP name with its {PLACEHOLDER} tokens filled from the product (its size,
 *  model and default variants), else the BOM page's sample values — so the
 *  page reads "8\" Divan- 6FT", not "{DIVAN_HEIGHT} Divan- {SIZE}". */
export function wipLabel(label: string, p: LabelProduct | undefined): string {
  const dv = p?.defaultVariants ?? {};
  const isSofa = p?.category === "SOFA";
  const values: Record<string, string> = {
    PRODUCT_CODE: p?.code ?? "",
    MODEL: p?.baseModel ?? "",
    SIZE: p?.sizeLabel ?? "",
    MODULE: p?.sizeCode ?? "",
    DIVAN_HEIGHT: dv.divanHeight || '8"',
    LEG_HEIGHT: dv.legHeight || '2"',
    TOTAL_HEIGHT: '10"',
    SEAT_SIZE: isSofa ? dv.seatHeight || '30"' : "",
    FABRIC: dv.fabricCode || "fabric",
    SPECIAL: "STD",
  };
  return label.replace(/\{([A-Z_]+)\}/g, (_, k: string) => values[k] ?? k).replace(/\s{2,}/g, " ").trim();
}
