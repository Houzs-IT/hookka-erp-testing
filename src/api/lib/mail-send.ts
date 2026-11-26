// ---------------------------------------------------------------------------
// Mail Center reliable sending (Houzs parity row 19, owner 2026-11-26).
//
// A reply or a new email is still sent straight away, on the request, when the
// provider answers. Only when that first try fails for a reason that may pass
// (a network error, a timeout, a 5xx, a rate limit) does the mail go into the
// existing outbox (lib/email-outbox.ts) as attempt 1 of 3. The drain retries
// it after the backoff (60 s, then 300 s) under the outbox's SENDING lease, so
// two drains can never deliver it twice. The thread shows "Queued, retrying"
// until it is sent, and "Not delivered" once the third try fails.
//
// A failure that cannot pass by retrying (no provider configured, or a 4xx
// such as an unverified sender or a malformed address) is answered as an error
// straight away, exactly as before: retrying it three times would only hide the
// real reason from the operator for six minutes.
// ---------------------------------------------------------------------------
import type { Context } from "hono";
import type { Env } from "../worker";
import { sendMail, type EmailAttachment } from "./email";
import { enqueueEmail } from "./email-outbox";

export type MailSendResult =
  | { status: "sent"; providerId: string | null }
  | { status: "queued"; outboxId: string; error: string }
  | { status: "error"; error: string };

/**
 * Whether a provider error is worth retrying. Errors from lib/email.ts look like
 * "502: <body>" for an HTTP answer, or a bare exception message for a network
 * failure. Config errors ("not configured") and 4xx answers other than 408/429
 * are permanent.
 */
export function isRetryableSendError(error: string | undefined | null): boolean {
  const e = String(error ?? "").trim();
  if (!e) return true;
  if (/not configured|no email provider|no recipient/i.test(e)) return false;
  const m = /^(\d{3}):/.exec(e);
  if (!m) return true; // no HTTP status: network / timeout / exception
  const code = Number(m[1]);
  if (code === 408 || code === 429) return true;
  return code >= 500;
}

export interface MailSendArgs {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  /** email_messages.id the caller will write; the drain stamps the provider id on it. */
  messageRowId: string;
}

/** Send now; on a passing failure queue it for retry instead of failing the request. */
export async function sendOrQueueMail(c: Context<Env>, args: MailSendArgs): Promise<MailSendResult> {
  const result = await sendMail(c.env, args.from, {
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    text: args.text,
    html: args.html,
    ...(args.headers ? { headers: args.headers } : {}),
    ...(args.attachments && args.attachments.length > 0 ? { attachments: args.attachments } : {}),
  });
  if (result.ok) return { status: "sent", providerId: result.id ?? null };
  const error = result.error || "send failed";
  if (!isRetryableSendError(error)) return { status: "error", error };
  try {
    const { id } = await enqueueEmail(c, {
      to: args.to.join(", "),
      subject: args.subject,
      html: args.html,
      text: args.text,
      attachments: args.attachments,
      envelope: {
        from: args.from,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        headers: args.headers,
        messageRowId: args.messageRowId,
      },
      firstAttemptError: error,
    });
    return { status: "queued", outboxId: id, error };
  } catch (e) {
    // The queue itself is down: say so rather than pretend it will retry.
    console.error("[mail-send] could not queue a failed send:", e);
    return { status: "error", error };
  }
}
