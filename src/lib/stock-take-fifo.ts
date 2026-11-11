// ---------------------------------------------------------------------------
// FIFO pricing for a counted quantity (owner 2026-11-11 「要用fifo 定价」,
// WORK-TRACKER 136; replaces "the latest purchase price for every unit" from
// 2026-10-09). First in, first out: what is still on the shelf at month end is
// what came in last, so the count is valued at the most recent purchases — the
// newest purchase-invoice line's quantity at its price, then the line before,
// and so on until the count is covered.
//
//   • Only lines within 2× of the newest line's price take part: a line far
//     off is a mis-coded size or another unit (measured 2026-11-11: D30-3"
//     bought at 10.83–418.42 under one code; NLY-D35-2.5" one line at 30
//     among 78–98). Skipped lines are counted and shown.
//   • A count larger than everything bought since the system started is
//     priced, for the part beyond, at the oldest line's price, and said so.
//   • A unit factor ("1 purchase unit = N count units", set on Warehouse ›
//     Stock Take) turns each line into the count unit: qty × N, price ÷ N.
//
// Pure: the API returns each item's purchase lines; Finance's Stock Take
// import (src/pages/accounting/index.tsx) prices with these functions.
// ---------------------------------------------------------------------------

/** One purchase-invoice line of an item: its quantity and unit price (sen, after line discount, before SST). */
export type PiLayer = { date: string; piNo: string; supplier: string; qty: number; unitSen: number };

export type FifoResult = {
  /** The count's value (sen). */
  valueSen: number;
  /** valueSen ÷ counted quantity (sen, 4 decimals) — the price per counted unit. */
  unitSen: number;
  /** The purchase lines used, newest first, in count units. */
  used: { piNo: string; date: string; supplier: string; qty: number; unitSen: number }[];
  /** Counted beyond every purchase on file, priced at the oldest line's price. */
  beyondQty: number;
  beyondUnitSen: number;
  /** Lines left out: priced more than `band`× away from the newest line. */
  skipped: number;
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Newest first: by invoice date, then purchase-invoice number. */
export function sortLayersNewestFirst<T extends { date: string; piNo: string }>(layers: T[]): T[] {
  return [...layers].sort((a, b) => b.date.localeCompare(a.date) || b.piNo.localeCompare(a.piNo));
}

/**
 * The FIFO value of `countQty` from an item's purchase lines (any order; on or
 * before month end). null when there is no usable line — the caller falls back
 * to the price list or a typed price.
 */
export function fifoValue(countQty: number, layers: PiLayer[], opts: { factor?: number | null; band?: number } = {}): FifoResult | null {
  const factor = typeof opts.factor === "number" && Number.isFinite(opts.factor) && opts.factor > 0 ? opts.factor : 1;
  const band = opts.band ?? 2;
  const lines = sortLayersNewestFirst(layers.filter((l) => l.qty > 0 && l.unitSen > 0)).map((l) => ({
    ...l,
    qty: round4(l.qty * factor),
    unitSen: round4(l.unitSen / factor),
  }));
  if (!lines.length) return null;
  const ref = lines[0].unitSen;
  const kept = lines.filter((l) => l.unitSen >= ref / band && l.unitSen <= ref * band);
  const skipped = lines.length - kept.length;
  const qty = Math.max(0, Number(countQty) || 0);
  let rem = qty;
  let value = 0;
  const used: FifoResult["used"] = [];
  for (const l of kept) {
    if (rem <= 1e-9) break;
    const take = round4(Math.min(rem, l.qty));
    value += take * l.unitSen;
    rem = round4(rem - take);
    used.push({ piNo: l.piNo, date: l.date, supplier: l.supplier, qty: take, unitSen: l.unitSen });
  }
  const oldest = kept[kept.length - 1];
  const beyondQty = rem > 1e-9 ? rem : 0;
  if (beyondQty) value += beyondQty * oldest.unitSen;
  const valueSen = Math.round(value);
  return {
    valueSen,
    unitSen: qty > 0 ? round4(valueSen / qty) : ref,
    used,
    beyondQty,
    beyondUnitSen: oldest.unitSen,
    skipped,
  };
}

/** Sen as an RM price: 2 decimals, more only when the sen are fractional (4.5 sen → "0.045"). */
function rm(sen: number): string {
  const whole = Math.abs(sen - Math.round(sen)) < 1e-9;
  return whole ? (sen / 100).toFixed(2) : String(Math.round(sen * 100) / 10000);
}

const qtyText = (q: number) => String(round4(q));

/** "FIFO: PI-2608-048 962.4 @ 8.00 + PI-2607-060 207.9 @ 12.00 (+ N beyond purchases on file @ x)". */
export function fifoSourceText(r: FifoResult): string {
  const parts = r.used.map((u) => `${u.piNo} ${qtyText(u.qty)} @ ${rm(u.unitSen)}`);
  if (r.beyondQty > 0) parts.push(`${qtyText(r.beyondQty)} beyond purchases on file @ ${rm(r.beyondUnitSen)}`);
  return `FIFO: ${parts.join(" + ")}`;
}
