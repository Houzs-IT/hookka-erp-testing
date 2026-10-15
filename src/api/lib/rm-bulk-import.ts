// HK-0002: a batch-import UPDATE must never clear a stored value. A blank,
// null or absent cell asserts nothing, so it keeps what is stored; a typed
// value (including an explicit 0) wins. Mirrors shapeProductBulkRow.
// To empty a nullable text field (notes / itemType / supplier code) a sheet
// types the explicit token [CLEAR]; blank still keeps.
export const RM_CLEAR_TOKEN = "[CLEAR]";
export type RmBulkStored = {
  description: string;
  itemGroup: string;
  status: string;
  minStock: number;
  maxStock: number;
  notes: string | null;
  uomCount: number;
  itemType: string | null;
  stockControl: number;
  mainSupplierCode: string | null;
};

type Cell = unknown;
const blank = (v: Cell) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const str = (v: Cell) => String(v).trim();
const isClear = (v: Cell) => typeof v === "string" && v.trim().toUpperCase() === RM_CLEAR_TOKEN;
// Nullable text: [CLEAR] -> NULL, blank -> keep, else the trimmed value.
const text = (v: Cell, keep: string | null) => (isClear(v) ? null : blank(v) ? keep : str(v));
// 0/1/true/false only; anything else is not an assertion, so keep.
const flag = (v: Cell, keep: number) => {
  if (v === true || v === 1 || v === "1" || (typeof v === "string" && v.trim().toLowerCase() === "true")) return 1;
  if (v === false || v === 0 || v === "0" || (typeof v === "string" && v.trim().toLowerCase() === "false")) return 0;
  return keep;
};
const num = (v: Cell, keep: number) => (blank(v) || !Number.isFinite(Number(v)) ? keep : Number(v));

export function mergeRmBulkUpdate(prior: RmBulkStored, r: Record<string, Cell>): RmBulkStored {
  const status = !blank(r.status)
    ? str(r.status)
    : r.isActive === true ? "ACTIVE" : r.isActive === false ? "INACTIVE" : prior.status;
  return {
    description: blank(r.description) ? prior.description : str(r.description),
    itemGroup: blank(r.itemGroup) ? prior.itemGroup : str(r.itemGroup),
    status,
    minStock: num(r.minStock, prior.minStock),
    maxStock: num(r.maxStock, prior.maxStock),
    notes: text(r.notes, prior.notes),
    uomCount: num(r.uomCount, prior.uomCount),
    itemType: text(r.itemType, prior.itemType),
    stockControl: flag(r.stockControl, prior.stockControl),
    mainSupplierCode: text(r.mainSupplierCode, prior.mainSupplierCode),
  };
}
