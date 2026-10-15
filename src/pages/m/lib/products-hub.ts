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
