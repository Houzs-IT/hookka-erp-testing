// ---------------------------------------------------------------------------
// poll-etag.ts — ETag / 304 on the GET lists the screens poll.
//
// The production-orders list got this first (#888: a bodyless 304 when the
// list is unchanged, measured 906 KB -> headers only). Houzs ported it to every
// polled list (Houzs#5484); this is the port back (cross-system review P3).
//
// On a GET 200 JSON reply from a path in POLLED_LIST_PATHS the body is hashed
// together with the caller's user id and org — two people, or one person in
// two orgs, can never share a tag even when the bodies are identical (Houzs
// found the browser offers one entry's tag on the next request regardless of
// Vary). A matching If-None-Match gets an empty 304; the browser then hands
// the page its stored copy as a normal 200, so no frontend change is needed.
//
// The body is NEVER changed: a non-matching request gets the same bytes it
// always did, plus an ETag header. Left alone: non-GET, non-200, non-JSON, and
// any reply that sets its own ETag, Cache-Control or Set-Cookie.
//
// The `/api/*` header middleware in worker.ts turns "has an ETag" into
// `Cache-Control: private, no-cache` (kept by this browser only, revalidated
// every time). This middleware must be registered AFTER auth + tenant (it
// reads userId / orgId) and before the routes.
// ---------------------------------------------------------------------------
import type { MiddlewareHandler } from "hono";

/** The GET endpoints a screen re-requests on a timer, and who polls them. */
export const POLLED_LIST_PATHS: ReadonlyArray<{ re: RegExp; polledBy: string }> = [
  { re: /^\/api\/notifications$/, polledBy: "sidebar bell, every 60 s" },
  { re: /^\/api\/it-support\/unread-count$/, polledBy: "sidebar IT badge, every 60 s" },
  { re: /^\/api\/it-support\/tickets$/, polledBy: "IT Support list, every 60 s" },
  { re: /^\/api\/it-support\/tickets\/[^/]+$/, polledBy: "IT Support ticket detail, every 30 s" },
  { re: /^\/api\/presence$/, polledBy: "use-presence (who else is editing), every 10 s" },
  { re: /^\/api\/scan-queue\/batch\/[^/]+$/, polledBy: "scan PO / supplier modals, every 5 s" },
  { re: /^\/api\/dashboard\/prototype$/, polledBy: "dashboard, every 30 min" },
];

export function isPolledListPath(path: string): boolean {
  return POLLED_LIST_PATHS.some((p) => p.re.test(path));
}

export async function pollEtagFor(body: string, identity: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${identity}\n${body}`));
  return `"${Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

/** Cloudflare weakens a tag when it compresses, so the browser may echo W/"…". */
export function ifNoneMatchHits(ifNoneMatch: string | undefined | null, tag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || v.replace(/^W\//, "") === tag;
  });
}

export const pollEtag: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.req.method !== "GET" || !isPolledListPath(c.req.path)) return;
  const res = c.res;
  if (res.status !== 200) return;
  if (res.headers.has("ETag") || res.headers.has("Cache-Control") || res.headers.has("Set-Cookie")) return;
  if (!(res.headers.get("Content-Type") ?? "").includes("application/json")) return;

  const get = (k: string) => (c as unknown as { get: (k: string) => unknown }).get(k);
  const identity = `${String(get("userId") ?? "")}|${String(get("orgId") ?? "")}`;
  const body = await res.clone().text();
  const tag = await pollEtagFor(body, identity);

  const headers = new Headers(res.headers);
  headers.set("ETag", tag);
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Authorization, Cookie` : "Authorization, Cookie");

  // Clear first: Hono's `c.res` setter otherwise copies the old reply's
  // headers (Content-Length included) onto the new one.
  c.res = undefined as unknown as Response;
  if (ifNoneMatchHits(c.req.header("If-None-Match"), tag)) {
    headers.delete("Content-Length");
    c.res = new Response(null, { status: 304, headers });
    return;
  }
  c.res = new Response(body, { status: 200, headers });
};
