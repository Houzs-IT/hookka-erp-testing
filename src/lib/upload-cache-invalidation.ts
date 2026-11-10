// ---------------------------------------------------------------------------
// upload-cache-invalidation.ts — an upload clears the read cache (O5).
//
// `useCachedJson` keeps the last response per URL (localStorage + memory) and
// serves it first. JSON saves invalidate it by hand at each call site; uploads
// never did. So a photo / attachment uploaded on one screen was missing from a
// cached file list (`/api/files?resourceType=…`, the mobile document and line
// screens, the report editions' model photos) until the cache aged out, and
// staff uploaded it again. Sister fix: Houzs#5478 (from Conts#713).
//
// Decided centrally, in the global fetch patch (src/lib/api-client.ts), so
// every upload surface — uploadFileAsset, the raw `fetch("/api/files")` calls,
// any future one — is covered without touching its page. A FAILED upload
// leaves the cache alone (nothing changed on the server).
//
// Pure: no window, no cache import, so it is unit-tested in node.
// ---------------------------------------------------------------------------

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True for a request body that carries a file (multipart form or raw bytes). */
export function isUploadBody(body: unknown): boolean {
  if (body == null) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) return true;
  return false;
}

/**
 * Cache prefixes to drop after a SUCCESSFUL request, or [] for none.
 *
 *  - any write to the shared file store (`/api/files`, `/api/files/:id`,
 *    `/api/files/:id/cover`) → every cached `/api/files…` list;
 *  - an upload body sent anywhere else (e.g. a POD photo on a record) → that
 *    record's cached reads, `/api/<module>/<id>`.
 */
export function uploadInvalidationPrefixes(method: string, path: string, body: unknown): string[] {
  if (!MUTATING.has(method.toUpperCase())) return [];
  if (/^\/api\/files(\/|$)/.test(path)) return ["/api/files"];
  if (!isUploadBody(body)) return [];
  const parts = path.split("/").filter(Boolean); // ["api", module, id, ...]
  if (parts[0] !== "api" || parts.length < 2) return [];
  return [`/${parts.slice(0, Math.min(parts.length, 3)).join("/")}`];
}
