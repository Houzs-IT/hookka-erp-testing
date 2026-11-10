// ---------------------------------------------------------------------------
// service-case-sla.ts — a target number of days per service-case stage
// (cross-system review pass 2, H1-7; sister Houzs#4754).
//
// The list already shows how many days a case has sat in its current stage
// ("Status Days"). The office now sets a target per stage (Settings on the
// Service Cases list); a case past its stage's target is OVERDUE — the row is
// flagged and the status chips count the overdue ones. Targets are read live,
// so a changed target applies to open cases straight away.
//
// Stored as one kv_config row (SERVICE_CASE_TARGETS_KEY), JSON
// { "<stage label>": days | null }. A stage with no target is never overdue.
// Closed and cancelled cases are never overdue. Pure; shared by the route and
// the page.
// ---------------------------------------------------------------------------
import { CASE_PIPELINE_STEPS } from "./case-pipeline";

export const SERVICE_CASE_TARGETS_KEY = "service_case_stage_targets";

/** Stages a target can be set on — every open stage (Closed is the end). */
export const TARGET_STAGES = CASE_PIPELINE_STEPS.filter((s) => s !== "Closed");

export type StageTargets = Partial<Record<string, number>>;

export const MAX_TARGET_DAYS = 365;

/** Whole days 1..365, or null for "no target". */
export function cleanTargetDays(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_TARGET_DAYS) return null;
  return n;
}

/** Read the stored value (string, {value}, object) into clean targets. */
export function parseStageTargets(raw: unknown): StageTargets {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (obj && typeof obj === "object" && "value" in (obj as object) && !Array.isArray(obj)) {
    obj = (obj as { value: unknown }).value;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: StageTargets = {};
  for (const stage of TARGET_STAGES) {
    const d = cleanTargetDays((obj as Record<string, unknown>)[stage]);
    if (d != null) out[stage] = d;
  }
  return out;
}

/**
 * Validate a PUT body's `targets`. Returns the clean map, or an error naming
 * the first bad stage / value.
 */
export function validateStageTargets(input: unknown): { ok: true; targets: StageTargets } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "targets must be an object of stage → days" };
  }
  const out: StageTargets = {};
  for (const [stage, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(TARGET_STAGES as readonly string[]).includes(stage)) {
      return { ok: false, error: `Unknown stage "${stage}"` };
    }
    if (v === null || v === "" || v === undefined) continue;
    const d = cleanTargetDays(v);
    if (d == null) return { ok: false, error: `${stage}: enter whole days from 1 to ${MAX_TARGET_DAYS}, or leave it empty` };
    out[stage] = d;
  }
  return { ok: true, targets: out };
}

/** Is this case past its current stage's target? */
export function isStageOverdue(
  row: { status: string; stageLabel: string; stageDays: number },
  targets: StageTargets,
): boolean {
  if (row.status === "CLOSED" || row.status === "CANCELLED") return false;
  const t = targets[row.stageLabel];
  return t != null && row.stageDays > t;
}

/** "3d over a 2d target" — the overdue flag's tooltip / filter text. */
export function overdueLabel(row: { stageLabel: string; stageDays: number }, targets: StageTargets): string {
  const t = targets[row.stageLabel];
  return t == null ? "" : `${row.stageDays - t}d over the ${t}d target for ${row.stageLabel}`;
}
