// ---------------------------------------------------------------------------
// Phone › Floor Live › Category breakdown (the strip in each department card)
// and its full-screen "Completed" detail.
// Visual source of truth: Claude Design handoff "Hookka Floor Live (2)".
// DESIGN ONLY — the numbers are the desktop's own (DeptCompletedStrip):
//   GET /api/dashboard/floor-live/completed (src/api/lib/dept-completed.ts),
//   deptCompletedFor / deptCompletedDays / behindPace / myNowMin (floor-live-lib).
// RM = Department Revenue's production value: an order's FULL value, booked on
// the day this department's last job card for it closes. It is not the
// department's added value, so values overlap between departments.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BedDouble, CalendarDays, ChevronLeft, ChevronRight, Sofa, Wallet, type LucideIcon } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import {
  behindPace, deptCompletedDays, deptCompletedFor, myNowMin,
  type DeptCompletedResponse,
} from "../../../dashboards/floor-live-lib";
import { M } from "../../theme";
import { SHADOW_SMALL, TNUM } from "./home-style";
import type { CompletedTarget } from "./completed-detail-state";

const SOFA_BAR = "#CDBE98";
const ICON_TAN = "#8B7A4E";
const SHADOW_PANEL = "0 0 0 1px rgba(31,29,27,.05),0 2px 4px rgba(31,29,27,.06),0 14px 30px -14px rgba(31,29,27,.30)";
const SHADOW_TILE = "0 0 0 1px rgba(31,29,27,.04),0 2px 4px rgba(31,29,27,.06),0 10px 24px -12px rgba(31,29,27,.28)";
const TODAY_ROW = `color-mix(in srgb, ${M.taupe} 8%, ${M.card})`;
const STRIP_BG = `color-mix(in srgb, ${M.taupe} 12%, ${M.card})`;
// 390px: 330px inner width = 46 + bar + 62 + 62 + 80 + 4 gaps of 4 → the bar keeps ~64px; "12 Nov" and "RM 170,640" fit.
const TABLE_GRID = "46px minmax(0,1fr) 62px 62px 80px";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const rmN = (sen: number | undefined) => Math.round((sen ?? 0) / 100).toLocaleString("en-MY");
/** Desktop's format (DeptCompletedStrip): "RM 9,698", whole ringgit. */
const rm = (sen: number | undefined) => `RM ${rmN(sen)}`;

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
      style={{ width: "calc(100% - 20px)", margin: "8px 10px 4px", display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "7px 10px", boxSizing: "border-box", border: `1px dashed ${SOFA_BAR}`, borderRadius: 10, backgroundColor: STRIP_BG, fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: items.length === 2 ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: "2px 12px" }}>
        {items.map((x) => (
          <span key={x.k} style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>
              {x.k} <b style={{ fontSize: 14, color: tone(x.v, x.usual), ...TNUM }}>{x.v}</b>
              {showUsual ? <span style={{ fontSize: 10.5, color: M.body, ...TNUM }}> / {Math.round(x.usual)}</span> : null}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: M.taupe, ...TNUM }}>RM {rmN(x.sen)}</span>
          </span>
        ))}
        {/* Accessory: value only, no count (owner 2026-11-20). */}
        {accSen > 0 ? <span style={{ gridColumn: "1 / -1", fontSize: 11, color: M.body, ...TNUM }}>Accessory <b style={{ color: M.taupe }}>RM {rmN(accSen)}</b></span> : null}
      </span>
      <ChevronRight size={16} strokeWidth={2} color={M.taupe} aria-hidden="true" />
    </button>
  );
}

// ---- the full-screen detail ------------------------------------------------------
const circleBtn: CSSProperties = { width: 36, height: 36, borderRadius: "50%", border: "none", backgroundColor: M.card, boxShadow: SHADOW_SMALL, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.taupe, padding: 0 };

function Tile({ icon: Icon, k, v, sub }: { icon: LucideIcon; k: string; v: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0, boxSizing: "border-box", padding: "12px 14px", borderRadius: 14, backgroundColor: M.card, boxShadow: SHADOW_TILE }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1.3, color: M.taupe, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden" }}>
        <span style={{ display: "flex", flex: "none" }}><Icon size={13} strokeWidth={2} color={ICON_TAN} aria-hidden="true" /></span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
      </span>
      <span style={{ display: "block", marginTop: 8, fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: M.raisin, whiteSpace: "nowrap", ...TNUM }}>{v}</span>
      {sub ? <span style={{ display: "block", minHeight: 29, marginTop: 4, fontSize: 11, lineHeight: 1.3, color: M.ink, ...TNUM }}>{sub}</span> : null}
    </div>
  );
}

function Cell({ qty, money }: { qty: string; money: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin }}>{qty}</span>
      <span style={{ fontSize: 10.5, color: M.taupe, whiteSpace: "nowrap" }}>{money}</span>
    </span>
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
  const days = all.filter((d) => d.bedframeUnits > 0 || d.sofaSets > 0 || (d.bedframeSen ?? 0) > 0 || (d.sofaSen ?? 0) > 0 || (d.accessorySen ?? 0) > 0);
  const bedSen = days.reduce((s, d) => s + (d.bedframeSen ?? 0), 0);
  const sofaSen = days.reduce((s, d) => s + (d.sofaSen ?? 0), 0);
  const accSen = days.reduce((s, d) => s + (d.accessorySen ?? 0), 0);
  const max = Math.max(1, ...days.map((d) => (d.bedframeSen ?? 0) + (d.sofaSen ?? 0) + (d.accessorySen ?? 0)));

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
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 200, backgroundColor: M.paper, color: M.raisin, display: "flex", flexDirection: "column", fontFamily: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" }}>
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

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18px calc(110px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ width: "100%", maxWidth: 820, margin: "0 auto", paddingTop: 4 }}>
          {loadingOther ? (
            <div aria-busy="true" role="status" style={{ padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>Loading {monthLabel}…</div>
          ) : failedOther ? (
            <div role="alert" style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_PANEL, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
              Could not load {monthLabel}.
              <div><button type="button" onClick={() => other.refresh()} style={{ marginTop: 12, height: 40, padding: "0 18px", border: "none", borderRadius: 12, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Retry</button></div>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginBottom: 16 }}>
                <Tile icon={BedDouble} k="Bedframe units" v={bedTotal.toLocaleString()} sub={`${base(c?.usualBedframe)} · ${monthAvg(bedAvg)}`} />
                <Tile icon={Sofa} k="Sofa sets" v={sofaTotal.toLocaleString()} sub={`${base(c?.usualSofa)} · ${monthAvg(sofaAvg)}`} />
                <Tile icon={Wallet} k="Bedframe value" v={rm(bedSen)} />
                <Tile icon={Wallet} k="Sofa value" v={rm(sofaSen)} />
                {accSen > 0 ? <Tile icon={Wallet} k="Accessory value" v={rm(accSen)} /> : null}
              </div>

              {days.length === 0 ? (
                <div style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_PANEL, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>Nothing completed this month yet.</div>
              ) : null}

              <div style={{ display: "flex", gap: 12, margin: "0 0 8px", padding: "0 4px", fontSize: 11.5, color: M.ink }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 8, borderRadius: 2, backgroundColor: M.taupe }} />Bedframe value</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 8, borderRadius: 2, backgroundColor: SOFA_BAR }} />Sofa value</span>
              </div>
              <div role="table" aria-label="Completed per day" style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_PANEL }}>
                <div role="row" style={{ position: "sticky", top: 0, zIndex: 2, display: "grid", gridTemplateColumns: TABLE_GRID, gap: 4, alignItems: "center", padding: "8px 12px", borderRadius: "16px 16px 0 0", backgroundColor: `color-mix(in srgb, ${M.raisin} 3%, ${M.card})`, boxShadow: `0 1px 0 ${M.divider}`, fontSize: 11, fontWeight: 700, color: M.muted }}>
                  <span>Date</span><span aria-hidden="true" /><span style={{ textAlign: "right" }}>Bedframe</span><span style={{ textAlign: "right" }}>Sofa</span><span style={{ textAlign: "right" }}>Total RM</span>
                </div>
                {days.map((d) => {
                  const isToday = d.date === today;
                  const wd = WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
                  const bs = d.bedframeSen ?? 0;
                  const ss = d.sofaSen ?? 0;
                  const as = d.accessorySen ?? 0;
                  return (
                    <div key={d.date} role="row" style={{ display: "grid", gridTemplateColumns: TABLE_GRID, gap: 4, alignItems: "center", minHeight: 44, padding: "6px 12px", borderTop: `1px solid ${M.divider}`, backgroundColor: isToday ? TODAY_ROW : M.card, ...TNUM }}>
                      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{+d.date.slice(8)} {MONTHS[+d.date.slice(5, 7) - 1].slice(0, 3)}</span>
                        <span style={{ fontSize: 10.5, fontWeight: isToday ? 700 : 500, color: isToday ? M.taupe : M.muted, whiteSpace: "nowrap" }}>{isToday ? "Today" : wd}</span>
                      </span>
                      <span aria-hidden="true" style={{ display: "flex", height: 8, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
                        <span style={{ width: `${(bs / max) * 100}%`, backgroundColor: M.taupe }} />
                        <span style={{ width: `${(ss / max) * 100}%`, backgroundColor: SOFA_BAR }} />
                        <span style={{ width: `${(as / max) * 100}%`, backgroundColor: "#A8A29A" }} />
                      </span>
                      <Cell qty={d.bedframeUnits ? String(d.bedframeUnits) : "—"} money={bs ? rm(bs) : "—"} />
                      <Cell qty={d.sofaSets ? String(d.sofaSets) : "—"} money={ss ? rm(ss) : "—"} />
                      <span style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{rm(bs + ss + as)}</span>
                    </div>
                  );
                })}
                <div role="row" style={{ display: "grid", gridTemplateColumns: TABLE_GRID, gap: 4, alignItems: "center", padding: "9px 12px", borderTop: `1px solid ${M.hairline}`, borderRadius: "0 0 16px 16px", backgroundColor: M.divider, ...TNUM }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: M.taupe }}>Total</span><span />
                  <Cell qty={String(bedTotal)} money={rm(bedSen)} />
                  <Cell qty={String(sofaTotal)} money={rm(sofaSen)} />
                  <span style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, color: M.taupe, whiteSpace: "nowrap" }}>{rm(bedSen + sofaSen + accSen)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
