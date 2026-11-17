// working-hours-copy.ts — Working Hours → "..." → Copy yesterday / Copy from another date (HK-0125). Desktop's Copy workflow
// (employees.tsx WorkingHoursTab `copyFromSource` / `copyYesterday` / `saveRow`), on the phone. It WRITES, but only in two steps:
//   1. COPY    reads the source day's entries and builds editable DRAFTS for the target day. Nothing is written.
//   2. SAVE    posts each kept draft to POST /api/working-hour-entries (server gate: attendance:create), one at a time (parallel posts
//              race the server's auto-create attendance helper for the same worker + day), exactly the body desktop's saveRow sends.
// Rules kept from desktop: a source row is skipped when the same worker + department + category already exists on the target day;
// the source day cannot equal the target day; an empty source and "everything already there" are reported, not silently ignored.
// Owner 2026-11-17: the target is the selected work date when it is a single day, otherwise a picker; the user can untick rows and
// edit hours and notes before saving. Pure: `fetchFn` is injected.
import type { WhEntry } from "./working-hours-model";

export type DraftState = "idle" | "saving" | "saved" | "failed";
export type CopyDraft = {
  key: string;
  workerId: string;
  deptCode: string;
  category: string;
  /** Kept as typed so a half-edited number is not rewritten under the user's thumb. */
  hours: string;
  notes: string;
  keep: boolean;
  state: DraftState;
  error?: string;
};

/** The day before `ymd` (UTC arithmetic: no clock, no timezone). */
export function yesterdayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) - 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** The copy target: the selected work date when it is ONE day (no picker), else the picker's value (default today). */
export function copyTarget(selectedDate: string, today: string): { fixed: boolean; date: string } {
  return /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? { fixed: true, date: selectedDate } : { fixed: false, date: today };
}

export type CopyResult = { ok: true; drafts: CopyDraft[] } | { ok: false; message: string };

/** Desktop's checks and its dedup, in desktop's order and wording. */
export function buildCopyDrafts(input: { source: readonly WhEntry[]; onTarget: readonly WhEntry[]; sourceDate: string; targetDate: string }): CopyResult {
  const { source, onTarget, sourceDate, targetDate } = input;
  if (!sourceDate) return { ok: false, message: "Pick a source date first" };
  if (sourceDate === targetDate) return { ok: false, message: "Source date can't equal target date" };
  if (source.length === 0) return { ok: false, message: `No entries on ${sourceDate} to copy` };
  const have = new Set(onTarget.filter((e) => e.workerId).map((e) => `${e.workerId}|${e.departmentCode}|${e.category}`));
  const drafts = source
    .filter((e) => !have.has(`${e.workerId}|${e.departmentCode}|${e.category}`))
    .map(
      (e, i): CopyDraft => ({
        key: `${e.workerId}|${e.departmentCode}|${e.category}|${i}`,
        workerId: e.workerId,
        deptCode: e.departmentCode,
        category: e.category ?? "",
        hours: String(e.hours ?? 0),
        notes: e.notes ?? "",
        keep: true,
        state: "idle",
      }),
    );
  if (drafts.length === 0) return { ok: false, message: "All matching entries already exist on this date" };
  return { ok: true, drafts };
}

/** The body desktop's saveRow POSTs for a NEW row. */
export const saveBody = (d: CopyDraft, targetDate: string) => ({ workerId: d.workerId, date: targetDate, departmentCode: d.deptCode, category: d.category, hours: Number(d.hours) || 0, notes: d.notes });

type Resp = { ok: boolean; status: number; json: () => Promise<unknown> };
type FetchFn = (url: string, init?: { method: string; headers: Record<string, string>; body: string }) => Promise<Resp>;

/** A day's entries (`GET /api/working-hour-entries?date=`), or null when the response is not a list. */
export async function fetchDay(date: string, fetchFn: FetchFn): Promise<WhEntry[] | null> {
  try {
    const r = await fetchFn(`/api/working-hour-entries?date=${date}`);
    const j = (await r.json()) as { success?: boolean; data?: unknown };
    return r.ok && Array.isArray(j?.data) ? (j.data as WhEntry[]) : null;
  } catch {
    return null;
  }
}

/** Save one draft; returns it marked saved, or failed with the server's message (desktop: `j.error || HTTP status`). */
export async function saveDraft(d: CopyDraft, targetDate: string, fetchFn: FetchFn): Promise<CopyDraft> {
  try {
    const r = await fetchFn("/api/working-hour-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saveBody(d, targetDate)) });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; data?: unknown; error?: string };
    if (!r.ok || !j.success || !j.data) throw new Error(j.error || `HTTP ${r.status}`);
    return { ...d, state: "saved", error: undefined };
  } catch (e) {
    return { ...d, state: "failed", error: e instanceof Error ? e.message : "Couldn't save. Please try again." };
  }
}

/** The drafts a Save will post: kept, not already saved. */
export const toSave = (drafts: readonly CopyDraft[]): CopyDraft[] => drafts.filter((d) => d.keep && d.state !== "saved");
