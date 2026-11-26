// Meeting emails through Hookka's Mail Center (owner 2026-11-25).
//
// The Houzs IT Hub writes every meeting email (invitation, change, cancellation, reminder, guest booking). This
// collects the ones for meetings made in Hookka ERP with the hub key, sends them with sendMail (Hookka's own
// provider, Brevo or Resend, from hookka.com), and tells the hub what happened; the organiser sees it in the
// meeting detail. Pages has no cron, so it runs by itself from traffic (routes/meetings.ts): right after a booking,
// change or cancellation, and at most once a minute from the unread badge every signed-in page polls, which is
// what carries the reminders.
//
// The hub hands each email out once (locked, with a 10-minute lease) and offers a failed one again, up to 5 tries.
import { sendMail } from "./email";

export type HubMail = { id: number; from: string; to: string[]; subject: string; html: string; text: string };
/** Send one email; null when it went, else the reason it did not. */
export type SendOne = (m: HubMail) => Promise<string | null>;
type MailEnv = { IT_HUB_URL?: string; IT_HUB_API_KEY?: string; RESEND_API_KEY?: string; BREVO_API_KEY?: string };

const HUB_TIMEOUT_MS = 20_000;
const BADGE_EVERY_MS = 60_000;
let lastBadgeRun = 0;

/** Collect the waiting emails from the hub, send each, and report the results. */
export async function collectAndSend(base: string, key: string, send: SendOne): Promise<{ sent: number; failed: number }> {
  const call = (path: string, body: unknown) =>
    fetch(`${base}/api/v1/sys/meetings${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "X-Reporter-Id": "mail", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
    });
  const res = await call("/mail/claim", {});
  if (!res.ok) throw new Error(`the hub answered ${res.status}`);
  const mail = ((await res.json()) as { mail?: HubMail[] }).mail ?? [];
  const results: { id: number; error: string | null }[] = [];
  for (const m of mail) {
    let error: string | null;
    try {
      error = await send(m);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    results.push({ id: m.id, error });
  }
  if (results.length) {
    const done = await call("/mail/results", { results });
    if (!done.ok) throw new Error(`the hub did not take the results (${done.status})`);
  }
  return { sent: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length };
}

/** Hookka's waiting meeting emails; nothing when meetings is not connected. */
export async function sendMeetingMail(env: MailEnv): Promise<{ sent: number; failed: number }> {
  const base = (env.IT_HUB_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.IT_HUB_API_KEY ?? "").trim();
  if (!base || !key) return { sent: 0, failed: 0 };
  return collectAndSend(base, key, async (m) => {
    const r = await sendMail(env, m.from, { to: m.to, subject: m.subject, html: m.html, text: m.text });
    return r.ok ? null : r.error ?? "not sent";
  });
}

/** Run it after the answer has gone. `badge`: the unread poll, at most once a minute per instance. */
export function mailSoon(c: { env: MailEnv; executionCtx: { waitUntil(p: Promise<unknown>): void } }, badge: boolean): void {
  if (badge) {
    const now = Date.now();
    if (now - lastBadgeRun < BADGE_EVERY_MS) return;
    lastBadgeRun = now;
  }
  const run = sendMeetingMail(c.env).catch((e) => console.warn("[meetings] mail:", e instanceof Error ? e.message : String(e)));
  try {
    c.executionCtx.waitUntil(run);
  } catch {
    // No execution context (tests): the run above carries on by itself.
  }
}
