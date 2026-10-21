// ---------------------------------------------------------------------------
// finance-dashboard-calc.ts — the figures behind the Financial Dashboard's
// salary and cost-structure cards, shared by the desktop page
// (src/pages/finance-dashboard.tsx) and the phone (src/pages/m/screens/finance/
// DashScreen.tsx, owner 2026-10-19 「要」: the phone gets the five sections it
// was missing) so both show the same numbers. Moved here from the desktop
// page's closures unchanged. Money in sen; percentages rounded to 2 dp.
// ---------------------------------------------------------------------------

export type DashCsCat = { name: string; line: "bedframe" | "sofa" | "shared"; spend: number; purchase: number; closing: number };
export type DashSalaryDept = { dept: string; costSen: number; forecastSen?: number; nonProd?: boolean };

/** The parts of a dashboard row these figures read (a structural subset of /api/accounting/dashboard's row). */
export type DashCalcRow = {
  actual: { sales: number; labour: number } | null;
  forecast: { sales: number; labour: number } | null;
  costStructure?: { salesSplit: { bedframe: number; sofa: number }; forecast?: Record<string, number>; categories: DashCsCat[] };
  productionRevenue?: { bedframe: number; sofa: number; accessory: number; total: number } | null;
  salaryByDept?: DashSalaryDept[];
};

export type CsMeasure = "spend" | "purchase" | "closing";
export type CsLine = "all" | "bedframe" | "sofa";

/** v as a percentage of base, 2 dp; null when either side is missing or the base is 0. */
export const pctOf = (v: number | null, base: number | null): number | null =>
  v !== null && base !== null && base !== 0 ? Math.round((v / base) * 10000) / 100 : null;

/** Every material category on any row, sorted. */
export function csCategories(rows: readonly DashCalcRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const cc of r.costStructure?.categories ?? []) set.add(cc.name);
  return [...set].sort();
}

/** A category can exist on more than one line (B.M FABRIC and S FABRIC are both
 *  FABRIC) — every matching entry under the line view; a shared material is
 *  apportioned to a line by that period's share of sales. */
export function csAmount(r: DashCalcRow, cat: string, measure: CsMeasure, line: CsLine): number {
  const s = r.costStructure?.salesSplit;
  const tot = (s?.bedframe ?? 0) + (s?.sofa ?? 0);
  let out = 0;
  for (const cc of r.costStructure?.categories ?? []) {
    if (cc.name !== cat) continue;
    const raw = cc[measure];
    if (line === "all" || cc.line === line) out += raw;
    else if (cc.line === "shared" && tot > 0) {
      out += Math.round(raw * ((line === "bedframe" ? s!.bedframe : s!.sofa) / tot));
    }
  }
  return out;
}

/** Production revenue for the line view; Sofa takes the accessories too — the
 *  same split as the sales side. */
export function csLineProdRev(r: DashCalcRow, line: CsLine): number | null {
  const p = r.productionRevenue;
  if (!p) return null;
  return line === "all" ? p.total : line === "bedframe" ? p.bedframe : p.sofa + p.accessory;
}

/** Sales for the line view (the whole row's sales when no split is sent). */
export function csLineSales(r: DashCalcRow, line: CsLine): number {
  const s = r.costStructure?.salesSplit;
  if (!s) return r.actual?.sales ?? 0;
  return line === "all" ? s.bedframe + s.sofa : line === "bedframe" ? s.bedframe : s.sofa;
}

/** The FORECAST revenue a forecast percentage divides by (owner 2026-08-06),
 *  pro-rated to a line by the actual split. */
export function csForecastSales(r: DashCalcRow, line: CsLine): number | null {
  const fs = r.forecast?.sales ?? null;
  if (fs === null) return null;
  if (line === "all") return fs;
  const s = r.costStructure?.salesSplit;
  const tot = s ? s.bedframe + s.sofa : 0;
  if (!s || tot <= 0) return null;
  return Math.round(fs * ((line === "bedframe" ? s.bedframe : s.sofa) / tot));
}

/** A category's forecast for the line view — keyed whole-company, pro-rated by the line's sales share. */
export function csForecastAmt(r: DashCalcRow, cat: string, line: CsLine): number | null {
  const f = r.costStructure?.forecast?.[cat];
  if (f === undefined) return null;
  if (line === "all") return f;
  const s = r.costStructure!.salesSplit;
  const tot = s.bedframe + s.sofa;
  if (tot <= 0) return null;
  return Math.round(f * ((line === "bedframe" ? s.bedframe : s.sofa) / tot));
}

/** The salary cards' departments: production and non-production, by the master's flag (any row flagging it non-production). */
export function salaryDeptSplit(rows: readonly DashCalcRow[]): { prod: string[]; non: string[] } {
  const flags = new Map<string, boolean>();
  for (const r of rows) for (const d of r.salaryByDept ?? []) flags.set(d.dept, (flags.get(d.dept) ?? false) || !!d.nonProd);
  const all = [...flags.keys()].sort();
  return { prod: all.filter((d) => !flags.get(d)), non: all.filter((d) => flags.get(d)) };
}

/**
 * One salary card's month: each of ITS departments (a zero cost / forecast
 * reads as none), the card total and its forecast — the departments' sums;
 * where the month has no department figure at all, the fallback (the
 * production card passes the P&L labour bucket; the non-production card
 * passes none, so it shows "-", never borrowed figures).
 */
export function salaryCardMonth(
  r: DashCalcRow,
  depts: readonly string[],
  fallback: { amount: number | null; forecast: number | null } | null,
): { amount: number | null; forecast: number | null; byDept: { dept: string; amount: number | null; forecast: number | null }[] } {
  const cost = new Map<string, number>();
  const fc = new Map<string, number>();
  for (const d of r.salaryByDept ?? []) {
    if (d.costSen !== 0) cost.set(d.dept, d.costSen);
    const f = d.forecastSen ?? 0;
    if (f !== 0) fc.set(d.dept, f);
  }
  let amt: number | null = null;
  let fcs: number | null = null;
  const byDept: { dept: string; amount: number | null; forecast: number | null }[] = [];
  for (const dept of depts) {
    const a = cost.get(dept) ?? null;
    const f = fc.get(dept) ?? null;
    if (a !== null) amt = (amt ?? 0) + a;
    if (f !== null) fcs = (fcs ?? 0) + f;
    byDept.push({ dept, amount: a, forecast: f });
  }
  const none = amt === null && fcs === null;
  return { amount: none ? (fallback?.amount ?? null) : amt, forecast: none ? (fallback?.forecast ?? null) : fcs, byDept };
}
