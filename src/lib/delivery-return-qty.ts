// What is still returnable on each delivery-order line (HK-0110).
//
// Returns are recorded per production order, not per DO line, so a production
// order's already-returned quantity is split across the DO lines carrying it,
// in line order. Two lines with the same production order are then not each
// reduced by the whole amount. Used by the "New return" picker (default / max
// quantity) and by the invoice (what is still billable after returns).
export function returnableByLine(
  lines: { productionOrderId?: string | null; quantity?: number | null }[],
  returnedByPo: Map<string, number>,
): number[] {
  const left = new Map(returnedByPo);
  return lines.map((l) => {
    const delivered = Math.max(0, Number(l.quantity) || 0);
    const po = l.productionOrderId ?? "";
    if (!po) return delivered;
    const used = Math.min(left.get(po) ?? 0, delivered);
    left.set(po, (left.get(po) ?? 0) - used);
    return delivered - used;
  });
}
