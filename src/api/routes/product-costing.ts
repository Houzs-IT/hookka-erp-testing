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
import { claudeFetch, MISSING_ANTHROPIC_KEY_ERROR } from "../lib/claude-fetch";
import { stripJsonFences } from "../lib/scan-engine";
import { normaliseRdScan } from "../../lib/rd-scan";
import { memoizeSelfApply, runSelfApply, selfApplyForRead } from "../lib/self-apply";
import { todayYmdMY } from "../../lib/utils";
import {
  computeCosting,
  normaliseFabricTiers,
  validateFabricTiers,
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

// Stored as { tiers, updatedBy, updatedAt } (a bare array from the first
// version still reads).
async function loadTiersWithMeta(db: D1Database) {
  const row = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind(TIERS_KEY)
    .first<{ value: string }>()
    .catch(() => null);
  const v = parse<unknown>(row?.value ?? null, null);
  const obj = v && !Array.isArray(v) && typeof v === "object" ? (v as { tiers?: unknown; updatedBy?: unknown; updatedAt?: unknown }) : null;
  return {
    tiers: normaliseFabricTiers(obj ? obj.tiers : v),
    updatedBy: obj && typeof obj.updatedBy === "string" ? obj.updatedBy : null,
    updatedAt: obj && typeof obj.updatedAt === "string" ? obj.updatedAt : null,
  };
}
async function loadTiers(db: D1Database) {
  return (await loadTiersWithMeta(db)).tiers;
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
  const m = await loadTiersWithMeta(c.var.DB);
  return c.json({ success: true, data: m.tiers, updatedBy: m.updatedBy, updatedAt: m.updatedAt });
});

app.put("/fabric-tiers", async (c) => {
  const denied = await requirePermission(c, "products", "update");
  if (denied) return denied;
  const body = await c.req.json().catch(() => null);
  const incoming = (body as { tiers?: unknown } | null)?.tiers;
  const tiers = validateFabricTiers(incoming);
  if (!tiers) {
    return c.json({ success: false, error: "Each level needs a different name and a From ≤ To price above 0 (1–10 levels)." }, 400);
  }
  const before = await loadTiers(c.var.DB);
  const updatedBy = await actorName(c);
  const updatedAt = new Date().toISOString();
  await c.var.DB.prepare(
    `INSERT INTO kv_config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(TIERS_KEY, JSON.stringify({ tiers, updatedBy, updatedAt }), updatedAt)
    .run();
  await emitAudit(c, { resource: "costing-settings", resourceId: TIERS_KEY, action: "update", before, after: tiers });
  return c.json({ success: true, data: tiers, updatedBy, updatedAt });
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
  const data: Record<string, { labourSen: number; materialSen: number; totalSen: number; materialLines: number; otherLines: number; missingLines: number; fabricLines: number; tier: string | null }> = {};
  for (const [code, tpl] of best) {
    const r = computeCosting({ bom: bomOf(tpl), ...inputs });
    data[code] = {
      labourSen: r.labourSen,
      materialSen: r.materialSen,
      totalSen: r.totalSen,
      materialLines: r.materialLines,
      missingLines: r.missingLines,
      fabricLines: r.fabricFromOrderLines,
      // Lines other than "fabric from order" — every bedframe / sofa BOM is
      // seeded with the fabric line, so THIS is what says "materials set up".
      otherLines: r.materialLines - r.fabricFromOrderLines,
      tier: r.tier,
    };
  }
  return c.json({ success: true, data });
});

// POST /preview — cost a BOM that has not been saved (the costing editor's
// live numbers while you type). Writes nothing.
app.post("/preview", async (c) => {
  const denied = await requirePermission(c, "products", "read");
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as { bom?: BomIn; tier?: string } | null;
  if (!body || !body.bom || typeof body.bom !== "object") {
    return c.json({ success: false, error: "bom is required" }, 400);
  }
  const inputs = await loadPricingInputs(c.var.DB);
  return c.json({ success: true, data: computeCosting({ bom: body.bom, ...inputs }, { tier: body.tier }) });
});

app.get("/:productId", async (c) => {
  const denied = await requirePermission(c, "products", "read");
  if (denied) return denied;
  const loaded = await loadCosting(c.var.DB, c.req.param("productId"), c.req.query("tier") ?? undefined);
  if (!loaded) return c.json({ success: false, error: "Product not found" }, 404);
  const { product, tpl, fabricTiers, costing } = loaded;
  const standard = await latestStandard(c.var.DB, product.id);
  const tierMeta = await loadTiersWithMeta(c.var.DB);
  return c.json({
    success: true,
    data: {
      product,
      bom: tpl
        ? { id: tpl.id, version: tpl.version, status: tpl.versionStatus, effectiveFrom: tpl.effectiveFrom }
        : null,
      fabricTiers,
      fabricTiersMeta: { updatedBy: tierMeta.updatedBy, updatedAt: tierMeta.updatedAt },
      standard,
      // The BOM itself, for the costing editor (phase 4) — the same row the
      // BOM page edits; saving goes back through PUT /api/bom/templates/:id.
      template: tpl ? { id: tpl.id, productCode: tpl.productCode, ...bomOf(tpl) } : null,
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

// POST /:productId/rd-entry — record that a BOM save came from a filled R&D
// Spec Form (plan D11: "record of who / when"): form no., who filled it, the
// date on the paper; the server adds who keyed it in and when (audit journal).
app.post("/:productId/rd-entry", async (c) => {
  const denied = await requirePermission(c, "products", "update");
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as { formNo?: unknown; filledBy?: unknown; filledOn?: unknown; bomId?: unknown } | null;
  const formNo = String(body?.formNo ?? "").trim().slice(0, 60);
  const filledBy = String(body?.filledBy ?? "").trim().slice(0, 80);
  const filledOn = String(body?.filledOn ?? "").trim().slice(0, 10);
  if (!formNo) return c.json({ success: false, error: "Form no. is required" }, 400);
  if (filledOn && !/^\d{4}-\d{2}-\d{2}$/.test(filledOn)) return c.json({ success: false, error: "Date must be YYYY-MM-DD" }, 400);
  const product = await c.var.DB.prepare("SELECT id FROM products WHERE id = ? OR code = ? LIMIT 1")
    .bind(c.req.param("productId"), c.req.param("productId"))
    .first<{ id: string }>();
  if (!product) return c.json({ success: false, error: "Product not found" }, 404);
  const entry = { formNo, filledBy, filledOn, bomId: typeof body?.bomId === "string" ? body.bomId : null, enteredBy: await actorName(c) };
  await emitAudit(c, { resource: "products", resourceId: product.id, action: "rd-form-entry", after: entry });
  return c.json({ success: true, data: entry }, 201);
});

// POST /:productId/rd-scan — read a filled R&D Spec Form (PDF or photo) and
// return what is written on it (phase 7). WRITES NOTHING: the costing editor
// shows each reading as a change to tick, and the operator saves as usual.
// The prompt carries the form's own numbered layout (WIP #, departments, the
// "now" minutes, materials on file) so handwriting is matched to a WIP number
// and a department / material code rather than guessed from scratch.
const RD_SCAN_MODEL = "claude-sonnet-4-6"; // same model as the customer-PO scan
const RD_SCAN_MAX_BYTES = 20 * 1024 * 1024;

app.post("/:productId/rd-scan", async (c) => {
  const denied = await requirePermission(c, "products", "update");
  if (denied) return denied;
  const apiKey = c.env?.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: MISSING_ANTHROPIC_KEY_ERROR }, 503);
  let file: File | null = null;
  try {
    const fd = await c.req.formData();
    const f = fd.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return c.json({ success: false, error: "Upload the filled form as a file" }, 400);
  }
  if (!file) return c.json({ success: false, error: "Upload the filled form as a file" }, 400);
  if (file.size > RD_SCAN_MAX_BYTES) return c.json({ success: false, error: "File is over 20 MB" }, 400);
  const mime = file.type || "application/pdf";
  const isPdf = /pdf/i.test(mime);
  if (!isPdf && !/^image\/(jpeg|png|webp|gif)$/i.test(mime)) {
    return c.json({ success: false, error: "Use a PDF or a JPG / PNG photo of the form" }, 400);
  }
  const loaded = await loadCosting(c.var.DB, c.req.param("productId"), undefined);
  if (!loaded) return c.json({ success: false, error: "Product not found" }, 404);
  const { product, costing } = loaded;

  // The form as printed: WIP #n, its departments with "now" minutes, its
  // materials on file (qty per product, unit).
  let no = 0;
  const layout = costing.nodes
    .filter((n) => n.level > 1)
    .map((n) => {
      no += 1;
      const procs = n.processes.map((p) => `${p.dept} (now ${p.minutesPerPc} min/pc)`).join("; ") || "no processes";
      const mats = n.materials.map((m) => `${m.code || m.name} ${+(m.qtyPerPc * n.pcs).toFixed(4)} ${m.unit}`).join("; ") || "none";
      return `#${no} ${n.label} x${n.pcs} PCS | processes: ${procs} | materials on file: ${mats}`;
    })
    .join("\n");
  const prompt =
    `This is a filled-in "R&D Spec Form" for product ${product.code} (${product.name}). ` +
    `It was printed from this layout (WIP numbers are printed on the form as #1, #2 ...):\n${layout}\n\n` +
    `Read ONLY what was HANDWRITTEN on the form:\n` +
    `- minutes: a number written in a process's minutes box (per piece). Skip boxes left empty.\n` +
    `- corrections: a corrected quantity written beside a material that was already printed (quantity per product).\n` +
    `- newMaterials: material code + quantity (per product) + unit written on the blank lines under a WIP, or in the "Extra raw materials" table with its WIP no.\n` +
    `- formNo (printed top right), filledBy and filledOn (the "Filled by (R&D)" line and its date, as YYYY-MM-DD).\n` +
    `If something is unreadable, leave it out. Never invent values.\n` +
    `Return JSON only: {"formNo":"","filledBy":"","filledOn":"","minutes":[{"wipNo":1,"dept":"Packing","minutes":20}],` +
    `"corrections":[{"wipNo":2,"code":"PLY18","qty":1.5,"unit":"PCS"}],"newMaterials":[{"wipNo":3,"code":"STAPLE","qty":40,"unit":"PCS"}]}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  const data = btoa(binary);
  const media = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mime.toLowerCase(), data } };

  const resp = await claudeFetch(
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: RD_SCAN_MODEL,
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: "user", content: [media, { type: "text", text: prompt }] }],
      }),
    },
    "rd_form_scan",
  ).catch((e: unknown) => e as Error);
  if (resp instanceof Error) return c.json({ success: false, error: `Could not reach the reader: ${resp.message}` }, 502);
  const bodyText = await resp.text();
  if (!resp.ok) return c.json({ success: false, error: `Reader error ${resp.status}: ${bodyText.slice(0, 200)}` }, 502);
  let text = "";
  try {
    const parsed = JSON.parse(bodyText) as { content?: { type: string; text?: string }[] };
    text = parsed.content?.find((b) => b.type === "text")?.text ?? "";
  } catch {
    return c.json({ success: false, error: "The reader returned something unreadable" }, 502);
  }
  let raw: unknown = null;
  try {
    raw = JSON.parse(stripJsonFences(text));
  } catch {
    return c.json({ success: false, error: "Could not read the form — try a clearer scan or photo" }, 422);
  }
  const reading = normaliseRdScan(raw, no);
  await emitAudit(c, { resource: "products", resourceId: product.id, action: "rd-form-scan", after: { formNo: reading.formNo, minutes: reading.minutes.length, corrections: reading.corrections.length, newMaterials: reading.newMaterials.length } });
  return c.json({ success: true, data: reading });
});

export default app;
