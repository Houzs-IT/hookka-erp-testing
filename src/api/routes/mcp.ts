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
import { MCP_ACTION_HEADER, MCP_INNER_HEADER, armConfirmedAction, mcpInnerSecret, rememberVerified } from "../lib/mcp-inner";
import { emitAudit } from "../lib/audit";
import { confirmPending, proposeWrite, WRITE_PERMISSIONS, type ActionDeps, type WriteKind } from "../lib/mcp-write-actions";
import { explainScreen, whereIs } from "../lib/mcp-screens";
import { annotatedSvg, pickShot, realPageLink, showMeContent, toBase64 } from "../lib/mcp-show-me";
import { HELP_SHOTS_CAPTURED_AT } from "../lib/howto/help-shots";
import { explainError, glossary, howTo, moduleOverview, NO_GUIDE_NOTE, onboarding, scrubQuestion } from "../lib/mcp-howto";
import { needLabel, parseQuickText, QUICK_OUTPUT_SCHEMA, readToolAllowed, STRUCTURED_TOOLS, withLinksAndRm } from "../lib/mcp-visibility";
import {
  ACTIONS_OFF_MESSAGE,
  actionsEnabled,
  buildEmailProposal,
  buildMeetingProposal,
  cancelPendingAction,
  createPendingAction,
  meetingBusyWarnings,
  readBootstrap,
  readMailboxes,
  writeActionSwitches,
  type ActionKind,
  type WriteAction,
} from "../lib/mcp-actions";
import { FLOW_API, parseAnchorId, pickFlowAnchor, shapeFlow, soRefsFromDoc, type FlowKind } from "../lib/mcp-flow";
import {
  addDays,
  listRows,
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
  PROMPT_TOOLS,
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
import {
  floorDeptNames,
  labourByDept,
  mergeFloorWorkers,
  overdueDeliveries,
  pickProduct,
  reportMonths,
  resolvePeriod,
  summariseCompanyReport,
  summariseGrossProfit,
  summariseLeadTimes,
  summarisePoOverdue,
  summariseProductCost,
  summariseProductionOutput,
  summariseRawMaterials,
  summariseStockCheck,
  summariseSupplierLateness,
  summariseUninvoiced,
  PERIODS,
  UNINVOICED_STATUSES,
  type GpBy,
  type Period,
  type ReportPeriod,
} from "../lib/mcp-round4";
import { GAP_SO_SCAN, summariseDataGaps } from "../lib/mcp-proactive";
import { renderServerPdf, uploadExportAndSign, uploadPdfAndSign, SERVER_PDF_KINDS, XLSX_CONTENT_TYPE, type PdfKind } from "../lib/mcp-pdf";
import { buildXlsx, EXPORT_LISTS, EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE, exportFileName, exportRows, exportTotal, filterRows, pagesToRead, pickColumns } from "../lib/mcp-export";
import { AnswerCache, CACHEABLE_TOOLS, countRecentCalls, MAX_BATCH, RATE_LIMIT_STATUS, rateDecision } from "../lib/mcp-limits";
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
  // validRedirectUri again here: clients registered before the host allowlist must stop working too.
  if (!cl.redirectUris.includes(p.redirectUri) || !validRedirectUri(p.redirectUri)) return { ok: false, res: page("Invalid request", `<h1>Invalid request</h1><p>The return address does not match this app.</p>`, 400) };
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
<p>Your access goes to <b>${esc(new URL(p.redirectUri).host)}</b>. If that is not the AI app you are adding, press Cancel.</p>
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
  const cl = clientId ? await getClient(c.var.DB, clientId) : null;
  if (!cl) return err("invalid_client", "Unknown client", 401);
  // A client registered before the redirect allowlist must not keep refreshing tokens it got then.
  if (!cl.redirectUris.every(validRedirectUri)) return err("invalid_client", "This app's return address is no longer allowed. Remove the connector and add it again.", 401);

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
- Who is on leave or absent today (HR only): attendance_today. "What do I need to look at today?": daily_brief. Missing data to fill in (BOMs, costs, delivery dates, departments, supplier bindings): data_gaps.
- Round 4: overdue POs / still to receive: po_overdue. Late suppliers: supplier_lateness {period}. Delivered not invoiced (with age): uninvoiced_deliveries. "Do we have stock of X?": stock_check {query}. What a product costs to make: product_cost {product}. Output by department / worker: production_output {period}. Lowest-efficiency workers and departments (+ labour cost): worker_efficiency {period}. Raw-material stock, shortages and price changes: raw_material_summary {period}. Gross profit: gross_profit {period, by: product | customer | invoice}. How long a product takes to make: production_lead_time {product, period}. Delivery schedule incl. next week and overdue: deliveries_due {range: today | week | next_week}. The company management report: company_report {period: month | quarter | year, month}.
- period (every period tool): today | week | month | last_month | quarter | year, or from + to (YYYY-MM-DD); the answer compares with the period before.
- A list as an Excel file: export_excel {list, search, status, from, to, fields} (15-minute download link).
- A document by number or a customer / product name: search {query}, then fetch {id} for the full record.
Only when no quick answer fits: list_modules → list_endpoints → erp_get. With erp_get pass "fields" (only the keys you need) and query filters (from/to YYYY-MM-DD, page/limit, search) to keep replies small.
Money in the ERP is integer sen (RM × 100) unless a field says RM. Dates are Malaysia time.
A document's chain (sales order → production orders → job cards → delivery orders → invoices → payments, or back from any of them; or a purchase order → GRNs → purchase invoices): document_flow {number_or_id}.
Keep replies short: lead with the count and the few lines that matter, give links. If a tool says the person has no access to something, say so in one line — never guess the figure.
For a PDF: find the document id, then get_pdf (sales orders, delivery orders and invoices come back as a 15-minute download link; purchase orders as a link to the ERP page). Give the person the link.
ACTIONS (only if the admin switched them on): to book a meeting call propose_meeting, to send an email call propose_email. They do NOTHING yet — they return a summary and a confirmationId. Show the person that summary word for word and ask them to confirm. Only call confirm_action after they explicitly say yes; if they say no or want changes, call cancel_action (and propose again with the changes). Never confirm on your own, never confirm something the person has not seen. When the admin switched them on, the same goes for propose_mail_reply (reply to a Mail Center thread — thread_id from daily_brief), propose_note (a note on a purchase order or service case) and propose_po_approval (mark a sent PO Confirmed). Nothing else can be changed: no payments, stock, prices, payroll or deletes.
If a call says "not available to your role", tell the user they do not have permission for that data.
HELP ("how do I…", "where is…", "what does X mean", an error message): how_to {question} gives click-by-click steps with ERP links (end-to-end chains such as order to cash or procure to pay come back as one flow); module_overview {module} explains a module; glossary {term} explains a term or abbreviation; explain_error {text} explains an ERP error message (read it off a screenshot if needed); onboarding {role} gives a new starter's first-week reading path. "Where do I open X?": where_is {thing} (sidebar path + a link that outlines the button). "Show me where": show_me {path, label} or {guide_id, step} returns a screenshot of the page, where the button is (red-box coordinates; the annotated picture is behind its 15-minute link) (test data — say so) plus the live-page link. What a screen or button does: explain_screen.
SCREENSHOTS: when the person sends a screenshot or photo of the ERP, read the URL bar (the path after the domain, e.g. /procurement/grn) and the visible button / tab / heading labels, then call explain_screen {path, visible_text: [labels]} — the path if you can read it, the labels either way. Explain the page from its answer, not from guesses; point at buttons by their exact label and give the link. Follow the guide's steps and labels exactly, and if canDo is false tell the person they need to ask their supervisor or admin for the permission. Guides are in English; answer in the person's language.`;

// ── round 4 tool list (owner 2026-11-26) ────────────────────────────────────
const RO = { readOnlyHint: true, openWorldHint: false };
const PERIOD_PROPS = {
  period: { type: "string", enum: [...PERIODS], description: "today, week (Monday to today), month (to date), last_month, quarter (to date), year (to date) or custom with from/to." },
  from: { type: "string", description: "YYYY-MM-DD (custom period)" },
  to: { type: "string", description: "YYYY-MM-DD (custom period)" },
};
const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
const ROUND4D_TOOLS = [
  {
    name: "data_gaps",
    title: "Data gaps to fill (quick answer)",
    description: "What the ERP is missing, in ONE call: active products without a BOM or selling price, BOMs with no material besides the fabric line, products whose BOM has lines without a price (no full cost), open sales orders without a delivery date, active workers without a department, active suppliers with no material binding. Counts and the first five of each with links. Also sent in the Monday morning brief.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
];
const ROUND4_TOOLS = [
  { name: "po_overdue", title: "Overdue POs and what is still to be received (quick answer)", description: "Open purchase orders past their expected date (supplier, days late, value RM) and everything still waiting to be received (sent, partly received), due this week and by supplier, in ONE call.", inputSchema: NO_ARGS, annotations: RO },
  { name: "supplier_lateness", title: "Which suppliers are late most often (quick answer)", description: "Late deliveries per supplier over a period: POs received after their expected date (count, average days late, on-time %) and open POs past their date, compared with the period before. Default: the last 90 days.", inputSchema: { type: "object", properties: { ...PERIOD_PROPS, days: { type: "number", description: "Instead of period: the last N days (default 90)." } }, additionalProperties: false }, annotations: RO },
  { name: "uninvoiced_deliveries", title: "Delivered but not invoiced (quick answer)", description: "Delivery orders signed / delivered with no invoice yet: count, value (RM), by age (0-7, 8-30, 31-60, over 60 days), by customer, and the oldest with links.", inputSchema: NO_ARGS, annotations: RO },
  { name: "stock_check", title: "Do we have stock? (quick answer)", description: "One item by code or name: raw material on hand, minimum, quantity on open POs with the next ETA; finished goods in stock, reserved and available.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Item code or part of its name" } }, required: ["query"], additionalProperties: false }, annotations: RO },
  { name: "product_cost", title: "What a product costs to make (quick answer)", description: "A product's BOM cost from the costing module: total, labour and materials (RM), by department, each material line with price and amount, lines not counted, fabric tiers and the standard cost. Money only for people who may see costing in the ERP.", inputSchema: { type: "object", properties: { product: { type: "string", description: "Product code or name" }, tier: { type: "string", description: "Fabric price tier, e.g. Lv2 (default: the first)" } }, required: ["product"], additionalProperties: false }, annotations: RO },
  { name: "production_output", title: "Production output by department and worker (quick answer)", description: "For a period: pieces completed per department (bedframe units, sofa sets) and their value, against the usual day and the period before; workers, hours and efficiency per department; top workers and the lowest efficiency. Default period: today.", inputSchema: { type: "object", properties: PERIOD_PROPS, additionalProperties: false }, annotations: RO },
  { name: "worker_efficiency", title: "Lowest-efficiency workers and departments (quick answer)", description: "For a period: departments and workers with the lowest efficiency (earned / clocked minutes), with their output and hours, and the labour cost per department for whole-month periods where the person may see finance figures. Default period: week.", inputSchema: { type: "object", properties: PERIOD_PROPS, additionalProperties: false }, annotations: RO },
  { name: "raw_material_summary", title: "Raw materials (quick answer)", description: "Raw-material stock (low, negative, zero, by group), what is short for open production orders, and supplier price changes in the period (biggest increases first). Default period: month.", inputSchema: { type: "object", properties: PERIOD_PROPS, additionalProperties: false }, annotations: RO },
  { name: "gross_profit", title: "Gross profit (quick answer)", description: "Gross profit for a period: invoiced revenue against each product's BOM cost, by product, customer or invoice, with margin %, the lowest margins and the period before. Cost only for people who may see costing in the ERP. Default period: month.", inputSchema: { type: "object", properties: { ...PERIOD_PROPS, by: { type: "string", enum: ["product", "customer", "invoice"], description: "Default: product." } }, additionalProperties: false }, annotations: RO },
  { name: "production_lead_time", title: "How long a product takes to make (quick answer)", description: "Days from production start to completion over orders completed in a period: median and average overall and per product, against the period before. Give a product to narrow it. Default: the last 90 days.", inputSchema: { type: "object", properties: { product: { type: "string", description: "Product code or name (optional)" }, ...PERIOD_PROPS }, additionalProperties: false }, annotations: RO },
  {
    name: "company_report",
    title: "Company management report",
    description: "The management report for a month, quarter or year in ONE call: revenue, gross profit and margin, costs by type, net profit, cash flow, balance sheet, what customers owe and what we owe, production revenue and headcount, against the period before. Finance (accounting) permission needed.",
    inputSchema: { type: "object", properties: { period: { type: "string", enum: ["month", "quarter", "year"], description: "Default: month." }, month: { type: "string", description: "YYYY-MM: the month, or the last month of the quarter / year to date. Default: last month." } }, additionalProperties: false },
    annotations: RO,
  },
];

const HOWTO_TOOLS = [
  {
    name: "how_to",
    title: "How do I… (step-by-step ERP help)",
    description: "Step-by-step help for doing something in the ERP, e.g. 'how do I create a PO', 'open a service case', '开PO', 'terima barang'. Returns the top 1-3 guides (or one end-to-end flow such as order to cash) with exact button labels, fields, checks, warnings, how to undo, ERP links and canDo (whether this person has the ERP permission). Read-only.",
    inputSchema: { type: "object", properties: { question: { type: "string", description: "The person's question, in any language" }, topic: { type: "string", description: "A guide or flow id from an earlier answer" }, company: { type: "string", description: "Company code (e.g. HOOKKA, OHANA) to narrow company-specific steps" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "module_overview",
    title: "What an ERP module is for",
    description: "For a sidebar module (Sales, Production, Procurement, Warehouse, Finance, …): what it is for, its key pages (with links and whether this person can open them), who uses it and how it links to other modules. No module: every module in one line.",
    inputSchema: { type: "object", properties: { module: { type: "string", description: "Module id or sidebar section, e.g. procurement" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "glossary",
    title: "What does this ERP term mean",
    description: "Plain-English meaning of a term or abbreviation staff meet in the ERP (SO, PO, GRN, DO, job card, WIP, FG, BOM, fabric tier, MRP, credit note, AR / AP aging, sen vs RM, Floor Live, efficiency %…). No term: the whole list.",
    inputSchema: { type: "object", properties: { term: { type: "string" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "explain_error",
    title: "Explain an ERP error message",
    description: "What an ERP error or validation message means, why it happens and how to fix it. Pass the message text (read it off a screenshot if needed).",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The error message" } }, required: ["text"], additionalProperties: false },
    annotations: RO,
  },
  {
    name: "onboarding",
    title: "First-week reading path for a role",
    description: "An ordered list of guides and flows for a new starter: sales, purchasing, production, warehouse, finance or after-sales.",
    inputSchema: { type: "object", properties: { role: { type: "string", description: "sales | purchasing | production | warehouse | finance | after-sales" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "explain_screen",
    title: "Explain this ERP screen",
    description: "Which ERP page this is and what every button, tab and menu on it does (with canDo for this person). Give the URL path if you can read it, and/or the labels visible on a screenshot (visible_text).",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "The URL or path, e.g. /procurement/grn" }, visible_text: { type: "array", items: { type: "string" }, description: "Button / tab / heading labels read off the screenshot" }, company: { type: "string" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "where_is",
    title: "Where do I open…",
    description: "Where something is in the ERP (e.g. 'maintenance log', 'credit note', 'open an SO'): the sidebar path and a link that outlines the button to press, plus the matching how-to guide.",
    inputSchema: { type: "object", properties: { thing: { type: "string" }, company: { type: "string" } }, required: ["thing"], additionalProperties: false },
    annotations: RO,
  },
  {
    name: "show_me",
    title: "Show me where to click (screenshot)",
    description: "A screenshot of the ERP page (plain WebP) with the red-box coordinates of the button to press, a 15-minute link to the annotated picture (red box, arrow and caption drawn on) and the live-page link that outlines the button. Give a page path and button label, or a how_to guide id and step number. The screenshot uses test data: names and numbers differ, the layout is the same.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, label: { type: "string", description: "The button / tab label" }, guide_id: { type: "string" }, step: { type: "number", description: "Step number in the guide (1-based)" }, company: { type: "string" } }, additionalProperties: false },
    annotations: RO,
  },
];
const HELP_TOOLS = new Set(HOWTO_TOOLS.map((t) => t.name));

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
    description: "The delivery schedule in ONE call: delivery orders not yet delivered by delivery date (customer, hub, lorry, status) and sales orders due by their expected date, for today, this week (today + 6 days) or next week (the 7 days after), plus every delivery order already past its date and not delivered (overdue).",
    inputSchema: { type: "object", properties: { range: { type: "string", enum: ["today", "week", "next_week"], description: "Default: today." } }, additionalProperties: false },
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
  ...ROUND4_TOOLS,
  ...ROUND4D_TOOLS,
  ...HOWTO_TOOLS,
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
  // ── round 4b write actions (owner 2026-11-26), each behind its own switch ──
  {
    name: "propose_mail_reply",
    title: "Propose a Mail Center reply (needs the person's yes)",
    description: "Prepare a reply in an existing Mail Center thread, from the person's own mailbox, to the thread's latest correspondent. Nothing is sent yet: it returns the draft, the recipients and the thread as a summary and a confirmationId. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes. If a colleague replies first, the reply is not sent.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "The thread id (threadId in daily_brief's mail list, or the id in the thread's link)" },
        body: { type: "string", description: "The reply, plain text" },
        from_mailbox: { type: "string", description: "Which of the person's mailboxes to reply from (default: the thread's mailbox)" },
      },
      required: ["thread_id", "body"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "propose_note",
    title: "Propose a note on a PO or service case (needs the person's yes)",
    description: "Prepare a note on a purchase order (added to the end of its notes) or a service case (added under \"Action taken\"), with today's date and the person's name. Nothing is saved yet: it returns a summary and a confirmationId. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes. Sales orders and production orders have no note endpoint in the ERP.",
    inputSchema: {
      type: "object",
      properties: {
        target_type: { type: "string", enum: ["purchase_order", "service_case"] },
        number_or_id: { type: "string", description: "The PO or case number (or an id from search)" },
        note: { type: "string", description: "The note, one short paragraph" },
      },
      required: ["target_type", "number_or_id", "note"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "propose_po_approval",
    title: "Propose approving a purchase order (needs the person's yes)",
    description: "Prepare the approval of a sent (SUBMITTED) purchase order — the PO page's \"Mark Confirmed\" — for a person who holds the ERP's PO approve permission. Nothing is approved yet: it returns a summary and a confirmationId. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes.",
    inputSchema: { type: "object", properties: { number_or_id: { type: "string", description: "The PO number (or an id from search)" } }, required: ["number_or_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

/** Document → its ERP page (where the PDF is made) and its read API. */
export const DOC_LINKS: Record<string, { page: string; api: string }> = {
  "sales-order": { page: "/sales", api: "/api/sales-orders" },
  "purchase-order": { page: "/procurement", api: "/api/purchase-orders" },
  "delivery-order": { page: "/delivery", api: "/api/delivery-orders" },
  invoice: { page: "/invoices", api: "/api/invoices" },
};

type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean; structuredContent?: Record<string, unknown> };
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
  const perms = ["payroll:read", "payslips:read", "cost-ledger:read", "product-costing:read", "accounting:read", "product-pricing:read", "revenue-figures:read"];
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
    p = buildEmailProposal(args, readMailboxes(mbJson), id.userId, id.email);
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
 * The ONE write a confirmed action makes: the ERP's own route, in-process, as
 * the person. Armed for this token + method + path just before the call;
 * auth-middleware.ts takes the arm once (mcp-inner.ts). The route and body come
 * from lib/mcp-write-actions.ts requestFor, already checked against
 * ACTION_ALLOWLIST and actionBodyAllowed.
 */
async function innerAction(c: Context<Env>, id: McpIdentity, token: string, actionId: string, route: { method: string; path: string; body: unknown }): Promise<{ status: number; body: unknown }> {
  if (!appRef) throw new Error("MCP app not initialised");
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
      body: JSON.stringify(route.body),
    }),
    c.env,
    ctx,
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Mail Center reads used only by propose_mail_reply (not reachable through erp_get). */
const MAIL_FIXED = /^\/api\/mail-center\/(threads\/[A-Za-z0-9._-]{1,80}|addresses)$/;

/** The real I/O for lib/mcp-write-actions.ts: reads as the person, the armed write, the ERP's permission check and audit trail. */
function actionDeps(c: Context<Env>, id: McpIdentity, token: string): ActionDeps {
  return {
    db: c.var.DB,
    tokenId: id.tokenId,
    userId: id.userId,
    userName: id.name,
    read: async (path, query) => {
      const fixed = MAIL_FIXED.test(path) ? { path, resources: ["mail-center"] } : undefined;
      const r = await readValue(c, token, path, query, fixed);
      return r.ok ? { status: 200, body: r.value } : { status: r.status, body: { error: r.message } };
    },
    write: (actionId, req) => innerAction(c, id, token, actionId, req),
    can: (resource, action) => hasPermission(c, resource, action),
    audit: async (kind, ref, after) => {
      await emitAudit(c, { resource: kind === "case_note" ? "service-cases" : "purchase-orders", resourceId: ref, action: "update", after, source: "api" });
    },
  };
}

/** confirm_action, every kind: lib/mcp-write-actions.ts confirmPending (switches → cap → single-use claim → body fence → one write). */
async function confirmAction(c: Context<Env>, id: McpIdentity, token: string, raw: string): Promise<Step> {
  const o = await confirmPending(actionDeps(c, id, token), raw);
  return { result: text(o.text, !o.ok), status: o.status, target: o.target, note: "" };
}

/** propose_mail_reply / propose_note / propose_po_approval. Nothing is written yet. */
async function proposeWriteStep(c: Context<Env>, id: McpIdentity, token: string, kind: WriteKind, args: Record<string, unknown>): Promise<Step> {
  const o = await proposeWrite(actionDeps(c, id, token), kind, args);
  if (!o.ok) return { result: text(o.text, true), status: o.status, target: o.target, note: "" };
  return {
    result: text(
      JSON.stringify({
        confirmationId: o.confirmationId,
        summary: o.summary,
        warnings: o.warnings ?? [],
        expiresInMinutes: 10,
        next: "Nothing has been done yet. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes; otherwise call cancel_action.",
      }),
    ),
    status: 200,
    target: o.target,
    note: "",
  };
}

// ── round 4c: role-aware tools/list (P1) ────────────────────────────────────

const WRITE_TOOL_KIND: Record<string, { switch: WriteAction; kinds: WriteKind[] }> = {
  propose_mail_reply: { switch: "mail_reply", kinds: ["mail_reply"] },
  propose_note: { switch: "note", kinds: ["po_note", "case_note"] },
  propose_po_approval: { switch: "po_approval", kinds: ["po_approval"] },
};
const ACTION_TOOLS = new Set(["propose_meeting", "propose_email", "confirm_action", "cancel_action", ...Object.keys(WRITE_TOOL_KIND)]);

/**
 * Which tools this person can use: read tools by the module gate of the
 * endpoints they read (lib/mcp-visibility.ts), write tools by their switches
 * and the ERP permission the route checks. Memoised per call.
 */
async function toolAccess(c: Context<Env>): Promise<(name: string) => Promise<boolean>> {
  const memo = new Map<string, Promise<boolean>>();
  const ask = (r: string, a: string) => {
    const k = `${r}:${a}`;
    let p = memo.get(k);
    if (!p) memo.set(k, (p = hasPermission(c, r, a)));
    return p;
  };
  const [main, switches] = await Promise.all([actionsEnabled(c.var.DB), writeActionSwitches(c.var.DB)]);
  const writeOk = async (tool: string): Promise<boolean> => {
    const w = WRITE_TOOL_KIND[tool];
    if (!main || !switches[w.switch]) return false;
    for (const k of w.kinds) {
      let all = true;
      for (const [r, a] of WRITE_PERMISSIONS[k]) if (!(await ask(r, a))) all = false;
      if (all) return true;
    }
    return false;
  };
  const one = async (name: string): Promise<boolean> => {
    if (WRITE_TOOL_KIND[name]) return writeOk(name);
    if (name === "propose_meeting") return main;
    if (name === "propose_email") return main && (await ask("mail-center", "create"));
    if (name === "confirm_action" || name === "cancel_action") return main;
    return readToolAllowed(name, (r) => ask(r, "read"));
  };
  return one;
}

async function visibleTools(c: Context<Env>): Promise<Record<string, unknown>[]> {
  const ok = await toolAccess(c);
  const flags = await Promise.all(TOOLS.map((t) => ok(t.name)));
  return TOOLS.filter((_, i) => flags[i]).map((t) => (STRUCTURED_TOOLS.has(t.name) ? { ...t, outputSchema: QUICK_OUTPUT_SCHEMA } : t));
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
    const range = args.range === "week" ? "week" : args.range === "next_week" ? "next_week" : "today";
    const [dos, sos] = await Promise.all([
      readValue(c, token, "/api/delivery-orders", { status: DO_NOT_DELIVERED, page: 1, limit: 500 }),
      readValue(c, token, "/api/sales-orders", { fields: "orders-due", top: BRIEF_SO_TOP }),
    ]);
    if (!dos.ok && !sos.ok) {
      const a = P.need(dos, "delivery orders");
      if (!a.ok) return fin(`deliveries:${range}`, a.step);
    }
    const d = P.opt(dos, "delivery orders");
    return fin(
      `deliveries:${range}`,
      // Round 4 (K12): the overdue half of the schedule, from the same read.
      P.done({ ...summariseDeliveriesDue(range, d, P.opt(sos, "sales orders"), today, origin), ...(d !== null ? { overdueDeliveryOrders: overdueDeliveries(d, today, origin) } : {}) }),
    );
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

  // ── round 4d (owner 2026-11-26): data gaps, also in the Monday brief ─────
  if (name === "data_gaps") {
    const reads = await Promise.all([
      readValue(c, token, "/api/products/setup-incomplete", undefined),
      readValue(c, token, "/api/product-costing/summary", undefined),
      readValue(c, token, "/api/sales-orders", { page: 1, limit: GAP_SO_SCAN }),
      readValue(c, token, "/api/workers", undefined),
      readValue(c, token, "/api/suppliers", undefined),
      readValue(c, token, "/api/supplier-materials", undefined),
    ]);
    if (reads.every((r) => !r.ok && r.status === 403)) {
      return fin("data_gaps", { result: text("You don't have access to any of the lists data_gaps checks (products, product costing, sales orders, workers, suppliers).", true), status: 403, note: "no permission" });
    }
    const [setup, cost, sos, wk, sup, bind] = reads;
    return fin(
      "data_gaps",
      P.done(
        summariseDataGaps({
          today,
          origin,
          setupIncomplete: P.opt(setup, "products"),
          costSummary: P.opt(cost, "product costing"),
          salesOrders: P.opt(sos, "sales orders"),
          workers: P.opt(wk, "workers"),
          suppliers: P.opt(sup, "suppliers"),
          bindings: P.opt(bind, "supplier material bindings"),
        }),
      ),
    );
  }

  // ── round 4 (owner 2026-11-26) ───────────────────────────────────────────
  const r4 = await round4Tool(c, token, name, args, today, origin, P);
  if (r4) return r4;

  return null;
}

/** A period argument, or a plain 400 step. */
function periodOr(args: Record<string, unknown>, today: string, dflt: Period["period"], target: string): Period | Step {
  const p = resolvePeriod(args, today, dflt);
  return "error" in p ? { result: text(p.error, true), status: 400, target, note: "" } : p;
}
const isStep = (x: unknown): x is Step => !!x && typeof x === "object" && "result" in (x as object);

/** Pages 2..n of a paginated list, all at once (bounded by `maxPages`). */
async function morePages(c: Context<Env>, token: string, path: string, query: Record<string, unknown>, first: ReadValue, limit: number, maxPages: number): Promise<{ rows: Record<string, unknown>[]; truncated: boolean; failed: ReadValue | null }> {
  if (!first.ok) return { rows: [], truncated: false, failed: first };
  const rows = listRows(first.value);
  const total = Number((first.value as { total?: unknown } | null)?.total) || rows.length;
  const pages = Math.min(maxPages, Math.ceil(total / limit));
  if (pages > 1) {
    const more = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => readValue(c, token, path, { ...query, page: i + 2, limit })));
    for (const m of more) {
      if (!m.ok) return { rows, truncated: true, failed: m };
      rows.push(...listRows(m.value));
    }
  }
  return { rows, truncated: total > pages * limit, failed: null };
}

/**
 * The round-4 quick answers (K1–K12 + company_report). Every read goes through
 * readValue as the person — the module gate (mcp-access.ts), the route's own
 * permission check and the money redaction all apply. At most 4 reads, in
 * parallel. null = not one of them.
 */
async function round4Tool(c: Context<Env>, token: string, name: string, args: Record<string, unknown>, today: string, origin: string, P: Parts): Promise<Step | null> {
  const fin = (target: string, s: Omit<Step, "target">): Step => ({ ...s, target });

  if (name === "po_overdue") {
    const a = P.need(await readValue(c, token, "/api/purchase-orders/stats", undefined), "purchase orders");
    if (!a.ok) return fin("po_overdue", a.step);
    return fin(`po_overdue:${today}`, P.done(summarisePoOverdue(a.value, today, origin)));
  }

  if (name === "supplier_lateness") {
    const days = Math.max(1, Math.min(400, Number(args.days) || 90));
    const p = args.period || args.from ? periodOr(args, today, "month", "supplier_lateness") : ({ period: "custom", from: addDays(today, -(days - 1)), to: today, prev: { from: addDays(today, -(2 * days - 1)), to: addDays(today, -days) } } as Period);
    if (isStep(p)) return p;
    const a = P.need(await readValue(c, token, "/api/purchase-orders/stats", undefined), "purchase orders");
    if (!a.ok) return fin("supplier_lateness", a.step);
    return fin(`supplier_lateness:${p.from}..${p.to}`, P.done(summariseSupplierLateness(a.value, p, today)));
  }

  if (name === "uninvoiced_deliveries") {
    const q = { status: UNINVOICED_STATUSES };
    const first = await readValue(c, token, "/api/delivery-orders", { ...q, page: 1, limit: 500 });
    const a = P.need(first, "delivery orders");
    if (!a.ok) return fin("uninvoiced", a.step);
    const got = await morePages(c, token, "/api/delivery-orders", q, first, 500, 4);
    if (got.failed && got.failed !== first) P.opt(got.failed, "delivery orders (later pages)");
    return fin("uninvoiced", P.done(summariseUninvoiced(got.rows, today, origin, got.truncated)));
  }

  if (name === "stock_check") {
    const query = String(args.query ?? "").trim().slice(0, 60);
    if (!query) return { result: text("Give an item code or name.", true), status: 400, target: "stock_check", note: "" };
    const [inv, prods, fg, lines] = await Promise.all([
      readValue(c, token, "/api/inventory", { buckets: "rawMaterials" }),
      readValue(c, token, "/api/products", { search: query }),
      readValue(c, token, "/api/inventory/fg-stock", undefined),
      readValue(c, token, "/api/procurement-reports/outstanding-lines", undefined),
    ]);
    if (!inv.ok && !prods.ok) {
      const a = P.need(inv, "inventory");
      if (!a.ok) return fin(`stock_check:${query}`, a.step);
    }
    const i = P.opt(inv, "raw-material stock");
    const pr = P.opt(prods, "products");
    const f = P.opt(fg, "finished-goods stock");
    const l = i !== null ? P.opt(lines, "open purchase-order lines") : null;
    return fin(`stock_check:${query}`, P.done(summariseStockCheck(query, i, pr, f, l, today)));
  }

  if (name === "product_cost") {
    const q = String(args.product ?? args.query ?? "").trim().slice(0, 60);
    if (!q) return { result: text("Give a product code or name.", true), status: 400, target: "product_cost", note: "" };
    const tier = typeof args.tier === "string" && /^[A-Za-z0-9 _-]{1,20}$/.test(args.tier) ? args.tier : undefined;
    const s = P.need(await readValue(c, token, "/api/products", { search: q }), "products");
    if (!s.ok) return fin(`product_cost:${q}`, s.step);
    const prod = pickProduct(q, s.value);
    if (!prod || !SAFE_REF.test(prod.id)) return { result: text(`No product matches "${q}".`, true), status: 404, target: `product_cost:${q}`, note: "" };
    const a = P.need(await readValue(c, token, `/api/product-costing/${prod.id}`, tier ? { tier } : undefined), "product costing");
    if (!a.ok) return fin(`product_cost:${prod.code}`, a.step);
    return fin(`product_cost:${prod.code}`, P.done(summariseProductCost(a.value, origin)));
  }

  if (name === "production_output" || name === "worker_efficiency") {
    const view = name === "worker_efficiency" ? "efficiency" : "output";
    const p = periodOr(args, today, view === "efficiency" ? "week" : "today", name);
    if (isStep(p)) return p;
    const withLive = p.to >= today;
    const onlyToday = p.from === today && p.to === today;
    // Labour cost: whole-month periods only (payroll is monthly), from the Finance dashboard.
    const wholeMonths = ["month", "last_month", "quarter", "year"].includes(p.period);
    const [cur, prev, summary, live, dash] = await Promise.all([
      readValue(c, token, "/api/dashboard/floor-live/completed", { from: p.from, to: p.to }),
      readValue(c, token, "/api/dashboard/floor-live/completed", { from: p.prev.from, to: p.prev.to, month: p.prev.to.slice(0, 7) }),
      onlyToday ? Promise.resolve(null) : readValue(c, token, "/api/dashboard/floor-live/summary", { from: p.from, to: p.to }),
      withLive ? readValue(c, token, "/api/dashboard/floor-live", undefined) : Promise.resolve(null),
      view === "efficiency" && wholeMonths ? readValue(c, token, "/api/accounting/dashboard", { granularity: "month", from: p.from.slice(0, 7), to: p.to.slice(0, 7) }) : Promise.resolve(null),
    ]);
    const a = P.need(cur, "production (Floor Live)");
    if (!a.ok) return fin(`${name}:${p.from}..${p.to}`, a.step);
    const s = P.opt(summary, "per-worker figures (Floor Live summary)");
    const savedToday = !!s && Array.isArray((s as { savedDays?: unknown }).savedDays) && ((s as { savedDays: unknown[] }).savedDays).includes(today);
    const lv = withLive && !savedToday ? P.opt(live, "today's floor") : null;
    const workers = s === null && lv === null ? null : mergeFloorWorkers(s, lv);
    const labour = dash ? labourByDept(P.opt(dash, "labour cost (finance)"), p.from, p.to) : null;
    return fin(`${name}:${p.from}..${p.to}`, P.done(summariseProductionOutput(view, p, a.value, P.opt(prev, "the previous period"), workers, floorDeptNames(s, lv), labour)));
  }

  if (name === "raw_material_summary") {
    const p = periodOr(args, today, "month", name);
    if (isStep(p)) return p;
    const [inv, plan, prices] = await Promise.all([
      readValue(c, token, "/api/inventory", { buckets: "rawMaterials" }),
      readValue(c, token, "/api/mrp/plan", undefined),
      readValue(c, token, "/api/price-history", undefined),
    ]);
    const a = P.need(inv, "raw-material stock (inventory)");
    if (!a.ok) return fin(`raw_materials:${p.from}..${p.to}`, a.step);
    return fin(`raw_materials:${p.from}..${p.to}`, P.done(summariseRawMaterials(a.value, P.opt(plan, "MRP shortages"), P.opt(prices, "supplier price history"), p)));
  }

  if (name === "gross_profit") {
    const p = periodOr(args, today, "month", name);
    if (isStep(p)) return p;
    const by = (["product", "customer", "invoice"].includes(String(args.by)) ? String(args.by) : "product") as GpBy;
    const [lines, prevLines, costs] = await Promise.all([
      readValue(c, token, "/api/invoices/line-summary", { from: p.from, to: p.to }),
      readValue(c, token, "/api/invoices/line-summary", { from: p.prev.from, to: p.prev.to }),
      readValue(c, token, "/api/product-costing/summary", undefined),
    ]);
    const a = P.need(lines, "invoices");
    if (!a.ok) return fin(`gp:${by}:${p.from}..${p.to}`, a.step);
    return fin(`gp:${by}:${p.from}..${p.to}`, P.done(summariseGrossProfit(by, p, a.value, P.opt(prevLines, "the previous period's invoices"), P.opt(costs, "product costing"))));
  }

  if (name === "production_lead_time") {
    const q = String(args.product ?? args.query ?? "").trim().slice(0, 60);
    const p = args.period || args.from ? periodOr(args, today, "month", name) : ({ period: "custom", from: addDays(today, -89), to: today, prev: { from: addDays(today, -179), to: addDays(today, -90) } } as Period);
    if (isStep(p)) return p;
    // Newest first (created_at DESC); no job cards — only the order's dates are needed.
    const query = { status: "COMPLETED", include: "none" };
    const first = await readValue(c, token, "/api/production-orders", { ...query, page: 1, limit: 500 });
    const a = P.need(first, "production orders");
    if (!a.ok) return fin(`lead_time:${q}`, a.step);
    const got = await morePages(c, token, "/api/production-orders", query, first, 500, 4);
    if (got.failed && got.failed !== first) P.opt(got.failed, "production orders (later pages)");
    return fin(`lead_time:${q}:${p.from}..${p.to}`, P.done(summariseLeadTimes(got.rows, p, q, got.truncated)));
  }

  if (name === "company_report") {
    const period = (["month", "quarter", "year"].includes(String(args.period)) ? String(args.period) : "month") as ReportPeriod;
    const m = reportMonths(period, args.month, today);
    const all = [...m.prevMonths, ...m.months].sort();
    const [dash, aging] = await Promise.all([
      readValue(c, token, "/api/accounting/dashboard", { granularity: "month", from: all[0], to: all[all.length - 1] }),
      readValue(c, token, "/api/accounting/aging", undefined),
    ]);
    const a = P.need(dash, "the company figures (accounting / finance)");
    if (!a.ok) return fin(`company_report:${period}:${m.label}`, a.step);
    return fin(`company_report:${period}:${m.label}`, P.done(summariseCompanyReport(period, m, a.value, P.opt(aging, "AR / AP ageing"))));
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

/**
 * Round 4c P3 + P5: a quick answer also as `structuredContent` (its tools/list
 * entry carries an open outputSchema), with an ERP link and money in RM; the
 * text carries the same JSON. A reply cut at the size cap cannot be parsed —
 * it goes out as `{ text, truncated }` so the schema still holds.
 */
function structured(name: string, r: ToolResult, origin: string): ToolResult {
  const raw = r.content.map((x) => ("text" in x ? x.text : "")).join("");
  const q = parseQuickText(raw);
  if (!q) return { ...r, structuredContent: { text: raw, truncated: true } };
  const value = withLinksAndRm(name, q.value, origin);
  if (q.hidden.length) value.hiddenFields = q.hidden;
  let body = JSON.stringify(value);
  if (body.length > MAX_RESULT_CHARS) body = body.slice(0, MAX_RESULT_CHARS);
  const head = q.hidden.length ? `Fields hidden for this person: ${q.hidden.join(", ")}.
` : "";
  return { ...r, content: [{ type: "text", text: head + body }], structuredContent: value };
}

/** Successful quick answers, reused for 60 s per person + role + arguments (lib/mcp-limits.ts). */
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
    // Round 4c P1: a tool hidden from this person's tools/list answers "no
    // access" when called directly (same gate the list uses). Action tools keep
    // their own plain refusals (switched off / ERP permission) below.
    if (!cached && !ACTION_TOOLS.has(name) && TOOLS.some((t) => t.name === name) && !(await (await toolAccess(c))(name))) {
      result = text(`You don't have access to this in the ERP (${name} needs read permission for ${needLabel(name)}).`, true);
      status = 403;
      note = "no permission";
      target = name;
    } else if (cached) {
      result = cached.result;
      target = cached.target;
      note = cached.note ? `cached,${cached.note}` : "cached";
    } else if ((quick = await quickTool(c, id, token, name, args))) {
      result = quick.result;
      status = quick.status;
      note = quick.note;
      target = quick.target;
    } else if (name === "show_me") {
      const pick = pickShot(args);
      if ("error" in pick) {
        result = text(JSON.stringify({ noMatch: pick.error }));
        note = NO_GUIDE_NOTE;
        target = scrubQuestion(String(args.label ?? args.guide_id ?? args.path ?? ""));
      } else {
        const origin = originOf(c);
        target = `${pick.shot.page} · ${pick.box.label}`;
        const img = await fetch(`${origin}${pick.shot.file}`).catch(() => null);
        const realPage = realPageLink(origin, pick);
        if (!img || !img.ok) {
          result = text(JSON.stringify({ caption: pick.caption, realPage, note: "The screenshot could not be loaded; use the link — it outlines the button on the real page." }));
          note = "shot-missing";
        } else {
          const webp = new Uint8Array(await img.arrayBuffer());
          const webpBase64 = toBase64(webp);
          // The annotated SVG lives only behind the 15-minute link: Claude does
          // not accept SVG image content (BUG-2026-11-27-596).
          const svg = new TextEncoder().encode(annotatedSvg(`data:image/webp;base64,${webpBase64}`, pick.box, pick.caption));
          let imageLink: string | null = null;
          try {
            imageLink = await uploadExportAndSign(c.env, id.orgId || "hookka", "show-me.svg", svg, "image/svg+xml", ".svg");
          } catch {
            imageLink = null;
          }
          result = { content: showMeContent({ webpBase64, pick, imageLink, realPage, capturedAt: HELP_SHOTS_CAPTURED_AT }) };
        }
      }
    } else if (HELP_TOOLS.has(name)) {
      const can = (r: string, a: string) => hasPermission(c, r, a);
      const origin = originOf(c);
      const ans =
        name === "how_to" ? await howTo(args, origin, can)
        : name === "module_overview" ? await moduleOverview(args, origin, can)
        : name === "glossary" ? glossary(args, origin)
        : name === "explain_error" ? explainError(args)
        : name === "explain_screen" ? await explainScreen(args, origin, can)
        : name === "where_is" ? await whereIs(args, origin, can)
        : await onboarding(args, origin, can);
      result = text(JSON.stringify(ans.value));
      // Gap log: a question with no guide yet is kept (personal data stripped) so the admin page can list what to write next.
      if (!ans.matched) {
        note = NO_GUIDE_NOTE;
        target = scrubQuestion(String(args.question ?? args.topic ?? args.text ?? args.thing ?? args.path ?? args.module ?? args.term ?? args.role ?? (Array.isArray(args.visible_text) ? args.visible_text.slice(0, 8).join(" | ") : "")));
      }
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
      const sw = actions ? await writeActionSwitches(c.var.DB) : null;
      const on = sw ? ["meetings", "email", ...(sw.mail_reply ? ["Mail Center replies"] : []), ...(sw.note ? ["notes on POs / service cases"] : []), ...(sw.po_approval ? ["PO approval"] : [])] : [];
      result = text(JSON.stringify({ name: id.name, role: id.role, readableModules: mods.length, readOnly: !actions, actions: actions ? `${on.join(", ")}, each after the person confirms` : "switched off" }));
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
    } else if (WRITE_TOOL_KIND[name]) {
      const kind: WriteKind = name === "propose_note" ? (args.target_type === "service_case" ? "case_note" : "po_note") : WRITE_TOOL_KIND[name].kinds[0];
      if (name === "propose_note" && args.target_type !== "service_case" && args.target_type !== "purchase_order") {
        result = text('Give target_type "purchase_order" or "service_case". Sales orders and production orders have no note endpoint in the ERP.', true);
        status = 400;
        target = "propose:note";
      } else {
        const r = await proposeWriteStep(c, id, token, kind, args);
        result = r.result;
        status = r.status;
        target = r.target;
      }
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
      result = ok ? text("Cancelled. Nothing was done.") : text("Nothing to cancel: that confirmation is unknown, already used or not yours.", true);
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
  if (STRUCTURED_TOOLS.has(name) && !result.isError) result = structured(name, result, originOf(c));
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
  return asPerson(c, id, token, () => callTool(c, id, token, name, args));
}

/** Run `fn` with the person's identity on the context (rbac / tenant / redaction read it), then restore it. */
async function asPerson<T>(c: Context<Env>, id: McpIdentity, token: string, fn: () => Promise<T>): Promise<T> {
  const ctx = c as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void };
  const saved = { userId: ctx.get("userId"), userRole: ctx.get("userRole"), orgId: ctx.get("orgId") };
  rememberVerified(token, id);
  ctx.set("userId", id.userId);
  ctx.set("userRole", id.role);
  if (id.orgId) ctx.set("orgId", id.orgId);
  try {
    return await fn();
  } finally {
    ctx.set("userId", saved.userId);
    ctx.set("userRole", saved.userRole);
    ctx.set("orgId", saved.orgId);
  }
}

export type PersonRead = { ok: true; value: unknown } | { ok: false; status: number; message: string };

/**
 * Round 4d (urgent alerts, routes/mcp-proactive.ts): several reads AS the
 * person, in parallel, through the SAME readValue path a tool uses — the module
 * gate, the route's own permission check and makeRedactor all apply. Not a tool
 * call, so nothing is written to mcp_calls (the alert check runs every 30
 * minutes; only the emails it sends are logged). One person at a time: the
 * identity sits on the shared context.
 */
export async function readManyAsPerson(c: Context<Env>, id: McpIdentity, token: string, reads: { path: string; query?: Record<string, unknown> }[]): Promise<PersonRead[]> {
  return asPerson(c, id, token, () =>
    Promise.all(
      reads.map(async (r) => {
        const v = await readValue(c, token, r.path, r.query);
        return v.ok ? ({ ok: true, value: v.value } as const) : ({ ok: false, status: v.status, message: v.message } as const);
      }),
    ),
  );
}

async function handleRpc(c: Context<Env>, id: McpIdentity, token: string, m: RpcReq, seen: { calls: number }): Promise<unknown | null> {
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
      // Round 4c P1: only the tools this person can use.
      return reply({ tools: await visibleTools(c) });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const args = (m.params?.arguments as Record<string, unknown>) ?? {};
      // Per-person rate limit (lib/mcp-limits.ts). Only here: runToolAs (the
      // admin leak check) calls callTool directly and is never limited.
      let over: string | null = null;
      try {
        const n = await countRecentCalls(c.var.DB, id.userId);
        // Rows are written after the call (waitUntil), so add the calls already made in this request.
        over = rateDecision(n.lastMinute + seen.calls, n.today + seen.calls);
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
      seen.calls++;
      return reply(await callTool(c, id, token, name, args));
    }
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list": {
      // Round 4c P2: a prompt shows when the person can use one of its tools.
      const ok = await toolAccess(c);
      const shown = await Promise.all(PROMPTS.map(async (p) => {
        for (const t of PROMPT_TOOLS[p.name] ?? []) if (await ok(t)) return true;
        return !(p.name in PROMPT_TOOLS);
      }));
      return reply({ prompts: PROMPTS.filter((_, i) => shown[i]) });
    }
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
  if (msgs.length > MAX_BATCH) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `At most ${MAX_BATCH} messages in one batch.` } }, 400);
  }
  const out: unknown[] = [];
  const seen = { calls: 0 };
  for (const m of msgs) {
    const r = await handleRpc(c, id, token, m, seen);
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
