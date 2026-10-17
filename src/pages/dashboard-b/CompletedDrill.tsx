import { dropIdleSundays } from "@/lib/idle-sundays";

// Layer 2 of "Completed" (owner 2026-10-17: layer 1 as simple as possible, the
// detail opens in a popup). Plant Load's Completed row opens this: the totals,
// the average a working day completes — Bedframe and Sofa separately — and the
// day list. No chart and no best day (owner: the list is enough). Same rule as
// the tile — an order counts on the day its LAST job card closes; idle Sundays
// are dropped, a worked Sunday stays.
type Day = { date: string; bedframeUnits: number; sofaSets: number };

export function CompletedDrill({ days, totalBf, totalSofa }: { days: Day[]; totalBf: number; totalSofa: number }) {
  const rows = dropIdleSundays(days, (d) => d.date, (d) => [d.bedframeUnits, d.sofaSets]);
  // Working day = a day anything was completed.
  const worked = rows.filter((d) => d.bedframeUnits + d.sofaSets > 0);
  const n = worked.length;
  const avgBf = n ? worked.reduce((a, d) => a + d.bedframeUnits, 0) / n : 0;
  const avgSofa = n ? worked.reduce((a, d) => a + d.sofaSets, 0) / n : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Bedframe units", totalBf.toLocaleString()],
          ["Sofa sets", totalSofa.toLocaleString()],
          ["Avg bedframe / day", avgBf.toFixed(1)],
          ["Avg sofa / day", avgSofa.toFixed(1)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-[#F7F4EF] px-3 py-2">
            <p className="text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">{l}</p>
            <p className="text-lg font-bold tabular-nums text-[#1F1D1B]">{v}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#9CA3AF]">
        Average over the {n} working day{n === 1 ? "" : "s"} with completions · counted on the day an order's last job card closes.
      </p>
      <div className="max-h-[360px] overflow-y-auto">
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
