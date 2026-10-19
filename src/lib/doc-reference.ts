// ---------------------------------------------------------------------------
// doc-reference.ts — the Reference on a payment voucher or a journal entry
// (owner 2026-10-19 「先做 Reference 栏」): the TT / cheque no. (or, on an AP
// Payment drawn on trade finance, the bank's drawdown no.), its own field —
// the description stays the printed text. Pure, shared by the API and tests.
// ---------------------------------------------------------------------------

export const REFERENCE_MAX = 120;

/** The stored form: trimmed, at most REFERENCE_MAX characters; blank = null. */
export function normaliseReference(v: unknown): string | null {
  return String(v ?? "").trim().slice(0, REFERENCE_MAX) || null;
}

/**
 * What an AP Payment hands its settlement document (the supplier / other-party
 * payment, or the trade-finance drawdown) as the reference: the voucher's own
 * Reference. A voucher keyed before the field existed carried the TT / cheque
 * no. in its description, so that is the fallback — such a voucher settles
 * exactly as it did before.
 */
export function settlementReference(reference: unknown, description: unknown): string | null {
  return normaliseReference(reference) ?? (String(description ?? "").trim() || null);
}
