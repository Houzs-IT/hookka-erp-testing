// Home Employees v3 · Workers & departments: the window switch, the department filter, and the four cards (Department efficiency,
// Worker ranking, Non-production hours, Attendance log). Visual + interaction source: the approved Home Employees v3 HTML.
// Data and rules: desktop EmployeesDashboard.tsx, NonProdHoursCard.tsx, AttendanceLogCard.tsx (emp-lib.ts).
import { useRef, useState, type PointerEvent } from "react";
import { Building2, CalendarCheck, CalendarDays, ChevronDown, Hourglass, Trophy, UserRound } from "lucide-react";
import { M } from "../../theme";
import { GREEN, RED } from "../../../dashboards/dashboard-shared-lib";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { TNUM } from "./home-style";
import { CREAM } from "./ops-oc-style";
import { ECardG, MorePill, ROW_DIV, T_LINE } from "./emp-glass";
import { RAIL, TONES, WASH, tint } from "./emp-glass-style";
import { DeptTable, NpTable, WorkerTable, type WorkerLine } from "./emp-tables";
import { Empty, LegendText, Pills, Segment, TipCard } from "./emp-ui";
import { dLab, dShort, hrs, npAxis, pctOf, type NpPoint } from "./emp-lib";
import { NP_LEGEND } from "./emp-rows";
import type { EmpModel } from "./emp-model";

// ---------------------------------------------------------------------------
// Workers & departments: label rule, window switch (or the day note), department filter
// ---------------------------------------------------------------------------
export function WorkersControls({ m }: { m: EmpModel }) {
  const { W } = m;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px 0" }}>
        <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>WORKERS &amp; DEPARTMENTS</span>
        <span aria-hidden="true" style={{ flex: 1, height: 1, background: `color-mix(in srgb, ${M.raisin} 10%, transparent)` }} />
        <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: M.ink, whiteSpace: "nowrap" }}>{W.label}</span>
      </div>
      {W.dayMode ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, background: CREAM, fontSize: 12, lineHeight: 1.45, color: M.ink }}>
          <CalendarDays size={14} strokeWidth={2} color={M.taupe} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
          <span>Showing the day picked at the top. Pick Month there for 7 days or the whole period.</span>
        </div>
      ) : (
        <div style={{ margin: "0 4px" }}>
          <Segment aria="Time window" value={m.win} onChange={m.setWin} options={[["day", "Latest day"], ["7d", "7 days"], ["period", "Whole period"]] as const} />
        </div>
      )}
      {/* Department filter (kept from the current dashboard; filters the worker ranking, as on the desktop). */}
      <label style={{ position: "relative", display: "block", margin: "0 4px" }}>
        <select aria-label="Department" value={m.dept} onChange={(e) => m.setDept(e.target.value)}
          style={{ width: "100%", height: 44, boxSizing: "border-box", appearance: "none", WebkitAppearance: "none", border: "none", borderRadius: 12, padding: "0 40px 0 14px", background: `linear-gradient(180deg,color-mix(in srgb, ${M.card} 95%, transparent),color-mix(in srgb, ${M.card} 78%, transparent))`, boxShadow: `inset 0 1px 0 ${M.card}, 0 0 0 1px rgba(201,169,97,.25), 0 6px 14px -8px rgba(107,92,50,.45)`, fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, color: M.raisin, cursor: "pointer" }}>
          <option value="ALL">All departments</option>
          {m.depts.map((d) => <option key={d} value={d}>{deptName(d)}</option>)}
        </select>
        <ChevronDown size={16} strokeWidth={2.2} color={M.taupe} aria-hidden="true" style={{ position: "absolute", right: 14, top: 14, pointerEvents: "none" }} />
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Department efficiency: top 3 by efficiency + the Total row
// ---------------------------------------------------------------------------
export function DeptCard({ m }: { m: EmpModel }) {
  const rows = m.deptRows;
  return (
    <ECardG icon={Building2} title="Department efficiency" below={`Top 3 by efficiency · ${m.W.label} · tap a department for its workers`} label="Department efficiency">
      {rows.length ? <DeptTable m={m} rows={rows.slice(0, 3)} total={m.deptTotal} /> : null}
      {rows.length ? <OutLegendRow /> : <Empty>No hours in this window.</Empty>}
      {rows.length ? <MorePill label={`All ${rows.length} departments`} onClick={() => m.open({ type: "depts" })} /> : null}
    </ECardG>
  );
}
function OutLegendRow() {
  const sw = (c: string, l: string) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8, padding: "0 4px", fontSize: 11, color: M.ink }}>
      {sw("#2B5797", "Bedframe")}{sw("#1F9E89", "Sofa")}{sw("#A8A29A", "Accessory")}<span style={{ whiteSpace: "nowrap" }}>· hours = production / working</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Worker ranking: upper half = the top 3 (medals); lower half = the bottom 3, worst first
// ---------------------------------------------------------------------------
function rankCardLines(m: EmpModel): WorkerLine[] {
  const { split, rkHalf } = m;
  if (rkHalf === "upper") return split.upper.slice(0, 3).map((r, i) => ({ r, rank: i + 1, gold: true, rail: RAIL.green, bg: WASH.green }));
  return split.lower.map((r, i) => ({ r, rank: split.half + i + 1 })).slice(-3).reverse().map((x) => ({ ...x, rail: RAIL.red, bg: WASH.red }));
}
export function RankCard({ m }: { m: EmpModel }) {
  const { split, rkHalf } = m;
  const list = rkHalf === "upper" ? split.upper : split.lower;
  return (
    <ECardG icon={Trophy} title="Worker ranking" below={`Ranked by efficiency over ${m.W.label}${m.dept !== "ALL" ? ` · ${deptName(m.dept)}` : ""}`} label="Worker ranking">
      <Pills aria="Ranking half" value={rkHalf} onChange={m.setRkHalf} options={[["upper", `Upper half · ${split.upper.length}`], ["lower", `Lower half · ${split.lower.length}`]] as const} />
      {list.length ? <WorkerTable m={m} lines={rankCardLines(m)} /> : <Empty>No one clocked an hour in this window.</Empty>}
      {list.length ? <MorePill label={`View all ${list.length} · ${rkHalf === "upper" ? "upper half" : "lower half"}`} onClick={() => m.open({ type: "rank", half: rkHalf })} /> : null}
    </ECardG>
  );
}

// ---------------------------------------------------------------------------
// Non-production hours (the chart is shared by the card and its sheet)
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
      {ax.ticks.map((v) => <g key={v}><line x1={NL} x2={NR} y1={y(v)} y2={y(v)} style={{ stroke: M.divider }} /><text x={NL - 5} y={y(v) + 3} textAnchor="end" fontSize={8.5} style={{ fill: M.muted }}>{v}</text></g>)}
      {si >= 0 ? <line x1={sx(si)} x2={sx(si)} y1={NT} y2={NB} stroke="#C9BFAE" strokeWidth={1} /> : null}
      {npHide.h ? null : points.map((v, i) => <rect key={`b${v.date}`} x={sx(i) - bw / 2} y={y(v.hours)} width={bw} height={Math.max(0, NB - y(v.hours))} rx={1.5} fill="#D9705A" fillOpacity={si < 0 || si === i ? 1 : 0.5} />)}
      {npHide.p ? null : <polyline points={points.map((v, i) => (v.pct == null ? null : `${sx(i)},${y(v.pct)}`)).filter(Boolean).join(" ")} fill="none" stroke="#5C4A2E" strokeWidth={1.6} strokeLinejoin="round" />}
      {npHide.p ? null : points.map((v, i) => (v.pct == null ? null : <circle key={`c${v.date}`} cx={sx(i)} cy={y(v.pct)} r={2.4} style={{ fill: M.card }} stroke="#5C4A2E" strokeWidth={1.4} />))}
      <line x1={NL} x2={NR} y1={NB} y2={NB} style={{ stroke: M.hairline }} />
      {points.map((v, i) => (i % every === 0 ? <text key={`x${v.date}`} x={sx(i)} y={NB + 13} textAnchor="middle" fontSize={8.5} style={{ fill: M.muted }}>{dShort(v.date)}</text> : null))}
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
  const byP = npView === "people";
  const none = (byP ? np.people : np.depts).length === 0;
  return (
    <ECardG icon={Hourglass} title="Non-production hours" label="Non-production hours"
      below={<>Clocked but logged outside the production departments (R&amp;D, warehousing, repair …) · <b style={{ color: RED }}>{hrs(np.total)}</b> = {pctOf(np.total, np.clocked)} of {hrs(np.clocked)} clocked</>}>
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
      {none ? <Empty>No non-production hours in this window.</Empty> : <NpTable m={m} people={byP ? np.people.slice(0, 3) : undefined} depts={byP ? undefined : np.depts.slice(0, 3)} />}
      {none ? null : <MorePill label="Chart and full list" onClick={() => m.open({ type: "np" })} />}
    </ECardG>
  );
}

// ---------------------------------------------------------------------------
// Attendance log card: Not in / Late / On time tiles, the stacked bar, the three groups (with the punch photo when the reader may
// see attendance), "Open attendance log".
// ---------------------------------------------------------------------------
function PunchFace({ id, has }: { id: string; has: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span aria-label="Clock-in photo" role="img" style={{ width: 32, height: 32, flex: "none", borderRadius: "50%", overflow: "hidden", background: "linear-gradient(160deg,#D9CFBF,#B9AC97)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
      {has && !failed ? <img src={`/api/attendance/${encodeURIComponent(id)}/photo?which=in`} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <UserRound size={16} strokeWidth={1.6} aria-hidden="true" />}
    </span>
  );
}

export function AttendanceCard({ m }: { m: EmpModel }) {
  const { dayL, monthL, logDay } = m;
  const s = monthL ?? dayL;
  const sum = { absent: s?.absent ?? 0, late: s?.late ?? 0, on: s?.on ?? 0 };
  const total = sum.absent + sum.late + sum.on || 1;
  const when = logDay ? dLab(logDay) : `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.monthYm.slice(5, 7)) - 1]} ${m.monthYm.slice(0, 4)}`;
  const tiles: [string, number, typeof TONES[keyof typeof TONES]][] = [["Not in", sum.absent, TONES.red], ["Late", sum.late, TONES.amber], ["On time", sum.on, TONES.green]];
  const segs: [number, string][] = [[sum.absent, RED], [sum.late, "#C9A04A"], [sum.on, GREEN]];
  const groups: [keyof NonNullable<typeof s>["groups"], string, string][] = [["absent", "Not in", RED], ["late", "Late", "#85600F"], ["on", "On time", GREEN]];
  // Punch photos of the log's own day (only a day log, only with attendance:read, only for that day's punches).
  const photoOf = new Map<string, { id: string; has: boolean }>();
  if (!monthL && logDay === m.W.anchor && m.punches.status === "ready") for (const p of m.punches.rows) if (!photoOf.has(p.employeeId)) photoOf.set(p.employeeId, { id: p.id, has: !!p.hasClockInPhoto });
  return (
    <ECardG icon={CalendarCheck} title="Attendance log" sub={`${when} · ${monthL ? "most absent first, then most late" : "not in first, then late, then on time"}`} divider label="Attendance log" id="emp-attendance">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
        {tiles.map(([l, n, t]) => (
          <div key={l} style={{ position: "relative", overflow: "hidden", minWidth: 0, padding: "9px 10px 9px 13px", borderRadius: 14, background: `linear-gradient(150deg,${M.card} 50%,${n ? tint(t.fg, 12) : tint(M.raisin, 5)})`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 8px 18px -12px rgba(107,92,50,.35)` }}>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: n ? t.fg : M.muted }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: M.taupe, textTransform: "uppercase", whiteSpace: "nowrap" }}>{l}</div>
            <div style={{ fontSize: 18, lineHeight: "24px", fontWeight: 800, color: n ? t.fg : M.muted, marginTop: 2, ...TNUM }}>{n}</div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: 2, height: 6, marginTop: 10, borderRadius: 999, overflow: "hidden", background: `color-mix(in srgb, ${M.divider} 80%, transparent)` }}>
        {segs.filter(([n]) => n > 0).map(([n, c]) => <span key={c} style={{ width: `${(n / total) * 100}%`, background: c }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10, marginTop: 12 }}>
        {s ? groups.map(([k, l, c]) => {
          const g = s.groups[k];
          return (
            <div key={k} style={{ borderRadius: 16, background: M.card, boxShadow: `0 0 0 1px ${T_LINE}, 0 10px 22px -16px rgba(107,92,50,.40)`, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: CREAM, borderBottom: `1px solid ${T_LINE}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: M.raisin }}>{l}</span>
                <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: tint(c, 14), color: c, fontSize: 11, fontWeight: 700, ...TNUM }}>{g.length}</span>
              </div>
              {g.length === 0 ? <div style={{ padding: "10px 12px", fontSize: 12.5, color: M.muted }}>None</div> : null}
              {g.slice(0, 3).map((r, i) => {
                const ph = k !== "absent" && r.id ? photoOf.get(r.id) : undefined;
                return (
                  <div key={`${r.n}${i}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46, padding: "6px 12px", borderTop: i ? `1px solid ${ROW_DIV}` : "none" }}>
                    {ph?.has ? <PunchFace id={ph.id} has /> : null}
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.n}</span>
                    <span style={{ flex: "none", fontSize: 12, color: M.ink, whiteSpace: "nowrap", ...TNUM }}>{r.d}</span>
                  </div>
                );
              })}
              {g.length > 3 ? <div style={{ padding: "8px 12px", borderTop: `1px solid ${ROW_DIV}`, fontSize: 12, fontWeight: 600, color: M.ink }}>+{g.length - 3} more</div> : null}
            </div>
          );
        }) : null}
      </div>
      <MorePill label="Open attendance log" onClick={() => m.open({ type: "log" })} top={12} />
    </ECardG>
  );
}

