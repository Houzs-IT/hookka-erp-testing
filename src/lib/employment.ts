// ---------------------------------------------------------------------------
// employment.ts — THE rule for "is this person an employee on day D"
// (owner 2026-11-21: onboarding / offboarding must reflect across the whole
// system the same way — payroll, attendance, efficiency, Floor Live,
// dashboards, pickers, reports).
//
// A worker is EMPLOYED on day D when:
//   - they are not a test account (empNo TEST*), and
//   - their joinDate is empty or on/before D, and
//   - they have not left before D: a RESIGNED or INACTIVE worker counts up to
//     and including their last day (resignedAt). RESIGNED / INACTIVE with no
//     last day on record counts as gone (the API now requires the date; old
//     rows without one are fixed in the data).
//
// Use `employedOn` for a day, `employedDuring` for a period (anyone employed on
// at least one day of it), and the SQL builders for server queries so a
// screen and the query behind it can never disagree. Outsource is decided by
// the worker's isOutsource flag only.
// ---------------------------------------------------------------------------

export type EmploymentFields = {
  empNo?: string | null;
  status?: string | null;
  joinDate?: string | null;
  resignedAt?: string | null;
};

const ymd = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : "");

export function isTestWorker(w: { empNo?: string | null }): boolean {
  return /^TEST/i.test(w.empNo ?? "");
}

export function isOutsourceWorkerFlag(w: { isOutsource?: boolean | number | string | null }): boolean {
  const v = w.isOutsource;
  return v === true || v === 1 || v === "1" || v === "true";
}

const LEFT = new Set(["RESIGNED", "INACTIVE"]);

/** The worker's last working day, or null while still employed. */
export function lastDayOf(w: EmploymentFields): string | null {
  return ymd(w.resignedAt) || null;
}

/** Employed on day `day` (YYYY-MM-DD). */
export function employedOn(w: EmploymentFields, day: string): boolean {
  if (isTestWorker(w)) return false;
  const join = ymd(w.joinDate);
  if (join && join > day) return false;
  const left = LEFT.has((w.status ?? "").toUpperCase());
  const last = ymd(w.resignedAt);
  if (left) return !!last && last >= day;
  return !last || last >= day;
}

/**
 * May this worker use the worker app on `day`? (owner 2026-11-21: lock the
 * day AFTER the last working day, not the moment the status changes.)
 * ACTIVE: yes. RESIGNED / INACTIVE: up to and including resignedAt; no last
 * day on record = locked. Any other status = locked. Unlike employedOn, a test
 * account or a not-yet-joined ACTIVE hire keeps access (setting up a phone
 * before day one is normal).
 */
export function canUseWorkerApp(
  w: { status?: string | null; resignedAt?: string | null },
  day: string,
): boolean {
  const s = (w.status ?? "").toUpperCase();
  if (s === "ACTIVE") return true;
  if (!LEFT.has(s)) return false;
  const last = ymd(w.resignedAt);
  return !!last && last >= day;
}

/** Employed on at least one day of [from, to] (YYYY-MM-DD, inclusive). */
export function employedDuring(w: EmploymentFields, from: string, to: string): boolean {
  if (isTestWorker(w)) return false;
  const join = ymd(w.joinDate);
  if (join && join > to) return false;
  const left = LEFT.has((w.status ?? "").toUpperCase());
  const last = ymd(w.resignedAt);
  if (left) return !!last && last >= from;
  return !last || last >= from;
}

/**
 * SQL for "employed on day ?" over a workers alias. Bind employedOnParams(day)
 * (three placeholders). Columns are the adapter's camelCase.
 */
export function employedOnSql(alias = "w"): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}empNo NOT LIKE 'TEST%'
    AND (${a}joinDate IS NULL OR ${a}joinDate = '' OR substr(${a}joinDate::text, 1, 10) <= ?)
    AND (CASE WHEN ${a}status IN ('RESIGNED','INACTIVE')
              THEN ${a}resignedAt IS NOT NULL AND ${a}resignedAt <> '' AND substr(${a}resignedAt::text, 1, 10) >= ?
              ELSE ${a}resignedAt IS NULL OR ${a}resignedAt = '' OR substr(${a}resignedAt::text, 1, 10) >= ? END))`;
}

/** Parameters for employedOnSql. */
export function employedOnParams(day: string): string[] {
  return [day, day, day];
}

/**
 * SQL for "employed on at least one day of [?, ?]". Binds via
 * employedDuringParams(from, to).
 */
export function employedDuringSql(alias = "w"): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}empNo NOT LIKE 'TEST%'
    AND (${a}joinDate IS NULL OR ${a}joinDate = '' OR substr(${a}joinDate::text, 1, 10) <= ?)
    AND (CASE WHEN ${a}status IN ('RESIGNED','INACTIVE')
              THEN ${a}resignedAt IS NOT NULL AND ${a}resignedAt <> '' AND substr(${a}resignedAt::text, 1, 10) >= ?
              ELSE ${a}resignedAt IS NULL OR ${a}resignedAt = '' OR substr(${a}resignedAt::text, 1, 10) >= ? END))`;
}

export function employedDuringParams(from: string, to: string): string[] {
  return [to, from, from];
}

/** Last day (YYYY-MM-DD) of a YYYY-MM period. */
export function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
