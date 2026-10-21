// ---------------------------------------------------------------------------
// idempotency.ts — Sprint 3 #4 idempotency wrapper for money POST routes.
//
// Money-mutating endpoints (sales-orders, invoices, payments) must be
// safe to retry. A network blip during the round-trip leaves the client
// uncertain whether the server saw the request — a retry could create a
// duplicate sales order, double-collect a payment, or fan out two
// invoice records for the same delivery.
//
// Spec:
//   * Client sends `Idempotency-Key: <uuid>` header on the POST.
//   * Server hashes (org, resource, key) into a KV cache key. The org is
//     part of the key so two tenants sending the same key never collide
//     (BUG-2026-10-20-370).
//   * The SHA-256 of the raw request body is stored with the entry. The
//     same key with a DIFFERENT body is a client bug, not a retry: it
//     gets 422 instead of the first request's response
//     (BUG-2026-10-20-371).
//   * First request runs the handler, stores the response (status + JSON
//     body) in KV with a 24h TTL, returns the response.
//   * Subsequent requests with the same (resource, key) read from KV and
//     return the cached response — bit-for-bit identical to the first.
//
// Key collision: while a request is in-flight, a duplicate retry races
// against the cache write. We mark the slot with a sentinel
// (`{state: 'pending', startedAt}`) on entry, so a concurrent retry
// returns a 409 Conflict with a Retry-After hint instead of executing
// the handler twice. The pending sentinel is overwritten with the final
// response when the handler completes.
//
// What if the handler throws?
//   * The pending sentinel is DELETED so a future retry can run cleanly.
//   * We deliberately do NOT cache 5xx responses — the client should be
//     able to retry a transient failure and get a different outcome.
//   * 4xx responses ARE cached so the client gets the same validation
//     error on retry (matches Stripe / IETF idempotency-key draft).
//
// What if the client sends NO header?
//   * No-op. The handler runs as before. Idempotency is opt-in.
//
// Storage budget per cached response: ~5KB for typical money-API JSON.
// At 1k POSTs/day with a 24h TTL, that's 5MB resident — well within
// the SESSION_CACHE budget.
// ---------------------------------------------------------------------------
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../worker";
import { tryGetOrgId } from "./tenant";

const TTL_SECONDS = 60 * 60 * 24; // 24h
const PENDING_TTL_SECONDS = 60 * 5; // 5min — enough for a slow handler
const MAX_KEY_LENGTH = 200;

type CachedResponse = {
  state: "complete";
  bodyHash: string;
  status: number;
  body: unknown;
  storedAt: string;
};

type PendingMarker = {
  state: "pending";
  bodyHash: string;
  startedAt: string;
};

type CacheEntry = CachedResponse | PendingMarker;

/**
 * Read the `Idempotency-Key` header. Returns null if absent / empty /
 * suspiciously long. Trimmed of whitespace.
 */
export function readIdempotencyKey(c: Context<Env>): string | null {
  const raw = c.req.header("idempotency-key") ?? c.req.header("Idempotency-Key");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) return null;
  return trimmed;
}

function cacheKey(orgId: string, resource: string, key: string): string {
  return `idem:${orgId}:${resource}:${key}`;
}

// Hash the raw bytes without consuming the body the handler will read.
// Wrappers sit at the route entry, before anything reads the body; if
// something already did, Hono's body cache still has it as text.
async function hashRequestBody(c: Context<Env>): Promise<string> {
  const buf = c.req.raw.bodyUsed
    ? new TextEncoder().encode(await c.req.text())
    : await c.req.raw.clone().arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Wrap a POST handler with idempotency. Pass the resource name (e.g.
 * "sales-orders") and the per-request key (from `readIdempotencyKey`).
 *
 * - If the client did not send a key, runs `handler` directly.
 * - If a complete cache hit exists, returns the cached response.
 * - If a pending marker exists, returns 409 Conflict.
 * - Otherwise, marks the slot pending, runs the handler, caches the
 *   final response (or clears the marker on throw / 5xx).
 *
 * The handler must return a Hono `Response` object. We capture status +
 * JSON body and reconstruct an equivalent response on cache replay.
 */
export async function withIdempotency(
  c: Context<Env>,
  resource: string,
  key: string | null,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (!key) return handler();

  const kv = c.env.SESSION_CACHE;
  if (!kv) {
    // KV namespace not bound (e.g. in some test envs). Idempotency
    // becomes a no-op — better to serve the request than to 500.
    return handler();
  }

  // No org (system paths) shares one "_" bucket — same as before scoping.
  const k = cacheKey(tryGetOrgId(c) ?? "_", resource, key);
  const bodyHash = await hashRequestBody(c);

  // 1. Check for an existing entry.
  let existing: CacheEntry | null = null;
  try {
    existing = await kv.get<CacheEntry>(k, { type: "json" });
  } catch {
    /* KV read failure is non-fatal — fall through and run the handler */
  }

  if (existing && existing.bodyHash !== bodyHash) {
    return new Response(
      JSON.stringify({
        success: false,
        error:
          "This Idempotency-Key was already used with a different request body. Use a new key for a new request.",
      }),
      { status: 422, headers: { "content-type": "application/json" } },
    );
  }

  if (existing?.state === "complete") {
    // Cache hit: replay the original response.
    return new Response(JSON.stringify(existing.body), {
      status: existing.status,
      headers: {
        "content-type": "application/json",
        "idempotency-replay": "true",
      },
    });
  }

  if (existing?.state === "pending") {
    // Concurrent retry while the original request is still running.
    return new Response(
      JSON.stringify({
        success: false,
        error:
          "A request with this Idempotency-Key is already in flight. Retry once it completes.",
        // Lets the client tell this 409 from a business-rule 409: the
        // attempt is still unresolved, so it must keep its key.
        inFlight: true,
      }),
      {
        status: 409,
        headers: {
          "content-type": "application/json",
          "retry-after": "5",
          "idempotency-in-flight": "true",
        },
      },
    );
  }

  // 2. Mark pending so concurrent retries 409 instead of double-running.
  const pending: PendingMarker = {
    state: "pending",
    bodyHash,
    startedAt: new Date().toISOString(),
  };
  try {
    await kv.put(k, JSON.stringify(pending), {
      expirationTtl: PENDING_TTL_SECONDS,
    });
  } catch {
    /* KV write failure: still try to run the handler */
  }

  // 3. Execute the handler.
  let res: Response;
  try {
    res = await handler();
  } catch (e) {
    // Clear the pending marker so a retry can succeed cleanly.
    try {
      await kv.delete(k);
    } catch {
      /* swallow */
    }
    throw e;
  }

  // 4. Cache the response (only 2xx and 4xx — never 5xx, and never 401/403:
  //    a permission answer can change, it is not the request's outcome).
  if (res.status >= 500 || res.status === 401 || res.status === 403) {
    try {
      await kv.delete(k);
    } catch {
      /* swallow */
    }
    return res;
  }

  // We need to read the body so we can both cache it and return it. Clone
  // before reading so the original response stream is intact for the SPA.
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    // Non-JSON response — skip caching but still return the response.
    try {
      await kv.delete(k);
    } catch {
      /* swallow */
    }
    return res;
  }

  const complete: CachedResponse = {
    state: "complete",
    bodyHash,
    status: res.status,
    body,
    storedAt: new Date().toISOString(),
  };
  try {
    await kv.put(k, JSON.stringify(complete), {
      expirationTtl: TTL_SECONDS,
    });
  } catch {
    /* swallow — better to return the live response than to 500 */
  }
  return res;
}

/**
 * Same wrapper as Hono route middleware, so a route opts in with one
 * changed line and no re-indent:
 *   app.post("/", idempotent(), async (c) => { ... })
 * The resource is the method + full path, so a path id (CN convert's
 * `/:id/`) is part of the key. It runs before the handler's RBAC gate,
 * which is why 401/403 are never cached (see withIdempotency).
 */
export function idempotent(): MiddlewareHandler<Env> {
  return (c, next) =>
    withIdempotency(c, `${c.req.method} ${c.req.path}`, readIdempotencyKey(c), async () => {
      await next();
      return c.res;
    });
}
