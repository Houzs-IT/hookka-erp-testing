// ---------------------------------------------------------------------------
// Finance Overview (owner 2026-10-14 「overview 主要显示…」→「做」): the months
// at a glance — sales orders vs sales invoices, gross and net profit, raw
// material and direct labour as a share of sales, the most-produced models
// (top 5, Sofa and Bedframe apart) — as six charts and one month-by-month
// table, with the receivable / payable aging below. Pointing at a bar, a
// point or a figure shows how it is made (src/lib/overview-trend.ts
// explainMonth; the P&L figures are the P&L page's own). Display only.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Amount } from "@/components/finance/amount";
import { useCachedJson } from "@/lib/cached-fetch";
import { fmtPct } from "@/lib/finance-money";
import {
  explainMonth,
  niceAxis,
  shareOfSales,
  type ExplainLine,
  type ModelQty,
  type OverviewMetric,
  type OverviewMonth,
} from "@/lib/overview-trend";
import type { APAgingEntry, ARAgingEntry } from "@/types";

const RANGES = [3, 6, 12] as const;
type Range = (typeof RANGES)[number];

const monthShort = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " '");
const monthLong = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
// Axis ticks in RM: 150k, 1.2M.
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
};
const rm = (sen: number | null | undefined) => (sen === null || sen === undefined ? null : sen / 100);
const pctOrNull = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

// ---- "How this figure is made" ---------------------------------------------

function ExplainBox({ title, lines }: { title: string; lines: ExplainLine[] }) {
  return (
    <div className="min-w-[16rem] max-w-[22rem] rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-xs text-[#1F1D1B] shadow-lg">
      <div className="mb-1 font-semibold">{title}</div>
      <table data-col-resize="off" className="w-full">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={l.total ? "border-t border-[#E2DDD8] font-semibold" : ""}>
              <td className="py-0.5 pr-3 text-[#4B5563]">
                {l.label}
                {l.note && <span className="block text-[10px] font-normal text-[#9CA3AF]">{l.note}</span>}
              </td>
              <td className="py-0.5 text-right tabular-nums">
                {l.sen !== undefined ? <Amount sen={l.sen} /> : l.pct !== undefined ? (l.pct === null ? "—" : fmtPct(l.pct)) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const monthTitle = (m: OverviewMonth) => `${monthLong(m.ym)}${m.running ? " · so far" : ""}`;

/**
 * Shows `detail` next to its trigger while the pointer is on it; a tap toggles
 * it (a phone has no hover). Drawn in a layer of its own so a scrolling table
 * cannot clip it.
 */
function HoverDetail({ children, detail, block = false }: { children: ReactNode; detail: ReactNode; block?: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);
  const Tag = block ? "div" : "span";
  return (
    <Tag
      ref={(el: HTMLElement | null) => { ref.current = el; }}
      className={block ? "block cursor-help" : "inline-block cursor-help underline decoration-dotted decoration-[#C9C2B9] underline-offset-2"}
      onMouseEnter={show}
      onMouseLeave={() => setAt(null)}
      onClick={() => (at ? setAt(null) : show())}
    >
      {children}
      {at && createPortal(
        <div className="pointer-events-none fixed z-[60]" style={{ top: at.top, right: at.right }}>{detail}</div>,
        document.body,
      )}
    </Tag>
  );
}

// recharts hands the hovered point to the tooltip; the month's lines are ours.
function chartTip(byYm: Map<string, OverviewMonth>, metric: OverviewMetric) {
  return function Tip(props: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
    const ym = (props.payload?.[0]?.payload as { ym?: string } | undefined)?.ym;
    const m = ym ? byYm.get(ym) : undefined;
    if (!props.active || !m) return null;
    return <ExplainBox title={monthTitle(m)} lines={explainMonth(m, metric)} />;
  };
}

// ---- The six charts ---------------------------------------------------------

function ChartCard({ title, headline, sub, children }: { title: string; headline: ReactNode; sub?: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{title}</div>
          {sub && <div className="truncate text-[11px] text-[#9CA3AF]">{sub}</div>}
        </div>
        <div className="mt-1 text-lg font-bold tabular-nums text-[#1F1D1B]">{headline}</div>
        <div className="mt-2 h-44">{children}</div>
      </CardContent>
    </Card>
  );
}

const axisTick = { fontSize: 11, fill: "#6B7280" };

function TopList({ title, items, color }: { title: string; items: ModelQty[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.qty));
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-[#9CA3AF]">Nothing completed</div>
      ) : (
        <ol className="space-y-1.5">
          {items.map((it, i) => (
            <li key={it.model} className="text-xs" title={`${it.qty} made on ${it.orders} production order${it.orders === 1 ? "" : "s"}`}>
              <div className="flex justify-between gap-2">
                <span className="truncate">{i + 1}. {it.model}</span>
                <span className="font-semibold tabular-nums">{it.qty}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded bg-[#F0ECE9]">
                <div className="h-full rounded" style={{ width: `${(it.qty / max) * 100}%`, background: color }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TopModelsCard({ months }: { months: OverviewMonth[] }) {
  const [ym, setYm] = useState<string | null>(null);
  const m = months.find((x) => x.ym === ym) ?? months[months.length - 1];
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Most produced models · top 5</div>
          <div className="text-[11px] text-[#9CA3AF]">units completed</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {months.map((x) => (
            <button
              key={x.ym}
              type="button"
              onClick={() => setYm(x.ym)}
              className={`cursor-pointer rounded-md border px-2 py-0.5 text-[11px] ${x.ym === m.ym ? "border-[#6B5C32] bg-[#6B5C32] text-white" : "border-[#E2DDD8] bg-white text-[#4B5563] hover:bg-[#F0ECE9]"}`}
            >
              {monthShort(x.ym)}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <TopList title="Sofa" items={m.top.SOFA} color="#6B5C32" />
          <TopList title="Bedframe" items={m.top.BEDFRAME} color="#3E6570" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Aging, with who makes up each bucket -----------------------------------

type AgingRow = { name: string; currentSen: number; days30Sen: number; days60Sen: number; days90Sen: number; over90Sen: number };
const BUCKETS: { period: string; key: keyof Omit<AgingRow, "name"> }[] = [
  { period: "Current", key: "currentSen" },
  { period: "1 month", key: "days30Sen" },
  { period: "2 months", key: "days60Sen" },
  { period: "3 months", key: "days90Sen" },
  { period: "3+ months", key: "over90Sen" },
];
const PARTY_LINES = 8;

function AgingCard({ title, icon, rows, barColor, party }: { title: string; icon: ReactNode; rows: AgingRow[]; barColor: string; party: string }) {
  const buckets = BUCKETS.map((b) => ({
    period: b.period,
    amountSen: rows.reduce((s, r) => s + r[b.key], 0),
    parties: rows.filter((r) => r[b.key] !== 0).map((r) => ({ name: r.name, sen: r[b.key] })).sort((a, c) => c.sen - a.sen),
  }));
  const total = buckets.reduce((s, b) => s + b.amountSen, 0);
  // The parties behind a bucket: the largest first, the rest on one line.
  const detail = (b: (typeof buckets)[number]) => {
    const shown = b.parties.slice(0, PARTY_LINES);
    const rest = b.parties.slice(PARTY_LINES);
    const lines: ExplainLine[] = shown.map((p) => ({ label: p.name, sen: p.sen }));
    if (rest.length) lines.push({ label: `${rest.length} more ${party}${rest.length === 1 ? "" : "s"}`, sen: rest.reduce((s, p) => s + p.sen, 0) });
    lines.push({ label: `= ${b.period}`, sen: b.amountSen, total: true });
    return <ExplainBox title={`${title.replace(" Aging", "")} · ${b.period}`} lines={b.parties.length ? lines : [{ label: `No ${party} in this bucket` }]} />;
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {buckets.map((b) => {
            const pct = total > 0 ? Math.round((b.amountSen / total) * 100) : 0;
            return (
              <HoverDetail key={b.period} block detail={detail(b)}>
                <div className="space-y-1 rounded-md px-1 py-0.5 hover:bg-[#FAF8F5]">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#4B5563]">{b.period}</span>
                    <span className="font-medium text-[#1F1D1B] underline decoration-dotted decoration-[#C9C2B9] underline-offset-2"><Amount sen={b.amountSen} /></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#F0ECE9]">
                    <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.max(0, pct)}%` }} />
                  </div>
                </div>
              </HoverDetail>
            );
          })}
          <div className="flex items-center justify-between border-t border-[#E2DDD8] pt-2 text-sm font-semibold">
            <span className="text-[#1F1D1B]">Total</span>
            <span className="text-[#1F1D1B]"><Amount sen={total} /></span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- The tab ------------------------------------------------------------------

export function OverviewTab({ arData, apData }: { arData: ARAgingEntry[]; apData: APAgingEntry[] }) {
  const [range, setRange] = useState<Range>(3);
  const { data: resp, loading } = useCachedJson<{ success?: boolean; data?: { months: OverviewMonth[]; runningYm: string } }>(
    `/api/accounting/overview-trend?months=${range}`,
  );
  const months = resp?.success ? resp.data?.months ?? [] : [];
  const byYm = new Map(months.map((m) => [m.ym, m]));
  const last = months[months.length - 1];
  const data = months.map((m) => {
    const p = m.pnl;
    return {
      ym: m.ym,
      label: monthShort(m.ym),
      so: rm(m.so.sen),
      inv: rm(m.inv.sen),
      gp: rm(p?.grossProfitSen),
      np: rm(p?.netProfitSen),
      gpPct: p ? pctOrNull(shareOfSales(p.grossProfitSen, p.netSalesSen)) : null,
      npPct: p ? pctOrNull(shareOfSales(p.netProfitSen, p.netSalesSen)) : null,
      rmPct: p ? pctOrNull(shareOfSales(p.rm.usedSen, p.netSalesSen)) : null,
      dlPct: p ? pctOrNull(shareOfSales(p.labourSen, p.netSalesSen)) : null,
    };
  });
  const pctLabel = (v: unknown) => (typeof v === "number" ? fmtPct(v) : "");
  // Round ticks through 0, with room for the bars' labels (niceAxis).
  const ordersAxis = niceAxis(data.flatMap((d) => [d.so ?? 0, d.inv ?? 0]));
  const gpAxis = niceAxis(data.map((d) => d.gp ?? 0));
  const npAxis = niceAxis(data.map((d) => d.np ?? 0));
  const sub = last ? `${monthLong(last.ym)}${last.running ? " so far" : ""}` : "";
  const lp = last?.pnl;
  const ofSales = (sen: number | undefined) => (lp && sen !== undefined ? shareOfSales(sen, lp.netSalesSen) : null);

  const arRows: AgingRow[] = arData.map((a) => ({ name: a.customerName, currentSen: a.currentSen, days30Sen: a.days30Sen, days60Sen: a.days60Sen, days90Sen: a.days90Sen, over90Sen: a.over90Sen }));
  const apRows: AgingRow[] = apData.map((a) => ({ name: a.supplierName, currentSen: a.currentSen, days30Sen: a.days30Sen, days60Sen: a.days60Sen, days90Sen: a.days90Sen, over90Sen: a.over90Sen }));

  // Month-by-month table, newest month first (as the Monthly P&L reads).
  const cols = [...months].reverse();
  const cell = (m: OverviewMonth, metric: OverviewMetric, body: ReactNode) => (
    <HoverDetail detail={<ExplainBox title={monthTitle(m)} lines={explainMonth(m, metric)} />}>{body}</HoverDetail>
  );
  const pctCell = (v: number | null) => (v === null ? "—" : fmtPct(v));
  const topText = (items: ModelQty[]) => (items.length ? items.map((i) => `${i.model} ×${i.qty}`).join(" · ") : "—");
  const tableRows: { label: string; strong?: boolean; render: (m: OverviewMonth) => ReactNode }[] = [
    { label: "Sales orders", render: (m) => cell(m, "orders", <Amount sen={m.so.sen} />) },
    { label: "Sales invoices", render: (m) => cell(m, "orders", <Amount sen={m.inv.sen} />) },
    { label: "Invoiced, of the orders", render: (m) => pctCell(m.so.sen > 0 ? (m.inv.sen / m.so.sen) * 100 : null) },
    { label: "Net sales", render: (m) => (m.pnl ? cell(m, "gp", <Amount sen={m.pnl.netSalesSen} />) : "—") },
    { label: "Gross profit", strong: true, render: (m) => (m.pnl ? cell(m, "gp", <Amount sen={m.pnl.grossProfitSen} />) : "—") },
    { label: "Gross profit, of sales", render: (m) => (m.pnl ? cell(m, "gp", pctCell(shareOfSales(m.pnl.grossProfitSen, m.pnl.netSalesSen))) : "—") },
    { label: "Net profit", strong: true, render: (m) => (m.pnl ? cell(m, "np", <Amount sen={m.pnl.netProfitSen} />) : "—") },
    { label: "Net profit, of sales", render: (m) => (m.pnl ? cell(m, "np", pctCell(shareOfSales(m.pnl.netProfitSen, m.pnl.netSalesSen))) : "—") },
    { label: "Raw material cost, of sales", render: (m) => (m.pnl ? cell(m, "rm", pctCell(shareOfSales(m.pnl.rm.usedSen, m.pnl.netSalesSen))) : "—") },
    { label: "Direct labour, of sales", render: (m) => (m.pnl ? cell(m, "dl", pctCell(shareOfSales(m.pnl.labourSen, m.pnl.netSalesSen))) : "—") },
    { label: "Most produced · Sofa", render: (m) => <span className="text-xs">{topText(m.top.SOFA)}</span> },
    { label: "Most produced · Bedframe", render: (m) => <span className="text-xs">{topText(m.top.BEDFRAME)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Months shown" className="inline-flex overflow-hidden rounded-md border border-[#E2DDD8] bg-white text-sm">
          {RANGES.map((r, i) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={`cursor-pointer px-3 py-1.5 ${i > 0 ? "border-l border-[#E2DDD8]" : ""} ${range === r ? "bg-[#6B5C32] text-white" : "text-[#4B5563] hover:bg-[#F0ECE9]"}`}
            >
              {r} months
            </button>
          ))}
        </div>
        <span className="text-[11px] text-[#9CA3AF]">Point at a bar, a line or a figure to see how it is made.</span>
      </div>
      {last?.running && (
        <p className="-mt-2 text-[11px] text-[#9C6F1E]">
          {monthLong(last.ym)} is still running — its figures are so far, and recurring costs not recorded yet are at last month&apos;s amount.
        </p>
      )}

      {loading && !months.length ? (
        <div className="py-16 text-center text-sm text-[#6B7280]">Loading…</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ChartCard
              title="Sales orders vs sales invoices"
              sub={sub}
              headline={last ? <><Amount sen={last.inv.sen} /> <span className="text-xs font-normal text-[#6B7280]">invoiced of <Amount sen={last.so.sen} /> ordered</span></> : "—"}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE9" />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={compact} width={44} domain={ordersAxis.domain} ticks={ordersAxis.ticks} />
                  <Tooltip cursor={{ fill: "#F7F4EF" }} content={chartTip(byYm, "orders")} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                  <Bar dataKey="so" name="Sales orders" fill="#C9B98F" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="inv" name="Sales invoices" fill="#6B5C32" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Gross profit"
              sub={sub}
              headline={lp ? <><Amount sen={lp.grossProfitSen} /> <span className="text-xs font-normal text-[#6B7280]">{pctCell(ofSales(lp.grossProfitSen))} of sales</span></> : "—"}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE9" />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={compact} width={44} domain={gpAxis.domain} ticks={gpAxis.ticks} />
                  <Tooltip cursor={{ fill: "#F7F4EF" }} content={chartTip(byYm, "gp")} />
                  <Bar dataKey="gp" name="Gross profit" radius={[3, 3, 0, 0]}>
                    {data.map((d) => <Cell key={d.ym} fill={(d.gp ?? 0) < 0 ? "#9A3A2D" : "#4F7C3A"} />)}
                    <LabelList dataKey="gpPct" position="top" formatter={pctLabel} style={{ fontSize: 10, fill: "#6B7280" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Net profit"
              sub={sub}
              headline={lp ? <><Amount sen={lp.netProfitSen} /> <span className="text-xs font-normal text-[#6B7280]">{pctCell(ofSales(lp.netProfitSen))} of sales</span></> : "—"}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE9" />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={compact} width={44} domain={npAxis.domain} ticks={npAxis.ticks} />
                  <Tooltip cursor={{ fill: "#F7F4EF" }} content={chartTip(byYm, "np")} />
                  <Bar dataKey="np" name="Net profit" radius={[3, 3, 0, 0]}>
                    {data.map((d) => <Cell key={d.ym} fill={(d.np ?? 0) < 0 ? "#9A3A2D" : "#4F7C3A"} />)}
                    <LabelList dataKey="npPct" position="top" formatter={pctLabel} style={{ fontSize: 10, fill: "#6B7280" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Raw material cost, of sales"
              sub={sub}
              headline={lp ? <>{pctCell(ofSales(lp.rm.usedSen))} <span className="text-xs font-normal text-[#6B7280]"><Amount sen={lp.rm.usedSen} /> used</span></> : "—"}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE9" />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} padding={{ left: 24, right: 24 }} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={40} />
                  <Tooltip content={chartTip(byYm, "rm")} />
                  <Line type="monotone" dataKey="rmPct" name="Raw material cost" stroke="#9C6F1E" strokeWidth={2} dot={{ r: 3 }} connectNulls>
                    <LabelList dataKey="rmPct" position="top" formatter={pctLabel} style={{ fontSize: 10, fill: "#6B7280" }} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Direct labour, of sales"
              sub={sub}
              headline={lp ? <>{pctCell(ofSales(lp.labourSen))} <span className="text-xs font-normal text-[#6B7280]"><Amount sen={lp.labourSen} /> labour</span></> : "—"}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE9" />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} padding={{ left: 24, right: 24 }} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={40} />
                  <Tooltip content={chartTip(byYm, "dl")} />
                  <Line type="monotone" dataKey="dlPct" name="Direct labour" stroke="#6B4A6D" strokeWidth={2} dot={{ r: 3 }} connectNulls>
                    <LabelList dataKey="dlPct" position="top" formatter={pctLabel} style={{ fontSize: 10, fill: "#6B7280" }} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {months.length > 0 && <TopModelsCard months={months} />}
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table data-col-resize="first" className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">Month by month</th>
                    {cols.map((m) => (
                      <th key={m.ym} className="px-3 py-2 text-right">{monthShort(m.ym)}{m.running ? " ·" : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.label} className={`border-t border-[#F0ECE9] ${r.strong ? "font-semibold" : ""}`}>
                      <td className="px-3 py-1.5 text-[#4B5563]">{r.label}</td>
                      {cols.map((m) => (
                        <td key={m.ym} className="px-3 py-1.5 text-right tabular-nums">{r.render(m)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {cols.some((m) => m.running) && (
                <p className="px-3 pb-2 pt-1 text-[11px] text-[#9CA3AF]">· the month is still running.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AgingCard title="Accounts Receivable Aging" icon={<TrendingUp className="h-5 w-5 text-[#6B5C32]" />} rows={arRows} barColor="bg-[#6B5C32]" party="customer" />
        <AgingCard title="Accounts Payable Aging" icon={<TrendingDown className="h-5 w-5 text-[#6B5C32]" />} rows={apRows} barColor="bg-[#9C6F1E]" party="supplier" />
      </div>
    </div>
  );
}

