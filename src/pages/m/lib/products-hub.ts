// ---------------------------------------------------------------------------
// products-hub — pure logic behind the phone Products screen (SKU Master +
// Catalog, `Products Hub.dc.html`). No React, so tests/m-products-hub.test.mjs
// can pin it.
//
// Every rule here mirrors the desktop Products page so the phone and desktop
// never disagree:
//   • families   — familyOf(code), sub-grouped by stored baseModel, exactly as
//                  buildModelGroups in src/pages/products/catalog.tsx;
//   • sofa tiers — an entry without `tier` is Price 2 (entryTier in
//                  src/pages/products/index.tsx), the tier view is saved under
//                  the same localStorage key the desktop SKU Master uses;
//   • prices     — Bedframe Price 1 = price1Sen, Price 2 = basePriceSen;
//                  Accessory = basePriceSen; Sofa = seatHeightPrices only.
//                  A missing or non-positive price is "no price", never RM 0.00.
// ---------------------------------------------------------------------------
import { familyOf } from "../../../lib/product-family";

export type SofaTier = "PRICE_1" | "PRICE_2" | "PRICE_3";

export const SOFA_TIERS: { value: SofaTier; label: string }[] = [
  { value: "PRICE_1", label: "P1" },
  { value: "PRICE_2", label: "P2" },
  { value: "PRICE_3", label: "P3" },
];

/** Same key as the desktop SKU Master, so both remember one tier view. */
export const SOFA_TIER_KEY = "hookka.products.sofaTier";

export type SeatPrice = { height: string; priceSen: number; tier?: SofaTier };

export type HubProduct = {
  id: string;
  code: string;
  name: string;
  category: string;
  baseModel: string;
  sizeLabel: string;
  unitM3: number | null;
  productionTimeMinutes: number | null;
  /** Price 2 (bedframe) / base price (accessory). Undefined when not set or withheld. */
  basePriceSen?: number;
  /** Price 1 (bedframe). */
  price1Sen?: number;
  seatHeightPrices: SeatPrice[];
};

type Raw = Record<string, unknown>;

function rawStr(r: Raw, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function rawNum(r: Raw, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = r[k];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** A positive integer-sen price, or undefined. 0 / null / missing = not set. */
function positiveSen(n: number | null): number | undefined {
  return n != null && n > 0 ? Math.round(n) : undefined;
}

/** Strip the inch mark and blanks so `28`, `"28"` and `28"` compare equal. */
export function normHeight(h: unknown): string {
  return String(h ?? "").replace(/"/g, "").trim();
}

function toTier(t: unknown): SofaTier | undefined {
  return t === "PRICE_1" || t === "PRICE_2" || t === "PRICE_3" ? t : undefined;
}

/** One /api/products row → HubProduct (dual-keyed reads). */
export function toHubProduct(r: Raw): HubProduct {
  const code = rawStr(r, "code");
  const seatRaw = r.seatHeightPrices ?? r.seat_height_prices;
  const seats: SeatPrice[] = Array.isArray(seatRaw)
    ? seatRaw
        .filter((e): e is Raw => !!e && typeof e === "object")
        .map((e) => ({
          height: normHeight(e.height),
          priceSen: rawNum(e, "priceSen", "price_sen") ?? 0,
          tier: toTier(e.tier),
        }))
        .filter((e) => e.height.length > 0)
    : [];
  return {
    id: rawStr(r, "id") || code,
    code,
    name: rawStr(r, "name"),
    category: rawStr(r, "category").toUpperCase(),
    baseModel: rawStr(r, "baseModel", "base_model") || code,
    sizeLabel: rawStr(r, "sizeLabel", "size_label"),
    unitM3: rawNum(r, "unitM3", "unit_m3"),
    productionTimeMinutes: rawNum(r, "productionTimeMinutes", "production_time_minutes"),
    basePriceSen: positiveSen(rawNum(r, "basePriceSen", "base_price_sen")),
    price1Sen: positiveSen(rawNum(r, "price1Sen", "price1_sen")),
    seatHeightPrices: seats,
  };
}

// ---- Categories -------------------------------------------------------------

export const KNOWN_CATEGORIES = ["SOFA", "BEDFRAME", "ACCESSORY"] as const;

export function categoryLabel(cat: string): string {
  if (!cat) return "Uncategorised";
  return cat.charAt(0) + cat.slice(1).toLowerCase();
}

/** Category → tone key for the Products Hub v2 colours; unknown → "other". */
export function categoryTone(cat: string): "sofa" | "bedframe" | "accessory" | "other" {
  if (cat === "SOFA") return "sofa";
  if (cat === "BEDFRAME") return "bedframe";
  if (cat === "ACCESSORY") return "accessory";
  return "other";
}

/** The chip keys: All, the three known categories, then any other category present. */
export function categoryKeys(products: HubProduct[]): string[] {
  const extra = [...new Set(products.map((p) => p.category))]
    .filter((c) => !(KNOWN_CATEGORIES as readonly string[]).includes(c))
    .sort();
  return ["all", ...KNOWN_CATEGORIES, ...extra];
}

// ---- Families (mirror of catalog.tsx buildModelGroups) ------------------------

export type HubVariant = { baseModel: string; products: HubProduct[] };

export type HubFamily = {
  familyKey: string;
  category: string;
  name: string;
  products: HubProduct[];
  variants: HubVariant[];
};

export function buildFamilies(products: HubProduct[]): HubFamily[] {
  const map = new Map<string, HubProduct[]>();
  for (const p of products) {
    const key = familyOf(p.code) || p.code;
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  const out: HubFamily[] = [];
  for (const [familyKey, ps] of map) {
    const vMap = new Map<string, HubProduct[]>();
    for (const p of ps) {
      const k = p.baseModel || p.code;
      const arr = vMap.get(k);
      if (arr) arr.push(p);
      else vMap.set(k, [p]);
    }
    const variants = [...vMap.entries()]
      .map(([baseModel, vps]) => ({
        baseModel,
        products: vps.slice().sort((a, b) => a.code.localeCompare(b.code)),
      }))
      .sort((a, b) => a.baseModel.localeCompare(b.baseModel));
    out.push({
      familyKey,
      category: ps[0].category,
      name: ps[0].name,
      products: ps.slice().sort((a, b) => a.code.localeCompare(b.code)),
      variants,
    });
  }
  return out;
}

export function familyCounts(f: HubFamily): string {
  const v = f.variants.length;
  const n = f.products.length;
  return `${v} variant${v === 1 ? "" : "s"} · ${n} SKU${n === 1 ? "" : "s"}`;
}

// ---- Search, filter, sort ----------------------------------------------------

export type HubSort = "name" | "code";
export type HubFilters = { sizes: string[]; sort: HubSort };
export const EMPTY_FILTERS: HubFilters = { sizes: [], sort: "name" };

function words(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAll(text: string, ws: string[]): boolean {
  const t = text.toLowerCase();
  return ws.every((w) => t.includes(w));
}

export function inCategory(cat: string, chip: string): boolean {
  return chip === "all" || cat === chip;
}

export function passesFilters(p: HubProduct, f: HubFilters): boolean {
  return f.sizes.length === 0 || f.sizes.includes(p.sizeLabel);
}

export function sortProducts(list: HubProduct[], sort: HubSort): HubProduct[] {
  return list.slice().sort((a, b) =>
    sort === "code"
      ? a.code.localeCompare(b.code)
      : a.name.localeCompare(b.name) || a.code.localeCompare(b.code),
  );
}

export function sortFamilies(list: HubFamily[], sort: HubSort): HubFamily[] {
  return list.slice().sort((a, b) =>
    sort === "code"
      ? a.familyKey.localeCompare(b.familyKey)
      : a.name.localeCompare(b.name) || a.familyKey.localeCompare(b.familyKey),
  );
}

/** A family stays when any of its SKUs passes the filters. */
export function familyPasses(f: HubFamily, filters: HubFilters): boolean {
  return f.products.some((p) => passesFilters(p, filters));
}

/** Distinct real size labels in the category scope, for the filter sheet. */
export function sizeOptions(products: HubProduct[], chip: string): string[] {
  return [
    ...new Set(
      products.filter((p) => inCategory(p.category, chip) && p.sizeLabel).map((p) => p.sizeLabel),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** Unified search: SKU hits (exact code first) and family hits, category-scoped. */
export function searchHub(
  products: HubProduct[],
  families: HubFamily[],
  q: string,
  chip: string,
): { skus: HubProduct[]; exactId: string | null; families: HubFamily[] } {
  const ws = words(q);
  if (ws.length === 0) return { skus: [], exactId: null, families: [] };
  const needle = q.trim().toLowerCase();
  const hits = sortProducts(
    products.filter(
      (p) =>
        inCategory(p.category, chip) &&
        matchesAll(`${p.code} ${p.name} ${p.baseModel} ${p.sizeLabel}`, ws),
    ),
    "code",
  );
  const exact = hits.find((p) => p.code.toLowerCase() === needle) ?? null;
  const skus = exact ? [exact, ...hits.filter((p) => p !== exact)] : hits;
  const fams = families.filter(
    (f) =>
      inCategory(f.category, chip) &&
      (matchesAll(`${f.familyKey} ${f.name}`, ws) ||
        f.variants.some((v) => matchesAll(v.baseModel, ws))),
  );
  return { skus, exactId: exact?.id ?? null, families: sortFamilies(fams, "code") };
}

// ---- Pricing -----------------------------------------------------------------

export function entryTier(t: SofaTier | undefined): SofaTier {
  return t ?? "PRICE_2";
}

export function readSofaTier(saved: string | null | undefined): SofaTier {
  if (saved === "PRICE_1" || saved === "PRICE_2" || saved === "PRICE_3") return saved;
  if (saved === "P1") return "PRICE_1";
  if (saved === "P3") return "PRICE_3";
  return "PRICE_2";
}

/** The positive seat price for (height, tier), or null when that cell is not set. */
export function seatPrice(p: HubProduct, height: string, tier: SofaTier): number | null {
  const h = normHeight(height);
  const e = p.seatHeightPrices.find(
    (s) => s.height === h && entryTier(s.tier) === tier && s.priceSen > 0,
  );
  return e ? e.priceSen : null;
}

/**
 * Rows of the sofa price sheet: the Maintenance seat sizes first (the same
 * columns as the desktop grid), then any height that carries a real price but
 * is no longer in Maintenance, so no stored price is hidden.
 */
export function seatRows(p: HubProduct, maintenanceHeights: string[]): string[] {
  const base = maintenanceHeights.map(normHeight).filter(Boolean);
  const extra = [
    ...new Set(
      p.seatHeightPrices
        .filter((s) => s.priceSen > 0 && !base.includes(s.height))
        .map((s) => s.height),
    ),
  ];
  return [...base, ...extra];
}

export type PriceDisplay =
  | { kind: "sofa" }
  | { kind: "bedframe"; p1?: number; p2?: number }
  | { kind: "single"; base: number }
  | { kind: "none" };

/** What the SKU card shows in its price slot. */
export function priceDisplay(p: HubProduct): PriceDisplay {
  if (p.category === "SOFA") {
    return p.seatHeightPrices.some((s) => s.priceSen > 0) ? { kind: "sofa" } : { kind: "none" };
  }
  if (p.category === "BEDFRAME") {
    return p.price1Sen == null && p.basePriceSen == null
      ? { kind: "none" }
      : { kind: "bedframe", p1: p.price1Sen, p2: p.basePriceSen };
  }
  return p.basePriceSen != null ? { kind: "single", base: p.basePriceSen } : { kind: "none" };
}

// ---- Specs -------------------------------------------------------------------

export function fmtMinutes(m: number | null): string | null {
  if (m == null || !(m > 0)) return null;
  const mins = Math.round(m);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtM3(v: number | null): string | null {
  return v != null && v > 0 ? `${v.toFixed(2)} m³` : null;
}

// ---- Product detail (ProductDetailScreen, Products Hub v2) ---------------------

/** The family key a SKU belongs to (same rule as buildFamilies / desktop Catalog). */
export function familyKeyOf(code: string): string {
  return familyOf(code) || code;
}

/** The family holding this product: by id, else by its family key. */
export function familyOfProduct(
  families: HubFamily[],
  p: { id: string; code: string },
): HubFamily | null {
  return (
    families.find((f) => f.products.some((x) => x.id === p.id)) ??
    families.find((f) => f.familyKey === familyKeyOf(p.code)) ??
    null
  );
}

/** BOM row icon tone (prototype: fabric plum, foam teal, wood ochre, hardware neutral). */
export type MaterialTone = "fabric" | "foam" | "wood" | "hardware";

export function materialTone(category: string): MaterialTone {
  const c = (category || "").toUpperCase();
  if (c.includes("FABRIC")) return "fabric";
  if (c.includes("FILLER") || c.includes("FOAM")) return "foam";
  if (c.includes("PLYWOOD") || c.startsWith("WD_") || c.includes("WOOD")) return "wood";
  return "hardware";
}

/** `FABRIC_SEWING` → "Fabric Sewing". */
export function deptLabel(code: string): string {
  const words = (code || "").split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return "Department";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export type DeptRow = { id: string; dept: string; category: string; minutes: number; pct: number };

/**
 * Dept Working Times as bar rows. `totalMinutes` is the sum of the rows shown
 * ("Department Time Total") — NOT productionTimeMinutes, which the API derives
 * from the active BOM template and can differ (owner 2026-10-21).
 */
export function deptRows(raw: unknown): { rows: DeptRow[]; totalMinutes: number } {
  const list = Array.isArray(raw) ? (raw as Raw[]) : [];
  const base = list
    .filter((r) => !!r && typeof r === "object")
    .map((r, i) => {
      const code = rawStr(r, "departmentCode", "department_code");
      const m = rawNum(r, "minutes");
      return {
        id: rawStr(r, "id") || `${code || "dept"}-${i}`,
        dept: deptLabel(code),
        category: rawStr(r, "category"),
        minutes: m != null && m > 0 ? m : 0,
      };
    });
  return withBars(base);
}

function withBars(base: Omit<DeptRow, "pct">[]): { rows: DeptRow[]; totalMinutes: number } {
  const max = base.reduce((a, r) => Math.max(a, r.minutes), 0);
  const totalMinutes = base.reduce((a, r) => a + r.minutes, 0);
  return {
    rows: base.map((r) => ({ ...r, pct: max > 0 ? Math.round((r.minutes / max) * 100) : 0 })),
    totalMinutes,
  };
}

// ---- Active BOM template (GET /api/bom/templates) -------------------------------
//
// The BOM editor's source of truth. The SKU's productionTimeMinutes is computed
// by the API from this same template (fetchProductWithChildren in
// src/api/routes/products.ts): productCode = the SKU code exactly, versionStatus
// ACTIVE (missing = DRAFT), newest effectiveFrom first with empty last, one row.
// The list endpoint orders by productCode only, so the pick is repeated here.

export type BomTemplate = {
  id: string;
  productCode: string;
  version: string;
  effectiveFrom: string;
  l1Processes: unknown[];
  wipComponents: unknown[];
};

/** The ACTIVE template for exactly this code, chosen as the API does; else null. */
export function pickActiveTemplate(resp: unknown, code: string): BomTemplate | null {
  const list = resp && typeof resp === "object" ? (resp as { data?: unknown }).data : undefined;
  if (!Array.isArray(list) || !code) return null;
  const hits = (list as Raw[])
    .filter((t) => !!t && typeof t === "object")
    .filter(
      (t) =>
        rawStr(t, "productCode", "product_code") === code &&
        (rawStr(t, "versionStatus", "version_status") || "DRAFT").toUpperCase() === "ACTIVE",
    )
    .sort((a, b) =>
      rawStr(b, "effectiveFrom", "effective_from").localeCompare(rawStr(a, "effectiveFrom", "effective_from")),
    );
  const t = hits[0];
  if (!t) return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    id: rawStr(t, "id"),
    productCode: code,
    version: rawStr(t, "version"),
    effectiveFrom: rawStr(t, "effectiveFrom", "effective_from"),
    l1Processes: arr(t.l1Processes ?? t.l1_processes),
    wipComponents: arr(t.wipComponents ?? t.wip_components),
  };
}

type WipRaw = Raw & { processes?: unknown; materials?: unknown; children?: unknown };

function wipList(v: unknown): WipRaw[] {
  return Array.isArray(v) ? (v.filter((w) => !!w && typeof w === "object") as WipRaw[]) : [];
}

/**
 * Department rows of the template, summed per department with the API's own
 * rule (bomTotalMinutes): L1 processes once; each WIP's processes × its
 * quantity (missing = 1); children counted on their own. So totalMinutes equals
 * the productionTimeMinutes the API derives from this template.
 */
export function templateDeptRows(t: BomTemplate): { rows: DeptRow[]; totalMinutes: number } {
  const byDept = new Map<string, Omit<DeptRow, "pct">>();
  const add = (proc: unknown, times: number) => {
    if (!proc || typeof proc !== "object") return;
    const r = proc as Raw;
    const code = rawStr(r, "deptCode", "dept_code", "departmentCode");
    const minutes = (rawNum(r, "minutes") ?? 0) * times;
    const key = code || rawStr(r, "dept") || "dept";
    const cur = byDept.get(key);
    if (cur) cur.minutes += minutes;
    else byDept.set(key, { id: key, dept: rawStr(r, "dept") || deptLabel(code), category: "", minutes });
  };
  for (const p of t.l1Processes) add(p, 1);
  const walk = (wips: WipRaw[]) => {
    for (const w of wips) {
      const q = rawNum(w, "quantity");
      const times = q ?? 1;
      for (const p of Array.isArray(w.processes) ? w.processes : []) add(p, times);
      walk(wipList(w.children));
    }
  };
  walk(wipList(t.wipComponents));
  return withBars([...byDept.values()].map((r) => ({ ...r, minutes: r.minutes > 0 ? r.minutes : 0 })));
}

/** One row of the detail's Bill of materials (template or legacy source). */
export type BomRow = { id: string; title: string; sub: string; qty: string | null; tone: MaterialTone };

function qtyText(qty: number | null, unit: string): string | null {
  return qty != null && qty > 0 ? `${qty}${unit ? ` ${unit}` : ""}` : null;
}

/**
 * Materials stored on the template's WIP components (the list endpoint does
 * not return product-level l1Materials). Quantities are shown as stored, per
 * component — not multiplied out. Sub-line = the component they belong to.
 */
export function templateMaterials(t: BomTemplate): BomRow[] {
  const out: BomRow[] = [];
  const walk = (wips: WipRaw[]) => {
    for (const w of wips) {
      const comp = rawStr(w, "wipCode", "wip_code") || deptLabel(rawStr(w, "wipType", "wip_type"));
      const mats = Array.isArray(w.materials) ? (w.materials as unknown[]) : [];
      mats.forEach((m, i) => {
        if (!m || typeof m !== "object") return;
        const r = m as Raw;
        const name = rawStr(r, "name");
        const code = rawStr(r, "code", "inventoryCode");
        const auto = rawStr(r, "autoDetect").toUpperCase();
        out.push({
          id: `${comp}-${code || name || "m"}-${i}-${out.length}`,
          title: name || code || "Material",
          sub: comp,
          qty: qtyText(rawNum(r, "qty"), rawStr(r, "unit")),
          tone: auto === "FABRIC" ? "fabric" : materialTone(`${code} ${name}`),
        });
      });
      walk(wipList(w.children));
    }
  };
  walk(wipList(t.wipComponents));
  return out;
}

/**
 * Where the detail's BOM / Production come from, decided once:
 *   template  — the ACTIVE template for exactly this code (primary source);
 *   none      — the read succeeded and this code has no ACTIVE template;
 *   forbidden — 403 (a future bom read gate): not shown to this role;
 *   error     — any other failure, incl. a 200 `{success:false}`;
 *   loading   — nothing yet.
 * Only `none` / `forbidden` / `error` may fall back to the SKU's legacy rows,
 * and the screen says so. Never "nothing recorded" while unknown.
 */
export type BomSource =
  | { kind: "loading" }
  | { kind: "template"; template: BomTemplate }
  | { kind: "none" }
  | { kind: "forbidden" }
  | { kind: "error" };

export function bomSource(
  resp: unknown,
  code: string,
  opts: { error: boolean; status: number | null },
): BomSource {
  const ok =
    resp != null &&
    typeof resp === "object" &&
    (resp as { success?: unknown }).success !== false &&
    Array.isArray((resp as { data?: unknown }).data);
  if (ok) {
    // The request filters by productCode, so a row for any other code means a
    // stale response (e.g. the previous SKU's, mid-navigation): never use it,
    // and never read it as "no BOM".
    const rows = (resp as { data: unknown[] }).data;
    if (rows.some((r) => !!r && typeof r === "object" && rawStr(r as Raw, "productCode", "product_code") !== code)) {
      return { kind: "loading" };
    }
    const t = pickActiveTemplate(resp, code);
    return t ? { kind: "template", template: t } : { kind: "none" };
  }
  if (resp != null || opts.error) return opts.status === 403 ? { kind: "forbidden" } : { kind: "error" };
  return { kind: "loading" };
}

/** `BM_FABRIC` → "BM Fabric", `PLYWOOD` → "Plywood" (short codes stay upper-case). */
export function materialLabel(category: string): string {
  const words = (category || "").split(/[_\s]+/).filter(Boolean);
  return words
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** The legacy per-SKU bom_components rows (GET /api/products/:id), as BomRows. */
export function legacyMaterials(raw: unknown): BomRow[] {
  const list = Array.isArray(raw) ? (raw as unknown[]) : [];
  return list
    .filter((b): b is Raw => !!b && typeof b === "object")
    .map((b, i) => {
      const category = rawStr(b, "materialCategory", "material_category");
      const waste = rawNum(b, "wastePct", "waste_pct") ?? 0;
      return {
        id: rawStr(b, "id") || `bom-${i}`,
        title: rawStr(b, "materialName", "material_name") || materialLabel(category) || "Component",
        sub: [materialLabel(category), waste > 0 ? `+${waste}% waste` : ""].filter(Boolean).join(" · "),
        qty: qtyText(rawNum(b, "qtyPerUnit", "qty_per_unit"), rawStr(b, "unit")),
        tone: materialTone(category),
      };
    });
}

// ---- Family photos (/api/files?resourceType=modular) ---------------------------

export type ModularFile = {
  id: string;
  resourceId: string;
  contentType?: string;
  uploadedAt?: string;
  sortOrder?: number | null;
};

/** Cover photo per family key: lowest sortOrder, then newest (catalog.tsx comparePhotos). */
export function coverByFamily(files: unknown): Map<string, string> {
  const list = Array.isArray(files) ? (files as Raw[]) : [];
  const best = new Map<string, ModularFile>();
  for (const r of list) {
    const f: ModularFile = {
      id: rawStr(r, "id"),
      resourceId: rawStr(r, "resourceId", "resource_id"),
      contentType: rawStr(r, "contentType", "content_type"),
      uploadedAt: rawStr(r, "uploadedAt", "uploaded_at"),
      sortOrder: rawNum(r, "sortOrder", "sort_order"),
    };
    if (!f.id || !f.resourceId) continue;
    if (f.contentType && !f.contentType.startsWith("image/")) continue;
    const cur = best.get(f.resourceId);
    if (!cur || comparePhotos(f, cur) < 0) best.set(f.resourceId, f);
  }
  const out = new Map<string, string>();
  for (const [k, f] of best) out.set(k, f.id);
  return out;
}

function comparePhotos(a: ModularFile, b: ModularFile): number {
  const ao = a.sortOrder ?? 1e9;
  const bo = b.sortOrder ?? 1e9;
  if (ao !== bo) return ao - bo;
  return (b.uploadedAt || "").localeCompare(a.uploadedAt || "");
}
