// HK-0169 — the unit a SCANNED purchase-invoice line is billed in.
// A supplier may bill a PO line in another unit (PO in ROLL, invoice in MTR).
// The read or picked unit is kept when it is a known RM unit; a misread unit
// (not on the list) falls back to the PO line's unit, since the server would
// refuse it. Billed in another unit, the line must say how much of the PO line
// it covers (po_qty, HK-0149): there is no conversion rate to work it out.
import { isUomAllowed, sameUom } from "./material-variants";

export function scanPiLineUnit(
  line: { uom?: string | null; poQty?: number | null },
  poUnit: string | null | undefined,
  units: string[],
): { uom: string | null; poQty: number | null; missingPoQty: boolean } {
  const u = (line.uom ?? "").trim().toUpperCase();
  if (!poUnit || !u || sameUom(u, poUnit) || !isUomAllowed(u, units)) {
    return { uom: null, poQty: null, missingPoQty: false };
  }
  const poQty = line.poQty ?? null;
  // 0 counts as missing: the cell turns a cleared box into 0, and a line covering none of its PO line leaves it open.
  return { uom: u, poQty, missingPoQty: !(Number(poQty) > 0) };
}
