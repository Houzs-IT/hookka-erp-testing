// ============================================================================
// /m preload — warm the localStorage cache for the FEW endpoints the Home
// screen actually paints on first load, and nothing else.
//
// 2026-07-04 weak-wifi slim (WORK-TRACKER "cure queue"): the old preload fired
// 18 endpoints in parallel at shell mount — including heavy module lists the
// Home never renders (/api/delivery-orders ~652KB, /api/purchase-orders,
// /api/invoices, /api/production-orders, /api/raw-materials,
// /api/mail-center/threads, /api/payslips, …). Measured cost: /m home = 4.3MB
// across ~20 calls. On a factory phone with weak wifi those 18 parallel
// requests SATURATE the link and STARVE the handful the Home genuinely needs,
// so the dashboard paints slower, not faster. That is the opposite of what a
// preload is for.
//
// Slim rule — preload ONLY the Home's own first-paint endpoints (the cheap KPI
// rail + Stock alerts + Orders-due). Everything else now loads ON DEMAND:
//   • Module lists (Sales / Delivery / Procurement / …) — each
//     ModuleListScreen fetches its own source via useCachedJson on VISIT.
//   • Global Search — GlobalSearchSheet already warms every module endpoint
//     itself when the sheet OPENS (ALL_SOURCE_URLS), so search is unaffected.
// Both paths are cache-backed + deduped, so the first real interaction warms
// them; the persistent localStorage cache still primes the operator's next
// visit. Net: far less contention at boot, faster dashboard on weak wifi, zero
// feature loss.
//
// Cache backing is localStorage (src/lib/cached-fetch.ts) so the warm-up
// PERSISTS across the next reload too.
// ============================================================================
import { cachedFetchJson, peekCache } from "@/lib/cached-fetch";
import { hasPermissionIn } from "@/lib/use-permission";

/** How many Orders-due cards the /m Home renders (sent to the server as ?top=). */
export const ORDERS_DUE_TOP = 6;

/**
 * The Orders-due URL — exported and imported by Home.tsx rather than written
 * out twice. The localStorage cache (src/lib/cached-fetch.ts) is keyed by URL,
 * so a preload that warms a DIFFERENT string from the one the screen requests
 * is a silent double fetch. One constant makes that impossible.
 */
export const ORDERS_DUE_URL = `/api/sales-orders?fields=orders-due&top=${ORDERS_DUE_TOP}`;

/**
 * The Home's Stock-alerts URL — exported for the SAME reason as ORDERS_DUE_URL
 * above: the cache is keyed by the exact URL string, so preloading a different
 * one than Home.tsx requests is a silent double fetch.
 *
 * perf 2026-08-13 (BUG-2026-08-13-021): this was the bare "/api/inventory" —
 * all three buckets, 1.16 MB, of which the Home reads ONLY `rawMaterials` (the
 * "at/below reorder" chips). After BUG-2026-08-13-011/-013 removed the
 * whole-org delivery + sales-order pulls, this single call was 91% of what was
 * left of the /m Home payload. `?buckets=rawMaterials` ships the identical RM
 * array (same SELECT, same ORDER BY, same rowToRawMaterial) and drops the
 * 365-row product catalogue and the WIP bucket, neither of which the Home
 * touches.
 */
export const STOCK_ALERTS_URL = "/api/inventory?buckets=rawMaterials";

function buildEndpoints(): string[] {
  // Current "YYYY-MM" — the Home's default Command Center period.
  const ym = new Date().toISOString().slice(0, 7);
  return [
    // ---- Home v10 first paint: the two feeds its Sales view opens on (the month
    // list + problem tiles, and the month's totals). Orders-due and Stock alerts
    // belonged to the old Home presentation and are no longer drawn on /m. ----
    "/api/dashboard/prototype",
    `/api/dashboard/overview?period=${ym}`,
  ];
}

/**
 * The Home dashboard is warmed only for a user the CACHED permission set already
 * says may open it (dashboard nav gate + sales read, or a tab list with sales).
 * First visit (nothing cached) warms nothing: the dashboard fetches for itself
 * once permissions load. This keeps a user with no dashboard access from having
 * company-wide figures pulled into their browser cache by a warm-up that has not
 * asked the permission question yet.
 */
function mayWarmDashboard(): boolean {
  const p = peekCache<{ permissions?: string[]; navHidden?: string[]; dashboardTabs?: string[] | null }>("/api/auth/me/permissions");
  if (!p) return false;
  const gate = "/dashboard-experimental";
  if ((p.navHidden ?? []).some((h) => gate === h || gate.startsWith(`${h}/`))) return false;
  if (p.dashboardTabs) return p.dashboardTabs.includes("sales");
  return hasPermissionIn(new Set(p.permissions ?? []), "sales-orders", "read");
}

/** True only on the Home route (basename is /m, Home = the index "/"). */
function isHomeLanding(): boolean {
  // pathname is "/m" or "/m/" on Home; "/m/production", "/m/sales", … elsewhere.
  const p = (globalThis.location?.pathname || "").replace(/\/+$/, "");
  return p === "/m" || p === "";
}

/**
 * Warm the Home's first-paint endpoints — but ONLY when the operator actually
 * LANDED on Home. On any other landing this is pure waste.
 *
 * Why route-gate (2026-07-14 mobile-lag fix): the shell mounts this once for the
 * WHOLE /m session, regardless of landing route. A factory worker who opens
 * straight to /m/production doesn't need Home's cards — yet the eager warm-up
 * fired /api/dashboard/overview (a ~7.6s compute-bound query), the full
 * /api/sales-orders (~100KB) and /api/inventory (~95KB) in parallel, saturating
 * the phone's link and starving the production board's own fetch. Home fetches
 * these itself via useCachedJson (and every other screen fetches its own), so
 * the only value of this warm-up is the Home-landing case — where it coalesces
 * with Home's own fetch via cachedFetchJson's in-flight dedup. Gating on the
 * landing route removes the contention on every non-Home screen with zero loss:
 * navigating TO Home later still triggers Home's own cache-backed fetch.
 * (Idle-gating was tried first and doesn't help — the main thread goes idle
 * within a frame of mount, so the deferred fetches still race the board.)
 */
export function preloadMobileCritical(): void {
  if (!isHomeLanding() || !mayWarmDashboard()) return;
  for (const url of buildEndpoints()) {
    // Best-effort background warm-up; a failed one just falls back to an
    // on-demand fetch on first navigation.
    void cachedFetchJson(url).catch(() => {});
  }
}
