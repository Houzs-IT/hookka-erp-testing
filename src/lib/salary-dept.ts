// ---------------------------------------------------------------------------
// Department-dimension salary maths, shared by the dashboard endpoint and the
// Forecast page. The department dimension exists ONLY in payslips — never in
// the GL — so both consumers aggregate the same raw rows with this one rule.
// Cost = gross pay + employer EPF/SOCSO/EIS (identical to aggregateLabour on
// the Labour tab, so the card's Σdepartments always equals that tab's total).
// ---------------------------------------------------------------------------

export type PayslipDeptRow = {
  period?: string | null;
  departmentCode?: string | null;
  department_code?: string | null;
  grossPaySen?: number | null; gross_pay_sen?: number | null;
  epfEmployerSen?: number | null; epf_employer_sen?: number | null;
  socsoEmployerSen?: number | null; socso_employer_sen?: number | null;
  eisEmployerSen?: number | null; eis_employer_sen?: number | null;
};

export type DeptCost = { dept: string; costSen: number };

export function groupPayslipsByMonthDept(rows: PayslipDeptRow[]): Map<string, DeptCost[]> {
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const ym = String(r.period ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const dept = String(r.departmentCode ?? r.department_code ?? "").trim() || "(unassigned)";
    const cost =
      (Number(r.grossPaySen ?? r.gross_pay_sen) || 0) +
      (Number(r.epfEmployerSen ?? r.epf_employer_sen) || 0) +
      (Number(r.socsoEmployerSen ?? r.socso_employer_sen) || 0) +
      (Number(r.eisEmployerSen ?? r.eis_employer_sen) || 0);
    const m = byMonth.get(ym) ?? new Map<string, number>();
    m.set(dept, (m.get(dept) ?? 0) + cost);
    byMonth.set(ym, m);
  }
  const out = new Map<string, DeptCost[]>();
  for (const [ym, m] of byMonth) {
    out.set(
      ym,
      [...m.entries()].map(([dept, costSen]) => ({ dept, costSen })).sort((a, b) => a.dept.localeCompare(b.dept)),
    );
  }
  return out;
}

/**
 * Non-production departments' share of a month's gross pay (owner 2026-11-18
 * 「non production 没有看到？」). A payslip files the worker's whole month under
 * his home (production) department, so R&D / repair / maintenance have no pay
 * of their own. Each worker's pay is split by the hours he CLOCKED: the hours
 * in a non-production department move that share out of his home department
 * into it. Money only moves — the total stays to the sen — so the Forecast
 * P&L's department rows still add up to the salary account.
 *
 * `base` = gross per home department (what the P&L posts). `slips` say who
 * belongs where and how the department's gross divides between its people
 * (for the month still running, the base is labour to date, so each worker's
 * part is his share of the department's slips, scaled to the base).
 */
export function reallocateNonProdGross(
  base: Readonly<Record<string, number>>,
  slips: readonly { workerId: string; dept: string; grossSen: number }[],
  hours: readonly { workerId: string; dept: string; hours: number }[],
  nonProd: ReadonlySet<string>,
): Record<string, number> {
  const out: Record<string, number> = { ...base };
  if (!nonProd.size) return out;
  const deptSlips = new Map<string, number>();
  const worker = new Map<string, { dept: string; grossSen: number }>();
  for (const s of slips) {
    if (!s.workerId || !s.dept || !(s.grossSen > 0)) continue;
    deptSlips.set(s.dept, (deptSlips.get(s.dept) ?? 0) + s.grossSen);
    const w = worker.get(s.workerId);
    worker.set(s.workerId, { dept: w?.dept ?? s.dept, grossSen: (w?.grossSen ?? 0) + s.grossSen });
  }
  const clocked = new Map<string, Map<string, number>>();
  for (const h of hours) {
    if (!h.workerId || !h.dept || !(h.hours > 0)) continue;
    const m = clocked.get(h.workerId) ?? new Map<string, number>();
    m.set(h.dept, (m.get(h.dept) ?? 0) + h.hours);
    clocked.set(h.workerId, m);
  }
  for (const [wid, w] of worker) {
    if (nonProd.has(w.dept)) continue;
    const by = clocked.get(wid);
    const home = out[w.dept] ?? 0;
    const den = deptSlips.get(w.dept) ?? 0;
    if (!by || home <= 0 || den <= 0) continue;
    const total = [...by.values()].reduce((a, v) => a + v, 0);
    const pay = Math.round((base[w.dept] ?? 0) * (w.grossSen / den));
    for (const [dept, h] of by) {
      if (dept === w.dept || !nonProd.has(dept)) continue;
      const move = Math.min(out[w.dept] ?? 0, Math.round((pay * h) / total));
      if (move <= 0) continue;
      out[w.dept] = (out[w.dept] ?? 0) - move;
      out[dept] = (out[dept] ?? 0) + move;
    }
  }
  return out;
}

// --- Forecast supersede rule ------------------------------------------------
// A month that carries ANY `dept:` entry forecasts labour AT DEPARTMENT LEVEL;
// its DIRECT_LABOUR account entries (750-x) are display-only leftovers and
// MUST be ignored by every consumer, or the month double-counts. Keyed off the
// 750- prefix so this lib stays dependency-free: every DIRECT_LABOUR account
// in this COA is 750-x, and pnl-bucket.ts maps 750 → DIRECT_LABOUR by the
// same prefix.
const LABOUR_ACCOUNT_RE = /^750-/;

export function forecastEntryKind(code: string): "dept" | "labourAccount" | "other" {
  if (code.startsWith("dept:")) return "dept";
  if (LABOUR_ACCOUNT_RE.test(code)) return "labourAccount";
  return "other";
}

export function monthHasDeptForecast(pct: Record<string, unknown> | undefined | null): boolean {
  for (const k of Object.keys(pct ?? {})) if (k.startsWith("dept:")) return true;
  return false;
}

// Every account the labour map can post wages to (dept accounts + fallback +
// the three statutory accounts). A month that forecasts BY DEPARTMENT
// supersedes exactly these accounts — keying both a dept row and one of these
// would double-count, so both the Forecast page and the dashboard skip them
// in dept mode (owner 2026-08-24: dept rows follow the labour map's section).
export type LabourMapLike = {
  fallback?: string | null;
  byDept?: Record<string, string> | null;
  epf?: string | null;
  socso?: string | null;
  eis?: string | null;
};

export function labourMappedAccounts(map: LabourMapLike): string[] {
  const s = new Set<string>();
  const add = (v?: string | null) => {
    const t = String(v ?? "").trim();
    if (t) s.add(t);
  };
  add(map.fallback);
  add(map.epf);
  add(map.socso);
  add(map.eis);
  for (const v of Object.values(map.byDept ?? {})) add(v);
  return [...s].sort();
}
