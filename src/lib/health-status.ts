// ---------------------------------------------------------------------------
// health-status.ts — the System Health banner's verdict, in one place.
//
// The admin page (src/pages/admin/health.tsx) shows it as the green / amber /
// red banner; the red-alert email (src/api/lib/health-alert.ts, cross-system
// review P4) reads the SAME function, so "the page is red" and "management was
// emailed" can never disagree. Thresholds are rough Hookka-scale expectations
// (~40-500 req/24h, P95 typically 100-500 ms when healthy).
// ---------------------------------------------------------------------------

export type HealthTone = "green" | "amber" | "red";

export interface HealthInputs {
  p50: number;
  p95: number;
  longTaskCount: number;
  cacheHitRatio: number;
  /** 5xx replies in the window. */
  fiveXX: number;
  /** Front-end errors in the window (top groups, as the page lists them). */
  feErrCount: number;
  /**
   * Outside keys the provider REFUSED (C2-11, src/lib/key-probe.ts). Any one
   * turns the banner red, so the existing alert email fires. Optional: a
   * caller that did not probe changes nothing.
   */
  keysRefused?: string[];
  /** Outside keys that got no answer (timeout / 5xx) — amber only. */
  keysNoAnswer?: string[];
}

export function computeHealthStatus(k: HealthInputs): {
  tone: HealthTone;
  label: string;
  detail: string;
} {
  const issues: string[] = [];
  if (k.p95 >= 1500) issues.push(`P95 latency ${k.p95}ms`);
  if (k.longTaskCount > 500) issues.push(`${k.longTaskCount} long tasks`);
  if (k.fiveXX > 0) issues.push(`${k.fiveXX} server errors`);
  if (k.feErrCount > 10) issues.push(`${k.feErrCount} FE errors`);
  const refused = k.keysRefused ?? [];
  const noAnswer = k.keysNoAnswer ?? [];
  if (refused.length) issues.push(`Key refused: ${refused.join(", ")}`);
  if (noAnswer.length) issues.push(`No answer: ${noAnswer.join(", ")}`);
  if (issues.length === 0) {
    return {
      tone: "green",
      label: "All systems normal",
      detail: `P50 ${k.p50}ms · P95 ${k.p95}ms · Cache ${Math.round(k.cacheHitRatio * 100)}% · No 5xx`,
    };
  }
  // Critical thresholds — any of these alone is enough to escalate.
  const critical =
    k.p95 >= 2000 || k.fiveXX > 10 || k.feErrCount > 50 || refused.length > 0 || issues.length >= 3;
  return {
    tone: critical ? "red" : "amber",
    label: critical ? "Critical — investigate now" : "Investigate",
    detail: issues.join(" · "),
  };
}
