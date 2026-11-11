// ---------------------------------------------------------------------------
// pl-forecast-edit.ts — what a Monthly P&L row keys when the forecast is
// edited in place (owner 2026-11-10 「我想要A」; spec docs/superpowers/specs/
// 2026-11-10-monthly-pl-forecast-edit-design.md section 3). Pure; tests:
// tests/monthly-pl-forecast-edit.test.mjs.
// ---------------------------------------------------------------------------
import type { FcAccount, FcLineGroups } from "./forecast-pnl";
import type { PnlMatrixRow } from "./pnl-matrix";

/** Every line the Forecast P&L keys, in one list. */
export function forecastLines(g: FcLineGroups): FcAccount[] {
  return [
    ...g.materials, ...g.direct, ...g.labour, ...g.labourOvhDepts, ...g.labourExpDepts,
    ...g.labourAccounts, ...g.overhead, ...g.otherIncome, ...g.expenses,
  ];
}

/** What a row keys in a forecast month column: "sales", a material
 *  ("cat:<TYPE>"), carriage or SST, an account the Forecast P&L lists, or a
 *  department with no posting account (its own line); null for a row with
 *  nothing to key (stock lines, revenue accounts, lines the forecast does not
 *  list). */
export function plEditKey(row: Pick<PnlMatrixRow, "fcKey">, g: FcLineGroups): string | null {
  const k = row.fcKey;
  if (!k) return null;
  if (k === "sales") return k;
  return forecastLines(g).some((a) => a.code === k) ? k : null;
}

/** The department rows whose wages post to `code` (the labour map): what ▸
 *  opens under that account line. A department's forecast sits on that line,
 *  as the Monthly P&L forecast lays it (forecastPnlWindow). */
export function deptsPostingTo(code: string, g: FcLineGroups, deptAccount: (dept: string) => string | null): FcAccount[] {
  return [...g.labour, ...g.labourOvhDepts, ...g.labourExpDepts].filter((d) => deptAccount(d.name) === code);
}

/** A past month's Forecast column (owner 2026-11-10 「我也要一个按钮和cash flow
 *  一样，hide 已经过了的month」): what Hide past months takes away. Its Actual,
 *  the Accumulated columns, this month and the months ahead stay — as on
 *  Cash Flow (pastForecastCol). */
export function plPastForecastCol(c: { forecast?: boolean; accum: boolean; ym?: string }, curYm: string): boolean {
  return !!c.forecast && !c.accum && !!c.ym && c.ym < curYm;
}

/** A row with no figure in any column: what Hide unused takes away (owner
 *  2026-11-10 「点开全部和收起没用到的」). */
export function plRowUnused(row: { values: readonly number[] }): boolean {
  return row.values.every((v) => !v);
}

/** Edit forecast with the stock detail folded (owner 2026-11-11 「我要看到actual
 *  的categories 的actual 那个月的purchase total罢了」): everything under a
 *  material TYPE row — its stock groups with their opening / purchase / closing
 *  lines — and the type's own total line goes; the type row shows the month's
 *  purchases instead (PnlMatrixRow.purchaseValues). Everything else stays, in
 *  order. `items` is foldStatementRows' output. */
export function foldMaterialDetail<T extends { row: { kind: string; fcKey?: string }; close?: boolean }>(items: readonly T[]): T[] {
  const out: T[] = [];
  let inside: T["row"] | null = null;
  for (const it of items) {
    if (inside) {
      if (it.close && it.row === inside) inside = null;
      continue;
    }
    out.push(it);
    if (!it.close && it.row.kind === "group" && it.row.fcKey?.startsWith("cat:")) inside = it.row;
  }
  return out;
}
