// ===========================================================================
// Dashboard B — chart components, split into a lazily-loaded chunk.
//
// recharts (+ d3) is ~357 KB — by far the biggest dependency on the dashboard.
// Keeping it behind React.lazy here means the dashboard's KPI numbers paint
// from the small page chunk first, and this chart code streams in behind a
// placeholder (see <Suspense> in ./index.tsx). Same charts, same data, same
// look — only the LOAD ORDER changes. The two components and their tooltip /
// label helpers were moved here verbatim from index.tsx; colours + computed
// data come in as props so the parent keeps owning the numbers.
// ===========================================================================
import type React from "react";
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  ReferenceLine,
  Line,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

const rm = (sen: number | undefined) => formatCurrency(sen ?? 0);

// Revenue area-chart tooltip (moved verbatim from index.tsx).
function RevTooltip(props: {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number | string; color?: string }[];
}) {
  if (!props.active || !props.payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E2DDD8] bg-white px-3 py-2 shadow-md text-xs">
      <div className="font-semibold text-[#5A5550] mb-1">{props.label}</div>
      {props.payload.map((p) => (
        <div
          key={p.name}
          className="flex items-center justify-between gap-5 py-0.5"
        >
          <span style={{ color: p.color }}>● {p.name}</span>
          <span className="font-semibold text-[#1F1D1B] tabular-nums">
            {rm(Number(p.value) * 100)}
          </span>
        </div>
      ))}
    </div>
  );
}

export type RevChartRow = {
  m: string;
  "Sales Orders": number;
  Invoices: number;
  Production: number;
};

export function RevenueChart({
  data,
  hiddenSeries,
  cSO,
  cProd,
  cInv,
}: {
  data: RevChartRow[];
  hiddenSeries: Set<string>;
  cSO: string;
  cProd: string;
  cInv: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="bSO" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cSO} stopOpacity={0.22} />
            <stop offset="100%" stopColor={cSO} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="bPR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cProd} stopOpacity={0.2} />
            <stop offset="100%" stopColor={cProd} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="m"
          tick={{ fill: "#9CA3AF", fontSize: 11 }}
          axisLine={{ stroke: "#F0ECE6" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          tick={{ fill: "#9CA3AF", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={38}
        />
        <Tooltip content={<RevTooltip />} cursor={{ stroke: "#E2DDD8" }} />
        <Area
          type="monotone"
          dataKey="Sales Orders"
          stroke={cSO}
          strokeWidth={2}
          fill="url(#bSO)"
          isAnimationActive={false}
          dot={false}
          hide={hiddenSeries.has("Sales Orders")}
        />
        <Area
          type="monotone"
          dataKey="Production"
          stroke={cProd}
          strokeWidth={2}
          fill="url(#bPR)"
          isAnimationActive={false}
          dot={false}
          hide={hiddenSeries.has("Production")}
        />
        <Area
          type="monotone"
          dataKey="Invoices"
          stroke={cInv}
          strokeWidth={1.75}
          fill="none"
          strokeDasharray="4 3"
          isAnimationActive={false}
          dot={false}
          hide={hiddenSeries.has("Invoices")}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Donut leader-line label — customer name + share % pointing at the slice.
interface PieLabelArg {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  percent?: number;
  index?: number;
  name?: string | number;
}

export type PieDatum = { name: string; value: number };

export function CustomerPieChart({
  data,
  pieColors,
  totalCustRev,
}: {
  data: PieDatum[];
  pieColors: string[];
  totalCustRev: number;
}) {
  const renderPieLabel = (a: PieLabelArg): React.ReactElement => {
    const RAD = Math.PI / 180;
    const cx = a.cx ?? 0;
    const cy = a.cy ?? 0;
    const mid = a.midAngle ?? 0;
    const oR = a.outerRadius ?? 0;
    const cos = Math.cos(-mid * RAD);
    const sin = Math.sin(-mid * RAD);
    const sx = cx + oR * cos;
    const sy = cy + oR * sin;
    const mx = cx + (oR + 13) * cos;
    const my = cy + (oR + 13) * sin;
    const right = cos >= 0;
    const ex = mx + (right ? 15 : -15);
    const ey = my;
    const idx = a.index ?? 0;
    const color = pieColors[idx % pieColors.length];
    const nm = String(a.name ?? "");
    const short = nm.length > 15 ? `${nm.slice(0, 14)}…` : nm;
    const pct = ((a.percent ?? 0) * 100).toFixed(0);
    return (
      <g>
        <polyline
          points={`${sx},${sy} ${mx},${my} ${ex},${ey}`}
          stroke={color}
          strokeWidth={1}
          fill="none"
          opacity={0.55}
        />
        <text
          x={ex + (right ? 4 : -4)}
          y={ey}
          textAnchor={right ? "start" : "end"}
          dominantBaseline="central"
          fontSize={10}
          fill="#5A5550"
        >
          {short}
          <tspan fill="#9CA3AF"> {pct}%</tspan>
        </text>
      </g>
    );
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={66}
          outerRadius={104}
          paddingAngle={2}
          stroke="#fff"
          strokeWidth={2}
          isAnimationActive={false}
          labelLine={false}
          label={renderPieLabel}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={pieColors[i % pieColors.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(val, name) => {
            const v = Number(val) || 0;
            return [
              `${rm(v)} · ${((v / Math.max(1, totalCustRev)) * 100).toFixed(1)}%`,
              String(name),
            ];
          }}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #E2DDD8",
            fontSize: 12,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Department Revenue (owner 2026-10-15; small multiples 2026-10-19): one small
// line chart per production department, RM per bucket. All charts share one
// date axis and one y scale, so heights compare directly; hovering any chart
// marks the same day on every chart. Rows: { m, d, <dept label>: RM, … }.
export function DeptRevenueChart({
  data,
  series,
  markDay,
  onPickDay,
}: {
  data: Record<string, number | string>[];
  series: { key: string; color: string }[];
  markDay?: string;
  onPickDay?: (day: string) => void;
}) {
  const [hover, setHover] = useState<string>();
  const max = Math.max(1, ...data.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)));
  const first = data[0]?.m;
  const last = data[data.length - 1]?.m;
  if (series.length === 0)
    return <div className="flex items-center justify-center h-40 text-xs text-[#9CA3AF]">Every department is hidden.</div>;
  return (
    <div>
      <p className="text-[11px] text-[#9CA3AF] mb-1">Same scale on every chart: 0 to {rm(max * 100)}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        {series.map((s) => {
          const peak = data.reduce<Record<string, number | string> | undefined>(
            (p, r) => ((Number(r[s.key]) || 0) > (Number(p?.[s.key]) || 0) ? r : p),
            undefined,
          );
          // Hover wins, then the picked day, so the header matches the table on a day view.
          const at = hover ?? markDay ? data.find((r) => r.m === (hover ?? markDay)) : undefined;
          return (
            <div key={s.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 truncate text-[#1F1D1B]">
                  <span style={{ color: s.color }}>●</span>
                  {s.key}
                </span>
                <span className="shrink-0 tabular-nums text-[#5A5550]">
                  {at
                    ? `${at.m} · ${rm(Math.round((Number(at[s.key]) || 0) * 100))}`
                    : peak
                      ? `peak ${peak.m} · ${rm(Math.round((Number(peak[s.key]) || 0) * 100))}`
                      : "no output"}
                </span>
              </div>
              <div style={{ height: 64 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    margin={{ top: 4, right: 6, bottom: 0, left: 6 }}
                    onMouseMove={(e) => setHover(e?.activeLabel != null ? String(e.activeLabel) : undefined)}
                    onMouseLeave={() => setHover(undefined)}
                    onClick={onPickDay ? (e) => {
                      const hit = data.find((r) => r.m === e?.activeLabel);
                      if (hit) onPickDay(String(hit.d));
                    } : undefined}
                    style={onPickDay ? { cursor: "pointer" } : undefined}
                  >
                    {markDay && <ReferenceLine x={markDay} stroke="#6B5C32" strokeDasharray="3 3" />}
                    {hover && <ReferenceLine x={hover} stroke="#C9C2B8" />}
                    <XAxis
                      dataKey="m"
                      ticks={first && last ? [first, last] : undefined}
                      interval={0}
                      tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
                        <text x={x} y={y} dy="0.71em" textAnchor={payload.value === first ? "start" : "end"} fill="#9CA3AF" fontSize={10}>
                          {payload.value}
                        </text>
                      )}
                      axisLine={{ stroke: "#F0ECE6" }}
                      tickLine={false}
                      height={20}
                    />
                    <YAxis hide domain={[0, max]} />
                    <Tooltip content={() => null} cursor={false} />
                    <Line
                      type="monotone"
                      dataKey={s.key}
                      stroke={peak ? s.color : "#E2DDD8"}
                      strokeWidth={1.75}
                      isAnimationActive={false}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
