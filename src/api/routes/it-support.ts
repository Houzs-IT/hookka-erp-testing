// ---------------------------------------------------------------------------
// it-support.ts — "IT Support": staff report an issue, follow it, reply.
//
// The tickets do not live in Hookka. They live in the Houzs IT Hub
// (support.houzscentury.com), one inbox the developers work for every system.
// This file is the only thing that talks to it, server to server:
//
//   browser --session--> /api/it-support/* --Bearer key + X-Reporter-Id--> hub
//
// Two rules hold the design together:
//   1. The hub key (IT_HUB_API_KEY) never leaves the Worker.
//   2. WHO is reporting is read off the session, never off the request. The
//      hub shows a reporter only their own tickets, keyed on X-Reporter-Id, so
//      a user id taken from a query string or a form field would be everyone's
//      tickets one edit away. Same model as /api/kpi/me and sessions.ts:
//      self-scoped, so there is no resource to grant — signed in is the gate.
//
// The hub being down or unconfigured must read as exactly that (503 / 502),
// never as an empty list: "no tickets" and "could not ask" are different facts.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { memoizeSelfApply, runSelfApply } from "../lib/self-apply";
import { DEFAULT_ORG_ID } from "../lib/tenant";

const app = new Hono<Env>();

const HUB_TIMEOUT_MS = 20_000;
const TICKET_CODE = /^[A-Z0-9]{2,6}-\d{1,8}$/;
const TICKET_STATUSES = new Set([
  "open", "in_progress", "on_hold", "testing", "waiting_reporter", "resolved", "closed", "rejected",
]);
// What the browser may set on a new ticket. Every reporter_* field, user_agent
// and app_version are filled in here from the session and the request.
const TICKET_FIELDS = ["title", "description", "type", "priority", "occurred_at", "page_url"] as const;

const ctxGet = (c: Context<Env>, k: string): string =>
  (c as unknown as { get: (k: string) => string | undefined }).get(k) ?? "";

type Hub = { base: string; key: string; reporterId: string };

/** The signed-in caller plus the hub settings, or the response to send instead. */
function hubFor(c: Context<Env>): Hub | Response {
  const reporterId = ctxGet(c, "userId");
  if (!reporterId) return c.json({ success: false, error: "Unauthorized" }, 401);
  const base = (c.env.IT_HUB_URL ?? "").trim().replace(/\/+$/, "");
  const key = (c.env.IT_HUB_API_KEY ?? "").trim();
  if (!base || !key) {
    return c.json({ success: false, error: "IT Support is not connected yet. Please tell IT directly." }, 503);
  }
  return { base, key, reporterId };
}

function hubFetch(hub: Hub, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${hub.key}`);
  headers.set("X-Reporter-Id", hub.reporterId);
  return fetch(`${hub.base}/api/v1/sys${path}`, { ...init, headers, signal: AbortSignal.timeout(HUB_TIMEOUT_MS) });
}

/**
 * Turns a hub JSON answer into ours. The hub's own 4xx messages are written
 * for the reporter ("Only a resolved ticket can be confirmed") and pass
 * through. 401 is different: it means OUR key is wrong, which is not something
 * the person at the screen can act on and must not look like their login
 * expired — the client would bounce them to /login.
 */
async function relay(c: Context<Env>, call: Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await call;
  } catch (err) {
    console.warn("[it-support] hub unreachable:", err instanceof Error ? err.message : String(err));
    return c.json({ success: false, error: "IT Support is temporarily unavailable. Please try again." }, 502);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok && body) return c.json({ success: true, data: body }, res.status === 201 ? 201 : 200);

  const message = typeof body?.error === "string" ? body.error : "";
  if (res.status === 400 || res.status === 404 || res.status === 409) {
    return c.json({ success: false, error: message || "Request failed" }, res.status);
  }
  console.warn(`[it-support] hub answered ${res.status}: ${message}`);
  return c.json({ success: false, error: "IT Support is temporarily unavailable. Please try again." }, 502);
}

type Reporter = { name: string; email: string; department: string };

async function loadReporter(c: Context<Env>, userId: string): Promise<Reporter> {
  type Row = { email?: string | null; displayName?: string | null; display_name?: string | null; department?: string | null };
  let row: Row | null = null;
  try {
    row = await c.var.DB.prepare("SELECT email, displayName, department FROM users WHERE id = ?").bind(userId).first<Row>();
  } catch {
    // users.department is added by a runtime self-apply in users.ts, so a
    // database that has never served the Users page does not have it yet.
    row = await c.var.DB.prepare("SELECT email, displayName FROM users WHERE id = ?").bind(userId).first<Row>();
  }
  const email = String(row?.email ?? "");
  const name = String(row?.displayName ?? row?.display_name ?? "").trim() || email || userId;
  return { name, email, department: String(row?.department ?? "") };
}

/** Text fields and files off the browser's form; nothing else is forwarded. */
async function readForm(c: Context<Env>): Promise<{ fields: Record<string, string>; files: File[] } | null> {
  const type = c.req.header("Content-Type") ?? "";
  const fields: Record<string, string> = {};
  const files: File[] = [];
  try {
    if (type.includes("multipart/form-data")) {
      const form = await c.req.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") fields[k] = v;
        else if (k === "files" && (v as File).size > 0) files.push(v as File);
      }
    } else {
      const body = (await c.req.json()) as Record<string, unknown>;
      for (const [k, v] of Object.entries(body ?? {})) if (v != null) fields[k] = String(v);
    }
  } catch {
    return null;
  }
  return { fields, files };
}

// ---- My tickets ------------------------------------------------------------
app.get("/tickets", async (c) => {
  const hub = hubFor(c);
  if (hub instanceof Response) return hub;
  const statuses = (c.req.query("status") ?? "").split(",").filter((s) => TICKET_STATUSES.has(s));
  const qs = statuses.length ? `?status=${statuses.join(",")}` : "";
  return relay(c, hubFetch(hub, `/tickets${qs}`));
});

// ---- Sidebar badge: tickets a developer answered that I have not opened ----
app.get("/unread-count", async (c) => {
  const hub = hubFor(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, "/tickets/unread-count"));
});

// ---- One ticket and its public timeline (the hub marks it seen) ------------
app.get("/tickets/:code", async (c) => {
  const hub = hubFor(c);
  if (hub instanceof Response) return hub;
  const code = c.req.param("code");
  if (!TICKET_CODE.test(code)) return c.json({ success: false, error: "Not found" }, 404);
  return relay(c, hubFetch(hub, `/tickets/${code}`));
});

// ---- Report an issue --------------------------------------------------------
app.post("/tickets", async (c) => {
  const hub = hubFor(c);
  if (hub instanceof Response) return hub;
  const input = await readForm(c);
  if (!input) return c.json({ success: false, error: "Invalid request body" }, 400);
  if (!input.fields.title?.trim()) return c.json({ success: false, error: "Title is required" }, 400);

  const reporter = await loadReporter(c, hub.reporterId);
  const out = new FormData();
  for (const k of TICKET_FIELDS) if (input.fields[k]?.trim()) out.set(k, input.fields[k].trim());
  out.set("reporter_name", reporter.name);
  if (reporter.email) out.set("reporter_email", reporter.email);
  if (reporter.department) out.set("reporter_department", reporter.department);
  const agent = c.req.header("User-Agent");
  if (agent) out.set("user_agent", agent);
  for (const f of input.files) out.append("files", f, f.name);

  return relay(c, hubFetch(hub, "/tickets", { method: "POST", body: out }));
});

// ---- Reply on my ticket ------------------------------------------------------
app.post("/tickets/:code/replies", async (c) => {
  const hub = hubFor(c);
  if (hub instanceof Response) return hub;
  const code = c.req.param("code");
  if (!TICKET_CODE.test(code)) return c.json({ success: false, error: "Not found" }, 404);
  const input = await readForm(c);
  if (!input) return c.json({ success: false, error: "Invalid request body" }, 400);
  const body = (input.fields.body ?? "").trim();
  if (!body && input.files.length === 0) {
    return c.json({ success: false, error: "Write a reply or attach a file" }, 400);
  }

  const out = new FormData();
  if (body) out.set("body", body);
  for (const f of input.files) out.append("files", f, f.name);
  return relay(c, hubFetch(hub, `/tickets/${code}/replies`, { method: "POST", body: out }));
});

// ---- "Yes, this is fixed": Done -> Closed -----------------------------------
app.post("/tickets/:code/confirm", async (c) => {
  const hub = hubFor(c);
  if (hub instanceof Response) return hub;
  const code = c.req.param("code");
  if (!TICKET_CODE.test(code)) return c.json({ success: false, error: "Not found" }, 404);
  return relay(c, hubFetch(hub, `/tickets/${code}/confirm`, { method: "POST" }));
});

// ---- A file on my ticket, streamed through so the key stays here ------------
app.get("/attachments/:id", async (c) => {
  const hub = hubFor(c);
  if (hub instanceof Response) return hub;
  const id = c.req.param("id");
  if (!/^\d{1,12}$/.test(id)) return c.json({ success: false, error: "Not found" }, 404);
  let res: Response;
  try {
    res = await hubFetch(hub, `/attachments/${id}`);
  } catch {
    return c.json({ success: false, error: "IT Support is temporarily unavailable. Please try again." }, 502);
  }
  if (res.status === 404) return c.json({ success: false, error: "Not found" }, 404);
  if (!res.ok || !res.body) {
    return c.json({ success: false, error: "IT Support is temporarily unavailable. Please try again." }, 502);
  }
  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("Content-Type") ?? "application/octet-stream");
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  return new Response(res.body, { status: 200, headers });
});

// ---- Hub -> Hookka: IT replied on, or moved, a ticket -----------------------
// The hub POSTs one event per developer reply or status change to
// /api/it-support/hub-events (mounted in worker.ts BEFORE authMiddleware, gated
// on IT_HUB_WEBHOOK_SECRET). Each becomes one bell row addressed to the
// reporter alone. The row id is the hub's event id, so a retry is a no-op.

// The reporter's words for each status, same as the IT Support page.
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  testing: "Testing",
  waiting_reporter: "Waiting for you",
  resolved: "Done, please confirm",
  closed: "Closed",
  rejected: "Rejected",
};
// Statuses that ask the reporter to do something.
const NEEDS_REPORTER = new Set(["waiting_reporter", "resolved"]);

let notificationsUserColumn: Promise<void> | null = null;
const ensureNotificationsUserColumn = (db: Parameters<typeof runSelfApply>[0]) =>
  memoizeSelfApply(
    () => notificationsUserColumn,
    (p) => { notificationsUserColumn = p; },
    () => runSelfApply(db, "notifications.user_id", ["ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id TEXT"]),
  );

const str = (v: unknown, max: number): string => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");

export async function recordHubEvent(c: Context<Env>): Promise<Response> {
  const e = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return c.json({ ok: false, error: "invalid payload" }, 400);

  // A reporter's own reply or Confirm is not news to them.
  if (e.author_kind !== "developer") return c.json({ ok: true, skipped: "not from IT" });

  const eventId = str(e.event_id, 64);
  const kind = e.kind;
  const code = str(e.ticket_code, 20);
  const reporterId = str(e.reporter_id, 128);
  const toStatus = str(e.to_status, 32);
  if (!/^[A-Za-z0-9_-]+$/.test(eventId) || !TICKET_CODE.test(code) || !reporterId) {
    return c.json({ ok: false, error: "event_id, ticket_code and reporter_id are required" }, 400);
  }
  if (kind !== "comment" && !(kind === "status" && TICKET_STATUSES.has(toStatus))) {
    return c.json({ ok: false, error: "kind must be comment, or status with a known to_status" }, 400);
  }

  type UserRow = { orgId?: string | null; org_id?: string | null };
  const user = await c.var.DB.prepare("SELECT orgId FROM users WHERE id = ?").bind(reporterId).first<UserRow>();
  if (!user) return c.json({ ok: false, error: "unknown reporter" }, 404);

  const ticketTitle = str(e.ticket_title, 200);
  const snippet = str(e.body, 200).replace(/\s+/g, " ");
  const title = kind === "comment" ? `IT replied on ${code}` : `IT ticket ${code}: ${STATUS_LABEL[toStatus]}`;
  const message = kind === "comment" && snippet ? `${ticketTitle}: ${snippet}` : ticketTitle;
  const severity = kind === "status" && NEEDS_REPORTER.has(toStatus) ? "WARNING" : "INFO";

  await ensureNotificationsUserColumn(c.var.DB);
  // type is SYSTEM: the column's CHECK has no IT value, and the title names IT.
  const res = await c.var.DB.prepare(
    `INSERT INTO notifications (id, type, title, message, severity, is_read, link, created_at, org_id, user_id)
     VALUES (?, 'SYSTEM', ?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
  )
    .bind(
      `it-hub-${eventId}`, title, message, severity, `/it-support?ticket=${code}`,
      new Date().toISOString(), user.orgId ?? user.org_id ?? DEFAULT_ORG_ID, reporterId,
    )
    .run();
  return c.json({ ok: true, created: (res.meta?.changes ?? 0) > 0 });
}

export default app;
