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
