// HK-0118 — does an SO edit touch anything its production orders were built
// from? The PUT rebuilds every PO / job card from sales_order_items when the
// items change, but a PO that already produced finished goods has fg_batches
// rows (FK without CASCADE, and they are cost lots), so the rebuild cannot
// delete it. Prices, discounts and specials' surcharges never reach a PO, so
// an edit that only changes those can keep production as it is.
//
// Fields are the ones the rebuild hands to createProductionOrdersForOrder.
// productName / sizeLabel are left out: the PUT re-snaps them from the
// catalog, so a catalog rename would read as a change nobody made.

export interface SoProductionLine {
  lineNo: number;
  productId?: string | null;
  productCode?: string | null;
  itemCategory?: string | null;
  sizeCode?: string | null;
  fabricCode?: string | null;
  quantity?: number | null;
  gapInches?: unknown;
  divanHeightInches?: unknown;
  legHeightInches?: unknown;
  specialOrder?: string | null;
  notes?: string | null;
  repairScope?: string | null;
  repairscope?: string | null;
}

const str = (v: unknown) => String(v ?? "").trim().toUpperCase();
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

function lineKey(l: SoProductionLine): string {
  return JSON.stringify([
    str(l.productId),
    str(l.productCode),
    str(l.itemCategory),
    str(l.sizeCode),
    str(l.fabricCode),
    num(l.quantity),
    num(l.gapInches),
    num(l.divanHeightInches),
    num(l.legHeightInches),
    str(l.specialOrder),
    str(l.notes),
    str(l.repairScope ?? l.repairscope),
  ]);
}

export function soProductionLinesChanged(
  before: SoProductionLine[],
  after: SoProductionLine[],
): boolean {
  if (before.length !== after.length) return true;
  const a = [...before].sort((x, y) => x.lineNo - y.lineNo).map(lineKey);
  const b = [...after].sort((x, y) => x.lineNo - y.lineNo).map(lineKey);
  return a.some((k, i) => k !== b[i]);
}

export interface SoProductionHeader {
  customerId?: string | null;
  customerState?: string | null;
  reference?: string | null;
  customerPOId?: string | null;
  companySODate?: string | null;
}

// Header fields the rebuild copies onto each PO. Delivery dates are not here:
// the PUT re-dates POs and job cards in place when the rebuild does not run.
export function soProductionHeaderChanged(before: SoProductionHeader, after: SoProductionHeader): boolean {
  return (
    str(before.customerId) !== str(after.customerId) ||
    str(before.customerState) !== str(after.customerState) ||
    str(before.reference) !== str(after.reference) ||
    str(before.customerPOId) !== str(after.customerPOId) ||
    str(before.companySODate).slice(0, 10) !== str(after.companySODate).slice(0, 10)
  );
}
