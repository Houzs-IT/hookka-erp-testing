// ---------------------------------------------------------------------------
// Finance Overview (owner 2026-10-14 「overview 主要显示…」→「做」): the months
// at a glance — sales orders vs sales invoices, gross and net profit, raw
// material and direct labour as a share of sales, the most-produced models
// (top 5, Sofa and Bedframe apart) — as six charts and one month-by-month
// table, with the receivable / payable aging below. Pointing at a bar, a
// point or a figure shows how it is made (src/lib/overview-trend.ts
// explainMonth; the P&L figures are the P&L page's own). Display only.
//
// Canary review (owner 2026-10-14): amounts on the bars without pointing;
// profit as bars (amount) + a line (% of sales); raw materials explained per
// material; grid lines on every tick; rank apart from the model number; a
// calmer month table (sections, amount and % in one cell, top model only).
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
// Bar labels in RM, one decimal: 407.5k, (73.7k).
const compactLabel = (v: unknown) => {
  if (typeof v !== "number" || v === 0) return "";
  const a = Math.abs(v);
  const text = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}M` : a >= 1_000 ? `${(a / 1_000).toFixed(1)}k` : a.toFixed(0);
  return v < 0 ? `(${text})` : text;
};
const pctLabel = (v: unknown) => (typeof v === "number" ? fmtPct(v) : "");
const rm = (sen: number | null | undefined) => (sen === null || sen === undefined ? null : sen / 100);
const pctOrNull = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

// Chart colours — palette E (owner 2026-10-14: navy + teal + gold).
const C = {
  order: "#D9BE85",
  invoice: "#1F3B63",
  profit: "#2A9D8F",
  loss: "#D9534F",
  line: "#1F2A44",
  rmLine: "#C9A15E",
  dlLine: "#1F3B63",
  sofa: "#1F3B63",
  bed: "#2A9D8F",
};
const axisTick = { fontSize: 11, fill: "#5F6B7A" };
// Bars and lines draw in half a second (recharts' 1.5 s default reads as slow).
const ANIM = 500;

// ---- "How this figure is made" ---------------------------------------------

function ExplainBox({ title, lines }: { title: string; lines: ExplainLine[] }) {
  return (
    <div className="min-w-[17rem] max-w-[24rem] rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-xs text-[#1F1D1B] shadow-lg">
      <div className="mb-1 font-semibold">{title}</div>
      <table data-col-resize="off" className="w-full">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={l.total ? "border-t border-[#E2DDD8] font-semibold" : ""}>
              <td className="py-0.5 pr-3 text-[#4B5563]">
                {l.label}
                {l.note && <span className="block text-[10px] font-normal text-[#9CA3AF]">{l.note}</span>}
              </td>
              <td className="py-0.5 text-right align-top tabular-nums">
                {l.sen !== undefined ? <Amount sen={l.sen} /> : l.pct !== undefined && l.pct !== null ? fmtPct(l.pct) : l.pct === null ? "—" : ""}
              </td>
              <td className="w-14 py-0.5 pl-2 text-right align-top tabular-nums text-[#6B7280]">
                {l.sen !== undefined && l.pct !== undefined ? (l.pct === null ? "—" : fmtPct(l.pct)) : ""}
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
      className={block ? "block cursor-help" : "-mx-1 inline-block cursor-help rounded px-1 hover:bg-[#F0ECE9]"}
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
        <div className="mt-2 h-48">{children}</div>
      </CardContent>
    </Card>
  );
}

function TopList({ title, items, color }: { title: string; items: ModelQty[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.qty));
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-[#9CA3AF]">Nothing completed</div>
      ) : (
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li key={it.model} className="text-xs" title={`${it.qty} made on ${it.orders} production order${it.orders === 1 ? "" : "s"}`}>
              <div className="flex items-center gap-2">
                {/* The rank in a small grey circle, so it never reads as part of a model number. */}
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#F0ECE9] text-[9px] font-semibold text-[#6B7280]">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-[#1F1D1B]">{it.model}</span>
                <span className="shrink-0 tabular-nums text-[#4B5563]">{it.qty} <span className="text-[10px] text-[#9CA3AF]">pcs</span></span>
              </div>
              <div className="ml-6 mt-1 h-1.5 rounded bg-[#F0ECE9]">
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
          <div className="text-[11px] text-[#9CA3AF]">pieces completed</div>
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
        <div className="mt-3 grid grid-cols-2 gap-5">
          <TopList title="Sofa" items={m.top.SOFA} color={C.sofa} />
          <TopList title="Bedframe" items={m.top.BEDFRAME} color={C.bed} />
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
                    <span className="font-medium text-[#1F1D1B]"><Amount sen={b.amountSen} /></span>
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

// ---- The month-by-month table ------------------------------------------------

type TableRow = { label: string; strong?: boolean; render: (m: OverviewMonth) => ReactNode };

// A section heading row followed by its rows.
function SectionRows({ title, span, children }: { title: string; span: number; children: ReactNode }) {
  return (
    <>
      <tr className="bg-[#FAF8F4]">
        <td colSpan={span} className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#6B5C32]">{title}</td>
      </tr>
      {children}
    </>
  );
}

function MonthTable({ months }: { months: OverviewMonth[] }) {
  // Newest month first (as the Monthly P&L reads).
  const cols = [...months].reverse();
  const hover = (m: OverviewMonth, metric: OverviewMetric, body: ReactNode) => (
    <HoverDetail detail={<ExplainBox title={monthTitle(m)} lines={explainMonth(m, metric)} />}>{body}</HoverDetail>
  );
  // An amount with its share beside it, small and grey.
  const withPct = (sen: number, pct: number | null) => (
    <span className="inline-flex items-baseline justify-end gap-2">
      <Amount sen={sen} />
      <span className="w-12 text-right text-[11px] font-normal text-[#9CA3AF]">{pct === null ? "—" : fmtPct(pct)}</span>
    </span>
  );
  const top1 = (items: ModelQty[]) =>
    items.length ? <span><span className="font-semibold">{items[0].model}</span> <span className="text-[11px] text-[#9CA3AF]">· {items[0].qty} pcs</span></span> : "—";
  const sections: { title: string; rows: TableRow[] }[] = [
    {
      title: "Sales",
      rows: [
        { label: "Sales orders", render: (m) => hover(m, "orders", <Amount sen={m.so.sen} />) },
        { label: "Sales invoices · % of orders", render: (m) => hover(m, "orders", withPct(m.inv.sen, m.so.sen > 0 ? (m.inv.sen / m.so.sen) * 100 : null)) },
      ],
    },
    {
      title: "Profit · % of sales",
      rows: [
        { label: "Net sales", render: (m) => (m.pnl ? <Amount sen={m.pnl.netSalesSen} /> : "—") },
        { label: "Gross profit", strong: true, render: (m) => (m.pnl ? hover(m, "gp", withPct(m.pnl.grossProfitSen, shareOfSales(m.pnl.grossProfitSen, m.pnl.netSalesSen))) : "—") },
        { label: "Net profit", strong: true, render: (m) => (m.pnl ? hover(m, "np", withPct(m.pnl.netProfitSen, shareOfSales(m.pnl.netProfitSen, m.pnl.netSalesSen))) : "—") },
      ],
    },
    {
      title: "Cost · % of sales",
      rows: [
        { label: "Raw materials", render: (m) => (m.pnl ? hover(m, "rm", withPct(m.pnl.rm.usedSen, shareOfSales(m.pnl.rm.usedSen, m.pnl.netSalesSen))) : "—") },
        { label: "Direct labour", render: (m) => (m.pnl ? hover(m, "dl", withPct(m.pnl.labourSen, shareOfSales(m.pnl.labourSen, m.pnl.netSalesSen))) : "—") },
      ],
    },
    {
      title: "Most produced · top model",
      rows: [
        { label: "Sofa", render: (m) => top1(m.top.SOFA) },
        { label: "Bedframe", render: (m) => top1(m.top.BEDFRAME) },
      ],
    },
  ];
  return (
    <Card className="w-fit max-w-full">
      <CardContent className="overflow-x-auto p-0">
        <table data-col-resize="first" className="text-sm">
          <thead>
            <tr>
              <th className="w-56 px-4 py-2 text-left">Month by month</th>
              {cols.map((m) => (
                <th key={m.ym} className="w-52 px-4 py-2 text-right">{monthShort(m.ym)}{m.running ? " · so far" : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => (
              <SectionRows key={sec.title} title={sec.title} span={cols.length + 1}>
                {sec.rows.map((r) => (
                  <tr key={r.label} className={`border-t border-[#F0ECE9] ${r.strong ? "font-semibold" : ""}`}>
                    <td className="px-4 py-1.5 pl-6 text-[#4B5563]">{r.label}</td>
                    {cols.map((m) => (
                      <td key={m.ym} className="px-4 py-1.5 text-right tabular-nums">{r.render(m)}</td>
                    ))}
                  </tr>
                ))}
              </SectionRows>
            ))}
          </tbody>
        </table>
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
  type Point = (typeof data)[number];
  const sub = last ? `${monthLong(last.ym)}${last.running ? " so far" : ""}` : "";
  const lp = last?.pnl;
  const ofSales = (sen: number | undefined) => (lp && sen !== undefined ? shareOfSales(sen, lp.netSalesSen) : null);
  const pctCell = (v: number | null) => (v === null ? "—" : fmtPct(v));
  // Round ticks through 0, with room for the labels (niceAxis) — the % axes too.
  const nums = (key: keyof Point) => data.map((d) => (typeof d[key] === "number" ? (d[key] as number) : 0));
  const ordersAxis = niceAxis([...nums("so"), ...nums("inv")]);
  const gpAxis = niceAxis(nums("gp"));
  const npAxis = niceAxis(nums("np"));
  const gpPctAxis = niceAxis(nums("gpPct"), 1.3, 1.5);
  const npPctAxis = niceAxis(nums("npPct"), 1.3, 1.5);
  const rmPctAxis = niceAxis(nums("rmPct"), 1.3);
  const dlPctAxis = niceAxis(nums("dlPct"), 1.3);

  const arRows: AgingRow[] = arData.map((a) => ({ name: a.customerName, currentSen: a.currentSen, days30Sen: a.days30Sen, days60Sen: a.days60Sen, days90Sen: a.days90Sen, over90Sen: a.over90Sen }));
  const apRows: AgingRow[] = apData.map((a) => ({ name: a.supplierName, currentSen: a.currentSen, days30Sen: a.days30Sen, days60Sen: a.days60Sen, days90Sen: a.days90Sen, over90Sen: a.over90Sen }));

  // Profit: bars for the amount (labelled inside), a line for the share of sales (owner: 「line graph + diagram graph」).
  const profitChart = (key: "gp" | "np", pctKey: "gpPct" | "npPct", axis: ReturnType<typeof niceAxis>, pctAxis: ReturnType<typeof niceAxis>, metric: OverviewMetric) => (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#EEF1F5" syncWithTicks />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis yAxisId="amt" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={compact} width={44} domain={axis.domain} ticks={axis.ticks} />
        <YAxis yAxisId="pct" orientation="right" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={40} domain={pctAxis.domain} ticks={pctAxis.ticks} />
        <Tooltip cursor={{ fill: "#F2F4F7" }} content={chartTip(byYm, metric)} />
        <Bar yAxisId="amt" dataKey={key} name="Amount" radius={[3, 3, 0, 0]} animationDuration={ANIM} maxBarSize={56}>
          {data.map((d) => <Cell key={d.ym} fill={(d[key] ?? 0) < 0 ? C.loss : C.profit} />)}
          {/* The amount sits by the zero line — the % line follows the bar ends. */}
          <LabelList dataKey={key} position="insideBottom" formatter={(v: unknown) => (typeof v === "number" && v > 0 ? compactLabel(v) : "")} style={{ fontSize: 10, fill: "#FFFFFF", fontWeight: 600 }} />
          <LabelList dataKey={key} position="insideTop" formatter={(v: unknown) => (typeof v === "number" && v < 0 ? compactLabel(v) : "")} style={{ fontSize: 10, fill: "#FFFFFF", fontWeight: 600 }} />
        </Bar>
        <Line yAxisId="pct" type="monotone" dataKey={pctKey} name="% of sales" stroke={C.line} strokeWidth={1.5} dot={{ r: 3, fill: "#FFFFFF" }} animationDuration={ANIM} connectNulls>
          <LabelList dataKey={pctKey} position="top" formatter={pctLabel} style={{ fontSize: 10, fill: C.line, fontWeight: 600, paintOrder: "stroke", stroke: "#FFFFFF", strokeWidth: 3 }} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
  const pctChart = (key: "rmPct" | "dlPct", axis: ReturnType<typeof niceAxis>, color: string, name: string, metric: OverviewMetric) => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#EEF1F5" syncWithTicks />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} padding={{ left: 28, right: 28 }} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} width={40} domain={axis.domain} ticks={axis.ticks} />
        <Tooltip content={chartTip(byYm, metric)} />
        <Line type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={2} dot={{ r: 3 }} animationDuration={ANIM} connectNulls>
          <LabelList dataKey={key} position="top" offset={8} formatter={pctLabel} style={{ fontSize: 10, fill: "#475467", fontWeight: 600 }} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );

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
                <BarChart data={data} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#EEF1F5" syncWithTicks />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={compact} width={44} domain={ordersAxis.domain} ticks={ordersAxis.ticks} />
                  <Tooltip cursor={{ fill: "#F2F4F7" }} content={chartTip(byYm, "orders")} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                  {/* The amounts show on the bars without pointing (owner 2026-10-14). */}
                  <Bar dataKey="so" name="Sales orders" fill={C.order} radius={[3, 3, 0, 0]} animationDuration={ANIM} maxBarSize={44}>
                    <LabelList dataKey="so" position="top" formatter={compactLabel} style={{ fontSize: 10, fill: "#475467" }} />
                  </Bar>
                  <Bar dataKey="inv" name="Sales invoices" fill={C.invoice} radius={[3, 3, 0, 0]} animationDuration={ANIM} maxBarSize={44}>
                    <LabelList dataKey="inv" position="top" formatter={compactLabel} style={{ fontSize: 10, fill: "#475467" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Gross profit · % of sales"
              sub={sub}
              headline={lp ? <><Amount sen={lp.grossProfitSen} /> <span className="text-xs font-normal text-[#6B7280]">{pctCell(ofSales(lp.grossProfitSen))} of sales</span></> : "—"}
            >
              {profitChart("gp", "gpPct", gpAxis, gpPctAxis, "gp")}
            </ChartCard>

            <ChartCard
              title="Net profit · % of sales"
              sub={sub}
              headline={lp ? <><Amount sen={lp.netProfitSen} /> <span className="text-xs font-normal text-[#6B7280]">{pctCell(ofSales(lp.netProfitSen))} of sales</span></> : "—"}
            >
              {profitChart("np", "npPct", npAxis, npPctAxis, "np")}
            </ChartCard>

            <ChartCard
              title="Raw material cost, of sales"
              sub={sub}
              headline={lp ? <>{pctCell(ofSales(lp.rm.usedSen))} <span className="text-xs font-normal text-[#6B7280]"><Amount sen={lp.rm.usedSen} /> used</span></> : "—"}
            >
              {pctChart("rmPct", rmPctAxis, C.rmLine, "Raw material cost", "rm")}
            </ChartCard>

            <ChartCard
              title="Direct labour, of sales"
              sub={sub}
              headline={lp ? <>{pctCell(ofSales(lp.labourSen))} <span className="text-xs font-normal text-[#6B7280]"><Amount sen={lp.labourSen} /> labour</span></> : "—"}
            >
              {pctChart("dlPct", dlPctAxis, C.dlLine, "Direct labour", "dl")}
            </ChartCard>

            {months.length > 0 && <TopModelsCard months={months} />}
          </div>

          <MonthTable months={months} />
        </>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AgingCard title="Accounts Receivable Aging" icon={<TrendingUp className="h-5 w-5 text-[#6B5C32]" />} rows={arRows} barColor="bg-[#6B5C32]" party="customer" />
        <AgingCard title="Accounts Payable Aging" icon={<TrendingDown className="h-5 w-5 text-[#6B5C32]" />} rows={apRows} barColor="bg-[#9C6F1E]" party="supplier" />
      </div>
    </div>
  );
}
