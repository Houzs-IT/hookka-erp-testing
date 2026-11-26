// Home Operations v3 · Output & Cost, part 1: Costing vs production revenue and Plan vs actual.
// Visual + interaction source: the approved Home Operations HTML (cards AND every opened detail). Data and rules are the repo's own:
// desktop dashboards/CostingPanel.tsx and dashboards/ProductionDailyPanels.tsx (sub="plan").
import { useMemo, useState } from "react";
import { CalendarDays, Calculator, Info, Target } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { dropIdleSundays } from "../../../../lib/idle-sundays";
import { M } from "../../theme";
import { dayLabel, monthLabel, widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { SheetFrame } from "./home-ui";
import { TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import {
  costOf, costingByDay, costingCols, materialLines, n0, pct1, pctOf, planBars, planSeries, planTotals, rollUpMonths, stageRows, weekdayDayMonth, ZERO,
  type PlanMetric, type PlanRow,
} from "./ops-lib";
import { C, sheetCard } from "./ops-style";
import { StatusBlock, TableSheet } from "./ops-ui";
import { OGCard, ONote, PillButton } from "./ops-glass";
import { SecRule, TableCard } from "./ops-sheet-kit";
import { CapsLabel, ChartPanel, LegendToggle, OcSeg, SoftPill, ValueChip } from "./ops-oc-kit";
import { CREAM, OCHRE, PAPER_ROW, ROW_LINE, mixInto } from "./ops-oc-style";

const rm = (sen: number) => formatCurrency(Math.round(sen));

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------
type CostRow = { k: string; p?: string; v: string; weight: number; bg?: string; top?: boolean; muted?: boolean };

export function CostingCard({ d, period, today }: { d: OpsData; period: Period; today: string }) {
  const [sheet, setSheet] = useState<{ k: "month" | "mat"; ym: string; sub: string } | null>(null);
  const [allDays, setAllDays] = useState(false);
  const rev = d.revenue;
  const matReady = d.cost.status === "ready" && d.cost.prevStatus === "ready";
  const lab = d.labour.state;
  const withLabour = lab === "ready" || lab === "none";
  const invOk = d.pis.status === "ready";
  const byDay = useMemo(() => costingByDay({ revByDay: rev.byDay, pnl: d.cost.pnl, labourByDay: d.labour.byDay, directShare: d.labour.directShare, pis: invOk ? d.pis.rows : [], from: d.from, to: d.to }), [rev.byDay, d.cost.pnl, d.labour.byDay, d.labour.directShare, invOk, d.pis.rows, d.from, d.to]);
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

  const title = "Costing vs production revenue";
  const sub = "% of production revenue · materials used + labour = cost";
  if (rev.status !== "ready") {
    return (
      <OGCard icon={Calculator} title={title} sub={sub} label="Costing" id="ops-costing" divider={false}>
        <div style={{ marginTop: 10 }}><StatusBlock status={rev.status} what="Costing" need="a dashboard operations view" onRetry={rev.refresh} /></div>
      </OGCard>
    );
  }

  /** The design's table rows of one bucket: revenue, materials, [direct, non-production], total cost, purchases (not in cost). */
  const rowsOf = (b: (typeof head)["b"]): CostRow[] => {
    const pc = (v: number) => (b.revenue > 0 ? pct1(pctOf(v, b.revenue)) : "—");
    const val = (v: number) => (waiting ? "…" : blocked ? "—" : rm(v));
    const pcs = (v: number) => (waiting || blocked ? "" : pc(v));
    const cost = costOf(b, withLabour);
    return [
      { k: "Production revenue", v: b.revenue > 0 ? rm(b.revenue) : "—", weight: 700, bg: PAPER_ROW },
      { k: "Materials", v: val(b.material), p: pcs(b.material), weight: 500 },
      ...(withLabour ? [
        { k: "Direct labour", v: val(b.direct), p: pcs(b.direct), weight: 500 },
        { k: "Non-production", v: val(b.nonProd), p: pcs(b.nonProd), weight: 500 },
      ] : []),
      { k: withLabour ? "Total cost" : "Cost · materials only", v: val(cost), p: pcs(cost), weight: 800, bg: CREAM, top: true },
      ...(invOk ? [{ k: "Purchases · not in cost", v: rm(b.purchases), p: b.revenue > 0 ? pc(b.purchases) : "", weight: 500, muted: true }] : []),
    ];
  };

  const sheetMonth = sheet ? (byMonth.get(sheet.ym) ?? ZERO) : ZERO;
  // Newest first; a Sunday with nothing booked is left out (the design lists working days), as the desktop's day chart does.
  const sheetDays = sheet?.k === "month" ? dropIdleSundays([...byDay.entries()].filter(([x]) => x.startsWith(sheet.ym)).sort(([a], [b]) => b.localeCompare(a)), ([x]) => x, ([, b]) => [b.revenue, b.material, b.labour]) : [];
  const shownDays = allDays ? sheetDays : sheetDays.slice(0, 5);
  const lines = sheet?.k === "mat" ? materialLines(d.cost.sets, sheet.ym) : [];
  const tot = (f: (r: (typeof lines)[number]) => number) => lines.reduce((a, r) => a + f(r), 0);
  const closeSheet = () => { setSheet(null); setAllDays(false); };

  return (
    <>
      <OGCard icon={Calculator} title={title} sub={sub} right={<span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: M.ink, whiteSpace: "nowrap" }}>{monthLabel(d.focusMonth)}</span>} label="Costing" id="ops-costing" divider={false}>
        <CapsLabel top={14}>COST % · {monthLabel(d.focusMonth).toUpperCase()}</CapsLabel>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
          <span style={{ fontSize: 28, fontWeight: 700, lineHeight: "34px", letterSpacing: -0.6, color: headPct != null && prevPct != null ? (good ? C.ok : C.danger) : M.raisin, ...TNUM }}>{waiting ? "…" : pct1(headPct)}</span>
          {headPct != null && prevPct != null ? <span style={{ fontSize: 12.5, color: M.ink, ...TNUM }}>{good ? "▼" : "▲"} {Math.abs(headPct - prevPct).toFixed(1)} pts vs last month ({pct1(prevPct)})</span> : null}
        </div>
        {matNote ? <ONote top={8}>{matNote}</ONote> : null}
        {labNote ? <div role="status" style={{ marginTop: 8, fontSize: 11.5, color: M.ink, lineHeight: 1.4 }}>{labNote}</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10, marginTop: 12 }}>
          {cols.map((c, ci) => {
            const cost = costOf(c.b, withLabour);
            const isDay = !!period.day && ci === 0;
            const link = !!c.ym;
            const label = isDay ? dayLabel(period.day!) : c.label;
            return (
              <TableCard key={`${ci}-${c.label}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{label}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: M.ink, marginTop: 1 }}>{c.sub}</span>
                  </span>
                  <span style={{ flex: "none", fontSize: 15, fontWeight: 800, color: M.taupe, whiteSpace: "nowrap", ...TNUM }}>{blocked ? "—" : waiting ? "…" : pct1(pctOf(cost, c.b.revenue))}</span>
                </div>
                <div style={{ margin: "0 12px", borderRadius: 10, overflow: "hidden", boxShadow: `inset 0 0 0 1px ${ROW_LINE}`, ...TNUM }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 64px 118px", background: CREAM, borderBottom: `1px solid ${ROW_LINE}`, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: M.taupe, textTransform: "uppercase" }}>
                    <span style={{ padding: "7px 10px" }}>Line</span>
                    <span style={{ padding: "7px 8px", textAlign: "right", borderLeft: `1px solid ${ROW_LINE}` }}>% rev</span>
                    <span style={{ padding: "7px 10px", textAlign: "right", borderLeft: `1px solid ${ROW_LINE}` }}>Amount</span>
                  </div>
                  {rowsOf(c.b).map((g, gi) => (
                    <div key={g.k} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 64px 118px", alignItems: "stretch", borderTop: gi ? (g.top ? `1.5px solid ${ROW_LINE}` : `1px solid ${ROW_LINE}`) : "none", background: g.bg ?? "transparent" }}>
                      <span style={{ minWidth: 0, padding: "8px 10px", fontSize: 12, lineHeight: 1.35, fontWeight: g.weight === 800 ? 700 : g.weight, color: g.muted ? M.muted : g.weight >= 700 ? M.raisin : M.ink, overflowWrap: "anywhere" }}>{g.k}</span>
                      <span style={{ padding: "8px 8px", textAlign: "right", borderLeft: `1px solid ${ROW_LINE}`, fontSize: 11.5, color: OCHRE, fontWeight: 600, whiteSpace: "nowrap" }}>{g.p ?? ""}</span>
                      <span style={{ padding: "8px 10px", textAlign: "right", borderLeft: `1px solid ${ROW_LINE}`, fontSize: 12.5, fontWeight: g.weight === 500 ? 600 : g.weight, color: g.muted ? M.muted : M.raisin, whiteSpace: "nowrap" }}>{g.v}</span>
                    </div>
                  ))}
                </div>
                {link ? (
                  <button type="button" aria-label={`${label}: cost ${blocked ? "unavailable" : pct1(pctOf(cost, c.b.revenue))} of production revenue. Open day by day`} onClick={() => setSheet({ k: "month", ym: c.ym!, sub: c.sub })}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, height: 40, marginTop: 10, border: "none", borderTop: `1px solid ${ROW_LINE}`, background: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: M.taupe, cursor: "pointer", whiteSpace: "nowrap" }}>
                    <span>Day by day</span><span aria-hidden="true">›</span>
                  </button>
                ) : <div style={{ height: 10 }} />}
              </TableCard>
            );
          })}
        </div>
        <ONote>% = share of production revenue (completed Upholstery job cards). Materials = opening stock + purchases − closing stock. Purchases are stock bought, not used, so they’re not in cost.</ONote>
      </OGCard>

      {sheet?.k === "month" ? (
        <SheetFrame open title={`${monthLabel(sheet.ym)} · day by day`} sub={sheet.sub} onClose={closeSheet}>
          <TableCard>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 10, padding: "8px 12px", background: CREAM, borderBottom: `1px solid ${ROW_LINE}`, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: M.taupe, textTransform: "uppercase" }}>
              <span>Line</span><span>% of revenue</span><span style={{ minWidth: 104, textAlign: "right" }}>Amount</span>
            </div>
            {rowsOf(sheetMonth).map((g, gi) => (
              <div key={g.k} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 10, alignItems: "baseline", padding: "8px 12px", borderTop: gi ? `1px solid ${ROW_LINE}` : "none", ...TNUM }}>
                <span style={{ minWidth: 0, fontSize: 12.5, fontWeight: g.weight === 800 ? 700 : g.weight === 500 ? 500 : g.weight, color: g.muted ? M.muted : M.raisin }}>{g.k === "Materials" ? "Materials used" : g.k}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: OCHRE, whiteSpace: "nowrap" }}>{g.p ?? ""}</span>
                <span style={{ minWidth: 104, textAlign: "right", fontSize: 13, fontWeight: g.weight === 500 ? 500 : g.weight === 800 ? 700 : g.weight, color: g.muted ? M.muted : M.raisin, whiteSpace: "nowrap" }}>{g.v}</span>
              </div>
            ))}
          </TableCard>
          {matReady ? <PillButton label="Materials used breakdown" chevron="right" onClick={() => setSheet({ k: "mat", ym: sheet.ym, sub: sheet.sub })} /> : null}
          <SecRule label="DAY BY DAY" hint="Newest first" />
          {sheetDays.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>Nothing recorded this month.</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
            {shownDays.map(([day, b]) => (
              <TableCard key={day}>
                <div style={{ padding: "11px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CalendarDays size={14} strokeWidth={2} color="#8B7A4E" aria-hidden="true" />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{weekdayDayMonth(day)}</span>
                    <SoftPill>{blocked ? "—" : pct1(pctOf(costOf(b, withLabour), b.revenue))} cost</SoftPill>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${withLabour ? 3 : 2},minmax(0,1fr))`, gap: 6, marginTop: 9 }}>
                    <ValueChip k="Revenue" v={rm(b.revenue)} bg={M.paper} />
                    <ValueChip k="Materials" v={matReady ? rm(b.material) : "—"} bg={M.card} />
                    {withLabour ? <ValueChip k="Labour (all)" v={rm(b.labour)} bg={M.card} /> : null}
                  </div>
                </div>
              </TableCard>
            ))}
          </div>
          {sheetDays.length > 5 ? <PillButton label={allDays ? "Show fewer" : `Show all ${sheetDays.length} days`} expanded={allDays} chevron="none" onClick={() => setAllDays((v) => !v)} /> : null}
        </SheetFrame>
      ) : null}

      {sheet?.k === "mat" ? (
        <SheetFrame open title={`Materials used · ${monthLabel(sheet.ym)}`} sub={est(sheet.ym) ? "P&L lines · estimated month" : "P&L lines · opening + purchases − closing"} onBack={() => setSheet({ k: "month", ym: sheet.ym, sub: sheet.sub })} onClose={closeSheet}>
          {est(sheet.ym) ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10, padding: "10px 12px", borderRadius: 12, background: mixInto("#E8C766", 30), fontSize: 12, lineHeight: 1.45, color: M.raisin }}>
              <Info size={14} strokeWidth={2} color={OCHRE} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
              <span>No stock take yet for this month — the dashboard estimates it; the P&amp;L lines below have no closing stock.</span>
            </div>
          ) : null}
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
              <div style={{ padding: "11px 14px", borderTop: `1px solid ${M.divider}`, background: M.paper, margin: "0 -14px" }}>
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
const PLAN_DUE = "#D19A32";
const PLAN_DONE = "#2B5797";
const chartLabel = (iso: string) => (iso.length === 10 ? String(Number(iso.slice(8, 10))) : monthLabel(iso).slice(0, 3));

function PlanChart({ bars, plan, actual, selIdx, onPick, show }: { bars: PlanRow[]; plan: number[]; actual: (number | null)[]; selIdx: number; onPick: (b: PlanRow) => void; show: { done: boolean; due: boolean } }) {
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
      {show.due ? <polyline points={plan.map((v, i) => `${px(i)},${py(v)}`).join(" ")} fill="none" stroke={PLAN_DUE} strokeWidth={1.6} /> : null}
      {selIdx >= 0 ? <line x1={px(selIdx)} x2={px(selIdx)} y1={8} y2={140} stroke={M.taupe} strokeDasharray="3 3" /> : null}
      {show.done ? segs.map((s, i) => <polyline key={i} points={s} fill="none" stroke={PLAN_DONE} strokeWidth={2.2} />) : null}
      {selIdx >= 0 && show.due ? <circle cx={px(selIdx)} cy={py(plan[selIdx])} r={3} fill="#FFFFFF" stroke="#9A9082" strokeWidth={1.6} /> : null}
      {selIdx >= 0 && show.done && actual[selIdx] != null ? <circle cx={px(selIdx)} cy={py(actual[selIdx]!)} r={3.5} fill={PLAN_DONE} /> : null}
      {bars.map((b, i) => <rect key={b.iso} x={px(i) - hz / 2} y={0} width={hz} height={H} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onPick(b)} />)}
    </svg>
  );
}

function PlanTile({ k, v, color }: { k: string; v: string; color: string }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", minWidth: 0, padding: "10px 11px 10px 14px", borderRadius: 14, background: `linear-gradient(150deg,${M.card} 45%,${mixInto(color, 10)})`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 8px 18px -12px rgba(107,92,50,.35)` }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: M.taupe, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</div>
      <div style={{ fontSize: 20, lineHeight: "24px", fontWeight: 800, letterSpacing: -0.4, color, marginTop: 4, ...TNUM }}>{v}</div>
    </div>
  );
}

export function PlanCard({ d, period, onPeriod, today }: { d: OpsData; period: Period; onPeriod: (p: Period) => void; today: string }) {
  const [metric, setMetric] = useState<PlanMetric>("units");
  const [view, setView] = useState<"cum" | "day">("cum");
  const [show, setShow] = useState({ done: true, due: true });
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
  const monthly = period.mode === "monthly";

  const pick = (b: PlanRow) => {
    if (byMonth) onPeriod({ mode: "monthly", month: b.iso });
    else if (period.mode === "range") onPeriod({ mode: "monthly", month: b.iso.slice(0, 7), day: b.iso });
    else if (period.day && period.day !== b.iso) onPeriod({ mode: "monthly", month: period.month, day: b.iso });
    else onPeriod({ mode: "monthly", month: period.month, day: period.day === b.iso ? undefined : b.iso });
  };
  const pickText = selIdx >= 0 ? `${Number(bars[selIdx].iso.slice(8, 10))} ${monthLabel(bars[selIdx].iso.slice(0, 7)).slice(0, 3)} · plan ${n0(series.plan[selIdx])} · done ${series.actual[selIdx] == null ? "—" : n0(series.actual[selIdx]!)}` : "";

  return (
    <>
      <OGCard icon={Target} title="Are we keeping up with the plan?" sub={`Orders due by each day vs finished · ${periodText}`} label="Plan vs actual" id="ops-plan">
        {status !== "ready" || !lim || !tot ? (
          <StatusBlock status={status === "ready" ? "error" : status} what="Plan vs actual" need="production-orders access" reason={status === "ready" ? "the daily production slice is missing from the feed" : reason} onRetry={d.retryFeed} />
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
              <PlanTile k="Due by today" v={n0(dueToDate)} color={M.raisin} />
              <PlanTile k="Finished" v={n0(aT)} color="#4F7C3A" />
              <PlanTile k={gap >= 0 ? "Ahead" : "Behind"} v={n0(Math.abs(gap))} color={gap >= 0 ? "#4F7C3A" : "#9A3A2D"} />
              <PlanTile k={monthly || period.day ? "Still due this month" : "Still due"} v={n0(Math.max(0, pT - dueToDate))} color={M.ink} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: sameUnits ? "minmax(0,1fr)" : "minmax(0,1.35fr) minmax(0,1fr)", gap: 8, marginTop: 12 }}>
              <OcSeg radius={12} aria="View" value={view} onChange={setView} options={[["cum", "Running total"], ["day", byMonth ? "Per month" : "Per day"]]} />
              {!sameUnits ? <OcSeg radius={12} aria="Measure" value={metric} onChange={setMetric} options={[["units", "Units"], ["orders", "Orders"]]} /> : null}
            </div>
            <ChartPanel>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 2px" }}>
                <LegendToggle label="Completed" color={PLAN_DONE} on={show.done} onToggle={() => setShow((s) => ({ ...s, done: !s.done }))} />
                <LegendToggle label="Due" color={PLAN_DUE} on={show.due} onToggle={() => setShow((s) => ({ ...s, due: !s.due }))} />
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{pickText}</span>
              </div>
              {bars.length === 0 ? (
                <div role="status" style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: M.ink }}>Nothing recorded in this period.</div>
              ) : (
                <div role="img" aria-label="Plan versus actual — tap a day" style={{ position: "relative", width: "100%", height: 150, marginTop: 8 }}>
                  <PlanChart bars={bars} plan={series.plan} actual={series.actual} selIdx={selIdx} onPick={pick} show={show} />
                </div>
              )}
            </ChartPanel>
            <ONote>Cancelled orders excluded · {n0(lim.orders.withoutTarget)} orders have no target date. {byMonth ? "Tap a month to open it." : selIdx >= 0 ? "Tap the day again to clear it." : "Tap a day to see it."}</ONote>
            <PillButton label="By department" chevron="right" onClick={() => setDeptOpen(true)} />
          </>
        )}
      </OGCard>
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
