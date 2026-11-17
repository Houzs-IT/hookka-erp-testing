// calc-guide.ts — the printable Salary Calculation Guide, shared by desktop (Payroll → "Calculation Guide") and the phone
// (Employees → Payroll → "..." → Calculation Guide, HK-0125). Moved verbatim out of src/pages/employees.tsx so the two print
// the same worked example from the same rules. GENERATED from the pay rules in force (`cfg`), so it never goes stale.
import { minToHhmm, type PayRulesConfig } from "./pay-rules";
import type { PrintReportOptions } from "./print-report";

export function buildCalcGuide(cfg: PayRulesConfig, now: Date = new Date()): PrintReportOptions {
  const S = 2050; // example salary (RM)
  const monthName = now.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
  const calDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let monSat = 0;
  for (let i = 1; i <= calDays; i++) {
    if (new Date(now.getFullYear(), now.getMonth(), i).getDay() !== 0) monSat++;
  }
  const lunchH = cfg.lunchMin / 60;
  const lunchTxt = `${cfg.lunchMin % 60 === 0 ? lunchH.toFixed(0) : lunchH.toFixed(1)}h`;
  const stdH = (cfg.shiftEndMin - cfg.shiftStartMin - cfg.lunchMin) / 60;
  const shiftTxt = `${minToHhmm(cfg.shiftStartMin)}-${minToHhmm(cfg.shiftEndMin)}`;
  // Day rate per the configured divisor mode.
  const dayDiv = cfg.dayRateDivisorMode === "calendarDays" ? calDays : cfg.dayRateDivisorMode === "workingDays" ? monSat : 26;
  const dayDivTxt =
    cfg.dayRateDivisorMode === "calendarDays"
      ? `the month's calendar days (${monthName}: ${calDays})`
      : cfg.dayRateDivisorMode === "workingDays"
        ? `the month's working days (${monthName}: ${monSat}, Mon-Sat before public holidays)`
        : "26 — the same every month";
  const dayRate = S / dayDiv;
  // Hour rate per the configured mode (example worker = 9h/day).
  const hourDiv = cfg.hourRateDivisorMode === "fixed" ? cfg.rateHoursPerDay : cfg.hourRateDivisorMode === "hoursOnly" ? 9 : 9 + lunchH;
  const hourDivTxt =
    cfg.hourRateDivisorMode === "fixed"
      ? `${cfg.rateHoursPerDay} (the same fixed number for everyone)`
      : cfg.hourRateDivisorMode === "hoursOnly"
        ? "the worker's daily hours (9h worker → ÷9)"
        : `the worker's daily hours + ${lunchTxt} lunch (9h worker → ÷${9 + lunchH})`;
  // Rounded to the sen like the engine (payrollHourRateSen).
  const hourRate = Math.round((dayRate / Math.max(1, hourDiv)) * 100) / 100;
  const rm = (v: number) => `RM${v.toFixed(2)}`;
  const grace = cfg.lateGraceMin;
  const block = cfg.lateBlockMin;
  const lateIn = minToHhmm(cfg.shiftStartMin + grace + 1);
  const onTimeIn = minToHhmm(cfg.shiftStartMin + Math.max(0, grace - 2));
  const sun = cfg.sundayOtMultiplier;
  const ph = cfg.holidayOtMultiplier;
  type GuideRow = { item: string; rule: string; example: string };
  // Item bold + Example in the house gold, so the three columns read as
  // name / explanation / number instead of one grey block (owner 2026-06-11).
  // Same widths in every section so the three columns line up down the
  // whole page (owner: sections must align, not each table auto-sizing).
  const col = [
    { header: "Item", width: "19%", value: (r: unknown) => ({ text: (r as GuideRow).item, bold: true }) },
    { header: "How it is calculated", width: "53%", value: (r: unknown) => (r as GuideRow).rule },
    { header: "Example", width: "28%", value: (r: unknown) => ({ text: (r as GuideRow).example, color: "#6B5C32", bold: true }) },
  ];
  const s = (title: string, rows: GuideRow[]) => ({ title, columns: col, rows });
  return {
    title: "Salary Calculation Guide",
    filterSummary: `Worked example: RM2,050/month · 9h/day worker · ${monthName} · Shift ${shiftTxt}, ${lunchTxt} unpaid lunch = ${stdH}h standard day · printed from the rules in force today`,
    cards: [
      { label: "Example salary", value: "RM2,050 / month" },
      { label: "Day rate", value: `2,050 ÷ ${dayDiv} = ${rm(dayRate)}` },
      { label: "Hour rate", value: `${rm(dayRate)} ÷ ${hourDiv} = ${rm(hourRate)}` },
      { label: "OT rates", value: `Weekday 1.5x · Sunday ${sun}x · Holiday ${ph}x` },
    ],
    sections: [
      s("1. Daily & hourly rates", [
        { item: "Day rate", rule: `Monthly salary ÷ ${dayDivTxt} · used for absences and join/resign`, example: `2,050 ÷ ${dayDiv} = ${rm(dayRate)} / day` },
        { item: "Hour rate", rule: `Day rate ÷ ${hourDivTxt} · used for lateness, short hours AND the overtime base`, example: `${rm(dayRate)} ÷ ${hourDiv} = ${rm(hourRate)} / hour` },
        { item: "Production cost day rate", rule: "Monthly salary ÷ working days of the month (internal costing only — never changes pay)", example: `2,050 ÷ ${monSat} ≈ ${rm(S / Math.max(1, monSat))} / day` },
      ]),
      s("2. Working hours from the punch clock", [
        { item: "Standard day", rule: `Punch in to punch out, minus the ${lunchTxt} unpaid lunch`, example: `${shiftTxt} − ${lunchTxt} = ${stdH}h` },
        { item: "Late grace", rule: `Up to ${grace} minutes late is forgiven`, example: `${onTimeIn} in → counted as on time` },
        { item: "Lateness rounding", rule: `Beyond grace, lateness rounds UP in ${block}-min blocks`, example: `${lateIn} → ${block} min late` },
        // The 15-min-block wording predates the owner's 2026-07-04 rule
        // ("OT 要30分鐘才算") and told workers 16 min earned 15 min of OT while
        // the engine paid nothing under 30. The guide is handed to workers —
        // it has to state what they are actually paid.
        { item: "Overtime counting", rule: `Only after ${minToHhmm(cfg.shiftEndMin)}, and only once it reaches 30 minutes; then in 15-min blocks`, example: "29 min → 0; 30 min → 30 min; 45 min → 45 min" },
      ]),
      s("3. Lateness / short hours deduction", [
        { item: "Deduction", rule: `Short hours × the hour rate (${rm(hourRate)}/h)`, example: `30 min late, no OT → 0.5h × ${hourRate.toFixed(2)} = −${rm(hourRate / 2)}` },
        { item: "Same-day OT offsets first", rule: "Evening OT covers the morning gap 1:1; only the remainder is deducted", example: "30 min late + 2h OT → deduction RM0, paid OT 1.5h" },
        { item: "Review", rule: "The office can Keep pay (no deduction) or Deduct each short day; every deduction can be undone", example: "Shown in the worker app under 'Late / short hours'" },
      ]),
      s("4. Overtime pay", [
        { item: "Weekday OT", rule: `Hours above the ${stdH}h standard × hour rate × the worker's multiplier (usually 1.5)`, example: `2h → 2 × ${hourRate.toFixed(2)} × 1.5 = ${rm(2 * hourRate * 1.5)}` },
        { item: "Sunday work", rule: `EVERY hour that day × hour rate × ${sun} (Sundays are non-working)`, example: `8h Sunday → ${rm(8 * hourRate * sun)}` },
        { item: "Public holiday work", rule: `EVERY hour that day × hour rate × ${ph}`, example: `8h holiday → ${rm(8 * hourRate * ph)}` },
      ]),
      s("5. Absence", [
        { item: "Absent working day", rule: "Each confirmed absent day deducts the day rate", example: `1 day → −${rm(dayRate)}` },
        { item: "Grace before confirming", rule: `A blank day only becomes an absence after ${cfg.absenceGraceWorkingDays} working days (it may just not be keyed yet)`, example: "Shown as 'Pending' until confirmed" },
        { item: "Backfilling hours", rule: "Keying the hours later removes the absence automatically", example: "No button needed; regenerate if the month was finalised" },
      ]),
      s("6. Joining / resigning mid-month", [
        { item: "One rule for everyone", rule: "No separate part-month formula — every working day of the month not worked counts as an absent day at the day rate", example: `Same −${rm(dayRate)} per day` },
        { item: "Join mid-month", rule: "Full salary − the working days before the join date (they count as absences)", example: `3 working days before joining → 2,050 − 3 × ${dayRate.toFixed(2)} = ${rm(S - 3 * dayRate)}` },
        { item: "Resign mid-month", rule: "Working days after the last day also count as absent days", example: `Each later working day deducts ${rm(dayRate)}` },
      ]),
      s("7. Allowance, statutory & net pay", [
        { item: "Efficiency allowance", rule: "Flat bonus when the month's cumulative efficiency reaches the worker's target, else RM0 (no proration)", example: "RM150 at 100%" },
        { item: "Leadership allowance", rule: "Flat monthly bonus pro-rated by attendance — no efficiency threshold", example: `27 working days, 2 absent → 25/27 of the configured amount` },
        { item: "Statutory (per-worker toggle)", rule: `EPF ${cfg.epfEmployeePct}% employee / ${cfg.epfEmployerPct}% employer on basic · SOCSO RM${(cfg.socsoEmployeeSen / 100).toFixed(2)}/${(cfg.socsoEmployerSen / 100).toFixed(2)} · EIS RM${(cfg.eisEmployeeSen / 100).toFixed(2)}/${(cfg.eisEmployerSen / 100).toFixed(2)}`, example: "Deducted only when enabled" },
        { item: "Net pay", rule: "Basic − absence − late/short + OT + allowance − employee statutory − salary advances already taken", example: "What the worker receives" },
        { item: "Salary advance", rule: "Cash drawn during the month is paid back out of that same month's pay. It is not an earning and not a statutory deduction, so EPF / SOCSO / EIS / PCB are unaffected", example: "Draw RM300 on the 12th → RM300 less in the pay-out" },
      ]),
    ],
  };
}
