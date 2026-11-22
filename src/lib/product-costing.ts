// ---------------------------------------------------------------------------
// product-costing.ts (pure) — what one finished good costs to make, from its
// BOM. Owner-approved rules: docs/plans/product-costing.md (D1–D14).
//
//   Labour    = BOM minutes × RM 2,200 / 26 d / 9 h / 60            (D1)
//   Materials = BOM qty × supplier price                             (D2)
//               main supplier's price, else the newest price of any
//               other supplier; no price → shown red, NEVER counted as 0
//   Fabric "from order" = metres × the TOP of each fabric tier        (D9)
//
// Quantities follow the BOM walkers already in use (products.ts minutes,
// po-cost-cascade.ts materials): a node's `quantity` is pieces PER FINISHED
// GOOD (it does not compound down the tree); a material's `qty` is per piece
// of its node; wastage expands it; a FILLER cut size consumes a fraction of a
// sheet. Scaling rules are NOT applied — this is the cost at the BOM's base
// size (the size the BOM is written for).
//
// Money is integer sen at the edges; per-unit prices may carry sub-sen
// (unit-price-precision) so amounts round ONCE per line.
// ---------------------------------------------------------------------------

export const LABOUR_SALARY_SEN = 220_000; // RM 2,200 / month (D1)
export const LABOUR_DAYS = 26;
export const LABOUR_HOURS = 9;
export const LABOUR_RATE_PER_MIN_SEN = LABOUR_SALARY_SEN / LABOUR_DAYS / LABOUR_HOURS / 60;

export type FabricTier = { level: string; minSen: number; maxSen: number };

/** D9 (owner 2026-11-22): per metre. Costing uses maxSen. */
export const DEFAULT_FABRIC_TIERS: FabricTier[] = [
  { level: "Lv1", minSen: 1000, maxSen: 1200 },
  { level: "Lv2", minSen: 1200, maxSen: 1600 },
  { level: "Lv3", minSen: 1600, maxSen: 2100 },
  { level: "Lv4", minSen: 2100, maxSen: 2500 },
];

/** Accepts whatever is stored; anything malformed falls back to the defaults. */
export function normaliseFabricTiers(raw: unknown): FabricTier[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_FABRIC_TIERS;
  const out: FabricTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") return DEFAULT_FABRIC_TIERS;
    const r = t as Record<string, unknown>;
    const level = String(r.level ?? "").trim();
    const minSen = Math.round(Number(r.minSen));
    const maxSen = Math.round(Number(r.maxSen));
    if (!level || !Number.isFinite(minSen) || !Number.isFinite(maxSen) || minSen < 0 || maxSen <= 0 || maxSen < minSen) {
      return DEFAULT_FABRIC_TIERS;
    }
    out.push({ level, minSen, maxSen });
  }
  return out;
}

// ---- inputs ---------------------------------------------------------------

export type BomProcessIn = { dept?: string; deptCode?: string; category?: string; minutes?: number | string };
export type BomMaterialIn = {
  code?: string;
  name?: string;
  qty?: number | string;
  unit?: string;
  wastePct?: number | string;
  inventoryCode?: string;
  autoDetect?: string;
  cutLengthIn?: number | string;
  cutWidthIn?: number | string;
};
export type BomNodeIn = {
  id?: string;
  wipCode?: string;
  wipType?: string;
  quantity?: number | string;
  processes?: BomProcessIn[];
  materials?: BomMaterialIn[];
  children?: BomNodeIn[];
};
export type BomIn = {
  l1Processes?: BomProcessIn[];
  l1Materials?: BomMaterialIn[];
  wipComponents?: BomNodeIn[];
};

export type RawMaterialIn = {
  itemCode: string;
  description?: string | null;
  baseUOM?: string | null;
  itemGroup?: string | null;
  sheetLengthIn?: number | null;
  sheetWidthIn?: number | null;
};

export type BindingIn = {
  materialCode: string;
  supplierName?: string | null;
  unitPrice: number | string; // sen per base unit (may carry sub-sen)
  currency?: string | null;
  isMainSupplier?: boolean | number | null;
  effectiveFrom?: string | null;
};

export type CostingInputs = {
  bom: BomIn;
  rawMaterials: RawMaterialIn[];
  bindings: BindingIn[];
  fabricTiers?: FabricTier[];
  /** kv variants-config sheetDefaults, keyed by item group (upper-case). */
  sheetDefaults?: Record<string, { length: number; width: number }>;
};

// ---- outputs --------------------------------------------------------------

export type MaterialStatus =
  | "priced" // has a supplier price
  | "no-price" // known material, no usable price → red, not counted
  | "no-code" // typed line that matches no raw material → red, not counted
  | "fabric-tier" // fabric "from order": priced per tier
  | "from-order"; // leg "from order": unknown until the order → red, not counted

export type CostProcess = {
  dept: string;
  deptCode: string;
  category: string;
  minutesPerPc: number;
  pcs: number;
  minutes: number;
  labourSen: number;
};

export type CostMaterial = {
  code: string;
  name: string;
  unit: string;
  /** Raw material base unit when it differs from the BOM line's unit. */
  priceUnit: string;
  unitMismatch: boolean;
  qtyPerPc: number;
  /** Per finished good, after pieces, wastage and sheet fraction. */
  qty: number;
  wastePct: number;
  status: MaterialStatus;
  priceSen: number | null;
  supplierName: string;
  isMainSupplier: boolean;
  /** null when not counted (no price / from order). Fabric: at the selected tier. */
  amountSen: number | null;
  /** Fabric "from order" only: amount at each tier's max. */
  tierAmountsSen?: Record<string, number>;
};

export type CostNode = {
  id: string;
  label: string;
  wipType: string;
  /** 1 = product level (L1 processes/materials), 2+ = WIP depth. */
  level: number;
  pcs: number;
  processes: CostProcess[];
  materials: CostMaterial[];
  labourSen: number;
  materialSen: number;
};

export type CostingResult = {
  labourRatePerMinSen: number;
  nodes: CostNode[];
  byDept: { deptCode: string; dept: string; minutes: number; labourSen: number }[];
  minutes: number;
  labourSen: number;
  /** Materials with a price, fabric at `tier`. */
  materialSen: number;
  totalSen: number;
  tier: string | null;
  tiers: { level: string; maxSen: number; materialSen: number; totalSen: number }[];
  materialLines: number;
  /** Lines not counted: no price / no code / leg from order. */
  missingLines: number;
  fabricFromOrderLines: number;
};

// ---- helpers --------------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const key = (s: unknown): string => String(s ?? "").trim().toUpperCase();
const isMain = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true" || v === "t";

export type PriceHistoryIn = {
  oldPrice: number | string;
  newPrice: number | string;
  effectiveFrom?: string | null;
  changedDate?: string | null;
};

/**
 * The price IN EFFECT on `today` (owner 2026-11-22: 「改价格应该都有effective
 * date的 好像customer price那样」). Saving a price with a future Effective
 * From overwrites the binding's unitPrice at once, so the binding alone would
 * cost with a price that has not started yet. The price trail holds each
 * change with its effective date: take the newest change effective on or
 * before today; if every change is still in the future, the price before the
 * first one (its oldPrice) is today's — 0 there means "no price yet".
 */
export function priceInEffect(
  binding: { unitPrice: number | string; effectiveFrom?: string | null },
  history: readonly PriceHistoryIn[],
  today: string,
): { priceSen: number; effectiveFrom: string } | null {
  const day = (s: unknown) => String(s ?? "").slice(0, 10);
  const eff = (h: PriceHistoryIn) => day(h.effectiveFrom) || day(h.changedDate);
  const started = history
    .filter((h) => eff(h) && eff(h) <= today)
    .sort((a, b) => eff(b).localeCompare(eff(a)) || day(b.changedDate).localeCompare(day(a.changedDate)));
  const bindingFrom = day(binding.effectiveFrom);
  if (!bindingFrom || bindingFrom <= today) {
    // The binding's own price has started; it is the newest unless the trail
    // has a later-started change (cannot normally happen, but trust dates).
    if (started[0] && bindingFrom && eff(started[0]) > bindingFrom) {
      return { priceSen: num(started[0].newPrice), effectiveFrom: eff(started[0]) };
    }
    return { priceSen: num(binding.unitPrice), effectiveFrom: bindingFrom };
  }
  if (started[0]) return { priceSen: num(started[0].newPrice), effectiveFrom: eff(started[0]) };
  const future = history.filter((h) => eff(h) > today).sort((a, b) => eff(a).localeCompare(eff(b)));
  const before = future[0] ? num(future[0].oldPrice) : 0;
  return before > 0 ? { priceSen: before, effectiveFrom: "" } : null;
}

/**
 * D2: the main supplier's price; else the newest (effectiveFrom) price among
 * the others. Only MYR prices above 0 count — a CNY-only material is treated
 * as having no price rather than mixing currencies.
 */
export function pickPrice(bindings: readonly BindingIn[]): { priceSen: number; supplierName: string; isMainSupplier: boolean } | null {
  const usable = bindings.filter((b) => num(b.unitPrice) > 0 && key(b.currency || "MYR") === "MYR");
  if (usable.length === 0) return null;
  const main = usable.find((b) => isMain(b.isMainSupplier));
  const pick =
    main ??
    [...usable].sort((a, b) => String(b.effectiveFrom ?? "").localeCompare(String(a.effectiveFrom ?? "")))[0];
  return { priceSen: num(pick.unitPrice), supplierName: String(pick.supplierName ?? ""), isMainSupplier: isMain(pick.isMainSupplier) };
}

const FILLER_SHEET = { length: 96, width: 48 };

function sheetFraction(
  m: BomMaterialIn,
  rm: RawMaterialIn | undefined,
  defaults: Record<string, { length: number; width: number }>,
): number {
  const cl = num(m.cutLengthIn);
  const cw = num(m.cutWidthIn);
  if (!rm || cl <= 0 || cw <= 0) return 1;
  const g = key(rm.itemGroup);
  const def = defaults[g] ?? (/FILLER/.test(g) ? FILLER_SHEET : null);
  const sl = num(rm.sheetLengthIn) || def?.length || 0;
  const sw = num(rm.sheetWidthIn) || def?.width || 0;
  return sl * sw > 0 ? (cl * cw) / (sl * sw) : 1;
}

// ---- engine ---------------------------------------------------------------

export function computeCosting(input: CostingInputs, opts: { tier?: string } = {}): CostingResult {
  const tiers = input.fabricTiers ?? DEFAULT_FABRIC_TIERS;
  const tier = tiers.find((t) => t.level === opts.tier) ?? tiers[0] ?? null;
  const defaults = input.sheetDefaults ?? {};
  const rmByCode = new Map<string, RawMaterialIn>();
  const rmByName = new Map<string, RawMaterialIn>();
  for (const rm of input.rawMaterials) {
    rmByCode.set(key(rm.itemCode), rm);
    if (rm.description) rmByName.set(key(rm.description), rm);
  }
  const bindingsByCode = new Map<string, BindingIn[]>();
  for (const b of input.bindings) {
    const k = key(b.materialCode);
    const list = bindingsByCode.get(k) ?? [];
    list.push(b);
    bindingsByCode.set(k, list);
  }

  const nodes: CostNode[] = [];
  const dept = new Map<string, { deptCode: string; dept: string; minutes: number; labourSen: number }>();
  const tierTotals = new Map<string, number>(tiers.map((t) => [t.level, 0]));
  let materialLines = 0;
  let missingLines = 0;
  let fabricFromOrderLines = 0;

  const costProcess = (p: BomProcessIn, pcs: number): CostProcess | null => {
    const per = num(p.minutes);
    if (per <= 0) return null;
    const minutes = per * pcs;
    const labourSen = Math.round(minutes * LABOUR_RATE_PER_MIN_SEN);
    const deptCode = key(p.deptCode) || key(p.dept);
    const row = dept.get(deptCode) ?? { deptCode, dept: String(p.dept ?? deptCode), minutes: 0, labourSen: 0 };
    row.minutes += minutes;
    row.labourSen += labourSen;
    dept.set(deptCode, row);
    return { dept: String(p.dept ?? deptCode), deptCode, category: String(p.category ?? ""), minutesPerPc: per, pcs, minutes, labourSen };
  };

  const costMaterial = (m: BomMaterialIn, pcs: number): CostMaterial | null => {
    const qtyPerPc = num(m.qty);
    const auto = key(m.autoDetect);
    const code = String(m.inventoryCode || m.code || "").trim();
    const name = String(m.name || "").trim() || (auto === "FABRIC" ? "Fabric (from order)" : auto === "LEG" ? "Leg (from order)" : code);
    if (qtyPerPc <= 0 || (!code && !name && !auto)) return null;
    const rm = rmByCode.get(key(m.inventoryCode)) ?? rmByCode.get(key(m.code)) ?? rmByName.get(key(m.name));
    const wastePct = Math.max(0, num(m.wastePct));
    const qty = qtyPerPc * pcs * (1 + wastePct / 100) * sheetFraction(m, rm, defaults);
    const unit = String(m.unit ?? "").trim();
    const priceUnit = String(rm?.baseUOM ?? "").trim();
    const base: CostMaterial = {
      code: rm?.itemCode ?? code,
      name: name || String(rm?.description ?? ""),
      unit,
      priceUnit: priceUnit || unit,
      unitMismatch: !!priceUnit && !!unit && key(priceUnit) !== key(unit),
      qtyPerPc,
      qty,
      wastePct,
      status: "no-price",
      priceSen: null,
      supplierName: "",
      isMainSupplier: false,
      amountSen: null,
    };
    materialLines += 1;
    if (auto === "FABRIC") {
      fabricFromOrderLines += 1;
      const tierAmountsSen: Record<string, number> = {};
      for (const t of tiers) {
        tierAmountsSen[t.level] = Math.round(qty * t.maxSen);
        tierTotals.set(t.level, (tierTotals.get(t.level) ?? 0) + tierAmountsSen[t.level]);
      }
      return {
        ...base,
        status: "fabric-tier",
        priceSen: tier?.maxSen ?? null,
        unitMismatch: false,
        amountSen: tier ? tierAmountsSen[tier.level] : null,
        tierAmountsSen,
      };
    }
    if (auto === "LEG") {
      missingLines += 1;
      return { ...base, status: "from-order" };
    }
    if (!rm) {
      missingLines += 1;
      return { ...base, status: "no-code" };
    }
    const price = pickPrice(bindingsByCode.get(key(rm.itemCode)) ?? []);
    if (!price) {
      missingLines += 1;
      return base;
    }
    const amountSen = Math.round(qty * price.priceSen);
    for (const t of tiers) tierTotals.set(t.level, (tierTotals.get(t.level) ?? 0) + amountSen);
    return { ...base, status: "priced", ...price, amountSen };
  };

  const pushNode = (
    id: string,
    label: string,
    wipType: string,
    level: number,
    pcs: number,
    procs: BomProcessIn[] | undefined,
    mats: BomMaterialIn[] | undefined,
  ) => {
    const processes = (procs ?? []).map((p) => costProcess(p, pcs)).filter((p): p is CostProcess => !!p);
    const materials = (mats ?? []).map((m) => costMaterial(m, pcs)).filter((m): m is CostMaterial => !!m);
    nodes.push({
      id,
      label,
      wipType,
      level,
      pcs,
      processes,
      materials,
      labourSen: processes.reduce((s, p) => s + p.labourSen, 0),
      materialSen: materials.reduce((s, m) => s + (m.amountSen ?? 0), 0),
    });
  };

  const bom = input.bom ?? {};
  if ((bom.l1Processes?.length ?? 0) > 0 || (bom.l1Materials?.length ?? 0) > 0) {
    pushNode("l1", "Product", "PRODUCT", 1, 1, bom.l1Processes, bom.l1Materials);
  }
  const walk = (list: BomNodeIn[] | undefined, level: number) => {
    (list ?? []).forEach((n, i) => {
      const q = num(n.quantity);
      const pcs = q > 0 ? q : 1;
      pushNode(String(n.id ?? `${level}-${i}`), String(n.wipCode ?? n.wipType ?? ""), String(n.wipType ?? ""), level, pcs, n.processes, n.materials);
      walk(n.children, level + 1);
    });
  };
  walk(bom.wipComponents, 2);

  const minutes = nodes.reduce((s, n) => s + n.processes.reduce((a, p) => a + p.minutes, 0), 0);
  const labourSen = nodes.reduce((s, n) => s + n.labourSen, 0);
  const materialSen = nodes.reduce((s, n) => s + n.materialSen, 0);
  return {
    labourRatePerMinSen: LABOUR_RATE_PER_MIN_SEN,
    nodes,
    byDept: [...dept.values()],
    minutes,
    labourSen,
    materialSen,
    totalSen: labourSen + materialSen,
    tier: fabricFromOrderLines > 0 ? tier?.level ?? null : null,
    tiers:
      fabricFromOrderLines > 0
        ? tiers.map((t) => ({ level: t.level, maxSen: t.maxSen, materialSen: tierTotals.get(t.level) ?? 0, totalSen: labourSen + (tierTotals.get(t.level) ?? 0) }))
        : [],
    materialLines,
    missingLines,
    fabricFromOrderLines,
  };
}

/** Margin on a price (sen): {marginSen, pct}; pct null when price ≤ 0. */
export function marginOn(priceSen: number, costSen: number): { marginSen: number; pct: number | null } {
  const marginSen = priceSen - costSen;
  return { marginSen, pct: priceSen > 0 ? (marginSen / priceSen) * 100 : null };
}

/** Selling price for a target margin %: cost ÷ (1 − m). null when m ≥ 100. */
export function priceForMargin(costSen: number, marginPct: number): number | null {
  if (!Number.isFinite(marginPct) || marginPct >= 100) return null;
  return Math.round(costSen / (1 - marginPct / 100));
}

// ---- standard cost (D3) ---------------------------------------------------

/** What is kept with a standard so later prices can be compared line by line. */
export type StandardSnapshot = {
  /** material code → unit price (sen) at the time the standard was set. */
  linePrices: Record<string, number>;
  /** fabric tier → material total (sen), so a tier switch compares like with like. */
  tierMaterialSen: Record<string, number>;
};

export function standardSnapshot(r: CostingResult): StandardSnapshot {
  const linePrices: Record<string, number> = {};
  for (const n of r.nodes) {
    for (const m of n.materials) {
      if (m.status === "priced" && m.priceSen != null && m.code) linePrices[m.code.toUpperCase()] = m.priceSen;
    }
  }
  const tierMaterialSen: Record<string, number> = {};
  for (const t of r.tiers) tierMaterialSen[t.level] = t.materialSen;
  return { linePrices, tierMaterialSen };
}

/** Today's cost against the standard, at the same fabric tier when there is one. */
export function compareToStandard(
  today: Pick<CostingResult, "labourSen" | "materialSen" | "totalSen" | "tier">,
  std: { labourSen: number; materialSen: number; tierMaterialSen?: Record<string, number> },
): { stdMaterialSen: number; stdTotalSen: number; diffSen: number; diffPct: number | null } {
  const stdMaterialSen =
    today.tier && std.tierMaterialSen && std.tierMaterialSen[today.tier] != null ? std.tierMaterialSen[today.tier] : std.materialSen;
  const stdTotalSen = std.labourSen + stdMaterialSen;
  const diffSen = today.totalSen - stdTotalSen;
  return { stdMaterialSen, stdTotalSen, diffSen, diffPct: stdTotalSen > 0 ? (diffSen / stdTotalSen) * 100 : null };
}
