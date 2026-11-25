// ---------------------------------------------------------------------------
// mcp-store.ts — storage for the Hookka ERP MCP connector (docs/plans/mcp-connector.md).
//
// Owner 2026-11-25 「我的全套系统都要有mcp」: staff connect Claude / ChatGPT to
// the ERP with THEIR OWN login, read-only, and the owner sees who connected and
// what was looked up. Everything the connector keeps lives here:
//
//   mcp_access          who may connect (approved by a Super Admin) — kept out
//                       of the RBAC override table on purpose, so approving one
//                       person never freezes the rest of their role's grants.
//   mcp_access_requests "Request access" from the staff page, Approve / Reject.
//   mcp_oauth_clients   OAuth dynamic client registration (Claude, ChatGPT …).
//   mcp_oauth_codes     one-time authorization codes (PKCE S256), 10 minutes.
//   mcp_tokens          access + refresh tokens — only SHA-256 hashes stored.
//   mcp_calls           one row per tool call: who, which app, what, result.
//
// Tables self-apply (CREATE TABLE IF NOT EXISTS), snake_case, awaited before
// the first read/write — migrations do not auto-apply on deploy.
// ---------------------------------------------------------------------------
import { memoizeSelfApply } from "./self-apply";

type Db = D1Database;

export const MCP_TOKEN_PREFIX = "hkmcp_";
export const MCP_REFRESH_PREFIX = "hkmcpr_";
export const ACCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const CODE_TTL_MS = 10 * 60 * 1000; // 10 min

let _ready: Promise<void> | null = null;

export function ensureMcpTables(db: Db): Promise<void> {
  return memoizeSelfApply(() => _ready, (p) => { _ready = p; }, async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS mcp_access (
         user_id     TEXT PRIMARY KEY,
         approved_by TEXT,
         approved_at TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS mcp_access_requests (
         id          TEXT PRIMARY KEY,
         user_id     TEXT NOT NULL,
         reason      TEXT,
         status      TEXT NOT NULL,
         created_at  TEXT NOT NULL,
         decided_by  TEXT,
         decided_at  TEXT
       )`,
      `CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
         client_id     TEXT PRIMARY KEY,
         client_name   TEXT,
         redirect_uris TEXT NOT NULL,
         created_at    TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
         code_hash      TEXT PRIMARY KEY,
         client_id      TEXT NOT NULL,
         user_id        TEXT NOT NULL,
         redirect_uri   TEXT NOT NULL,
         code_challenge TEXT NOT NULL,
         expires_at     TEXT NOT NULL,
         used           INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE TABLE IF NOT EXISTS mcp_tokens (
         id                 TEXT PRIMARY KEY,
         user_id            TEXT NOT NULL,
         client_id          TEXT NOT NULL,
         access_hash        TEXT NOT NULL,
         access_expires_at  TEXT NOT NULL,
         refresh_hash       TEXT NOT NULL,
         refresh_expires_at TEXT NOT NULL,
         created_at         TEXT NOT NULL,
         last_used_at       TEXT,
         revoked_at         TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS mcp_tokens_access_idx ON mcp_tokens (access_hash)`,
      `CREATE INDEX IF NOT EXISTS mcp_tokens_refresh_idx ON mcp_tokens (refresh_hash)`,
      `CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON mcp_tokens (user_id)`,
      `CREATE TABLE IF NOT EXISTS mcp_calls (
         id         TEXT PRIMARY KEY,
         token_id   TEXT,
         user_id    TEXT NOT NULL,
         client_id  TEXT,
         tool       TEXT NOT NULL,
         target     TEXT,
         status     INTEGER,
         ok         INTEGER NOT NULL,
         note       TEXT,
         ms         INTEGER,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS mcp_calls_user_idx ON mcp_calls (user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS mcp_calls_created_idx ON mcp_calls (created_at)`,
    ];
    for (const s of stmts) await db.prepare(s).run();
  });
}

export function _resetMcpStoreForTests(): void {
  _ready = null;
}

// ── crypto helpers ───────────────────────────────────────────────────────────

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PKCE S256: BASE64URL(SHA256(verifier)) === challenge. */
export async function pkceS256(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const str = (r: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null) return String(v);
  }
  return "";
};

// ── access (who may connect) ────────────────────────────────────────────────

export async function hasMcpAccess(db: Db, userId: string, role: string): Promise<boolean> {
  if (role.toUpperCase() === "SUPER_ADMIN") return true;
  await ensureMcpTables(db);
  const row = await db.prepare("SELECT user_id FROM mcp_access WHERE user_id = ?").bind(userId).first();
  return !!row;
}

// ── clients ─────────────────────────────────────────────────────────────────

export type McpClient = { clientId: string; clientName: string; redirectUris: string[] };

export async function getClient(db: Db, clientId: string): Promise<McpClient | null> {
  await ensureMcpTables(db);
  const r = await db.prepare("SELECT * FROM mcp_oauth_clients WHERE client_id = ?").bind(clientId).first<Record<string, unknown>>();
  if (!r) return null;
  let uris: string[] = [];
  try {
    uris = JSON.parse(str(r, "redirect_uris", "redirectUris")) as string[];
  } catch {
    uris = [];
  }
  return { clientId: str(r, "client_id", "clientId"), clientName: str(r, "client_name", "clientName") || "AI app", redirectUris: uris };
}

/** A redirect URI a client may register: https anywhere, http only for loopback. */
export function validRedirectUri(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export async function registerClient(db: Db, name: string, redirectUris: string[]): Promise<McpClient> {
  await ensureMcpTables(db);
  const clientId = `mcpc_${randomToken(18)}`;
  const clientName = (name || "AI app").slice(0, 80);
  await db
    .prepare("INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, clientName, JSON.stringify(redirectUris), new Date().toISOString())
    .run();
  return { clientId, clientName, redirectUris };
}

/** A friendly app name for the admin page, from the registered client name. */
export function appLabel(clientName: string): string {
  const n = clientName.toLowerCase();
  if (n.includes("claude")) return "Claude";
  if (n.includes("chatgpt") || n.includes("openai")) return "ChatGPT";
  if (n.includes("gemini") || n.includes("google")) return "Gemini";
  return clientName || "AI app";
}

// ── authorization codes ─────────────────────────────────────────────────────

export async function createCode(
  db: Db,
  a: { clientId: string; userId: string; redirectUri: string; codeChallenge: string },
): Promise<string> {
  await ensureMcpTables(db);
  const code = randomToken(32);
  await db
    .prepare(
      `INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at, used)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(await sha256Hex(code), a.clientId, a.userId, a.redirectUri, a.codeChallenge, new Date(Date.now() + CODE_TTL_MS).toISOString())
    .run();
  return code;
}

/** Single use: the UPDATE claims the code; a replay finds used = 1 and fails. */
export async function consumeCode(
  db: Db,
  code: string,
): Promise<{ clientId: string; userId: string; redirectUri: string; codeChallenge: string } | null> {
  await ensureMcpTables(db);
  const h = await sha256Hex(code);
  const r = await db
    .prepare(
      `UPDATE mcp_oauth_codes SET used = 1
        WHERE code_hash = ? AND used = 0 AND expires_at > ?
        RETURNING client_id, user_id, redirect_uri, code_challenge`,
    )
    .bind(h, new Date().toISOString())
    .first<Record<string, unknown>>();
  if (!r) return null;
  return {
    clientId: str(r, "client_id", "clientId"),
    userId: str(r, "user_id", "userId"),
    redirectUri: str(r, "redirect_uri", "redirectUri"),
    codeChallenge: str(r, "code_challenge", "codeChallenge"),
  };
}

// ── tokens ──────────────────────────────────────────────────────────────────

export type IssuedTokens = { accessToken: string; refreshToken: string; expiresIn: number; tokenId: string };

export async function issueTokens(db: Db, userId: string, clientId: string): Promise<IssuedTokens> {
  await ensureMcpTables(db);
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const refreshToken = MCP_REFRESH_PREFIX + randomToken(32);
  const tokenId = `mcpt_${randomToken(12)}`;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO mcp_tokens (id, user_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenId,
      userId,
      clientId,
      await sha256Hex(accessToken),
      new Date(now + ACCESS_TTL_MS).toISOString(),
      await sha256Hex(refreshToken),
      new Date(now + REFRESH_TTL_MS).toISOString(),
      new Date(now).toISOString(),
    )
    .run();
  return { accessToken, refreshToken, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), tokenId };
}

/** Rotate: the old refresh token stops working the moment a new pair is issued. */
export async function refreshTokens(db: Db, refreshToken: string, clientId: string): Promise<IssuedTokens | null> {
  await ensureMcpTables(db);
  const h = await sha256Hex(refreshToken);
  const nowIso = new Date().toISOString();
  const r = await db
    .prepare(
      `SELECT id, user_id, client_id FROM mcp_tokens
        WHERE refresh_hash = ? AND revoked_at IS NULL AND refresh_expires_at > ?`,
    )
    .bind(h, nowIso)
    .first<Record<string, unknown>>();
  if (!r || str(r, "client_id", "clientId") !== clientId) return null;
  const accessToken = MCP_TOKEN_PREFIX + randomToken(32);
  const newRefresh = MCP_REFRESH_PREFIX + randomToken(32);
  const now = Date.now();
  const upd = await db
    .prepare(
      `UPDATE mcp_tokens SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?
        WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL
        RETURNING id`,
    )
    .bind(
      await sha256Hex(accessToken),
      new Date(now + ACCESS_TTL_MS).toISOString(),
      await sha256Hex(newRefresh),
      new Date(now + REFRESH_TTL_MS).toISOString(),
      str(r, "id"),
      h,
    )
    .first();
  if (!upd) return null;
  return { accessToken, refreshToken: newRefresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000), tokenId: str(r, "id") };
}

export type McpIdentity = { tokenId: string; userId: string; clientId: string; role: string; orgId: string | null; name: string };

/**
 * The person behind an MCP access token — or null when the token is unknown,
 * expired, revoked, the account is inactive, or their AI access was removed.
 */
export async function resolveAccessToken(db: Db, token: string): Promise<McpIdentity | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX)) return null;
  await ensureMcpTables(db);
  const r = await db
    .prepare(
      `SELECT t.id AS token_id, t.user_id AS user_id, t.client_id AS client_id, t.last_used_at AS last_used_at,
              u.role AS role, u.isActive AS isActive, u.orgId AS orgId,
              u.displayName AS display_name, u.email AS email
         FROM mcp_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.access_hash = ? AND t.revoked_at IS NULL AND t.access_expires_at > ?
        LIMIT 1`,
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<Record<string, unknown>>();
  if (!r) return null;
  if (Number(r.isActive ?? r.isactive ?? r.is_active) !== 1) return null;
  const id: McpIdentity = {
    tokenId: str(r, "token_id"),
    userId: str(r, "user_id"),
    clientId: str(r, "client_id"),
    role: str(r, "role").toUpperCase(),
    orgId: str(r, "orgId", "orgid", "org_id") || null,
    // Read on the same row that authenticated the token (whoami used a second
    // query that came back without the person's name — BUG-2026-11-25-558).
    name: str(r, "display_name", "displayName", "displayname").trim() || str(r, "email"),
  };
  if (!(await hasMcpAccess(db, id.userId, id.role))) return null;
  // last-used, at most once a minute per token
  const last = str(r, "last_used_at");
  if (!last || Date.now() - Date.parse(last) > 60_000) {
    try {
      await db.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), id.tokenId).run();
    } catch {
      /* cosmetic */
    }
  }
  return id;
}

export async function revokeToken(db: Db, tokenId: string, userId?: string): Promise<number> {
  await ensureMcpTables(db);
  const r = await db
    .prepare(`UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL ${userId ? "AND user_id = ?" : ""} RETURNING id`)
    .bind(new Date().toISOString(), tokenId, ...(userId ? [userId] : []))
    .all();
  return (r.results ?? []).length;
}

export async function revokeUserTokens(db: Db, userId: string): Promise<number> {
  await ensureMcpTables(db);
  const r = await db
    .prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL RETURNING id")
    .bind(new Date().toISOString(), userId)
    .all();
  return (r.results ?? []).length;
}

// ── call log ────────────────────────────────────────────────────────────────

export async function logCall(
  db: Db,
  c: { tokenId: string; userId: string; clientId: string; tool: string; target: string; status: number; ok: boolean; note?: string; ms: number },
): Promise<void> {
  try {
    await ensureMcpTables(db);
    await db
      .prepare(
        `INSERT INTO mcp_calls (id, token_id, user_id, client_id, tool, target, status, ok, note, ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `mcpl_${randomToken(12)}`,
        c.tokenId,
        c.userId,
        c.clientId,
        c.tool,
        c.target.slice(0, 500),
        c.status,
        c.ok ? 1 : 0,
        (c.note ?? "").slice(0, 300),
        c.ms,
        new Date().toISOString(),
      )
      .run();
  } catch (e) {
    console.warn("[mcp] call log failed:", e instanceof Error ? e.message : String(e));
  }
}
