// ---------------------------------------------------------------------------
// fiscal-year.ts (pure) — financial years with year-end changes (finance
// backlog item 9; the design's Settings › Financial Year End: "Change Year
// End is Super Admin only, closed years are locked, transition-year
// preview", and Month / Quarter / Financial Year pickers on the reports).
//
// The books' year end is kv `fye_month` — the month every year ended in
// before any change. A change is { from, to }: the financial year starting
// `from` (YYYY-MM) becomes a transition year ending `to`; its month is the
// new year end and the years after it run twelve months to it. A transition
// year is 1 to 18 months long (a company's financial year may run up to 18
// months when its year end changes). With no change every year is the old
// twelve months, so every report reads exactly what it read before.
// ---------------------------------------------------------------------------

export type FyeChange = { from: string; to: string };
export type FySchedule = { fyeMonth: number; changes: FyeChange[] };
export type FyPeriod = { name: string; startYm: string; endYm: string; months: number; transition: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const yOf = (ym: string) => Number(ym.slice(0, 4));
const mOf = (ym: string) => Number(ym.slice(5, 7));
export const isYm = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function addMonths(ym: string, n: number): string {
  const t = yOf(ym) * 12 + (mOf(ym) - 1) + n;
  return `${Math.floor(t / 12)}-${pad((((t % 12) + 12) % 12) + 1)}`;
}

/** Months from `a` to `b`, both counted ("2026-09".."2026-12" = 4). */
export function monthsBetween(a: string, b: string): number {
  return (yOf(b) - yOf(a)) * 12 + (mOf(b) - mOf(a)) + 1;
}

/** "FY 2025/26"; a year inside one calendar year reads "FY 2026". */
export function fyName(startYm: string, endYm: string): string {
  const a = startYm.slice(0, 4);
  const b = endYm.slice(0, 4);
  return a === b ? `FY ${a}` : `FY ${a}/${b.slice(2)}`;
}

// The start of the twelve-month year (one year end) holding `ym`.
function startUnder(ym: string, fyeMonth: number): string {
  const startMonth = (fyeMonth % 12) + 1;
  return mOf(ym) >= startMonth ? `${yOf(ym)}-${pad(startMonth)}` : `${yOf(ym) - 1}-${pad(startMonth)}`;
}

const validChanges = (s: FySchedule) =>
  s.changes
    .filter((c) => isYm(c.from) && isYm(c.to) && c.to >= c.from && monthsBetween(c.from, c.to) <= 18)
    .sort((a, b) => a.from.localeCompare(b.from));

/** Every financial year overlapping [fromYm, toYm], oldest first. */
export function fyPeriods(s: FySchedule, fromYm: string, toYm: string): FyPeriod[] {
  const changes = validChanges(s);
  let fye = s.fyeMonth >= 1 && s.fyeMonth <= 12 ? s.fyeMonth : 12;
  const earliest = changes.length && changes[0].from < fromYm ? changes[0].from : fromYm;
  let start = startUnder(earliest, fye);
  const out: FyPeriod[] = [];
  for (let guard = 0; start <= toYm && guard < 600; guard++) {
    const ch = changes.find((c) => c.from === start);
    let end: string;
    if (ch) {
      end = ch.to;
      fye = mOf(ch.to);
    } else {
      end = addMonths(start, 11);
    }
    if (end >= fromYm) out.push({ name: fyName(start, end), startYm: start, endYm: end, months: monthsBetween(start, end), transition: !!ch && monthsBetween(start, end) !== 12 });
    start = addMonths(end, 1);
  }
  return out;
}

/** The financial year holding month `ym`. */
export function fyFor(ym: string, s: FySchedule): FyPeriod {
  return fyPeriods(s, ym, ym)[0];
}

/** A year's quarters: three-month blocks from its start (a transition
 *  year's last block may be shorter). */
export function fyQuarters(fy: FyPeriod): { q: number; startYm: string; endYm: string }[] {
  const out: { q: number; startYm: string; endYm: string }[] = [];
  for (let i = 0; i * 3 < fy.months; i++) {
    const startYm = addMonths(fy.startYm, i * 3);
    const end = addMonths(startYm, 2);
    out.push({ q: i + 1, startYm, endYm: end > fy.endYm ? fy.endYm : end });
  }
  return out;
}

// ---- period keys the reports pass around ------------------------------------
// "fy:2025-09..2026-08" — a financial year; "fyq:2025-09..2026-08:Q1" — a
// quarter of it. The server reads both through parseFyKey (periodStartYm /
// periodEndYm), so a report never needs the schedule to find its months.

export const fyKey = (fy: Pick<FyPeriod, "startYm" | "endYm">) => `fy:${fy.startYm}..${fy.endYm}`;
export const fyqKey = (fy: Pick<FyPeriod, "startYm" | "endYm">, q: number) => `fyq:${fy.startYm}..${fy.endYm}:Q${q}`;

export function parseFyKey(key: string): { kind: "year" | "quarter"; fy: { startYm: string; endYm: string; name: string }; q: number | null; startYm: string; endYm: string } | null {
  const m = /^(fy|fyq):(\d{4}-\d{2})\.\.(\d{4}-\d{2})(?::Q(\d{1,2}))?$/.exec(key);
  if (!m || !isYm(m[2]) || !isYm(m[3]) || m[3] < m[2]) return null;
  const fy = { startYm: m[2], endYm: m[3], name: fyName(m[2], m[3]) };
  if (m[1] === "fy") return m[4] ? null : { kind: "year", fy, q: null, startYm: fy.startYm, endYm: fy.endYm };
  if (!m[4]) return null;
  const q = Number(m[4]);
  const startYm = addMonths(fy.startYm, (q - 1) * 3);
  if (startYm > fy.endYm) return null;
  const end = addMonths(startYm, 2);
  return { kind: "quarter", fy, q, startYm, endYm: end > fy.endYm ? fy.endYm : end };
}

// ---- Change Year End ----------------------------------------------------------

/** The transition years a change to `newMonth` could make, starting `fy`:
 *  ending at the first `newMonth` month after its start, or a year later —
 *  only those 1 to 18 months long. A year that already ends in `newMonth`
 *  offers nothing (no change). */
export function yearEndChangeOptions(fy: Pick<FyPeriod, "startYm" | "endYm">, newMonth: number): { to: string; months: number }[] {
  if (!(newMonth >= 1 && newMonth <= 12) || mOf(fy.endYm) === newMonth) return [];
  let first = fy.startYm;
  while (mOf(first) !== newMonth) first = addMonths(first, 1);
  return [first, addMonths(first, 12)]
    .map((to) => ({ to, months: monthsBetween(fy.startYm, to) }))
    .filter((o) => o.months >= 1 && o.months <= 18);
}

/** Why a change cannot be saved (null = it can): it starts a year that is
 *  closed or already over, or its length is not one the year allows. */
export function yearEndChangeError(
  s: FySchedule,
  change: FyeChange,
  closedEnds: ReadonlySet<string>,
  todayYm: string,
): string | null {
  if (!isYm(change.from) || !isYm(change.to)) return "Pick the financial year and the new year end";
  const fy = fyPeriods(s, change.from, change.from).find((f) => f.startYm === change.from);
  if (!fy) return "The change must start at the beginning of a financial year";
  if (closedEnds.has(fy.endYm)) return `${fy.name} is closed — a closed year cannot change`;
  if (fy.endYm < todayYm) return `${fy.name} is already over — change the year end from the current year or a later one`;
  const ok = yearEndChangeOptions(fy, mOf(change.to)).some((o) => o.to === change.to);
  if (!ok) return "The transition year must run 1 to 18 months to the new year end";
  return null;
}

/** The schedule with `change` saved: changes from that year on are replaced
 *  (a later year end follows from this one). */
export function withYearEndChange(s: FySchedule, change: FyeChange): FySchedule {
  return { fyeMonth: s.fyeMonth, changes: [...validChanges(s).filter((c) => c.from < change.from), change] };
}
