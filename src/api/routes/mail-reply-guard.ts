// ---------------------------------------------------------------------------
// Mail Center reply guard + waiting badge routes (Houzs parity rows 13 + 21).
// Registered on the Mail Center app by routes/mail-center.ts, which hands in
// its own getMailScope so the visibility rule stays in one place. Rules:
// lib/mail-reply-guard.ts.
//
//   POST /api/mail-center/threads/:id/replying { drafting }  the reply box heartbeat
//   GET  /api/mail-center/waiting-count                      the sidebar badge
// ---------------------------------------------------------------------------
import type { Context, Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { replyingOn, setReplying, waitingCount } from "../lib/mail-reply-guard";
import { ensureMailParitySchema, mailMaintenanceSoon } from "../lib/mail-delivery-refresh";

type Scope = { isAdmin: boolean; userId: string; addresses: string[] };

export function registerReplyGuardRoutes(
  app: Hono<Env>,
  getMailScope: (c: Context<Env>, orgId: string) => Promise<Scope>,
  displayName: (db: D1Database, userId: string) => Promise<string>,
): void {
  app.post("/threads/:id/replying", async (c) => {
    const denied = await requirePermission(c, "mail-center", "create");
    if (denied) return denied;
    await ensureMailParitySchema(c.var.DB);
    const orgId = getOrgId(c);
    const id = c.req.param("id");
    const scope = await getMailScope(c, orgId);
    if (!scope.userId) return c.json({ error: "Sign in again." }, 401);
    const thread = await c.var.DB.prepare(
      `SELECT mailbox_address AS "mailboxAddress" FROM email_threads WHERE org_id = ? AND id = ? LIMIT 1`,
    )
      .bind(orgId, id)
      .first<{ mailboxAddress: string | null }>();
    if (!thread || (!scope.isAdmin && !scope.addresses.includes((thread.mailboxAddress ?? "").toLowerCase()))) {
      return c.json({ error: "Thread not found" }, 404);
    }
    const body = await c.req.json<{ drafting?: boolean }>().catch(() => ({}) as { drafting?: boolean });
    const drafting = body.drafting === true;
    await setReplying(c.var.DB, {
      orgId,
      threadId: id,
      userId: scope.userId,
      userName: drafting ? (await displayName(c.var.DB, scope.userId)) || null : null,
      drafting,
    });
    // While I type, each beat also tells me who else is writing and the
    // newest message id, so the box can pull in a colleague's reply at once.
    const latest = await c.var.DB.prepare(
      `SELECT id FROM email_messages WHERE org_id = ? AND thread_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(orgId, id)
      .first<{ id: string }>();
    return c.json({
      ok: true,
      replying: drafting ? await replyingOn(c.var.DB, orgId, id, scope.userId) : [],
      latestMessageId: latest?.id ?? null,
    });
  });

  app.get("/waiting-count", async (c) => {
    c.header("Cache-Control", "no-store");
    const denied = await requirePermission(c, "mail-center", "read");
    if (denied) return c.json({ count: 0 });
    const userId = (c as unknown as { get: (k: string) => string | undefined }).get("userId") ?? "";
    if (!userId) return c.json({ count: 0 });
    // This poll (once a minute per open tab) is the Mail Center's clock: it
    // retries queued sends and refreshes Delivered / Bounced after answering.
    mailMaintenanceSoon(c);
    try {
      return c.json({ count: await waitingCount(c.var.DB, getOrgId(c), userId) });
    } catch (e) {
      console.warn("[mail-center] waiting-count failed:", e instanceof Error ? e.message : String(e));
      return c.json({ count: 0 });
    }
  });
}
