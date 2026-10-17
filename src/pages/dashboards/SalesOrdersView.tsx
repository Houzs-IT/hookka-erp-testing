import { useMemo, useState } from "react";
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
  const forecast = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const d of allByDay) {
      const m = d.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + d.revenueSen);
    }
    const { actual, projected } = rollingForecast([...byMonth.entries()], 6);
    const out = actual.map((r) => ({
      month: `${r.ym.slice(5)} ${r.ym.slice(2, 4)}`,
      iso: r.ym,
      actualSen: r.sen,
      Actual: Math.round(r.sen / 100),
      Target: r.targetSen === null ? null : Math.round(r.targetSen / 100),
      hit: r.hit,
      projected: false,
    }));
    // Carry the trend forward: each projected month's target is the rolling
    // average of the last three known actuals.
    for (const p of projected) {
      out.push({
        month: `${p.ym.slice(5)} ${p.ym.slice(2, 4)}`,
        iso: p.ym,
        actualSen: 0,
        Actual: null as unknown as number,
        Target: Math.round(p.sen / 100),
        hit: null,
        projected: true,
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
        <Card className="bg-white border-[#E5E0D8]">
          <CardHeader className="pb-3">
            <CardTitle>Sales forecast</CardTitle>
            <p className="text-xs" style={{ color: CHART_AXIS }}>
              Target is the 3-month rolling average of the preceding months —
              this book sets no explicit revenue target, so none is invented.
              Greyed months are projected and have no actual yet.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-3 pb-2 text-[11px]" style={{ color: CHART_AXIS }}>
              {([
                { label: "Hit target", color: GREEN, line: false },
                { label: "Missed target", color: AMBER, line: false },
                { label: "Projected", color: "#E3DED5", line: false },
                { label: "Target", color: TEAL, line: true },
              ] as const).map((l) => (
                <span key={l.label} className="inline-flex items-center gap-1.5">
                  {l.line ? (
                    <span
                      className="inline-block w-4"
                      style={{ borderTop: `2px dashed ${l.color}` }}
                    />
                  ) : (
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: l.color }}
                    />
                  )}
                  {l.label}
                </span>
              ))}
            </div>
            <div style={{ width: "100%", height: 260 }}>
              {forecast.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs" style={{ color: CHART_AXIS }}>
                  No dated revenue.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={forecast} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART_AXIS} strokeOpacity={0.25} />
                    <XAxis
                      dataKey="month"
                      tick={CC_TICK}
                      axisLine={CC_AXIS_LINE}
                      tickLine={false}
                    />
                    <YAxis
                      tick={CC_TICK}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tickFormatter={(v) => fmtRMAxis(Number(v))}
                    />
                    <Tooltip
                      contentStyle={{
                        background: CARD_BG,
                        border: `1px solid ${CARD_BORDER}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value, name) => {
                        const n = typeof value === "number" ? value : Number(value);
                        return [formatCurrency(n * 100), name];
                      }}
                    />
                    <Bar
                      dataKey="Actual"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={26}
                      isAnimationActive={false}
                      activeBar={{ fillOpacity: 1 }}
                    >
                      {forecast.map((r) => (
                        <Cell
                          key={r.iso}
                          fill={r.hit === null ? "#E3DED5" : r.hit ? GREEN : AMBER}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="monotone"
                      dataKey="Target"
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
