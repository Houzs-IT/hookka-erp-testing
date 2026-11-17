// payroll-prints.ts — Employees → Payroll → "..." → Print Report and Export CSV (HK-0125). Pure: payslip rows in, a PrintDoc / CSV text out.
//
// Both mirror desktop's Payroll tab (employees.tsx `handlePrint` and `exportCSV`) over the SELECTED MONTH'S payslips, all of them — the
// desktop tab has no search or filter, so neither does the printout or the file (the phone's search / filters only narrow the list on
// screen). The Calculation Guide is src/lib/calc-guide.ts, shared with desktop. All amounts are the server's, in sen.
import { formatCurrency } from "../../../../lib/utils";
import { normalizeStoredPcbStatus, pcbHasFigure } from "../../../../lib/pcb";
import type { PrintCell, PrintDoc } from "./menu-prints";
import { partMonthSen, type DetailRow } from "./payslip-detail-model";

const n = (v: unknown) => Number(v) || 0;
/** No "RM " prefix: ten money columns of repeated prefix push the sheet off the page; the unit is in the subtitle (desktop `printMoney`). */
const pm = (sen: number): string => formatCurrency(sen).replace(/^RM\s*/, "");
const hours = (h: number | undefined): string => (n(h) > 0 ? `${h}h` : "-");
const money = (sen: number | undefined, minus = false): string => (n(sen) > 0 ? `${minus ? "−" : ""}${pm(n(sen))}` : "-");
const pcbShown = (p: DetailRow): boolean => pcbHasFigure(normalizeStoredPcbStatus(p.pcbStatus));

export function payrollPrint(rows: readonly DetailRow[], monthLabel: string, estimate: boolean): PrintDoc {
  const sum = (f: (p: DetailRow) => number) => rows.reduce((s, p) => s + f(p), 0);
  const gross = sum((p) => n(p.grossPay));
  const employer = sum((p) => n(p.epfEmployer) + n(p.socsoEmployer) + n(p.eisEmployer));
  const advances = sum((p) => n(p.advanceDeductionSen));
  const penalties = sum((p) => n(p.penaltyDeductionSen));
  const pcbComplete = rows.every(pcbShown);
  return {
    title: "Payroll",
    subtitle: "All amounts in RM",
    filterSummary: `${monthLabel}${estimate ? " · Estimate (month in progress)" : ""}`,
    orientation: "landscape",
    dense: true,
    cards: [
      { label: "Still To Pay Out", value: formatCurrency(gross + employer) },
      ...(advances > 0 ? [{ label: "Advances Already Paid", value: formatCurrency(advances) }] : []),
      ...(penalties > 0 ? [{ label: "Worker Penalties", value: formatCurrency(penalties) }] : []),
      { label: "Total EPF (EE+ER)", value: formatCurrency(sum((p) => n(p.epfEmployee) + n(p.epfEmployer))) },
      { label: "Total SOCSO", value: formatCurrency(sum((p) => n(p.socsoEmployee) + n(p.socsoEmployer))) },
      { label: "Total EIS", value: formatCurrency(sum((p) => n(p.eisEmployee) + n(p.eisEmployer))) },
      // A total inherits the weakest input: a PCB sum over months where it was never computed would look complete.
      { label: "Total PCB", value: pcbComplete ? formatCurrency(sum((p) => n(p.pcb))) : "— not computed" },
    ],
    sections: [
      {
        columns: [
          { header: "Employee", width: "13%" },
          { header: "Dept", width: "7%" },
          { header: "Basic", align: "right" },
          { header: "Days", align: "center" },
          { header: "Absent", align: "center" },
          { header: "Absence", align: "right" },
          { header: "Late/Short", align: "right" },
          { header: "OT Wk", align: "right" },
          { header: "OT Sun", align: "right" },
          { header: "OT PH", align: "right" },
          { header: "OT Amt", align: "right" },
          { header: "Allow", align: "right" },
          { header: "Gross", align: "right" },
          { header: "EPF EE", align: "right" },
          { header: "EPF ER", align: "right" },
          { header: "SOCSO", align: "right" },
          { header: "EIS", align: "right" },
          { header: "PCB", align: "right" },
          { header: "Advance", align: "right" },
          { header: "Penalty", align: "right" },
          { header: "Net Pay", align: "right" },
          { header: "Status", align: "center" },
        ],
        rows: rows.map((p): PrintCell[] => {
          const late = p.shortHourDeductionSen ?? partMonthSen(p);
          const lateDays = p.lateDays?.length ?? 0;
          return [
            `${p.employeeNo ?? ""} ${p.employeeName ?? ""}`,
            (p.departmentCode ?? "").replace(/_/g, " "),
            pm(n(p.basicSalary)),
            n(p.workingDays),
            n(p.absentDays) > 0 ? `${p.absentDays}d` : "-",
            money(p.absenceDeductionSen, true),
            late > 1 ? `−${pm(late)}${lateDays > 0 ? ` (${lateDays}d)` : ""}` : "-",
            hours(p.otWeekdayHours),
            hours(p.otSundayHours),
            hours(p.otPHHours),
            money(p.totalOT),
            money(p.allowances),
            pm(n(p.grossPay)),
            money(p.epfEmployee),
            money(p.epfEmployer),
            money(p.socsoEmployee),
            money(p.eisEmployee),
            pcbShown(p) && n(p.pcb) > 0 ? pm(n(p.pcb)) : "-",
            money(p.advanceDeductionSen, true),
            money(p.penaltyDeductionSen, true),
            { text: pm(n(p.netPay)), bold: true },
            p.status ?? "",
          ];
        }),
      },
    ],
  };
}

// ---- Export CSV -------------------------------------------------------------------------------------------------------------------------

export type AdvanceDay = { workerId: string; date: string; amountSen: number };
export type PenaltyLine = { workerId: string; penaltyNo: string; poNo?: string; amountSen: number };

export const CSV_HEADERS = [
  "Employee No", "Employee Name", "Department", "Basic Salary", "Working Days",
  "Absent Days", "Absence Deduction", "Absence Formula", "Absent Dates",
  "Late/Short Hours", "Late/Short Deduction", "Late/Short Formula", "Late/Short Days",
  "Part-month Adjustment", "Basic Earned",
  "OT Weekday Hrs", "OT Sunday Hrs", "OT PH Hrs", "OT Days", "Hourly Rate",
  "OT Weekday Amt", "OT Sunday Amt", "OT PH Amt", "Total OT", "Allowances",
  "Gross Pay", "EPF EE (11%)", "EPF ER (13%)", "SOCSO EE", "SOCSO ER",
  "EIS EE", "EIS ER", "PCB", "Total Deductions",
  "Advance Taken", "Advance Dates",
  "Worker Penalty", "Penalty Refs",
  "Net Pay", "Bank Account", "Status",
] as const;

const rm2 = (sen: number): string => (sen / 100).toFixed(2);
/** Hours are sums of per-department rows, so a 0.5h dock can carry float dust; two decimals is the precision they are recorded in. */
const round2 = (h: number): number => Math.round((Number(h) || 0) * 100) / 100;
/** Quote anything with a comma / quote / newline — the detail columns join dates with "; ". */
const esc = (v: unknown): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** desktop `exportCSV`, column for column. `advances` / `penalties` are the period's lists (empty when the role cannot read them). */
export function payrollCsv(rows: readonly DetailRow[], advances: readonly AdvanceDay[], penalties: readonly PenaltyLine[]): string {
  const lines = rows.map((r) => {
    const absentDays = n(r.absentDays);
    const absenceSen = n(r.absenceDeductionSen);
    const shortSen = n(r.shortHourDeductionSen);
    const shortDays = r.lateDays ?? [];
    const shortHours = Math.round(shortDays.reduce((s, d) => s + (d.hours || 0), 0) * 100) / 100;
    // The rate actually used for the dock (salary ÷ days ÷ day span), NOT the "Hourly Rate" column: printing the real one is the point.
    const shortRate = shortHours > 0 ? shortSen / shortHours : 0;
    const advanceSen = n(r.advanceDeductionSen);
    const penaltySen = n(r.penaltyDeductionSen);
    const proration = partMonthSen(r);
    const basicEarned = Math.max(0, n(r.basicSalary) - absenceSen - shortSen - proration);
    const cells: unknown[] = [
      r.employeeNo ?? "", r.employeeName ?? "", r.departmentCode ?? "", rm2(n(r.basicSalary)),
      n(r.workingDays), absentDays, rm2(absenceSen),
      absentDays > 0 ? `${rm2(n(r.basicSalary))} / ${n(r.workingDays)} days x ${absentDays} = ${rm2(absenceSen)}` : "",
      (r.absentDates ?? []).join(" "),
      shortHours || "", shortSen > 0 ? rm2(shortSen) : "",
      shortHours > 0 ? `${shortHours}h x ${rm2(shortRate)}/h = ${rm2(shortSen)}` : "",
      shortDays.map((d) => `${d.date} ${round2(d.hours)}h`).join("; "),
      proration > 1 ? rm2(proration) : "",
      rm2(basicEarned),
      n(r.otWeekdayHours), n(r.otSundayHours), n(r.otPHHours),
      (r.otDays ?? []).map((d) => `${d.date} ${round2(d.hours)}h`).join("; "),
      rm2(n(r.hourlyRate)), rm2(n(r.otWeekdayAmount)), rm2(n(r.otSundayAmount)), rm2(n(r.otPHAmount)),
      rm2(n(r.totalOT)), rm2(n(r.allowances)),
      rm2(n(r.grossPay)), rm2(n(r.epfEmployee)), rm2(n(r.epfEmployer)), rm2(n(r.socsoEmployee)),
      rm2(n(r.socsoEmployer)), rm2(n(r.eisEmployee)), rm2(n(r.eisEmployer)),
      // Exported the way it is displayed: blank, not 0.00, when no withholding was computed for this employee.
      pcbShown(r) ? rm2(n(r.pcb)) : "",
      rm2(n(r.totalDeductions)),
      advanceSen > 0 ? rm2(advanceSen) : "",
      advanceSen > 0 ? advances.filter((a) => a.workerId === r.employeeId).map((a) => `${a.date} ${rm2(a.amountSen)}`).join("; ") : "",
      penaltySen > 0 ? rm2(penaltySen) : "",
      penaltySen > 0 ? penalties.filter((l) => l.workerId === r.employeeId).map((l) => `${l.penaltyNo}${l.poNo ? ` (${l.poNo})` : ""} ${rm2(l.amountSen)}`).join("; ") : "",
      rm2(n(r.netPay)),
      r.bankAccount ?? "", r.status ?? "",
    ];
    return cells.map(esc).join(",");
  });
  return [CSV_HEADERS.join(","), ...lines].join("\n");
}

/** The file desktop downloads: `payroll-YYYY-MM.csv`. */
export const csvFileName = (period: string): string => `payroll-${period}.csv`;
