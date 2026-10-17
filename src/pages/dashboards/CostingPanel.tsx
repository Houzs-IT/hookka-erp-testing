import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { formatCurrency } from "@/lib/utils";
import { dropIdleSundays } from "@/lib/idle-sundays";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProductionRevenue } from "./use-production-revenue";
import { useLabourCost } from "./use-labour-cost";
import { useSeriesToggle } from "./use-series-toggle";
import { CC_AXIS_LINE, CC_TICK, fmtRMAxis, inPeriod, monthLabel, shiftMonth, ymd, type Period } from "./dashboard-shared-lib";

// ---------------------------------------------------------------------------
// Costing (owner 2026-10-17): "目前的 costing 对比上个月的 costing", every RM
// with its % of production revenue beside it, and a trend of that % per day
// (per month on a year view).
//
//   Production revenue — the Upholstery row of Department Revenue (an order's
//     value on the day its Upholstery cards complete), the same number the
//     Command Center and Employees use.
//   Materials used — THE P&L's raw materials line (owner 2026-10-17: "我的
//     September 跟 October 不是这样子算的, 你去看一下我的 P&L"): opening stock
//     + purchases − closing stock, per month, from GET /api/accounting/
//     cost-structure (the same window the P&L uses; closing stock = the
//     month's stock-take import). A month whose stock take is not in yet —
//     always the running month — has no closing figure, so its materials are
//     ESTIMATED at the last finished month's materials ÷ production revenue,
//     the same carry-forward the P&L uses to value live WIP / FG. The system's
//     own stock balances are not used: valued at purchase price they come to
//     ~RM 7.8m against a RM 56k stock take (2026-10-17), so "purchases −
//     balance" would be noise until the balances are reconciled. A day gets
//     its month's materials ratio × its production revenue.
//   Labour — logged working hours at the Labor Cost rate (payroll only).
//   Cost % = (materials used + labour) ÷ production revenue.
//   Purchases — supplier invoices by invoice date. Shown for reference, NOT
//     added to cost: a purchase is stock until it is used.
//
// The current month is to date, so its RM is not comparable to a whole month —
// the % is, which is why every RM carries one.
// ---------------------------------------------------------------------------

type CostDay = { date: string; materialSen: number; laborSen: number; totalSen: number };
type CostStructure = { data?: { cols?: string[]; groups?: { months?: ({ opening?: number; purchase?: number; closing?: number } | null)[] }[] } };
type Pi = { invoiceDate: string | null; amountSen: number | string | null; status: string };
type Bucket = { revenue: number; material: number; labour: number; purchases: number };

const ZERO: Bucket = { revenue: 0, material: 0, labour: 0, purchases: 0 };
const INK = "#6B5C32";
const TEAL = "#3E6570";
const GOLD = "#C9A24B";

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const pctTxt = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const rm = (sen: number) => formatCurrency(Math.round(sen));

function addTo(m: Map<string, Bucket>, key: string, k: keyof Bucket, v: number) {
  const b = m.get(key) ?? { ...ZERO };
  b[k] += v;
  m.set(key, b);
}

export function CostingPanel({ period, costByDay, onPeriodChange }: { period: Period; costByDay: CostDay[]; onPeriodChange: (p: Period) => void }) {
  const { hasPermission } = usePermissions();
  const canLabour = hasPermission("payroll", "read");
  const today = ymd(new Date());
  const ytd = period.mode === "ytd";
  const focusMonth = period.mode === "range" ? (period.to ?? today).slice(0, 7) : period.month;
  // Months the summary and the trend need: the focus month, the three before
  // it (last month + the 3-month average), and on a year view every month of it.
  const months = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i <= 3; i++) set.add(shiftMonth(focusMonth, -i));
    if (ytd) for (let m = 1; m <= 12; m++) set.add(`${focusMonth.slice(0, 4)}-${String(m).padStart(2, "0")}`);
    return [...set].filter((m) => m <= today.slice(0, 7)).sort();
  }, [focusMonth, ytd, today]);
  const from = `${months[0]}-01`;
  const lastMonth = months[months.length - 1];
  const to = ymd(new Date(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0)) < today ? ymd(new Date(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0)) : today;

  const prodRev = useProductionRevenue(months);
  const revByDay = prodRev?.byDay ?? null;
  const { byWorkerDay, ready: labourReady } = useLabourCost(from, to, canLabour);
  const { data: piResp } = useCachedJson<{ data?: Pi[] }>("/api/purchase-invoices");
  // P&L raw materials by month: this financial year, and the one before when
  // the 3-month window reaches back into it.
  const { data: csNow } = useCachedJson<CostStructure>("/api/accounting/cost-structure");
  const firstFyCol = csNow?.data?.cols?.[0] ?? "";
  const needPrevFy = !!firstFyCol && months[0] < firstFyCol;
  const { data: csPrev } = useCachedJson<CostStructure>(needPrevFy ? `/api/accounting/cost-structure?fy=${Number(firstFyCol.slice(0, 4)) - 1}` : null);
  const pnlMaterials = useMemo(() => {
    const out = new Map<string, number>();
    for (const cs of [csPrev, csNow]) {
      const cols = cs?.data?.cols ?? [];
      cols.forEach((ym, i) => {
        // The running month has no closing stock yet — estimated below.
        if (ym >= today.slice(0, 7)) return;
        let used = 0;
        let any = false;
        for (const g of cs?.data?.groups ?? []) {
          const m = g.months?.[i];
          if (!m) continue;
          any = true;
          used += (m.opening ?? 0) + (m.purchase ?? 0) - (m.closing ?? 0);
        }
        if (any) out.set(ym, used);
      });
    }
    return out;
  }, [csNow, csPrev, today]);

  // Everything per day, then rolled up per month.
  const byDay = useMemo(() => {
    const m = new Map<string, Bucket>();
    for (const [d, v] of revByDay ?? []) if (d >= from && d <= to) addTo(m, d, "revenue", v.total);
    // Materials: each month's P&L figure spread over its days by production
    // revenue; a month without one (the running month) at the last finished
    // month's ratio.
    const revByMonth = new Map<string, number>();
    for (const [d, v] of revByDay ?? []) revByMonth.set(d.slice(0, 7), (revByMonth.get(d.slice(0, 7)) ?? 0) + v.total);
    const finished = [...pnlMaterials.keys()].sort();
    const ratioOf = (ym: string) => {
      const known = pnlMaterials.get(ym);
      const r = revByMonth.get(ym) ?? 0;
      if (known != null) return r > 0 ? known / r : 0;
      const last = [...finished].reverse().find((f) => f < ym && (revByMonth.get(f) ?? 0) > 0);
      return last ? (pnlMaterials.get(last) ?? 0) / (revByMonth.get(last) ?? 1) : 0;
    };
    for (const [d, v] of revByDay ?? []) if (d >= from && d <= to) addTo(m, d, "material", v.total * ratioOf(d.slice(0, 7)));
    void costByDay;
    for (const [k, v] of byWorkerDay) {
      const d = k.slice(k.indexOf("|") + 1);
      addTo(m, d, "labour", v);
    }
    for (const p of piResp?.data ?? []) {
      const d = String(p.invoiceDate ?? "").slice(0, 10);
      if (p.status === "CANCELLED" || d < from || d > to) continue;
      addTo(m, d, "purchases", Number(p.amountSen) || 0);
    }
    return m;
  }, [revByDay, costByDay, byWorkerDay, piResp, from, to, pnlMaterials]);
  const byMonth = useMemo(() => {
    const m = new Map<string, Bucket>();
    for (const [d, b] of byDay) for (const k of Object.keys(b) as (keyof Bucket)[]) addTo(m, d.slice(0, 7), k, b[k]);
    return m;
  }, [byDay]);

  const loading = revByDay == null || (canLabour && !labourReady) || !csNow;
  const estimated = (ym: string) => !pnlMaterials.has(ym);
  const cost = (b: Bucket) => b.material + (canLabour ? b.labour : 0);

  // Summary columns: [the day], the focus month, last month, the 3 months before.
  const prev = shiftMonth(focusMonth, -1);
  const three = [1, 2, 3].map((i) => byMonth.get(shiftMonth(focusMonth, -i)) ?? ZERO);
  const threeSum = three.reduce<Bucket>((a, b) => ({ revenue: a.revenue + b.revenue, material: a.material + b.material, labour: a.labour + b.labour, purchases: a.purchases + b.purchases }), { ...ZERO });
  const isCurrent = focusMonth === today.slice(0, 7);
  const cols: { label: string; sub: string; b: Bucket; avg?: boolean }[] = [
    ...(period.day ? [{ label: period.day.slice(5).replace("-", "/"), sub: "the selected day", b: byDay.get(period.day) ?? ZERO }] : []),
    { label: monthLabel(focusMonth), sub: isCurrent ? `to date · live${estimated(focusMonth) ? " · materials est." : ""}` : `whole month${estimated(focusMonth) ? " · materials est." : ""}`, b: byMonth.get(focusMonth) ?? ZERO },
    { label: monthLabel(prev), sub: "last month", b: byMonth.get(prev) ?? ZERO },
    { label: "3-month avg", sub: `${monthLabel(shiftMonth(focusMonth, -3))} – ${monthLabel(prev)}`, b: { revenue: threeSum.revenue / 3, material: threeSum.material / 3, labour: threeSum.labour / 3, purchases: threeSum.purchases / 3 }, avg: true },
  ];
  const head = cols[period.day ? 1 : 0];
  const headPct = pctOf(cost(head.b), head.b.revenue);
  const prevPct = pctOf(cost(cols[period.day ? 2 : 1].b), cols[period.day ? 2 : 1].b.revenue);

  // Trend: one point per day (per month on a year view), idle Sundays out.
  const t = useSeriesToggle();
  const trend = useMemo(() => {
    if (ytd) {
      return months
        .filter((m) => m.slice(0, 4) === focusMonth.slice(0, 4))
        .map((m) => {
          const b = byMonth.get(m) ?? ZERO;
          return { key: m, label: monthLabel(m), Revenue: Math.round(b.revenue / 100), Materials: Math.round(b.material / 100), Labour: canLabour ? Math.round(b.labour / 100) : 0, "Cost %": pctOf(cost(b), b.revenue), revenue: b.revenue };
        });
    }
    const days = [...byDay.keys()].filter((d) => inPeriod(period, d)).sort();
    return dropIdleSundays(
      days.map((d) => ({ d, b: byDay.get(d)! })),
      (x) => x.d,
      (x) => [x.b.revenue, x.b.material, x.b.labour],
    ).map(({ d, b }) => ({ key: d, label: d.slice(5), Revenue: Math.round(b.revenue / 100), Materials: Math.round(b.material / 100), Labour: canLabour ? Math.round(b.labour / 100) : 0, "Cost %": pctOf(cost(b), b.revenue), revenue: b.revenue }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytd, months, byMonth, byDay, period, focusMonth, canLabour]);
  const pick = (e: { activeLabel?: unknown } | null) => {
    const hit = trend.find((r) => r.label === e?.activeLabel);
    if (!hit) return;
    if (ytd) onPeriodChange({ mode: "monthly", month: hit.key });
    else onPeriodChange({ ...period, day: period.day === hit.key ? undefined : hit.key });
  };

  const row = (label: string, get: (b: Bucket) => number | null, opts: { pct?: boolean; strong?: boolean; muted?: boolean } = {}) => (
    <tr className={`border-b border-[#F0ECE6] ${opts.strong ? "font-semibold" : ""}`}>
      <td className={`py-2 pr-3 ${opts.muted ? "text-[#9CA3AF]" : "text-[#1F1D1B]"}`}>{label}</td>
      {cols.map((c) => {
        const v = get(c.b);
        const p = opts.pct && v != null ? pctOf(v, c.b.revenue) : null;
        return (
          <td key={c.label} className="py-2 pl-3 text-right tabular-nums whitespace-nowrap">
            <span className={opts.muted ? "text-[#9CA3AF]" : "text-[#1F1D1B]"}>{v == null ? "payroll only" : rm(v)}</span>
            {opts.pct && <span className="ml-2 inline-block min-w-[46px] rounded bg-[#F5F2ED] px-1.5 py-0.5 text-[11px] text-[#6B5C32]">{pctTxt(p)}</span>}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle>Costing vs production revenue</CardTitle>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">% = share of production revenue · materials used + labour = cost</p>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-end gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#9CA3AF]">Cost % · {head.label}</p>
              <p className="text-3xl font-bold tabular-nums" style={{ color: headPct != null && prevPct != null && headPct > prevPct ? "#9A3A2D" : "#4F7C3A" }}>{loading ? "…" : pctTxt(headPct)}</p>
            </div>
            {!loading && headPct != null && prevPct != null && (
              <p className="pb-1 text-xs text-[#6B7280]">
                {headPct > prevPct ? "▲" : "▼"} {Math.abs(headPct - prevPct).toFixed(1)} pts vs last month ({pctTxt(prevPct)})
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">
                  <th className="py-1.5 text-left font-semibold" />
                  {cols.map((c) => (
                    <th key={c.label} className="py-1.5 pl-3 text-right font-semibold">
                      <div className="text-[#6B7280]">{c.label}</div>
                      <div className="font-normal normal-case tracking-normal">{c.sub}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {row("Production revenue", (b) => b.revenue, { strong: true })}
                {row("Materials used (P&L)", (b) => b.material, { pct: true })}
                {row("Labour", (b) => (canLabour ? b.labour : null), { pct: true })}
                {row("Total cost", (b) => cost(b), { pct: true, strong: true })}
                {row("Purchases (supplier invoices)", (b) => b.purchases, { pct: true, muted: true })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[#9CA3AF]">
            Materials used = the P&L's raw materials (opening stock + purchases − closing stock from the stock take). A month without its stock take yet is estimated at the last finished month's rate. Purchases are stock bought, not used — reference only, not added to cost.
            {!canLabour && " Labour needs payroll access, so cost here is materials only."}
          </p>
        </CardContent>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle>Cost trend · {ytd ? "by month" : "by day"}</CardTitle>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">Each {ytd ? "month" : "day"}: production revenue (light) beside its cost (materials + labour) — the gap is the margin · line = cost % · click a bar to focus it</p>
        </CardHeader>
        <CardContent>
          <div className="select-none [&_*]:outline-none" style={{ width: "100%", height: 280 }}>
            {loading ? (
              <div className="flex h-full items-center justify-center text-xs text-[#9CA3AF]">Loading…</div>
            ) : trend.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-[#9CA3AF]">Nothing in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} onClick={pick} style={{ cursor: "pointer" }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE6" />
                  <XAxis dataKey="label" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
                  <YAxis yAxisId="rm" tick={CC_TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => fmtRMAxis(Number(v))} />
                  <YAxis yAxisId="pct" orientation="right" tick={CC_TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    cursor={{ fill: "rgba(107,92,50,0.06)" }}
                    content={({ active, payload }) => {
                      const r = active ? (payload?.[0]?.payload as (typeof trend)[number] | undefined) : undefined;
                      if (!r) return null;
                      return (
                        <div className="rounded-lg border border-[#E2DDD8] bg-white px-3 py-2 text-xs shadow-md">
                          <p className="mb-1 font-semibold text-[#1F1D1B]">{r.key}</p>
                          <p>Production revenue: <b>{rm(r.revenue)}</b></p>
                          <p>Materials used: <b>{rm(r.Materials * 100)}</b></p>
                          {canLabour && <p>Labour: <b>{rm(r.Labour * 100)}</b></p>}
                          <p className="mt-1" style={{ color: GOLD }}>Cost %: <b>{pctTxt(r["Cost %"])}</b></p>
                        </div>
                      );
                    }}
                  />
                  <Legend {...t.legend} />
                  <Bar yAxisId="rm" dataKey="Revenue" hide={t.hide("Revenue")} fill="#E3DCD0" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Bar yAxisId="rm" dataKey="Materials" hide={t.hide("Materials")} stackId="c" fill={INK} maxBarSize={18} isAnimationActive={false} />
                  {canLabour && <Bar yAxisId="rm" dataKey="Labour" hide={t.hide("Labour")} stackId="c" fill={TEAL} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />}
                  <Line yAxisId="pct" type="monotone" dataKey="Cost %" hide={t.hide("Cost %")} stroke={GOLD} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
                  {headPct != null && !ytd && <ReferenceLine yAxisId="pct" y={Math.round(headPct * 10) / 10} stroke={GOLD} strokeDasharray="4 3" strokeOpacity={0.6} />}
                  {period.day && !ytd && <ReferenceLine yAxisId="rm" x={period.day.slice(5)} stroke="#9C6F1E" strokeWidth={2} />}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
