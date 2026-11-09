// ---------------------------------------------------------------------------
// rm-rename.ts — renaming a raw material's code carries its references along.
//
// A raw material is joined by CODE in a few standing tables. Renaming the code
// on the Raw Materials page used to update the material row (and the fabric
// mirror) only, so afterwards:
//   • supplier_material_bindings still named the old code — the PO screen's
//     "cheapest supplier" lookup found no supplier for the material;
//   • component_bom_lines still listed the old code as a child — the BOM
//     cascade issued nothing for it;
//   • price_histories stayed on the old code — the price trail broke.
// (Houzs review list, owner 2026-11-08.) These now move with the rename, in
// the same batch as the material update.
//
// Documents are NOT rewritten: a PO, GRN or PI line keeps the code it was
// issued with, which is what an audit expects to read.
//
// A rename is only carried when it is unambiguous: if ANOTHER raw material
// already holds the old or the new code, re-pointing would hand that row's
// bindings to the wrong material, so nothing is moved and the caller is told.
// ---------------------------------------------------------------------------
import { ensureComponentBomTable } from "./component-bom";

export const normRmCode = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export type RmRenamePlan =
  | { carried: true; statements: D1PreparedStatement[] }
  | { carried: false; statements: []; reason: string };

export async function buildRmRenameStatements(
  db: D1Database,
  rmId: string,
  oldCode: string,
  newCode: string,
): Promise<RmRenamePlan> {
  const from = normRmCode(oldCode);
  const to = normRmCode(newCode);
  if (!from || !to || from === to) return { carried: false, statements: [], reason: "code unchanged" };
  const clash = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM raw_materials
        WHERE id <> ? AND UPPER(TRIM(itemCode)) IN (?, ?)`,
    )
    .bind(rmId, from, to)
    .first<{ n: number | string }>();
  if (Number(clash?.n ?? 0) > 0) {
    return {
      carried: false,
      statements: [],
      reason: `another raw material already uses ${from} or ${to}; supplier bindings, BOM lines and price history were left on ${from}`,
    };
  }
  await ensureComponentBomTable(db);
  return {
    carried: true,
    statements: [
      db.prepare("UPDATE supplier_material_bindings SET materialCode = ? WHERE UPPER(TRIM(materialCode)) = ?").bind(newCode.trim(), from),
      db.prepare("UPDATE component_bom_lines SET child_code = ? WHERE UPPER(TRIM(child_code)) = ?").bind(newCode.trim(), from),
      db.prepare("UPDATE price_histories SET material_code = ? WHERE UPPER(TRIM(material_code)) = ?").bind(newCode.trim(), from),
    ],
  };
}
