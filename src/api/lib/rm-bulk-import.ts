// HK-0002: a batch-import UPDATE must never clear a stored value. A blank,
// null or absent cell asserts nothing, so it keeps what is stored; a typed
// value (including an explicit 0) wins. Mirrors shapeProductBulkRow.
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
    notes: typeof r.notes === "string" && r.notes !== "" ? r.notes : prior.notes,
    uomCount: num(r.uomCount, prior.uomCount),
    itemType: blank(r.itemType) ? prior.itemType : str(r.itemType),
    stockControl: blank(r.stockControl) ? prior.stockControl : Number(r.stockControl) === 0 ? 0 : 1,
    mainSupplierCode: blank(r.mainSupplierCode) ? prior.mainSupplierCode : str(r.mainSupplierCode),
  };
}
