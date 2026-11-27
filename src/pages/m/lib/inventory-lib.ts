// ===========================================================================
// Inventory (Final Batch 5, Claude Design "Inventory (standalone)") — the pure
// rules behind the phone/tablet screens in src/pages/m/screens/inventory/.
// No React, no fetch: everything here is unit-tested in
// tests/m-inventory-mobile.test.mjs.
//
// Data sources (all existing endpoints, nothing new on the API):
//   Finished goods  GET /api/products (catalogue) + GET /api/inventory/fg-stock
//                   (counts merged with mergeFgDeltas — never /api/inventory,
//                   whose finishedProducts carry stockQty null)
//   WIP             GET /api/inventory/wip (lazy, on tab open)
//   Raw materials   GET /api/raw-materials, /:id, /:id/used-in,
//                   GET /api/supplier-materials?materialCode=<itemCode>
//   Fabrics         GET /api/fabric-tracking
//   Adjustments     GET /api/stock-adjustments · POST (Reduce stock, RM only)
//   Breakdown       GET /api/stock/breakdown?type=FG|WIP|RM&itemId=
//
// Owner decisions applied here: quantities only (no money anywhere, S-2);
// FG has no per-SKU age on the list (I-2); the draft-DO figure is always
// "On draft DO" (I-1).
// ===========================================================================
import { mergeFgDeltas, type FgDeltas } from "../../../lib/fg-stock";
import type { Product } from "../../../types";

export type Raw = Record<string, unknown>;

// ---- dual-key reads (camelCase ?? snake_case) ----------------------------------
export function str(r: Raw | null | undefined, ...keys: string[]): string {
  if (!r) return "";
  for (const k of keys) {
    const v = r[k];
    if (v != null && v !== "") return String(v);
  }
  return "";
}
export function num(r: Raw | null | undefined, ...keys: string[]): number {
  const v = numOrNull(r, ...keys);
  return v ?? 0;
}
export function numOrNull(r: Raw | null | undefined, ...keys: string[]): number | null {
  if (!r) return null;
  for (const k of keys) {
    const v = r[k];
    if (v != null && v !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
export const rowsOf = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
/** `{ success, data: [...] }` → the array (or [] for anything else). */
export const dataRows = (env: unknown): Raw[] =>
  rowsOf(env && typeof env === "object" ? (env as { data?: unknown }).data : null);

// ---- formatting ------------------------------------------------------------------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Quantity: whole numbers plain, fractions to 2 dp (fabric metres). */
export function q2(v: number): string {
  const dp = Number.isInteger(v) ? 0 : 2;
  return Number(v).toLocaleString("en-MY", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
/** Signed quantity with a real minus sign: +4, −2.5, 0. */
export function signed(v: number): string {
  return (v > 0 ? "+" : v < 0 ? "−" : "") + q2(Math.abs(v));
}
/** Quantity keeping a minus for negatives but no plus (WIP totals). */
export function plainQty(v: number): string {
  return (v < 0 ? "−" : "") + q2(Math.abs(v));
}
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Malaysia calendar day of a stored date or timestamp ("YYYY-MM-DD"). */
export function ymdMY(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
/** "26 Nov 2026"; "—" when there is no date. */
export function dateLabel(v: string | null | undefined): string {
  const k = ymdMY(v);
  if (!k) return "—";
  return `${+k.slice(8, 10)} ${MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
}
/** "Today" / "1 day" / "N days"; "—" when unknown. */
export function ageLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n <= 0) return "Today";
  return n === 1 ? "1 day" : `${n} days`;
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// ---- tones ------------------------------------------------------------------------
export type Tone = "ok" | "warn" | "bad" | "neu" | "info" | "br";

/** STOCK_THRESHOLD {OUT: 0, LOW: 5} — the desktop rule. */
export const LOW_STOCK = 5;
/** WIP_AGE_THRESHOLD {WARN: 7, CRITICAL: 14}. */
export const AGE_WARN = 7;
export const AGE_CRITICAL = 14;

export function ageTone(n: number | null | undefined): Tone {
  if (n == null) return "neu";
  return n > AGE_CRITICAL ? "bad" : n > AGE_WARN ? "warn" : "neu";
}

// ---- Finished goods -----------------------------------------------------------------
export type FgRow = {
  id: string;
  code: string;
  name: string;
  /** BEDFRAME / SOFA / ACCESSORY (upper, as stored). */
  category: string;
  sizeLabel: string;
  baseModel: string;
  status: string;
  /** Available: free stock (not on a draft DO). */
  stockQty: number;
  /** On draft DO: pieces named on a DRAFT delivery / active consignment note. NEVER "reserved". */
  reservedQty: number;
  /** An off-catalogue row synthesised from production orders (no breakdown). */
  dyn: boolean;
};

/** fg-stock payload → FgDeltas (tolerant of a missing / partial body). */
export function toDeltas(env: unknown): FgDeltas {
  const d = env && typeof env === "object" ? (env as { data?: unknown }).data : null;
  const o = (d && typeof d === "object" ? d : {}) as { counts?: unknown; dyn?: unknown };
  return {
    counts: rowsOf(o.counts).map((c) => ({ id: str(c, "id"), stockQty: num(c, "stockQty", "stock_qty"), reservedQty: num(c, "reservedQty", "reserved_qty") })),
    dyn: rowsOf(o.dyn).map((c) => ({
      id: str(c, "id"),
      code: str(c, "code"),
      name: str(c, "name"),
      category: str(c, "category") as Product["category"],
      sizeCode: str(c, "sizeCode", "size_code") || undefined,
      sizeLabel: str(c, "sizeLabel", "size_label") || undefined,
      stockQty: num(c, "stockQty", "stock_qty"),
      reservedQty: num(c, "reservedQty", "reserved_qty"),
    })),
  };
}

/**
 * The FG list: the product catalogue with fg-stock counts merged on by id
 * (mergeFgDeltas, the desktop's own merge). A product absent from `counts`
 * reads 0 / 0; off-catalogue `fg-dyn-*` rows are appended.
 */
export function mergeFg(products: Raw[], deltas: FgDeltas): FgRow[] {
  return mergeFgDeltas(products as unknown as Product[], deltas).map((p) => {
    const r = p as unknown as Raw;
    const id = str(r, "id");
    return {
      id,
      code: str(r, "code") || "—",
      name: str(r, "name") || str(r, "code") || "—",
      category: str(r, "category").toUpperCase(),
      sizeLabel: str(r, "sizeLabel", "size_label"),
      baseModel: str(r, "baseModel", "base_model"),
      status: str(r, "status") || "ACTIVE",
      stockQty: num(r, "stockQty"),
      reservedQty: num(r, "reservedQty"),
      dyn: id.startsWith("fg-dyn-"),
    };
  });
}

export const fgOnHand = (f: Pick<FgRow, "stockQty" | "reservedQty">) => f.stockQty + f.reservedQty;

export function fgTone(f: Pick<FgRow, "stockQty" | "reservedQty">): [string, Tone] {
  if (fgOnHand(f) <= 0) return ["Out of stock", "bad"];
  if (f.stockQty <= 0) return ["All on draft DO", "warn"];
  if (f.stockQty < LOW_STOCK) return ["Low stock", "warn"];
  return ["In stock", "ok"];
}
export const fgActive = (f: Pick<FgRow, "status">) => f.status.toUpperCase() === "ACTIVE";
/** BEDFRAME → size label; SOFA → base model; otherwise whichever exists. */
export function fgSizeOf(f: Pick<FgRow, "category" | "sizeLabel" | "baseModel">): string {
  if (f.category === "BEDFRAME") return f.sizeLabel || f.baseModel;
  if (f.category === "SOFA") return f.baseModel || f.sizeLabel;
  return f.sizeLabel || f.baseModel;
}
export function fgSub(f: FgRow): string {
  return [f.category ? titleCase(f.category) : "", fgSizeOf(f)].filter(Boolean).join(" · ");
}

// ---- WIP ---------------------------------------------------------------------------------
export type WipSource = { poCode: string; jobCardId: string; quantity: number; completedDate: string; ageDays: number | null };
export type WipRow = {
  id: string;
  wipCode: string;
  wipType: string;
  category: string;
  completedBy: string;
  relatedProduct: string;
  totalQty: number;
  oldestAgeDays: number | null;
  sources: WipSource[];
};

export function toWip(r: Raw): WipRow {
  return {
    id: str(r, "id") || str(r, "wipCode", "wip_code"),
    wipCode: str(r, "wipCode", "wip_code"),
    wipType: str(r, "wipType", "wip_type"),
    category: str(r, "category").toUpperCase(),
    completedBy: str(r, "completedBy", "completed_by"),
    relatedProduct: str(r, "relatedProduct", "related_product"),
    totalQty: num(r, "totalQty", "total_qty"),
    oldestAgeDays: numOrNull(r, "oldestAgeDays", "oldest_age_days"),
    sources: rowsOf(r.sources).map((s) => ({
      poCode: str(s, "poCode", "po_code"),
      jobCardId: str(s, "jobCardId", "job_card_id"),
      quantity: num(s, "quantity"),
      completedDate: str(s, "completedDate", "completed_date"),
      ageDays: numOrNull(s, "ageDays", "age_days"),
    })),
  };
}
/** Desktop drops SET rows defensively (the API no longer emits them). */
export const wipList = (env: unknown): WipRow[] => dataRows(env).map(toWip).filter((w) => w.wipType !== "SET");

export const DEPT_LABEL: Record<string, string> = {
  FAB_CUT: "Fabric Cutting",
  FAB_SEW: "Fabric Sewing",
  WOOD_CUT: "Wood Cutting",
  FOAM: "Foam Bonding",
  FRAMING: "Framing",
  WEBBING: "Webbing",
  UPHOLSTERY: "Upholstery",
  PACKING: "Packing",
};
export const deptLabel = (code: string) => DEPT_LABEL[code] ?? (code ? titleCase(code) : "—");
/** Desktop rule: a SOFA WIP shows only the model before the first "-". */
export function wipTitle(w: Pick<WipRow, "category" | "relatedProduct" | "wipType">): string {
  const p = w.relatedProduct;
  if (w.category === "SOFA" && p.includes("-")) return p.split("-")[0].trim() || p;
  return p || w.wipType || "—";
}
/** Age only for a non-negative row with a known age (desktop shows "—" otherwise). */
export const wipAge = (w: Pick<WipRow, "totalQty" | "oldestAgeDays">) => (w.totalQty < 0 ? null : w.oldestAgeDays);
export function wipSub(w: WipRow): string {
  return [w.category ? titleCase(w.category) : "", deptLabel(w.completedBy), w.wipType].filter(Boolean).join(" · ");
}
export const WIP_NEGATIVE_HINT =
  "A downstream department completed work before the upstream one. It evens out once the earlier step is scanned.";

// ---- Raw materials ------------------------------------------------------------------------
export type RmRow = {
  id: string;
  itemCode: string;
  description: string;
  itemGroup: string;
  baseUOM: string;
  balanceQty: number;
  minStock: number;
};
export function toRm(r: Raw): RmRow {
  return {
    id: str(r, "id"),
    itemCode: str(r, "itemCode", "item_code") || "—",
    description: str(r, "description"),
    itemGroup: str(r, "itemGroup", "item_group"),
    baseUOM: str(r, "baseUOM", "base_uom", "baseUom"),
    balanceQty: num(r, "balanceQty", "balance_qty"),
    minStock: num(r, "minStock", "min_stock"),
  };
}
export function rmTone(r: Pick<RmRow, "balanceQty">): [string, Tone] {
  if (r.balanceQty < 0) return ["Negative stock", "bad"];
  if (r.balanceQty === 0) return ["Zero stock", "bad"];
  if (r.balanceQty < LOW_STOCK) return ["Low stock", "warn"];
  return ["In stock", "ok"];
}
export const withUom = (v: number, uom: string) => `${q2(v)}${uom ? ` ${uom}` : ""}`;
/** The API sends minStock ?? 0, so "Not set" ⇔ minStock ≤ 0. */
export const minStockLabel = (r: Pick<RmRow, "minStock" | "baseUOM">) => (r.minStock > 0 ? withUom(r.minStock, r.baseUOM) : "Not set");

/** RM movement type → the prototype's label. */
export function rmMoveLabel(m: { direction: string; type: string }): string {
  if (/ADJUST/i.test(m.type)) return "Adjustment";
  return m.direction === "IN" ? "Received" : "Issued to production";
}

// ---- Fabrics -----------------------------------------------------------------------------------
export type FabricRow = {
  id: string;
  fabricCode: string;
  fabricDescription: string;
  fabricCategory: string;
  priceTier: string;
  sofaPriceTier: string;
  bedframePriceTier: string;
  soh: number;
  poOutstanding: number;
  shortage: number;
  lastMonthUsage: number;
  oneWeekUsage: number;
  twoWeeksUsage: number;
  oneMonthUsage: number;
  reorderPoint: number;
  supplier: string;
  leadTimeDays: number;
};
export function toFabric(r: Raw): FabricRow {
  return {
    id: str(r, "id") || str(r, "fabricCode", "fabric_code"),
    fabricCode: str(r, "fabricCode", "fabric_code") || "—",
    fabricDescription: str(r, "fabricDescription", "fabric_description"),
    fabricCategory: str(r, "fabricCategory", "fabric_category"),
    priceTier: str(r, "priceTier", "price_tier"),
    sofaPriceTier: str(r, "sofaPriceTier", "sofa_price_tier"),
    bedframePriceTier: str(r, "bedframePriceTier", "bedframe_price_tier"),
    soh: num(r, "soh"),
    poOutstanding: num(r, "poOutstanding", "po_outstanding"),
    shortage: num(r, "shortage"),
    lastMonthUsage: num(r, "lastMonthUsage", "last_month_usage"),
    oneWeekUsage: num(r, "oneWeekUsage", "one_week_usage"),
    twoWeeksUsage: num(r, "twoWeeksUsage", "two_weeks_usage"),
    oneMonthUsage: num(r, "oneMonthUsage", "one_month_usage"),
    reorderPoint: num(r, "reorderPoint", "reorder_point"),
    supplier: str(r, "supplier"),
    leadTimeDays: num(r, "leadTimeDays", "lead_time_days"),
  };
}
/** fabrics.tsx: `(f.sofaPriceTier ?? f.priceTier ?? "PRICE_2").replace("PRICE_", "")`. */
export function tierLabel(own: string, fallback: string): string {
  return (own || fallback || "PRICE_2").replace("PRICE_", "");
}
export const fabricTone = (f: Pick<FabricRow, "shortage">): [string, Tone] =>
  f.shortage < 0 ? ["Under-provisioned", "bad"] : ["Covered", "ok"];

// ---- Adjustments ---------------------------------------------------------------------------------
export type AdjRow = {
  id: string;
  adjNo: string;
  type: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyDelta: number;
  direction: string;
  reason: string;
  notes: string;
  adjustedByName: string;
  adjustedAt: string;
  caseId: string;
};
export function toAdj(r: Raw): AdjRow {
  return {
    id: str(r, "id"),
    adjNo: str(r, "adjNo", "adj_no"),
    type: str(r, "type"),
    itemId: str(r, "itemId", "item_id"),
    itemCode: str(r, "itemCode", "item_code"),
    itemName: str(r, "itemName", "item_name"),
    qtyDelta: num(r, "qtyDelta", "qty_delta"),
    direction: str(r, "direction"),
    reason: str(r, "reason"),
    notes: str(r, "notes"),
    adjustedByName: str(r, "adjustedByName", "adjusted_by_name"),
    adjustedAt: str(r, "adjustedAt", "adjusted_at"),
    caseId: str(r, "caseId", "case_id", "caseid"),
  };
}
/** Desktop adjustments.tsx REASON_OPTIONS labels. */
export const REASON_LABEL: Record<string, string> = {
  FOUND: "Found",
  DAMAGED: "Damaged",
  COUNT_CORRECTION: "Count Corr.",
  WRITE_OFF: "Write-Off",
  SERVICE_REPLACEMENT: "Service top-up",
  OTHER: "Other",
};
export const reasonLabel = (r: string) => REASON_LABEL[r] ?? (r ? titleCase(r) : "—");
export const ADJ_TYPE_LABEL: Record<string, string> = { RM: "Raw material", WIP: "Work in progress", FG: "Finished goods" };

// ---- KPIs ---------------------------------------------------------------------------------------
export function fgKpis(L: FgRow[]) {
  return {
    total: L.length,
    available: L.reduce((a, x) => a + x.stockQty, 0),
    draft: L.reduce((a, x) => a + x.reservedQty, 0),
    bedframe: L.filter((x) => x.category === "BEDFRAME").length,
    sofa: L.filter((x) => x.category === "SOFA").length,
  };
}
export function wipKpis(L: WipRow[]) {
  const ages = L.map((w) => w.oldestAgeDays).filter((v): v is number => typeof v === "number");
  return {
    total: L.length,
    qty: L.reduce((a, x) => a + x.totalQty, 0),
    oldest: ages.length ? Math.max(...ages) : 0,
    over7: ages.filter((d) => d > AGE_WARN).length,
  };
}
export function rmKpis(L: RmRow[]) {
  return {
    total: L.length,
    groups: new Set(L.map((x) => x.itemGroup).filter(Boolean)).size,
    low: L.filter((x) => x.balanceQty > 0 && x.balanceQty < LOW_STOCK).length,
    zero: L.filter((x) => x.balanceQty === 0).length,
  };
}
export function fabricKpis(L: FabricRow[]) {
  return { total: L.length, soh: round2(L.reduce((a, x) => a + x.soh, 0)) };
}

// ---- tabs, search, chips, sorts -----------------------------------------------------------------
export type TabKey = "fg" | "wip" | "rm" | "fab" | "adj";
export const TABS: { k: TabKey; l: string }[] = [
  { k: "fg", l: "Finished Goods" },
  { k: "wip", l: "WIP" },
  { k: "rm", l: "Raw Materials" },
  { k: "fab", l: "Fabrics" },
  { k: "adj", l: "Adjustments" },
];

export const SORTS: Record<TabKey, { k: string; l: string }[]> = {
  // I-2: no FG newest/oldest-stock sorts (the list carries no per-SKU age).
  fg: [
    { k: "code", l: "Code A–Z" },
    { k: "codeD", l: "Code Z–A" },
    { k: "name", l: "Name A–Z" },
    { k: "nameD", l: "Name Z–A" },
    { k: "availA", l: "Lowest available first" },
  ],
  wip: [
    { k: "oldest", l: "Oldest first" },
    { k: "newest", l: "Newest first" },
    { k: "qtyA", l: "Lowest qty first" },
    { k: "code", l: "Code A–Z" },
    { k: "name", l: "Product A–Z" },
  ],
  // I-2: no RM receipt-date sorts (the list carries no receipt date).
  rm: [
    { k: "code", l: "Code A–Z" },
    { k: "codeD", l: "Code Z–A" },
    { k: "name", l: "Description A–Z" },
    { k: "qtyA", l: "Lowest stock first" },
  ],
  fab: [
    { k: "short", l: "Biggest shortage first" },
    { k: "code", l: "Code A–Z" },
    { k: "name", l: "Description A–Z" },
  ],
  adj: [
    { k: "new", l: "Newest first" },
    { k: "old", l: "Oldest first" },
  ],
};
export const DEFAULT_SORT: Record<TabKey, string> = { fg: "code", wip: "oldest", rm: "code", fab: "short", adj: "new" };

const cmp = (a: string | number, b: string | number) => (a > b ? 1 : a < b ? -1 : 0);
const text = (s: string) => s.toLowerCase();

export function sortFg(L: FgRow[], k: string): FgRow[] {
  const c = [...L];
  if (k === "codeD") return c.sort((a, b) => cmp(b.code, a.code));
  if (k === "name") return c.sort((a, b) => cmp(text(a.name), text(b.name)) || cmp(a.code, b.code));
  if (k === "nameD") return c.sort((a, b) => cmp(text(b.name), text(a.name)) || cmp(a.code, b.code));
  if (k === "availA") return c.sort((a, b) => a.stockQty - b.stockQty || cmp(a.code, b.code));
  return c.sort((a, b) => cmp(a.code, b.code));
}
export function sortWip(L: WipRow[], k: string): WipRow[] {
  const c = [...L];
  const age = (w: WipRow) => wipAge(w);
  if (k === "newest") return c.sort((a, b) => (age(a) ?? Infinity) - (age(b) ?? Infinity) || cmp(a.wipCode, b.wipCode));
  if (k === "qtyA") return c.sort((a, b) => a.totalQty - b.totalQty || cmp(a.wipCode, b.wipCode));
  if (k === "code") return c.sort((a, b) => cmp(a.wipCode, b.wipCode));
  if (k === "name") return c.sort((a, b) => cmp(text(wipTitle(a)), text(wipTitle(b))) || cmp(a.wipCode, b.wipCode));
  return c.sort((a, b) => (age(b) ?? -Infinity) - (age(a) ?? -Infinity) || cmp(a.wipCode, b.wipCode));
}
export function sortRm(L: RmRow[], k: string): RmRow[] {
  const c = [...L];
  if (k === "codeD") return c.sort((a, b) => cmp(b.itemCode, a.itemCode));
  if (k === "name") return c.sort((a, b) => cmp(text(a.description), text(b.description)) || cmp(a.itemCode, b.itemCode));
  if (k === "qtyA") return c.sort((a, b) => a.balanceQty - b.balanceQty || cmp(a.itemCode, b.itemCode));
  return c.sort((a, b) => cmp(a.itemCode, b.itemCode));
}
export function sortFabric(L: FabricRow[], k: string): FabricRow[] {
  const c = [...L];
  if (k === "code") return c.sort((a, b) => cmp(a.fabricCode, b.fabricCode));
  if (k === "name") return c.sort((a, b) => cmp(text(a.fabricDescription), text(b.fabricDescription)) || cmp(a.fabricCode, b.fabricCode));
  return c.sort((a, b) => a.shortage - b.shortage || cmp(a.fabricCode, b.fabricCode));
}
export function sortAdj(L: AdjRow[], k: string): AdjRow[] {
  const key = (a: AdjRow) => `${a.adjustedAt}|${a.adjNo}|${a.id}`;
  return [...L].sort((a, b) => (k === "old" ? cmp(key(a), key(b)) : cmp(key(b), key(a))));
}

export const searchFg = (f: FgRow) => `${f.code} ${f.name} ${f.sizeLabel} ${f.baseModel}`;
export const searchWip = (w: WipRow) => `${w.wipCode} ${w.relatedProduct} ${w.wipType} ${w.sources.map((s) => s.poCode).join(" ")}`;
export const searchRm = (r: RmRow) => `${r.itemCode} ${r.description}`;
export const searchFabric = (f: FabricRow) => `${f.fabricCode} ${f.fabricDescription}`;
export const searchAdj = (a: AdjRow) => `${a.adjNo} ${a.itemCode} ${a.itemName} ${reasonLabel(a.reason)} ${a.adjustedByName}`;
export const matches = (hay: string, q: string) => !q.trim() || hay.toLowerCase().includes(q.trim().toLowerCase());

/** FG / WIP chips are the three product categories (WIP includes ACCESSORY); RM / Fabrics come from the data. */
export const PRODUCT_CATEGORIES = ["BEDFRAME", "SOFA", "ACCESSORY"];
export const ADJ_TYPES = ["RM", "WIP", "FG"];
export function chipsFromData(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// ---- detail ids (one route segment: /m/inventory/:id) --------------------------------------------
export type DetailRef = { kind: "fg" | "wip" | "rm"; id: string };
/** FG → `fg.<productId>`, WIP → `wip.<wip id>`, RM keeps its own id so existing links still open. */
export function detailId(ref: DetailRef): string {
  return ref.kind === "rm" ? ref.id : `${ref.kind}.${ref.id}`;
}
export const detailPath = (ref: DetailRef) => `/m/inventory/${encodeURIComponent(detailId(ref))}`;
export function parseDetailId(raw: string): DetailRef {
  if (raw.startsWith("fg.")) return { kind: "fg", id: raw.slice(3) };
  if (raw.startsWith("wip.")) return { kind: "wip", id: raw.slice(4) };
  return { kind: "rm", id: raw };
}
export const TAB_OF_KIND: Record<DetailRef["kind"], TabKey> = { fg: "fg", wip: "wip", rm: "rm" };

// ---- urls ---------------------------------------------------------------------------------------
const enc = encodeURIComponent;
export const URLS = {
  products: "/api/products",
  fgStock: "/api/inventory/fg-stock",
  wip: "/api/inventory/wip",
  rm: "/api/raw-materials",
  rmOne: (id: string) => `/api/raw-materials/${enc(id)}`,
  usedIn: (id: string) => `/api/raw-materials/${enc(id)}/used-in`,
  /** Bindings are keyed by materialCode = the RM ITEM CODE (not the RM id). */
  suppliers: (itemCode: string) => `/api/supplier-materials?materialCode=${enc(itemCode)}`,
  fabrics: "/api/fabric-tracking",
  adjustments: "/api/stock-adjustments",
  breakdown: (type: "FG" | "WIP" | "RM", itemId: string) => `/api/stock/breakdown?type=${type}&itemId=${enc(itemId)}`,
};

/** The breakdown's own 404 copy (stock-breakdown.ts), shown verbatim. */
export const BREAKDOWN_404 =
  "No catalogue item matches this row, so there is no stock ledger to read. Rows derived from production orders have no item record of their own.";

// ---- Reduce stock --------------------------------------------------------------------------------
export type ReduceReason = "COUNT_CORRECTION" | "DAMAGED" | "WRITE_OFF";
export const REDUCE_REASONS: { k: ReduceReason; l: string }[] = [
  { k: "COUNT_CORRECTION", l: "Count correction (reduce)" },
  { k: "DAMAGED", l: "Damaged" },
  { k: "WRITE_OFF", l: "Write-off" },
];

/** Client-side check before Review. The server still refuses below zero (409). */
export function validateReduceQty(raw: string, balance: number, uom: string): string {
  const v = raw.trim().replace(/,/g, "");
  if (!v) return "Enter a quantity above 0.";
  const n = Number(v);
  if (!Number.isFinite(n)) return "Enter a number.";
  if (n < 0) return "Quantity can't be negative.";
  if (n === 0) return "Enter a quantity above 0.";
  if (!/^\d*\.?\d{0,4}$/.test(v)) return "Use at most 4 decimal places.";
  if (n > balance) return `You can remove up to ${withUom(balance, uom)}.`;
  return "";
}
export const parseQty = (raw: string) => Number(raw.trim().replace(/,/g, ""));

export type ReduceUser = { id?: string | null; displayName?: string | null; email?: string | null } | null;
/**
 * POST /api/stock-adjustments body — the same contract desktop sends
 * (adjustments.tsx): signed negative delta, enum reason, unitCostSen 0 (an
 * OUT is FIFO-costed by the server), and the adjuster the way desktop sends it.
 */
export function reduceBody(p: { itemId: string; qty: number; reason: ReduceReason; notes: string; user: ReduceUser }) {
  return {
    type: "RM" as const,
    itemId: p.itemId,
    qtyDelta: -Math.abs(p.qty),
    unitCostSen: 0,
    reason: p.reason,
    notes: p.notes.trim() || null,
    adjustedBy: p.user?.id ?? null,
    adjustedByName: p.user?.displayName || p.user?.email || null,
  };
}

/**
 * One Idempotency-Key per INTENT. The same body (a retry of the same intent)
 * reuses the key; any change to the body is a new intent and gets a new key
 * (the server answers 422 to a reused key with a different body).
 */
export type IntentKey = { sig: string; key: string } | null;
export function keyForIntent(prev: IntentKey, body: unknown, mint: () => string): { sig: string; key: string } {
  const sig = JSON.stringify(body);
  if (prev && prev.sig === sig) return prev;
  return { sig, key: mint() };
}

export type SubmitOutcome =
  | { kind: "ok"; adjNo: string }
  | { kind: "rejected"; status: number; error: string }
  | { kind: "uncertain"; status: number; error: string };

/**
 * What a POST answer means for the user:
 *   ok         2xx with a body that is not `{success:false}`
 *   rejected   a definite 4xx answer (nothing was written) — the server's text, verbatim
 *   uncertain  no answer / timeout / any 5xx / the idempotency "still in flight" 409 /
 *              a 2xx we could not read: the stock MAY have changed, so the screen
 *              must re-read the balance before another submission.
 */
export function classifyOutcome(status: number, body: unknown): SubmitOutcome {
  const b = (body && typeof body === "object" ? body : null) as { success?: boolean; error?: string; inFlight?: boolean; data?: Raw } | null;
  if (status >= 200 && status < 300) {
    if (!b) return { kind: "uncertain", status, error: "The server's answer could not be read." };
    if (b.success === false) return { kind: "rejected", status, error: b.error || "The server refused this adjustment." };
    return { kind: "ok", adjNo: str(b.data ?? null, "adjNo", "adj_no") };
  }
  if (status === 0) return { kind: "uncertain", status, error: "No answer from the server." };
  if (status >= 500) return { kind: "uncertain", status, error: b?.error || `The server failed (HTTP ${status}).` };
  if (status === 409 && b?.inFlight) return { kind: "uncertain", status, error: b.error || "The first attempt is still being processed." };
  if (status === 403) return { kind: "rejected", status, error: b?.error && b.error !== "Forbidden" ? b.error : "You don't have permission to adjust inventory." };
  return { kind: "rejected", status, error: b?.error || `Request failed (HTTP ${status}).` };
}
