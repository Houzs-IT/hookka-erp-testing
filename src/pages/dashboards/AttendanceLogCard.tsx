import { useMemo, useState, type ReactNode } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MUTED, inFocus, isOutsourced, periodLabel, stepDay, ymd, type Period } from "./dashboard-shared-lib";
import type { EmployeeSlice } from "./EmployeesInsights";
import { deptName } from "./ops-floor-lib";

// Attendance log: latest recorded day per employee inside the period (or the
// focused day), plus that person's day count.
//
// Clock in/out and the day count come from attendance_records. HOURS and
// EFFICIENCY do not: attendance_records.production_time_minutes is not what
// the office reads (the route's header says so, and it showed 0h for everyone),
// so they come from the house metric, performance.byDay[].workers, for that
// worker on that day:
//   Production time = clocked minutes in production depts
//   Prod hours      = earned standard minutes
//   Non-prod hours  = all-dept clocked − production-dept clocked
//   Efficiency      = Prod hours ÷ Production time
const hrs = (min: number) => `${Math.round(min / 6) / 10}h`;
const hhmm = (t: string | null) => t?.match(/\d{2}:\d{2}/)?.[0] ?? "—";
// Minutes after the 08:00 shift start; 0 when on time or unparseable.
const lateMin = (t: string | null) => {
  const m = t?.match(/(\d{2}):(\d{2})/);
  return m ? Math.max(0, Number(m[1]) * 60 + Number(m[2]) - 480) : 0;
};

// perDay is an explicit prop (set when the filter bar has ONE employee picked) rather than
// derived from "one distinct employee in the slice": a department that happens to have a
// single active worker should still read as the department view.
// `below` renders under the card with the card's EFFECTIVE period, so a panel there
// (the Time & attendance warning audit) follows the Today / Yesterday switch too.
export function AttendanceLogCard({ employee, period: pagePeriod, perDay = false, below }: {
  employee: EmployeeSlice; period: Period; perDay?: boolean; below?: (period: Period) => ReactNode;
}) {
  // Today / Yesterday switch for THIS card only. "Today" is the browser's calendar day, the
  // same one resolvePeriod opens the page on. A pick remembers the page period it was made
  // against, so moving the page picker drops it (derived, no effect); pressing the lit chip
  // again also hands the card back to the page period.
  const today = ymd(new Date());
  const days = [["Today", today], ["Yesterday", stepDay(today, -1, today)!]] as const;
  const pageKey = JSON.stringify(pagePeriod);
  const [pick, setPick] = useState<{ day: string; pageKey: string } | null>(null);
  const override = pick?.pageKey === pageKey ? pick.day : undefined;
  const period = useMemo(() => (override ? { ...pagePeriod, day: override } : pagePeriod), [pagePeriod, override]);
  // "This month" (owner 2026-10-17: "如果我要看这个月的，该怎么看"): one row per
  // person for the month — days in, days not in, times late, minutes late —
  // most absent first, then most late.
  // A login kept only for viewing never clocks in — not an absent worker.
  const everClocked = useMemo(() => new Set(employee.attendance.filter((r) => r.clockIn || r.clockOut).map((r) => r.employeeId)), [employee]);
  const [monthPick, setMonthPick] = useState<string | null>(null);
  const monthOn = monthPick === pageKey;
  const monthYm = (pagePeriod.day ?? pagePeriod.month ?? today).slice(0, 7);
  const monthRows = useMemo(() => {
    if (!monthOn) return null;
    const recs = employee.attendance.filter((r) => (r.date ?? "").startsWith(monthYm) && (r.clockIn || r.clockOut));
    const workDays = [...new Set(recs.map((r) => r.date as string))].sort();
    const byName = new Map(employee.workers.map((w) => [(w.name ?? "").trim().toLowerCase(), w.id]));
    const byWorker = new Map<string, typeof recs>();
    for (const r of recs) {
      const id = r.employeeId ?? byName.get((r.employeeName ?? "").trim().toLowerCase()) ?? null;
      if (!id) continue;
      byWorker.set(id, [...(byWorker.get(id) ?? []), r]);
    }
    const rows = employee.workers
      .filter((w) => w.countsToHeadcount && !isOutsourced(w) && everClocked.has(w.id))
      .map((w) => {
        const mine = byWorker.get(w.id) ?? [];
        const inDays = new Set(mine.map((r) => r.date));
        const lates = mine.map((r) => lateMin(r.clockIn)).filter((m) => m > 0);
        // Days before the person's first clock-in this month are not counted
        // as absences (a mid-month joiner).
        const first = [...inDays].sort()[0] ?? workDays[0];
        const expected = workDays.filter((d) => d >= (first ?? ""));
        return {
          id: w.id,
          name: w.name ?? w.id,
          dept: w.dept ? deptName(w.dept) : "—",
          daysIn: inDays.size,
          notIn: Math.max(0, expected.length - inDays.size),
          late: lates.length,
          lateMin: lates.reduce((a, b) => a + b, 0),
        };
      })
      .sort((a, b) => b.notIn - a.notIn || b.late - a.late || b.lateMin - a.lateMin || a.name.localeCompare(b.name));
    return { rows, workDays: workDays.length };
  }, [monthOn, employee, monthYm, everClocked]);

  const log = useMemo(() => {
    const byId = new Set(employee.workers.map((w) => w.id));
    const homeDept = new Map(employee.workers.map((w) => [w.id, w.dept]));
    const byName = new Map(employee.workers.map((w) => [(w.name ?? "").trim().toLowerCase(), w.id]));
    const perf = new Map<string, { working: number; prod: number; all: number }>();
    for (const d of employee.performance.byDay) {
      for (const x of d.workers ?? []) {
        perf.set(`${d.date}|${x.workerId}`, { working: x.workingMinutes, prod: x.productionMinutes, all: x.allDeptMinutes ?? x.workingMinutes });
      }
    }

    const byEmp = new Map<string, { last: EmployeeSlice["attendance"][number]; workerId: string | null; days: number }>();
    for (const r of employee.attendance) {
      if (!r.date || !inFocus(period, r.date)) continue;
      const workerId = r.employeeId && byId.has(r.employeeId)
        ? r.employeeId
        : (byName.get((r.employeeName ?? "").trim().toLowerCase()) ?? null);
      const k = (workerId ?? r.employeeId ?? r.employeeName ?? "") + (perDay ? `|${r.date}` : "");
      const cur = byEmp.get(k);
      byEmp.set(k, { last: !cur || r.date >= (cur.last.date ?? "") ? r : cur.last, workerId, days: (cur?.days ?? 0) + 1 });
    }

    const rows = [...byEmp.entries()]
      .map(([key, { last, workerId, days }]) => {
        const p = workerId && last.date ? perf.get(`${last.date}|${workerId}`) : undefined;
        const dept = (workerId && homeDept.get(workerId)) || last.dept;
        return {
          key, last, days,
          dept: dept ? deptName(dept) : "—",
          working: p?.working ?? null,
          prod: p?.prod ?? null,
          nonProd: p ? Math.max(0, p.all - p.working) : null,
          eff: p && p.working > 0 ? (p.prod / p.working) * 100 : null,
          absent: false,
        };
      });
    // One day in focus: every headcount worker with no clock record that day
    // is listed as NOT IN (owner 2026-10-17: "没来的一定要显示"), and the list
    // reads not in → late → on time, so the problems are on top.
    if (period.day && !perDay) {
      const seen = new Set([...byEmp.values()].map((v) => v.workerId).filter(Boolean));
      for (const w of employee.workers) {
        if (!w.countsToHeadcount || isOutsourced(w) || !everClocked.has(w.id) || seen.has(w.id)) continue;
        rows.push({
          key: `absent|${w.id}`,
          last: { employeeId: w.id, employeeName: w.name, dept: w.dept, date: period.day, clockIn: null, clockOut: null, workingMinutes: 0, productionMinutes: 0, overtimeMinutes: 0, efficiencyPct: null },
          dept: w.dept ? deptName(w.dept) : "—",
          days: 0, working: null, prod: null, nonProd: null, eff: null, absent: true,
        });
      }
    }
    const rank = (r: (typeof rows)[number]) => (r.absent ? 0 : lateMin(r.last.clockIn) > 0 ? 1 : 2);
    rows.sort((a, b) => perDay
      ? (b.last.date ?? "").localeCompare(a.last.date ?? "")
      : rank(a) - rank(b) || (a.last.employeeName ?? "").localeCompare(b.last.employeeName ?? ""));

    const sum = (f: (r: (typeof rows)[number]) => number | null) => rows.reduce((a, r) => a + (f(r) ?? 0), 0);
    const working = sum((r) => r.working);
    const prod = sum((r) => r.prod);
    return { rows, working, prod, nonProd: sum((r) => r.nonProd), days: sum((r) => r.days), eff: working > 0 ? (prod / working) * 100 : null, absent: rows.filter((r) => r.absent).length, late: rows.filter((r) => !r.absent && lateMin(r.last.clockIn) > 0).length };
  }, [employee, period, perDay, everClocked]);

  const H = ["Employee", "Department", "Date", "Clock in", "Clock out", "Production time", "Prod hours", "Non-prod hours", "Efficiency", ...(perDay ? [] : ["Total days"]), "Status"];
  const ncol = H.length;
  const who = log.rows[0]?.last.employeeName ?? "";
  const h = (v: number | null) => (v == null ? "—" : hrs(v));

  return (
    <>
    <Card>
      <CardHeader className="pb-3 flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <CardTitle>
          Attendance log{" "}
          <span className="ml-2 max-md:ml-0 max-md:block text-[11px] font-normal text-[#6B7280]">
            {monthRows
              ? `${monthYm} · ${monthRows.workDays} working days so far · ${monthRows.rows.filter((r) => r.notIn > 0).length} people missed a day · ${monthRows.rows.filter((r) => r.late > 0).length} were late`
              : perDay
              ? `${log.days} days · ${who} · ${periodLabel(period)}`
              : period.day
                ? `${periodLabel(period)} · ${log.absent} not in · ${log.late} late · ${log.rows.length - log.absent - log.late} on time`
                : `${log.rows.length} employees · latest recorded day each · ${periodLabel(period)}`}
          </span>
        </CardTitle>
        {/* Same segmented look as the page's Day / Month / YTD toggle (PeriodPicker). */}
        <div role="group" aria-label="Attendance day" className="flex gap-0.5 rounded-lg border border-[#E2DDD8] bg-[#F7F5F3] p-0.5">
          {days.map(([label, d]) => {
            const on = !monthOn && period.day === d;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => { setMonthPick(null); setPick(on ? null : { day: d, pageKey }); }}
                className={
                  "px-3 py-1 max-md:h-11 max-md:text-sm text-xs font-medium rounded-md border transition-colors " +
                  (on
                    ? "bg-white border-[#6B5C32] text-[#1F1D1B] shadow-sm"
                    : "bg-transparent border-transparent text-[#6B7280] hover:bg-white/60")
                }
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={monthOn}
            onClick={() => setMonthPick(monthOn ? null : pageKey)}
            className={
              "px-3 py-1 max-md:h-11 max-md:text-sm text-xs font-medium rounded-md border transition-colors " +
              (monthOn ? "bg-white border-[#6B5C32] text-[#1F1D1B] shadow-sm" : "bg-transparent border-transparent text-[#6B7280] hover:bg-white/60")
            }
          >
            This month
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {monthRows ? (
          <div className="overflow-x-auto" style={{ maxHeight: 460, overflowY: "auto" }}>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="*:sticky *:top-0 *:z-10 *:bg-white *:shadow-[inset_0_1px_0_#E2DDD8,inset_0_-1px_0_#E2DDD8]">
                  {["Employee", "Department", "Days in", "Not in", "Times late", "Minutes late", "Status"].map((t, i) => (
                    <th key={t} className={`px-3 py-2 font-semibold uppercase text-[10.5px] tracking-wide text-[#6B7280] whitespace-nowrap ${i >= 2 && i <= 5 ? "text-right" : "text-left"}`}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthRows.rows.map((r) => (
                  <tr key={r.id} className={`border-b border-[#E2DDD8] ${r.notIn > 0 ? "bg-[#FDF3F1]" : ""}`}>
                    <td className={`px-3 py-2 ${r.notIn > 0 ? "font-semibold text-[#9A3A2D]" : "text-[#1F1D1B]"}`}>{r.name}</td>
                    <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">{r.dept}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.daysIn}</td>
                    <td className={`px-3 py-2 text-right font-mono ${r.notIn > 0 ? "font-semibold text-[#9A3A2D]" : "text-[#9CA3AF]"}`}>{r.notIn}</td>
                    <td className={`px-3 py-2 text-right font-mono ${r.late > 0 ? "text-[#9C6F1E]" : "text-[#9CA3AF]"}`}>{r.late}</td>
                    <td className={`px-3 py-2 text-right font-mono ${r.lateMin > 0 ? "text-[#9C6F1E]" : "text-[#9CA3AF]"}`}>{r.lateMin}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={r.notIn > 0 ? { background: "#FBE7E3", color: "#9A3A2D" } : r.late > 0 ? { background: "#FBF0DC", color: "#9C6F1E" } : { background: "#EEF3E4", color: "#4F7C3A" }}
                      >
                        {r.notIn > 0 ? `${r.notIn} day${r.notIn > 1 ? "s" : ""} not in` : r.late > 0 ? `Late ${r.late}×` : "Every day on time"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-[#6B7280]">Working days = days anyone clocked in this month. Days before a person's first clock-in this month are not counted against them. Outsourced workers are not listed.</p>
          </div>
        ) : (
        <>
        <div className="overflow-x-auto" style={{ maxHeight: 460, overflowY: "auto" }}>
          <table className="w-full text-[12.5px]">
            {/* Sticky + background + borders live on the CELLS, not the <tr>: under Tailwind's
                border-collapse a row's border stays put while the row sticks, leaving a strip
                the scrolled rows show through. Inset shadows are the borders that travel. */}
            <thead>
              <tr className="*:sticky *:top-0 *:z-10 *:bg-white *:shadow-[inset_0_1px_0_#E2DDD8,inset_0_-1px_0_#E2DDD8]">
                {H.map((t, i) => (
                  <th key={t} className={`px-3 py-2 font-semibold uppercase text-[10.5px] tracking-wide text-[#6B7280] whitespace-nowrap ${i >= 5 && i <= 8 + (perDay ? 0 : 1) ? "text-right" : "text-left"}`}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {log.rows.map((r) => {
                const late = lateMin(r.last.clockIn);
                return (
                  <tr key={r.key} className={`border-b border-[#E2DDD8] ${r.absent ? "bg-[#FDF3F1]" : ""}`}>
                    <td className={`px-3 py-2 ${r.absent ? "font-semibold text-[#9A3A2D]" : "text-[#1F1D1B]"}`}>{r.last.employeeName ?? "—"}</td>
                    <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">{r.dept}</td>
                    <td className="px-3 py-2 text-[#6B7280] whitespace-nowrap">
                      {r.last.date ? `${Number(r.last.date.slice(8))} ${new Date(r.last.date).toLocaleString("en", { month: "short" })}` : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">{hhmm(r.last.clockIn)}</td>
                    <td className="px-3 py-2 font-mono">{hhmm(r.last.clockOut)}</td>
                    <td className="px-3 py-2 text-right font-mono">{h(r.working)}</td>
                    <td className="px-3 py-2 text-right font-mono">{h(r.prod)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${(r.nonProd ?? 0) > 90 ? "text-[#B5701A]" : "text-[#6B7280]"}`}>{h(r.nonProd)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: r.eff == null ? MUTED : r.eff >= 90 ? "#4F7C3A" : "#B5701A" }}>
                      {r.eff == null ? "—" : `${r.eff.toFixed(1)}%`}
                    </td>
                    {!perDay && <td className="px-3 py-2 text-right font-mono">{r.absent ? "—" : r.days}</td>}
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={r.absent ? { background: "#FBE7E3", color: "#9A3A2D" } : late ? { background: "#FBF0DC", color: "#9C6F1E" } : { background: "#EEF3E4", color: "#4F7C3A" }}
                      >
                        {r.absent ? "Not in" : late ? `Late ${late}m` : "On time"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {log.rows.length === 0 && (
                <tr><td colSpan={ncol} className="px-4 py-6 text-center text-[#6B7280]">No attendance recorded in this period.</td></tr>
              )}
            </tbody>
            {log.rows.length > 0 && (
              <tfoot>
                <tr className="font-mono font-semibold *:sticky *:bottom-0 *:z-10 *:bg-white *:shadow-[inset_0_2px_0_#E2DDD8]">
                  <td className="px-3 py-2" colSpan={5}>{perDay ? `Total (${log.days} days)` : "Listed rows"}</td>
                  <td className="px-3 py-2 text-right">{hrs(log.working)}</td>
                  <td className="px-3 py-2 text-right">{hrs(log.prod)}</td>
                  <td className="px-3 py-2 text-right">{hrs(log.nonProd)}</td>
                  <td className="px-3 py-2 text-right">{log.eff == null ? "—" : `${log.eff.toFixed(1)}%`}</td>
                  {!perDay && <td className="px-3 py-2 text-right">{log.days}</td>}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="px-3 py-2 text-[11px] text-[#6B7280]">
          "—" means no work-hour entry exists for that person on that day, so there is nothing to compute from.
        </p>
        </>
        )}
      </CardContent>
    </Card>
    {below?.(period)}
    </>
  );
}
