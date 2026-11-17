// working-hours-model.ts — rows, filters and grouping for the Working Hours section (HK-0125 Phase 2). Pure.
//
// One row = one worker on one day, built from the existing `GET /api/working-hour-entries?from&to` (hours by
// department / category), `GET /api/attendance?from&to` (punch in / out), the worker list (name, employee no, standard
// hours) and the department list (names). Hours on a card are ALWAYS the worker's full-day total across departments; the
// table lists every department segment, and an active department filter only decides which days appear and which
// segment is highlighted — it never re-totals the day.
import { thisMonthRange, type YmdRange } from "./employees-dates";
import { dayHeading, fmtHours } from "./employees-format";

export type WhEntry = {
  id?: string;
  workerId: string;
  date: string;
  departmentCode: string;
  category: string;
  hours: number;
  notes: string;
};
export type WhPunch = {
  employeeId: string;
  employeeName?: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
};
export type WhWorker = { id: string; name: string; empNo: string; workingHoursPerDay?: number };
export type WhDept = { code: string; name: string };

export type WhSeg = { deptCode: string; deptName: string; category: string; hours: number; notes: string };
export type WhTagTone = "ot" | "short" | "full";
export type WhRow = {
  key: string;
  workerId: string;
  name: string;
  empNo: string;
  date: string;
  /** Full-day total across every department. */
  total: number;
  /** The worker's standard day (Employee Master `workingHoursPerDay`, else 9 — desktop's rule). */
  std: number;
  tag: { label: string; tone: WhTagTone };
  punchIn: string | null;
  punchOut: string | null;
  segs: WhSeg[];
};
export type WhFilters = { q: string; date: string; dept: string };

/** URL params of this section. Kept apart from Attendance's so switching tabs never carries one over to the other. */
export const WH_PARAMS = ["q", "wdate", "wdept"] as const;

const DEFAULT_STD = 9;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** More than the standard day → "OT", less → "short", equal → "full day". */
export function dayTag(total: number, std: number): { label: string; tone: WhTagTone } {
  const t = round2(total);
  const s = std > 0 ? std : DEFAULT_STD;
  const text = `${fmtHours(t)} h`;
  if (t > s + 0.005) return { label: `${text} · OT`, tone: "ot" };
  if (t < s - 0.005) return { label: `${text} · short`, tone: "short" };
  return { label: `${text} · full day`, tone: "full" };
}

export function buildRows(
  entries: readonly WhEntry[] | null | undefined,
  punches: readonly WhPunch[] | null | undefined,
  workers: readonly WhWorker[] | null | undefined,
  depts: readonly WhDept[] | null | undefined,
): WhRow[] {
  const workerById = new Map((workers ?? []).map((w) => [w.id, w]));
  const deptName = new Map((depts ?? []).map((d) => [d.code, d.name]));
  const punchByDay = new Map<string, WhPunch>();
  for (const p of punches ?? []) punchByDay.set(`${p.employeeId}|${p.date}`, p);

  const byDay = new Map<string, WhEntry[]>();
  for (const e of entries ?? []) {
    const k = `${e.workerId}|${e.date}`;
    const list = byDay.get(k);
    if (list) list.push(e);
    else byDay.set(k, [e]);
  }

  const rows: WhRow[] = [];
  for (const [key, list] of byDay) {
    const { workerId, date } = list[0];
    const w = workerById.get(workerId);
    const p = punchByDay.get(key);
    const std = w?.workingHoursPerDay && w.workingHoursPerDay > 0 ? w.workingHoursPerDay : DEFAULT_STD;
    const total = round2(list.reduce((s, e) => s + (Number(e.hours) || 0), 0));
    rows.push({
      key,
      workerId,
      name: w?.name || p?.employeeName || workerId,
      empNo: w?.empNo ?? "",
      date,
      total,
      std,
      tag: dayTag(total, std),
      punchIn: p?.clockIn ?? null,
      punchOut: p?.clockOut ?? null,
      segs: list.map((e) => ({
        deptCode: e.departmentCode,
        deptName: deptName.get(e.departmentCode) || e.departmentCode,
        category: e.category || "",
        hours: Number(e.hours) || 0,
        notes: e.notes || "",
      })),
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Name or employee-number match, a single work date and/or a department; `skip` leaves one filter out (chip counts). */
export function applyFilters(rows: readonly WhRow[], f: WhFilters, skip?: keyof WhFilters): WhRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (skip === "date" || !f.date || r.date === f.date) &&
      (skip === "dept" || !f.dept || r.segs.some((s) => s.deptCode === f.dept)) &&
      (skip === "q" || !q || r.name.toLowerCase().includes(q) || r.empNo.toLowerCase().includes(q)),
  );
}

/** "All" plus every department present in the rows, each with the count under the OTHER active filters. */
export function deptOptions(rows: readonly WhRow[], f: WhFilters): { code: string; name: string; count: number }[] {
  const base = applyFilters(rows, f, "dept");
  const names = new Map<string, string>();
  for (const r of rows) for (const s of r.segs) if (!names.has(s.deptCode)) names.set(s.deptCode, s.deptName);
  const opts = [...names.entries()]
    .map(([code, name]) => ({ code, name, count: base.filter((r) => r.segs.some((s) => s.deptCode === code)).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [{ code: "", name: "All", count: base.length }, ...opts];
}

export type WhGroup = { date: string; title: string; workers: number; hours: number; rows: WhRow[] };

/** By date, newest first. `hours` is the sum of the full-day totals shown in the group. */
export function groupByDate(rows: readonly WhRow[]): WhGroup[] {
  const out: WhGroup[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.date === r.date) {
      last.rows.push(r);
      last.workers += 1;
      last.hours = round2(last.hours + r.total);
    } else {
      out.push({ date: r.date, title: dayHeading(r.date), workers: 1, hours: r.total, rows: [r] });
    }
  }
  return out;
}

/** The first `limit` rows across groups (the HTML shows 5, then "Show all N"). */
export function limitGroups(groups: readonly WhGroup[], limit: number): WhGroup[] {
  const out: WhGroup[] = [];
  let left = limit;
  for (const g of groups) {
    if (left <= 0) break;
    const rows = g.rows.slice(0, left);
    left -= rows.length;
    out.push({ ...g, rows });
  }
  return out;
}

/** What to fetch: the Malaysia month of the picked date, else the current month. */
export function windowFor(date: string, today: string): YmdRange {
  return thisMonthRange(date || today);
}
