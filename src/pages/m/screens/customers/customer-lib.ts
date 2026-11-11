// ===========================================================================
// Customers v3 — pure helpers shared by CustomersScreen / CustomerDetailScreen.
//
// Rules are the existing ones, unchanged: stage = customerStage (a missing
// value counts as CONFIRMED, as in src/pages/customers.tsx and the API's
// readCustomerStage); credit use = outstandingSen / creditLimitSen with the
// desktop thresholds (> 80% red, > 50% ochre, else green, customers.tsx:3874).
// ===========================================================================
import { num, str } from "../../config/helpers";
import type { ColumnDef, RawRow } from "../../config/types";

export type Stage = "CONFIRMED" | "POTENTIAL" | "ALL";

export const STAGE_TABS: { key: Stage; label: string }[] = [
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "POTENTIAL", label: "Potential" },
  { key: "ALL", label: "All" },
];

export function stageOf(r: RawRow): "CONFIRMED" | "POTENTIAL" {
  return str(r, "customerStage", "customer_stage").toUpperCase() === "POTENTIAL" ? "POTENTIAL" : "CONFIRMED";
}

/** Same test as the old config: only a literal true is Active. */
export const isActive = (r: RawRow) => r.isActive === true;

export function hubsOf(r: RawRow): RawRow[] {
  return Array.isArray(r.deliveryHubs) ? (r.deliveryHubs as RawRow[]) : [];
}

export type Credit = {
  has: boolean;
  /** Percent of the limit used (0 when there is no limit). */
  pct: number;
  availSen: number;
  over: boolean;
  tone: "danger" | "warning" | "success";
};

export function creditOf(r: RawRow): Credit {
  const limit = num(r, "creditLimitSen", "credit_limit_sen");
  const out = num(r, "outstandingSen", "outstanding_sen");
  const has = limit > 0;
  const pct = has ? (out / limit) * 100 : 0;
  const availSen = limit - out;
  return { has, pct, availSen, over: has && availSen <= 0, tone: pct > 80 ? "danger" : pct > 50 ? "warning" : "success" };
}

export const TONE_COLOR: Record<Credit["tone"], string> = {
  danger: "var(--m-inv-danger)",
  warning: "var(--m-inv-warning)",
  success: "var(--m-inv-success)",
};

const TERMS: Record<string, string> = { COD: "COD", NET30: "30 days", NET45: "45 days", NET60: "60 days", NET90: "90 days" };
export const termsLabel = (t: string) => TERMS[t] ?? t;

export function initials(name: string): string {
  return (
    name
      .replace(/\b(Sdn|Bhd|Enterprise|Trading)\b/gi, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/** "RM 1,234.00" → "1,234.00". */
export const stripRM = (s: string) => s.replace(/^RM\s*/, "");

/** Credit-limit KPI: whole ringgit, "—" when nothing is approved. */
export function limitKpi(sen: number): string {
  return sen > 0 ? `RM ${Math.round(sen / 100).toLocaleString("en-MY")}` : "—";
}

// ---- document status tones (Customers v3 SO_SEM / INV_SEM) -----------------
export type DocTone = "neutral" | "info" | "success" | "warning" | "danger";
const SO_TONE: Record<string, DocTone> = {
  DRAFT: "neutral", IN_PRODUCTION: "info", READY_TO_SHIP: "success", SHIPPED: "info", DELIVERED: "success",
  INVOICED: "success", CLOSED: "neutral", ON_HOLD: "warning", CANCELLED: "danger",
};
const INV_TONE: Record<string, DocTone> = {
  DRAFT: "neutral", SENT: "info", PARTIAL_PAID: "warning", PAID: "success", OVERDUE: "danger", CANCELLED: "neutral",
};
export const soTone = (s: string): DocTone => SO_TONE[s.toUpperCase()] ?? "neutral";
export const invTone = (s: string): DocTone => INV_TONE[s.toUpperCase()] ?? "neutral";
export const titleCase = (s: string) =>
  s.split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");

/**
 * Where a customer operates, from verified data only: the distinct `state` of
 * its delivery hubs. /api/customers has no customer-level state (rowToCustomer
 * in src/api/routes/customers.ts), so nothing else is read or invented.
 */
export function hubStates(r: RawRow): string[] {
  const seen = new Set<string>();
  for (const h of hubsOf(r)) {
    const s = str(h, "state").trim();
    if (s) seen.add(s);
  }
  return [...seen];
}
export const stateText = (r: RawRow) => hubStates(r).join(", ");

/**
 * Filter & sort columns — the original customersConfig set (Reference,
 * Customer, State, Outstanding, Status), now backed by real data: State from
 * the hubs, Status from isActive (the old `status` key never existed on a
 * customer row, so that filter matched nothing).
 */
export const CUSTOMER_COLUMNS: ColumnDef[] = [
  { key: "code", label: "Reference", type: "text", value: (r) => str(r, "code", "debtorCode") },
  { key: "name", label: "Customer", type: "text", value: (r) => str(r, "name") },
  { key: "state", label: "State", type: "text", value: stateText },
  { key: "outstanding", label: "Outstanding", type: "number", value: (r) => num(r, "outstandingSen", "outstanding_sen") },
  { key: "status", label: "Status", type: "enum", value: (r) => (isActive(r) ? "ACTIVE" : "INACTIVE"), options: ["ACTIVE", "INACTIVE"] },
];
export const DEFAULT_SORT = { key: "name", dir: "asc" } as const;

// ---- Customer pricing (GET /api/customer-products?customerId=&asOf=) --------
// Display only. The server already resolves override-vs-master and the asOf
// date (customer-products.ts resolvePrices); this just lays the fields out the
// way the desktop Customer Products grid does (customers.tsx:1104-1130):
//   BEDFRAME / other  Price 2 = basePriceSen, Price 1 = price1Sen
//   ACCESSORY         Base Price = basePriceSen
//   SOFA              seatHeightPrices by seat size × tier (P1/P2/P3; a
//                     missing tier counts as P2, custEntryTier)
export type PriceLine = { label: string; sen: number | null };
export type SofaTierBlock = { key: string; label: string; cells: { height: string; sen: number }[] };
export type PriceRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  kind: "SOFA" | "FLAT";
  lines: PriceLine[];
  tiers: SofaTierBlock[];
};

const TIER_LABEL: Record<string, string> = { PRICE_1: "P1", PRICE_2: "P2", PRICE_3: "P3" };
const normHeight = (v: unknown) => String(v ?? "").replace(/"/g, "").trim();
const senOrNull = (r: RawRow, key: string): number | null => {
  const v = r[key];
  return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
};

export function priceRows(rows: RawRow[]): PriceRow[] {
  return rows
    .map((r): PriceRow => {
      const category = str(r, "category", "productCategory").toUpperCase();
      const base = { id: str(r, "id", "productId"), code: str(r, "productCode"), name: str(r, "productName"), category };
      if (category === "SOFA") {
        const byTier = new Map<string, { height: string; sen: number }[]>();
        for (const e of Array.isArray(r.seatHeightPrices) ? (r.seatHeightPrices as RawRow[]) : []) {
          const sen = Number(e.priceSen);
          const height = normHeight(e.height);
          if (!height || !Number.isFinite(sen)) continue;
          const tier = str(e, "tier") || "PRICE_2";
          byTier.set(tier, [...(byTier.get(tier) ?? []), { height, sen }]);
        }
        const tiers = ["PRICE_1", "PRICE_2", "PRICE_3"]
          .filter((k) => byTier.has(k))
          .map((k) => ({
            key: k,
            label: TIER_LABEL[k],
            cells: [...(byTier.get(k) ?? [])].sort((a, b) => {
              const na = Number(a.height), nb = Number(b.height);
              return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.height.localeCompare(b.height);
            }),
          }));
        return { ...base, kind: "SOFA", lines: [], tiers };
      }
      const lines: PriceLine[] =
        category === "ACCESSORY"
          ? [{ label: "Base price", sen: senOrNull(r, "basePriceSen") }]
          : [
              { label: "Price 2", sen: senOrNull(r, "basePriceSen") },
              { label: "Price 1", sen: senOrNull(r, "price1Sen") },
            ];
      return { ...base, kind: "FLAT", lines, tiers: [] };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
}
