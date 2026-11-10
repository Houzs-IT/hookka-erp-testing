// ---------------------------------------------------------------------------
// pv-remind.ts — "Remind approver" on a checked payment voucher
// (cross-system review pass 2, H3-7; sister Houzs#5232).
//
// A voucher can sit at CHECKED for days because nobody told the approver. The
// preparer now presses "Remind approver": everyone who holds
// accounting:approve gets an in-app notification (the top-bar bell), at most
// once an hour per voucher. Nothing about the voucher changes.
//
// The hour is rolling and is read from the notifications themselves (the link
// carries the voucher), so no new column is needed; the notification id is
// per voucher + approver + hour, with ON CONFLICT DO NOTHING, so two presses
// in the same instant still send once.
// ---------------------------------------------------------------------------

export const PV_REMIND_INTERVAL_MS = 60 * 60 * 1000;

/** Minutes until the next reminder is allowed; 0 = allowed now. Pure. */
export function remindWaitMinutes(lastSentIso: string | null | undefined, nowMs: number): number {
  if (!lastSentIso) return 0;
  const last = Date.parse(lastSentIso);
  if (!Number.isFinite(last)) return 0;
  const left = last + PV_REMIND_INTERVAL_MS - nowMs;
  return left > 0 ? Math.ceil(left / 60000) : 0;
}

/** The sentence a refused reminder answers with. */
export function remindTooSoonMessage(minutes: number): string {
  return `The approver was reminded less than an hour ago. You can remind again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Wildcard grant check, same rules as the RBAC gate. Pure. */
export function grantsApprove(perms: Set<string>): boolean {
  return (
    perms.has("accounting:approve") ||
    perms.has("accounting:*") ||
    perms.has("*:approve") ||
    perms.has("*:*")
  );
}

/** Where the bell sends the approver, and what marks a voucher's reminders. */
export function pvRemindLink(pvId: string): string {
  return `/accounting?tab=payments&pv=${encodeURIComponent(pvId)}`;
}

/** One notification per voucher + approver + hour (double-press safe). */
export function pvRemindNotificationId(pvId: string, userId: string, nowMs: number): string {
  return `pv-remind-${pvId}-${userId}-${Math.floor(nowMs / PV_REMIND_INTERVAL_MS)}`;
}
