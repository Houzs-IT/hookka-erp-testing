// Home Operations v3 · Overview, part 2: Plant Load and Department Backlog, with their bottom sheets (glass cards, "Home
// Operations v3" design). Data and rules: desktop dashboard-b/index.tsx (plantLoad, deptBacklog). Both read
// GET /api/dashboard/overview?period=<month|quarter|year>: they FOLLOW the period, a past period shows a saved snapshot / a
// month-end reconstruction / today's live figure (labelled), and a picked day does not change them (department capacity is
// always the rolling 12 working days). The Sofa / Bedframe and delivery-month chips are the desktop's page-wide toggles
// (backlog-toggle-store), shared by Backlog, Plant Load, Total Backlog and Active Jobs.
import { useMemo, useState } from "react";
import { CircleCheck, Clock, Factory, Gauge, Layers, Package, ChevronDown, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { widgetPeriodLabel, type Period } from "../../../dashboards/dashboard-shared-lib";
import { toggleBacklogCategory, toggleBacklogMonth, useBacklogToggles } from "../../../dashboards/backlog-toggle-store";
import { NOWRAP_ELLIPSIS, TNUM } from "./home-style";
import type { OpsData } from "./ops-data";
import { backlogMonthChips, backlogView, capacityWindowLabel, completedHead, hrs, n0, plantFiltered, plantGauge, stateTag } from "./ops-lib";
import { C } from "./ops-style";
import { Chev, StatusBlock } from "./ops-ui";
import { OGCard, ONote, PillButton } from "./ops-glass";
import { panelStyle } from "./ops-glass-style";
import { G } from "./sales-glass";
import { BacklogSheet, CapacitySheet, DoneSheet, JobsSheet } from "./HomeOpsSheets";

/** Category colours of the v3 design (README: Bedframe #2B5797, Sofa #8A8F98). */
const BED = "#2B5797";
const SOFA = "#8A8F98";

const ARC_R = 82;
function arcPath(p: number): string {
  const a1 = Math.PI * (1 - Math.min(p, 1));
  const x1 = 100 + ARC_R * Math.cos(a1);
  const y1 = 100 - ARC_R * Math.sin(a1);
  return `M${100 - ARC_R},100 A${ARC_R},${ARC_R} 0 0 1 ${x1},${y1}`;
}
const gaugeColor = (hex: string) => (hex === "#DC2626" ? C.gaugeRed : hex === "#C9A24B" ? C.gaugeAmber : C.gaugeGreen);
/**
 * The design has no LIVE tag on these cards, so a live figure shows nothing. A figure that is NOT today's keeps a compact tag
 * (the desktop's three cases): a saved snapshot "as of 31 Oct", a month-end estimate "estimate", or today's figure standing in
 * for a past month "no snapshot". The full wording stays in the tooltip.
 */
function StateTagView({ tag }: { tag: ReturnType<typeof stateTag> }) {
  if (!tag) return null;
  const short = tag.kind === "asof" ? tag.text : tag.kind === "reconstructed" ? "estimate" : "no snapshot";
  const [bg, fg] = tag.kind === "asof" ? ["#EEF3EE", "#4B7A52"] : tag.kind === "reconstructed" ? ["#EEF1F4", "#5B6675"] : ["#FBF3E2", "#9A7B2E"];
  return <span title={tag.text} style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, background: bg, color: fg, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{short}</span>;
}

type Sheet = "cap" | "backlog" | "jobs" | "done" | null;
type Tile = { icon: LucideIcon; bg: string; fg: string; label: string; value: string; unit: string; sheet: Exclude<Sheet, null> };

export function PlantLoadCard({ d, period, periodKey, curYm }: { d: OpsData; period: Period; periodKey: string; curYm: string }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const toggles = useBacklogToggles();
  const { status, data } = d.overview;
  const prod = data?.production;
  const tag = stateTag(data?.stateSnapshot);
  const pf = prod ? plantFiltered(prod, toggles) : null;
  const g = pf ? plantGauge(pf.backlogDays) : null;
  const gc = g ? gaugeColor(g.color) : C.gaugeGreen;
  const head = prod ? completedHead(prod) : null;
  const win = capacityWindowLabel(periodKey, curYm);
  const winText = win === "12-day avg" ? "last 12 working days" : win;
  const avg = prod?.dailyCapacityMin ?? 0;
  const tiles: Tile[] = prod && head && pf ? [
    { icon: Factory, bg: "#F4EFE6", fg: M.taupe, label: "Daily Capacity", value: hrs(avg), unit: "per day", sheet: "cap" },
    { icon: Clock, bg: C.dangerBg, fg: C.danger, label: "Total Backlog", value: `${pf.backlogDays.toFixed(1)} days`, unit: `${hrs(pf.backlogMin)} queued`, sheet: "backlog" },
    { icon: Package, bg: C.tealBg, fg: C.teal, label: "Active Jobs", value: `${n0(pf.jobs.bedframeUnits)} / ${n0(pf.jobs.sofaSets)}`, unit: "bedframe / sofa", sheet: "jobs" },
    { icon: CircleCheck, bg: C.okBg, fg: C.ok, label: "Completed", value: `${n0(head.bedframe)} / ${n0(head.sofa)}`, unit: "bedframe / sofa", sheet: "done" },
  ] : [];
  const rowsB = prod ? backlogView(prod, toggles) : [];
  const bedOn = !toggles.hiddenCat.has("Bedframe");
  const sofaOn = !toggles.hiddenCat.has("Sofa");

  return (
    <>
      <OGCard icon={Gauge} title="Plant Load" sub="Backlog vs daily capacity" label="Plant Load" id="ops-plant-load" divider={false} right={<StateTagView tag={tag} />}>
        {status !== "ready" || !prod || !g || !pf ? (
          <div style={{ marginTop: 10 }}><StatusBlock status={status === "ready" ? "error" : status} what="Plant Load" need="a dashboard view" reason={status === "ready" ? "no production figures returned" : undefined} onRetry={d.retryOverview} /></div>
        ) : (
          <>
            <div style={{ ...panelStyle({ padding: "10px 12px" }), display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <div role="img" aria-label={`Queue ${pf.backlogDays.toFixed(1)} days, ${g.pct}% of a 14-day buffer`} style={{ position: "relative", flex: "none", width: 132, height: 78 }}>
                <svg viewBox="0 0 200 112" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                  <path d={arcPath(1)} fill="none" stroke={M.divider} strokeWidth={14} strokeLinecap="round" />
                  {g.util > 0 ? <path d={arcPath(g.util)} fill="none" stroke={gc} strokeWidth={14} strokeLinecap="round" /> : null}
                </svg>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, textAlign: "center" }}>
                  <div style={{ fontSize: 20, lineHeight: "22px", fontWeight: 800, letterSpacing: -0.5, color: M.raisin, ...TNUM }}>{pf.backlogDays.toFixed(1)}d</div>
                  <div style={{ fontSize: 10.5, color: M.muted }}>queue</div>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: M.taupe }}>WORKFORCE</span>
                  <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.4, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{data?.employee ? n0(data.employee.activeHeadcount) : "—"}</span>
                </div>
                <div aria-hidden="true" style={{ height: 1, background: G.rule }} />
                <div title="Queue length as a share of a 2-week (14-day) buffer — not a utilisation figure." style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, color: M.taupe }}>QUEUE VS 14D</span>
                  <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.4, color: gc, whiteSpace: "nowrap", ...TNUM }}>{g.pct}%</span>
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 8 }}>
              {tiles.map((r) => (
                <button key={r.label} type="button" aria-label={`${r.label}: ${r.value} ${r.unit}`} onClick={() => setSheet(r.sheet)}
                  style={{ position: "relative", overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, padding: "10px 11px", border: "none", borderRadius: 14, background: `linear-gradient(160deg,${M.card} 40%,color-mix(in srgb, ${r.fg} 10%, ${M.card}))`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 8px 18px -12px rgba(107,92,50,.35)`, fontFamily: "inherit", textAlign: "left", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, minHeight: 22 }}>
                    <span aria-hidden="true" style={{ width: 22, height: 22, flex: "none", borderRadius: 7, background: `color-mix(in srgb, ${r.fg} 16%, ${M.card})`, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <r.icon size={12} strokeWidth={2.2} color={r.fg} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, lineHeight: 1.25, color: M.raisin, overflowWrap: "anywhere" }}>{r.label}</span>
                    <span aria-hidden="true" style={{ width: 18, height: 18, flex: "none", borderRadius: "50%", background: `color-mix(in srgb, ${M.card} 85%, transparent)`, boxShadow: "inset 0 0 0 1px rgba(31,29,27,.06)", display: "flex", alignItems: "center", justifyContent: "center" }}><Chev size={12} color={r.fg} /></span>
                  </span>
                  <span style={{ display: "block", minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 17, lineHeight: "21px", fontWeight: 800, letterSpacing: -0.4, color: r.fg, whiteSpace: "nowrap", ...TNUM }}>{r.value}</span>
                    <span style={{ display: "block", fontSize: 11, lineHeight: 1.3, color: M.muted, marginTop: 2, overflowWrap: "anywhere" }}>{r.unit}</span>
                  </span>
                </button>
              ))}
            </div>
            {pf.filtered ? <ONote top={10}>Total Backlog and Active Jobs show {pf.showing}.</ONote> : null}
            {period.day ? <div style={{ fontSize: 11.5, color: M.ink, marginTop: 10 }}>Showing {widgetPeriodLabel(period)} — a single day does not change this card.</div> : null}
          </>
        )}
      </OGCard>

      {sheet === "cap" && prod ? <CapacitySheet prod={prod} winText={winText} onClose={() => setSheet(null)} /> : null}
      {sheet === "backlog" && prod && pf ? <BacklogSheet prod={prod} pf={pf} rows={rowsB} live={tag ? tag.text : "Live"} sofaOn={sofaOn} bedOn={bedOn} onClose={() => setSheet(null)} /> : null}
      {sheet === "jobs" && prod && pf ? <JobsSheet pf={pf} onClose={() => setSheet(null)} /> : null}
      {sheet === "done" && prod && head ? <DoneSheet prod={prod} head={head} period={period} onClose={() => setSheet(null)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Department Backlog
// ---------------------------------------------------------------------------
const chipBtn = (on: boolean) => ({
  height: 28, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 10px", border: "none", borderRadius: 999, background: on ? M.card : M.divider,
  boxShadow: on ? "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)" : "none", fontFamily: "inherit", fontSize: 12, fontWeight: 600, color: on ? M.raisin : M.muted,
  cursor: "pointer", whiteSpace: "nowrap" as const, WebkitTapHighlightColor: "transparent",
});

export function DeptBacklogCard({ d }: { d: OpsData }) {
  const [all, setAll] = useState(false);
  const [openDept, setOpenDept] = useState<string | null>(null);
  const toggles = useBacklogToggles();
  const { status, data } = d.overview;
  const prod = data?.production;
  const tag = stateTag(data?.stateSnapshot);
  const rows = useMemo(() => (prod ? backlogView(prod, toggles) : []), [prod, toggles]);
  const monthChips = useMemo(() => (prod ? backlogMonthChips(prod) : []), [prod]);
  const sofaOn = !toggles.hiddenCat.has("Sofa");
  const bedOn = !toggles.hiddenCat.has("Bedframe");
  const maxDays = Math.max(1, ...rows.map((r) => r.shown ?? 0));
  const daysText = (v: number | null) => (v == null ? "Stalled" : `${v.toFixed(1)}d`);
  const shownRows = all ? rows : rows.slice(0, 5);

  return (
    <OGCard icon={Layers} title="Department Backlog" label="Department Backlog" id="ops-dept-backlog" right={<StateTagView tag={tag} />}>
      {status !== "ready" || !prod ? (
        <StatusBlock status={status === "ready" ? "error" : status} what="Department Backlog" need="a dashboard view" reason={status === "ready" ? "no production figures returned" : undefined} onRetry={d.retryOverview} />
      ) : prod.backlogByDept.length === 0 ? (
        <div role="status" style={{ padding: "22px 0", textAlign: "center", fontSize: 13, color: M.muted }}>No active work in any department.</div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 8, margin: "0 2px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: "none", width: 62, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.muted }}>CATEGORY</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {([["Sofa", SOFA], ["Bedframe", BED]] as const).map(([k, c]) => {
                  const on = !toggles.hiddenCat.has(k);
                  return (
                    <button key={k} type="button" aria-pressed={on} onClick={() => toggleBacklogCategory(k)} style={chipBtn(on)}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: c, opacity: on ? 1 : 0.35 }} />{k}
                    </button>
                  );
                })}
              </div>
            </div>
            {monthChips.length > 0 ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ flex: "none", width: 62, paddingTop: 7, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.muted }}>DELIVERY</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {monthChips.map((m) => {
                    const on = !toggles.hiddenMonth.has(m.key);
                    return (
                      <button key={m.key} type="button" aria-pressed={on} onClick={() => toggleBacklogMonth(m.key)}
                        style={{ ...chipBtn(true), color: M.raisin, opacity: on ? 1 : 0.4, textDecoration: on ? "none" : "line-through" }}>
                        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 3, background: m.color }} />{m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <div role="status" style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.muted }}>Nothing is shown — turn a category or delivery month back on.</div>
          ) : (
            <div style={panelStyle({ padding: "0 12px", overflow: "hidden" })}>
              {shownRows.map((r, i) => {
                const open = openDept === r.dept;
                const stalled = r.shown == null;
                const pillBg = stalled ? C.dangerBg : "#F0ECE9";
                const pillFg = stalled ? C.danger : "#4D4630";
                const facts: [string, string, string][] = [
                  ["Queued", hrs((sofaOn ? r.sofaMin : 0) + (bedOn ? r.bedframeMin : 0)), M.taupe],
                  [r.single ? `${r.single.label} cap` : "Daily cap", r.single ? (r.single.capMin > 0 ? `${hrs(r.single.capMin)}/day` : "—") : r.dailyCapMin > 0 ? `${hrs(r.dailyCapMin)}/day` : "—", "#8B7A4E"],
                  ...(sofaOn ? [["Sofa", hrs(r.sofaMin), SOFA] as [string, string, string]] : []),
                  ...(bedOn ? [["Bedframe", hrs(r.bedframeMin), BED] as [string, string, string]] : []),
                ];
                return (
                  <div key={r.dept} style={{ borderTop: i ? `1px solid ${G.rule}` : "none" }}>
                    <button type="button" aria-expanded={open} aria-label={`${r.dept}, ${stalled ? "stalled" : `${r.shown!.toFixed(1)} days`} to clear. Show queued hours and capacity`} onClick={() => setOpenDept(open ? null : r.dept)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 42, padding: 0, border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ flex: "none", width: 92, fontSize: 12.5, fontWeight: 600, color: M.raisin, ...NOWRAP_ELLIPSIS }}>{r.dept}</span>
                      <span aria-hidden="true" style={{ flex: 1, minWidth: 0, display: "flex", gap: 1, height: 8, borderRadius: 999, background: M.divider, overflow: "hidden" }}>
                        {stalled ? null : r.segs.length > 0
                          ? r.segs.map((s) => <span key={s.month} style={{ flex: "none", width: `${(s.days / maxDays) * 100}%`, background: s.color }} />)
                          : (
                            <>
                              <span style={{ flex: "none", width: `${((sofaOn ? r.sofaDays : 0) / maxDays) * 100}%`, background: SOFA }} />
                              <span style={{ flex: "none", width: `${((bedOn ? r.bedDays : 0) / maxDays) * 100}%`, background: BED }} />
                            </>
                          )}
                      </span>
                      <span style={{ flex: "none", minWidth: 50, height: 22, boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 7px", borderRadius: 999, background: pillBg, fontSize: 11.5, fontWeight: 800, color: pillFg, whiteSpace: "nowrap", ...TNUM }}>{daysText(r.shown)}</span>
                      <span style={{ flex: "none", display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .18s ease" }}><ChevronDown size={13} strokeWidth={2} color={C.chevron} aria-hidden="true" /></span>
                    </button>
                    {open ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, margin: "0 0 10px" }}>
                        {facts.map(([k, v, dot]) => (
                          <div key={k} style={{ minWidth: 0, padding: "7px 9px", borderRadius: 10, background: M.card, boxShadow: "inset 0 0 0 1px rgba(31,29,27,.07)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 600, color: M.muted, whiteSpace: "nowrap" }}>
                              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />{k}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", ...TNUM }}>{v}</div>
                          </div>
                        ))}
                        {stalled ? <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: M.ink }}>No completions in the last 12 working days, so there is no capacity to divide by.</div> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {rows.length > 5 ? <PillButton label={all ? "Show fewer" : `Show all ${rows.length}`} expanded={all} onClick={() => setAll((v) => !v)} /> : null}
          <ONote>Tap a department for queued hours and capacity. Tap a category or delivery month to show or hide it — days recalculate.</ONote>
        </>
      )}
    </OGCard>
  );
}
