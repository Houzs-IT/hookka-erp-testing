// ---------------------------------------------------------------------------
// new-models-export.ts — the "New models" export behind the Products Catalog
// button (owner 2026-11-10: the board report's New models page should come
// from the Catalog by date in one download, photos and prices included).
//
// Pure: the route loads products, their active prices, sofa combos and the
// Catalog cover photos, and this module shapes them. One entry per FAMILY
// (familyOf: 1003 / 1003(A) / 1003-(K) are one model, sofa pieces 1A / 2A / L
// are one model) — sizes are folded in, never listed as separate cards.
//
// "New" = the product's own created_at (owner's choice, 2026-11-10). Products
// created before that column existed have no date and are never "new"; the
// route reports how many active products carry no date so the page can say so.
//
// Prices are master prices in sen, shown in RM without the "RM" (the page adds
// it): bedframes by size (Q = 5FT, K = 6FT, SK = Super King), sofas by combo
// (Sofa Combo pricing) and otherwise by seat / length.
// ---------------------------------------------------------------------------
import { familyOf } from "./product-family";

export interface NmSeatPrice {
  height: string;
  priceSen: number;
  tier?: string;
}

export interface NmProduct {
  code: string;
  name: string;
  category: string;
  sizeLabel: string | null;
  sizeCode: string | null;
  createdAt: string | null;
  basePriceSen: number | null;
  seatHeightPrices: NmSeatPrice[];
}

export interface NmCombo {
  baseModel: string;
  componentSizes: string[][];
  pricesByHeight: Record<string, number>;
  fabricTier: string | null;
  customerName: string | null;
}

export interface NewModel {
  code: string;
  category: string;
  name: string;
  added: string;
  skus: number;
  sizes: string;
  price: string;
  price2: string;
  hasPhoto: boolean;
  photo: string | null;
}

const rm = (sen: number): string => {
  const v = sen / 100;
  return (Number.isInteger(v) ? v : Math.round(v)).toLocaleString("en-MY");
};

export const NO_PRICE = "No price set yet";

// Charge lines live in Products (as ACCESSORY) but are not models to show.
const NOT_A_MODEL = /^(SERVICE|DELIVERY|TRANSPORT|INSTALL\w*)\b|\bCHARGES?\b/i;

const SIZE_TOKEN = /^(\d+(\.\d+)?FT|\d[A-Z]{0,2}|CNR|CSL|L|NA|S|SK|K|Q|SS|SP)$/;

/** A readable model name from the first SKU's name: drops sizes, dimensions,
 *  the word BEDFRAME / SOFA and the family code. "HIPSTER BEDFRAME (6FT)
 *  (183X190CM)" → "HIPSTER"; "SOFA 5560 1A(LHF)" → "Sofa 5560"; a name that is
 *  only a size → "Model 2135". */
export function modelNameOf(name: string, family: string, category: string): string {
  const words = (name || "")
    .toUpperCase()
    .replace(/\([^)]*\)?/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w !== "BEDFRAME" && w !== "SOFA" && w !== family && !SIZE_TOKEN.test(w));
  if (words.length) return words.join(" ");
  return category.toUpperCase() === "SOFA" ? `Sofa ${family}` : `Model ${family}`;
}

const sizeOf = (p: NmProduct): string => (p.sizeLabel || p.sizeCode || "").trim();
const stripHand = (s: string): string => s.replace(/\((LHF|RHF)\)/gi, "").trim();
const tierPick = (prices: NmSeatPrice[]): NmSeatPrice[] => {
  const p2 = prices.filter((x) => (x.tier || "PRICE_2") === "PRICE_2");
  return p2.length ? p2 : prices;
};

const BED_MAIN: [string, string][] = [["5FT", "Q"], ["6FT", "K"], ["SUPERKING", "SK"]];
const BED_OTHER: [string, string][] = [["3FT", "3FT"], ["3.5FT", "3.5FT"], ["SPECIALSIZE", "Special"]];

function bedPrices(ps: NmProduct[]): [string, string] {
  const by = new Map<string, number>();
  for (const p of ps) {
    if (p.basePriceSen == null) continue;
    const k = sizeOf(p).toUpperCase().replace(/\s+/g, "");
    if (!by.has(k) || p.basePriceSen < (by.get(k) as number)) by.set(k, p.basePriceSen);
  }
  const line = (pairs: [string, string][]) =>
    pairs.filter(([k]) => by.has(k)).map(([k, lab]) => `${lab} ${rm(by.get(k) as number)}`).join(" · ");
  return [line(BED_MAIN), line(BED_OTHER)];
}

function comboLines(family: string, combos: NmCombo[]): string[] {
  // One line per combo (same pieces). Customers priced differently for the
  // same pieces become a range per seat height, not two look-alike lines.
  const byLabel = new Map<string, Map<number, [number, number]>>();
  for (const c of combos) {
    if (familyOf(c.baseModel) !== family) continue;
    const parts: string[] = [];
    for (const g of c.componentSizes || []) for (const s of g) {
      const t = stripHand(s);
      if (t && !parts.includes(t)) parts.push(t);
    }
    if (!parts.length) continue;
    const prices = Object.entries(c.pricesByHeight || {})
      .map(([h, v]) => [Number(h), Number(v)] as [number, number])
      .filter(([h, v]) => Number.isFinite(h) && Number.isFinite(v) && v > 0)
      .sort((a, b) => a[0] - b[0]);
    if (!prices.length) continue;
    const label = parts.join(" + ");
    const heights = byLabel.get(label) ?? new Map<number, [number, number]>();
    for (const [h, v] of prices) {
      const cur = heights.get(h);
      heights.set(h, cur ? [Math.min(cur[0], v), Math.max(cur[1], v)] : [v, v]);
    }
    byLabel.set(label, heights);
  }
  const money = ([lo, hi]: [number, number]) => (lo === hi ? rm(lo) : `${rm(lo)}–${rm(hi)}`);
  return [...byLabel.entries()]
    .map(([label, heights]) => {
      const hs = [...heights.entries()].sort((a, b) => a[0] - b[0]);
      return { label, first: hs[0][1][0], hs };
    })
    .sort((a, b) => a.first - b.first)
    .map(({ label, hs }) => {
      const ends = hs.length > 1 ? [hs[0], hs[hs.length - 1]] : [hs[0]];
      return `Combo ${label}: ` + ends.map(([h, r]) => `${money(r)} (${h}″)`).join(" · ");
    });
}

function seatLine(ps: NmProduct[]): string {
  // Lowest seat-height price per size; a DEFAULT-height row is priced by length.
  const by = new Map<string, number>();
  for (const p of ps) {
    for (const sp of tierPick(p.seatHeightPrices || [])) {
      if (!(sp.priceSen > 0)) continue;
      const k = stripHand(sizeOf(p)).toUpperCase();
      if (!k) continue;
      if (!by.has(k) || sp.priceSen < (by.get(k) as number)) by.set(k, sp.priceSen);
    }
  }
  if (!by.size) return "";
  const seats = ["1NA", "1A", "1S"].filter((k) => by.has(k));
  if (seats.length) return "Seats from " + seats.slice(0, 2).map((k) => `${rm(by.get(k) as number)} (${k})`).join(" · ");
  const lengths = [...by.keys()].filter((k) => /^\d+(\.\d+)?FT$/.test(k)).sort((a, b) => parseFloat(a) - parseFloat(b));
  if (lengths.length) return lengths.slice(0, 4).map((k) => `${k} ${rm(by.get(k) as number)}`).join(" · ");
  const [k, v] = [...by.entries()].sort((a, b) => a[1] - b[1])[0];
  return `From ${rm(v)} (${k})`;
}

function sizesLine(ps: NmProduct[]): string {
  const out: string[] = [];
  for (const p of ps) {
    let s = stripHand(sizeOf(p));
    if (/^superking$/i.test(s)) s = "Super King";
    if (/^specialsize$/i.test(s)) s = "Special";
    if (s && !out.includes(s)) out.push(s);
  }
  const num = (s: string) => (/^\d/.test(s) ? parseFloat(s) : 1e6);
  out.sort((a, b) => num(a) - num(b) || a.localeCompare(b));
  return out.length > 8 ? out.slice(0, 8).join(" · ") + " · …" : out.join(" · ");
}

/** Shape the models created between `from` and `to` (inclusive, YYYY-MM-DD),
 *  newest first. `photos` maps a family key to its cover photo (a data URL) —
 *  a family missing from the map has no Catalog photo. */
export function buildNewModels(
  products: NmProduct[],
  combos: NmCombo[],
  photos: Map<string, string | null>,
  range: { from: string; to: string },
  opts: { pricesIncluded?: boolean } = {},
): NewModel[] {
  const pricesIncluded = opts.pricesIncluded !== false;
  const families = new Map<string, NmProduct[]>();
  for (const p of products) {
    const k = familyOf(p.code);
    if (!k || NOT_A_MODEL.test(p.code.trim()) || NOT_A_MODEL.test((p.name || "").trim())) continue;
    const arr = families.get(k);
    if (arr) arr.push(p); else families.set(k, [p]);
  }
  const out: NewModel[] = [];
  for (const [family, ps] of families) {
    const dates = ps.map((p) => (p.createdAt || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const added = dates[0];
    // A family is new when its FIRST dated SKU falls in the range — a new size
    // added to an old model does not make the model new.
    if (!added || added < range.from || added > range.to) continue;
    const category = (ps[0].category || "OTHER").toUpperCase();
    let price = "", price2 = "";
    if (category === "BEDFRAME") {
      [price, price2] = bedPrices(ps);
    } else if (category === "SOFA") {
      const combosFor = comboLines(family, combos);
      const seats = seatLine(ps);
      if (combosFor.length) {
        price = combosFor[0];
        price2 = combosFor[1] || seats;
      } else {
        price = seats;
        price2 = seats ? "No combo price set yet" : "";
      }
    } else {
      const base = ps.map((p) => p.basePriceSen).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
      price = base.length ? (base.length > 1 && base[0] !== base[base.length - 1] ? `${rm(base[0])} – ${rm(base[base.length - 1])}` : rm(base[0])) : "";
    }
    // "No price" only when prices were looked at — a login without
    // product-pricing gets blank lines, not a claim that nothing is priced.
    if (pricesIncluded && !price && !price2) price = NO_PRICE;
    const photo = photos.get(family) ?? null;
    out.push({
      code: family,
      category,
      name: modelNameOf(ps[0].name, family, category),
      added,
      skus: ps.length,
      sizes: sizesLine(ps),
      price,
      price2,
      hasPhoto: photos.has(family),
      photo,
    });
  }
  return out.sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : a.code.localeCompare(b.code)));
}

export const NEW_MODELS_PRICE_NOTE =
  "RM, master prices (Price 2 fabric tier where a product has tiers). Bedframes: Q = 5FT, K = 6FT, SK = Super King. Sofa combos from Sofa Combo pricing.";
