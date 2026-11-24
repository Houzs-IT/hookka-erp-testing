// ---------------------------------------------------------------------------
// dashboard-forecast.ts (pure) — the Financial Dashboard's Cash Flow and
// Balance Sheet cards with their forecasts (owner 2026-11-23 「dashboard那边的
// balance sheet 和 cash flow 可以显示forecast的相对应数据」, 「不可以都显示吗？」
// → 「Build it」):
//   • Cash Flow: both Cash Flow forecasts — the P&L forecast (fp:, the
//     Forecast P&L as cash) and the Docs forecast (fc:, the documents open at
//     the 1st by their terms) — read off the statement with the card's own
//     split (cashFlowCardMonth), so a forecast figure is one the Cash Flow
//     page prints;
//   • Balance Sheet: the Forecast Balance Sheet's month-ends (forecastBsView
//     on last month-end's sheet), totalled as the card totals the actual sheet;
//   • the periods after the last one that has happened, as far as a forecast
//     reaches, shown with the forecast only.
// ---------------------------------------------------------------------------
import { cashFlowCardMonth, freeCashFlow, type CfStatementRow } from "./cashflow-card";
import { forecastBsView, type BsForecastPayload } from "./forecast-bs";
import type { BsMonthEntry } from "./bs-monthly";
import { SECTION_LABELS, SECTION_ORDER } from "./cashflow-engine";

export type DashCashFigures = { operating: number; investing: number; financing: number; net: number; freeCashFlow: number };
export type DashCashForecast = Record<string, { pnl?: DashCashFigures; docs?: DashCashFigures }>;
export type DashBsFigures = {
  assets: number; liabilities: number; debtPct: number | null;
  // For the forecast ratios (owner 2026-11-24): split the same way the
  // dashboard route splits an actual month-end (sections; 330-x = stock).
  currentAssets?: number; currentLiabilities?: number; inventory?: number; equity?: number;
};

/** Each month's two Cash Flow forecasts, from the statement's fp: / fc: columns. */
export function dashCashForecast(cf: { columns: readonly { key: string }[]; rows: readonly CfStatementRow[] }): DashCashForecast {
  const out: DashCashForecast = {};
  cf.columns.forEach((c, idx) => {
    const m = /^(fp|fc):(\d{4}-\d{2})$/.exec(c.key);
    if (!m) return;
    const f = cashFlowCardMonth(cf.rows, idx);
    const fig = { ...f, freeCashFlow: freeCashFlow(f) };
    (out[m[2]] ??= {})[m[1] === "fp" ? "pnl" : "docs"] = fig;
  });
  return out;
}

const isAsset = (category: string) => category === "FIXED_ASSET" || category === "CURRENT_ASSET";
const isLiability = (category: string) => category === "CURRENT_LIABILITY" || category === "LONG_TERM_LIABILITY";
const debtPctOf = (assets: number, liabilities: number): number | null =>
  assets > 0 ? Math.round((liabilities / assets) * 10000) / 100 : null;

/** A sheet's totals as the card adds them up: assets, liabilities, debt to assets. */
export function bsTotals(entries: readonly BsMonthEntry[]): DashBsFigures {
  let assets = 0;
  let liabilities = 0;
  let currentAssets = 0;
  let currentLiabilities = 0;
  let inventory = 0;
  for (const e of entries) {
    if (isAsset(e.category)) {
      assets += e.balance;
      if (e.category === "CURRENT_ASSET") currentAssets += e.balance;
      if (/^33\d/.test(e.accountCode)) inventory += e.balance;
    } else if (isLiability(e.category)) {
      liabilities += e.balance;
      if (e.category === "CURRENT_LIABILITY") currentLiabilities += e.balance;
    }
  }
  return { assets, liabilities, debtPct: debtPctOf(assets, liabilities), currentAssets, currentLiabilities, inventory, equity: assets - liabilities };
}

/** Each forecast month-end's totals, from last month-end's sheet (`opening`). */
export function dashBsForecast(fc: BsForecastPayload, opening: readonly BsMonthEntry[]): Record<string, DashBsFigures> {
  const view = forecastBsView(fc, opening);
  const out: Record<string, DashBsFigures> = {};
  for (const ym of fc.months) if (view.sheets[ym]) out[ym] = bsTotals(view.sheets[ym]);
  return out;
}

/** The dashboard's period key for a month: "YYYY-MM", or "YYYY-Qn" by calendar quarter. */
export function dashBucketOf(ym: string, granularity: "month" | "quarter"): string {
  if (granularity === "month") return ym;
  return `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;
}

/** The Cash Flow forecasts by period: a quarter adds up its months. */
export function cashForecastByBucket(fc: DashCashForecast, granularity: "month" | "quarter"): DashCashForecast {
  const out: DashCashForecast = {};
  const add = (a: DashCashFigures | undefined, b: DashCashFigures): DashCashFigures => (a
    ? { operating: a.operating + b.operating, investing: a.investing + b.investing, financing: a.financing + b.financing, net: a.net + b.net, freeCashFlow: a.freeCashFlow + b.freeCashFlow }
    : { ...b });
  for (const ym of Object.keys(fc).sort()) {
    const k = dashBucketOf(ym, granularity);
    const cur = (out[k] ??= {});
    if (fc[ym].pnl) cur.pnl = add(cur.pnl, fc[ym].pnl!);
    if (fc[ym].docs) cur.docs = add(cur.docs, fc[ym].docs!);
  }
  return out;
}

/** The Forecast Balance Sheet by period: a quarter reads its last month-end forecast. */
export function bsForecastByBucket(fc: Record<string, DashBsFigures>, granularity: "month" | "quarter"): Record<string, DashBsFigures> {
  const out: Record<string, DashBsFigures> = {};
  for (const ym of Object.keys(fc).sort()) out[dashBucketOf(ym, granularity)] = fc[ym];
  return out;
}

/** The periods after the last one shown, as far as a forecast reaches: the
 *  rows that have not happened yet whose key a forecast covers, in order. */
export function dashAheadRows<T extends { key: string; actual: unknown }>(rows: readonly T[], shown: readonly T[], forecastKeys: ReadonlySet<string>): T[] {
  const last = shown[shown.length - 1];
  const from = last ? rows.indexOf(last) + 1 : 0;
  const out: T[] = [];
  for (const r of rows.slice(from)) {
    if (r.actual !== null && r.actual !== undefined) continue;
    if (!forecastKeys.has(r.key)) break;
    out.push(r);
  }
  return out;
}

// ---- Cash Flow Detail: Actual | Forecast per period (owner 2026-11-23,
// 「这个detail可以整理一下吗？然后detail看没有forecast？还是你这样的table？」 →
// 「Actual + Forecast」) -------------------------------------------------------

/** "<SECTION>||<label>" → sen, per month and kind: the statement's own LINE
 *  rows of each fp: / fc: column (the key the card's actual lines use). */
export type DashCashLines = Record<string, { pnl?: Record<string, number>; docs?: Record<string, number> }>;

export function dashCashForecastLines(cf: { columns: readonly { key: string }[]; rows: readonly CfStatementRow[] }): DashCashLines {
  const out: DashCashLines = {};
  cf.columns.forEach((c, idx) => {
    const m = /^(fp|fc):(\d{4}-\d{2})$/.exec(c.key);
    if (!m) return;
    const lines: Record<string, number> = {};
    for (const r of cf.rows) {
      if (r.kind !== "line" || !r.section) continue;
      const v = Number(r.values[idx]) || 0;
      if (!v) continue;
      const k = `${r.section}||${r.label}`;
      lines[k] = (lines[k] ?? 0) + v;
    }
    (out[m[2]] ??= {})[m[1] === "fp" ? "pnl" : "docs"] = lines;
  });
  return out;
}

/** The lines by period: a quarter adds up its months. */
export function cashLinesByBucket(fc: DashCashLines, granularity: "month" | "quarter"): DashCashLines {
  const out: DashCashLines = {};
  const add = (into: Record<string, number> | undefined, from: Record<string, number>) => {
    const o = { ...(into ?? {}) };
    for (const [k, v] of Object.entries(from)) o[k] = (o[k] ?? 0) + v;
    return o;
  };
  for (const ym of Object.keys(fc).sort()) {
    const k = dashBucketOf(ym, granularity);
    const cur = (out[k] ??= {});
    if (fc[ym].pnl) cur.pnl = add(cur.pnl, fc[ym].pnl!);
    if (fc[ym].docs) cur.docs = add(cur.docs, fc[ym].docs!);
  }
  return out;
}

export type DetailCell = { actual: number | null; forecast: number | null };
export type DetailLine = { key: string; label: string; cells: DetailCell[] };
export type DetailGroup = { id: string; label: string; totals: DetailCell[]; lines: DetailLine[] };
export type DetailSection = { section: string; label: string; totals: DetailCell[]; groups: DetailGroup[]; lines: DetailLine[] };

/** The statement's own sub-groups (owner 2026-11-23 「这里很杂乱，可以整理一下
 *  吗？」, the Raw Materials lines): each LINE row's group under its section —
 *  "RAW_MATERIALS>701-0000" PURCHASE - FABRIC and so on — keyed as the lines.
 *  The actuals (item-group codes, B.M-FABR), the P&L forecast (material
 *  types, FABRIC) and the Docs forecast (opening creditors per supplier) name
 *  their lines differently but roll up into the same group, so a group's
 *  Actual and Forecast are comparable where its lines are not. */
export type DashLineGroups = Record<string, { id: string; label: string }>;
export function dashCashLineGroups(cf: { rows: readonly (CfStatementRow & { groupId?: string; depth?: number })[] }): DashLineGroups {
  const groupLabel = new Map<string, string>();
  for (const r of cf.rows) if (r.kind === "group" && r.groupId && r.groupId.includes(">")) groupLabel.set(r.groupId, r.label);
  const out: DashLineGroups = {};
  for (const r of cf.rows) {
    if (r.kind !== "line" || !r.section || !r.groupId || !groupLabel.has(r.groupId)) continue;
    out[`${r.section}||${r.label}`] = { id: r.groupId, label: groupLabel.get(r.groupId)! };
  }
  return out;
}

// Within a group: the lines the actuals carry first, then the forecast's own,
// then the per-party catch-alls (opening creditors, unallocated, overdue).
const lineRank = (l: DetailLine): number => {
  if (/^(Opening creditors|Unallocated) —|^Overdue \(past term\)$/.test(l.label)) return 2;
  return l.cells.some((c) => c.actual) ? 0 : 1;
};
const byRankThenLabel = (a: DetailLine, b: DetailLine) => lineRank(a) - lineRank(b) || a.label.localeCompare(b.label);

/** The Detail table: each section in the statement's order (unknown sections
 *  after, by name); under it the statement's own groups where it has them
 *  (each with its lines), else its lines; every period an Actual and a
 *  Forecast cell. A period ahead has no actual (null); a period the forecast
 *  does not reach has no forecast (null). A line with nothing anywhere goes. */
export function cashDetailSections(
  periods: readonly { actual: readonly { section: string; label: string; value: number }[] | null; forecast: Record<string, number> | null }[],
  groupsOf: DashLineGroups = {},
): DetailSection[] {
  const keys = new Map<string, { section: string; label: string }>();
  for (const p of periods) {
    for (const l of p.actual ?? []) keys.set(`${l.section}||${l.label}`, { section: l.section, label: l.label });
    for (const k of Object.keys(p.forecast ?? {})) {
      const [section, ...rest] = k.split("||");
      keys.set(k, { section, label: rest.join("||") });
    }
  }
  const rank = (s: string) => {
    const i = (SECTION_ORDER as readonly string[]).indexOf(s);
    return i < 0 ? SECTION_ORDER.length : i;
  };
  const sum = (lines: readonly DetailLine[]) => periods.map((p, i): DetailCell => ({
    actual: p.actual ? lines.reduce((t, l) => t + (l.cells[i].actual ?? 0), 0) : null,
    forecast: p.forecast ? lines.reduce((t, l) => t + (l.cells[i].forecast ?? 0), 0) : null,
  }));
  const bySection = new Map<string, DetailLine[]>();
  for (const [key, meta] of keys) {
    const cells = periods.map((p): DetailCell => ({
      actual: p.actual ? p.actual.filter((l) => `${l.section}||${l.label}` === key).reduce((t, l) => t + l.value, 0) : null,
      forecast: p.forecast ? p.forecast[key] ?? 0 : null,
    }));
    if (cells.every((c) => !c.actual && !c.forecast)) continue;
    bySection.set(meta.section, [...(bySection.get(meta.section) ?? []), { key, label: meta.label, cells }]);
  }
  return [...bySection.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([section, lines]) => {
      // Group the lines by the statement's own groups when the section has
      // any; a line the statement does not place goes under "Other".
      const grouped = lines.some((l) => groupsOf[l.key]);
      const groups: DetailGroup[] = [];
      if (grouped) {
        const byGroup = new Map<string, { label: string; lines: DetailLine[] }>();
        for (const l of lines) {
          const g = groupsOf[l.key] ?? { id: `${section}>other`, label: "Other" };
          const cur = byGroup.get(g.id) ?? { label: g.label, lines: [] };
          cur.lines.push(l);
          byGroup.set(g.id, cur);
        }
        for (const [id, g] of [...byGroup.entries()].sort((a, b) => (a[0].endsWith(">other") ? 1 : 0) - (b[0].endsWith(">other") ? 1 : 0) || a[0].localeCompare(b[0]))) {
          groups.push({ id, label: g.label, lines: g.lines.sort(byRankThenLabel), totals: sum(g.lines) });
        }
      }
      return {
        section,
        label: (SECTION_LABELS as Record<string, string>)[section]?.toUpperCase() ?? section.replace(/_/g, " "),
        lines: lines.sort(byRankThenLabel),
        groups,
        totals: sum(lines),
      };
    });
}

/** A period's ratios from the Forecast P&L and the Forecast Balance Sheet —
 *  the same formulas the dashboard route uses for an actual period. */
export function dashForecastRatios(
  pl: { sales: number; gross: number; net: number } | null | undefined,
  bs: DashBsFigures | null | undefined,
): Record<"grossMarginPct" | "netMarginPct" | "currentRatio" | "quickRatio" | "roePct" | "roaPct", number | null> {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : null);
  const cl = bs?.currentLiabilities ?? 0;
  const eq = bs?.equity ?? 0;
  return {
    grossMarginPct: pl ? pct(pl.gross, pl.sales) : null,
    netMarginPct: pl ? pct(pl.net, pl.sales) : null,
    currentRatio: bs && cl > 0 && bs.currentAssets !== undefined ? r2(bs.currentAssets / cl) : null,
    quickRatio: bs && cl > 0 && bs.currentAssets !== undefined ? r2((bs.currentAssets - (bs.inventory ?? 0)) / cl) : null,
    roePct: bs && pl && eq > 0 ? pct(pl.net, eq) : null,
    roaPct: bs && pl && bs.assets > 0 ? pct(pl.net, bs.assets) : null,
  };
}
