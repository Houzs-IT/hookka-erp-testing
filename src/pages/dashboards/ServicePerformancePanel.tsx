import { useMemo, useState, type ReactNode } from "react";
import { useSeriesToggle } from "./use-series-toggle";
import { BarChart, Bar, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  TAUPE, TEAL, BORDER, GREEN, AMBER, RED, CHART_GOLD, fmtN,
  inPeriod, inFocus, monthLabel, periodLabel, previousPeriod, ymd, type Period, CC_TICK, CC_AXIS_LINE } from "./dashboard-shared-lib";
import { Kpi } from "./dashboard-shared";
import { TallyList } from "./ServiceIssuesPanel";
import { DashModal } from "./DashModal";
import { ServiceCaseNo } from "./ServiceCaseLink";
import { useServiceCaseLinks } from "./use-service-case-links";
import {
  byPrevention, avgClose, daysToClose, openedVsClosed, agingSplit, preventionNotDone, causeLabel,
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
  slice, period, onPeriodChange, afterKpis,
}: { slice: ServicePerformanceSlice | null | undefined; period: Period; onPeriodChange: (p: Period) => void; afterKpis?: ReactNode }) {
  const cases = useMemo(() => slice?.cases ?? [], [slice]);
  const threshold = slice?.overdueAfterDays ?? 0;
  const ytd = period.mode === "ytd";
  const bucketOf = (d: string) => (ytd ? d.slice(0, 7) : d);
  const { canOpen, rowProps } = useServiceCaseLinks();
  // Layer 2 behind each number in the KPI row.
  const [drill, setDrill] = useState<"opened" | "closed" | "open" | "overdue" | null>(null);
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
  // Average case closing, presented two ways (owner 2026-10-17: "average case
  // closing 怎么去计算 … 怎么呈现会比较好"). Days = whole days from logged to
  // closed, over cases CLOSED in the period (any logged date):
  //   • how long they took — closed cases split into day bands, so one very
  //     old case shows as one bar instead of dragging an average line;
  //   • the monthly average over the last 6 months, to see the trend.
  const closeBands = useMemo(() => {
    const bands = [
      { label: "Same / next day", lo: 0, hi: 1 },
      { label: "2–3 days", lo: 2, hi: 3 },
      { label: "4–7 days", lo: 4, hi: 7 },
      { label: "8–14 days", lo: 8, hi: 14 },
      { label: "15+ days", lo: 15, hi: Infinity },
    ].map((b) => ({ ...b, count: 0 }));
    const ds: number[] = [];
    for (const c of closedNow) {
      const d = daysToClose(c);
      if (d == null) continue;
      ds.push(d);
      const band = bands.find((b) => d >= b.lo && d <= b.hi);
      if (band) band.count += 1;
    }
    ds.sort((x, y) => x - y);
    const median = ds.length ? (ds.length % 2 ? ds[(ds.length - 1) / 2] : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2) : null;
    return { bands, median, max: Math.max(1, ...bands.map((b) => b.count)) };
  }, [closedNow]);
  const closeMonthly = useMemo(() => {
    const end = (period.mode === "range" ? (period.to ?? "") : period.month).slice(0, 7) || ymd(new Date()).slice(0, 7);
    const out: { m: string; ym: string; "Avg days": number | null; Closed: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1 - i, 1);
      const ym = ymd(d).slice(0, 7);
      const cs = cases.filter((c) => c.status === "CLOSED" && (c.closedDate ?? "").startsWith(ym));
      out.push({ m: monthLabel(ym).slice(0, 3), ym, "Avg days": avgClose(cs).avg, Closed: cs.length });
    }
    return out;
  }, [cases, period]);

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
        <Kpi label="Opened" onClick={() => setDrill("opened")} value={fmtN(openedInFocus.length)} sub={`new cases logged · ${win}`} />
        <Kpi label="Closed" onClick={() => setDrill("closed")} value={fmtN(closedNow.length)} sub={`closed · ${win} (any logged date)`} valueColorClass="text-[#4F7C3A]" />
        <Kpi label="Still open now" onClick={() => setDrill("open")} value={fmtN(open.length)} sub={`${fmtN(open.filter((c) => c.status === "OPEN").length)} not started · ${fmtN(open.filter((c) => c.status === "IN_PROGRESS").length)} in progress`} valueColorClass="text-[#9C6F1E]" />
        <Kpi label="Overdue now" onClick={() => setDrill("overdue")} value={fmtN(open.filter((c) => c.daysOverdue > 0).length)} sub={`open more than ${threshold} days`} valueColorClass="text-[#9A3A2D]" />
        <Kpi label="Avg case closing" onClick={() => setDrill("closed")} value={closeNow.avg === null ? "—" : `${closeNow.avg} d`} sub={`${fmtN(closeNow.n)} closed · ${dl ? dl.text : "no previous-period comparison"}`} valueColorClass={dl?.good == null ? undefined : dl.good ? "text-[#4F7C3A]" : "text-[#9A3A2D]"} />
      </div>

      {drill && (() => {
        const list = drill === "opened" ? openedInFocus : drill === "closed" ? closedNow : drill === "open" ? open : open.filter((c) => c.daysOverdue > 0);
        const title = drill === "opened" ? `Cases opened · ${win}` : drill === "closed" ? `Cases closed · ${win}` : drill === "open" ? "Cases still open" : "Cases overdue";
        return (
          <DashModal wide title={`${title} · ${fmtN(list.length)}`} subtitle={drill === "closed" ? "Days = whole days from logged to closed" : drill === "opened" ? "Logged in the period" : "Days = open since logged"} onClose={() => setDrill(null)}>
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr className="sticky top-0 bg-white text-left text-[10.5px] uppercase tracking-wide text-[#9CA3AF] shadow-[inset_0_-1px_0_#E2DDD8]">
                  <th className="py-1.5">Case</th><th className="py-1.5">Customer</th><th className="py-1.5">Issue</th><th className="py-1.5">Logged</th><th className="py-1.5">Closed</th><th className="py-1.5">Status</th><th className="py-1.5 text-right">Days</th>
                </tr></thead>
                <tbody>
                  {[...list].sort((a, b) => b.createdDate.localeCompare(a.createdDate)).map((c) => {
                    const days = c.status === "CLOSED" && c.closedDate ? daysToClose(c) : c.ageDays;
                    return (
                      <tr key={c.id} {...rowProps(c.id, "border-b border-[#F0ECE6]")}>
                        <td className="py-1.5 font-mono whitespace-nowrap"><ServiceCaseNo id={c.id} caseNo={c.caseNo} canOpen={canOpen} /></td>
                        <td className="py-1.5">{c.customer ?? "—"}</td>
                        <td className="py-1.5 max-w-[280px] truncate text-[#6B7280]">{(c as { issue?: string }).issue || "—"}</td>
                        <td className="py-1.5 whitespace-nowrap text-[#6B7280]">{c.createdDate}</td>
                        <td className="py-1.5 whitespace-nowrap text-[#6B7280]">{c.closedDate ?? "—"}</td>
                        <td className="py-1.5 text-[#6B7280]">{c.status}</td>
                        <td className={`py-1.5 text-right tabular-nums ${c.daysOverdue > 0 ? "font-semibold text-[#9A3A2D]" : ""}`}>{days == null ? "—" : `${days} d`}</td>
                      </tr>
                    );
                  })}
                  {list.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-[#9CA3AF]">None.</td></tr>}
                </tbody>
              </table>
            </div>
          </DashModal>
        );
      })()}

      {/* Issues by category sits right under the numbers (owner 2026-10-17). */}
      {afterKpis}

      {/* The two charts share a row (less scrolling on layer 1). */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Average case closing</CardTitle>
          <p className="text-xs text-[#6B7280] max-w-3xl">
            Average whole days from the case being logged to it being closed, over cases <b>closed</b> in {win}
            {period.day ? " (no previous-period comparison for a single day)" : ""}. Left: the closed cases by how many days they took. Right: the monthly average, to see the trend.
          </p>
        </CardHeader>
        <CardContent>
          <div className={CHART_WRAP} style={{ width: "100%", height: 240 }}>
            {closedNow.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-[#6B7280]">No cases closed in this period.</div>
            ) : (
              <div className="grid h-full grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col justify-center">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">How long they took · {fmtN(closedNow.length)} closed</p>
                  {closeBands.bands.map((b, i) => (
                    <div key={b.label} className="grid grid-cols-[96px_1fr_28px_44px] items-center gap-2 border-t border-[#F0ECE6] py-1.5 text-[12.5px]">
                      <span className="text-[#1F1D1B]">{b.label}</span>
                      <span className="h-3 rounded-sm bg-[#F0ECE6]">
                        <span className="block h-3 rounded-sm" style={{ width: `${(b.count / closeBands.max) * 100}%`, background: i <= 1 ? GREEN : i === 2 ? CHART_GOLD : i === 3 ? AMBER : RED }} />
                      </span>
                      <span className="text-right font-semibold tabular-nums">{b.count}</span>
                      <span className="text-right text-[11.5px] tabular-nums text-[#6B7280]">{closedNow.length ? `${Math.round((b.count / closedNow.length) * 100)}%` : "—"}</span>
                    </div>
                  ))}
                  <p className="mt-1 text-[11px] text-[#6B7280]">
                    Average <b>{closeNow.avg ?? "—"} d</b> · median <b>{closeBands.median ?? "—"} d</b> — the median is the typical case; a few very old cases pull the average up.
                  </p>
                </div>
                <div className="min-h-[180px]">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Average days to close · last 6 months</p>
                  <ResponsiveContainer width="100%" height="88%">
                    <ComposedChart data={closeMonthly} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="#F0ECE6" />
                      <XAxis dataKey="m" tick={CC_TICK} axisLine={CC_AXIS_LINE} tickLine={false} />
                      <YAxis tick={CC_TICK} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => `${v}d`} />
                      <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => (n === "Avg days" ? [`${v} d`, n] : [v, n])} />
                      <Legend {...tClose.legend} />
                      <Bar dataKey="Avg days" hide={tClose.hide("Avg days")} fill={TAUPE} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
          {closedNow.length > 0 && (() => {
            const within = (days: number) => closeBands.bands.filter((b) => b.hi <= days).reduce((a, b) => a + b.count, 0);
            const share = (n: number) => `${Math.round((n / closedNow.length) * 100)}%`;
            const over14 = closeBands.bands[closeBands.bands.length - 1].count;
            return (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: "Closed within 3 days", n: within(3), tone: "text-[#4F7C3A]" },
                  { label: "Closed within 7 days", n: within(7), tone: "text-[#1F1D1B]" },
                  { label: "Took 15+ days", n: over14, tone: over14 > 0 ? "text-[#9A3A2D]" : "text-[#1F1D1B]" },
                ].map((k) => (
                  <div key={k.label} className="rounded-lg bg-[#F7F4EF] px-3 py-2">
                    <p className="truncate text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">{k.label}</p>
                    <p className={`text-lg font-bold tabular-nums ${k.tone}`}>{share(k.n)}</p>
                    <p className="text-[11px] text-[#6B7280]">{fmtN(k.n)} of {fmtN(closedNow.length)} cases</p>
                  </div>
                ))}
              </div>
            );
          })()}
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
