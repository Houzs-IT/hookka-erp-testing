// ---------------------------------------------------------------------------
// board-report.ts — the monthly Board Report's shaping, pure.
//
// Owner 2026-11-10: "every figure from live ERP data; nobody should have to ask
// Claude each month". GET /api/reports/board (src/api/routes/reports.ts) reads
// the ERP's own report endpoints in-process (src/api/lib/board-report-sources.ts)
// and hands their payloads here; this file only PICKS and ARRANGES figures —
// it never re-derives a P&L, a balance sheet or a cash flow. Every number on
// the page traces to one of those endpoints:
//
//   dashboard     GET /api/accounting/dashboard?granularity=month&from=&to=
//   plMonthly     GET /api/accounting/pl-monthly?anchor=M        (appendix A)
//   plCur/plPrev  GET /api/accounting/pl?period=M / M-1          (appendix B, flags)
//   cashflow      GET /api/accounting/cashflow-statement?period=M (bank month-end, appendix C)
//   cashForecast  GET /api/accounting/cashflow-forecast?period=running month
//   overview      GET /api/dashboard/overview?period=M           (customers)
//   revSplit*     GET /api/dashboard/overview/revenue-split?period=M / M-1
//   newModels     GET /api/products/new-models?from=&to=          (last 3 months)
//   defects       defectRates() over buildServiceSlice()          (service cases)
//   workforce     collectOperationsReport().workforce             (workers:read only)
//
// Money is integer sen throughout; percentages are numbers (2 dp) or null when
// the base is missing / zero — never a fabricated 0.
// ---------------------------------------------------------------------------

// ── month helpers ─────────────────────────────────────────────────────────
export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
/** "Oct 26" */
export const shortMonth = (ym: string): string => `${MONTHS[parseInt(ym.slice(5, 7), 10) - 1] ?? "?"} ${ym.slice(2, 4)}`;
/** "October 2026" */
export const longMonth = (ym: string): string => `${MONTHS_LONG[parseInt(ym.slice(5, 7), 10) - 1] ?? "?"} ${ym.slice(0, 4)}`;
/** The last closed month = the month before today's (Malaysia) month. */
export const lastClosedMonth = (todayYmd: string): string => addMonths(todayYmd.slice(0, 7), -1);
/** Last day of a month as YYYY-MM-DD. */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
/** The month a report request is for: `?month=` when valid and not in the future, else the last closed month. */
export function resolveBoardMonth(q: string | null | undefined, todayYmd: string): string {
  const cur = todayYmd.slice(0, 7);
  if (q && YM_RE.test(q) && q <= cur) return q;
  return lastClosedMonth(todayYmd);
}
/** The windows every source is asked for. */
export function boardWindows(month: string, todayYmd: string) {
  const running = todayYmd.slice(0, 7);
  const ahead = running > month ? running : month;
  return {
    month,
    prev: addMonths(month, -1),
    quarterAgo: addMonths(month, -3),
    running,
    dashFrom: addMonths(month, -11),
    // Forecast reach: the running month plus three, at least M + 3.
    dashTo: addMonths(ahead, 3),
    newModelsFrom: `${addMonths(month, -2)}-01`,
    newModelsTo: monthEnd(month),
  };
}

// ── maths helpers ─────────────────────────────────────────────────────────
export const pct = (v: number | null | undefined, base: number | null | undefined): number | null =>
  v === null || v === undefined || base === null || base === undefined || base === 0 ? null : Math.round((v / base) * 10000) / 100;
/** Change of a over b in %, against |b|. */
export const changePct = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined || b === null || b === undefined || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 10000) / 100;
const sum = (xs: readonly number[]) => xs.reduce((t, x) => t + x, 0);

/**
 * Cap a growing list so a page cannot overflow: keep the first `max - 1`
 * rows and fold the rest into one "Other (n more)" row made by `merge`.
 * A list that already fits is returned unchanged.
 */
export function capRows<T>(rows: readonly T[], max: number, merge: (rest: T[], label: string) => T): T[] {
  if (rows.length <= max) return [...rows];
  const keep = rows.slice(0, Math.max(0, max - 1));
  const rest = rows.slice(Math.max(0, max - 1));
  return [...keep, merge(rest, `Other (${rest.length} more)`)];
}

// ── source shapes (structural subsets of each endpoint's payload) ─────────
export type Src<T> = { ok: true; data: T } | { ok: false; error: string };

export type DashSlice = {
  sales: number; cogs: number; gross: number; otherIncome: number; expenses: number; net: number;
  materials: number; labour: number; overhead: number; stockMovement: number;
  staffCost: number; otherOpex: number; estimated?: number;
};
export type DashBs = { assets: number; liabilities: number; equity: number; currentAssets: number; currentLiabilities: number; inventory: number };
export type DashRow = {
  key: string;
  label?: string;
  partial: boolean;
  actual: DashSlice | null;
  forecast: DashSlice | null;
  labourBase?: { headcount: number | null; unitsCompleted: number | null };
  salaryByDept?: { dept: string; costSen: number; forecastSen?: number; nonProd?: boolean }[];
  productionRevenue?: { bedframe: number; sofa: number; accessory: number; total: number } | null;
  costStructure?: {
    salesSplit: { bedframe: number; sofa: number };
    forecast?: Record<string, number>;
    categories: { name: string; line: string; spend: number; purchase: number; closing: number }[];
  };
  cashFlow?: { operating: number; investing: number; financing: number; net: number; freeCashFlow: number };
  balanceSheet: DashBs | null;
  ratios?: {
    grossMarginPct: number | null; netMarginPct: number | null; currentRatio: number | null; quickRatio: number | null;
    debtToAssetPct: number | null; roePct: number | null; roaPct: number | null;
  };
};
export type DashPayload = { openingDate?: string | null; rows: DashRow[] };

export type MatrixCol = { key: string; label: string; accum?: boolean; ym?: string; forecast?: boolean; forecastKind?: string; future?: boolean; blank?: boolean };
export type PlMatrixRow = { kind: string; depth: number; label: string; values: number[] };
export type PlMonthlyPayload = { fyLabel?: string; columns: MatrixCol[]; rows: PlMatrixRow[] };
export type CfRowLite = { kind: string; depth: number; label: string; values: (number | null)[] };
export type CfPayload = { columns: MatrixCol[]; rows: CfRowLite[]; today?: string };
export type BsLine = { accountCode: string; accountName: string; category: string; balance: number };
export type PlPayload = { totals?: { netProfit?: number; revenue?: number }; balanceSheet?: BsLine[]; sheetStock?: { month: string; totalSen: number } | null; sheetStockError?: string | null };
export type AovRow = { customerName: string; bedframeAvgSen: number; bedframeUnits: number; sofaAvgSen: number; sofaSets: number; totalSen: number };
export type Concentration = { totalSen: number; customerCount: number; largestName: string | null; largestPct: number | null; largestSen: number; top10Pct: number | null; top10Sen: number };
export type OverviewPayload = {
  aovByCustomer?: AovRow[];
  aovCompany?: Omit<AovRow, "customerName">;
  customerConcentration?: { all: Concentration; bedframe?: Concentration; sofa?: Concentration; shownCount?: number };
};
export type CatSplit = { bedframe: number; sofa: number; accessory: number; unclassified: number; total: number };
export type RevSplitPayload = { departments?: { code: string; label: string; period: CatSplit }[] };
export type NewModelLite = { code: string; category: string; name: string; added: string; skus: number; sizes: string; price: string; price2: string; hasPhoto: boolean; photo: string | null };
export type NewModelsPayload = { from: string; to: string; models: NewModelLite[]; priceNote?: string; pricesIncluded?: boolean; undatedProducts?: number };
export type DefectRow = { category: string; cases: number; units: number; rate: number | null };
export type DefectsPayload = { month: DefectRow[]; prev: DefectRow[]; trend: { ym: string; cases: number; units: number; rate: number | null }[] };
export type WorkforcePayload = { activeWorkers: number | null; topEfficiency: { name: string; pct: number }[]; bottomEfficiency: { name: string; pct: number }[] };
export type BoardNotes = { text: string; updatedAt: string | null; updatedBy: string | null };

export type BoardSources = {
  dashboard: Src<DashPayload>;
  plMonthly: Src<PlMonthlyPayload>;
  plCur: Src<PlPayload>;
  plPrev: Src<PlPayload>;
  cashflow: Src<CfPayload>;
  cashForecast: Src<CfPayload>;
  overview: Src<OverviewPayload>;
  revSplitCur: Src<RevSplitPayload>;
  revSplitPrev: Src<RevSplitPayload>;
  newModels: Src<NewModelsPayload>;
  defects: Src<DefectsPayload>;
  workforce: Src<WorkforcePayload>;
  notes: BoardNotes;
};

// ── output shapes ─────────────────────────────────────────────────────────
export type Tile = { label: string; value: number | null; prev: number | null; forecast: number | null; note?: string };
export type PlLineKey = "sales" | "cogs" | "materials" | "labour" | "overhead" | "stockMovement" | "gross" | "otherIncome" | "expenses" | "staffCost" | "otherOpex" | "net";
export type IncomeRow = { key: PlLineKey; label: string; depth: 0 | 1; strong: boolean; actual: number | null; forecast: number | null; prev: number | null; since: number | null; pctOfSales: number | null };
export type TrendPoint = { ym: string; label: string; kind: "actual" | "mtd" | "forecast"; sales: number | null; net: number | null; gross: number | null; forecastSales: number | null; forecastNet: number | null };
export type LabourDept = { dept: string; cost: number; prev: number | null; forecast: number | null; share: number | null; pctTotalProdRev: number | null; pctOwnProdRev: number | null; ownProdRev: number | null };
export type MaterialCat = { name: string; spend: number; purchase: number; closing: number; forecast: number | null; prev: number | null; pctOfSales: number | null };
export type BsRow = { label: string; strong: boolean; cur: number | null; prev: number | null; change: number | null; quarterAgo: number | null };
export type CashMonth = { ym: string; label: string; kind: "actual" | "mtd"; operating: number; investing: number; financing: number; net: number; fcf: number };
export type CashForecastMonth = { ym: string; label: string; actual: number | null; docs: number | null; pnl: number | null };
export type CustomerRow = { name: string; total: number; share: number | null; bedframeAvg: number | null; bedframeUnits: number; sofaAvg: number | null; sofaSets: number };
export type ProdDept = { code: string; label: string; total: number; prev: number | null; change: number | null };
export type OutlookMonth = { ym: string; label: string; mtd: DashSlice | null; forecast: DashSlice | null };
export type Flag = { level: "alert" | "check" | "info"; text: string };
export type TableBlock = { columns: string[]; rows: { label: string; depth: number; strong: boolean; values: (number | null)[] }[] };

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

export type BoardReport = {
  month: string;
  monthLabel: string;
  running: string;
  generatedAt: string;
  openingDate: string | null;
  cover: Section<{ tiles: Tile[]; trend: TrendPoint[]; highlights: string[] }>;
  income: Section<{ rows: IncomeRow[]; sinceLabel: string; costStructure: { label: string; value: number }[]; margins: { label: string; actual: number | null; forecast: number | null; prev: number | null }[]; estimated: number }>;
  labour: Section<{ depts: LabourDept[]; total: number; prevTotal: number | null; forecastTotal: number | null; productionRevenue: number | null; headcount: number | null; units: number | null; trend: { ym: string; label: string; byDept: Record<string, number>; total: number }[]; series: string[] }>;
  materials: Section<{ cats: MaterialCat[]; total: number; sales: number | null; trend: { ym: string; label: string; actual: number | null; forecast: number | null }[] }>;
  trend: Section<{ points: TrendPoint[]; summary: { label: string; kind: TrendPoint["kind"]; sales: number | null; gross: number | null; net: number | null; grossPct: number | null; netPct: number | null }[]; last3: { label: string; sales: number | null; fcSales: number | null; net: number | null; fcNet: number | null }[] }>;
  balance: Section<{ rows: BsRow[]; ratios: { label: string; cur: number | null; prev: number | null; unit: "x" | "%" }[]; equity: { opening: number | null; net: number | null; other: number | null; closing: number | null }; trend: { ym: string; label: string; assets: number; liabilities: number; equity: number }[] }>;
  cashFlow: Section<{ months: CashMonth[]; bankClose: number | null }>;
  cashForecast: Section<{ months: CashForecastMonth[]; asOf: string | null }>;
  customers: Section<{ rows: CustomerRow[]; concentration: Concentration | null; company: { bedframeAvg: number | null; bedframeUnits: number; sofaAvg: number | null; sofaSets: number; total: number } | null }>;
  newModels: Section<{ from: string; to: string; models: NewModelLite[]; more: string[]; priceNote: string; undated: number }>;
  operations: Section<{
    prodMix: ProdDept[]; prodTotal: number; categoryMix: { label: string; value: number }[];
    headcount: number | null; prevHeadcount: number | null; units: number | null; prevUnits: number | null;
    defects: DefectRow[] | null; defectTrend: DefectsPayload["trend"]; defectsError: string | null;
    workforce: WorkforcePayload | null; workforceNote: string | null;
    trend: { ym: string; label: string; bedframe: number; sofa: number; accessory: number }[];
  }>;
  outlook: Section<{ months: OutlookMonth[]; quarter: { label: string; rows: { label: string; kind: "actual" | "mtd" | "forecast"; sales: number | null; net: number | null }[]; sales: number | null; net: number | null } | null }>;
  notes: { flags: Flag[]; text: string; updatedAt: string | null; updatedBy: string | null };
  appendixPl: Section<TableBlock & { title: string }>;
  appendixBs: Section<TableBlock>;
  appendixCf: Section<TableBlock & { title: string }>;
};

// ── shaping ───────────────────────────────────────────────────────────────
const fail = <T,>(s: { ok: false; error: string }): Section<T> => ({ ok: false, error: s.error });

const rowAt = (rows: readonly DashRow[], ym: string) => rows.find((r) => r.key === ym) ?? null;
const slice = (rows: readonly DashRow[], ym: string, which: "actual" | "forecast") => rowAt(rows, ym)?.[which] ?? null;

const INCOME_LINES: { key: PlLineKey; label: string; depth: 0 | 1; strong: boolean }[] = [
  { key: "sales", label: "Revenue", depth: 0, strong: true },
  { key: "cogs", label: "Cost of goods sold", depth: 0, strong: false },
  { key: "materials", label: "Raw materials", depth: 1, strong: false },
  { key: "labour", label: "Direct labour", depth: 1, strong: false },
  { key: "overhead", label: "Factory overhead", depth: 1, strong: false },
  { key: "stockMovement", label: "Stock movement (WIP / FG)", depth: 1, strong: false },
  { key: "gross", label: "Gross profit", depth: 0, strong: true },
  { key: "otherIncome", label: "Other income", depth: 0, strong: false },
  { key: "expenses", label: "Operating expenses", depth: 0, strong: false },
  { key: "staffCost", label: "Staff cost", depth: 1, strong: false },
  { key: "otherOpex", label: "Other expenses", depth: 1, strong: false },
  { key: "net", label: "Net profit", depth: 0, strong: true },
];

/** Months of the window that have closed by M (actual figures), oldest first, from the first with any data. */
function closedMonths(rows: readonly DashRow[], month: string): DashRow[] {
  return rows.filter((r) => r.key <= month && r.actual !== null);
}

export function buildTrend(rows: readonly DashRow[], month: string, running: string): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const r of closedMonths(rows, month)) {
    out.push({ ym: r.key, label: shortMonth(r.key), kind: "actual", sales: r.actual!.sales, net: r.actual!.net, gross: r.actual!.gross, forecastSales: r.forecast?.sales ?? null, forecastNet: r.forecast?.net ?? null });
  }
  // Months after M up to the running month: month to date (the running month)
  // or a closed month later than the one being reported (an older report).
  for (let ym = addMonths(month, 1); ym <= running; ym = addMonths(ym, 1)) {
    const r = rowAt(rows, ym);
    if (!r) continue;
    out.push({ ym, label: shortMonth(ym), kind: ym === running ? "mtd" : "actual", sales: r.actual?.sales ?? null, net: r.actual?.net ?? null, gross: r.actual?.gross ?? null, forecastSales: r.forecast?.sales ?? null, forecastNet: r.forecast?.net ?? null });
  }
  const next = addMonths(running > month ? running : month, 1);
  const nr = rowAt(rows, next);
  if (nr?.forecast) out.push({ ym: next, label: shortMonth(next), kind: "forecast", sales: null, net: null, gross: null, forecastSales: nr.forecast.sales, forecastNet: nr.forecast.net });
  return out;
}

function shapeCover(d: DashPayload, month: string, running: string, cash: CfPayload | null, ov: OverviewPayload | null): BoardReport["cover"] {
  const a = slice(d.rows, month, "actual");
  if (!a) return { ok: false, error: `No actual figures for ${longMonth(month)} in the Financial Dashboard` };
  const p = slice(d.rows, addMonths(month, -1), "actual");
  const f = slice(d.rows, month, "forecast");
  const bank = cash ? bankCloseAt(cash, month) : null;
  const bankPrev = cash ? bankCloseAt(cash, addMonths(month, -1)) : null;
  const tiles: Tile[] = [
    { label: "Revenue", value: a.sales, prev: p?.sales ?? null, forecast: f?.sales ?? null },
    { label: "Gross profit", value: a.gross, prev: p?.gross ?? null, forecast: f?.gross ?? null, note: pct(a.gross, a.sales) !== null ? `${pct(a.gross, a.sales)}% margin` : undefined },
    { label: "Net profit", value: a.net, prev: p?.net ?? null, forecast: f?.net ?? null, note: pct(a.net, a.sales) !== null ? `${pct(a.net, a.sales)}% margin` : undefined },
    { label: "Cash at bank, month end", value: bank, prev: bankPrev, forecast: null, note: bank === null ? "Cash Flow statement not available" : undefined },
  ];
  const highlights: string[] = [];
  const ch = changePct(a.sales, p?.sales);
  if (ch !== null) highlights.push(`Revenue ${ch >= 0 ? "up" : "down"} ${Math.abs(ch)}% on ${longMonth(addMonths(month, -1))}.`);
  const vf = changePct(a.sales, f?.sales);
  if (vf !== null) highlights.push(`Revenue ${vf >= 0 ? "above" : "below"} forecast by ${Math.abs(vf)}%.`);
  const gm = pct(a.gross, a.sales), nm = pct(a.net, a.sales);
  if (gm !== null && nm !== null) highlights.push(`Gross margin ${gm}%, net margin ${nm}%.`);
  if (a.net < 0) highlights.push(`A net loss for the month.`);
  const conc = ov?.customerConcentration?.all;
  if (conc?.largestName && conc.largestPct !== null) highlights.push(`Largest customer ${conc.largestName}: ${conc.largestPct}% of confirmed sales orders.`);
  return { ok: true, data: { tiles, trend: buildTrend(d.rows, month, running).filter((t) => t.kind !== "forecast" || t.forecastSales !== null), highlights } };
}

function shapeIncome(d: DashPayload, month: string): BoardReport["income"] {
  const a = slice(d.rows, month, "actual");
  if (!a) return { ok: false, error: `No actual figures for ${longMonth(month)}` };
  const f = slice(d.rows, month, "forecast");
  const p = slice(d.rows, addMonths(month, -1), "actual");
  const closed = closedMonths(d.rows, month);
  const opening = (d.openingDate ?? "").slice(0, 7);
  const sinceLabel = closed.length && YM_RE.test(opening) && closed[0].key <= opening ? "Since opening" : closed.length ? `Since ${shortMonth(closed[0].key)}` : "Since opening";
  const since = (k: PlLineKey) => (closed.length ? sum(closed.map((r) => r.actual![k])) : null);
  const rows: IncomeRow[] = INCOME_LINES.map((l) => ({
    ...l,
    actual: a[l.key],
    forecast: f ? f[l.key] : null,
    prev: p ? p[l.key] : null,
    since: since(l.key),
    pctOfSales: l.key === "sales" ? (a.sales ? 100 : null) : pct(a[l.key], a.sales),
  }));
  const costStructure = [
    { label: "Raw materials", value: a.materials },
    { label: "Direct labour", value: a.labour },
    { label: "Factory overhead", value: a.overhead },
    { label: "Stock movement", value: a.stockMovement },
    { label: "Staff cost", value: a.staffCost },
    { label: "Other expenses", value: a.otherOpex },
  ].filter((x) => x.value > 0);
  const margins = [
    { label: "Gross margin", actual: pct(a.gross, a.sales), forecast: f ? pct(f.gross, f.sales) : null, prev: p ? pct(p.gross, p.sales) : null },
    { label: "Net margin", actual: pct(a.net, a.sales), forecast: f ? pct(f.net, f.sales) : null, prev: p ? pct(p.net, p.sales) : null },
    { label: "Materials / revenue", actual: pct(a.materials, a.sales), forecast: f ? pct(f.materials, f.sales) : null, prev: p ? pct(p.materials, p.sales) : null },
    { label: "Labour / revenue", actual: pct(a.labour, a.sales), forecast: f ? pct(f.labour, f.sales) : null, prev: p ? pct(p.labour, p.sales) : null },
  ];
  return { ok: true, data: { rows, sinceLabel, costStructure, margins, estimated: a.estimated ?? 0 } };
}

function shapeLabour(d: DashPayload, month: string, rev: RevSplitPayload | null): BoardReport["labour"] {
  const r = rowAt(d.rows, month);
  if (!r || !r.actual) return { ok: false, error: `No figures for ${longMonth(month)}` };
  const prevRow = rowAt(d.rows, addMonths(month, -1));
  const prod = (row: DashRow | null) => (row?.salaryByDept ?? []).filter((x) => !x.nonProd);
  const cur = prod(r);
  const prevBy = new Map(prod(prevRow).map((x) => [x.dept, x.costSen] as const));
  const ownRev = new Map((rev?.departments ?? []).map((x) => [x.code.toUpperCase(), x.period.total] as const));
  const total = cur.length ? sum(cur.map((x) => x.costSen)) : r.actual.labour;
  const prodRev = r.productionRevenue?.total ?? null;
  const depts: LabourDept[] = cur
    .filter((x) => x.costSen !== 0 || (x.forecastSen ?? 0) !== 0)
    .sort((x, y) => y.costSen - x.costSen)
    .map((x) => {
      const own = ownRev.get(x.dept.toUpperCase()) ?? null;
      return {
        dept: x.dept,
        cost: x.costSen,
        prev: prevBy.get(x.dept) ?? null,
        forecast: x.forecastSen ? x.forecastSen : null,
        share: pct(x.costSen, total),
        pctTotalProdRev: pct(x.costSen, prodRev),
        pctOwnProdRev: own ? pct(x.costSen, own) : null,
        ownProdRev: own,
      };
    });
  const capped = capRows(depts, 12, (rest, label) => {
    const cost = sum(rest.map((x) => x.cost));
    const prevs = rest.map((x) => x.prev).filter((x): x is number => x !== null);
    const fcs = rest.map((x) => x.forecast).filter((x): x is number => x !== null);
    return { dept: label, cost, prev: prevs.length ? sum(prevs) : null, forecast: fcs.length ? sum(fcs) : null, share: pct(cost, total), pctTotalProdRev: pct(cost, prodRev), pctOwnProdRev: null, ownProdRev: null };
  });
  // Trend: production salary per month, stacked by the six biggest departments of M.
  const series = depts.slice(0, 6).map((x) => x.dept);
  const trend = closedMonths(d.rows, month).slice(-12).map((row) => {
    const byDept: Record<string, number> = {};
    let t = 0;
    for (const x of prod(row)) {
      t += x.costSen;
      const k = series.includes(x.dept) ? x.dept : "Other";
      byDept[k] = (byDept[k] ?? 0) + x.costSen;
    }
    if (!prod(row).length && row.actual) { byDept.Other = row.actual.labour; t = row.actual.labour; }
    return { ym: row.key, label: shortMonth(row.key), byDept, total: t };
  });
  const prevTotal = prevRow ? (prod(prevRow).length ? sum(prod(prevRow).map((x) => x.costSen)) : prevRow.actual?.labour ?? null) : null;
  const fcAll = cur.map((x) => x.forecastSen ?? 0);
  return {
    ok: true,
    data: {
      depts: capped,
      total,
      prevTotal,
      forecastTotal: fcAll.some((x) => x !== 0) ? sum(fcAll) : r.forecast?.labour ?? null,
      productionRevenue: prodRev,
      headcount: r.labourBase?.headcount ?? null,
      units: r.labourBase?.unitsCompleted ?? null,
      trend,
      series: trend.some((t) => t.byDept.Other) ? [...series, "Other"] : series,
    },
  };
}

function materialsOf(row: DashRow | null): Map<string, { spend: number; purchase: number; closing: number }> {
  const m = new Map<string, { spend: number; purchase: number; closing: number }>();
  for (const c of row?.costStructure?.categories ?? []) {
    const e = m.get(c.name) ?? { spend: 0, purchase: 0, closing: 0 };
    e.spend += c.spend; e.purchase += c.purchase; e.closing += c.closing;
    m.set(c.name, e);
  }
  return m;
}

function shapeMaterials(d: DashPayload, month: string): BoardReport["materials"] {
  const r = rowAt(d.rows, month);
  if (!r || !r.actual) return { ok: false, error: `No figures for ${longMonth(month)}` };
  const cur = materialsOf(r);
  const prev = materialsOf(rowAt(d.rows, addMonths(month, -1)));
  const fc = r.costStructure?.forecast ?? {};
  const sales = r.actual.sales;
  const cats: MaterialCat[] = [...cur.entries()]
    .map(([name, v]) => ({ name, ...v, forecast: fc[name] ?? null, prev: prev.get(name)?.spend ?? null, pctOfSales: pct(v.spend, sales) }))
    .sort((x, y) => y.spend - x.spend);
  const capped = capRows(cats, 12, (rest, label) => {
    const spend = sum(rest.map((x) => x.spend));
    const prevs = rest.map((x) => x.prev).filter((x): x is number => x !== null);
    const fcs = rest.map((x) => x.forecast).filter((x): x is number => x !== null);
    return { name: label, spend, purchase: sum(rest.map((x) => x.purchase)), closing: sum(rest.map((x) => x.closing)), forecast: fcs.length ? sum(fcs) : null, prev: prevs.length ? sum(prevs) : null, pctOfSales: pct(spend, sales) };
  });
  const trend = closedMonths(d.rows, month).slice(-12).map((row) => ({ ym: row.key, label: shortMonth(row.key), actual: row.actual?.materials ?? null, forecast: row.forecast?.materials ?? null }));
  return { ok: true, data: { cats: capped, total: r.actual.materials, sales, trend } };
}

function shapeTrend(d: DashPayload, month: string, running: string): BoardReport["trend"] {
  const points = buildTrend(d.rows, month, running);
  if (!points.length) return { ok: false, error: "No monthly figures" };
  const actual = points.filter((p) => p.kind === "actual" && p.ym <= month);
  const tail = [...actual.slice(-6), ...points.filter((p) => p.ym > month)];
  const summary = tail.map((p) => {
    const s = p.kind === "forecast" ? p.forecastSales : p.sales;
    const n = p.kind === "forecast" ? p.forecastNet : p.net;
    const g = p.kind === "forecast" ? rowAt(d.rows, p.ym)?.forecast?.gross ?? null : p.gross;
    return {
      label: p.kind === "mtd" ? `${p.label} (to date)` : p.kind === "forecast" ? `${p.label} (forecast)` : p.label,
      kind: p.kind, sales: s, gross: g, net: n, grossPct: pct(g, s), netPct: pct(n, s),
    };
  });
  const last3 = actual.slice(-3).map((p) => ({ label: p.label, sales: p.sales, fcSales: p.forecastSales, net: p.net, fcNet: p.forecastNet }));
  return { ok: true, data: { points, summary, last3 } };
}

function shapeBalance(d: DashPayload, month: string): BoardReport["balance"] {
  const cur = rowAt(d.rows, month);
  if (!cur?.balanceSheet) return { ok: false, error: `No balance sheet for ${longMonth(month)}` };
  const prev = rowAt(d.rows, addMonths(month, -1));
  const qa = rowAt(d.rows, addMonths(month, -3));
  const b = (r: DashRow | null, f: (x: DashBs) => number) => (r?.balanceSheet ? f(r.balanceSheet) : null);
  const line = (label: string, strong: boolean, f: (x: DashBs) => number): BsRow => {
    const c = b(cur, f), p = b(prev, f);
    return { label, strong, cur: c, prev: p, change: c !== null && p !== null ? c - p : null, quarterAgo: b(qa, f) };
  };
  const rows: BsRow[] = [
    line("Current assets", false, (x) => x.currentAssets),
    line("of which inventory", false, (x) => x.inventory),
    line("Non-current assets", false, (x) => x.assets - x.currentAssets),
    line("Total assets", true, (x) => x.assets),
    line("Current liabilities", false, (x) => x.currentLiabilities),
    line("Non-current liabilities", false, (x) => x.liabilities - x.currentLiabilities),
    line("Total liabilities", true, (x) => x.liabilities),
    line("Equity (net assets)", true, (x) => x.equity),
  ];
  const rc = cur.ratios, rp = prev?.ratios;
  const ratios: { label: string; cur: number | null; prev: number | null; unit: "x" | "%" }[] = [
    { label: "Current ratio", cur: rc?.currentRatio ?? null, prev: rp?.currentRatio ?? null, unit: "x" },
    { label: "Quick ratio", cur: rc?.quickRatio ?? null, prev: rp?.quickRatio ?? null, unit: "x" },
    { label: "Debt to assets", cur: rc?.debtToAssetPct ?? null, prev: rp?.debtToAssetPct ?? null, unit: "%" },
    { label: "Return on equity (month)", cur: rc?.roePct ?? null, prev: rp?.roePct ?? null, unit: "%" },
    { label: "Return on assets (month)", cur: rc?.roaPct ?? null, prev: rp?.roaPct ?? null, unit: "%" },
  ];
  const opening = prev?.balanceSheet?.equity ?? null;
  const closing = cur.balanceSheet.equity;
  const net = cur.actual?.net ?? null;
  const equity = { opening, net, other: opening !== null && net !== null ? closing - opening - net : null, closing };
  const trend = closedMonths(d.rows, month).filter((r) => r.balanceSheet).slice(-12).map((r) => ({ ym: r.key, label: shortMonth(r.key), assets: r.balanceSheet!.assets, liabilities: r.balanceSheet!.liabilities, equity: r.balanceSheet!.equity }));
  return { ok: true, data: { rows, ratios, equity, trend } };
}

/** The statement's bank balance carried forward at the end of `ym` (the actual column), or null. */
export function bankCloseAt(cf: CfPayload, ym: string): number | null {
  const idx = cf.columns.findIndex((c) => !c.accum && !c.forecast && (c.ym ?? c.key) === ym);
  if (idx < 0) return null;
  const row = cf.rows.find((r) => r.kind === "cf");
  const v = row?.values[idx];
  return typeof v === "number" ? v : null;
}

function shapeCashFlow(d: DashPayload, month: string, running: string, cash: CfPayload | null): BoardReport["cashFlow"] {
  const months: CashMonth[] = d.rows
    .filter((r) => r.cashFlow && (r.key <= month || (r.key === running && running > month)) && (r.actual !== null || r.key <= month))
    .slice(-13)
    .map((r) => ({ ym: r.key, label: shortMonth(r.key), kind: r.key === running ? "mtd" : "actual", operating: r.cashFlow!.operating, investing: r.cashFlow!.investing, financing: r.cashFlow!.financing, net: r.cashFlow!.net, fcf: r.cashFlow!.freeCashFlow }));
  if (!months.length) return { ok: false, error: "No cash flow figures" };
  return { ok: true, data: { months, bankClose: cash ? bankCloseAt(cash, month) : null } };
}

/** Month-end bank balance per month: the Actual column, the Docs forecast (fc:) and the P&L forecast (fp:). */
export function shapeCashForecast(cf: CfPayload, month: string): BoardReport["cashForecast"] {
  const row = cf.rows.find((r) => r.kind === "cf");
  if (!row) return { ok: false, error: "The Cash Flow forecast has no bank balance row" };
  const by = new Map<string, CashForecastMonth>();
  const get = (ym: string) => {
    let e = by.get(ym);
    if (!e) { e = { ym, label: shortMonth(ym), actual: null, docs: null, pnl: null }; by.set(ym, e); }
    return e;
  };
  cf.columns.forEach((c, i) => {
    if (c.accum || c.blank) return;
    const ym = c.ym ?? c.key.replace(/^f[cp]:/, "");
    if (!YM_RE.test(ym)) return;
    const v = row.values[i];
    const val = typeof v === "number" ? v : null;
    if (!c.forecast) { if (!c.future) get(ym).actual = val; }
    else if (c.forecastKind === "pnl" || c.key.startsWith("fp:")) get(ym).pnl = val;
    else get(ym).docs = val;
  });
  const months = [...by.values()].filter((m) => m.ym >= addMonths(month, -2)).sort((a, b) => a.ym.localeCompare(b.ym)).slice(0, 9);
  if (!months.length) return { ok: false, error: "No months in the Cash Flow forecast" };
  return { ok: true, data: { months, asOf: cf.today ?? null } };
}

function shapeCustomers(ov: OverviewPayload): BoardReport["customers"] {
  const conc = ov.customerConcentration?.all ?? null;
  const total = conc?.totalSen ?? sum((ov.aovByCustomer ?? []).map((r) => r.totalSen));
  const shown = (ov.aovByCustomer ?? []).slice(0, 10);
  const rows: CustomerRow[] = shown.map((r) => ({
    name: r.customerName, total: r.totalSen, share: pct(r.totalSen, total),
    bedframeAvg: r.bedframeUnits > 0 ? r.bedframeAvgSen : null, bedframeUnits: r.bedframeUnits,
    sofaAvg: r.sofaSets > 0 ? r.sofaAvgSen : null, sofaSets: r.sofaSets,
  }));
  const shownTotal = sum(rows.map((r) => r.total));
  const restCount = (conc?.customerCount ?? rows.length) - rows.length;
  if (restCount > 0 && total - shownTotal > 0) {
    rows.push({ name: `Other (${restCount} more)`, total: total - shownTotal, share: pct(total - shownTotal, total), bedframeAvg: null, bedframeUnits: 0, sofaAvg: null, sofaSets: 0 });
  }
  const co = ov.aovCompany;
  return {
    ok: true,
    data: {
      rows,
      concentration: conc,
      company: co ? { bedframeAvg: co.bedframeUnits > 0 ? co.bedframeAvgSen : null, bedframeUnits: co.bedframeUnits, sofaAvg: co.sofaSets > 0 ? co.sofaAvgSen : null, sofaSets: co.sofaSets, total: co.totalSen } : null,
    },
  };
}

/** Nine photo cards fit one A4 page; the rest are named in one line. */
export const NEW_MODEL_CARDS = 9;
function shapeNewModels(nm: NewModelsPayload): BoardReport["newModels"] {
  const models = [...nm.models].sort((a, b) => b.added.localeCompare(a.added) || a.code.localeCompare(b.code));
  return {
    ok: true,
    data: {
      from: nm.from, to: nm.to,
      models: models.slice(0, NEW_MODEL_CARDS),
      more: models.slice(NEW_MODEL_CARDS).map((m) => m.code),
      priceNote: nm.priceNote ?? "",
      undated: nm.undatedProducts ?? 0,
    },
  };
}

function shapeOperations(d: DashPayload, month: string, revCur: Src<RevSplitPayload>, revPrev: Src<RevSplitPayload>, defects: Src<DefectsPayload>, workforce: Src<WorkforcePayload>): BoardReport["operations"] {
  const r = rowAt(d.rows, month);
  const prevRow = rowAt(d.rows, addMonths(month, -1));
  const prevBy = new Map((revPrev.ok ? revPrev.data.departments ?? [] : []).map((x) => [x.code, x.period.total] as const));
  const prodMix: ProdDept[] = (revCur.ok ? revCur.data.departments ?? [] : [])
    .map((x) => {
      const p = revPrev.ok ? prevBy.get(x.code) ?? 0 : null;
      return { code: x.code, label: x.label, total: x.period.total, prev: p, change: changePct(x.period.total, p) };
    })
    .filter((x) => x.total !== 0 || (x.prev ?? 0) !== 0);
  const pr = r?.productionRevenue ?? null;
  const categoryMix = pr ? [{ label: "Bedframe", value: pr.bedframe }, { label: "Sofa", value: pr.sofa }, { label: "Accessory", value: pr.accessory }].filter((x) => x.value > 0) : [];
  const trend = closedMonths(d.rows, month).slice(-12).map((row) => ({ ym: row.key, label: shortMonth(row.key), bedframe: row.productionRevenue?.bedframe ?? 0, sofa: row.productionRevenue?.sofa ?? 0, accessory: row.productionRevenue?.accessory ?? 0 }));
  if (!r && !revCur.ok) return { ok: false, error: revCur.error };
  return {
    ok: true,
    data: {
      prodMix: capRows(prodMix, 10, (rest, label) => {
        const t = sum(rest.map((x) => x.total));
        const p = rest.every((x) => x.prev === null) ? null : sum(rest.map((x) => x.prev ?? 0));
        return { code: "OTHER", label, total: t, prev: p, change: changePct(t, p) };
      }),
      prodTotal: pr?.total ?? sum(prodMix.map((x) => x.total)),
      categoryMix,
      headcount: r?.labourBase?.headcount ?? null,
      prevHeadcount: prevRow?.labourBase?.headcount ?? null,
      units: r?.labourBase?.unitsCompleted ?? null,
      prevUnits: prevRow?.labourBase?.unitsCompleted ?? null,
      defects: defects.ok ? defects.data.month : null,
      defectTrend: defects.ok ? defects.data.trend : [],
      defectsError: defects.ok ? null : defects.error,
      workforce: workforce.ok ? workforce.data : null,
      workforceNote: workforce.ok ? null : workforce.error,
      trend,
    },
  };
}

function shapeOutlook(d: DashPayload, month: string, running: string): BoardReport["outlook"] {
  const months: OutlookMonth[] = d.rows
    .filter((r) => r.key > month && (r.forecast !== null || r.key === running))
    .slice(0, 6)
    .map((r) => ({ ym: r.key, label: shortMonth(r.key), mtd: r.key <= running ? r.actual : null, forecast: r.forecast }));
  // The quarter the next month falls in: closed months actual, the running
  // month to date and its forecast, months ahead forecast.
  const next = addMonths(month, 1);
  const qStartM = Math.floor((parseInt(next.slice(5, 7), 10) - 1) / 3) * 3 + 1;
  const qStart = `${next.slice(0, 4)}-${String(qStartM).padStart(2, "0")}`;
  const qMonths = [qStart, addMonths(qStart, 1), addMonths(qStart, 2)];
  const qRows = qMonths.map((ym) => {
    const r = rowAt(d.rows, ym);
    const kind: "actual" | "mtd" | "forecast" = ym < running ? "actual" : ym === running ? "mtd" : "forecast";
    const s = kind === "actual" ? r?.actual : r?.forecast;
    return { label: `${shortMonth(ym)} ${kind === "actual" ? "actual" : "forecast"}`, kind, sales: s?.sales ?? null, net: s?.net ?? null };
  });
  const allSales = qRows.map((x) => x.sales), allNet = qRows.map((x) => x.net);
  const quarter = {
    label: `Q${Math.floor((qStartM - 1) / 3) + 1} ${qStart.slice(0, 4)}`,
    rows: qRows,
    sales: allSales.every((x) => x !== null) ? sum(allSales as number[]) : null,
    net: allNet.every((x) => x !== null) ? sum(allNet as number[]) : null,
  };
  if (!months.length) return { ok: false, error: "No Forecast P&L months after this one — key them under Forecasting › Forecast P&L" };
  return { ok: true, data: { months, quarter } };
}

// ── appendices ────────────────────────────────────────────────────────────
/** Pick the accumulated column plus up to six months on or before M, newest first. */
function pickMonthCols(cols: readonly MatrixCol[], month: string, max = 6): { idx: number; label: string }[] {
  const out: { idx: number; label: string }[] = [];
  const acc = cols.findIndex((c) => c.accum && !c.forecast);
  const monthsIdx = cols
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.accum && !c.forecast && !c.future && YM_RE.test(c.ym ?? c.key) && (c.ym ?? c.key) <= month)
    .sort((a, b) => (b.c.ym ?? b.c.key).localeCompare(a.c.ym ?? a.c.key))
    .slice(0, max);
  for (const { c, i } of monthsIdx) out.push({ idx: i, label: shortMonth(c.ym ?? c.key) });
  if (acc >= 0) out.push({ idx: acc, label: "Year to date" });
  return out;
}

export function shapeMatrix(p: { columns: MatrixCol[]; rows: { kind: string; depth: number; label: string; values: (number | null)[] }[] }, month: string): TableBlock {
  const cols = pickMonthCols(p.columns, month);
  return {
    columns: cols.map((c) => c.label),
    rows: p.rows
      .filter((r) => r.kind !== "gap")
      .map((r) => ({
        label: r.label,
        depth: Math.max(0, Math.min(4, r.depth)),
        strong: r.kind === "total" || r.kind === "grandtotal" || r.kind === "result" || r.kind === "subtotal" || r.kind === "section" || r.kind === "bf" || r.kind === "cf",
        values: cols.map((c) => {
          const v = r.values[c.idx];
          return typeof v === "number" ? v : null;
        }),
      })),
  };
}

// src/lib/bs-section.ts — the balance sheet's own sections, in its order.
const BS_ORDER = ["FIXED_ASSET", "CURRENT_ASSET", "CURRENT_LIABILITY", "LONG_TERM_LIABILITY", "EQUITY"];
const bsTitle = (cat: string) => cat.toLowerCase().replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
export function shapeBsAppendix(cur: PlPayload, prev: PlPayload | null): TableBlock {
  const lines = cur.balanceSheet ?? [];
  const prevBy = new Map((prev?.balanceSheet ?? []).map((l) => [l.accountCode, l.balance] as const));
  const cats = [...new Set([...lines.map((l) => l.category), ...(prev?.balanceSheet ?? []).map((l) => l.category)])]
    .sort((a, b) => (BS_ORDER.indexOf(a) + 1 || 99) - (BS_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const rows: TableBlock["rows"] = [];
  for (const cat of cats) {
    rows.push({ label: bsTitle(cat), depth: 0, strong: true, values: [null, null, null] });
    const codes = [...new Set([...lines.filter((l) => l.category === cat).map((l) => l.accountCode), ...(prev?.balanceSheet ?? []).filter((l) => l.category === cat).map((l) => l.accountCode)])].sort();
    let tc = 0, tp = 0;
    for (const code of codes) {
      const l = lines.find((x) => x.accountCode === code) ?? (prev?.balanceSheet ?? []).find((x) => x.accountCode === code)!;
      const c = lines.find((x) => x.accountCode === code)?.balance ?? 0;
      const p = prevBy.get(code) ?? 0;
      tc += c; tp += p;
      rows.push({ label: `${code === "NP-CURRENT" ? "" : `${code} `}${l.accountName}`, depth: 1, strong: false, values: [c, prev ? p : null, prev ? c - p : null] });
    }
    rows.push({ label: `Total ${bsTitle(cat).toLowerCase()}`, depth: 0, strong: true, values: [tc, prev ? tp : null, prev ? tc - tp : null] });
  }
  return { columns: ["Month end", "Previous", "Change"], rows };
}

/** Split a long table into A4 pages of at most `perPage` rows. */
export function paginate<T>(rows: readonly T[], perPage: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) out.push(rows.slice(i, i + perPage));
  return out.length ? out : [[]];
}

// ── flags (page 13) ───────────────────────────────────────────────────────
const rmText = (sen: number) => `RM ${Math.round(sen / 100).toLocaleString("en-MY")}`;

export function boardFlags(s: BoardSources, month: string): Flag[] {
  const flags: Flag[] = [];
  const failed: [string, Src<unknown>][] = [
    ["Financial Dashboard", s.dashboard], ["Monthly P&L", s.plMonthly], ["Balance sheet", s.plCur], ["Cash Flow statement", s.cashflow],
    ["Cash Flow forecast", s.cashForecast], ["Customer figures", s.overview], ["Production revenue by department", s.revSplitCur],
    ["New models", s.newModels], ["Defect rates", s.defects],
  ];
  for (const [name, src] of failed) if (!src.ok) flags.push({ level: "check", text: `${name} could not be loaded: ${src.error}` });
  if (!s.dashboard.ok) return flags;
  const rows = s.dashboard.data.rows;
  const a = slice(rows, month, "actual");
  const p = slice(rows, addMonths(month, -1), "actual");
  if (a && p) {
    if (p.staffCost > 0 && a.staffCost < p.staffCost * 0.5) {
      flags.push({ level: "alert", text: `Staff cost ${rmText(a.staffCost)} is ${Math.round((1 - a.staffCost / p.staffCost) * 100)}% below ${longMonth(addMonths(month, -1))} (${rmText(p.staffCost)}). Is the month's payroll fully posted?` });
    }
    if (p.labour > 0 && a.labour < p.labour * 0.5) {
      flags.push({ level: "alert", text: `Direct labour ${rmText(a.labour)} is less than half of last month's ${rmText(p.labour)}.` });
    }
  }
  if (a && (a.estimated ?? 0) > 0) {
    flags.push({ level: "check", text: `${longMonth(month)} still carries ${rmText(a.estimated!)} of estimates for recurring costs not yet recorded.` });
  }
  const cur = rowAt(rows, month), prev = rowAt(rows, addMonths(month, -1));
  if (a && cur?.balanceSheet && prev?.balanceSheet) {
    const dEq = cur.balanceSheet.equity - prev.balanceSheet.equity;
    const gap = dEq - a.net;
    if (Math.abs(gap) > Math.max(100_000, Math.abs(a.net) * 0.05)) {
      flags.push({ level: "alert", text: `Equity moved ${rmText(dEq)} but net profit was ${rmText(a.net)} — ${rmText(Math.abs(gap))} ${gap > 0 ? "more" : "less"} than profit. Capital injected, drawings, or a posting to equity?` });
    }
    if (cur.balanceSheet.assets !== cur.balanceSheet.liabilities + cur.balanceSheet.equity && Math.abs(cur.balanceSheet.assets - cur.balanceSheet.liabilities - cur.balanceSheet.equity) > 100) {
      flags.push({ level: "alert", text: `The balance sheet does not balance: assets ${rmText(cur.balanceSheet.assets)} vs liabilities + equity ${rmText(cur.balanceSheet.liabilities + cur.balanceSheet.equity)}.` });
    }
  }
  for (const r of closedMonths(rows, month).slice(-12)) {
    if (r.actual && r.actual.net < 0) flags.push({ level: r.key === month ? "alert" : "info", text: `${longMonth(r.key)}: net loss of ${rmText(-r.actual.net)}.` });
  }
  const f = slice(rows, month, "forecast");
  if (a && f && f.sales > 0) {
    const v = changePct(a.sales, f.sales)!;
    if (Math.abs(v) >= 20) flags.push({ level: "info", text: `Revenue ${v > 0 ? "beat" : "missed"} the forecast by ${Math.abs(v)}% (${rmText(a.sales)} vs ${rmText(f.sales)}).` });
  }
  if (s.plCur.ok) {
    const ledgerNet = s.plCur.data.totals?.netProfit;
    if (a && typeof ledgerNet === "number" && Math.abs(ledgerNet - a.net) > 100_000) {
      flags.push({ level: "check", text: `Net profit differs between the Monthly P&L (${rmText(a.net)}) and the ledger P&L report (${rmText(ledgerNet)}) — the two are built differently; Finance to confirm which figure is signed off.` });
    }
    if (s.plCur.data.sheetStockError) flags.push({ level: "check", text: `Balance-sheet stock could not be read: ${s.plCur.data.sheetStockError}` });
  }
  if (!s.workforce.ok) flags.push({ level: "info", text: `Workforce efficiency left out: ${s.workforce.error}` });
  return flags;
}

// ── the whole report ──────────────────────────────────────────────────────
export function shapeBoardReport(s: BoardSources, month: string, todayYmd: string, generatedAt: string): BoardReport {
  const running = todayYmd.slice(0, 7);
  const d = s.dashboard;
  const dash = d.ok ? d.data : null;
  const cash = s.cashflow.ok ? s.cashflow.data : null;
  const ov = s.overview.ok ? s.overview.data : null;
  const need = <T,>(f: (x: DashPayload) => Section<T>): Section<T> => (dash ? f(dash) : fail<T>(d as { ok: false; error: string }));
  return {
    month,
    monthLabel: longMonth(month),
    running,
    generatedAt,
    openingDate: dash?.openingDate ?? null,
    cover: need((x) => shapeCover(x, month, running, cash, ov)),
    income: need((x) => shapeIncome(x, month)),
    labour: need((x) => shapeLabour(x, month, s.revSplitCur.ok ? s.revSplitCur.data : null)),
    materials: need((x) => shapeMaterials(x, month)),
    trend: need((x) => shapeTrend(x, month, running)),
    balance: need((x) => shapeBalance(x, month)),
    cashFlow: need((x) => shapeCashFlow(x, month, running, cash)),
    cashForecast: s.cashForecast.ok ? shapeCashForecast(s.cashForecast.data, month) : fail(s.cashForecast),
    customers: ov ? shapeCustomers(ov) : fail(s.overview as { ok: false; error: string }),
    newModels: s.newModels.ok ? shapeNewModels(s.newModels.data) : fail(s.newModels),
    operations: need((x) => shapeOperations(x, month, s.revSplitCur, s.revSplitPrev, s.defects, s.workforce)),
    outlook: need((x) => shapeOutlook(x, month, running)),
    notes: { flags: boardFlags(s, month), text: s.notes.text, updatedAt: s.notes.updatedAt, updatedBy: s.notes.updatedBy },
    appendixPl: s.plMonthly.ok ? { ok: true, data: { title: s.plMonthly.data.fyLabel ?? "", ...shapeMatrix(s.plMonthly.data, month) } } : fail(s.plMonthly),
    appendixBs: s.plCur.ok ? { ok: true, data: shapeBsAppendix(s.plCur.data, s.plPrev.ok ? s.plPrev.data : null) } : fail(s.plCur),
    appendixCf: cash ? { ok: true, data: { title: "", ...shapeMatrix(cash, month) } } : fail(s.cashflow as { ok: false; error: string }),
  };
}

// ── notes (kv_config board_report_notes:<YYYY-MM>) ────────────────────────
export const NOTES_MAX = 4000;
export const notesKey = (ym: string) => `board_report_notes:${ym}`;
export function parseNotes(raw: string | null | undefined): BoardNotes {
  if (!raw) return { text: "", updatedAt: null, updatedBy: null };
  try {
    const j = JSON.parse(raw) as Partial<BoardNotes>;
    return { text: typeof j.text === "string" ? j.text : "", updatedAt: j.updatedAt ?? null, updatedBy: j.updatedBy ?? null };
  } catch {
    return { text: String(raw), updatedAt: null, updatedBy: null };
  }
}
/** Validate a notes write: text only, trimmed of trailing space, capped. */
export function cleanNotesInput(body: unknown): { ok: true; month: string; text: string } | { ok: false; error: string } {
  const b = (body ?? {}) as { month?: unknown; text?: unknown };
  const month = typeof b.month === "string" ? b.month : "";
  if (!YM_RE.test(month)) return { ok: false, error: "month must be YYYY-MM" };
  if (typeof b.text !== "string") return { ok: false, error: "text is required" };
  const text = b.text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
  if (text.length > NOTES_MAX) return { ok: false, error: `Notes are limited to ${NOTES_MAX} characters` };
  return { ok: true, month, text };
}
