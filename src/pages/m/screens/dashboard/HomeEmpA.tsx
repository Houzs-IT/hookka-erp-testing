// Home Employees v3 · Workforce card (Present + four KPI tiles) and the Working vs production hours chart.
// Visual + interaction source: the approved Home Employees v3 HTML. Data and rules: desktop dashboards/EmployeesDashboard.tsx
// (emp-lib.ts): labour from payroll, helpers left out of production efficiency, revenue per worker-day.
import { useRef, type PointerEvent } from "react";
import { CalendarDays, ChartColumn, Gauge, TrendingUp, UserCheck, UserRound, Users, Wallet } from "lucide-react";
import { M } from "../../theme";
import { AMBER, GREEN, RED, monthLabel, periodLabel } from "../../../dashboards/dashboard-shared-lib";
import { TNUM } from "./home-style";
import { G } from "./sales-glass";
import { LegendToggle } from "./ops-oc-kit";
import { ONote } from "./ops-glass";
import { BLUE, CHART_AREA, CHART_SEL, ECardG, KpiTile } from "./emp-glass";
import { TONES, tint } from "./emp-glass-style";
import { axisLabelIdx, dShort, poolEff, effColor, hrs, mainAxis, overallText, pct } from "./emp-lib";
import type { EmpModel } from "./emp-model";

// ---------------------------------------------------------------------------
// Workforce: Present (full width) + Labour cost, Labour cost per person, Revenue per person, Production efficiency
// ---------------------------------------------------------------------------
function PresentTile({ m }: { m: EmpModel }) {
  const { pres, roster, W } = m;
  const absent = pres.absent.length;
  const tone = absent ? TONES.red : TONES.green;
  const inW = roster.length ? (pres.present / roster.length) * 100 : 0;
  // Present opens the punches of that day (attendance:read). Without that permission it opens the attendance log, whose
  // data is this dashboard's own feed (the Employees view's gate) — never an empty punch list.
  const open = () => {
    if (m.punches.allowed || m.punches.permLoading) m.open({ type: "present" });
    else { m.setLogPick(null); m.open({ type: "log" }); }
  };
  return (
    <KpiTile icon={UserCheck} tone={tone} label={`Present on ${W.anchor || "—"}`} value="" aria={m.punches.allowed ? "Open who clocked in" : "Open attendance log"} onTap={open} span>
      <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
        <span style={{ flex: "none", fontSize: 15, lineHeight: "20px", fontWeight: 800, color: absent ? RED : M.raisin, whiteSpace: "nowrap", ...TNUM }}>{pres.present} / {roster.length}</span>
        <span aria-hidden="true" style={{ flex: 1, height: 6, borderRadius: 999, background: `color-mix(in srgb, ${M.divider} 85%, transparent)`, overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${inW}%`, borderRadius: 999, background: TONES.green.fg }} />
        </span>
      </span>
      <span style={{ display: "block", marginTop: 3, fontSize: 11, lineHeight: 1.35, color: absent ? "#C0392B" : TONES.green.fg, overflowWrap: "anywhere" }}>
        {absent ? `${absent} not in · tap to see who` : "Everyone clocked in"}
      </span>
    </KpiTile>
  );
}

export function Workforce({ m }: { m: EmpModel }) {
  const { totals, head, W, target } = m;
  const e = poolEff(totals);
  const labourTone = head.labourPct != null && head.prevLabourPct != null ? (head.labourPct <= head.prevLabourPct ? "good" : "bad") : "neutral";
  const salaryOk = m.salaryStatus === "ready";
  // The change compares revenue per worker-day with last month's (desktop rule); not shown for a single day.
  const revBadge = m.revStatus === "ready" && head.revChange != null && W.effWin !== "day" ? `${head.revChange >= 0 ? "▲" : "▼"} ${Math.abs(head.revChange).toFixed(1)}% vs last month` : "";
  const helpers = overallText(totals);
  return (
    <ECardG icon={Users} title="Workforce" divider label="Workforce">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 10 }}>
        <PresentTile m={m} />
        <KpiTile icon={Wallet} tone={TONES.blue} label="Labour cost" aria={`Labour · ${W.label}`} value={m.salaryText(head.winSalary)} valueColor={BLUE}
          sub={m.salaryNote ?? "Total from payroll"} onTap={m.canSalary && m.salaryStatus !== "denied" ? () => m.open({ type: "tile", kind: "salary" }) : undefined} />
        <KpiTile icon={UserRound} tone={TONES.taupe} label="Labour cost per person" aria="Avg labour cost per person" value={m.salaryText(totals.fte ? head.winSalary / totals.fte : 0)}
          badge={salaryOk && head.labourPct != null ? `${head.labourPct.toFixed(1)}% of revenue` : undefined} badgeTone={labourTone}
          sub={m.salaryNote ?? (salaryOk && head.prevLabourPct != null ? `Last month ${head.prevLabourPct.toFixed(1)}% of revenue` : "Per full-time person")} />
        <KpiTile icon={TrendingUp} tone={TONES.green} label="Revenue per person" aria="Avg production revenue per person" value={m.revText(head.revPerFte)} valueColor={GREEN}
          badge={revBadge || undefined} badgeTone={head.revChange == null ? "neutral" : head.revChange >= 0 ? "good" : "bad"}
          sub={m.revNote ?? `${m.revText(head.revPerDay)} per worker-day`} />
        <KpiTile icon={Gauge} tone={TONES.amber} label="Production efficiency" aria="Production efficiency, see each worker" value={pct(e)} valueColor={effColor(e, target)}
          sub={<>{hrs(totals.prod)} earned of {hrs(totals.work)} worked{helpers ? <><br />{helpers}</> : null}</>} onTap={() => m.open({ type: "tile", kind: "eff" })} />
      </div>
    </ECardG>
  );
}

// ---------------------------------------------------------------------------
// Working vs production hours · efficiency
// ---------------------------------------------------------------------------
const L = 30, RR = 312, T0 = 12, B0 = 168;

export function ChartCard({ m }: { m: EmpModel }) {
  const { chart, target, W, period, hide, chSel } = m;
  const n = chart.length;
  const ax = mainAxis(chart);
  const step = n ? (RR - L) / n : 1, Wd = RR - L, H = B0 - T0;
  const sx = (i: number) => L + step * (i + 0.5);
  const yH = (min: number) => B0 - (min / 60 / ax.mxH) * H;
  const yP = (v: number) => B0 - (Math.min(v, ax.mxP) / ax.mxP) * H;
  const bw = Math.max(3, step * 0.62);
  const si = chSel ? chart.findIndex((d) => d.date === chSel) : -1;
  const sel = si >= 0 ? chart[si] : null;
  const labels = axisLabelIdx(n);
  const dotC = (v: number) => (v >= target ? GREEN : v >= target * 0.85 ? AMBER : RED);
  const drag = useRef(false);
  const pickAt = (e: PointerEvent<SVGRectElement>, toggle: boolean) => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 340;
    const i = Math.max(0, Math.min(n - 1, Math.floor((x - L) / step)));
    const dt = chart[i].date;
    if (toggle && chSel === dt) m.setChSel(null);
    else if (chSel !== dt) m.setChSel(dt);
  };
  const sub = W.dayMode && period.day ? `${monthLabel(period.day.slice(0, 7))} · picked ${dShort(period.day)}` : periodLabel(period);
  const tog = (k: string) => m.setHide((x) => ({ ...x, [k]: !x[k] }));
  const area = n ? `M${sx(0)},${B0} ${chart.map((d, i) => `L${sx(i)},${yH(d.workingMin)}`).join(" ")} L${sx(n - 1)},${B0} Z` : "";
  const line = chart.map((d, i) => (d.eff == null ? null : `${sx(i)},${yP(d.eff)}`)).filter(Boolean).join(" ");
  const tip = sel ? [["Efficiency", pct(sel.eff), "#B08D3E"], ["Production", hrs(sel.productionMin), M.raisin], ["Working", hrs(sel.workingMin), M.muted]] as const : [];
  return (
    <ECardG icon={ChartColumn} title="Working vs production hours · efficiency" below={sub} divider label="Working vs production hours and efficiency">
      <div style={{ ...G.panel, padding: "12px 10px 10px", background: `color-mix(in srgb, ${M.card} 72%, transparent)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "0 4px" }}>
          <LegendToggle label="Working" color="#D9D2C6" h={8} round={false} on={!hide.Working} onToggle={() => tog("Working")} />
          <LegendToggle label="Production" color="#6B5C32" h={8} round={false} on={!hide.Production} onToggle={() => tog("Production")} />
          <LegendToggle label="Efficiency" color="#C9A961" h={3} round={false} on={!hide.Efficiency} onToggle={() => tog("Efficiency")} />
        </div>
        {n === 0 ? (
          <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: M.muted }}>No hours in this period.</div>
        ) : (
          <div role="img" aria-label="Working, production hours and efficiency per day — tap a day" style={{ position: "relative", width: "100%", marginTop: 8 }}>
            <svg viewBox="0 0 340 186" width="100%" style={{ display: "block", overflow: "visible", fontFamily: "inherit" }}>
              {ax.hTicks.map((v) => <g key={`t${v}`}><line x1={L} x2={RR} y1={B0 - (v / ax.mxH) * H} y2={B0 - (v / ax.mxH) * H} style={{ stroke: M.divider }} strokeWidth={1} /><text x={L - 5} y={B0 - (v / ax.mxH) * H + 3} textAnchor="end" fontSize={8.5} style={{ fill: M.muted }}>{v}</text></g>)}
              {ax.pTicks.map((v) => <text key={`p${v}`} x={RR + 4} y={yP(v) + 3} fontSize={8.5} style={{ fill: M.muted }}>{v}%</text>)}
              {si >= 0 ? <rect x={sx(si) - step / 2} y={T0} width={step} height={H} style={{ fill: CHART_SEL }} /> : null}
              {hide.Working ? null : <path d={area} style={{ fill: CHART_AREA }} fillOpacity={0.85} stroke="#B9AE9F" strokeWidth={1} />}
              {hide.Production ? null : chart.map((d, i) => <rect key={`b${d.date}`} x={sx(i) - bw / 2} y={yH(d.productionMin)} width={bw} height={Math.max(0, B0 - yH(d.productionMin))} rx={1.5} fill="#6B5C32" fillOpacity={si < 0 || si === i ? 1 : 0.55} />)}
              <line x1={L} x2={RR} y1={yP(target)} y2={yP(target)} style={{ stroke: M.muted }} strokeDasharray="3 3" strokeWidth={1} />
              <text x={RR - 2} y={yP(target) - 4} textAnchor="end" fontSize={8.5} fill={GREEN}>target {target}%</text>
              {hide.Efficiency ? null : <polyline points={line} fill="none" stroke="#C9A961" strokeWidth={2} strokeLinejoin="round" />}
              {hide.Efficiency ? null : chart.map((d, i) => (d.eff == null ? null : <circle key={`c${d.date}`} cx={sx(i)} cy={yP(d.eff)} r={n > 26 ? 2.4 : 3} style={{ fill: M.card }} stroke={dotC(d.eff)} strokeWidth={1.5} />))}
              <line x1={L} x2={RR} y1={B0} y2={B0} style={{ stroke: M.hairline }} strokeWidth={1} />
              {chart.map((d, i) => (labels.has(i) ? <text key={`x${d.date}`} x={sx(i)} y={B0 + 13} textAnchor="middle" fontSize={8.5} style={{ fill: M.muted }}>{dShort(d.date)}</text> : null))}
              <rect x={L} y={0} width={Wd} height={186} fill="transparent" style={{ cursor: "pointer", touchAction: "pan-y" }}
                onPointerDown={(e) => { drag.current = true; pickAt(e, true); }} onPointerMove={(e) => { if (drag.current) pickAt(e, false); }} onPointerUp={() => { drag.current = false; }} onPointerLeave={() => { drag.current = false; }} />
            </svg>
          </div>
        )}
        {sel ? (
          <div style={{ marginTop: 10, padding: "10px 4px 0", borderTop: `1px solid ${G.rule}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CalendarDays size={14} strokeWidth={2} color="#8B7A4E" aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin }}>{dShort(sel.date)}{m.salaryStatus === "ready" ? ` · salary ${m.rm(sel.cost)}` : ""}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 8 }}>
              {tip.map(([k, v, c]) => (
                <div key={k} style={{ minWidth: 0, padding: "7px 9px", borderRadius: 10, background: M.card, boxShadow: `inset 0 0 0 1px ${tint(M.raisin, 7)}` }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: M.muted, whiteSpace: "nowrap" }}>{k}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: c, marginTop: 2, whiteSpace: "nowrap", ...TNUM }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <ONote>Tap a day to see it; tap it again to clear. Tap a legend to show or hide it.</ONote>
    </ECardG>
  );
}

