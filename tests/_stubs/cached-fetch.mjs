// Test stub for "@/lib/cached-fetch": serves fixture data synchronously so a screen can be
// server-rendered in node:test. Fixtures are looked up by URL prefix on
// globalThis.__CACHED_FIXTURES__ (longest matching prefix wins); no fixture = no data.
function lookup(url) {
  const fx = globalThis.__CACHED_FIXTURES__ || {};
  if (!url) return undefined;
  const key = Object.keys(fx).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key === undefined ? undefined : fx[key];
}
export function useCachedJson(url) {
  const data = lookup(url);
  return { data: data ?? null, loading: false, error: null, refresh() {}, isValidating: false };
}
export function peekCache() { return null; }
export function invalidateCache() {}
export function invalidateCachePrefix() {}
export function clearAllCache() {}
export async function cachedFetchJson() { return null; }
export async function cachedFetchJsonResult() { return { ok: false }; }
