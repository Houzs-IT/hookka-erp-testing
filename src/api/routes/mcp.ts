// ---------------------------------------------------------------------------
// /api/mcp — the Hookka ERP MCP connector (docs/plans/mcp-connector.md).
//
// Owner 2026-11-25 「我的全套系统都要有mcp」. Registered BEFORE authMiddleware in
// worker.ts: every handler here does its own auth.
//
//   POST /api/mcp                    MCP Streamable HTTP (JSON-RPC, stateless),
//                                    Bearer hkmcp_… access token.
//   POST /api/mcp/oauth/register     OAuth dynamic client registration.
//   GET  /api/mcp/oauth/authorize    ERP login → "Allow" page (session cookie).
//   POST /api/mcp/oauth/approve      the Allow / Cancel form (cookie + CSRF).
//   POST /api/mcp/oauth/token        authorization_code (PKCE S256) / refresh_token.
//   GET  /.well-known/oauth-*        discovery (wellKnown, mounted at the root).
//
// Read-only and own-permissions by construction: a tool call re-enters the
// whole app as a GET carrying the caller's MCP token (auth-middleware.ts
// accepts it ONLY for that inner call, and only for GET), so every route runs
// its own permission check against the real person; mcp-access.ts then gates
// the module and strips cost / salary / price fields the person may not see.
//
// The one exception (owner 2026-11-26 「先确认再做」): propose_meeting /
// propose_email store a pending action; confirm_action — after the person said
// yes — makes ONE POST to the ERP's own create-meeting or Mail Center compose
// route, as the person (innerAction). The fence is mcp-inner.ts
// ACTION_ALLOWLIST + takeConfirmedAction, checked in auth-middleware.ts; the
// owner's switch (default off) and the storage are lib/mcp-actions.ts.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { hasPermission } from "../lib/rbac";
import { readCookie, SESSION_COOKIE, CSRF_COOKIE } from "../lib/auth-middleware";
import { classifyPath, makeRedactor, moduleCatalog, MCP_PREFIX_RESOURCES } from "../lib/mcp-access";
import { MCP_ACTION_HEADER, MCP_INNER_HEADER, allowlistedAction, armConfirmedAction, mcpInnerSecret, rememberVerified } from "../lib/mcp-inner";
import {
  ACTIONS_OFF_MESSAGE,
  ACTIONS_PER_DAY,
  actionsEnabled,
  buildEmailProposal,
  buildMeetingProposal,
  cancelPendingAction,
  confirmedSince,
  consumePendingAction,
  createPendingAction,
  describeOutcome,
  finishPendingAction,
  meetingBusyWarnings,
  myDayStartIso,
  readBootstrap,
  readMailboxes,
  actionTarget,
  type ActionKind,
} from "../lib/mcp-actions";
import { FLOW_API, parseAnchorId, pickFlowAnchor, shapeFlow, soRefsFromDoc, type FlowKind } from "../lib/mcp-flow";
import {
  BRIEF_MAIL_LIMIT,
  BRIEF_SO_TOP,
  buildDailyBrief,
  docTitle,
  FETCH_API,
  myToday,
  normalisePeriod,
  parseFetchId,
  pickFields,
  PROMPTS,
  promptText,
  sameDaysPrevMonth,
  searchResults,
  summariseAttendance,
  summariseDeliveriesDue,
  summariseInventory,
  summariseOrders,
  summariseOverdueSales,
  summarisePayables,
  summariseProduction,
  summariseProductionLate,
  summarisePurchasing,
  summariseReceivables,
  summariseSales,
  summariseShippedNotInvoiced,
  summariseShortages,
  validRange,
  type PurchasingView,
} from "../lib/mcp-quick";
import { pickPurchaseAnchor, shapePurchaseFlow } from "../lib/mcp-flow";
import { renderServerPdf, uploadExportAndSign, uploadPdfAndSign, SERVER_PDF_KINDS, XLSX_CONTENT_TYPE, type PdfKind } from "../lib/mcp-pdf";
import { buildXlsx, EXPORT_LISTS, EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE, exportFileName, exportRows, exportTotal, filterRows, pagesToRead, pickColumns } from "../lib/mcp-export";
import { AnswerCache, CACHEABLE_TOOLS, countRecentCalls, RATE_LIMIT_STATUS, rateDecision } from "../lib/mcp-limits";
import {
  consumeCode,
  createCode,
  getClient,
  hasMcpAccess,
  issueTokens,
  logCall,
  pkceS256,
  refreshTokens,
  registerClient,
  resolveAccessToken,
  validRedirectUri,
  type McpIdentity,
} from "../lib/mcp-store";

const app = new Hono<Env>();

// The full app, for in-process tool calls. Set by worker.ts once routes exist
// (importing worker.ts here would be circular).
type FetchApp = { fetch: (req: Request, env: unknown, ctx?: unknown) => Response | Promise<Response>; routes?: { method: string; path: string }[] };
let appRef: FetchApp | null = null;
export function setMcpApp(a: FetchApp): void {
  appRef = a;
}
/** For the Super Admin leak check (routes/mcp-admin.ts): the app's routes and a way in. */
export function mcpAppRoutes(): { method: string; path: string }[] {
  return appRef?.routes ?? [];
}
export function mcpAppFetch(req: Request, env: unknown, ctx?: unknown): Promise<Response> {
  if (!appRef) throw new Error("MCP app not initialised");
  return Promise.resolve(appRef.fetch(req, env, ctx));
}

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MAX_RESULT_CHARS = 30_000;
const SERVER_INFO = { name: "hookka-erp", title: "Hookka ERP", version: "1.0.0" };

const originOf = (c: Context<Env>): string => new URL(c.req.url).origin;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ── discovery (also mounted at /.well-known by worker.ts) ───────────────────

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["erp.read"],
    resource_name: "Hookka ERP",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["erp.read"],
  };
}

export const wellKnown = new Hono<Env>();
wellKnown.get("/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(originOf(c))));
wellKnown.get("/oauth-protected-resource/*", (c) => c.json(protectedResourceMetadata(originOf(c))));
wellKnown.get("/oauth-authorization-server", (c) => c.json(authorizationServerMetadata(originOf(c))));
wellKnown.get("/oauth-authorization-server/*", (c) => c.json(authorizationServerMetadata(originOf(c))));

// ── session (the ERP login) for the authorize page ──────────────────────────

type SessionUser = { userId: string; role: string; name: string; orgId: string | null };

async function sessionUser(c: Context<Env>): Promise<SessionUser | null> {
  const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const r = await c.var.DB.prepare(
    `SELECT s.userId AS userId, s.expiresAt AS expiresAt, u.role AS role, u.isActive AS isActive,
            u.orgId AS orgId, u.displayName AS displayName, u.email AS email
       FROM user_sessions s
       JOIN users u ON u.id = s.userId
      WHERE s.token = ?
      LIMIT 1`,
  )
    .bind(token)
    .first<Record<string, unknown>>();
  if (!r) return null;
  if (Number(r.isActive ?? r.isactive) !== 1) return null;
  if (new Date(String(r.expiresAt ?? r.expiresat ?? 0)).getTime() <= Date.now()) return null;
  return {
    userId: String(r.userId ?? r.userid),
    role: String(r.role ?? "").toUpperCase(),
    name: String(r.displayName || r.display_name || r.displayname || r.email || "your account"),
    orgId: (r.orgId ?? r.orgid ?? null) as string | null,
  };
}

// ── OAuth: register ─────────────────────────────────────────────────────────

app.post("/oauth/register", async (c) => {
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_client_metadata", error_description: "JSON body required" }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (uris.length === 0 || uris.length > 5 || uris.some((u) => u.length > 500 || !validRedirectUri(u))) {
    return c.json({ error: "invalid_redirect_uri", error_description: "1–5 https redirect URIs required" }, 400);
  }
  const cl = await registerClient(c.var.DB, typeof body.client_name === "string" ? body.client_name : "AI app", uris);
  return c.json(
    {
      client_id: cl.clientId,
      client_name: cl.clientName,
      redirect_uris: cl.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201,
  );
});

// ── OAuth: authorize (HTML) ─────────────────────────────────────────────────

type AuthParams = { clientId: string; redirectUri: string; state: string; challenge: string; method: string };

function readAuthParams(get: (k: string) => string | undefined): AuthParams {
  return {
    clientId: get("client_id") ?? "",
    redirectUri: get("redirect_uri") ?? "",
    state: get("state") ?? "",
    challenge: get("code_challenge") ?? "",
    method: get("code_challenge_method") ?? "",
  };
}

function page(title: string, inner: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#F6F4EF;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1F1D1A}
.wrap{min-height:100vh;box-sizing:border-box;padding:48px 16px;display:flex;justify-content:center;align-items:flex-start}
.card{width:100%;max-width:480px;background:#fff;border:1px solid #E6E1D6;border-radius:16px;padding:32px;box-sizing:border-box;box-shadow:0 8px 24px rgba(31,29,26,.06)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.logo{width:44px;height:44px;border-radius:10px;background:#1F1D1A;color:#E9D9A6;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px}
h1{margin:0 0 8px;font-size:22px;line-height:1.3}
p{margin:0 0 12px;font-size:14px;color:#55534E;line-height:1.5}
ul{margin:16px 0;padding:0;list-style:none}
li{display:flex;gap:10px;font-size:14px;line-height:1.5;margin-bottom:12px}
li b{color:#1F1D1A}
.tick{flex:0 0 20px;color:#1E6B3F;font-weight:700}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
button,.btn{flex:1 1 140px;height:46px;border-radius:10px;font:600 15px Inter,system-ui,sans-serif;cursor:pointer;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}
.primary{border:0;background:#6B5A2E;color:#fff}
.secondary{border:1px solid #D9D4C7;background:#fff;color:#1F1D1A}
.small{font-size:12px;color:#6B6B66;margin-top:16px}
a{color:#6B5A2E}
</style></head><body><main class="wrap"><div class="card">
<div class="brand"><div class="logo" aria-hidden="true">H</div><div><div style="font-weight:700">Hookka ERP</div></div></div>
${inner}
</div></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'",
      // same-origin, not no-referrer: with no-referrer the browser sends `Origin: null` on the Allow form
      // post and the approve handler refused it as cross-site (BUG-2026-11-26, owner could not connect).
      "Referrer-Policy": "same-origin",
    },
  });
}

async function checkAuthParams(c: Context<Env>, p: AuthParams): Promise<{ ok: true; clientName: string } | { ok: false; res: Response }> {
  if (!p.clientId || !p.redirectUri) return { ok: false, res: page("Invalid request", `<h1>Invalid request</h1><p>Missing client or redirect address.</p>`, 400) };
  const cl = await getClient(c.var.DB, p.clientId);
  if (!cl) return { ok: false, res: page("Unknown app", `<h1>Unknown app</h1><p>This AI app is not registered. Remove the connector and add it again.</p>`, 400) };
  if (!cl.redirectUris.includes(p.redirectUri)) return { ok: false, res: page("Invalid request", `<h1>Invalid request</h1><p>The return address does not match this app.</p>`, 400) };
  if (!p.challenge || p.method !== "S256") return { ok: false, res: page("Invalid request", `<h1>Invalid request</h1><p>This app must use PKCE (S256).</p>`, 400) };
  return { ok: true, clientName: cl.clientName };
}

app.get("/oauth/authorize", async (c) => {
  const p = readAuthParams((k) => c.req.query(k));
  const chk = await checkAuthParams(c, p);
  if (!chk.ok) return chk.res;
  if (c.req.query("response_type") !== "code") return page("Invalid request", `<h1>Invalid request</h1><p>Only response_type=code is supported.</p>`, 400);

  const who = await sessionUser(c);
  if (!who) {
    const here = new URL(c.req.url);
    return c.redirect(`/login?next=${encodeURIComponent(here.pathname + here.search)}`, 302);
  }
  if (!(await hasMcpAccess(c.var.DB, who.userId, who.role))) {
    return page(
      "Not turned on",
      `<h1>AI Connector is not turned on for your account</h1>
<p>Signed in as <b>${esc(who.name)}</b>. Ask your admin to approve AI Connector for you.</p>
<div class="row"><a class="btn primary" href="/settings/ai-connector">Request access</a></div>
<p class="small">Not you? <a href="/login">Sign in with another account</a>.</p>`,
      403,
    );
  }
  const csrf = readCookie(c.req.header("cookie"), CSRF_COOKIE);
  if (!csrf) return page("Sign in again", `<h1>Please sign in again</h1><p><a href="/login?next=${encodeURIComponent(new URL(c.req.url).pathname + new URL(c.req.url).search)}">Sign in</a> and try connecting again.</p>`, 400);
  const app_ = esc(chk.clientName);
  const hidden = (n: string, v: string) => `<input type="hidden" name="${n}" value="${esc(v)}">`;
  return page(
    "Allow AI to read Hookka ERP",
    `<h1>${app_} wants to use Hookka ERP as you</h1>
<p>Signed in as <b>${esc(who.name)}</b></p>
<ul>
<li><span class="tick" aria-hidden="true">✓</span><span><b>Looks things up.</b> It cannot change orders, money, stock or approvals, and cannot delete anything.</span></li>
<li><span class="tick" aria-hidden="true">✓</span><span><b>Meetings and email only after you say yes.</b> If your admin allows AI actions, it can book a meeting or send an email for you — it shows you each one first and does it only when you confirm.</span></li>
<li><span class="tick" aria-hidden="true">✓</span><span><b>Only what you can see.</b> The same pages and figures your ERP login shows you — nothing more.</span></li>
<li><span class="tick" aria-hidden="true">✓</span><span><b>Logged.</b> Your admin can see which ERP data was looked up and when.</span></li>
<li><span class="tick" aria-hidden="true" style="color:#6B5A2E">i</span><span>Data it reads is sent to the AI app to answer you. Stop any time in Settings › AI Connector.</span></li>
</ul>
<form method="post" action="/api/mcp/oauth/approve">
${hidden("client_id", p.clientId)}${hidden("redirect_uri", p.redirectUri)}${hidden("state", p.state)}${hidden("code_challenge", p.challenge)}${hidden("code_challenge_method", p.method)}${hidden("csrf", csrf)}
<div class="row"><button class="primary" type="submit" name="decision" value="allow">Allow</button><button class="secondary" type="submit" name="decision" value="deny">Cancel</button></div>
</form>
<p class="small">Not you? <a href="/login">Sign in with your own account</a>.</p>`,
  );
});

app.post("/oauth/approve", async (c) => {
  // `Origin: null` (privacy mode / a page served with no-referrer) passes only when the browser itself says
  // the post came from this same site; the CSRF cookie check below still applies.
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  const nullOk = origin === "null" && (site === "same-origin" || site === "none");
  if ((origin && origin !== originOf(c) && !nullOk) || site === "cross-site" || site === "same-site")
    return page("Refused", `<h1>Refused</h1><p>Cross-site request.</p>`, 403);
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const get = (k: string) => (typeof form[k] === "string" ? (form[k] as string) : undefined);
  const csrfCookie = readCookie(c.req.header("cookie"), CSRF_COOKIE);
  if (!csrfCookie || get("csrf") !== csrfCookie) return page("Refused", `<h1>Refused</h1><p>Your session changed. Start connecting again from the AI app.</p>`, 403);
  const p = readAuthParams(get);
  const chk = await checkAuthParams(c, p);
  if (!chk.ok) return chk.res;
  const who = await sessionUser(c);
  if (!who) return page("Sign in again", `<h1>Please sign in again</h1><p>Start connecting again from the AI app.</p>`, 401);
  const back = new URL(p.redirectUri);
  if (p.state) back.searchParams.set("state", p.state);
  if (get("decision") !== "allow") {
    back.searchParams.set("error", "access_denied");
    return c.redirect(back.toString(), 302);
  }
  if (!(await hasMcpAccess(c.var.DB, who.userId, who.role))) return page("Not turned on", `<h1>AI Connector is not turned on for your account</h1>`, 403);
  const code = await createCode(c.var.DB, { clientId: p.clientId, userId: who.userId, redirectUri: p.redirectUri, codeChallenge: p.challenge });
  back.searchParams.set("code", code);
  return c.redirect(back.toString(), 302);
});

// ── OAuth: token ────────────────────────────────────────────────────────────

app.post("/oauth/token", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  let f: Record<string, string> = {};
  try {
    if (ct.includes("application/json")) {
      const j = (await c.req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(j)) if (typeof v === "string") f[k] = v;
    } else {
      const b = await c.req.parseBody();
      for (const [k, v] of Object.entries(b)) if (typeof v === "string") f[k] = v;
    }
  } catch {
    f = {};
  }
  const err = (error: string, desc: string, status: 400 | 401 = 400) =>
    c.json({ error, error_description: desc }, status, { "Cache-Control": "no-store" });
  const clientId = f.client_id ?? "";
  if (!clientId || !(await getClient(c.var.DB, clientId))) return err("invalid_client", "Unknown client", 401);

  let issued: Awaited<ReturnType<typeof issueTokens>> | null = null;
  if (f.grant_type === "authorization_code") {
    if (!f.code || !f.code_verifier) return err("invalid_request", "code and code_verifier are required");
    const rec = await consumeCode(c.var.DB, f.code);
    if (!rec || rec.clientId !== clientId) return err("invalid_grant", "Code is invalid, used or expired");
    if (f.redirect_uri && f.redirect_uri !== rec.redirectUri) return err("invalid_grant", "redirect_uri mismatch");
    if ((await pkceS256(f.code_verifier)) !== rec.codeChallenge) return err("invalid_grant", "PKCE check failed");
    const u = await c.var.DB.prepare("SELECT role, isActive FROM users WHERE id = ?").bind(rec.userId).first<Record<string, unknown>>();
    if (!u || Number(u.isActive ?? u.isactive) !== 1 || !(await hasMcpAccess(c.var.DB, rec.userId, String(u.role ?? "")))) {
      return err("invalid_grant", "This account may not use the AI connector");
    }
    issued = await issueTokens(c.var.DB, rec.userId, clientId);
  } else if (f.grant_type === "refresh_token") {
    if (!f.refresh_token) return err("invalid_request", "refresh_token is required");
    issued = await refreshTokens(c.var.DB, f.refresh_token, clientId);
    if (!issued) return err("invalid_grant", "Refresh token is invalid, revoked or expired");
  } else {
    return err("unsupported_grant_type", "Use authorization_code or refresh_token");
  }
  return c.json(
    { access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, refresh_token: issued.refreshToken, scope: "erp.read" },
    200,
    { "Cache-Control": "no-store", Pragma: "no-cache" },
  );
});

// ── MCP endpoint ────────────────────────────────────────────────────────────

type RpcReq = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const INSTRUCTIONS = `You are connected to Hookka ERP (a furniture manufacturer's ERP: sales, production, MRP, warehouse, delivery, procurement, finance, HR) as the signed-in staff member.
Reading is limited to what this person may see in the ERP; fields they may not see (cost, salary, price) are removed — never guess them.
ANSWER FAST — use a quick answer first, it is one call and already summarised:
- Sales (this month, a month, quarter or year; by customer, top products, daily, trend): sales_summary {period: "YYYY-MM" | "YYYY-Qn" | "YYYY"}.
- Production (production revenue, by department, daily, top products, units completed, workforce, backlog; compared with the same days last month): production_summary {from, to} (default: this month to today).
- Orders in the pipeline: order_backlog. Which sales orders are overdue: so_overdue. What is due for delivery today / this week: deliveries_due {range}.
- Who owes us money, and what is delivered but not invoiced: receivables_summary. What we owe suppliers: payables_summary.
- Purchasing: purchasing_summary {view: "overview" | "overdue" (late POs) | "awaiting" (still to be received) | "suppliers" (who delivers late, {days})}.
- Which materials are short: material_shortages. Low or negative stock: inventory_summary. Late production orders: production_late.
- Who is on leave or absent today (HR only): attendance_today. "What do I need to look at today?": daily_brief.
- A list as an Excel file: export_excel {list, search, status, from, to, fields} (15-minute download link).
- A document by number or a customer / product name: search {query}, then fetch {id} for the full record.
Only when no quick answer fits: list_modules → list_endpoints → erp_get. With erp_get pass "fields" (only the keys you need) and query filters (from/to YYYY-MM-DD, page/limit, search) to keep replies small.
Money in the ERP is integer sen (RM × 100) unless a field says RM. Dates are Malaysia time.
A document's chain (sales order → production orders → job cards → delivery orders → invoices → payments, or back from any of them; or a purchase order → GRNs → purchase invoices): document_flow {number_or_id}.
Keep replies short: lead with the count and the few lines that matter, give links. If a tool says the person has no access to something, say so in one line — never guess the figure.
For a PDF: find the document id, then get_pdf (sales orders, delivery orders and invoices come back as a 15-minute download link; purchase orders as a link to the ERP page). Give the person the link.
ACTIONS (only if the admin switched them on): to book a meeting call propose_meeting, to send an email call propose_email. They do NOTHING yet — they return a summary and a confirmationId. Show the person that summary word for word and ask them to confirm. Only call confirm_action after they explicitly say yes; if they say no or want changes, call cancel_action (and propose again with the changes). Never confirm on your own, never confirm something the person has not seen. Nothing else can be changed: no orders, money, stock, approvals or deletes.
If a call says "not available to your role", tell the user they do not have permission for that data.`;

const TOOLS = [
  {
    name: "sales_summary",
    title: "Sales summary (quick answer)",
    description: "Sales for a month, quarter or year in ONE call: sales orders, delivered and invoiced (RM), change vs the previous month, units sold, by customer, top bedframes and sofa models, daily figures and a 6-month trend. Same numbers as the Dashboard.",
    inputSchema: {
      type: "object",
      properties: { period: { type: "string", description: "YYYY-MM, YYYY-Qn or YYYY. Default: this month." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "production_summary",
    title: "Production summary (quick answer)",
    description: "Production for a date range in ONE call: production revenue (RM) by category and by department, compared with the same days last month, daily figures, top products, units completed, workforce and today's backlog. Default range: this month to today.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "YYYY-MM-DD. Default: the 1st of this month." },
        to: { type: "string", description: "YYYY-MM-DD. Default: today." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "whoami",
    title: "Who am I connected as",
    description: "The ERP account this connection uses, its role, and which modules it may read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_modules",
    title: "List ERP modules",
    description: "The ERP modules this person may read, each with its API path prefix. Start here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_endpoints",
    title: "List read endpoints",
    description: "Every readable GET endpoint under a module prefix (e.g. /api/production-orders), with :id style placeholders.",
    inputSchema: {
      type: "object",
      properties: { prefix: { type: "string", description: "Module prefix from list_modules, e.g. /api/mrp" } },
      required: ["prefix"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "erp_get",
    title: "Read from the ERP",
    description: "Read one ERP endpoint as the signed-in person (GET only) and return its JSON. Large replies are cut; narrow them with query parameters.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Endpoint path without query string, e.g. /api/working-hour-entries/production-revenue" },
        query: { type: "object", description: "Query parameters, e.g. {\"from\":\"2026-11-01\",\"to\":\"2026-11-24\"}", additionalProperties: { type: ["string", "number", "boolean"] } },
        fields: { type: "array", items: { type: "string" }, description: "Only keep these keys (at any depth), e.g. [\"soNo\",\"customerName\",\"totalSen\"]. Makes big replies small and fast." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_pdf",
    title: "Get a document's PDF",
    description: "The PDF of a sales order, delivery order or invoice — the same file the ERP's Download PDF button makes — as a download link valid for 15 minutes. For a purchase order it returns a link to the ERP page instead (press PDF there). Get the document's id first (erp_get / search).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["delivery-order", "invoice", "sales-order", "purchase-order"] },
        id: { type: "string", description: "The document's id from the ERP" },
      },
      required: ["type", "id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "erp_link",
    title: "Link to a document (for its PDF)",
    description: "A link that opens a sales order, purchase order, delivery order or invoice in the ERP, where the person can download its PDF. Get the document's id first (erp_get / search). The person must be logged in and allowed to see it.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["sales-order", "purchase-order", "delivery-order", "invoice"] },
        id: { type: "string", description: "The document's id from the ERP (not necessarily its number)" },
      },
      required: ["type", "id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "order_backlog",
    title: "Order backlog (quick answer)",
    description: "Sales orders by status with their value (RM), what is in production, ready to ship and not yet delivered, today's production backlog in days and overdue production by customer. ONE call.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "receivables_summary",
    title: "Receivables / debtor ageing (quick answer)",
    description: "Who owes us and for how long: total owed (RM) by age (current, 30, 60, 90, over 90), the customers owing most and the oldest unpaid invoices (Accounting > Debtor Aging), plus delivery orders shipped but not yet invoiced. ONE call.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "material_shortages",
    title: "Material shortages (quick answer)",
    description: "Raw materials short for open production orders, from the MRP page's calculation: how many are short, the 15 needed soonest (short, stock, on order, need-by date, main supplier) and BOM gaps. ONE call.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "inventory_summary",
    title: "Stock levels (quick answer)",
    description: "Low and negative stock in ONE call: raw materials below their minimum, below zero and at zero (by group, the worst first), and finished goods in stock / reserved. Same data as the Inventory page.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "purchasing_summary",
    title: "Purchasing (quick answer)",
    description: "Purchase orders in ONE call. view \"overview\" (default): open POs by status (RM), overdue, awaiting GRN, expected in the next 7 days. \"overdue\": POs past their expected date and not fully received — supplier, days late, value. \"awaiting\": still to be received (partly received first). \"suppliers\": which suppliers deliver late most often over the last `days` (default 90; 30 = about this month) — late count, on-time %, average days late.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["overview", "overdue", "awaiting", "suppliers"] },
        days: { type: "number", description: "For view suppliers: the window in days (default 90)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "payables_summary",
    title: "What we owe suppliers (quick answer)",
    description: "Unpaid supplier invoices in ONE call: total owed (RM) by age, past due, due in the next 7 days and the suppliers owed most. Same as Accounting > Creditor Aging; needs the accounting permission.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "so_overdue",
    title: "Overdue sales orders (quick answer)",
    description: "Open sales orders past their Hookka expected delivery date in ONE call: count, value (RM), by customer, and the 15 most late with days late and links.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "deliveries_due",
    title: "Deliveries due (quick answer)",
    description: "What is due for delivery today or this week in ONE call: delivery orders not yet delivered by delivery date (customer, hub, lorry, status) and sales orders due by their expected date.",
    inputSchema: { type: "object", properties: { range: { type: "string", enum: ["today", "week"], description: "Default: today." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "production_late",
    title: "Late production orders (quick answer)",
    description: "Live production orders past their target end date in ONE call: count, by department (where each is now) and customer, and the 15 most late with links.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "attendance_today",
    title: "Who is away today (quick answer, HR)",
    description: "Who is on approved leave, absent or not clocked in yet today, from Attendance and Leave. Only for people with HR access; others are told they have no access.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "daily_brief",
    title: "What do I need to look at today?",
    description: "The person's day in ONE call: overdue and due-in-3-days sales orders and purchase orders, Mail Center threads waiting for them, and service-case / leave approvals waiting for them — each with a count and the top 5 with links.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "export_excel",
    title: "Export a list to Excel",
    description: "A real .xlsx of one ERP list, read as the person (their permissions and hidden fields apply), up to 5,000 rows, money in RM. Returns a 15-minute download link, the row count and whether it was cut at the cap.",
    inputSchema: {
      type: "object",
      properties: {
        list: { type: "string", enum: Object.keys(EXPORT_LISTS) },
        search: { type: "string", description: "Keep rows containing this text" },
        status: { type: "string", description: "Keep rows with this status, e.g. CONFIRMED" },
        from: { type: "string", description: "YYYY-MM-DD, on the list's document date" },
        to: { type: "string", description: "YYYY-MM-DD" },
        fields: { type: "array", items: { type: "string" }, description: "Only these columns (keys or column titles)" },
      },
      required: ["list"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "search",
    title: "Search the ERP",
    description: "Find sales orders, delivery orders, invoices, purchase orders, production orders, customers, products, suppliers and more by number or name. Returns ids to open with fetch.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "A document number, customer, product or supplier name" } }, required: ["query"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "fetch",
    title: "Open a search result",
    description: "The full record for an id returned by search (e.g. \"sales_order:abc123\"): a sales order with its lines, an invoice, a customer…",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "An id from search" } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "document_flow",
    title: "Document flow (SO → production → DO → invoice → payment)",
    description: "The whole chain around one document, in ONE call: its sales order, production orders and job cards, delivery orders, invoices and payments — each with number, status, date, amount (RM) and its ERP link. Give a sales order, production order, delivery order or invoice number (or an id from search). For a purchase order (number, or purchase_order:<id> from search): the PO, its GRNs and its purchase invoices.",
    inputSchema: {
      type: "object",
      properties: { number_or_id: { type: "string", description: "e.g. SO-2611-376, DO-2611-102, INV-2611-088, a PO number, or sales_order:abc123 from search" } },
      required: ["number_or_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "propose_meeting",
    title: "Propose a meeting (needs the person's yes)",
    description: "Prepare a meeting booking in Meetings as the signed-in person. Nothing is booked yet: it checks everything a real booking checks and returns a summary and a confirmationId. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "Malaysia time, e.g. 2026-11-27T15:00 (or ISO with an offset)" },
        end: { type: "string", description: "Malaysia time. Default: one hour after start." },
        attendees: { type: "array", items: { type: "string" }, description: "Colleagues by full name or email; an outside email gets an invitation by email." },
        room: { type: "string", description: "Meeting room name (optional)" },
        notes: { type: "string" },
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "propose_email",
    title: "Propose an email (needs the person's yes)",
    description: "Prepare an email from the person's Mail Center mailbox. Nothing is sent yet: it checks the recipients and the mailbox like the Send button does and returns a summary and a confirmationId. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" } },
        cc: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string", description: "Plain text" },
        from_mailbox: { type: "string", description: "Which of the person's mailboxes to send from, if they have more than one" },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "confirm_action",
    title: "Do a confirmed meeting / email",
    description: "Book the meeting or send the email from propose_meeting / propose_email. ONLY after the person has seen the summary and explicitly said yes. Each confirmationId works once and only for 10 minutes.",
    inputSchema: { type: "object", properties: { confirmationId: { type: "string" } }, required: ["confirmationId"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "cancel_action",
    title: "Cancel a proposed meeting / email",
    description: "Drop a proposal the person said no to (or wants changed).",
    inputSchema: { type: "object", properties: { confirmationId: { type: "string" } }, required: ["confirmationId"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

/** Document → its ERP page (where the PDF is made) and its read API. */
export const DOC_LINKS: Record<string, { page: string; api: string }> = {
  "sales-order": { page: "/sales", api: "/api/sales-orders" },
  "purchase-order": { page: "/procurement", api: "/api/purchase-orders" },
  "delivery-order": { page: "/delivery", api: "/api/delivery-orders" },
  invoice: { page: "/invoices", api: "/api/invoices" },
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

async function canAny(c: Context<Env>, resources: string[]): Promise<boolean> {
  for (const r of resources) if (await hasPermission(c, r, "read")) return true;
  return false;
}

/**
 * Permission answers for the redactor. Round 3 perf: looked up ONCE per request
 * and person (a quick answer / export makes 2–10 reads, each used to ask the
 * same six questions again), in parallel. Keyed by user + role too, because the
 * leak check runs several people's calls on one admin request (runToolAs).
 */
const permMemo = new WeakMap<object, Map<string, Promise<(perm: string) => boolean>>>();
function permLookup(c: Context<Env>): Promise<(perm: string) => boolean> {
  const g = c as unknown as { get: (k: string) => unknown };
  const who = `${String(g.get("userId") ?? "")}|${String(g.get("userRole") ?? "")}`;
  let m = permMemo.get(c);
  if (!m) permMemo.set(c, (m = new Map()));
  const hit = m.get(who);
  if (hit) return hit;
  const perms = ["payroll:read", "payslips:read", "cost-ledger:read", "accounting:read", "product-pricing:read", "revenue-figures:read"];
  const p = Promise.all(perms.map((x) => hasPermission(c, x.split(":")[0], x.split(":")[1]))).then((ans) => {
    const got = new Map(perms.map((x, i) => [x, ans[i]]));
    return (q: string) => got.get(q) === true;
  });
  m.set(who, p);
  return p;
}

async function innerGet(c: Context<Env>, token: string, pathWithQuery: string): Promise<Response> {
  if (!appRef) throw new Error("MCP app not initialised");
  let ctx: unknown;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  return appRef.fetch(
    new Request(originOf(c) + pathWithQuery, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, [MCP_INNER_HEADER]: mcpInnerSecret(), accept: "application/json" },
    }),
    c.env,
    ctx,
  );
}

type ReadValue =
  | { ok: true; status: number; value: unknown; removed: Set<string>; target: string }
  | { ok: false; status: number; message: string; note: string; target: string };

/**
 * A fixed endpoint outside the readable-module map, used by ONE tool for a
 * narrow purpose (daily_brief's Mail Center count). Not reachable through
 * erp_get. Same gate (the resource's read) + inner GET as the person +
 * redaction as any other read; the route still runs its own scope check.
 */
type FixedRead = { path: string; resources: string[] };
const MAIL_THREADS_READ: FixedRead = { path: "/api/mail-center/threads", resources: ["mail-center"] };

/** Read one endpoint as the person: gated, then redacted. Shared by erp_get and the quick answers. */
async function readValue(c: Context<Env>, token: string, rawPath: string, query: Record<string, unknown> | undefined, fixed?: FixedRead): Promise<ReadValue> {
  const d = fixed ? { ok: true as const, path: fixed.path, resources: fixed.resources } : classifyPath(rawPath);
  if (!d.ok) return { ok: false, status: 400, message: d.reason, note: "blocked path", target: rawPath };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") continue;
    qs.set(k, String(v));
  }
  const target = d.path + (qs.toString() ? `?${qs.toString()}` : "");
  if (!(await canAny(c, d.resources))) {
    return { ok: false, status: 403, message: `Not available to your role: you do not have read permission for ${d.resources.join(" / ")}.`, note: "no permission", target };
  }
  const res = await innerGet(c, token, target);
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("json")) {
    return { ok: false, status: res.status, message: `This endpoint returns a file (${ctype || "unknown type"}), not data. Open it in the ERP instead.`, note: "non-json", target };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, status: 502, message: `The ERP sent a reply that could not be read (HTTP ${res.status}).`, note: `unreadable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120), target };
  }
  if (res.status === 403) return { ok: false, status: 403, message: "Not available to your role.", note: "no permission", target };
  if (res.status >= 400) {
    const msg = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `HTTP ${res.status}`;
    return { ok: false, status: res.status, message: `The ERP answered: ${msg}`, note: msg.slice(0, 120), target };
  }
  const redact = makeRedactor(await permLookup(c), d.resources);
  const { value, removed } = redact(body);
  return { ok: true, status: res.status, value, removed, target };
}

async function readEndpoint(
  c: Context<Env>,
  token: string,
  rawPath: string,
  query: Record<string, unknown> | undefined,
  fields: string[] = [],
): Promise<{ result: ToolResult; status: number; note: string; target: string }> {
  const r = await readValue(c, token, rawPath, query);
  if (!r.ok) return { result: text(r.message, true), status: r.status, note: r.note, target: r.target };
  let out = JSON.stringify(pickFields(r.value, fields));
  let cut = false;
  if (out.length > MAX_RESULT_CHARS) {
    out = out.slice(0, MAX_RESULT_CHARS);
    cut = true;
  }
  const notes: string[] = [];
  if (r.removed.size) notes.push(`Fields hidden for this person: ${[...r.removed].join(", ")}.`);
  if (cut) notes.push(`Reply cut at ${MAX_RESULT_CHARS} characters — pass "fields" and narrow it with query parameters (dates, page/limit, search), or use a quick answer.`);
  return { result: text((notes.length ? notes.join(" ") + "\n" : "") + out), status: r.status, note: [...r.removed].join(","), target: r.target };
}

/** A quick answer: the summary as JSON, or the first refusal / error in plain words. */
function quickResult(summary: unknown, reads: ReadValue[]): { result: ToolResult; status: number; note: string } {
  const failed = reads.find((x) => !x.ok);
  if (failed && !failed.ok) return { result: text(failed.message, true), status: failed.status, note: failed.note };
  const hidden = new Set<string>();
  for (const x of reads) if (x.ok) for (const k of x.removed) hidden.add(k);
  const head = hidden.size ? `Fields hidden for this person: ${[...hidden].join(", ")}.\n` : "";
  return { result: text(head + JSON.stringify(summary)), status: 200, note: [...hidden].join(",") };
}

type Step = { result: ToolResult; status: number; target: string; note: string };

const errText = (body: unknown): string =>
  body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "";

const SAFE_REF = /^[A-Za-z0-9._-]{1,80}$/;

/** document_flow for a purchase order: the PO and its GRNs at once, then the supplier's purchase invoices (FAQ P5). */
async function purchaseFlow(c: Context<Env>, token: string, poId: string, target: string): Promise<Step> {
  if (!SAFE_REF.test(poId)) return { result: text("That purchase order id cannot be read.", true), status: 400, target, note: "" };
  const [po, grns] = await Promise.all([
    readValue(c, token, `/api/purchase-orders/${poId}`, undefined),
    readValue(c, token, "/api/grn", { poId }),
  ]);
  if (!po.ok) return { result: text(po.status === 403 ? "You don't have access to purchase orders." : po.message, true), status: po.status, target, note: po.note };
  const d = (po.value && typeof po.value === "object" ? ((po.value as { data?: unknown }).data ?? po.value) : {}) as Record<string, unknown>;
  const supplierId = String(d.supplierId ?? "");
  const pis = supplierId && SAFE_REF.test(supplierId) ? await readValue(c, token, "/api/purchase-invoices", { supplierId }) : null;
  const P = new Parts();
  P.opt(po, "purchase orders");
  const flow = shapePurchaseFlow(po.value, P.opt(grns, "goods received (GRN)"), P.opt(pis, "purchase invoices"), originOf(c));
  return { ...P.done({ from: `purchase_order:${poId}`, flows: [flow], tip: "Amounts are RM; null means not shown to this person. Give the person the links." }), target };
}

/** document_flow: the anchor → its sales order(s) → each chain, every read AS THE PERSON through readValue. */
async function documentFlow(c: Context<Env>, token: string, raw: string): Promise<Step> {
  const q = raw.trim();
  const target = `flow:${q}`;
  const fail = (message: string, status: number, note = ""): Step => ({ result: text(message, true), status, target, note });
  if (!q || q.length > 80) return fail("Give a sales order, production order, delivery order or invoice number.", 400);
  let anchor: { kind: FlowKind; id: string } | null = parseAnchorId(q);
  const directPo = anchor ? null : pickPurchaseAnchor(q, null);
  if (directPo) return purchaseFlow(c, token, directPo, target);
  if (!anchor) {
    const sr = await readValue(c, token, "/api/search", { q, limit: 8 });
    if (!sr.ok) return fail(sr.message, sr.status, sr.note);
    const poId = pickPurchaseAnchor(q, sr.value);
    if (poId) return purchaseFlow(c, token, poId, target);
    anchor = pickFlowAnchor(sr.value, q);
    if (!anchor) return fail(`No sales order, production order, delivery order or invoice matches "${q}".`, 404);
  }
  let refs: string[] = [];
  if (anchor.kind === "sales_order" || anchor.kind === "service_order") {
    refs = [anchor.id];
  } else {
    if (!SAFE_REF.test(anchor.id)) return fail("That document id cannot be read.", 400);
    const d = await readValue(c, token, `${FLOW_API[anchor.kind]}/${anchor.id}`, undefined);
    if (!d.ok) return fail(d.message, d.status, d.note);
    let r = soRefsFromDoc(anchor.kind, anchor.id, d.value);
    if (!r.refs.length && r.viaDo && SAFE_REF.test(r.viaDo)) {
      const dd = await readValue(c, token, `/api/delivery-orders/${r.viaDo}`, undefined);
      if (dd.ok) r = soRefsFromDoc("delivery_order", r.viaDo, dd.value);
    }
    refs = r.refs;
  }
  refs = refs.filter((x) => SAFE_REF.test(x));
  if (!refs.length) return fail(`This ${anchor.kind.replace(/_/g, " ")} is not linked to a sales order, so there is no chain to show.`, 404);
  const chains = await Promise.all(
    refs.map(async (ref) => {
      const [det, fp] = await Promise.all([
        readValue(c, token, `/api/sales-orders/${ref}`, undefined),
        readValue(c, token, `/api/sales-orders/${ref}/footprint`, undefined),
      ]);
      return { det, fp };
    }),
  );
  const okChains = chains.filter((x) => x.det.ok);
  if (!okChains.length) {
    const f = chains[0].det;
    return f.ok ? fail("Nothing to show.", 404) : fail(f.message, f.status, f.note);
  }
  const hidden = new Set<string>();
  for (const x of okChains) if (x.det.ok) for (const k of x.det.removed) hidden.add(k);
  const flows = okChains.map((x) => shapeFlow(x.det.ok ? x.det.value : null, x.fp.ok ? x.fp.value : null, originOf(c)));
  const head = hidden.size ? `Fields hidden for this person: ${[...hidden].join(", ")}.\n` : "";
  return {
    result: text(head + JSON.stringify({ from: `${anchor.kind}:${anchor.id}`, flows, tip: "Amounts are RM; null means not shown to this person. Give the person the links." })),
    status: 200,
    target,
    note: [...hidden].join(","),
  };
}

/** propose_meeting / propose_email: validate like the real submit, store one pending action. Nothing is done yet. */
async function proposeAction(c: Context<Env>, id: McpIdentity, token: string, kind: ActionKind, args: Record<string, unknown>): Promise<Step> {
  let target = `propose:${kind}`;
  const fail = (message: string, status: number): Step => ({ result: text(message, true), status, target, note: "" });
  if (!(await actionsEnabled(c.var.DB))) return fail(ACTIONS_OFF_MESSAGE, 403);
  let p: ReturnType<typeof buildMeetingProposal> | ReturnType<typeof buildEmailProposal>;
  if (kind === "meeting") {
    const bootRes = await innerGet(c, token, "/api/meetings/bootstrap");
    const bootJson = (await bootRes.json().catch(() => null)) as unknown;
    if (bootRes.status >= 400 || !bootJson) return fail(errText(bootJson) || "Meetings could not be reached. Please try again in a moment.", bootRes.status >= 400 ? bootRes.status : 502);
    const boot = readBootstrap(bootJson);
    const mp = buildMeetingProposal(args, boot);
    if (mp.ok) {
      // Early warning only — the hub decides clashes when the person confirms (409).
      const calRes = await innerGet(c, token, `/api/meetings/calendar?from=${encodeURIComponent(mp.body.start)}&to=${encodeURIComponent(mp.body.end)}`);
      if (calRes.ok) mp.warnings.push(...meetingBusyWarnings(mp.body, await calRes.json().catch(() => null), boot.people));
    }
    p = mp;
  } else {
    // The compose route's own gate, asked up front so the person hears it before saying yes.
    if (!(await hasPermission(c, "mail-center", "create"))) return fail("Sending email is not available to your role.", 403);
    const mbRes = await innerGet(c, token, "/api/mail-center/addresses");
    const mbJson = (await mbRes.json().catch(() => null)) as unknown;
    if (mbRes.status >= 400 || !mbJson) return fail(errText(mbJson) || "Mail Center could not be read.", mbRes.status >= 400 ? mbRes.status : 502);
    p = buildEmailProposal(args, readMailboxes(mbJson), id.userId);
  }
  if (!p.ok) return fail(p.error, 400);
  target = p.target;
  const pend = await createPendingAction(c.var.DB, { tokenId: id.tokenId, userId: id.userId, kind, payload: p.body, summary: p.summary });
  return {
    result: text(
      JSON.stringify({
        confirmationId: pend.id,
        summary: p.summary,
        warnings: p.warnings,
        expiresInMinutes: 10,
        next: "Nothing has been done yet. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes; otherwise call cancel_action.",
      }),
    ),
    status: 200,
    target,
    note: "",
  };
}

/**
 * The ONE write an MCP token can make: the ERP's own create-meeting / compose
 * route, in-process, as the person. Armed for this token + method + path just
 * before the call; auth-middleware.ts takes the arm once (mcp-inner.ts).
 */
async function innerAction(c: Context<Env>, id: McpIdentity, token: string, actionId: string, kind: ActionKind, body: unknown): Promise<{ status: number; body: unknown }> {
  if (!appRef) throw new Error("MCP app not initialised");
  const route = allowlistedAction(kind);
  if (!route) throw new Error(`Not an allowed action: ${kind}`);
  let ctx: unknown;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  armConfirmedAction(actionId, id.tokenId, route.method, route.path);
  const res = await appRef.fetch(
    new Request(originOf(c) + route.path, {
      method: route.method,
      headers: {
        authorization: `Bearer ${token}`,
        [MCP_INNER_HEADER]: mcpInnerSecret(),
        [MCP_ACTION_HEADER]: actionId,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    }),
    c.env,
    ctx,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** confirm_action: switch on, under the daily cap, single-use claim, then the real route. */
async function confirmAction(c: Context<Env>, id: McpIdentity, token: string, raw: string): Promise<Step> {
  const cid = raw.trim();
  let target = `confirm:${cid}`;
  const fail = (message: string, status: number): Step => ({ result: text(message, true), status, target, note: "" });
  if (!/^mcpa_[a-f0-9]{24}$/.test(cid)) return fail("Give the confirmationId from propose_meeting or propose_email.", 400);
  if (!(await actionsEnabled(c.var.DB))) return fail(ACTIONS_OFF_MESSAGE, 403);
  if ((await confirmedSince(c.var.DB, id.userId, myDayStartIso())) >= ACTIONS_PER_DAY) {
    return fail(`You have reached today's limit of ${ACTIONS_PER_DAY} AI actions. Do it in the ERP instead, or try again tomorrow.`, 429);
  }
  const act = await consumePendingAction(c.var.DB, cid, id.tokenId, id.userId);
  if (!act) return fail("That confirmation is unknown, already used, cancelled, expired (10 minutes) or not yours. Propose it again.", 404);
  target = actionTarget(act.kind, act.payload);
  let out: { status: number; body: unknown };
  try {
    out = await innerAction(c, id, token, cid, act.kind, act.payload);
  } catch (e) {
    out = { status: 502, body: { error: e instanceof Error ? e.message : String(e) } };
  }
  const d = describeOutcome(act.kind, out.status, out.body);
  await finishPendingAction(c.var.DB, cid, out.status, d.text);
  return { result: text(d.text, !d.ok), status: out.status, target, note: "" };
}

// ── round 3 quick answers, daily brief, export (owner 2026-11-26) ───────────

/** Collects what a multi-read answer could not read: 403 → "no access", anything else → a problem line. */
class Parts {
  noAccess: string[] = [];
  problems: string[] = [];
  hidden = new Set<string>();
  /** The value of a read the answer can do without (null when refused or failed). */
  opt(r: ReadValue | null, label: string): unknown {
    if (!r) return null;
    if (r.ok) {
      for (const k of r.removed) this.hidden.add(k);
      return r.value;
    }
    if (r.status === 403) this.noAccess.push(label);
    else this.problems.push(`${label} could not be read (${r.message})`);
    return null;
  }
  /** A read the answer needs: its value, or the plain refusal as the whole answer. */
  need(r: ReadValue, label: string): { ok: true; value: unknown } | { ok: false; step: Omit<Step, "target"> } {
    if (r.ok) {
      for (const k of r.removed) this.hidden.add(k);
      return { ok: true, value: r.value };
    }
    const message = r.status === 403 ? `You don't have access to ${label}.` : r.message;
    return { ok: false, step: { result: text(message, true), status: r.status, note: r.note } };
  }
  done(summary: Record<string, unknown>): Omit<Step, "target"> {
    const out: Record<string, unknown> = { ...summary };
    if (this.noAccess.length) out.noAccess = [...new Set(this.noAccess)].map((x) => `You don't have access to ${x}.`);
    if (this.problems.length) out.couldNotRead = this.problems;
    const head = this.hidden.size ? `Fields hidden for this person: ${[...this.hidden].join(", ")}.\n` : "";
    let body = JSON.stringify(out);
    if (body.length > MAX_RESULT_CHARS) body = body.slice(0, MAX_RESULT_CHARS);
    return { result: text(head + body), status: 200, note: [...this.hidden].join(",") };
  }
}

const DO_NOT_DELIVERED = "DRAFT,LOADED,DISPATCHED,IN_TRANSIT";
const DO_SHIPPED = "LOADED,DISPATCHED,IN_TRANSIT,SIGNED,DELIVERED";

/** The round-3 quick answers + daily brief. null = not one of them. */
async function quickTool(c: Context<Env>, id: McpIdentity, token: string, name: string, args: Record<string, unknown>): Promise<Step | null> {
  const today = myToday();
  const origin = originOf(c);
  const P = new Parts();
  const fin = (target: string, s: Omit<Step, "target">): Step => ({ ...s, target });

  if (name === "inventory_summary") {
    const [inv, fg] = await Promise.all([
      // ?buckets=rawMaterials: the one bucket needed (the whole reply is ~1.2 MB).
      readValue(c, token, "/api/inventory", { buckets: "rawMaterials" }),
      readValue(c, token, "/api/inventory/fg-stock", undefined),
    ]);
    const a = P.need(inv, "inventory");
    if (!a.ok) return fin("inventory", a.step);
    return fin("inventory", P.done(summariseInventory(a.value, P.opt(fg, "finished-goods stock"))));
  }

  if (name === "purchasing_summary") {
    const view = (["overview", "overdue", "awaiting", "suppliers"].includes(String(args.view)) ? String(args.view) : "overview") as PurchasingView;
    const days = Math.max(1, Math.min(400, Number(args.days) || 90));
    const wantGrn = view === "overview" || view === "awaiting";
    const [po, grn] = await Promise.all([
      readValue(c, token, "/api/purchase-orders/stats", undefined),
      wantGrn ? readValue(c, token, "/api/grn/stats", undefined) : Promise.resolve(null),
    ]);
    const a = P.need(po, "purchase orders");
    if (!a.ok) return fin(`purchasing:${view}`, a.step);
    return fin(`purchasing:${view}${view === "suppliers" ? `:${days}d` : ""}`, P.done(summarisePurchasing(a.value, P.opt(grn, "goods received (GRN)"), today, origin, view, days)));
  }

  if (name === "payables_summary") {
    const ag = await readValue(c, token, "/api/accounting/aging", undefined);
    const a = P.need(ag, "accounting (creditor aging)");
    if (!a.ok) return fin("payables", a.step);
    return fin("payables", P.done(summarisePayables(a.value, today)));
  }

  if (name === "so_overdue") {
    const due = await readValue(c, token, "/api/sales-orders", { fields: "orders-due", top: BRIEF_SO_TOP });
    const a = P.need(due, "sales orders");
    if (!a.ok) return fin("so_overdue", a.step);
    return fin("so_overdue", P.done(summariseOverdueSales(a.value, today, origin)));
  }

  if (name === "deliveries_due") {
    const range = args.range === "week" ? "week" : "today";
    const [dos, sos] = await Promise.all([
      readValue(c, token, "/api/delivery-orders", { status: DO_NOT_DELIVERED, page: 1, limit: 500 }),
      readValue(c, token, "/api/sales-orders", { fields: "orders-due", top: BRIEF_SO_TOP }),
    ]);
    if (!dos.ok && !sos.ok) {
      const a = P.need(dos, "delivery orders");
      if (!a.ok) return fin(`deliveries:${range}`, a.step);
    }
    return fin(`deliveries:${range}`, P.done(summariseDeliveriesDue(range, P.opt(dos, "delivery orders"), P.opt(sos, "sales orders"), today, origin)));
  }

  if (name === "production_late") {
    const board = await readValue(c, token, "/api/production-orders/board", undefined);
    const a = P.need(board, "production orders");
    if (!a.ok) return fin("production_late", a.step);
    return fin("production_late", P.done(summariseProductionLate(a.value, today, origin)));
  }

  if (name === "attendance_today") {
    const [att, lv, wk] = await Promise.all([
      readValue(c, token, "/api/attendance", { date: today }),
      readValue(c, token, "/api/leaves", { status: "APPROVED" }),
      readValue(c, token, "/api/workers", undefined),
    ]);
    if (!att.ok && !lv.ok) {
      const status = att.status === 403 && lv.status === 403 ? 403 : att.status;
      return fin(`attendance:${today}`, { result: text(status === 403 ? "You don't have access to attendance or leave (HR only)." : att.message, true), status, note: att.note });
    }
    const a = P.opt(att, "attendance");
    const l = P.opt(lv, "leave");
    const w = att.ok ? P.opt(wk, "the worker list (needed for 'not clocked in yet')") : null;
    return fin(`attendance:${today}`, P.done(summariseAttendance(today, a, l, w)));
  }

  if (name === "daily_brief") {
    const [mayApproveCases, mayApproveLeave] = await Promise.all([hasPermission(c, "service-cases", "approve"), hasPermission(c, "leaves", "update")]);
    // At most five reads, all at once.
    const [so, po, mail, svc, lv] = await Promise.all([
      readValue(c, token, "/api/sales-orders", { fields: "orders-due", top: BRIEF_SO_TOP }),
      readValue(c, token, "/api/purchase-orders/stats", undefined),
      readValue(c, token, MAIL_THREADS_READ.path, { status: "open", limit: BRIEF_MAIL_LIMIT }, MAIL_THREADS_READ),
      mayApproveCases ? readValue(c, token, "/api/service-cases/approvals", undefined) : Promise.resolve(null),
      mayApproveLeave ? readValue(c, token, "/api/leaves", { status: "PENDING" }) : Promise.resolve(null),
    ]);
    const brief = buildDailyBrief({
      today,
      origin,
      userId: id.userId,
      salesDue: P.opt(so, "sales orders"),
      poStats: P.opt(po, "purchase orders"),
      mailThreads: P.opt(mail, "Mail Center"),
      serviceApprovals: P.opt(svc, "service-case approvals"),
      leaveApprovals: P.opt(lv, "leave approvals"),
      noAccess: [],
    });
    return fin(`brief:${today}`, P.done(brief));
  }

  if (name === "receivables_summary") {
    const [ag, dos] = await Promise.all([
      readValue(c, token, "/api/accounting/aging", undefined),
      readValue(c, token, "/api/delivery-orders", { status: DO_SHIPPED, page: 1, limit: 500 }),
    ]);
    const a = P.need(ag, "accounting (debtor aging)");
    if (!a.ok) return fin("receivables", a.step);
    const shipped = P.opt(dos, "delivery orders");
    return fin(
      "receivables",
      P.done({
        ...summariseReceivables(a.value),
        ...(shipped !== null ? { shippedNotInvoiced: { ...summariseShippedNotInvoiced(shipped, today, origin), countedFrom: "the 500 most recent shipped delivery orders" } } : {}),
      }),
    );
  }

  return null;
}

/** export_excel: page through one allowlisted list as the person, build the .xlsx, store it like get_pdf. */
async function exportExcel(c: Context<Env>, id: McpIdentity, token: string, args: Record<string, unknown>): Promise<Step> {
  const listName = String(args.list ?? "");
  const spec = EXPORT_LISTS[listName];
  let target = `export:${listName}`;
  const fail = (message: string, status: number, note = ""): Step => ({ result: text(message, true), status, target, note });
  if (!spec) return fail(`Choose a list: ${Object.keys(EXPORT_LISTS).join(", ")}.`, 400);
  const first = await readValue(c, token, spec.api, { ...(spec.query ?? {}), ...(spec.paginated ? { page: 1, limit: EXPORT_PAGE_SIZE } : {}) });
  if (!first.ok) return fail(first.status === 403 ? `You don't have access to ${spec.label.toLowerCase()}.` : first.message, first.status, first.note);
  const hidden = new Set(first.removed);
  let rows = exportRows(first.value, spec.rowsAt);
  const total = exportTotal(first.value);
  let sourceRows = total ?? rows.length;
  if (spec.paginated) {
    const pages = pagesToRead(total, rows.length);
    if (pages > 1) {
      // The rest at once (≤ 9 more), not one after another.
      const more = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) => readValue(c, token, spec.api, { ...(spec.query ?? {}), page: i + 2, limit: EXPORT_PAGE_SIZE })),
      );
      for (const m of more) {
        if (!m.ok) return fail(`Page could not be read: ${m.message}`, m.status, m.note);
        for (const k of m.removed) hidden.add(k);
        rows = rows.concat(exportRows(m.value, spec.rowsAt));
      }
    }
    if (total === null) sourceRows = rows.length >= EXPORT_MAX_ROWS ? EXPORT_MAX_ROWS + 1 : rows.length;
  }
  const truncated = sourceRows > EXPORT_MAX_ROWS || rows.length > EXPORT_MAX_ROWS;
  const f = filterRows(rows.slice(0, EXPORT_MAX_ROWS), {
    search: typeof args.search === "string" ? args.search : undefined,
    status: typeof args.status === "string" ? args.status : undefined,
    from: typeof args.from === "string" ? args.from : undefined,
    to: typeof args.to === "string" ? args.to : undefined,
  });
  const fields = Array.isArray(args.fields) ? (args.fields as unknown[]).map(String).filter(Boolean).slice(0, 60) : [];
  const cols = pickColumns(f.rows, spec.prefer, fields);
  if (!f.rows.length) return { result: text(JSON.stringify({ list: listName, rows: 0, note: "No rows match, so no file was made." })), status: 200, target: `${target} rows=0`, note: [...hidden].join(",") };
  if (!cols.length) return fail("None of the requested fields exist in this list.", 400);
  const filename = exportFileName(listName, myToday());
  const bytes = buildXlsx(spec.label, f.rows, cols);
  const url = await uploadExportAndSign(c.env, id.orgId || "hookka", filename, bytes, XLSX_CONTENT_TYPE, ".xlsx");
  target = `${target} rows=${f.rows.length}${truncated ? " truncated" : ""}`;
  return {
    result: text(
      (hidden.size ? `Fields hidden for this person: ${[...hidden].join(", ")}.\n` : "") +
        JSON.stringify({
          list: listName,
          filename,
          downloadUrl: url,
          expiresInMinutes: 15,
          rows: f.rows.length,
          truncated,
          ...(truncated ? { truncatedNote: `Only the newest ${EXPORT_MAX_ROWS} rows were read; filters were applied to those.` } : {}),
          ...(f.dateKey ? { dateFilteredOn: f.dateKey } : {}),
          columns: cols.length,
          note: "Give the person this link; it downloads the Excel file and stops working after 15 minutes. Money columns are RM.",
        }),
    ),
    status: 200,
    target,
    note: [...hidden].join(","),
  };
}

/** Successful quick answers, reused for 30 s per person + role + arguments (lib/mcp-limits.ts). */
const answerCache = new AnswerCache<{ result: ToolResult; target: string; note: string }>();

async function callTool(c: Context<Env>, id: McpIdentity, token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const t0 = Date.now();
  let status = 200;
  let note = "";
  let target = "";
  let result: ToolResult;
  const cacheKey = CACHEABLE_TOOLS.has(name) ? AnswerCache.key(id.userId, id.role, name, args) : "";
  const cached = cacheKey ? answerCache.get(cacheKey) : null;
  let quick: Step | null = null;
  try {
    if (cached) {
      result = cached.result;
      target = cached.target;
      note = cached.note ? `cached,${cached.note}` : "cached";
    } else if ((quick = await quickTool(c, id, token, name, args))) {
      result = quick.result;
      status = quick.status;
      note = quick.note;
      target = quick.target;
    } else if (name === "export_excel") {
      const r = await exportExcel(c, id, token, args);
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else if (name === "whoami") {
      const mods: string[] = [];
      for (const m of moduleCatalog()) if (await canAny(c, m.resources)) mods.push(m.prefix);
      const actions = await actionsEnabled(c.var.DB);
      result = text(JSON.stringify({ name: id.name, role: id.role, readableModules: mods.length, readOnly: !actions, actions: actions ? "meetings and email, after the person confirms" : "switched off" }));
    } else if (name === "list_modules") {
      const mods: { prefix: string; module: string }[] = [];
      for (const m of moduleCatalog()) if (await canAny(c, m.resources)) mods.push({ prefix: m.prefix, module: m.resources[0] });
      result = text(JSON.stringify({ readOnly: true, modules: mods, tip: "Call list_endpoints with a prefix to see its endpoints, then erp_get." }));
    } else if (name === "list_endpoints") {
      const prefix = String(args.prefix ?? "");
      target = prefix;
      const d = classifyPath(prefix);
      if (!d.ok) {
        result = text(d.reason, true);
        status = 400;
      } else if (!(await canAny(c, d.resources))) {
        result = text("Not available to your role.", true);
        status = 403;
      } else {
        const paths = [...new Set((appRef?.routes ?? []).filter((r) => r.method === "GET" && (r.path === d.path || r.path.startsWith(d.path + "/"))).map((r) => r.path))]
          .filter((p) => !p.includes("*"))
          .filter((p) => classifyPath(p.replace(/:[^/]+/g, "x")).ok)
          .sort();
        result = text(JSON.stringify({ prefix: d.path, endpoints: paths.slice(0, 200) }));
      }
    } else if (name === "get_pdf" && (args.type === "delivery-order" || args.type === "invoice" || args.type === "sales-order")) {
      const kind = args.type as PdfKind;
      const docId = String(args.id ?? "").trim();
      target = `pdf:${kind}:${docId}`;
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(docId)) {
        result = text("Give the document id.", true);
        status = 400;
      } else {
        const spec = SERVER_PDF_KINDS[kind];
        const d = classifyPath(`${spec.api}/${docId}`);
        if (!d.ok || !(await canAny(c, d.resources))) {
          result = text("Not available to your role.", true);
          status = 403;
        } else {
          const docRes = await innerGet(c, token, `${spec.api}/${encodeURIComponent(docId)}`);
          const docJson = (await docRes.json().catch(() => null)) as { success?: boolean; data?: Record<string, unknown> } | null;
          if (docRes.status >= 400 || !docJson) {
            result = text(docRes.status === 403 ? "Not available to your role." : docRes.status === 404 ? "Document not found." : `The ERP answered HTTP ${docRes.status}.`, true);
            status = docRes.status;
          } else {
            const doc = (docJson.success && docJson.data ? docJson.data : docJson) as Record<string, unknown>;
            // The page's second input: a DO / invoice's print-extras; a sales order's customer (its "Bill To").
            const exPath =
              kind === "sales-order"
                ? doc.customerId
                  ? `/api/customers/${encodeURIComponent(String(doc.customerId))}`
                  : null
                : `${spec.api}/${encodeURIComponent(docId)}/print-extras`;
            const exRes = exPath ? await innerGet(c, token, exPath) : null;
            const exJson = exRes ? ((await exRes.json().catch(() => null)) as { success?: boolean; data?: Record<string, unknown> } | null) : null;
            const extras = exJson?.success && exJson.data ? exJson.data : undefined;
            const { bytes, filename } = await renderServerPdf(kind, doc, extras, c.env, c.req.url);
            const url = await uploadPdfAndSign(c.env, id.orgId || "hookka", filename, bytes);
            result = text(JSON.stringify({ filename, downloadUrl: url, expiresInMinutes: 15, note: "Give the person this link; it downloads the PDF and stops working after 15 minutes." }));
          }
        }
      }
    } else if (name === "erp_link" || name === "get_pdf") {
      const kind = String(args.type ?? "");
      const docId = String(args.id ?? "").trim();
      const spec = DOC_LINKS[kind];
      target = `${kind}:${docId}`;
      if (!spec || !/^[A-Za-z0-9._-]{1,80}$/.test(docId)) {
        result = text("Give type (sales-order, purchase-order, delivery-order, invoice) and the document id.", true);
        status = 400;
      } else {
        // Same rule as reading it: check the document opens for this person.
        const r = await readEndpoint(c, token, `${spec.api}/${docId}`, undefined);
        if (r.result.isError) {
          result = r.result;
          status = r.status;
        } else {
          result = text(JSON.stringify({ url: `${originOf(c)}${spec.page}/${encodeURIComponent(docId)}`, how: "Open the link (sign in if asked) and press PDF / Print on the page." }));
        }
      }
    } else if (name === "sales_summary") {
      const period = normalisePeriod(args.period, myToday());
      target = `sales:${period}`;
      const ov = await readValue(c, token, "/api/dashboard/overview", { period });
      const q = quickResult(ov.ok ? summariseSales(ov.value, period) : null, [ov]);
      result = q.result;
      status = q.status;
      note = q.note;
    } else if (name === "production_summary") {
      const today = myToday();
      const range = validRange(args.from ?? `${today.slice(0, 7)}-01`, args.to ?? today);
      if (!range) {
        result = text("Give from and to as YYYY-MM-DD (from before to, at most 400 days).", true);
        status = 400;
      } else {
        target = `production:${range.from}..${range.to}`;
        const prevRange = sameDaysPrevMonth(range.from, range.to);
        const sameMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
        const [cur, prev, ov] = await Promise.all([
          readValue(c, token, "/api/working-hour-entries/production-revenue", range),
          readValue(c, token, "/api/working-hour-entries/production-revenue", prevRange),
          // The Dashboard's live block (units completed, workforce, backlog) covers one month.
          sameMonth ? readValue(c, token, "/api/dashboard/overview", { period: range.from.slice(0, 7) }) : Promise.resolve(null),
        ]);
        // Only the range itself must succeed; the comparison and the live block are extras.
        const q = quickResult(
          cur.ok ? summariseProduction(range, cur.value, prevRange, prev.ok ? prev.value : null, ov && ov.ok ? ov.value : null) : null,
          [cur],
        );
        result = q.result;
        status = q.status;
        note = q.note;
      }
    } else if (name === "order_backlog") {
      target = "order_backlog";
      const [st, ov] = await Promise.all([
        readValue(c, token, "/api/sales-orders/stats", undefined),
        readValue(c, token, "/api/dashboard/overview", { period: myToday().slice(0, 7) }),
      ]);
      const q = quickResult(st.ok ? summariseOrders(st.value, ov.ok ? ov.value : null) : null, [st]);
      result = q.result;
      status = q.status;
      note = q.note;
    } else if (name === "material_shortages") {
      target = "material_shortages";
      const pl = await readValue(c, token, "/api/mrp/plan", undefined);
      const q = quickResult(pl.ok ? summariseShortages(pl.value) : null, [pl]);
      result = q.result;
      status = q.status;
      note = q.note;
    } else if (name === "search") {
      const q = String(args.query ?? args.q ?? "").trim();
      target = `search:${q}`;
      const r = await readValue(c, token, "/api/search", { q, limit: 8 });
      if (!r.ok) {
        result = text(r.message, true);
        status = r.status;
        note = r.note;
      } else {
        result = text(JSON.stringify({ results: searchResults(r.value, originOf(c)) }));
      }
    } else if (name === "fetch") {
      const f = parseFetchId(args.id);
      target = `fetch:${String(args.id ?? "")}`;
      const api = f ? FETCH_API[f.kind] : undefined;
      if (!f) {
        result = text("Give an id from search, e.g. sales_order:abc123.", true);
        status = 400;
      } else if (!api) {
        result = text(`A ${f.kind.replace(/_/g, " ")} has no detail record to open here; use its link from search.`, true);
        status = 400;
      } else {
        const r = await readValue(c, token, `${api}/${encodeURIComponent(f.rowId)}`, undefined);
        if (!r.ok) {
          result = text(r.message, true);
          status = r.status;
          note = r.note;
        } else {
          let body = JSON.stringify(r.value);
          if (body.length > MAX_RESULT_CHARS) body = body.slice(0, MAX_RESULT_CHARS);
          const link = DOC_LINKS[f.kind.replace(/_/g, "-")]?.page;
          result = text(
            JSON.stringify({
              id: `${f.kind}:${f.rowId}`,
              title: docTitle(f.kind, r.value),
              text: body,
              url: link ? `${originOf(c)}${link}/${encodeURIComponent(f.rowId)}` : originOf(c),
              metadata: { kind: f.kind, hiddenFields: [...r.removed] },
            }),
          );
          note = [...r.removed].join(",");
        }
      }
    } else if (name === "document_flow") {
      const r = await documentFlow(c, token, String(args.number_or_id ?? args.number ?? args.id ?? ""));
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else if (name === "propose_meeting" || name === "propose_email") {
      const r = await proposeAction(c, id, token, name === "propose_meeting" ? "meeting" : "email", args);
      result = r.result;
      status = r.status;
      target = r.target;
    } else if (name === "confirm_action") {
      const r = await confirmAction(c, id, token, String(args.confirmationId ?? ""));
      result = r.result;
      status = r.status;
      target = r.target;
      note = r.note;
    } else if (name === "cancel_action") {
      const cid = String(args.confirmationId ?? "").trim();
      target = `cancel:${cid}`;
      const ok = /^mcpa_[a-f0-9]{24}$/.test(cid) && (await cancelPendingAction(c.var.DB, cid, id.tokenId, id.userId));
      result = ok ? text("Cancelled. Nothing was booked or sent.") : text("Nothing to cancel: that confirmation is unknown, already used or not yours.", true);
      status = ok ? 200 : 404;
    } else if (name === "erp_get") {
      const fields = Array.isArray(args.fields) ? (args.fields as unknown[]).map(String).filter(Boolean).slice(0, 40) : [];
      const r = await readEndpoint(c, token, String(args.path ?? ""), (args.query as Record<string, unknown>) ?? undefined, fields);
      result = r.result;
      status = r.status;
      note = r.note;
      target = r.target;
    } else {
      result = text(`Unknown tool: ${name}`, true);
      status = 400;
    }
  } catch (e) {
    result = text(`Failed: ${e instanceof Error ? e.message : String(e)}`, true);
    status = 500;
  }
  if (cacheKey && !cached && !result.isError && status === 200) answerCache.set(cacheKey, { result, target, note });
  const done = logCall(c.var.DB, { tokenId: id.tokenId, userId: id.userId, clientId: id.clientId, tool: name, target, status, ok: !result.isError, note, ms: Date.now() - t0 });
  try {
    c.executionCtx.waitUntil(done);
  } catch {
    await done;
  }
  return result;
}

/**
 * The leak check (routes/mcp-admin.ts): run ONE tool exactly as the staff member
 * would, in this request, without going through the door. The person's role and
 * org are put on the context for the call (the module gate and redaction read
 * them) and restored afterwards; the inner GETs find the identity through
 * rememberVerified. The token must be a real one issued for that person.
 */
export async function runToolAs(c: Context<Env>, id: McpIdentity, token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const ctx = c as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void };
  const saved = { userId: ctx.get("userId"), userRole: ctx.get("userRole"), orgId: ctx.get("orgId") };
  rememberVerified(token, id);
  ctx.set("userId", id.userId);
  ctx.set("userRole", id.role);
  if (id.orgId) ctx.set("orgId", id.orgId);
  try {
    return await callTool(c, id, token, name, args);
  } finally {
    ctx.set("userId", saved.userId);
    ctx.set("userRole", saved.userRole);
    ctx.set("orgId", saved.orgId);
  }
}

async function handleRpc(c: Context<Env>, id: McpIdentity, token: string, m: RpcReq): Promise<unknown | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  const isNotification = m.id === undefined || m.id === null;
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const args = (m.params?.arguments as Record<string, unknown>) ?? {};
      // Per-person rate limit (lib/mcp-limits.ts). Only here: runToolAs (the
      // admin leak check) calls callTool directly and is never limited.
      let over: string | null = null;
      try {
        const n = await countRecentCalls(c.var.DB, id.userId);
        over = rateDecision(n.lastMinute, n.today);
      } catch (e) {
        // The count failing must not take the connector down: let the call through.
        console.warn("[mcp] rate count failed:", e instanceof Error ? e.message : String(e));
      }
      if (over) {
        const done = logCall(c.var.DB, { tokenId: id.tokenId, userId: id.userId, clientId: id.clientId, tool: name, target: "rate-limited", status: RATE_LIMIT_STATUS, ok: false, note: "rate limit", ms: 0 });
        try {
          c.executionCtx.waitUntil(done);
        } catch {
          await done;
        }
        return reply(text(over, true));
      }
      return reply(await callTool(c, id, token, name, args));
    }
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: PROMPTS });
    case "prompts/get": {
      const pname = String(m.params?.name ?? "");
      const ptext = promptText(pname, (m.params?.arguments as Record<string, unknown> | undefined) ?? {});
      if (ptext === null) return fail(-32602, `Unknown prompt: ${pname}`);
      return reply({ description: PROMPTS.find((x) => x.name === pname)?.description ?? "", messages: [{ role: "user", content: { type: "text", text: ptext } }] });
    }
    default:
      if (isNotification || (m.method ?? "").startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${m.method}`);
  }
}

app.post("/", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const id = token ? await resolveAccessToken(c.var.DB, token) : null;
  if (!id) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, {
      "WWW-Authenticate": `Bearer realm="hookka-erp", resource_metadata="${originOf(c)}/.well-known/oauth-protected-resource/api/mcp"${token ? ', error="invalid_token"' : ""}`,
    });
  }
  // The inner calls of this request reuse this check instead of repeating it
  // (auth-middleware.ts recallVerified) — one token lookup per lookup, not two.
  rememberVerified(token, id);
  // Run every tool call as this person (rbac / tenant read these).
  const set = c as unknown as { set: (k: string, v: unknown) => void };
  set.set("userId", id.userId);
  set.set("userRole", id.role);
  if (id.orgId) set.set("orgId", id.orgId);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const msgs = Array.isArray(body) ? (body as RpcReq[]) : [body as RpcReq];
  const out: unknown[] = [];
  for (const m of msgs) {
    const r = await handleRpc(c, id, token, m);
    if (r) out.push(r);
  }
  if (out.length === 0) return c.body(null, 202);
  return c.json(Array.isArray(body) ? out : out[0]);
});

// No server-initiated stream: GET/DELETE are not supported (stateless server).
app.get("/", (c) => c.json({ error: "Use POST (MCP Streamable HTTP)." }, 405, { Allow: "POST" }));
app.delete("/", (c) => c.body(null, 405, { Allow: "POST" }));

export { MCP_PREFIX_RESOURCES };
export default app;
