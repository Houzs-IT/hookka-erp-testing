// ===========================================================================
// Inventory — data hooks and the permission map. Each tab reads only when it
// is open (WIP is slow, as on desktop). Every read keeps the hook's `failure`
// so a load failure is never shown as "empty" (class C15), and a 403 is shown
// as "no access" for that section only.
// ===========================================================================
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useCachedJson, type CachedFetchFailure } from "@/lib/cached-fetch";
import type { StockBreakdown } from "@/lib/stock-breakdown";
import { usePermissions } from "@/lib/use-permission";
import {
  dataRows, mergeFg, toAdj, toDeltas, toFabric, toRm, URLS, wipList,
  type AdjRow, type FabricRow, type FgRow, type RmRow, type WipRow,
} from "../../lib/inventory-lib";

export type ListState<T> = {
  rows: T[];
  /** Nothing to show yet (first load). */
  loading: boolean;
  /** The read failed and there is nothing cached to show. */
  failed: boolean;
  /** The server refused this read (403). */
  denied: boolean;
  error: string;
  /** A failure while showing cached rows (stale data). */
  stale: boolean;
  refresh: () => void;
  /** Changes whenever a read lands (used to end the Refresh spinner). */
  stamp: unknown;
};

type Res = { data: unknown; loading: boolean; error: string | null; failure: CachedFetchFailure | null; refresh: () => void };

function combine<T>(parts: Res[], rows: T[]): ListState<T> {
  const missing = parts.some((p) => p.data == null);
  const failure = parts.find((p) => p.failure)?.failure ?? null;
  const loading = missing && parts.some((p) => p.loading && !p.failure);
  return {
    rows,
    loading: loading && !failure,
    failed: missing && !!failure,
    denied: !!failure && failure.status === 403,
    error: failure?.message ?? "",
    stale: !missing && !!failure,
    refresh: () => parts.forEach((p) => p.refresh()),
    stamp: parts.map((p) => p.data ?? p.failure),
  };
}

/** Finished goods: the catalogue + fg-stock counts (both needed). */
export function useFgList(on: boolean): ListState<FgRow> {
  const products = useCachedJson<unknown>(on ? URLS.products : null);
  const stock = useCachedJson<unknown>(on ? URLS.fgStock : null);
  const rows = useMemo(
    () => (products.data && stock.data ? mergeFg(dataRows(products.data), toDeltas(stock.data)) : []),
    [products.data, stock.data],
  );
  return combine([products, stock], rows);
}

export function useWipList(on: boolean): ListState<WipRow> {
  const r = useCachedJson<unknown>(on ? URLS.wip : null);
  const rows = useMemo(() => wipList(r.data), [r.data]);
  return combine([r], rows);
}

export function useRmList(on: boolean): ListState<RmRow> {
  const r = useCachedJson<unknown>(on ? URLS.rm : null);
  const rows = useMemo(() => dataRows(r.data).map(toRm), [r.data]);
  return combine([r], rows);
}

export function useFabricList(on: boolean): ListState<FabricRow> {
  const r = useCachedJson<unknown>(on ? URLS.fabrics : null);
  const rows = useMemo(() => dataRows(r.data).map(toFabric), [r.data]);
  return combine([r], rows);
}

export function useAdjList(on: boolean): ListState<AdjRow> {
  const r = useCachedJson<unknown>(on ? URLS.adjustments : null);
  const rows = useMemo(() => dataRows(r.data).map(toAdj), [r.data]);
  return combine([r], rows);
}

// ---- permissions -------------------------------------------------------------------
export type InvPerms = {
  loading: boolean;
  /** The whole module: the desktop /inventory gate (inventory:read). */
  module: boolean;
  /** Fabrics tab: the desktop /inventory/fabrics gate (fabrics:read). */
  fabrics: boolean;
  /** Adjustments tab: the desktop /inventory/adjustments gate (stock-movements:read). */
  adjustments: boolean;
  /** Reduce stock: POST /api/stock-adjustments = inventory:create. */
  reduce: boolean;
};

/**
 * Every flag is false while the permission set is still loading (Batch 4
 * pattern). The nav gates come from the server (`isNavAllowed`); the per-tab
 * resource checks repeat the same rule the server uses to build them. The
 * API stays the authority either way.
 */
export function useInvPerms(): InvPerms {
  const { hasPermission: can, isNavAllowed, loading } = usePermissions();
  if (loading) return { loading, module: false, fabrics: false, adjustments: false, reduce: false };
  const module = isNavAllowed("/inventory") && can("inventory", "read");
  return {
    loading,
    module,
    fabrics: module && isNavAllowed("/inventory/fabrics") && can("fabrics", "read"),
    adjustments: module && isNavAllowed("/inventory/adjustments") && can("stock-movements", "read"),
    reduce: module && can("inventory", "create"),
  };
}

// ---- detail helpers -----------------------------------------------------------------
export function useBack(): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/m/inventory");
  };
}

export type Breakdown = {
  data: StockBreakdown | null;
  loading: boolean;
  failure: CachedFetchFailure | null;
  refresh: () => void;
};

export function useBreakdown(type: "FG" | "WIP" | "RM", itemId: string | null): Breakdown {
  const r = useCachedJson<{ success?: boolean; data?: StockBreakdown }>(itemId ? URLS.breakdown(type, itemId) : null);
  const d = r.data?.data;
  const ok = !!d && typeof d === "object" && !!(d as StockBreakdown).header;
  return { data: ok ? (d as StockBreakdown) : null, loading: r.loading && !r.data && !r.failure, failure: r.failure, refresh: r.refresh };
}

