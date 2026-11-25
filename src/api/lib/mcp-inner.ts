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
