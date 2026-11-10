// ---------------------------------------------------------------------------
// forecast-sheet.ts — the Forecast P&L as keyed: one sheet model for every
// page that keys it (owner 2026-11-10 「我想要A」: the forecast is keyed in the
// Monthly P&L too; spec docs/superpowers/specs/2026-11-10-monthly-pl-
// forecast-edit-design.md section 4). Moved unchanged from
// src/pages/forecast.tsx, so whatever is keyed on one page saves exactly as the
// other would save it. Pure; tests: tests/forecast-sheet.test.mjs.
// ---------------------------------------------------------------------------
import { moneyFieldToSen } from "./money-field";
import type { FcEntry, FcMonth, FcSupplierCell } from "./forecast-pnl";
import type { ForecastCell, ForecastMonth } from "./forecast-snapshot";

/** One keyed cell as typed (owner 2026-07-29): a % of sales ("15.4") OR an
 *  RM amount ("3000"); typing one clears the other. */
export type CellEntry = ForecastCell;
/** One month of the sheet as typed: sales, line cells, and the customer and
 *  supplier cells (forecast-snapshot.ts). */
export type SheetMonth = ForecastMonth;
/** One month as stored in kv `forecast_pnl.months` and read back by GET
 *  /forecast (legacy bare-bp line cells included). */
export type SavedMonth = {
  salesSen?: number;
  salesByCustomer?: Record<string, number>;
  purchasesByType?: Record<string, Record<string, FcSupplierCell>>;
  pct?: Record<string, number | { bp?: number; amtSen?: number }>;
};
/** One month as PUT /forecast takes it. */
export type PayloadMonth = {
  salesSen: number;
  pct: Record<string, { bp?: number; amtSen?: number }>;
  salesByCustomer?: Record<string, number>;
  purchasesByType?: Record<string, Record<string, FcSupplierCell>>;
};

// "15.4" → 1540 basis points (int); blank/garbage → 0. A PERCENTAGE, not
// money, so it keeps parseFloat (tests/money-input-parsing.test.mjs).
export const strToBp = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
};
export const bpToStr = (bp: number): string => (bp === 0 ? "" : (bp / 100).toString());

export const cellKeyed = (e: CellEntry | undefined): boolean => (e?.a ?? "").trim() !== "" || (e?.p ?? "").trim() !== "";

// A month's customer cells in sen, for the screen only (the live total and
// each one's share). An unreadable cell shows as nothing here; Save refuses it
// first (sheetMoneyFields) and builds its own payload.
export function partySen(cells: Record<string, string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, s] of Object.entries(cells ?? {})) {
    const sen = (s ?? "").trim() === "" ? 0 : moneyFieldToSen(s) ?? 0;
    if (sen > 0) out[id] = sen;
  }
  return out;
}

// A material's supplier cells as typed → as stored, for the screen and for
// Save alike: an RM amount (whole sen) over a % (`{ bp }` of the month's
// sales); a cell that is empty or not above zero is left out. An unreadable
// RM is left out too, never read as 0 (tests/money-input-parsing.test.mjs);
// Save refuses it before this runs (sheetMoneyFields).
export function supplierCells(cells: Record<string, CellEntry> | undefined): Record<string, FcSupplierCell> {
  const out: Record<string, FcSupplierCell> = {};
  for (const [id, e] of Object.entries(cells ?? {})) {
    if ((e?.a ?? "").trim() !== "") {
      const sen = moneyFieldToSen(e.a as string);
      if (sen !== null && sen > 0) out[id] = sen;
    } else if ((e?.p ?? "").trim() !== "") {
      const bp = strToBp(e.p as string);
      if (bp > 0) out[id] = { bp };
    }
  }
  return out;
}

// The sheet's strings → the kv shape (`forecast_pnl.months[ym]`) the shared
// calc reads. BUG-2026-08-13-095: the shared money parser reads every form
// and returns null for the rest. Save refuses on null, so the `?? 0` here is
// only ever reached by a cell the operator is already being told to fix.
// Every key is kept, even a cleared one: the dept-mode test
// (monthHasDeptForecast) looks at keys, exactly as the old inline calc did.
export function toFcMonth(m: SheetMonth | undefined): FcMonth | undefined {
  if (!m) return undefined;
  const pct: Record<string, FcEntry> = {};
  for (const [code, e] of Object.entries(m.pct)) {
    pct[code] = e.a !== undefined && e.a !== "" ? { amtSen: moneyFieldToSen(e.a) ?? 0 } : { bp: strToBp(e.p ?? "") };
  }
  const purchasesByType: Record<string, Record<string, FcSupplierCell>> = {};
  for (const [type, cells] of Object.entries(m.suppliers ?? {})) {
    const kept = supplierCells(cells);
    if (Object.keys(kept).length) purchasesByType[type] = kept;
  }
  return {
    salesSen: Math.max(0, moneyFieldToSen(m.salesStr ?? "") ?? 0),
    salesByCustomer: partySen(m.customers),
    purchasesByType,
    pct,
  };
}

/** The stored months as the sheet types them: each cell in the box it was
 *  keyed in (an RM amount, or a % — a legacy bare number is a %). */
export function sheetFromSaved(saved: Record<string, SavedMonth>): Record<string, SheetMonth> {
  const next: Record<string, SheetMonth> = {};
  for (const [ym, m] of Object.entries(saved ?? {})) {
    const pct: Record<string, CellEntry> = {};
    for (const [code, v] of Object.entries(m?.pct ?? {})) {
      // Legacy shape = bare bp number; new shape = { bp } or { amtSen }.
      if (typeof v === "number") pct[code] = { p: bpToStr(v) };
      else if (v && typeof v === "object") {
        if (v.amtSen) pct[code] = { a: (Number(v.amtSen) / 100).toString() };
        else if (v.bp) pct[code] = { p: bpToStr(Number(v.bp) || 0) };
      }
    }
    const customers: Record<string, string> = {};
    for (const [id, sen] of Object.entries(m?.salesByCustomer ?? {}))
      if (Number(sen) > 0) customers[id] = (Number(sen) / 100).toFixed(2);
    // A supplier cell loads into the box it was keyed in: RM sen → RM,
    // `{ bp }` → % (owner 2026-11-10 「每个supplier 填percentage 或amount」).
    const suppliers: Record<string, Record<string, CellEntry>> = {};
    for (const [type, cells] of Object.entries(m?.purchasesByType ?? {}))
      for (const [id, v] of Object.entries(cells ?? {})) {
        if (v && typeof v === "object") {
          const bp = Number(v.bp) || 0;
          if (bp > 0) (suppliers[type] ??= {})[id] = { p: bpToStr(bp) };
        } else if (Number(v) > 0) (suppliers[type] ??= {})[id] = { a: (Number(v) / 100).toFixed(2) };
      }
    next[ym] = { salesStr: m?.salesSen ? (Number(m.salesSen) / 100).toFixed(2) : "", pct, customers, suppliers };
  }
  return next;
}

/** Every money cell on the sheet, labelled by month and line, so a refusal can
 *  point at the one that cannot be read (firstMoneyFieldError). Save must not
 *  run while any of them is unreadable: sheetPayload trusts they are. */
export function sheetMoneyFields(
  months: Record<string, SheetMonth>,
  names: { customerName: (id: string) => string; supplierName: (id: string) => string },
): { label: string; value: string }[] {
  return Object.entries(months).flatMap(([ym, m]) => [
    { label: `${ym} sales`, value: m.salesStr },
    ...Object.entries(m.customers ?? {})
      .filter(([, v]) => (v ?? "").trim() !== "")
      .map(([id, v]) => ({ label: `${ym} ${names.customerName(id)} sales`, value: v })),
    ...Object.entries(m.suppliers ?? {}).flatMap(([type, cells]) =>
      Object.entries(cells ?? {})
        .filter(([, e]) => (e?.a ?? "").trim() !== "")
        .map(([id, e]) => ({ label: `${ym} ${type} ${names.supplierName(id)} purchases`, value: e.a as string })),
    ),
    ...Object.entries(m.pct)
      .filter(([, e]) => e.a !== undefined && e.a !== "")
      .map(([code, e]) => ({ label: `${ym} ${code} amount`, value: e.a as string })),
  ]);
}

/** The sheet as PUT /forecast takes it. Every money cell is readable here:
 *  the caller refused the save first (sheetMoneyFields). Customer cells are
 *  kept and Sales is their sum (the server works it out the same way,
 *  forecastSalesSen); supplier cells are kept as keyed, RM or %, the same
 *  conversion as the screen's (supplierCells). */
export function sheetPayload(months: Record<string, SheetMonth>): Record<string, PayloadMonth> {
  const payload: Record<string, PayloadMonth> = {};
  for (const [ym, m] of Object.entries(months)) {
    const pct: Record<string, { bp?: number; amtSen?: number }> = {};
    for (const [code, e] of Object.entries(m.pct)) {
      if (e.a !== undefined && e.a !== "") {
        const sen = moneyFieldToSen(e.a) as number;
        if (sen !== 0) pct[code] = { amtSen: sen };
      } else if (e.p !== undefined && e.p !== "") {
        const bp = strToBp(e.p);
        if (bp !== 0) pct[code] = { bp };
      }
    }
    const salesByCustomer: Record<string, number> = {};
    for (const [id, v] of Object.entries(m.customers ?? {})) {
      if ((v ?? "").trim() === "") continue;
      const sen = moneyFieldToSen(v) as number;
      if (sen > 0) salesByCustomer[id] = sen;
    }
    const customerTotal = Object.values(salesByCustomer).reduce((s, v) => s + v, 0);
    const purchasesByType: Record<string, Record<string, FcSupplierCell>> = {};
    for (const [type, cells] of Object.entries(m.suppliers ?? {})) {
      const kept = supplierCells(cells);
      if (Object.keys(kept).length) purchasesByType[type] = kept;
    }
    payload[ym] = {
      ...(customerTotal > 0
        ? { salesSen: customerTotal, pct, salesByCustomer }
        : { salesSen: Math.max(0, moneyFieldToSen(m.salesStr) as number), pct }),
      ...(Object.keys(purchasesByType).length ? { purchasesByType } : {}),
    };
  }
  return payload;
}

/** A month added to the sheet: it inherits the PREVIOUS month's percentages
 *  (owner rule; the latest month when none is earlier), and no customer or
 *  supplier cells (spec 2026-11-09 section 4, spec 2026-11-10 section 3). */
export function newSheetMonth(months: Record<string, SheetMonth>, ym: string): SheetMonth {
  const yms = Object.keys(months).sort();
  const prevYm = [...yms].filter((k) => k < ym).pop() ?? [...yms].pop();
  const inherited = prevYm ? { ...months[prevYm].pct } : {};
  return { salesStr: "", pct: inherited, customers: {}, suppliers: {} };
}

/** Whether a month's Sales is its customers' total: only a customer figure
 *  above 0 counts (owner 2026-11-10 「我这里无法直接填total?」 — a box left at
 *  0 had kept Sales locked while the figure came from the Sales box). Empty,
 *  0 and unreadable boxes are no customer figure, so Sales is typed again;
 *  an unreadable one is still refused on Save (sheetMoneyFields). */
export const customersKeyed = (m: SheetMonth | undefined): boolean => Object.keys(partySen(m?.customers)).length > 0;
