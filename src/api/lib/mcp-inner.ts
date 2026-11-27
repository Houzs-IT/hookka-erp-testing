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
// The connector is read-only EXCEPT for the actions the owner allowed
// (2026-11-26: book a meeting, send an email; round 4b: reply to a Mail Center
// thread, add a note to a PO / service case, approve a PO), each only after the
// person said yes (routes/mcp.ts confirm_action). auth-middleware.ts lets an
// MCP token make a non-GET request ONLY when ALL of these hold:
//   1. the per-isolate inner secret (MCP_INNER_HEADER) — it came from the tool
//      runner in this isolate, not from outside;
//   2. MCP_ACTION_HEADER names a confirmed action;
//   3. that action was ARMED here for this same token, method and path, within
//      the last ARM_TTL_MS — confirm_action arms it right after it consumed the
//      pending row (single-use UPDATE … RETURNING) in this same request;
//   4. method + path matches ACTION_ALLOWLIST.
// takeConfirmedAction is one-shot: the arm is deleted on first use, so one
// "yes" is one write. Anything else stays 403. The BODY an action may carry is
// fenced too (actionBodyAllowed, checked before arming): a PO note can only
// carry notes, a PO approval only status CONFIRMED — never items, prices,
// supplier or any other field the same PUT route would accept.
export const MCP_ACTION_HEADER = "x-hookka-mcp-action";

export type FencedKind = "meeting" | "email" | "mail_reply" | "po_note" | "case_note" | "po_approval";

const REF = "[A-Za-z0-9._-]{1,80}";
/** The ONLY non-GET requests an MCP token can ever make. `:ref` = one safe id segment. */
export const ACTION_ALLOWLIST: readonly { kind: FencedKind; method: "POST" | "PUT"; path: string }[] = [
  { kind: "meeting", method: "POST", path: "/api/meetings/meetings" },
  { kind: "email", method: "POST", path: "/api/mail-center/compose" },
  { kind: "mail_reply", method: "POST", path: "/api/mail-center/threads/:ref/reply" },
  { kind: "po_note", method: "PUT", path: "/api/purchase-orders/:ref" },
  { kind: "case_note", method: "PUT", path: "/api/service-cases/:ref" },
  { kind: "po_approval", method: "PUT", path: "/api/purchase-orders/:ref" },
];

// The allowlist paths hold only letters, "/", "-" and ":ref" — no regex metacharacters to escape.
const pathRe = (pattern: string) => new RegExp(`^${pattern.replace(":ref", REF)}$`);
const ALLOW_RE = ACTION_ALLOWLIST.map((a) => ({ ...a, re: pathRe(a.path) }));

/** The concrete route for an action kind (`ref` fills `:ref`), or null for an unknown kind / unsafe ref. */
export function allowlistedAction(kind: string, ref = ""): { method: "POST" | "PUT"; path: string } | null {
  const e = ACTION_ALLOWLIST.find((a) => a.kind === kind);
  if (!e) return null;
  if (!e.path.includes(":ref")) return { method: e.method, path: e.path };
  if (!new RegExp(`^${REF}$`).test(ref)) return null;
  return { method: e.method, path: e.path.replace(":ref", ref) };
}

export function isAllowlisted(method: string, path: string): boolean {
  return ALLOW_RE.some((a) => a.method === method.toUpperCase() && a.re.test(path));
}

/** The keys each kind's body may carry (exactly what the ERP's own screen sends for that action). */
const BODY_KEYS: Record<FencedKind, readonly string[] | null> = {
  meeting: null, // the hub's draftBody, built by buildMeetingProposal
  email: null, // the compose body, built by buildEmailProposal
  mail_reply: ["text", "fromAddress", "afterMessageId"],
  po_note: ["notes", "expectedUpdatedAt"],
  case_note: ["actionLog"],
  po_approval: ["status", "expectedUpdatedAt"],
};

/** True when `body` is a plain object carrying only the keys `kind` may send (PO approval: status CONFIRMED only). */
export function actionBodyAllowed(kind: string, body: unknown): boolean {
  if (!(kind in BODY_KEYS)) return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = BODY_KEYS[kind as FencedKind];
  if (keys === null) return true;
  const b = body as Record<string, unknown>;
  if (!Object.keys(b).every((k) => keys.includes(k))) return false;
  if (kind === "po_approval" && b.status !== "CONFIRMED") return false;
  if (kind === "po_note" && typeof b.notes !== "string") return false;
  if (kind === "case_note" && !Array.isArray(b.actionLog)) return false;
  if (kind === "mail_reply" && (typeof b.text !== "string" || !b.text.trim())) return false;
  return true;
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
