// ---------------------------------------------------------------------------
// Phone › Floor Live › Category breakdown (the strip in each department card)
// and its full-screen "Completed" detail.
// Visual source of truth: the approved Home Operations v3 design (Floor Live › Completed). DESIGN ONLY — the numbers are the desktop's own
// (DeptCompletedStrip):
//   GET /api/dashboard/floor-live/completed (src/api/lib/dept-completed.ts),
//   deptCompletedFor / deptCompletedDays / behindPace / myNowMin (floor-live-lib).
// RM = Department Revenue's production value: an order's FULL value, booked on
// the day this department's last job card for it closes. It is not the
// department's added value, so values overlap between departments.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { formatCurrency, todayYmdMY } from "@/lib/utils";
import {
  behindPace, deptCompletedDays, deptCompletedFor, myNowMin,
  type DeptCompletedResponse,
} from "../../../dashboards/floor-live-lib";
import { M } from "../../theme";
import { SHADOW_SMALL, TNUM } from "./home-style";
import type { CompletedTarget } from "./completed-detail-state";
import { G } from "./sales-glass";
import { CREAM, OCHRE, mixInto } from "./ops-oc-style";

const BED_BAR = "#6B5C32";
const SOFA_BAR = "#CDBE98";
const ACC_BAR = "#A8A29A";
const ICON_TAN = "#8B7A4E";
const RING = `0 0 0 1px ${M.hairline}`;
const SOFT = "0 10px 22px -16px rgba(107,92,50,.40)";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** Desktop's format (DeptCompletedStrip): "RM 9,698.50" — to the sen, as every revenue figure (owner 2026-11-20). */
const rm = (sen: number | undefined) => formatCurrency(Math.round(sen ?? 0));

// ---- the strip in a department card --------------------------------------------
export function CategoryStrip({ code, name, data, showUsual, live, onOpen }: {
  code: string;
  name: string;
  data: DeptCompletedResponse | null | undefined;
  showUsual: boolean;
  /** Today, live: a number behind the time-based pace turns red. */
  live: boolean;
  onOpen: (t: CompletedTarget) => void;
}) {
  const c = deptCompletedFor(data, code);
  if (!c) return null;
  const hasBed = c.bedframeUnits > 0 || c.usualBedframe > 0;
  const hasSofa = c.sofaSets > 0 || c.usualSofa > 0;
  const accSen = c.accessorySen ?? 0;
  if (!hasBed && !hasSofa && accSen <= 0) return null;
  const nowMin = myNowMin();
  const tone = (v: number, usual: number) =>
    showUsual && usual > 0 && v >= usual ? "#2F6B3F" : live && behindPace(v, usual, nowMin) ? "#DC2626" : M.raisin;
  const items = [
    hasBed && { k: "Bedframe", v: c.bedframeUnits, usual: c.usualBedframe, sen: c.bedframeSen },
    hasSofa && { k: "Sofa", v: c.sofaSets, usual: c.usualSofa, sen: c.sofaSen },
  ].filter(Boolean) as { k: string; v: number; usual: number; sen: number | undefined }[];
  return (
    <button
      type="button"
      onClick={() => onOpen({ code, name })}
      aria-label={`Completed by ${name}, every day this month`}
      style={{ width: "calc(100% - 20px)", margin: "8px 10px 4px", display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "7px 10px", boxSizing: "border-box", border: `1px dashed ${SOFA_BAR}`, borderRadius: 10, backgroundColor: CREAM, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: items.length === 2 ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: "2px 12px" }}>
        {items.map((x) => (
          <span key={x.k} style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>
              {x.k} <b style={{ fontSize: 14, color: tone(x.v, x.usual), ...TNUM }}>{x.v}</b>
              {showUsual ? <span style={{ fontSize: 10.5, color: M.body, ...TNUM }}> / {Math.round(x.usual)}</span> : null}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: M.taupe, ...TNUM }}>{rm(x.sen)}</span>
          </span>
        ))}
        {/* Accessory: value only, no count (owner 2026-11-20). */}
        {accSen > 0 ? <span style={{ gridColumn: "1 / -1", fontSize: 11, color: M.body, ...TNUM }}>Accessory <b style={{ color: M.taupe }}>{rm(accSen)}</b></span> : null}
      </span>
      <ChevronRight size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />
    </button>
  );
}

// ---- the full-screen detail ------------------------------------------------------
const circleBtn: CSSProperties = { width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: M.card, boxShadow: SHADOW_SMALL, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.taupe, padding: 0 };

function Tile({ k, v, sub, dot, bg, wide }: { k: string; v: string; sub?: string; dot: string; bg: string; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "auto", minWidth: 0, padding: "10px 12px", borderRadius: 14, background: bg, boxShadow: "inset 0 0 0 1px rgba(31,29,27,.05)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11.5, fontWeight: 700, lineHeight: "15px", color: M.taupe }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, flex: "none", marginTop: 3.5, borderRadius: 2, background: dot }} />
        <span style={{ minWidth: 0 }}>{k}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 16, fontWeight: 800, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{v}</div>
      {sub ? <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.35, color: M.ink, ...TNUM }}>{sub}</div> : null}
    </div>
  );
}

function Chip({ k, v, unit, money, dot, dim }: { k: string; v: string; unit?: string; money: string; dot: string; dim?: boolean }) {
  return (
    <div style={{ minWidth: 0, padding: "7px 8px", borderRadius: 10, background: M.paper }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: 0.2, color: M.taupe }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, flex: "none", borderRadius: 2, background: dot }} />{k}
      </div>
      <div style={{ marginTop: 3, fontSize: 13, fontWeight: 700, color: dim ? M.muted : M.raisin, whiteSpace: "nowrap" }}>{v}{unit ? <> <span style={{ fontSize: 10.5, fontWeight: 600, color: M.ink }}>{unit}</span></> : null}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: M.taupe, whiteSpace: "nowrap" }}>{money}</div>
    </div>
  );
}

export function CompletedDetail({ target, data, onClose }: { target: CompletedTarget; data: DeptCompletedResponse | null | undefined; onClose: () => void }) {
  // Malaysia date (UTC+8), not the device's: it decides "today" and the last month you can open.
  const today = todayYmdMY();
  const curMonth = today.slice(0, 7);
  // Opens on the month of the Floor Live date being viewed (the response's `to`).
  const baseMonth = (data?.to ?? today).slice(0, 7);
  const [month, setMonth] = useState(baseMonth);
  const other = useCachedJson<DeptCompletedResponse>(
    month !== baseMonth && data ? `/api/dashboard/floor-live/completed?from=${data.from}&to=${data.to}&month=${month}` : null,
    0,
  );
  const shown = month === baseMonth ? data : other.data;
  const c = deptCompletedFor(data, target.code); // the 12-day baseline is the latest one, whichever month is shown
  const { days: all, bedTotal, sofaTotal, bedAvg, sofaAvg } = deptCompletedDays(shown, target.code, today);
  // Newest first, only the days with output (the design's "BY DAY").
  const days = all.filter((d) => d.bedframeUnits > 0 || d.sofaSets > 0 || (d.bedframeSen ?? 0) > 0 || (d.sofaSen ?? 0) > 0 || (d.accessorySen ?? 0) > 0).sort((a, b) => b.date.localeCompare(a.date));
  const bedSen = days.reduce((s, d) => s + (d.bedframeSen ?? 0), 0);
  const sofaSen = days.reduce((s, d) => s + (d.sofaSen ?? 0), 0);
  const accSen = days.reduce((s, d) => s + (d.accessorySen ?? 0), 0);
  const totSen = bedSen + sofaSen + accSen;
  const max = Math.max(1, ...days.map((d) => (d.bedframeSen ?? 0) + (d.sofaSen ?? 0) + (d.accessorySen ?? 0)));
  const share = (v: number) => `${totSen > 0 ? (v / totSen) * 100 : 0}%`;

  const [yy, mm] = month.split("-").map(Number);
  const monthLabel = `${MONTHS[mm - 1]} ${yy}`;
  const isCurrent = month === curMonth;
  const mon = MONTHS[mm - 1].slice(0, 3);
  const step = (by: number) => {
    const t = new Date(Date.UTC(yy, mm - 1 + by, 1)).toISOString().slice(0, 7);
    if (t <= curMonth) setMonth(t);
  };
  const loadingOther = month !== baseMonth && other.loading && !other.data;
  const failedOther = month !== baseMonth && !other.loading && (!!other.error || (!!other.data && other.data.success === false) || !other.data);

  // Captions: the baseline is always the latest 12 working days; the month figure
  // is the average over this month's finished days with output (today left out).
  const base = (v: number | undefined) => `${isCurrent ? "12-day avg" : "Latest 12-day avg"} ${v ?? 0} / day`;
  const monthAvg = (a: number) => `${isCurrent ? "this month" : `${mon} avg`} ${a.toFixed(1)}`;

  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const title = `${target.name} — completed`;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 200, background: `linear-gradient(180deg,${mixInto("#C9A961", 16)} 0%,${M.paper} 40%)`, color: M.raisin, display: "flex", flexDirection: "column", fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" }}>
      <div style={{ flex: "none", height: "env(safe-area-inset-top, 0px)" }} />
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, height: 52, padding: "0 14px 0 8px", width: "100%", maxWidth: 820, margin: "0 auto", boxSizing: "border-box" }}>
        <button ref={backRef} type="button" onClick={onClose} aria-label="Back" style={{ width: 44, height: 44, border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.raisin }}>
          <ChevronLeft size={24} strokeWidth={1.9} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{target.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 12, color: M.ink, whiteSpace: "nowrap", overflow: "hidden" }}>
            <CalendarDays size={13} strokeWidth={2} color={ICON_TAN} aria-hidden="true" />
            <span>{monthLabel}</span><span aria-hidden="true">·</span><span>Completed</span>
          </div>
        </div>
        <div style={{ flex: "none", display: "flex", gap: 6 }}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous month" style={circleBtn}><ChevronLeft size={16} strokeWidth={2} /></button>
          <button type="button" onClick={() => step(1)} disabled={isCurrent} aria-label="Next month" style={{ ...circleBtn, opacity: isCurrent ? 0.3 : 1, cursor: isCurrent ? "default" : "pointer" }}><ChevronRight size={16} strokeWidth={2} /></button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px calc(110px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ width: "100%", maxWidth: 820, margin: "0 auto" }}>
          {loadingOther ? (
            <div aria-busy="true" role="status" style={{ padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>Loading {monthLabel}…</div>
          ) : failedOther ? (
            <div role="alert" style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: `${RING}, ${SOFT}`, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
              Could not load {monthLabel}.
              <div><button type="button" onClick={() => other.refresh()} style={{ marginTop: 12, height: 40, padding: "0 18px", border: "none", borderRadius: 12, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Retry</button></div>
            </div>
          ) : (
            <>
              <section aria-label="Month total" style={{ ...G.card, margin: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CalendarDays size={14} strokeWidth={2} color={M.taupe} aria-hidden="true" />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{monthLabel}</span>
                  <span style={{ minWidth: 0, fontSize: 12, color: M.ink }}>· {days.length} working day{days.length === 1 ? "" : "s"}</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: M.taupe }}>COMPLETED VALUE</div>
                <div style={{ fontSize: 26, lineHeight: "32px", fontWeight: 800, letterSpacing: -0.6, color: M.raisin, ...TNUM }}>{rm(totSen)}</div>
                <div aria-hidden="true" style={{ display: "flex", gap: 2, height: 8, marginTop: 8, borderRadius: 999, overflow: "hidden", background: M.divider }}>
                  <span style={{ width: share(bedSen), background: BED_BAR }} /><span style={{ width: share(sofaSen), background: SOFA_BAR }} /><span style={{ width: share(accSen), background: ACC_BAR }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
                  <Tile k="Bedframe units" v={bedTotal.toLocaleString()} sub={`${base(c?.usualBedframe)} · ${monthAvg(bedAvg)}`} dot={BED_BAR} bg={CREAM} />
                  <Tile k="Sofa sets" v={sofaTotal.toLocaleString()} sub={`${base(c?.usualSofa)} · ${monthAvg(sofaAvg)}`} dot={SOFA_BAR} bg={mixInto("#CDBE98", 18)} />
                  <Tile k="Bedframe value" v={rm(bedSen)} dot={BED_BAR} bg={CREAM} />
                  <Tile k="Sofa value" v={rm(sofaSen)} dot={SOFA_BAR} bg={mixInto("#CDBE98", 18)} />
                  {accSen > 0 ? <Tile k="Accessory value" v={rm(accSen)} sub="no units or sets — value only" dot={ACC_BAR} bg={mixInto("#A8A29A", 14)} wide /> : null}
                </div>
              </section>

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 2px 8px" }}>
                <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>BY DAY</span>
                <span aria-hidden="true" style={{ flex: 1, height: 1, background: G.rule }} />
                <span style={{ flex: "none", fontSize: 11.5, color: M.ink, whiteSpace: "nowrap" }}>Newest first</span>
              </div>
              {days.length === 0 ? (
                <div style={{ padding: 22, borderRadius: 16, background: M.card, boxShadow: RING, textAlign: "center", fontSize: 13, color: M.ink }}>Nothing completed this month yet.</div>
              ) : null}
              <div role="list" aria-label="Completed per day" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>
                {days.map((d) => {
                  const isToday = d.date === today;
                  const wd = WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
                  const bs = d.bedframeSen ?? 0;
                  const ss = d.sofaSen ?? 0;
                  const as = d.accessorySen ?? 0;
                  const fg = isToday ? "#FFFFFF" : M.taupe;
                  return (
                    <div key={d.date} role="listitem" style={{ padding: 12, borderRadius: 16, background: M.card, boxShadow: `${isToday ? "0 0 0 1.5px #C9A24B" : RING}, ${SOFT}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 40, height: 40, flex: "none", borderRadius: 11, background: isToday ? M.taupe : CREAM, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: fg, ...TNUM }}>{+d.date.slice(8)}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: fg, marginTop: 2, opacity: 0.85 }}>{isToday ? "TODAY" : wd}</span>
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span aria-hidden="true" style={{ display: "flex", gap: 2, height: 6, borderRadius: 999, background: M.divider, overflow: "hidden" }}>
                            <span style={{ width: `${(bs / max) * 100}%`, background: BED_BAR }} /><span style={{ width: `${(ss / max) * 100}%`, background: SOFA_BAR }} /><span style={{ width: `${(as / max) * 100}%`, background: ACC_BAR }} />
                          </span>
                        </span>
                        <span style={{ flex: "none", fontSize: 14, fontWeight: 800, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{rm(bs + ss + as)}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, marginTop: 10, ...TNUM }}>
                        <Chip k="BEDFRAME" v={d.bedframeUnits ? String(d.bedframeUnits) : "—"} unit={d.bedframeUnits ? "units" : undefined} money={bs ? rm(bs) : "—"} dot={BED_BAR} dim={!d.bedframeUnits} />
                        <Chip k="SOFA" v={d.sofaSets ? String(d.sofaSets) : "—"} unit={d.sofaSets ? "sets" : undefined} money={ss ? rm(ss) : "—"} dot={SOFA_BAR} dim={!d.sofaSets} />
                        <Chip k="ACCESSORY" v="—" money={as ? rm(as) : "—"} dot={ACC_BAR} dim />
                      </div>
                    </div>
                  );
                })}
              </div>
              {days.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "4px 12px", alignItems: "center", marginTop: 10, padding: "12px 14px", borderRadius: 14, background: "#3A352C", color: "#FFFFFF", ...TNUM }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6 }}>MONTH TOTAL</span>
                  <span style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap" }}>{rm(totSen)}</span>
                  <span style={{ fontSize: 11.5, color: "#D9D2C5" }}>Bedframe {rm(bedSen)} · Sofa {rm(sofaSen)} · Accessory {rm(accSen)}</span>
                  <span />
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "rgba(201,169,97,.08)", fontSize: 11.5, lineHeight: 1.45, color: OCHRE }}>
                <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                <span style={{ minWidth: 0 }}>Average = the last 12 working days. Bedframe counts every piece; sofa counts 1 order as 1 set. Value = Department Revenue’s figure (the order’s full value when this department’s last card for it closes). Accessory makes no units or sets; its value is shown so the total equals Department Revenue.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
