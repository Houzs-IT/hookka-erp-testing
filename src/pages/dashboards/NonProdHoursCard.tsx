import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dropIdleSundays } from "@/lib/idle-sundays";
import { useSeriesToggle } from "./use-series-toggle";
import { CC_AXIS_LINE, CC_TICK, fmtN } from "./dashboard-shared-lib";
import { DEPT_FLOOR, deptName } from "./ops-floor-lib";

// ---------------------------------------------------------------------------
// Non-production hours (owner 2026-10-17: "能看到每一天 non prod hours, 然后每个
// 部门 — 我担心很多人走后门"). Non-production = time clocked but logged to a
// non-production department (R&D, warehousing, repair, shortfall …): the feed's
// all-department clocked minutes minus its production-department minutes, per
// worker per day — the same "Non-prod hours" the attendance log shows. Where
// the hours were logged comes from the hour entries (payroll access only).
// ---------------------------------------------------------------------------
type DayW = { workerId: string; workingMinutes: number; productionMinutes: number; allDeptMinutes?: number };
type Day = { date: string; workers?: DayW[] };
type Entry = { workerId: string; date: string; hours: number | string; departmentCode?: string | null };

const NAMES: Record<string, string> = { WAREHOUSING: "Warehousing", R_AND_D: "R&D", REPAIR: "Repair", PRODUCTION_SHORTFALL: "Production shortfall" };
const label = (c: string) => NAMES[c] ?? deptName(c);
const h1 = (min: number) => `${(min / 60).toLocaleString("en-MY", { maximumFractionDigits: 1 })} h`;

export function NonProdHoursCard({ days, winDates, winLabel, workerById, entries }: {
  days: Day[];
  winDates: Set<string>;
  winLabel: string;
  workerById: Map<string, { name: string | null; dept: string | null }>;
  entries: Entry[];
}) {
  const t = useSeriesToggle();
  const [view, setView] = useState<"dept" | "people">("people");
  const floor = useMemo(() => new Set<string>(DEPT_FLOOR.map(([c]) => c as string)), []);
  const non = (x: DayW) => Math.max(0, (x.allDeptMinutes ?? x.workingMinutes) - x.workingMinutes);

  const chart = useMemo(
    () =>
      dropIdleSundays(
        days.map((d) => {
          let n = 0;
          let all = 0;
          for (const x of d.workers ?? []) { n += non(x); all += x.allDeptMinutes ?? x.workingMinutes; }
          return { date: d.date, m: d.date.slice(5), "Non-production hours": Math.round((n / 60) * 10) / 10, "% of clocked": all > 0 ? Math.round((n / all) * 1000) / 10 : null };
        }),
        (r) => r.date,
        (r) => [r["Non-production hours"]],
      ),
    [days],
  );

  // Where non-production hours were logged, per worker (entry departments
  // outside the production floor).
  const loggedUnder = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const e of entries) {
      if (!winDates.has(e.date) || !e.departmentCode || floor.has(e.departmentCode)) continue;
      const mm = m.get(e.workerId) ?? new Map<string, number>();
      mm.set(e.departmentCode, (mm.get(e.departmentCode) ?? 0) + (Number(e.hours) || 0));
      m.set(e.workerId, mm);
    }
    return m;
  }, [entries, winDates, floor]);

  const { people, depts, total, clocked } = useMemo(() => {
    const p = new Map<string, { id: string; non: number; all: number; days: number }>();
    for (const d of days) {
      if (!winDates.has(d.date)) continue;
      for (const x of d.workers ?? []) {
        const r = p.get(x.workerId) ?? { id: x.workerId, non: 0, all: 0, days: 0 };
        const n = non(x);
        r.non += n;
        r.all += x.allDeptMinutes ?? x.workingMinutes;
        if (n > 0) r.days += 1;
        p.set(x.workerId, r);
      }
    }
    const list = [...p.values()];
    const dm = new Map<string, { dept: string; non: number; all: number; people: number; top: { id: string; non: number } | null }>();
    for (const r of list) {
      const dep = workerById.get(r.id)?.dept ?? "—";
      const e = dm.get(dep) ?? { dept: dep, non: 0, all: 0, people: 0, top: null };
      e.non += r.non;
      e.all += r.all;
      if (r.non > 0) e.people += 1;
      if (!e.top || r.non > e.top.non) e.top = { id: r.id, non: r.non };
      dm.set(dep, e);
    }
    return {
      people: list.filter((r) => r.non > 0).sort((a, b) => b.non - a.non),
      depts: [...dm.values()].filter((d) => d.all > 0).sort((a, b) => b.non - a.non),
      total: list.reduce((a, r) => a + r.non, 0),
      clocked: list.reduce((a, r) => a + r.all, 0),
    };
  }, [days, winDates, workerById]);

  const pctOf = (n: number, all: number) => (all > 0 ? `${((n / all) * 100).toFixed(1)}%` : "—");
  const name = (id: string) => workerById.get(id)?.name ?? id;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Non-production hours · {winLabel}</CardTitle>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            Clocked but logged outside the production departments (R&amp;D, warehousing, repair …) ·{" "}
            <b className="text-[#9A3A2D]">{h1(total)}</b> = {pctOf(total, clocked)} of {h1(clocked)} clocked
          </p>
        </div>
        <div className="flex gap-1">
          {(["people", "dept"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${view === v ? "bg-[#6B5C32] text-white" : "bg-[#F5F2ED] text-[#5A5550] hover:bg-[#EAE5DC]"}`}>
              {v === "people" ? "By person" : "By department"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="select-none [&_*]:outline-none" style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#F0ECE6" />
              <XAxis dataKey="m" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
              <YAxis yAxisId="h" tick={CC_TICK} axisLine={false} tickLine={false} width={32} />
              <YAxis yAxisId="p" orientation="right" tick={CC_TICK} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E2DDD8", borderRadius: 8, fontSize: 12 }} formatter={(v, n) => (n === "% of clocked" ? [`${v}%`, n] : [`${v} h`, n])} />
              <Legend {...t.legend} />
              <Bar yAxisId="h" dataKey="Non-production hours" hide={t.hide("Non-production hours")} fill="#C2410C" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Line yAxisId="p" type="monotone" dataKey="% of clocked" hide={t.hide("% of clocked")} stroke="#6B5C32" strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-x-auto" style={{ maxHeight: 360, overflowY: "auto" }}>
          {view === "people" ? (
            <table className="w-full text-[12.5px]">
              <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#6B7280] shadow-[inset_0_-1px_0_#E2DDD8]">
                <th className="px-3 py-1.5">#</th><th className="px-3 py-1.5">Worker</th><th className="px-3 py-1.5">Dept</th><th className="px-3 py-1.5 text-right">Non-prod</th><th className="px-3 py-1.5 text-right">% of clocked</th><th className="px-3 py-1.5 text-right">Days</th><th className="px-3 py-1.5">Logged under</th>
              </tr></thead>
              <tbody>
                {people.map((r, i) => {
                  const share = r.all > 0 ? r.non / r.all : 0;
                  const under = [...(loggedUnder.get(r.id) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).map(([c, hh]) => `${label(c)} ${hh.toFixed(1)}h`).join(" · ");
                  return (
                    <tr key={r.id} className={`border-b border-[#F0ECE6] ${share >= 0.2 ? "bg-[#FDF3F1]" : ""}`}>
                      <td className="px-3 py-1.5 tabular-nums text-[#6B7280]">{i + 1}</td>
                      <td className="px-3 py-1.5 text-[#1F1D1B]">{name(r.id)}</td>
                      <td className="px-3 py-1.5 text-[#6B7280]">{deptName(workerById.get(r.id)?.dept ?? "—")}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[#9A3A2D]">{h1(r.non)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${share >= 0.2 ? "font-semibold text-[#9A3A2D]" : "text-[#6B7280]"}`}>{pctOf(r.non, r.all)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(r.days)}</td>
                      <td className="px-3 py-1.5 text-[11.5px] text-[#6B7280]">{under || "—"}</td>
                    </tr>
                  );
                })}
                {people.length === 0 && <tr><td colSpan={7} className="px-3 py-5 text-center text-[#6B7280]">No non-production hours in this window.</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#6B7280] shadow-[inset_0_-1px_0_#E2DDD8]">
                <th className="px-3 py-1.5">Department</th><th className="px-3 py-1.5 text-right">Clocked</th><th className="px-3 py-1.5 text-right">Non-prod</th><th className="px-3 py-1.5 text-right">% of clocked</th><th className="px-3 py-1.5 text-right">People with any</th><th className="px-3 py-1.5">Most</th>
              </tr></thead>
              <tbody>
                {depts.map((d) => (
                  <tr key={d.dept} className="border-b border-[#F0ECE6]">
                    <td className="px-3 py-1.5 text-[#1F1D1B]">{deptName(d.dept)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#6B7280]">{h1(d.all)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[#9A3A2D]">{h1(d.non)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pctOf(d.non, d.all)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(d.people)}</td>
                    <td className="px-3 py-1.5 text-[#6B7280]">{d.top && d.top.non > 0 ? `${name(d.top.id)} · ${h1(d.top.non)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[11px] text-[#9CA3AF]">Rows shaded red: 20% or more of the person's clocked time was non-production. "Logged under" needs payroll access (it reads the hour entries).</p>
      </CardContent>
    </Card>
  );
}
