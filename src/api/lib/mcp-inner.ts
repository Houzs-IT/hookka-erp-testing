// ---------------------------------------------------------------------------
// mcp-inner.ts — proof that a request carrying an MCP token came from the MCP
// tool runner in THIS isolate (routes/mcp.ts → innerGet), not from outside.
//
// auth-middleware.ts accepts an `hkmcp_` token only with this header, so the
// token an AI app holds cannot be replayed straight at /api/* to skip the
// connector's module gate and field redaction. The secret is random per
// isolate and never leaves it.
// ---------------------------------------------------------------------------
export const MCP_INNER_HEADER = "x-hookka-mcp-inner";

let secret: string | null = null;

export function mcpInnerSecret(): string {
  if (!secret) {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    secret = Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return secret;
}

export function isMcpInner(headerValue: string | undefined | null): boolean {
  if (!headerValue || !secret) return false;
  if (headerValue.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= headerValue.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

// ── one token check per lookup ──────────────────────────────────────────────
// routes/mcp.ts verifies the token at the door (resolveAccessToken: expiry,
// revocation, active account, AI access) and then makes one or more inner GETs
// for the same tool call. Those inner GETs reuse that answer for a few seconds
// instead of querying the token again. Every new request from the AI app is
// still checked at the door, so Disconnect / Remove stop the NEXT request.
const VERIFIED_TTL_MS = 15_000;
const verified = new Map<string, { id: unknown; exp: number }>();

export function rememberVerified(token: string, id: unknown, now = Date.now()): void {
  if (verified.size > 500) {
    for (const [k, v] of verified) if (v.exp <= now) verified.delete(k);
  }
  verified.set(token, { id, exp: now + VERIFIED_TTL_MS });
}

export function recallVerified<T>(token: string, now = Date.now()): T | null {
  const e = verified.get(token);
  if (!e) return null;
  if (e.exp <= now) {
    verified.delete(token);
    return null;
  }
  return e.id as T;
}

// ── the write fence: confirmed actions only ─────────────────────────────────
// The connector is read-only EXCEPT for the two actions the owner allowed
// (2026-11-26: book a meeting, send an email), each only after the person said
// yes (routes/mcp.ts confirm_action). auth-middleware.ts lets an MCP token make
// a non-GET request ONLY when ALL of these hold:
//   1. the per-isolate inner secret (MCP_INNER_HEADER) — it came from the tool
//      runner in this isolate, not from outside;
//   2. MCP_ACTION_HEADER names a confirmed action;
//   3. that action was ARMED here for this same token, method and path, within
//      the last ARM_TTL_MS — confirm_action arms it right after it consumed the
//      pending row (single-use UPDATE … RETURNING) in this same request;
//   4. method + path is in ACTION_ALLOWLIST.
// takeConfirmedAction is one-shot: the arm is deleted on first use, so one
// "yes" is one write. Anything else stays 403.
export const MCP_ACTION_HEADER = "x-hookka-mcp-action";

/** The ONLY non-GET requests an MCP token can ever make. */
export const ACTION_ALLOWLIST: readonly { kind: "meeting" | "email"; method: "POST"; path: string }[] = [
  { kind: "meeting", method: "POST", path: "/api/meetings/meetings" },
  { kind: "email", method: "POST", path: "/api/mail-center/compose" },
];

export function allowlistedAction(kind: string): { method: "POST"; path: string } | null {
  const e = ACTION_ALLOWLIST.find((a) => a.kind === kind);
  return e ? { method: e.method, path: e.path } : null;
}

export function isAllowlisted(method: string, path: string): boolean {
  return ACTION_ALLOWLIST.some((a) => a.method === method.toUpperCase() && a.path === path);
}

const ARM_TTL_MS = 30_000;
const armed = new Map<string, { tokenId: string; method: string; path: string; exp: number }>();

/** confirm_action, after it consumed the pending row: allow exactly one matching write. */
export function armConfirmedAction(actionId: string, tokenId: string, method: string, path: string, now = Date.now()): void {
  if (!actionId || !isAllowlisted(method, path)) return;
  for (const [k, v] of armed) if (v.exp <= now) armed.delete(k);
  armed.set(actionId, { tokenId, method: method.toUpperCase(), path, exp: now + ARM_TTL_MS });
}

/** auth-middleware.ts: true once, for the armed action's own token + method + path. */
export function takeConfirmedAction(actionId: string | undefined | null, tokenId: string, method: string, path: string, now = Date.now()): boolean {
  if (!actionId) return false;
  const e = armed.get(actionId);
  if (!e) return false;
  armed.delete(actionId);
  return e.exp > now && e.tokenId === tokenId && e.method === method.toUpperCase() && e.path === path && isAllowlisted(method, path);
}
