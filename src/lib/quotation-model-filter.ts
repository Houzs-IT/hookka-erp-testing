// HK-0168 (Violet, 2026-11-20): export the customer quotation for chosen
// models only. A model is the product master's baseModel (5530, 1003(A), A01…),
// falling back to the SKU code when a product has none. Empty pick = all.

type ModelLookup = Map<string, { baseModel?: string | null }>;

export function quotationModelOf(
  productId: string,
  code: string,
  productById: ModelLookup,
): string {
  return productById.get(productId)?.baseModel?.trim() || code;
}

export function quotationModelOptions(
  rows: Array<{ productId: string; productCode: string }>,
  productById: ModelLookup,
): string[] {
  const models = new Set(rows.map((r) => quotationModelOf(r.productId, r.productCode, productById)));
  return [...models].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function pickQuotationModels<
  E extends {
    products: Array<{ productId: string; code: string }>;
    sofaCombos: Array<{ baseModel: string }>;
  },
>(env: E, models: string[], productById: ModelLookup): E {
  if (models.length === 0) return env;
  const want = new Set(models);
  return {
    ...env,
    products: env.products.filter((p) => want.has(quotationModelOf(p.productId, p.code, productById))),
    sofaCombos: env.sofaCombos.filter((c) => want.has(c.baseModel)),
  };
}
