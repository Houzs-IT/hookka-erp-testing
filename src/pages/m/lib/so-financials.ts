// so-financials — the Paid / Balance maths of a Sales Order, as the tablet detail
// has always done it (SalesDetailScreen.tsx):
//   Paid    = Σ the order's linked payments (`amount` or `amountSen`, integer sen)
//   Balance = Total − Paid
// Money stays in integer sen; formatting happens at display time only.
// Not read on the phone (the approved phone detail is read-only and money-light).
import { num } from "../config/helpers";

type Row = Record<string, unknown>;

export type SoFinancials = { total: number; paid: number; balance: number };

export function soFinancials(totalSen: number, payments: Row[]): SoFinancials {
  const paid = payments.reduce((sum, p) => sum + num(p, "amount", "amountSen"), 0);
  return { total: totalSen, paid, balance: totalSen - paid };
}

/** True while money is still owed (the tablet colours Balance red then, green once settled). */
export function hasBalanceDue(f: SoFinancials): boolean {
  return f.balance > 0;
}
