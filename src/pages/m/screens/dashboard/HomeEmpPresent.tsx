// Home Employees v3 · "Present on <day>" sheet: who punched that day, with the location chips, the In / Out selfies, the late
// pill and the not-in list. Visual source: the approved Home Employees v3 HTML. Data and rules: the SAME request, row rule and
// fence rule as Employees → Attendance (attendance-model.ts, attendance-location.ts); the selfie viewer and punch detail are
// that screen's own components, unchanged. Read-only, attendance:read only (the Present tile never opens it without that).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CameraOff, ChevronRight, Info, UserRound } from "lucide-react";
import { M } from "../../theme";
import { deptName } from "../../../dashboards/ops-floor-lib";
import { TNUM } from "./home-style";
import { MorePill, ROW_DIV, T_LINE } from "./emp-glass";
import { tint } from "./emp-glass-style";
import { outsourcedIds } from "./emp-present";
import { dLab, hhmm, lateMin } from "./emp-lib";
import type { EmpModel } from "./emp-model";
import AttendanceDetail from "../employees/AttendanceDetail";
import PunchPhotoViewer, { type PunchPhotoTarget } from "../employees/PunchPhotoViewer";
import { LOC_LABEL, filterByLoc, locCounts, rowLocation, type LocFilter, type RowLoc } from "../employees/attendance-location";
import type { AttRow } from "../employees/attendance-model";

const LOC_TONE: Record<RowLoc, string> = { factory: "#4F7C3A", offsite: "#9A3A2D", nogps: "#6B6358" };
const CHIPS: readonly (readonly [LocFilter, string, string | null])[] = [["all", "All", null], ["factory", "At factory", "#4F7C3A"], ["offsite", "Off-site", "#9A3A2D"], ["nogps", "No GPS", "#9A9082"]];

/** A punch selfie as a 38 px circle that opens the viewer (camera-off circle when there is no photo). */
function Thumb({ label, has, src, onClick }: { label: string; has: boolean; src: string; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={has ? `View punch-${label.toLowerCase()} photo` : `No punch-${label.toLowerCase()} photo`}
      style={{ border: "none", background: "none", padding: 0, fontFamily: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <span style={{ width: 38, height: 38, borderRadius: "50%", overflow: "hidden", background: has ? "linear-gradient(160deg,#D9CFBF,#B9AC97)" : "#E6E0D9", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
        {has && !failed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : has ? <UserRound size={19} strokeWidth={1.6} /> : <CameraOff size={19} strokeWidth={1.6} />}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: M.muted, lineHeight: 1 }}>{label}</span>
    </button>
  );
}

const box = { margin: 0, borderRadius: 16, background: M.card, boxShadow: `0 0 0 1px ${T_LINE}, 0 10px 22px -16px rgba(107,92,50,.40)`, overflow: "hidden" } as const;
const capsLabel = (c: string) => ({ padding: "12px 4px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: c }) as const;

export function PresentSheetBody({ m }: { m: EmpModel }) {
  const navigate = useNavigate();
  const [loc, setLoc] = useState<LocFilter>("all");
  const [detail, setDetail] = useState<AttRow | null>(null);
  const [photo, setPhoto] = useState<{ target: PunchPhotoTarget; which: "in" | "out" } | null>(null);
  const day = m.W.anchor;
  const { status, rows } = m.punches;
  const out = outsourcedIds(m);
  const openPhoto = (r: AttRow, which: "in" | "out") => setPhoto({ which, target: { id: r.id, name: r.employeeName, clockIn: r.clockIn, clockOut: r.clockOut, hasIn: !!r.hasClockInPhoto, hasOut: !!r.hasClockOutPhoto } });
  const link = `/m/employees?section=attendance${day && day !== m.today ? `&adate=${day}` : ""}`;

  if (status !== "ready") {
    const msg = status === "loading" ? "Loading the punches…" : status === "denied" ? "You don't have access to attendance punches." : "Couldn't load the punches.";
    return (
      <div role="status" style={{ ...box, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
        {msg}
        {status === "error" ? <div><button type="button" onClick={m.punches.refresh} style={{ marginTop: 12, height: 36, padding: "0 16px", border: "none", borderRadius: 12, background: M.taupe, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Try again</button></div> : null}
      </div>
    );
  }

  const counts = locCounts(rows);
  const shown = filterByLoc(rows, loc).sort((a, b) => (a.employeeName ?? "").localeCompare(b.employeeName ?? ""));
  const absent = m.pres.absent;
  return (
    <>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "2px -16px 0", padding: "8px 16px 4px", scrollbarWidth: "none" }}>
        {CHIPS.map(([k, l, dot]) => {
          const on = loc === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setLoc(k)}
              style={{ flex: "none", height: 34, padding: "0 13px", borderRadius: 999, border: "none", background: on ? M.taupe : M.card, color: on ? "#FFFFFF" : M.raisin, boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              {dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} /> : null}{l}<span style={{ opacity: 0.8, ...TNUM }}>{counts[k]}</span>
            </button>
          );
        })}
      </div>
      <div style={capsLabel(M.taupe)}>{shown.length} · PUNCHES</div>
      {shown.length === 0 ? (
        <div style={{ ...box, padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>{loc === "all" ? `No punches on ${day ? dLab(day) : "this day"}.` : `No ${LOC_LABEL[loc as RowLoc].toLowerCase()} punches on ${day ? dLab(day) : "this day"}.`}</div>
      ) : (
        <div style={box}>
          {shown.map((r, i) => {
            const lc = rowLocation(r);
            const lm = lateMin(r.clockIn);
            return (
              <div key={r.id} role="button" tabIndex={0} aria-label={`${r.employeeName}, in ${hhmm(r.clockIn)}, out ${hhmm(r.clockOut)}, ${LOC_LABEL[lc]}. Open details`}
                onClick={() => setDetail(r)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setDetail(r); } }}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "10px 14px", borderTop: i ? `1px solid ${ROW_DIV}` : "none", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <span style={{ flex: "none", display: "flex", gap: 6 }}>
                  <Thumb label="In" has={!!r.hasClockInPhoto} src={`/api/attendance/${encodeURIComponent(r.id)}/photo?which=in`} onClick={() => openPhoto(r, "in")} />
                  <Thumb label="Out" has={!!r.hasClockOutPhoto} src={`/api/attendance/${encodeURIComponent(r.id)}/photo?which=out`} onClick={() => openPhoto(r, "out")} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.employeeName || r.employeeId}{out.has(r.employeeId) ? " (outsourced)" : ""}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 3, whiteSpace: "nowrap", ...TNUM }}>
                    <span style={{ color: lm > 0 ? "#9C6F1E" : M.ink, fontWeight: 600 }}>In {hhmm(r.clockIn)}</span> · Out {hhmm(r.clockOut)}
                  </span>
                  {lm > 0 ? <span style={{ display: "inline-flex", alignItems: "center", height: 18, marginTop: 4, padding: "0 7px", borderRadius: 999, background: tint("#C9A24B", 24), color: "#85600F", fontSize: 10.5, fontWeight: 700 }}>{lm}m late</span> : null}
                </span>
                <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: tint(LOC_TONE[lc], 13), color: LOC_TONE[lc], fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>{LOC_LABEL[lc]}</span>
                <ChevronRight size={16} strokeWidth={2} color="#B5AC9C" aria-hidden="true" style={{ flex: "none" }} />
              </div>
            );
          })}
        </div>
      )}
      {absent.length ? (
        <>
          <div style={{ ...capsLabel("#9A3A2D"), paddingTop: 16 }}>NOT IN · {absent.length}</div>
          <div style={box}>
            {absent.map((w, i) => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: i ? `1px solid ${ROW_DIV}` : "none" }}>
                <span style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", background: "#9A3A2D" }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{w.name}</span>
                <span style={{ flex: "none", fontSize: 12, color: M.ink }}>{w.dept ? deptName(w.dept) : ""}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <MorePill label="Open Attendance in Employees" onClick={() => { m.close(); navigate(link); }} top={14} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, margin: "12px 4px 0", fontSize: 11.5, lineHeight: 1.45, color: "#9C6F1E" }}>
        <Info size={14} strokeWidth={2} aria-hidden="true" style={{ flex: "none", marginTop: 1.5 }} />
        <span>Attendance is read-only, as on desktop. Tap a photo to view the punch selfie.</span>
      </div>
      <AttendanceDetail row={detail} onClose={() => (photo ? undefined : setDetail(null))} onViewPhotos={(w) => detail && openPhoto(detail, w)} />
      {photo ? <PunchPhotoViewer target={photo.target} which={photo.which} onWhich={(w) => setPhoto({ ...photo, which: w })} onClose={() => setPhoto(null)} /> : null}
    </>
  );
}
