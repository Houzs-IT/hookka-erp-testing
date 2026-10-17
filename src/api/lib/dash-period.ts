// ---------------------------------------------------------------------------
// dash-period.ts — the Command Center's `period` query value, parsed once.
//
//   all          every month (the old default)
//   YYYY-MM      one month
//   YYYY-Qn      a calendar quarter            (owner 2026-10-17: 季度与年)
//   YYYY         a calendar year
//
// Every period-scoped figure in dashboard-overview.ts used to compare a row's
// month with `period` by string equality, so only "one month" or "all" could
// exist. They now ask `inYm(ym)` / use `monthsSql`, and the month-window
// widgets (Revenue chart, Completed, Daily Capacity) take start/end from here.
// Pure; the route passes today's ISO date.
// ---------------------------------------------------------------------------
export type DashPeriodKind = "all" | "month" | "quarter" | "year";

export type DashPeriod = {
  key: string;
  kind: DashPeriodKind;
  /** Months in the period, oldest first (empty for "all"). */
  months: string[];
  firstYm: string;
  lastYm: string;
  /** The equal-length period before this one ("" for "all"). */
  prevKey: string;
  prevMonths: string[];
  /** First and last calendar day of the period. */
  startISO: string;
  lastDayISO: string;
  inYm: (ym: string | null | undefined) => boolean;
  /** `'2026-10','2026-11',…` — only ever built from validated months, safe to inline. */
  monthsSql: string;
};

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

function span(y: number, m1: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(y, m1 - 1 + i, 1));
    out.push(ym(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return out;
}

export function parseDashPeriod(raw: string | null | undefined): DashPeriod {
  const s = String(raw ?? "").trim().toUpperCase();
  let kind: DashPeriodKind = "all";
  let months: string[] = [];
  let prevMonths: string[] = [];
  let key = "all";
  let prevKey = "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})$/)) && +m[2] >= 1 && +m[2] <= 12) {
    kind = "month";
    key = s;
    months = [s];
    prevMonths = span(+m[1], +m[2] - 1, 1);
    prevKey = prevMonths[0];
  } else if ((m = s.match(/^(\d{4})-Q([1-4])$/))) {
    kind = "quarter";
    key = s;
    const y = +m[1];
    const q = +m[2];
    months = span(y, (q - 1) * 3 + 1, 3);
    const py = q === 1 ? y - 1 : y;
    const pq = q === 1 ? 4 : q - 1;
    prevKey = `${py}-Q${pq}`;
    prevMonths = span(py, (pq - 1) * 3 + 1, 3);
  } else if ((m = s.match(/^(\d{4})$/))) {
    kind = "year";
    key = s;
    months = span(+m[1], 1, 12);
    prevKey = String(+m[1] - 1);
    prevMonths = span(+m[1] - 1, 1, 12);
  }
  const set = new Set(months);
  const firstYm = months[0] ?? "";
  const lastYm = months[months.length - 1] ?? "";
  return {
    key,
    kind,
    months,
    firstYm,
    lastYm,
    prevKey,
    prevMonths,
    startISO: firstYm ? `${firstYm}-01` : "",
    lastDayISO: lastYm ? lastDay(+lastYm.slice(0, 4), +lastYm.slice(5, 7)) : "",
    inYm: (v) => kind === "all" || (!!v && set.has(String(v).slice(0, 7))),
    monthsSql: months.map((x) => `'${x}'`).join(","),
  };
}
