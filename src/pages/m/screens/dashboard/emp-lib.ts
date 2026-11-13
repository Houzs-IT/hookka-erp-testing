// Pure logic of the /m Home Employees view. No React, so node --test imports it (tests/m-home-employees.test.mjs).
//
// RULE: nothing here invents a business definition. Every function below is the desktop's own maths, copied
// line-for-line from dashboards/EmployeesDashboard.tsx, NonProdHoursCard.tsx and AttendanceLogCard.tsx, where it
// lives inside a component body and cannot be imported. The desktop files are NOT edited; tests/m-home-employees
// holds fixtures that pin this copy to the desktop's documented behaviour.
import { dropIdleSundays } from "../../../../lib/idle-sundays";
import { AMBER, GREEN, MUTED, RED, hasKeyedHours, inFocus, inPeriod, isOutsourced, periodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { DEPT_FLOOR, deptName } from "../../../dashboards/ops-floor-lib";

// ---------------------------------------------------------------------------
// Feed shapes (GET /api/dashboard/prototype → employee)
// ---------------------------------------------------------------------------
export type EmpWorker = { id: string; empNo?: string | null; name: string | null; dept: string | null; role?: string | null; countsToHeadcount: boolean; isHelper?: boolean };
export type EmpAtt = {
  employeeId: string | null; employeeName: string | null; dept: string | null; date: string | null; clockIn: string | null; clockOut: string | null;
  workingMinutes: number; productionMinutes: number; overtimeMinutes: number; efficiencyPct: number | null;
};
export type EmpDayWorker = { workerId: string; workingMinutes: number; productionMinutes: number; allDeptMinutes?: number; isHelper?: boolean };
export type EmpDay = { date: string; workingMinutes: number; productionMinutes: number; allDeptMinutes?: number; helperWorkingMinutes?: number; helperProductionMinutes?: number; workers?: EmpDayWorker[] };
export type EmpSlice = { workers: EmpWorker[]; attendance: EmpAtt[]; performance: { byDay: EmpDay[] } };
export type HourEntry = { workerId: string; date: string; hours: number | string; departmentCode?: string | null };

export const MIN_RANK_MIN = 60; // under an hour clocked in the window has no meaningful ratio
export type Win = "day" | "7d" | "period";

// ---------------------------------------------------------------------------
// Formatting + the efficiency band
// ---------------------------------------------------------------------------
export const hrs = (min: number) => `${(min / 60).toLocaleString("en-MY", { maximumFractionDigits: 1 })} h`;
export const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const eff = (prod: number, work: number) => (work > 0 ? (prod / work) * 100 : null);
// Helpers / 杂工 (owner 2026-11-11) — same rule as the desktop dashboard:
// production efficiency leaves helper minutes out; a helper row shows "—".
export const poolEff = (t: { prod: number; work: number; hp?: number; hw?: number }) => eff(t.prod - (t.hp ?? 0), t.work - (t.hw ?? 0));
export const rowEff = (r: { prod: number; work: number; isHelper?: boolean }) => (r.isHelper ? null : eff(r.prod, r.work));
/** "Overall xx% (incl. helpers X h)" text, or "" when no helper clocked time. */
export const overallText = (t: { prod: number; work: number; hw?: number }) =>
  (t.hw ?? 0) > 0 ? `Overall ${pct(eff(t.prod, t.work))} (incl. helpers ${hrs(t.hw ?? 0)})` : "";
export const ratio = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
/** Desktop effColor: green at target, amber from 85% of the configured target, red below. */
export const effColor = (v: number | null, target: number) => (v == null ? MUTED : v >= target ? GREEN : v >= target * 0.85 ? AMBER : RED);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
/** "Thu 29 Oct" */
export const dLab = (s: string) => { const d = parseDay(s); return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
/** "29 Oct" */
export const dShort = (s: string) => { const d = parseDay(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };

export const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// Non-production cost centres in the hour log, shown in words.
const COST_CENTRES: Record<string, string> = { WAREHOUSING: "Warehousing", R_AND_D: "R&D", REPAIR: "Repair", PRODUCTION_SHORTFALL: "Production shortfall", UNLINKED: "Production not linked to a worker" };
export const costCentreName = (code: string) => COST_CENTRES[code] ?? deptName(code);
export const floorSet = (): Set<string> => new Set<string>(DEPT_FLOOR.map(([c]) => c as string));

// ---------------------------------------------------------------------------
// Salary state. The desktop shows "…" until the salary is computed and never says why it is not. On a phone that
// reads as "still loading" for ever, and a settled empty answer read as RM 0.00 is worse: it states a fact that was
// never measured. So every non-answer has its own name, and the calculation only counts as READY when every input of
// it (workers, hour entries, pay rules, public holidays, salary rates) was really answered.
// ---------------------------------------------------------------------------
export type LabourState = "denied" | "loading" | "error" | "ready" | "none";
export function labourStateOf(i: {
  canSalary: boolean; failureStatuses: number[]; ready: boolean; wkRows: number | null; heRows: number | null; inputsReady: boolean;
}): LabourState {
  if (!i.canSalary) return "denied";
  if (i.failureStatuses.some((s) => s === 401 || s === 403)) return "denied";
  if (i.failureStatuses.length > 0) return "error";
  if (i.wkRows != null && i.heRows != null && (i.wkRows === 0 || i.heRows === 0)) return "none";
  if (!i.inputsReady) return "loading";
  return i.ready ? "ready" : "loading";
}

// ---------------------------------------------------------------------------
// Window (desktop: winDates / winLabel)
// ---------------------------------------------------------------------------
export function periodDays(allDays: EmpDay[], period: Period): EmpDay[] {
  return allDays.filter((d) => inPeriod(period, d.date));
}
export function latestDay(days: EmpDay[]): string {
  return [...days].reverse().find((d) => d.workingMinutes > 0)?.date ?? days[days.length - 1]?.date ?? "";
}
export function buildWindow(days: EmpDay[], period: Period, win: Win) {
  const dayMode = !!period.day;
  const latest = latestDay(days);
  const anchor = period.day ?? latest;
  const range = { from: days[0]?.date ?? "", to: days[days.length - 1]?.date ?? "" };
  const effWin: Win = dayMode ? "day" : win;
  let winDates: Set<string>;
  if (!anchor) winDates = new Set();
  else if (effWin === "day") winDates = new Set([anchor]);
  else if (effWin === "7d") { const lo = shiftDay(anchor, -6); winDates = new Set(days.filter((d) => d.date >= lo && d.date <= anchor).map((d) => d.date)); }
  else winDates = new Set(days.map((d) => d.date));
  const label = effWin === "day" ? dLab(anchor || "1970-01-01") : effWin === "7d" ? `7 days to ${dShort(anchor)}` : `${periodLabel(period)}${period.mode === "monthly" && range.to ? ` · to ${dShort(range.to)}` : ""}`;
  const sorted = [...winDates].sort();
  return { dayMode, anchor, effWin, winDates, range, label, winFrom: sorted[0] ?? "", winTo: sorted[sorted.length - 1] ?? "" };
}

// ---------------------------------------------------------------------------
// Roster / outsourced / presence (desktop: clockers, roster, outsourced, presence)
// ---------------------------------------------------------------------------
export function rosterOf(slice: EmpSlice) {
  const clockers = new Set(slice.attendance.filter((r) => r.clockIn || r.clockOut).map((r) => r.employeeId));
  const roster = slice.workers.filter((w) => w.countsToHeadcount && !isOutsourced(w) && clockers.has(w.id));
  const outsourced = new Set(slice.workers.filter(isOutsourced).map((w) => w.id));
  return { clockers, roster, outsourced };
}
export function presenceOn(slice: EmpSlice, roster: EmpWorker[], anchor: string) {
  const att = new Set(slice.attendance.filter((r) => r.date === anchor).map((r) => r.employeeId));
  const absent = roster.filter((w) => !att.has(w.id));
  return { present: roster.length - absent.length, absent };
}

// ---------------------------------------------------------------------------
// Headline numbers (desktop: sumWindow + the tile maths)
// ---------------------------------------------------------------------------
export type WindowSum = { work: number; prod: number; hw: number; hp: number; sen: number; workerDays: number; workingDays: number; fte: number; revenue: number };
export function sumWindow(allDays: EmpDay[], has: (d: string) => boolean, cost: Map<string, number>, outsourced: Set<string>, revenueByDay: Map<string, { total: number }> | null): WindowSum {
  let work = 0, prod = 0, hw = 0, hp = 0, sen = 0, workerDays = 0, workingDays = 0, revenue = 0;
  for (const d of allDays) {
    if (!has(d.date)) continue;
    if (hasKeyedHours(d)) {
      work += d.workingMinutes;
      prod += d.productionMinutes;
      hw += d.helperWorkingMinutes ?? 0;
      hp += d.helperProductionMinutes ?? 0;
    }
    let any = false;
    for (const x of d.workers ?? []) {
      sen += cost.get(`${x.workerId}|${d.date}`) ?? 0;
      if (x.workingMinutes > 0 && !outsourced.has(x.workerId)) { workerDays += 1; any = true; }
    }
    if (any) workingDays += 1;
  }
  for (const [d, v] of revenueByDay ?? []) if (has(d)) revenue += v.total;
  const fte = workingDays ? workerDays / workingDays : 0;
  return { work, prod, hw, hp, sen, workerDays, workingDays, fte, revenue };
}

export function headlineOf(a: { totals: WindowSum; prev: WindowSum | null; costByDept: Map<string, number>; winDates: Set<string>; revenueKnown: boolean }) {
  const { totals, prev, costByDept, winDates, revenueKnown } = a;
  let winSalary = totals.sen;
  if (costByDept.size > 0) { winSalary = 0; for (const [k, v] of costByDept) if (winDates.has(k.split("|")[1])) winSalary += v; }
  const labourPct = ratio(winSalary, totals.revenue);
  const prevLabourPct = prev && prev.sen > 0 ? ratio(prev.sen, prev.revenue) : null;
  const revPerFte = revenueKnown && totals.fte ? totals.revenue / totals.fte : null;
  const revPerDay = revenueKnown && totals.workerDays ? totals.revenue / totals.workerDays : null;
  const prevRevPerDay = prev && prev.workerDays && prev.revenue > 0 ? prev.revenue / prev.workerDays : null;
  const revChange = revPerDay != null && prevRevPerDay ? ((revPerDay - prevRevPerDay) / prevRevPerDay) * 100 : null;
  return { winSalary, labourPct, prevLabourPct, revPerFte, revPerDay, prevRevPerDay, revChange, fte: totals.fte };
}

// ---------------------------------------------------------------------------
// Worker rows, ranking (desktop: rows / ranked / upper / lower)
// ---------------------------------------------------------------------------
export type Row = { id: string; name: string; dept: string; isHelper?: boolean; work: number; prod: number; cost: number; daysWorked: number; byDay: { date: string; work: number; prod: number; cost: number }[] };
export function workerRows(days: EmpDay[], winDates: Set<string>, workerById: Map<string, EmpWorker>, dept: string, cost: Map<string, number>): Row[] {
  const m = new Map<string, Row>();
  for (const d of days) {
    if (!winDates.has(d.date)) continue;
    for (const x of d.workers ?? []) {
      const earnedMinutes = hasKeyedHours(d) ? x.productionMinutes : 0;
      const w = workerById.get(x.workerId);
      const wDept = w?.dept ?? "—";
      if (dept !== "ALL" && wDept !== dept) continue;
      const c = cost.get(`${x.workerId}|${d.date}`) ?? 0;
      const r = m.get(x.workerId) ?? { id: x.workerId, name: w?.name ?? x.workerId, dept: wDept, isHelper: !!(x.isHelper || w?.isHelper), work: 0, prod: 0, cost: 0, daysWorked: 0, byDay: [] };
      r.work += x.workingMinutes;
      r.prod += earnedMinutes;
      r.cost += c;
      if (x.workingMinutes > 0) r.daysWorked += 1;
      r.byDay.push({ date: d.date, work: x.workingMinutes, prod: earnedMinutes, cost: c });
      m.set(x.workerId, r);
    }
  }
  return [...m.values()].filter((r) => r.work > 0).sort((a, b) => (rowEff(b) ?? -1) - (rowEff(a) ?? -1));
}
export function rankSplit(rows: Row[], outsourced: Set<string>) {
  const ranked = rows.filter((r) => r.work >= MIN_RANK_MIN && !outsourced.has(r.id) && !r.isHelper);
  const half = Math.ceil(ranked.length / 2);
  return {
    ranked, half, upper: ranked.slice(0, half), lower: ranked.slice(half),
    unranked: rows.filter((r) => r.work < MIN_RANK_MIN && !outsourced.has(r.id)),
    outsourcedRows: rows.filter((r) => outsourced.has(r.id)),
  };
}
export const departmentsOf = (workers: EmpWorker[]) => [...new Set(workers.map((w) => w.dept).filter((d): d is string => !!d))].sort();

// ---------------------------------------------------------------------------
// Department efficiency (desktop: deptRows / deptTotal / progByDept)
// ---------------------------------------------------------------------------
export type DeptRow = { dept: string; people: Set<string>; work: number; prod: number; hw: number; hp: number; cost: number; bf: number; sofa: number };
export function foldProgressive(byDeptCategory: Record<string, number> | undefined) {
  const m = new Map<string, { bf: number; sofa: number; other: number }>();
  for (const [k, v] of Object.entries(byDeptCategory ?? {})) {
    const [dept, cat] = k.split("|");
    const r = m.get(dept) ?? { bf: 0, sofa: 0, other: 0 };
    if (cat === "BEDFRAME") r.bf += v;
    else if (cat === "SOFA") r.sofa += v;
    else r.other += v;
    m.set(dept, r);
  }
  return m;
}
export function deptRowsOf(a: {
  days: EmpDay[]; winDates: Set<string>; workerById: Map<string, EmpWorker>; costByWorkerDay: Map<string, number>; costByDept: Map<string, number>;
  hourEntries: HourEntry[]; progByDept: Map<string, { bf: number; sofa: number; other: number }>; outsourced: Set<string>;
}): DeptRow[] {
  const { days, winDates, workerById, costByWorkerDay, costByDept, hourEntries, progByDept, outsourced } = a;
  const floor = floorSet();
  const m = new Map<string, DeptRow>();
  const row = (k: string) => {
    const r = m.get(k) ?? { dept: k, people: new Set<string>(), work: 0, prod: 0, hw: 0, hp: 0, cost: 0, bf: 0, sofa: 0 };
    m.set(k, r);
    return r;
  };
  const split = new Map<string, Map<string, number>>(); // worker|date → dept → production-dept hours
  for (const e of hourEntries) {
    if (!winDates.has(e.date) || !e.departmentCode || !floor.has(e.departmentCode)) continue;
    const k = `${e.workerId}|${e.date}`;
    const mm = split.get(k) ?? new Map<string, number>();
    mm.set(e.departmentCode, (mm.get(e.departmentCode) ?? 0) + (Number(e.hours) || 0));
    split.set(k, mm);
  }
  for (const d of days) {
    if (!winDates.has(d.date)) continue;
    for (const x of d.workers ?? []) {
      const earnedMinutes = hasKeyedHours(d) ? x.productionMinutes : 0;
      const k = `${x.workerId}|${d.date}`;
      const shares = split.get(k);
      const total = shares ? [...shares.values()].reduce((s, v) => s + v, 0) : 0;
      const parts: [string, number][] = shares && total > 0 ? [...shares.entries()].map(([dep, h]) => [dep, h / total]) : [[workerById.get(x.workerId)?.dept ?? "—", 1]];
      for (const [dep, f] of parts) {
        const r = row(dep);
        if (x.workingMinutes > 0 && !outsourced.has(x.workerId)) r.people.add(x.workerId);
        r.work += x.workingMinutes * f;
        r.prod += earnedMinutes * f;
        if (x.isHelper) { r.hw += x.workingMinutes * f; r.hp += earnedMinutes * f; }
      }
      if (costByDept.size === 0) row(parts[0][0]).cost += costByWorkerDay.get(k) ?? 0;
    }
  }
  let unlinked = 0;
  for (const d of days) {
    if (!winDates.has(d.date) || !hasKeyedHours(d)) continue;
    unlinked += d.productionMinutes - (d.workers ?? []).reduce((s, x) => s + x.productionMinutes, 0);
  }
  if (unlinked > 0.5) row("UNLINKED").prod += unlinked;
  for (const [k, v] of costByDept) {
    const [wid, date, dep] = k.split("|");
    if (!winDates.has(date)) continue;
    row(dep || workerById.get(wid)?.dept || "—").cost += v;
  }
  for (const [dep, pr] of progByDept) {
    const r = row(dep);
    r.bf = pr.bf;
    r.sofa = pr.sofa + pr.other;
  }
  return [...m.values()]
    .filter((r) => r.work > 0 || r.prod > 0 || r.cost > 0 || r.bf + r.sofa > 0)
    .sort((x, y) => Number(!floor.has(x.dept)) - Number(!floor.has(y.dept)) || (poolEff(y) ?? -1) - (poolEff(x) ?? -1));
}
export function deptTotalOf(rows: DeptRow[]) {
  return rows.reduce(
    (t, r) => ({ work: t.work + r.work, prod: t.prod + r.prod, hw: t.hw + r.hw, hp: t.hp + r.hp, cost: t.cost + r.cost, bf: t.bf + r.bf, sofa: t.sofa + r.sofa, people: new Set([...t.people, ...r.people]) }),
    { work: 0, prod: 0, hw: 0, hp: 0, cost: 0, bf: 0, sofa: 0, people: new Set<string>() },
  );
}
/** Workers whose home department this is, or who logged hours there in the window (desktop deptDrill). */
export function deptWorkers(rows: Row[], hourEntries: HourEntry[], winDates: Set<string>, dept: string) {
  const logged = new Set(hourEntries.filter((e) => winDates.has(e.date) && e.departmentCode === dept).map((e) => e.workerId));
  const hoursHere = new Map<string, number>();
  for (const e of hourEntries) if (winDates.has(e.date) && e.departmentCode === dept) hoursHere.set(e.workerId, (hoursHere.get(e.workerId) ?? 0) + (Number(e.hours) || 0));
  const list = rows.filter((r) => r.dept === dept || logged.has(r.id)).sort((a, b) => (hoursHere.get(b.id) ?? 0) - (hoursHere.get(a.id) ?? 0));
  return { list, hoursHere };
}

// ---------------------------------------------------------------------------
// Chart (desktop: `chart` memo)
// ---------------------------------------------------------------------------
export type ChartPoint = { date: string; workingMin: number; productionMin: number; eff: number | null; cost: number };
export function mainChartPoints(days: EmpDay[], cost: Map<string, number>): ChartPoint[] {
  return dropIdleSundays(
    days.map((d) => {
      let c = 0;
      for (const x of d.workers ?? []) c += cost.get(`${x.workerId}|${d.date}`) ?? 0;
      return { date: d.date, workingMin: d.workingMinutes, productionMin: d.productionMinutes, eff: poolEff({ prod: d.productionMinutes, work: d.workingMinutes, hp: d.helperProductionMinutes, hw: d.helperWorkingMinutes }), cost: c };
    }),
    (r) => r.date,
    (r) => [Math.round((r.workingMin / 60) * 10) / 10, Math.round((r.productionMin / 60) * 10) / 10],
  );
}

// ---------------------------------------------------------------------------
// Non-production hours (desktop: NonProdHoursCard)
// ---------------------------------------------------------------------------
const nonOf = (x: EmpDayWorker) => Math.max(0, (x.allDeptMinutes ?? x.workingMinutes) - x.workingMinutes);
export type NpPoint = { date: string; hours: number; pct: number | null };
export function npChartPoints(days: EmpDay[]): NpPoint[] {
  return dropIdleSundays(
    days.map((d) => {
      let n = 0, all = 0;
      for (const x of d.workers ?? []) { n += nonOf(x); all += x.allDeptMinutes ?? x.workingMinutes; }
      return { date: d.date, hours: Math.round((n / 60) * 10) / 10, pct: all > 0 ? Math.round((n / all) * 1000) / 10 : null };
    }),
    (r) => r.date,
    (r) => [r.hours],
  );
}
export function npData(days: EmpDay[], winDates: Set<string>, workerById: Map<string, { dept: string | null }>) {
  const p = new Map<string, { id: string; non: number; all: number; days: number }>();
  for (const d of days) {
    if (!winDates.has(d.date)) continue;
    for (const x of d.workers ?? []) {
      const r = p.get(x.workerId) ?? { id: x.workerId, non: 0, all: 0, days: 0 };
      const n = nonOf(x);
      r.non += n;
      r.all += x.allDeptMinutes ?? x.workingMinutes;
      if (n > 0) r.days += 1;
      p.set(x.workerId, r);
    }
  }
  const list = [...p.values()];
  const dm = new Map<string, { dept: string; non: number; all: number; people: number; top: { id: string; non: number } | null }>();
  for (const r of list) {
    const dep = workerById.get(r.id)?.dept ?? "—";
    const e = dm.get(dep) ?? { dept: dep, non: 0, all: 0, people: 0, top: null };
    e.non += r.non;
    e.all += r.all;
    if (r.non > 0) e.people += 1;
    if (!e.top || r.non > e.top.non) e.top = { id: r.id, non: r.non };
    dm.set(dep, e);
  }
  return {
    people: list.filter((r) => r.non > 0).sort((a, b) => b.non - a.non),
    depts: [...dm.values()].filter((d) => d.all > 0).sort((a, b) => b.non - a.non),
    total: list.reduce((a, r) => a + r.non, 0),
    clocked: list.reduce((a, r) => a + r.all, 0),
  };
}
/** Where non-production hours were logged, per worker (entry departments outside the production floor). */
export function loggedUnder(entries: HourEntry[], winDates: Set<string>, workerId: string): string {
  const floor = floorSet();
  const mm = new Map<string, number>();
  for (const e of entries) {
    if (e.workerId !== workerId || !winDates.has(e.date) || !e.departmentCode || floor.has(e.departmentCode)) continue;
    mm.set(e.departmentCode, (mm.get(e.departmentCode) ?? 0) + (Number(e.hours) || 0));
  }
  return [...mm.entries()].sort((a, b) => b[1] - a[1]).map(([c, h]) => `${costCentreName(c)} ${h.toFixed(1)}h`).join(" · ");
}
export const NP_SHADE_SHARE = 0.2; // desktop: row shaded red at 20% or more of the person's clocked time
export const pctOf = (n: number, all: number) => (all > 0 ? `${((n / all) * 100).toFixed(1)}%` : "—");

// ---------------------------------------------------------------------------
// Attendance log (desktop: AttendanceLogCard)
// ---------------------------------------------------------------------------
export const hhmm = (t: string | null) => t?.match(/\d{2}:\d{2}/)?.[0] ?? "—";
/** Minutes after the 08:00 shift start; 0 when on time or unparseable. */
export const lateMin = (t: string | null) => {
  const m = t?.match(/(\d{2}):(\d{2})/);
  return m ? Math.max(0, Number(m[1]) * 60 + Number(m[2]) - 480) : 0;
};
const hrsLog = (min: number) => `${Math.round(min / 6) / 10}h`;
export const hLog = (v: number | null) => (v == null ? "—" : hrsLog(v));

export type LogRow = {
  key: string; id: string | null; name: string; dept: string | null; date: string | null; clockIn: string | null; clockOut: string | null;
  working: number | null; prod: number | null; nonProd: number | null; eff: number | null; absent: boolean; days: number; late: number;
};
export type LogGroups = { absent: { n: string; d: string }[]; late: { n: string; d: string }[]; on: { n: string; d: string }[] };
export type MonthRow = { id: string; name: string; dept: string | null; daysIn: number; notIn: number; late: number; lateMin: number };

const workerIdOf = (r: EmpAtt, byId: Set<string>, byName: Map<string, string>) =>
  r.employeeId && byId.has(r.employeeId) ? r.employeeId : (byName.get((r.employeeName ?? "").trim().toLowerCase()) ?? null);

/** One day in focus: every clock record that day, plus every headcount worker with none as NOT IN; not in → late → on time. */
export function dayLog(slice: EmpSlice, day: string): { rows: LogRow[]; absent: number; late: number; on: number; groups: LogGroups } {
  const { clockers } = rosterOf(slice);
  const byId = new Set(slice.workers.map((w) => w.id));
  const byName = new Map(slice.workers.map((w) => [(w.name ?? "").trim().toLowerCase(), w.id]));
  const perf = new Map<string, { working: number; prod: number; all: number }>();
  for (const d of slice.performance.byDay) for (const x of d.workers ?? []) perf.set(`${d.date}|${x.workerId}`, { working: x.workingMinutes, prod: x.productionMinutes, all: x.allDeptMinutes ?? x.workingMinutes });

  const byEmp = new Map<string, { last: EmpAtt; workerId: string | null; days: number }>();
  for (const r of slice.attendance) {
    if (!r.date || r.date.slice(0, 10) !== day) continue;
    const workerId = workerIdOf(r, byId, byName);
    const k = workerId ?? r.employeeId ?? r.employeeName ?? "";
    const cur = byEmp.get(k);
    byEmp.set(k, { last: !cur || r.date >= (cur.last.date ?? "") ? r : cur.last, workerId, days: (cur?.days ?? 0) + 1 });
  }
  const rows: LogRow[] = [...byEmp.entries()].map(([key, { last, workerId, days }]) => {
    const p = workerId && last.date ? perf.get(`${last.date}|${workerId}`) : undefined;
    return {
      key, id: workerId, name: last.employeeName ?? "—", dept: last.dept, date: last.date, clockIn: last.clockIn, clockOut: last.clockOut,
      working: p?.working ?? null, prod: p?.prod ?? null, nonProd: p ? Math.max(0, p.all - p.working) : null,
      eff: p && p.working > 0 ? (p.prod / p.working) * 100 : null, absent: false, days, late: lateMin(last.clockIn),
    };
  });
  const seen = new Set([...byEmp.values()].map((v) => v.workerId).filter(Boolean));
  for (const w of slice.workers) {
    if (!w.countsToHeadcount || isOutsourced(w) || !clockers.has(w.id) || seen.has(w.id)) continue;
    rows.push({ key: `absent|${w.id}`, id: w.id, name: w.name ?? "—", dept: w.dept, date: day, clockIn: null, clockOut: null, working: null, prod: null, nonProd: null, eff: null, absent: true, days: 0, late: 0 });
  }
  const rank = (r: LogRow) => (r.absent ? 0 : r.late > 0 ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const absent = rows.filter((r) => r.absent), late = rows.filter((r) => !r.absent && r.late > 0), on = rows.filter((r) => !r.absent && r.late === 0);
  const groups: LogGroups = {
    absent: absent.map((r) => ({ n: r.name, d: r.dept ? deptName(r.dept) : "—" })),
    late: [...late].sort((a, b) => b.late - a.late).map((r) => ({ n: r.name, d: `${hhmm(r.clockIn)} · ${r.late}m late` })),
    on: [...on].sort((a, b) => (a.clockIn ?? "").localeCompare(b.clockIn ?? "")).map((r) => ({ n: r.name, d: hhmm(r.clockIn) })),
  };
  return { rows, absent: absent.length, late: late.length, on: on.length, groups };
}

/** "This month": one row per person, most absent first, then most late (desktop monthRows). */
export function monthLog(slice: EmpSlice, monthYm: string): { rows: MonthRow[]; workDays: number; groups: LogGroups; absent: number; late: number; on: number } {
  const { clockers } = rosterOf(slice);
  const recs = slice.attendance.filter((r) => (r.date ?? "").startsWith(monthYm) && (r.clockIn || r.clockOut));
  const workDays = [...new Set(recs.map((r) => r.date as string))].sort();
  const byName = new Map(slice.workers.map((w) => [(w.name ?? "").trim().toLowerCase(), w.id]));
  const byWorker = new Map<string, EmpAtt[]>();
  for (const r of recs) {
    const id = r.employeeId ?? byName.get((r.employeeName ?? "").trim().toLowerCase()) ?? null;
    if (!id) continue;
    byWorker.set(id, [...(byWorker.get(id) ?? []), r]);
  }
  const rows: MonthRow[] = slice.workers
    .filter((w) => w.countsToHeadcount && !isOutsourced(w) && clockers.has(w.id))
    .map((w) => {
      const mine = byWorker.get(w.id) ?? [];
      const inDays = new Set(mine.map((r) => r.date));
      const lates = mine.map((r) => lateMin(r.clockIn)).filter((m) => m > 0);
      const first = [...inDays].sort()[0] ?? workDays[0];
      const expected = workDays.filter((d) => d >= (first ?? ""));
      return { id: w.id, name: w.name ?? w.id, dept: w.dept, daysIn: inDays.size, notIn: Math.max(0, expected.length - inDays.size), late: lates.length, lateMin: lates.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.notIn - a.notIn || b.late - a.late || b.lateMin - a.lateMin || a.name.localeCompare(b.name));
  const groups: LogGroups = {
    absent: rows.filter((r) => r.notIn > 0).map((r) => ({ n: r.name, d: `${r.notIn} day${r.notIn > 1 ? "s" : ""}` })),
    late: rows.filter((r) => r.late > 0).sort((a, b) => b.late - a.late || b.lateMin - a.lateMin).map((r) => ({ n: r.name, d: `${r.late}× · ${r.lateMin}m` })),
    on: rows.filter((r) => r.notIn === 0 && r.late === 0).map((r) => ({ n: r.name, d: `${r.daysIn} days` })),
  };
  return { rows, workDays: workDays.length, groups, absent: groups.absent.length, late: groups.late.length, on: groups.on.length };
}

/** Attendance records inside the page period for one person (the "Total days" of a log row). */
export function daysInPeriod(slice: EmpSlice, workerId: string, period: Period): number {
  return slice.attendance.filter((a) => a.employeeId === workerId && inFocus({ ...period, day: undefined }, a.date)).length;
}

// ---------------------------------------------------------------------------
// Presentation helpers shared by the cards
// ---------------------------------------------------------------------------
const AVC: [string, string][] = [["#F4EFE6", "#6B5C32"], ["#E7EEF1", "#1F4654"], ["#EEF3E4", "#4F7C3A"], ["#FBF3DC", "#85600F"], ["#F1E9F0", "#6B4A6D"]];
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const avatarOf = (n: string) => { const c = AVC[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVC.length]; return { ini: initials(n), avBg: c[0], avFg: c[1] }; };
/** Efficiency bar: scale 0..130 %, the dark tick sits at the configured target. */
export const effBar = (v: number | null, target: number) => (v == null ? null : { w: `${(Math.min(v, 130) / 130) * 100}%`, t: `${(Math.min(target, 130) / 130) * 100}%`, c: "" });

/** Chart geometry that does not depend on React (axis ticks of the main chart). */
export function mainAxis(points: ChartPoint[]) {
  const mxRaw = Math.max(1, ...points.map((d) => Math.max(d.workingMin, d.productionMin) / 60));
  const tick = mxRaw > 240 ? 90 : mxRaw > 120 ? 60 : mxRaw > 40 ? 20 : 10;
  const mxH = Math.ceil(mxRaw / tick) * tick;
  const maxEff = Math.max(0, ...points.map((d) => d.eff ?? 0));
  const mxP = Math.max(130, Math.ceil(maxEff / 10) * 10);
  const pTicks = mxP === 130 ? [0, 35, 70, 105, 130] : [0, 1, 2, 3, 4].map((i) => Math.round((mxP * i) / 4));
  const hTicks: number[] = [];
  for (let v = 0; v <= mxH; v += tick) hTicks.push(v);
  return { mxH, mxP, pTicks, hTicks };
}
export function npAxis(points: NpPoint[]) {
  const mxRaw = Math.max(1, ...points.map((v) => v.hours), ...points.map((v) => v.pct || 0));
  const tick = mxRaw > 40 ? 15 : mxRaw > 20 ? 10 : 5;
  const mx = Math.ceil(mxRaw / tick) * tick;
  const ticks: number[] = [];
  for (let v = 0; v <= mx; v += tick) ticks.push(v);
  return { mx, ticks };
}
/** Which of ~6 x labels to print (HTML rule). */
export function axisLabelIdx(n: number): Set<number> {
  const every = Math.max(1, Math.ceil(n / 6));
  const out = new Set<number>();
  for (let i = 0; i < n; i++) if ((i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every && i % every === 0 && n - 1 - i < every / 2)) out.add(i);
  return out;
}
