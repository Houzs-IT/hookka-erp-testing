import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { monthsOf, useProductionRevenue } from "./use-production-revenue";
import { useSeriesToggle } from "./use-series-toggle";
import { CC_AXIS_LINE, CC_TICK, CHART_GOLD, CHART_INK, fmtRMAxis, inPeriod, monthLabel, ymd, type Period } from "./dashboard-shared-lib";

// ---------------------------------------------------------------------------
// Daily production revenue (owner 2026-10-20: "operation 那边加一个 daily
// production revenue 的 bar chart"). One bar per day, Bedframe / Sofa stacked,
// from the same feed as Costing and the Command Center (an order's value on
// the day its Upholstery cards complete — useProductionRevenue). A Year view
// rolls up per month. The dashed line is the average per working day; idle
// days (nothing produced) are left out of that average. Click a bar to focus
// the day.
// ---------------------------------------------------------------------------
const rm = (sen: number) => formatCurrency(Math.round(sen));

export function DailyProductionRevenueCard({ period, onPeriodChange }: { period: Period; onPeriodChange?: (p: Period) => void }) {
  const today = ymd(new Date());
  const months = useMemo(() => monthsOf(period, today), [period, today]);
  const rev = useProductionRevenue(months);
  const t = useSeriesToggle();
  const byMonth = period.mode === "ytd";

  const { rows, total, avg, workDays, best, bfShare } = useMemo(() => {
    const days = [...(rev?.byDay ?? new Map()).entries()]
      .filter(([d]) => d <= today && inPeriod(period, d))
      .sort(([a], [b]) => a.localeCompare(b));
    const buckets = new Map<string, { bedframe: number; sofa: number; total: number }>();
    for (const [d, v] of days) {
      const k = byMonth ? d.slice(0, 7) : d;
      const b = buckets.get(k) ?? { bedframe: 0, sofa: 0, total: 0 };
      b.bedframe += v.bedframe;
      b.sofa += v.sofa;
      b.total += v.total;
      buckets.set(k, b);
    }
    const sum = days.reduce((a, [, v]) => a + v.total, 0);
    const bf = days.reduce((a, [, v]) => a + v.bedframe, 0);
    const sofa = days.reduce((a, [, v]) => a + v.sofa, 0);
    // A working day = any department produced something (the same rule as
    // the Department Revenue table's Avg / day), so the two averages agree.
    const deptActive = (d: string) => [...(rev?.dept.values() ?? [])].some((m) => (m.get(d)?.total ?? 0) > 0);
    const active = days.filter(([d, v]) => v.total > 0 || deptActive(d));
    const top = days.filter(([, v]) => v.total > 0).reduce<[string, number] | null>((m, [d, v]) => (!m || v.total > m[1] ? [d, v.total] : m), null);
    return {
      // Idle Sundays (nothing anywhere) stay off the axis, as on every per-day chart.
      rows: [...buckets.entries()].filter(([k, b]) => byMonth || b.total > 0 || deptActive(k) || new Date(`${k}T00:00:00Z`).getUTCDay() !== 0).map(([k, b]) => ({
        key: k,
        label: byMonth ? monthLabel(k).slice(0, 3) : k.slice(5),
        Bedframe: Math.round(b.bedframe / 100),
        Sofa: Math.round(b.sofa / 100),
        // anything not classed bedframe / sofa (accessories, unclassified)
        Other: Math.max(0, Math.round((b.total - b.bedframe - b.sofa) / 100)),
        totalSen: b.total,
      })),
      total: sum,
      workDays: active.length,
      avg: active.length ? sum / active.length : 0,
      best: top,
      bfShare: bf + sofa > 0 ? Math.round((bf / (bf + sofa)) * 100) : null,
    };
  }, [rev, period, today, byMonth]);

  const avgLine = byMonth ? null : Math.round(avg / 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Daily production revenue</CardTitle>
        <p className="mt-0.5 text-xs text-[#9CA3AF]">
          Value of what finished production each {byMonth ? "month" : "day"} (an order counts on the day its Upholstery cards complete) · dashed line = average per working day · click a bar to focus that day
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            ["Total", rev ? rm(total) : "…", `${workDays} working day${workDays === 1 ? "" : "s"}`],
            ["Average per working day", rev ? rm(avg) : "…", "days no department produced left out"],
            ["Best day", best ? rm(best[1]) : "—", best ? best[0] : ""],
            ["Bedframe / Sofa", !rev ? "…" : bfShare == null ? "—" : `${bfShare}% / ${100 - bfShare}%`, "share of bedframe + sofa value"],
          ].map(([k, v, s]) => (
            <div key={k} className="min-w-0 rounded-lg bg-[#F7F4EF] px-3 py-2">
              <p className="truncate text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">{k}</p>
              <p className="truncate text-lg font-bold tabular-nums text-[#1F1D1B]">{v}</p>
              <p className="truncate text-[11px] text-[#6B7280]">{s}</p>
            </div>
          ))}
        </div>
        <div className="select-none [&_*]:outline-none" style={{ width: "100%", height: 260 }}>
          {!rev ? (
            <div className="flex h-full items-center justify-center text-xs text-[#9CA3AF]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[#9CA3AF]">No production revenue in this period.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
                style={{ cursor: !byMonth && onPeriodChange ? "pointer" : undefined }}
                onClick={(e) => {
                  if (byMonth || !onPeriodChange) return;
                  const hit = rows.find((r) => r.label === e?.activeLabel);
                  if (hit) onPeriodChange({ ...period, day: hit.key });
                }}
              >
                <CartesianGrid vertical={false} stroke="#F0ECE6" />
                <XAxis dataKey="label" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                <YAxis tick={CC_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => fmtRMAxis(Number(v))} />
                <Tooltip
                  cursor={{ fill: "rgba(107,92,50,0.06)" }}
                  content={({ active, payload }) => {
                    const r = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
                    if (!r) return null;
                    return (
                      <div className="rounded-lg border border-[#E2DDD8] bg-white px-3 py-2 text-xs shadow-md">
                        <p className="mb-1 font-semibold text-[#1F1D1B]">{byMonth ? monthLabel(r.key) : r.key}</p>
                        <p>Total: <b>{rm(r.totalSen)}</b></p>
                        <p>Bedframe: {formatCurrency(r.Bedframe * 100)} · Sofa: {formatCurrency(r.Sofa * 100)}{r.Other ? ` · Other: ${formatCurrency(r.Other * 100)}` : ""}</p>
                        {!byMonth && avg > 0 && <p className="mt-1 text-[#6B7280]">{r.totalSen >= avg ? "▲" : "▼"} {Math.abs(Math.round(((r.totalSen - avg) / avg) * 100))}% vs average day</p>}
                      </div>
                    );
                  }}
                />
                <Legend {...t.legend} />
                <Bar dataKey="Bedframe" hide={t.hide("Bedframe")} stackId="r" fill={CHART_INK} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="Sofa" hide={t.hide("Sofa")} stackId="r" fill={CHART_GOLD} maxBarSize={22} isAnimationActive={false} />
                <Bar dataKey="Other" hide={t.hide("Other")} stackId="r" fill="#D9D2C5" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                {avgLine != null && avgLine > 0 && <ReferenceLine y={avgLine} stroke="#3E6570" strokeDasharray="5 4" strokeOpacity={0.8} />}
                {period.day && !byMonth && <ReferenceLine x={period.day.slice(5)} stroke="#9C6F1E" strokeWidth={2} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
