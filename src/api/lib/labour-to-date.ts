// ---------------------------------------------------------------------------
// labour-to-date.ts (loader) — reads what the Labor Cost page's "Labor Cost incl.
// EPF & Allowances" card reads, for the month still running, and hands it to the
// pure core in src/lib/labour-to-date.ts (owner 2026-10-12). Used by the P&L's
// report-layer labour and the finance dashboard's salary cards.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { effectiveSalarySenForMonth } from "../../lib/labor-engine";
import { computeLabourToDate, type LabourToDate, type TdEntry, type TdPayslip, type TdWorker } from "../../lib/labour-to-date";
import { loadPayRuleVersions } from "./pay-rules-store";
import { projectedPayslipsForMonth } from "./labour-projection";

export { runningMonthYm } from "../../lib/labour-to-date";

const pad2 = (n: number) => String(n).padStart(2, "0");

// The departments seeded before the master existed — the Labor Cost page's own
// fallback (employees.tsx SEED_DEPARTMENTS) when the master is empty.
const SEED_DEPARTMENT_CODES = [
  "FAB_CUT", "FAB_SEW", "WOOD_CUT", "FOAM_CUTTING", "FOAM", "FIBRE", "FRAMING", "WEBBING",
  "UPHOLSTERY", "PACKING", "WAREHOUSING", "REPAIR", "MAINTENANCE", "PRODUCTION_SHORTFALL", "R_AND_D",
];

const num = (v: unknown) => Number(v) || 0;
const pick = (r: Record<string, unknown>, camel: string, snake: string) => r[camel] ?? r[snake];

// Loads what the card reads — the month's working hours, every worker and
// their effective salary, the month's payslips (stored, else the live
// estimate), the docks, the holidays, the pay rules and the department master —
// and computes the month's labour to date.
export async function loadLabourToDate(
  db: Env["Variables"]["DB"],
  orgId: string,
  ym: string,
): Promise<LabourToDate | null> {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, mo] = ym.split("-").map(Number);
  const lastDay = new Date(y, mo, 0).getDate();
  const entryRes = await db
    .prepare("SELECT workerId, date, hours, departmentCode, category FROM working_hour_entries WHERE date >= ? AND date <= ?")
    .bind(`${ym}-01`, `${ym}-${pad2(lastDay)}`)
    .all<Record<string, unknown>>();
  const entries: TdEntry[] = (entryRes.results ?? []).map((r) => ({
    workerId: String(pick(r, "workerId", "worker_id") ?? ""),
    date: String(r.date ?? ""),
    hours: num(r.hours),
    departmentCode: String(pick(r, "departmentCode", "department_code") ?? ""),
    category: (r.category as string | null) ?? null,
  }));
  if (!entries.length) return null;

  const holidays: string[] = [];
  const phRow = await db.prepare("SELECT value FROM kv_config WHERE key = ?").bind("public_holidays").first<{ value: string | null }>();
  if (phRow?.value) {
    try {
      const parsed = JSON.parse(phRow.value);
      if (Array.isArray(parsed)) for (const d of parsed) if (typeof d === "string") holidays.push(d);
    } catch { /* malformed — no holidays */ }
  }
  const holidaySet = new Set(holidays);

  const history = new Map<string, Array<{ effectiveFrom: string; basicSalarySen: number }>>();
  try {
    const hRes = await db.prepare("SELECT workerId, basicSalarySen, effectiveFrom FROM worker_salary_history").all<Record<string, unknown>>();
    for (const r of hRes.results ?? []) {
      const id = String(pick(r, "workerId", "worker_id") ?? "");
      const a = history.get(id) ?? [];
      a.push({ effectiveFrom: String(pick(r, "effectiveFrom", "effective_from") ?? ""), basicSalarySen: num(pick(r, "basicSalarySen", "basic_salary_sen")) });
      history.set(id, a);
    }
  } catch { /* no salary history — everyone on their scalar */ }

  const wRes = await db.prepare("SELECT * FROM workers").all<Record<string, unknown>>();
  const workers = new Map<string, TdWorker>();
  for (const r of wRes.results ?? []) {
    const id = String(r.id ?? "");
    if (!id) continue;
    const basic = num(pick(r, "basicSalarySen", "basic_salary_sen"));
    const otm = pick(r, "otMultiplier", "ot_multiplier");
    workers.set(id, {
      id,
      departmentCode: (pick(r, "departmentCode", "department_code") as string | null) ?? null,
      basicSalarySen: basic,
      effectiveSalarySen: effectiveSalarySenForMonth(history.get(id) ?? [], basic, y, mo, holidaySet),
      workingHoursPerDay: num(pick(r, "workingHoursPerDay", "working_hours_per_day")),
      workingDaysPerMonth: num(pick(r, "workingDaysPerMonth", "working_days_per_month")),
      otMultiplier: otm === null || otm === undefined ? null : Number(otm),
      payMode: (pick(r, "payMode", "pay_mode") as string | null) ?? null,
      dailyRateSen: (() => { const v = pick(r, "dailyRateSen", "daily_rate_sen"); return v === null || v === undefined ? null : Number(v); })(),
    });
  }

  let payslips: TdPayslip[] = [];
  try {
    const psRes = await db
      .prepare("SELECT * FROM payslips WHERE orgId = ? AND period = ? AND employeeNo NOT LIKE 'TEST%'")
      .bind(orgId, ym)
      .all<Record<string, unknown>>();
    payslips = (psRes.results ?? []).map((r) => ({
      id: String(r.id ?? ""),
      employeeId: String(pick(r, "employeeId", "employee_id") ?? ""),
      departmentCode: (pick(r, "departmentCode", "department_code") as string | null) ?? null,
      basicSalarySen: num(pick(r, "basicSalarySen", "basic_salary_sen")),
      absentDays: num(pick(r, "absentDays", "absent_days")),
      absenceDeductionSen: num(pick(r, "absenceDeductionSen", "absence_deduction_sen")),
      otWeekdayHours: num(pick(r, "otWeekdayHours", "ot_weekday_hours")),
      otSundayHours: num(pick(r, "otSundayHours", "ot_sunday_hours")),
      otPhHours: num(pick(r, "otPhHours", "ot_ph_hours")),
      totalOtSen: num(pick(r, "totalOtSen", "total_ot_sen")),
      allowancesSen: num(pick(r, "allowancesSen", "allowances_sen")),
      grossPaySen: num(pick(r, "grossPaySen", "gross_pay_sen")),
      epfEmployerSen: num(pick(r, "epfEmployerSen", "epf_employer_sen")),
      socsoEmployerSen: num(pick(r, "socsoEmployerSen", "socso_employer_sen")),
      eisEmployerSen: num(pick(r, "eisEmployerSen", "eis_employer_sen")),
    }));
  } catch { /* payslips table absent → the live estimate below */ }
  if (!payslips.length) payslips = await projectedPayslipsForMonth(db, ym);

  const deductions: { workerId: string; hours: number }[] = [];
  try {
    const dRes = await db.prepare("SELECT workerId, hours FROM payroll_hour_deductions WHERE date LIKE ?").bind(`${ym}-%`).all<Record<string, unknown>>();
    for (const r of dRes.results ?? []) deductions.push({ workerId: String(pick(r, "workerId", "worker_id") ?? ""), hours: num(r.hours) });
  } catch { /* no docks table — no docks */ }

  const factoryDeptCodes = new Set<string>();
  try {
    const dRes = await db.prepare("SELECT code FROM departments").all<{ code: string | null }>();
    for (const r of dRes.results ?? []) { const c = String(r.code ?? "").trim(); if (c) factoryDeptCodes.add(c); }
  } catch { /* master absent — seed below */ }
  if (!factoryDeptCodes.size) for (const c of SEED_DEPARTMENT_CODES) factoryDeptCodes.add(c);

  const payRuleVersions = await loadPayRuleVersions(db);
  return computeLabourToDate({ ym, entries, workers, payslips, deductions, holidays, payRuleVersions, factoryDeptCodes });
}

