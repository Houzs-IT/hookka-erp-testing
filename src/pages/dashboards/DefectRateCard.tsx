import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { defectRates } from "../../api/lib/service-issue-stats";
import { monthsOf } from "./use-production-revenue";
import { useSeriesToggle } from "./use-series-toggle";
import { CC_AXIS_LINE, CC_TICK, fmtN, monthLabel, shiftMonth, ymd, type Period } from "./dashboard-shared-lib";

// ---------------------------------------------------------------------------
// Defect rate (owner 2026-10-17: "defects rate 在 service, 根据出货的数量, 根据
// 不一样 category"). Cases logged in the period ÷ units delivered in the period,
// per product category. Units = finished-goods units scanned DELIVERED
// (bedframe / accessory per unit, sofa per set = sales order). A case counts
// under each category of its affected products; one with no product recorded
// is "Not specified" and has no rate. Read off the service slice of the feed
// (`shipped`, `cases[].productCategories`).
// ---------------------------------------------------------------------------
type Case = { createdDate: string; productCategories?: string[] | null };
type Shipped = { ym: string; category: string; units: number };

const NAME: Record<string, string> = { BEDFRAME: "Bedframe", SOFA: "Sofa", ACCESSORY: "Accessory", UNSPECIFIED: "Not specified (no product on the case)" };

export function DefectRateCard({ cases, shipped, period }: { cases: Case[]; shipped: Shipped[] | undefined; period: Period }) {
  const t = useSeriesToggle();
  const today = ymd(new Date());
  const months = useMemo(() => monthsOf(period, today), [period, today]);
  const rows = useMemo(() => defectRates(cases, shipped ?? [], months), [cases, shipped, months]);
  const total = useMemo(() => {
    const named = rows.filter((r) => r.category !== "UNSPECIFIED");
    const units = named.reduce((a, r) => a + r.units, 0);
    const n = rows.reduce((a, r) => a + r.cases, 0);
    return { units, n, rate: units > 0 ? (n / units) * 100 : null };
  }, [rows]);
  const trend = useMemo(() => {
    const last = months[months.length - 1] ?? today.slice(0, 7);
    return Array.from({ length: 6 }, (_, i) => shiftMonth(last, i - 5)).map((m) => {
      const r = defectRates(cases, shipped ?? [], [m]);
      const units = r.filter((x) => x.category !== "UNSPECIFIED").reduce((a, x) => a + x.units, 0);
      const n = r.reduce((a, x) => a + x.cases, 0);
      return { m: monthLabel(m).slice(0, 3), Cases: n, "Units shipped": units, "Defect rate %": units > 0 ? Math.round((n / units) * 1000) / 10 : null };
    });
  }, [cases, shipped, months, today]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Defect rate · cases per unit shipped</CardTitle>
        <p className="mt-0.5 text-xs text-[#9CA3AF]">
          Service cases logged ÷ units delivered in the period, by product category · units = finished-goods units scanned delivered (sofa counted per set)
        </p>
      </CardHeader>
      <CardContent>
        {!shipped ? (
          <p className="py-6 text-center text-xs text-[#9CA3AF]">Shipped quantities are not in the feed yet — they appear once the server update is live.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <p className="text-3xl font-bold tabular-nums text-[#1F1D1B]">{total.rate == null ? "—" : `${total.rate.toFixed(2)}%`}</p>
              <p className="mb-2 text-xs text-[#6B7280]">{fmtN(total.n)} cases on {fmtN(total.units)} units shipped{total.rate != null ? ` · ${((total.rate / 100) * 1000).toFixed(1)} per 1,000` : ""}</p>
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]"><th className="py-1.5">Category</th><th className="py-1.5 text-right">Cases</th><th className="py-1.5 text-right">Shipped</th><th className="py-1.5 text-right">Rate</th><th className="py-1.5 text-right">Per 1,000</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.category} className="border-b border-[#F0ECE6]">
                      <td className={`py-1.5 ${r.category === "UNSPECIFIED" ? "text-[#9C6F1E]" : "text-[#1F1D1B]"}`}>{NAME[r.category] ?? r.category}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtN(r.cases)}</td>
                      <td className="py-1.5 text-right tabular-nums text-[#6B7280]">{r.category === "UNSPECIFIED" ? "—" : fmtN(r.units)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{r.rate == null ? "—" : `${r.rate.toFixed(2)}%`}</td>
                      <td className="py-1.5 text-right tabular-nums text-[#6B7280]">{r.rate == null ? "—" : (r.rate * 10).toFixed(1)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={5} className="py-5 text-center text-[#6B7280]">No cases or deliveries in this period.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="xl:col-span-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Last 6 months</p>
              <div className="select-none [&_*]:outline-none" style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#F0ECE6" />
                    <XAxis dataKey="m" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} />
                    <YAxis yAxisId="u" tick={CC_TICK} axisLine={false} tickLine={false} width={36} />
                    <YAxis yAxisId="p" orientation="right" tick={CC_TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E2DDD8", borderRadius: 8, fontSize: 12 }} formatter={(v, n) => (n === "Defect rate %" ? [`${v}%`, n] : [v, n])} />
                    <Legend {...t.legend} />
                    <Bar yAxisId="u" dataKey="Units shipped" hide={t.hide("Units shipped")} fill="#E3DCD0" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                    <Bar yAxisId="u" dataKey="Cases" hide={t.hide("Cases")} fill="#9A3A2D" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                    <Line yAxisId="p" type="monotone" dataKey="Defect rate %" hide={t.hide("Defect rate %")} stroke="#6B5C32" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
