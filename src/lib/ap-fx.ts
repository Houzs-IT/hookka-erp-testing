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
