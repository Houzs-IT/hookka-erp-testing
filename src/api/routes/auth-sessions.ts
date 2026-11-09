// ---------------------------------------------------------------------------
// /api/auth/sessions — "Signed-in devices" for the CURRENT user.
//
// Hardening batch (owner-approved 2026-11-08). Every handler is self-scoped:
// it only ever reads or deletes rows WHERE userId = the caller, so there is no
// permission to check beyond being signed in (authMiddleware already returns
// 401 without a session — this path is not in PUBLIC_PATHS / PUBLIC_PREFIXES).
//
//   GET    /                → list my live sessions (device, IP, signed in,
//                              last active, expires; `current` marks this one)
//   DELETE /:id             → sign out ONE of my other sessions
//   POST   /revoke-others   → sign out every session except this one
//
// The raw token never leaves the server — `id` is a one-way hash
// (lib/user-sessions.ts → sessionPublicId).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { emitAudit } from "../lib/audit";
import {
  currentSessionToken,
  listOwnSessions,
  revokeOwnSession,
  revokeOtherSessions,
} from "../lib/user-sessions";

const app = new Hono<Env>();

function callerId(c: { get: (k: string) => unknown }): string | undefined {
  return c.get("userId") as string | undefined;
}

app.get("/", async (c) => {
  const userId = callerId(c as unknown as { get: (k: string) => unknown });
  if (!userId) return c.json({ success: false, error: "Unauthorized" }, 401);
  const data = await listOwnSessions(c.var.DB, userId, currentSessionToken(c.req.raw));
  return c.json({ success: true, data });
});

app.post("/revoke-others", async (c) => {
  const userId = callerId(c as unknown as { get: (k: string) => unknown });
  if (!userId) return c.json({ success: false, error: "Unauthorized" }, 401);
  const current = currentSessionToken(c.req.raw);
  if (!current) {
    return c.json({ success: false, error: "Could not identify this session." }, 400);
  }
  const revoked = await revokeOtherSessions(c.var.DB, c.env.SESSION_CACHE, userId, current);
  if (revoked > 0) {
    await emitAudit(c, {
      resource: "auth",
      resourceId: userId,
      action: "revoke-other-sessions",
      after: { revoked },
    });
  }
  return c.json({ success: true, data: { revoked } });
});

app.delete("/:id", async (c) => {
  const userId = callerId(c as unknown as { get: (k: string) => unknown });
  if (!userId) return c.json({ success: false, error: "Unauthorized" }, 401);
  const publicId = c.req.param("id");
  if (!/^[0-9a-f]{32}$/.test(publicId)) {
    return c.json({ success: false, error: "Session not found." }, 404);
  }
  const outcome = await revokeOwnSession(
    c.var.DB,
    c.env.SESSION_CACHE,
    userId,
    publicId,
    currentSessionToken(c.req.raw),
  );
  if (outcome === "current") {
    return c.json(
      { success: false, error: "This is the session you are using now. Use Sign Out to end it." },
      400,
    );
  }
  if (outcome === "not-found") {
    return c.json({ success: false, error: "Session not found." }, 404);
  }
  await emitAudit(c, {
    resource: "auth",
    resourceId: userId,
    action: "revoke-session",
    after: { sessionId: publicId },
  });
  return c.json({ success: true });
});

export default app;
