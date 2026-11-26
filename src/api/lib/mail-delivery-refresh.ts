// ---------------------------------------------------------------------------
// Mail Center delivery refresh (Houzs parity row 20) — asks the provider what
// happened to recent outbound replies and new emails, stores Delivered /
// Bounced on the message, and puts a bell notice in front of the sender when
// one bounced. No dashboard webhook to set up: it polls by the id the provider
// returned when we sent (Brevo transactional events API by messageId, or
// Resend GET /emails/:id). The pure rules are in lib/mail-delivery.ts.
//
// Pages has no scheduler of its own, so this runs from traffic like
// lib/meeting-mail.ts: mailMaintenanceSoon() is called by the Mail Center's
// waiting-count poll (once a minute per open tab) and runs at most once a
// minute per instance, after the answer has gone. The 5-minute GitHub tick
// (POST /api/internal/process-email-outbox) runs it too. Each run is bounded:
// at most DELIVERY_REFRESH_LIMIT messages, only those sent in the last 3 days
// that have no final status yet.
// ---------------------------------------------------------------------------
import {
  DELIVERY_WINDOW_MS,
  providerOf,
  recipientCount,
  statusFromBrevoEvents,
  statusFromResendEvent,
  type BrevoEvent,
  type StoredDeliveryStatus,
} from "./mail-delivery";
import { memoizeSelfApply, runSelfApply } from "./self-apply";

export const DELIVERY_REFRESH_LIMIT = 20;
const MAINTENANCE_EVERY_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

type DeliveryEnv = { RESEND_API_KEY?: string; BREVO_API_KEY?: string };
type Db = D1Database;

// ---------------------------------------------------------------------------
// Schema for the parity features (delivery + reply guard). Runtime self-apply:
// migrations are inert on deploy (CLAUDE.md). Mirrors
// migrations-postgres/0260_mail_center_parity.sql.
// ---------------------------------------------------------------------------
let paritySchema: Promise<void> | null = null;
export const MAIL_PARITY_DDL = [
  `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS outbox_id TEXT`,
  `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS delivery_status TEXT`,
  `ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS delivery_status_at TEXT`,
  `CREATE INDEX IF NOT EXISTS ix_email_messages_outbound_recent
     ON email_messages (direction, created_at)`,
  `CREATE TABLE IF NOT EXISTS mail_thread_replying (
     org_id TEXT NOT NULL DEFAULT 'hookka',
     thread_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     user_name TEXT,
     beat_at TEXT NOT NULL,
     PRIMARY KEY (thread_id, user_id)
   )`,
];
export const ensureMailParitySchema = (db: Db): Promise<void> =>
  memoizeSelfApply(
    () => paritySchema,
    (p) => {
      paritySchema = p;
    },
    () => runSelfApply(db, "mail-center.parity", MAIL_PARITY_DDL),
  );

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown | undefined> {
  const ctl = new AbortController();
  // eslint-disable-next-line no-restricted-syntax -- server-side fetch timeout in a Worker, not React
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) return undefined;
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The provider's answer for one sent mail: a final status, null when it is
 * still on its way, undefined when the provider could not be asked.
 */
export async function fetchDeliveryStatus(
  env: DeliveryEnv,
  providerId: string,
  recipients: number,
): Promise<StoredDeliveryStatus | null | undefined> {
  if (providerOf(providerId) === "brevo") {
    if (!env.BREVO_API_KEY) return undefined;
    const url =
      "https://api.brevo.com/v3/smtp/statistics/events?limit=100&days=4&messageId=" +
      encodeURIComponent(providerId);
    const body = (await fetchJson(url, { "api-key": env.BREVO_API_KEY, Accept: "application/json" })) as
      | { events?: BrevoEvent[] }
      | undefined;
    if (!body) return undefined;
    return statusFromBrevoEvents(body.events ?? [], recipients);
  }
  if (!env.RESEND_API_KEY) return undefined;
  const body = (await fetchJson(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
  })) as { last_event?: string } | undefined;
  if (!body) return undefined;
  return statusFromResendEvent(body.last_event);
}

interface PendingRow {
  id: string;
  orgId: string | null;
  threadId: string | null;
  providerId: string | null;
  subject: string | null;
  toAddresses: string | null;
  ccAddresses: string | null;
  bccAddresses: string | null;
  sentByUserId: string | null;
}

export interface DeliveryRefreshRun {
  checked: number;
  changed: number;
  bounced: number;
  unreachable: number;
}

function recipientsLabel(toJson: string | null): string {
  try {
    const v: unknown = JSON.parse(toJson ?? "[]");
    return Array.isArray(v) ? v.map(String).join(", ") : "";
  } catch {
    return "";
  }
}

/** Bell notice to whoever sent the mail. One per message (id is deterministic). */
async function noticeBounce(db: Db, row: PendingRow, nowIso: string): Promise<void> {
  if (!row.sentByUserId) return;
  try {
    const { ensureNotificationsUserColumn } = await import("../routes/it-support");
    await ensureNotificationsUserColumn(db);
    const subject = (row.subject ?? "").trim() || "(no subject)";
    const to = recipientsLabel(row.toAddresses);
    await db
      .prepare(
        `INSERT INTO notifications (id, type, title, message, severity, is_read, link, created_at, org_id, user_id)
         VALUES (?, 'SYSTEM', ?, ?, 'WARNING', 0, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      )
      .bind(
        `mail-bounce-${row.id}`,
        `Email bounced: ${subject}`.slice(0, 200),
        `Your email${to ? ` to ${to}` : ""} could not be delivered. Check the address in Mail Center and send it again.`,
        row.threadId ? `/mail-center/${row.threadId}` : "/mail-center",
        nowIso,
        row.orgId || "hookka",
        row.sentByUserId,
      )
      .run();
  } catch (e) {
    console.warn("[mail-delivery] bounce notice failed:", e instanceof Error ? e.message : String(e));
  }
}

/** Ask the provider about up to `limit` recent outbound messages with no final status. */
export async function refreshOutboundDelivery(
  db: Db,
  env: DeliveryEnv,
  limit: number,
  nowMs: number,
): Promise<DeliveryRefreshRun> {
  const run: DeliveryRefreshRun = { checked: 0, changed: 0, bounced: 0, unreachable: 0 };
  if (!env.BREVO_API_KEY && !env.RESEND_API_KEY) return run;
  await ensureMailParitySchema(db);
  const res = await db
    .prepare(
      `SELECT id,
              org_id              AS "orgId",
              thread_id           AS "threadId",
              provider_message_id AS "providerId",
              subject,
              to_addresses        AS "toAddresses",
              cc_addresses        AS "ccAddresses",
              bcc_addresses       AS "bccAddresses",
              sent_by_user_id     AS "sentByUserId"
         FROM email_messages
        WHERE direction = 'outbound' AND created_at >= ?
          AND provider_message_id IS NOT NULL AND provider_message_id <> ''
          AND delivery_status IS NULL
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(new Date(nowMs - DELIVERY_WINDOW_MS).toISOString(), limit)
    .all<PendingRow>();
  const nowIso = new Date(nowMs).toISOString();
  // One provider call per message is the point of the loop; each is bounded by
  // FETCH_TIMEOUT_MS and the whole run by `limit`.
  for (const row of res.results ?? []) {
    if (!row.providerId) continue;
    run.checked++;
    const status = await fetchDeliveryStatus(
      env,
      row.providerId,
      recipientCount(row.toAddresses, row.ccAddresses, row.bccAddresses),
    );
    if (status === undefined) {
      run.unreachable++;
      continue;
    }
    if (status === null) continue;
    const upd = await db
      .prepare(
        `UPDATE email_messages SET delivery_status = ?, delivery_status_at = ?
          WHERE id = ? AND delivery_status IS NULL`,
      )
      .bind(status, nowIso, row.id)
      .run();
    // Two instances may refresh the same row; only the one that wrote it rings the bell.
    if (((upd as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1) === 0) continue;
    run.changed++;
    if (status === "bounced") {
      run.bounced++;
      await noticeBounce(db, row, nowIso);
    }
  }
  return run;
}

let lastMaintenance = 0;

/**
 * Retry queued Mail Center sends and refresh delivery status, after the
 * response has gone; at most once a minute per instance.
 */
export function mailMaintenanceSoon(c: {
  env: unknown;
  var: { DB: Db };
  executionCtx: { waitUntil(p: Promise<unknown>): void };
}): void {
  const now = Date.now();
  if (now - lastMaintenance < MAINTENANCE_EVERY_MS) return;
  lastMaintenance = now;
  const env = c.env as DeliveryEnv & { RESEND_FROM_EMAIL?: string };
  const db = c.var.DB;
  const run = (async () => {
    const { processOutbox } = await import("./email-outbox");
    await processOutbox(db, env).catch((e: unknown) =>
      console.warn("[mail-maintenance] outbox drain:", e instanceof Error ? e.message : String(e)),
    );
    await refreshOutboundDelivery(db, env, DELIVERY_REFRESH_LIMIT, Date.now()).catch((e: unknown) =>
      console.warn("[mail-maintenance] delivery refresh:", e instanceof Error ? e.message : String(e)),
    );
  })();
  try {
    c.executionCtx.waitUntil(run);
  } catch {
    // No execution context (tests): the run above carries on by itself.
  }
}
