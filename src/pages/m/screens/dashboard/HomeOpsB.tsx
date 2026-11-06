// Home Operations · Output & Cost, part 1: Costing vs production revenue and Plan vs actual.
// Visual + interaction source: the approved Home Operations HTML. Data and rules: desktop dashboards/CostingPanel.tsx and
// dashboards/ProductionDailyPanels.tsx (sub="plan").
import { useMemo, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { M } from "../../theme";
import { dayLabel, monthLabel, widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { SheetFrame } from "./home-ui";
import { TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import {
  costOf, costingByDay, costingCols, materialLines, n0, pct1, pctOf, planBars, planSeries, planTotals, rollUpMonths, stageRows, weekdayDay,
  type PlanMetric, type PlanRow,
} from "./ops-lib";
import { C, sheetCard } from "./ops-style";
import { Chev, InfoBox, OCard, OHead, PeriodText, SectionLabel, Seg, StatusBlock, TableSheet } from "./ops-ui";

const rm = (sen: number) => formatCurrency(Math.round(sen));

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------
export function CostingCard({ d, period, today }: { d: OpsData; period: Period; today: string }) {
  const [sheet, setSheet] = useState<{ k: "month" | "mat"; ym: string; sub: string } | null>(null);
  const rev = d.revenue;
  const matReady = d.cost.status === "ready" && d.cost.prevStatus === "ready";
  const lab = d.labour.state;
  const withLabour = lab === "ready" || lab === "none";
  const byDay = useMemo(() => costingByDay({ revByDay: rev.byDay, pnl: d.cost.pnl, labourByDay: d.labour.byDay, pis: [], from: d.from, to: d.to }), [rev.byDay, d.cost.pnl, d.labour.byDay, d.from, d.to]);
  const byMonth = useMemo(() => rollUpMonths(byDay), [byDay]);
  const est = (ym: string) => !d.cost.pnl.has(ym);
  const cols = useMemo(() => costingCols({ byDay, byMonth, focusMonth: d.focusMonth, day: period.day, today, estimated: est }), [byDay, byMonth, d.focusMonth, period.day, today, d.cost.pnl]); // eslint-disable-line react-hooks/exhaustive-deps
  const hi = period.day ? 1 : 0;
  const head = cols[hi];
  const prevB = cols[hi + 1];
  // Cost needs materials (P&L) and, when the reader may see it, labour. A missing piece is said, never zero.
  const waiting = rev.status === "loading" || d.cost.status === "loading" || d.cost.prevStatus === "loading" || lab === "loading";
  const blocked = !matReady || lab === "error";
  const headPct = !blocked && !waiting ? pctOf(costOf(head.b, withLabour), head.b.revenue) : null;
  const prevPct = !blocked && !waiting ? pctOf(costOf(prevB.b, withLabour), prevB.b.revenue) : null;
  const good = headPct != null && prevPct != null && headPct <= prevPct;

  const matNote = d.cost.status === "denied" ? "Materials and cost % need accounting access (the P&L)."
    : d.cost.status === "error" || d.cost.prevStatus === "error" ? "The P&L could not be loaded, so materials and cost % are unavailable."
      : d.cost.prevStatus === "denied" ? "The previous financial year of the P&L is not available to your role."
        : null;
  const labNote = lab === "denied" ? (matReady ? "Labour needs payroll access, so cost here is materials only." : null)
    : lab === "error" ? "Labour could not be loaded, so cost % is unavailable."
      : lab === "none" ? "No logged working hours were found for these months, so labour is zero." : null;

  if (rev.status !== "ready") {
    return (
      <OCard label="Costing" id="ops-costing">
        <OHead title="Costing vs production revenue" sub="% of production revenue · materials used + labour = cost" />
        <div style={{ marginTop: 10 }}><StatusBlock status={rev.status} what="Costing" need="a dashboard operations view" onRetry={rev.refresh} /></div>
      </OCard>
    );
  }

  const sheetDays = sheet?.k === "month" ? [...byDay.entries()].filter(([x]) => x.startsWith(sheet.ym)).sort(([a], [b]) => b.localeCompare(a)) : [];
  const lines = sheet?.k === "mat" ? materialLines(d.cost.sets, sheet.ym) : [];
  const tot = (f: (r: (typeof lines)[number]) => number) => lines.reduce((a, r) => a + f(r), 0);

  return (
    <>
      <OCard label="Costing" id="ops-costing">
        <OHead title="Costing vs production revenue" right={<PeriodText>{monthLabel(d.focusMonth)}</PeriodText>} sub="% of production revenue · materials used + labour = cost" />
        <div style={{ marginTop: 14 }}>
          <SectionLabel>COST % · {monthLabel(d.focusMonth).toUpperCase()}</SectionLabel>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
          <span style={{ fontSize: 28, fontWeight: 700, lineHeight: "34px", letterSpacing: -0.6, color: headPct != null && prevPct != null ? (good ? C.ok : C.danger) : M.raisin, ...TNUM }}>{waiting ? "…" : pct1(headPct)}</span>
          {headPct != null && prevPct != null ? <span style={{ fontSize: 12.5, color: M.ink, ...TNUM }}>{good ? "▼" : "▲"} {Math.abs(headPct - prevPct).toFixed(1)} pts vs last month ({pct1(prevPct)})</span> : null}
        </div>
        {matNote ? <div style={{ marginTop: 8 }}><InfoBox icon={Info}>{matNote}</InfoBox></div> : null}
        {labNote ? <div role="status" style={{ marginTop: 8, fontSize: 11.5, color: M.ink, lineHeight: 1.4 }}>{labNote}</div> : null}
        <div style={{ marginTop: 10 }}>
          {cols.map((c) => {
            const cost = costOf(c.b, withLabour);
            const link = !!c.ym;
            const body = (
              <>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{c.label}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: M.muted, marginTop: 1 }}>{c.sub}</span>
                </span>
                <span style={{ flex: "none", textAlign: "right" }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{blocked ? "—" : waiting ? "…" : pct1(pctOf(cost, c.b.revenue))}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 1, whiteSpace: "nowrap", ...TNUM }}>{blocked ? `revenue ${rm(c.b.revenue)}` : `cost ${waiting ? "…" : rm(cost)}`}</span>
                </span>
                {link ? <Chev /> : <span style={{ width: 15 }} />}
              </>
            );
            const st = { width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: 0, borderTop: `1px solid ${M.divider}`, boxSizing: "border-box" as const };
            return link ? (
              <button key={c.label} type="button" aria-label={`${c.label}: cost ${blocked ? "unavailable" : pct1(pctOf(cost, c.b.revenue))} of production revenue. Open day by day`} onClick={() => setSheet({ k: "month", ym: c.ym!, sub: c.sub })}
                style={{ ...st, border: "none", borderTop: st.borderTop, background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>{body}</button>
            ) : <div key={c.label} style={st}>{body}</div>;
          })}
        </div>
      </OCard>

      {sheet?.k === "month" ? (
        <SheetFrame open title={`${monthLabel(sheet.ym)} · day by day`} sub={sheet.sub} onClose={() => setSheet(null)}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 2px 8px" }}>
            <SectionLabel>DAY BY DAY</SectionLabel>
            <button type="button" onClick={() => setSheet({ k: "mat", ym: sheet.ym, sub: sheet.sub })} disabled={!matReady}
              style={{ border: "none", background: "none", padding: 0, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: matReady ? M.taupe : M.faint, cursor: matReady ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 3 }}>
              Materials used<ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div style={{ ...sheetCard, padding: "0 14px" }}>
            {sheetDays.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>Nothing recorded this month.</div> : null}
            {sheetDays.map(([day, b], i) => (
              <div key={day} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 52, borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{weekdayDay(day)}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: M.raisin, ...TNUM }}>{rm(b.revenue)}</span>
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: M.muted, marginTop: 2, ...TNUM }}>Materials {matReady ? rm(b.material) : "—"} · Labour {withLabour ? rm(b.labour) : "—"}</span>
                </span>
                <span style={{ flex: "none", textAlign: "right" }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, ...TNUM }}>{blocked ? "—" : pct1(pctOf(costOf(b, withLabour), b.revenue))}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: M.muted }}>cost</span>
                </span>
              </div>
            ))}
          </div>
        </SheetFrame>
      ) : null}

      {sheet?.k === "mat" ? (
        <SheetFrame open title={`Materials used · ${monthLabel(sheet.ym)}`} sub={est(sheet.ym) ? "P&L lines · estimated month" : "P&L lines · opening + purchases − closing"} onBack={() => setSheet({ k: "month", ym: sheet.ym, sub: sheet.sub })} onClose={() => setSheet(null)}>
          {est(sheet.ym) ? <div style={{ marginBottom: 10 }}><InfoBox icon={Info}>No stock take yet for this month — the dashboard estimates it; the P&amp;L lines below have no closing stock.</InfoBox></div> : null}
          <div style={{ ...sheetCard, padding: "0 14px" }}>
            {lines.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No P&amp;L lines for this month.</div> : null}
            {lines.map((r, i) => (
              <div key={r.code + i} style={{ padding: "11px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{r.name || r.code}</span>
                  <span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: M.raisin, ...TNUM }}>{rm(r.opening + r.purchase - r.closing)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: M.muted, marginTop: 3, ...TNUM }}>Opening {rm(r.opening)} · + Purchases {rm(r.purchase)} · − Closing {est(sheet.ym) ? "—" : rm(r.closing)}</div>
              </div>
            ))}
            {lines.length ? (
              <div style={{ padding: "11px 0", borderTop: `1px solid ${M.divider}`, backgroundColor: M.paper, margin: "0 -14px", paddingLeft: 14, paddingRight: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>Total</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, ...TNUM }}>{rm(tot((r) => r.opening + r.purchase - r.closing))}</span>
                </div>
                <div style={{ fontSize: 11.5, color: M.muted, marginTop: 3, ...TNUM }}>Opening {rm(tot((r) => r.opening))} · + Purchases {rm(tot((r) => r.purchase))} · − Closing {est(sheet.ym) ? "—" : rm(tot((r) => r.closing))}</div>
              </div>
            ) : null}
          </div>
        </SheetFrame>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Plan vs actual
// ---------------------------------------------------------------------------
const chartLabel = (iso: string) => (iso.length === 10 ? String(Number(iso.slice(8, 10))) : monthLabel(iso).slice(0, 3));

function PlanChart({ bars, plan, actual, selIdx, onPick }: { bars: PlanRow[]; plan: number[]; actual: (number | null)[]; selIdx: number; onPick: (b: PlanRow) => void }) {
  const W = 340; const H = 160;
  const n = bars.length;
  const pmax = Math.max(1, ...plan, ...actual.filter((v): v is number => v != null)) * 1.1;
  const px = (i: number) => 30 + (n <= 1 ? 0 : (i * (W - 38)) / (n - 1));
  const py = (v: number) => 8 + (H - 28) * (1 - v / pmax);
  const lab = n > 12 ? bars.filter((_, i) => i % Math.ceil(n / 6) === 0) : bars;
  const segs: string[] = [];
  let cur: string[] = [];
  actual.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur.join(" ")); cur = []; } else cur.push(`${px(i)},${py(v)}`); });
  if (cur.length) segs.push(cur.join(" "));
  const hz = (W - 38) / Math.max(n, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={30} x2={332} y1={py(pmax * f)} y2={py(pmax * f)} stroke={M.divider} />
          <text x={26} y={py(pmax * f) + 3} textAnchor="end" style={{ fontSize: "9px", fill: M.muted }}>{Math.round(pmax * f).toLocaleString("en-MY")}</text>
        </g>
      ))}
      {lab.map((b) => <text key={b.iso} x={px(bars.indexOf(b))} y={155} textAnchor="middle" style={{ fontSize: "9px", fill: M.muted }}>{chartLabel(b.iso)}</text>)}
      <polyline points={plan.map((v, i) => `${px(i)},${py(v)}`).join(" ")} fill="none" stroke="#9A9082" strokeWidth={1.6} strokeDasharray="5 4" />
      {selIdx >= 0 ? <line x1={px(selIdx)} x2={px(selIdx)} y1={8} y2={140} stroke={M.taupe} strokeDasharray="3 3" /> : null}
      {segs.map((s, i) => <polyline key={i} points={s} fill="none" stroke={C.teal} strokeWidth={2.2} />)}
      {selIdx >= 0 ? <circle cx={px(selIdx)} cy={py(plan[selIdx])} r={3} fill="#FFFFFF" stroke="#9A9082" strokeWidth={1.6} /> : null}
      {selIdx >= 0 && actual[selIdx] != null ? <circle cx={px(selIdx)} cy={py(actual[selIdx]!)} r={3.5} fill={C.teal} /> : null}
      {bars.map((b, i) => <rect key={b.iso} x={px(i) - hz / 2} y={0} width={hz} height={H} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onPick(b)} />)}
    </svg>
  );
}

export function PlanCard({ d, period, onPeriod, today }: { d: OpsData; period: Period; onPeriod: (p: Period) => void; today: string }) {
  const [metric, setMetric] = useState<PlanMetric>("units");
  const [view, setView] = useState<"cum" | "day">("cum");
  const [deptOpen, setDeptOpen] = useState(false);
  const { status, reason } = d.lim;
  const lim = d.feed?.lim ?? null;
  const byMonth = period.mode === "ytd";
  const tot = useMemo(() => (lim ? planTotals(lim, period) : null), [lim, period]);
  const sameUnits = !!tot && tot.pu === tot.po && tot.au === tot.ao;
  const m: PlanMetric = sameUnits ? "orders" : metric;
  const bars = useMemo<PlanRow[]>(() => (lim ? planBars(lim, period, m) : []), [lim, period, m]);
  const series = useMemo(() => planSeries(bars, today, view === "cum"), [bars, today, view]);
  const stages = useMemo(() => (lim ? stageRows(lim, period, today) : []), [lim, period, today]);
  const pT = bars.reduce((a, b) => a + b.plan, 0);
  const aT = bars.reduce((a, b) => a + (b.iso > today ? 0 : b.actual), 0);
  const dueToDate = bars.reduce((a, b) => a + (b.iso <= today ? b.plan : 0), 0);
  const gap = aT - dueToDate;
  const selIdx = !byMonth && period.day ? bars.findIndex((b) => b.iso === period.day) : -1;
  const periodText = period.day ? dayLabel(period.day) : widgetPeriodLabel(period);

  const pick = (b: PlanRow) => {
    if (byMonth) onPeriod({ mode: "monthly", month: b.iso });
    else if (period.mode === "range") onPeriod({ mode: "monthly", month: b.iso.slice(0, 7), day: b.iso });
    else if (period.day && period.day !== b.iso) onPeriod({ mode: "monthly", month: period.month, day: b.iso });
    else onPeriod({ mode: "monthly", month: period.month, day: period.day === b.iso ? undefined : b.iso });
  };
  const pickText = selIdx >= 0 ? `${Number(bars[selIdx].iso.slice(8, 10))} ${monthLabel(bars[selIdx].iso.slice(0, 7)).slice(0, 3)} · plan ${n0(series.plan[selIdx])} · done ${series.actual[selIdx] == null ? "—" : n0(series.actual[selIdx]!)}` : "";

  return (
    <>
      <OCard label="Plan vs actual" id="ops-plan">
        <OHead title="Are we keeping up with the plan?" right={<PeriodText>{periodText}</PeriodText>} />
        {status !== "ready" || !lim || !tot ? (
          <div style={{ marginTop: 12 }}><StatusBlock status={status === "ready" ? "error" : status} what="Plan vs actual" need="production-orders access" reason={status === "ready" ? "the daily production slice is missing from the feed" : reason} onRetry={d.retryFeed} /></div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 26, fontWeight: 700, lineHeight: "30px", letterSpacing: -0.5, color: M.raisin, ...TNUM }}>{n0(aT)}</span>
              <span style={{ fontSize: 13, color: M.ink, ...TNUM }}>of {n0(pT)} {m === "units" ? "units" : "orders"} planned</span>
            </div>
            <div aria-hidden="true" style={{ height: 8, marginTop: 8, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pT ? Math.min(aT / pT, 1) * 100 : 0}%`, borderRadius: 999, backgroundColor: C.teal }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 12, ...TNUM }}>
              <span style={{ color: M.ink }}>{pT ? `${Math.round((aT / pT) * 100)}%` : "—"} done</span>
              <span style={{ fontWeight: 700, color: gap >= 0 ? C.ok : C.danger }}>{n0(Math.abs(gap))} {gap >= 0 ? "ahead" : "behind"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: sameUnits ? "minmax(0,1fr)" : "minmax(0,1.35fr) minmax(0,1fr)", gap: 8, marginTop: 14 }}>
              <Seg aria="View" value={view} onChange={setView} options={[["cum", "Running total"], ["day", byMonth ? "Per month" : "Per day"]]} />
              {!sameUnits ? <Seg aria="Measure" value={metric} onChange={setMetric} options={[["units", "Units"], ["orders", "Orders"]]} /> : null}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 12, minHeight: 18 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, ...TNUM }}>{pickText}</span>
              <span style={{ fontSize: 11, color: M.muted, whiteSpace: "nowrap" }}>{byMonth ? "tap a month to open it" : selIdx >= 0 ? "tap again to clear" : "tap a day to see it"}</span>
            </div>
            {bars.length === 0 ? (
              <div role="status" style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: M.ink }}>Nothing recorded in this period.</div>
            ) : (
              <div role="img" aria-label="Plan versus actual — tap a day" style={{ position: "relative", width: "100%", height: 150, marginTop: 6 }}>
                <PlanChart bars={bars} plan={series.plan} actual={series.actual} selIdx={selIdx} onPick={pick} />
              </div>
            )}
            <div style={{ display: "flex", gap: 14, marginTop: 4, fontSize: 11.5, color: M.ink }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 0, borderTop: "2px dashed #9A9082" }} />Plan (due)</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: C.teal }} />Actual (done)</span>
            </div>
            <div style={{ fontSize: 11, color: M.muted, marginTop: 8 }}>Cancelled orders excluded · {n0(lim.orders.withoutTarget)} orders have no target date.</div>
            <button type="button" onClick={() => setDeptOpen(true)} style={{ width: "100%", height: 44, margin: "12px 0 -6px", border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              By department<ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </>
        )}
      </OCard>
      {deptOpen && lim ? (
        <SheetFrame open title={`By department · ${periodText}`} sub="Job cards (one card = one stage of one order) · Plan = due by today · Actual = done" onClose={() => setDeptOpen(false)}>
          <TableSheet grid="minmax(0,1fr) auto auto auto" head={[{ t: "Dept" }, { t: "Plan", right: true }, { t: "Actual", right: true }, { t: "Gap", right: true }]}
            none="No stage plan or completion in this window."
            rows={stages.map((r) => { const g = r.actual - r.plan; return { cells: [{ t: deptName(r.dept) }, { t: n0(r.plan), right: true }, { t: n0(r.actual), right: true }, { t: g > 0 ? `+${n0(g)}` : n0(g), right: true, w: 700, color: g >= 0 ? C.ok : C.danger }] }; })} />
        </SheetFrame>
      ) : null}
    </>
  );
}
