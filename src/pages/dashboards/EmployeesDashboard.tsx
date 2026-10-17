import { useMemo, useState } from "react";
import { useSeriesToggle } from "./use-series-toggle";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { formatCurrency } from "@/lib/utils";
import { useLabourCost } from "./use-labour-cost";
import { monthsOf, useProductionRevenue } from "./use-production-revenue";
import { dropIdleSundays } from "@/lib/idle-sundays";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceLogCard } from "./AttendanceLogCard";
import { DashModal } from "./DashModal";
import { deptName } from "./ops-floor-lib";
import type { EmployeeSlice } from "./EmployeesInsights";
import {
  BORDER, CARD_BG, CARD_BORDER, CHART_AXIS, CHART_GOLD, CHART_INK, GREEN, MUTED, RED, TEAL,
  fmtN, inPeriod, isOutsourced, periodLabel, shiftMonth, ymd, type Period, CC_TICK, CC_AXIS_LINE } from "./dashboard-shared-lib";

// ---------------------------------------------------------------------------
// Employees, merged dashboard (owner 2026-10-17). One page, no sub-tabs: "a
// dashboard should show me the problems straight away, not after I pick a
// person". Efficiency comes from the dashboard feed (production minutes ÷
// working minutes per worker per day); salary is the Labor Cost rule
// (src/lib/labor-day-cost.ts) over the logged working-hour entries, shown only
// to accounts that can read payroll.
//
// Window: the page picker's Day narrows everything below the chart to that
// day; otherwise the Latest day / 7 days / Whole period switch picks it.
//
// Per person = per FULL-TIME EQUIVALENT: worker-days ÷ working days in the
// window. A joiner, a leaver or an absent day counts by the days actually
// worked, so half a month of someone is half a person — dividing by "people
// who logged any hour" made a mid-month joiner a whole person and pulled the
// average down.
// ---------------------------------------------------------------------------

type FeedWorker = { id: string; empNo: string | null; name: string | null; dept: string | null; role: string | null; countsToHeadcount: boolean };
type Feed = {
  success?: boolean;
  meta?: { config?: { efficiencyTargetPct?: number } };
  employee?: EmployeeSlice & { workers: FeedWorker[] };
};

type Win = "day" | "7d" | "period";
const MIN_RANK_MIN = 60; // under an hour clocked in the window has no meaningful ratio

const hrs = (min: number) => `${(min / 60).toLocaleString("en-MY", { maximumFractionDigits: 1 })} h`;
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const eff = (prod: number, work: number) => (work > 0 ? (prod / work) * 100 : null);
const ratio = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const effColor = (v: number | null, target: number) => (v == null ? MUTED : v >= target ? GREEN : v >= target * 0.85 ? "#9C6F1E" : RED);
const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function Tile({ label, value, sub, color = "#1F1D1B", badge, badgeTone = "neutral", onClick }: {
  label: string; value: string; sub?: string; color?: string; badge?: string | null; badgeTone?: "good" | "bad" | "neutral"; onClick?: () => void;
}) {
  const tone = badgeTone === "good" ? "bg-[#EEF3E4] text-[#4F7C3A]" : badgeTone === "bad" ? "bg-[#FBE7E3] text-[#9A3A2D]" : "bg-[#F5F2ED] text-[#6B5C32]";
  const body = (
    <CardContent className="p-3">
      <p className="truncate text-xs text-[#6B7280]">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <p className="truncate text-2xl font-bold tabular-nums max-md:text-xl" style={{ color }}>{value}</p>
        {badge && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>{badge}</span>}
      </div>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-[#6B7280]">{sub}</p>}
    </CardContent>
  );
  return onClick ? (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>{body}</Card>
  ) : (
    <Card>{body}</Card>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${value === v ? "bg-[#6B5C32] text-white" : "bg-[#F5F2ED] text-[#5A5550] hover:bg-[#EAE5DC]"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function EmployeesDashboard({ period }: { period: Period }) {
  const { data, loading } = useCachedJson<Feed>("/api/dashboard/prototype");
  const { hasPermission } = usePermissions();
  const tHours = useSeriesToggle();
  const canSalary = hasPermission("payroll", "read");
  const employee = data?.employee;
  const target = data?.meta?.config?.efficiencyTargetPct ?? 100;
  const today = ymd(new Date());

  const workers = useMemo(() => employee?.workers ?? [], [employee]);
  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  // Headcount for present / not in: ACTIVE, not outsourced, and has clocked in
  // at least once — a login kept only for viewing (owner 2026-10-17: Chee "只是
  // 账号提供观看") never clocks and is not a worker who is absent.
  const clockers = useMemo(() => new Set((employee?.attendance ?? []).filter((r) => r.clockIn || r.clockOut).map((r) => r.employeeId)), [employee]);
  const roster = useMemo(() => workers.filter((w) => w.countsToHeadcount && !isOutsourced(w) && clockers.has(w.id)), [workers, clockers]);
  const outsourced = useMemo(() => new Set(workers.filter(isOutsourced).map((w) => w.id)), [workers]);

  // Per worker per day, the period's working / production minutes.
  const allDays = useMemo(() => [...(employee?.performance.byDay ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1)), [employee]);
  const days = useMemo(() => allDays.filter((d) => inPeriod(period, d.date)), [allDays, period]);
  const latest = useMemo(() => [...days].reverse().find((d) => d.workingMinutes > 0)?.date ?? days[days.length - 1]?.date ?? "", [days]);
  const range = useMemo(() => ({ from: days[0]?.date ?? "", to: days[days.length - 1]?.date ?? "" }), [days]);

  // ---- Window ---------------------------------------------------------------
  const [win, setWin] = useState<Win>("period");
  const [dept, setDept] = useState("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const dayMode = !!period.day;
  const anchor = period.day ?? latest;
  const effWin: Win = dayMode ? "day" : win;
  const winDates = useMemo(() => {
    if (!anchor) return new Set<string>();
    if (effWin === "day") return new Set([anchor]);
    if (effWin === "7d") {
      const lo = shiftDay(anchor, -6);
      return new Set(days.filter((d) => d.date >= lo && d.date <= anchor).map((d) => d.date));
    }
    return new Set(days.map((d) => d.date));
  }, [effWin, anchor, days]);
  const winLabel = effWin === "day" ? anchor : effWin === "7d" ? `7 days to ${anchor.slice(5)}` : `${periodLabel(period)}${period.mode === "monthly" && range.to ? ` · to ${range.to.slice(5)}` : ""}`;

  // ---- Salary + production revenue -------------------------------------------
  const { byWorkerDay: costByWorkerDay, ready: salaryReady } = useLabourCost(range.from, range.to, canSalary);
  const prevYm = anchor ? shiftMonth(anchor.slice(0, 7), -1) : "";
  const prevTo = prevYm ? ymd(new Date(Number(prevYm.slice(0, 4)), Number(prevYm.slice(5, 7)), 0)) : "";
  const { byWorkerDay: prevCost } = useLabourCost(prevYm ? `${prevYm}-01` : "", prevTo, canSalary);
  const revMonths = useMemo(() => [...new Set([...(prevYm ? [prevYm] : []), ...monthsOf(period, today)])].sort(), [prevYm, period, today]);
  const prodRev = useProductionRevenue(revMonths);
  // Department PROGRESSIVE revenue (owner 2026-10-17): each department earns
  // its minute-weighted slice of an order's price when its own job card
  // completes — the Labor Cost report's Category Revenue
  // (GET /api/working-hour-entries/production-revenue). Slices add up to the
  // order, so salary ÷ slice is that department's real labour share.
  // (Department Revenue — every department booking the full order — stays the
  // supply / demand balance view on Operations.)
  const winFrom = useMemo(() => [...winDates].sort()[0] ?? "", [winDates]);
  const winTo = useMemo(() => [...winDates].sort().pop() ?? "", [winDates]);
  const { data: progResp } = useCachedJson<{ data?: { byDeptCategory?: Record<string, number> } }>(
    winFrom ? `/api/working-hour-entries/production-revenue?from=${winFrom}&to=${winTo}` : null,
  );
  const progByDept = useMemo(() => {
    const m = new Map<string, { bf: number; sofa: number; other: number }>();
    for (const [k, v] of Object.entries(progResp?.data?.byDeptCategory ?? {})) {
      const [dept, cat] = k.split("|");
      const r = m.get(dept) ?? { bf: 0, sofa: 0, other: 0 };
      if (cat === "BEDFRAME") r.bf += v;
      else if (cat === "SOFA") r.sofa += v;
      else r.other += v;
      m.set(dept, r);
    }
    return m;
  }, [progResp]);

  // ---- Headline numbers over the window -------------------------------------
  const sumWindow = (has: (d: string) => boolean, cost: Map<string, number>) => {
    let work = 0, prod = 0, sen = 0, workerDays = 0, workingDays = 0, revenue = 0;
    for (const d of allDays) {
      if (!has(d.date)) continue;
      work += d.workingMinutes;
      prod += d.productionMinutes;
      let any = false;
      for (const x of d.workers ?? []) {
        sen += cost.get(`${x.workerId}|${d.date}`) ?? 0;
        if (x.workingMinutes > 0 && !outsourced.has(x.workerId)) { workerDays += 1; any = true; }
      }
      if (any) workingDays += 1;
    }
    for (const [d, v] of prodRev?.byDay ?? []) if (has(d)) revenue += v.total;
    const fte = workingDays ? workerDays / workingDays : 0;
    return { work, prod, sen, workerDays, workingDays, fte, revenue };
  };
  const totals = useMemo(() => sumWindow((d) => winDates.has(d), costByWorkerDay), [allDays, winDates, costByWorkerDay, prodRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => (prevYm ? sumWindow((d) => d.startsWith(prevYm), prevCost) : null), [allDays, prevYm, prevCost, prodRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const labourPct = ratio(totals.sen, totals.revenue);
  const prevLabourPct = prev && prev.sen > 0 ? ratio(prev.sen, prev.revenue) : null;
  const revPerFte = prodRev && totals.fte ? totals.revenue / totals.fte : null;
  // Compared per WORKER-DAY: a month to date against a whole last month is
  // only fair per day worked (half a month is half the revenue per person).
  const revPerDay = prodRev && totals.workerDays ? totals.revenue / totals.workerDays : null;
  const prevRevPerDay = prev && prev.workerDays && prev.revenue > 0 ? prev.revenue / prev.workerDays : null;
  const revChange = revPerDay != null && prevRevPerDay ? ((revPerDay - prevRevPerDay) / prevRevPerDay) * 100 : null;

  // Present / not in on the anchor day, from clock records (attendance), the
  // same source as the attendance log below — headcount workers only.
  const presence = useMemo(() => {
    const att = new Set((employee?.attendance ?? []).filter((r) => r.date === anchor).map((r) => r.employeeId));
    const absent = roster.filter((w) => !att.has(w.id));
    return { present: roster.length - absent.length, absent };
  }, [employee, anchor, roster]);

  // ---- Worker rows ------------------------------------------------------------
  type Row = { id: string; name: string; dept: string; work: number; prod: number; cost: number; daysWorked: number; byDay: { date: string; work: number; prod: number; cost: number }[] };
  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    for (const d of days) {
      if (!winDates.has(d.date)) continue;
      for (const x of d.workers ?? []) {
        const w = workerById.get(x.workerId);
        const wDept = w?.dept ?? "—";
        if (dept !== "ALL" && wDept !== dept) continue;
        const cost = costByWorkerDay.get(`${x.workerId}|${d.date}`) ?? 0;
        const r = m.get(x.workerId) ?? { id: x.workerId, name: w?.name ?? x.workerId, dept: wDept, work: 0, prod: 0, cost: 0, daysWorked: 0, byDay: [] };
        r.work += x.workingMinutes;
        r.prod += x.productionMinutes;
        r.cost += cost;
        if (x.workingMinutes > 0) r.daysWorked += 1;
        r.byDay.push({ date: d.date, work: x.workingMinutes, prod: x.productionMinutes, cost });
        m.set(x.workerId, r);
      }
    }
    return [...m.values()].filter((r) => r.work > 0).sort((a, b) => (eff(b.prod, b.work) ?? -1) - (eff(a.prod, a.work) ?? -1));
  }, [days, winDates, workerById, dept, costByWorkerDay]);
  // One ranking, split in halves (owner 2026-10-17: top 10 / bottom 10 /
  // every worker were the same people three times — "从上面 list 下来分一半").
  const ranked = rows.filter((r) => r.work >= MIN_RANK_MIN && !outsourced.has(r.id));
  const outsourcedRows = rows.filter((r) => outsourced.has(r.id));
  const half = Math.ceil(ranked.length / 2);
  const upper = ranked.slice(0, half);
  const lower = ranked.slice(half);
  const unranked = rows.filter((r) => r.work < MIN_RANK_MIN && !outsourced.has(r.id));
  const depts = useMemo(() => [...new Set(workers.map((w) => w.dept).filter((d): d is string => !!d))].sort(), [workers]);

  const deptRows = useMemo(() => {
    const m = new Map<string, { dept: string; people: Set<string>; work: number; prod: number; cost: number; bf: number; sofa: number }>();
    for (const d of days) {
      if (!winDates.has(d.date)) continue;
      for (const x of d.workers ?? []) {
        const key = workerById.get(x.workerId)?.dept ?? "—";
        const r = m.get(key) ?? { dept: key, people: new Set<string>(), work: 0, prod: 0, cost: 0, bf: 0, sofa: 0 };
        if (x.workingMinutes > 0 && !outsourced.has(x.workerId)) r.people.add(x.workerId);
        r.work += x.workingMinutes;
        r.prod += x.productionMinutes;
        r.cost += costByWorkerDay.get(`${x.workerId}|${d.date}`) ?? 0;
        m.set(key, r);
      }
    }
    for (const r of m.values()) {
      const pr = progByDept.get(r.dept);
      if (pr) { r.bf = pr.bf; r.sofa = pr.sofa + pr.other; }
    }
    return [...m.values()].filter((r) => r.work > 0).sort((a, b) => (eff(b.prod, b.work) ?? 0) - (eff(a.prod, a.work) ?? 0));
  }, [days, winDates, workerById, costByWorkerDay, progByDept, outsourced]);

  const chart = useMemo(
    () =>
      dropIdleSundays(
        days.map((d) => {
          let cost = 0;
          for (const x of d.workers ?? []) cost += costByWorkerDay.get(`${x.workerId}|${d.date}`) ?? 0;
          return { date: d.date, Working: Math.round((d.workingMinutes / 60) * 10) / 10, Production: Math.round((d.productionMinutes / 60) * 10) / 10, Efficiency: eff(d.productionMinutes, d.workingMinutes), cost };
        }),
        (r) => r.date,
        (r) => [r.Working, r.Production],
      ).map((r) => ({ ...r, m: r.date.slice(5), Efficiency: r.Efficiency == null ? null : Math.round(r.Efficiency * 10) / 10 })),
    [days, costByWorkerDay],
  );

  if (!employee) {
    return <Card><CardContent className="py-10 text-center text-sm text-[#6B7280]">{loading ? "Loading…" : "No employee data."}</CardContent></Card>;
  }
  const money = (sen: number | null) => (!canSalary ? "No access" : sen == null || !salaryReady ? "…" : formatCurrency(Math.round(sen)));
  const fteTxt = totals.fte ? totals.fte.toFixed(1) : "—";
  const openWorker = open ? rows.find((r) => r.id === open) ?? null : null;
  const dayLine = dayMode ? anchor.slice(5) : null;

  const rankTable = (list: Row[], start: number, title: string) => (
    <Card>
      <CardHeader className="pb-2"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-[#E2DDD8] text-left text-[10.5px] uppercase tracking-wide text-[#6B7280]">
              <th className="px-3 py-1.5">#</th><th className="px-3 py-1.5">Worker</th><th className="px-3 py-1.5">Dept</th><th className="px-3 py-1.5 text-right">Days</th><th className="px-3 py-1.5 text-right">Prod / Working</th><th className="px-3 py-1.5 text-right">Efficiency</th>{canSalary && <th className="px-3 py-1.5 text-right">Salary</th>}
            </tr></thead>
            <tbody>
              {list.map((r, i) => {
                const v = eff(r.prod, r.work);
                return (
                  <tr key={r.id} className="cursor-pointer border-b border-[#F0ECE6] hover:bg-[#FAF8F4]" onClick={() => setOpen(r.id)} title="Open this worker's days">
                    <td className="px-3 py-1.5 tabular-nums text-[#6B7280]">{start + i + 1}</td>
                    <td className="px-3 py-1.5 text-[#1F1D1B]">{r.name}</td>
                    <td className="px-3 py-1.5 text-[#6B7280]">{deptName(r.dept)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{fmtN(r.daysWorked)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.prod)} / {hrs(r.work)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: effColor(v, target) }}>{pct(v)}</td>
                    {canSalary && <td className="px-3 py-1.5 text-right tabular-nums">{money(r.cost)}</td>}
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={canSalary ? 7 : 6} className="px-3 py-5 text-center text-[#6B7280]">No one clocked an hour in this window.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label={`Present on ${anchor || "—"}`}
          value={`${fmtN(presence.present)} / ${fmtN(roster.length)}`}
          sub={presence.absent.length ? `${presence.absent.length} not in: ${presence.absent.map((w) => w.name).slice(0, 3).join(", ")}${presence.absent.length > 3 ? "…" : ""}` : "everyone clocked in"}
          color={presence.absent.length ? "#9A3A2D" : "#1F1D1B"}
          onClick={() => document.getElementById("emp-attendance")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
        <Tile label={`Salary · ${winLabel}`} value={money(totals.sen)} sub="logged hours at the Labor Cost rate" color={CHART_INK} />
        <Tile
          label="Avg labour cost / person"
          value={money(totals.fte ? totals.sen / totals.fte : 0)}
          badge={canSalary && salaryReady && labourPct != null ? `${labourPct.toFixed(1)}% of revenue` : null}
          badgeTone={labourPct != null && prevLabourPct != null ? (labourPct <= prevLabourPct ? "good" : "bad") : "neutral"}
          sub={`÷ ${fteTxt} full-time people${canSalary && prevLabourPct != null ? ` · last month ${prevLabourPct.toFixed(1)}% of revenue` : ""}`}
        />
        <Tile
          label="Avg production revenue / person"
          value={revPerFte == null ? "…" : formatCurrency(Math.round(revPerFte))}
          badge={revChange == null || effWin === "day" ? null : `${revChange >= 0 ? "▲" : "▼"} ${Math.abs(revChange).toFixed(1)}% per day vs last month`}
          badgeTone={revChange == null ? "neutral" : revChange >= 0 ? "good" : "bad"}
          sub={`Upholstery output ÷ ${fteTxt} full-time people · ${revPerDay == null ? "…" : formatCurrency(Math.round(revPerDay))} per worker-day${prevRevPerDay ? ` (last month ${formatCurrency(Math.round(prevRevPerDay))})` : ""}`}
          color={GREEN}
        />
        <Tile label="Overall efficiency" value={pct(eff(totals.prod, totals.work))} sub={`${hrs(totals.prod)} prod / ${hrs(totals.work)} working`} color={effColor(eff(totals.prod, totals.work), target)} />
      </div>
      <p className="-mt-1 text-[11px] text-[#9CA3AF]">
        {winLabel} · full-time people = worker-days ÷ working days ({fmtN(totals.workerDays)} ÷ {fmtN(totals.workingDays)}), so a joiner, a leaver or a day off counts by the days actually worked.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Working vs production hours · efficiency · {periodLabel(period)}</CardTitle>
          <p className="text-xs text-[#9CA3AF]">Shaded = hours clocked · bar = production hours earned · line = efficiency (dots green at target, amber close, red well under) · hover a day for its salary · idle Sundays left out</p>
        </CardHeader>
        <CardContent>
          <div className="select-none [&_*]:outline-none" style={{ width: "100%", height: 280 }}>
            {chart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">No hours in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_AXIS} strokeOpacity={0.25} />
                  <XAxis dataKey="m" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} />
                  <YAxis yAxisId="h" tick={CC_TICK} axisLine={false} tickLine={false} width={40} />
                  <YAxis yAxisId="p" orientation="right" domain={[0, (max: number) => Math.max(120, Math.ceil(max / 10) * 10)]} tickFormatter={(v) => `${v}%`} tick={CC_TICK} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 8, fontSize: 12 }}
                    formatter={(v, n) => (n === "Efficiency" ? [`${v}%`, n] : [`${v} h`, n])}
                    labelFormatter={(l, p) => {
                      const c = (p?.[0]?.payload as { cost?: number } | undefined)?.cost ?? 0;
                      return canSalary && salaryReady ? `${l} · salary ${formatCurrency(c)}` : String(l);
                    }}
                  />
                  <Legend {...tHours.legend} />
                  {/* Working = the shaded band (hours clocked); Production = the
                      bar inside it (standard hours earned). A bar above the band
                      = beat the standard; below = time not producing. Efficiency
                      on the right axis, against the target line. */}
                  <Area yAxisId="h" type="monotone" dataKey="Working" hide={tHours.hide("Working")} stroke="#B9AE9F" strokeWidth={1.5} fill="#E9E3DA" fillOpacity={0.9} isAnimationActive={false} />
                  <Bar yAxisId="h" dataKey="Production" hide={tHours.hide("Production")} fill={CHART_INK} radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                  <ReferenceLine yAxisId="p" y={target} stroke={GREEN} strokeDasharray="4 3" strokeOpacity={0.7} label={{ value: `target ${target}%`, position: "insideTopRight", fill: GREEN, fontSize: 10 }} />
                  <Line
                    yAxisId="p"
                    type="monotone"
                    dataKey="Efficiency"
                    hide={tHours.hide("Efficiency")}
                    stroke={CHART_GOLD}
                    strokeWidth={2.5}
                    isAnimationActive={false}
                    connectNulls
                    dot={(props: { cx?: number; cy?: number; payload?: { Efficiency: number | null }; index?: number }) => {
                      const v = props.payload?.Efficiency;
                      if (props.cx == null || props.cy == null || v == null) return <g key={props.index} />;
                      return <circle key={props.index} cx={props.cx} cy={props.cy} r={3.5} fill="#FFFFFF" stroke={v >= target ? GREEN : v >= target * 0.85 ? "#9C6F1E" : RED} strokeWidth={2} />;
                    }}
                  />
                  {dayLine && <ReferenceLine yAxisId="h" x={dayLine} stroke="#9C6F1E" strokeWidth={2} />}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1F1D1B]">Workers &amp; departments · {winLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          {dayMode ? (
            <span className="text-xs text-[#9CA3AF]">Showing the day picked at the top — pick Month there for 7 days / whole period</span>
          ) : (
            <Seg value={win} options={[["day", "Latest day"], ["7d", "7 days"], ["period", "Whole period"]] as const} onChange={setWin} />
          )}
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-md border border-[#E2DDD8] bg-white px-2 py-1 text-xs text-[#1F1D1B]" aria-label="Department">
            <option value="ALL">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{deptName(d)}</option>)}
          </select>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Department efficiency · {winLabel}</CardTitle>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">Output = the department's progressive revenue: its minute-weighted share of each order's price, earned when its own job card completes (Labor Cost report's Category Revenue){canSalary ? " · labour % = salary ÷ that share" : ""}</p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E2DDD8] text-left text-[10.5px] uppercase tracking-wide text-[#6B7280]">
                <th className="px-3 py-1.5">Department</th><th className="px-3 py-1.5 text-right">People</th><th className="px-3 py-1.5 text-right">Working</th><th className="px-3 py-1.5 text-right">Production</th><th className="px-3 py-1.5 text-right">Efficiency</th>
                <th className="px-3 py-1.5 text-right">Output · Bedframe</th><th className="px-3 py-1.5 text-right">Output · Sofa</th>
                {canSalary && <><th className="px-3 py-1.5 text-right">Salary</th><th className="px-3 py-1.5 text-right">Labour %</th></>}
              </tr></thead>
              <tbody>
                {deptRows.map((r) => {
                  const v = eff(r.prod, r.work);
                  const lp = ratio(r.cost, r.bf + r.sofa);
                  return (
                    <tr key={r.dept} className="border-b border-[#F0ECE6]">
                      <td className="px-3 py-1.5 text-[#1F1D1B]">{deptName(r.dept)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.people.size)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.work)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.prod)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: effColor(v, target) }}>{pct(v)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: CHART_INK }}>{progResp ? formatCurrency(Math.round(r.bf / 100) * 100) : "…"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: TEAL }}>{progResp ? formatCurrency(Math.round(r.sofa / 100) * 100) : "…"}</td>
                      {canSalary && <>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(r.cost)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#6B5C32]">{salaryReady && progResp ? pct(lp) : "…"}</td>
                      </>}
                    </tr>
                  );
                })}
                {deptRows.length === 0 && <tr><td colSpan={canSalary ? 9 : 7} className="px-3 py-5 text-center text-[#6B7280]">No hours in this window.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {rankTable(upper, 0, `Upper half · ${upper.length} workers`)}
        {rankTable(lower, half, `Lower half · ${lower.length} workers · needs attention`)}
      </div>
      <p className="-mt-1 text-[11px] text-[#9CA3AF]">
        Ranked by efficiency over {winLabel}; click a worker for each day's hours{canSalary ? ", efficiency and salary" : " and efficiency"}.
        {unranked.length > 0 && ` ${unranked.length} with under an hour clocked are not ranked.`}
        {outsourcedRows.length > 0 && ` Outsourced, not ranked or counted as people: ${outsourcedRows.map((r) => r.name).join(", ")}.`}
      </p>

      {/* Attendance log: opens on the picked day (or the latest day with hours);
          not in first, late second, on time last. */}
      <div id="emp-attendance" className="scroll-mt-48">
        <AttendanceLogCard employee={employee} period={anchor ? { ...period, day: anchor } : period} />
      </div>
      <p className="text-[11px]" style={{ color: MUTED, borderColor: BORDER }}>
        Salary = logged hours priced by the Labor Cost rule (regular hours at salary ÷ the month's working days ÷ hours per day; OT by day type), so it matches the Labor Cost tab. <span style={{ color: TEAL }}>Efficiency</span> = production minutes ÷ working minutes.
      </p>

      {openWorker && (
        <DashModal title={`${openWorker.name} · ${deptName(openWorker.dept)}`} subtitle={`${winLabel} · ${fmtN(openWorker.daysWorked)} days · efficiency ${pct(eff(openWorker.prod, openWorker.work))}`} onClose={() => setOpen(null)}>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]">
                <th className="py-1.5">Date</th><th className="py-1.5 text-right">Working</th><th className="py-1.5 text-right">Production</th><th className="py-1.5 text-right">Efficiency</th>{canSalary && <th className="py-1.5 text-right">Salary</th>}
              </tr></thead>
              <tbody>
                {openWorker.byDay.filter((d) => d.work > 0).map((d) => {
                  const dv = eff(d.prod, d.work);
                  return (
                    <tr key={d.date} className="border-b border-[#F0ECE6]">
                      <td className="py-1.5 text-[#1F1D1B]">{d.date}</td>
                      <td className="py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(d.work)}</td>
                      <td className="py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(d.prod)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums" style={{ color: effColor(dv, target) }}>{pct(dv)}</td>
                      {canSalary && <td className="py-1.5 text-right tabular-nums">{money(d.cost)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DashModal>
      )}
    </div>
  );
}
