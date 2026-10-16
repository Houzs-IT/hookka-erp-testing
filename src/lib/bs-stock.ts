// ---------------------------------------------------------------------------
// bs-stock.ts (pure) — the Balance Sheet's stock is the P&L's closing stock
// (owner 2026-10-13: 「balance sheet 就让他的 closing stock 和 P&L closing stock
// 一样不就行了吗」→「做」).
//
// Report layer only — nothing is posted. A sheet as at month-end M shows, on
// each stock account of the stock map (one 330-x home per material group, plus
// WIP and FG), the closing stock the P&L uses for M (the Stock Summary's
// figure). Whatever the ledger itself holds on those accounts is replaced and
// the difference goes to Current Year Earnings (unclosed): stock not yet used
// is cost the ledger has already expensed, so earnings carry it back. A
// year-end stock entry in the ledger that matches the count therefore adds
// nothing on top. Months before the books opened carry no stock.
// ---------------------------------------------------------------------------

export type StockHomes = {
  rmDefault: { stock: string };
  rm: Record<string, { stock: string }>;
  wip: { stock: string };
  fg: { stock: string };
};

export type ClosingStock = {
  /** Raw-material value per material group (sen). */
  rows: { group: string; closingSen: number }[];
  wipSen: number;
  fgSen: number;
};

const same = (code: string) => code;

/** Every account the stock map keeps stock on — the balances the sheet replaces. */
export function stockAccounts(map: StockHomes, resolve: (code: string) => string = same): Set<string> {
  const out = new Set<string>([resolve(map.rmDefault.stock), resolve(map.wip.stock), resolve(map.fg.stock)]);
  for (const e of Object.values(map.rm)) out.add(resolve(e.stock));
  return out;
}

/** The closing stock filed on its accounts; a group without its own home falls to the default one. */
export function stockByAccount(
  map: StockHomes,
  closing: ClosingStock,
  resolve: (code: string) => string = same,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (code: string, sen: number) => {
    const c = resolve(code);
    out.set(c, (out.get(c) ?? 0) + Math.round(sen));
  };
  for (const r of closing.rows) add((map.rm[r.group] ?? map.rmDefault).stock, r.closingSen);
  add(map.wip.stock, closing.wipSen);
  add(map.fg.stock, closing.fgSen);
  return out;
}

/**
 * The month whose closing stock a sheet as at `endYm` carries: the month
 * itself, the running month for a sheet past it (or with no month), null
 * before the opening month (or with no opening date).
 */
export function sheetStockMonth(endYm: string | null, openingYm: string | null, runningYm: string): string | null {
  const m = !endYm || endYm > runningYm ? runningYm : endYm;
  return openingYm && m >= openingYm ? m : null;
}

/**
 * Replace the ledger's stock balances with the closing stock. `ledgerNet` is
 * the ledger's DR − CR on an account at the sheet's date. Returns each stock
 * account's balance on the sheet (asset side) and how much Current Year
 * Earnings moves by (closing stock − what the ledger held).
 */
export function stockOverride(
  accounts: ReadonlySet<string>,
  byAccount: ReadonlyMap<string, number>,
  ledgerNet: (code: string) => number,
): { balances: Map<string, number>; earningsSen: number } {
  const balances = new Map<string, number>();
  let stock = 0;
  let ledger = 0;
  for (const code of accounts) {
    const v = byAccount.get(code) ?? 0;
    balances.set(code, v);
    stock += v;
    ledger += ledgerNet(code);
  }
  return { balances, earningsSen: stock - ledger };
}

/**
 * The Balance Sheet drill on one stock account: b/f = last month-end's
 * closing stock on it (null `opening` = none, the opening month), c/f = this
 * month-end's, and one line per material group (or WIP / FG) that moved.
 */
export function stockDrill(
  account: string,
  map: StockHomes,
  opening: ClosingStock | null,
  closing: ClosingStock,
  resolve: (code: string) => string = same,
): { bfSen: number; cfSen: number; lines: { label: string; fromSen: number; toSen: number }[] } {
  const parts = new Map<string, { fromSen: number; toSen: number }>();
  const add = (label: string, home: string, sen: number, side: "fromSen" | "toSen") => {
    if (resolve(home) !== account) return;
    const p = parts.get(label) ?? { fromSen: 0, toSen: 0 };
    p[side] += Math.round(sen);
    parts.set(label, p);
  };
  const fill = (s: ClosingStock, side: "fromSen" | "toSen") => {
    for (const r of s.rows) add(r.group, (map.rm[r.group] ?? map.rmDefault).stock, r.closingSen, side);
    add("WIP", map.wip.stock, s.wipSen, side);
    add("FG", map.fg.stock, s.fgSen, side);
  };
  if (opening) fill(opening, "fromSen");
  fill(closing, "toSen");
  let bfSen = 0;
  let cfSen = 0;
  const lines: { label: string; fromSen: number; toSen: number }[] = [];
  for (const [label, p] of [...parts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    bfSen += p.fromSen;
    cfSen += p.toSen;
    if (p.toSen !== p.fromSen) lines.push({ label, ...p });
  }
  return { bfSen, cfSen, lines };
}

/**
 * The drill's rows in the ledger drill's shape — display only, never ledger
 * legs: one per group that moved, dated the month end, debit = stock up.
 */
export function stockDrillRows(
  month: string,
  monthEnd: string,
  lines: { label: string; fromSen: number; toSen: number }[],
  money: (sen: number) => string,
): {
  id: string; date: string; description: string; otherSide: { code: string; name: string }[];
  ref1: string; ref2: string | null; docs: string | null; debitSen: number; creditSen: number;
  sourceType: string; sourceId: string;
}[] {
  return lines.map((l) => {
    const move = l.toSen - l.fromSen;
    return {
      id: `stock:${month}:${l.label}`,
      date: monthEnd,
      description: `Stock take · ${l.label}: ${money(l.fromSen)} → ${money(l.toSen)}`,
      otherSide: [],
      ref1: "Stock Summary",
      ref2: null,
      docs: null,
      debitSen: move > 0 ? move : 0,
      creditSen: move < 0 ? -move : 0,
      sourceType: "stock_take",
      sourceId: month,
    };
  });
}
