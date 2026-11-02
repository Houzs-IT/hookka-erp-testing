// ---------------------------------------------------------------------------
// hub-health.ts — Hookka's health report for the Houzs IT Hub.
//
// The hub's own check of /api/health only proves the Worker answers. This sends
// what it cannot see: a live database query, the email queue, and whether Claude
// calls are working, by feature and model. The hub draws it on its System health
// page. The warm-lists tick sends it every 5 minutes (worker.ts).
//
// AI status comes from real calls in ai_usage_events; no test call is made, so a
// broken key shows at the first call after it broke. The latest call of each
// feature and model decides: one that has since worked is not a problem now.
// ---------------------------------------------------------------------------
import { recentAiCalls, type RecentAiCall } from "./ai-usage";

export type HealthStatus = "ok" | "warning" | "critical" | "off";

export interface HealthCheck {
  key: string;
  label: string;
  value: string;
  status: HealthStatus;
  summary: string;
  detail?: string;
}

const DAY_MS = 86400_000;
const HUB_TIMEOUT_MS = 15_000;
const AI_ROWS = 2000;
const STUCK_EMAIL_MS = 30 * 60_000;
const MAX_PROBLEMS = 10;

const FEATURE_NAMES: Record<string, string> = {
  scan_po: "PO scan",
  scan_supplier_do: "Supplier DO scan",
  scan_doc_boundary: "Document split",
  scan_distill_customer: "Customer scan rules",
  scan_distill_supplier: "Supplier scan rules",
  assistant: "Hookka AI",
  agent_brain: "Agent brain",
  announcement_translate: "Announcement translation",
};
export const featureName = (f: string) => FEATURE_NAMES[f] ?? f;

/** Pure: what a failed call's status means, and whether it needs a person. */
export function aiFailure(status: number | null): { reason: string; status: "critical" | "warning" } {
  if (status === 401 || status === 403) return { reason: "Key wrong, expired or not allowed", status: "critical" };
  if (status === 404) return { reason: "Model not available", status: "critical" };
  // Anthropic answers 400 both for no credit and for a file it cannot read.
  if (status === 400) return { reason: "Refused: out of credit, or a file it could not read", status: "warning" };
  if (status === 429) return { reason: "Rate limit reached", status: "warning" };
  if (status === 529) return { reason: "Anthropic overloaded", status: "warning" };
  if (status && status >= 500) return { reason: `Anthropic error ${status}`, status: "warning" };
  if (!status) return { reason: "Could not reach Anthropic", status: "warning" };
  return { reason: `Answered ${status}`, status: "warning" };
}

/** Pure: one card from the last day's calls, newest first. */
export function aiCheck(key: string, label: string, idle: string, calls: RecentAiCall[], hasKey: boolean): HealthCheck {
  if (!hasKey) {
    return { key, label, value: "No key", status: "critical", summary: "ANTHROPIC_API_KEY is not set, so every call fails." };
  }
  if (!calls.length) return { key, label, value: "Idle", status: "ok", summary: idle };

  const seen = new Map<string, { feature: string; model: string; latest: RecentAiCall; total: number; failed: number }>();
  for (const c of calls) {
    const k = `${c.feature}|${c.model}`;
    const s = seen.get(k) ?? { feature: c.feature, model: c.model, latest: c, total: 0, failed: 0 };
    s.total += 1;
    if (Number(c.ok) !== 1) s.failed += 1;
    seen.set(k, s);
  }
  const groups = [...seen.values()];
  const failing = groups
    .filter((g) => Number(g.latest.ok) !== 1)
    .map((g) => ({ ...g, ...aiFailure(g.latest.http_status) }));
  if (failing.length) {
    const lines = failing.map(
      (g) => `${featureName(g.feature)}, ${g.model}: ${g.failed} of ${g.total} failed in 24h. ${g.reason}`,
    );
    const critical = failing.some((g) => g.status === "critical");
    return {
      key,
      label,
      value: critical ? "Problem" : "Check",
      status: critical ? "critical" : "warning",
      summary: lines[0]!,
      ...(lines.length > 1 ? { detail: lines.slice(1).join("; ") } : {}),
    };
  }
  const failed = groups.reduce((a, g) => a + g.failed, 0);
  const models = [...new Set(groups.map((g) => g.model))].join(", ");
  return {
    key,
    label,
    value: "Working",
    status: "ok",
    summary: `${calls.length} call${calls.length === 1 ? "" : "s"} in 24h${failed ? `, ${failed} failed but working since` : ""}`,
    detail: `Models: ${models}`,
  };
}

/** Pure: the newest failed calls, for the report's problem list. */
export function aiProblems(calls: RecentAiCall[]) {
  return calls
    .filter((c) => Number(c.ok) !== 1)
    .slice(0, MAX_PROBLEMS)
    .map((c) => ({
      at: c.created_at,
      what: "AI call failed",
      where: `${featureName(c.feature)}, ${c.model}`,
      error: aiFailure(c.http_status).reason,
    }));
}

async function emailCheck(db: D1Database, hasKey: boolean, now: number): Promise<HealthCheck> {
  const base = { key: "email", label: "Email" };
  if (!hasKey) return { ...base, value: "No key", status: "critical", summary: "RESEND_API_KEY is not set, so no email can go out." };
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM outbox_emails WHERE status = 'FAILED' AND created_at >= ?) AS failed,
              (SELECT COUNT(*) FROM outbox_emails WHERE status IN ('PENDING','RETRYING') AND created_at < ?) AS stuck`,
    )
    .bind(new Date(now - DAY_MS).toISOString(), new Date(now - STUCK_EMAIL_MS).toISOString())
    .first<{ failed: number; stuck: number }>();
  const failed = Number(row?.failed ?? 0);
  const stuck = Number(row?.stuck ?? 0);
  const bad = failed > 0 || stuck > 0;
  return {
    ...base,
    value: bad ? `${failed + stuck}` : "OK",
    status: bad ? "warning" : "ok",
    summary: bad ? `${failed} failed in 24h, ${stuck} waiting over 30 minutes` : "Nothing failed or stuck in 24h",
  };
}

export interface HubHealthEnv {
  IT_HUB_URL?: string;
  IT_HUB_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  RESEND_API_KEY?: string;
}

/** Measures with whatever still works: a failed part becomes a red card, never a missing report. */
export async function measureHealth(db: D1Database, env: HubHealthEnv, nowMs = Date.now()) {
  const t0 = Date.now();
  let dbState: { ok: boolean; latency_ms: number; error?: string };
  try {
    await db.prepare("SELECT 1 AS x").first();
    dbState = { ok: true, latency_ms: Date.now() - t0 };
  } catch {
    // Driver messages can name tables, so they stay out of the report.
    console.error("[hub-health] database check failed");
    dbState = { ok: false, latency_ms: Date.now() - t0, error: "Did not answer a live query" };
  }

  const checks: HealthCheck[] = [];
  let problems: ReturnType<typeof aiProblems> = [];
  try {
    const calls = await recentAiCalls(db, new Date(nowMs - DAY_MS).toISOString(), AI_ROWS);
    const hasKey = !!env.ANTHROPIC_API_KEY;
    const isScan = (c: RecentAiCall) => c.feature.startsWith("scan_");
    checks.push(aiCheck("ocr", "OCR", "No scans in 24h", calls.filter(isScan), hasKey));
    checks.push(aiCheck("ai", "Other AI", "No calls in 24h", calls.filter((c) => !isScan(c)), hasKey));
    problems = aiProblems(calls);
  } catch {
    console.error("[hub-health] AI calls could not be read");
    checks.push({ key: "ocr", label: "OCR", value: "—", status: "critical", summary: "Could not be checked." });
  }
  try {
    checks.push(await emailCheck(db, !!env.RESEND_API_KEY, nowMs));
  } catch {
    console.error("[hub-health] email queue could not be read");
    checks.push({ key: "email", label: "Email", value: "—", status: "critical", summary: "Could not be checked." });
  }

  return {
    ok: dbState.ok && !checks.some((c) => c.status === "critical"),
    time: new Date(nowMs).toISOString(),
    db: dbState,
    counts: {},
    checks,
    problems,
  };
}

/** Called on the warm-lists tick. Does nothing on a deploy with no hub set up. */
export async function sendHealthReport(db: D1Database, env: HubHealthEnv): Promise<void> {
  const base = (env.IT_HUB_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.IT_HUB_API_KEY ?? "").trim();
  if (!base || !key) return;
  const report = await measureHealth(db, env);
  const res = await fetch(`${base}/api/v1/sys/health`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`IT Hub ${res.status}`);
}
