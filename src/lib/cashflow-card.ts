// ---------------------------------------------------------------------------
// cashflow-card.ts (pure) — the Finance Dashboard's Cash Flow card, read off
// THE Cash Flow statement (src/lib/cashflow-engine.ts) so every figure on the
// card is a number the report prints. BUG-2026-11-08-419.
//
// Investing and Financing used to be read from `subtotal` rows of their
// sections, but the statement only emits a subtotal row for Revenue
// Collection — every other section is a `group` row over its lines — so both
// tabs printed 0 every month while the report showed capex, loan, deposit and
// finance-cost money. They are now summed from the statement's LINE rows by
// section, which does not depend on how the rows are grouped.
//
// Owner 2026-11-08:
//   • Financing includes Trade Finance (「当做 financing」).
//   • Free cash flow = operating − capex (it used to equal operating, from the
//     earlier 「当作没有固定资产」 rule, but there is capex now).
//   • Money in / out count money that left or entered the business. A move
//     between our own bank and cash accounts (a petty-cash top-up) is not
//     money in or out — the spending is counted by its purpose when it is
//     recorded (「这个是根据用途吧」).
// ---------------------------------------------------------------------------

export const INVESTING_SECTIONS: ReadonlySet<string> = new Set(["CAPEX"]);
export const FINANCING_SECTIONS: ReadonlySet<string> = new Set(["TRADE_FINANCE", "LOAN", "DEPOSIT", "FINANCE_COST"]);

export type CfStatementRow = { kind: string; label: string; section?: string; values: (number | null)[] };

export type CashFlowCardMonth = { operating: number; investing: number; financing: number; net: number };

/** The card's four figures for one column of the statement. Line values already
 *  carry the statement's display sign (money in +, money out −). */
export function cashFlowCardMonth(rows: readonly CfStatementRow[], idx: number): CashFlowCardMonth {
  const sum = (pred: (r: CfStatementRow) => boolean) =>
    rows.filter(pred).reduce((s, r) => s + (Number(r.values[idx]) || 0), 0);
  const sections = (set: ReadonlySet<string>) => sum((r) => r.kind === "line" && set.has(r.section ?? ""));
  return {
    operating: sum((r) => r.kind === "result" && /operation surplus/i.test(r.label)),
    investing: sections(INVESTING_SECTIONS),
    financing: sections(FINANCING_SECTIONS),
    net: sum((r) => r.kind === "total" && /Cash Surplus/i.test(r.label)),
  };
}

/** Free cash flow: operating cash less capex (investing is negative when spent). */
export function freeCashFlow(cf: { operating: number; investing: number }): number {
  return cf.operating + cf.investing;
}

export type CardBankLeg = { entry?: string; debitSen: number; creditSen: number; ym: string };

/**
 * Money in / out per month off the bank and cash legs, netted within each
 * entry first: a transfer between two of our own accounts nets to 0 and is
 * neither in nor out; a transfer that also paid a bank charge leaves only the
 * charge. `in + out` per month is unchanged by the netting, so it still ties
 * to the statement's cash surplus.
 */
export function bankInOutByMonth(legs: readonly CardBankLeg[]): Map<string, { inflow: number; outflow: number }> {
  const net = new Map<string, { ym: string; sen: number }>();
  let anon = 0;
  for (const l of legs) {
    const key = `${l.ym}|${l.entry ?? `#${anon++}`}`;
    const cur = net.get(key) ?? { ym: l.ym, sen: 0 };
    cur.sen += (Number(l.debitSen) || 0) - (Number(l.creditSen) || 0);
    net.set(key, cur);
  }
  const out = new Map<string, { inflow: number; outflow: number }>();
  for (const { ym, sen } of net.values()) {
    const cur = out.get(ym) ?? { inflow: 0, outflow: 0 };
    if (sen > 0) cur.inflow += sen;
    else cur.outflow += sen;
    out.set(ym, cur);
  }
  return out;
}
