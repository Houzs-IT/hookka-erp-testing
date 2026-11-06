// Home Operations · Overview, part 2: Plant Load and Department Backlog, with their bottom sheets.
// Visual + interaction source: the approved Home Operations HTML. Data and rules: desktop dashboard-b/index.tsx
// (plantLoad, deptBacklog). Both read GET /api/dashboard/overview?period=<month|quarter|year>: they FOLLOW the period,
// a past period shows a saved snapshot / a month-end reconstruction / today's live figure (labelled), and a picked day
// does not change them (the department capacity is always the rolling 14 working days).
import { useMemo, useState } from "react";
import { CircleCheck, Clock, Factory, Package, TriangleAlert, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { SheetFrame } from "./home-ui";
import { NOWRAP_ELLIPSIS, TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import { backlogRows, capacityWindowLabel, completedHead, hm, hrs, n0, perWorkerMin, plantGauge, stateTag, weekdayDay, weekdayDayMonth } from "./ops-lib";
import { C, CAT, sheetCard } from "./ops-style";
import { Bar, Chev, IconTile, LegendPill, MoreButton, OCard, OHead, SectionLabel, SheetNote2, SofaBedBar, StatusBlock, SwatchLegend, Tag, TotalsCard } from "./ops-ui";

const ARC_R = 82;
function arcPath(p: number): string {
  const a1 = Math.PI * (1 - Math.min(p, 1));
  const x1 = 100 + ARC_R * Math.cos(a1);
  const y1 = 100 - ARC_R * Math.sin(a1);
  return `M${100 - ARC_R},100 A${ARC_R},${ARC_R} 0 0 1 ${x1},${y1}`;
}
const gaugeColor = (hex: string) => (hex === "#DC2626" ? C.gaugeRed : hex === "#C9A24B" ? C.gaugeAmber : C.gaugeGreen);
const TAG_KIND = { asof: "live", reconstructed: "info", "live-no-history": "warn" } as const;

/** The header tag of Plant Load / Backlog: the HTML's "LIVE" (green) or "LIVE — NO SNAPSHOT" (amber), plus the desktop's saved / reconstructed cases. */
function StateTagView({ tag }: { tag: ReturnType<typeof stateTag> }) {
  if (!tag) return <Tag kind="live">LIVE</Tag>;
  return <Tag kind={TAG_KIND[tag.kind]}>{tag.kind === "live-no-history" ? "LIVE — NO SNAPSHOT" : tag.text}</Tag>;
}

type Sheet = "cap" | "backlog" | "jobs" | "done" | null;
type Row = { icon: LucideIcon; bg: string; fg: string; label: string; hint: string; value: string; unit: string; sheet: Exclude<Sheet, null> };

export function PlantLoadCard({ d, period, periodKey, curYm }: { d: OpsData; period: Period; periodKey: string; curYm: string }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [day, setDay] = useState<string | null>(null);
  const [doneN, setDoneN] = useState(31);
  const { status, data } = d.overview;
  const prod = data?.production;
  const tag = stateTag(data?.stateSnapshot);
  const g = prod ? plantGauge(prod.backlogDays) : null;
  const gc = g ? gaugeColor(g.color) : C.gaugeGreen;
  const head = prod ? completedHead(prod) : null;
  const per = prod ? perWorkerMin(prod.capacityDays, prod.dailyCapacityMin) : null;
  const win = capacityWindowLabel(periodKey, curYm);
  const winText = win === "14-day avg" ? "last 14 working days" : win;
  const days = prod ? [...prod.capacityDays].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const avg = prod?.dailyCapacityMin ?? 0;
  const mx = Math.max(1, ...days.map((x) => x.minutes)) * 1.08;
  const sel = days.find((x) => x.date === day) ?? null;
  const rows: Row[] = prod && head ? [
    { icon: Factory, bg: "#F4EFE6", fg: M.taupe, label: "Daily Capacity", hint: win === "14-day avg" ? "avg of last 14 working days" : win, value: hrs(avg), unit: "per day", sheet: "cap" },
    { icon: Clock, bg: C.dangerBg, fg: C.danger, label: "Total Backlog", hint: "by department", value: `${prod.backlogDays.toFixed(1)} days`, unit: `${hrs(prod.backlogMin)} queued`, sheet: "backlog" },
    { icon: Package, bg: C.tealBg, fg: C.teal, label: "Active Jobs", hint: "pending, by customer", value: `${n0(prod.activeJobs.bedframeUnits)} / ${n0(prod.activeJobs.sofaSets)}`, unit: "bedframe / sofa", sheet: "jobs" },
    { icon: CircleCheck, bg: C.okBg, fg: C.ok, label: "Completed", hint: "all job cards done", value: `${n0(head.bedframe)} / ${n0(head.sofa)}`, unit: "bedframe / sofa", sheet: "done" },
  ] : [];

  return (
    <>
      <OCard label="Plant Load" id="ops-plant-load">
        <OHead title="Plant Load" right={<StateTagView tag={tag} />} sub="Backlog vs daily capacity" />
        {status !== "ready" || !prod || !g ? (
          <div style={{ marginTop: 10 }}><StatusBlock status={status === "ready" ? "error" : status} what="Plant Load" need="a dashboard view" reason={status === "ready" ? "no production figures returned" : undefined} onRetry={d.retryOverview} /></div>
        ) : (
          <>
            <div role="img" aria-label={`Queue ${prod.backlogDays.toFixed(1)} days, ${g.pct}% of a 14-day buffer`} style={{ position: "relative", width: 200, height: 116, margin: "14px auto 0" }}>
              <svg viewBox="0 0 200 112" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                <path d={arcPath(1)} fill="none" stroke={M.divider} strokeWidth={14} strokeLinecap="round" />
                {g.util > 0 ? <path d={arcPath(g.util)} fill="none" stroke={gc} strokeWidth={14} strokeLinecap="round" /> : null}
              </svg>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 2, textAlign: "center" }}>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.6, color: M.raisin, ...TNUM }}>{prod.backlogDays.toFixed(1)}d</div>
                <div style={{ fontSize: 11, color: M.muted }}>queue</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", marginTop: 14, padding: "12px 0", borderTop: `1px solid ${M.divider}`, borderBottom: `1px solid ${M.divider}` }}>
              <div style={{ minWidth: 0, padding: "0 12px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: M.ink }}>Workforce</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: M.raisin, marginTop: 2, ...TNUM }}>{data?.employee ? n0(data.employee.activeHeadcount) : "—"}</div>
              </div>
              <div title="Queue length as a share of a 2-week (14-day) buffer — not a utilisation figure." style={{ minWidth: 0, padding: "0 12px", textAlign: "center", borderLeft: `1px solid ${M.divider}` }}>
                <div style={{ fontSize: 11, color: M.ink }}>Queue vs 14d</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: gc, marginTop: 2, ...TNUM }}>{g.pct}%</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
              <SectionLabel>BREAKDOWN</SectionLabel><span style={{ fontSize: 11.5, color: M.muted }}>tap for detail</span>
            </div>
            <div style={{ marginTop: 6 }}>
              {rows.map((r, i) => (
                <button key={r.label} type="button" onClick={() => { setDay(null); setDoneN(31); setSheet(r.sheet); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, minHeight: 56, padding: "8px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  <IconTile icon={r.icon} bg={r.bg} fg={r.fg} size={32} radius={9} iconSize={16} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{r.label}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: M.muted, marginTop: 1 }}>{r.hint}</span>
                  </span>
                  <span style={{ flex: "none", textAlign: "right" }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{r.value}</span>
                    <span style={{ display: "block", fontSize: 11, color: M.muted, marginTop: 1, whiteSpace: "nowrap" }}>{r.unit}</span>
                  </span>
                  <Chev />
                </button>
              ))}
            </div>
            {period.day ? <div style={{ fontSize: 11.5, color: M.ink, marginTop: 10 }}>Showing {widgetPeriodLabel(period)} — a single day does not change this card.</div> : null}
          </>
        )}
      </OCard>

      {sheet === "cap" && prod ? (
        <SheetFrame open title="Daily Capacity" sub={`Production time · ${winText} · live`} onClose={() => setSheet(null)}>
          <div style={{ ...sheetCard, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: M.ink }}>{sel ? weekdayDayMonth(sel.date) : "Average per working day"}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: M.raisin, marginTop: 2, ...TNUM }}>{hm(sel ? sel.minutes : avg)}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: M.ink, lineHeight: 1.5, ...TNUM }}>
                {sel ? (<>{sel.workers > 0 ? `${sel.workers} workers · ${hm(sel.minutes / sel.workers)}/worker` : "no workers credited"}<br />{sel.minutes >= avg ? "+" : "−"}{hm(Math.abs(sel.minutes - avg))} vs avg</>) : (<>{winText}<br />{per == null ? "no per-worker figure" : `${hm(per)}/worker`}</>)}
              </div>
            </div>
            <div role="img" aria-label={`Production time per day, ${winText}`} style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 4, height: 110, marginTop: 16 }}>
              <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${(avg / mx) * 100}%`, borderTop: "1.5px dashed #C9A961" }} />
              {days.map((x) => {
                const on = x.date === day;
                return (
                  <button key={x.date} type="button" aria-label={`${weekdayDayMonth(x.date)}: ${hm(x.minutes)}`} aria-pressed={on} onClick={() => setDay(on ? null : x.date)}
                    style={{ flex: 1, minWidth: 0, height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "flex-end" }}>
                    <span style={{ display: "block", width: "100%", height: `${(x.minutes / mx) * 100}%`, borderRadius: "4px 4px 2px 2px", backgroundColor: x.minutes >= avg ? C.ok : C.neutralRail, opacity: day && !on ? 0.35 : 1 }} />
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {days.map((x) => <span key={x.date} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 9.5, color: x.date === day ? M.raisin : M.muted, fontWeight: x.date === day ? 700 : 500, ...TNUM }}>{Number(x.date.slice(8, 10))}</span>)}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 10, fontSize: 11.5, color: M.ink }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: C.ok }} />Above average</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: C.neutralRail }} />Below average</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, borderTop: "1.5px dashed #C9A961" }} />Average</span>
            </div>
          </div>
          <div style={{ padding: "14px 2px 8px" }}><SectionLabel>BY DAY</SectionLabel></div>
          <div style={{ ...sheetCard, padding: "0 14px" }}>
            {[...days].reverse().map((x, i) => {
              const up = x.minutes >= avg;
              const on = x.date === day;
              return (
                <button key={x.date} type="button" onClick={() => setDay(on ? null : x.date)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: 0, border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", backgroundColor: on ? M.paper : "transparent", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{weekdayDayMonth(x.date)}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: M.muted, marginTop: 1, ...TNUM }}>{x.workers > 0 ? `${x.workers} workers · ${hm(x.minutes / x.workers)}/worker` : "no workers credited"}</span>
                  </span>
                  <span style={{ flex: "none", textAlign: "right" }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{hm(x.minutes)}</span>
                    <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: up ? C.ok : C.danger, marginTop: 1, whiteSpace: "nowrap", ...TNUM }}>{up ? "+" : "−"}{hm(Math.abs(x.minutes - avg))}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </SheetFrame>
      ) : null}

      {sheet === "backlog" && prod ? (
        <SheetFrame open title="Total Backlog" sub={`Active work across ${prod.backlogByDept.length} departments · live`} onClose={() => setSheet(null)}>
          <TotalsCard items={[{ label: "Total backlog", value: `${prod.backlogDays.toFixed(1)} days`, color: C.danger }, { label: "Active work", value: hrs(prod.backlogMin) }]} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 2px 8px" }}>
            <span style={{ flex: 1 }}><SectionLabel>BY DEPARTMENT</SectionLabel></span>
            <SwatchLegend items={[{ label: "Sofa", color: CAT.sofa }, { label: "Bedframe", color: CAT.bedframe }]} />
          </div>
          <div style={{ ...sheetCard, padding: "0 14px" }}>
            {prod.backlogByDept.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No active work in any department.</div> : null}
            {prod.backlogByDept.map((r, i) => {
              const mxm = Math.max(1, ...prod.backlogByDept.map((x) => x.sofaMin + x.bedframeMin));
              return (
                <div key={r.dept} style={{ padding: "12px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin }}>{r.dept}</span>
                    <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 15, fontWeight: 700, color: r.backlogDays == null ? C.danger : M.raisin, ...TNUM }}>{r.backlogDays == null ? "Stalled" : `${r.backlogDays.toFixed(1)} days`}</span>
                  </div>
                  <div style={{ marginTop: 8 }}><SofaBedBar sofa={r.sofaMin} bed={r.bedframeMin} max={mxm} /></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 7, fontSize: 12, color: M.ink, ...TNUM }}>
                    <span>Sofa {hrs(r.sofaMin)}</span><span>Bedframe {hrs(r.bedframeMin)}</span><span style={{ color: M.muted }}>Capacity {r.dailyCapMin ? `${hrs(r.dailyCapMin)}/day` : "none"}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <SheetNote2>Days = queued hours ÷ daily capacity. Bar length is relative to the department with the most queued hours.</SheetNote2>
        </SheetFrame>
      ) : null}

      {sheet === "jobs" && prod ? (
        <SheetFrame open title="Active Jobs" sub="Pending in production · live" onClose={() => setSheet(null)}>
          <TotalsCard items={[{ label: "Bedframe", value: n0(prod.activeJobs.bedframeUnits), dot: CAT.bedframe }, { label: "Sofa sets", value: n0(prod.activeJobs.sofaSets), dot: CAT.sofa }]} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 2px 8px" }}>
            <span style={{ flex: 1 }}><SectionLabel>BY CUSTOMER</SectionLabel></span>
            <SwatchLegend items={[{ label: "Bedframe", color: CAT.bedframe }, { label: "Sofa sets", color: CAT.sofa }]} />
          </div>
          <div style={{ ...sheetCard, padding: "0 14px" }}>
            {prod.activeJobs.byCustomer.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No active jobs.</div> : null}
            {prod.activeJobs.byCustomer.map((c, i) => (
              <div key={c.customer + i} style={{ padding: "12px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{c.customer}</span>
                  <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 12.5, color: M.ink, ...TNUM }}><b style={{ color: CAT.bedframe }}>{n0(c.bedframeUnits)}</b> · <b style={{ color: CAT.sofa }}>{n0(c.sofaSets)}</b></span>
                </div>
                <div aria-hidden="true" style={{ display: "grid", gap: 4, marginTop: 8 }}>
                  <Bar frac={c.bedframeUnits / Math.max(1, ...prod.activeJobs.byCustomer.map((x) => x.bedframeUnits))} color={CAT.bedframe} h={6} />
                  <Bar frac={c.sofaSets / Math.max(1, ...prod.activeJobs.byCustomer.map((x) => x.sofaSets))} color={CAT.sofa} h={6} />
                </div>
              </div>
            ))}
          </div>
          <SheetNote2>Bedframe = pieces in production · Sofa = sets (1 SO = 1 set)</SheetNote2>
        </SheetFrame>
      ) : null}

      {sheet === "done" && prod && head ? (
        <SheetFrame open title="Completed" sub={`${widgetPeriodLabel(period)} · live`} onClose={() => setSheet(null)}>
          <TotalsCard items={[{ label: "Bedframe", value: n0(head.bedframe), dot: CAT.bedframe }, { label: "Sofa sets", value: n0(head.sofa), dot: CAT.sofa }]} />
          <div style={{ padding: "14px 2px 8px" }}><SectionLabel>BY DAY</SectionLabel></div>
          <div style={{ ...sheetCard, padding: "0 14px" }}>
            {prod.completedLast7.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No completions in this period.</div> : null}
            {[...prod.completedLast7].sort((a, b) => b.date.localeCompare(a.date)).slice(0, doneN).map((r, i) => (
              <div key={r.date} style={{ padding: "11px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{weekdayDay(r.date)}</span>
                  <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 12.5, color: M.ink, ...TNUM }}>Bedframe <b style={{ color: M.raisin }}>{n0(r.bedframeUnits)}</b> · Sofa <b style={{ color: M.raisin }}>{n0(r.sofaSets)}</b></span>
                </div>
                <div style={{ marginTop: 8 }}><SofaBedBar2 b={r.bedframeUnits} s={r.sofaSets} max={Math.max(1, ...prod.completedLast7.map((x) => x.sofaSets + x.bedframeUnits))} /></div>
              </div>
            ))}
          </div>
          {prod.completedLast7.length > doneN ? <MoreButton label="Show more days" onClick={() => setDoneN((n) => n + 31)} margin="10px 0 0" /> : null}
          <div style={{ marginTop: 10 }}><SwatchLegend items={[{ label: "Bedframe", color: CAT.bedframe }, { label: "Sofa sets", color: CAT.sofa }]} /></div>
          <SheetNote2>Production finished per day (last upholstery completed). The totals are the server’s deduplicated count for the whole period.</SheetNote2>
        </SheetFrame>
      ) : null}
    </>
  );
}

/** Completed-by-day bar: Bedframe first, then Sofa (HTML Completed sheet). */
function SofaBedBar2({ b, s, max }: { b: number; s: number; max: number }) {
  const w = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <span aria-hidden="true" style={{ display: "flex", height: 8, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
      <span style={{ width: w(b), backgroundColor: CAT.bedframe }} /><span style={{ width: w(s), backgroundColor: CAT.sofa }} />
    </span>
  );
}

export function DeptBacklogCard({ d }: { d: OpsData }) {
  const [showSofa, setSofa] = useState(true);
  const [showBed, setBed] = useState(true);
  const [all, setAll] = useState(false);
  const { status, data } = d.overview;
  const prod = data?.production;
  const tag = stateTag(data?.stateSnapshot);
  const rows = useMemo(() => (prod ? backlogRows(prod.backlogByDept, showSofa, showBed) : []), [prod, showSofa, showBed]);
  const maxDays = Math.max(1, ...rows.map((r) => r.shown ?? 0));
  const top = rows[0];
  const daysText = (v: number | null) => (v == null ? "Stalled" : `${v.toFixed(1)} days`);

  return (
    <OCard label="Department Backlog" id="ops-dept-backlog">
      <OHead title="Department Backlog" right={<StateTagView tag={tag} />} sub="Days to clear active work at daily capacity" />
      {status !== "ready" || !prod ? (
        <div style={{ marginTop: 10 }}><StatusBlock status={status === "ready" ? "error" : status} what="Department Backlog" need="a dashboard view" reason={status === "ready" ? "no production figures returned" : undefined} onRetry={d.retryOverview} /></div>
      ) : rows.length === 0 ? (
        <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No active work in any department.</div>
      ) : (
        <>
          {top ? (
            <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "11px 12px", borderRadius: 12, backgroundColor: C.dangerBg }}>
              <TriangleAlert size={16} strokeWidth={2} color={C.danger} aria-hidden="true" style={{ flex: "none" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.warnInk }}>Bottleneck <b style={{ color: M.raisin }}>{top.dept}</b></span>
              <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 14, fontWeight: 700, color: C.danger, ...TNUM }}>{daysText(top.shown)}</span>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12 }}>
            <LegendPill label="Sofa" color={CAT.sofa} on={showSofa} onToggle={() => setSofa((v) => !v)} />
            <LegendPill label="Bedframe" color={CAT.bedframe} on={showBed} onToggle={() => setBed((v) => !v)} />
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: M.muted }}>tap to show / hide</span>
          </div>
          <div style={{ marginTop: 6 }}>
            {(all ? rows : rows.slice(0, 5)).map((r, i) => (
              <div key={r.dept} style={{ padding: "11px 0", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{r.dept}</span>
                  <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 14, fontWeight: 700, color: C.danger, ...TNUM }}>{daysText(r.shown)}</span>
                </div>
                <div style={{ marginTop: 7 }}>
                  <span aria-hidden="true" style={{ display: "flex", height: 8, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
                    <span style={{ width: `${((showSofa ? r.sofaDays : 0) / maxDays) * 100}%`, backgroundColor: CAT.sofa }} />
                    <span style={{ width: `${((showBed ? r.bedDays : 0) / maxDays) * 100}%`, backgroundColor: CAT.bedframe }} />
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: M.ink, marginTop: 5, overflowWrap: "anywhere", ...TNUM }}>
                  {r.dailyCapMin > 0 ? `Sofa ${hrs(r.sofaMin)} · Bedframe ${hrs(r.bedframeMin)} · capacity ${hrs(r.dailyCapMin)}/day` : `Sofa ${hrs(r.sofaMin)} · Bedframe ${hrs(r.bedframeMin)} · no completions in 14 working days`}
                </div>
              </div>
            ))}
          </div>
          {rows.length > 5 ? <MoreButton label={all ? "Show fewer" : `Show all ${rows.length} departments`} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
        </>
      )}
    </OCard>
  );
}

