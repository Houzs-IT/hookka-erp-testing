// ---------------------------------------------------------------------------
// user-sessions.ts — "Signed-in devices": list and revoke your own sessions.
//
// Hardening batch (owner-approved 2026-11-08). Dashboard sessions are already
// server-side rows in `user_sessions` (token, userId, createdAt, expiresAt —
// see auth-middleware.ts), so a user can be shown where they are signed in and
// end any of those sessions. Three nullable columns are added at runtime:
//
//   user_agent   TEXT  — browser / device string at sign-in (trimmed to 500)
//   ip_address   TEXT  — CF-Connecting-IP at sign-in
//   last_seen_at TEXT  — ISO time; refreshed by authMiddleware (touchLastSeen)
//                        at most once per SESSION_CACHE_TTL_S per session (on a
//                        KV cache miss) and only when older than 15 minutes
//
// Safety rules this file keeps:
//   * Nothing on the login or auth hot path DEPENDS on these columns. Login
//     inserts the row exactly as before; the device stamp is a separate,
//     best-effort UPDATE afterwards. The auth middleware never SELECTs them.
//   * The raw token never leaves the server. The client sees `sessionPublicId`
//     — a one-way hash — and revocation matches it back against the caller's
//     OWN rows only, so one user can never end another user's session.
//   * Migrations do not auto-apply in this repo; the columns arrive through
//     `ensureSessionDeviceColumns` (ALTER TABLE … ADD COLUMN IF NOT EXISTS).
// ---------------------------------------------------------------------------
import type { Context } from "hono";
import type { Env } from "../worker";
import { runSelfApply, memoizeSelfApply } from "./self-apply";
import { readCookie, SESSION_COOKIE, invalidateSessionCache } from "./auth-middleware";

const UA_MAX = 500;
let _ensure: Promise<void> | null = null;

/** Add the three device columns once per isolate; retried if a round fails. */
export function ensureSessionDeviceColumns(db: D1Database): Promise<void> {
  return memoizeSelfApply(
    () => _ensure,
    (p) => {
      _ensure = p;
    },
    () =>
      runSelfApply(db, "user-sessions-device", [
        "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT",
        "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT",
        "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_seen_at TEXT",
      ]),
  );
}

/** The dashboard session token on this request: cookie first, then Bearer. */
export function currentSessionToken(req: Request): string | null {
  const fromCookie = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (fromCookie) return fromCookie;
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() || null : null;
}

/** One-way, stable id for a session that is safe to send to the browser. */
export async function sessionPublicId(token: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`hookka-session-id:${token}`),
  );
  return Array.from(new Uint8Array(buf).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Record the browser and IP on a freshly issued session. Best-effort: a
 * failure is logged and swallowed — signing in must never fail because of it.
 */
export async function stampSessionDevice(c: Context<Env>, token: string): Promise<void> {
  try {
    await ensureSessionDeviceColumns(c.var.DB);
    const ua = (c.req.header("user-agent") || "").slice(0, UA_MAX) || null;
    const ip =
      c.req.header("cf-connecting-ip") ||
      (c.req.header("x-forwarded-for") || "").split(",")[0].trim() ||
      null;
    await c.var.DB.prepare(
      "UPDATE user_sessions SET user_agent = ?, ip_address = ?, last_seen_at = ? WHERE token = ?",
    )
      .bind(ua, ip, new Date().toISOString(), token)
      .run();
  } catch (err) {
    console.warn(
      "[sessions] device stamp failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** "Chrome on Windows", "Safari on iPhone", … — a readable label for a UA string. */
export function describeUserAgent(ua: string | null | undefined): string {
  const s = ua || "";
  if (!s) return "Unknown device";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /SamsungBrowser\//.test(s)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(s)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(s)
            ? "Chrome"
            : /Safari\//.test(s)
              ? "Safari"
              : "Browser";
  const os = /iPhone/.test(s)
    ? "iPhone"
    : /iPad/.test(s)
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(s)
            ? "Mac"
            : /CrOS/.test(s)
              ? "ChromeOS"
              : /Linux/.test(s)
                ? "Linux"
                : "";
  return os ? `${browser} on ${os}` : browser;
}

export type SessionView = {
  id: string;
  current: boolean;
  device: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
};

type SessionRow = {
  token: string;
  createdAt?: string;
  created_at?: string;
  expiresAt?: string;
  expires_at?: string;
  user_agent?: string | null;
  userAgent?: string | null;
  ip_address?: string | null;
  ipAddress?: string | null;
  last_seen_at?: string | null;
  lastSeenAt?: string | null;
};

async function loadOwnRows(db: D1Database, userId: string): Promise<SessionRow[]> {
  try {
    await ensureSessionDeviceColumns(db);
    const res = await db
      .prepare(
        "SELECT token, createdAt, expiresAt, user_agent, ip_address, last_seen_at FROM user_sessions WHERE userId = ?",
      )
      .bind(userId)
      .all<SessionRow>();
    return res.results ?? [];
  } catch (err) {
    // Columns could not be added — still list the sessions, without details.
    console.warn(
      "[sessions] device columns unavailable, listing without them:",
      err instanceof Error ? err.message : String(err),
    );
    const res = await db
      .prepare("SELECT token, createdAt, expiresAt FROM user_sessions WHERE userId = ?")
      .bind(userId)
      .all<SessionRow>();
    return res.results ?? [];
  }
}

/** The caller's live (unexpired) sessions, newest activity first. */
export async function listOwnSessions(
  db: D1Database,
  userId: string,
  currentToken: string | null,
): Promise<SessionView[]> {
  const rows = await loadOwnRows(db, userId);
  const now = Date.now();
  const out: SessionView[] = [];
  for (const r of rows) {
    const expiresAt = String(r.expiresAt ?? r.expires_at ?? "");
    if (!expiresAt || new Date(expiresAt).getTime() <= now) continue;
    const ua = r.user_agent ?? r.userAgent ?? null;
    out.push({
      id: await sessionPublicId(r.token),
      current: currentToken !== null && r.token === currentToken,
      device: describeUserAgent(ua),
      userAgent: ua,
      ipAddress: r.ip_address ?? r.ipAddress ?? null,
      createdAt: String(r.createdAt ?? r.created_at ?? ""),
      lastSeenAt: r.last_seen_at ?? r.lastSeenAt ?? null,
      expiresAt,
    });
  }
  const key = (s: SessionView) => s.lastSeenAt || s.createdAt;
  out.sort((a, b) => (a.current ? -1 : b.current ? 1 : key(b).localeCompare(key(a))));
  return out;
}

/** Delete the given tokens (already proven to belong to the caller) + their KV cache. */
async function deleteTokens(
  db: D1Database,
  kv: KVNamespace | undefined,
  userId: string,
  tokens: string[],
): Promise<number> {
  if (tokens.length === 0) return 0;
  const placeholders = tokens.map(() => "?").join(", ");
  await db
    .prepare(`DELETE FROM user_sessions WHERE userId = ? AND token IN (${placeholders})`)
    .bind(userId, ...tokens)
    .run();
  await Promise.all(tokens.map((t) => invalidateSessionCache(kv, t)));
  return tokens.length;
}

/**
 * End ONE of the caller's sessions by public id. Returns "not-found" when the
 * id matches none of the caller's rows (including someone else's session),
 * "current" when it is the session making the request (use Sign Out for that).
 */
export async function revokeOwnSession(
  db: D1Database,
  kv: KVNamespace | undefined,
  userId: string,
  publicId: string,
  currentToken: string | null,
): Promise<"revoked" | "not-found" | "current"> {
  const res = await db
    .prepare("SELECT token FROM user_sessions WHERE userId = ?")
    .bind(userId)
    .all<{ token: string }>();
  for (const r of res.results ?? []) {
    if ((await sessionPublicId(r.token)) !== publicId) continue;
    if (currentToken !== null && r.token === currentToken) return "current";
    await deleteTokens(db, kv, userId, [r.token]);
    return "revoked";
  }
  return "not-found";
}

/** End every session of the caller except the one making the request. */
export async function revokeOtherSessions(
  db: D1Database,
  kv: KVNamespace | undefined,
  userId: string,
  currentToken: string | null,
): Promise<number> {
  const res = await db
    .prepare("SELECT token FROM user_sessions WHERE userId = ?")
    .bind(userId)
    .all<{ token: string }>();
  const others = (res.results ?? []).map((r) => r.token).filter((t) => t !== currentToken);
  return deleteTokens(db, kv, userId, others);
}
