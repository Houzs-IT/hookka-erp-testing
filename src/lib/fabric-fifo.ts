// ---------------------------------------------------------------------------
// fabric-fifo.ts (pure) — what each month's fabric cost under first-in-first-out
// (owner 2026-11-06). Usage comes from the Fabric Usage on the cut orders, and
// the month-end stock take fixes where FIFO stands.
//
// Why not the RM_ISSUE ledger: an issue is only written when the batch has
// stock, and fabric stopped reaching rm_batches in March 2026, so it recorded
// 2,274 m of October's 7,135 m. See BUG-2026-11-06-428.
//
// How it works, per fabric. Line every receipt up oldest first as one long
// tape of metres. The counted closing stock is the newest metres on the tape,
// so everything before that point has been used. Walking back from there, the
// counted month's usage is the stretch just before it, the month before that
// the stretch before that, and so on. Months after the count run forward.
// Usage that falls off the front of the tape has no receipt to cost it, and is
// reported as unpriced rather than guessed.
// ---------------------------------------------------------------------------

export type FifoLayer = { date: string; qty: number; unitSen: number };
export type FifoMonth = { pricedMeters: number; costSen: number };

/**
 * One code for one fabric across purchasing, BOM and the count. Invoices carry
 * HOK-BO315-21 for the fabric the orders call BO315-21, and some orders carry
 * FABRICHR805-90 for HR805-90.
 */
export function fabricCodeKey(code: unknown): string {
  return String(code ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
    .replace(/^HOK-/, "")
    .replace(/^FABRIC[- ]?(?=[A-Z0-9])/, "");
}

/**
 * An OPENING batch counts as a layer unless its price is out of line with what
 * the fabric was really bought at: PC151-01 opens 12,030 m at RM 35 against
 * RM 8.50-12 on every invoice.
 */
export function openingIsCredible(openingUnitSen: number, boughtUnitSens: readonly number[]): boolean {
  if (boughtUnitSens.length === 0) return true;
  return openingUnitSen <= Math.max(...boughtUnitSens) * 1.5;
}

/** The cost of the stretch of the tape between two positions, in metres from the oldest. */
function costBetween(layers: readonly FifoLayer[], from: number, to: number): FifoMonth {
  let at = 0;
  let pricedMeters = 0;
  let costSen = 0;
  for (const l of layers) {
    const start = Math.max(from, at);
    const end = Math.min(to, at + l.qty);
    if (end > start) {
      pricedMeters += end - start;
      costSen += (end - start) * l.unitSen;
    }
    at += l.qty;
  }
  return { pricedMeters, costSen };
}

/**
 * Each month's FIFO cost for one fabric.
 * `anchorYm` is the month of the stock take, `closingMeters` what it counted.
 */
export function fifoCostByMonth(
  layers: readonly FifoLayer[],
  usageByYm: ReadonlyMap<string, number>,
  anchorYm: string,
  closingMeters: number,
): Map<string, FifoMonth> {
  const sorted = [...layers].sort((a, b) => a.date.localeCompare(b.date));
  const receivedByAnchor = sorted
    .filter((l) => l.date.slice(0, 7) <= anchorYm)
    .reduce((s, l) => s + l.qty, 0);
  const anchor = receivedByAnchor - closingMeters;
  const yms = [...usageByYm.keys()].sort();
  const out = new Map<string, FifoMonth>();

  let to = anchor;
  for (const ym of yms.filter((y) => y <= anchorYm).reverse()) {
    const used = usageByYm.get(ym) ?? 0;
    out.set(ym, costBetween(sorted, to - used, to));
    to -= used;
  }
  let from = anchor;
  for (const ym of yms.filter((y) => y > anchorYm)) {
    const used = usageByYm.get(ym) ?? 0;
    out.set(ym, costBetween(sorted, from, from + used));
    from += used;
  }
  return out;
}

/** Counted metres: a count in rolls is turned into metres by its value at the metre price. */
export function countedMeters(
  line: { qty?: unknown; uom?: unknown; valueSen?: unknown },
  meterUnitSen: number,
): number {
  const uom = String(line.uom ?? "").trim().toUpperCase();
  if (uom === "MTR" || uom === "M" || uom === "METER" || uom === "METRE") return Number(line.qty) || 0;
  return meterUnitSen > 0 ? (Number(line.valueSen) || 0) / meterUnitSen : 0;
}
