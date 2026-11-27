// ---------------------------------------------------------------------------
// /api/mcp-admin — Settings › AI Connector (docs/plans/mcp-connector.md).
//
// Staff (any login): /me — am I allowed, my connected apps, what the AI looked
// up for me; Request access; Disconnect my own app.
// Super Admin only (owner 2026-11-25 「谁有approval」 → only the owner for now):
// overview, approve / reject requests, give / remove access, disconnect anyone,
// the question log, and the "Allow AI actions (meetings, email)" switch
// (owner 2026-11-26, default OFF — lib/mcp-actions.ts).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { requireSuperAdmin } from "../lib/rbac";
import { emitAudit } from "../lib/audit";
import { DEFAULT_ORG_ID } from "../lib/tenant";
import { ensureNotificationsUserColumn } from "./it-support";
import { appLabel, ensureMcpTables, hasMcpAccess, issueTokens, randomToken, revokeToken, revokeUserTokens } from "../lib/mcp-store";
import { analyseToolText, leakCheckTargets, LEAK_CHECK_TOOLS, type LeakRow } from "../lib/mcp-leak-check";
import { mcpAppRoutes, runToolAs } from "./mcp";
import { actionsEnabled, setActionsEnabled, setWriteActionSwitch, WRITE_ACTIONS, writeActionSwitches, type WriteAction } from "../lib/mcp-actions";
import { LEAK_CHECK_CLIENT_ID, latencyByTool, RATE_PER_DAY, RATE_PER_MINUTE } from "../lib/mcp-limits";

const LIMITS = { perMinute: RATE_PER_MINUTE, perDay: RATE_PER_DAY };

const app = new Hono<Env>();

const uid = (c: Context<Env>): string => String((c as unknown as { get: (k: string) => unknown }).get("userId") ?? "");
const role = (c: Context<Env>): string => String((c as unknown as { get: (k: string) => unknown }).get("userRole") ?? "").toUpperCase();
const s = (r: Record<string, unknown>, ...k: string[]): string => {
  // Empty strings fall through too: a blank display name should show the email, not nothing.
  for (const key of k) if (r[key] !== undefined && r[key] !== null && r[key] !== "") return String(r[key]);
  return "";
};
const n = (r: Record<string, unknown>, ...k: string[]): number => Number(s(r, ...k)) || 0;

function callRow(r: Record<string, unknown>) {
  return {
    at: s(r, "created_at", "createdAt"),
    userId: s(r, "user_id", "userId"),
    name: s(r, "display_name", "displayName", "displayname", "email"),
    app: appLabel(s(r, "client_name", "clientName")),
    tool: s(r, "tool"),
    target: s(r, "target"),
    ok: n(r, "ok") === 1,
    status: n(r, "status"),
    note: s(r, "note"),
  };
}

function tokenRow(r: Record<string, unknown>) {
  return {
    tokenId: s(r, "id"),
    userId: s(r, "user_id", "userId"),
    name: s(r, "display_name", "displayName", "displayname", "email"),
    role: s(r, "role"),
    app: appLabel(s(r, "client_name", "clientName")),
    connectedAt: s(r, "created_at", "createdAt"),
    lastUsedAt: s(r, "last_used_at", "lastUsedAt") || null,
  };
}

// ── staff ───────────────────────────────────────────────────────────────────

app.get("/me", async (c) => {
  const db = c.var.DB;
  await ensureMcpTables(db);
  const me = uid(c);
  const allowed = await hasMcpAccess(db, me, role(c));
  const toks = await db
    .prepare(
      `SELECT t.id, t.user_id, t.created_at, t.last_used_at, cl.client_name
         FROM mcp_tokens t LEFT JOIN mcp_oauth_clients cl ON cl.client_id = t.client_id
        WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.refresh_expires_at > ?
        ORDER BY t.created_at DESC`,
    )
    .bind(me, new Date().toISOString())
    .all<Record<string, unknown>>();
  const calls = await db
    .prepare(
      `SELECT k.*, cl.client_name FROM mcp_calls k LEFT JOIN mcp_oauth_clients cl ON cl.client_id = k.client_id
        WHERE k.user_id = ? ORDER BY k.created_at DESC LIMIT 50`,
    )
    .bind(me)
    .all<Record<string, unknown>>();
  const pending = await db
    .prepare("SELECT id, created_at FROM mcp_access_requests WHERE user_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1")
    .bind(me)
    .first<Record<string, unknown>>();
  return c.json({
    success: true,
    data: {
      allowed,
      isSuperAdmin: role(c) === "SUPER_ADMIN",
      actionsEnabled: await actionsEnabled(db),
      writeActions: await writeActionSwitches(db),
      limits: LIMITS,
      connectorUrl: `${new URL(c.req.url).origin}/api/mcp`,
      connections: (toks.results ?? []).map(tokenRow),
      calls: (calls.results ?? []).map(callRow),
      pendingRequestAt: pending ? s(pending, "created_at", "createdAt") : null,
    },
  });
});

app.post("/me/request", async (c) => {
  const db = c.var.DB;
  await ensureMcpTables(db);
  const me = uid(c);
  if (await hasMcpAccess(db, me, role(c))) return c.json({ success: true, data: { already: true } });
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const open = await db.prepare("SELECT id FROM mcp_access_requests WHERE user_id = ? AND status = 'PENDING'").bind(me).first();
  if (open) return c.json({ success: true, data: { pending: true } });
  const id = `mcpr_${randomToken(12)}`;
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO mcp_access_requests (id, user_id, reason, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)")
    .bind(id, me, reason, now)
    .run();
  // Bell for every Super Admin (the approvers).
  try {
    await ensureNotificationsUserColumn(db);
    const who = await db.prepare("SELECT displayName, email, orgId FROM users WHERE id = ?").bind(me).first<Record<string, unknown>>();
    const name = who ? s(who, "display_name", "displayName", "displayname", "email") : me;
    const admins = await db.prepare("SELECT id, orgId FROM users WHERE role = 'SUPER_ADMIN' AND isActive = 1").all<Record<string, unknown>>();
    const stmts = (admins.results ?? []).map((a) =>
      db
        .prepare(
          `INSERT INTO notifications (id, type, title, message, severity, is_read, link, created_at, org_id, user_id)
           VALUES (?, 'SYSTEM', ?, ?, 'INFO', 0, '/settings/ai-connector', ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        )
        .bind(`${id}-${s(a, "id")}`, `AI Connector request: ${name}`, reason || "Asked to use Claude / ChatGPT with Hookka ERP", now, s(a, "orgId", "orgid") || DEFAULT_ORG_ID, s(a, "id")),
    );
    if (stmts.length) await db.batch(stmts);
  } catch (e) {
    console.warn("[mcp-admin] request notification failed:", e instanceof Error ? e.message : String(e));
  }
  await emitAudit(c, { resource: "ai-connector", resourceId: id, action: "create", after: { request: me, reason } });
  return c.json({ success: true, data: { pending: true } });
});

app.post("/me/revoke", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { tokenId?: unknown };
  const tokenId = typeof body.tokenId === "string" ? body.tokenId : "";
  if (!tokenId) return c.json({ success: false, error: "tokenId required" }, 400);
  const nRevoked = await revokeToken(c.var.DB, tokenId, uid(c));
  if (nRevoked) await emitAudit(c, { resource: "ai-connector", resourceId: tokenId, action: "delete", after: { disconnectedBy: "self" } });
  return c.json({ success: true, data: { revoked: nRevoked } });
});

// ── Super Admin ─────────────────────────────────────────────────────────────

app.get("/admin/overview", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const db = c.var.DB;
  await ensureMcpTables(db);
  const now = new Date();
  const nowIso = now.toISOString();
  const myDay = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10); // Malaysia date
  const dayStart = new Date(`${myDay}T00:00:00+08:00`).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const userFilter = c.req.query("userId") ?? "";

  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 3600 * 1000).toISOString();
  const [conns, allowedRows, reqs, calls, today, week, timing] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.user_id, t.created_at, t.last_used_at, cl.client_name, u.displayName AS display_name, u.email, u.role
           FROM mcp_tokens t
           LEFT JOIN mcp_oauth_clients cl ON cl.client_id = t.client_id
           LEFT JOIN users u ON u.id = t.user_id
          WHERE t.revoked_at IS NULL AND t.refresh_expires_at > ?
          ORDER BY COALESCE(t.last_used_at, t.created_at) DESC`,
      )
      .bind(nowIso)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT a.user_id, a.approved_at, u.displayName AS display_name, u.email, u.role
           FROM mcp_access a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.approved_at DESC`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT r.id, r.user_id, r.reason, r.status, r.created_at, u.displayName AS display_name, u.email, u.role
           FROM mcp_access_requests r LEFT JOIN users u ON u.id = r.user_id
          WHERE r.status = 'PENDING' ORDER BY r.created_at ASC`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT k.*, cl.client_name, u.displayName AS display_name, u.email
           FROM mcp_calls k
           LEFT JOIN mcp_oauth_clients cl ON cl.client_id = k.client_id
           LEFT JOIN users u ON u.id = k.user_id
          ${userFilter ? "WHERE k.user_id = ?" : ""}
          ORDER BY k.created_at DESC LIMIT 200`,
      )
      .bind(...(userFilter ? [userFilter] : []))
      .all<Record<string, unknown>>(),
    db
      .prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN ok = 0 AND status = 403 THEN 1 ELSE 0 END) AS refused FROM mcp_calls WHERE created_at >= ?")
      .bind(dayStart)
      .first<Record<string, unknown>>(),
    db
      .prepare("SELECT user_id, COUNT(*) AS n FROM mcp_calls WHERE created_at >= ? GROUP BY user_id")
      .bind(weekAgo)
      .all<Record<string, unknown>>(),
    // Latency per tool (round 3): the last 24 h against the 7 days before.
    // mcp_calls.ms has been logged since launch, so the earlier window is the
    // "before" for any change shipped in the last day.
    db
      .prepare(
        `SELECT tool, ms, note, created_at FROM mcp_calls
          WHERE created_at >= ? AND COALESCE(client_id, '') <> ? AND COALESCE(status, 0) <> 429
          ORDER BY created_at DESC LIMIT 20000`,
      )
      .bind(eightDaysAgo, LEAK_CHECK_CLIENT_ID)
      .all<Record<string, unknown>>(),
  ]);
  const timingRows = (timing.results ?? []).map((r) => ({ tool: s(r, "tool"), ms: n(r, "ms"), note: s(r, "note"), at: s(r, "created_at", "createdAt") }));
  const weekBy = new Map((week.results ?? []).map((r) => [s(r, "user_id", "userId"), n(r, "n")]));
  const actionsOn = await actionsEnabled(db);
  const connections = (conns.results ?? []).map((r) => ({ ...tokenRow(r), callsWeek: weekBy.get(s(r, "user_id", "userId")) ?? 0 }));
  const apps: Record<string, number> = {};
  for (const x of connections) apps[x.app] = (apps[x.app] ?? 0) + 1;
  return c.json({
    success: true,
    data: {
      connectorUrl: `${new URL(c.req.url).origin}/api/mcp`,
      actionsEnabled: actionsOn,
      writeActions: await writeActionSwitches(db),
      limits: LIMITS,
      latency: {
        last24h: latencyByTool(timingRows.filter((r) => r.at >= dayAgo)),
        previous7d: latencyByTool(timingRows.filter((r) => r.at < dayAgo)),
      },
      stats: {
        allowed: (allowedRows.results ?? []).length,
        connectedPeople: new Set(connections.map((x) => x.userId)).size,
        connectedApps: apps,
        callsToday: today ? n(today, "n") : 0,
        refusedToday: today ? n(today, "refused") : 0,
      },
      connections,
      allowed: (allowedRows.results ?? []).map((r) => ({
        userId: s(r, "user_id", "userId"),
        name: s(r, "display_name", "displayName", "displayname", "email"),
        role: s(r, "role"),
        approvedAt: s(r, "approved_at", "approvedAt"),
      })),
      requests: (reqs.results ?? []).map((r) => ({
        id: s(r, "id"),
        userId: s(r, "user_id", "userId"),
        name: s(r, "display_name", "displayName", "displayname", "email"),
        role: s(r, "role"),
        reason: s(r, "reason"),
        at: s(r, "created_at", "createdAt"),
      })),
      calls: (calls.results ?? []).map(callRow),
    },
  });
});

async function grant(c: Context<Env>, userId: string): Promise<void> {
  await c.var.DB
    .prepare(
      `INSERT INTO mcp_access (user_id, approved_by, approved_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET approved_by = excluded.approved_by, approved_at = excluded.approved_at`,
    )
    .bind(userId, uid(c), new Date().toISOString())
    .run();
}

async function notifyUser(c: Context<Env>, userId: string, title: string, message: string): Promise<void> {
  try {
    const db = c.var.DB;
    await ensureNotificationsUserColumn(db);
    const u = await db.prepare("SELECT orgId FROM users WHERE id = ?").bind(userId).first<Record<string, unknown>>();
    await db
      .prepare(
        `INSERT INTO notifications (id, type, title, message, severity, is_read, link, created_at, org_id, user_id)
         VALUES (?, 'SYSTEM', ?, ?, 'INFO', 0, '/settings/ai-connector', ?, ?, ?)`,
      )
      .bind(`mcpn_${randomToken(10)}`, title, message, new Date().toISOString(), (u && s(u, "orgId", "orgid")) || DEFAULT_ORG_ID, userId)
      .run();
  } catch (e) {
    console.warn("[mcp-admin] notify failed:", e instanceof Error ? e.message : String(e));
  }
}

app.post("/admin/requests/:id/:decision", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const db = c.var.DB;
  await ensureMcpTables(db);
  const decision = c.req.param("decision");
  if (decision !== "approve" && decision !== "reject") return c.json({ success: false, error: "approve or reject" }, 400);
  const id = c.req.param("id");
  const r = await db
    .prepare("UPDATE mcp_access_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'PENDING' RETURNING user_id")
    .bind(decision === "approve" ? "APPROVED" : "REJECTED", uid(c), new Date().toISOString(), id)
    .first<Record<string, unknown>>();
  if (!r) return c.json({ success: false, error: "Request not found or already decided" }, 404);
  const userId = s(r, "user_id", "userId");
  if (decision === "approve") {
    await grant(c, userId);
    await notifyUser(c, userId, "AI Connector approved", "You can now connect Claude or ChatGPT to Hookka ERP. Open Settings › AI Connector for the steps.");
  } else {
    await notifyUser(c, userId, "AI Connector request declined", "Your admin declined the AI Connector request.");
  }
  await emitAudit(c, { resource: "ai-connector", resourceId: userId, action: "update", after: { request: id, decision } });
  return c.json({ success: true });
});

app.post("/admin/access", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  await ensureMcpTables(c.var.DB);
  const body = (await c.req.json().catch(() => ({}))) as { userId?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : "";
  const u = userId ? await c.var.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first() : null;
  if (!u) return c.json({ success: false, error: "User not found" }, 404);
  await grant(c, userId);
  await c.var.DB.prepare("UPDATE mcp_access_requests SET status = 'APPROVED', decided_by = ?, decided_at = ? WHERE user_id = ? AND status = 'PENDING'").bind(uid(c), new Date().toISOString(), userId).run();
  await notifyUser(c, userId, "AI Connector turned on", "You can now connect Claude or ChatGPT to Hookka ERP. Open Settings › AI Connector for the steps.");
  await emitAudit(c, { resource: "ai-connector", resourceId: userId, action: "create", after: { access: true } });
  return c.json({ success: true });
});

app.delete("/admin/access/:userId", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  await ensureMcpTables(c.var.DB);
  const userId = c.req.param("userId");
  await c.var.DB.prepare("DELETE FROM mcp_access WHERE user_id = ?").bind(userId).run();
  const revoked = await revokeUserTokens(c.var.DB, userId);
  await emitAudit(c, { resource: "ai-connector", resourceId: userId, action: "delete", after: { access: false, revoked } });
  return c.json({ success: true, data: { revoked } });
});

app.post("/admin/revoke", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { tokenId?: unknown; userId?: unknown };
  let revoked = 0;
  if (typeof body.tokenId === "string" && body.tokenId) revoked = await revokeToken(c.var.DB, body.tokenId);
  else if (typeof body.userId === "string" && body.userId) revoked = await revokeUserTokens(c.var.DB, body.userId);
  else return c.json({ success: false, error: "tokenId or userId required" }, 400);
  await emitAudit(c, { resource: "ai-connector", resourceId: String(body.tokenId ?? body.userId), action: "delete", after: { disconnected: revoked } });
  return c.json({ success: true, data: { revoked } });
});

// "Allow AI actions (meetings, email)". Off by default; while off, propose_* and
// confirm_action answer "AI actions are switched off by your admin".
app.post("/admin/actions", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return c.json({ success: false, error: "enabled (true / false) required" }, 400);
  await setActionsEnabled(c.var.DB, body.enabled, uid(c));
  await emitAudit(c, { resource: "ai-connector", resourceId: "actions", action: "update", after: { actionsEnabled: body.enabled } });
  return c.json({ success: true, data: { actionsEnabled: body.enabled } });
});

// Round 4b: one switch per write action (Mail Center reply, notes, PO approval),
// default OFF, each only effective while "Allow AI actions" is on too.
app.post("/admin/write-actions", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { action?: unknown; enabled?: unknown };
  if (!WRITE_ACTIONS.includes(body.action as WriteAction)) return c.json({ success: false, error: `action must be one of ${WRITE_ACTIONS.join(", ")}` }, 400);
  if (typeof body.enabled !== "boolean") return c.json({ success: false, error: "enabled (true / false) required" }, 400);
  const action = body.action as WriteAction;
  await setWriteActionSwitch(c.var.DB, action, body.enabled, uid(c));
  await emitAudit(c, { resource: "ai-connector", resourceId: `action:${action}`, action: "update", after: { [action]: body.enabled } });
  return c.json({ success: true, data: { writeActions: await writeActionSwitches(c.var.DB) } });
});

// ── leak check (Super Admin) ────────────────────────────────────────────────
// Runs the connector's real read path AS the chosen account over every list
// endpoint, a page at a time (the page loops `offset` until `done`). Field
// names and outcomes only, never values. See lib/mcp-leak-check.ts.
const LEAK_CLIENT_ID = LEAK_CHECK_CLIENT_ID; // excluded from the rate limit and the latency figures
const LEAK_PAGE = 20;

app.post("/admin/leak-check", async (c) => {
  const denied = requireSuperAdmin(c);
  if (denied) return denied;
  const db = c.var.DB;
  await ensureMcpTables(db);
  const body = (await c.req.json().catch(() => ({}))) as { userId?: unknown; offset?: unknown };
  const userId = typeof body.userId === "string" ? body.userId : "";
  const offset = Math.max(0, Number(body.offset) || 0);
  const u = userId ? await db.prepare("SELECT id, role, isActive, displayName, email, orgId FROM users WHERE id = ?").bind(userId).first<Record<string, unknown>>() : null;
  if (!u) return c.json({ success: false, error: "User not found" }, 404);
  const r = s(u, "role").toUpperCase();
  if (r === "SUPER_ADMIN" || r === "ADMIN") return c.json({ success: false, error: "Admins see everything — pick a staff account." }, 400);
  if (n(u, "isActive", "isactive") !== 1) return c.json({ success: false, error: "That account is inactive." }, 400);
  if (!(await hasMcpAccess(db, userId, r))) return c.json({ success: false, error: "Approve this account for AI Connector first (it needs access to be checked)." }, 400);

  await db
    .prepare("INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, 'Leak check', '[]', ?) ON CONFLICT (client_id) DO NOTHING")
    .bind(LEAK_CLIENT_ID, new Date().toISOString())
    .run();
  const paths = leakCheckTargets(mcpAppRoutes());
  const page = paths.slice(offset, offset + LEAK_PAGE);
  const tok = await issueTokens(db, userId, LEAK_CLIENT_ID);
  const rows: LeakRow[] = [];
  // The staff member's identity, exactly as the door would build it. Each call
  // runs in THIS request with their role on the context (runToolAs) — no second
  // trip through /api/mcp, which refused these tokens on prod (BUG-2026-11-25-559).
  const who = {
    tokenId: tok.tokenId,
    userId,
    clientId: LEAK_CLIENT_ID,
    role: r,
    orgId: s(u, "orgId", "orgid", "org_id") || null,
    name: s(u, "display_name", "displayName", "displayname", "email"),
  };
  try {
    // One at a time: the calls share this request's context (the person's role
    // is set on it for each call). In-process tool calls, no query of their own
    // — the one entry in tests/no-query-in-loop.baseline.json for this file.
    for (const path of page) {
      try {
        const tool = path.startsWith("tool:") ? LEAK_CHECK_TOOLS.find((t) => `tool:${t.name}` === path) : undefined;
        const res = tool
          ? await runToolAs(c, who, tok.accessToken, tool.name, tool.args)
          : await runToolAs(c, who, tok.accessToken, "erp_get", { path, query: { limit: 5, page: 1 } });
        rows.push(analyseToolText(path, res.content[0]?.text ?? "", !!res.isError));
      } catch (e) {
        rows.push({ path, outcome: "error", status: e instanceof Error ? e.message : String(e), hidden: [], kept: [], keptExpected: false });
      }
    }
  } finally {
    await revokeToken(db, tok.tokenId);
  }
  if (offset === 0) await emitAudit(c, { resource: "ai-connector", resourceId: userId, action: "update", after: { leakCheck: true, endpoints: paths.length } });
  return c.json({
    success: true,
    data: { person: s(u, "display_name", "displayName", "displayname", "email"), role: r, total: paths.length, offset, next: offset + page.length, done: offset + page.length >= paths.length, rows },
  });
});

export default app;
