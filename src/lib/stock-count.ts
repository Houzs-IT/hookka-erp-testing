// ---------------------------------------------------------------------------
// Warehouse › Stock Take — a quantity-only count (owner 2026-11-11,
// WORK-TRACKER 133: 「先把我要做的 quantities usage 和 export for stock count
// 功能做好先」; earlier 「这个 stock take 是要分14类，然后在更详细」「他们是点
// quantity 的哦」).
//
// Pure helpers shared by the page (src/pages/inventory/stock-take.tsx) and the
// API (src/api/routes/stock-count.ts):
//   • seriesOf / buildCountSheets / countSheetAoa — the blank count sheet: one
//     sheet per stock-take type, items grouped by their item-code series, and
//     NO system quantity (the September file copied the system's balance).
//   • parseCountWorkbook / normalizeCountLines — the filled sheet read back. A
//     blank Counted Qty means "not counted"; 0 means "counted, none".
//   • buildUsage / usageExportAoa — the month's usage per item: opening (last
//     month's count) + purchased (purchase-invoice STOCKED lines dated in the
//     month, × the item's unit factor when one is set) − closing (this month's
//     count). Quantities only — no money anywhere on this page.
//   • financeCountAoa — the saved count in the raw-material master layout that
//     Finance's Stock Take import already reads (Shape 3, `isRmCountShape`), so
//     Finance prices it the way it prices any count.
// ---------------------------------------------------------------------------
import { itemCodeKey } from "./stock-take-import";
import { findHeaderIndex } from "./table-import";

export type CountItem = { id?: string; code: string; description: string; uom: string; group: string; active: boolean };
/** `uom` only when the sheet named a unit other than the item master's (owner 「然后 UOM 如果他导出来换呢」). */
export type CountLine = { code: string; qty: number; remark?: string; uom?: string };
/** Which kind of row each line of an exported sheet is — drives the lines and shading (src/lib/styled-xlsx.ts). */
export type SheetRowKind = "title" | "meta" | "metaLong" | "sign" | "note" | "blank" | "header" | "series" | "item";
/** Quantity per item key (`itemCodeKey`). */
export type QtyByKey = Record<string, number>;
/** A month's purchased quantity of one item, and the unit-price spread of every purchase of it up to month end (sen). */
export type PurchaseQty = { qty: number; minUnitSen: number; maxUnitSen: number };

/** Most lines one saved count may hold (the master has ~600 raw materials). */
export const MAX_COUNT_LINES = 5000;
export const OTHER_SERIES = "Other items";
/** Five columns, so a sheet prints on A4 portrait at 100% (the family is the bold row above its items). */
export const COUNT_SHEET_HEADER = ["Item Code", "Description", "UOM", "Counted Qty", "Remark"];
/** Column widths (characters) that fit A4 portrait with 0.4" margins; Counted Qty and Remark are the write-in columns. */
export const COUNT_SHEET_COLS = [20, 40, 7, 12, 15];
export const COUNT_SHEET_WRITE_COLS = [3, 4];
/** The raw-material master export's columns — what `isRmCountShape` recognises. */
export const FINANCE_COUNT_HEADER = ["ID", "Item Code", "Description", "Base UOM", "Item Group", "Balance Qty"];

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
const groupKey = (g: unknown) => String(g ?? "").trim().toUpperCase();

/** A unit to compare on: the metre spellings are one unit, the rest upper-cased. */
export function unitKey(u: unknown): string {
  const s = String(u ?? "").trim().toUpperCase();
  return ["M", "MTR", "METER", "METRE", "METERS", "METRES"].includes(s) ? "M" : s;
}

/** "2026-11" → "2026-10"; January steps back into December. */
export function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-11" → "Nov 2026". */
export function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return m >= 1 && m <= 12 ? `${names[m - 1]} ${y}` : ym;
}

/** A short last part that only tells sizes or colours apart: "01", '2.5"', "A", "120E". */
function isVariantToken(t: string): boolean {
  const s = t.replace(/["″]+$/, "");
  if (!s || s.length > 5 || !/^[0-9A-Z.]+$/.test(s)) return false;
  return s.length === 1 || /[0-9]/.test(s);
}

/**
 * The family an item code belongs to on the count sheet: the code without its
 * last short variant ("PC151-14" → "PC151", 'NLY-D35-2.5"' → "NLY-D35",
 * "STAR 01" → "STAR"), after dropping trailing bracket notes ("OPN-A (12KG X
 * 10 ROLL)" → "OPN"). A code of letters then digits takes its letters ("ZS51"
 * → "ZS"). Anything else is its own family ("NON WOVEN BLACK"). The item
 * master has no sub-category field (measured 2026-11-11: itemType empty).
 */
export function seriesOf(code: string): string {
  const full = itemCodeKey(code);
  let base = full;
  for (let i = 0; i < 3 && /\s*\([^()]*\)$/.test(base); i++) base = base.replace(/\s*\([^()]*\)$/, "").trim();
  if (!base) base = full;
  let series: string | null = null;
  const m = /^(.*?[^\s-])[\s-]+([^\s-]+)$/.exec(base);
  if (m && isVariantToken(m[2])) series = m[1];
  else if (!/[\s-]/.test(base)) {
    const lm = /^([A-Z]{2,})[0-9][0-9A-Z.]*$/.exec(base);
    if (lm) series = lm[1];
  }
  return (series ?? full).replace(/\s+\(/g, "(");
}

/** Families with two or more items, in order; the single items last as "Other items". */
function seriesSections<T extends { code: string }>(list: T[], multi: Set<string>): { series: string; items: T[] }[] {
  const by = new Map<string, T[]>();
  const singles: T[] = [];
  for (const x of list) {
    const s = seriesOf(x.code);
    if (!multi.has(s)) { singles.push(x); continue; }
    const arr = by.get(s);
    if (arr) arr.push(x);
    else by.set(s, [x]);
  }
  const out = [...by.entries()].map(([series, items]) => ({ series, items: items.sort((a, b) => natural(a.code, b.code)) }));
  out.sort((a, b) => natural(a.series, b.series));
  if (singles.length) out.push({ series: OTHER_SERIES, items: singles.sort((a, b) => natural(a.code, b.code)) });
  return out;
}

/** The families of a type that have two or more of its active items. */
function multiSeriesOf(items: CountItem[], group: string): Set<string> {
  const n = new Map<string, number>();
  for (const it of items) {
    if (!it.active || groupKey(it.group) !== groupKey(group)) continue;
    const s = seriesOf(it.code);
    n.set(s, (n.get(s) ?? 0) + 1);
  }
  return new Set([...n].filter(([, c]) => c >= 2).map(([s]) => s));
}

export type SheetRow =
  | { kind: "series"; series: string; count: number }
  | { kind: "item"; series: string; code: string; description: string; uom: string };
export type CountSheet = { group: string; itemCount: number; rows: SheetRow[] };

/** One count sheet per chosen type (in the order given): its active items, family by family. */
export function buildCountSheets(items: CountItem[], groups: string[]): CountSheet[] {
  const out: CountSheet[] = [];
  for (const g of groups) {
    const list = items.filter((i) => i.active && groupKey(i.group) === groupKey(g) && itemCodeKey(i.code));
    if (!list.length) continue;
    const rows: SheetRow[] = [];
    for (const s of seriesSections(list, multiSeriesOf(items, g))) {
      rows.push({ kind: "series", series: s.series, count: s.items.length });
      for (const i of s.items) {
        rows.push({ kind: "item", series: s.series === OTHER_SERIES ? "" : s.series, code: i.code.trim(), description: i.description ?? "", uom: i.uom ?? "" });
      }
    }
    out.push({ group: g, itemCount: list.length, rows });
  }
  return out;
}

/** A count sheet as rows for Excel — title, who counted, the rule for blanks, the header, then the items — with each row's kind. */
export function countSheetLayout(sheet: CountSheet, meta: { company: string; ymLabel: string }): { aoa: (string | number)[][]; kinds: SheetRowKind[] } {
  const aoa: (string | number)[][] = [
    [`${meta.company} — Stock count`],
    ["Type", sheet.group, "", "Month", meta.ymLabel],
    ["Counted by", "", "", "Checked by", ""],
    ["Count at the end of the month, in the unit shown. Write 0 if there is none — a blank means not counted. Counted in another unit? Write it in UOM."],
    [],
    [...COUNT_SHEET_HEADER],
  ];
  const kinds: SheetRowKind[] = ["title", "meta", "sign", "note", "blank", "header"];
  for (const r of sheet.rows) {
    if (r.kind === "series") {
      aoa.push([`${r.series} (${r.count} ${r.count === 1 ? "item" : "items"})`, "", "", "", ""]);
      kinds.push("series");
    } else {
      aoa.push([r.code, r.description, r.uom, "", ""]);
      kinds.push("item");
    }
  }
  return { aoa, kinds };
}

/** The count sheet's rows alone. */
export function countSheetAoa(sheet: CountSheet, meta: { company: string; ymLabel: string }): (string | number)[][] {
  return countSheetLayout(sheet, meta).aoa;
}

export type CountProblem = { sheet: string; row: number; code: string; message: string };
export type ParsedCount = {
  lines: CountLine[];
  problems: CountProblem[];
  /** Codes that appeared more than once; their quantities were added. */
  duplicates: string[];
  /** Item rows left blank — not counted. */
  blank: number;
  sheetsRead: number;
  /** Sheets with no "Item Code" + "Counted Qty" header. */
  skippedSheets: string[];
  /** Items whose UOM on the sheet is not the item master's (only when the master's units were given). */
  unitChanges: { code: string; from: string; to: string }[];
};

const QTY_HEADERS = ["Counted Qty", "Count Qty", "Balance Qty", "Qty", "Quantity"];
/** A family heading on the count sheet ("PC151 (18 items)"), which sits in the Item Code column. */
const SERIES_ROW = /^.+ \(\d+ items?\)$/;

/** A quantity cell: a number, or text with thousands commas ("1,333.2"). NaN when unreadable. */
function qtyFromCell(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const t = String(raw).trim();
  return /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? Number(t.replace(/,/g, "")) : Number(t);
}

/**
 * The filled count sheet read back — every sheet that has an "Item Code" and a
 * "Counted Qty" header (the master export's "Balance Qty" works too). The same
 * item on two rows or two sheets is added up and reported. Given the item
 * master's units (`masterUnits`, code → UOM), the UOM column is read too: a
 * line keeps the unit written on the sheet when it is not the master's
 * (MTR = METER), and those items are listed in `unitChanges`.
 */
export function parseCountWorkbook(sheets: { name: string; aoa: unknown[][] }[], masterUnits?: Record<string, string>): ParsedCount {
  const byKey = new Map<string, CountLine>();
  const dup = new Set<string>();
  const problems: CountProblem[] = [];
  const skippedSheets: string[] = [];
  const unitChanges: ParsedCount["unitChanges"] = [];
  const units = masterUnits ? new Map(Object.entries(masterUnits).map(([k, u]) => [itemCodeKey(k), String(u ?? "").trim()])) : null;
  let blank = 0;
  let sheetsRead = 0;
  for (const sh of sheets) {
    const aoa = Array.isArray(sh.aoa) ? sh.aoa : [];
    let h = -1, cCode = -1, cQty = -1, cRemark = -1, cUom = -1;
    for (let i = 0; i < Math.min(aoa.length, 40); i++) {
      const row = Array.isArray(aoa[i]) ? aoa[i] : [];
      const code = findHeaderIndex(row, "Item Code");
      const qty = findHeaderIndex(row, ...QTY_HEADERS);
      if (code >= 0 && qty >= 0) {
        h = i; cCode = code; cQty = qty;
        cRemark = findHeaderIndex(row, "Remark", "Remarks", "Note", "Notes");
        cUom = units ? findHeaderIndex(row, "UOM", "Base UOM", "Unit") : -1;
        break;
      }
    }
    if (h < 0) { skippedSheets.push(sh.name); continue; }
    sheetsRead++;
    for (let i = h + 1; i < aoa.length; i++) {
      const row = Array.isArray(aoa[i]) ? aoa[i] : [];
      const code = String(row[cCode] ?? "").trim().replace(/\s+/g, " ");
      if (!code) continue;
      const raw = row[cQty];
      const isBlank = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
      if (SERIES_ROW.test(code)) {
        // A family heading, not an item: skipped; a quantity written on it is reported, never saved as a code.
        if (!isBlank) problems.push({ sheet: sh.name, row: i + 1, code, message: "This is a family heading — write the quantity on the item rows" });
        continue;
      }
      if (isBlank) { blank++; continue; }
      const qty = qtyFromCell(raw);
      if (!Number.isFinite(qty)) { problems.push({ sheet: sh.name, row: i + 1, code, message: "Counted Qty is not a number" }); continue; }
      if (qty < 0) { problems.push({ sheet: sh.name, row: i + 1, code, message: "Counted Qty is below zero" }); continue; }
      const remark = cRemark >= 0 ? String(row[cRemark] ?? "").trim().slice(0, 200) : "";
      const key = itemCodeKey(code);
      // A unit is kept only when it is not the master's (or the item is not in the master).
      const written = cUom >= 0 ? String(row[cUom] ?? "").trim().slice(0, 20) : "";
      const master = units?.get(key);
      const uom = written && (master === undefined || unitKey(written) !== unitKey(master)) ? written : "";
      const prev = byKey.get(key);
      if (prev) {
        prev.qty = round4(prev.qty + qty);
        if (remark) prev.remark = (prev.remark ? `${prev.remark}; ${remark}` : remark).slice(0, 200);
        if (uom && !prev.uom) prev.uom = uom;
        dup.add(prev.code);
      } else {
        const line: CountLine = { code, qty: round4(qty) };
        if (remark) line.remark = remark;
        if (uom) line.uom = uom;
        byKey.set(key, line);
      }
      if (uom && master && !unitChanges.some((u) => itemCodeKey(u.code) === key)) unitChanges.push({ code, from: master, to: uom });
    }
  }
  return { lines: [...byKey.values()], problems, duplicates: [...dup], blank, sheetsRead, skippedSheets, unitChanges };
}

/** The server's check of a count about to be saved: every line a code and a number ≥ 0; the same item added up. */
export function normalizeCountLines(input: unknown): { lines: CountLine[]; errors: string[] } {
  if (!Array.isArray(input)) return { lines: [], errors: ["lines must be a list"] };
  if (input.length > MAX_COUNT_LINES) return { lines: [], errors: [`a count holds at most ${MAX_COUNT_LINES} lines`] };
  const errors: string[] = [];
  const byKey = new Map<string, CountLine>();
  input.forEach((l, i) => {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const code = String(o.code ?? "").trim().replace(/\s+/g, " ");
    const qty = typeof o.qty === "number" ? o.qty : Number.NaN;
    if (!code || code.length > 100) { errors.push(`line ${i + 1}: item code missing or too long`); return; }
    if (!Number.isFinite(qty) || qty < 0 || qty > 1e9) { errors.push(`line ${i + 1} (${code}): quantity must be a number of 0 or more`); return; }
    const remark = typeof o.remark === "string" ? o.remark.trim().slice(0, 200) : "";
    const uom = typeof o.uom === "string" ? o.uom.trim().slice(0, 20) : "";
    const key = itemCodeKey(code);
    const prev = byKey.get(key);
    if (prev) {
      prev.qty = round4(prev.qty + qty);
      if (remark) prev.remark = (prev.remark ? `${prev.remark}; ${remark}` : remark).slice(0, 200);
      if (uom && !prev.uom) prev.uom = uom;
    } else {
      const line: CountLine = { code, qty: round4(qty) };
      if (remark) line.remark = remark;
      if (uom) line.uom = uom;
      byKey.set(key, line);
    }
  });
  return { lines: errors.length ? [] : [...byKey.values()], errors };
}

/** 1 purchase unit = N count units. A positive number; blank clears (null); anything else is refused (undefined). */
export function parseUomFactor(v: unknown): number | null | undefined {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return undefined;
  return Math.round(n * 1e6) / 1e6;
}

function qtyByKey(lines: unknown, keep: (o: Record<string, unknown>) => boolean): QtyByKey | null {
  if (!Array.isArray(lines)) return null;
  const out: QtyByKey = {};
  for (const l of lines) {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    if (!keep(o)) continue;
    const key = itemCodeKey(o.code);
    const qty = Number(o.qty);
    if (!key || !Number.isFinite(qty) || qty < 0) continue;
    out[key] = round4((out[key] ?? 0) + qty);
  }
  return out;
}

/** Quantities of Finance's priced count (kv stock_take_lines): its counted lines only. */
export function countFromFinanceLines(record: unknown): QtyByKey | null {
  return qtyByKey((record as { lines?: unknown } | null)?.lines, (o) => o.counted !== false);
}

/** Quantities of a saved warehouse count (kv stock_count). */
export function countFromWarehouseLines(record: unknown): QtyByKey | null {
  return qtyByKey((record as { lines?: unknown } | null)?.lines, () => true);
}

/**
 * The units a count names per item: Finance's priced count carries every
 * line's unit (`countedOnly` — its counted lines only); a warehouse line
 * carries one only when it was changed on the sheet.
 */
export function countUnitsFromLines(record: unknown, countedOnly: boolean): Record<string, string[]> {
  const lines = (record as { lines?: unknown } | null)?.lines;
  const out: Record<string, string[]> = {};
  if (!Array.isArray(lines)) return out;
  for (const l of lines) {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    if (countedOnly && o.counted === false) continue;
    const key = itemCodeKey(o.code);
    const u = typeof o.uom === "string" ? o.uom.trim() : "";
    if (!key || !u) continue;
    const arr = (out[key] ??= []);
    if (!arr.includes(u)) arr.push(u);
  }
  return out;
}

export type UsageFlag = "noOpening" | "noClosing" | "units" | "unitChanged" | "negative";
export type UsageRow = {
  code: string;
  description: string;
  uom: string;
  group: string;
  /** Last month's count; null = not in it (or no count that month). */
  opening: number | null;
  /** Purchase-invoice quantity dated in the month, as invoiced. */
  purchasedRaw: number;
  /** 1 purchase unit = factor count units; null = the same unit. */
  factor: number | null;
  /** purchasedRaw × factor, in the count unit. */
  purchased: number;
  closing: number | null;
  /** opening + purchased − closing; null when either count is missing. */
  usage: number | null;
  flags: UsageFlag[];
  /** Units a count used for this item that are not the item master's ("unitChanged"). */
  countedUnits: string[];
};
export type UsageSeries = { series: string; rows: UsageRow[]; total: { uom: string; opening: number; purchased: number; closing: number; usage: number } | null };
export type UsageGroup = { group: string; series: UsageSeries[]; items: number; withUsage: number; negatives: number; units: number };
export type UsageResult = { groups: UsageGroup[]; unknown: UsageRow[]; summary: { items: number; withUsage: number; negatives: number; units: number } };

/**
 * The month's usage per item of the chosen types. `opening` / `closing` are the
 * counts on file for last month and this month (null = no count that month);
 * an item a count does not list was not counted, so its usage stays empty
 * rather than turning into a false gain or loss (owner 2026-11-11 「那就不太对了」
 * on comparing a 68-item count with a 211-item one). Bought at unit prices more
 * than 3× apart with no factor set → "units" (the invoice's unit may not be
 * the count's, e.g. a roll bought, metres counted).
 */
export function buildUsage(input: {
  items: CountItem[];
  groups: string[];
  opening: QtyByKey | null;
  closing: QtyByKey | null;
  /** Units each count named per item (countUnitsFromLines); a unit not the master's flags "unitChanged". */
  openingUnits?: Record<string, string[]>;
  closingUnits?: Record<string, string[]>;
  purchases: Record<string, PurchaseQty>;
  factors: Record<string, number>;
}): UsageResult {
  const { items, groups, opening, closing, purchases, factors } = input;
  const openingUnits = input.openingUnits ?? {};
  const closingUnits = input.closingUnits ?? {};
  const master = new Map<string, CountItem>();
  for (const it of items) {
    const k = itemCodeKey(it.code);
    if (k && !master.has(k)) master.set(k, it);
  }
  const rowFor = (key: string, it: CountItem | null): UsageRow | null => {
    const o = opening && Object.prototype.hasOwnProperty.call(opening, key) ? opening[key] : null;
    const c = closing && Object.prototype.hasOwnProperty.call(closing, key) ? closing[key] : null;
    const p = purchases[key];
    const raw = p ? round4(Number(p.qty) || 0) : 0;
    if (o === null && c === null && !(raw > 0)) return null;
    const f = factors[key];
    const factor = typeof f === "number" && Number.isFinite(f) && f > 0 ? f : null;
    const purchased = round4(raw * (factor ?? 1));
    const usage = o !== null && c !== null ? round4(o + purchased - c) : null;
    const flags: UsageFlag[] = [];
    if (opening && o === null) flags.push("noOpening");
    if (closing && c === null) flags.push("noClosing");
    if (p && factor === null && p.minUnitSen > 0 && p.maxUnitSen / p.minUnitSen > 3) flags.push("units");
    // A count taken in another unit than the item master's (MTR = METER).
    const masterUnit = unitKey(it?.uom ?? "");
    const countedUnits = masterUnit
      ? [...new Set([...(o !== null ? openingUnits[key] ?? [] : []), ...(c !== null ? closingUnits[key] ?? [] : [])])].filter((u) => unitKey(u) !== masterUnit)
      : [];
    if (countedUnits.length) flags.push("unitChanged");
    if (usage !== null && usage < 0) flags.push("negative");
    return { code: it ? it.code.trim() : key, description: it?.description ?? "", uom: it?.uom ?? "", group: it?.group ?? "", opening: o, purchasedRaw: raw, factor, purchased, closing: c, usage, flags, countedUnits };
  };

  const summary = { items: 0, withUsage: 0, negatives: 0, units: 0 };
  const out: UsageGroup[] = [];
  for (const g of groups) {
    const rows: UsageRow[] = [];
    const seen = new Set<string>();
    for (const [key, it] of master) {
      if (groupKey(it.group) !== groupKey(g) || seen.has(key)) continue;
      seen.add(key);
      const r = rowFor(key, it);
      if (r) rows.push(r);
    }
    if (!rows.length) continue;
    const series = seriesSections(rows, multiSeriesOf(items, g)).map((s) => ({ series: s.series, rows: s.items, total: seriesTotal(s.series, s.items) }));
    const grp: UsageGroup = {
      group: g,
      series,
      items: rows.length,
      withUsage: rows.filter((r) => r.usage !== null).length,
      negatives: rows.filter((r) => r.flags.includes("negative")).length,
      units: rows.filter((r) => r.flags.includes("units") || r.flags.includes("unitChanged")).length,
    };
    summary.items += grp.items;
    summary.withUsage += grp.withUsage;
    summary.negatives += grp.negatives;
    summary.units += grp.units;
    out.push(grp);
  }

  // Counted codes the item master does not know: listed apart, never dropped.
  const unknown: UsageRow[] = [];
  const counted = new Set([...Object.keys(opening ?? {}), ...Object.keys(closing ?? {})]);
  for (const key of [...counted].sort(natural)) {
    if (master.has(key)) continue;
    const r = rowFor(key, null);
    if (r) unknown.push(r);
  }
  return { groups: out, unknown, summary };
}

/** A family's total — only when every item has a usage and they share one unit. */
function seriesTotal(series: string, rows: UsageRow[]): UsageSeries["total"] {
  if (series === OTHER_SERIES || rows.length < 2) return null;
  const u = unitKey(rows[0].uom);
  if (!u || rows.some((r) => unitKey(r.uom) !== u || r.usage === null || r.opening === null || r.closing === null)) return null;
  const sum = (f: (r: UsageRow) => number) => round4(rows.reduce((t, r) => t + f(r), 0));
  return { uom: rows[0].uom, opening: sum((r) => r.opening ?? 0), purchased: sum((r) => r.purchased), closing: sum((r) => r.closing ?? 0), usage: sum((r) => r.usage ?? 0) };
}

/** What a row's flags mean, in words. */
export function usageNote(r: Pick<UsageRow, "flags" | "uom" | "countedUnits">): string {
  const words: Record<UsageFlag, string> = {
    noOpening: "Not in last month's count",
    noClosing: "Not counted this month",
    units: "Unit? Bought at prices over 3× apart — the invoice unit may not be the count unit",
    unitChanged: `Counted in ${(r.countedUnits ?? []).join("/")} — item unit ${r.uom || "not set"}`,
    negative: "Negative usage",
  };
  return r.flags.map((f) => words[f]).join("; ");
}

/** The usage table for Excel — the two counts it used, then one row per item — with each row's kind. */
export function usageExportLayout(
  u: UsageResult,
  meta: { company: string; ymLabel: string; prevLabel: string; openingSource: string; closingSource: string },
): { aoa: (string | number)[][]; kinds: SheetRowKind[] } {
  const aoa: (string | number)[][] = [
    [`${meta.company} — Stock usage ${meta.ymLabel}`],
    ["Opening", `${meta.prevLabel} — ${meta.openingSource}`],
    ["Closing", `${meta.ymLabel} — ${meta.closingSource}`],
    ["Usage = opening + purchased − closing. Purchased = purchase-invoice quantity dated in the month × unit factor. Quantities only."],
    [],
    ["Type", "Series", "Item Code", "Description", "UOM", `Opening (${meta.prevLabel})`, `Purchased (${meta.ymLabel})`, "Unit factor", `Closing (${meta.ymLabel})`, `Usage (${meta.ymLabel})`, "Note"],
  ];
  const kinds: SheetRowKind[] = ["title", "metaLong", "metaLong", "note", "blank", "header"];
  const push = (group: string, series: string, r: UsageRow) => {
    aoa.push([group, series, r.code, r.description, r.uom, r.opening ?? "", r.purchased, r.factor ?? "", r.closing ?? "", r.usage ?? "", usageNote(r)]);
    kinds.push("item");
  };
  for (const g of u.groups) for (const s of g.series) for (const r of s.rows) push(g.group, s.series === OTHER_SERIES ? "" : s.series, r);
  for (const r of u.unknown) push("Not in item master", "", r);
  return { aoa, kinds };
}

/** The usage table's rows alone. */
export function usageExportAoa(
  u: UsageResult,
  meta: { company: string; ymLabel: string; prevLabel: string; openingSource: string; closingSource: string },
): (string | number)[][] {
  return usageExportLayout(u, meta).aoa;
}

/** A saved count in the raw-material master export layout (header row first), for Finance's Stock Take import. */
export function financeCountAoa(lines: CountLine[], items: CountItem[]): (string | number)[][] {
  const master = new Map<string, CountItem>();
  for (const it of items) {
    const k = itemCodeKey(it.code);
    if (k && !master.has(k)) master.set(k, it);
  }
  const aoa: (string | number)[][] = [[...FINANCE_COUNT_HEADER]];
  for (const l of lines) {
    const it = master.get(itemCodeKey(l.code));
    // The unit counted in, when the sheet changed it — Finance prices per unit.
    aoa.push([it?.id ?? "", l.code, it?.description ?? "", l.uom || (it?.uom ?? ""), it?.group ?? "", l.qty]);
  }
  return aoa;
}
