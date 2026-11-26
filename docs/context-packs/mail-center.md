# Mail Center — Module Guide

> **Last verified: 2026-11-26** (branch `feat/mail-center-parity`): written for the Houzs
> parity work (owner 2026-11-26: every system's Mail Center works like Houzs ERP's). Covers the
> sending, delivery, reply-guard and disable rules in full; for everything older (inbound, access
> levels, read receipts, acknowledgements, labels, picker) the code map is
> [`CODEBASE-MAP.md`](../CODEBASE-MAP.md) § Mail Center and PRD T-012.

## Where it lives

| Part | File |
| --- | --- |
| Routes (threads, reply, compose, outbox log, mailboxes, labels) | `src/api/routes/mail-center.ts` |
| Reply guard heartbeat + waiting badge routes | `src/api/routes/mail-reply-guard.ts` (registered by `mail-center.ts`) |
| Send now, queue on a passing failure | `src/api/lib/mail-send.ts` |
| Outbox (retry, lease, envelope) | `src/api/lib/email-outbox.ts` |
| Delivery status rules (pure) | `src/api/lib/mail-delivery.ts` |
| Delivery refresh, parity schema, traffic clock | `src/api/lib/mail-delivery-refresh.ts` |
| Reply guard rules + SQL | `src/api/lib/mail-reply-guard.ts` |
| Disable closes the mailbox | `src/api/lib/mail-provision.ts` (`closePersonalMailOnDisable`, `reopenPersonalMailbox`), called from `src/api/routes/users.ts` |
| Thread page, reply box | `src/pages/mail-center/detail.tsx`, `mail-reply-parts.tsx`, `mail-reply-rules.ts`, `use-replying-heartbeat.ts`, `mail-delivery.ts` |
| Menu badge | `src/lib/mail-waiting.ts`, `src/components/layout/sidebar.tsx` |
| Schema | runtime `ensureMailSchema` (mail-center.ts) + `ensureMailParitySchema`; files `migrations-postgres/0233_mail_reads_acks.sql`, `0260_mail_center_parity.sql` |
| Tests | `tests/mail-center-parity.test.mjs`, `mail-threading`, `mail-send-path`, `mail-provision`, `mail-reads-acks`, `email-outbox-attachments` |

## Sending a reply or a new email (Houzs row 19)

1. `POST /threads/:id/reply` or `POST /compose` sends **straight away** through `sendMail`
   (Brevo when `BREVO_API_KEY` is set, else Resend).
2. If the provider fails for a reason that may pass — no HTTP answer (network, timeout), 5xx, 408 or
   429 — the mail goes into `outbox_emails` as **attempt 1 of 3** (status `RETRYING`), with its whole
   envelope (From, To, Cc, Bcc, threading headers, the message row id) in `payload_json`
   (`kind: "mail-center-send"`). The message is recorded on the thread with `outbox_id`, and the
   answer is `{ ok: true, queued: true }`. The screen says "Not sent yet. It is queued and will retry
   within a few minutes." — never "failed", which would make the operator send it twice.
3. A failure retrying cannot fix (no provider configured, a 4xx such as an unverified sender or a bad
   address) is answered **502 with the provider's reason**, as before, and nothing is recorded.
4. The drain (`processOutbox`) retries after 60 s, then 300 s. Before each try it claims the row
   (`SENDING`); that claim is a **5-minute lease** no other drain can take, which is what stops a
   double delivery. A row stuck in `SENDING` past the lease is taken over. The third failure marks it
   `FAILED`. On success the provider id is written back onto the thread message.
5. Who runs the drain: the GitHub tick every 5 min (`process-email-outbox.yml`), the eager push after
   a normal enqueue, and the **traffic clock** below.

The Auto-sent log (`GET /outbox`, `/outbox/:id`) leaves these rows out: they live on their thread.

## Delivered / Bounced (Houzs row 20)

Each outbound message shows one chip: **Queued, retrying** (outbox pending / retrying / sending),
**Not delivered** (outbox failed, or the provider reports failed), **Delivered**, or
**Bounced: check the address**. Rules: `deliveryStatus()` in `lib/mail-delivery.ts`.

No dashboard or webhook to set up. `refreshOutboundDelivery` asks the provider by the id it returned:

- **Brevo** (`messageId` looks like `<…@smtp-relay.mailin.fr>`): `GET /v3/smtp/statistics/events?messageId=…`.
  Events are per recipient: **Bounced** as soon as any recipient hard/soft-bounced, was blocked or
  invalid; **Delivered** only once every To + Cc + Bcc address has a delivered / opened / clicked
  event; otherwise it keeps asking.
- **Resend** (a UUID): `GET /emails/:id`, `last_event` mapped as Houzs does.

Bounded: at most 20 messages per run, only outbound messages sent in the last 3 days that have no
final status yet; each provider call times out after 8 s. A bounce writes one bell notice
(`notifications`, id `mail-bounce-<message id>`, so never twice) to the person who sent it, linking to
the thread. Stored on `email_messages.delivery_status` / `delivery_status_at`.

**Traffic clock.** Pages has no scheduler, so like meeting mail it runs from traffic: every open tab
polls `GET /waiting-count` once a minute (the menu badge), and that request kicks
`mailMaintenanceSoon` — outbox drain + delivery refresh — at most once a minute per instance, after
the answer has gone. The 5-minute GitHub tick runs the delivery refresh too.

## Reply guard, auto-assign, waiting badge (Houzs rows 13 + 21)

- **"X is writing a reply."** While the reply box has text it posts
  `POST /threads/:id/replying { drafting: true }` every 20 s (and `false` when emptied). A mark older
  than 90 s is ignored. `GET /threads/:id` returns `replying` (colleagues, never me); each heartbeat
  also returns `replying` and the thread's newest message id, so a colleague's reply appears while I
  type. Table `mail_thread_replying` (one row per thread + person).
- **Already replied.** The reply box sends `afterMessageId` (the newest message on screen). If a
  colleague sent an outbound reply after it, the server answers **409**
  `{ code: "already_replied", by, at }` and sends nothing. The box shows their reply, says mine has
  not been sent, and offers **Discard mine** or **Send mine too** (`force: true`). An old client that
  sends no `afterMessageId` is never blocked. Rule: `findReplyConflict()` (pure, over the messages the
  route already loaded).
- **Auto-assign.** Whoever replies to an unassigned thread (assignee NULL or empty) becomes its
  assignee; an assigned thread keeps its assignee.
- **Waiting badge.** `GET /waiting-count`: open, not trashed threads whose last message is inbound,
  assigned to me, or unassigned in a mailbox assigned to me. Shown on the **Mail Center** menu item.

## Disabling a member (Houzs row 25)

`PUT /api/users/:id { isActive: false }` and `DELETE /api/users/:id` call
`closePersonalMailOnDisable`: every address assigned to them is set `active = 0` (it drops out of
every scope and send-from list; the mail history stays) and every mailbox grant they held is deleted.
Colleagues' grants on the closed mailbox stay. Re-enabling (`isActive` back to true) reopens the
addresses assigned to them; shared mailboxes come back only when an admin grants them again. Best
effort: a mailbox error is logged and never fails the account change.

Note: like Houzs, this closes **every** address whose owner is that person, including a shared
mailbox an admin gave them as owner. Reassign such a mailbox before disabling the person.

## Not covered here / known gaps

- The phone screen (`src/pages/m/screens/MailCenterScreen.tsx`) does not show the reply guard or the
  delivery chip yet; a queued reply there simply reports success.
- Brevo live polling was not exercised against the real API when this was written (see the PR).
