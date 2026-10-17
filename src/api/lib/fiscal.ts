// ---------------------------------------------------------------------------
// fiscal.ts — financial-year helpers (Phase 1, owner-maintainable FYE).
//
// The FYE (financial year end) month lives in kv_config under `fye_month`
// as { month: 1..12 } — e.g. 3 = year ends 31 Mar, 8 = 31 Aug. Everything
// fiscal-year-aware (P&L YTD window, quarter/half buckets, year-end profit
// close, cost-structure pages) reads it through getFyeMonth so changing
// the setting in the Accounting UI re-bases every report consistently.
//
// Default: 12 (calendar year) until the owner sets it. Changing FYE after
// data exists re-bases historical YTD/quarter groupings — the settings UI
// warns about this.
//
// Change Year End (finance backlog item 9, 2026-10-18): `fye_month` is now the
// year end BEFORE any change, and kv `fye_changes` = [{ from, to }] lists the
// transition years (src/lib/fiscal-year.ts). Reports read the year holding a
// month through getFySchedule + fyWindowAt; with no change saved every window
// is exactly what fyWindowFor gave.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { closedYearMessage, fyFor, isYm, lockedYearFor, type FyeChange, type FySchedule } from "../../lib/fiscal-year";

type Db = Env["Variables"]["DB"];

export const FYE_KV_KEY = "fye_month";
export const FYE_CHANGES_KV_KEY = "fye_changes";
/** The last months (YYYY-MM) of the financial years that are closed and
 *  locked (Close Year adds one, Reopen takes it out) — item 9 part B. */
export const FY_LOCKED_KV_KEY = "fy_locked_ends";

/** The year end before any Change Year End (kv `fye_month`; default 12). */
export async function getBaseFyeMonth(db: Db): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind(FYE_KV_KEY)
    .first<{ value: string }>();
  try {
    const v = JSON.parse(row?.value ?? "null") as { month?: number } | null;
    if (
      v &&
      typeof v.month === "number" &&
      Number.isInteger(v.month) &&
      v.month >= 1 &&
      v.month <= 12
    )
      return v.month;
  } catch {
    /* fall through to default */
  }
  return 12;
}

/** The base year end and every saved change (unreadable → none). */
export async function getFySchedule(db: Db): Promise<FySchedule> {
  const [fyeMonth, row] = await Promise.all([
    getBaseFyeMonth(db),
    db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(FYE_CHANGES_KV_KEY).first<{ value: string | null }>().catch(() => null),
  ]);
  let changes: FyeChange[] = [];
  try {
    const v = JSON.parse(row?.value ?? "[]") as unknown;
    if (Array.isArray(v)) changes = v.filter((c): c is FyeChange => !!c && isYm((c as FyeChange).from) && isYm((c as FyeChange).to));
  } catch {
    /* none */
  }
  return { fyeMonth, changes };
}

/** The year end in force now (the current financial year's last month) —
 *  for readers anchored on today (the finance dashboard). */
export async function getFyeMonth(db: Db): Promise<number> {
  const s = await getFySchedule(db);
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
  return Number(fyFor(now, s).endYm.slice(5, 7));
}

/**
 * Financial-year window containing `date` for the given FYE month.
 * FYE 3 (31 Mar) and date 2026-06-10 → start 2026-04-01, end 2027-03-31.
 * Returned as ISO date strings (inclusive start, inclusive end).
 */
export function fyWindowFor(
  date: Date,
  fyeMonth: number,
): { startIso: string; endIso: string; label: string } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1..12
  // FY starts the month AFTER the FYE month.
  const startMonth = (fyeMonth % 12) + 1;
  // If we're past the FY start month this calendar year, the FY started
  // this year; otherwise it started last year. Calendar-year FYE (12)
  // degenerates to start Jan of the current year.
  const startYear = m >= startMonth ? y : y - 1;
  const endYear = fyeMonth === 12 ? startYear : startYear + 1;
  const startIso = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(endYear, fyeMonth, 0)).getUTCDate();
  const endIso = `${endYear}-${String(fyeMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  const label =
    fyeMonth === 12 ? `FY ${startYear}` : `FY ${startYear}/${String(endYear).slice(2)}`;
  return { startIso, endIso, label };
}

/** fyWindowFor with the year-end changes: the financial year holding
 *  `date` (a Date, or a "YYYY-MM…" string). */
export function fyWindowAt(
  date: Date | string,
  s: FySchedule,
): { startIso: string; endIso: string; label: string } {
  const ym = typeof date === "string" ? date.slice(0, 7) : date.toISOString().slice(0, 7);
  const fy = fyFor(ym, s);
  const y = Number(fy.endYm.slice(0, 4));
  const m = Number(fy.endYm.slice(5, 7));
  const endDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startIso: `${fy.startYm}-01`, endIso: `${fy.endYm}-${String(endDay).padStart(2, "0")}`, label: fy.name };
}

// ---- closed-year lock (finance backlog item 9 part B) ----------------------------

/** A change refused because its document is dated in a closed year. */
export class ClosedYearError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedYearError";
  }
}

/** The locked years' last months (unreadable → none). */
export async function getFyLockedEnds(db: Db): Promise<Set<string>> {
  try {
    const row = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind(FY_LOCKED_KV_KEY).first<{ value: string | null }>();
    const v = JSON.parse(row?.value ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.filter(isYm) : []);
  } catch {
    return new Set();
  }
}

/** Why a change dated `dates` is refused (null = every date is in an open
 *  year). A date may be a day or a month; null / "" dates are skipped. */
export async function closedYearError(db: Db, dates: string | null | readonly (string | null)[]): Promise<string | null> {
  const list = (Array.isArray(dates) ? dates : [dates]).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}/.test(d));
  if (!list.length) return null;
  const locked = await getFyLockedEnds(db);
  if (!locked.size) return null;
  const sched = await getFySchedule(db);
  for (const d of list) {
    const fy = lockedYearFor(d, sched, locked);
    if (fy) return closedYearMessage(fy);
  }
  return null;
}

/** closedYearError, thrown — for code paths that answer by throwing. */
export async function assertYearOpen(db: Db, dates: string | null | readonly (string | null)[]): Promise<void> {
  const err = await closedYearError(db, dates);
  if (err) throw new ClosedYearError(err);
}
