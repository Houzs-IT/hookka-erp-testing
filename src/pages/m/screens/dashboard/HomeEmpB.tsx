// Home Employees · Workers & departments controls and the four cards: Department efficiency, Worker ranking,
// Non-production hours, Attendance log. Visual + interaction source: the approved Home Employees 2 HTML.
// Data and rules: desktop EmployeesDashboard.tsx, NonProdHoursCard.tsx, AttendanceLogCard.tsx.
import { useRef, type PointerEvent } from "react";
import { Building2, CalendarCheck, CalendarDays, ChevronDown, ChevronRight, Hourglass, Trophy } from "lucide-react";
import { M } from "../../theme";
import { AMBER, GREEN, RED } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { SHADOW_SMALL, TNUM } from "./home-style";
import { Empty, ECard, EHead, LegendText, MoreBtn, Pills, RowList, Segment, TipCard } from "./emp-ui";
import { dLab, dShort, effColor, eff, hrs, npAxis, pct, pctOf, type NpPoint } from "./emp-lib";
import { NP_LEGEND, deptRow, deptSub, npDeptRow, npPersonRow, workerRow } from "./emp-rows";
import type { EmpModel } from "./emp-model";

// ---------------------------------------------------------------------------
// Workers & departments: label, window switch (or the day note), department filter
// ---------------------------------------------------------------------------
export function WorkersControls({ m }: { m: EmpModel }) {
  const { W } = m;
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "2px 2px 0" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>WORKERS &amp; DEPARTMENTS</span>
        <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{W.label}</span>
      </div>
      {W.dayMode ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, backgroundColor: "#F4EFE6", fontSize: 12, lineHeight: 1.45, color: M.ink }}>
          <CalendarDays size={14} strokeWidth={2} color={M.taupe} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
          <span>Showing the day picked at the top. Pick Month there for 7 days or the whole period.</span>
        </div>
      ) : (
        <Segment aria="Time window" value={m.win} onChange={m.setWin} options={[["day", "Latest day"], ["7d", "7 days"], ["period", "Whole period"]] as const} />
      )}
      <label style={{ position: "relative", display: "block" }}>
        <select aria-label="Department" value={m.dept} onChange={(e) => m.setDept(e.target.value)}
          style={{ width: "100%", height: 44, boxSizing: "border-box", appearance: "none", WebkitAppearance: "none", border: "none", borderRadius: 12, padding: "0 40px 0 14px", backgroundColor: M.card, boxShadow: SHADOW_SMALL, fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, color: M.raisin, cursor: "pointer" }}>
          <option value="ALL">All departments</option>
          {m.depts.map((d) => <option key={d} value={d}>{deptName(d)}</option>)}
        </select>
        <ChevronDown size={16} strokeWidth={2.2} color={M.taupe} aria-hidden="true" style={{ position: "absolute", right: 14, top: 14, pointerEvents: "none" }} />
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Department efficiency
// ---------------------------------------------------------------------------
export function DeptCard({ m }: { m: EmpModel }) {
  const t = m.deptTotal;
  const v = eff(t.prod, t.work);
  const rows = m.deptRows;
  return (
    <ECard label="Department efficiency">
      <EHead icon={Building2} bg="#F4EFE6" fg={M.taupe} title="Department efficiency" sub={deptSub(m)}
        right={<span style={{ flex: "none", fontSize: 14, fontWeight: 700, color: effColor(v, m.target), ...TNUM }}>{pct(v)}</span>} />
      <RowList rows={rows.slice(0, 3).map((r) => deptRow(m, r, true))} />
      {rows.length === 0 ? <Empty>No hours in this window.</Empty> : <MoreBtn label={`All ${rows.length} departments · output, salary, labour %`} onClick={() => m.open({ type: "depts" })} />}
    </ECard>
  );
}

// ---------------------------------------------------------------------------
// Worker ranking
// ---------------------------------------------------------------------------
export function RankCard({ m }: { m: EmpModel }) {
  const { split, rkHalf } = m;
  const list = rkHalf === "upper" ? split.upper : split.lower;
  return (
    <ECard label="Worker ranking">
      <EHead icon={Trophy} bg="#FBF3DC" fg="#9C6F1E" title="Worker ranking" sub={`Ranked by efficiency over ${m.W.label}${m.dept !== "ALL" ? ` · ${deptName(m.dept)}` : ""}`} />
      <Pills aria="Ranking half" value={rkHalf} onChange={m.setRkHalf} options={[["upper", `Upper half · ${split.upper.length}`], ["lower", `Lower half · ${split.lower.length}`]] as const} />
      <RowList rows={list.slice(0, 3).map((r, i) => workerRow(m, r, i, rkHalf === "upper" ? 0 : split.half))} />
      {list.length === 0 ? <Empty>No one clocked an hour in this window.</Empty> : <MoreBtn label={`View all ${list.length} · ${rkHalf === "upper" ? "upper half" : "lower half"}`} onClick={() => m.open({ type: "rank", half: rkHalf })} />}
    </ECard>
  );
}

// ---------------------------------------------------------------------------
// Non-production hours (chart is shared by the card and its sheet)
// ---------------------------------------------------------------------------
const NL = 26, NR = 316, NT = 10, NB = 150;
export function NpChart({ m, points }: { m: EmpModel; points: NpPoint[] }) {
  const { npHide, npSel } = m;
  const n = points.length;
  const drag = useRef(false);
  if (!n) return null;
  const ax = npAxis(points);
  const step = (NR - NL) / n;
  const sx = (i: number) => NL + step * (i + 0.5);
  const y = (v: number) => NB - (v / ax.mx) * (NB - NT);
  const bw = Math.max(3, step * 0.62);
  const si = npSel ? points.findIndex((v) => v.date === npSel) : -1;
  const every = Math.max(1, Math.ceil(n / 6));
  const pickAt = (e: PointerEvent<SVGRectElement>, toggle: boolean) => {
    const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 340;
    const i = Math.max(0, Math.min(n - 1, Math.floor((x - NL) / step)));
    const dt = points[i].date;
    if (toggle && npSel === dt) m.setNpSel(null);
    else if (npSel !== dt) m.setNpSel(dt);
  };
  return (
    <svg viewBox="0 0 340 166" width="100%" style={{ display: "block", overflow: "visible", fontFamily: "inherit" }}>
      {ax.ticks.map((v) => <g key={v}><line x1={NL} x2={NR} y1={y(v)} y2={y(v)} stroke="#F0ECE9" /><text x={NL - 5} y={y(v) + 3} textAnchor="end" fontSize={8.5} fill="#9A9082">{v}</text></g>)}
      {si >= 0 ? <line x1={sx(si)} x2={sx(si)} y1={NT} y2={NB} stroke="#C9BFAE" strokeWidth={1} /> : null}
      {npHide.h ? null : points.map((v, i) => <rect key={`b${v.date}`} x={sx(i) - bw / 2} y={y(v.hours)} width={bw} height={Math.max(0, NB - y(v.hours))} rx={1.5} fill="#D9705A" fillOpacity={si < 0 || si === i ? 1 : 0.5} />)}
      {npHide.p ? null : <polyline points={points.map((v, i) => (v.pct == null ? null : `${sx(i)},${y(v.pct)}`)).filter(Boolean).join(" ")} fill="none" stroke="#5C4A2E" strokeWidth={1.6} strokeLinejoin="round" />}
      {npHide.p ? null : points.map((v, i) => (v.pct == null ? null : <circle key={`c${v.date}`} cx={sx(i)} cy={y(v.pct)} r={2.4} fill="#FFFFFF" stroke="#5C4A2E" strokeWidth={1.4} />))}
      <line x1={NL} x2={NR} y1={NB} y2={NB} stroke="#D9D2C6" />
      {points.map((v, i) => (i % every === 0 ? <text key={`x${v.date}`} x={sx(i)} y={NB + 13} textAnchor="middle" fontSize={8.5} fill="#9A9082">{dShort(v.date)}</text> : null))}
      <rect x={NL} y={0} width={NR - NL} height={166} fill="transparent" style={{ cursor: "pointer", touchAction: "pan-y" }}
        onPointerDown={(e) => { drag.current = true; pickAt(e, true); }} onPointerMove={(e) => { if (drag.current) pickAt(e, false); }} onPointerUp={() => { drag.current = false; }} onPointerLeave={() => { drag.current = false; }} />
    </svg>
  );
}
export function NpTip({ m }: { m: EmpModel }) {
  const v = m.npSel ? m.npPoints.find((x) => x.date === m.npSel) : null;
  if (!v) return <div style={{ fontSize: 11.5, color: M.muted, marginTop: 6 }}>Tap or slide on the chart to see a day</div>;
  return <TipCard head={dShort(v.date)} onClear={() => m.setNpSel(null)} rows={[{ k: "% of clocked", v: v.pct == null ? "—" : `${v.pct.toFixed(1)}%`, c: M.raisin }, { k: "Non-production hours", v: `${v.hours.toFixed(1)} h`, c: "#C2410C" }]} />;
}

export function NonProdCard({ m }: { m: EmpModel }) {
  const { np, npView, npHide } = m;
  const rows = npView === "people" ? np.people.slice(0, 3).map((r, i) => npPersonRow(m, r, i)) : np.depts.slice(0, 3).map((d) => npDeptRow(m, d));
  const none = (npView === "people" ? np.people : np.depts).length === 0;
  const flat = rows.map((r) => ({ ...r, onTap: undefined }));
  return (
    <ECard label="Non-production hours">
      <EHead icon={Hourglass} bg="#FCE9E0" fg="#C2410C" title="Non-production hours"
        sub={<>Clocked but logged outside the production departments (R&amp;D, warehousing, repair …) · <b style={{ color: RED }}>{hrs(np.total)}</b> = {pctOf(np.total, np.clocked)} of {hrs(np.clocked)} clocked</>} />
      <Pills aria="Non-production view" value={npView} onChange={m.setNpView} options={[["people", "By person"], ["dept", "By department"]] as const} />
      {m.npPoints.length ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 12 }}>
            {NP_LEGEND.map(([k, l, c, h]) => <LegendText key={k} label={l} color={c} h={h} on={!npHide[k]} onToggle={() => m.setNpHide((x) => ({ ...x, [k]: !x[k] }))} />)}
          </div>
          <div role="img" aria-label="Non-production hours per day — tap or slide" style={{ marginTop: 8 }}><NpChart m={m} points={m.npPoints} /></div>
          <NpTip m={m} />
        </>
      ) : null}
      <RowList rows={flat} />
      {none ? <Empty>No non-production hours in this window.</Empty> : <MoreBtn label="Chart and full list" onClick={() => m.open({ type: "np" })} />}
    </ECard>
  );
}

// ---------------------------------------------------------------------------
// Attendance log
// ---------------------------------------------------------------------------
export function AttendanceCard({ m }: { m: EmpModel }) {
  const { dayL, monthL, logDay } = m;
  const s = monthL ?? dayL;
  const sum = { absent: s?.absent ?? 0, late: s?.late ?? 0, on: s?.on ?? 0 };
  const total = sum.absent + sum.late + sum.on || 1;
  const when = logDay ? dLab(logDay) : `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.monthYm.slice(5, 7)) - 1]} ${m.monthYm.slice(0, 4)}`;
  const counts: [string, number, string][] = [["Not in", sum.absent, RED], ["Late", sum.late, AMBER], ["On time", sum.on, M.raisin]];
  const segs: [number, string][] = [[sum.absent, "#C0392B"], [sum.late, "#C9A04A"], [sum.on, GREEN]];
  const groups: [keyof NonNullable<typeof s>["groups"], string, string, string][] = [["absent", "Not in", RED, "#FBE7E3"], ["late", "Late", "#85600F", "#FAEFCB"], ["on", "On time", GREEN, "#EEF3E4"]];
  return (
    <ECard label="Attendance log" id="emp-attendance">
      <EHead icon={CalendarCheck} bg="#EEF3E4" fg={GREEN} title="Attendance log" right={<span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>{when}</span>} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", marginTop: 12, padding: "10px 0", borderTop: `1px solid ${M.divider}`, borderBottom: `1px solid ${M.divider}` }}>
        {counts.map(([l, n, c], i) => (
          <div key={l} style={{ minWidth: 0, textAlign: "center", borderLeft: i ? `1px solid ${M.divider}` : "none" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: n ? c : M.muted, ...TNUM }}>{n}</div>
            <div style={{ fontSize: 11.5, color: M.ink, marginTop: 1 }}>{l}</div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: 2, height: 8, marginTop: 10, borderRadius: 999, overflow: "hidden", backgroundColor: M.divider }}>
        {segs.filter(([n]) => n > 0).map(([n, c]) => <span key={c} style={{ width: `${(n / total) * 100}%`, backgroundColor: c }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 12, marginTop: 12 }}>
        {s ? groups.map(([k, l, c, bg]) => {
          const g = s.groups[k];
          return (
            <div key={k}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: c }} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: M.raisin }}>{l}</span>
                <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, backgroundColor: bg, color: c, fontSize: 11, fontWeight: 700, ...TNUM }}>{g.length}</span>
              </div>
              {g.length === 0 ? <div style={{ fontSize: 12, color: M.muted, padding: "6px 0 0 16px" }}>None</div> : null}
              {g.slice(0, 3).map((r, i) => (
                <div key={`${r.n}${i}`} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 0 0 16px" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.n}</span>
                  <span style={{ flex: "none", fontSize: 12, color: M.ink, whiteSpace: "nowrap", ...TNUM }}>{r.d}</span>
                </div>
              ))}
              {g.length > 3 ? <div style={{ fontSize: 11.5, color: M.muted, padding: "4px 0 0 16px" }}>+{g.length - 3} more</div> : null}
            </div>
          );
        }) : null}
      </div>
      <button type="button" onClick={() => m.open({ type: "log" })} style={{ width: "100%", height: 44, margin: "8px 0 -6px", border: "none", background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>Open attendance log<ChevronRight size={15} strokeWidth={2} aria-hidden="true" /></button>
    </ECard>
  );
}
