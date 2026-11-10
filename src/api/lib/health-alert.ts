// ---------------------------------------------------------------------------
// health-alert.ts — email management when System Health turns red.
//
// Cross-system review P4, ported from Conts#420 / #424. Rides the 5-minute
// email-outbox drain (POST /api/internal/process-email-outbox), so it needs no
// cron of its own, and enqueues into the same outbox the drain then sends.
//
// The verdict is the System Health page's own banner (measureHealthBanner in
// routes/admin-health.ts -> computeHealthStatus in src/lib/health-status.ts),
// over the page's default 24 h window. Rules:
//   - red on TWO checks in a row (about 10 minutes) before anyone is told —
//     one slow minute is not an incident;
//   - one email per problem, however long it stays red;
//   - one "working again" email when it leaves red, only if the alert went out;
//   - no live metrics (Analytics Engine not wired, a query failed, mock data):
//     nothing changes and nothing is sent.
//
// Recipients: kv_config['health_alert_recipients'] (JSON array, {value:[…]} or
// comma-separated), else the owner-set kv_config['daily_report_recipients']
// (the management list the morning brief goes to). Never the SUPER_ADMIN
// fallback, never an env default: with neither key set, nothing is sent.
// State: kv_config['health_alert_state'], so an incident is announced once
// whichever isolate measured it.
// ---------------------------------------------------------------------------

export const HEALTH_ALERT_RECIPIENTS_KEY = "health_alert_recipients";
export const HEALTH_ALERT_FALLBACK_RECIPIENTS_KEY = "daily_report_recipients";
export const HEALTH_ALERT_STATE_KEY = "health_alert_state";
export const CHECKS_BEFORE_ALERT = 2;

export interface HealthAlertState {
  red: boolean;
  checks: number;
  since: string;
  alerted: boolean;
  detail?: string;
}

/** What one more check does to the state, and what to send. Pure. */
export function stepHealthAlert(
  prev: HealthAlertState | null,
  red: boolean,
  nowIso: string,
  detail = "",
): { next: HealthAlertState; send: "alert" | "recovered" | null } {
  if (red) {
    const checks = prev?.red ? prev.checks + 1 : 1;
    const since = prev?.red ? prev.since : nowIso;
    const alerted = prev?.red ? prev.alerted : false;
    const due = !alerted && checks >= CHECKS_BEFORE_ALERT;
    return { next: { red: true, checks, since, alerted: alerted || due, detail }, send: due ? "alert" : null };
  }
  return {
    next: { red: false, checks: 0, since: prev?.red ? nowIso : prev?.since ?? nowIso, alerted: false },
    send: prev?.red && prev.alerted ? "recovered" : null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every shape a kv_config list can hold (see routes/reports.ts resolveRecipients). */
export function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  let list: string[];
  try {
    const parsed = JSON.parse(raw);
    const inner =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && "value" in parsed
        ? (parsed as { value: unknown }).value
        : parsed;
    list = Array.isArray(inner) ? inner.map((x) => String(x)) : String(inner ?? "").split(/[,\n;]/);
  } catch {
    list = raw.split(/[,\n;]/);
  }
  return [...new Set(list.map((s) => s.trim()).filter((s) => EMAIL_RE.test(s)))];
}

/** "10/11 07:35" in Malaysia time. */
export function mytStamp(iso: string): string {
  const t = new Date(Date.parse(iso) + 8 * 3600_000).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function healthAlertEmail(
  kind: "alert" | "recovered",
  state: { since: string; detail?: string },
  nowIso: string,
  pageUrl: string,
): { subject: string; text: string; html: string } {
  const subject =
    kind === "alert" ? "Hookka ERP: System Health is red" : "Hookka ERP: System Health is working again";
  const lines =
    kind === "alert"
      ? [
          `System Health has been red on two checks in a row, since ${mytStamp(state.since)} (Malaysia time).`,
          state.detail ? `What is wrong: ${state.detail}.` : "",
          `See ${pageUrl}`,
          "You get one email per problem, and another when it is working again.",
        ]
      : [
          `System Health is back to normal at ${mytStamp(nowIso)} (Malaysia time), after it turned red at ${mytStamp(state.since)}.`,
          `See ${pageUrl}`,
        ];
  const text = lines.filter(Boolean).join("\n\n");
  const html = lines
    .filter(Boolean)
    .map((l) => `<p>${esc(l).replace(esc(pageUrl), `<a href="${esc(pageUrl)}">${esc(pageUrl)}</a>`)}</p>`)
    .join("");
  return { subject, text, html };
}

type Db = {
  prepare: (sql: string) => {
    bind: (...v: unknown[]) => {
      first: <T>() => Promise<T | null>;
      run: () => Promise<unknown>;
    };
  };
};

export interface HealthAlertDeps {
  db: Db;
  /** The page's banner, measured now (measureHealthBanner). */
  measure: () => Promise<{ live: true; status: { tone: string; detail: string } } | { live: false; reason: string }>;
  /** Queue one email (enqueueEmail in production; a recorder in tests). */
  send: (to: string, mail: { subject: string; text: string; html: string }) => Promise<void>;
  pageUrl: string;
  now?: () => string;
}

async function kvGet(db: Db, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/** One check. Never throws — the drain it rides on must still run. */
export async function runHealthAlertCheck(deps: HealthAlertDeps): Promise<{
  checked: boolean;
  red?: boolean;
  sent?: "alert" | "recovered" | null;
  recipients?: number;
  reason?: string;
}> {
  try {
    const m = await deps.measure();
    if (!m.live) return { checked: false, reason: m.reason };
    const nowIso = (deps.now ?? (() => new Date().toISOString()))();
    const red = m.status.tone === "red";

    let prev: HealthAlertState | null = null;
    try {
      prev = JSON.parse((await kvGet(deps.db, HEALTH_ALERT_STATE_KEY)) ?? "null") as HealthAlertState | null;
    } catch {
      prev = null; // unreadable state starts afresh
    }
    const { next, send } = stepHealthAlert(prev, red, nowIso, m.status.detail);

    let recipients: string[] = [];
    if (send) {
      recipients = parseRecipientList(await kvGet(deps.db, HEALTH_ALERT_RECIPIENTS_KEY));
      if (!recipients.length) {
        recipients = parseRecipientList(await kvGet(deps.db, HEALTH_ALERT_FALLBACK_RECIPIENTS_KEY));
      }
      const mail = healthAlertEmail(send, send === "alert" ? next : (prev as HealthAlertState), nowIso, deps.pageUrl);
      for (const to of recipients) await deps.send(to, mail);
    }

    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      await deps.db
        .prepare(
          `INSERT INTO kv_config (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(HEALTH_ALERT_STATE_KEY, JSON.stringify(next), nowIso)
        .run();
    }
    return { checked: true, red, sent: send, recipients: recipients.length };
  } catch (e) {
    console.error("[health-alert] check failed:", e instanceof Error ? e.message : e);
    return { checked: false, reason: "check failed" };
  }
}
