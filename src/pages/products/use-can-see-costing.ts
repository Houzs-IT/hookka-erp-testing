import { usePermissions } from "@/lib/use-permission";

/**
 * Product costs are locked to Super Admin / Admin / Finance / R&D (owner
 * 2026-11-26): the same test as requireCostingRead in
 * src/api/routes/product-costing.ts.
 */
export function useCanSeeCosting(): boolean {
  const { hasPermission } = usePermissions();
  return hasPermission("product-costing", "read") || hasPermission("cost-ledger", "read");
}
