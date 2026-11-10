/**
 * Review C2-8 (Conts#810, from Houzs#4899) — a deactivated raw material can't
 * be NEWLY added to a purchase order. The PO picker already hides inactive
 * materials (`procurement/create.tsx` `activeRMs`); the server now refuses
 * too, so an import, an old tab or a copied PO can't slip one in.
 *
 * "Newly added" = a line whose material code the PO does not already carry.
 * A line that was on the PO before its material was deactivated stays
 * editable. A code counts as inactive only when EVERY raw-material row for it
 * is inactive (one code can have several unit rows; a retired unit row must
 * not block the live one).
 */
export type RmActiveRow = {
  itemCode?: string | null;
  isActive?: number | boolean | string | null;
  status?: string | null;
};

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

export function rmRowIsActive(r: RmActiveRow): boolean {
  const st = norm(r.status);
  if (st === "INACTIVE") return false;
  const a = r.isActive;
  if (a === false || a === 0 || a === "0" || a === "false" || a === "f") return false;
  return true;
}

/** Codes whose every raw-material row is inactive. */
export function inactiveCodesFromRows(rows: RmActiveRow[]): Set<string> {
  const anyActive = new Map<string, boolean>();
  for (const r of rows) {
    const code = norm(r.itemCode);
    if (!code) continue;
    anyActive.set(code, (anyActive.get(code) ?? false) || rmRowIsActive(r));
  }
  return new Set([...anyActive].filter(([, active]) => !active).map(([code]) => code));
}

/** Material codes on the payload that the PO does not already carry. */
export function newlyAddedCodes(
  lines: Array<{ materialCode?: unknown }>,
  existingCodes: Iterable<unknown> = [],
): string[] {
  const have = new Set([...existingCodes].map(norm).filter(Boolean));
  const out = new Set<string>();
  for (const l of lines) {
    const code = norm(l.materialCode);
    if (code && !have.has(code)) out.add(code);
  }
  return [...out];
}

export function inactiveMaterialError(codes: string[]): string {
  const list = codes.join(", ");
  return codes.length === 1
    ? `${list} is deactivated and can't be added to a purchase order. Reactivate it in Raw Materials first, or pick another material.`
    : `${list} are deactivated and can't be added to a purchase order. Reactivate them in Raw Materials first, or pick other materials.`;
}
