// What the supplier-document scan sheets (Purchase Invoice, Goods Receipt) load before a review can be built:
// suppliers, organisations, raw materials, supplier-material bindings, purchase orders (only when the role may read
// them) and the taught supplier aliases. Reads only. Returns an error text when the supplier list itself is unavailable.
import { fetchPartyAliases } from "@/lib/party-alias-client";
import { piContextFrom, type PiContext } from "../../lib/scan-pi";

export async function loadSupplierContext(canReadPos: boolean): Promise<{ ctx: PiContext | null; error: string | null }> {
  const get = async (url: string) => {
    try {
      const res = await fetch(url, { credentials: "include" });
      const j = (await res.json().catch(() => null)) as Record<string, unknown> | unknown[] | null;
      return { ok: res.ok, status: res.status, j };
    } catch {
      return { ok: false, status: 0, j: null };
    }
  };
  const rowsOf = (j: unknown): unknown => (Array.isArray(j) ? j : (j as { data?: unknown } | null)?.data ?? []);
  const [sup, org, mat, bind, po, aliases] = await Promise.all([
    get("/api/suppliers"), get("/api/organisations"), get("/api/inventory?buckets=rawMaterials"), get("/api/supplier-materials"),
    canReadPos ? get("/api/purchase-orders") : Promise.resolve({ ok: true, status: 200, j: [] as unknown }),
    fetchPartyAliases("SUPPLIER"),
  ]);
  if (!sup.ok) return { ctx: null, error: sup.status === 403 ? "Your role cannot see the supplier list, which the review needs." : `Could not load the suppliers (HTTP ${sup.status || "network"}).` };
  return {
    error: null,
    ctx: piContextFrom({
      suppliers: rowsOf(sup.j),
      orgs: (org.j as { organisations?: unknown } | null)?.organisations ?? [],
      materials: ((mat.j as { data?: { rawMaterials?: unknown } } | null)?.data?.rawMaterials) ?? [],
      bindings: rowsOf(bind.j),
      purchaseOrders: rowsOf(po.j),
    }, aliases),
  };
}
