// ---------------------------------------------------------------------------
// The actual purchases the Forecast P&L page shows under each material (owner
// 2026-11-11 「我要看到actual 的categories 的actual 那个月的purchase total罢了，
// 主要是让我有一个refer to fill forecast P&L 的数额」 → 「同时原有的forecast P&L
// 输入界面也要做成一样」). Read from the Monthly P&L's own month windows (GET
// /api/accounting/pl-monthly …&edit=1), each stock group filed under its
// material type exactly as the Monthly P&L files it (rmTypeOf). Pure; tests:
// tests/forecast-actual-purchases.test.mjs.
// ---------------------------------------------------------------------------
import { rmTypeOf } from "./pnl-forecast";
import type { PnlWindowLike } from "./pnl-matrix";

export type MonthActualPurchases = { salesSen: number; byType: Record<string, number> };

/** Each month window's net sales and its purchases by material type. Only
 *  "YYYY-MM" keys are months (the response also carries `acc`). */
export function actualPurchasesByMonth(windows: Record<string, PnlWindowLike | undefined>): Record<string, MonthActualPurchases> {
  const out: Record<string, MonthActualPurchases> = {};
  for (const [key, w] of Object.entries(windows)) {
    if (!/^\d{4}-\d{2}$/.test(key) || !w) continue;
    const byType: Record<string, number> = {};
    for (const g of w.rmGroups ?? []) {
      const t = rmTypeOf(g);
      byType[t] = (byType[t] ?? 0) + (g.purchasesSen ?? 0);
    }
    out[key] = { salesSen: w.netSalesSen ?? 0, byType };
  }
  return out;
}

/** One type's purchases over the months given that have actuals, with those
 *  months' net sales (for the %) and how many there were. */
export function sumActualPurchases(by: Record<string, MonthActualPurchases>, yms: readonly string[], type: string): { sen: number; salesSen: number; months: number } {
  let sen = 0;
  let salesSen = 0;
  let months = 0;
  for (const ym of yms) {
    const m = by[ym];
    if (!m) continue;
    sen += m.byType[type] ?? 0;
    salesSen += m.salesSen;
    months++;
  }
  return { sen, salesSen, months };
}

/** The next month to ask the Monthly P&L for (one answer covers that month's
 *  whole financial year): this month first, then the newest month on the
 *  sheet, up to this month, that still has no actuals and was not asked for.
 *  Null when nothing is left. A sheet month in an earlier financial year (prod
 *  2026-11-11: FY 2026/27 starts in September, the sheet starts in August)
 *  costs one more request; a month the books have nothing for is asked once. */
export function nextActualsAnchor(sheetYms: readonly string[], curYm: string, got: Readonly<Record<string, unknown>>, tried: ReadonlySet<string>): string | null {
  const want = [...new Set([curYm, ...sheetYms.filter((ym) => ym <= curYm)])];
  const missing = want.filter((ym) => !got[ym] && !tried.has(ym)).sort().reverse();
  return missing[0] ?? null;
}
