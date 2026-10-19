// ---------------------------------------------------------------------------
// bank-leg-carry.ts — an edit (restate) re-posts a document's ledger legs
// under NEW ids. Bank reconciliation stores leg ids: a statement line's
// matchedLegId, a split's leg_id, the cash board's daily tick. Left alone,
// they keep pointing at the old leg the edit just hid, so the statement line
// reads as booked while the re-posted bank leg shows as not yet through the
// bank — the month is out by the amount (class C31, docs/BUG-CLASSES.md).
//
// The rule, one place for every edit (official receipt, payment voucher,
// customer receipt, other-party payment, supplier payment): each held leg
// moves to the re-posted leg with the same account and the same amounts.
// When there is none — the bank account or the amount changed — a statement
// match or split refuses the edit (unmatch in Cash Book first); a daily tick
// never blocks, it stays on the old, hidden leg, which nothing reads.
// ---------------------------------------------------------------------------

export type CarryLeg = { id: string; accountCode: string; debitSen: number; creditSen: number };
export type BankRefs = { matched: Set<string>; split: Set<string>; ticked: Set<string> };
export type CarryMove = { from: string; to: string };

export function bankMatchedEditError(noun: string): string {
  return `This ${noun} is matched to a bank statement line in Cash Book, so its bank account and amount must stay the same. Unmatch it in Cash Book first to change them.`;
}

// Thrown by an edit builder that runs inside a route's try (customer receipt,
// other-party payment, supplier payment); the route answers 409 with it.
export class BankMatchedEditRefused extends Error {}

export function planBankCarry(
  live: CarryLeg[],
  refs: BankRefs,
  posted: CarryLeg[],
  noun: string,
  resolve: (code: string) => string = (c) => c,
): { ok: true; moves: CarryMove[] } | { ok: false; error: string } {
  const sen = (n: number) => Math.round(Number(n) || 0);
  const used = new Set<string>();
  const moves: CarryMove[] = [];
  for (const h of live) {
    const inBank = refs.matched.has(h.id) || refs.split.has(h.id);
    if (!inBank && !refs.ticked.has(h.id)) continue;
    const to = posted.find(
      (p) =>
        !used.has(p.id) &&
        resolve(p.accountCode) === resolve(h.accountCode) &&
        sen(p.debitSen) === sen(h.debitSen) &&
        sen(p.creditSen) === sen(h.creditSen),
    );
    if (to) {
      used.add(to.id);
      moves.push({ from: h.id, to: to.id });
    } else if (inBank) {
      return { ok: false, error: bankMatchedEditError(noun) };
    }
  }
  return { ok: true, moves };
}
