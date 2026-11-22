// ---------------------------------------------------------------------------
// actor-name.ts — who is making this request, as a name a person can read.
//
// Price and BOM writes used to take "changedBy" from the request body, and no
// screen ever sent one, so every supplier price change was logged as
// "System" (found 2026-11-22, docs/plans/product-costing.md "Known gaps").
// The server knows the signed-in user (auth middleware stamps userId), so the
// name comes from there; the body value is only a fallback for cron/system
// callers that have no user.
// ---------------------------------------------------------------------------
import type { Context } from "hono";
import type { Env } from "../worker";

export async function actorName(c: Context<Env>, fallback?: unknown): Promise<string> {
  const get = (c as unknown as { get: (k: string) => string | undefined }).get;
  const userId = get.call(c, "userId") ?? null;
  const typed = typeof fallback === "string" && fallback.trim() ? fallback.trim() : "System";
  if (!userId || userId.startsWith("system:")) return typed;
  try {
    const u = await c.var.DB.prepare("SELECT displayName, email FROM users WHERE id = ? LIMIT 1")
      .bind(userId)
      .first<Record<string, unknown>>();
    const name = u?.displayName ?? u?.display_name ?? u?.email;
    return name ? String(name) : userId;
  } catch {
    return userId;
  }
}
