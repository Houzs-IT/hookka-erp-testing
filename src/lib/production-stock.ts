// ---------------------------------------------------------------------------
// production-stock.ts (pure) — finished goods and work in progress valued from
// the production orders, for a month whose Stock Take carries no FG / WIP
// figure (owner 2026-10-13: 「10 月的 FG 可以计算还没送的货，然后在我的 P&L
// 出现吗」→ 1.A, WIP the same way, cost ratio with this month's labour →「做」).
//
// The method the owner approved for May–September (keyed into Stock Take on
// 2026-10-09), now computed live:
//   • FG as of D  — orders CLOSED (completedDate) on or before D and not yet
//     dispatched by D (no delivery order / consignment note out by then),
//     valued at selling price × cost ratio.
//   • WIP as of D — orders not closed by D with at least one job card done by
//     D, valued at selling price × completion × cost ratio; completion = the
//     done job cards' standard minutes ÷ all of the order's (card count when no
//     minutes are set). An order whose cards are all done but which isn't
//     closed stays WIP at 100% (owner: 「不当 FG」).
//   • SERVICE CHARGE lines are not goods: never FG, never WIP (owner).
//   • Selling price: the order's sales-order line for the same product (the
//     line with the order's own line number first — orders split per unit so
//     line numbers drift), else its consignment-order line, else the average
//     price of its product category.
//   • Cost ratio for month M = last month's materials ÷ last month's completed
//     goods at selling price + this month's direct labour ÷ this month's
//     completed goods at selling price (owner: 「人工用这个月的」), no factory
//     overhead (owner: 「先不加工厂费用」).
// ---------------------------------------------------------------------------

export type PsOrder = {
  id: string;
  status: string;
  /** The day the order was closed (YYYY-MM-DD); null while open. */
  completedDate: string | null;
  qty: number;
  itemCategory: string | null;
  productCode: string | null;
  productName: string | null;
  salesOrderId: string | null;
  consignmentOrderId: string | null;
  lineNo: number | null;
};

export type PsJobCard = { productionOrderId: string; status: string; completedDate: string | null; minutes: number };

export type PsLine = { orderId: string; lineNo: number | null; productCode: string | null; unitPriceSen: number };

export type PreparedProduction = {
  orders: PsOrder[];
  priceSen: Map<string, number>;
  cards: Map<string, PsJobCard[]>;
  dispatchedOn: Map<string, string>;
  /** Orders closed before this day are pre-opening stock (the opening seed). */
  floorIso: string | null;
};

export type StockAt = {
  /** FG at selling price (before the cost ratio). */
  fgPriceSen: number;
  /** WIP at selling price × completion (before the cost ratio). */
  wipPriceSen: number;
  fgUnits: number;
  wipUnits: number;
  /** WIP in whole-unit equivalents (Σ qty × completion). */
  wipEquivalentUnits: number;
};

const day = (v: string | null | undefined) => String(v ?? "").slice(0, 10);

export function isServiceCharge(o: Pick<PsOrder, "productCode" | "productName">): boolean {
  return /SERVICE\s*CHARGE/i.test(`${o.productCode ?? ""} ${o.productName ?? ""}`);
}

// The selling price per unit of each order (sen).
export function priceOrders(orders: PsOrder[], soLines: PsLine[], coLines: PsLine[]): Map<string, number> {
  const index = (lines: PsLine[]) => {
    const m = new Map<string, PsLine[]>();
    for (const l of lines) {
      const k = `${l.orderId}|${String(l.productCode ?? "").trim()}`;
      const arr = m.get(k) ?? [];
      arr.push(l);
      m.set(k, arr);
    }
    return m;
  };
  const so = index(soLines);
  const co = index(coLines);
  const pick = (cands: PsLine[] | undefined, lineNo: number | null): number | null => {
    if (!cands || !cands.length) return null;
    const own = cands.find((l) => lineNo !== null && l.lineNo === lineNo);
    const first = [...cands].sort((a, b) => (a.lineNo ?? 0) - (b.lineNo ?? 0))[0];
    const v = Number((own ?? first).unitPriceSen) || 0;
    return v > 0 ? v : null;
  };
  const out = new Map<string, number>();
  const catSum = new Map<string, { sen: number; qty: number }>();
  for (const o of orders) {
    const product = String(o.productCode ?? "").trim();
    const price =
      (o.salesOrderId ? pick(so.get(`${o.salesOrderId}|${product}`), o.lineNo) : null) ??
      (o.consignmentOrderId ? pick(co.get(`${o.consignmentOrderId}|${product}`), o.lineNo) : null);
    if (price === null) continue;
    out.set(o.id, price);
    const cat = String(o.itemCategory ?? "");
    const c = catSum.get(cat) ?? { sen: 0, qty: 0 };
    const q = Math.max(1, Number(o.qty) || 1);
    c.sen += price * q;
    c.qty += q;
    catSum.set(cat, c);
  }
  for (const o of orders) {
    if (out.has(o.id)) continue;
    const c = catSum.get(String(o.itemCategory ?? ""));
    if (c && c.qty > 0) out.set(o.id, c.sen / c.qty);
  }
  return out;
}

export function prepareProduction(input: {
  orders: PsOrder[];
  jobCards: PsJobCard[];
  soLines: PsLine[];
  coLines: PsLine[];
  dispatches: { productionOrderId: string; date: string }[];
  floorIso: string | null;
}): PreparedProduction {
  const orders = input.orders.filter((o) => String(o.status).toUpperCase() !== "CANCELLED");
  const cards = new Map<string, PsJobCard[]>();
  for (const c of input.jobCards) {
    const arr = cards.get(c.productionOrderId) ?? [];
    arr.push(c);
    cards.set(c.productionOrderId, arr);
  }
  const dispatchedOn = new Map<string, string>();
  for (const d of input.dispatches) {
    const dd = day(d.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dd)) continue;
    const cur = dispatchedOn.get(d.productionOrderId);
    if (!cur || dd < cur) dispatchedOn.set(d.productionOrderId, dd);
  }
  return { orders, priceSen: priceOrders(orders, input.soLines, input.coLines), cards, dispatchedOn, floorIso: input.floorIso ? day(input.floorIso) : null };
}

const isDone = (c: PsJobCard, asOf: string) => {
  const s = String(c.status).toUpperCase();
  const d = day(c.completedDate);
  return (s === "COMPLETED" || s === "TRANSFERRED") && d !== "" && d <= asOf;
};

export function productionStockAt(p: PreparedProduction, asOfIso: string): StockAt {
  const asOf = day(asOfIso);
  let fgPriceSen = 0, wipPriceSen = 0, fgUnits = 0, wipUnits = 0, wipEquivalentUnits = 0;
  for (const o of p.orders) {
    if (isServiceCharge(o)) continue;
    const price = p.priceSen.get(o.id);
    if (price === undefined) continue;
    const qty = Math.max(1, Number(o.qty) || 1);
    const closed = day(o.completedDate);
    const out = p.dispatchedOn.get(o.id);
    const gone = !!out && out <= asOf;
    if (closed && closed <= asOf) {
      if (gone) continue;
      if (p.floorIso && closed < p.floorIso) continue; // pre-opening stock
      fgPriceSen += price * qty;
      fgUnits += qty;
      continue;
    }
    if (gone) continue;
    const cards = p.cards.get(o.id) ?? [];
    const done = cards.filter((c) => isDone(c, asOf));
    if (!done.length) continue; // not started
    const totalMin = cards.reduce((s, c) => s + (Number(c.minutes) || 0), 0);
    const completion = totalMin > 0
      ? done.reduce((s, c) => s + (Number(c.minutes) || 0), 0) / totalMin
      : done.length / cards.length;
    wipPriceSen += price * qty * completion;
    wipUnits += qty;
    wipEquivalentUnits += qty * completion;
  }
  return { fgPriceSen, wipPriceSen, fgUnits, wipUnits, wipEquivalentUnits };
}

// Goods completed (orders closed) in [fromIso, toIso], at selling price.
export function completedPriceSen(p: PreparedProduction, fromIso: string, toIso: string): number {
  const from = day(fromIso), to = day(toIso);
  let sen = 0;
  for (const o of p.orders) {
    if (isServiceCharge(o)) continue;
    const closed = day(o.completedDate);
    if (!closed || closed < from || closed > to) continue;
    const price = p.priceSen.get(o.id);
    if (price === undefined) continue;
    sen += price * Math.max(1, Number(o.qty) || 1);
  }
  return sen;
}

// Last month's materials share + this month's labour share. This month's
// labour share falls back to last month's while nothing has been completed yet
// this month (the 1st of a month has no denominator).
export function costRatio(a: {
  prevMaterialsSen: number;
  prevCompletedSen: number;
  prevLabourSen: number;
  labourSen: number;
  completedSen: number;
}): number {
  const materials = a.prevCompletedSen > 0 ? a.prevMaterialsSen / a.prevCompletedSen : 0;
  const labour = a.completedSen > 0
    ? a.labourSen / a.completedSen
    : a.prevCompletedSen > 0 ? a.prevLabourSen / a.prevCompletedSen : 0;
  return Math.max(0, materials + labour);
}
