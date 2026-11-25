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
