import { useMemo, useState } from "react";
import { useSeriesToggle } from "./use-series-toggle";
import { DashModal } from "./DashModal";
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
  inPeriod, inFocus, periodLabel, monthLabel, quarterOfPeriod, quarterKeyOf, type Period, CC_TICK, CC_AXIS_LINE } from "./dashboard-shared-lib";
import { LiveBadge } from "./dashboard-shared";
import { CommandCenterSections } from "./CommandCenterSections";
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

  // Sales forecast (owner 2026-10-18: "sales forecast 应该用我的 forecast 的
  // module 取, actual sales 应该根据 invoice 的"):
  //   • Target = the sales the owner keyed per month in Forecast P&L
  //     (GET /api/accounting/forecast → months[ym].salesSen). A quarter / year
  //     target is the sum of its keyed months; a month with nothing keyed has
  //     no target (no rolling-average stand-in — that was a made-up number).
  //   • Actual = invoiced value by invoice date (cancelled out) — the same
  //     figure as the "This month invoices" tile and the P&L's sales.
  // Bars follow the period picker: months on Month, quarters on Quarter,
  // years on Year. The bucket in progress shows invoiced so far plus what is
  // still needed; future buckets show the keyed target only.
  const fcUnit: "month" | "quarter" | "year" = period.mode === "ytd" ? "year" : quarterOfPeriod(period) ? "quarter" : "month";
  const tFc = useSeriesToggle();
  const { data: fcResp, failure: fcFailure } = useCachedJson<{ data?: { months?: Record<string, { salesSen?: number }> } }>("/api/accounting/forecast");
  const { data: invResp } = useCachedJson<{ data?: { invoiceDate?: string | null; status: string; totalSen?: number | null }[] }>("/api/invoices");
  const forecast = useMemo(() => {
    const curYm = todayYmd.slice(0, 7);
    const keyOf = (ym: string) => (fcUnit === "year" ? ym.slice(0, 4) : fcUnit === "quarter" ? quarterKeyOf(ym) : ym);
    const labelOf = (k: string) => (fcUnit === "year" ? k : fcUnit === "quarter" ? `Q${k.slice(6)} ${k.slice(2, 4)}` : `${monthLabel(k).slice(0, 3)} ${k.slice(2, 4)}`);
    const curKey = keyOf(curYm);
    const actual = new Map<string, number>();
    for (const i of invResp?.data ?? []) {
      if (i.status === "CANCELLED" || !i.invoiceDate) continue;
      const k = keyOf(String(i.invoiceDate).slice(0, 7));
      actual.set(k, (actual.get(k) ?? 0) + (Number(i.totalSen) || 0));
    }
    const target = new Map<string, number>();
    for (const [ym, m] of Object.entries(fcResp?.data?.months ?? {})) {
      const sen = Number(m?.salesSen) || 0;
      if (!/^\d{4}-\d{2}$/.test(ym) || sen <= 0) continue;
      target.set(keyOf(ym), (target.get(keyOf(ym)) ?? 0) + sen);
    }
    const keys = [...new Set([...actual.keys(), ...target.keys(), curKey])].sort();
    type Row = { month: string; iso: string; Actual: number | null; "Still needed": number | null; Target: number | null; actualSen: number; targetSen: number | null; hit: boolean | null; projected: boolean; inProgress: boolean };
    const out: Row[] = keys.map((k) => {
      const t = target.get(k) ?? null;
      const v = actual.get(k) ?? 0;
      const past = k < curKey;
      const now = k === curKey;
      return {
        month: labelOf(k),
        iso: k,
        Actual: past || now ? Math.round(v / 100) : null,
        "Still needed": now && t != null ? Math.max(0, Math.round((t - v) / 100)) : null,
        Target: t == null ? null : Math.round(t / 100),
        // exact sen for the header / tooltip; the bar heights above are RM
        actualSen: v,
        targetSen: t,
        hit: t == null || (!past && !now) ? null : v >= t ? true : now ? null : false,
        projected: !past && !now,
        inProgress: now,
      };
    });
    // Months: the last 6 finished + now + up to 6 keyed ahead.
    if (fcUnit !== "month") return out;
    const at = out.findIndex((r) => r.inProgress);
    return out.slice(Math.max(0, at - 6), at + 7);
  }, [invResp, fcResp, fcUnit]);
  const fcNoAccess = !fcResp && fcFailure != null;
  const fcNone = !!fcResp && forecast.every((r) => r.Target == null);
  const fcNow = forecast.find((r) => r.inProgress);



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

  // Layer 2: a state or a category opens the products sold there.
  const [saleDrill, setSaleDrill] = useState<{ kind: "state" | "category"; key: string } | null>(null);
  const saleDrillRows = useMemo(() => {
    if (!saleDrill) return [];
    const m = new Map<string, { sku: string; name: string; other: string; qty: number; revenueSen: number }>();
    for (const r of stateCatRows) {
      const hit = saleDrill.kind === "state" ? (r.state ?? "—") === saleDrill.key : (r.category ?? "—") === saleDrill.key;
      if (!hit) continue;
      const k = r.sku ?? "—";
      const e = m.get(k) ?? { sku: k, name: r.name ?? k, other: saleDrill.kind === "state" ? (r.category ?? "—") : (r.state ?? "—"), qty: 0, revenueSen: 0 };
      e.qty += r.qty;
      e.revenueSen += r.revenueSen;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.revenueSen - a.revenueSen);
  }, [saleDrill, stateCatRows]);

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
              By {fcUnit} · actual = invoiced (by invoice date) · target = sales keyed in Forecast P&L
              {fcNoAccess && " · the target needs Accounting access"}
              {fcNone && " · no sales keyed in Forecast P&L yet"}
              {fcNow && fcNow.targetSen != null && (
                <> · {fcNow.month} invoiced so far {formatCurrency(fcNow.actualSen)} of {formatCurrency(fcNow.targetSen)} target ({Math.round((fcNow.actualSen / Math.max(1, fcNow.targetSen)) * 100)}%)</>
              )}
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-end gap-3 pb-2 text-xs text-[#6B7280]">
              {([
                { key: "Actual", label: "Invoiced (green = hit, amber = missed, brown = so far, grey = no target keyed)", color: GREEN, line: false },
                { key: "Still needed", label: `Still needed for target (this ${fcUnit})`, color: "#E9E3DA", line: false },
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
                <div className="flex items-center justify-center h-full text-xs text-[#9CA3AF]">No invoices yet.</div>
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
                            {!r.projected && <p>{r.inProgress ? "Invoiced so far" : "Invoiced"}: <b>{formatCurrency(r.actualSen)}</b></p>}
                            {r.inProgress && r["Still needed"] != null && <p>Still needed for target: <b>{rm(r["Still needed"])}</b></p>}
                            <p>Forecast target: <b>{r.targetSen == null ? "— (not keyed)" : formatCurrency(r.targetSen)}</b></p>
                            {r.hit !== null && (
                              <p style={{ color: r.hit ? GREEN : AMBER }}>{r.hit ? "On / above target" : "Below target"}</p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="Actual" hide={tFc.hide("Actual")} stackId="m" maxBarSize={26} isAnimationActive={false}>
                      {forecast.map((r) => (
                        <Cell
                          key={r.iso}
                          fill={r.inProgress ? (r.hit ? GREEN : "#6B5C32") : r.projected ? "#E3DED5" : r.hit === null ? "#A39E93" : r.hit ? GREEN : AMBER}
                          // the bar's top corners are rounded only when no estimate sits on it
                          radius={(r.inProgress && r["Still needed"] ? [0, 0, 0, 0] : [4, 4, 0, 0]) as unknown as number}
                        />
                      ))}
                    </Bar>
                    <Bar dataKey="Still needed" hide={tFc.hide("Still needed")} stackId="m" maxBarSize={26} isAnimationActive={false} fill="#E9E3DA" stroke="#C9BFAF" strokeDasharray="3 2" radius={[4, 4, 0, 0]} />
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
      <CommandCenterSections period={period} sections={["customers"]} />

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
                    onClick={() => { setStateFilter((cur) => (cur === st.state ? null : st.state)); setSaleDrill({ kind: "state", key: st.state }); }}
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
                  <p key={c.category} className="cursor-pointer text-[12px] flex items-baseline gap-2 hover:bg-[#FAF8F4]" onClick={() => setSaleDrill({ kind: "category", key: c.category })} title="Click for the products">
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

      {/* Top Sellers last, 10 each with their share of sales (owner 2026-10-17). */}
      <CommandCenterSections period={period} sections={["topSellers"]} />

      {saleDrill && (
        <DashModal
          wide
          title={`${saleDrill.key} · ${periodLabel(period)}`}
          subtitle={`Products sold ${saleDrill.kind === "state" ? "in this state" : "in this category"} · ${formatCurrency(saleDrillRows.reduce((a, r) => a + r.revenueSen, 0))}`}
          onClose={() => setSaleDrill(null)}
        >
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]">
                <th className="py-1.5">Product</th><th className="py-1.5">{saleDrill.kind === "state" ? "Category" : "State"}</th><th className="py-1.5 text-right">Qty</th><th className="py-1.5 text-right">Revenue</th><th className="py-1.5 text-right">Share</th>
              </tr></thead>
              <tbody>
                {(() => { const tot = saleDrillRows.reduce((a, r) => a + r.revenueSen, 0); return saleDrillRows.map((r) => (
                  <tr key={r.sku} className="border-b border-[#F0ECE6]">
                    <td className="py-1.5">{r.name}</td>
                    <td className="py-1.5 text-[#6B7280]">{r.other}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtN(r.qty)}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold">{formatCurrency(r.revenueSen)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[#6B7280]">{tot > 0 ? `${((r.revenueSen / tot) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                )); })()}
              </tbody>
            </table>
          </div>
        </DashModal>
      )}
    </div>
  );
}
