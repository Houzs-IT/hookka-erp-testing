import { Fragment, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { formatCurrency } from "@/lib/utils";
import { countElapsedWorkingDays } from "@/lib/labor-engine";
import { workerDayEntryCostsSen, type CostWorker } from "@/lib/labor-day-cost";
import { dropIdleSundays } from "@/lib/idle-sundays";
import type { PayRuleVersion } from "@/lib/pay-rules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AttendanceLogCard } from "./AttendanceLogCard";
import type { EmployeeSlice } from "./EmployeesInsights";
import type { RevenueSplitResp } from "../dashboard-b/revenue-split";
import {
  BORDER, CARD_BG, CARD_BORDER, CHART_AXIS, CHART_GOLD, CHART_INK, GREEN, MUTED, RED, TEAL,
  fmtN, inPeriod, periodLabel, widgetPeriod, type Period,
} from "./dashboard-shared-lib";

// ---------------------------------------------------------------------------
// Employees, merged dashboard (owner 2026-10-17). One page, no sub-tabs: "a
// dashboard should show me the problems straight away, not after I pick a
// person". Efficiency comes from the dashboard feed (production minutes ÷
// working minutes per worker per day); salary is the Labor Cost rule
// (src/lib/labor-day-cost.ts) over the logged working-hour entries, shown only
// to accounts that can read payroll. The efficiency warning audit is gone: the
// Bottom 10 shows the same people.
// ---------------------------------------------------------------------------

type FeedWorker = { id: string; empNo: string | null; name: string | null; dept: string | null; role: string | null; countsToHeadcount: boolean };
type Feed = {
  success?: boolean;
  meta?: { config?: { efficiencyTargetPct?: number } };
  employee?: EmployeeSlice & { workers: FeedWorker[] };
};
type Entry = { workerId: string; date: string; hours: number | string; departmentCode: string };
type SalaryWorker = CostWorker & { id: string };

type Win = "day" | "7d" | "period";
const MIN_RANK_MIN = 60; // under an hour clocked in the window has no meaningful ratio

const hrs = (min: number) => `${(min / 60).toLocaleString("en-MY", { maximumFractionDigits: 1 })} h`;
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const eff = (prod: number, work: number) => (work > 0 ? (prod / work) * 100 : null);
const effColor = (v: number | null, target: number) => (v == null ? MUTED : v >= target ? GREEN : v >= target * 0.85 ? "#9C6F1E" : RED);
const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function Tile({ label, value, sub, color = "#1F1D1B" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="truncate text-xs text-[#6B7280]">{label}</p>
        <p className="mt-1 truncate text-2xl font-bold tabular-nums max-md:text-xl" style={{ color }}>{value}</p>
        {sub && <p className="mt-0.5 truncate text-[11px] text-[#6B7280]">{sub}</p>}
      </CardContent>
    </Card>
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
  const canSalary = hasPermission("payroll", "read");
  const employee = data?.employee;
  const target = data?.meta?.config?.efficiencyTargetPct ?? 100;

  const workers = useMemo(() => employee?.workers ?? [], [employee]);
  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  const roster = useMemo(() => workers.filter((w) => w.countsToHeadcount).length, [workers]);

  // Per worker per day, the period's working / production minutes.
  const days = useMemo(
    () => (employee?.performance.byDay ?? []).filter((d) => inPeriod(period, d.date)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [employee, period],
  );
  const latest = useMemo(() => [...days].reverse().find((d) => d.workingMinutes > 0)?.date ?? days[days.length - 1]?.date ?? "", [days]);
  const range = useMemo(() => ({ from: days[0]?.date ?? "", to: days[days.length - 1]?.date ?? "" }), [days]);

  // ---- Salary: the Labor Cost rule, per worker per day ---------------------
  const salaryMonth = range.to.slice(0, 7);
  const { data: workersResp } = useCachedJson<{ data?: SalaryWorker[] }>(canSalary ? "/api/workers" : null);
  const { data: entriesResp } = useCachedJson<{ success?: boolean; data?: Entry[] }>(
    canSalary && range.from ? `/api/working-hour-entries?from=${range.from}&to=${range.to}` : null,
  );
  const { data: effResp } = useCachedJson<{ data?: Record<string, number> }>(canSalary && salaryMonth ? `/api/workers/salary/effective?period=${salaryMonth}` : null);
  const { data: holResp } = useCachedJson<{ data?: string[] }>(canSalary ? "/api/kv-config/public_holidays" : null);
  const { data: rulesResp } = useCachedJson<{ data?: { versions?: PayRuleVersion[] } }>(canSalary ? "/api/pay-rules" : null);
  const costByWorkerDay = useMemo(() => {
    const out = new Map<string, number>();
    const ws = new Map((workersResp?.data ?? []).map((w) => [w.id, w]));
    const entries = entriesResp?.data ?? [];
    if (!canSalary || ws.size === 0 || entries.length === 0) return out;
    const holidays = Array.isArray(holResp?.data) ? holResp!.data! : [];
    const versions = rulesResp?.data?.versions ?? [];
    const effSal = effResp?.data ?? {};
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = `${e.workerId}|${e.date}`;
      const g = groups.get(k);
      if (g) g.push(e);
      else groups.set(k, [e]);
    }
    const workDaysByMonth = new Map<string, number>();
    for (const [k, segs] of groups) {
      const [wid, date] = k.split("|");
      const w = ws.get(wid);
      if (!w) continue;
      const ym = date.slice(0, 7);
      let wd = workDaysByMonth.get(ym);
      if (wd == null) {
        const [y, m] = ym.split("-").map(Number);
        wd = Math.max(1, countElapsedWorkingDays(y, m, new Date(y, m, 0).getDate(), holidays));
        workDaysByMonth.set(ym, wd);
      }
      const costs = workerDayEntryCostsSen({
        worker: w,
        effSalarySen: Number(effSal[wid]) || w.basicSalarySen,
        date,
        entryHours: segs.map((s) => Number(s.hours) || 0),
        actualWorkingDays: wd,
        holidays,
        payRuleVersions: versions,
      });
      out.set(k, Math.round(costs.reduce((a, b) => a + b, 0)));
    }
    return out;
  }, [canSalary, workersResp, entriesResp, effResp, holResp, rulesResp]);
  const salaryReady = canSalary && costByWorkerDay.size > 0;

  // Production revenue (the Upholstery department row of Department Revenue).
  const { data: splitResp } = useCachedJson<RevenueSplitResp & { success?: boolean }>(`/api/dashboard/overview/revenue-split?period=${widgetPeriod(period)}`);
  const productionRevenueSen = splitResp?.departments?.find((d) => d.code === "UPHOLSTERY")?.period.total ?? null;

  // ---- Window for the worker tables ----------------------------------------
  const [win, setWin] = useState<Win>("period");
  const [dept, setDept] = useState("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const winDates = useMemo(() => {
    if (!latest) return new Set<string>();
    if (win === "day") return new Set([latest]);
    if (win === "7d") {
      const lo = shiftDay(latest, -6);
      return new Set(days.filter((d) => d.date >= lo && d.date <= latest).map((d) => d.date));
    }
    return new Set(days.map((d) => d.date));
  }, [win, latest, days]);

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
  const ranked = rows.filter((r) => r.work >= MIN_RANK_MIN);
  const top10 = ranked.slice(0, 10);
  const bottom10 = [...ranked].reverse().slice(0, 10);
  const depts = useMemo(() => [...new Set(workers.map((w) => w.dept).filter((d): d is string => !!d))].sort(), [workers]);

  const deptRows = useMemo(() => {
    const m = new Map<string, { dept: string; people: Set<string>; work: number; prod: number; cost: number }>();
    for (const d of days) {
      if (!winDates.has(d.date)) continue;
      for (const x of d.workers ?? []) {
        const key = workerById.get(x.workerId)?.dept ?? "—";
        const r = m.get(key) ?? { dept: key, people: new Set<string>(), work: 0, prod: 0, cost: 0 };
        if (x.workingMinutes > 0) r.people.add(x.workerId);
        r.work += x.workingMinutes;
        r.prod += x.productionMinutes;
        r.cost += costByWorkerDay.get(`${x.workerId}|${d.date}`) ?? 0;
        m.set(key, r);
      }
    }
    return [...m.values()].filter((r) => r.work > 0).sort((a, b) => (eff(b.prod, b.work) ?? 0) - (eff(a.prod, a.work) ?? 0));
  }, [days, winDates, workerById, costByWorkerDay]);

  // ---- Period headline numbers ---------------------------------------------
  const totals = useMemo(() => {
    let work = 0, prod = 0, cost = 0;
    const paid = new Set<string>();
    const producers = new Set<string>();
    for (const d of days) {
      work += d.workingMinutes;
      prod += d.productionMinutes;
      for (const x of d.workers ?? []) {
        const c = costByWorkerDay.get(`${x.workerId}|${d.date}`) ?? 0;
        cost += c;
        if (c > 0 || x.workingMinutes > 0) paid.add(x.workerId);
        if (x.productionMinutes > 0) producers.add(x.workerId);
      }
    }
    const today = days.find((d) => d.date === latest);
    const workingToday = (today?.workers ?? []).filter((x) => x.workingMinutes > 0).length;
    return { work, prod, cost, paid: paid.size, producers: producers.size, workingToday };
  }, [days, costByWorkerDay, latest]);

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
  const money = (sen: number | null) => (!canSalary ? "No access" : sen == null || !salaryReady ? "…" : formatCurrency(sen));
  const winLabel = win === "day" ? (latest ? `${latest}` : "latest day") : win === "7d" ? "last 7 days" : periodLabel(period);
  const rankTable = (list: Row[], title: string, tone: string) => (
    <Card>
      <CardHeader className="pb-2"><CardTitle>{title} · {winLabel}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="border-b border-[#E2DDD8] text-left text-[10.5px] uppercase tracking-wide text-[#6B7280]">
              <th className="px-3 py-1.5">#</th><th className="px-3 py-1.5">Worker</th><th className="px-3 py-1.5">Dept</th><th className="px-3 py-1.5 text-right">Prod / Working</th><th className="px-3 py-1.5 text-right">Efficiency</th>
            </tr></thead>
            <tbody>
              {list.map((r, i) => {
                const v = eff(r.prod, r.work);
                return (
                  <tr key={r.id} className="border-b border-[#F0ECE6]">
                    <td className="px-3 py-1.5 tabular-nums text-[#6B7280]">{i + 1}</td>
                    <td className="px-3 py-1.5 text-[#1F1D1B]">{r.name}</td>
                    <td className="px-3 py-1.5 text-[#6B7280]">{r.dept}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.prod)} / {hrs(r.work)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: tone === "top" ? GREEN : effColor(v, target) }}>{pct(v)}</td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={5} className="px-3 py-5 text-center text-[#6B7280]">No one clocked an hour in this window.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label={`Working now · ${latest || "—"}`} value={`${fmtN(totals.workingToday)} / ${fmtN(roster)}`} sub="clocked hours that day / headcount" />
        <Tile label={`Overall salary · ${periodLabel(period)}`} value={money(totals.cost)} sub="logged hours at the Labor Cost rate" color={CHART_INK} />
        <Tile label="Avg labour cost / person" value={money(totals.paid ? Math.round(totals.cost / totals.paid) : 0)} sub={`${fmtN(totals.paid)} people logged hours`} />
        <Tile label="Avg production revenue / person" value={productionRevenueSen == null ? "…" : formatCurrency(totals.producers ? Math.round(productionRevenueSen / totals.producers) : 0)} sub={`Upholstery output ÷ ${fmtN(totals.producers)} producers`} color={GREEN} />
        <Tile label="Overall efficiency" value={pct(eff(totals.prod, totals.work))} sub={`${hrs(totals.prod)} prod / ${hrs(totals.work)} working`} color={effColor(eff(totals.prod, totals.work), target)} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Working vs production hours · efficiency · {periodLabel(period)}</CardTitle>
          <p className="text-xs text-[#6B7280]">Bars: hours per day. Line: production ÷ working (target {target}%). Hover a day for its salary. Idle Sundays left out.</p>
        </CardHeader>
        <CardContent>
          <div className="select-none [&_*]:outline-none" style={{ width: "100%", height: 280 }}>
            {chart.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-[#6B7280]">No hours in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART_AXIS} strokeOpacity={0.25} />
                  <XAxis dataKey="m" tick={{ fontSize: 10, fill: CHART_AXIS }} axisLine={{ stroke: CARD_BORDER }} tickLine={false} />
                  <YAxis yAxisId="h" tick={{ fontSize: 10, fill: CHART_AXIS }} axisLine={false} tickLine={false} width={40} />
                  <YAxis yAxisId="p" orientation="right" domain={[0, (max: number) => Math.max(120, Math.ceil(max / 10) * 10)]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: CHART_AXIS }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 8, fontSize: 12 }}
                    formatter={(v, n) => (n === "Efficiency" ? [`${v}%`, n] : [`${v} h`, n])}
                    labelFormatter={(l, p) => {
                      const c = (p?.[0]?.payload as { cost?: number } | undefined)?.cost ?? 0;
                      return canSalary && salaryReady ? `${l} · salary ${formatCurrency(c)}` : String(l);
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="h" dataKey="Working" fill="#D9D2CA" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Bar yAxisId="h" dataKey="Production" fill={CHART_INK} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Line yAxisId="p" type="monotone" dataKey="Efficiency" stroke={CHART_GOLD} strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1F1D1B]">Workers &amp; departments · {winLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={win} options={[["day", "Day"], ["7d", "7 days"], ["period", "Whole period"]] as const} onChange={setWin} />
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-md border border-[#E2DDD8] bg-white px-2 py-1 text-xs text-[#1F1D1B]" aria-label="Department">
            <option value="ALL">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Department efficiency · {winLabel}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-[#E2DDD8] text-left text-[10.5px] uppercase tracking-wide text-[#6B7280]">
                <th className="px-3 py-1.5">Department</th><th className="px-3 py-1.5 text-right">People</th><th className="px-3 py-1.5 text-right">Working</th><th className="px-3 py-1.5 text-right">Production</th><th className="px-3 py-1.5 text-right">Efficiency</th><th className="px-3 py-1.5 text-right">Salary</th>
              </tr></thead>
              <tbody>
                {deptRows.map((r) => {
                  const v = eff(r.prod, r.work);
                  return (
                    <tr key={r.dept} className="border-b border-[#F0ECE6]">
                      <td className="px-3 py-1.5 text-[#1F1D1B]">{r.dept}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.people.size)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.work)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.prod)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: effColor(v, target) }}>{pct(v)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(r.cost)}</td>
                    </tr>
                  );
                })}
                {deptRows.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-[#6B7280]">No hours in this window.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {rankTable(top10, "Top 10 performers", "top")}
        {rankTable(bottom10, "Bottom 10 · needs attention", "bottom")}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Every worker · {winLabel}</CardTitle>
          <p className="text-xs text-[#6B7280]">Click a worker for each day's hours, efficiency and salary.</p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto" style={{ maxHeight: 480, overflowY: "auto" }}>
            <table className="w-full text-[12.5px]">
              <thead><tr className="sticky top-0 border-b border-[#E2DDD8] bg-white text-left text-[10.5px] uppercase tracking-wide text-[#6B7280]">
                <th className="px-3 py-1.5">Worker</th><th className="px-3 py-1.5">Dept</th><th className="px-3 py-1.5 text-right">Days</th><th className="px-3 py-1.5 text-right">Working</th><th className="px-3 py-1.5 text-right">Production</th><th className="px-3 py-1.5 text-right">Efficiency</th><th className="px-3 py-1.5 text-right">Salary</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const v = eff(r.prod, r.work);
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr className="cursor-pointer border-b border-[#F0ECE6] hover:bg-[#FAF8F4]" onClick={() => setOpen(isOpen ? null : r.id)}>
                        <td className="px-3 py-1.5 text-[#1F1D1B]">{isOpen ? "▾" : "▸"} {r.name}</td>
                        <td className="px-3 py-1.5 text-[#6B7280]">{r.dept}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.daysWorked)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.work)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{hrs(r.prod)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: effColor(v, target) }}>{pct(v)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(r.cost)}</td>
                      </tr>
                      {isOpen && r.byDay.filter((d) => d.work > 0).map((d) => {
                        const dv = eff(d.prod, d.work);
                        return (
                          <tr key={d.date} className="border-b border-[#F7F4EF] bg-[#FAF8F4] text-[12px]">
                            <td className="py-1 pl-8 pr-3 text-[#6B7280]" colSpan={3}>{d.date}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-[#6B7280]">{hrs(d.work)}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-[#6B7280]">{hrs(d.prod)}</td>
                            <td className="px-3 py-1 text-right tabular-nums" style={{ color: effColor(dv, target) }}>{pct(dv)}</td>
                            <td className="px-3 py-1 text-right tabular-nums">{money(d.cost)}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-5 text-center text-[#6B7280]">No hours in this window.</td></tr>}
              </tbody>
            </table>
          </div>
          {!canSalary && <p className="px-3 pb-3 pt-2 text-[11px]" style={{ color: MUTED }}>Salary figures need payroll access.</p>}
        </CardContent>
      </Card>

      {/* Attendance log: opens on the latest day that has hours (today may have none yet). */}
      <AttendanceLogCard employee={employee} period={latest ? { ...period, day: latest } : period} />
      <p className="text-[11px]" style={{ color: MUTED, borderColor: BORDER }}>
        Salary = logged hours priced by the Labor Cost rule (regular hours at salary ÷ the month's working days ÷ hours per day; OT by day type), so it matches the Labor Cost tab. <span style={{ color: TEAL }}>Efficiency</span> = production minutes ÷ working minutes.
      </p>
    </div>
  );
}
