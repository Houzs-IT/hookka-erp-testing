import { useMemo, useState } from "react";
import { useSeriesToggle } from "./use-series-toggle";
import {
  CartesianGrid,
  ComposedChart,
  Cell,
  Line,
  Bar,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  GREEN, AMBER, TEAL, fmtN, fmtRMAxis, ymd,
  CHART_AXIS, CARD_BORDER, CARD_BG, CHART_SERIES,
  inPeriod, inFocus, periodLabel, type Period, CC_TICK, CC_AXIS_LINE } from "./dashboard-shared-lib";
import { LiveBadge } from "./dashboard-shared";
import { CommandCenterSections } from "./CommandCenterSections";
import { rollingForecast } from "@/lib/revenue-forecast";
import { buildSalesTrend, computeSalesKpis } from "./dashboard-sales-lib";

// Today, in the app's own local date. Used to cap the zero-fill: a future day
// has no rows because it has not happened, which is not the same as a day that
// recorded nothing.
const todayYmd = ymd(new Date());



// Real data from GET /api/dashboard/prototype (src/api/routes/dashboard-
// prototype.ts) — the SAME route + SQL the original HTML prototype read.
// Only the `sales` + `availability.sales` slices are used here; the route
// also computes delivery/inventory/purchase/employee/production, ready for
// when those tabs get ported.
type Feed = {
  success?: boolean;
  availability?: { sales?: { live: boolean; rows: number; reason?: string } };
  sales?: {
    byDay: { date: string; orders: number; revenueSen: number; cancelled: number }[];
    orders: {
      id: string;
      no: string | null;
      customer: string | null;
      status: string;
      totalSen: number;
      createdAt: string | null;
      /** The official SO date — what the Sales KPI buckets on. */
      soDate?: string | null;
      deliveryDate: string | null;
      isServiceOrder: boolean;
    }[];
    pipeline: { status: string; count: number; valueSen: number }[];
    // One row per (order day, state, category, sku) — the day is the order's
    // SO date (created_at only when it has none), as the Sales KPI uses.
    byStateCategory: {
      date: string | null;
      state: string | null;
      category: string | null;
      sku: string | null;
      name: string | null;
      qty: number;
      revenueSen: number;
    }[];
  };
};

export function SalesOrdersView({
  period,
  onPeriodChange,
}: {
  period: Period;
  months: string[];
  onPeriodChange: (p: Period) => void;
}) {
  const { data, loading, error } = useCachedJson<Feed>("/api/dashboard/prototype");
  const [stateFilter, setStateFilter] = useState<string | null>(null);

  // `?? []` allocates a fresh array each render, which would make every
  // downstream useMemo re-run regardless of its deps. Memoised so the deps
  // below actually mean something.
  const allOrders = useMemo(() => data?.sales?.orders ?? [], [data]);
  const allByDay = useMemo(() => data?.sales?.byDay ?? [], [data]);
  const live = data?.availability?.sales?.live ?? false;

  // Everything with a date is scoped to the global period picker above the
  // tabs.
  const orders = useMemo(
    // SO date, the Sales KPI's own basis (merged dashboard 2026-10-17), so the
    // pipeline and order counts here reconcile with the KPI cards above.
    () => allOrders.filter((o) => inPeriod(period, o.soDate ?? o.createdAt)),
    [allOrders, period],
  );
  const byDay = useMemo(
    () => allByDay.filter((d) => inPeriod(period, d.date)),
    [allByDay, period],
  );



  // Monthly shows bare day numbers (01, 02, ...) as the design prototype does;
  // YTD rolls the days up per month so the axis stays readable.
  //
  // ZERO-FILL: the feed only returns days that HAVE rows, so a day with no
  // sales was simply absent from the axis — the chart silently skipped it and
  // the line joined across the gap as if it never existed. Every day in the
  // window is generated here and missing ones default to 0, so a quiet day
  // reads as a real zero rather than vanishing. The fill stops at today: days
  // that have not happened yet are not zeros, they are unknown.
  const baseTrend = useMemo(
    () => buildSalesTrend(byDay, period, todayYmd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byDay, period.mode, period.month, period.from, period.to],
  );

  // The day series only backs a highlighted day (period.day, set from the
  // period picker); the revenue chart itself is the Command Center card.
  const chartData = baseTrend;

  const clearDay = () => onPeriodChange({ ...period, day: undefined });

  const selectedDetail = useMemo(() => {
    if (!period.day) return null;
    const hit = chartData.find((d) => d.iso === period.day);
    if (!hit) return null;
    return { label: hit.iso, revenueSen: hit.Revenue * 100, orders: hit.Orders };
  }, [period.day, chartData]);

  // Clicking a day in the trend narrows EVERYTHING that is order-scoped —
  // the KPI row, the pipeline and the recent list — to that day, so the cards
  // answer "what happened on the 10th" rather than staying on the month while
  // the chart below them says otherwise.
  const scopedOrders = useMemo(
    () =>
      selectedDetail
        ? orders.filter((o) => (o.soDate ?? o.createdAt) === selectedDetail.label)
        : orders,
    [orders, selectedDetail],
  );

  const kpis = useMemo(() => computeSalesKpis(scopedOrders), [scopedOrders]);

  // Sales forecast — the TARGET is the 3-month rolling average of the months
  // before it, which is what "actual vs target" means here; this book carries
  // no externally-set revenue target anywhere in the feed, and inventing one
  // would put a number on the page that nothing backs. A month is "hit" when
  // actual >= that rolling target. Future months carry the last known target
  // forward as a projection and have no actual, so they draw as empty slots
  // rather than as zero — a zero would read as "sold nothing".
  // The current month is IN PROGRESS (owner 2026-10-17: "forecast 看起来不对"):
  // half a month against a full-month target always read "missed", and it
  // dragged the projection down. It is now kept out of the rolling maths —
  // target and projection come from finished months only — and drawn as
  // "so far" plus a run-rate estimate (so far ÷ working days elapsed × working
  // days in the month; Sundays are not working days, matching idle-Sunday
  // handling elsewhere). Its hit/miss is judged on the estimate.
  const tFc = useSeriesToggle();
  const forecast = useMemo(() => {
    const curYm = todayYmd.slice(0, 7);
    const byMonth = new Map<string, number>();
    for (const d of allByDay) {
      const m = d.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + d.revenueSen);
    }
    const curSen = byMonth.get(curYm) ?? 0;
    byMonth.delete(curYm);
    const done = [...byMonth.entries()].filter(([m]) => m < curYm);
    const { actual, projected } = rollingForecast(done, 7);
    const label = (ym: string) => `${ym.slice(5)} ${ym.slice(2, 4)}`;
    const out: {
      month: string; iso: string; actualSen: number; Actual: number | null; Estimate: number | null;
      Target: number | null; hit: boolean | null; projected: boolean; inProgress: boolean;
    }[] = actual.map((r) => ({
      month: label(r.ym),
      iso: r.ym,
      actualSen: r.sen,
      Actual: Math.round(r.sen / 100),
      Estimate: null,
      Target: r.targetSen === null ? null : Math.round(r.targetSen / 100),
      hit: r.hit,
      projected: false,
      inProgress: false,
    }));
    const tail = done.slice(-3).map(([, v]) => v);
    const curTarget = tail.length === 3 ? tail.reduce((a, v) => a + v, 0) / 3 : null;
    const [y, mo, day] = todayYmd.split("-").map(Number);
    const dim = new Date(y, mo, 0).getDate();
    let elapsed = 0;
    let total = 0;
    for (let dd = 1; dd <= dim; dd++) {
      if (new Date(y, mo - 1, dd).getDay() === 0) continue;
      total++;
      if (dd <= day) elapsed++;
    }
    const estSen = elapsed ? (curSen / elapsed) * total : curSen;
    out.push({
      month: label(curYm),
      iso: curYm,
      actualSen: curSen,
      Actual: Math.round(curSen / 100),
      Estimate: Math.max(0, Math.round((estSen - curSen) / 100)),
      Target: curTarget === null ? null : Math.round(curTarget / 100),
      hit: curTarget === null ? null : estSen >= curTarget,
      projected: false,
      inProgress: true,
    });
    // Projection carries the average of the last three FINISHED months
    // forward; the first projected slot would be the current month, already
    // drawn above.
    for (const p of projected.filter((x) => x.ym > curYm).slice(0, 6)) {
      out.push({
        month: label(p.ym),
        iso: p.ym,
        actualSen: 0,
        Actual: null,
        Estimate: null,
        Target: Math.round(p.sen / 100),
        hit: null,
        projected: true,
        inProgress: false,
      });
    }
    return out;
  }, [allByDay]);



  // State x Category and Top SKUs follow the picker (and a clicked day), same
  // as the KPI row and pipeline.
  const stateCatRows = useMemo(
    () => (data?.sales?.byStateCategory ?? []).filter((r) => inFocus(period, r.date)),
    [data, period],
  );
  const attribution = useMemo(() => {
    const rows = stateCatRows;
    const states = new Map<string, { state: string; revenueSen: number; qty: number }>();
    const cats = new Map<string, { category: string; revenueSen: number; qty: number }>();
    const skus = new Map<string, { sku: string; name: string; category: string; revenueSen: number; qty: number }>();
    for (const r of rows) {
      const st = r.state ?? "—";
      const ct = r.category ?? "—";
      const sk = r.sku ?? "—";
      const s = states.get(st) ?? { state: st, revenueSen: 0, qty: 0 };
      s.revenueSen += r.revenueSen; s.qty += r.qty; states.set(st, s);
      const c = cats.get(ct) ?? { category: ct, revenueSen: 0, qty: 0 };
      c.revenueSen += r.revenueSen; c.qty += r.qty; cats.set(ct, c);
      const e = skus.get(sk) ?? { sku: sk, name: r.name ?? sk, category: ct, revenueSen: 0, qty: 0 };
      e.revenueSen += r.revenueSen; e.qty += r.qty; skus.set(sk, e);
    }
    const desc = <T extends { revenueSen: number }>(a: T, b: T) => b.revenueSen - a.revenueSen;
    const total = rows.reduce((s, r) => s + r.revenueSen, 0);
    return {
      states: [...states.values()].sort(desc),
      categories: [...cats.values()].sort(desc),
      allSkus: [...skus.values()].sort(desc),
      total,
    };
  }, [stateCatRows]);

  // Donut: top states, with anything past the 6th folded into "Other" so the
  // outside labels cannot collide into an unreadable fan.
  const donutData = useMemo(() => {
    const rows = attribution.states;
    const head = rows.slice(0, 6);
    const tailSen = rows.slice(6).reduce((t, r) => t + r.revenueSen, 0);
    const tailQty = rows.slice(6).reduce((t, r) => t + r.qty, 0);
    return tailSen > 0
      ? [...head, { state: "Other", revenueSen: tailSen, qty: tailQty }]
      : head;
  }, [attribution.states]);

  const donutTop = useMemo(() => {
    const top = donutData[0];
    if (!top || attribution.total <= 0) return null;
    return { state: top.state, pct: (top.revenueSen / attribution.total) * 100 };
  }, [donutData, attribution.total]);


  if (loading) {
    return <div className="py-16 text-center text-sm text-[#6B7280]">Loading…</div>;
  }

  if (error || !data?.success) {
    return (
      <Card className="border-[#F0D9AE] bg-[#FDF3E4]">
        <CardContent className="p-3 text-sm text-[#B5701A]">
          Couldn't load Sales Orders: {error ?? "unknown error"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-md:space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-[#1F1D1B]">Sales Orders</h2>
        <LiveBadge live={live} />
        {selectedDetail ? (
          <button
            type="button"
            onClick={clearDay}
            className="text-xs rounded-md border border-[#E5E0D8] bg-[#F7F5F3] px-2 py-0.5 text-[#6B5C32] hover:bg-white max-md:min-h-10 max-md:px-3 max-md:text-left"
          >
            Showing: {selectedDetail.label} — click to go back
          </button>
        ) : (
          <span className="text-xs text-[#6B7280]">
            {fmtN(kpis.soCount)} orders · {periodLabel(period)}
          </span>
        )}
      </div>

      {/* The Command Center KPI cards, exactly as on the old Dashboard. */}
      <CommandCenterSections period={period} sections={["kpis"]} />

      {/* Revenue: the Command Center chart itself (owner 2026-10-17: "换成
          第二张" — the old area chart, Sales Orders · Production · Invoices,
          All / Bedframe / Sofa, idle Sundays out), replacing the bar trend. */}
      <CommandCenterSections period={period} sections={["revenue"]} />

      {/* Attribution and forecast sit side by side, as the design
          prototype pairs them. */}
      <div className="grid gap-3 xl:grid-cols-2 items-start">
        <CommandCenterSections period={period} sections={["pipeline"]} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Sales forecast</CardTitle>
            <p className="mt-0.5 text-xs text-[#9CA3AF]">
              Target = average of the 3 finished months before · {forecast.find((r) => r.inProgress)?.month ?? "this month"} is in progress: so far + run-rate estimate
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-end gap-3 pb-2 text-xs text-[#6B7280]">
              {([
                { key: "Actual", label: "Actual (green = hit, amber = missed)", color: GREEN, line: false },
                { key: "Estimate", label: "Estimate (rest of month)", color: "#D9D3C7", line: false },
                { key: "Target", label: "Target", color: TEAL, line: true },
              ] as const).map((l) => {
                const off = tFc.hide(l.key);
                return (
                  <button key={l.key} type="button" onClick={() => tFc.toggle(l.key)} className="inline-flex items-center gap-1.5" style={{ color: off ? "#C9C4BA" : undefined, textDecoration: off ? "line-through" : undefined }}>
                    {l.line ? (
                      <span className="inline-block w-4" style={{ borderTop: `2px dashed ${l.color}` }} />
                    ) : (
                      <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: l.color }} />
                    )}
                    {l.label}
                  </button>
                );
              })}
            </div>
            <div style={{ width: "100%", height: 260 }}>
              {forecast.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-[#9CA3AF]">No dated revenue.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={forecast} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#F0ECE6" />
                    <XAxis dataKey="month" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} />
                    <YAxis tick={CC_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => fmtRMAxis(Number(v))} />
                    <Tooltip
                      cursor={{ fill: "rgba(107,92,50,0.06)" }}
                      content={({ active, payload }) => {
                        const r = active ? (payload?.[0]?.payload as (typeof forecast)[number] | undefined) : undefined;
                        if (!r) return null;
                        const rm = (n: number | null) => (n == null ? "—" : formatCurrency(n * 100));
                        return (
                          <div className="rounded-lg border border-[#E2DDD8] bg-white px-3 py-2 text-xs shadow-md">
                            <p className="mb-1 font-semibold text-[#1F1D1B]">
                              {r.iso}
                              {r.inProgress ? " · in progress" : r.projected ? " · projected" : ""}
                            </p>
                            {!r.projected && <p>{r.inProgress ? "So far" : "Actual"}: <b>{rm(r.Actual)}</b></p>}
                            {r.inProgress && <p>Estimate for the month: <b>{rm((r.Actual ?? 0) + (r.Estimate ?? 0))}</b></p>}
                            <p>{r.projected ? "Projected" : "Target"}: <b>{rm(r.Target)}</b></p>
                            {r.hit !== null && (
                              <p style={{ color: r.hit ? GREEN : AMBER }}>{r.hit ? "On / above target" : "Below target"}{r.inProgress ? " (on estimate)" : ""}</p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="Actual" hide={tFc.hide("Actual")} stackId="m" maxBarSize={26} isAnimationActive={false}>
                      {forecast.map((r) => (
                        <Cell
                          key={r.iso}
                          fill={r.hit === null ? "#E3DED5" : r.hit ? GREEN : AMBER}
                          // the bar's top corners are rounded only when no estimate sits on it
                          radius={(r.inProgress && r.Estimate ? [0, 0, 0, 0] : [4, 4, 0, 0]) as unknown as number}
                        />
                      ))}
                    </Bar>
                    <Bar dataKey="Estimate" hide={tFc.hide("Estimate")} stackId="m" maxBarSize={26} isAnimationActive={false} fill="#D9D3C7" radius={[4, 4, 0, 0]} />
                    <Line
                      type="monotone"
                      dataKey="Target"
                      hide={tFc.hide("Target")}
                      stroke={TEAL}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      connectNulls
                      isAnimationActive={false}
                      dot={{ r: 3, fill: "#FFFFFF", stroke: TEAL, strokeWidth: 2 }}
                      activeDot={{ r: 5, fill: "#FFFFFF", stroke: TEAL, strokeWidth: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales by Customer & Month and Top Sellers: the Command Center cards
          (they replace Sales attribution and the second customer card). */}
      <CommandCenterSections period={period} sections={["customers", "topSellers"]} />

      {/* Fulfillment pipeline and Top SKUs were folded into the Command
          Center Order Pipeline ("by status") and Top Sellers (owner
          2026-10-17). Sales by state stays. */}
      <div className="grid gap-3">
        <Card className="bg-white border-[#E5E0D8]">
          <CardHeader className="pb-3">
            <CardTitle>Sales by state &amp; category</CardTitle>
            <p className="text-xs" style={{ color: CHART_AXIS }}>
              Revenue by state and category · {selectedDetail ? selectedDetail.label : periodLabel(period)} · click a state to highlight it
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 items-center">
            {/* Donut with outside labels + leader lines, and the leading share
                called out in the hole — the shape the design reference uses. */}
            <div
              className="relative select-none [&_*]:outline-none"
              style={{ width: "100%", height: 250 }}
            >
              {/* Centre stat renders BEFORE the chart on purpose: as a later
                  sibling it painted on top of the tooltip whenever the pointer
                  was near the middle of the donut. The hole is transparent, so
                  it still reads through. */}
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="text-center leading-tight">
                  <p className="text-[9px] uppercase tracking-wide" style={{ color: CHART_AXIS }}>
                    Largest state
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-[#1F1D1B]">
                    {donutTop ? `${donutTop.pct.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[9px]" style={{ color: CHART_AXIS }}>
                    of total revenue
                  </p>
                </div>
              </div>

              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Pie
                    data={donutData}
                    dataKey="revenueSen"
                    nameKey="state"
                    innerRadius="58%"
                    outerRadius="88%"
                    paddingAngle={1}
                    stroke={CARD_BG}
                    strokeWidth={2}
                    isAnimationActive={false}
                    onClick={(d) => {
                      const row = (d as unknown as { payload?: { state?: string } })?.payload;
                      const name = row?.state;
                      if (name) setStateFilter((cur) => (cur === name ? null : name));
                    }}
                  >
                    {donutData.map((st, i) => (
                      <Cell
                        key={st.state}
                        cursor="pointer"
                        fill={CHART_SERIES[i % CHART_SERIES.length]}
                        opacity={stateFilter && stateFilter !== st.state ? 0.28 : 1}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    wrapperStyle={{ zIndex: 30, outline: "none" }}
                    contentStyle={{
                      background: "#FFFFFF",
                      opacity: 1,
                      border: "1px solid " + CARD_BORDER,
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: "0 4px 14px rgba(42,39,35,0.18)",
                    }}
                    formatter={(value, name) => [formatCurrency(Number(value)), String(name)]}
                  />
                </PieChart>
              </ResponsiveContainer>

            </div>

            <div className="space-y-2">
              <div>
                <p className="text-lg font-bold tabular-nums text-[#1F1D1B]">
                  {formatCurrency(attribution.total)}
                </p>
                <p className="text-[10px] uppercase tracking-wide" style={{ color: CHART_AXIS }}>
                  Total sales · {selectedDetail ? selectedDetail.label : periodLabel(period)}
                </p>
              </div>
              {attribution.states.slice(0, 7).map((st, i) => {
                const pct = attribution.total > 0 ? (st.revenueSen / attribution.total) * 100 : 0;
                const on = !stateFilter || stateFilter === st.state;
                return (
                  <button
                    key={st.state}
                    type="button"
                    onClick={() => setStateFilter((cur) => (cur === st.state ? null : st.state))}
                    className="w-full flex items-center gap-2 text-[12.5px] text-left max-md:py-1.5"
                    style={{ opacity: on ? 1 : 0.45 }}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ background: CHART_SERIES[i % CHART_SERIES.length] }}
                    />
                    <span className="flex-1 truncate text-[#1F1D1B]">{st.state}</span>
                    <span className="tabular-nums shrink-0 font-semibold text-[#1F1D1B]">{formatCurrency(st.revenueSen)}</span>
                    <span className="w-12 text-right tabular-nums shrink-0" style={{ color: CHART_AXIS }}>
                      {pct.toFixed(1)}%
                    </span>
                  </button>
                );
              })}
              <div className="pt-1 border-t border-[#E5E0D8] space-y-0.5">
                {attribution.categories.slice(0, 4).map((c) => (
                  <p key={c.category} className="text-[12px] flex items-baseline gap-2">
                    <span className="flex-1" style={{ color: CHART_AXIS }}>{c.category}</span>
                    <span className="tabular-nums" style={{ color: CHART_AXIS }}>{fmtN(c.qty)} sold</span>
                    <span className="tabular-nums font-semibold text-[#1F1D1B]">{formatCurrency(c.revenueSen)}</span>
                    <span className="w-12 text-right tabular-nums" style={{ color: CHART_AXIS }}>
                      {attribution.total > 0 ? ((c.revenueSen / attribution.total) * 100).toFixed(1) : "0.0"}%
                    </span>
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

      </div>

    </div>
  );
}
