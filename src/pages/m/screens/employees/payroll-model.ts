// payroll-model.ts — the rules behind Employees → Payroll, the LIST (HK-0125 Phase 6a). Pure: no React, no clock.
//
// The figures are the payslips API's own (GET /api/payslips?period=YYYY-MM, `payslips:read`); nothing is recomputed except the sums
// desktop's PayrollTab itself sums. Desktop's rules, kept:
//   • Total Pay = Gross + employer EPF + employer SOCSO + employer EIS (what the worker COSTS the company). An advance or penalty is
//     already inside Net Pay and is never subtracted again;
//   • a negative Net Pay stays negative (and red) — clamping it would write the difference off;
//   • PCB: a stored 0 is "no tax due" only when `pcbStatus` says something was worked out (COMPUTED / ZERO_PROVEN). Otherwise the
//     figure is "—", and any total that includes it is flagged "PCB not computed" ("a total inherits the weakest input");
//   • the status shown is the one the API returns (DRAFT / APPROVED / PAID), per payslip.
// The month is the Payroll tab's OWN (URL `pm`), not the shared period. A running month with no stored payslips shows desktop's live
// ESTIMATE (/api/payslips/projected) — but only for the CURRENT Malaysia month, only after the stored request SUCCEEDED with zero
// records; a failed stored request is an error, never an empty month.
import { formatRM } from "../../../../lib/utils";
import { normalizeStoredPcbStatus, pcbHasFigure } from "../../../../lib/pcb";
import { MIN_DATE, monthLabel } from "./employees-dates";

export const PAY_PARAMS = ["pm", "pq", "pst", "pdp", "pdd", "pay"] as const;

export type PayslipRow = {
  id?: string;
  employeeId?: string;
  employeeName?: string;
  employeeNo?: string;
  departmentCode?: string;
  period?: string;
  basicSalary?: number;
  workingDays?: number;
  absentDays?: number;
  absenceDeductionSen?: number;
  shortHourDeductionSen?: number;
  totalOT?: number;
  grossPay?: number;
  epfEmployee?: number;
  epfEmployer?: number;
  socsoEmployee?: number;
  socsoEmployer?: number;
  eisEmployee?: number;
  eisEmployer?: number;
  pcb?: number;
  pcbStatus?: string | null;
  netPay?: number;
  status?: string;
  advanceDeductionSen?: number;
  penaltyDeductionSen?: number;
};

const n = (v: unknown) => Number(v) || 0;

/** Rows of a list response, or null when the body is not a list (a degraded `{success:false}` is "unavailable", not "empty"). */
export function payslipRows(resp: unknown): PayslipRow[] | null {
  if (Array.isArray(resp)) return resp as PayslipRow[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as PayslipRow[]) : null;
}

// ---- the month ---------------------------------------------------------------------------------------------------------------------

/** The current Malaysia month, YYYY-MM. */
export const currentMonth = (today: string) => today.slice(0, 7);

/** A `pm` URL value → a real, non-future month (2020 on); anything else falls back to the current month. */
export function parseMonth(raw: string | null, today: string): string {
  const cur = currentMonth(today);
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return cur;
  return raw > cur || raw < MIN_DATE.slice(0, 7) ? cur : raw;
}

export const labelOfMonth = (ym: string) => monthLabel(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)));

/** Months of one year for the picker: future months are disabled. */
export function monthsOfYear(year: number, today: string): { month: number; ym: string; disabled: boolean }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month: i + 1, ym, disabled: ym > currentMonth(today) };
  });
}

// ---- what the screen shows for a month ------------------------------------------------------------------------------------------------

export type Req = { rows: PayslipRow[] | null; loading: boolean; error: boolean };
export type PayView =
  | { kind: "loading" }
  | { kind: "error"; what: "payslips" | "estimate" }
  | { kind: "empty" }
  | { kind: "stored"; rows: PayslipRow[] }
  | { kind: "estimate"; rows: PayslipRow[] };

/** Should the live estimate be requested? Only for the CURRENT Malaysia month, after a successful stored request with zero records. */
export function wantEstimate(month: string, today: string, stored: Req): boolean {
  return month === currentMonth(today) && !stored.loading && !stored.error && stored.rows !== null && stored.rows.length === 0;
}

export function payView(month: string, today: string, stored: Req, projected: Req): PayView {
  if (stored.rows === null) return stored.error && !stored.loading ? { kind: "error", what: "payslips" } : { kind: "loading" };
  if (stored.rows.length > 0) return { kind: "stored", rows: stored.rows };
  if (!wantEstimate(month, today, stored)) return { kind: "empty" };
  if (projected.rows === null) return projected.error && !projected.loading ? { kind: "error", what: "estimate" } : { kind: "loading" };
  return projected.rows.length > 0 ? { kind: "estimate", rows: projected.rows } : { kind: "empty" };
}

// ---- money ---------------------------------------------------------------------------------------------------------------------------

/** What this worker costs the company: Gross + employer EPF / SOCSO / EIS. */
export const totalPayOf = (p: PayslipRow) => n(p.grossPay) + n(p.epfEmployer) + n(p.socsoEmployer) + n(p.eisEmployer);
const statutoryOf = (p: PayslipRow) => n(p.epfEmployee) + n(p.epfEmployer) + n(p.socsoEmployee) + n(p.socsoEmployer) + n(p.eisEmployee) + n(p.eisEmployer) + n(p.pcb);
export const hasPcb = (p: PayslipRow) => pcbHasFigure(normalizeStoredPcbStatus(p.pcbStatus));

export type Totals = {
  count: number;
  basic: number;
  ot: number;
  gross: number;
  net: number;
  totalPay: number;
  epf: number;
  socso: number;
  eis: number;
  pcb: number;
  statutory: number;
  employerEpf: number;
  employerSocso: number;
  employerEis: number;
  advances: number;
  /** True only when every payslip's PCB was actually worked out. */
  pcbComplete: boolean;
};

export function totalsOf(rows: readonly PayslipRow[]): Totals {
  const t: Totals = { count: rows.length, basic: 0, ot: 0, gross: 0, net: 0, totalPay: 0, epf: 0, socso: 0, eis: 0, pcb: 0, statutory: 0, employerEpf: 0, employerSocso: 0, employerEis: 0, advances: 0, pcbComplete: true };
  for (const p of rows) {
    t.basic += n(p.basicSalary);
    t.ot += n(p.totalOT);
    t.gross += n(p.grossPay);
    t.net += n(p.netPay);
    t.totalPay += totalPayOf(p);
    t.epf += n(p.epfEmployee) + n(p.epfEmployer);
    t.socso += n(p.socsoEmployee) + n(p.socsoEmployer);
    t.eis += n(p.eisEmployee) + n(p.eisEmployer);
    t.pcb += n(p.pcb);
    t.statutory += statutoryOf(p);
    t.employerEpf += n(p.epfEmployer);
    t.employerSocso += n(p.socsoEmployer);
    t.employerEis += n(p.eisEmployer);
    t.advances += n(p.advanceDeductionSen);
    if (!hasPcb(p)) t.pcbComplete = false;
  }
  return t;
}

// ---- the four cards and their sheets (scoped to the whole month, never to the filters) -----------------------------------------------------

export type Card = { key: "tot" | "gross" | "net" | "stat"; l: string; v: string; fg: string; tap: boolean; sub: string; subFg: string };
export function cards(t: Totals): Card[] {
  return [
    { key: "tot", l: "Total Pay", v: formatRM(t.totalPay), fg: "#6B5C32", tap: true, sub: "", subFg: "#6B7280" },
    { key: "gross", l: "Gross Pay", v: formatRM(t.gross), fg: "#1F1D1B", tap: false, sub: "", subFg: "#6B7280" },
    { key: "net", l: "Net Pay", v: formatRM(t.net), fg: t.net < 0 ? "#9A3A2D" : "#1F1D1B", tap: false, sub: "", subFg: "#6B7280" },
    { key: "stat", l: "Statutory (all)", v: formatRM(t.statutory), fg: "#3E6570", tap: true, sub: t.pcbComplete ? "" : "PCB not computed yet", subFg: "#9A3A2D" },
  ];
}

export type Sheet = { title: string; sub: string; rows: { k: string; v: string }[]; total: string; note: string };
export function totalPaySheet(t: Totals): Sheet {
  return {
    title: "Total Pay",
    sub: "Gross + employer contributions",
    rows: [
      { k: "Gross Pay", v: formatRM(t.gross) },
      { k: "Employer EPF", v: formatRM(t.employerEpf) },
      { k: "Employer SOCSO", v: formatRM(t.employerSocso) },
      { k: "Employer EIS", v: formatRM(t.employerEis) },
    ],
    total: formatRM(t.totalPay),
    note: t.advances > 0 ? `${formatRM(t.advances)} of this already paid as advances` : "",
  };
}
export function statutorySheet(t: Totals): Sheet {
  return {
    title: "Statutory (all)",
    sub: "Employee + employer contributions",
    rows: [
      { k: "EPF (EE + ER)", v: formatRM(t.epf) },
      { k: "SOCSO (EE + ER)", v: formatRM(t.socso) },
      { k: "EIS (EE + ER)", v: formatRM(t.eis) },
      { k: "PCB", v: t.pcbComplete ? formatRM(t.pcb) : "Not computed" },
    ],
    total: formatRM(t.statutory),
    note: t.pcbComplete ? "" : "PCB could not be computed for every worker, so this total is a floor.",
  };
}

// ---- the worker cards --------------------------------------------------------------------------------------------------------------------

export type Cell = { k: string; v: string; fg: string; w: number };
export function workerCells(p: PayslipRow): Cell[] {
  const net = n(p.netPay);
  return [
    { k: "Basic (RM)", v: formatRM(n(p.basicSalary)), fg: "#1F1D1B", w: 600 },
    { k: "Days", v: String(n(p.workingDays)), fg: "#1F1D1B", w: 600 },
    { k: "OT Amt", v: formatRM(n(p.totalOT)), fg: "#6B5C32", w: 600 },
    { k: "Gross", v: formatRM(n(p.grossPay)), fg: "#1F1D1B", w: 700 },
    { k: "Net Pay", v: formatRM(net), fg: net < 0 ? "#9A3A2D" : "#1F1D1B", w: 700 },
    { k: "Total Pay", v: formatRM(totalPayOf(p)), fg: "#6B5C32", w: 700 },
  ];
}

/** The status the API returned, with the HTML's colours (DRAFT grey, APPROVED teal, PAID green). */
export function statusTone(status: string | undefined): { label: string; bg: string; fg: string } {
  const s = (status || "").toUpperCase();
  if (s === "DRAFT") return { label: "DRAFT", bg: "#F3F4F6", fg: "#374151" };
  if (s === "APPROVED") return { label: "APPROVED", bg: "#E0EDF0", fg: "#3E6570" };
  if (s === "PAID") return { label: "PAID", bg: "#EEF3E4", fg: "#4F7C3A" };
  return { label: s || "—", bg: "#F0ECE9", fg: "#4D4630" };
}

/** The TOTAL strip over the MATCHING workers (all of them, not only the first five). */
export function stripCells(t: Totals): Cell[] {
  return [
    { k: "Basic", v: formatRM(t.basic), fg: "#1F1D1B", w: 700 },
    { k: "OT Amt", v: formatRM(t.ot), fg: "#6B5C32", w: 700 },
    { k: "Gross", v: formatRM(t.gross), fg: "#1F1D1B", w: 700 },
    { k: "Statutory", v: formatRM(t.statutory), fg: "#3E6570", w: 700 },
    { k: "Net Pay", v: formatRM(t.net), fg: t.net < 0 ? "#9A3A2D" : "#1F1D1B", w: 700 },
    { k: "Total Pay", v: formatRM(t.totalPay), fg: "#6B5C32", w: 700 },
  ];
}

// ---- search and filters (client-side; the matching list drives the TOTAL strip and "Show N workers") ------------------------------------------

export type Deduction = "all" | "abs" | "late" | "adv" | "pen";
export type PayFilters = { q: string; st: string; dept: string; ded: Deduction };
export const NO_PAY_FILTERS: PayFilters = { q: "", st: "all", dept: "all", ded: "all" };

export const parseDeduction = (raw: string | null): Deduction => (raw === "abs" || raw === "late" || raw === "adv" || raw === "pen" ? raw : "all");

export function deductionOk(p: PayslipRow, d: Deduction): boolean {
  if (d === "all") return true;
  if (d === "abs") return n(p.absenceDeductionSen) > 0;
  if (d === "late") return n(p.shortHourDeductionSen) > 0;
  if (d === "adv") return n(p.advanceDeductionSen) > 0;
  return n(p.penaltyDeductionSen) > 0;
}

export function matches(p: PayslipRow, f: PayFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !`${p.employeeName ?? ""} ${p.employeeNo ?? ""}`.toLowerCase().includes(q)) return false;
  if (f.st !== "all" && (p.status ?? "").toUpperCase() !== f.st) return false;
  if (f.dept !== "all" && (p.departmentCode ?? "") !== f.dept) return false;
  return deductionOk(p, f.ded);
}

/** The filter badge counts the three chips (status, department, deductions); the search is not a chip. */
export const filterCount = (f: PayFilters) => (f.st !== "all" ? 1 : 0) + (f.dept !== "all" ? 1 : 0) + (f.ded !== "all" ? 1 : 0);

export function deptOptions(rows: readonly PayslipRow[], nameOf: (code: string) => string): { code: string; name: string }[] {
  return [...new Set(rows.map((r) => r.departmentCode ?? "").filter(Boolean))].map((code) => ({ code, name: nameOf(code) })).sort((a, b) => a.name.localeCompare(b.name));
}

export const STATUS_CHOICES: { k: string; l: string }[] = [
  { k: "all", l: "All" },
  { k: "DRAFT", l: "Draft" },
  { k: "APPROVED", l: "Approved" },
  { k: "PAID", l: "Paid" },
];
export const DEDUCTION_CHOICES: { k: Deduction; l: string }[] = [
  { k: "all", l: "Any" },
  { k: "abs", l: "Absence" },
  { k: "late", l: "Late / short" },
  { k: "adv", l: "Advance" },
  { k: "pen", l: "Penalty" },
];
