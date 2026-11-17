// efficiency-model.ts — the ranking behind Employees → Efficiency Overview (HK-0125 Phase 4, step 1). Pure: no React, no clock.
//
// Same numbers desktop's Efficiency Overview grid shows, from the same sources:
//   /api/working-hour-entries/summary?from&to   per worker: totalHours, byDept {code: hours}, daysWithEntries
//   /api/job-cards/summary?from&to              per worker: productionMinutes = completed job-card minutes (halved when the card is
//                                               shared) PLUS approved extra production time, added ONCE by the server
//   /api/workers, /api/departments              names, employee numbers, which departments are production
// Efficiency % = Earned time ÷ (Hours worked × 60), where Hours worked is production-department hours only (Warehousing,
// Repair, Maintenance, Shortfall are "Non-Prod Hrs" and never counted).
//
// Approved extra production time: the job-cards summary ALREADY contains it, so Earned time is exactly that one number. This
// file never reads the approved-claims list and never adds a second credit — see the "counted once" test.
//
// Ranking (owner 2026-11-16): highest efficiency first; ties (compared at the one decimal shown) go by employee number; ranks
// are assigned over the WHOLE period's list, so searching never renumbers anyone. A worker without a valid personal efficiency
// (helper / 杂工, no entry days, no production-department hours, or earned time unavailable) comes last with "—" and NO rank.

export type EffWorker = {
  id: string;
  name?: string;
  empNo?: string;
  isHelper?: boolean;
  is_helper?: boolean;
  // the roster fields Employee Performance's info card and picker read (the same /api/workers rows)
  status?: string;
  departmentCode?: string;
  position?: string;
  joinDate?: string;
};
export type EffHours = { workerId: string; totalHours?: number; byDept?: Record<string, number>; daysWithEntries?: number };
export type EffEarned = { workerId: string; productionMinutes?: number };
export type EffDept = { code: string; name?: string; shortName?: string; isProduction?: boolean; sequence?: number };

/** Why a row has no personal efficiency (null when it has one, or when earned time as a whole is unavailable). */
export type NoEffReason = "helper" | "no-entries" | "no-production-hours" | null;

export type EffChip = { label: string; hours: number; production: boolean };
export type EffRow = {
  workerId: string;
  name: string;
  empNo: string;
  totalHours: number;
  days: number;
  prodHours: number;
  nonProdHours: number;
  /** Earned minutes; null when the earned-time source is unavailable (no permission / failed). */
  earnedMin: number | null;
  /** Efficiency %, unrounded; null = no valid personal efficiency. */
  eff: number | null;
  /** 1-based rank over the whole period's list; null = unranked. */
  rank: number | null;
  reason: NoEffReason;
  chips: EffChip[];
};

export const EFF_PREVIEW = 5;
export const EFF_PARAMS = ["eq"] as const;

/** Efficiency compared the way it is shown (one decimal), so two cards that read the same percentage sort by employee number. */
const shown = (e: number) => Math.round(e * 10) / 10;

/** "40.0h" */
export const fmtH1 = (h: number) => `${(Math.round((Number(h) || 0) * 10) / 10).toFixed(1)}h`;

/** Minutes the way the HTML writes them: "5h 30m", "5h", "45m". Rounds the TOTAL first so 59.6 min never prints "60m". */
export function fmtHM(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export type EffTone = { bg: string; fg: string };
/** Desktop's grid thresholds (also the HTML's): >= 85 green, >= 70 amber, else red; no efficiency = grey. */
export function efficiencyTone(eff: number | null): EffTone {
  if (eff === null) return { bg: "#F0ECE9", fg: "#9A9082" };
  const v = shown(eff);
  if (v >= 85) return { bg: "#EEF3E4", fg: "#3D6229" };
  if (v >= 70) return { bg: "#FAEFCB", fg: "#85600F" };
  return { bg: "#F6E2DE", fg: "#9A3A2D" };
}

/** Rank badge colours: 1 gold, 2 silver, 3 bronze (white text), 4+ taupe. */
export function rankTone(rank: number): { bg: string; fg: string } {
  if (rank === 1) return { bg: "#C9A961", fg: "#FFFFFF" };
  if (rank === 2) return { bg: "#B8BCC4", fg: "#FFFFFF" };
  if (rank === 3) return { bg: "#C08A5B", fg: "#FFFFFF" };
  return { bg: "#F4EFE6", fg: "#6B5C32" };
}

/** Desktop's department order: production first, then by sequence, then code. */
function orderDepts(depts: readonly EffDept[]): EffDept[] {
  return [...depts].sort((a, b) => {
    const pa = a.isProduction ? 0 : 1;
    const pb = b.isProduction ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const sa = a.sequence ?? 999;
    const sb = b.sequence ?? 999;
    if (sa !== sb) return sa - sb;
    return a.code.localeCompare(b.code);
  });
}

const byEmpNo = (a: { empNo: string; workerId: string }, b: { empNo: string; workerId: string }) =>
  (a.empNo || "~").localeCompare(b.empNo || "~") || a.workerId.localeCompare(b.workerId);

/**
 * One row per worker who has hours OR earned time in the period — desktop's union, so a worker credited only by job cards or
 * approved extra time is not hidden. `earned` null = the earned-time source is unavailable: every efficiency is then "—".
 */
export function buildEfficiencyRows(input: {
  workers: readonly EffWorker[];
  hours: readonly EffHours[];
  earned: readonly EffEarned[] | null;
  depts: readonly EffDept[];
}): EffRow[] {
  const { workers, hours, earned, depts } = input;
  const workerById = new Map(workers.map((w) => [w.id, w]));
  const ordered = orderDepts(depts);
  const deptByCode = new Map(ordered.map((d) => [d.code, d]));
  const earnedById = new Map<string, number>();
  for (const e of earned ?? []) {
    // One row per worker from the server; a repeated id replaces (never adds to) the earlier one, as on desktop.
    if (e.workerId) earnedById.set(e.workerId, Number(e.productionMinutes) || 0);
  }
  const hoursById = new Map<string, EffHours>();
  for (const h of hours) if (h.workerId) hoursById.set(h.workerId, h);
  const ids = new Set<string>([...hoursById.keys(), ...earnedById.keys()]);

  const rows: EffRow[] = [];
  for (const id of ids) {
    const w = workerById.get(id);
    const h = hoursById.get(id);
    const byDept = h?.byDept ?? {};
    let prodHours = 0;
    let nonProdHours = 0;
    for (const [code, hrs] of Object.entries(byDept)) {
      const v = Number(hrs) || 0;
      if (deptByCode.get(code)?.isProduction) prodHours += v;
      else nonProdHours += v;
    }
    const days = Number(h?.daysWithEntries) || 0;
    const isHelper = Boolean(w?.isHelper ?? w?.is_helper);
    let reason: NoEffReason = null;
    if (isHelper) reason = "helper";
    else if (days === 0) reason = "no-entries";
    else if (prodHours <= 0) reason = "no-production-hours";
    const earnedMin = earned === null ? null : (earnedById.get(id) ?? 0);
    const eff = reason === null && earnedMin !== null ? (earnedMin / (prodHours * 60)) * 100 : null;

    const chips: EffChip[] = [];
    for (const d of ordered) {
      const v = Number(byDept[d.code]) || 0;
      if (v > 0) chips.push({ label: d.shortName || d.name || d.code, hours: v, production: !!d.isProduction });
    }
    for (const [code, hrs] of Object.entries(byDept)) {
      const v = Number(hrs) || 0;
      if (v > 0 && !deptByCode.has(code)) chips.push({ label: code, hours: v, production: false });
    }
    rows.push({
      workerId: id,
      name: w?.name || id,
      empNo: w?.empNo || "",
      totalHours: Number(h?.totalHours) || 0,
      days,
      prodHours,
      nonProdHours,
      earnedMin,
      eff,
      rank: null,
      reason,
      chips,
    });
  }

  const ranked = rows.filter((r) => r.eff !== null).sort((a, b) => shown(b.eff as number) - shown(a.eff as number) || byEmpNo(a, b));
  ranked.forEach((r, i) => (r.rank = i + 1));
  const unranked = rows.filter((r) => r.eff === null).sort(byEmpNo);
  return [...ranked, ...unranked];
}

/** Search by name or employee number; ranks are untouched (they were fixed over the whole list). */
export function filterEfficiencyRows(rows: readonly EffRow[], q: string): EffRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => `${r.empNo} ${r.name}`.toLowerCase().includes(needle));
}

/** The grey line under an unranked card. */
export function whyNoEfficiency(r: EffRow): string {
  if (r.reason === "helper") return "Helper — assists others, so no personal efficiency";
  if (r.reason === "no-entries") return "No working hours logged in this period";
  if (r.reason === "no-production-hours") return "All hours in non-production departments (Warehousing / Repair / Maintenance / Shortfall)";
  return "";
}

/** The six stat cells of a card, as the HTML lays them out. */
export function statCells(r: EffRow): { k: string; v: string; kind: "plain" | "muted" | "eff" }[] {
  return [
    { k: "Total", v: r.totalHours > 0 ? `${fmtH1(r.totalHours)} (${r.days}d)` : "—", kind: "plain" },
    { k: "Earned time", v: r.earnedMin !== null && r.earnedMin > 0 ? fmtHM(r.earnedMin) : "—", kind: "plain" },
    { k: "Hours worked", v: r.prodHours > 0 ? fmtHM(r.prodHours * 60) : "—", kind: "plain" },
    { k: "Non-Prod Hrs", v: r.nonProdHours > 0 ? fmtHM(r.nonProdHours * 60) : "—", kind: "muted" },
    { k: "Efficiency %", v: r.eff === null ? "—" : `${shown(r.eff).toFixed(1)}%`, kind: "eff" },
    { k: "Days", v: String(r.days), kind: "plain" },
  ];
}
