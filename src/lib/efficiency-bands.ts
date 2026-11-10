// ---------------------------------------------------------------------------
// efficiency-bands.ts — the worker-efficiency display band, one definition.
//
// The Employees insights page (src/pages/dashboards/EmployeesInsights.tsx)
// flags a person whose period efficiency is under WARN_LOW (under-performance)
// or over WARN_HIGH (over-reporting), and ranks only people who clocked at
// least MIN_RANK_MINUTES. The Board Report's page 11 counts workers in the same
// three bands, so both read these constants. They are display choices around
// the 100% baseline, not payroll policy (the efficiency allowance has its own
// per-worker threshold, workers.efficiencyThresholdPct).
// ---------------------------------------------------------------------------

export const EFFICIENCY_WARN_LOW = 90;
export const EFFICIENCY_WARN_HIGH = 150;
/** A person clocking under an hour in the window has no meaningful ratio. */
export const EFFICIENCY_MIN_RANK_MINUTES = 60;

export type EfficiencyBand = "below" | "within" | "above";

/** The page's test: under WARN_LOW is below, over WARN_HIGH is above, both ends inclusive in the band. */
export function efficiencyBand(pct: number): EfficiencyBand {
  if (pct < EFFICIENCY_WARN_LOW) return "below";
  if (pct > EFFICIENCY_WARN_HIGH) return "above";
  return "within";
}

export type EfficiencyBandCounts = { below: number; within: number; above: number; ranked: number; low: number; high: number };

/** How many of `pcts` fall in each band (the unrounded figures, as the page compares them). */
export function countEfficiencyBands(pcts: readonly number[]): EfficiencyBandCounts {
  const out: EfficiencyBandCounts = { below: 0, within: 0, above: 0, ranked: 0, low: EFFICIENCY_WARN_LOW, high: EFFICIENCY_WARN_HIGH };
  for (const p of pcts) {
    if (!Number.isFinite(p)) continue;
    out[efficiencyBand(p)] += 1;
    out.ranked += 1;
  }
  return out;
}
