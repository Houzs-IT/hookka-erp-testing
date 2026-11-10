// ---------------------------------------------------------------------------
// in-process-get.ts — read another router's GET handler from inside a request,
// without a network round trip and without re-implementing its maths.
//
// Same technique as doc-import.ts's makeCallRoute (the one place that already
// does this): a throwaway Hono wrapper copies the OUTER request's context
// variables (DB, userId, userRole, orgId …) onto the synthetic request, mounts
// the target router, and calls it in-process. The target route therefore runs
// its own permission check against the real caller, its own snapshot cache and
// its own SQL — the figures cannot drift from the page that route feeds.
//
// Why not a bare `app.request()`: a synthetic sub-request gets a FRESH context
// whose c.var is empty (the DB binding is attached by middleware on the parent
// app), so it throws — production-orders.ts's warm cron lost every call that
// way (2026-08-02). Copying the variables is what makes it work.
//
// GET only; read-only by construction.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";

export type InProcessResult<T = unknown> =
  | { ok: true; status: number; json: T }
  | { ok: false; status: number; error: string };

export type InProcessGet = <T = unknown>(app: Hono<Env>, path: string) => Promise<InProcessResult<T>>;

/** A GET caller bound to the outer request `c`. `path` is the router-relative path with its query, e.g. "/dashboard?from=2026-01&to=2026-10". */
export function makeInProcessGet(c: Context<Env>): InProcessGet {
  let execCtx: unknown;
  try {
    execCtx = c.executionCtx;
  } catch {
    // outside a Worker isolate (tests) — no waitUntil
  }
  const outerVars = Object.entries(c.var as Record<string, unknown>);
  const cookie = c.req.header("cookie");
  return async <T,>(app: Hono<Env>, path: string): Promise<InProcessResult<T>> => {
    const wrap = new Hono<Env>();
    wrap.use("*", async (ic, next) => {
      for (const [k, v] of outerVars) ic.set(k as never, v as never);
      await next();
    });
    wrap.route("/x", app);
    try {
      const res = await wrap.request(
        `/x${path.replace(/^\/(?=\?|$)/, "")}`,
        { method: "GET", headers: cookie ? { cookie } : {} },
        c.env,
        execCtx as never,
      );
      const json = (await res.json().catch(() => null)) as (T & { success?: boolean; error?: unknown }) | null;
      if (res.status >= 400 || !json || json.success === false) {
        const why = json && typeof json.error === "string" && json.error ? json.error : `HTTP ${res.status}`;
        return { ok: false, status: res.status, error: res.status === 403 ? `Not available to your role (${why})` : why };
      }
      return { ok: true, status: res.status, json };
    } catch (e) {
      return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
    }
  };
}
