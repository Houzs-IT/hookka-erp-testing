// overview-model.ts — the Employees Overview (Employees 3.dc.html, HK-0125 Phase 3). Pure: no clock, no React.
//
// Period: the CURRENT Malaysia month, month to date (1st .. today). The caller passes `today`.
// Cards: the same four figures as desktop's summary cards (employees.tsx: Total Workers / Present / Working Hours /
// Avg Efficiency), from `GET /api/department-performance?view=summary` (`data.totals`) and the worker list.
// Needs action: Pending time adjustments (the shell's pending list — the same list as the Working Hours tab badge) and
// Attendance exceptions (Off-site punch records this month, each record once, the same rule and range the Attendance
// screen's Off-site list uses).
import { fmtDistance, offsitePunchTime, rowFarthestMeters, rowLocation } from "./attendance-location";
import { punchRows, type AttRow } from "./attendance-model";
import { monthLabel, monthShort, type YmdRange } from "./employees-dates";
import { fmtMin } from "./employees-format";
import { pendingBadge, requestedMin, type NonprodReq } from "./time-adjustments-model";

/** 1st of the current Malaysia month .. today. */
export function monthToDate(today: string): YmdRange {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** "November 2026 · Month to date" */
export function overviewLabel(today: string): string {
  return `${monthLabel(Number(today.slice(0, 4)), Number(today.slice(5, 7)))} · Month to date`;
}

export type SummaryTotals = { workerCount?: number; workingMinutes?: number; efficiencyPct?: number };
export type WorkerLite = { id?: string; status?: string; empNo?: string };
/** One row of `GET /api/working-hour-entries/summary` (hours in ANY department, per worker, for from..to). */
export type HoursRow = { workerId?: string; totalHours?: number };

/** The roster both numbers of "Workers with logged hours" use: ACTIVE workers, test accounts excluded (desktop's headcount). */
export function activeRoster(workers: readonly WorkerLite[]): WorkerLite[] {
  return workers.filter((w) => w.status === "ACTIVE" && !/^TEST/i.test(w.empNo || ""));
}

/** Desktop's headcount: ACTIVE workers, test accounts excluded. */
export function countWorkers(workers: readonly WorkerLite[]): number {
  return activeRoster(workers).length;
}

/**
 * How many roster workers have POSITIVE logged hours in ANY department in the period — each worker once, however many
 * departments or rows they have. Resigned / inactive workers, test accounts, ids with no worker record, and people whose
 * only credit is a job card or an approved extra-production claim (no hours row) are not counted, so the result can never
 * exceed the roster size.
 */
export function countLoggedHours(workers: readonly WorkerLite[], hours: readonly HoursRow[]): number {
  const hoursById = new Map<string, number>();
  for (const h of hours) {
    if (!h.workerId) continue;
    hoursById.set(h.workerId, (hoursById.get(h.workerId) ?? 0) + (Number(h.totalHours) || 0));
  }
  const counted = new Set<string>();
  for (const w of activeRoster(workers)) {
    if (w.id && (hoursById.get(w.id) ?? 0) > 0) counted.add(w.id);
  }
  return counted.size;
}

export type CardTone = "ink" | "green" | "amber" | "red";
export type OverviewCard = {
  key: "total" | "logged" | "hours" | "efficiency";
  icon: "Users" | "UserCheck" | "Clock" | "Activity";
  label: string;
  value: string;
  tone: CardTone;
  /** The Employees section the card opens. */
  target: "attendance" | "working-hours" | "efficiency";
};

/** Desktop's efficiency colours: >= 85 green, >= 70 amber, else red. */
export function efficiencyTone(pct: number): CardTone {
  return pct >= 85 ? "green" : pct >= 70 ? "amber" : "red";
}

/**
 * The four cards, labels and order as in the HTML. A figure whose source is unavailable (no permission, still loading,
 * failed) reads "—", never a made-up zero.
 */
export function buildCards(input: {
  workers: readonly WorkerLite[] | null;
  totals: SummaryTotals | null;
  /** The hours summary rows; null while loading, failed or not allowed. */
  hours: readonly HoursRow[] | null;
}): OverviewCard[] {
  const total = input.workers ? countWorkers(input.workers) : null;
  const t = input.totals;
  const minutes = t?.workingMinutes ?? 0;
  const eff = t && minutes > 0 ? Number((t.efficiencyPct ?? 0).toFixed(1)) : 0;
  return [
    { key: "total", icon: "Users", label: "TOTAL WORKERS", value: total === null ? "—" : String(total), tone: "ink", target: "attendance" },
    {
      key: "logged",
      icon: "UserCheck",
      label: "WORKERS WITH LOGGED HOURS",
      // Same roster on both sides: logged-hours workers within the active, non-test roster, over that roster.
      value: input.workers && input.hours ? `${countLoggedHours(input.workers, input.hours)}/${total}` : "—",
      tone: "green",
      target: "working-hours",
    },
    { key: "hours", icon: "Clock", label: "WORKING HOURS", value: t ? `${(minutes / 60).toFixed(1)}h` : "—", tone: "ink", target: "working-hours" },
    {
      key: "efficiency",
      icon: "Activity",
      label: "AVG EFFICIENCY",
      value: t ? (minutes > 0 ? `${eff.toFixed(1)}%` : "0%") : "—",
      tone: t ? efficiencyTone(eff) : "ink",
      target: "efficiency",
    },
  ];
}

/** "4 Nov" — the HTML's short day. */
export function shortDay(ymd: string): string {
  return `${Number(ymd.slice(8, 10))} ${monthShort(Number(ymd.slice(5, 7)))}`;
}

export type Peek = { a: string; b: string; c: string };

/** The newest pending request (the list is newest first): "NAME  Department  11 Nov · 51 min". */
export function pendingPeek(rows: readonly NonprodReq[], deptName: (code: string) => string): Peek | null {
  const r = rows[0];
  if (!r) return null;
  return { a: r.workerName || r.workerId, b: deptName(r.departmentCode), c: `${shortDay(r.date)} · ${fmtMin(requestedMin(r))}` };
}

/** Off-site punch records, each attendance record once, newest first. */
export function offsiteRecords(raw: readonly AttRow[] | null | undefined): AttRow[] {
  return punchRows(raw)
    .filter((r) => rowLocation(r) === "offsite")
    .sort((a, b) => b.date.localeCompare(a.date) || (offsitePunchTime(b) ?? "").localeCompare(offsitePunchTime(a) ?? ""));
}

/** "Lim Wei Jie  Off-site · 1.4 km  4 Nov · 07:52" for the newest exception. */
export function offsitePeek(records: readonly AttRow[]): Peek | null {
  const r = records[0];
  if (!r) return null;
  const m = rowFarthestMeters(r);
  return {
    a: r.employeeName || r.employeeId,
    b: m === null ? "Off-site" : `Off-site · ${fmtDistance(m)}`,
    c: `${shortDay(r.date)} · ${offsitePunchTime(r) ?? "—"}`,
  };
}

/** What one source (a request list) looks like to the Overview. */
export type SourceState<T> = {
  /** The role may read it (otherwise nothing was requested). */
  allowed: boolean;
  /** null until the first response. */
  rows: readonly T[] | null;
  loading: boolean;
  /** The last request failed. */
  error: boolean;
};

export type NeedRow = {
  key: "pending" | "attendance";
  label: string;
  count: string;
  tone: "amber" | "red";
  peek: Peek | null;
};
export type NeedsAction = {
  rows: NeedRow[];
  /** Messages for lists that failed to load. */
  errors: string[];
  /** An accessible list has not answered yet. */
  loading: boolean;
  /** "No pending actions": ONLY when both lists are accessible, loaded without error, and empty. */
  calm: boolean;
  /** Neither list is accessible to this role: the section is not drawn at all. */
  hidden: boolean;
};

export function needsAction(
  pending: SourceState<NonprodReq>,
  attendance: SourceState<AttRow>,
  deptName: (code: string) => string,
): NeedsAction {
  const hidden = !pending.allowed && !attendance.allowed;
  const rows: NeedRow[] = [];
  const errors: string[] = [];
  let loading = false;

  if (pending.allowed) {
    if (pending.error) errors.push("Couldn't load pending time adjustments.");
    else if (pending.rows === null) loading = loading || pending.loading;
    if (pending.rows && pending.rows.length > 0) {
      rows.push({ key: "pending", label: "Pending time adjustments", count: pendingBadge(pending.rows as NonprodReq[]) ?? String(pending.rows.length), tone: "amber", peek: pendingPeek(pending.rows, deptName) });
    }
  }
  if (attendance.allowed) {
    if (attendance.error) errors.push("Couldn't load attendance exceptions.");
    else if (attendance.rows === null) loading = loading || attendance.loading;
    const records = offsiteRecords(attendance.rows as AttRow[] | null);
    if (records.length > 0) {
      rows.push({ key: "attendance", label: "Attendance exceptions", count: String(records.length), tone: "red", peek: offsitePeek(records) });
    }
  }

  const loaded = (s: SourceState<unknown>) => s.allowed && s.rows !== null && !s.error;
  const calm = loaded(pending) && loaded(attendance) && rows.length === 0;
  return { rows, errors, loading, calm, hidden };
}
