// Pure logic of the /m Home Operations view. No React, so node --test imports it
// (tests/m-home-operations.test.mjs).
//
// RULE (same as home-lib.ts): nothing here invents a business definition. Every
// figure is the desktop Operations tab's own (OperationsView.tsx and the cards it
// mounts), copied line-for-line where the desktop keeps it inside a component
// that cannot be imported. Where mobile deliberately differs the difference is
// named next to the code (costingFocusMonth in home-lib.ts is the main one).
//
// A section that the user may not read is DENIED, never an empty or a zero: the
// status helpers below are what every card branches on first.
import { dropIdleSundays } from "../../../../lib/idle-sundays";
import { formatCurrency } from "../../../../lib/utils";
import { parseDashPeriod } from "../../../../api/lib/dash-period";
import { inFocus, inPeriod, monthLabel, shiftMonth, type Period } from "../../../dashboards/dashboard-shared-lib";
import { DEPT_FLOOR, deptName } from "../../../dashboards/ops-floor-lib";
import { pickCat, type RevCat } from "../../../dashboard-b/revenue-split";

// ---------------------------------------------------------------------------
// Request lifecycle → one status per section
// ---------------------------------------------------------------------------
export type Status = "loading" | "error" | "denied" | "ready";
type SlotLike = { data: unknown; loading: boolean; failure: { status: number } | null };

/**
 * ready  = a settled answer is in hand (a failed REFRESH keeps the last answer)
 * denied = the client permission is missing, or the server said 401 / 403
 * error  = the last attempt failed for any other reason and nothing is in hand
 * loading = nothing settled yet
 * `allowed` is the client-side permission gate; the server stays the authority.
 */
export function slotStatus(s: SlotLike, allowed = true): Status {
  if (!allowed) return "denied";
  if (s.data != null) return "ready";
  if (s.failure) return s.failure.status === 401 || s.failure.status === 403 ? "denied" : "error";
  return "loading";
}

export type Avail = { live?: boolean; reason?: string } | undefined;

/**
 * One section of the dashboard feed. The server redacts a section the reader
 * may not see to null with `availability.<x>.live === false` and an
 * "insufficient permission" reason (dashboard-prototype.ts, the response
 * boundary). That is DENIED. A null section for any other reason is an error.
 */
export function sectionStatus(feed: Status, section: unknown, avail: Avail): { status: Status; reason?: string } {
  if (feed !== "ready") return { status: feed };
  if (section != null) return { status: "ready" };
  if (avail && avail.live === false && /permission/i.test(avail.reason ?? "")) return { status: "denied", reason: avail.reason };
  return { status: "error", reason: avail?.reason };
}

// ---------------------------------------------------------------------------
// Feed types (the fields the desktop Operations tab reads)
// ---------------------------------------------------------------------------
export type ProdOrder = {
  poNo: string | null; customer: string | null; productName: string | null; currentDept: string | null;
  daysToDD: number | null; stagesDone: number; stagesTotal: number; risk?: string;
};
export type DailySlice = {
  orders: { byDay: { date: string; planOrders: number; planUnits: number; actualOrders: number; actualUnits: number }[]; withoutTarget: number };
  stages: { byDay: { date: string; dept: string; plan: number; actual: number }[] };
};
export type OpsFeed = {
  success?: boolean;
  availability?: Record<string, Avail>;
  production?: { orders: ProdOrder[]; dueSoon3Days: ProdOrder[] } | null;
  inventory?: { materialShortage: { code: string | null; description: string | null; group: string | null; balanceQty: number }[] } | null;
  lim?: DailySlice | null;
};
export type JobsBreakdown = { bedframeUnits: number; sofaSets: number; byCustomer: { customer: string; bedframeUnits: number; sofaSets: number }[] };
export type FabricCat = {
  list: { fabCode: string; meters: number; past30Meters: number; next30Meters: number; buyAvgSen: number; buyMinSen: number; buyMaxSen: number }[];
  monthly: { month: string; meters: number; lateMeters?: number; costSen?: number }[];
};
export type OpsOverview = {
  success?: boolean;
  production?: {
    dailyCapacityMin: number; backlogMin: number; backlogDays: number;
    activeJobs: JobsBreakdown; completedYesterday: JobsBreakdown;
    completedLast7: { date: string; bedframeUnits: number; sofaSets: number }[];
    completedRange?: { bedframeUnits: number; sofaSets: number };
    capacityDays: { date: string; minutes: number; workers: number }[];
    backlogByDept: { dept: string; sofaMin: number; bedframeMin: number; totalMin: number; dailyCapMin: number; backlogDays: number | null }[];
    backlogGrandMin: number;
  };
  purchasing?: { openPOCount: number; outstandingPOValueSen: number; itemsPendingReceipt: number };
  fabricCostPerMeterSen?: { total: number; exclBedframeSofa: number; bedframe: number; sofa: number };
  fabric?: { BEDFRAME: FabricCat; SOFA: FabricCat };
  employee?: { activeHeadcount: number };
  stateSnapshot?: { source: "live" | "snapshot" | "reconstructed"; isHistorical: boolean; asOf: string | null };
};

// ---------------------------------------------------------------------------
// Number / text
// ---------------------------------------------------------------------------
export const n0 = (n: number | null | undefined): string => Math.round(n ?? 0).toLocaleString("en-MY");
/** "7h 05m" (the approved design's minute format). */
export const hm = (min: number | null | undefined): string => {
  const m = Math.max(0, Math.round(min ?? 0));
  return `${Math.floor(m / 60).toLocaleString("en-MY")}h ${String(m % 60).padStart(2, "0")}m`;
};
/** "170 h" (the approved design's hour format). */
export const hrs = (min: number | null | undefined): string => `${Math.round((min ?? 0) / 60).toLocaleString("en-MY")} h`;
/** Chart axis money: 232k / 1.2M (sen in). */
export const axisRm = (sen: number): string => {
  const v = sen / 100;
  return v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
};
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon 30" for a YYYY-MM-DD day. */
export const weekdayDay = (iso: string): string => { const [y, m, d] = iso.split("-").map(Number); return `${WD[new Date(y, m - 1, d).getDay()]} ${d}`; };
/** "Mon 20 Oct" for a YYYY-MM-DD day. */
export const weekdayDayMonth = (iso: string): string => { const [y, m, d] = iso.split("-").map(Number); return `${WD[new Date(y, m - 1, d).getDay()]} ${d} ${monthLabel(`${y}-${String(m).padStart(2, "0")}`).slice(0, 3)}`; };
export const pct1 = (v: number | null): string => (v == null || Number.isNaN(v) ? "—" : `${v.toFixed(1)}%`);
export const pctOf = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

// ---------------------------------------------------------------------------
// 1 · Daily Report
// ---------------------------------------------------------------------------
/** The 14 chip categories, in the desktop's declaration order (dashboard-b/index.tsx). pendingTimeAdjustments is in the total, never a chip. */
export const DR_CHECKS = [
  ["overdueOrders", "Overdue"],
  ["soNoInvoice", "SO not invoiced"],
  ["pricingIssues", "Pricing issues"],
  ["cogsIssues", "COGS issues"],
  ["doNotInvoiced", "DO not invoiced"],
  ["doPendingDispatch", "DO pending dispatch"],
  ["doNotDelivered", "DO not delivered"],
  ["soNoDo", "SO no DO"],
  ["poNotReceived", "PO not received"],
  ["lowEfficiencyWorkers", "Low efficiency"],
  ["processSkips", "Process skips"],
  ["missingWipTimes", "Missing WIP times"],
  ["incompleteBoms", "Incomplete BOMs"],
  ["rdStalled", "R&D stalled"],
] as const;
export type DrKey = (typeof DR_CHECKS)[number][0];

export type ComplianceData = {
  counts: Partial<Record<DrKey | "pendingTimeAdjustments", number | null>> & { total: number; checksRun?: number; checksTotal?: number };
  unavailable?: { check: string; message: string }[];
  groups?: Partial<Record<DrKey | "pendingTimeAdjustments", unknown[]>>;
};

export type DrSummary = {
  total: number; partial: boolean; failed: number; checksTotal: number;
  top: { key: DrKey; label: string; n: number }[];
  /** Issues that are in the headline total but not in a shown tile. */
  other: number;
  clear: boolean;
};

/** Headline, top-four non-zero tiles by count (ties keep declaration order), and the partial-sweep facts. */
export function drSummary(d: ComplianceData): DrSummary {
  const failed = d.unavailable?.length ?? 0;
  const top = DR_CHECKS
    .map(([key, label]) => ({ key, label, n: d.counts[key] ?? 0 }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  const total = d.counts.total ?? 0;
  return {
    total, failed, partial: failed > 0, checksTotal: d.counts.checksTotal ?? 15, top,
    other: Math.max(0, total - top.reduce((a, c) => a + c.n, 0)),
    clear: total === 0 && failed === 0,
  };
}

/** What each check looks at, in words that carry no threshold (the grace days are server config). */
export const DR_RULE: Record<DrKey, string> = {
  overdueOrders: "Sales orders past the customer's delivery date",
  soNoInvoice: "Sales orders with no invoice",
  pricingIssues: "Pricing integrity problems",
  cogsIssues: "Delivered units with no cost behind them",
  doNotInvoiced: "Delivered delivery orders with no invoice",
  doPendingDispatch: "Delivery orders created and not yet dispatched",
  doNotDelivered: "Dispatched delivery orders not yet delivered",
  soNoDo: "Sales orders with no delivery order",
  poNotReceived: "Purchase orders not yet received",
  lowEfficiencyWorkers: "Workers under the efficiency band",
  processSkips: "Orders where a later stage finished before an earlier one",
  missingWipTimes: "Products with no WIP time for a department",
  incompleteBoms: "Products with an incomplete bill of materials",
  rdStalled: "R&D projects past their target launch date",
};

export type DrRow = { key: string; ref: string; sub: string; right: string; rightSub: string; link: { kind: "so" | "do"; id: string } | null };
type R = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));
const days = (v: unknown): string => (v == null || v === "" ? "" : `${s(v)} d`);

/** Item rows of one check, using only the fields compliance-report.ts returns for it (no urgency or status is derived). */
export function drRows(key: DrKey, groups: ComplianceData["groups"]): DrRow[] {
  const rows = (groups?.[key] ?? []) as R[];
  return rows.map((r, i): DrRow => {
    const k = `${key}-${s(r.id ?? r.productionOrderId ?? r.salesOrderId ?? r.ref ?? r.productCode ?? r.doNo ?? r.name)}-${i}`;
    switch (key) {
      case "doPendingDispatch": return { key: k, ref: s(r.doNo), sub: s(r.customerName), right: days(r.daysWaiting), rightSub: "waiting", link: r.id ? { kind: "do", id: s(r.id) } : null };
      case "doNotDelivered": return { key: k, ref: s(r.doNo), sub: s(r.customerName), right: days(r.daysSinceDispatch), rightSub: "since dispatch", link: r.id ? { kind: "do", id: s(r.id) } : null };
      case "doNotInvoiced": return { key: k, ref: s(r.doNo), sub: s(r.customerName), right: days(r.daysSinceDelivered), rightSub: "since delivery", link: r.id ? { kind: "do", id: s(r.id) } : null };
      case "soNoDo":
      case "soNoInvoice": return { key: k, ref: s(r.companySOId), sub: s(r.customerName), right: days(r.days), rightSub: s(r.status), link: r.id ? { kind: "so", id: s(r.id) } : null };
      case "overdueOrders": return { key: k, ref: s(r.companySOId), sub: [s(r.customerName), s(r.productSummary)].filter(Boolean).join(" · "), right: days(r.daysOverdue), rightSub: s(r.status), link: r.salesOrderId ? { kind: "so", id: s(r.salesOrderId) } : null };
      case "poNotReceived": return { key: k, ref: s(r.poNo), sub: s(r.supplierName), right: days(r.daysOpen), rightSub: s(r.status), link: null };
      case "lowEfficiencyWorkers": return { key: k, ref: s(r.name), sub: s(r.departmentName), right: r.efficiencyPct == null ? "" : `${Math.round(Number(r.efficiencyPct))}%`, rightSub: "efficiency", link: null };
      case "processSkips": return { key: k, ref: s(r.poNo), sub: s(r.productName), right: days(r.days), rightSub: [s(r.doneDept) && `${s(r.doneDept)} done`, s(r.blockedByDept) && `${s(r.blockedByDept)} ${s(r.blockedByStatus)}`.trim()].filter(Boolean).join(" · "), link: r.salesOrderId ? { kind: "so", id: s(r.salesOrderId) } : null };
      case "missingWipTimes": return { key: k, ref: s(r.productCode), sub: s(r.productName), right: s(r.departmentCode), rightSub: "", link: null };
      case "incompleteBoms": return { key: k, ref: s(r.productCode), sub: s(r.productName), right: "", rightSub: s(r.reason), link: null };
      case "rdStalled": return { key: k, ref: s(r.name), sub: s(r.currentStage), right: days(r.daysOverdue), rightSub: s(r.status), link: null };
      case "pricingIssues": return { key: k, ref: s(r.ref), sub: s(r.detail), right: r.amountSen == null ? "" : formatCurrency(Math.round(Number(r.amountSen))), rightSub: s(r.kind), link: null };
      case "cogsIssues": return { key: k, ref: s(r.doNo), sub: s(r.customerName), right: r.uncostedQty == null ? "" : `${s(r.uncostedQty)} of ${s(r.deliveredQty)}`, rightSub: "units uncosted", link: null };
    }
  });
}

// ---------------------------------------------------------------------------
// 2 · Department Revenue (revenue-split)
// ---------------------------------------------------------------------------
export type CatSplit = { bedframe: number; sofa: number; accessory: number; unclassified: number; total: number };
export type SplitResp = {
  period?: string;
  granularity?: "day" | "week" | "month";
  revenue?: { bucket: string; production: CatSplit }[];
  departments?: { code: string; label: string; period: CatSplit; byBucket: CatSplit[] }[];
};
export type OpsRevCat = Extract<RevCat, "all" | "bedframe" | "sofa">;

/** Index of the picked day in a per-day split; -1 unless the split is daily (a month). Same rule as dayBucketIndex. */
export const splitDayIndex = (d: SplitResp | null | undefined, day: string | undefined): number =>
  !day || d?.granularity !== "day" ? -1 : (d.revenue ?? []).findIndex((r) => r.bucket === day);

export type DeptRevRow = { code: string; label: string; value: number; frac: number };
/**
 * One row per department in the order the API returns (the desktop's fixed floor order,
 * which the desktop card does not re-sort). The value is the picked day's when the split is
 * daily and the day is in it, else the whole period's. Departments are never summed.
 */
export function deptRevenueRows(d: SplitResp | null | undefined, cat: OpsRevCat, day: string | undefined): DeptRevRow[] {
  const di = splitDayIndex(d, day);
  const rows = (d?.departments ?? []).map((x) => ({
    code: x.code, label: x.label,
    value: pickCat(di >= 0 ? x.byBucket[di] ?? undefined : x.period, cat),
  }));
  const max = Math.max(0, ...rows.map((r) => r.value));
  return rows.map((r) => ({ ...r, frac: max > 0 ? r.value / max : 0 }));
}

/** The buckets of one department for its sheet, with the label the API's granularity calls for. */
export function deptBuckets(d: SplitResp, code: string, cat: OpsRevCat): { bucket: string; label: string; value: number; pickable: boolean }[] {
  const dept = (d.departments ?? []).find((x) => x.code === code);
  const g = d.granularity ?? "day";
  return (d.revenue ?? []).map((r, i) => ({
    bucket: r.bucket,
    label: g === "month" ? monthLabel(r.bucket.slice(0, 7)).slice(0, 3) : g === "week" ? `${Number(r.bucket.slice(8, 10))} ${monthLabel(r.bucket.slice(0, 7)).slice(0, 3)}` : String(Number(r.bucket.slice(8, 10))),
    value: pickCat(dept?.byBucket[i], cat),
    pickable: g === "day",
  }));
}
export const bucketWord = (g: SplitResp["granularity"]): string => (g === "month" ? "month" : g === "week" ? "week" : "day");

// ---------------------------------------------------------------------------
// 3 · Plant Load + 4 · Department Backlog (overview.production)
// ---------------------------------------------------------------------------
export const GAUGE = { red: "#DC2626", gold: "#C9A24B", green: "#15803D" } as const;
/** Desktop gauge: queue days vs the 14-day buffer; red over 12 days, gold over 7 (dashboard-b/index.tsx). */
export function plantGauge(backlogDays: number): { util: number; pct: number; color: string } {
  const util = Math.min(1, backlogDays / 14);
  return { util, pct: Math.round(util * 100), color: backlogDays > 12 ? GAUGE.red : backlogDays > 7 ? GAUGE.gold : GAUGE.green };
}

export type StateTag = { kind: "asof" | "reconstructed" | "live-no-history"; text: string } | null;
/** The point-in-time tag of Plant Load / Backlog, from stateSnapshot (the desktop's three cases). */
export function stateTag(snap: OpsOverview["stateSnapshot"]): StateTag {
  if (!snap) return null;
  if (snap.source === "snapshot") return { kind: "asof", text: `as of ${snap.asOf ?? ""}`.trim() };
  if (snap.source === "reconstructed") return { kind: "reconstructed", text: `≈ reconstructed (month-end est.)${snap.asOf ? ` · as of ${snap.asOf}` : ""}` };
  return snap.isHistorical ? { kind: "live-no-history", text: "live (no history before today)" } : null;
}

/** "14-day avg" for the current month, else "<period> avg" (the desktop's wording). */
export function capacityWindowLabel(periodKey: string, curYm: string): string {
  return periodKey === curYm ? "14-day avg" : `${periodKey} avg`;
}

/** Average capacity per worker: avg/day ÷ avg workers over days that credit a worker (desktop). */
export function perWorkerMin(capacityDays: { minutes: number; workers: number }[], dailyCapacityMin: number): number | null {
  const w = capacityDays.filter((d) => (d.workers ?? 0) > 0);
  if (!w.length) return null;
  const avg = w.reduce((a, d) => a + d.workers, 0) / w.length;
  return avg > 0 ? Math.round(dailyCapacityMin / avg) : null;
}

export type BacklogRow = { dept: string; sofaMin: number; bedframeMin: number; totalMin: number; dailyCapMin: number; days: number | null; sofaDays: number; bedDays: number; shown: number | null };
/**
 * Backlog rows in the server's order (stalled first, then most days). The bars are scaled by
 * DAYS (minutes ÷ the department's daily capacity), as on the desktop; hiding a category
 * re-sums the days of what is left, and a stalled department stays stalled.
 */
export function backlogRows(rows: NonNullable<OpsOverview["production"]>["backlogByDept"], showSofa: boolean, showBed: boolean): BacklogRow[] {
  return rows.map((d) => {
    const cap = d.dailyCapMin;
    const sofaDays = cap > 0 ? d.sofaMin / cap : 0;
    const bedDays = cap > 0 ? d.bedframeMin / cap : 0;
    const both = showSofa && showBed;
    const shown = d.backlogDays == null ? null : both ? d.backlogDays : Math.round(((showSofa ? sofaDays : 0) + (showBed ? bedDays : 0)) * 10) / 10;
    return { dept: d.dept, sofaMin: d.sofaMin, bedframeMin: d.bedframeMin, totalMin: d.totalMin, dailyCapMin: cap, days: d.backlogDays, sofaDays, bedDays, shown };
  });
}

/** The headline of the Completed drill: all-time is not offered on mobile, so it is the period's running total (the server's deduped range total first). */
export function completedHead(p: NonNullable<OpsOverview["production"]>): { bedframe: number; sofa: number } {
  return {
    bedframe: p.completedRange?.bedframeUnits ?? p.completedLast7.reduce((a, d) => a + (d.bedframeUnits || 0), 0),
    sofa: p.completedRange?.sofaSets ?? p.completedLast7.reduce((a, d) => a + (d.sofaSets || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// 5 · Overdue production orders / 6 · Due within 3 days (prototype feed)
// ---------------------------------------------------------------------------
export const allStagesDone = (o: ProdOrder): boolean => o.stagesTotal > 0 && o.stagesDone >= o.stagesTotal;
export const deptKey = (o: ProdOrder): string => o.currentDept || "(no dept)";

/** Risk "critical" = past the customer's date; most late first. live = still being made; done = every stage finished, status not closed. */
export function overdueSplit(orders: ProdOrder[]): { live: ProdOrder[]; done: ProdOrder[] } {
  const late = orders.filter((o) => o.risk === "critical").sort((a, b) => (a.daysToDD ?? 0) - (b.daysToDD ?? 0));
  return { live: late.filter((o) => !allStagesDone(o)), done: late.filter(allStagesDone) };
}
export const staleCount = (orders: ProdOrder[]): number => orders.filter((o) => (o.daysToDD ?? 0) < -60).length;

/** Every production department even at zero, in floor order, then any other code present. */
export function deptChips(orders: ProdOrder[]): { key: string; label: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const o of orders) counts.set(deptKey(o), (counts.get(deptKey(o)) ?? 0) + 1);
  const codes = [...DEPT_FLOOR.map(([c]) => c as string), ...[...counts.keys()].filter((c) => !DEPT_FLOOR.some(([k]) => k === c))];
  return codes.map((c) => ({ key: c, label: deptName(c), n: counts.get(c) ?? 0 }));
}
export function filterOrders(orders: ProdOrder[], dept: string, search: string): ProdOrder[] {
  const q = search.trim().toLowerCase();
  return orders
    .filter((o) => dept === "ALL" || deptKey(o) === dept)
    .filter((o) => !q || [o.poNo, o.customer, o.productName].some((v) => (v ?? "").toLowerCase().includes(q)));
}

export const DUE_LANES = [
  { d: 0, label: "Due today", urgent: true },
  { d: 1, label: "Tomorrow", urgent: true },
  { d: 2, label: "In 2 days", urgent: false },
  { d: 3, label: "In 3 days", urgent: false },
] as const;
/** The desktop's urgency pill: red up to tomorrow, amber for 2-3 days. */
export function duePill(daysLeft: number | null): { label: string; urgent: boolean | null } {
  if (daysLeft == null) return { label: "—", urgent: null };
  if (daysLeft <= 1) return { label: daysLeft <= 0 ? "Today" : "1 Day", urgent: true };
  return { label: `${daysLeft} Days`, urgent: false };
}
export const dueSorted = (orders: ProdOrder[]): ProdOrder[] => [...orders].sort((a, b) => (a.daysToDD ?? 0) - (b.daysToDD ?? 0));

// ---------------------------------------------------------------------------
// 11 · Material shortage
// ---------------------------------------------------------------------------
export function shortageSummary(rows: NonNullable<OpsFeed["inventory"]>["materialShortage"]) {
  const all = [...rows].sort((a, b) => a.balanceQty - b.balanceQty);
  return { all, negative: all.filter((m) => m.balanceQty < 0).length, zero: all.filter((m) => m.balanceQty === 0).length };
}

// ---------------------------------------------------------------------------
// 8 · Costing vs production revenue
// ---------------------------------------------------------------------------
export type Bucket = { revenue: number; material: number; labour: number; purchases: number };
export const ZERO: Bucket = { revenue: 0, material: 0, labour: 0, purchases: 0 };
export type CostStructure = { data?: { cols?: string[]; groups?: { group?: string; description?: string; months?: ({ opening?: number; purchase?: number; closing?: number } | null)[] }[] } };
export type Pi = { piNo?: string | null; invoiceDate: string | null; dueDate?: string | null; amountSen: number | string | null; paidAmountSen?: number | string | null; status: string; supplierName?: string | null };

/** Months the summary needs: the focus month and the three before it, plus every month of the year on a year view; never beyond today. */
export function costingMonths(focusMonth: string, ytd: boolean, today: string): string[] {
  const set = new Set<string>();
  for (let i = 0; i <= 3; i++) set.add(shiftMonth(focusMonth, -i));
  if (ytd) for (let m = 1; m <= 12; m++) set.add(`${focusMonth.slice(0, 4)}-${String(m).padStart(2, "0")}`);
  return [...set].filter((m) => m <= today.slice(0, 7)).sort();
}

/** The P&L's materials used per finished month: opening + purchases − closing, summed over the purchase accounts. The running month has no closing stock and is left out (estimated instead). */
export function pnlMaterials(sets: (CostStructure | null | undefined)[], today: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const cs of sets) {
    (cs?.data?.cols ?? []).forEach((ym, i) => {
      if (ym >= today.slice(0, 7)) return;
      let used = 0;
      let any = false;
      for (const g of cs?.data?.groups ?? []) {
        const m = g.months?.[i];
        if (!m) continue;
        any = true;
        used += (m.opening ?? 0) + (m.purchase ?? 0) - (m.closing ?? 0);
      }
      if (any) out.set(ym, used);
    });
  }
  return out;
}

export function materialLines(sets: (CostStructure | null | undefined)[], ym: string) {
  const out: { code: string; name: string; opening: number; purchase: number; closing: number }[] = [];
  for (const cs of sets) {
    const i = (cs?.data?.cols ?? []).indexOf(ym);
    if (i < 0) continue;
    for (const g of cs?.data?.groups ?? []) {
      const m = g.months?.[i];
      if (!m) continue;
      out.push({ code: g.group ?? "", name: g.description ?? "", opening: m.opening ?? 0, purchase: m.purchase ?? 0, closing: m.closing ?? 0 });
    }
  }
  return out.filter((r) => r.opening || r.purchase || r.closing).sort((a, b) => (b.opening + b.purchase - b.closing) - (a.opening + a.purchase - a.closing));
}

/** Everything per day (desktop CostingPanel `byDay`): revenue, materials at the month's P&L ratio (the running month at the last finished month's), labour, purchases. */
export function costingByDay(a: {
  revByDay: Map<string, { total: number }>; pnl: Map<string, number>; labourByDay: Map<string, number>; pis: Pi[]; from: string; to: string;
}): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  const add = (key: string, k: keyof Bucket, v: number) => { const b = m.get(key) ?? { ...ZERO }; b[k] += v; m.set(key, b); };
  for (const [d, v] of a.revByDay) if (d >= a.from && d <= a.to) add(d, "revenue", v.total);
  const revByMonth = new Map<string, number>();
  for (const [d, v] of a.revByDay) revByMonth.set(d.slice(0, 7), (revByMonth.get(d.slice(0, 7)) ?? 0) + v.total);
  const finished = [...a.pnl.keys()].sort();
  const ratioOf = (ym: string) => {
    const known = a.pnl.get(ym);
    const r = revByMonth.get(ym) ?? 0;
    if (known != null) return r > 0 ? known / r : 0;
    const last = [...finished].reverse().find((f) => f < ym && (revByMonth.get(f) ?? 0) > 0);
    return last ? (a.pnl.get(last) ?? 0) / (revByMonth.get(last) ?? 1) : 0;
  };
  for (const [d, v] of a.revByDay) if (d >= a.from && d <= a.to) add(d, "material", v.total * ratioOf(d.slice(0, 7)));
  for (const [d, v] of a.labourByDay) add(d, "labour", v);
  for (const p of a.pis) {
    const d = String(p.invoiceDate ?? "").slice(0, 10);
    if (p.status === "CANCELLED" || d < a.from || d > a.to) continue;
    add(d, "purchases", Number(p.amountSen) || 0);
  }
  return m;
}

/** `workerId|date` → sen (use-labour-cost) rolled up to date → sen. */
export function labourPerDay(byWorkerDay: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of byWorkerDay) { const d = k.slice(k.indexOf("|") + 1); out.set(d, (out.get(d) ?? 0) + v); }
  return out;
}

export function rollUpMonths(byDay: Map<string, Bucket>): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  for (const [d, b] of byDay) {
    const key = d.slice(0, 7);
    const cur = m.get(key) ?? { ...ZERO };
    (Object.keys(b) as (keyof Bucket)[]).forEach((k) => { cur[k] += b[k]; });
    m.set(key, cur);
  }
  return m;
}

export type CostCol = { label: string; sub: string; b: Bucket; avg?: boolean; ym?: string };
/** The summary rows of the card: [the picked day], the focus month, last month, the 3 months before as an average (desktop, line for line). */
export function costingCols(a: { byDay: Map<string, Bucket>; byMonth: Map<string, Bucket>; focusMonth: string; day?: string; today: string; estimated: (ym: string) => boolean }): CostCol[] {
  const prev = shiftMonth(a.focusMonth, -1);
  const three = [1, 2, 3].map((i) => a.byMonth.get(shiftMonth(a.focusMonth, -i)) ?? ZERO);
  const sum = three.reduce<Bucket>((x, y) => ({ revenue: x.revenue + y.revenue, material: x.material + y.material, labour: x.labour + y.labour, purchases: x.purchases + y.purchases }), { ...ZERO });
  const isCurrent = a.focusMonth === a.today.slice(0, 7);
  const est = a.estimated(a.focusMonth) ? " · materials est." : "";
  return [
    ...(a.day ? [{ label: a.day.slice(5).replace("-", "/"), sub: "the selected day", b: a.byDay.get(a.day) ?? ZERO }] : []),
    { label: monthLabel(a.focusMonth), sub: isCurrent ? `to date · live${est}` : `whole month${est}`, b: a.byMonth.get(a.focusMonth) ?? ZERO, ym: a.focusMonth },
    { label: monthLabel(prev), sub: "last month", b: a.byMonth.get(prev) ?? ZERO, ym: prev },
    { label: "3-month avg", sub: `${monthLabel(shiftMonth(a.focusMonth, -3))} – ${monthLabel(prev)}`, b: { revenue: sum.revenue / 3, material: sum.material / 3, labour: sum.labour / 3, purchases: sum.purchases / 3 }, avg: true },
  ];
}
export const costOf = (b: Bucket, withLabour: boolean): number => b.material + (withLabour ? b.labour : 0);

/** Cost % per day of the period (idle Sundays out) for the read-only sparkline; per month on a year view. */
export function costTrend(a: { byDay: Map<string, Bucket>; byMonth: Map<string, Bucket>; period: Period; months: string[]; focusMonth: string; withLabour: boolean }): { key: string; pct: number | null }[] {
  if (a.period.mode === "ytd") {
    return a.months.filter((m) => m.slice(0, 4) === a.focusMonth.slice(0, 4)).map((m) => {
      const b = a.byMonth.get(m) ?? ZERO;
      return { key: m, pct: pctOf(costOf(b, a.withLabour), b.revenue) };
    });
  }
  const dayKeys = [...a.byDay.keys()].filter((d) => inPeriod(a.period, d)).sort();
  return dropIdleSundays(dayKeys.map((d) => ({ d, b: a.byDay.get(d)! })), (x) => x.d, (x) => [x.b.revenue, x.b.material, x.b.labour])
    .map(({ d, b }) => ({ key: d, pct: pctOf(costOf(b, a.withLabour), b.revenue) }));
}

// ---------------------------------------------------------------------------
// 9 · Plan vs actual (feed.lim)
// ---------------------------------------------------------------------------
export type PlanMetric = "units" | "orders";
export type PlanRow = { iso: string; label: string; plan: number; actual: number };
/** One bar per day (per month on a year view), only inside the period; the picked day does not narrow the chart (desktop `bucket`). */
export function planBars(lim: DailySlice, period: Period, metric: PlanMetric): PlanRow[] {
  const rows = lim.orders.byDay.filter((d) => inPeriod(period, d.date));
  const pick = (r: (typeof rows)[number]) => ({ plan: metric === "units" ? r.planUnits : r.planOrders, actual: metric === "units" ? r.actualUnits : r.actualOrders });
  if (period.mode !== "ytd") return rows.map((r) => ({ iso: r.date, label: r.date.slice(5), ...pick(r) }));
  const m = new Map<string, PlanRow>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    const cur = m.get(key) ?? { iso: key, label: key, plan: 0, actual: 0 };
    const v = pick(r);
    cur.plan += v.plan; cur.actual += v.actual;
    m.set(key, cur);
  }
  return [...m.values()];
}
export type PlanCum = PlanRow & { duePlan: number; done: number | null };
/** The two lines the plan chart draws, one point per bar: plan and actual (actual is null after today); running totals when `cumulative`. */
export function planSeries(bars: PlanRow[], todayIso: string, cumulative: boolean): { plan: number[]; actual: (number | null)[] } {
  if (!cumulative) return { plan: bars.map((b) => b.plan), actual: bars.map((b) => (b.iso > todayIso ? null : b.actual)) };
  const cum = planCumulative(bars, todayIso);
  return { plan: cum.map((c) => c.duePlan), actual: cum.map((c) => c.done) };
}
export function planCumulative(bars: PlanRow[], todayIso: string): PlanCum[] {
  let p = 0;
  let a = 0;
  return bars.map((b) => { p += b.plan; a += b.actual; return { ...b, duePlan: p, done: b.iso > todayIso ? null : a }; });
}
export function planTotals(lim: DailySlice, period: Period) {
  return lim.orders.byDay.filter((d) => inFocus(period, d.date)).reduce(
    (a, d) => ({ po: a.po + d.planOrders, pu: a.pu + d.planUnits, ao: a.ao + d.actualOrders, au: a.au + d.actualUnits }),
    { po: 0, pu: 0, ao: 0, au: 0 },
  );
}
/** Stage plan vs actual per department: plan counts only cards due by today (desktop). */
export function stageRows(lim: DailySlice, period: Period, todayIso: string): { dept: string; plan: number; actual: number }[] {
  const m = new Map<string, { dept: string; plan: number; actual: number }>();
  for (const r of lim.stages.byDay) {
    if (!inFocus(period, r.date)) continue;
    const e = m.get(r.dept) ?? { dept: r.dept, plan: 0, actual: 0 };
    if (r.date <= todayIso) e.plan += r.plan;
    e.actual += r.actual;
    m.set(r.dept, e);
  }
  return [...m.values()].sort((a, b) => a.dept.localeCompare(b.dept));
}

// ---------------------------------------------------------------------------
// 10 · Purchasing
// ---------------------------------------------------------------------------
export function purchasingMonths(key: string, today: string) {
  const d = parseDashPeriod(key);
  const months = d.months.length ? d.months.filter((m) => m <= today.slice(0, 7)) : [today.slice(0, 7)];
  const prevMonths = d.prevMonths.length ? d.prevMonths : [shiftMonth(today.slice(0, 7), -1)];
  const lastYm = months[months.length - 1];
  const trendMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(lastYm, i - 5));
  const revMonths = [...new Set([...[1, 2, 3].map((i) => shiftMonth(trendMonths[0], -i)), ...trendMonths, ...months, ...prevMonths])].filter((m) => m <= today.slice(0, 7)).sort();
  return { months, prevMonths, lastYm, trendMonths, revMonths };
}

export function purchasingCalc(a: { pis: Pi[]; revByDay: Map<string, { total: number }> | null; months: string[]; prevMonths: string[]; trendMonths: string[] }) {
  const pis = a.pis.filter((p) => p.status !== "CANCELLED");
  const spendBy = new Map<string, number>();
  const supplier = new Map<string, { sen: number; n: number }>();
  for (const p of pis) {
    const amt = Number(p.amountSen) || 0;
    const ym = String(p.invoiceDate ?? "").slice(0, 7);
    spendBy.set(ym, (spendBy.get(ym) ?? 0) + amt);
    if (a.months.includes(ym)) {
      const k = p.supplierName || "—";
      const sv = supplier.get(k) ?? { sen: 0, n: 0 };
      sv.sen += amt; sv.n += 1;
      supplier.set(k, sv);
    }
  }
  const revOf = (ms: string[]) => ms.reduce((acc, m) => {
    let t = 0;
    for (const [d, v] of a.revByDay ?? []) if (d.startsWith(m)) t += v.total;
    return acc + t;
  }, 0);
  const spend = a.months.reduce((x, m) => x + (spendBy.get(m) ?? 0), 0);
  const prevSpend = a.prevMonths.reduce((x, m) => x + (spendBy.get(m) ?? 0), 0);
  const rev = revOf(a.months);
  const prevRev = revOf(a.prevMonths);
  const shareOf = (m: string) => { const r = revOf([m]); return r > 0 ? (spendBy.get(m) ?? 0) / r : null; };
  const trend = a.trendMonths.map((m) => {
    const r = revOf([m]);
    const sp = spendBy.get(m) ?? 0;
    const prior = [1, 2, 3].map((i) => shareOf(shiftMonth(m, -i))).filter((x): x is number => x != null);
    const rate = prior.length ? prior.reduce((x, y) => x + y, 0) / prior.length : null;
    return { ym: m, spend: sp, expected: rate == null ? null : r * rate, share: r > 0 ? (sp / r) * 100 : null, rev: r };
  });
  return {
    spend, prevSpend, rev, prevRev, trend,
    change: prevSpend > 0 ? ((spend - prevSpend) / prevSpend) * 100 : null,
    share: rev > 0 ? (spend / rev) * 100 : null,
    prevShare: prevRev > 0 ? (prevSpend / prevRev) * 100 : null,
    top: [...supplier.entries()].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.sen - x.sen).slice(0, 6),
    periodPis: pis.filter((p) => a.months.includes(String(p.invoiceDate ?? "").slice(0, 7))).sort((x, y) => String(y.invoiceDate).localeCompare(String(x.invoiceDate))),
  };
}

/** Latest finished month with a stock take (non-zero closing), and the one before it. */
export function stockTake(cs: CostStructure | null | undefined, today: string) {
  const cols = cs?.data?.cols ?? [];
  const groups = cs?.data?.groups ?? [];
  const closingAt = (i: number) => {
    let sum = 0;
    let any = false;
    for (const g of groups) { const m = g.months?.[i]; if (m?.closing != null && m.closing !== 0) { sum += m.closing; any = true; } }
    return any ? sum : null;
  };
  const taken = cols.map((ym, i) => ({ ym, i, sen: ym < today.slice(0, 7) ? closingAt(i) : null })).filter((x): x is { ym: string; i: number; sen: number } => x.sen != null);
  const last = taken[taken.length - 1];
  if (!last) return null;
  const prev = taken[taken.length - 2] ?? null;
  const lines = groups
    .map((g) => ({ name: g.description || g.group || "—", sen: g.months?.[last.i]?.closing ?? 0, prevSen: prev ? g.months?.[prev.i]?.closing ?? 0 : null }))
    .filter((l) => l.sen || l.prevSen)
    .sort((x, y) => y.sen - x.sen);
  return { ym: last.ym, sen: last.sen, prevYm: prev?.ym ?? null, prevSen: prev?.sen ?? null, lines };
}

// ---------------------------------------------------------------------------
// 11 · Fabric
// ---------------------------------------------------------------------------
export type FabMode = "previous" | "next";
export type FabGran = "monthly" | "quarterly";
export function fabricRows(cat: FabricCat | undefined, mode: FabMode) {
  const list = cat?.list ?? [];
  return (mode === "next" ? list.filter((r) => r.next30Meters > 0).sort((a, b) => b.next30Meters - a.next30Meters) : list.filter((r) => r.meters > 0).sort((a, b) => b.meters - a.meters)).slice(0, 10);
}
/** Meters posted: last 12 posting months, or last 8 quarters, newest first; cost per metre = issue cost ÷ meters. */
export function fabricTrend(cat: FabricCat | undefined, gran: FabGran): { key: string; label: string; meters: number; perM: number | null }[] {
  const monthly = [...(cat?.monthly ?? [])].sort((a, b) => b.month.localeCompare(a.month));
  if (gran === "monthly") return monthly.slice(0, 12).map((m) => ({ key: m.month, label: monthLabel(m.month), meters: m.meters, perM: m.meters > 0 && m.costSen != null ? m.costSen / m.meters : null }));
  const q = new Map<string, { meters: number; cost: number; hasCost: boolean }>();
  for (const m of monthly) {
    const key = `${m.month.slice(0, 4)}-Q${Math.floor((Number(m.month.slice(5, 7)) - 1) / 3) + 1}`;
    const e = q.get(key) ?? { meters: 0, cost: 0, hasCost: false };
    e.meters += m.meters;
    if (m.costSen != null) { e.cost += m.costSen; e.hasCost = true; }
    q.set(key, e);
  }
  return [...q.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).map(([key, e]) => ({ key, label: `Q${key.slice(6)} ${key.slice(0, 4)}`, meters: e.meters, perM: e.meters > 0 && e.hasCost ? e.cost / e.meters : null }));
}
