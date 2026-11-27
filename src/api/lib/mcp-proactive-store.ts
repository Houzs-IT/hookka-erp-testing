// ---------------------------------------------------------------------------
// mcp-proactive-store.ts — storage for AI Connector round 4d (morning brief +
// urgent alerts). Pure logic lives in mcp-proactive.ts.
//
//   mcp_brief_subscriptions  one row per person who opted in (or opted out
//                            again): brief on/off, time (HH:MM Malaysia),
//                            weekdays/daily, alerts on/off, the random token
//                            in the email's unsubscribe link, last alert check.
//   mcp_proactive_keys       the debounce / idempotency ledger: one row per
//                            person + key + Malaysia day. "brief" is a key too,
//                            so a second tick on the same day cannot send a
//                            second brief (INSERT … ON CONFLICT DO NOTHING
//                            RETURNING = the claim).
//   mcp_proactive_sends      the send log — who, what kind, how many items,
//                            the outbox row id, status. NEVER the body.
//
// Tables self-apply (CREATE TABLE IF NOT EXISTS), snake_case, awaited before
// the first read/write — migrations do not auto-apply on deploy.
// ---------------------------------------------------------------------------
import { memoizeSelfApply } from "./self-apply";
import { randomToken } from "./mcp-store";
import { subscriptionFromRow, type Subscription } from "./mcp-proactive";

type Db = D1Database;

let _ready: Promise<void> | null = null;

export function ensureProactiveTables(db: Db): Promise<void> {
  return memoizeSelfApply(() => _ready, (p) => { _ready = p; }, async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS mcp_brief_subscriptions (
         user_id             TEXT PRIMARY KEY,
         brief_enabled       INTEGER NOT NULL DEFAULT 0,
         brief_time          TEXT NOT NULL DEFAULT '08:00',
         brief_days          TEXT NOT NULL DEFAULT 'weekdays',
         alerts_enabled      INTEGER NOT NULL DEFAULT 0,
         unsub_token         TEXT NOT NULL,
         last_alert_check_at TEXT,
         created_at          TEXT NOT NULL,
         updated_at          TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS mcp_proactive_keys (
         user_id    TEXT NOT NULL,
         alert_key  TEXT NOT NULL,
         day        TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (user_id, alert_key, day)
       )`,
      `CREATE INDEX IF NOT EXISTS mcp_proactive_keys_day_idx ON mcp_proactive_keys (user_id, day)`,
      `CREATE TABLE IF NOT EXISTS mcp_proactive_sends (
         id         TEXT PRIMARY KEY,
         user_id    TEXT NOT NULL,
         kind       TEXT NOT NULL,
         day        TEXT NOT NULL,
         items      INTEGER,
         outbox_id  TEXT,
         status     TEXT NOT NULL,
         note       TEXT,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS mcp_proactive_sends_user_idx ON mcp_proactive_sends (user_id, created_at)`,
    ];
    for (const s of stmts) await db.prepare(s).run();
  });
}

export function _resetProactiveStoreForTests(): void {
  _ready = null;
}

const s = (r: Record<string, unknown>, ...k: string[]): string => {
  for (const x of k) if (r[x] !== undefined && r[x] !== null) return String(r[x]);
  return "";
};

// ── subscriptions ───────────────────────────────────────────────────────────

export async function getSubscription(db: Db, userId: string): Promise<Subscription | null> {
  await ensureProactiveTables(db);
  const r = await db.prepare("SELECT * FROM mcp_brief_subscriptions WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();
  return r ? subscriptionFromRow(r) : null;
}

/** Insert or update; the unsubscribe token is made once and kept. */
export async function saveSubscription(db: Db, sub: Subscription): Promise<void> {
  await ensureProactiveTables(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO mcp_brief_subscriptions (user_id, brief_enabled, brief_time, brief_days, alerts_enabled, unsub_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET brief_enabled = excluded.brief_enabled, brief_time = excluded.brief_time,
         brief_days = excluded.brief_days, alerts_enabled = excluded.alerts_enabled, updated_at = excluded.updated_at`,
    )
    .bind(sub.userId, sub.briefEnabled ? 1 : 0, sub.briefTime, sub.briefDays, sub.alertsEnabled ? 1 : 0, randomToken(24), now, now)
    .run();
}

/** The token in this person's unsubscribe link (made on first save). */
export async function unsubscribeToken(db: Db, userId: string): Promise<string> {
  await ensureProactiveTables(db);
  const r = await db.prepare("SELECT unsub_token FROM mcp_brief_subscriptions WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();
  return r ? s(r, "unsub_token", "unsubToken") : "";
}

/** A token can only ever be one of ours: base64url, the length randomToken(24) makes. */
export const UNSUB_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/**
 * The unsubscribe link: brief AND alerts off for whoever holds this token (the
 * token alone identifies the person — no user id in the link). Returns the
 * user id, or null for an unknown / malformed token.
 */
export async function unsubscribeWithToken(db: Db, token: string): Promise<string | null> {
  if (!UNSUB_TOKEN_RE.test(token)) return null;
  await ensureProactiveTables(db);
  const res = await db
    .prepare("UPDATE mcp_brief_subscriptions SET brief_enabled = 0, alerts_enabled = 0, updated_at = ? WHERE unsub_token = ? RETURNING user_id")
    .bind(new Date().toISOString(), token)
    .all<Record<string, unknown>>();
  const r = (res.results ?? [])[0];
  return r ? s(r, "user_id", "userId") : null;
}

/** Who already holds `key` for `day` — one query (e.g. who got today's brief). */
export async function usersWithKey(db: Db, key: string, day: string): Promise<Set<string>> {
  await ensureProactiveTables(db);
  const res = await db.prepare("SELECT user_id FROM mcp_proactive_keys WHERE alert_key = ? AND day = ?").bind(key, day).all<Record<string, unknown>>();
  return new Set((res.results ?? []).map((r) => s(r, "user_id", "userId")));
}

export type Subscriber = Subscription & { email: string; name: string; role: string; orgId: string | null; lastAlertCheckAt: string };

/**
 * Everyone opted in to anything, with their account — ONE query. Only active
 * accounts with an email and AI Connector access (approved, or Super Admin).
 * The tick picks who is due from this list (mcp-proactive.ts isBriefDue).
 */
export async function activeSubscribers(db: Db): Promise<Subscriber[]> {
  await ensureProactiveTables(db);
  const res = await db
    .prepare(
      `SELECT b.*, u.email AS email, u.displayName AS display_name, u.role AS role, u.orgId AS org_id
         FROM mcp_brief_subscriptions b
         JOIN users u ON u.id = b.user_id
         LEFT JOIN mcp_access a ON a.user_id = b.user_id
        WHERE (b.brief_enabled = 1 OR b.alerts_enabled = 1)
          AND u.isActive = 1
          AND (a.user_id IS NOT NULL OR UPPER(u.role) = 'SUPER_ADMIN')`,
    )
    .bind()
    .all<Record<string, unknown>>();
  return (res.results ?? [])
    .map((r) => ({
      ...subscriptionFromRow(r),
      email: s(r, "email").trim(),
      name: s(r, "display_name", "displayName", "displayname").trim() || s(r, "email"),
      role: s(r, "role").toUpperCase(),
      orgId: s(r, "org_id", "orgId", "orgid") || null,
      lastAlertCheckAt: s(r, "last_alert_check_at", "lastAlertCheckAt"),
    }))
    .filter((x) => x.email.includes("@"));
}

export async function markAlertChecked(db: Db, userId: string): Promise<void> {
  await db.prepare("UPDATE mcp_brief_subscriptions SET last_alert_check_at = ? WHERE user_id = ?").bind(new Date().toISOString(), userId).run();
}

// ── the debounce / idempotency ledger ───────────────────────────────────────

/** key → the latest day it was sent to this person, for these keys, since `sinceDay`. One query. */
export async function sentKeys(db: Db, userId: string, keys: string[], sinceDay: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  await ensureProactiveTables(db);
  const uniq = [...new Set(keys)];
  const res = await db
    .prepare(`SELECT alert_key, MAX(day) AS day FROM mcp_proactive_keys WHERE user_id = ? AND day >= ? AND alert_key IN (${uniq.map(() => "?").join(",")}) GROUP BY alert_key`)
    .bind(userId, sinceDay, ...uniq)
    .all<Record<string, unknown>>();
  for (const r of res.results ?? []) out.set(s(r, "alert_key", "alertKey"), s(r, "day"));
  return out;
}

/**
 * Claim keys for today: returns only the keys THIS call inserted. A key already
 * claimed today (another tick, a retry) comes back missing, so it is not sent
 * twice. One statement.
 */
export async function claimKeys(db: Db, userId: string, keys: string[], day: string): Promise<string[]> {
  const uniq = [...new Set(keys)];
  if (!uniq.length) return [];
  await ensureProactiveTables(db);
  const now = new Date().toISOString();
  const res = await db
    .prepare(
      `INSERT INTO mcp_proactive_keys (user_id, alert_key, day, created_at) VALUES ${uniq.map(() => "(?, ?, ?, ?)").join(", ")}
       ON CONFLICT (user_id, alert_key, day) DO NOTHING RETURNING alert_key`,
    )
    .bind(...uniq.flatMap((k) => [userId, k, day, now]))
    .all<Record<string, unknown>>();
  return (res.results ?? []).map((r) => s(r, "alert_key", "alertKey"));
}

/** Give a claim back (the brief could not be built — the next tick may retry today). */
export async function releaseKey(db: Db, userId: string, key: string, day: string): Promise<void> {
  await db.prepare("DELETE FROM mcp_proactive_keys WHERE user_id = ? AND alert_key = ? AND day = ?").bind(userId, key, day).run();
}

// ── the send log (never the body) ───────────────────────────────────────────

export type SendKind = "brief" | "brief_test" | "alert";

export async function logSend(db: Db, x: { userId: string; kind: SendKind; day: string; items: number; outboxId: string | null; status: "queued" | "failed" | "skipped"; note?: string }): Promise<void> {
  try {
    await ensureProactiveTables(db);
    await db
      .prepare("INSERT INTO mcp_proactive_sends (id, user_id, kind, day, items, outbox_id, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(`mcps_${randomToken(12)}`, x.userId, x.kind, x.day, x.items, x.outboxId, x.status, (x.note ?? "").slice(0, 200), new Date().toISOString())
      .run();
  } catch (e) {
    console.warn("[mcp-proactive] send log failed:", e instanceof Error ? e.message : String(e));
  }
}

export type SendRow = { at: string; kind: string; items: number; status: string; note: string };

export async function recentSends(db: Db, userId: string, limit = 10): Promise<SendRow[]> {
  await ensureProactiveTables(db);
  const res = await db
    .prepare("SELECT kind, items, status, note, created_at FROM mcp_proactive_sends WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, limit)
    .all<Record<string, unknown>>();
  return (res.results ?? []).map((r) => ({ at: s(r, "created_at", "createdAt"), kind: s(r, "kind"), items: Number(s(r, "items")) || 0, status: s(r, "status"), note: s(r, "note") }));
}
