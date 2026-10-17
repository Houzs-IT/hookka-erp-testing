import { useMemo } from "react";
import { useSeriesToggle } from "./use-series-toggle";
import { BarChart, Bar, ComposedChart, CartesianGrid, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  TAUPE, TEAL, BORDER, GREEN, AMBER, RED, CHART_GOLD, fmtN,
  inPeriod, inFocus, periodLabel, previousPeriod, ymd, type Period, CC_TICK, CC_AXIS_LINE } from "./dashboard-shared-lib";
import { Kpi } from "./dashboard-shared";
import { TallyList } from "./ServiceIssuesPanel";
import { ServiceCaseNo } from "./ServiceCaseLink";
import { useServiceCaseLinks } from "./use-service-case-links";
import {
  byPrevention, avgClose, closeTrend, openedVsClosed, agingSplit, preventionNotDone, causeLabel,
  type IssueCase,
} from "../../api/lib/service-issue-stats";

// Service > Performance sub-tab. Reads the `service` slice of the shared
// dashboard feed (api/lib/dashboard-service-slice.ts); maths lives in
// api/lib/service-issue-stats.ts (avgClose, closeTrend, openedVsClosed,
// agingSplit, preventionNotDone) and is unit-tested there.
// Every new field is optional so a feed cached before it shipped still renders.
export type ServicePerformanceCase = IssueCase & {
  id: string;
  caseNo: string | null;
  customer: string | null;
  ageDays: number | null;
  daysOverdue: number;
  preventionOwner?: string | null;
  preventionAction?: string;
};
export type ServicePerformanceSlice = { overdueAfterDays: number; cases: ServicePerformanceCase[] };

const TOOLTIP = { background: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12 };
const CHART_WRAP = "select-none [&_*]:outline-none [&_.recharts-wrapper]:outline-none";
const OPEN = new Set(["OPEN", "IN_PROGRESS"]);
const th = "px-4 py-2 font-semibold uppercase text-[10.5px] tracking-wide text-[#6B7280] whitespace-nowrap";

function delta(cur: number | null, prev: number | null, lowerIsBetter: boolean) {
  if (cur === null || prev === null) return null;
  const d = Math.round((cur - prev) * 10) / 10;
  return { text: `${d > 0 ? "+" : ""}${d} d vs previous period (${prev} d)`, good: d === 0 ? null : (d < 0) === lowerIsBetter };
}

export function ServicePerformancePanel({
  slice, period, onPeriodChange,
}: { slice: ServicePerformanceSlice | null | undefined; period: Period; onPeriodChange: (p: Period) => void }) {
  const cases = useMemo(() => slice?.cases ?? [], [slice]);
  const threshold = slice?.overdueAfterDays ?? 0;
  const ytd = period.mode === "ytd";
  const bucketOf = (d: string) => (ytd ? d.slice(0, 7) : d);
  const { canOpen, rowProps } = useServiceCaseLinks();
  const tClose = useSeriesToggle();
  const tFlow = useSeriesToggle();

  // Closed inside the focused window, and inside the previous comparable period.
  const closedNow = useMemo(() => cases.filter((c) => c.status === "CLOSED" && inFocus(period, c.closedDate)), [cases, period]);
  const closedPrev = useMemo(() => {
    if (period.day || !period.month) return [];
    const first = cases.reduce((m, c) => (c.createdDate < m ? c.createdDate : m), period.month + "-01").slice(0, 7);
    const months: string[] = [];
    for (let y = Number(first.slice(0, 4)), m = Number(first.slice(5)); `${y}-${String(m).padStart(2, "0")}` <= period.month; m === 12 ? (y++, (m = 1)) : m++) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    const prev = previousPeriod(period, months);
    return prev ? cases.filter((c) => c.status === "CLOSED" && inPeriod(prev, c.closedDate)) : [];
  }, [cases, period]);
  const closeNow = avgClose(closedNow);
  const closePrev = avgClose(closedPrev);
  const dl = delta(closeNow.avg, closePrev.n ? closePrev.avg : null, true);
  const trend = useMemo(
    () => closeTrend(cases.filter((c) => c.status === "CLOSED" && inPeriod(period, c.closedDate)), bucketOf),
    [cases, period], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Every day (YTD: every month) of the window up to today, not only the days
  // something closed (owner 2026-10-17: "怎么不是每一天"). Bars = cases closed
  // that day (a quiet day is a real 0); line = running average closing days of
  // everything closed in the period so far, so it is continuous.
  const closeSeries = useMemo(() => {
    const today = ymd(new Date());
    const buckets: string[] = [];
    if (ytd) {
      const y = period.month.slice(0, 4);
      for (let m = 1; m <= 12; m++) {
        const b = `${y}-${String(m).padStart(2, "0")}`;
        if (b <= today.slice(0, 7)) buckets.push(b);
      }
    } else {
      const from = period.mode === "range" && period.from ? period.from : `${period.month}-01`;
      const last = period.mode === "range" && period.to ? period.to : ymd(new Date(Number(period.month.slice(0, 4)), Number(period.month.slice(5, 7)), 0));
      const end = last < today ? last : today;
      for (let d = new Date(`${from}T00:00:00`); ymd(d) <= end; d.setDate(d.getDate() + 1)) buckets.push(ymd(d));
    }
    const hit = new Map(trend.map((t) => [t.bucket, t]));
    let sum = 0;
    let n = 0;
    return buckets.map((b) => {
      const t = hit.get(b);
      if (t && t.avg !== null) { sum += t.avg * t.closed; n += t.closed; }
      return { date: ytd ? b : b.slice(5), Closed: t?.closed ?? 0, "Avg days (running)": n ? Math.round((sum / n) * 10) / 10 : null };
    });
  }, [trend, period, ytd]);

  const open = useMemo(() => cases.filter((c) => OPEN.has(c.status)), [cases]);
  const openedInFocus = useMemo(() => cases.filter((c) => inFocus(period, c.createdDate)), [cases, period]);
  const flow = useMemo(
    () => openedVsClosed(cases, (d) => inPeriod(period, d), bucketOf).map((r) => ({ iso: r.bucket, date: ytd ? r.bucket : r.bucket.slice(5), Opened: r.opened, Closed: r.closed })),
    [cases, period], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const aging = useMemo(() => agingSplit(open, threshold), [open, threshold]);
  const agingMax = Math.max(1, ...aging.map((a) => a.count));
  const prevention = useMemo(() => byPrevention(openedInFocus), [openedInFocus]);
  const notDone = useMemo(() => preventionNotDone(openedInFocus), [openedInFocus]);

  const pick = (e: { activeLabel?: unknown } | null) => {
    const hit = flow.find((d) => d.date === e?.activeLabel);
    if (!hit) return;
    if (ytd) onPeriodChange({ mode: "monthly", month: hit.iso });
    else onPeriodChange({ ...period, day: period.day === hit.iso ? undefined : hit.iso });
  };
  const dayLine = period.day && !ytd ? period.day.slice(5) : null;

  if (!slice) {
    return (
      <Card className="border-[#F0D9AE] bg-[#FDF3E4]">
        <CardContent className="p-3 text-sm text-[#B5701A]">
          Service isn't available: the feed carries no service-case slice (it may be an older cached response — reload in a minute, or you may lack service-cases access).
        </CardContent>
      </Card>
    );
  }
  const win = period.day ? "that day" : periodLabel(period);

  return (
    <>
      {/* One row, each number with its own scope stated (owner 2026-10-17):
          opened / closed = in the period (closed counts cases logged earlier
          too); open / overdue = right now, whenever they were logged.
          "Not started" is the OPEN status (logged, nobody on it yet). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Opened" value={fmtN(openedInFocus.length)} sub={`new cases logged · ${win}`} />
        <Kpi label="Closed" value={fmtN(closedNow.length)} sub={`closed · ${win} (any logged date)`} valueColorClass="text-[#4F7C3A]" />
        <Kpi label="Still open now" value={fmtN(open.length)} sub={`${fmtN(open.filter((c) => c.status === "OPEN").length)} not started · ${fmtN(open.filter((c) => c.status === "IN_PROGRESS").length)} in progress`} valueColorClass="text-[#9C6F1E]" />
        <Kpi label="Overdue now" value={fmtN(open.filter((c) => c.daysOverdue > 0).length)} sub={`open more than ${threshold} days`} valueColorClass="text-[#9A3A2D]" />
        <Kpi label="Avg case closing" value={closeNow.avg === null ? "—" : `${closeNow.avg} d`} sub={`${fmtN(closeNow.n)} closed · ${dl ? dl.text : "no previous-period comparison"}`} valueColorClass={dl?.good == null ? undefined : dl.good ? "text-[#4F7C3A]" : "text-[#9A3A2D]"} />
      </div>

      {/* The two charts share a row (less scrolling on layer 1). */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Average case closing</CardTitle>
          <p className="text-xs text-[#6B7280] max-w-3xl">
            Average whole days from the case being logged to it being closed, over cases <b>closed</b> in {win}
            {period.day ? " (no previous-period comparison for a single day)" : ""}. Bars = cases closed each {ytd ? "month" : "day"}; line = running average closing days so far.
          </p>
        </CardHeader>
        <CardContent>
          <div className={CHART_WRAP} style={{ width: "100%", height: 220 }}>
            {trend.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-[#6B7280]">No cases closed in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={closeSeries} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="#F0ECE6" />
                  <XAxis dataKey="date" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis yAxisId="n" tick={CC_TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                  <YAxis yAxisId="d" orientation="right" tick={CC_TICK} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v} d`} />
                  <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgba(107,92,50,0.06)" }} />
                  <Legend {...tClose.legend} />
                  <Bar yAxisId="n" dataKey="Closed" hide={tClose.hide("Closed")} fill={CHART_GOLD} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Line yAxisId="d" type="monotone" dataKey="Avg days (running)" hide={tClose.hide("Avg days (running)")} stroke={TAUPE} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Opening cases · opened vs closed by {ytd ? "month" : "day"}</CardTitle>
          <p className="text-xs text-[#6B7280] max-w-3xl">
            <b>Open</b> = status Open or In progress, right now (not limited to the period). <b>Opened</b> = logged in the period, <b>Closed</b> = closed in the period.
            Age = whole days since logged; overdue threshold is {threshold} days.
          </p>
        </CardHeader>
        <CardContent>
          <div className={CHART_WRAP} style={{ width: "100%", height: 240 }}>
            {flow.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-[#6B7280]">Nothing recorded in this period.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flow} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} style={{ cursor: "pointer" }} onClick={pick}>
                  <XAxis dataKey="date" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} />
                  <YAxis tick={CC_TICK} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "#F0ECE9" }} contentStyle={TOOLTIP} />
                  <Legend {...tFlow.legend} />
                  {dayLine && <ReferenceLine x={dayLine} stroke={AMBER} strokeWidth={2} />}
                  <Bar dataKey="Opened" hide={tFlow.hide("Opened")} fill={CHART_GOLD} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Closed" hide={tFlow.hide("Closed")} fill={TAUPE} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="mt-2 text-[11px] text-[#6B7280]">Click a bar to focus that {ytd ? "month" : "day"}.</p>
          <div className="mt-4">
            <div className="text-xs font-semibold text-[#1F1D1B] mb-1">Aging of the {fmtN(open.length)} open cases</div>
            {aging.map((a, i) => (
              <div key={a.label} className="grid grid-cols-[90px_1fr_36px] gap-2 items-center py-1.5 border-t border-[#E2DDD8] text-[12.5px]">
                <span className="text-[#1F1D1B]">{a.label}</span>
                <span className="h-3 rounded-sm bg-[#F0ECE9]">
                  <span className="block h-3 rounded-sm" style={{ width: `${(a.count / agingMax) * 100}%`, background: i === 0 ? GREEN : i === 1 ? AMBER : RED }} />
                </span>
                <span className="text-right tabular-nums font-semibold">{fmtN(a.count)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Category / root cause render once, below the case list (the full
          ServiceIssuesPanel in ServiceView) — this copy duplicated it. */}

      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle>Prevention</CardTitle>
          <p className="text-xs text-[#6B7280] max-w-3xl">
            Cases logged in {win}. Below: prevention not yet done (Planned, In progress, or none recorded on a case that has a root cause or is closed),
            oldest first. Days open = age while open, else days to close. Cancelled cases are left out. No prevention due date is recorded on service cases,
            so overdue-prevention cannot be shown.
          </p>
        </CardHeader>
        <CardContent>
          <TallyList rows={prevention} total={openedInFocus.length} empty="No service cases in this period." />
        </CardContent>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] max-md:min-w-[560px]">
              <thead>
                <tr className="border-t border-b border-[#E2DDD8]">
                  <th className={`${th} text-left`}>Case</th><th className={`${th} text-left`}>Customer</th>
                  <th className={`${th} text-left`}>Root cause</th><th className={`${th} text-left`}>Prevention</th>
                  <th className={`${th} text-right`}>Days open</th>
                </tr>
              </thead>
              <tbody>
                {notDone.map((c) => (
                  <tr key={c.id} {...rowProps(c.id, "border-b border-[#E2DDD8]")}>
                    <td className="px-4 py-2.5 font-mono"><ServiceCaseNo id={c.id} caseNo={c.caseNo ?? c.id} canOpen={canOpen} /></td>
                    <td className="px-4 py-2.5">{c.customer ?? "—"}</td>
                    <td className="px-4 py-2.5" style={{ color: c.causes?.length ? "#1F1D1B" : AMBER }}>
                      {c.causes?.length ? c.causes.map(causeLabel).join(", ") : "Not yet analysed"}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: TEAL }} title={c.preventionAction || undefined}>
                      {c.prevention === "IN_PROGRESS" ? "In progress" : c.prevention === "PENDING" ? "Planned" : "None recorded"}
                      {c.preventionOwner ? ` · ${c.preventionOwner}` : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{c.daysOpen ?? "—"}</td>
                  </tr>
                ))}
                {notDone.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-[#6B7280]">No cases with outstanding prevention in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
