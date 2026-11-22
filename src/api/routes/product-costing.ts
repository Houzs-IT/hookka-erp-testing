// ---------------------------------------------------------------------------
// /api/product-costing — what one finished good costs to make (owner
// 2026-11-22, docs/plans/product-costing.md). The maths is the pure engine in
// src/lib/product-costing.ts; this route only gathers its inputs:
//
//   GET  /fabric-tiers            the per-metre fabric price tiers (D9)
//   PUT  /fabric-tiers            save them (products:update)
//   GET  /:productId?tier=Lv2     the costing of the product's ACTIVE BOM
//
// Read-only on business data: nothing here writes a BOM, a price or a cost.
// The BOM is the same row the BOM page edits (bom_templates), so a change
// there shows here on the next read — one data path (D6).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { emitAudit } from "../lib/audit";
import { todayYmdMY } from "../../lib/utils";
import {
  computeCosting,
  normaliseFabricTiers,
  priceInEffect,
  type BindingIn,
  type PriceHistoryIn,
  type BomIn,
  type RawMaterialIn,
} from "../../lib/product-costing";

const app = new Hono<Env>();

const TIERS_KEY = "costing-fabric-tiers";

function parse<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function loadTiers(db: D1Database) {
  const row = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind(TIERS_KEY)
    .first<{ value: string }>()
    .catch(() => null);
  return normaliseFabricTiers(parse(row?.value ?? null, null));
}

async function loadSheetDefaults(db: D1Database): Promise<Record<string, { length: number; width: number }>> {
  const out: Record<string, { length: number; width: number }> = {};
  const row = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind("variants-config")
    .first<{ value: string }>()
    .catch(() => null);
  const sd = parse<{ sheetDefaults?: Record<string, { length?: unknown; width?: unknown }> }>(row?.value ?? null, {})
    ?.sheetDefaults;
  if (sd && typeof sd === "object") {
    for (const [k, v] of Object.entries(sd)) {
      const l = Number(v?.length);
      const w = Number(v?.width);
      if (l > 0 && w > 0) out[k.toUpperCase()] = { length: l, width: w };
    }
  }
  return out;
}

app.get("/fabric-tiers", async (c) => {
  const denied = await requirePermission(c, "products", "read");
  if (denied) return denied;
  return c.json({ success: true, data: await loadTiers(c.var.DB) });
});

app.put("/fabric-tiers", async (c) => {
  const denied = await requirePermission(c, "products", "update");
  if (denied) return denied;
  const body = await c.req.json().catch(() => null);
  const incoming = (body as { tiers?: unknown } | null)?.tiers;
  const tiers = normaliseFabricTiers(incoming);
  // normalise falls back to the defaults on bad input; refuse instead of
  // silently saving something the owner did not type.
  if (!Array.isArray(incoming) || incoming.length !== tiers.length) {
    return c.json({ success: false, error: "Each tier needs a name and a min ≤ max price (sen) above 0." }, 400);
  }
  const before = await loadTiers(c.var.DB);
  await c.var.DB.prepare(
    `INSERT INTO kv_config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(TIERS_KEY, JSON.stringify(tiers), new Date().toISOString())
    .run();
  await emitAudit(c, { resource: "costing-settings", resourceId: TIERS_KEY, action: "update", before, after: tiers });
  return c.json({ success: true, data: tiers });
});

type TemplateRow = {
  id: string;
  productCode: string;
  version: string | null;
  versionStatus: string | null;
  effectiveFrom: string | null;
  l1Processes: string | null;
  wipComponents: string | null;
  l1_materials?: string | null;
  l1Materials?: string | null;
};

app.get("/:productId", async (c) => {
  const denied = await requirePermission(c, "products", "read");
  if (denied) return denied;
  const db = c.var.DB;
  const productId = c.req.param("productId");
  const product = await db
    .prepare("SELECT id, code, name, category FROM products WHERE id = ? OR code = ? LIMIT 1")
    .bind(productId, productId)
    .first<{ id: string; code: string; name: string; category: string }>();
  if (!product) return c.json({ success: false, error: "Product not found" }, 404);

  // The ACTIVE BOM (one per product since D14); a product with only a draft
  // still gets a costing, flagged so the page can say so.
  const tpl = await db
    .prepare(
      `SELECT * FROM bom_templates WHERE productCode = ?
         ORDER BY CASE WHEN versionStatus = 'ACTIVE' THEN 0 WHEN versionStatus = 'DRAFT' THEN 1 ELSE 2 END,
                  effectiveFrom DESC
         LIMIT 1`,
    )
    .bind(product.code)
    .first<TemplateRow>();

  const bom: BomIn = tpl
    ? {
        l1Processes: parse(tpl.l1Processes, []),
        l1Materials: parse(tpl.l1_materials ?? tpl.l1Materials ?? null, []),
        wipComponents: parse(tpl.wipComponents, []),
      }
    : {};

  const [rmRes, bindRes, histRes, fabricTiers, sheetDefaults] = await Promise.all([
    db.prepare("SELECT * FROM raw_materials").all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT b.id AS "id", b.materialCode AS "materialCode", b.unitPrice AS "unitPrice", b.currency AS "currency",
                b.isMainSupplier AS "isMainSupplier", COALESCE(b.effectiveFrom, b.priceValidFrom) AS "effectiveFrom",
                s.name AS "supplierName"
           FROM supplier_material_bindings b
           LEFT JOIN suppliers s ON s.id = b.supplierId`,
      )
      .all<BindingIn & { id: string }>(),
    db
      .prepare(
        `SELECT bindingId AS "bindingId", oldPrice AS "oldPrice", newPrice AS "newPrice",
                COALESCE(effectiveFrom, changedDate) AS "effectiveFrom", changedDate AS "changedDate"
           FROM price_histories`,
      )
      .all<PriceHistoryIn & { bindingId: string }>()
      .catch(() => ({ results: [] as (PriceHistoryIn & { bindingId: string })[] })),
    loadTiers(db),
    loadSheetDefaults(db),
  ]);
  const rawMaterials: RawMaterialIn[] = (rmRes.results ?? []).map((r) => ({
    itemCode: String(r.itemCode ?? r.item_code ?? ""),
    description: (r.description ?? null) as string | null,
    baseUOM: (r.baseUOM ?? r.base_uom ?? null) as string | null,
    itemGroup: (r.itemGroup ?? r.item_group ?? null) as string | null,
    sheetLengthIn: (r.sheet_length_in ?? r.sheetLengthIn ?? null) as number | null,
    sheetWidthIn: (r.sheet_width_in ?? r.sheetWidthIn ?? null) as number | null,
  }));

  // Each supplier price as it stands TODAY: a saved future price has not
  // started yet (effective-dated, like customer prices).
  const today = todayYmdMY();
  const historyBy = new Map<string, PriceHistoryIn[]>();
  for (const h of histRes.results ?? []) {
    const list = historyBy.get(h.bindingId) ?? [];
    list.push(h);
    historyBy.set(h.bindingId, list);
  }
  const bindings: BindingIn[] = [];
  for (const b of bindRes.results ?? []) {
    const now = priceInEffect(b, historyBy.get(b.id) ?? [], today);
    if (now) bindings.push({ ...b, unitPrice: now.priceSen, effectiveFrom: now.effectiveFrom || b.effectiveFrom });
  }

  const tier = c.req.query("tier") ?? undefined;
  const costing = computeCosting(
    { bom, rawMaterials, bindings, fabricTiers, sheetDefaults },
    { tier },
  );
  return c.json({
    success: true,
    data: {
      product,
      bom: tpl
        ? { id: tpl.id, version: tpl.version, status: tpl.versionStatus, effectiveFrom: tpl.effectiveFrom }
        : null,
      fabricTiers,
      ...costing,
    },
  });
});

export default app;
