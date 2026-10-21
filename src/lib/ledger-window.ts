// ---------------------------------------------------------------------------
// ledger-window.ts — a P&L window's ledger net, from the live legs dated and
// resolved ONCE per request (2026-10-19, owner 「优化加载速度」).
//
// glWindowSigned used to walk every live leg for every window it was asked
// for — the P&L statement asks for eight (the period, the year to date, the
// recurring-cost estimate's months, the stock months): eight passes of a
// document-date lookup and an alias resolve per leg. `prepareLedger` does that
// pass once: per month, per account, DR − CR (and the leg the account first
// appears at), plus the opening legs netted per account. `windowNet` then adds
// up the months a window covers. Same figures, same account order as the old
// loop (an account enters the window's map at its first leg in the window).
// Pure; integer sen, so the sums are exact in any order.
// ---------------------------------------------------------------------------

export type LedgerLeg = {
  accountCode: string;
  sourceType: string;
  sourceId: string;
  debitSen: number;
  creditSen: number;
  postedAt: string;
};

export type PreparedLedger = {
  /** month (YYYY-MM by document date) → account → DR − CR, and the index of the account's first leg that month. */
  months: Map<string, Map<string, { net: number; first: number }>>;
  /** Opening-balance legs (and their reversals), netted per account — they belong to no single month. */
  openingNet: Map<string, number>;
};

export type LedgerPrepOptions = {
  /** The leg's document date, YYYY-MM-DD. */
  docDate: (sourceType: string, sourceId: string, postedAt: string | null | undefined) => string;
  /** An account code through its rename aliases. */
  resolve: (code: string) => string;
  /** A leg before the books opened (not extracted). */
  isBeforeOpening: (sourceType: string, docDate: string) => boolean;
  /** An opening-balance leg (or its reversal). */
  isOpening: (sourceType: string) => boolean;
};

const legNet = (l: LedgerLeg) => (Number(l.debitSen) || 0) - (Number(l.creditSen) || 0);

export function prepareLedger(legs: readonly LedgerLeg[], o: LedgerPrepOptions): PreparedLedger {
  const months: PreparedLedger["months"] = new Map();
  const openingNet = new Map<string, number>();
  legs.forEach((l, i) => {
    const dd = o.docDate(l.sourceType, l.sourceId, l.postedAt);
    if (o.isBeforeOpening(l.sourceType, dd)) return; // pre-opening: not extracted
    if (o.isOpening(l.sourceType)) {
      const code = o.resolve(l.accountCode);
      openingNet.set(code, (openingNet.get(code) ?? 0) + legNet(l));
      return;
    }
    // Closing-stock legs are bookkeeping, not trading — the stock summary
    // already supplies stock.
    if (l.sourceType === "closing_stock" || l.sourceType === "closing_stock_reversal") return;
    const ym = dd.slice(0, 7);
    const code = o.resolve(l.accountCode);
    let m = months.get(ym);
    if (!m) {
      m = new Map();
      months.set(ym, m);
    }
    const cur = m.get(code);
    if (cur) cur.net += legNet(l);
    else m.set(code, { net: legNet(l), first: i });
  });
  return { months, openingNet };
}

/** The window's net per account — a fresh map the caller may add to. */
export function windowNet(p: PreparedLedger, startYm: string | null, endYm: string | null): Map<string, number> {
  const sums = new Map<string, number>();
  const first = new Map<string, number>();
  for (const [ym, m] of p.months) {
    if (startYm && ym < startYm) continue;
    if (endYm && ym > endYm) continue;
    for (const [code, v] of m) {
      sums.set(code, (sums.get(code) ?? 0) + v.net);
      const f = first.get(code);
      if (f === undefined || v.first < f) first.set(code, v.first);
    }
  }
  return new Map([...sums.entries()].sort((a, b) => (first.get(a[0]) ?? 0) - (first.get(b[0]) ?? 0)));
}
