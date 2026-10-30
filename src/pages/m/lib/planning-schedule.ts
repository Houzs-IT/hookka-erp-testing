// ===========================================================================
// Planning (mobile) — Schedule tab: read the department schedule snapshot,
// and decide, per job, which production order it may open.
//
// SOURCE OF TRUTH: GET /api/planning/schedule/:dept returns a spreadsheet-
// shaped snapshot `{ generatedAt, department, sheets }`. The calendar sheet is
// date-separator rows ("2026-06-02  Tue   (Day 1)") followed by item rows. The
// DAY of a job is the scheduler-assigned day of that separator — never a lead
// time and never a dept due date. Rows before the first separator are the
// desktop "Unscheduled" group (_DepartmentSchedulePage.tsx buildCalendarGroups).
// Column layouts are copied from src/pages/planning/dept/*.tsx.
//
// The sheets carry NO production-order id, so opening an order is only offered
// when the match is unambiguous (owner decision D2):
//   • Fabric Cutting / Fabric Sewing rows carry the per-line label
//     `companySOId-NN` (planning-schedule.ts soPoOf) — exact match, must be ONE.
//   • every other department packs one row per SO + lane (the SO id and the
//     item label only) — the order must be the ONLY one left after SO + lane +
//     dept (+ WIP label); otherwise the job is shown but not tappable.
// Nothing here guesses an order id.
// ===========================================================================
import foamCuttingSnapshot from "../../../data/foamcutting-schedule-snapshot.json";
import fibreSnapshot from "../../../data/fibre-schedule-snapshot.json";
import type { PlanJobCard, PlanOrder } from "./planning-capacity";

export type Cell = string | number | null;
export type Sheet = Cell[][];
export type Snapshot = { generatedAt: string; department: string; sheets: Record<string, Sheet> };
export type Lane = "BEDFRAME" | "SOFA" | "ACCESSORY";

export type ScheduleDeptConfig = {
  code: string;
  name: string;
  /** API slug for GET /api/planning/schedule/:slug; null = no live endpoint. */
  slug: string | null;
  sheet: string;
  /** Singular count word of the desktop page's first chip (cut / SO / piece…). */
  unit: string;
  qtyUnit: string;
  note: string;
  upstream: string[];
  /** Column layout of the calendar sheet. */
  laneCol: number;
  groupCol: number;
  /** "cut" = the group key is a cut number; "so" = the group key is the SO id. */
  groupKind: "cut" | "so";
  soPoCol?: number;
  customerCol?: number;
  modelCol?: number;
  labelCol: number;
  fabricCol?: number;
  qtyCols: number[];
  minsCol?: number;
  cddCol?: number;
  /** Bundled snapshot desktop falls back to when there is no live endpoint. */
  staticSnapshot?: Snapshot;
};

export const SCHEDULE_DEPTS: ScheduleDeptConfig[] = [
  { code: "FAB_CUT", name: "Fabric Cutting", slug: "fabric-cutting", sheet: "Cut Calendar", unit: "order", qtyUnit: "set",
    note: "First stage — fabric cut per order", upstream: [],
    laneCol: 1, groupCol: 2, groupKind: "cut", soPoCol: 5, customerCol: 6, modelCol: 3, labelCol: 7, fabricCol: 8, qtyCols: [9], cddCol: 11 },
  { code: "FAB_SEW", name: "Fabric Sewing", slug: "fabric-sewing", sheet: "Sew Calendar", unit: "piece", qtyUnit: "pc",
    note: "After Fabric Cutting", upstream: ["FAB_CUT"],
    laneCol: 0, groupCol: 1, groupKind: "so", soPoCol: 5, customerCol: 2, modelCol: 3, labelCol: 6, qtyCols: [7], minsCol: 8, cddCol: 9 },
  { code: "WOOD_CUT", name: "Wood Cutting", slug: "wood-cutting", sheet: "Wood Cut Calendar", unit: "item", qtyUnit: "pc",
    note: "After Fabric Sewing", upstream: ["FAB_SEW"],
    laneCol: 1, groupCol: 2, groupKind: "so", customerCol: 8, modelCol: 3, labelCol: 5, qtyCols: [6], cddCol: 9 },
  { code: "FOAM_CUTTING", name: "Foam Cutting", slug: null, sheet: "Foam Cutting Calendar", unit: "SO", qtyUnit: "pc",
    note: "Foam cutting — after Wood Cutting, before Foam Bonding", upstream: ["WOOD_CUT"],
    laneCol: 1, groupCol: 2, groupKind: "so", modelCol: 3, labelCol: 4, qtyCols: [5], minsCol: 6, cddCol: 7,
    staticSnapshot: foamCuttingSnapshot as unknown as Snapshot },
  { code: "FRAMING", name: "Framing", slug: "framing", sheet: "Framing Calendar", unit: "item", qtyUnit: "pc",
    note: "After Wood Cutting", upstream: ["WOOD_CUT"],
    laneCol: 1, groupCol: 2, groupKind: "so", customerCol: 10, modelCol: 3, labelCol: 4, qtyCols: [5], minsCol: 6, cddCol: 11 },
  { code: "WEBBING", name: "Webbing", slug: "webbing", sheet: "Webbing Calendar", unit: "SO", qtyUnit: "pc",
    note: "Same day as Framing — runs in parallel", upstream: ["FRAMING"],
    laneCol: 1, groupCol: 2, groupKind: "so", modelCol: 3, labelCol: 4, qtyCols: [5], minsCol: 6, cddCol: 7 },
  { code: "FOAM", name: "Foam Bonding", slug: "foam-bonding", sheet: "Foam Calendar", unit: "SO", qtyUnit: "pc",
    note: "Sofa foam bonding — after Framing", upstream: ["FRAMING"],
    laneCol: 1, groupCol: 2, groupKind: "so", modelCol: 3, labelCol: 4, qtyCols: [5, 6, 7], minsCol: 8 },
  { code: "FIBRE", name: "Fibre", slug: null, sheet: "Fibre Calendar", unit: "SO", qtyUnit: "pc",
    note: "Fibre filling — after Foam Bonding", upstream: ["FOAM"],
    laneCol: 1, groupCol: 2, groupKind: "so", modelCol: 3, labelCol: 4, qtyCols: [5], minsCol: 6, cddCol: 7,
    staticSnapshot: fibreSnapshot as unknown as Snapshot },
  { code: "UPHOLSTERY", name: "Upholstery", slug: "upholstery", sheet: "Uph Calendar", unit: "piece", qtyUnit: "pc",
    note: "Bedframe after Webbing · Sofa after Foam Bonding", upstream: ["WEBBING", "FOAM"],
    laneCol: 1, groupCol: 2, groupKind: "so", modelCol: 3, labelCol: 4, qtyCols: [5], minsCol: 6, cddCol: 7 },
  { code: "PACKING", name: "Packing", slug: "packing", sheet: "Pack Calendar", unit: "piece", qtyUnit: "pc",
    note: "Final packing — follows Upholstery, no capacity cap", upstream: ["UPHOLSTERY"],
    laneCol: 1, groupCol: 2, groupKind: "so", modelCol: 3, labelCol: 4, qtyCols: [5], cddCol: 6 },
];

export const SCHEDULE_DEPT_BY_CODE: Record<string, ScheduleDeptConfig> = Object.fromEntries(
  SCHEDULE_DEPTS.map((d) => [d.code, d]),
);

export const LANE_LABEL: Record<Lane, string> = { BEDFRAME: "Bedframe", SOFA: "Sofa", ACCESSORY: "Accessory" };
export const LANE_ORDER: Lane[] = ["BEDFRAME", "SOFA", "ACCESSORY"];

// ── Dates (local, Mon-Sat working week — desktop scopeRange) ────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const parseLocal = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const toISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayLocal = (now: Date = new Date()): string => toISO(now);
export const addDays = (iso: string, n: number): string => {
  const d = parseLocal(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const mondayOf = (iso: string): string => {
  const d = parseLocal(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
};
export const weekDays = (monday: string): string[] => [0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i));
export const weekdayOf = (iso: string): string => WEEKDAYS[parseLocal(iso).getDay()];
export const dayNum = (iso: string): number => parseLocal(iso).getDate();
export const diffDays = (a: string, b: string): number => Math.round((parseLocal(a).getTime() - parseLocal(b).getTime()) / 864e5);
export function shortDate(iso: string | null | undefined): string {
  const s = (iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const d = parseLocal(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function longDate(iso: string | null | undefined): string {
  const s = (iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const d = parseLocal(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Desktop `isOverdueDate` (_DepartmentSchedulePage.tsx:87-95): a Customer DD is
 * overdue when it is before `new Date().toISOString().slice(0,10)` — the UTC
 * date, kept as-is so mobile and desktop never disagree on the same job.
 */
export function isCustomerDdOverdue(cdd: string | null | undefined, now: Date = new Date()): boolean {
  const s = (cdd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return s < now.toISOString().slice(0, 10);
}

// ── Parsing ─────────────────────────────────────────────────────────────────
export type ScheduleJob = {
  id: string;
  dept: string;
  /** Scheduler-assigned working day, or null = the desktop "Unscheduled" group. */
  day: string | null;
  lane: Lane | null;
  groupKey: string;
  soKey: string;
  /** Per-line label (`companySOId-NN`) — only Fabric Cutting / Fabric Sewing carry it. */
  soPo: string;
  label: string;
  model: string;
  customer: string;
  fabric: string;
  qty: number;
  mins: number | null;
  cdd: string | null;
};

const blank = (c: Cell | undefined): boolean => c === "" || c === null || c === undefined;
const str = (c: Cell | undefined): string => (blank(c) ? "" : String(c).trim());
function num(c: Cell | undefined): number {
  if (typeof c === "number") return Number.isFinite(c) ? c : 0;
  const n = parseFloat(String(c ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Desktop `resolveLane`: substring match on the English word. */
export function laneOf(raw: Cell | undefined): Lane | null {
  const s = String(raw ?? "");
  if (/bedframe/i.test(s)) return "BEDFRAME";
  if (/sofa/i.test(s)) return "SOFA";
  if (/pillow|accessor/i.test(s)) return "ACCESSORY";
  return null;
}

/** Desktop `isDateSeparator`: only the first cell is filled. */
function isSeparator(row: Cell[]): boolean {
  if (!row.length) return false;
  const filled = row.filter((c) => !blank(c));
  return filled.length === 1 && !blank(row[0]);
}

/** Strip the `-NN` line suffix: `SO-2610-012-01` -> `SO-2610-012`. */
export function soOfLabel(label: string): string {
  const m = /^(.*)-\d{2}$/.exec(label.trim());
  return m ? m[1] : label.trim();
}

export function parseSchedule(snap: Snapshot | null | undefined, cfg: ScheduleDeptConfig): ScheduleJob[] {
  const sheet = snap?.sheets?.[cfg.sheet];
  if (!sheet || sheet.length < 2) return [];
  const jobs: ScheduleJob[] = [];
  let day: string | null = null;
  let group: { key: string; lane: Lane | null; so: string; customer: string } | null = null;

  for (let i = 1; i < sheet.length; i++) {
    const row = sheet[i];
    if (isSeparator(row)) {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(row[0]));
      day = m ? m[1] : null;
      group = null;
      continue;
    }
    if (row.every(blank)) continue;

    const key = str(row[cfg.groupCol]);
    if (key || !group) {
      const soPo = cfg.soPoCol != null ? str(row[cfg.soPoCol]) : "";
      group = {
        key: key || "—",
        lane: laneOf(row[cfg.laneCol]),
        so: cfg.groupKind === "so" ? key : soOfLabel(soPo),
        customer: "",
      };
    }
    const own = cfg.customerCol != null ? str(row[cfg.customerCol]) : "";
    if (own) group.customer = own;

    const soPo = cfg.soPoCol != null ? str(row[cfg.soPoCol]) : "";
    const cdd = cfg.cddCol != null ? str(row[cfg.cddCol]).slice(0, 10) : "";
    jobs.push({
      id: `${cfg.code}|${i}`,
      dept: cfg.code,
      day,
      lane: group.lane,
      groupKey: group.key,
      soKey: cfg.groupKind === "so" ? group.so : soOfLabel(soPo) || group.so,
      soPo,
      label: str(row[cfg.labelCol]),
      model: cfg.modelCol != null ? str(row[cfg.modelCol]) : "",
      customer: own || group.customer,
      fabric: cfg.fabricCol != null ? str(row[cfg.fabricCol]) : "",
      qty: cfg.qtyCols.reduce((s, c) => s + num(row[c]), 0),
      mins: cfg.minsCol != null ? num(row[cfg.minsCol]) : null,
      cdd: /^\d{4}-\d{2}-\d{2}$/.test(cdd) ? cdd : null,
    });
  }
  return jobs;
}

export function jobsOnDay(jobs: ScheduleJob[], day: string | "UNSCHED"): ScheduleJob[] {
  return jobs.filter((j) => (day === "UNSCHED" ? j.day === null : j.day === day));
}

export type LaneGroup = { lane: Lane | null; label: string; jobs: ScheduleJob[] };

/** day → lane (Bedframe / Sofa / Accessory) → order / cut (jobs stay in sheet order). */
export function groupByLane(jobs: ScheduleJob[]): LaneGroup[] {
  const out: LaneGroup[] = LANE_ORDER.map((lane) => ({ lane: lane as Lane | null, label: LANE_LABEL[lane], jobs: jobs.filter((j) => j.lane === lane) }));
  const other = jobs.filter((j) => j.lane === null);
  if (other.length) out.push({ lane: null, label: "Other", jobs: other });
  return out.filter((g) => g.jobs.length);
}

export function summarize(jobs: ScheduleJob[], cfg: ScheduleDeptConfig): string {
  const n = jobs.length;
  const qty = jobs.reduce((s, j) => s + j.qty, 0);
  const parts = [`${n} ${cfg.unit}${n === 1 ? "" : "s"}`, `${qty} ${cfg.qtyUnit}`];
  if (cfg.minsCol != null) parts.push(`${jobs.reduce((s, j) => s + (j.mins ?? 0), 0)} min`);
  return parts.join(" · ");
}

// ── Safe job → production order resolution (D2) ─────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Mirrors the API's `soPoOf`: `companySOId-NN`, else the PO number. */
export function lineLabelOf(o: PlanOrder): string {
  const so = (o.companySOId ?? "").trim();
  if (so) return `${so}${o.lineNo != null ? `-${pad2(o.lineNo)}` : ""}`;
  return (o.poNo ?? o.id).trim();
}

export type OrderIndex = { byLabel: Map<string, PlanOrder[]>; bySo: Map<string, PlanOrder[]> };

export function buildOrderIndex(orders: PlanOrder[]): OrderIndex {
  const byLabel = new Map<string, PlanOrder[]>();
  const bySo = new Map<string, PlanOrder[]>();
  const push = (m: Map<string, PlanOrder[]>, k: string, o: PlanOrder) => {
    if (!k) return;
    const list = m.get(k) ?? [];
    if (!list.includes(o)) list.push(o);
    m.set(k, list);
  };
  for (const o of orders) {
    push(byLabel, lineLabelOf(o), o);
    push(byLabel, (o.poNo ?? "").trim(), o);
    push(bySo, (o.companySOId ?? "").trim(), o);
  }
  return { byLabel, bySo };
}

export type JobResolution = {
  /** The ONE production order this job opens, or null (never a guess). */
  order: PlanOrder | null;
  /** The job card of that order in this department when it is also unambiguous. */
  jobCard: PlanJobCard | null;
  /** Every order of the job's SO (all share one customer / customer DD). */
  soOrders: PlanOrder[];
};

const waitingIn = (o: PlanOrder, dept: string) => o.jobCards.filter((jc) => jc.departmentCode === dept && jc.status === "WAITING");

export function resolveJob(job: ScheduleJob, index: OrderIndex): JobResolution {
  const soOrders = index.bySo.get(job.soKey) ?? [];
  let order: PlanOrder | null = null;

  if (job.soPo) {
    const cands = index.byLabel.get(job.soPo) ?? [];
    order = cands.length === 1 ? cands[0] : null;
  } else if (job.soKey) {
    const inLane = soOrders.filter((o) => !job.lane || o.itemCategory === job.lane);
    const inDept = inLane.filter((o) => waitingIn(o, job.dept).length > 0);
    if (inDept.length === 1) order = inDept[0];
    else if (inDept.length > 1 && job.label) {
      const byLabel = inDept.filter((o) => waitingIn(o, job.dept).some((jc) => (jc.wipLabel ?? "") === job.label));
      if (byLabel.length === 1) order = byLabel[0];
    }
  }

  let jobCard: PlanJobCard | null = null;
  if (order) {
    let jcs = waitingIn(order, job.dept);
    if (jcs.length > 1 && job.label) {
      const same = jcs.filter((jc) => (jc.wipLabel ?? "") === job.label);
      if (same.length) jcs = same;
    }
    if (jcs.length === 1) jobCard = jcs[0];
    else if (jcs.length > 1) {
      const dates = new Set(jcs.map((jc) => (jc.dueDate ?? "").slice(0, 10)));
      if (dates.size === 1) jobCard = jcs[0];
    }
  }
  return { order, jobCard, soOrders };
}

/** The value every order of the SO agrees on, or "" (never picks one of several). */
export function commonValue(orders: PlanOrder[], pick: (o: PlanOrder) => string | null | undefined): string {
  const vals = new Set(orders.map((o) => (pick(o) ?? "").trim()).filter(Boolean));
  return vals.size === 1 ? [...vals][0] : "";
}

/** SO ids / order refs to ask the production-orders `scope=` lookup for. */
export function scopeTokens(jobs: ScheduleJob[], max = 80): string[] {
  const set = new Set<string>();
  for (const j of jobs) {
    const t = (j.soKey || soOfLabel(j.soPo)).trim();
    if (t) set.add(t);
    if (set.size >= max) break;
  }
  return [...set];
}
