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
import { actorName } from "../lib/actor-name";
import { memoizeSelfApply, runSelfApply, selfApplyForRead } from "../lib/self-apply";
import { todayYmdMY } from "../../lib/utils";
import {
  computeCosting,
  normaliseFabricTiers,
  priceInEffect,
  standardSnapshot,
  type BindingIn,
  type StandardSnapshot,
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

type Product = { id: string; code: string; name: string; category: string };

// Everything the engine needs besides the BOM — loaded once per request so
// the list summary costs every product from one read of each table.
async function loadPricingInputs(db: D1Database) {
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

  return { rawMaterials, bindings, fabricTiers, sheetDefaults };
}

const bomOf = (tpl: TemplateRow): BomIn => ({
  l1Processes: parse(tpl.l1Processes, []),
  l1Materials: parse(tpl.l1_materials ?? tpl.l1Materials ?? null, []),
  wipComponents: parse(tpl.wipComponents, []),
});

async function loadCosting(db: D1Database, productId: string, tier: string | undefined) {
  const product = await db
    .prepare("SELECT id, code, name, category FROM products WHERE id = ? OR code = ? LIMIT 1")
    .bind(productId, productId)
    .first<Product>();
  if (!product) return null;

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

  const bom: BomIn = tpl ? bomOf(tpl) : {};
  const { rawMaterials, bindings, fabricTiers, sheetDefaults } = await loadPricingInputs(db);
  const costing = computeCosting(
    { bom, rawMaterials, bindings, fabricTiers, sheetDefaults },
    { tier },
  );
  return { product, tpl, fabricTiers, costing };
}

// ---- standard cost (D3): "the cost we agreed", kept append-only ----------
// Each "Set as standard" adds a row; the newest is the standard. The page
// compares today's cost against it so a supplier price rise shows up.
let standardMemo: Promise<void> | null = null;
function ensureStandardTable(db: D1Database): Promise<void> {
  return memoizeSelfApply(
    () => standardMemo,
    (p) => {
      standardMemo = p;
    },
    () =>
      runSelfApply(db, "product-costing", [
        `CREATE TABLE IF NOT EXISTS product_standard_costs (
           id TEXT PRIMARY KEY,
           product_id TEXT NOT NULL,
           bom_id TEXT,
           labour_sen INTEGER NOT NULL,
           material_sen INTEGER NOT NULL,
           total_sen INTEGER NOT NULL,
           fabric_tier TEXT,
           snapshot TEXT,
           missing_lines INTEGER NOT NULL DEFAULT 0,
           set_at TEXT NOT NULL,
           set_by TEXT
         )`,
        "CREATE INDEX IF NOT EXISTS idx_product_standard_costs_product ON product_standard_costs (product_id, set_at)",
      ]),
  );
}

type StandardRow = {
  id: string;
  labour_sen: number;
  material_sen: number;
  total_sen: number;
  fabric_tier: string | null;
  snapshot: string | null;
  missing_lines: number;
  set_at: string;
  set_by: string | null;
};

async function latestStandard(db: D1Database, productId: string) {
  await selfApplyForRead("product-costing", () => ensureStandardTable(db));
  const row = await db
    .prepare(
      `SELECT id, labour_sen, material_sen, total_sen, fabric_tier, snapshot, missing_lines, set_at, set_by
         FROM product_standard_costs WHERE product_id = ? ORDER BY set_at DESC LIMIT 1`,
    )
    .bind(productId)
    .first<StandardRow>()
    .catch(() => null);
  if (!row) return null;
  const snap = parse<StandardSnapshot>(row.snapshot, { linePrices: {}, tierMaterialSen: {} });
  return {
    id: row.id,
    labourSen: Number(row.labour_sen),
    materialSen: Number(row.material_sen),
    totalSen: Number(row.total_sen),
    tier: row.fabric_tier,
    missingLines: Number(row.missing_lines),
    setAt: row.set_at,
    setBy: row.set_by,
    ...snap,
  };
}

// GET /summary — one line per product with a BOM, for the Products list
// columns (D4): materials at the first fabric tier, line counts for the
// "No materials" / "no price" flags. Declared before /:productId.
app.get("/summary", async (c) => {
  const denied = await requirePermission(c, "products", "read");
  if (denied) return denied;
  const db = c.var.DB;
  const [tplRes, inputs] = await Promise.all([
    db.prepare("SELECT * FROM bom_templates").all<TemplateRow>(),
    loadPricingInputs(db),
  ]);
  // Same pick as the costing page: ACTIVE, else DRAFT, newest first.
  const rank = (s: string | null) => (s === "ACTIVE" ? 0 : s === "DRAFT" ? 1 : 2);
  const best = new Map<string, TemplateRow>();
  for (const t of tplRes.results ?? []) {
    const cur = best.get(t.productCode);
    if (
      !cur ||
      rank(t.versionStatus) < rank(cur.versionStatus) ||
      (rank(t.versionStatus) === rank(cur.versionStatus) && String(t.effectiveFrom ?? "") > String(cur.effectiveFrom ?? ""))
    ) {
      best.set(t.productCode, t);
    }
  }
  const data: Record<string, { labourSen: number; materialSen: number; totalSen: number; materialLines: number; missingLines: number; fabricLines: number; tier: string | null }> = {};
  for (const [code, tpl] of best) {
    const r = computeCosting({ bom: bomOf(tpl), ...inputs });
    data[code] = {
      labourSen: r.labourSen,
      materialSen: r.materialSen,
      totalSen: r.totalSen,
      materialLines: r.materialLines,
      missingLines: r.missingLines,
      fabricLines: r.fabricFromOrderLines,
      tier: r.tier,
    };
  }
  return c.json({ success: true, data });
});

app.get("/:productId", async (c) => {
  const denied = await requirePermission(c, "products", "read");
  if (denied) return denied;
  const loaded = await loadCosting(c.var.DB, c.req.param("productId"), c.req.query("tier") ?? undefined);
  if (!loaded) return c.json({ success: false, error: "Product not found" }, 404);
  const { product, tpl, fabricTiers, costing } = loaded;
  const standard = await latestStandard(c.var.DB, product.id);
  return c.json({
    success: true,
    data: {
      product,
      bom: tpl
        ? { id: tpl.id, version: tpl.version, status: tpl.versionStatus, effectiveFrom: tpl.effectiveFrom }
        : null,
      fabricTiers,
      standard,
      ...costing,
    },
  });
});

// POST /:productId/standard — today's cost becomes the standard (append-only).
app.post("/:productId/standard", async (c) => {
  const denied = await requirePermission(c, "products", "update");
  if (denied) return denied;
  const db = c.var.DB;
  await ensureStandardTable(db);
  const loaded = await loadCosting(db, c.req.param("productId"), c.req.query("tier") ?? undefined);
  if (!loaded) return c.json({ success: false, error: "Product not found" }, 404);
  const { product, tpl, costing } = loaded;
  if (!tpl) return c.json({ success: false, error: "This product has no BOM, so there is no cost to keep." }, 400);
  const id = `psc-${crypto.randomUUID().slice(0, 12)}`;
  const setBy = await actorName(c);
  const setAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO product_standard_costs (id, product_id, bom_id, labour_sen, material_sen, total_sen,
         fabric_tier, snapshot, missing_lines, set_at, set_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      product.id,
      tpl.id,
      costing.labourSen,
      costing.materialSen,
      costing.totalSen,
      costing.tier,
      JSON.stringify(standardSnapshot(costing)),
      costing.missingLines,
      setAt,
      setBy,
    )
    .run();
  await emitAudit(c, {
    resource: "products",
    resourceId: product.id,
    action: "set-standard-cost",
    after: { id, labourSen: costing.labourSen, materialSen: costing.materialSen, totalSen: costing.totalSen, tier: costing.tier },
  });
  return c.json({ success: true, data: await latestStandard(db, product.id) }, 201);
});

export default app;
