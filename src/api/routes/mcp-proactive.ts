// ---------------------------------------------------------------------------
// mcp-proactive.ts — AI Connector round 4d: the morning brief email (D1) and
// urgent alerts (D2). docs/plans/mcp-connector.md §3f.
//
// THREE mounts (worker.ts):
//   /api/internal/mcp-proactive   POST /tick — CRON_SECRET. Fired every 30 min
//                                 by the agent heartbeat (routes/agent-heartbeat.ts,
//                                 itself driven by the hookka-agent-heartbeat
//                                 Cron Worker */30 + the GitHub fallback), so no
//                                 new cron infrastructure. Pre-auth.
//   /api/mcp-proactive            GET/POST /unsubscribe?t=… — the link in every
//                                 email; the random token alone identifies the
//                                 person. Pre-auth.
//   /api/mcp-admin/proactive      the person's own settings (session): GET/PUT
//                                 /me, GET /me/preview, POST /me/test.
//
// AS THE PERSON, ALWAYS. Each person gets a short-lived connector token of
// their own (client mcpc_morning_brief), revoked in `finally`; the brief is the
// daily_brief tool run through runToolAs, and the alert reads go through
// readManyAsPerson — the same readValue path, module gate, route permission
// check and makeRedactor as a question from Claude. There is no service account.
//
// BOUNDED + IDEMPOTENT. At most maxBriefsPerTick briefs and maxPeoplePerTick
// alert checks per tick, a 20 s budget, people one at a time. One brief per
// person per Malaysia day (key "brief" claimed before building); every alert
// key at most once per person per day (claimed before sending). Each email is
// logged in mcp_proactive_sends — never its body.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { emitAudit } from "../lib/audit";
import { enqueueEmail } from "../lib/email-outbox";
import { constantTimeEqual } from "./delivery-agent";
import { readManyAsPerson, runToolAs } from "./mcp";
import { ensureMcpTables, hasMcpAccess, issueTokens, revokeToken, type McpIdentity } from "../lib/mcp-store";
import { PROACTIVE_CLIENT_ID } from "../lib/mcp-limits";
import { parseQuickText } from "../lib/mcp-visibility";
import { BRIEF_SO_TOP } from "../lib/mcp-quick";
import {
  alertsToSend,
  buildAlertEmail,
  buildBriefEmail,
  computeAlerts,
  debounceSince,
  DEFAULT_SUBSCRIPTION,
  escapeHtml,
  isMonday,
  mytNow,
  parseSubscriptionInput,
  pickTickWork,
  thresholdsForDisplay,
  type MytNow,
} from "../lib/mcp-proactive";
import {
  activeSubscribers,
  claimKeys,
  getSubscription,
  logSend,
  markAlertChecked,
  recentSends,
  releaseKey,
  saveSubscription,
  sentKeys,
  unsubscribeToken,
  unsubscribeWithToken,
  usersWithKey,
  type Subscriber,
} from "../lib/mcp-proactive-store";

type Obj = Record<string, unknown>;

/** The tick stops starting new people after this long (the rest wait 30 minutes). */
const TICK_BUDGET_MS = 20_000;
export const SCHEDULE_WORDS = "Checked every 30 minutes (the ERP's agent heartbeat). Briefs go out on the first check at or after your time; alerts are checked 7:00–20:00 Malaysia time.";

const db = (c: Context<Env>) => c.var.DB;
const uid = (c: Context<Env>): string => String((c as unknown as { get: (k: string) => unknown }).get("userId") ?? "");
const role = (c: Context<Env>): string => String((c as unknown as { get: (k: string) => unknown }).get("userRole") ?? "").toUpperCase();

/** Links in emails: the configured app URL, else the origin this request came in on. */
function appOrigin(c: Context<Env>): string {
  const env = (c.env ?? {}) as { APP_URL?: string };
  const configured = (env.APP_URL || "").replace(/\/+$/, "");
  return /^https?:\/\//.test(configured) ? configured : new URL(c.req.url).origin;
}

let clientReady = false;
async function ensureProactiveClient(c: Context<Env>): Promise<void> {
  if (clientReady) return;
  await ensureMcpTables(db(c));
  await db(c)
    .prepare("INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, 'Morning brief', '[]', ?) ON CONFLICT (client_id) DO NOTHING")
    .bind(PROACTIVE_CLIENT_ID, new Date().toISOString())
    .run();
  clientReady = true;
}

type Person = { userId: string; role: string; orgId: string | null; name: string; email: string };

/** Run `fn` with a fresh connector token of the person's own; always revoked afterwards. */
async function withPersonToken<T>(c: Context<Env>, p: Person, fn: (id: McpIdentity, token: string) => Promise<T>): Promise<T> {
  await ensureProactiveClient(c);
  const tok = await issueTokens(db(c), p.userId, PROACTIVE_CLIENT_ID);
  const id: McpIdentity = { tokenId: tok.tokenId, userId: p.userId, clientId: PROACTIVE_CLIENT_ID, role: p.role, orgId: p.orgId, name: p.name };
  try {
    return await fn(id, tok.accessToken);
  } finally {
    await revokeToken(db(c), tok.tokenId).catch(() => 0);
  }
}

/** A quick answer's JSON: structuredContent when present, else the text parsed. */
function answerValue(r: { content: { text: string }[]; structuredContent?: Obj; isError?: boolean }): { ok: true; value: Obj } | { ok: false; message: string } {
  const t = r.content[0]?.text ?? "";
  if (r.isError) return { ok: false, message: t.slice(0, 200) };
  const sc = r.structuredContent;
  if (sc && !("truncated" in sc && sc.truncated === true)) return { ok: true, value: sc };
  const q = parseQuickText(t);
  return q ? { ok: true, value: q.value } : { ok: false, message: "the answer could not be read" };
}

type BuiltBrief = { ok: true; subject: string; html: string; text: string; items: number } | { ok: false; message: string };

/** The brief AS THE PERSON: daily_brief (+ data_gaps on Monday / on request) through runToolAs. */
async function buildBrief(c: Context<Env>, p: Person, id: McpIdentity, token: string, now: MytNow, opts: { withGaps: boolean; test?: boolean }): Promise<BuiltBrief> {
  const b = answerValue(await runToolAs(c, id, token, "daily_brief", {}));
  if (!b.ok) return { ok: false, message: `daily_brief: ${b.message}` };
  let gaps: Obj | null = null;
  if (opts.withGaps) {
    const g = answerValue(await runToolAs(c, id, token, "data_gaps", {}));
    gaps = g.ok ? g.value : null; // no access to any list → no gaps section
  }
  const origin = appOrigin(c);
  const t = await unsubscribeToken(db(c), p.userId);
  const mail = buildBriefEmail({
    brief: b.value,
    gaps,
    name: p.name,
    date: now.day,
    settingsUrl: `${origin}/settings/ai-connector`,
    unsubscribeUrl: t ? `${origin}/api/mcp-proactive/unsubscribe?t=${encodeURIComponent(t)}` : "",
    test: opts.test,
  });
  return { ok: true, ...mail };
}

type PersonResult = { brief?: "queued" | "failed" | "already"; alerts?: number; alertError?: string };

/** One person on one tick: the brief if due, then the alert check if due. Never throws. */
async function runPerson(c: Context<Env>, s: Subscriber, now: MytNow, wantBrief: boolean, wantAlerts: boolean): Promise<PersonResult> {
  const out: PersonResult = {};
  const person: Person = { userId: s.userId, role: s.role, orgId: s.orgId, name: s.name, email: s.email };
  await withPersonToken(c, person, async (id, token) => {
    if (wantBrief) {
      const claimed = await claimKeys(db(c), s.userId, ["brief"], now.day);
      if (!claimed.length) out.brief = "already";
      else {
        try {
          const built = await buildBrief(c, person, id, token, now, { withGaps: isMonday(now) });
          if (!built.ok) throw new Error(built.message);
          const q = await enqueueEmail(c, { to: s.email, subject: built.subject, html: built.html, text: built.text });
          await logSend(db(c), { userId: s.userId, kind: "brief", day: now.day, items: built.items, outboxId: q.id, status: "queued", note: isMonday(now) ? "with data gaps" : "" });
          out.brief = "queued";
        } catch (e) {
          // Give the claim back so a later tick today can retry (until the cutoff).
          await releaseKey(db(c), s.userId, "brief", now.day).catch(() => {});
          const msg = e instanceof Error ? e.message : String(e);
          await logSend(db(c), { userId: s.userId, kind: "brief", day: now.day, items: 0, outboxId: null, status: "failed", note: msg });
          out.brief = "failed";
        }
      }
    }
    if (wantAlerts) {
      try {
        const [po, so, board, mrp] = await readManyAsPerson(c, id, token, [
          { path: "/api/purchase-orders/stats" },
          { path: "/api/sales-orders", query: { fields: "orders-due", top: BRIEF_SO_TOP } },
          { path: "/api/production-orders/board" },
          { path: "/api/mrp/plan" },
        ]);
        const v = (r: typeof po) => (r.ok ? r.value : null);
        const alerts = computeAlerts({ today: now.day, origin: appOrigin(c), poStats: v(po), soDue: v(so), board: v(board), mrpPlan: v(mrp) });
        const fresh = alertsToSend(alerts, await sentKeysFor(c, s.userId, alerts.map((a) => a.key), now.day), now.day);
        const claimed = new Set(await claimKeys(db(c), s.userId, fresh.map((a) => a.key), now.day));
        const send = fresh.filter((a) => claimed.has(a.key));
        if (send.length) {
          const t = await unsubscribeToken(db(c), s.userId);
          const origin = appOrigin(c);
          const mail = buildAlertEmail({ alerts: send, name: s.name, date: now.day, settingsUrl: `${origin}/settings/ai-connector`, unsubscribeUrl: t ? `${origin}/api/mcp-proactive/unsubscribe?t=${encodeURIComponent(t)}` : "" });
          const q = await enqueueEmail(c, { to: s.email, subject: mail.subject, html: mail.html, text: mail.text });
          await logSend(db(c), { userId: s.userId, kind: "alert", day: now.day, items: send.length, outboxId: q.id, status: "queued", note: [...new Set(send.map((a) => a.kind))].join(",") });
        }
        out.alerts = send.length;
      } catch (e) {
        out.alertError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      } finally {
        await markAlertChecked(db(c), s.userId).catch(() => {});
      }
    }
  });
  return out;
}

const sentKeysFor = (c: Context<Env>, userId: string, keys: string[], today: string) => sentKeys(db(c), userId, keys, debounceSince(today));

// ── /api/internal/mcp-proactive ─────────────────────────────────────────────

export const internal = new Hono<Env>();

internal.post("/tick", async (c) => {
  const expected = c.env.CRON_SECRET;
  if (!expected || expected.length < 16) return c.json({ ok: false, error: "service unavailable" }, 503);
  if (!(await constantTimeEqual(c.req.header("x-cron-secret") || "", expected))) return c.json({ ok: false, error: "forbidden" }, 403);
  const t0 = Date.now();
  const now = mytNow();
  const subs = await activeSubscribers(db(c));
  const work = pickTickWork(subs, now, await usersWithKey(db(c), "brief", now.day));
  if (c.req.query("dryRun") === "1") {
    return c.json({ ok: true, dryRun: true, subscribers: subs.length, briefsDue: work.briefs.length, alertChecksDue: work.alerts.length });
  }
  const byId = new Map<string, { s: Subscriber; brief: boolean; alerts: boolean }>();
  for (const s of work.briefs) byId.set(s.userId, { s, brief: true, alerts: false });
  for (const s of work.alerts) byId.set(s.userId, { s, brief: byId.get(s.userId)?.brief ?? false, alerts: true });
  const counts = { briefsQueued: 0, briefsFailed: 0, alertEmails: 0, alertLines: 0, alertErrors: 0, peopleDone: 0, peopleDeferred: 0 };
  // One person at a time: their identity sits on this request's context while
  // their reads run (runToolAs / readManyAsPerson). No query of its own here.
  for (const { s, brief, alerts } of byId.values()) {
    if (Date.now() - t0 > TICK_BUDGET_MS) {
      counts.peopleDeferred += 1;
      continue;
    }
    try {
      const r = await runPerson(c, s, now, brief, alerts);
      if (r.brief === "queued") counts.briefsQueued += 1;
      if (r.brief === "failed") counts.briefsFailed += 1;
      if (r.alerts) {
        counts.alertEmails += 1;
        counts.alertLines += r.alerts;
      }
      if (r.alertError) counts.alertErrors += 1;
    } catch (e) {
      console.warn("[mcp-proactive] person failed:", e instanceof Error ? e.message : String(e));
      counts.alertErrors += 1;
    }
    counts.peopleDone += 1;
  }
  return c.json({ ok: true, subscribers: subs.length, ...counts, ms: Date.now() - t0 });
});

// ── /api/mcp-proactive (the unsubscribe link, no session) ───────────────────

export const publicRoutes = new Hono<Env>();

function plainPage(title: string, inner: string, status: 200 | 400 = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F6F4EF;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F1D1A">
<main style="max-width:480px;margin:48px auto;padding:24px;background:#fff;border:1px solid #E6E1D6;border-radius:12px">${inner}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

// GET shows ONE button; the POST does it. A link scanner that pre-opens every
// link in an email (Outlook Safe Links, Gmail) must not unsubscribe anyone.
publicRoutes.get("/unsubscribe", (c) => {
  const t = c.req.query("t") ?? "";
  if (!/^[A-Za-z0-9_-]{32}$/.test(t)) return plainPage("Link not valid", `<h1 style="font-size:20px">This link is not valid</h1><p>Change your email settings on Settings › AI Connector in Hookka ERP.</p>`, 400);
  return plainPage(
    "Unsubscribe",
    `<h1 style="font-size:20px;margin:0 0 8px">Stop Hookka emails?</h1><p style="color:#55534E">This turns off your morning brief and urgent alerts. You can turn them on again on Settings › AI Connector.</p>
<form method="post" action="/api/mcp-proactive/unsubscribe"><input type="hidden" name="t" value="${escapeHtml(t)}"><button type="submit" style="height:44px;padding:0 20px;border:0;border-radius:8px;background:#6B5C32;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`,
  );
});

publicRoutes.post("/unsubscribe", async (c) => {
  let t = c.req.query("t") ?? "";
  if (!t) {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    t = typeof form.t === "string" ? form.t : "";
  }
  const userId = await unsubscribeWithToken(db(c), t);
  if (!userId) return plainPage("Link not valid", `<h1 style="font-size:20px">This link is not valid</h1><p>Change your email settings on Settings › AI Connector in Hookka ERP.</p>`, 400);
  await logSend(db(c), { userId, kind: "brief", day: mytNow().day, items: 0, outboxId: null, status: "skipped", note: "unsubscribed by email link" });
  return plainPage("Unsubscribed", `<h1 style="font-size:20px;margin:0 0 8px">You are unsubscribed</h1><p style="color:#55534E">No more morning briefs or alerts. Turn them on again any time on Settings › AI Connector.</p>`);
});

// ── /api/mcp-admin/proactive (the person's own settings, session) ───────────

export const me = new Hono<Env>();

async function sessionPerson(c: Context<Env>): Promise<Person | null> {
  const id = uid(c);
  if (!id) return null;
  const r = await db(c).prepare("SELECT id, email, displayName, role, orgId FROM users WHERE id = ?").bind(id).first<Obj>();
  if (!r) return null;
  const g = (...k: string[]) => {
    for (const x of k) if (r[x] !== undefined && r[x] !== null) return String(r[x]);
    return "";
  };
  return { userId: id, role: (g("role") || role(c)).toUpperCase(), orgId: g("orgId", "orgid", "org_id") || null, name: g("displayName", "displayname", "display_name") || g("email"), email: g("email").trim() };
}

me.get("/me", async (c) => {
  const p = await sessionPerson(c);
  if (!p) return c.json({ success: false, error: "Unauthorized" }, 401);
  const allowed = await hasMcpAccess(db(c), p.userId, p.role);
  const sub = await getSubscription(db(c), p.userId);
  return c.json({
    success: true,
    data: {
      allowed,
      email: p.email,
      saved: !!sub,
      subscription: sub ?? { userId: p.userId, ...DEFAULT_SUBSCRIPTION },
      thresholds: thresholdsForDisplay(),
      schedule: SCHEDULE_WORDS,
      recent: allowed ? await recentSends(db(c), p.userId, 10) : [],
    },
  });
});

me.put("/me", async (c) => {
  const p = await sessionPerson(c);
  if (!p) return c.json({ success: false, error: "Unauthorized" }, 401);
  if (!(await hasMcpAccess(db(c), p.userId, p.role))) return c.json({ success: false, error: "AI Connector is not turned on for your account. Ask for access first." }, 403);
  const parsed = parseSubscriptionInput(await c.req.json().catch(() => null), p.userId);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
  if ((parsed.value.briefEnabled || parsed.value.alertsEnabled) && !p.email.includes("@")) return c.json({ success: false, error: "Your ERP account has no email address. Ask an admin to add one first." }, 400);
  await saveSubscription(db(c), parsed.value);
  await emitAudit(c, { resource: "ai-connector", resourceId: `brief:${p.userId}`, action: "update", after: { ...parsed.value } });
  return c.json({ success: true, data: { subscription: parsed.value } });
});

/** The brief as it would be sent now — built as you, NOT sent. */
me.get("/me/preview", async (c) => {
  const p = await sessionPerson(c);
  if (!p) return c.json({ success: false, error: "Unauthorized" }, 401);
  if (!(await hasMcpAccess(db(c), p.userId, p.role))) return c.json({ success: false, error: "AI Connector is not turned on for your account." }, 403);
  const now = mytNow();
  const built = await withPersonToken(c, p, (id, token) => buildBrief(c, p, id, token, now, { withGaps: c.req.query("gaps") === "1" || isMonday(now) }));
  if (!built.ok) return c.json({ success: false, error: `The brief could not be built: ${built.message}` }, 502);
  return c.json({ success: true, data: { subject: built.subject, html: built.html, items: built.items } });
});

/** "Send me a test brief now" — to your own email only, at most once per 10 minutes. */
me.post("/me/test", async (c) => {
  const p = await sessionPerson(c);
  if (!p) return c.json({ success: false, error: "Unauthorized" }, 401);
  if (!(await hasMcpAccess(db(c), p.userId, p.role))) return c.json({ success: false, error: "AI Connector is not turned on for your account." }, 403);
  if (!p.email.includes("@")) return c.json({ success: false, error: "Your ERP account has no email address." }, 400);
  const now = mytNow();
  const bucket = `brief_test:${now.hhmm.slice(0, 4)}`; // HH:M — one per 10 minutes
  const claimed = await claimKeys(db(c), p.userId, [bucket], now.day);
  if (!claimed.length) return c.json({ success: false, error: "A test brief was sent in the last few minutes — check your inbox, or try again in 10 minutes." }, 429);
  // Settings saved once, so the email carries a working unsubscribe link.
  if (!(await getSubscription(db(c), p.userId))) await saveSubscription(db(c), { userId: p.userId, ...DEFAULT_SUBSCRIPTION });
  const built = await withPersonToken(c, p, (id, token) => buildBrief(c, p, id, token, now, { withGaps: true, test: true }));
  if (!built.ok) {
    await releaseKey(db(c), p.userId, bucket, now.day).catch(() => {});
    await logSend(db(c), { userId: p.userId, kind: "brief_test", day: now.day, items: 0, outboxId: null, status: "failed", note: built.message });
    return c.json({ success: false, error: `The brief could not be built: ${built.message}` }, 502);
  }
  const q = await enqueueEmail(c, { to: p.email, subject: built.subject, html: built.html, text: built.text });
  await logSend(db(c), { userId: p.userId, kind: "brief_test", day: now.day, items: built.items, outboxId: q.id, status: "queued", note: "with data gaps" });
  return c.json({ success: true, data: { sentTo: p.email, items: built.items } });
});
