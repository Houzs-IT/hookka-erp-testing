// payslip-detail-model.ts — the rules behind the Payroll payslip detail page (HK-0125 Phase 6b). Pure: no React, no clock.
//
// Every amount is the SERVER's (the payslip row already loaded for the list: GET /api/payslips?period=… or the live estimate); the only
// things derived here are the ones desktop's expanded payroll row also derives for display (days worked, the legacy "part-month" line)
// and two things the owner asked to be shown ONLY WHEN VERIFIED against the payslip itself:
//   • an OT MULTIPLIER — shown on a line only when hours × hourly rate × that multiplier reproduces the server's OT amount to the sen
//     (the engine rounds the hourly rate to the sen first, so a real multiplier reproduces exactly). Otherwise the line shows the hours
//     and the rate and no multiplier;
//   • the hourly-rate FORMULA — shown only when salary ÷ (days × the pay-rule hour divisor) reproduces the server's hourly rate; otherwise
//     just "Hourly rate: RM x/hr".
// "Piece wages" shows only when the API sends a figure. Advance dates and penalty references are chips built from the period's advance /
// penalty lists; the page requests them only where the existing permission allows (use-payslip-detail.ts).
import { formatRM } from "../../../../lib/utils";
import { PCB_STATUS_NOTE, normalizeStoredPcbStatus, pcbHasFigure } from "../../../../lib/pcb";
import { payrollHourDivisor, resolvePayRulesAsOf, type PayRuleVersion } from "../../../../lib/pay-rules";
import { monthShort } from "./employees-dates";
import { totalPayOf, type PayslipRow } from "./payroll-model";

export const PAY_DETAIL_PARAM = "pay";

export type DetailRow = PayslipRow & {
  hourlyRate?: number;
  otWeekdayHours?: number;
  otSundayHours?: number;
  otPHHours?: number;
  otWeekdayAmount?: number;
  otSundayAmount?: number;
  otPHAmount?: number;
  allowances?: number;
  totalDeductions?: number;
  bankAccount?: string;
  absentDates?: string[];
  otDays?: { date: string; hours: number }[];
  lateDays?: { date: string; hours: number }[];
  /** Only some servers send it (outsource piece-rate wages). */
  pieceWagesSen?: number | null;
};

const n = (v: unknown) => Number(v) || 0;
const sen = (v: unknown) => formatRM(n(v));
const less = (v: unknown) => `(${formatRM(n(v))})`;
export const dayMonth = (ymd: string) => (/^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${Number(ymd.slice(8, 10))} ${monthShort(Number(ymd.slice(5, 7)))}` : ymd);
const hrs = (h: number) => String(Math.round(h * 100) / 100);

/** The last day of a YYYY-MM period (the pay-rule version in force on it produced the stored payslip). */
export function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return y && m ? `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` : "9999-12-31";
}

// ---- OT calculation -----------------------------------------------------------------------------------------------------------------

/** The multiplier that reproduces the amount, or null. Shown only when hours × rate × clean multiplier equals the amount to the sen. */
export function verifiedMultiplier(hours: number, rateSen: number, amountSen: number): number | null {
  if (!(hours > 0) || !(rateSen > 0) || !(amountSen > 0)) return null;
  const clean = Math.round((amountSen / (hours * rateSen)) * 4) / 4;
  if (!(clean >= 1 && clean <= 5)) return null;
  return Math.abs(Math.round(hours * rateSen * clean) - amountSen) <= 1 ? clean : null;
}

export type OtLine = { key: string; amount: string; text: string };
export function otLines(p: DetailRow): OtLine[] {
  const rate = n(p.hourlyRate);
  const mk = (key: string, hours: number, amountSen: number): OtLine => {
    const mult = verifiedMultiplier(hours, rate, amountSen);
    const h = hours > 0 ? `${hrs(hours)} hrs` : amountSen > 0 ? "under 1 hr" : "0 hrs";
    return { key, amount: formatRM(amountSen), text: mult !== null ? `${h} × ${formatRM(rate)} × ${mult}` : `${h} · ${formatRM(rate)}/hr` };
  };
  return [
    mk("Weekday OT", n(p.otWeekdayHours), n(p.otWeekdayAmount)),
    mk("Sunday OT", n(p.otSundayHours), n(p.otSundayAmount)),
    mk("PH OT", n(p.otPHHours), n(p.otPHAmount)),
  ];
}

/** "RM 2,600.00 ÷ (26 × 10)" only when it reproduces the server's hourly rate; otherwise null. */
export function hourlyFormula(p: DetailRow, ctx: { versions: readonly PayRuleVersion[] | null; hoursPerDay: number | null | undefined; dailyPaid?: boolean }): string | null {
  if (!ctx.versions || ctx.dailyPaid) return null;
  const cfg = resolvePayRulesAsOf(ctx.versions as PayRuleVersion[], periodEnd(p.period ?? ""));
  const div = Number(payrollHourDivisor(ctx.hoursPerDay, cfg).toFixed(2));
  const days = n(p.workingDays);
  if (!(days > 0) || !(div > 0) || !(n(p.basicSalary) > 0)) return null;
  const derived = Math.round(n(p.basicSalary) / (days * div));
  return Math.abs(derived - n(p.hourlyRate)) <= 1 ? `${formatRM(n(p.basicSalary))} ÷ (${days} × ${div})` : null;
}

// ---- statutory / summary ---------------------------------------------------------------------------------------------------------------

export type Kv = { k: string; v: string; vc: string; vw: number; lw: number; lc: string };
const kv = (k: string, v: string, vc = "#1F1D1B", vw = 700, bold = false): Kv => ({ k, v, vc, vw, lw: bold ? 700 : 400, lc: bold ? "#1F1D1B" : "#4D4630" });

export function statutoryRows(p: DetailRow): Kv[] {
  const figure = pcbHasFigure(normalizeStoredPcbStatus(p.pcbStatus));
  return [
    kv("EPF Employee", sen(p.epfEmployee), "#9A3A2D"),
    kv("EPF Employer", sen(p.epfEmployer), "#3E6570"),
    kv("SOCSO Employee", sen(p.socsoEmployee), "#9A3A2D"),
    kv("SOCSO Employer", sen(p.socsoEmployer), "#3E6570"),
    kv("EIS Employee", sen(p.eisEmployee), "#9A3A2D"),
    kv("EIS Employer", sen(p.eisEmployer), "#3E6570"),
    kv("PCB (Tax)", figure ? sen(p.pcb) : "—", figure ? "#1F1D1B" : "#9A9082"),
  ];
}
/** Why PCB shows "—", in desktop's words (empty when PCB has a figure). */
export const pcbNote = (p: DetailRow) => (pcbHasFigure(normalizeStoredPcbStatus(p.pcbStatus)) ? "" : PCB_STATUS_NOTE[normalizeStoredPcbStatus(p.pcbStatus)]);

/** Legacy "part-month" reconciliation (desktop `prorationSenOf`): Basic − Absence − short-hour dock − (Gross − OT − allowances). Display only. */
export const partMonthSen = (p: DetailRow) => Math.max(0, n(p.basicSalary) - n(p.absenceDeductionSen) - n(p.shortHourDeductionSen) - (n(p.grossPay) - n(p.totalOT) - n(p.allowances)));

/** Days worked = the month's working days minus the absent days (both are the payslip's own figures). */
export const daysWorked = (p: DetailRow) => Math.max(0, n(p.workingDays) - n(p.absentDays));

export function summaryRows(p: DetailRow): Kv[] {
  const rows: Kv[] = [kv("Days worked", `${daysWorked(p)} of ${n(p.workingDays)}`), kv("Basic Salary", sen(p.basicSalary))];
  if (n(p.absenceDeductionSen) > 0) rows.push(kv(`Less: Absence (${n(p.absentDays)}d)`, less(p.absenceDeductionSen), "#9A3A2D"));
  if (n(p.shortHourDeductionSen) > 0) rows.push(kv("Less: Late / short hours", less(p.shortHourDeductionSen), "#9A3A2D"));
  if (partMonthSen(p) > 1) rows.push(kv("Less: Part-month", less(partMonthSen(p)), "#9A3A2D"));
  if (typeof p.pieceWagesSen === "number" && p.pieceWagesSen > 0) rows.push(kv("Piece wages", sen(p.pieceWagesSen)));
  rows.push(kv("Total OT", sen(p.totalOT), "#6B5C32"));
  if (n(p.allowances) > 0) rows.push(kv("Allowances", sen(p.allowances)));
  rows.push(kv("Gross Pay", sen(p.grossPay), "#1F1D1B", 700, true));
  rows.push(kv("Less: Deductions", less(p.totalDeductions), "#9A3A2D"));
  if (n(p.advanceDeductionSen) > 0) rows.push(kv("Less: Salary advance already taken", less(p.advanceDeductionSen), "#9A3A2D"));
  if (n(p.penaltyDeductionSen) > 0) rows.push(kv("Less: Worker penalty", less(p.penaltyDeductionSen), "#9A3A2D"));
  rows.push(kv("Net Pay", sen(p.netPay), n(p.netPay) < 0 ? "#9A3A2D" : "#1F1D1B", 700, true));
  if (p.bankAccount) rows.push({ ...kv("Bank Account", p.bankAccount, "#6B7280", 400), lw: 400 });
  return rows;
}

// ---- the top card and the header ------------------------------------------------------------------------------------------------------------

export function head(p: DetailRow, month: string) {
  return {
    name: p.employeeName || "—",
    sub: `${p.employeeNo || "—"}${p.departmentCode ? ` - ${p.departmentCode}` : ""} · ${month}`,
    net: sen(p.netPay),
    netFg: n(p.netPay) < 0 ? "#9A3A2D" : "#1F1D1B",
    total: formatRM(totalPayOf(p)),
  };
}

// ---- Day Detail -----------------------------------------------------------------------------------------------------------------------------------

export type DayGroup = { k: string; fg: string; bg: string; items: string[]; none: string };
export function dayGroups(p: DetailRow): DayGroup[] {
  return [
    { k: "Absent", fg: "#9A3A2D", bg: "#F5E9E7", items: (p.absentDates ?? []).map(dayMonth), none: "No absent days" },
    { k: "Overtime", fg: "#6B5C32", bg: "#F4EFE6", items: (p.otDays ?? []).map((d) => `${dayMonth(d.date)} · ${hrs(n(d.hours))}h`), none: "No overtime days" },
    { k: "Late / short", fg: "#85600F", bg: "#FAEFCB", items: (p.lateDays ?? []).map((d) => `${dayMonth(d.date)} · ${hrs(n(d.hours))}h`), none: "No late or short days" },
  ];
}

// ---- advance / penalty chips ------------------------------------------------------------------------------------------------------------------------

export type Advance = { id?: string; workerId?: string; date?: string; amountSen?: number; note?: string };
export type Penalty = { id?: string; penaltyNo?: string; poNo?: string; reason?: string; status?: string; lines?: { id?: string; workerId?: string; amountSen?: number; payrollPeriod?: string }[] };

export const advanceChips = (advances: readonly Advance[], workerId: string): string[] =>
  advances.filter((a) => a.workerId === workerId).map((a) => `Advance ${dayMonth(a.date ?? "")} · ${formatRM(n(a.amountSen))}`);

/** Approved / posted penalties with a line for this worker in this payroll period (desktop's rule). */
export function penaltyChips(penalties: readonly Penalty[], workerId: string, period: string): string[] {
  const out: string[] = [];
  for (const p of penalties) {
    if (p.status !== "APPROVED" && p.status !== "POSTED") continue;
    for (const l of p.lines ?? []) if (l.workerId === workerId && l.payrollPeriod === period) out.push(`${p.penaltyNo ?? "Penalty"}${p.poNo ? ` · ${p.poNo}` : ""} · ${formatRM(n(l.amountSen))}`);
  }
  return out;
}
