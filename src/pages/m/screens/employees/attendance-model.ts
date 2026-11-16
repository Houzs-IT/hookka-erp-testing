// attendance-model.ts — the Attendance section's period, URL params and row grouping (HK-0125 Phase 2). Pure.
//
// Period: one Malaysia day (the date chip, default today, past dates allowed) or — only when arrived at by the Overview
// "Attendance exceptions" link (Phase 3) — a from..to range such as month to date. The URL carries it
// (`adate`, or `afrom` + `ato`, plus `loc`) so refresh and Back keep the place.
import { MIN_DATE, isYmd, rangeLabel } from "./employees-dates";
import { dayHeading } from "./employees-format";
import { parseLocFilter, type LocFilter, type LocPunch } from "./attendance-location";

export type AttRow = LocPunch & {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  hasClockInPhoto?: boolean;
  hasClockOutPhoto?: boolean;
};

export type AttPeriod = { kind: "day"; date: string } | { kind: "range"; from: string; to: string };

/** A range longer than this is ignored (falls back to the day) — keeps one request small. */
export const MAX_RANGE_DAYS = 93;

export const ATT_PARAMS = ["adate", "afrom", "ato", "loc"] as const;

function dayNumber(ymd: string): number {
  return Math.floor(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

/** Params → period + location filter. Anything invalid or in the future falls back to today. */
export function parseAttendanceParams(
  get: (key: string) => string | null,
  today: string,
): { period: AttPeriod; loc: LocFilter } {
  const loc = parseLocFilter(get("loc"));
  const from = get("afrom");
  const to = get("ato");
  if (isYmd(from) && isYmd(to) && from >= MIN_DATE && from <= to && to <= today && daysBetween(from, to) <= MAX_RANGE_DAYS) {
    return { period: { kind: "range", from, to }, loc };
  }
  const d = get("adate");
  if (isYmd(d) && d >= MIN_DATE && d <= today) return { period: { kind: "day", date: d }, loc };
  return { period: { kind: "day", date: today }, loc };
}

/** The existing endpoint, by `date` or by `from` + `to`. */
export function attendanceUrl(period: AttPeriod): string {
  return period.kind === "day"
    ? `/api/attendance?date=${period.date}`
    : `/api/attendance?from=${period.from}&to=${period.to}`;
}

/**
 * The link Phase 3's Overview uses: "Attendance exceptions" → Attendance, Off-site chip on, month to date.
 * Lives here so the Overview cannot invent a second spelling of these params.
 */
export function attendanceLink(opts: { loc?: LocFilter; from?: string; to?: string } = {}): string {
  const p = new URLSearchParams({ section: "attendance" });
  if (opts.loc && opts.loc !== "all") p.set("loc", opts.loc);
  if (opts.from && opts.to) {
    p.set("afrom", opts.from);
    p.set("ato", opts.to);
  }
  return `/m/employees?${p.toString()}`;
}

/**
 * Only rows with a punch, as desktop's Attendance tab does, and each attendance record ONCE (by id). The Overview's
 * "Attendance exceptions" count and the Attendance list both come through here, so they cannot disagree.
 */
export function punchRows(raw: readonly AttRow[] | null | undefined): AttRow[] {
  const seen = new Set<string>();
  const out: AttRow[] = [];
  for (const r of raw ?? []) {
    if (!(r.clockIn || r.clockOut)) continue;
    if (r.id) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
    }
    out.push(r);
  }
  return out;
}

export function periodLabel(period: AttPeriod): string {
  if (period.kind === "day") return dayHeading(period.date);
  return rangeLabel({ from: period.from, to: period.to });
}

const byName = (a: AttRow, b: AttRow) =>
  (a.employeeName || "").localeCompare(b.employeeName || "", undefined, { sensitivity: "base" }) ||
  (a.clockIn ?? "99:99").localeCompare(b.clockIn ?? "99:99");

/** Day → one group; range → one group per date, newest first. Rows inside a group are by name. */
export function groupAttendance(rows: readonly AttRow[]): { date: string; title: string; rows: AttRow[] }[] {
  const byDate = new Map<string, AttRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, title: dayHeading(date), rows: [...list].sort(byName) }));
}
