// ---------------------------------------------------------------------------
// capacity-headcount.ts — the "Workers" column of the Daily Capacity drill-down
// (owner 2026-11-17): everyone who PUNCHED IN that day — production staff,
// helpers, all departments — except outsource workers. It used to be the
// people named as PIC on the job cards completed that day, which left out
// helpers and anyone whose cards finished on another day.
// ---------------------------------------------------------------------------
import { isOutsourceWorker } from "./labour-to-date";

export interface PunchRow {
  employeeId: string | null | undefined;
  date: string | null | undefined;
  clockIn: unknown;
}

export interface HeadcountWorker {
  id: string;
  empNo?: string | null;
  name?: string | null;
  isOutsource?: unknown;
}

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "t" || v === "true";

/** Outsource = the worker flag, or the OSC… employee number / OUTSOURCE… name rule payroll uses. */
export function isOutsourceForHeadcount(w: HeadcountWorker): boolean {
  return truthy(w.isOutsource) || isOutsourceWorker({ empNo: w.empNo, name: w.name });
}

/**
 * Distinct people with a punch-in per day, outsource left out. A punch row
 * whose worker is unknown (deleted record) still counts — they did come in.
 */
export function punchInHeadcountByDay(
  punches: readonly PunchRow[],
  workers: readonly HeadcountWorker[],
): Map<string, number> {
  const outsource = new Set(workers.filter(isOutsourceForHeadcount).map((w) => w.id));
  const byDay = new Map<string, Set<string>>();
  for (const p of punches) {
    const id = p.employeeId ? String(p.employeeId) : "";
    const day = p.date ? String(p.date).slice(0, 10) : "";
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (p.clockIn == null || String(p.clockIn).trim() === "") continue;
    if (outsource.has(id)) continue;
    let set = byDay.get(day);
    if (!set) byDay.set(day, (set = new Set()));
    set.add(id);
  }
  return new Map([...byDay].map(([d, s]) => [d, s.size]));
}

export interface CardCredit {
  date: string;
  minutes: number;
  pic1Id?: string | null;
  pic2Id?: string | null;
}

/**
 * Minutes done by OUTSOURCE people per day (owner 2026-11-18: "排除外包工时"
 * from the per-worker figure, since outsource are not in the headcount). A
 * card's minutes split evenly over its PICs, as `creditCardToPics` does
 * (job-card-minutes.ts); a card with no PIC stays in-house.
 */
export function outsourceMinutesByDay(
  cards: readonly CardCredit[],
  workers: readonly HeadcountWorker[],
): Map<string, number> {
  const outsource = new Set(workers.filter(isOutsourceForHeadcount).map((w) => w.id));
  const byDay = new Map<string, number>();
  for (const c of cards) {
    const pics = [c.pic1Id, c.pic2Id].filter((id): id is string => !!id);
    if (!pics.length || !(c.minutes > 0)) continue;
    const share = (c.minutes * pics.filter((id) => outsource.has(id)).length) / pics.length;
    if (share > 0) byDay.set(c.date, (byDay.get(c.date) ?? 0) + share);
  }
  return new Map([...byDay].map(([d, m]) => [d, Math.round(m)]));
}
