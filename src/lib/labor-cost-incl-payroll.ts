// ---------------------------------------------------------------------------
// labor-cost-incl-payroll.ts — the "Labor Cost incl. EPF & Allowances" card on
// Employees › Labor Cost vs Revenue (owner 2026-10-12: 「如果我要看到今天的工资包括
// 津贴、雇主 EPF/SOCSO/EIS、缺勤和扣钱的差价，我哪里可以看到？」→ method B).
//
// The Total Labor Cost card values only the hours logged in Working Hours at
// the production-cost rate. Payroll costs more: allowances, the employer's
// EPF / SOCSO / EIS, and the gap between how payroll pays an absent day or a
// docked hour (÷26) and how costing values it (÷ the month's working days).
//
//   A finished month → the payroll itself: Σ gross + Σ employer statutory (the
//   reconciliation's Total Payroll Cost).
//   A month still running → the logged-hours labour so far, plus the payslips'
//   allowances and employer statutory pro-rated to the share of the month's
//   working days already logged, plus the absent-day / OT / docked-hours
//   differences already incurred (the page's own per-payslip bridges), plus
//   anyone who logs no factory hours (office staff), pro-rated whole.
// ---------------------------------------------------------------------------

export type PayslipCostLine = {
  id: string;
  departmentCode: string | null;
  grossSen: number;
  /** Employer EPF + SOCSO + EIS. */
  statutorySen: number;
  /** Efficiency + leadership allowance (inside gross). */
  allowancesSen: number;
};

export function laborCostInclPayroll(args: {
  monthFinished: boolean;
  /** The Total Labor Cost card: hours logged so far at the production-cost rate. */
  loggedSen: number;
  payslips: PayslipCostLine[];
  /** A department whose people log Working Hours (production, warehousing, repair …). */
  isFactoryDept: (code: string) => boolean;
  /** Absent-day + OT + docked-hours differences already in this payslip. */
  bridgeSen: (payslipId: string) => number;
  /** Working days logged so far ÷ the month's working days (a running month only). */
  share: number;
}): number {
  const { monthFinished, loggedSen, payslips, isFactoryDept, bridgeSen, share } = args;
  if (monthFinished) {
    return payslips.reduce((s, p) => s + p.grossSen + p.statutorySen, 0);
  }
  let prorated = 0;
  let bridges = 0;
  for (const p of payslips) {
    if (!isFactoryDept(p.departmentCode || "UNASSIGNED")) {
      // Logs no factory hours: the whole salary and its statutory accrue by day.
      prorated += (p.grossSen + p.statutorySen) * share;
      continue;
    }
    prorated += (p.allowancesSen + p.statutorySen) * share;
    bridges += bridgeSen(p.id);
  }
  return loggedSen + Math.round(prorated) + bridges;
}

export function loggedDayShare(loggedWorkingDays: number, monthWorkingDays: number): number {
  if (monthWorkingDays <= 0 || loggedWorkingDays <= 0) return 0;
  return Math.min(1, loggedWorkingDays / monthWorkingDays);
}
