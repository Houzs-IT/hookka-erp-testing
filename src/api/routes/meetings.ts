// ---------------------------------------------------------------------------
// meetings.ts — meeting rooms shared by every company and every ERP.
//
// Rooms, meetings, guest links and the cross-ERP staff directory live in the
// Houzs IT Hub (houzs-hub routes/sysMeetings.ts), so a Houzs colleague booked
// from here sees it in Houzs ERP and the other way round. This file is the only
// thing that talks to it, server to server, like it-support.ts:
//
//   browser --session--> /api/meetings/* --Bearer key + X-Reporter-Id + X-Person-*--> hub
//
// WHO is asking is the session's user, never a value from the request; their
// name, email and department come from the users table here. Adding and
// changing rooms needs `meeting-rooms:update` (role-policy.ts; SUPER_ADMIN and
// ADMIN always pass), decided HERE and sent as X-Can-Manage-Rooms — the hub
// trusts it because only this Worker holds the key.
//
// The hub's 409 is a booking conflict and is relayed with its body unchanged:
// the page builds the "Adrian is busy 2-3pm" dialog from it. Not connected is
// 503, hub down is 502 — never an empty calendar.
//
// publicMeetings (mounted before authMiddleware at /api/public/meetings) is
// the guest side of a booking link, proxied as X-Reporter-Id: guest, which the
// hub only lets reach its /public routes.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { hasPermission } from "../lib/rbac";
import { apiRateLimit } from "../lib/api-rate-limit";

const app = new Hono<Env>();
export const publicMeetings = new Hono<Env>();
publicMeetings.use("*", apiRateLimit());

const HUB_TIMEOUT_MS = 20_000;
const ID = /^\d{1,12}$/;
const LINK_CODE = /^[a-z0-9]{1,8}-[a-f0-9]{6,32}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const COMPANY_NAME = "Hookka";

const NOT_CONNECTED = "Meetings is not connected yet. Please tell IT.";
const UNREACHABLE = "Meetings could not be reached. Please try again in a moment.";

type Hub = { base: string; key: string; headers: Record<string, string> };

const ctxGet = (c: Context<Env>, k: string): string =>
  (c as unknown as { get: (k: string) => string | undefined }).get(k) ?? "";
const hubBase = (env: Env["Bindings"]) => (env.IT_HUB_URL ?? "").trim().replace(/\/+$/, "");
const hubKey = (env: Env["Bindings"]) => (env.IT_HUB_API_KEY ?? "").trim();
/** Header values must be plain text: no line breaks, at most 200 characters. */
const clean = (v: unknown) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);

type Me = { name: string; email: string; department: string };
async function loadMe(c: Context<Env>, userId: string): Promise<Me> {
  type Row = { email?: string | null; displayName?: string | null; display_name?: string | null; department?: string | null };
  let row: Row | null = null;
  try {
    row = await c.var.DB.prepare("SELECT email, displayName, department FROM users WHERE id = ?").bind(userId).first<Row>();
  } catch {
    // users.department arrives by a runtime self-apply (users.ts); a database
    // that never served the Users page does not have it yet.
    row = await c.var.DB.prepare("SELECT email, displayName FROM users WHERE id = ?").bind(userId).first<Row>();
  }
  const email = String(row?.email ?? "");
  return { name: String(row?.displayName ?? row?.display_name ?? "").trim() || email || userId, email, department: String(row?.department ?? "") };
}

async function hubFor(c: Context<Env>): Promise<Hub | Response> {
  const userId = ctxGet(c, "userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const base = hubBase(c.env);
  const key = hubKey(c.env);
  if (!base || !key) return c.json({ error: NOT_CONNECTED }, 503);
  const me = await loadMe(c, userId);
  return {
    base,
    key,
    headers: {
      "X-Reporter-Id": clean(userId),
      "X-Person-Name": clean(me.name),
      "X-Person-Email": clean(me.email),
      "X-Person-Company": COMPANY_NAME,
      "X-Person-Department": clean(me.department),
      "X-Can-Manage-Rooms": (await hasPermission(c, "meeting-rooms", "update")) ? "1" : "0",
    },
  };
}

function hubFetch(hub: Hub, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${hub.key}`);
  for (const [k, v] of Object.entries(hub.headers)) headers.set(k, v);
  return fetch(`${hub.base}/api/v1/sys/meetings${path}`, { ...init, headers, signal: AbortSignal.timeout(HUB_TIMEOUT_MS) });
}

/** One hub call answered to the browser. 400/403/404/409/413/429 carry the hub's own body. */
async function relay(c: Context<Env>, call: Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await call;
  } catch (err) {
    console.warn("[meetings] hub unreachable:", err instanceof Error ? err.message : String(err));
    return c.json({ error: UNREACHABLE }, 502);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok && body) return c.json(body, res.status === 201 ? 201 : 200);
  if (body && [400, 403, 404, 409, 413, 429].includes(res.status)) return c.json(body, res.status as 400 | 403 | 404 | 409 | 413 | 429);
  // 401 means OUR key is wrong; passing it on would sign the user out.
  console.warn(`[meetings] hub answered ${res.status}: ${typeof body?.error === "string" ? body.error : ""}`);
  return c.json({ error: UNREACHABLE }, 502);
}

async function readJson(c: Context<Env>): Promise<Record<string, unknown> | null> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const UNREADABLE = "That could not be read. Please try again.";
const GONE = "That meeting is not there any more.";

/* ---------- staff directory ---------- */

export type DirectoryPerson = { id: string; name: string; email: string; company: string; department: string };
type UserRow = { id?: string; email?: string | null; displayName?: string | null; display_name?: string | null; department?: string | null; isActive?: number | null; is_active?: number | null };

/** Active Hookka staff as the hub's directory wants them. Pure, so the shape is tested alone. */
export function directoryPeople(rows: UserRow[]): DirectoryPerson[] {
  return rows
    .filter((r) => r.id && Number(r.isActive ?? r.is_active ?? 1) === 1)
    .map((r) => {
      const email = String(r.email ?? "").trim();
      return { id: String(r.id), name: String(r.displayName ?? r.display_name ?? "").trim() || email || String(r.id), email, company: COMPANY_NAME, department: String(r.department ?? "").trim() };
    });
}

/** Sends every active user to the hub. Nothing to send to (no address or key) is not an error. */
export async function pushMeetingsDirectory(env: Env["Bindings"], db: { prepare: (s: string) => { all: <T>() => Promise<{ results?: T[] } | T[]> } }): Promise<{ sent: number } | { skipped: string }> {
  const base = hubBase(env);
  const key = hubKey(env);
  if (!base || !key) return { skipped: "not connected" };
  let rows: UserRow[];
  try {
    const r = await db.prepare("SELECT id, email, displayName, department, isActive FROM users").all<UserRow>();
    rows = Array.isArray(r) ? r : r.results ?? [];
  } catch {
    const r = await db.prepare("SELECT id, email, displayName, isActive FROM users").all<UserRow>();
    rows = Array.isArray(r) ? r : r.results ?? [];
  }
  const people = directoryPeople(rows);
  const res = await fetch(`${base}/api/v1/sys/meetings/directory`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${key}`, "X-Reporter-Id": "system", "Content-Type": "application/json" },
    body: JSON.stringify({ people }),
    signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`hub refused the staff list: ${res.status}`);
  return { sent: people.length };
}

// Opening the page also refreshes the directory, at most once an hour per
// isolate, so a colleague is findable from Houzs ERP even between cron runs.
let lastPush = 0;
function maybePush(c: Context<Env>) {
  if (Date.now() - lastPush < 3_600_000) return;
  lastPush = Date.now();
  const p = pushMeetingsDirectory(c.env, c.var.DB as never).catch((e) => console.warn("[meetings] directory push failed:", e instanceof Error ? e.message : String(e)));
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    /* no ExecutionContext (tests) */
  }
}

/* ---------- signed-in routes ---------- */

app.get("/status", async (c) => {
  if (!hubBase(c.env) || !hubKey(c.env)) return c.json({ connected: false });
  return c.json({ connected: true });
});

app.get("/bootstrap", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  maybePush(c);
  return relay(c, hubFetch(hub, "/bootstrap"));
});

app.get("/calendar", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return c.json({ error: "from and to are required" }, 400);
  return relay(c, hubFetch(hub, `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
});

app.get("/mine", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, "/mine"));
});

app.get("/unread-count", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const res = await relay(c, hubFetch(hub, "/unread"));
  if (!res.ok) return res;
  const n = Number(((await res.json()) as { unread?: unknown }).unread);
  return c.json({ count: Number.isFinite(n) && n > 0 ? n : 0 });
});

app.post("/notifications/read", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, "/notifications/read", { method: "POST" }));
});

app.get("/meetings/:id", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: GONE }, 404);
  return relay(c, hubFetch(hub, `/meetings/${id}`));
});

app.post("/meetings", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const body = await readJson(c);
  if (!body) return c.json({ error: UNREADABLE }, 400);
  return relay(c, hubFetch(hub, "/meetings", jsonInit("POST", body)));
});

app.patch("/meetings/:id", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: GONE }, 404);
  const body = await readJson(c);
  if (!body) return c.json({ error: UNREADABLE }, 400);
  return relay(c, hubFetch(hub, `/meetings/${id}`, jsonInit("PATCH", body)));
});

app.post("/meetings/:id/:act{cancel|start|end}", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: GONE }, 404);
  return relay(c, hubFetch(hub, `/meetings/${id}/${c.req.param("act")}`, jsonInit("POST", (await readJson(c)) ?? {})));
});

app.post("/meetings/:id/files", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: GONE }, 404);
  let files: File[] = [];
  try {
    const form = await c.req.formData();
    files = form.getAll("files").filter((f): f is File => typeof f !== "string" && (f as File).size > 0);
  } catch {
    return c.json({ error: "Those files could not be read. Please attach them again." }, 400);
  }
  if (!files.length) return c.json({ error: "Attach at least one file." }, 400);
  if (files.length > MAX_FILES) return c.json({ error: `Attach at most ${MAX_FILES} files at a time.` }, 400);
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return c.json({ error: `${big.name} is larger than 25 MB.` }, 413);
  const out = new FormData();
  for (const f of files) out.append("files", f, f.name);
  return relay(c, hubFetch(hub, `/meetings/${id}/files`, { method: "POST", body: out }));
});

app.get("/meetings/:id/files/:fid", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const id = c.req.param("id");
  const fid = c.req.param("fid");
  if (!ID.test(id) || !ID.test(fid)) return c.json({ error: "That file could not be found." }, 404);
  let res: Response;
  try {
    res = await hubFetch(hub, `/meetings/${id}/files/${fid}`);
  } catch {
    return c.json({ error: UNREACHABLE }, 502);
  }
  if (res.status === 404) return c.json({ error: "That file could not be found." }, 404);
  if (!res.ok || !res.body) return c.json({ error: UNREACHABLE }, 502);
  const headers = new Headers({ "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream", "X-Content-Type-Options": "nosniff" });
  const disposition = res.headers.get("Content-Disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  return new Response(res.body, { status: 200, headers });
});

const MANAGE_ONLY = "You need Manage meeting rooms for that.";

app.post("/rooms", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  if (hub.headers["X-Can-Manage-Rooms"] !== "1") return c.json({ error: MANAGE_ONLY }, 403);
  const body = await readJson(c);
  if (!body) return c.json({ error: UNREADABLE }, 400);
  return relay(c, hubFetch(hub, "/rooms", jsonInit("POST", body)));
});

app.patch("/rooms/:id", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  if (hub.headers["X-Can-Manage-Rooms"] !== "1") return c.json({ error: MANAGE_ONLY }, 403);
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "Room not found" }, 404);
  const body = await readJson(c);
  if (!body) return c.json({ error: UNREADABLE }, 400);
  return relay(c, hubFetch(hub, `/rooms/${id}`, jsonInit("PATCH", body)));
});

app.get("/log", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  if (hub.headers["X-Can-Manage-Rooms"] !== "1") return c.json({ error: MANAGE_ONLY }, 403);
  return relay(c, hubFetch(hub, "/log"));
});

app.get("/links", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, "/links"));
});

app.post("/links", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const body = await readJson(c);
  if (!body) return c.json({ error: UNREADABLE }, 400);
  return relay(c, hubFetch(hub, "/links", jsonInit("POST", body)));
});

app.patch("/links/:id", async (c) => {
  const hub = await hubFor(c);
  if (hub instanceof Response) return hub;
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "Link not found" }, 404);
  return relay(c, hubFetch(hub, `/links/${id}`, jsonInit("PATCH", (await readJson(c)) ?? {})));
});

/* ---------- guests (no login) ---------- */

function guestHub(c: Context<Env>): Hub | Response {
  const base = hubBase(c.env);
  const key = hubKey(c.env);
  if (!base || !key) return c.json({ error: "Booking is not available right now." }, 503);
  return { base, key, headers: { "X-Reporter-Id": "guest" } };
}
const DEAD = "This booking link is not active.";

publicMeetings.get("/links/:code", async (c) => {
  const code = c.req.param("code");
  if (!LINK_CODE.test(code)) return c.json({ error: DEAD }, 404);
  const hub = guestHub(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, `/public/links/${code}`));
});

publicMeetings.get("/links/:code/slots", async (c) => {
  const code = c.req.param("code");
  const day = c.req.query("day") ?? "";
  if (!LINK_CODE.test(code)) return c.json({ error: DEAD }, 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: "Pick a day." }, 400);
  const hub = guestHub(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, `/public/links/${code}/slots?day=${day}`));
});

// One day of a link: each room's taken times (no titles, no people), for the guest to pick a room and time.
publicMeetings.get("/links/:code/day", async (c) => {
  const code = c.req.param("code");
  const day = c.req.query("day") ?? "";
  if (!LINK_CODE.test(code)) return c.json({ error: DEAD }, 404);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: "Pick a day." }, 400);
  const hub = guestHub(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, `/public/links/${code}/day?day=${day}`));
});

publicMeetings.post("/links/:code/book", async (c) => {
  const code = c.req.param("code");
  if (!LINK_CODE.test(code)) return c.json({ error: DEAD }, 404);
  const hub = guestHub(c);
  if (hub instanceof Response) return hub;
  const b = await readJson(c);
  if (!b) return c.json({ error: UNREADABLE }, 400);
  // Only these fields reach the hub. The guest picks the room and the time range; never a host or attendees.
  const body = { start: b.start, end: b.end, roomId: b.roomId, name: b.name, phone: b.phone, email: b.email, company: b.company, department: b.department, title: b.title, people: b.people };
  return relay(c, hubFetch(hub, `/public/links/${code}/book`, jsonInit("POST", body)));
});

publicMeetings.get("/bookings/:token", async (c) => {
  const token = c.req.param("token");
  if (!TOKEN.test(token)) return c.json({ error: "Booking not found" }, 404);
  const hub = guestHub(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, `/public/bookings/${token}`));
});

publicMeetings.post("/bookings/:token/cancel", async (c) => {
  const token = c.req.param("token");
  if (!TOKEN.test(token)) return c.json({ error: "Booking not found" }, 404);
  const hub = guestHub(c);
  if (hub instanceof Response) return hub;
  return relay(c, hubFetch(hub, `/public/bookings/${token}/cancel`, { method: "POST" }));
});

export default app;
