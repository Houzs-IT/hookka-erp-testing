// ---------------------------------------------------------------------------
// rm-merge-data.ts — loads the raw material rows, how often each code is used
// and what stock each row holds, and writes a merge. Stock and cost move to the
// kept row; the retired row stays, inactive, so the merge can be undone.
// ---------------------------------------------------------------------------
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { planRmMerge, retiredCode, type RmMergePlan, type RmRow } from "../../lib/rm-merge";

export type RmMergeLoad = {
  plan: RmMergePlan;
  stockByRow: Map<string, number>;
  balanceByRow: Map<string, number>;
  usageByCode: Map<string, number>;
};

export async function loadRmMerge(db: D1Database, orgId: string): Promise<RmMergeLoad> {
  const [rowsRes, piRes, poRes, ordRes, stockRes] = await Promise.all([
    db
      .prepare(
        `SELECT id AS "id", itemCode AS "itemCode", description AS "description",
                itemGroup AS "itemGroup", created_at AS "createdAt", balanceQty AS "balanceQty"
           FROM raw_materials
          WHERE orgId = ? AND isActive = 1 AND itemCode NOT LIKE '%~MERGED~%'`,
      )
      .bind(orgId)
      .all<RmRow & { balanceQty: number }>(),
    db
      .prepare(
        `SELECT pii.materialCode AS "code", COUNT(*) AS "n"
           FROM purchase_invoice_items pii
           JOIN purchase_invoices pi ON pi.id = pii.piId
          WHERE pi.orgId = ? AND pi.status <> 'CANCELLED'
          GROUP BY pii.materialCode`,
      )
      .bind(orgId)
      .all<{ code: string | null; n: number }>(),
    db
      .prepare(
        `SELECT poi.material_code AS "code", COUNT(*) AS "n"
           FROM purchase_order_items poi
          WHERE poi.material_code IS NOT NULL
          GROUP BY poi.material_code`,
      )
      .all<{ code: string | null; n: number }>(),
    db
      .prepare(
        `SELECT fabricCode AS "code", COUNT(*) AS "n"
           FROM production_orders
          WHERE orgId = ? AND fabricCode IS NOT NULL
          GROUP BY fabricCode`,
      )
      .bind(orgId)
      .all<{ code: string | null; n: number }>(),
    db
      .prepare(`SELECT rmId AS "rmId", SUM(remainingQty) AS "qty" FROM rm_batches WHERE remainingQty > 0 GROUP BY rmId`)
      .all<{ rmId: string; qty: number }>(),
  ]);

  const usageByCode = new Map<string, number>();
  for (const r of [...(piRes.results ?? []), ...(poRes.results ?? []), ...(ordRes.results ?? [])]) {
    const code = String(r.code ?? "").trim().toUpperCase();
    if (code) usageByCode.set(code, (usageByCode.get(code) ?? 0) + (Number(r.n) || 0));
  }
  const stockByRow = new Map((stockRes.results ?? []).map((r) => [r.rmId, Number(r.qty) || 0]));
  const rows = rowsRes.results ?? [];
  return {
    plan: planRmMerge(rows, usageByCode, stockByRow),
    stockByRow,
    balanceByRow: new Map(rows.map((r) => [r.id, Number(r.balanceQty) || 0])),
    usageByCode,
  };
}

export function rmMergeStatements(db: D1Database, orgId: string, load: RmMergeLoad): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (const g of load.plan.groups) {
    let moved = 0;
    for (const l of g.losers) {
      moved += load.balanceByRow.get(l.id) ?? 0;
      out.push(db.prepare("UPDATE rm_batches SET rmId = ? WHERE rmId = ?").bind(g.keep.id, l.id));
      out.push(db.prepare("UPDATE cost_ledger SET itemId = ? WHERE itemType = 'RM' AND itemId = ?").bind(g.keep.id, l.id));
      if (l.itemCode !== g.keep.itemCode) {
        // A supplier already bound to the kept code keeps that binding and price.
        out.push(
          db
            .prepare(
              `UPDATE supplier_material_bindings SET materialCode = ?
                WHERE orgId = ? AND materialCode = ?
                  AND supplierId NOT IN (
                    SELECT supplierId FROM supplier_material_bindings WHERE orgId = ? AND materialCode = ?
                  )`,
            )
            .bind(g.keep.itemCode, orgId, l.itemCode, orgId, g.keep.itemCode),
        );
      }
      out.push(
        db
          .prepare("UPDATE raw_materials SET itemCode = ?, isActive = 0, status = 'INACTIVE', balanceQty = 0 WHERE id = ?")
          .bind(retiredCode(l, g.keep.itemCode), l.id),
      );
    }
    out.push(
      db
        .prepare("UPDATE raw_materials SET balanceQty = balanceQty + ?, description = COALESCE(?, description) WHERE id = ?")
        .bind(moved, g.description, g.keep.id),
    );
  }
  return out;
}
