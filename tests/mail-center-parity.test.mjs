// ---------------------------------------------------------------------------
// mail-center-parity.test.mjs — Mail Center works like Houzs (owner 2026-11-26).
//
// Pins the pure rules behind the four parity items:
//   row 19  reliable sending: which failures are queued, the outbox retry /
//           lease state machine, and the envelope a queued reply carries
//   row 20  delivery status: provider detection, Resend + Brevo event mapping,
//           what the thread shows
//   row 21  reply guard: when a colleague's reply blocks mine
//   row 13  auto-assign: what counts as unassigned
//   row 25  disabling a member closes their mailbox (source-level guard)
// No DB, no network.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type-stripping handles it on newer Node.
}

const outbox = await import("../src/api/lib/email-outbox.ts");
const send = await import("../src/api/lib/mail-send.ts");
const delivery = await import("../src/api/lib/mail-delivery.ts");
const guard = await import("../src/api/lib/mail-reply-guard.ts");
const fe = await import("../src/pages/mail-center/mail-delivery.ts");

const NOW = Date.parse("2026-11-26T10:00:00.000Z");
const ago = (s) => new Date(NOW - s * 1000).toISOString();

// ---- row 19: which failures are retried -----------------------------------
test("retry: network errors, timeouts, 5xx, 408 and 429 are queued", () => {
  for (const e of ["fetch failed", "The operation was aborted", "502: bad gateway", "503: {}", "429: slow down", "408: timeout", ""]) {
    assert.equal(send.isRetryableSendError(e), true, e);
  }
});

test("retry: config errors and other 4xx answer straight away", () => {
  for (const e of [
    "No email provider configured (BREVO_API_KEY or RESEND_API_KEY)",
    "BREVO_API_KEY not configured — email not sent",
    "no recipient",
    "400: sender not authenticated",
    "401: unauthorized",
    "422: invalid email",
  ]) {
    assert.equal(send.isRetryableSendError(e), false, e);
  }
});

// ---- row 19: the outbox state machine --------------------------------------
test("outbox: 3 tries in all — attempt 1 and 2 fail to RETRYING, attempt 3 to FAILED", () => {
  assert.equal(outbox.OUTBOX_MAX_ATTEMPTS, 3);
  assert.equal(outbox.outboxStatusAfterAttempt(1, false), "RETRYING");
  assert.equal(outbox.outboxStatusAfterAttempt(2, false), "RETRYING");
  assert.equal(outbox.outboxStatusAfterAttempt(3, false), "FAILED");
  assert.equal(outbox.outboxStatusAfterAttempt(2, true), "SENT");
});

test("outbox: a queued reply (RETRYING, attempt 1) waits 60 s, then 300 s after attempt 2", () => {
  const row = (attempts, secsAgo) => ({ status: "RETRYING", attempts, lastAttemptAt: ago(secsAgo) });
  assert.equal(outbox.outboxRowDue(row(1, 30), NOW), false);
  assert.equal(outbox.outboxRowDue(row(1, 60), NOW), true);
  assert.equal(outbox.outboxRowDue(row(2, 120), NOW), false);
  assert.equal(outbox.outboxRowDue(row(2, 300), NOW), true);
});

test("outbox lease: a SENDING row is untouchable for 5 minutes, then reclaimable", () => {
  const sending = (secsAgo) => ({ status: "SENDING", attempts: 1, lastAttemptAt: ago(secsAgo) });
  assert.equal(outbox.outboxRowDue(sending(10), NOW), false);
  assert.equal(outbox.outboxRowDue(sending(299), NOW), false);
  assert.equal(outbox.outboxRowDue(sending(300), NOW), true);
  assert.equal(outbox.outboxLeaseExpired(null, NOW), true);
  assert.equal(outbox.outboxRowDue({ status: "SENT", attempts: 1, lastAttemptAt: null }, NOW), false);
  assert.equal(outbox.outboxRowDue({ status: "FAILED", attempts: 3, lastAttemptAt: null }, NOW), false);
  assert.equal(outbox.outboxRowDue({ status: "PENDING", attempts: 0, lastAttemptAt: null }, NOW), true);
});

test("outbox envelope: a queued reply keeps its From, every recipient and the threading headers", () => {
  const env = {
    from: "Sales <sales@hookka.com>",
    to: ["a@x.com", "b@x.com"],
    cc: ["c@x.com"],
    bcc: ["d@x.com"],
    headers: { "Message-ID": "<m1@hookka.com>", "In-Reply-To": "<p@x.com>" },
    messageRowId: "row-1",
  };
  const raw = outbox.envelopePayload(env);
  // The Auto-sent log filters these rows out by this exact prefix.
  assert.ok(raw.startsWith('{"kind":"mail-center-send"'));
  assert.deepEqual(outbox.parseOutboxEnvelope(raw), env);
  // A system email's payload (or none) is not an envelope.
  assert.equal(outbox.parseOutboxEnvelope(JSON.stringify({ kind: "mail-ack-chase", ackId: "x" })), null);
  assert.equal(outbox.parseOutboxEnvelope(null), null);
  assert.equal(outbox.parseOutboxEnvelope("{not json"), null);
  // No recipients = not usable; the drain falls back to to_address.
  assert.equal(outbox.parseOutboxEnvelope(outbox.envelopePayload({ ...env, to: [] })), null);
});

test("the Auto-sent log filter matches the envelope prefix", () => {
  const src = readFileSync("src/api/routes/mail-center.ts", "utf8");
  assert.match(src, /NOT LIKE '\{"kind":"mail-center-send"%'/);
  assert.equal(outbox.MAIL_CENTER_SEND_KIND, "mail-center-send");
});

// ---- row 20: delivery status -----------------------------------------------
test("provider is told apart by the id it returned", () => {
  assert.equal(delivery.providerOf("<202611260958.12345@smtp-relay.mailin.fr>"), "brevo");
  assert.equal(delivery.providerOf("4ef9a417-02e9-4d39-ad75-9611e0fcc33c"), "resend");
});

test("the thread shows the outbox state first, then the provider's answer", () => {
  assert.equal(delivery.deliveryStatus("RETRYING", null), "queued");
  assert.equal(delivery.deliveryStatus("SENDING", null), "queued");
  assert.equal(delivery.deliveryStatus("PENDING", null), "queued");
  assert.equal(delivery.deliveryStatus("FAILED", null), "failed");
  assert.equal(delivery.deliveryStatus("SENT", "delivered"), "delivered");
  assert.equal(delivery.deliveryStatus(null, "bounced"), "bounced");
  assert.equal(delivery.deliveryStatus(null, null), null);
  assert.equal(delivery.deliveryStatus(null, "something-else"), null);
});

test("Resend last_event mapping", () => {
  assert.equal(delivery.statusFromResendEvent("delivered"), "delivered");
  assert.equal(delivery.statusFromResendEvent("opened"), "delivered");
  assert.equal(delivery.statusFromResendEvent("bounced"), "bounced");
  assert.equal(delivery.statusFromResendEvent("failed"), "failed");
  assert.equal(delivery.statusFromResendEvent("sent"), null);
  assert.equal(delivery.statusFromResendEvent("delivery_delayed"), null);
  assert.equal(delivery.statusFromResendEvent(undefined), null);
});

test("Brevo events: bounced if anyone bounced, delivered only once everyone arrived", () => {
  const ev = (email, event) => ({ email, event });
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "requests")], 1), null);
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "requests"), ev("a@x.com", "delivered")], 1), "delivered");
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "delivered")], 2), null);
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "delivered"), ev("B@x.com", "opened")], 2), "delivered");
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "delivered"), ev("b@x.com", "hardBounces")], 2), "bounced");
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "softBounces")], 1), "bounced");
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "blocked")], 1), "bounced");
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "error")], 1), "failed");
  assert.equal(delivery.statusFromBrevoEvents([ev("a@x.com", "deferred")], 1), null);
  assert.equal(delivery.statusFromBrevoEvents([], 0), null);
});

test("recipient count spans To + Cc + Bcc, de-duplicated", () => {
  assert.equal(delivery.recipientCount('["a@x.com","b@x.com"]', '["A@x.com"]', '["c@x.com"]'), 3);
  assert.equal(delivery.recipientCount(null, "bad json", undefined), 0);
});

test("operator wording matches Houzs", () => {
  assert.equal(fe.deliveryLabel("queued"), "Queued, retrying");
  assert.equal(fe.deliveryLabel("failed"), "Not delivered");
  assert.equal(fe.deliveryLabel("delivered"), "Delivered");
  assert.equal(fe.deliveryLabel("bounced"), "Bounced: check the address");
  assert.equal(fe.deliveryLabel(null), null);
  assert.equal(fe.deliveryTone("bounced"), "bad");
  assert.equal(fe.deliveryTone("delivered"), "good");
  assert.match(fe.sentToast(true, "Reply sent."), /queued/);
  assert.equal(fe.sentToast(false, "Reply sent."), "Reply sent.");
});

// ---- row 21: reply guard ---------------------------------------------------
const msgs = [
  { id: "m1", direction: "inbound", createdAt: "2026-11-26T09:00:00.000Z", fromName: "Customer" },
  { id: "m2", direction: "outbound", createdAt: "2026-11-26T09:05:00.000Z", sentByUserId: "u-ann", sentByName: "Ann" },
  { id: "m3", direction: "inbound", createdAt: "2026-11-26T09:10:00.000Z", fromName: "Customer" },
  { id: "m4", direction: "outbound", createdAt: "2026-11-26T09:12:00.000Z", sentByUserId: "u-bo", sentByName: "Bo" },
];

test("guard: a colleague replied after the newest message I saw -> blocked with who and when", () => {
  assert.deepEqual(guard.findReplyConflict(msgs, "m3", "u-ann"), { by: "Bo", at: "2026-11-26T09:12:00.000Z" });
  // The newest reply wins when several landed.
  assert.deepEqual(guard.findReplyConflict(msgs, "m1", "u-cy"), { by: "Bo", at: "2026-11-26T09:12:00.000Z" });
});

test("guard: my own later reply, a newer customer email, or an up-to-date view never blocks", () => {
  assert.equal(guard.findReplyConflict(msgs, "m3", "u-bo"), null);
  assert.equal(guard.findReplyConflict(msgs, "m4", "u-ann"), null);
  assert.equal(guard.findReplyConflict(msgs.slice(0, 3), "m2", "u-cy"), null);
});

test("guard: an old client (no afterMessageId) or an unknown id never blocks", () => {
  assert.equal(guard.findReplyConflict(msgs, null, "u-ann"), null);
  assert.equal(guard.findReplyConflict(msgs, "gone", "u-ann"), null);
});

test("guard: a system-sent reply (no sender id) counts as someone else's", () => {
  const sys = [...msgs.slice(0, 3), { id: "m5", direction: "outbound", createdAt: "2026-11-26T09:20:00.000Z", fromName: "Hookka" }];
  assert.deepEqual(guard.findReplyConflict(sys, "m3", "u-ann"), { by: "Hookka", at: "2026-11-26T09:20:00.000Z" });
});

test("guard: the route answers 409 already_replied unless forced", () => {
  const src = readFileSync("src/api/routes/mail-center.ts", "utf8");
  assert.match(src, /if \(!body\.force\)/);
  assert.match(src, /code: "already_replied"/);
});

// ---- row 13: auto-assign ---------------------------------------------------
test("auto-assign: NULL or empty assignee is unassigned", () => {
  assert.equal(guard.isUnassigned(null), true);
  assert.equal(guard.isUnassigned(""), true);
  assert.equal(guard.isUnassigned("  "), true);
  assert.equal(guard.isUnassigned("u-ann"), false);
  assert.equal(guard.REPLYING_FRESH_MS, 90_000);
});

// ---- row 25: disable closes the mailbox ------------------------------------
test("disable closes the mailbox and removes grants; both user paths call it", () => {
  const prov = readFileSync("src/api/lib/mail-provision.ts", "utf8");
  assert.match(prov, /export async function closePersonalMailOnDisable/);
  assert.match(prov, /DELETE FROM email_address_access WHERE user_id = \?/);
  assert.match(prov, /UPDATE email_addresses SET active = 0 WHERE assigned_user_id = \?/);
  const users = readFileSync("src/api/routes/users.ts", "utf8");
  // PUT (isActive -> 0 / back to 1) and DELETE (soft delete) both sync it.
  assert.equal((users.match(/await syncMailboxWithActive\(/g) ?? []).length, 2);
});

// ---- row 21: what the reply box makes of the 409 ---------------------------
const rules = await import("../src/pages/mail-center/mail-reply-rules.ts");

test("reply box: only a 409 already_replied with who + when is a colleague's reply", () => {
  const body = { code: "already_replied", by: "Bo", at: "2026-11-26T09:12:00.000Z", error: "Bo already replied." };
  assert.deepEqual(rules.alreadyRepliedFrom(409, body), { by: "Bo", at: body.at });
  assert.equal(rules.alreadyRepliedFrom(502, body), null);
  assert.equal(rules.alreadyRepliedFrom(409, { error: "conflict" }), null);
  assert.equal(rules.alreadyRepliedFrom(409, null), null);
});

test("reply box wording: ago label and name list", () => {
  const at = new Date(NOW - 2 * 60_000).toISOString();
  assert.equal(rules.agoLabel(at, NOW), "2 minutes ago");
  assert.equal(rules.agoLabel(new Date(NOW).toISOString(), NOW), "just now");
  assert.equal(rules.agoLabel(new Date(NOW - 60 * 60_000).toISOString(), NOW), "1 hour ago");
  assert.equal(rules.joinNames(["Ann"]), "Ann");
  assert.equal(rules.joinNames(["Ann", "Bo", "Cy"]), "Ann, Bo and Cy");
});
