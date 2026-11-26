// ---------------------------------------------------------------------------
// mcp-export.ts — the AI Connector's export_excel (owner 2026-11-26, round 3).
//
// A list the connector can already read, fetched AS THE PERSON through the
// same inner GET + module gate + field redaction as erp_get (routes/mcp.ts
// readValue), turned into a real .xlsx: header row, sensible column widths,
// money in RM (a `…Sen` key becomes "<label> (RM)" divided by 100), at most
// EXPORT_MAX_ROWS rows. Stored like get_pdf (hookka-files/mcp-exports/<org>/,
// 15-minute signed link — lib/mcp-pdf.ts uploadExportAndSign).
//
// Writer: SheetJS `xlsx`, already a dependency and already in the Worker
// bundle (lib/assistant-exports.ts → delivery-orders), pure JS, Workers-safe
// with type "array". No new dependency.
//
// Everything here except buildXlsx's XLSX call is pure and unit-tested
// (tests/mcp-round3.test.mjs).
// ---------------------------------------------------------------------------
import * as XLSX from "xlsx";

type Obj = Record<string, unknown>;

export const EXPORT_MAX_ROWS = 5000;
export const EXPORT_PAGE_SIZE = 500; // every paginated list caps limit at 500
export const EXPORT_MAX_COLUMNS = 60;
const CELL_MAX = 2000;

export type ExportList = {
  label: string;
  api: string;
  /** Supports ?page&limit and answers { data, total }. */
  paginated: boolean;
  /** Fixed query the list always gets (e.g. the Inventory bucket). */
  query?: Record<string, string>;
  /** Where the rows sit when the reply is not a plain { data: [...] }. */
  rowsAt?: string;
  /** Columns to put first, when present. */
  prefer: string[];
};

/**
 * The lists export_excel may read: the main transaction and master lists the
 * connector already reads (every one is in MCP_PREFIX_RESOURCES, so the module
 * gate and the route's own permission check apply exactly as for erp_get).
 */
export const EXPORT_LISTS: Record<string, ExportList> = {
  "sales-orders": { label: "Sales orders", api: "/api/sales-orders", paginated: true, prefer: ["companySOId", "companySODate", "customerName", "hubName", "customerPOId", "status", "hookkaExpectedDD", "customerDeliveryDate", "totalSen"] },
  "delivery-orders": { label: "Delivery orders", api: "/api/delivery-orders", paginated: true, prefer: ["doNo", "deliveryDate", "customerName", "hubName", "status", "totalSen"] },
  invoices: { label: "Invoices", api: "/api/invoices", paginated: true, prefer: ["invoiceNo", "invoiceDate", "customerName", "status", "totalSen", "paidAmountSen", "dueDate"] },
  "purchase-orders": { label: "Purchase orders", api: "/api/purchase-orders", paginated: true, prefer: ["poNo", "orderDate", "supplierName", "status", "expectedDate", "totalSen", "grnNumbers"] },
  grn: { label: "Goods received", api: "/api/grn", paginated: true, prefer: ["grnNumber", "receiveDate", "supplierName", "poNumber", "status", "arrival_state"] },
  "production-orders": { label: "Production orders", api: "/api/production-orders", paginated: true, prefer: ["poNo", "companySOId", "customerName", "productCode", "productName", "status", "targetEndDate"] },
  customers: { label: "Customers", api: "/api/customers", paginated: false, prefer: ["code", "name", "contactPerson", "phone", "email", "state"] },
  suppliers: { label: "Suppliers", api: "/api/suppliers", paginated: false, prefer: ["code", "name", "contactPerson", "phone", "email"] },
  products: { label: "Products", api: "/api/products", paginated: false, prefer: ["code", "name", "category", "sizeCode", "status"] },
  "raw-materials": { label: "Raw materials", api: "/api/inventory", paginated: false, query: { buckets: "rawMaterials" }, rowsAt: "rawMaterials", prefer: ["itemCode", "description", "itemGroup", "baseUOM", "balanceQty", "minStock", "maxStock"] },
  "service-cases": { label: "Service cases", api: "/api/service-cases", paginated: false, prefer: ["caseNo", "customerName", "status", "createdAt"] },
};

/** Keys tried, in order, for the date-range filter. */
export const DATE_KEYS = ["companySODate", "orderDate", "invoiceDate", "doDate", "deliveryDate", "receiveDate", "date", "createdAt"];

/** The rows of one list reply. */
export function exportRows(body: unknown, rowsAt?: string): Obj[] {
  const asRows = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Obj[] : []);
  if (Array.isArray(body)) return asRows(body);
  const o = (body && typeof body === "object" ? body : {}) as Obj;
  const d = o.data;
  if (rowsAt) {
    if (d && typeof d === "object" && !Array.isArray(d) && Array.isArray((d as Obj)[rowsAt])) return asRows((d as Obj)[rowsAt]);
    if (Array.isArray(o[rowsAt])) return asRows(o[rowsAt]);
  }
  if (Array.isArray(d)) return asRows(d);
  if (d && typeof d === "object") for (const k of ["rows", "items", "results"]) if (Array.isArray((d as Obj)[k])) return asRows((d as Obj)[k]);
  for (const k of ["rows", "items", "results"]) if (Array.isArray(o[k])) return asRows(o[k]);
  return [];
}

/** The list's total row count, when the reply says it. */
export function exportTotal(body: unknown): number | null {
  const o = (body && typeof body === "object" ? body : {}) as Obj;
  const n = Number(o.total);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** How many pages to read: page 1 is already read; the rest at most up to the row cap. */
export function pagesToRead(total: number | null, firstPageRows: number): number {
  if (firstPageRows < EXPORT_PAGE_SIZE) return 1;
  const maxPages = Math.ceil(EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE);
  if (total === null) return maxPages; // unknown: read until a short page or the cap
  return Math.max(1, Math.min(maxPages, Math.ceil(total / EXPORT_PAGE_SIZE)));
}

export type ExportFilter = { search?: string; status?: string; from?: string; to?: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The date key a list's rows carry (first of DATE_KEYS present), or null. */
export function dateKeyOf(rows: Obj[]): string | null {
  const sample = rows.slice(0, 50);
  for (const k of DATE_KEYS) if (sample.some((r) => typeof r[k] === "string" && YMD.test(String(r[k]).slice(0, 10)))) return k;
  return null;
}

/** Search (any text cell, case-insensitive), status (exact, case-insensitive) and from / to on the list's date. */
export function filterRows(rows: Obj[], f: ExportFilter): { rows: Obj[]; dateKey: string | null } {
  const q = (f.search ?? "").trim().toLowerCase();
  const st = (f.status ?? "").trim().toLowerCase();
  const from = YMD.test(f.from ?? "") ? f.from! : "";
  const to = YMD.test(f.to ?? "") ? f.to! : "";
  const dateKey = from || to ? dateKeyOf(rows) : null;
  const out = rows.filter((r) => {
    if (st && String(r.status ?? "").toLowerCase() !== st) return false;
    if (dateKey) {
      const d = String(r[dateKey] ?? "").slice(0, 10);
      if (!d || (from && d < from) || (to && d > to)) return false;
    }
    if (q) {
      let hit = false;
      for (const v of Object.values(r)) {
        if ((typeof v === "string" || typeof v === "number") && String(v).toLowerCase().includes(q)) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }
    return true;
  });
  return { rows: out, dateKey };
}

const isMoneyKey = (k: string) => /sen$/i.test(k) && !/^(is|has)/.test(k);

/** "companySODate" → "Company SO Date"; "arrival_state" → "Arrival State"; money keys lose "Sen" and gain "(RM)". */
export function columnLabel(key: string): string {
  const money = isMoneyKey(key);
  const base = money ? key.replace(/_?sen$/i, "") : key;
  const words = base
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)));
  return words.join(" ") + (money ? " (RM)" : "");
}

export type Column = { key: string; label: string; money: boolean };

/**
 * The sheet's columns: scalar keys only (nested lines and objects are left
 * out), preferred ones first, then first-seen order; `fields` (keys or labels)
 * narrows them. Capped at EXPORT_MAX_COLUMNS.
 */
export function pickColumns(rows: Obj[], prefer: string[], fields: string[] = []): Column[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows.slice(0, 500)) {
    for (const [k, v] of Object.entries(r)) {
      if (set.has(k)) continue;
      if (v !== null && typeof v === "object") continue;
      set.add(k);
      seen.push(k);
    }
  }
  let keys = [...prefer.filter((k) => set.has(k)), ...seen.filter((k) => !prefer.includes(k))];
  if (fields.length) {
    const want = fields.map((f) => f.trim().toLowerCase()).filter(Boolean);
    keys = want
      .map((w) => keys.find((k) => k.toLowerCase() === w || columnLabel(k).toLowerCase() === w))
      .filter((k): k is string => !!k)
      .filter((k, i, a) => a.indexOf(k) === i);
  }
  return keys.slice(0, EXPORT_MAX_COLUMNS).map((key) => ({ key, label: columnLabel(key), money: isMoneyKey(key) }));
}

/** One cell: money → RM (2 dp), booleans → Yes / No, long text cut. */
export function cellValue(v: unknown, money: boolean): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (money) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) / 100 : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  return s.length > CELL_MAX ? s.slice(0, CELL_MAX - 1) + "…" : s;
}

/** Header + rows as an array of arrays, and a width per column (characters, 8–50). */
export function sheetData(rows: Obj[], cols: Column[]): { aoa: (string | number | null)[][]; widths: number[] } {
  const aoa: (string | number | null)[][] = [cols.map((c) => c.label)];
  const widths = cols.map((c) => c.label.length);
  rows.forEach((r, i) => {
    const line = cols.map((c) => cellValue(r[c.key], c.money));
    if (i < 300) line.forEach((v, j) => (widths[j] = Math.max(widths[j], v === null ? 0 : typeof v === "number" ? String(v).length + 3 : v.length)));
    aoa.push(line);
  });
  return { aoa, widths: widths.map((w) => Math.min(50, Math.max(8, w + 2))) };
}

/** The .xlsx bytes: header row frozen with a filter, widths set, RM columns as #,##0.00. */
export function buildXlsx(sheetName: string, rows: Obj[], cols: Column[]): Uint8Array {
  const { aoa, widths } = sheetData(rows, cols);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  if (cols.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: cols.length - 1, r: Math.max(1, rows.length) } }) };
  cols.forEach((c, ci) => {
    if (!c.money) return;
    for (let r = 1; r <= rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ c: ci, r })];
      if (cell && cell.t === "n") cell.z = "#,##0.00";
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31).replace(/[/\\?*[\]:]/g, "_") || "Sheet1");
  return new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
}

/** "Hookka-sales-orders-2026-11-26.xlsx". */
export function exportFileName(list: string, today: string): string {
  return `Hookka-${list}-${today}.xlsx`;
}
