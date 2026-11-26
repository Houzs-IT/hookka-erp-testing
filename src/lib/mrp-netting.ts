// ---------------------------------------------------------------------------
// MRP netting — pure, no I/O (owner 2026-11-23, ported from the Houzs
// computeMrp greedy allocator, minus everything retail).
//
// Per raw material, demands are served in NEED-BY order (earliest first; an
// order with no date goes last):
//   1. stock on hand (raw_materials.balanceQty, never below 0);
//   2. then open purchase-order lines, earliest ETA first (no ETA last);
//   3. whatever is left is SHORT.
//
// Need-by is decided by the caller: the due date of the job card that
// consumes the material (the department's own production due date), else the
// production order's target date — 「production duedate才是更高级的」.
// ---------------------------------------------------------------------------

export type MrpDemand = {
  rmId: string;
  required: number;
  needBy: string; // YYYY-MM-DD, or "" when unknown
  sortKey: string; // tie-breaker, e.g. the production-order number
};

export type MrpSupply = {
  rmId: string;
  ref: string; // PO number
  eta: string; // YYYY-MM-DD, or ""
  qty: number;
};

export type MrpCover =
  | { source: "STOCK"; qty: number }
  | { source: "PO"; ref: string; eta: string; qty: number };

export type MrpAllocation<D extends MrpDemand> = {
  demand: D;
  covers: MrpCover[];
  shortQty: number;
};

const EPS = 1e-9;

// "" sorts after every real date.
const dateKey = (d: string): string => (d && d.length >= 10 ? d.slice(0, 10) : "9999-99-99");

export function netMaterial<D extends MrpDemand>(
  demands: D[],
  stockQty: number,
  supplies: MrpSupply[],
): MrpAllocation<D>[] {
  let stock = Math.max(0, Number.isFinite(stockQty) ? stockQty : 0);
  const pos = supplies
    .filter((s) => s.qty > EPS)
    .map((s) => ({ ...s, left: s.qty }))
    .sort((a, b) => dateKey(a.eta).localeCompare(dateKey(b.eta)) || a.ref.localeCompare(b.ref));
  const ordered = demands
    .slice()
    .sort(
      (a, b) =>
        dateKey(a.needBy).localeCompare(dateKey(b.needBy)) || a.sortKey.localeCompare(b.sortKey),
    );
  const out: MrpAllocation<D>[] = [];
  for (const d of ordered) {
    let need = Math.max(0, d.required);
    const covers: MrpCover[] = [];
    if (need > EPS && stock > EPS) {
      const take = Math.min(stock, need);
      stock -= take;
      need -= take;
      covers.push({ source: "STOCK", qty: take });
    }
    for (const p of pos) {
      if (need <= EPS) break;
      if (p.left <= EPS) continue;
      const take = Math.min(p.left, need);
      p.left -= take;
      need -= take;
      covers.push({ source: "PO", ref: p.ref, eta: p.eta, qty: take });
    }
    out.push({ demand: d, covers, shortQty: need > EPS ? need : 0 });
  }
  return out;
}

// Stock status of one demand (one WIP's material) — for the future
// Production Tracking "Stock" column: READY = all from stock, WAITING_PO =
// nothing short but some still on an open PO, SHORT = some not covered.
export type MrpStockStatus = "READY" | "WAITING_PO" | "SHORT";

export function statusOf(a: { covers: MrpCover[]; shortQty: number }): MrpStockStatus {
  if (a.shortQty > EPS) return "SHORT";
  return a.covers.some((c) => c.source === "PO") ? "WAITING_PO" : "READY";
}
