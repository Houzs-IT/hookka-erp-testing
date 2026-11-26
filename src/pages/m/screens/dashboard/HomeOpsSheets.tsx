// Home Operations v3 · Overview — the opened details (bottom sheets), built to the approved design: Total Backlog, Active Jobs,
// Completed, Daily Capacity, the Department Revenue drill and the Daily Report lists. Data, permissions and navigation are the
// repo's own (the cards pass them in); only the layout is the design's.
import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Building2, CalendarDays, CircleCheck, CloudOff, Factory, Layers, Package, Truck, User, Users, type LucideIcon } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { M } from "../../theme";
import { dayLabel, widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { pickCat } from "../../../dashboard-b/revenue-split";
import { TNUM } from "./home-style";
import { SheetFrame } from "./home-ui";
import { Chev } from "./ops-ui";
import { C, CAT } from "./ops-style";
import { hm, hrs, n0, weekdayDayMonth, deptBuckets, deptAvg, type BacklogViewRow, type DrCard, type OpsOverview, type OpsRevCat, type PlantFiltered, type SplitResp } from "./ops-lib";
import { ChipRow, DCard, DCards, DeltaPill, MiniChip, NoteList, SecRule, SumPanel, SumTile, TableCard, TileGrid } from "./ops-sheet-kit";
import { PillButton } from "./ops-glass";
import type { StatusPillLook } from "./dr-status";
import { dvColor } from "./ops-dept-colors";

type Prod = NonNullable<OpsOverview["production"]>;
const rmFull = (sen: number) => formatCurrency(Math.round(sen));
const NEUTRAL_RAIL = "#8B7A4E";
const showWord = (all: boolean, n: number, what: string) => (all ? "Show fewer" : `Show all ${n} ${what}`);

// ---------------------------------------------------------------------------
// Total Backlog
// ---------------------------------------------------------------------------
export function BacklogSheet({ prod, pf, rows, live, sofaOn, bedOn, onClose }: { prod: Prod; pf: PlantFiltered; rows: BacklogViewRow[]; live: string; sofaOn: boolean; bedOn: boolean; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <SheetFrame open title="Total Backlog" sub={`Active work across ${prod.backlogByDept.length} departments · ${live.toLowerCase()}`} onClose={onClose}>
      <SumPanel icon={Layers} scope={live} scope2={`${rows.length} departments`}>
        <TileGrid>
          <SumTile k="Total backlog" v={`${pf.backlogDays.toFixed(1)} days`} tone="#9A3A2D" valueColor="#9A3A2D" />
          <SumTile k="Active work" v={hrs(pf.backlogMin)} tone="#6B5C32" />
        </TileGrid>
      </SumPanel>
      <SecRule label="BY DEPARTMENT" hint="Longest first" />
      {rows.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No active work in any department.</div> : null}
      <DCards>
        {shown.map((r) => {
          const stalled = r.shown == null;
          const queued = (sofaOn ? r.sofaMin : 0) + (bedOn ? r.bedframeMin : 0);
          return (
            <DCard key={r.dept} rail={stalled ? C.danger : NEUTRAL_RAIL}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Factory size={14} strokeWidth={2} color="#8B7A4E" aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.dept}</span>
                  <span style={{ display: "block", fontSize: 13, color: M.muted, marginTop: 2, ...TNUM }}><b style={{ fontSize: 15, fontWeight: 800, color: M.raisin }}>{hrs(queued)}</b> queued</span>
                </span>
                <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: stalled ? C.dangerBg : "#F0ECE9", color: stalled ? C.danger : "#4D4630", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>{stalled ? "Stalled" : `${r.shown!.toFixed(1)} days`}</span>
              </div>
              <ChipRow cols={3}>
                <MiniChip k="Sofa" v={hrs(r.sofaMin)} dot={CAT.sofa} />
                <MiniChip k="Bedframe" v={hrs(r.bedframeMin)} dot={CAT.bedframe} />
                <MiniChip k={r.single ? `${r.single.label} cap` : "Daily cap"} v={(r.single ? r.single.capMin : r.dailyCapMin) > 0 ? `${hrs(r.single ? r.single.capMin : r.dailyCapMin)}/day` : "—"} dot="#8B7A4E" />
              </ChipRow>
            </DCard>
          );
        })}
      </DCards>
      {rows.length > 5 ? <PillButton label={showWord(all, rows.length, "departments")} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
      <NoteList lines={[<><b style={{ fontWeight: 700 }}>Backlog days</b> = queued hours ÷ daily capacity</>, <><b style={{ fontWeight: 700 }}>Stalled</b> = no capacity recorded for that department</>, ...(pf.filtered ? [<>Showing {pf.showing}</>] : [])]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Active Jobs
// ---------------------------------------------------------------------------
export function JobsSheet({ pf, onClose }: { pf: PlantFiltered; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const list = pf.jobs.byCustomer;
  const shown = all ? list : list.slice(0, 5);
  return (
    <SheetFrame open title="Active Jobs" sub="Pending in production · live" onClose={onClose}>
      <SumPanel icon={Package} scope="Active now" scope2={`${list.length} customers`}>
        <TileGrid>
          <SumTile k="Bedframe units" v={n0(pf.jobs.bedframeUnits)} tone={CAT.bedframe} />
          <SumTile k="Sofa sets" v={n0(pf.jobs.sofaSets)} tone={CAT.sofa} />
        </TileGrid>
      </SumPanel>
      <SecRule label="BY CUSTOMER" hint="Most first" />
      {list.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No active jobs.</div> : null}
      <DCards>
        {shown.map((c, i) => (
          <DCard key={c.customer + i} rail={NEUTRAL_RAIL}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Building2 size={14} strokeWidth={2} color="#8B7A4E" aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer}</span>
            </div>
            <ChipRow cols={2}>
              <MiniChip k="Bedframe units" v={c.bedframeUnits ? n0(c.bedframeUnits) : "—"} dot={CAT.bedframe} />
              <MiniChip k="Sofa sets" v={c.sofaSets ? n0(c.sofaSets) : "—"} dot={CAT.sofa} />
            </ChipRow>
          </DCard>
        ))}
      </DCards>
      {list.length > 5 ? <PillButton label={showWord(all, list.length, "customers")} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
      <NoteList lines={[<><b style={{ fontWeight: 700 }}>Bedframe</b> = pieces in production</>, <><b style={{ fontWeight: 700 }}>Sofa</b> = sets (1 order = 1 set, consignment included)</>, ...(pf.filtered ? [<>Showing {pf.showing}</>] : [])]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Completed
// ---------------------------------------------------------------------------
export function DoneSheet({ prod, head, period, onClose }: { prod: Prod; head: { bedframe: number; sofa: number }; period: Period; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const list = [...prod.completedLast7].sort((a, b) => b.date.localeCompare(a.date));
  const n = list.filter((x) => x.bedframeUnits + x.sofaSets > 0).length;
  const shown = all ? list : list.slice(0, 5);
  const avg = (v: number) => (n ? (v / n).toFixed(1) : "—");
  return (
    <SheetFrame open title={`Completed — ${widgetPeriodLabel(period)}`} sub="Counted when an order’s last job card closes" onClose={onClose}>
      <SumPanel icon={CalendarDays} scope={widgetPeriodLabel(period)} scope2={`${n} working day${n === 1 ? "" : "s"}`}>
        <TileGrid>
          <SumTile k="Bedframe units" v={n0(head.bedframe)} tone={CAT.bedframe} dot={CAT.bedframe} />
          <SumTile k="Sofa sets" v={n0(head.sofa)} tone={CAT.sofa} dot={CAT.sofa} />
          <SumTile k="Avg bedframe / day" v={avg(head.bedframe)} tone={CAT.bedframe} dot={CAT.bedframe} />
          <SumTile k="Avg sofa / day" v={avg(head.sofa)} tone={CAT.sofa} dot={CAT.sofa} />
        </TileGrid>
      </SumPanel>
      <SecRule label="BY DAY" hint="Newest first" />
      {list.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No completions in this period.</div> : null}
      <DCards>
        {shown.map((r) => (
          <DCard key={r.date} rail={C.ok}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CalendarDays size={14} strokeWidth={2} color="#8B7A4E" aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{weekdayDayMonth(r.date)}</span>
              <span style={{ flex: "none", fontSize: 12, color: M.muted, whiteSpace: "nowrap", ...TNUM }}>{r.bedframeUnits + r.sofaSets} total</span>
            </div>
            <ChipRow cols={2}>
              <MiniChip k="Bedframe units" v={n0(r.bedframeUnits)} dot={CAT.bedframe} />
              <MiniChip k="Sofa sets" v={n0(r.sofaSets)} dot={CAT.sofa} />
            </ChipRow>
          </DCard>
        ))}
      </DCards>
      {list.length > 5 ? <PillButton label={showWord(all, list.length, "days")} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
      <NoteList lines={[<>Average over the <b style={{ fontWeight: 700 }}>{n} working days</b> with completions</>, <>Counted on the day an order’s <b style={{ fontWeight: 700 }}>last job card</b> closes</>]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Daily Capacity
// ---------------------------------------------------------------------------
export function CapacitySheet({ prod, winText, onClose }: { prod: Prod; winText: string; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const days = [...prod.capacityDays].sort((a, b) => a.date.localeCompare(b.date));
  const avg = prod.dailyCapacityMin;
  const hi = days.reduce<(typeof days)[number] | null>((m, x) => (!m || x.minutes > m.minutes ? x : m), null);
  const lo = days.reduce<(typeof days)[number] | null>((m, x) => (!m || x.minutes < m.minutes ? x : m), null);
  const list = [...days].reverse();
  const shown = all ? list : list.slice(0, 5);
  return (
    <SheetFrame open title="Daily Capacity" sub={`Production time · ${winText}`} onClose={onClose}>
      <SumPanel icon={CalendarDays} scope={winText} scope2={`${days.length} working day${days.length === 1 ? "" : "s"}`}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: M.taupe, marginTop: 12 }}>AVERAGE PER WORKING DAY</div>
        <div style={{ fontSize: 26, lineHeight: "30px", fontWeight: 800, letterSpacing: -0.6, color: M.raisin, marginTop: 2, ...TNUM }}>{days.length ? hm(avg) : "—"}</div>
        <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>Earned production time</div>
        <TileGrid>
          <SumTile k="HIGHEST" v={hi ? hm(hi.minutes) : "—"} tone="#4F7C3A" big={15} sub={hi ? weekdayDayMonth(hi.date) : ""} />
          <SumTile k="LOWEST" v={lo ? hm(lo.minutes) : "—"} tone="#9A3A2D" big={15} sub={lo ? weekdayDayMonth(lo.date) : ""} />
        </TileGrid>
      </SumPanel>
      <SecRule label="DAILY BREAKDOWN" hint="Newest first" />
      {days.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No capacity days in this period.</div> : null}
      <DCards>
        {shown.map((x) => {
          const diff = x.minutes - avg;
          const up = diff >= 0;
          const os = x.outsourceMinutes;
          const known = os != null;
          return (
            <DCard key={x.date} rail={up ? C.ok : C.danger}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CalendarDays size={14} strokeWidth={2} color="#8B7A4E" aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{weekdayDayMonth(x.date)}</span>
                <DeltaPill up={up}>{up ? <ArrowUp size={12} strokeWidth={2.4} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2.4} aria-hidden="true" />}{up ? "+" : "−"}{hm(Math.abs(diff))} vs avg</DeltaPill>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, padding: "7px 10px", borderRadius: 10, background: "rgba(201,169,97,.12)", boxShadow: "inset 0 0 0 1px rgba(201,169,97,.25)" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>PRODUCTION TIME</span>
                <span style={{ fontSize: 15, lineHeight: "20px", fontWeight: 800, letterSpacing: -0.2, color: M.taupe, whiteSpace: "nowrap", ...TNUM }}>{hm(x.minutes)}</span>
              </div>
              <ChipRow cols={3}>
                <MiniChip k="Outsource" v={known ? hm(os) : "—"} icon={Truck} />
                <MiniChip k="Workers" v={String(x.workers)} icon={Users} />
                <MiniChip k="Per worker" v={known && x.workers > 0 ? hm(Math.round((x.minutes - os) / x.workers)) : "—"} icon={User} />
              </ChipRow>
            </DCard>
          );
        })}
      </DCards>
      {list.length > 5 ? <PillButton label={showWord(all, list.length, "days")} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
      <NoteList lines={[<><b style={{ fontWeight: 700 }}>Per worker</b> = (production time − outsource) ÷ workers</>, <><b style={{ fontWeight: 700 }}>Workers</b> include helpers who punched in, not outsourced workers</>, <><b style={{ fontWeight: 700 }}>—</b> = not available</>]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Department Revenue drill
// ---------------------------------------------------------------------------
export function DeptRevenueSheet({ data, code, cat, period, todayMY, workDays, pickDay, onClose }: {
  data: SplitResp; code: string; cat: OpsRevCat; period: Period; todayMY: string; workDays: number; pickDay: (day: string) => void; onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const dept = (data.departments ?? []).find((x) => x.code === code);
  if (!dept) return null;
  const buckets = deptBuckets(data, code, cat);
  const total = pickCat(dept.period, cat);
  const avg = deptAvg(total, workDays);
  const dayOn = period.day && buckets.some((b) => b.bucket === period.day);
  const todayB = buckets.find((b) => b.bucket === todayMY) ?? buckets[buckets.length - 1];
  const sel = dayOn ? buckets.find((b) => b.bucket === period.day) : undefined;
  const third = sel ?? todayB;
  const maxB = Math.max(1, ...buckets.map((b) => b.value));
  const nz = buckets.filter((b) => b.value > 0);
  const rowAvg = nz.length ? total / nz.length : 0;
  const rows = [...nz].reverse();
  const shown = all ? rows : rows.slice(0, 5);
  const color = dvColor(code);
  const gran = data.granularity === "week" ? "week" : data.granularity === "month" ? "month" : "day";
  const label = (b: { bucket: string; label: string }) => (gran === "day" ? weekdayDayMonth(b.bucket) : b.label);
  return (
    <SheetFrame open title={dept.label} sub={`Department revenue · ${widgetPeriodLabel(period)}`} onClose={onClose}>
      <div style={{ padding: 14, borderRadius: 16, background: `color-mix(in srgb, ${M.card} 82%, transparent)`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 10px 22px -16px rgba(107,92,50,.40)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: "inset 0 0 0 1px rgba(128,128,128,.35)" }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{widgetPeriodLabel(period)}</span>
          <span style={{ fontSize: 12, color: M.muted, whiteSpace: "nowrap" }}>{workDays} working day{workDays === 1 ? "" : "s"}</span>
        </div>
        <TileGrid>
          <SumTile k="Total" v={rmFull(total)} tone="#6B5C32" big={15} />
          <SumTile k={`Avg / ${gran}`} v={avg == null ? "—" : rmFull(avg)} tone="#3E6570" big={15} />
          <SumTile k={sel ? dayLabel(sel.bucket) : "Today"} v={third ? rmFull(third.value) : "—"} tone="#3E6570" big={15} />
          <SumTile k={cat === "bedframe" ? "Bedframe units" : cat === "sofa" ? "Sofa sets" : cat === "accessory" ? "Units / sets" : "Units / sets"} v={cat === "accessory" ? "—" : cat === "bedframe" ? String(dept.sets?.bedframe ?? 0) : cat === "sofa" ? String(dept.sets?.sofa ?? 0) : `${dept.sets?.bedframe ?? 0} / ${dept.sets?.sofa ?? 0}`} tone="#6B5C32" big={15} />
        </TileGrid>
        {buckets.length > 1 ? (
          <>
            <div role="img" aria-label="Output for each day" style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 76, marginTop: 14 }}>
              {buckets.map((b) => {
                const on = b.bucket === sel?.bucket;
                const bar = <span style={{ width: "100%", height: `${Math.max((b.value / maxB) * 100, b.value ? 4 : 2)}%`, borderRadius: "4px 4px 2px 2px", background: color, opacity: sel && !on ? 0.35 : 1, display: "block" }} />;
                return b.pickable
                  ? <button key={b.bucket} type="button" aria-label={`${b.label}: ${rmFull(b.value)}`} aria-pressed={on} onClick={() => pickDay(b.bucket)} style={{ flex: 1, minWidth: 0, height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "flex-end" }}>{bar}</button>
                  : <span key={b.bucket} aria-label={`${b.label}: ${rmFull(b.value)}`} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end" }}>{bar}</span>;
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, color: M.muted, ...TNUM }}>
              <span>{label(buckets[0])}</span><span>{label(buckets[buckets.length - 1])}</span>
            </div>
          </>
        ) : null}
      </div>
      <SecRule label={gran === "day" ? "OUTPUT EACH DAY" : `OUTPUT EACH ${gran.toUpperCase()}`} hint="Newest first" />
      <TableCard>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 10, padding: "9px 12px", background: `color-mix(in srgb, ${M.taupe} 9%, ${M.card})`, borderBottom: `1px solid ${M.hairline}`, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: M.taupe, textTransform: "uppercase" }}>
          <span>{gran === "day" ? "Date" : gran === "week" ? "Week" : "Month"}</span><span style={{ textAlign: "right" }}>Value</span><span style={{ textAlign: "right", minWidth: 64 }}>vs avg</span>
        </div>
        {rows.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>No output in this period.</div> : null}
        {shown.map((b, i) => {
          const diff = b.value - rowAvg;
          const up = diff >= 0;
          const row = { width: "100%", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 10, alignItems: "center", minHeight: 44, padding: "0 12px", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: b.bucket === sel?.bucket ? "rgba(201,169,97,.12)" : "transparent", fontFamily: "inherit", textAlign: "left" as const, ...TNUM };
          const inner = (
            <>
              <span style={{ fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{label(b)}</span>
              <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{rmFull(b.value)}</span>
              <span style={{ minWidth: 64, textAlign: "right", fontSize: 12, fontWeight: 700, color: up ? C.ok : C.danger, whiteSpace: "nowrap" }}>{up ? "+" : "−"}{rmFull(Math.abs(diff))}</span>
            </>
          );
          return b.pickable ? <button key={b.bucket} type="button" onClick={() => pickDay(b.bucket)} style={{ ...row, cursor: "pointer" }}>{inner}</button> : <div key={b.bucket} style={row}>{inner}</div>;
        })}
      </TableCard>
      {rows.length > 5 ? <PillButton label={showWord(all, rows.length, gran === "day" ? "days" : `${gran}s`)} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
      <NoteList lines={["Each department books an order’s full value when its last card for that order completes, so departments aren’t added together."]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Daily Report list (design: count + rule panel, "LABEL ——— sort hint", order cards with a status pill, a labelled grid, a highlighted
// Problem row and an "Open ref" footer, then the destination button)
// ---------------------------------------------------------------------------
export function DrSheet({ title, rule, n, cards, head, sort, go, canGo, onGo, openRef, canOpen, pillOf, onClose }: {
  title: string; rule: string; n: number | null; cards: DrCard[]; head: string; sort?: string;
  go?: { label: string; icon: LucideIcon }; canGo: boolean; onGo: () => void;
  openRef: (c: DrCard) => void; canOpen: (c: DrCard) => boolean; pillOf: (c: DrCard) => StatusPillLook | null; onClose: () => void;
}) {
  const [shown, setShown] = useState(40);
  const nColor = n == null ? "#71717A" : n === 0 ? C.ok : "#9A3A2D";
  const panel = { background: `color-mix(in srgb, ${M.card} 82%, transparent)`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 10px 22px -16px rgba(107,92,50,.40)`, borderRadius: 16 } as const;
  const tone = (t: "warn" | "danger") => (t === "warn" ? { fg: "#85600F", bg: `color-mix(in srgb, #D19A32 24%, ${M.card})` } : { fg: "#9A3A2D", bg: `color-mix(in srgb, #C0574A 16%, ${M.card})` });
  return (
    <SheetFrame open title={title} sub="Daily Report · today" onClose={onClose}>
      <div style={{ ...panel, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <span style={{ flex: "none", fontSize: 30, lineHeight: "34px", fontWeight: 800, letterSpacing: -0.8, color: nColor, ...TNUM }}>{n == null ? "—" : n}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.4, color: M.ink }}>{rule}</span>
      </div>
      {n == null ? (
        <div style={{ ...panel, marginTop: 10, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ width: 40, height: 40, margin: "0 auto", borderRadius: 12, background: "color-mix(in srgb, #71717A 14%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}><CloudOff size={19} strokeWidth={2} color="#71717A" aria-hidden="true" /></div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, marginTop: 10 }}>Couldn’t check today</div>
          <div style={{ fontSize: 12, color: M.muted, marginTop: 3 }}>This check didn’t run — it isn’t a clean result.</div>
        </div>
      ) : n === 0 ? (
        <div style={{ ...panel, marginTop: 10, padding: "22px 16px", textAlign: "center" }}>
          <div style={{ width: 40, height: 40, margin: "0 auto", borderRadius: 12, background: C.okBg, display: "flex", alignItems: "center", justifyContent: "center" }}><CircleCheck size={19} strokeWidth={2} color={C.ok} aria-hidden="true" /></div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin, marginTop: 10 }}>Nothing flagged today</div>
          <div style={{ fontSize: 12, color: M.muted, marginTop: 3 }}>No record failed this check.</div>
        </div>
      ) : (
        <>
          <SecRule label={head} hint={sort} top={14} />
          {cards.length === 0 ? <div style={{ ...panel, padding: "16px 14px", fontSize: 13, color: M.ink, textAlign: "center" }}>The list for this check was not returned.</div> : null}
          <DCards>
            {cards.slice(0, shown).map((c) => {
              const pill = pillOf(c);
              const pr = c.problem ? tone(c.problem.tone) : null;
              const rows: { k: string; v: string; hl?: boolean }[] = [...c.grid.map(([k, v]) => ({ k, v })), ...(c.problem ? [{ k: "Problem", v: c.problem.text, hl: true }] : [])];
              return (
                <div key={c.key} style={{ borderRadius: 14, background: M.card, boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 8px 20px -14px rgba(107,92,50,.35)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{c.ref || "—"}</span>
                    {pill ? <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: pill.bg, color: pill.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{pill.label}</span> : null}
                  </div>
                  {rows.length ? (
                    <div style={{ margin: "0 12px", borderRadius: 10, overflow: "hidden", boxShadow: `inset 0 0 0 1px ${M.hairline}` }}>
                      {rows.map((g, i) => (
                        <div key={g.k} style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", borderTop: i ? `1px solid ${M.divider}` : "none", background: g.hl && pr ? pr.bg : "transparent" }}>
                          <span style={{ padding: "7px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: M.taupe, background: M.paper, borderRight: `1px solid ${M.divider}` }}>{g.k}</span>
                          <span style={{ padding: "7px 10px", fontSize: 12.5, fontWeight: g.hl ? 700 : 600, color: g.hl && pr ? pr.fg : M.raisin, overflowWrap: "anywhere", ...TNUM }}>{g.v}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {canOpen(c) ? (
                    <button type="button" onClick={() => openRef(c)} aria-label={`${c.ref}, open detail`} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, height: 40, marginTop: 10, border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: M.taupe, cursor: "pointer", whiteSpace: "nowrap" }}>
                      <span>Open {c.ref}</span><Chev size={14} color={M.taupe} />
                    </button>
                  ) : <div style={{ height: 10 }} />}
                </div>
              );
            })}
          </DCards>
          {cards.length > shown ? <PillButton label={`Show more (${cards.length - shown} left)`} onClick={() => setShown((x) => x + 40)} /> : null}
          {go && canGo ? (
            <button type="button" onClick={onGo} style={{ width: "100%", marginTop: 12, height: 46, border: "none", borderRadius: 12, background: M.taupe, color: M.paper, fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 8px 18px -10px rgba(107,92,50,.7)" }}>
              <go.icon size={16} strokeWidth={2} aria-hidden="true" />{go.label}<ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </>
      )}
    </SheetFrame>
  );
}
