// ---------------------------------------------------------------------------
// official-receipt-edit.ts — editing a POSTED official receipt (owner
// 2026-10-17 「可以」, finance backlog item 14). The receipt keeps its number;
// its live GL legs are reversed and the edited ones re-posted
// (official_receipt_restate_rev/post:<stamp>), the PV-restate pattern.
//
// The bank side. A receipt booked from a bank line (or matched in Cash Book)
// has a statement line pointing at its bank leg. Re-posting gives the bank
// leg a new id, so the match has to move with it — otherwise the statement
// line keeps pointing at a hidden leg and the month stops tallying. It can
// only move when the bank side is unchanged (same account, same amount);
// changing either on a matched receipt is refused until it is unmatched.
// A daily tick on the cash board moves the same way, but never blocks: a
// tick is a note, not a reconciliation.
// ---------------------------------------------------------------------------

export type OrLiveLeg = { id: string; accountCode: string; debitSen: number; creditSen: number };

export const OR_MATCHED_EDIT_ERR =
  "This receipt is matched to a bank statement line in Cash Book, so its bank account and amount must stay the same. Unmatch it in Cash Book first to change them.";

export function orBankCarry(
  live: OrLiveLeg[],
  refs: { matched: Set<string>; ticked: Set<string> },
  next: { payTo: string; totalSen: number },
): { ok: true; carryFrom: string | null } | { ok: false; error: string } {
  const held = live.filter((l) => refs.matched.has(l.id) || refs.ticked.has(l.id));
  if (held.length === 0) return { ok: true, carryFrom: null };
  const leg = held[0];
  const unchanged =
    held.length === 1 &&
    leg.accountCode === next.payTo &&
    Math.round(Number(leg.debitSen) || 0) === Math.round(Number(next.totalSen) || 0) &&
    Math.round(Number(leg.creditSen) || 0) === 0;
  if (unchanged) return { ok: true, carryFrom: leg.id };
  if (held.some((l) => refs.matched.has(l.id))) return { ok: false, error: OR_MATCHED_EDIT_ERR };
  // Only ticks: they stay with the old (hidden) leg, which nothing reads.
  return { ok: true, carryFrom: null };
}
