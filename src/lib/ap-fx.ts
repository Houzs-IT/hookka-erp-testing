// ---------------------------------------------------------------------------
// A foreign-currency bill paid on an AP Payment (Currency & FX step 3, owner
// 2026-10-20 「要」; plan docs/superpowers/plans/2026-10-20-currency-fx.md).
// The amount is typed in the bill's own currency and priced at the payment's
// rate (the month's rate from Setup is the form's default). AP is cleared at
// the bill's BOOKED RM — the whole RM still payable when the payment covers
// what is left — the bank pays foreign × rate, and the difference is realised
// FX. `computeAlloc` (src/lib/supplier-payment-alloc.ts) is the posting's own
// maths; this wraps it for the form and the server check so the two agree.
// Pure.
// ---------------------------------------------------------------------------
import { computeAlloc } from "./supplier-payment-alloc";
import { FX_RATE_DECIMALS } from "./fx";

/** What is still payable on a bill in its own currency (sen): its RM still
 *  payable at the bill's booking rate. */
export function foreignAvailableSen(availableSen: number, bookingRate: number): number {
  return bookingRate > 0 && availableSen > 0 ? Math.round(availableSen / bookingRate) : 0;
}

export type ApForeignPay =
  | { ok: true; full: boolean; bookedSen: number; bankSen: number; fxSen: number }
  | { ok: false; error: string };

/** Paying `foreignSen` (the bill's currency) on a bill with `availableSen` RM
 *  still payable, booked at `bookingRate`, at the payment's `payRate`. It is
 *  "full" — AP cleared at exactly the RM still payable — only when it covers
 *  what is left and no other unposted voucher holds part of the bill
 *  (`reservedSen`), so a full payment never clears RM another voucher holds. */
export function apForeignPay(o: { availableSen: number; reservedSen?: number; bookingRate: number; foreignSen: number; payRate: number }): ApForeignPay {
  if (!(o.bookingRate > 0)) return { ok: false, error: "the bill has no booking rate" };
  if (!(o.payRate > 0)) return { ok: false, error: "enter the payment's rate" };
  const foreign = Math.round(o.foreignSen);
  if (!(foreign > 0)) return { ok: false, error: "enter the amount paid" };
  const avail = foreignAvailableSen(o.availableSen, o.bookingRate);
  if (foreign > avail) return { ok: false, error: "more than is still payable" };
  const full = foreign === avail && (o.reservedSen ?? 0) === 0;
  const r = computeAlloc({ outstandingBookedSen: o.availableSen, isForeign: true, fxRate: o.bookingRate, foreignSen: foreign, payRate: o.payRate, full });
  if (!r.ok) return r;
  return { ok: true, full, bookedSen: r.bookedSen, bankSen: r.bankSen, fxSen: r.fxDiffSen };
}

// ---------------------------------------------------------------------------
// Confirm bank amount (Currency & FX step 4). A foreign payment posts at the
// payment's rate — an estimate until the bank statement shows the RM the bank
// actually debited. That RM replaces the estimate: each bill still clears its
// booked RM, the bank's RM is shared over the bills by what each paid in the
// currency, and the rate becomes RM ÷ foreign. Pure, shared by the server and
// the confirm box.
// ---------------------------------------------------------------------------

/** `totalSen` shared over the lines in proportion to `weights`, to the sen:
 *  each line gets its whole sen and the sen left over go to the largest
 *  remainders, so the parts always add up to `totalSen` and none is negative. */
export function splitBankAmount(totalSen: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const sum = w.reduce((s, x) => s + x, 0);
  if (!(sum > 0)) return w.map((_, i) => (i === n - 1 ? totalSen : 0));
  const exact = w.map((x) => (totalSen * x) / sum);
  const parts = exact.map((e) => Math.floor(e + 1e-9));
  let left = totalSen - parts.reduce((s, p) => s + p, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e + 1e-9) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n) {
    parts[order[k].i] += 1;
    left -= 1;
  }
  return parts;
}

/** A rate (RM per 1 unit) to the decimals the rate box keeps. */
export function roundFxRate(rate: number): number {
  const f = 10 ** FX_RATE_DECIMALS;
  return Math.round(rate * f) / f;
}

export type ConfirmBankPlan =
  | { ok: true; rate: number; parts: number[]; foreignBankSen: number }
  | { ok: false; error: string };

/** The RM the bank debited (`bankSen`) over a foreign payment's lines
 *  (`foreignSens`, what each paid in the currency). `fixedSen` is the part of
 *  the payment already in RM (an RM bill, an advance) — not re-priced. */
export function confirmBankPlan(o: { bankSen: number; fixedSen?: number; foreignSens: number[] }): ConfirmBankPlan {
  const bank = Number(o.bankSen);
  if (!Number.isInteger(bank) || bank <= 0) return { ok: false, error: "Enter the RM the bank debited" };
  const foreign = o.foreignSens.map((f) => Math.max(0, Math.round(Number(f) || 0)));
  const totalForeign = foreign.reduce((s, f) => s + f, 0);
  if (!(totalForeign > 0)) return { ok: false, error: "This payment has no foreign-currency bill on it" };
  const fixed = Math.max(0, Math.round(Number(o.fixedSen) || 0));
  const foreignBank = bank - fixed;
  if (foreignBank <= 0) return { ok: false, error: `The bank amount must be more than the RM ${(fixed / 100).toFixed(2)} of this payment that is already in RM` };
  const rate = roundFxRate(foreignBank / totalForeign);
  if (!(rate > 0)) return { ok: false, error: "That bank amount gives no rate — check the figure" };
  return { ok: true, rate, parts: splitBankAmount(foreignBank, foreign), foreignBankSen: foreignBank };
}
