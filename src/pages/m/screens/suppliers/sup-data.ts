// Suppliers — shared reads: the purchase companies (GET /api/organisations,
// active ones, code + legal name — the desktop Edit Supplier list) and the
// permission flags every surface is gated on.
import { useMemo } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import type { OrgOpt } from "./SupplierForm";

type OrgsResp = { organisations?: Array<{ code?: string; name?: string; isActive?: boolean }> };

export function useOrgOptions(): OrgOpt[] {
  const r = useCachedJson<OrgsResp>("/api/organisations");
  return useMemo(
    () => (r.data?.organisations ?? []).filter((o) => o.isActive !== false && o.code).map((o) => ({ code: String(o.code), name: String(o.name ?? "") })),
    [r.data],
  );
}

export type SupPerms = {
  loading: boolean;
  create: boolean; update: boolean;
  /** Pricing tab + Quotation PDF. */ materials: boolean;
  /** History → Price changes. */ priceHistory: boolean;
  /** History → PO lines. */ poLines: boolean;
  /** Info scorecard + POs tab. */ scorecards: boolean;
};

/** Every flag is false while the permission set is still loading, so nothing restricted flashes in. */
export function useSupPerms(): SupPerms {
  const { hasPermission, loading } = usePermissions();
  const can = (r: string, a: string) => !loading && hasPermission(r, a);
  return {
    loading,
    create: can("suppliers", "create"),
    update: can("suppliers", "update"),
    materials: can("supplier-materials", "read"),
    priceHistory: can("price-history", "read"),
    poLines: can("purchase-orders", "read"),
    scorecards: can("supplier-scorecards", "read"),
  };
}
