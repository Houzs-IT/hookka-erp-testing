// ---------------------------------------------------------------------------
// One main supplier per item — review pass 2, H2 B1 (Houzs#5077).
//
// Every bind path that saves a binding as MAIN first demotes the item's other
// main binding(s), in the same batch as the write, so the item never ends up
// with two mains. Readers (MRP `mainBindingByCode`, the PO price hint) used to
// pick whichever main they met last.
//
// Existing items that already carry more than one main are NOT repaired here
// (a prod data write needs the owner's approval): `listMultiMainItems` is the
// read-only list, served at GET /api/supplier-materials/multiple-main.
// ---------------------------------------------------------------------------
type Db = D1Database;

/**
 * The UPDATE that clears `isMainSupplier` on every OTHER binding of the item.
 * `keepId` is the binding being saved as main (its own row is never touched).
 * With `orgId` the demote stays inside that org; without it (legacy
 * single-org import paths) it matches the item code alone.
 */
export function demoteOtherMainsStatement(
  db: Db,
  materialCode: string,
  keepId: string,
  orgId?: string | null,
): D1PreparedStatement {
  // A NULL-org row is a legacy single-org binding: it belongs to the item too.
  const orgClause = orgId ? " AND (orgId = ? OR orgId IS NULL)" : "";
  return db
    .prepare(
      `UPDATE supplier_material_bindings SET isMainSupplier = 0
        WHERE materialCode = ? AND id <> ? AND isMainSupplier = 1${orgClause}`,
    )
    .bind(...(orgId ? [materialCode, keepId, orgId] : [materialCode, keepId]));
}

/** True when a body / row value means "main supplier". */
export function isMainFlag(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

export type MultiMainItem = {
  orgId: string;
  materialCode: string;
  count: number;
  bindings: Array<{ id: string; supplierId: string; supplierName: string; unitPrice: number }>;
};

type MainRow = {
  id: string;
  orgId?: string | null;
  org_id?: string | null;
  supplierId?: string | null;
  supplier_id?: string | null;
  materialCode?: string | null;
  material_code?: string | null;
  supplierName?: string | null;
  supplier_name?: string | null;
  unitPrice?: number | string | null;
  unit_price?: number | string | null;
};

/** Pure: fold main-binding rows into one entry per item with more than one main. */
export function groupMultiMainRows(rows: MainRow[]): MultiMainItem[] {
  const groups = new Map<string, MultiMainItem>();
  for (const r of rows) {
    const org = String(r.orgId ?? r.org_id ?? "");
    const materialCode = String(r.materialCode ?? r.material_code ?? "");
    const key = `${org}\u0000${materialCode}`;
    let g = groups.get(key);
    if (!g) {
      g = { orgId: org, materialCode, count: 0, bindings: [] };
      groups.set(key, g);
    }
    g.count++;
    g.bindings.push({
      id: String(r.id),
      supplierId: String(r.supplierId ?? r.supplier_id ?? ""),
      supplierName: String(r.supplierName ?? r.supplier_name ?? ""),
      unitPrice: Number(r.unitPrice ?? r.unit_price ?? 0) || 0,
    });
  }
  return [...groups.values()].filter((g) => g.count > 1);
}

/** READ-ONLY: items in this org that currently have more than one main supplier. */
export async function listMultiMainItems(db: Db, orgId?: string): Promise<MultiMainItem[]> {
  const orgFilter = orgId ? "AND orgId = ?" : "";
  const res = await db
    .prepare(
      `SELECT b.id AS "id", b.orgId AS "orgId", b.supplierId AS "supplierId",
              b.materialCode AS "materialCode", b.unitPrice AS "unitPrice", s.name AS "supplierName"
         FROM supplier_material_bindings b
         JOIN (
           SELECT orgId, materialCode
             FROM supplier_material_bindings
            WHERE isMainSupplier = 1 ${orgFilter}
            GROUP BY orgId, materialCode
           HAVING COUNT(*) > 1
         ) d ON d.orgId = b.orgId AND d.materialCode = b.materialCode
         LEFT JOIN suppliers s ON s.id = b.supplierId
        WHERE b.isMainSupplier = 1
        ORDER BY b.orgId, b.materialCode, b.id`,
    )
    .bind(...(orgId ? [orgId] : []))
    .all<MainRow>();
  return groupMultiMainRows(res.results ?? []);
}
