// ---------------------------------------------------------------------------
// mcp-actions.ts — the AI Connector's two ordinary actions: book a meeting and
// send an email (owner 2026-11-26 「等等一些普通功能」, design 「先确认再做」 —
// confirm first, then do). Never orders, money, stock, approvals or deletes.
//
//   propose_meeting / propose_email  validate like a real submit, store ONE
//                                    pending action (10 minutes), answer a
//                                    plain summary + confirmationId.
//   confirm_action                   single use, same token + person; then the
//                                    ERP's OWN create-meeting / Mail Center
//                                    compose route runs in-process AS the
//                                    person (routes/mcp.ts innerAction), so its
//                                    permission checks, mailbox rules and audit
//                                    trail all apply.
//   cancel_action                    drops a pending action.
//
// The write fence itself is in mcp-inner.ts (ACTION_ALLOWLIST + the one-shot
// armed action) and auth-middleware.ts. This file holds the storage, the owner
// switch and the pure shaping (tested in tests/mcp-actions.test.mjs).
//
// Table (runtime self-apply, snake_case — migrations do not auto-apply):
//   mcp_pending_actions  one row per proposal. payload_json is blanked as soon
//                        as the action ran (or expired), so an email body is
//                        kept only while it waits for the person's yes.
// The owner switch is kv_config['mcp_actions_enabled'] = {"enabled": true|false}.
// ---------------------------------------------------------------------------
import { memoizeSelfApply } from "./self-apply";
import { invalidAddresses, parseAddressList } from "./mail-threading";

type Db = D1Database;

export const ACTION_TTL_MS = 10 * 60 * 1000;
export const ACTIONS_PER_DAY = 30;
export const ACTIONS_SWITCH_KEY = "mcp_actions_enabled";
export const ACTIONS_OFF_MESSAGE = "AI actions are switched off by your admin.";
export type ActionKind = "meeting" | "email" | "mail_reply" | "po_note" | "case_note" | "po_approval";
export const ACTION_KINDS: readonly ActionKind[] = ["meeting", "email", "mail_reply", "po_note", "case_note", "po_approval"];

// ── round 4b: one admin switch per write action (owner 2026-11-26) ──────────
// Each is OFF until the owner turns it on, and only counts while the main
// "Allow AI actions" switch is on too (that one stays the master kill switch).
// kv_config['mcp_action_<name>'] = {"enabled": true|false}.
export const WRITE_ACTIONS = ["mail_reply", "note", "po_approval"] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];
export const WRITE_ACTION_LABELS: Record<WriteAction, string> = {
  mail_reply: "Reply to Mail Center threads",
  note: "Add notes to purchase orders and service cases",
  po_approval: "Approve purchase orders",
};
/** Which switch a pending action's kind needs (meetings / email only need the main switch). */
export function switchForKind(kind: ActionKind): WriteAction | null {
  if (kind === "mail_reply") return "mail_reply";
  if (kind === "po_note" || kind === "case_note") return "note";
  if (kind === "po_approval") return "po_approval";
  return null;
}
export const writeSwitchKey = (a: WriteAction): string => `mcp_action_${a}`;
export const actionOffMessage = (a: WriteAction): string => `"${WRITE_ACTION_LABELS[a]}" is switched off by your admin.`;

const MAX_TITLE = 200;
const MAX_NOTES = 4000;
const MAX_SUBJECT = 200;
const MAX_BODY = 20_000;
const MAX_RECIPIENTS = 20;
const MAX_ATTENDEES = 30;
const MAX_MEETING_MS = 12 * 3600_000;
const MAX_AHEAD_MS = 366 * 24 * 3600_000;

// ── storage ─────────────────────────────────────────────────────────────────

let _ready: Promise<void> | null = null;

export function ensureActionTables(db: Db): Promise<void> {
  return memoizeSelfApply(() => _ready, (p) => { _ready = p; }, async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS mcp_pending_actions (
         id            TEXT PRIMARY KEY,
         token_id      TEXT NOT NULL,
         user_id       TEXT NOT NULL,
         kind          TEXT NOT NULL,
         payload_json  TEXT NOT NULL,
         summary       TEXT NOT NULL,
         created_at    TEXT NOT NULL,
         expires_at    TEXT NOT NULL,
         used_at       TEXT,
         cancelled_at  TEXT,
         result_status INTEGER,
         result_note   TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS mcp_pending_actions_user_idx ON mcp_pending_actions (user_id, used_at)`,
    ];
    for (const s of stmts) await db.prepare(s).run();
  });
}

export function _resetActionStoreForTests(): void {
  _ready = null;
}

const str = (r: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null) return String(v);
  }
  return "";
};

function newId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return "mcpa_" + Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function switchOn(db: Db, key: string): Promise<boolean> {
  try {
    const r = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(key).first<Record<string, unknown>>();
    if (!r) return false;
    const v = JSON.parse(str(r, "value")) as { enabled?: unknown };
    return v?.enabled === true;
  } catch {
    return false;
  }
}

async function setSwitch(db: Db, key: string, enabled: boolean, by: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO kv_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify({ enabled, by, at: new Date().toISOString() }), new Date().toISOString())
    .run();
}

/** The owner's switch (Settings › AI Connector). Off unless explicitly turned on. */
export function actionsEnabled(db: Db): Promise<boolean> {
  return switchOn(db, ACTIONS_SWITCH_KEY);
}

export function setActionsEnabled(db: Db, enabled: boolean, by: string): Promise<void> {
  return setSwitch(db, ACTIONS_SWITCH_KEY, enabled, by);
}

/** One write action's own switch (off unless explicitly on). Does NOT include the main switch. */
export function writeActionSwitch(db: Db, a: WriteAction): Promise<boolean> {
  return switchOn(db, writeSwitchKey(a));
}

export function setWriteActionSwitch(db: Db, a: WriteAction, enabled: boolean, by: string): Promise<void> {
  return setSwitch(db, writeSwitchKey(a), enabled, by);
}

/** Every write action's own switch, for the admin page and tools/list. */
export async function writeActionSwitches(db: Db): Promise<Record<WriteAction, boolean>> {
  const vals = await Promise.all(WRITE_ACTIONS.map((a) => writeActionSwitch(db, a)));
  return Object.fromEntries(WRITE_ACTIONS.map((a, i) => [a, vals[i]])) as Record<WriteAction, boolean>;
}

/**
 * May an action of this kind run now? The main switch, then (round 4b) the
 * action's own switch. null = yes; otherwise the plain refusal.
 */
export async function kindAllowed(db: Db, kind: ActionKind): Promise<string | null> {
  if (!(await actionsEnabled(db))) return ACTIONS_OFF_MESSAGE;
  const sw = switchForKind(kind);
  if (sw && !(await writeActionSwitch(db, sw))) return actionOffMessage(sw);
  return null;
}

export async function createPendingAction(
  db: Db,
  a: { tokenId: string; userId: string; kind: ActionKind; payload: unknown; summary: string },
  now = Date.now(),
): Promise<{ id: string; expiresAt: string }> {
  await ensureActionTables(db);
  // Housekeeping: nothing waits past its 10 minutes, so no expired body is kept.
  await db
    .prepare("UPDATE mcp_pending_actions SET payload_json = '{}' WHERE used_at IS NULL AND expires_at <= ? AND payload_json <> '{}'")
    .bind(new Date(now).toISOString())
    .run();
  const id = newId();
  const expiresAt = new Date(now + ACTION_TTL_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO mcp_pending_actions (id, token_id, user_id, kind, payload_json, summary, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, a.tokenId, a.userId, a.kind, JSON.stringify(a.payload), a.summary.slice(0, 2000), new Date(now).toISOString(), expiresAt)
    .run();
  return { id, expiresAt };
}

/** Actions this person already confirmed since `sinceIso` (the daily cap). */
export async function confirmedSince(db: Db, userId: string, sinceIso: string): Promise<number> {
  await ensureActionTables(db);
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM mcp_pending_actions WHERE user_id = ? AND used_at IS NOT NULL AND used_at >= ?")
    .bind(userId, sinceIso)
    .first<Record<string, unknown>>();
  return Number(r ? str(r, "n") : 0) || 0;
}

/**
 * Single use: the UPDATE claims the row only while it is unused, not cancelled,
 * not expired, and belongs to THIS token and person; a replay or another
 * person's id finds nothing.
 */
export async function consumePendingAction(
  db: Db,
  id: string,
  tokenId: string,
  userId: string,
  now = Date.now(),
): Promise<{ kind: ActionKind; payload: unknown; summary: string } | null> {
  await ensureActionTables(db);
  const iso = new Date(now).toISOString();
  const r = await db
    .prepare(
      `UPDATE mcp_pending_actions SET used_at = ?
        WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?
        RETURNING kind, payload_json, summary`,
    )
    .bind(iso, id, tokenId, userId, iso)
    .first<Record<string, unknown>>();
  if (!r) return null;
  const kind = str(r, "kind") as ActionKind;
  if (!ACTION_KINDS.includes(kind)) return null;
  let payload: unknown = null;
  try {
    payload = JSON.parse(str(r, "payload_json", "payloadJson"));
  } catch {
    return null;
  }
  return { kind, payload, summary: str(r, "summary") };
}

/** The kind of a pending action this token + person may still confirm (null if none) — read only, nothing is claimed. */
export async function peekPendingKind(db: Db, id: string, tokenId: string, userId: string, now = Date.now()): Promise<ActionKind | null> {
  await ensureActionTables(db);
  const r = await db
    .prepare(
      `SELECT kind FROM mcp_pending_actions
        WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?`,
    )
    .bind(id, tokenId, userId, new Date(now).toISOString())
    .first<Record<string, unknown>>();
  const kind = r ? (str(r, "kind") as ActionKind) : null;
  return kind && ACTION_KINDS.includes(kind) ? kind : null;
}

/** After the action ran: keep the outcome, drop the payload (the email body). */
export async function finishPendingAction(db: Db, id: string, status: number, note: string): Promise<void> {
  try {
    await db
      .prepare("UPDATE mcp_pending_actions SET result_status = ?, result_note = ?, payload_json = '{}' WHERE id = ?")
      .bind(status, note.slice(0, 300), id)
      .run();
  } catch (e) {
    console.warn("[mcp-actions] finish failed:", e instanceof Error ? e.message : String(e));
  }
}

export async function cancelPendingAction(db: Db, id: string, tokenId: string, userId: string, now = Date.now()): Promise<boolean> {
  await ensureActionTables(db);
  const r = await db
    .prepare(
      `UPDATE mcp_pending_actions SET cancelled_at = ?, payload_json = '{}'
        WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL AND cancelled_at IS NULL
        RETURNING id`,
    )
    .bind(new Date(now).toISOString(), id, tokenId, userId)
    .first();
  return !!r;
}

/** Start of today in Malaysia (UTC+8), as an ISO instant. */
export function myDayStartIso(now = Date.now()): string {
  const day = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00+08:00`).toISOString();
}

// ── pure: times ─────────────────────────────────────────────────────────────

/**
 * A time the AI passes: ISO with an offset ("2026-11-27T15:00:00+08:00", "…Z"),
 * or a local Malaysia time without one ("2026-11-27T15:00", "2026-11-27 15:00").
 * Returns epoch ms, or null.
 */
export function parseWhen(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  const t = Date.parse(hasZone ? s : `${s}+08:00`);
  return Number.isFinite(t) ? t : null;
}

/** "Thu 27 Nov 2026, 3:00 pm" in Malaysia time. */
export function fmtMy(t: number): string {
  return new Date(t).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  });
}

const myDay = (t: number) => new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ── pure: meeting ───────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const strList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]+/) : []).map((x) => String(x ?? "").trim()).filter(Boolean);

export type MeetingBody = {
  title: string;
  start: string;
  end: string;
  roomId: number | null;
  organizer: string;
  attendees: string[];
  videoType: "none";
  videoUrl: string;
  notes: string;
  guestEmails: string[];
  reminders: { min: number; ch: ("erp" | "email")[] }[];
  repeat: "none";
  repeatUntil: null;
};

export type Proposal<T> = { ok: true; body: T; summary: string; target: string; warnings: string[] } | { ok: false; error: string };

type Person = { key: string; name: string; email: string };
type Room = { id: number; name: string; seats: number; active: boolean };

/** One attendee as typed by the person → a directory key, an outside email, or a reason it failed. */
export function resolvePerson(
  raw: string,
  people: Person[],
): { key: string; name: string } | { guest: string } | { error: string } {
  const q = raw.trim().toLowerCase();
  const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(q) ? q : "";
  if (email) {
    const hit = people.find((p) => p.email.toLowerCase() === email);
    return hit ? { key: hit.key, name: hit.name } : { guest: email };
  }
  const exact = people.filter((p) => p.name.toLowerCase() === q);
  if (exact.length === 1) return { key: exact[0].key, name: exact[0].name };
  const part = exact.length ? exact : people.filter((p) => p.name.toLowerCase().includes(q));
  if (part.length === 1) return { key: part[0].key, name: part[0].name };
  if (part.length === 0) return { error: `No colleague called "${raw}" — give their full name or email.` };
  return { error: `"${raw}" matches ${part.length} people (${part.slice(0, 5).map((p) => p.name).join(", ")}${part.length > 5 ? ", …" : ""}) — say which one.` };
}

export function resolveRoom(raw: string, rooms: Room[]): Room | { error: string } {
  const q = raw.trim().toLowerCase();
  const live = rooms.filter((r) => r.active);
  const exact = live.filter((r) => r.name.toLowerCase() === q);
  const hits = exact.length ? exact : live.filter((r) => r.name.toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return { error: `No meeting room called "${raw}". Rooms: ${live.map((r) => r.name).join(", ") || "none"}.` };
  return { error: `"${raw}" matches several rooms (${hits.map((r) => r.name).join(", ")}) — say which one.` };
}

/** The hub's /bootstrap reply → the people and rooms the proposal resolves against. */
export function readBootstrap(body: unknown): { me: string; people: Person[]; rooms: Room[] } {
  const b = obj(body);
  return {
    me: String(b.me ?? ""),
    people: arr(b.people)
      .map((p) => ({ key: String(p.key ?? ""), name: String(p.name ?? ""), email: String(p.email ?? "") }))
      .filter((p) => p.key),
    rooms: arr(b.rooms)
      .map((r) => ({ id: Number(r.id), name: String(r.name ?? ""), seats: Number(r.seats) || 0, active: r.active !== false }))
      .filter((r) => Number.isFinite(r.id) && r.name),
  };
}

/**
 * propose_meeting's validation and the exact body POST /api/meetings/meetings
 * takes (src/lib/meetings.ts draftBody). Conflicts with other meetings are the
 * hub's to decide at confirm time (409); `busy` adds early warnings.
 */
export function buildMeetingProposal(
  args: Obj,
  boot: { me: string; people: Person[]; rooms: Room[] },
  now = Date.now(),
): Proposal<MeetingBody> {
  const title = String(args.title ?? "").trim();
  if (!title) return { ok: false, error: "Give the meeting a title." };
  if (title.length > MAX_TITLE) return { ok: false, error: `The title is too long (at most ${MAX_TITLE} characters).` };
  const start = parseWhen(args.start);
  if (start === null) return { ok: false, error: "Give start as a date and time, e.g. 2026-11-27T15:00 (Malaysia time)." };
  const end = args.end === undefined || args.end === null || args.end === "" ? start + 3600_000 : parseWhen(args.end);
  if (end === null) return { ok: false, error: "Give end as a date and time, e.g. 2026-11-27T16:00 (Malaysia time)." };
  if (end <= start) return { ok: false, error: "The meeting must end after it starts." };
  if (end - start > MAX_MEETING_MS) return { ok: false, error: "A meeting can last at most 12 hours." };
  if (start < now - 5 * 60_000) return { ok: false, error: "That time has already passed." };
  if (start > now + MAX_AHEAD_MS) return { ok: false, error: "That is more than a year ahead." };
  const notes = String(args.notes ?? "").trim();
  if (notes.length > MAX_NOTES) return { ok: false, error: `The notes are too long (at most ${MAX_NOTES} characters).` };
  if (!boot.me) return { ok: false, error: "Meetings could not tell who you are. Open Meetings in the ERP once, then try again." };

  const wanted = strList(args.attendees);
  if (wanted.length > MAX_ATTENDEES) return { ok: false, error: `At most ${MAX_ATTENDEES} attendees.` };
  const keys: string[] = [];
  const names: string[] = [];
  const guests: string[] = [];
  for (const w of wanted) {
    const r = resolvePerson(w, boot.people);
    if ("error" in r) return { ok: false, error: r.error };
    if ("guest" in r) {
      if (!guests.includes(r.guest)) guests.push(r.guest);
    } else if (r.key !== boot.me && !keys.includes(r.key)) {
      keys.push(r.key);
      names.push(r.name);
    }
  }

  let room: Room | null = null;
  const roomRaw = String(args.room ?? "").trim();
  if (roomRaw) {
    const r = resolveRoom(roomRaw, boot.rooms);
    if ("error" in r) return { ok: false, error: r.error };
    room = r;
  }
  const warnings: string[] = [];
  const headcount = 1 + keys.length + guests.length;
  if (room && room.seats > 0 && room.seats < headcount) warnings.push(`${room.name} seats ${room.seats}, but ${headcount} people are invited.`);

  const body: MeetingBody = {
    title,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    roomId: room ? room.id : null,
    organizer: boot.me,
    attendees: keys,
    videoType: "none",
    videoUrl: "",
    notes,
    guestEmails: guests,
    reminders: [{ min: 15, ch: ["erp", "email"] }],
    repeat: "none",
    repeatUntil: null,
  };
  const who = [...names, ...guests];
  const summary =
    `Book a meeting "${title}" on ${fmtMy(start)} to ${myDay(start) === myDay(end) ? fmtMy(end).split(", ").pop() : fmtMy(end)} (Malaysia time)` +
    `${room ? ` in ${room.name}` : " with no room"}` +
    `${who.length ? `, inviting ${who.join(", ")}` : ", with nobody else invited"}.` +
    `${guests.length ? " Outside guests get an email invitation." : ""}` +
    `${notes ? ` Notes: ${cut(notes, 200)}` : ""}`;
  return { ok: true, body, summary, target: actionTarget("meeting", body), warnings };
}

/** Early warnings from the calendar: the room or an invitee is already in a meeting then. */
export function meetingBusyWarnings(body: MeetingBody, calendar: unknown, people: Person[]): string[] {
  const s = Date.parse(body.start);
  const e = Date.parse(body.end);
  const out: string[] = [];
  const name = (k: string) => people.find((p) => p.key === k)?.name ?? k;
  const invited = new Set([body.organizer, ...body.attendees]);
  for (const m of arr(obj(calendar).meetings)) {
    const ms = Date.parse(String(m.start ?? ""));
    const me = Date.parse(String(m.end ?? ""));
    if (!(ms < e && me > s)) continue;
    const t = String(m.title ?? "a meeting");
    if (body.roomId !== null && Number(m.roomId) === body.roomId) out.push(`The room is already booked for "${t}" then.`);
    const inMeeting = [String(m.organizer ?? ""), ...(Array.isArray(m.attendees) ? (m.attendees as unknown[]).map(String) : [])];
    for (const k of inMeeting) if (invited.has(k)) out.push(`${name(k)} is in "${t}" then.`);
  }
  return [...new Set(out)].slice(0, 8);
}

// ── pure: email ─────────────────────────────────────────────────────────────

export type EmailBody = { fromAddress: string; to: string[]; cc: string[]; subject: string; text: string };
type Mailbox = { address: string; active: boolean; assignedUserId: string };

/** GET /api/mail-center/addresses (already scoped to the person) → mailboxes. */
export function readMailboxes(body: unknown): Mailbox[] {
  const rows = Array.isArray(body) ? body : arr(obj(body).data);
  return (rows as unknown[]).map(obj).map((r) => ({
    address: String(r.address ?? "").toLowerCase(),
    active: r.active !== false,
    assignedUserId: String(r.assignedUserId ?? r.assigned_user_id ?? ""),
  })).filter((m) => m.address);
}

/** Same rules as the Mail Center compose route (recipientsError) plus size caps. */
export function buildEmailProposal(args: Obj, mailboxes: Mailbox[], userId: string): Proposal<EmailBody> {
  const to = parseAddressList(strList(args.to));
  const cc = parseAddressList(strList(args.cc));
  if (to.length === 0) return { ok: false, error: "Give at least one recipient (to)." };
  if (to.length + cc.length > MAX_RECIPIENTS) return { ok: false, error: `At most ${MAX_RECIPIENTS} recipients.` };
  const bad = invalidAddresses([...to, ...cc]);
  if (bad.length) return { ok: false, error: `Not a valid email address: ${bad[0]}` };
  const dup = to.find((a) => cc.includes(a));
  if (dup) return { ok: false, error: `${dup} is listed in both to and cc.` };
  const subject = String(args.subject ?? "").trim();
  if (!subject) return { ok: false, error: "Give the email a subject." };
  if (subject.length > MAX_SUBJECT) return { ok: false, error: `The subject is too long (at most ${MAX_SUBJECT} characters).` };
  const text = String(args.body ?? "").trim();
  if (!text) return { ok: false, error: "Write the email's message." };
  if (text.length > MAX_BODY) return { ok: false, error: `The message is too long (at most ${MAX_BODY} characters).` };

  const live = mailboxes.filter((m) => m.active);
  if (live.length === 0) return { ok: false, error: "You have no Mail Center mailbox to send from. Ask your admin to give you one." };
  const asked = String(args.from_mailbox ?? args.fromMailbox ?? "").trim().toLowerCase();
  let from: Mailbox | undefined;
  if (asked) {
    from = live.find((m) => m.address === asked);
    if (!from) return { ok: false, error: `You may not send from ${asked}. You can send from: ${live.map((m) => m.address).join(", ")}.` };
  } else {
    const mine = live.filter((m) => m.assignedUserId === userId);
    from = mine.length === 1 ? mine[0] : live.length === 1 ? live[0] : undefined;
    if (!from) return { ok: false, error: `Say which mailbox to send from (from_mailbox): ${live.map((m) => m.address).join(", ")}.` };
  }
  const body: EmailBody = { fromAddress: from.address, to, cc, subject, text };
  const summary =
    `Send an email from ${from.address} to ${to.join(", ")}${cc.length ? `, cc ${cc.join(", ")}` : ""}.\n` +
    `Subject: ${subject}\n` +
    `Message:\n${cut(text, 1500)}`;
  // The log line names who and what about — never the body.
  return { ok: true, body, summary, target: actionTarget("email", body), warnings: [] };
}

// ── pure: outcome ───────────────────────────────────────────────────────────

/** What the ERP's own route answered, in plain words. */
export function describeOutcome(kind: ActionKind, status: number, body: unknown): { ok: boolean; text: string } {
  const b = obj(body);
  const err = typeof b.error === "string" ? b.error : "";
  if (kind === "meeting") {
    if (status >= 200 && status < 300) {
      const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(String) : [];
      return { ok: true, text: `Meeting booked${ids.length ? ` (meeting ${ids.join(", ")})` : ""}. Invitations go out from the ERP as usual.` };
    }
    if (status === 409) {
      const c = obj(b.conflict);
      const room = obj(c.room);
      const busy = arr(c.people).map((p) => `${String(p.key ?? "")} is in "${String(obj(p.meeting).title ?? "a meeting")}"`);
      const rules = Array.isArray(c.rules) ? (c.rules as unknown[]).map(String) : [];
      const parts = [room.title ? `the room is taken by "${String(room.title)}"` : "", ...busy, ...rules].filter(Boolean);
      const sugg = typeof b.suggestTime === "string" && b.suggestTime ? ` The next free time is ${fmtMy(Date.parse(b.suggestTime))}.` : "";
      return { ok: false, text: `Not booked — it clashes: ${parts.join("; ") || "another booking"}.${sugg} Propose a new time to try again.` };
    }
    return { ok: false, text: `Not booked — Meetings answered: ${err || `HTTP ${status}`}.` };
  }
  if (status >= 200 && status < 300) return { ok: true, text: "Email sent. It is in Mail Center under Sent, like any email you send." };
  return { ok: false, text: `Not sent — Mail Center answered: ${err || `HTTP ${status}`}.` };
}

/** The call-log line for an action: kind + who / what about. Never an email body. */
export function actionTarget(kind: ActionKind, payload: unknown): string {
  const p = obj(payload);
  if (kind === "meeting") return `meeting: ${cut(String(p.title ?? ""), 60)} @ ${String(p.start ?? "").slice(0, 16)}`;
  const to = Array.isArray(p.to) ? (p.to as unknown[]).map(String).join(", ") : "";
  return `email: to ${cut(to, 80)} — ${cut(String(p.subject ?? ""), 60)}`;
}
