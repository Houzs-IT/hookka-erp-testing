/**
 * Review H2-2 / C2-5 (Houzs#4892, follow-ups #5026 / #5034; Conts#806) —
 * "Copy as new" on a Purchase Order. Opens New PO (`/procurement/create?copyFrom=<id>`)
 * pre-filled with the supplier, purchase company, notes and lines (item,
 * supplier SKU, qty, price, unit). NOT copied: the number, status, every date
 * (Expected Date blank; the order date is set by the server on save),
 * received qty, and any SO link.
 *
 * Re-checked on the copy:
 *  - a line whose material is deactivated (every Raw Materials row for the
 *    code inactive) is left out — the server would refuse it (review C2-8);
 *  - a line whose code is no longer in Raw Materials is left out (a one-off
 *    line the picker could not add today);
 *  - a one-off promo / reward / free-gift line is left out (Hookka PO lines
 *    carry no promo fields; a line is treated as one by its category).
 * The caller shows what was left out.
 */
export type CopySourceLine = {
  materialCategory?: string | null;
  materialCode?: string | null;
  materialName?: string | null;
  supplierSKU?: string | null;
  quantity?: number | null;
  unitPriceSen?: number | null;
  unit?: string | null;
};
export type CopySourcePo = {
  poNo?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  purchaseOrgCode?: string | null;
  notes?: string | null;
  items?: CopySourceLine[] | null;
};
export type CopyRm = {
  id: string;
  itemCode: string;
  description: string;
  baseUOM: string;
  itemGroup: string;
  isActive: boolean;
};
export type CopiedLine = {
  rmId: string;
  rmCode: string;
  rmDescription: string;
  supplierSku: string;
  quantity: number;
  unitPriceSen: number;
  unit: string;
  materialCategory: string;
};
export type PoCopySeed = {
  supplierId: string;
  purchaseOrgCode: string;
  notes: string;
  lines: CopiedLine[];
  droppedInactive: string[];
  droppedUnknown: string[];
  droppedOneOff: string[];
};

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/** Category words that mark a one-off promotional line (never re-ordered as is). */
export const ONE_OFF_LINE_RE = /\b(PROMO|PROMOTION|REWARD|PWP|FREE ?GIFT|FOC)\b/i;

export function isOneOffLine(l: CopySourceLine): boolean {
  return ONE_OFF_LINE_RE.test(String(l.materialCategory ?? ""));
}

/** Code of a PO line: materialCode, else the "CODE - description" prefix of the name. */
export function copyLineCode(l: CopySourceLine): string {
  const code = String(l.materialCode ?? "").trim();
  if (code) return code;
  const name = String(l.materialName ?? "");
  const dash = name.indexOf(" - ");
  return dash > 0 ? name.slice(0, dash).trim() : "";
}

export function buildPoCopySeed(po: CopySourcePo, rawMaterials: CopyRm[]): PoCopySeed {
  const byCode = new Map<string, CopyRm[]>();
  for (const rm of rawMaterials) {
    const k = norm(rm.itemCode);
    (byCode.get(k) ?? byCode.set(k, []).get(k)!).push(rm);
  }
  const seed: PoCopySeed = {
    supplierId: String(po.supplierId ?? ""),
    purchaseOrgCode: String(po.purchaseOrgCode ?? "").trim() || "HOOKKA",
    notes: String(po.notes ?? ""),
    lines: [],
    droppedInactive: [],
    droppedUnknown: [],
    droppedOneOff: [],
  };
  for (const l of po.items ?? []) {
    const code = copyLineCode(l);
    const label = code || String(l.materialName ?? "").trim() || "(blank line)";
    if (isOneOffLine(l)) {
      seed.droppedOneOff.push(label);
      continue;
    }
    const rows = byCode.get(norm(code)) ?? [];
    if (!code || rows.length === 0) {
      seed.droppedUnknown.push(label);
      continue;
    }
    const active = rows.filter((r) => r.isActive);
    if (active.length === 0) {
      seed.droppedInactive.push(label);
      continue;
    }
    // One code can be several unit rows (ROLL / MTR): keep the line's unit row.
    const unit = String(l.unit ?? "").trim();
    const rm = active.find((r) => norm(r.baseUOM) === norm(unit)) ?? active[0];
    seed.lines.push({
      rmId: rm.id,
      rmCode: rm.itemCode,
      rmDescription: rm.description,
      supplierSku: String(l.supplierSKU ?? ""),
      quantity: Number(l.quantity) || 0,
      unitPriceSen: Math.max(0, Number(l.unitPriceSen) || 0),
      unit: unit || rm.baseUOM,
      materialCategory: String(l.materialCategory ?? "") || rm.itemGroup,
    });
  }
  return seed;
}

/** One-line notice of what the copy left out ("" when nothing was). */
export function poCopyNotice(seed: PoCopySeed): string {
  const parts: string[] = [];
  if (seed.droppedInactive.length) parts.push(`deactivated: ${seed.droppedInactive.join(", ")}`);
  if (seed.droppedUnknown.length) parts.push(`no longer in Raw Materials: ${seed.droppedUnknown.join(", ")}`);
  if (seed.droppedOneOff.length) parts.push(`one-off promo lines: ${seed.droppedOneOff.join(", ")}`);
  if (!parts.length) return "";
  const n = seed.droppedInactive.length + seed.droppedUnknown.length + seed.droppedOneOff.length;
  return `${n} line${n === 1 ? "" : "s"} left out of the copy (${parts.join("; ")}).`;
}
