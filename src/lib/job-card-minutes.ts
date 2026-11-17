/**
 * Total production minutes for a job card. Merged FABRIC CUTTING (FAB_CUT) cards
 * store estMinutes/productionTimeMinutes as the per-SET TOTAL (sum of all
 * pieces), with wipQty = piece count — so that total must NOT be multiplied by
 * wipQty. Every other dept stores PER-PIECE minutes, so total = per-piece ×
 * wipQty. Mirrors the cost cascade, which already costs the un-multiplied total.
 */
export function jcMinutesTotal(
  perUnitMinutes: number,
  jc: { departmentCode?: string | null; wipQty?: number | null },
): number {
  if ((jc.departmentCode ?? "") === "FAB_CUT") return perUnitMinutes || 0;
  return (perUnitMinutes || 0) * Math.max(1, jc.wipQty ?? 1);
}

export interface CardPics {
  departmentCode?: string | null;
  wipQty?: number | null;
  pic1Id?: string | null;
  pic2Id?: string | null;
}

/**
 * Minutes each worker earns from a finished card: the payslip rule
 * (efficiency-allowance.ts). The card's two PIC slots share it, half each when
 * both are filled; who scanned which piece does not change the split.
 */
export function creditCardToPics(perUnitMinutes: number, card: CardPics): Map<string, number> {
  const slots = [card.pic1Id, card.pic2Id].filter((id): id is string => !!id);
  const credit = new Map<string, number>();
  const share = jcMinutesTotal(perUnitMinutes, card) / Math.max(1, slots.length);
  for (const workerId of slots) credit.set(workerId, (credit.get(workerId) ?? 0) + share);
  return credit;
}
