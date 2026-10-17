import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useSeriesToggle } from "../dashboards/use-series-toggle";
import { dropIdleSundays } from "@/lib/idle-sundays";

// Layer 2 of "Completed" (owner 2026-10-17: layer 1 as simple as possible, the
// detail opens in a popup). Plant Load's Completed row opens this: the per-day
// chart that used to sit on Output & Cost, the two totals, and the day table.
// Same rule as the tile — an order counts on the day its LAST job card closes;
// idle Sundays are dropped, a worked Sunday stays.
type Day = { date: string; bedframeUnits: number; sofaSets: number };

const TICK = { fontSize: 11, fill: "#9CA3AF" } as const;

export function CompletedDrill({ days, totalBf, totalSofa }: { days: Day[]; totalBf: number; totalSofa: number }) {
  const t = useSeriesToggle();
  const rows = dropIdleSundays(days, (d) => d.date, (d) => [d.bedframeUnits, d.sofaSets]);
  const data = rows.map((d) => ({ date: d.date.slice(5), Bedframe: d.bedframeUnits, Sofa: d.sofaSets }));
  const worked = rows.filter((d) => d.bedframeUnits + d.sofaSets > 0);
  const avg = worked.length ? worked.reduce((a, d) => a + d.bedframeUnits + d.sofaSets, 0) / worked.length : 0;
  const best = worked.reduce<Day | null>((b, d) => (!b || d.bedframeUnits + d.sofaSets > b.bedframeUnits + b.sofaSets ? d : b), null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Bedframe units", totalBf.toLocaleString()],
          ["Sofa sets", totalSofa.toLocaleString()],
          ["Avg / working day", avg.toFixed(1)],
          ["Best day", best ? `${best.date.slice(5)} · ${best.bedframeUnits + best.sofaSets}` : "—"],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-[#F7F4EF] px-3 py-2">
            <p className="text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">{l}</p>
            <p className="text-lg font-bold tabular-nums text-[#1F1D1B]">{v}</p>
          </div>
        ))}
      </div>
      <div style={{ width: "100%", height: 220 }} className="select-none [&_*]:outline-none">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#F0ECE6" />
            <XAxis dataKey="date" tick={TICK} axisLine={{ stroke: "#F0ECE6" }} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(107,92,50,0.06)" }} contentStyle={{ background: "#FFFFFF", border: "1px solid #E2DDD8", borderRadius: 8, fontSize: 12 }} />
            <Legend {...t.legend} />
            <Bar dataKey="Bedframe" hide={t.hide("Bedframe")} stackId="u" fill="#6B5C32" isAnimationActive={false} />
            <Bar dataKey="Sofa" hide={t.hide("Sofa")} stackId="u" fill="#3E6570" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            {avg > 0 && <ReferenceLine y={avg} stroke="#9C6F1E" strokeDasharray="4 3" strokeWidth={1.5} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-[#9CA3AF]">Dashed line = average per working day. Counted on the day an order's last job card closes.</p>
      <div className="max-h-[260px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 bg-white text-left text-xs text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]">
              <th className="py-1.5 font-medium">Date</th>
              <th className="py-1.5 text-right font-medium">Bedframe units</th>
              <th className="py-1.5 text-right font-medium">Sofa sets</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((d) => (
              <tr key={d.date} className="border-b border-[#F0ECE6]">
                <td className="py-1.5 text-[#1F1D1B]">{d.date}</td>
                <td className="py-1.5 text-right tabular-nums">{d.bedframeUnits.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums">{d.sofaSets.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
