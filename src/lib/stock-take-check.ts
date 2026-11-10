// ---------------------------------------------------------------------------
// stock-take-check.ts — a month's stored stock take vs the priced count lines
// it was built from. Pure; read-only.
//
// Two records make up a month-end stock take (src/api/routes/accounting.ts):
//   stored  table `stock_take` (item_group, ym, value_sen) — the per-group
//           closing value the P&L material engine uses (loadMaterialCostData →
//           stockTakeByGroupYm → materialWindow / closingStockAt). This is the
//           figure that drives raw-material cost.
//   lines   kv_config `stock_take_lines:<org>:<ym>` — the priced count saved
//           with the month by PUT /stock-take (owner 2026-10-09): every counted
//           item with its group, qty, price and valueSen; `counted` false = the
//           item or its whole group was left out of the month's figures.
// The Stock Take tab fills a group's stored value from the sum of its counted
// lines, but the value can be typed over afterwards and is saved separately,
// so the two can drift (Finance, Oct 2026 fabric: RM 14,877 stored vs RM 97,660
// from its lines). GET /api/accounting/stock-take/check reports both per group.
// ---------------------------------------------------------------------------

/** RM 100. */
export const STOCK_TAKE_MISMATCH_MIN_SEN = 10_000;
/** 1% of the larger of the two figures. */
export const STOCK_TAKE_MISMATCH_MIN_RATIO = 0.01;

export type StockTakeStoredRow = { itemGroup: string; valueSen: number };
export type StockTakeLine = { group?: unknown; valueSen?: unknown; counted?: unknown };
export type StockTakeLinesRecord = { file?: unknown; asOf?: unknown; savedAt?: unknown; lines?: unknown } | null;

export type StockTakeCheckRow = {
  group: string;
  /** null = no stored row: the P&L uses the automatic (FIFO/BOM) figure for this group. */
  storedSen: number | null;
  /** null = no counted line in this group (never counted, or left out). */
  linesSen: number | null;
  countedLines: number;
  /** linesSen − storedSen (a missing side counts as 0); null when there are no counted lines to compare. */
  diffSen: number | null;
  mismatch: boolean;
};

export type StockTakeCheck = {
  ym: string;
  hasLines: boolean;
  linesFile: string | null;
  linesSavedAt: string | null;
  rows: StockTakeCheckRow[];
};

const groupKey = (g: unknown) => String(g ?? "").trim().toUpperCase();

/** More than RM 100 AND more than 1% of the larger figure. */
export function isStockTakeMismatch(storedSen: number, linesSen: number): boolean {
  const diff = Math.abs(linesSen - storedSen);
  const base = Math.max(Math.abs(storedSen), Math.abs(linesSen));
  return diff > STOCK_TAKE_MISMATCH_MIN_SEN && diff > base * STOCK_TAKE_MISMATCH_MIN_RATIO;
}

export function compareStockTake(ym: string, stored: readonly StockTakeStoredRow[], record: StockTakeLinesRecord): StockTakeCheck {
  const lines = record && Array.isArray(record.lines) ? (record.lines as StockTakeLine[]) : null;
  const byKey = new Map<string, { group: string; storedSen: number | null; linesSen: number; countedLines: number }>();
  const at = (raw: unknown) => {
    const k = groupKey(raw);
    if (!k) return null;
    let cur = byKey.get(k);
    if (!cur) {
      cur = { group: String(raw ?? "").trim(), storedSen: null, linesSen: 0, countedLines: 0 };
      byKey.set(k, cur);
    }
    return cur;
  };
  for (const r of stored) {
    const cur = at(r.itemGroup);
    if (!cur) continue;
    cur.group = String(r.itemGroup).trim();
    cur.storedSen = (cur.storedSen ?? 0) + Math.round(Number(r.valueSen) || 0);
  }
  for (const l of lines ?? []) {
    if (l?.counted !== true) continue;
    const cur = at(l.group);
    if (!cur) continue;
    cur.linesSen += Math.round(Number(l.valueSen) || 0);
    cur.countedLines += 1;
  }
  const rows: StockTakeCheckRow[] = [...byKey.values()]
    .map((x) => {
      const linesSen = x.countedLines > 0 ? x.linesSen : null;
      const diffSen = linesSen === null ? null : linesSen - (x.storedSen ?? 0);
      const mismatch = linesSen !== null && isStockTakeMismatch(x.storedSen ?? 0, linesSen);
      return { group: x.group, storedSen: x.storedSen, linesSen, countedLines: x.countedLines, diffSen, mismatch };
    })
    .sort((a, b) => a.group.localeCompare(b.group));
  return {
    ym,
    hasLines: lines !== null,
    linesFile: record && typeof record.file === "string" && record.file ? record.file : null,
    linesSavedAt: record && typeof record.savedAt === "string" && record.savedAt ? record.savedAt : null,
    rows,
  };
}
