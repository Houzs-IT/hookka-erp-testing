// ---------------------------------------------------------------------------
// bom-single-active.ts — a product has at most ONE ACTIVE BOM.
//
// Nothing enforced it, and readers chose differently when there were two
// (po-cost-cascade took any row, products.ts the newest effectiveFrom), so a
// costing, a PO cost and a job card could each read a different BOM. Found
// 2026-11-22 (docs/plans/product-costing.md "Known gaps"); prod had 0 such
// products that day, so this only stops new ones.
//
// Rule: making a BOM ACTIVE retires the product's other ACTIVE BOMs to
// OBSOLETE (kept, not deleted — the history stays readable).
// ---------------------------------------------------------------------------

export function demoteOtherActiveBomsStatement(
  db: D1Database,
  productCode: string,
  keepId: string,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE bom_templates SET versionStatus = 'OBSOLETE' WHERE productCode = ? AND id <> ? AND versionStatus = 'ACTIVE'",
    )
    .bind(productCode, keepId);
}

/** For a whole set written at once: per product, keep the ACTIVE row with
 *  the newest effectiveFrom (last one wins on a tie); the others become
 *  OBSOLETE. Mutates and returns the array. */
export function oneActivePerProduct<
  T extends { productCode: string; versionStatus: string; effectiveFrom: string },
>(rows: T[]): T[] {
  const keep = new Map<string, T>();
  for (const r of rows) {
    if (r.versionStatus !== "ACTIVE") continue;
    const cur = keep.get(r.productCode);
    if (!cur || r.effectiveFrom >= cur.effectiveFrom) keep.set(r.productCode, r);
  }
  for (const r of rows) {
    if (r.versionStatus === "ACTIVE" && keep.get(r.productCode) !== r) {
      (r as { versionStatus: string }).versionStatus = "OBSOLETE";
    }
  }
  return rows;
}
