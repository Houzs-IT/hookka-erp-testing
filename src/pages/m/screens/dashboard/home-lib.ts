// Pure logic for the /m Home dashboard (Home v10). No React, so node --test
// imports it (tests/m-home-dashboard.test.mjs).
//
// RULE: nothing here invents a business definition. Every figure comes from
// the desktop endpoints, and the maths below is the desktop's own, copied
// line-for-line where the desktop keeps it inside a component that cannot be
// imported (dashboard-b/index.tsx, dashboards/SalesOrdersView.tsx). Where a
// desktop line is known to be wrong the difference is named next to it.
import {
  dayLabel,
  monthLabel,
  quarterKeyOf,
  quarterOfPeriod,
  quarterPeriod,
  stepDay,
  stepPeriod,
  stepQuarter,
  widgetPeriodLabel,
  ymd,
  type Period,
} from "../../../dashboards/dashboard-shared-lib";
import { parseDashPeriod } from "../../../../api/lib/dash-period";
import { dropIdleSundays } from "../../../../lib/idle-sundays";
import { formatCurrency } from "../../../../lib/utils";
import { pickCat, type RevCat, type RevenueSplitResp } from "../../../dashboard-b/revenue-split";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export const DASHBOARD_VIEWS = [
  { key: "sales", label: "Sales", blurb: "Orders, invoices, pipeline, forecast", built: true },
  { key: "operations", label: "Operations", blurb: "Production, backlog, plant load", built: true },
  { key: "people", label: "Employees", blurb: "Efficiency and attendance", built: true },
  { key: "service", label: "Service", blurb: "Cases, report, to do", built: false },
  { key: "finance", label: "Finance", blurb: "Per head, returns, outlook", built: false },
  { key: "ocr", label: "OCR", blurb: "Accuracy of the PO scanner", built: false },
] as const;
export type DashView = (typeof DASHBOARD_VIEWS)[number]["key"];

export const isDashView = (k: string | null | undefined): k is DashView =>
  DASHBOARD_VIEWS.some((v) => v.key === k);

/**
 * The views this user may open. `dashboardTabs` is the server's tab list for a
 * tab-restricted role (role-policy.ts DASHBOARD_TABS_BY_ROLE, today PRODUCTION
 * only); null/undefined means every tab, exactly as the desktop page reads it.
 */
export function allowedViews(dashboardTabs: readonly string[] | null | undefined): DashView[] {
  const all = DASHBOARD_VIEWS.map((v) => v.key);
  return dashboardTabs ? all.filter((k) => dashboardTabs.includes(k)) : all;
}

export type ResolvedView =
  | { kind: "view"; view: DashView }
  | { kind: "blocked"; view: DashView }
  | { kind: "none" };

/** `?view=` → what to show. A valid-but-not-allowed view is "blocked", never silently swapped. */
export function resolveView(raw: string | null | undefined, allowed: readonly DashView[]): ResolvedView {
  if (isDashView(raw)) return allowed.includes(raw) ? { kind: "view", view: raw } : { kind: "blocked", view: raw };
  const first = allowed[0];
  return first ? { kind: "view", view: first } : { kind: "none" };
}

/**
 * Where an old /m/dashboard[/:tab] link now lives. The view moves into
 * `?view=`; every other parameter (mode, month, from, to, lbl, day, sub) is
 * kept as it was. A bare /m/dashboard or an unknown tab carries no view, so
 * the screen opens on the user's first allowed view, not blindly on Sales.
 */
export function legacyDashboardTarget(tab: string | undefined, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("view");
  const key = tab === "overview" ? "sales" : tab;
  if (isDashView(key)) params.set("view", key);
  const qs = params.toString();
  return qs ? `/m?${qs}` : "/m";
}

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------
/** Desktop dashboard-prototype.tsx: `dayTab = tab === "people" || tab === "operations"`. */
export const DAY_VIEWS: readonly DashView[] = ["people", "operations"];
export const viewAllowsDay = (view: DashView): boolean => DAY_VIEWS.includes(view);

/**
 * The period a view actually reads. Off the Day views a picked day, or a range
 * that is not a calendar quarter, reads as its month (same rule as the desktop
 * page); the URL keeps whatever was there.
 */
export function effectivePeriod(view: DashView, raw: Period): Period {
  // Operations and Employees are the two Day views (DAY_VIEWS); both read the same period shape.
  if (view === "operations" || view === "people") return opsPeriod(raw);
  if (viewAllowsDay(view)) return raw;
  if (raw.mode === "range" && !quarterOfPeriod(raw)) return { mode: "monthly", month: raw.month };
  return raw.day ? { ...raw, day: undefined } : raw;
}

/**
 * The period the Operations view reads (desktop dashboard-prototype.tsx
 * `effectivePeriod`): a picked day survives, a range that is not a calendar
 * quarter falls back to its month, and a year or a quarter carries no day (a
 * day is only meaningful inside one month).
 */
export function opsPeriod(raw: Period): Period {
  if (raw.mode === "range" && !quarterOfPeriod(raw)) return { mode: "monthly", month: raw.month, ...(raw.day ? { day: raw.day } : {}) };
  if ((raw.mode === "ytd" || raw.mode === "range") && raw.day) return { ...raw, day: undefined };
  return raw;
}

/** Day / Month / Quarter / Year switch of the Operations period bar; the month in view is kept. */
export function switchOpsMode(p: Period, to: PeriodMode4, today: string): Period {
  if (to === "day") {
    const cur = today.slice(0, 7);
    const lastDay = ymd(new Date(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)), 0));
    return { mode: "monthly", month: p.month, day: p.day ?? (p.month === cur ? today : lastDay < today ? lastDay : today) };
  }
  return switchMode({ ...p, day: undefined }, to, today);
}

/** One step of the < > arrows on Operations: a calendar day in Day mode (desktop stepDay), else as Sales. */
export function stepOps(p: Period, months: string[], dir: -1 | 1, today: string): Period | null {
  if (p.day) {
    const d = stepDay(p.day, dir, today);
    return d ? { mode: "monthly", month: d.slice(0, 7), day: d } : null;
  }
  return stepSales(p, months, dir, today);
}

/** The label of the period pill: the picked day, else the month / quarter / year. */
export function opsPeriodLabel(p: Period): string {
  return p.day ? dayLabel(p.day) : widgetPeriodLabel(p);
}

/**
 * Costing's focus month (owner decision D2). Desktop uses the range's last
 * month, which for the quarter in progress is a month that has not started.
 * Here it is clamped to the current month; a finished quarter still uses its
 * final month. Any other period uses its own month.
 */
export function costingFocusMonth(p: Period, today: string): string {
  const cur = today.slice(0, 7);
  const m = p.mode === "range" && p.to ? p.to.slice(0, 7) : p.month;
  return m > cur ? cur : m;
}

/**
 * True once the period names a real month. Until the month list has loaded
 * `resolvePeriod` returns month "" - which would print "undefined" in the period
 * label and make `widgetPeriod` return "" (read by the server as ALL-TIME, the slow
 * query). Nothing may be fetched or labelled from an unresolved period.
 */
export const periodResolved = (p: Period): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month);

export type PeriodMode4 = "day" | "month" | "quarter" | "year";
export function periodMode(p: Period): PeriodMode4 {
  if (p.mode === "ytd") return "year";
  if (quarterOfPeriod(p)) return "quarter";
  if (p.day || p.mode === "range") return "day";
  return "month";
}

/** Month / Quarter / Year switch of the Sales period bar; the month in view is kept (desktop PeriodPicker rule). */
export function switchMode(p: Period, to: "month" | "quarter" | "year", today: string): Period {
  if (to === "year") return { mode: "ytd", month: p.month };
  if (to === "quarter") return quarterPeriod(quarterKeyOf(p.month), today);
  return { mode: "monthly", month: p.month };
}

/** One step of the < > arrows (desktop: months with data / calendar quarters / years with data). */
export function stepSales(p: Period, months: string[], dir: -1 | 1, today: string): Period | null {
  const qk = quarterOfPeriod(p);
  if (qk) {
    const k = stepQuarter(qk, dir, today);
    return k ? quarterPeriod(k, today) : null;
  }
  return stepPeriod(p, months, dir);
}

// ---------------------------------------------------------------------------
// Money / text
// ---------------------------------------------------------------------------
export const rm = (sen: number | null | undefined): string => formatCurrency(Math.round(sen ?? 0));
/** Axis / tile shorthand: RM 1.23m / RM 456k. */
export function rmShort(sen: number): string {
  const v = sen / 100;
  const a = Math.abs(v);
  if (a >= 1_000_000) return `RM ${(v / 1_000_000).toFixed(2)}m`;
  return `RM ${Math.round(v / 1000)}k`;
}
export const axisK = (v: number): string =>
  v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}k` : String(Math.round(v));
export const pct1 = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
export const titleCase = (s: string): string =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s_])([a-z])/g, (_m, p, c) => `${p === "_" ? " " : p}${c.toUpperCase()}`) : s;
export const ymLabelShort = (ym: string): string => `${monthLabel(ym).slice(0, 3)} ${ym.slice(2, 4)}`;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function todayLabel(d: Date = new Date()): string {
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${monthLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`).slice(0, 3)} ${d.getFullYear()}`;
}
export function greetingWord(d: Date = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// ---------------------------------------------------------------------------
// KPI state tiles (Pending Delivery / Outstanding)
// ---------------------------------------------------------------------------
export type StateTile =
  | { kind: "live"; sen: number }
  | { kind: "saved"; sen: number; asOf: string | null }
  | { kind: "none" };

/**
 * Live while the period reaches the current month; otherwise the month-end
 * figure the server saved for the period's LAST month, or "none".
 *
 * Differs from the desktop `stateKpiTile` on purpose: that one compares the
 * period KEY as a string against "YYYY-MM", so the current year ("2026") sorts
 * below "2026-11" and reads as past, while a past quarter ("2026-Q1") sorts
 * above it and reads as live. Here the period's last month decides, the same
 * test the server uses to decide whether it sends `stateKpis` at all
 * (dashboard-overview.ts: lastYm < currentMonth).
 */
export function stateTile(
  periodKey: string,
  saved: number | null | undefined,
  asOf: string | null | undefined,
  liveSen: number,
  curYm: string,
): StateTile {
  const last = parseDashPeriod(periodKey).lastYm;
  if (!last || last >= curYm) return { kind: "live", sen: liveSen };
  return saved == null ? { kind: "none" } : { kind: "saved", sen: saved, asOf: asOf ?? null };
}

// ---------------------------------------------------------------------------
// Revenue chart
// ---------------------------------------------------------------------------
export type RevPoint = { key: string; label: string; so: number; iv: number; pr: number };
type WeeklyRow = { week: string; salesOrderSen: number; invoiceSen: number; productionSen: number };

/** Same rows the desktop chart plots; sen, not rounded, idle Sundays dropped. */
export function revenuePoints(weekly: WeeklyRow[], split: RevenueSplitResp | null | undefined, cat: RevCat): RevPoint[] {
  if (cat === "all") {
    return dropIdleSundays(weekly, (r) => r.week, (r) => [r.salesOrderSen, r.invoiceSen, r.productionSen]).map((r) => ({
      key: r.week, label: r.week.slice(5), so: r.salesOrderSen, iv: r.invoiceSen, pr: r.productionSen,
    }));
  }
  return dropIdleSundays(
    split?.revenue ?? [],
    (r) => r.bucket,
    (r) => [pickCat(r.salesOrder, cat), pickCat(r.invoice, cat), pickCat(r.production, cat)],
  ).map((r) => ({
    key: r.bucket, label: r.bucket.slice(5),
    so: pickCat(r.salesOrder, cat), iv: pickCat(r.invoice, cat), pr: pickCat(r.production, cat),
  }));
}

/** Nice axis: 4 steps, max a round multiple of the step. */
export function niceAxis(rawMax: number): { step: number; max: number } {
  const stepRaw = Math.max(1, rawMax) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= stepRaw) ?? 10 * mag);
  return { step, max: step * 4 };
}

// ---------------------------------------------------------------------------
// Order pipeline
// ---------------------------------------------------------------------------
/** Same-cohort funnel (dashboard-b: isMonthScoped is always true in the embed). */
export function pipelineOf(salesThisMonthSen: number, deliveredOfMonthOrdersSen: number) {
  const confirmed = salesThisMonthSen;
  const delivered = deliveredOfMonthOrdersSen;
  const outstanding = Math.max(0, confirmed - delivered);
  return { confirmed, delivered, outstanding, rate: confirmed > 0 ? (delivered / confirmed) * 100 : 0, max: Math.max(1, confirmed, delivered, outstanding) };
}

/** dashboard-b `perDay`: a month's buckets are days, a quarter / year's are weeks counted as 6 working days. */
export function perDayOf(periodKey: string, weekly: WeeklyRow[]) {
  const daily = /^\d{4}-\d{2}$/.test(periodKey);
  const live = weekly.filter((r) => r.salesOrderSen || r.invoiceSen || r.productionSen);
  const days = daily ? live.length : live.length * 6;
  if (days === 0) return null;
  const sum = (f: (r: WeeklyRow) => number) => live.reduce((a, r) => a + f(r), 0);
  return { days, orders: sum((r) => r.salesOrderSen) / days, production: sum((r) => r.productionSen) / days, invoiced: sum((r) => r.invoiceSen) / days };
}

export function perDayNote(p: { orders: number; production: number }): string {
  if (!(p.production > 0)) return "No production recorded in this period yet.";
  return p.orders > p.production
    ? `Orders arrive ${(((p.orders - p.production) / p.production) * 100).toFixed(0)}% faster than we produce — the queue grows by about ${rm(Math.round(p.orders - p.production))} a day.`
    : `We produce ${(((p.production - p.orders) / p.production) * 100).toFixed(0)}% more than comes in — the queue shrinks by about ${rm(Math.round(p.production - p.orders))} a day.`;
}

/** Order Pipeline "by status" rows, in the order an SO moves through them (dashboard-b PIPELINE_STATUSES). */
export const PIPELINE_STATUSES = [
  ["CONFIRMED", "Confirmed"],
  ["IN_PRODUCTION", "In production"],
  ["READY_TO_SHIP", "Ready to ship"],
  ["SHIPPED", "Shipped"],
  ["DELIVERED", "Delivered"],
  ["INVOICED", "Invoiced"],
  ["ON_HOLD", "On hold"],
] as const;

// ---------------------------------------------------------------------------
// Sales forecast (SalesOrdersView.tsx:147-207, same maths)
// ---------------------------------------------------------------------------
export type FcUnit = "month" | "quarter" | "year";
export type FcRow = {
  label: string; full: string; iso: string;
  actualSen: number; targetSen: number | null;
  hit: boolean | null; projected: boolean; inProgress: boolean;
};

export function forecastUnit(p: Period): FcUnit {
  return p.mode === "ytd" ? "year" : quarterOfPeriod(p) ? "quarter" : "month";
}

export function buildForecast(
  unit: FcUnit,
  invoices: { invoiceDate?: string | null; status: string; totalSen?: number | null }[],
  months: Record<string, { salesSen?: number }>,
  todayYmd: string,
): FcRow[] {
  const curYm = todayYmd.slice(0, 7);
  const keyOf = (ym: string) => (unit === "year" ? ym.slice(0, 4) : unit === "quarter" ? quarterKeyOf(ym) : ym);
  const labelOf = (k: string) => (unit === "year" ? k : unit === "quarter" ? `Q${k.slice(6)} ${k.slice(2, 4)}` : ymLabelShort(k));
  const fullOf = (k: string) => (unit === "year" ? k : unit === "quarter" ? `Q${k.slice(6)} ${k.slice(0, 4)}` : monthLabel(k));
  const curKey = keyOf(curYm);
  const actual = new Map<string, number>();
  for (const i of invoices) {
    if (i.status === "CANCELLED" || !i.invoiceDate) continue;
    const k = keyOf(String(i.invoiceDate).slice(0, 7));
    actual.set(k, (actual.get(k) ?? 0) + (Number(i.totalSen) || 0));
  }
  const target = new Map<string, number>();
  for (const [ym, m] of Object.entries(months)) {
    const sen = Number(m?.salesSen) || 0;
    if (!/^\d{4}-\d{2}$/.test(ym) || sen <= 0) continue;
    target.set(keyOf(ym), (target.get(keyOf(ym)) ?? 0) + sen);
  }
  const keys = [...new Set([...actual.keys(), ...target.keys(), curKey])].sort();
  const out: FcRow[] = keys.map((k) => {
    const t = target.get(k) ?? null;
    const v = actual.get(k) ?? 0;
    const past = k < curKey;
    const now = k === curKey;
    return {
      label: labelOf(k), full: fullOf(k), iso: k, actualSen: v, targetSen: t,
      hit: t == null || (!past && !now) ? null : v >= t ? true : now ? null : false,
      projected: !past && !now, inProgress: now,
    };
  });
  if (unit !== "month") return out;
  const at = out.findIndex((r) => r.inProgress);
  return out.slice(Math.max(0, at - 6), at + 7);
}

export type FcTone = "hit" | "missed" | "so-far" | "none" | "future";
export const fcTone = (r: FcRow): FcTone =>
  r.projected ? "future" : r.inProgress ? (r.targetSen != null && r.actualSen >= r.targetSen ? "hit" : "so-far")
    : r.targetSen == null ? "none" : r.actualSen >= r.targetSen ? "hit" : "missed";

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export type Aov = {
  customerName: string; bedframeAvgSen: number; bedframeUnits: number; sofaAvgSen: number; sofaSets: number; totalSen: number;
};
export type CustCat = "all" | "bedframe" | "sofa";
export const catRev = (a: Aov, cat: CustCat): number =>
  cat === "bedframe" ? a.bedframeAvgSen * a.bedframeUnits : cat === "sofa" ? a.sofaAvgSen * a.sofaSets : a.totalSen;

/** Rows the desktop table sorts: All keeps the server order, a category re-sorts and drops zero rows. */
export function customerRows(list: Aov[], cat: CustCat): { a: Aov; rev: number }[] {
  const rows = list.map((a) => ({ a, rev: catRev(a, cat) }));
  if (cat === "all") return rows;
  return rows.filter((r) => r.rev > 0).sort((x, y) => y.rev - x.rev);
}

export type Slice = { name: string; sen: number; color: string; share: number; tappable: boolean };

/** top N + "Others". `totalSen` is the server's all-customer total; Others = total - top N, never below 0. */
export function topPlusOthers(
  rows: { name: string; sen: number }[],
  totalSen: number,
  colors: readonly string[],
  topN: number,
  othersName: string,
): Slice[] {
  const top = rows.slice(0, topN);
  const topSum = top.reduce((s, r) => s + r.sen, 0);
  const others = Math.max(0, totalSen - topSum);
  const den = totalSen > 0 ? totalSen : topSum || 1;
  const out: Slice[] = top.map((r, i) => ({ name: r.name, sen: r.sen, color: colors[i % (colors.length - 1)], share: r.sen / den, tappable: true }));
  if (others > 0) out.push({ name: othersName, sen: others, color: colors[colors.length - 1], share: others / den, tappable: false });
  return out;
}

export type MonthAov = { month: string; bedframeAvgSen: number; bedframeUnits: number; sofaAvgSen: number; sofaSets: number };

// ---------------------------------------------------------------------------
// State / category (SalesOrdersView.tsx:211-276)
// ---------------------------------------------------------------------------
export type StateCatRow = {
  date: string | null; state: string | null; category: string | null; sku: string | null; name: string | null; qty: number; revenueSen: number;
};
export function attribute(rows: StateCatRow[]) {
  const states = new Map<string, { name: string; revenueSen: number; qty: number }>();
  const cats = new Map<string, { name: string; revenueSen: number; qty: number }>();
  for (const r of rows) {
    const st = r.state ?? "—";
    const ct = r.category ?? "—";
    const s = states.get(st) ?? { name: st, revenueSen: 0, qty: 0 };
    s.revenueSen += r.revenueSen; s.qty += r.qty; states.set(st, s);
    const c = cats.get(ct) ?? { name: ct, revenueSen: 0, qty: 0 };
    c.revenueSen += r.revenueSen; c.qty += r.qty; cats.set(ct, c);
  }
  const desc = (a: { revenueSen: number }, b: { revenueSen: number }) => b.revenueSen - a.revenueSen;
  return {
    states: [...states.values()].sort(desc),
    categories: [...cats.values()].sort(desc),
    total: rows.reduce((s, r) => s + r.revenueSen, 0),
  };
}

/** Products sold in one state or one category (desktop saleDrillRows). */
export function productsSold(rows: StateCatRow[], kind: "state" | "category", key: string) {
  const m = new Map<string, { sku: string; name: string; other: string; qty: number; revenueSen: number }>();
  for (const r of rows) {
    const hit = kind === "state" ? (r.state ?? "—") === key : (r.category ?? "—") === key;
    if (!hit) continue;
    const k = r.sku ?? "—";
    const e = m.get(k) ?? { sku: k, name: r.name ?? k, other: kind === "state" ? (r.category ?? "—") : (r.state ?? "—"), qty: 0, revenueSen: 0 };
    e.qty += r.qty; e.revenueSen += r.revenueSen; m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.revenueSen - a.revenueSen);
}

/**
 * Donut slices: the top 6 states, the rest folded into "Others". A lone 7th
 * state is listed on its own (an "Others · 1 state" slice would hide a name for
 * nothing); the percentages are identical either way.
 */
export function stateSlices(states: { name: string; revenueSen: number }[], total: number, colors: readonly string[]): Slice[] {
  const keep = states.length - 6 >= 2 ? 6 : Math.min(7, states.length);
  const top = states.slice(0, keep);
  const tail = states.slice(keep);
  const tailSen = tail.reduce((s, r) => s + r.revenueSen, 0);
  const den = total > 0 ? total : 1;
  const out: Slice[] = top.map((r, i) => ({ name: r.name, sen: r.revenueSen, color: colors[i % colors.length], share: r.revenueSen / den, tappable: true }));
  if (tailSen > 0) out.push({ name: "Others", sen: tailSen, color: colors[6], share: tailSen / den, tappable: false });
  return out;
}

// ---------------------------------------------------------------------------
// Donut geometry (v10 `arcPath`, 326x236 box)
// ---------------------------------------------------------------------------
export const DONUT = { w: 326, h: 236, ro: 82, ri: 58 } as const;
const pt = (r: number, a: number): [number, number] => [DONUT.w / 2 + r * Math.cos((a * Math.PI) / 180), DONUT.h / 2 + r * Math.sin((a * Math.PI) / 180)];
export function donutArcs(slices: Slice[]) {
  let ang = -90;
  return slices.map((s) => {
    const sweep = s.share * 360;
    const a0 = ang;
    const a1 = ang + sweep;
    ang = a1;
    const g = Math.min(1.2, (a1 - a0) / 3);
    const b0 = a0 + g / 2;
    const b1 = a1 - g / 2;
    const large = b1 - b0 > 180 ? 1 : 0;
    const [x0, y0] = pt(DONUT.ro, b0);
    const [x1, y1] = pt(DONUT.ro, b1);
    const [x2, y2] = pt(DONUT.ri, b1);
    const [x3, y3] = pt(DONUT.ri, b0);
    const d = `M${x0},${y0} A${DONUT.ro},${DONUT.ro} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${DONUT.ri},${DONUT.ri} 0 ${large} 0 ${x3},${y3} Z`;
    const mid = (a0 + a1) / 2;
    const [ex, ey] = pt(DONUT.ro + 3, mid);
    const [kx, ky] = pt(DONUT.ro + 12, mid);
    const right = Math.cos((mid * Math.PI) / 180) >= 0;
    return { slice: s, d, mid, label: s.share >= 0.05 ? { ex, ey, kx, ky, right, tx: right ? kx + 10 : kx - 10 } : null };
  });
}
export const cutName = (t: string): string => (t.length > 13 ? `${t.slice(0, 12)}…` : t);

/**
 * A donut label as one line, or two when the name cannot fit beside its percentage. Two lines wrap at a
 * space (the whole first words on line 1, the rest on line 2 with the percentage); a line that still does
 * not fit is shortened with "…". `twoLinesOk` is false when a neighbouring label is too close for two lines,
 * which falls back to one shortened line. The percentage is never dropped.
 */
export function wrapLabel(
  name: string, pct: string, room: number, measure: (t: string) => number, twoLinesOk: boolean,
): { lines: string[]; pctOnLast: true } {
  const pw = measure(` ${pct}`);
  if (measure(name) + pw <= room) return { lines: [name], pctOnLast: true };
  const single = { lines: [fitLabel(name, room - pw, measure)], pctOnLast: true as const };
  const words = name.split(" ").filter(Boolean);
  if (!twoLinesOk || words.length < 2) return single;
  let n = words.length - 1;
  while (n > 0 && measure(words.slice(0, n).join(" ")) > room) n--;
  const first = n > 0 ? words.slice(0, n).join(" ") : null;
  if (!first) return single;
  const rest = words.slice(n).join(" ");
  return { lines: [first, fitLabel(rest, room - pw, measure)], pctOnLast: true };
}

/**
 * The name as long as fits `maxPx` (measured, not counted in characters): the full name when it fits,
 * otherwise the longest leading part plus "…". Nothing is stripped from the middle or the end of what is
 * shown, so two customers that differ only in a legal suffix are still told apart by their start.
 */
export function fitLabel(name: string, maxPx: number, measure: (t: string) => number): string {
  if (measure(name) <= maxPx) return name;
  let n = name.length - 1;
  while (n > 3 && measure(`${name.slice(0, n).trimEnd()}…`) > maxPx) n--;
  return `${name.slice(0, n).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Problem tiles → destinations (Today's problems)
// ---------------------------------------------------------------------------
export type ProblemDest =
  | { kind: "route"; to: string; navGate: string; where: string }
  | { kind: "info"; where: string };

/**
 * Where a problem tile can really lead on the phone. Only routes that exist and
 * list the thing the tile counts are used. "Not in" and "Efficiency" are
 * computed from attendance / job-card data that no /m screen lists, so they open
 * an explanation sheet instead of pretending a list exists.
 */
export function problemDest(key: string): ProblemDest {
  switch (key) {
    case "overdue": return { kind: "route", to: "/m/production", navGate: "/production", where: "Production" };
    case "svc": return { kind: "route", to: "/m/servicecases", navGate: "/service-cases", where: "Service Cases" };
    case "absent": return { kind: "info", where: "Attendance" };
    default: return { kind: "info", where: "Worker efficiency" };
  }
}
