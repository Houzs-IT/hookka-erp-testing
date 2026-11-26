// ---------------------------------------------------------------------------
// Mail Center reply guard (Houzs parity rows 13 + 21, owner 2026-11-26; the
// Houzs original is routes/mail-reply-guard.ts, owner 2026-11-21).
//
//   * "X is writing a reply": the reply box beats every 20 s while it has text
//     (POST /threads/:id/replying); a mark older than 90 s is someone who left.
//   * already_replied: a reply is refused with 409 when a colleague sent one
//     after the newest message the sender had on screen (afterMessageId). The
//     sender sees that reply and may send theirs anyway (force).
//   * auto-assign: whoever replies to an unassigned email becomes its assignee.
//   * waiting count: open emails whose last word is the customer's, assigned to
//     me, or unassigned in my own mailbox (sidebar badge).
// The routes are in routes/mail-reply-guard.ts.
// ---------------------------------------------------------------------------

/** A "writing" mark older than this is someone who left; the box beats every 20 s. */
export const REPLYING_FRESH_MS = 90_000;

export type ReplyConflict = { by: string; at: string };

export type GuardMessage = {
  id: string;
  direction: string;
  createdAt: string;
  sentByUserId?: string | null;
  sentByName?: string | null;
  fromName?: string | null;
};

/**
 * The newest outbound reply someone else sent after the message the sender
 * last saw, or null. Pure: runs over the thread's messages the reply route has
 * already loaded. An unknown / missing afterMessageId never blocks (an old
 * client, or a deleted message): the guard only fires when it is sure.
 */
export function findReplyConflict(
  messages: GuardMessage[],
  afterMessageId: string | null | undefined,
  me: string | null | undefined,
): ReplyConflict | null {
  if (!afterMessageId) return null;
  const seen = messages.find((m) => m.id === afterMessageId);
  if (!seen) return null;
  let hit: GuardMessage | null = null;
  for (const m of messages) {
    if (m.direction !== "outbound" || m.id === seen.id) continue;
    if (!(m.createdAt > seen.createdAt)) continue;
    if (me && m.sentByUserId && m.sentByUserId === me) continue;
    if (!hit || m.createdAt > hit.createdAt) hit = m;
  }
  if (!hit) return null;
  return {
    by: hit.sentByName?.trim() || hit.fromName?.trim() || "A colleague",
    at: hit.createdAt,
  };
}

/** An assignee value that means "nobody" (NULL, or the empty string an unassign may write). */
export function isUnassigned(assignedToUserId: string | null | undefined): boolean {
  return !String(assignedToUserId ?? "").trim();
}

type Db = D1Database;

/** Colleagues (not me) with text in this thread's reply box in the last 90 s. */
export async function replyingOn(
  db: Db,
  orgId: string,
  threadId: string,
  me: string,
  nowMs: number = Date.now(),
): Promise<Array<{ name: string }>> {
  try {
    const res = await db
      .prepare(
        `SELECT user_name AS "userName" FROM mail_thread_replying
          WHERE org_id = ? AND thread_id = ? AND beat_at > ? AND user_id <> ?
          ORDER BY beat_at`,
      )
      .bind(orgId, threadId, new Date(nowMs - REPLYING_FRESH_MS).toISOString(), me || "-")
      .all<{ userName: string | null }>();
    return (res.results ?? []).map((r) => ({ name: r.userName?.trim() || "A colleague" }));
  } catch {
    return []; // table not there yet: nobody shown
  }
}

/** Record or clear my "writing a reply" mark. */
export async function setReplying(
  db: Db,
  args: { orgId: string; threadId: string; userId: string; userName: string | null; drafting: boolean },
): Promise<void> {
  if (args.drafting) {
    await db
      .prepare(
        `INSERT INTO mail_thread_replying (org_id, thread_id, user_id, user_name, beat_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (thread_id, user_id) DO UPDATE SET beat_at = excluded.beat_at, user_name = excluded.user_name`,
      )
      .bind(args.orgId, args.threadId, args.userId, args.userName, new Date().toISOString())
      .run();
  } else {
    await db
      .prepare(`DELETE FROM mail_thread_replying WHERE thread_id = ? AND user_id = ?`)
      .bind(args.threadId, args.userId)
      .run();
  }
}

/** After my reply: I am no longer writing, and an unassigned email becomes mine. */
export async function afterReplySent(
  db: Db,
  args: { orgId: string; threadId: string; assignedToUserId: string | null; me: string | null; myName: string | null },
): Promise<boolean> {
  const { orgId, threadId, me } = args;
  if (!me) return false;
  try {
    await db
      .prepare(`DELETE FROM mail_thread_replying WHERE thread_id = ? AND user_id = ?`)
      .bind(threadId, me)
      .run();
  } catch (e) {
    // Best effort: the reply is already sent, and a stale mark expires in 90 s.
    console.warn("[mail] could not clear replying mark", e);
  }
  if (!isUnassigned(args.assignedToUserId)) return false;
  const res = await db
    .prepare(
      `UPDATE email_threads SET assigned_to_user_id = ?, assigned_to_name = ?
        WHERE org_id = ? AND id = ? AND (assigned_to_user_id IS NULL OR assigned_to_user_id = '')`,
    )
    .bind(me, args.myName, orgId, threadId)
    .run();
  return ((res as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0;
}

/** Open emails waiting on me: last word is the customer's, assigned to me or unassigned in my own mailbox. */
export async function waitingCount(db: Db, orgId: string, me: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM email_threads t
        WHERE t.org_id = ? AND t.status = 'open' AND t.trashed_at IS NULL AND t.last_direction = 'inbound'
          AND (t.assigned_to_user_id = ?
               OR ((t.assigned_to_user_id IS NULL OR t.assigned_to_user_id = '')
                   AND lower(t.mailbox_address) IN (
                     SELECT lower(a.address) FROM email_addresses a
                      WHERE a.org_id = ? AND a.assigned_user_id = ? AND a.active = 1)))`,
    )
    .bind(orgId, me, orgId, me)
    .first<{ n: number | string }>();
  return Number(row?.n ?? 0);
}
