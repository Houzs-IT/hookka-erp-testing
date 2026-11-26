// ---------------------------------------------------------------------------
// Mail Center delivery status (Houzs parity row 20) — the PURE rules.
//
// Every outbound reply / new email ends in one of these, shown on the thread:
//   queued     the first try failed and the outbox is retrying it
//   failed     the outbox gave up after 3 tries, or the provider refused it
//   delivered  the receiving server accepted it (or it was opened / clicked)
//   bounced    the receiving server sent it back (wrong / full / blocked address)
//   null       sent, and no answer from the provider yet
//
// Hookka sends through Brevo when BREVO_API_KEY is set, otherwise Resend
// (lib/email.ts sendMail), so the provider is told apart by the id it handed
// back: Brevo's messageId is an RFC Message-ID ("<…@smtp-relay.mailin.fr>"),
// Resend's id is a bare UUID. The network side is lib/mail-delivery-refresh.ts.
// ---------------------------------------------------------------------------

export type DeliveryStatus = "queued" | "failed" | "delivered" | "bounced" | null;
export type StoredDeliveryStatus = "delivered" | "bounced" | "failed";
export type MailProvider = "brevo" | "resend";

/** Statuses that never change again, so the refresh stops asking. */
export const FINAL_DELIVERY_STATUSES: readonly StoredDeliveryStatus[] = ["delivered", "bounced", "failed"];

/** How long after sending the refresh keeps asking the provider. */
export const DELIVERY_WINDOW_MS = 3 * 86_400_000;

/** Which provider issued this id. */
export function providerOf(providerId: string): MailProvider {
  return providerId.includes("@") || providerId.trim().startsWith("<") ? "brevo" : "resend";
}

/**
 * What the thread shows for one outbound message. The outbox state wins while
 * the mail has not left yet; after that, the provider's answer.
 */
export function deliveryStatus(
  outboxStatus: string | null | undefined,
  stored: string | null | undefined,
): DeliveryStatus {
  const o = String(outboxStatus ?? "").toUpperCase();
  if (o === "PENDING" || o === "RETRYING" || o === "SENDING") return "queued";
  if (o === "FAILED") return "failed";
  const s = String(stored ?? "").toLowerCase();
  return (FINAL_DELIVERY_STATUSES as readonly string[]).includes(s) ? (s as StoredDeliveryStatus) : null;
}

// Resend GET /emails/:id → { last_event }.
const RESEND_ARRIVED = ["delivered", "opened", "clicked", "complained"];
const RESEND_NOT_SENT = ["failed", "canceled"];

/** Resend's last_event as our status; null while it is still on its way. */
export function statusFromResendEvent(lastEvent: string | null | undefined): StoredDeliveryStatus | null {
  const e = String(lastEvent ?? "").toLowerCase();
  if (e === "bounced") return "bounced";
  if (RESEND_NOT_SENT.includes(e)) return "failed";
  if (RESEND_ARRIVED.includes(e)) return "delivered";
  return null;
}

// Brevo GET /v3/smtp/statistics/events?messageId=… → { events: [{ email, event }] },
// one event per recipient per step. Names as Brevo spells them.
const BREVO_BOUNCED = ["bounces", "hardbounces", "softbounces", "blocked", "invalid"];
const BREVO_ARRIVED = ["delivered", "opened", "uniqueopened", "clicks", "loadedbyproxy", "spam"];
const BREVO_ERROR = ["error"];

export type BrevoEvent = { email?: string | null; event?: string | null };

/**
 * Brevo reports per recipient, so one mail to three people has three
 * "delivered" events. Bounced as soon as any recipient bounced (the sender
 * must look at it); delivered only once every recipient has arrived;
 * otherwise still waiting. `recipients` is the number of distinct To + Cc +
 * Bcc addresses (0 when unknown: then any arrival counts as delivered).
 */
export function statusFromBrevoEvents(events: BrevoEvent[], recipients: number): StoredDeliveryStatus | null {
  const arrived = new Set<string>();
  let bounced = false;
  let errored = false;
  for (const ev of events) {
    const name = String(ev.event ?? "").toLowerCase();
    const who = String(ev.email ?? "").trim().toLowerCase();
    if (BREVO_BOUNCED.includes(name)) bounced = true;
    else if (BREVO_ERROR.includes(name)) errored = true;
    else if (BREVO_ARRIVED.includes(name)) arrived.add(who || "?");
  }
  if (bounced) return "bounced";
  if (arrived.size > 0 && arrived.size >= Math.max(1, recipients)) return "delivered";
  if (errored && arrived.size === 0) return "failed";
  return null;
}

/** Distinct addresses across To / Cc / Bcc JSON arrays as stored on email_messages. */
export function recipientCount(...jsonLists: (string | null | undefined)[]): number {
  const seen = new Set<string>();
  for (const raw of jsonLists) {
    try {
      const v: unknown = JSON.parse(raw ?? "[]");
      if (Array.isArray(v)) for (const a of v) if (String(a).trim()) seen.add(String(a).trim().toLowerCase());
    } catch {
      /* a malformed list counts as none */
    }
  }
  return seen.size;
}
