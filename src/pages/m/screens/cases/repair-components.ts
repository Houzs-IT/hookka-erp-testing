// Canonical damaged-part options come from GET /api/sales-orders/repair-components (the BOM → WIP breakdown).
export type RepairComponentOption = { key: string; label: string; type?: string; qty: number };
export type ComponentPick = { key: string; label: string; qty: number };

/** Variant fields that identify the exact BOM (feed the same query as desktop). */
export type ProductVariant = {
  productCode: string;
  sizeLabel?: string | null;
  sizeCode?: string | null;
  fabricCode?: string | null;
  gapInches?: number | null;
  divanHeightInches?: number | null;
  legHeightInches?: number | null;
};

export function repairComponentsUrl(v: ProductVariant): string | null {
  if (!v.productCode) return null;
  const p = new URLSearchParams({ productCode: v.productCode });
  if (v.sizeLabel) p.set("sizeLabel", v.sizeLabel);
  if (v.sizeCode) p.set("sizeCode", v.sizeCode);
  if (v.fabricCode) p.set("fabricCode", v.fabricCode);
  if (v.gapInches != null) p.set("gapInches", String(v.gapInches));
  if (v.divanHeightInches != null) p.set("divanHeightInches", String(v.divanHeightInches));
  if (v.legHeightInches != null) p.set("legHeightInches", String(v.legHeightInches));
  return `/api/sales-orders/repair-components?${p.toString()}`;
}

