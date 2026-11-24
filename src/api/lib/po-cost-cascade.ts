// ---------------------------------------------------------------------------
// po-cost-cascade.ts — Track F cost cascade on Production Order completion.
//
// When a PO reaches COMPLETED, three cost-side things must happen AFTER the
// fg_batches row is created by postProductionOrderCompletion():
//
//   F1. RM consumption (FIFO):
//       - Resolve BOM for PO.productId via bom_versions.tree (JSON) — we
//         walk the tree and collect every node's materials[] entry. If no
//         active bom_version exists, fall back to bom_components table.
//       - For each material line: required qty = perUnit × po.quantity
//         × (1 + waste%). FIFO-consume rm_batches (oldest receivedDate
//         first), decrement rm_batches.remainingQty and
//         raw_materials.balanceQty, emit one RM_ISSUE cost_ledger entry
//         per slice touched.
//       - Shortages log as a warning but do NOT abort.
//       - Idempotent: bail early if cost_ledger already has RM_ISSUE rows
//         for this productionOrderId.
//
//   F2. Labor posting per completed job card (handled by postJobCardLabor):
//       - On each job_card status flip to COMPLETED/TRANSFERRED, post a
//         LABOR_POSTED cost_ledger entry. The JC's production minutes are
//         costed at each attributed worker's own production-cost rate
//         (basic salary ÷ holiday-adjusted working days ÷ hours/day ÷ 60)
//         via the shared labor engine.
//       - Idempotent per jobCardId — we key by refType='JOB_CARD', refId=jc.id.
//
//   F3. FG batch cost backfill:
//       - Sum all RM_ISSUE + LABOR_POSTED totalCostSen for this PO, write
//         them back into fg_batches.{materialCostSen, laborCostSen,
//         unitCostSen} and emit the single FG_COMPLETED cost_ledger entry.
//       - Idempotent: bail if an FG_COMPLETED row already exists for the PO.
//
//   F4. WIP component tracking (light placeholder):
//       - Emits one WIP_COMPLETED cost_ledger entry summarising the FG qty.
//         Real WIP inventory deducts / layer creation is deferred
//         (TODO(wip-phase-2)).
//       - Idempotent by refType='PRODUCTION_ORDER' + WIP_COMPLETED row check.
//
// SCHEMA NOTE
//   cost_ledger.type CHECK constraint allows (post-migration-0011):
//     RM_RECEIPT / RM_ISSUE / LABOR_POSTED / FG_COMPLETED / FG_DELIVERED /
//     ADJUSTMENT / WIP_COMPLETED. F4 uses WIP_COMPLETED directly.
//     Legacy pre-0011 rows may still exist as ADJUSTMENT with a
//     "WIP_COMPLETED" notes prefix — the idempotency check covers both.
// ---------------------------------------------------------------------------
import { fifoConsume, QTY_EPSILON } from "../../lib/costing";
import {
  productionCostRatePerMinuteSen,
  costingWorkerOrDefault,
} from "../../lib/labor-engine";
import type { RMBatch } from "../../types";
import {
  expandMaterialQty,
  expandCutSize,
  parseMaterialScaling,
  parseSofaSeatHeightInches,
  type ProductionDimensions,
} from "./material-scaling";
import {
  parseRepairScope,
  materialLineInScope,
  repairComponentScale,
} from "../../lib/repair-scope";
import { deriveTopLevelWipKey } from "./bom-wip-breakdown";
import { explodeKits, loadAllKits } from "./component-bom";
import { DEPT_ORDER } from "./lead-times";

type RMBatchRow = {
  id: string;
  rmId: string;
  source: string;
  sourceRefId: string | null;
  receivedDate: string;
  originalQty: number;
  remainingQty: number;
  unitCostSen: number;
  created_at: string | null;
  notes: string | null;
};

export type ProductionOrderRow = {
  id: string;
  poNo: string;
  productId: string | null;
  productCode: string | null;
  quantity: number;
  completedDate: string | null;
  // Snapshotted SO/CO line dimensions used by the BOM material scaling
  // rule. Bedframe dims are stored as INTs; sofa seat height lives
  // inline in sizeCode/sizeLabel and is parsed at use time via
  // parseSofaSeatHeightInches. itemCategory tells us whether to do
  // that parse (bedframe sizeCode is "K"/"Q"/"S", not inches).
  itemCategory: string | null;
  gapInches: number | null;
  divanHeightInches: number | null;
  legHeightInches: number | null;
  sizeCode: string | null;
  sizeLabel: string | null;
  // SO line fabric snapshot. Fabric raw materials live in raw_materials
  // keyed by itemCode === fabricCode (e.g. "PC151-01"), so this drives
  // the autoDetect=FABRIC substitution at consumption time.
  fabricCode: string | null;
  // Repair Scope snapshot stamped at PO creation (0160). Runtime-added
  // column → SELECT * returns the folded-lowercase key
  // (BUG-2026-06-11-007); read dual-key.
  repairScope?: string | null;
  repairscope?: string | null;
};

export type BomVersionRow = {
  id: string;
  productId: string;
  productCode: string | null;
  status: string | null;
  tree: string | null;
};

type BomComponentRow = {
  id: string;
  productId: string;
  materialCategory: string;
  materialName: string;
  qtyPerUnit: number;
  unit: string;
  wastePct: number;
};

type MaterialLine = {
  code: string;              // BOM-side lookup key (e.g. "PLY-18")
  name: string;
  qtyPerUnit: number;
  wastePct: number;          // 0..100
  inventoryCode?: string;    // preferred mapping to raw_materials.itemCode
  // FILLER (sponge) area-based consumption (owner 2026-07-30). When a BOM
  // material line carries a cut size (inches), the resolved RM's sheet size
  // converts qtyPerUnit (cut-piece count) into a FRACTION of a sheet:
  //   sheets consumed = qtyPerUnit × (cutL×cutW) ÷ (sheetL×sheetW).
  // Thickness cancels (the piece is cut the full thickness of the sheet), so
  // area is enough. No cut size → consumes by qtyPerUnit as before.
  cutLengthIn?: number;
  cutWidthIn?: number;
  // When set, this BOM line is bound to a per-SO field rather than a
  // fixed inventory item. resolveBomMaterials substitutes inventoryCode
  // with the PO's snapshotted SO value before FIFO lookup runs:
  //   "FABRIC" → po.fabricCode (raw_materials.itemCode === fabricCode)
  //   "LEG"    → no current schema mapping → falls through to shortage
  //              report with the original "Leg (from order)" name.
  autoDetect?: "FABRIC" | "LEG";
  // deptCodes of the BOM node that OWNS this material line (the node whose
  // materials[] array carried it). Captured by collectTreeMaterials for
  // the Repair-Scope CUSTOM branch rule: a material is consumed only when
  // its owning node has at least one process in the chosen depts. Live
  // BOM audit 2026-06-11: every material-carrying node also carries its
  // own processes (399/399), so this is reliably populated for tree-based
  // BOMs; the flat bom_components fallback has no process info and leaves
  // it undefined.
  ownerDeptCodes?: string[];
  // Component-level Repair Scope: the TOP-LEVEL BOM WIP this line's owning
  // node descends from. ownerWipKey is derived with the SAME
  // deriveTopLevelWipKey helper breakBomIntoWips uses for job-card wipKeys
  // (single source of truth), so a picked component matches its material
  // lines exactly. ownerWipQty = that top-level node's per-FG piece count
  // (the bound a pick's qty is clamped to → scale = picked/bomQty). Only
  // the bom_templates.wipComponents walk can derive these — the legacy
  // bom_versions.tree single-root shape and the flat bom_components
  // fallback leave them undefined, and a component-scoped repair DROPS
  // such lines (never over-consume on a partial repair).
  ownerWipKey?: string;
  ownerWipQty?: number;
};

// Walk a BOM tree JSON node and gather every `materials[]` entry across all
// nested levels. The tree is the JSON stored in bom_versions.tree (legacy)
// or bom_templates.wipComponents (current source of truth, post-2026-05-07).
//
// Material qty semantics (BOM author convention):
//   - `material.qty` is PER PIECE OF THIS WIP (e.g. divan FC qty=3.25 means
//     3.25m fabric per individual divan piece).
//   - The parent WIP node's `quantity` field is the piece count produced
//     per finished good (2 for K/Q divans, 1 for headboards).
//   - Total per FG = (scaled material.qty) × (parent node quantity).
//
// Order: scale FIRST (perUnit slope is per-piece), then multiply by
// piece count. Scaling rules are authored per piece (base 8" divan,
// +0.4 m/inch); multiplying first would double the slope.
//
// Output `qtyPerUnit` is the per-FG-unit qty. Downstream multiplication
// by `po.quantity` (FG count) and `(1 + wastePct/100)` stays unchanged.
function collectTreeMaterials(
  node: unknown,
  out: MaterialLine[],
  dims: ProductionDimensions,
  // Top-level WIP owner tag (Component-level Repair Scope). Passed once by
  // the wipComponents walk for each root node and inherited UNCHANGED by
  // every descendant — a material anywhere in the Divan subtree belongs to
  // the Divan component. undefined for tree shapes that can't derive a
  // component key (legacy bom_versions.tree); such lines drop under a
  // component-scoped repair.
  owner?: { wipKey: string; wipQty: number },
): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  // Parent node's piece count. Defaults to 1 when missing / non-positive
  // — matches the prior behavior where the multiplier was implicitly 1.
  const rawNodeQty = n.quantity;
  const parsedNodeQty =
    typeof rawNodeQty === "number" ? rawNodeQty : Number(rawNodeQty);
  const nodeQuantity =
    Number.isFinite(parsedNodeQty) && parsedNodeQty > 0 ? parsedNodeQty : 1;
  // Owning node's dept set — drives the Repair-Scope CUSTOM branch rule.
  const nodeProcs = Array.isArray(n.processes) ? n.processes : [];
  const ownerDeptCodes = nodeProcs
    .map((p) =>
      p && typeof p === "object"
        ? String((p as { deptCode?: unknown }).deptCode ?? "").toUpperCase()
        : "",
    )
    .filter((d) => d.length > 0);
  const mats = n.materials;
  if (Array.isArray(mats)) {
    for (const m of mats) {
      if (!m || typeof m !== "object") continue;
      const row = m as Record<string, unknown>;
      const code = typeof row.code === "string" ? row.code : "";
      const name = typeof row.name === "string" ? row.name : code;
      const qty = typeof row.qty === "number" ? row.qty : Number(row.qty) || 0;
      const scaling = parseMaterialScaling(row.scaling);
      const perPieceScaled = expandMaterialQty(qty, scaling, dims);
      const perFgQty = perPieceScaled * nodeQuantity;
      const waste =
        typeof row.wastePct === "number"
          ? row.wastePct
          : Number(row.wastePct) || 0;
      const inventoryCode =
        typeof row.inventoryCode === "string" ? row.inventoryCode : undefined;
      const autoDetect =
        row.autoDetect === "FABRIC" || row.autoDetect === "LEG"
          ? row.autoDetect
          : undefined;
      // FILLER (sponge) cut size, if the BOM author entered one (inches). Read
      // dual-keyed so both camelCase (editor) and snake_case survive.
      const cutLenRaw = (row.cutLengthIn ?? row.cut_length_in) as unknown;
      const cutWidRaw = (row.cutWidthIn ?? row.cut_width_in) as unknown;
      const cutLenBase = Number(cutLenRaw) > 0 ? Number(cutLenRaw) : undefined;
      const cutWidBase = Number(cutWidRaw) > 0 ? Number(cutWidRaw) : undefined;
      // A bigger order is a bigger PIECE, not more pieces (owner 2026-08-21).
      // Slopes of zero — every BOM written before today — return the typed size
      // unchanged, so this is a no-op for existing data.
      const grownCut =
        cutLenBase && cutWidBase
          ? expandCutSize(cutLenBase, cutWidBase, scaling, dims)
          : null;
      const cutLengthIn = grownCut ? grownCut.lengthIn : cutLenBase;
      const cutWidthIn = grownCut ? grownCut.widthIn : cutWidBase;
      // autoDetect lines may have empty code/name at authoring time — keep
      // them so the substitution step downstream can resolve them. The
      // (code || name) guard would otherwise drop them silently.
      if (perFgQty > 0 && (code || name || autoDetect)) {
        out.push({
          code: code || name,
          name: name || (autoDetect === "FABRIC" ? "Fabric (from order)" : autoDetect === "LEG" ? "Leg (from order)" : ""),
          qtyPerUnit: perFgQty,
          wastePct: waste,
          inventoryCode,
          autoDetect,
          cutLengthIn,
          cutWidthIn,
          ownerDeptCodes,
          ownerWipKey: owner?.wipKey,
          ownerWipQty: owner?.wipQty,
        });
      }
    }
  }
  const kids = n.children;
  if (Array.isArray(kids)) {
    for (const child of kids) {
      collectTreeMaterials(child, out, dims, owner);
    }
  }
}

// Resolve the BOM material list for a PO. Walks three sources in order:
//   1. bom_versions.tree            (legacy rich schema, only ~4 rows in prod)
//   2. bom_templates.wipComponents  (current source of truth — BOM editor +
//                                    MRP both write here; 244 rows in prod)
//   3. bom_components               (flat fallback keyed by productId)
//
// Source #2 was added 2026-05-07: existing PO completions were silently
// returning [] for almost every product because bom_versions had only 4
// entries while operators authored BOMs through the /api/bom/templates UI.
// fabric was never being deducted at PO completion. Walking
// bom_templates.wipComponents with the same collectTreeMaterials helper
// (compatible shape — same `materials`/`children` keys) closes that gap
// without a data migration. Returns [] if nothing is found. Dimensions
// snapshot is used by the JSON-tree paths to expand per-material scaling
// rules at extraction time.
// Resolve the BOM material lines for a PO, THEN explode any reusable kit
// sub-BOMs (a mechanism / leg SKU that drags in its required screws — owner
// 2026-07-31). Explosion runs on the FINAL resolved lines so a mechanism bound
// via autoDetect=LEG also pulls its screws. Every consumer (consumption,
// costing, shortage report) goes through here, so the kit is intrinsic to the
// BOM everywhere. See component-bom.ts.
// Optional read-through cache for BULK callers (the MRP walks ~500 production
// orders in one request). Every map is pre-loaded once by the caller; a miss
// in a provided map means "no such row" (no DB fallback), so a cached run
// issues no per-PO queries for these four tables. Single-PO callers (the
// consume path) pass nothing and behave exactly as before.
export type BomResolveCache = {
  versionsByProductId: Map<string, BomVersionRow>;
  versionsByProductCode: Map<string, BomVersionRow>;
  templatesByProductCode: Map<string, { id: string; wipComponents: string | null }>;
  rmByItemCode: Map<string, Record<string, unknown>>;
  rmByDescriptionLower: Map<string, Record<string, unknown>>;
  kitsByParent: Map<string, Record<string, unknown>[]>;
};

export async function loadBomResolveCache(db: D1Database): Promise<BomResolveCache> {
  const [vers, tpls, rms] = await Promise.all([
    db
      .prepare("SELECT id, productId, productCode, status, tree FROM bom_versions WHERE status = 'ACTIVE'")
      .all<BomVersionRow>(),
    db
      .prepare(
        "SELECT id, productCode, wipComponents FROM bom_templates WHERE versionStatus = 'ACTIVE' ORDER BY effectiveFrom DESC",
      )
      .all<{ id: string; productCode: string | null; wipComponents: string | null }>(),
    db.prepare("SELECT * FROM raw_materials").all<Record<string, unknown>>(),
  ]);
  const cache: BomResolveCache = {
    versionsByProductId: new Map(),
    versionsByProductCode: new Map(),
    templatesByProductCode: new Map(),
    rmByItemCode: new Map(),
    rmByDescriptionLower: new Map(),
    kitsByParent: new Map(),
  };
  for (const v of vers.results ?? []) {
    if (v.productId && !cache.versionsByProductId.has(v.productId)) cache.versionsByProductId.set(v.productId, v);
    if (v.productCode && !cache.versionsByProductCode.has(v.productCode)) cache.versionsByProductCode.set(v.productCode, v);
  }
  // ORDER BY effectiveFrom DESC → first row per productCode wins, same as the
  // single-PO query's LIMIT 1.
  for (const t of tpls.results ?? []) {
    if (t.productCode && !cache.templatesByProductCode.has(t.productCode)) {
      cache.templatesByProductCode.set(t.productCode, { id: t.id, wipComponents: t.wipComponents });
    }
  }
  for (const r of rms.results ?? []) {
    const code = String(r.itemCode ?? "");
    if (code && !cache.rmByItemCode.has(code)) cache.rmByItemCode.set(code, r);
    const desc = String(r.description ?? "").toLowerCase();
    if (desc && !cache.rmByDescriptionLower.has(desc)) cache.rmByDescriptionLower.set(desc, r);
  }
  cache.kitsByParent = await loadAllKits(db);
  return cache;
}

async function resolveBomMaterials(
  db: D1Database,
  po: ProductionOrderRow,
  cache?: BomResolveCache,
): Promise<MaterialLine[]> {
  const lines = await resolveBomMaterialsRaw(db, po, cache);
  return explodeKits(db, lines, cache?.kitsByParent);
}

async function resolveBomMaterialsRaw(
  db: D1Database,
  po: ProductionOrderRow,
  cache?: BomResolveCache,
): Promise<MaterialLine[]> {
  // Try ACTIVE bom_version by productId first, productCode second.
  let version: BomVersionRow | null = null;
  if (cache) {
    version =
      (po.productId ? cache.versionsByProductId.get(po.productId) : undefined) ??
      (po.productCode ? cache.versionsByProductCode.get(po.productCode) : undefined) ??
      null;
  } else if (po.productId) {
    version = await db
      .prepare(
        "SELECT id, productId, productCode, status, tree FROM bom_versions WHERE productId = ? AND status = 'ACTIVE' LIMIT 1",
      )
      .bind(po.productId)
      .first<BomVersionRow>();
  }
  // A version found by productId must ALSO be for this product code
  // (BUG-2026-11-24-552): 2025 demo bom_versions rows (bom-v-1..3) share
  // productIds with real products — prod-5 is 1003(A)-(K) but bom-v-3 is a
  // 5530-1A sofa — so the order picked up the sofa's materials instead of its
  // own BOM template. The MRP, RM deduction and costing all follow the BOM.
  if (version && version.productCode && po.productCode && version.productCode !== po.productCode) {
    version = cache ? cache.versionsByProductCode.get(po.productCode) ?? null : null;
  }
  if (!cache && !version && po.productCode) {
    version = await db
      .prepare(
        "SELECT id, productId, productCode, status, tree FROM bom_versions WHERE productCode = ? AND status = 'ACTIVE' LIMIT 1",
      )
      .bind(po.productCode)
      .first<BomVersionRow>();
  }

  // Build the dimension snapshot used by every scaling rule on this PO.
  // Bedframe sizeCode ("Q" / "K" / "S") is rejected by the parser so it
  // doesn't pollute seatHeightInches; only sofa SO lines populate it.
  const dims: ProductionDimensions = {
    gapInches: po.gapInches,
    divanHeightInches: po.divanHeightInches,
    legHeightInches: po.legHeightInches,
    seatHeightInches:
      po.itemCategory === "SOFA"
        ? parseSofaSeatHeightInches(po.sizeCode, po.sizeLabel)
        : null,
  };

  if (version?.tree) {
    try {
      const parsed = JSON.parse(version.tree);
      const acc: MaterialLine[] = [];
      collectTreeMaterials(parsed, acc, dims);
      if (acc.length > 0) return await substituteAutoDetectMaterials(db, acc, po);
    } catch {
      // fall through to bom_templates
    }
  }

  // Step 2: bom_templates.wipComponents — current source of truth. The
  // wipComponents column is a JSON ARRAY of root nodes (one root per top-
  // level WIP — divan, headboard, sofa base, etc.), not a single root.
  // Walk each root with collectTreeMaterials; the helper accumulates into
  // `acc` across siblings.
  if (po.productCode) {
    const tplRow = cache
      ? cache.templatesByProductCode.get(po.productCode) ?? null
      : await db
          .prepare(
            "SELECT id, wipComponents FROM bom_templates WHERE productCode = ? AND versionStatus = 'ACTIVE' ORDER BY effectiveFrom DESC LIMIT 1",
          )
          .bind(po.productCode)
          .first<{ id: string; wipComponents: string | null }>();
    if (tplRow?.wipComponents) {
      try {
        const parsed = JSON.parse(tplRow.wipComponents);
        const isWipArray = Array.isArray(parsed);
        const roots = isWipArray ? parsed : [parsed];
        const acc: MaterialLine[] = [];
        for (let rootIdx = 0; rootIdx < roots.length; rootIdx++) {
          const root = roots[rootIdx];
          // Component-level Repair Scope: tag every material in this root's
          // subtree with the top-level WIP's key + per-FG piece count. The
          // key is derived with deriveTopLevelWipKey — the EXACT formula
          // breakBomIntoWips stamps on this product's job cards / serves to
          // the repair-components picker — so picked components and material
          // lines match by string equality. Derivable only for the real
          // wipComponents array shape (mirrors breakBomIntoWips, which
          // treats a non-array as the FG_MAIN fallback); otherwise leave
          // the lines untagged → dropped under a component scope.
          const rootQtyRaw =
            root && typeof root === "object"
              ? Number((root as Record<string, unknown>).quantity)
              : NaN;
          const owner = isWipArray
            ? {
                wipKey: deriveTopLevelWipKey(
                  po.productCode ?? "",
                  rootIdx,
                  root as { wipType?: unknown; wipCode?: unknown } | null,
                ),
                wipQty:
                  Number.isFinite(rootQtyRaw) && rootQtyRaw > 0
                    ? rootQtyRaw
                    : 1,
              }
            : undefined;
          collectTreeMaterials(root, acc, dims, owner);
        }
        if (acc.length > 0) return await substituteAutoDetectMaterials(db, acc, po);
      } catch {
        // fall through to bom_components
      }
    }
  }

  // Fallback: bom_components table (flat list keyed by productId).
  if (po.productId) {
    const bcRes = await db
      .prepare(
        "SELECT id, productId, materialCategory, materialName, qtyPerUnit, unit, wastePct FROM bom_components WHERE productId = ?",
      )
      .bind(po.productId)
      .all<BomComponentRow>();
    const rows = bcRes.results ?? [];
    if (rows.length > 0) {
      return rows.map((r) => ({
        code: r.materialName,
        name: r.materialName,
        qtyPerUnit: r.qtyPerUnit,
        wastePct: r.wastePct,
      }));
    }
  }
  return [];
}

// Parse the leading inch value from a leg-height option label.
//   `6"` → 6,  `7"` → 7,  `4.5"` → 4.5,  "No Leg" → null.
// Tolerates surrounding spaces and a missing inch mark.
function parseLegInches(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = value.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Resolve the raw_materials.itemCode a leg-height is EXPLICITLY bound to in the
// Maintenance → Leg Heights catalog. Owner 2026-07-30: each leg-height option
// in kv_config['variants-config'].legHeights / .sofaLegHeights can carry a
// `legSku` (the exact leg's internal code). When present it is authoritative —
// the shop binds e.g. "脚 6寸" → its precise SKU so consumption never guesses.
//
// SOFA orders consult sofaLegHeights first; everything else (bedframe) consults
// legHeights first; the other list is a fallback for shops keeping one shared
// catalog. Match is by the numeric inch value parsed from the option's `value`
// label (`6"` → 6) against po.legHeightInches. Returns null when no binding
// exists → the caller then falls back to the legacy fuzzy description match.
async function resolveBoundLegSku(
  db: D1Database,
  itemCategory: string | null,
  legHeightInches: number,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind("variants-config")
    .first<{ value: string }>();
  if (!row?.value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const cfg = parsed as { legHeights?: unknown; sofaLegHeights?: unknown };
  const isSofa = (itemCategory ?? "").toUpperCase() === "SOFA";
  const primary = isSofa ? cfg.sofaLegHeights : cfg.legHeights;
  const secondary = isSofa ? cfg.legHeights : cfg.sofaLegHeights;
  const fromList = (list: unknown): string | null => {
    if (!Array.isArray(list)) return null;
    for (const o of list) {
      if (!o || typeof o !== "object") continue;
      const opt = o as { value?: unknown; legSku?: unknown };
      const inches = parseLegInches(opt.value);
      if (inches != null && inches === legHeightInches) {
        const sku = typeof opt.legSku === "string" ? opt.legSku.trim() : "";
        return sku.length > 0 ? sku : null;
      }
    }
    return null;
  };
  return fromList(primary) ?? fromList(secondary);
}

// Bind autoDetect lines to a concrete inventory key from the PO snapshot.
//   FABRIC: po.fabricCode IS raw_materials.itemCode for the SO's chosen
//           fabric — set inventoryCode and let the normal lookup chain run.
//   LEG:    SO line carries legHeightInches. Resolution order:
//           1. EXPLICIT binding — the leg-height's `legSku` from the
//              Maintenance Leg Heights catalog (resolveBoundLegSku). Owner's
//              chosen source of truth; wins whenever set.
//           2. Legacy fuzzy fallback — the shop names leg inventory with the
//              inch height inline (e.g. `SOFA LEG PLASTIC (ROUND) 2"`); match
//              raw_materials.description LIKE `%<N>"%` AND `%LEG%`,
//              case-insensitive, first by itemCode ASC.
//           Both miss → falls through, caller records a shortage with the
//           original "Leg (from order)" name. Quantity always stays the BOM
//           line's qty (the binding only decides WHICH SKU, not how many).
// Lines without an autoDetect tag are passed through unchanged.
async function substituteAutoDetectMaterials(
  db: D1Database,
  lines: MaterialLine[],
  po: ProductionOrderRow,
): Promise<MaterialLine[]> {
  // Resolve the explicit leg SKU binding ONCE — po is fixed, and a BOM can
  // carry more than one LEG line (nested WIPs), so we avoid re-reading
  // kv_config per line.
  const boundLegSku =
    po.legHeightInches != null && po.legHeightInches > 0
      ? await resolveBoundLegSku(db, po.itemCategory, po.legHeightInches)
      : null;

  const out: MaterialLine[] = [];
  for (const line of lines) {
    if (!line.autoDetect) {
      out.push(line);
      continue;
    }
    if (line.autoDetect === "FABRIC" && po.fabricCode) {
      out.push({ ...line, inventoryCode: po.fabricCode, code: po.fabricCode });
      continue;
    }
    if (line.autoDetect === "LEG" && po.legHeightInches != null && po.legHeightInches > 0) {
      // 1) Explicit Maintenance binding wins.
      if (boundLegSku) {
        out.push({ ...line, inventoryCode: boundLegSku, code: boundLegSku });
        continue;
      }
      // 2) Legacy fuzzy fallback — description contains the inch height + LEG.
      const heightStr = `${po.legHeightInches}"`;
      const hit = await db
        .prepare(
          `SELECT itemCode FROM raw_materials
             WHERE isActive = 1
               AND description LIKE ? COLLATE NOCASE
               AND description LIKE '%LEG%' COLLATE NOCASE
             ORDER BY itemCode ASC LIMIT 1`,
        )
        .bind(`%${heightStr}%`)
        .first<{ itemCode: string }>();
      if (hit) {
        out.push({ ...line, inventoryCode: hit.itemCode, code: hit.itemCode });
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

// Resolve a BOM material line to a raw_materials row id. Tries:
//   1. inventoryCode exact match on raw_materials.itemCode
//   2. code on itemCode
//   3. name on description (case-insensitive)
// itemGroup rides along for the Repair-Scope material-class filter
// (fabric / wood / foam — see src/lib/repair-scope.ts). It is a
// rename-map-known identifier, so the adapter translates it in the
// explicit projection (unlike the BUG-2026-06-10-001 runtime-column case).
export type ResolvedRm = {
  id: string;
  itemCode: string;
  description: string;
  itemGroup: string | null;
  // Sheet dims for FILLER area-based consumption (owner 2026-07-30). Read
  // dual-keyed off SELECT * — the columns are runtime-added and may be absent
  // on a fresh DB, so we must NOT name them in the SELECT (that would throw).
  sheetLengthIn: number | null;
  sheetWidthIn: number | null;
};
function toResolvedRm(row: Record<string, unknown> | null): ResolvedRm | null {
  if (!row) return null;
  const sl = (row.sheet_length_in ?? row.sheetLengthIn) as number | null | undefined;
  const sw = (row.sheet_width_in ?? row.sheetWidthIn) as number | null | undefined;
  return {
    id: String(row.id ?? ""),
    itemCode: String(row.itemCode ?? ""),
    description: String(row.description ?? ""),
    itemGroup: (row.itemGroup ?? null) as string | null,
    sheetLengthIn: sl != null ? Number(sl) : null,
    sheetWidthIn: sw != null ? Number(sw) : null,
  };
}
async function resolveRmFromBom(
  db: D1Database,
  line: MaterialLine,
  cache?: BomResolveCache,
): Promise<ResolvedRm | null> {
  if (cache) {
    const hit =
      (line.inventoryCode ? cache.rmByItemCode.get(line.inventoryCode) : undefined) ??
      (line.code ? cache.rmByItemCode.get(line.code) : undefined) ??
      (line.name ? cache.rmByDescriptionLower.get(line.name.toLowerCase()) : undefined);
    return toResolvedRm(hit ?? null);
  }
  if (line.inventoryCode) {
    const hit = await db
      .prepare("SELECT * FROM raw_materials WHERE itemCode = ? LIMIT 1")
      .bind(line.inventoryCode)
      .first<Record<string, unknown>>();
    if (hit) return toResolvedRm(hit);
  }
  if (line.code) {
    const hit = await db
      .prepare("SELECT * FROM raw_materials WHERE itemCode = ? LIMIT 1")
      .bind(line.code)
      .first<Record<string, unknown>>();
    if (hit) return toResolvedRm(hit);
  }
  if (line.name) {
    const hit = await db
      .prepare("SELECT * FROM raw_materials WHERE description = ? COLLATE NOCASE LIMIT 1")
      .bind(line.name)
      .first<Record<string, unknown>>();
    if (hit) return toResolvedRm(hit);
  }
  return null;
}

function genLedgerId(prefix: string): string {
  return `cl-${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// F1 — RM consumption (FIFO).
//
// Architecture (2026-05-07): keyed on PRODUCT CODE → BOM template →
// material list. The trigger event moved from PO completion to FAB_CUT
// JC completion (matches physical reality — meters leave the roll when
// cutting happens, not weeks later when the whole PO finishes), but the
// underlying logic stays product-code-centric. We don't try to subdivide
// by JC structure (merged vs split FAB_CUT JCs); the BOM is the source
// of truth for what gets consumed per FG, and idempotency on
// refType='PRODUCTION_ORDER' ensures a PO only consumes once even when
// multiple FAB_CUT JCs in the same PO sequentially complete.
// ---------------------------------------------------------------------------
// Category default sheet size for FILLER area-based consumption. Owner
// 2026-07-30: default 96×48 inch (= an 8ft×4ft sheet), overridable. A FILLER material with no per-SKU
// sheet size falls back to its item-group default from
// kv_config['variants-config'].sheetDefaults, then to a hardcoded 8×4 for any
// FILLER group. Units don't matter to the ratio (cutArea ÷ sheetArea) as long
// as the BOM cut size uses the same unit as the sheet.
const HARDCODED_FILLER_SHEET = { length: 96, width: 48 };
async function loadSheetDefaults(
  db: D1Database,
): Promise<Record<string, { length: number; width: number }>> {
  const out: Record<string, { length: number; width: number }> = {};
  try {
    const row = await db
      .prepare("SELECT value FROM kv_config WHERE key = ?")
      .bind("variants-config")
      .first<{ value: string }>();
    if (row?.value) {
      const parsed = JSON.parse(row.value) as {
        sheetDefaults?: Record<string, { length?: unknown; width?: unknown }>;
      };
      const sd = parsed?.sheetDefaults;
      if (sd && typeof sd === "object") {
        for (const [k, v] of Object.entries(sd)) {
          const l = Number((v as { length?: unknown }).length);
          const w = Number((v as { width?: unknown }).width);
          if (l > 0 && w > 0) out[k.toUpperCase()] = { length: l, width: w };
        }
      }
    }
  } catch {
    /* fall through to the hardcoded FILLER default */
  }
  return out;
}
function categoryDefaultSheet(
  itemGroup: string | null,
  defaults: Record<string, { length: number; width: number }>,
): { length: number; width: number } | null {
  const g = (itemGroup ?? "").toUpperCase();
  if (defaults[g]) return defaults[g];
  if (/FILLER/.test(g)) return HARDCODED_FILLER_SHEET;
  return null;
}

// ---------------------------------------------------------------------------
// RM-consumption mode gate + PREVIEW recorder
// (owner 2026-07-29: 「你可以完善 … 等我说 ok 就正式扣料」)
//
// kv_config['rm_consumption_mode'] ∈ {"LIVE","PREVIEW"}.
//
// In PREVIEW, every consume trigger (FAB_CUT + FG completion) computes the
// would-be consumption and records it to rm_consume_preview WITHOUT any
// rm_batches / raw_materials / cost_ledger write — so a BOM can be validated
// against real production before it moves real stock. `resolved = 0` rows are
// the BOM gaps.
//
// THE DEFAULT IS "LIVE", AND THAT IS A CHANGE FROM HOW THIS WAS WRITTEN.
//
// The original (2026-07-29) defaulted to PREVIEW, fail-closed, because the BOMs
// were half-finished and consuming against them would deduct nonsense. That was
// right then. It is wrong now: measured on prod 2026-08-19, 384 of 385 BOM
// templates carry components, 385 of 410 products have a BOM at all, and RM
// consumption has been running normally — 2,150 RM_ISSUE entries since April,
// 418 of them in the last 30 days.
//
// So merging the original default would STOP raw-material deduction on a system
// where it is working. Fail-closed protects you from a bad state you are
// already out of; here it would create the bad state. The default therefore
// preserves today's behaviour, and PREVIEW becomes the thing you switch ON
// deliberately — to dry-run a BOM change — rather than the thing you have to
// remember to switch off.
//
// An unreadable kv_config still yields LIVE for the same reason: the safe
// answer is "keep doing what the factory is already doing", not "silently stop
// deducting stock and let someone discover it at month end".
//
// See docs/plans/2026-07-29-rm-consumption-gate.md.
// ---------------------------------------------------------------------------
export type RmConsumptionMode = "LIVE" | "PREVIEW";

export async function getRmConsumptionMode(db: D1Database): Promise<RmConsumptionMode> {
  try {
    const row = await db
      .prepare("SELECT value FROM kv_config WHERE key = 'rm_consumption_mode'")
      .first<{ value: string }>();
    if (!row) return "LIVE"; // no row = nobody has switched it — keep deducting
    let v: unknown = row.value;
    // kv-config PUT stringifies values (e.g. '"PREVIEW"'); tolerate a raw string too.
    try {
      const parsed = JSON.parse(row.value);
      if (typeof parsed === "string") v = parsed;
    } catch {
      /* stored raw — use as-is */
    }
    // Only the exact string PREVIEW turns deduction off. Anything else — a typo,
    // a stale value, a half-written config — leaves the factory deducting as it
    // does today, because quietly stopping is the more expensive failure.
    return v === "PREVIEW" ? "PREVIEW" : "LIVE";
  } catch {
    return "LIVE";
  }
}

let rmConsumePreviewTableEnsured = false;
async function ensureRmConsumePreviewTable(db: D1Database): Promise<void> {
  if (rmConsumePreviewTableEnsured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rm_consume_preview (
         id TEXT PRIMARY KEY,
         po_id TEXT NOT NULL,
         po_no TEXT,
         product_code TEXT,
         material_id TEXT,
         material_code TEXT,
         material_name TEXT,
         required_qty REAL,
         resolved INTEGER,
         computed_at TEXT
       )`,
    )
    .run();
  rmConsumePreviewTableEnsured = true;
}

// Compute what a PO WOULD consume and (re)write its rm_consume_preview rows.
// No stock/ledger writes. `resolved = 0` rows are BOM gaps (a material line that
// maps to no raw_materials row) — exactly what the owner needs to see while
// completing BOMs. Repair-scope is intentionally NOT applied here: preview
// validates the full authored BOM, not a scoped repair.
export async function recordConsumePreview(
  db: D1Database,
  po: ProductionOrderRow,
): Promise<{ shortages: { materialName: string; shortageQty: number }[]; lines: number; unresolved: number }> {
  await ensureRmConsumePreviewTable(db);
  const bomLines = await resolveBomMaterials(db, po);
  const nowIso = new Date().toISOString();
  // Refresh — a re-fired completion replaces the PO's prior preview.
  await db.prepare("DELETE FROM rm_consume_preview WHERE po_id = ?").bind(po.id).run();
  const shortages: { materialName: string; shortageQty: number }[] = [];
  let unresolved = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const line of bomLines) {
    const required =
      line.qtyPerUnit * (po.quantity || 0) * (1 + Math.max(0, line.wastePct || 0) / 100);
    if (required <= 0) continue;
    const rm = await resolveRmFromBom(db, line);
    if (!rm) {
      unresolved++;
      shortages.push({ materialName: line.name, shortageQty: required });
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO rm_consume_preview
             (id, po_id, po_no, product_code, material_id, material_code, material_name, required_qty, resolved, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          genLedgerId("rmp"),
          po.id,
          po.poNo ?? null,
          po.productCode ?? null,
          rm?.id ?? null,
          rm?.itemCode ?? line.inventoryCode ?? line.code ?? null,
          rm?.description ?? line.name ?? null,
          required,
          rm ? 1 : 0,
          nowIso,
        ),
    );
  }
  if (stmts.length > 0) await db.batch(stmts);
  return { shortages, lines: bomLines.length, unresolved };
}

// ---------------------------------------------------------------------------
// Required material lines for a PO — THE single calculation shared by stock
// deduction and the MRP, so "what the MRP says will be used" and "what
// production deducts" can never drift apart.
//
// Per BOM line: qtyPerUnit × po.quantity × (1 + waste%) × repair component
// scale, then the FILLER sheet fraction, then the repair-scope class filter.
// Unresolvable lines are returned with rm = null (callers report them as
// shortages / BOM gaps).
//
// consumeDept / wipKey say WHEN the line leaves stock (owner 2026-11-23:
// 「完成了就扣 每个wip完成的就扣」): when the job card of the line's own
// top-level WIP (wipKey) in the line's own department completes. The dept is
// the owning BOM node's process dept — the earliest in DEPT_ORDER if a node
// lists several. Lines with no owner info (legacy bom_versions.tree / flat
// bom_components shapes) keep the pre-2026-11-23 behaviour: wipKey "" and
// dept FAB_CUT, i.e. they leave stock at the first FAB_CUT completion.
// ---------------------------------------------------------------------------
export type RequiredLine = {
  name: string;
  code: string;
  rm: ResolvedRm | null;
  required: number;
  consumeDept: string;
  wipKey: string;
};

export const LEGACY_CONSUME_DEPT = "FAB_CUT";

export function consumeDeptOf(ownerDeptCodes: readonly string[] | undefined): string {
  const depts = (ownerDeptCodes ?? []).filter((d) => d.length > 0);
  if (depts.length === 0) return LEGACY_CONSUME_DEPT;
  const order = DEPT_ORDER as readonly string[];
  const idx = (d: string) => {
    const i = order.indexOf(d);
    return i === -1 ? order.length : i;
  };
  return depts.slice().sort((a, b) => idx(a) - idx(b))[0];
}

export async function computeRequiredLines(
  db: D1Database,
  po: ProductionOrderRow,
  opts?: { cache?: BomResolveCache; sheetDefaults?: Record<string, { length: number; width: number }> },
): Promise<RequiredLine[]> {
  if (!po.quantity || po.quantity <= 0) return [];
  const cache = opts?.cache;
  const bomLines = await resolveBomMaterials(db, po, cache);
  if (bomLines.length === 0) return [];
  // FILLER sheet-size defaults, loaded once (config overrides, else 8×4).
  const sheetDefaults = opts?.sheetDefaults ?? (await loadSheetDefaults(db));

  // ---- Repair Scope material filter (0160) -------------------------------
  // A scoped (non-FULL) repair must NEVER consume the full BOM. Per-line rule
  // in materialLineInScope (src/lib/repair-scope.ts): FABRIC / FRAME / FOAM
  // presets filter by material class; CUSTOM is branch-based on the owning
  // node's depts. Component picks (scope.components) apply on top and scale
  // partial picks via repairComponentScale. Out-of-scope lines are dropped
  // before any FIFO walk or shortage report.
  const repairScope = parseRepairScope(po.repairScope ?? po.repairscope);

  const out: RequiredLine[] = [];
  for (const line of bomLines) {
    //   1        → no component picks / picked at full BOM qty;
    //   fraction → partial pick (pickedQty / bomQty);
    //   null     → DROP (component not picked or no derivable owner).
    const componentScale = repairScope ? repairComponentScale(line, repairScope) : 1;
    if (componentScale === null) continue;
    let required =
      line.qtyPerUnit *
      po.quantity *
      (1 + Math.max(0, line.wastePct || 0) / 100) *
      componentScale;
    if (required <= 0) continue;

    const rm = await resolveRmFromBom(db, line, cache);

    // FILLER (sponge) area-based consumption (owner 2026-07-30): sheets =
    // (cut area ÷ sheet area) × qty, only when both sizes are known.
    // line.cutLengthIn / cutWidthIn are already the EFFECTIVE (grown) size.
    if (rm && line.cutLengthIn && line.cutWidthIn) {
      const catDef = categoryDefaultSheet(rm.itemGroup, sheetDefaults);
      const sheetL = rm.sheetLengthIn ?? catDef?.length ?? 0;
      const sheetW = rm.sheetWidthIn ?? catDef?.width ?? 0;
      const sheetArea = sheetL * sheetW;
      const cutArea = line.cutLengthIn * line.cutWidthIn;
      if (sheetArea > 0 && cutArea > 0) {
        required = required * (cutArea / sheetArea);
      }
    }
    if (required <= 0) continue;

    // Repair Scope class filter needs the resolved itemGroup. Unresolvable AND
    // unclassifiable lines drop too (never over-consume on a partial repair).
    if (repairScope && !materialLineInScope(line, rm?.itemGroup ?? null, repairScope)) {
      continue;
    }

    out.push({
      name: line.name,
      code: line.inventoryCode || line.code,
      rm,
      required,
      consumeDept: consumeDeptOf(line.ownerDeptCodes),
      wipKey: line.ownerWipKey ?? "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consumption marks — which (wipKey, dept) slices of a PO have left stock.
//
// One row per (po_id, wip_key, dept_code), claimed with ON CONFLICT DO NOTHING
// BEFORE any FIFO write, so two concurrent completions can never both deduct
// the same slice. A claimed slice stays claimed even if its FIFO walk throws
// part-way — the same "never double-deduct, under-deduct on a lost race" trade
// the PO-level RM_ISSUE idempotency check made before this table existed.
//
// LEGACY POs: a PO whose materials were deducted under the old whole-PO rule
// has RM_ISSUE rows but NO marks. Such a PO is treated as fully consumed and
// never touched again (no double deduction across the switch-over).
// ---------------------------------------------------------------------------
let rmConsumeMarksEnsured = false;
export async function ensureRmConsumeMarksTable(db: D1Database): Promise<void> {
  if (rmConsumeMarksEnsured) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rm_consume_marks (
         id TEXT PRIMARY KEY,
         po_id TEXT NOT NULL,
         wip_key TEXT NOT NULL DEFAULT '',
         dept_code TEXT NOT NULL,
         job_card_id TEXT,
         created_at TEXT,
         UNIQUE (po_id, wip_key, dept_code)
       )`,
    )
    .run();
  rmConsumeMarksEnsured = true;
}

export const sliceKey = (wipKey: string, dept: string): string => `${wipKey}|${dept}`;

export type PoConsumeState = { legacyConsumed: boolean; consumed: Set<string> };

// Consumption state for many POs in a few queries (MRP) — or one PO (consume).
export async function loadConsumeState(
  db: D1Database,
  poIds: string[],
): Promise<Map<string, PoConsumeState>> {
  await ensureRmConsumeMarksTable(db);
  const out = new Map<string, PoConsumeState>();
  for (const id of poIds) out.set(id, { legacyConsumed: false, consumed: new Set() });
  if (poIds.length === 0) return out;
  const CHUNK = 500;
  const issued = new Set<string>();
  for (let i = 0; i < poIds.length; i += CHUNK) {
    const ids = poIds.slice(i, i + CHUNK);
    const ph = ids.map(() => "?").join(",");
    const [marks, issues] = await Promise.all([
      db
        .prepare(`SELECT po_id, wip_key, dept_code FROM rm_consume_marks WHERE po_id IN (${ph})`)
        .bind(...ids)
        .all<Record<string, unknown>>(),
      db
        .prepare(
          `SELECT DISTINCT refId FROM cost_ledger WHERE refType = 'PRODUCTION_ORDER' AND type = 'RM_ISSUE' AND refId IN (${ph})`,
        )
        .bind(...ids)
        .all<Record<string, unknown>>(),
    ]);
    for (const m of marks.results ?? []) {
      const st = out.get(String(m.po_id ?? m.poId ?? ""));
      if (st) {
        st.consumed.add(
          sliceKey(String(m.wip_key ?? m.wipKey ?? ""), String(m.dept_code ?? m.deptCode ?? "")),
        );
      }
    }
    for (const r of issues.results ?? []) issued.add(String(r.refId ?? r.refid ?? ""));
  }
  for (const [id, st] of out) {
    if (issued.has(id) && st.consumed.size === 0) st.legacyConsumed = true;
  }
  return out;
}

async function claimSlice(
  db: D1Database,
  poId: string,
  wipKey: string,
  dept: string,
  jobCardId: string | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO rm_consume_marks (id, po_id, wip_key, dept_code, job_card_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (po_id, wip_key, dept_code) DO NOTHING`,
    )
    .bind(genLedgerId("rmk"), poId, wipKey, dept, jobCardId, new Date().toISOString())
    .run();
  return Number(res?.meta?.changes ?? 0) > 0;
}

export type ConsumeResult = {
  skipped: boolean;
  materialCostSen: number;
  linesConsumed: number;
  shortages: { materialName: string; shortageQty: number }[];
  preview?: boolean;
};

// FIFO-deduct already-computed lines. Writes rm_batches, cost_ledger RM_ISSUE
// (refType PRODUCTION_ORDER — every existing reader keys on that) and
// raw_materials.balanceQty.
async function fifoConsumeLines(
  db: D1Database,
  po: ProductionOrderRow,
  lines: RequiredLine[],
): Promise<Omit<ConsumeResult, "skipped">> {
  const dateIso = po.completedDate
    ? new Date(`${po.completedDate}T12:00:00`).toISOString()
    : new Date().toISOString();

  let materialCostSen = 0;
  let linesConsumed = 0;
  const shortages: { materialName: string; shortageQty: number }[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const { rm, required, name } of lines) {
    if (!rm) {
      shortages.push({ materialName: name, shortageQty: required });
      continue;
    }

    const batchesRes = await db
      .prepare(
        "SELECT id, rmId, source, sourceRefId, receivedDate, originalQty, remainingQty, unitCostSen, created_at, notes FROM rm_batches WHERE rmId = ? AND remainingQty > 0 ORDER BY receivedDate ASC, id ASC",
      )
      .bind(rm.id)
      .all<RMBatchRow>();
    const rows = batchesRes.results ?? [];

    const batches: RMBatch[] = rows.map((b) => ({
      id: b.id,
      rmId: b.rmId,
      source: b.source as RMBatch["source"],
      sourceRefId: b.sourceRefId ?? undefined,
      receivedDate: b.receivedDate,
      originalQty: b.originalQty,
      remainingQty: b.remainingQty,
      unitCostSen: b.unitCostSen,
      createdAt: b.created_at ?? "",
      notes: b.notes ?? undefined,
    }));

    const result = fifoConsume(batches, required);

    // PR 0 (2026-05-20, owner-confirmed) — per-slice WHERE guard + serial
    // execution to prevent the FIFO over-pull race: each slice is a single
    // conditional UPDATE (`AND remainingQty >= ?`); if another writer drained
    // the batch first the UPDATE no-ops and we throw rather than issue stock
    // that is not physically there.
    for (const slice of result.slices) {
      // A sub-epsilon slice is float dust, not a real draw (2026-08-01).
      if (slice.qty <= QTY_EPSILON) continue;
      const updateRes = await db
        .prepare(
          "UPDATE rm_batches SET remainingQty = remainingQty - ? WHERE id = ? AND remainingQty >= ?",
        )
        .bind(slice.qty, slice.batchId, slice.qty)
        .run();
      if (!updateRes.meta || updateRes.meta.changes === 0) {
        throw new Error(
          `RM batch ${slice.batchId} race lost: PO ${po.poNo} (${name}) tried to consume ${slice.qty} but another writer left less than that available. Retry the completion.`,
        );
      }
      await db
        .prepare(
          `INSERT INTO cost_ledger
             (id, date, type, itemType, itemId, batchId, qty, direction,
              unitCostSen, totalCostSen, refType, refId, notes)
           VALUES (?, ?, 'RM_ISSUE', 'RM', ?, ?, ?, 'OUT', ?, ?, 'PRODUCTION_ORDER', ?, ?)`,
        )
        .bind(
          genLedgerId("rmi"),
          dateIso,
          rm.id,
          slice.batchId,
          slice.qty,
          slice.unitCostSen,
          slice.totalCostSen,
          po.id,
          `Issued for ${po.poNo} (${name})`,
        )
        .run();
      materialCostSen += slice.totalCostSen;
    }

    if (result.consumedQty > 0) {
      statements.push(
        db
          .prepare(
            // GREATEST not MAX — Postgres MAX is an aggregate (caught 2026-05-07).
            "UPDATE raw_materials SET balanceQty = GREATEST(0, balanceQty - ?) WHERE id = ?",
          )
          .bind(result.consumedQty, rm.id),
      );
      linesConsumed++;
    }

    if (result.shortageQty > 0) {
      shortages.push({ materialName: name, shortageQty: result.shortageQty });
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
  return { materialCostSen, linesConsumed, shortages };
}

// Shared driver: honour the legacy + PREVIEW gates, claim the slices `pick`
// selects, FIFO-deduct only the lines of slices this call claimed.
async function consumeSlices(
  db: D1Database,
  poId: string,
  pick: (line: RequiredLine) => boolean,
  jobCardId: string | null,
  opts?: { forceLive?: boolean },
): Promise<ConsumeResult> {
  const none: ConsumeResult = { skipped: true, materialCostSen: 0, linesConsumed: 0, shortages: [] };
  const state = (await loadConsumeState(db, [poId])).get(poId);
  if (state?.legacyConsumed) return none;

  // SELECT * — the Repair-Scope column is runtime-added (BUG-2026-06-10-001);
  // read dual-key in computeRequiredLines.
  const po = await db
    .prepare("SELECT * FROM production_orders WHERE id = ?")
    .bind(poId)
    .first<ProductionOrderRow>();
  if (!po || !po.quantity || po.quantity <= 0) {
    return { skipped: false, materialCostSen: 0, linesConsumed: 0, shortages: [] };
  }

  // RM-consumption gate (owner 2026-07-29). PREVIEW records what WOULD leave
  // stock for the whole PO and writes nothing else. Default LIVE — see
  // getRmConsumptionMode.
  const mode = opts?.forceLive ? "LIVE" : await getRmConsumptionMode(db);
  if (mode !== "LIVE") {
    const preview = await recordConsumePreview(db, po);
    return { skipped: false, materialCostSen: 0, linesConsumed: 0, shortages: preview.shortages, preview: true };
  }

  const all = await computeRequiredLines(db, po);
  const wanted = all.filter(
    (l) => pick(l) && !state?.consumed.has(sliceKey(l.wipKey, l.consumeDept)),
  );
  if (wanted.length === 0) return none;

  const bySlice = new Map<string, RequiredLine[]>();
  for (const l of wanted) {
    const k = sliceKey(l.wipKey, l.consumeDept);
    const arr = bySlice.get(k) ?? [];
    arr.push(l);
    bySlice.set(k, arr);
  }
  const claimed: RequiredLine[] = [];
  for (const lines of bySlice.values()) {
    if (await claimSlice(db, poId, lines[0].wipKey, lines[0].consumeDept, jobCardId)) {
      claimed.push(...lines);
    }
  }
  if (claimed.length === 0) return none;
  const res = await fifoConsumeLines(db, po, claimed);
  return { skipped: false, ...res };
}

// Per-WIP deduction (owner 2026-11-23). Called on EVERY job-card COMPLETED /
// TRANSFERRED transition: deducts only the BOM lines owned by this job card's
// top-level WIP in this job card's department. A job card with no wipKey
// (older cards) matches every WIP's lines of its department. Legacy untagged
// lines (wipKey "") ride on the first FAB_CUT completion, as before.
export async function consumeRawMaterialsForJobCard(
  db: D1Database,
  poId: string,
  jc: { id: string; wipKey?: string | null; departmentCode?: string | null },
  opts?: { forceLive?: boolean },
): Promise<ConsumeResult> {
  const dept = String(jc.departmentCode ?? "").toUpperCase();
  if (!dept) return { skipped: true, materialCostSen: 0, linesConsumed: 0, shortages: [] };
  const jcWip = String(jc.wipKey ?? "");
  return consumeSlices(
    db,
    poId,
    (l) => l.consumeDept === dept && (jcWip === "" || l.wipKey === "" || l.wipKey === jcWip),
    jc.id,
    opts,
  );
}

// Whole-PO deduction of everything NOT yet deducted. Safety net at PO
// COMPLETED (fg-completion) and the import-completion repair tool: a slice
// whose job card never fired (e.g. dept not built as a card) still leaves
// stock once the order is finished. Already-deducted slices and legacy POs are
// skipped, so this never double-deducts.
export async function consumeRawMaterialsForPO(
  db: D1Database,
  poId: string,
  opts?: { forceLive?: boolean },
): Promise<ConsumeResult> {
  return consumeSlices(db, poId, () => true, null, opts);
}

// ---------------------------------------------------------------------------
// F2 — Labor posting for a single job card on COMPLETED transition.
// Called from production-orders.ts whenever a job_card status moves to
// COMPLETED or TRANSFERRED. Idempotent per jobCardId.
//
// Multi-PIC split: a single JC can have up to 2 PICs per piece (see
// piece_pics table), and a multi-piece JC may have different workers on
// different pieces. We collect every DISTINCT worker id who appears in
// ANY pic1Id or pic2Id slot for this JC, then split the JC's production
// minutes evenly across them — one cost_ledger row per worker.
//
// Per-worker rate: each worker's minutes are costed at THEIR own
// production-cost rate — basic salary ÷ (working days − public holidays)
// ÷ hours/day ÷ 60 — via the shared labor engine. A worker with no salary
// set falls back to the default (RM 2050 / 9 h / 26 days).
//
// If no workers are attributed (no piece_pics rows, or all slots null),
// fall back to a single un-attributed LABOR_POSTED row at the default
// rate so the FG-batch cost rollup stays correct.
// ---------------------------------------------------------------------------
export async function postJobCardLabor(
  db: D1Database,
  jobCardId: string,
  productionOrderId: string,
): Promise<{
  skipped: boolean;
  laborSen: number;
  minutes: number;
  workerCount: number;
}> {
  // Idempotency — already posted for this job card? Check covers BOTH
  // legacy single-row and new multi-row shapes: any LABOR_POSTED ledger
  // entry with refType='JOB_CARD' AND refId=jcId means we've run.
  const existing = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM cost_ledger WHERE type = 'LABOR_POSTED' AND refType = 'JOB_CARD' AND refId = ?",
    )
    .bind(jobCardId)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) {
    return { skipped: true, laborSen: 0, minutes: 0, workerCount: 0 };
  }

  const jc = await db
    .prepare(
      "SELECT id, productionOrderId, departmentCode, status, completedDate, estMinutes, actualMinutes, productionTimeMinutes FROM job_cards WHERE id = ?",
    )
    .bind(jobCardId)
    .first<{
      id: string;
      productionOrderId: string;
      departmentCode: string | null;
      status: string;
      completedDate: string | null;
      estMinutes: number;
      actualMinutes: number | null;
      productionTimeMinutes: number;
    }>();
  if (!jc) return { skipped: false, laborSen: 0, minutes: 0, workerCount: 0 };

  // Prefer actualMinutes if recorded, else fall back to standard/estimate.
  const minutes =
    (jc.actualMinutes && jc.actualMinutes > 0
      ? jc.actualMinutes
      : jc.productionTimeMinutes || jc.estMinutes) || 0;
  if (minutes <= 0) {
    return { skipped: false, laborSen: 0, minutes: 0, workerCount: 0 };
  }

  const dateIso = jc.completedDate
    ? new Date(`${jc.completedDate}T12:00:00`).toISOString()
    : new Date().toISOString();
  const completionDate = new Date(dateIso);
  const rateYear = completionDate.getFullYear();
  const rateMonth = completionDate.getMonth() + 1;

  // Public holidays for the completion month — the production-cost rate
  // divides the monthly salary by (working days − public holidays), so a
  // holiday month costs each produced minute more.
  const phRow = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind("public_holidays")
    .first<{ value: string | null }>();
  const publicHolidays = new Set<string>();
  if (phRow?.value) {
    try {
      const parsed = JSON.parse(phRow.value);
      if (Array.isArray(parsed)) {
        for (const d of parsed) {
          if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
            publicHolidays.add(d);
          }
        }
      }
    } catch {
      /* malformed payload — treat as no holidays */
    }
  }
  // Rate for un-attributed labor / a deleted or un-configured worker.
  const defaultRatePerMin = productionCostRatePerMinuteSen(
    costingWorkerOrDefault(undefined),
    rateYear,
    rateMonth,
    publicHolidays,
  );

  // Collect distinct worker ids from piece_pics for this JC.
  const picsRes = await db
    .prepare(
      "SELECT pic1Id, pic2Id FROM piece_pics WHERE jobCardId = ?",
    )
    .bind(jobCardId)
    .all<{ pic1Id: string | null; pic2Id: string | null }>();
  const picRows = picsRes.results ?? [];
  const distinctWorkers = new Set<string>();
  for (const row of picRows) {
    if (row.pic1Id) distinctWorkers.add(row.pic1Id);
    if (row.pic2Id) distinctWorkers.add(row.pic2Id);
  }

  // No attributed workers → single un-attributed LABOR_POSTED row, at the
  // default rate, so the FG rollup still captures the labor cost.
  if (distinctWorkers.size === 0) {
    const laborSen = Math.round(defaultRatePerMin * minutes);
    if (laborSen <= 0) {
      return { skipped: false, laborSen: 0, minutes, workerCount: 0 };
    }
    await db
      .prepare(
        `INSERT INTO cost_ledger
           (id, date, type, itemType, itemId, batchId, qty, direction,
            unitCostSen, totalCostSen, refType, refId, notes, workerId)
         VALUES (?, ?, 'LABOR_POSTED', 'WIP', ?, NULL, ?, 'IN', ?, ?, 'JOB_CARD', ?, ?, NULL)`,
      )
      .bind(
        genLedgerId("lab"),
        dateIso,
        productionOrderId,
        minutes,
        Math.round(defaultRatePerMin),
        laborSen,
        jobCardId,
        `Labor posted for ${jc.departmentCode ?? "?"} (${minutes} min) — no worker attributed`,
      )
      .run();
    return { skipped: false, laborSen, minutes, workerCount: 0 };
  }

  // Per-worker rate — load each attributed worker's Employee Master
  // figures in one query and compute their own production-cost rate.
  const workerIds = [...distinctWorkers];
  const workerPlaceholders = workerIds.map(() => "?").join(", ");
  const workerRowsRes = await db
    .prepare(
      `SELECT id, basicSalarySen, workingHoursPerDay, workingDaysPerMonth FROM workers WHERE id IN (${workerPlaceholders})`,
    )
    .bind(...workerIds)
    .all<{
      id: string;
      basicSalarySen: number | null;
      workingHoursPerDay: number | null;
      workingDaysPerMonth: number | null;
    }>();
  const rateByWorker = new Map<string, number>();
  for (const w of workerRowsRes.results ?? []) {
    rateByWorker.set(
      w.id,
      productionCostRatePerMinuteSen(
        costingWorkerOrDefault(w),
        rateYear,
        rateMonth,
        publicHolidays,
      ),
    );
  }

  // Split minutes evenly across distinct workers (round half-up).
  const n = distinctWorkers.size;
  const perWorkerMinutes = Math.round((minutes / n) * 10) / 10; // 1 dp
  const statements: D1PreparedStatement[] = [];
  let totalLaborSen = 0;
  for (const wid of distinctWorkers) {
    // A worker id with no workers-table row (deleted) → default rate.
    const ratePerMin = rateByWorker.get(wid) ?? defaultRatePerMin;
    const workerSen = Math.round(ratePerMin * perWorkerMinutes);
    totalLaborSen += workerSen;
    if (workerSen <= 0) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO cost_ledger
             (id, date, type, itemType, itemId, batchId, qty, direction,
              unitCostSen, totalCostSen, refType, refId, notes, workerId)
           VALUES (?, ?, 'LABOR_POSTED', 'WIP', ?, NULL, ?, 'IN', ?, ?, 'JOB_CARD', ?, ?, ?)`,
        )
        .bind(
          genLedgerId("lab"),
          dateIso,
          productionOrderId,
          perWorkerMinutes,
          Math.round(ratePerMin),
          workerSen,
          jobCardId,
          `Labor posted for ${jc.departmentCode ?? "?"} — PIC share 1/${n} (${perWorkerMinutes} min)`,
          wid,
        ),
    );
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }

  return { skipped: false, laborSen: totalLaborSen, minutes, workerCount: n };
}

// ---------------------------------------------------------------------------
// F3 — FG batch cost backfill. Run AFTER consumeRawMaterialsForPO() and all
// relevant postJobCardLabor() calls have landed (so the ledger rollup is
// complete). Idempotent via FG_COMPLETED ledger entry check.
// ---------------------------------------------------------------------------
export async function backfillFGBatchCost(
  db: D1Database,
  poId: string,
): Promise<{
  skipped: boolean;
  materialCostSen: number;
  laborCostSen: number;
  totalCostSen: number;
  unitCostSen: number;
}> {
  // Idempotency — already emitted FG_COMPLETED for this PO?
  const fgExisting = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM cost_ledger WHERE type = 'FG_COMPLETED' AND refType = 'PRODUCTION_ORDER' AND refId = ?",
    )
    .bind(poId)
    .first<{ n: number }>();
  if ((fgExisting?.n ?? 0) > 0) {
    return {
      skipped: true,
      materialCostSen: 0,
      laborCostSen: 0,
      totalCostSen: 0,
      unitCostSen: 0,
    };
  }

  const batch = await db
    .prepare(
      "SELECT id, productId, productionOrderId, originalQty, completedDate FROM fg_batches WHERE productionOrderId = ? LIMIT 1",
    )
    .bind(poId)
    .first<{
      id: string;
      productId: string;
      productionOrderId: string;
      originalQty: number;
      completedDate: string;
    }>();
  if (!batch || !batch.originalQty || batch.originalQty <= 0) {
    return {
      skipped: false,
      materialCostSen: 0,
      laborCostSen: 0,
      totalCostSen: 0,
      unitCostSen: 0,
    };
  }

  const matSum = await db
    .prepare(
      "SELECT COALESCE(SUM(totalCostSen),0) AS s FROM cost_ledger WHERE type = 'RM_ISSUE' AND refType = 'PRODUCTION_ORDER' AND refId = ?",
    )
    .bind(poId)
    .first<{ s: number }>();
  const materialCostSen = matSum?.s ?? 0;

  // Labor entries are refType='JOB_CARD'. Join via job_cards.productionOrderId.
  const labSum = await db
    .prepare(
      `SELECT COALESCE(SUM(cl.totalCostSen),0) AS s
         FROM cost_ledger cl
         INNER JOIN job_cards jc ON jc.id = cl.refId
         WHERE cl.type = 'LABOR_POSTED'
           AND cl.refType = 'JOB_CARD'
           AND jc.productionOrderId = ?`,
    )
    .bind(poId)
    .first<{ s: number }>();
  const laborCostSen = labSum?.s ?? 0;

  const totalCostSen = materialCostSen + laborCostSen;
  const unitCostSen =
    batch.originalQty > 0 ? Math.round(totalCostSen / batch.originalQty) : 0;

  const dateIso = batch.completedDate
    ? new Date(`${batch.completedDate}T12:00:00`).toISOString()
    : new Date().toISOString();

  await db.batch([
    db
      .prepare(
        "UPDATE fg_batches SET unitCostSen = ?, materialCostSen = ?, laborCostSen = ?, overheadCostSen = 0 WHERE id = ?",
      )
      .bind(unitCostSen, materialCostSen, laborCostSen, batch.id),
    db
      .prepare(
        `INSERT INTO cost_ledger
           (id, date, type, itemType, itemId, batchId, qty, direction,
            unitCostSen, totalCostSen, refType, refId, notes)
         VALUES (?, ?, 'FG_COMPLETED', 'FG', ?, ?, ?, 'IN', ?, ?, 'PRODUCTION_ORDER', ?, ?)`,
      )
      .bind(
        genLedgerId("fgc"),
        dateIso,
        batch.productId,
        batch.id,
        batch.originalQty,
        unitCostSen,
        totalCostSen,
        poId,
        `FG completion for PO ${poId}`,
      ),
  ]);

  return {
    skipped: false,
    materialCostSen,
    laborCostSen,
    totalCostSen,
    unitCostSen,
  };
}

// ---------------------------------------------------------------------------
// F4 — Light WIP completion marker. Real WIP inventory deducts / layer
// creation is a bigger project — for now we emit a single WIP_COMPLETED
// ledger entry so month-end views can see something happened. Full
// tracking is TODO(wip-phase-2).
//
// Idempotency: checks for WIP_COMPLETED OR legacy ADJUSTMENT rows with a
// "WIP_COMPLETED" notes prefix (pre-migration-0011 shape).
// ---------------------------------------------------------------------------
export async function postWIPCompletionMarker(
  db: D1Database,
  poId: string,
  fgQty: number,
): Promise<{ skipped: boolean }> {
  if (fgQty <= 0) return { skipped: true };

  const existing = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM cost_ledger
         WHERE refType = 'PRODUCTION_ORDER' AND refId = ?
           AND (
             type = 'WIP_COMPLETED'
             OR (type = 'ADJUSTMENT' AND notes LIKE 'WIP_COMPLETED%')
           )`,
    )
    .bind(poId)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) {
    return { skipped: true };
  }

  // TODO(wip-phase-2): Walk the BOM tree, compute WIP layer qtys + cost
  // splits, insert wip_items / wip_layers rows, and emit one ledger entry
  // per WIP node. For now just a single summary marker so we don't pretend
  // WIP inventory is tracked.
  await db
    .prepare(
      `INSERT INTO cost_ledger
         (id, date, type, itemType, itemId, batchId, qty, direction,
          unitCostSen, totalCostSen, refType, refId, notes)
       VALUES (?, ?, 'WIP_COMPLETED', 'WIP', ?, NULL, ?, 'IN', 0, 0, 'PRODUCTION_ORDER', ?, ?)`,
    )
    .bind(
      genLedgerId("wip"),
      new Date().toISOString(),
      poId,
      fgQty,
      poId,
      `WIP_COMPLETED — ${fgQty} FG from PO ${poId}. TODO(wip-phase-2): full WIP layer tracking.`,
    )
    .run();

  return { skipped: false };
}
