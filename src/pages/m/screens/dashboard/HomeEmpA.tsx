// Home Employees · headline boxes and the Working vs production hours chart.
// Visual + interaction source: the approved Home Employees 2 HTML. Data and rules: desktop dashboards/EmployeesDashboard.tsx.
import { useRef, type PointerEvent } from "react";
import { ChartColumn } from "lucide-react";
import { M } from "../../theme";
import { AMBER, GREEN, RED, monthLabel, periodLabel } from "../../../dashboards/dashboard-shared-lib";
import { Chv, ECard, EHead, LegendChip, TipCard } from "./emp-ui";
import { SHADOW_CARD, TNUM } from "./home-style";
import { axisLabelIdx, dShort, eff, effColor, hrs, mainAxis, pct } from "./emp-lib";
import type { EmpModel } from "./emp-model";

// ---------------------------------------------------------------------------
// Headline: five separate white boxes (Present, Salary, Avg labour cost, Avg production revenue, Overall efficiency)
// ---------------------------------------------------------------------------
function Box({ label, value, color, sub, badge, tone, span, onTap, aria }: {
  label: string; value: string; color: string; sub: string; badge?: string; tone?: "good" | "bad" | "neutral"; span?: boolean; onTap?: () => void; aria: string;
}) {
  const bg = tone === "good" ? "#EEF3E4" : tone === "bad" ? "#FBE7E3" : "#F5F2ED";
  const fg = tone === "good" ? GREEN : tone === "bad" ? RED : M.taupe;
  return (
    <button type="button" onClick={onTap} disabled={!onTap} aria-label={aria}
      style={{ gridColumn: span ? "1 / -1" : undefined, minWidth: 0, display: "block", padding: "10px 11px 11px", border: "none", backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_CARD, fontFamily: "inherit", textAlign: "left", cursor: onTap ? "pointer" : "default", WebkitTapHighlightColor: "transparent", color: "inherit" }}>
      <span style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.3, color: M.ink, overflowWrap: "anywhere" }}>{label}</span>
        {onTap ? <Chv size={13} /> : null}
      </span>
      <span style={{ display: "block", fontSize: 17, lineHeight: "22px", fontWeight: 700, color, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{value}</span>
      {badge ? <span style={{ display: "inline-flex", alignItems: "center", marginTop: 4, padding: "2px 6px", borderRadius: 6, backgroundColor: bg, color: fg, fontSize: 10.5, fontWeight: 700, lineHeight: 1.3, ...TNUM }}>{badge}</span> : null}
      <span style={{ display: "block", fontSize: 11, lineHeight: 1.35, color: M.ink, marginTop: 3, overflowWrap: "anywhere", ...TNUM }}>{sub}</span>
    </button>
  );
}

export function Headline({ m }: { m: EmpModel }) {
  const { pres, roster, totals, head, W, target } = m;
  const e = eff(totals.prod, totals.work);
  const labourTone = head.labourPct != null && head.prevLabourPct != null ? (head.labourPct <= head.prevLabourPct ? "good" : "bad") : "neutral";
  const salaryOk = m.salaryStatus === "ready";
  const revBadge = m.revStatus === "ready" && head.revChange != null && W.effWin !== "day" ? `${head.revChange >= 0 ? "▲" : "▼"} ${Math.abs(head.revChange).toFixed(1)}%` : "";
  return (
    <section aria-label="Headline">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
        <Box aria="Open attendance log" label={`Present on ${W.anchor || "—"}`} value={`${pres.present} / ${roster.length}`} color={pres.absent.length ? RED : M.raisin}
          sub={pres.absent.length ? `${pres.absent.length} not in · tap to see who` : "Everyone clocked in"} onTap={() => { m.setLogPick(null); m.open({ type: "log" }); }} />
        <Box aria={`Salary ${W.label}`} label={`Salary · ${W.label}`} value={m.salaryText(head.winSalary)} color="#8A6A3B" sub={m.salaryNote ?? "Logged hours × Labor Cost rate"}
          onTap={m.canSalary && m.salaryStatus !== "denied" ? () => m.open({ type: "tile", kind: "salary" }) : undefined} />
        <Box aria="Avg labour cost per person" label="Avg labour cost / person" value={m.salaryText(totals.fte ? head.winSalary / totals.fte : 0)} color={M.raisin}
          badge={salaryOk && head.labourPct != null ? `${head.labourPct.toFixed(1)}% of revenue` : undefined} tone={labourTone}
          sub={m.salaryNote ?? (salaryOk && head.prevLabourPct != null ? `Last month ${head.prevLabourPct.toFixed(1)}%` : "Per full-time person")} />
        <Box aria="Avg production revenue per person" label="Avg production revenue / person" value={m.revText(head.revPerFte)} color={GREEN}
          badge={revBadge || undefined} tone={head.revChange == null ? "neutral" : head.revChange >= 0 ? "good" : "bad"} sub={m.revNote ?? "Per day vs last month"} />
        <Box aria="Overall efficiency, see each worker" label="Overall efficiency" value={pct(e)} color={effColor(e, target)} span
          sub={`${hrs(totals.prod)} production ÷ ${hrs(totals.work)} working`} onTap={() => m.open({ type: "tile", kind: "eff" })} />
      </div>
    </section>
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
  return (
    <ECard label="Working vs production hours and efficiency">
      <EHead icon={ChartColumn} bg="#E7EEF1" fg="#1F4654" title="Working vs production hours · efficiency" sub={sub} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        <LegendChip label="Working" color="#D9D2C6" h={8} on={!hide.Working} onToggle={() => tog("Working")} />
        <LegendChip label="Production" color="#6B5C32" h={8} on={!hide.Production} onToggle={() => tog("Production")} />
        <LegendChip label="Efficiency" color="#C9A961" h={3} on={!hide.Efficiency} onToggle={() => tog("Efficiency")} />
      </div>
      {n === 0 ? (
        <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: M.muted }}>No hours in this period.</div>
      ) : (
        <div role="img" aria-label="Working, production hours and efficiency per day — tap a day" style={{ position: "relative", width: "100%", marginTop: 10 }}>
          <svg viewBox="0 0 340 186" width="100%" style={{ display: "block", overflow: "visible", fontFamily: "inherit" }}>
            {ax.hTicks.map((v) => <g key={`t${v}`}><line x1={L} x2={RR} y1={B0 - (v / ax.mxH) * H} y2={B0 - (v / ax.mxH) * H} stroke="#F0ECE9" strokeWidth={1} /><text x={L - 5} y={B0 - (v / ax.mxH) * H + 3} textAnchor="end" fontSize={8.5} fill="#9A9082">{v}</text></g>)}
            {ax.pTicks.map((v) => <text key={`p${v}`} x={RR + 4} y={yP(v) + 3} fontSize={8.5} fill="#9A9082">{v}%</text>)}
            {si >= 0 ? <rect x={sx(si) - step / 2} y={T0} width={step} height={H} fill="#F4EFE6" /> : null}
            {hide.Working ? null : <path d={area} fill="#E9E3DA" fillOpacity={0.85} stroke="#B9AE9F" strokeWidth={1} />}
            {hide.Production ? null : chart.map((d, i) => <rect key={`b${d.date}`} x={sx(i) - bw / 2} y={yH(d.productionMin)} width={bw} height={Math.max(0, B0 - yH(d.productionMin))} rx={1.5} fill="#6B5C32" fillOpacity={si < 0 || si === i ? 1 : 0.55} />)}
            <line x1={L} x2={RR} y1={yP(target)} y2={yP(target)} stroke="#9A9082" strokeDasharray="3 3" strokeWidth={1} />
            <text x={RR - 2} y={yP(target) - 4} textAnchor="end" fontSize={8.5} fill={GREEN}>target {target}%</text>
            {hide.Efficiency ? null : <polyline points={line} fill="none" stroke="#C9A961" strokeWidth={2} strokeLinejoin="round" />}
            {hide.Efficiency ? null : chart.map((d, i) => (d.eff == null ? null : <circle key={`c${d.date}`} cx={sx(i)} cy={yP(d.eff)} r={n > 26 ? 2.4 : 3} fill="#FFFFFF" stroke={dotC(d.eff)} strokeWidth={1.5} />))}
            <line x1={L} x2={RR} y1={B0} y2={B0} stroke="#D9D2C6" strokeWidth={1} />
            {chart.map((d, i) => (labels.has(i) ? <text key={`x${d.date}`} x={sx(i)} y={B0 + 13} textAnchor="middle" fontSize={8.5} fill="#9A9082">{dShort(d.date)}</text> : null))}
            <rect x={L} y={0} width={Wd} height={186} fill="transparent" style={{ cursor: "pointer", touchAction: "pan-y" }}
              onPointerDown={(e) => { drag.current = true; pickAt(e, true); }} onPointerMove={(e) => { if (drag.current) pickAt(e, false); }} onPointerUp={() => { drag.current = false; }} onPointerLeave={() => { drag.current = false; }} />
          </svg>
        </div>
      )}
      <div style={{ marginTop: 10, minHeight: 20 }}>
        {sel ? (
          <TipCard head={`${dShort(sel.date)}${m.salaryStatus === "ready" ? ` · salary ${m.rm(sel.cost)}` : ""}`} onClear={() => m.setChSel(null)}
            rows={[{ k: "Efficiency", v: pct(sel.eff), c: "#B08D3E" }, { k: "Production", v: hrs(sel.productionMin), c: M.raisin }, { k: "Working", v: hrs(sel.workingMin), c: M.muted }]} />
        ) : <span style={{ fontSize: 11.5, color: M.muted }}>Tap or slide on the chart to see a day</span>}
      </div>
    </ECard>
  );
}
