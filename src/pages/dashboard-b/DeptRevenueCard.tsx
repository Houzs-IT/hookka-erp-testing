// ===========================================================================
// Department Revenue card (owner 2026-10-15).
//
// Each production department books an order's FULL value the day its last
// card for that order completes — the Production (Upholstery) revenue rule per
// department, computed by GET /api/dashboard/overview/revenue-split (see
// src/api/lib/dept-revenue.ts). So a RM 2,000 sofa through 9 departments
// shows RM 2,000 on each row; balanced output = equal rows.
// ===========================================================================
import { lazy, Suspense, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { dayBucketIndex, pickCat, type CatSplit, type RevCat, type RevenueSplitResp } from "./revenue-split";
import { dayLabel } from "@/pages/dashboards/dashboard-shared-lib";
import { dropIdleSundays } from "@/lib/idle-sundays";

const DeptRevenueChart = lazy(() =>
  import("./charts").then((m) => ({ default: m.DeptRevenueChart })),
);

export function CatToggle({ value, onChange }: { value: RevCat; onChange: (v: RevCat) => void }) {
  return (
    <div className="flex items-center gap-1">
      {(
        [
          ["all", "All"],
          ["bedframe", "Bedframe"],
          ["sofa", "Sofa"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            value === v ? "bg-[#6B5C32] text-white" : "bg-[#F5F2ED] text-[#5A5550] hover:bg-[#EAE5DC]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Ten distinguishable, muted colours in the dashboard's palette family.
const DEPT_COLORS = [
  "#6B5C32",
  "#C9A24B",
  "#8C6D4F",
  "#4B7A52",
  "#3E6570",
  "#9A3A2D",
  "#6B4A6D",
  "#B8601A",
  "#1F1D1B",
  "#A8A29A",
];

const rm = (sen: number) => formatCurrency(sen);
const NONE: CatSplit = { bedframe: 0, sofa: 0, accessory: 0, unclassified: 0, total: 0 };

export function DeptRevenueCard({
  data,
  loading,
  periodLabel,
  day,
  onPickDay,
}: {
  data: RevenueSplitResp | null;
  loading: boolean;
  periodLabel: string;
  // A picked day (Operations Day view): the table shows that day, the chart
  // keeps the whole month and marks it. onPickDay(undefined) = back to the month.
  day?: string;
  onPickDay?: (day: string | undefined) => void;
}) {
  const [cat, setCat] = useState<RevCat>("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const depts = useMemo(() => data?.departments ?? [], [data]);
  const buckets = useMemo(() => (data?.revenue ?? []).map((r) => r.bucket), [data]);
  const colorOf = useMemo(() => new Map(depts.map((d, i) => [d.code, DEPT_COLORS[i % DEPT_COLORS.length]])), [depts]);
  const di = dayBucketIndex(data, day);
  const valueOf = (d: (typeof depts)[number]): CatSplit => (di >= 0 ? d.byBucket[di] ?? NONE : d.period);
  const showAccessory = depts.some((d) => d.period.accessory > 0);
  const maxSel = Math.max(1, ...depts.map((d) => pickCat(valueOf(d), cat)));
  const clickable = !!onPickDay && data?.granularity === "day";

  const chartRows = useMemo(
    () =>
      // A Sunday no department booked anything on is a closed day: left off
      // the axis instead of drawn as a dive to 0 (owner 2026-10-15).
      dropIdleSundays(
        buckets.map((b, i) => ({ b, i })),
        (x) => x.b,
        (x) => depts.map((d) => pickCat(d.byBucket[x.i], cat)),
      ).map(({ b, i }) => {
        const row: Record<string, number | string> = { m: b.slice(5), d: b };
        for (const d of depts) row[d.label] = Math.round(pickCat(d.byBucket[i], cat) / 100);
        return row;
      }),
    [buckets, depts, cat],
  );
  const series = depts
    .filter((d) => !hidden.has(d.code))
    .map((d) => ({ key: d.label, color: colorOf.get(d.code) ?? "#A8A29A" }));

  const toggle = (code: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  return (
    <Card className="bg-white rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <CardContent className="p-5">
        <div className="flex items-end justify-between mb-3 flex-wrap gap-y-2 gap-x-3">
          <div>
            <h3 className="text-sm font-bold text-[#1F1D1B] tracking-[-0.2px]">Department Revenue — {di >= 0 && day ? dayLabel(day) : periodLabel}</h3>
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              Each department books an order's full value when its last card for that order completes (same rule as
              Production) · equal rows = balanced output · click a department to hide its line{clickable ? " · click a day on the chart to see that day" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Hide / show every line at once (owner 2026-10-17: clicking one
                department at a time could not clear them all). */}
            <button type="button" onClick={() => setHidden(new Set())} className="rounded-md px-2.5 py-1 text-xs font-medium bg-[#F5F2ED] text-[#5A5550] hover:bg-[#EAE5DC]">Show all</button>
            <button type="button" onClick={() => setHidden(new Set(depts.map((d) => d.code)))} className="rounded-md px-2.5 py-1 text-xs font-medium bg-[#F5F2ED] text-[#5A5550] hover:bg-[#EAE5DC]">Hide all</button>
            <CatToggle value={cat} onChange={setCat} />
          </div>
        </div>

        {loading && !data ? (
          <div className="h-40 flex items-center justify-center text-xs text-[#9CA3AF]">Loading…</div>
        ) : depts.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-[#9CA3AF]">No department revenue data.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 min-w-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#9CA3AF] border-b border-[#F0ECE6]">
                    <th className="text-left font-medium py-1.5 pr-2">Department</th>
                    <th className="text-right font-medium py-1.5 px-2">Bedframe</th>
                    <th className="text-right font-medium py-1.5 px-2">Sofa</th>
                    {showAccessory && <th className="text-right font-medium py-1.5 px-2">Accessory</th>}
                    <th className="text-right font-medium py-1.5 pl-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {depts.map((d) => {
                    const off = hidden.has(d.code);
                    const v = valueOf(d);
                    const sel = pickCat(v, cat);
                    return (
                      <tr
                        key={d.code}
                        onClick={() => toggle(d.code)}
                        className="border-b border-[#F7F4EF] cursor-pointer hover:bg-[#FAF8F4]"
                        style={{ opacity: off ? 0.45 : 1 }}
                        title={off ? "Show this department's line" : "Hide this department's line"}
                      >
                        <td className="py-1.5 pr-2">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span style={{ color: colorOf.get(d.code) }}>●</span>
                            <span className="text-[#1F1D1B]">{d.label}</span>
                          </div>
                          <div className="mt-1 h-1 rounded bg-[#F5F2ED]">
                            <div
                              className="h-1 rounded"
                              style={{ width: `${(sel / maxSel) * 100}%`, background: colorOf.get(d.code) }}
                            />
                          </div>
                        </td>
                        <td className={`text-right tabular-nums py-1.5 px-2 ${cat === "bedframe" ? "font-semibold text-[#1F1D1B]" : "text-[#5A5550]"}`}>
                          {rm(v.bedframe)}
                        </td>
                        <td className={`text-right tabular-nums py-1.5 px-2 ${cat === "sofa" ? "font-semibold text-[#1F1D1B]" : "text-[#5A5550]"}`}>
                          {rm(v.sofa)}
                        </td>
                        {showAccessory && (
                          <td className="text-right tabular-nums py-1.5 px-2 text-[#5A5550]">{rm(v.accessory)}</td>
                        )}
                        <td className={`text-right tabular-nums py-1.5 pl-2 ${cat === "all" ? "font-semibold text-[#1F1D1B]" : "text-[#5A5550]"}`}>
                          {rm(v.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="lg:col-span-3 min-w-0" style={{ height: 280 }}>
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-xs text-[#9CA3AF]">Loading chart…</div>
                }
              >
                <DeptRevenueChart
                  data={chartRows}
                  series={series}
                  markDay={di >= 0 ? day?.slice(5) : undefined}
                  onPickDay={clickable ? (d) => onPickDay?.(d === day ? undefined : d) : undefined}
                />
              </Suspense>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
