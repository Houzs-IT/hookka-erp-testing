// AttendanceSection — Employees → Attendance (Employees 3.dc.html), view-only (HK-0125 Phase 2).
//
// A date chip (default today in Malaysia, past dates allowed), the location chips (All · At factory · Off-site · No GPS,
// each with its count) and one row per punch: In / Out photo buttons, name, "In hh:mm · Out hh:mm" and a location pill.
// The row badge, the chip counts and the filtered list all use ONE rule (attendance-location.ts: Off-site = either punch
// outside the factory fence). The Overview's month-to-date "Attendance exceptions" link (Phase 3) opens the same screen
// with `loc=offsite&afrom&ato`; the active range is shown in a banner. No distance is shown (desktop shows none).
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, CameraOff, ChevronRight, UserRound } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { todayYmdMY } from "@/lib/utils";
import { M } from "../../theme";
import AttendanceDetail from "./AttendanceDetail";
import DatePickButton from "./DatePickButton";
import {
  ATT_PARAMS,
  attendanceUrl,
  groupAttendance,
  parseAttendanceParams,
  periodLabel,
  punchRows,
  type AttRow,
} from "./attendance-model";
import { LOC_LABEL, filterByLoc, locCounts, rowLocation, type LocFilter, type RowLoc } from "./attendance-location";
import { MIN_DATE } from "./employees-dates";
import { CARD, TONE } from "./employees-styles";
import PunchPhotoViewer, { type PunchPhotoTarget } from "./PunchPhotoViewer";
import { rowsOf } from "./time-adjustments-model";
import { useCanReadAttendance } from "./use-time-adjustments";

const CHIPS: { key: LocFilter; label: string; dot: string | null }[] = [
  { key: "all", label: "All", dot: null },
  { key: "factory", label: "At factory", dot: TONE.green.dot },
  { key: "offsite", label: "Off-site", dot: TONE.red.dot },
  { key: "nogps", label: "No GPS", dot: TONE.grey.dot },
];
const PILL: Record<RowLoc, { bg: string; fg: string }> = {
  factory: TONE.green,
  offsite: TONE.red,
  nogps: TONE.grey,
};

export default function AttendanceSection() {
  const [params, setParams] = useSearchParams();
  const today = todayYmdMY();
  const { period, loc } = parseAttendanceParams((k) => params.get(k), today);
  const allowed = useCanReadAttendance();
  const { data, loading, error } = useCachedJson<unknown>(allowed ? attendanceUrl(period) : null, 60);
  const [photo, setPhoto] = useState<{ target: PunchPhotoTarget; which: "in" | "out" } | null>(null);
  const [detail, setDetail] = useState<AttRow | null>(null);

  const rows = punchRows(rowsOf<AttRow>(data));
  const counts = locCounts(rows);
  const shown = filterByLoc(rows, loc);
  const groups = groupAttendance(shown);

  const setParam = (key: (typeof ATT_PARAMS)[number], value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const pickDay = (d: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("afrom");
        next.delete("ato");
        if (d && d !== today) next.set("adate", d);
        else next.delete("adate");
        return next;
      },
      { replace: true },
    );

  const openPhoto = (r: AttRow, which: "in" | "out") =>
    setPhoto({
      which,
      target: { id: r.id, name: r.employeeName, clockIn: r.clockIn, clockOut: r.clockOut, hasIn: !!r.hasClockInPhoto, hasOut: !!r.hasClockOutPhoto },
    });

  const isRange = period.kind === "range";
  const dayValue = period.kind === "day" ? period.date : period.to;
  const label = periodLabel(period);

  if (!allowed) {
    return (
      <div role="status" style={{ ...CARD, margin: "14px 18px 0", padding: 18, fontSize: 13, color: M.ink, textAlign: "center" }}>
        You don't have access to attendance.
      </div>
    );
  }

  const where = isRange ? "in this period" : `on ${label}`;
  const emptyText = loc !== "all" ? `No ${LOC_LABEL[loc as RowLoc].toLowerCase()} punches ${where}.` : `No punches ${where}.`;

  return (
    <>
      {isRange ? (
        <div role="status" style={{ margin: "12px 18px 0", padding: "10px 12px", borderRadius: 12, background: "#F4EFE6", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: M.raisin, lineHeight: 1.35 }}>
            <b style={{ fontWeight: 700 }}>Showing {label}</b>
            {loc !== "all" ? <div style={{ color: M.ink }}>{LOC_LABEL[loc as RowLoc]} only</div> : null}
          </div>
          <button
            type="button"
            onClick={() => setParams((prev) => { const n = new URLSearchParams(prev); n.delete("afrom"); n.delete("ato"); n.delete("adate"); return n; }, { replace: true })}
            style={{ flex: "none", height: 30, padding: "0 12px", border: "none", borderRadius: 999, background: M.card, boxShadow: "inset 0 0 0 1px #E6E0D9", color: "#6B5C32", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            Back to today
          </button>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "14px 18px 4px", scrollbarWidth: "none" }}>
        {CHIPS.map((c) => {
          const on = loc === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => setParam("loc", c.key === "all" ? null : c.key)}
              style={{
                flex: "none",
                height: 34,
                padding: "0 13px",
                borderRadius: 999,
                border: "none",
                background: on ? M.taupe : M.card,
                color: on ? "#FFFFFF" : M.ink,
                boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06), 0 4px 10px -6px rgba(31,29,27,.16)",
                fontFamily: "inherit",
                fontSize: 12.5,
                fontWeight: on ? 700 : 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              {c.dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.dot }} /> : null}
              {c.label}
              <span style={{ opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>{counts[c.key]}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 22px 8px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, textTransform: "uppercase" }}>{shown.length} · Punches</span>
        <DatePickButton
          value={dayValue}
          min={MIN_DATE}
          max={today}
          onPick={pickDay}
          ariaLabel={`Date: ${label}. Change date`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 999, background: isRange ? "#F4EFE6" : M.card, boxShadow: "inset 0 0 0 1px #E6E0D9", color: M.raisin, fontSize: 12.5, fontWeight: 600, maxWidth: "100%" }}
        >
          <CalendarDays size={14} strokeWidth={2} color="#6B5C32" />
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        </DatePickButton>
      </div>

      {data === null && loading ? <Status>Loading punches…</Status> : null}
      {data === null && !loading && error ? <Status>Couldn't load punches.</Status> : null}
      {data !== null && shown.length === 0 ? <Status>{emptyText}</Status> : null}

      {groups.map((g) => (
        <div key={g.date}>
          {isRange ? (
            <div style={{ padding: "6px 22px 6px", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: M.taupe, textTransform: "uppercase" }}>{g.title}</div>
          ) : null}
          <div style={{ ...CARD, margin: "0 18px 10px", boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)" }}>
            {g.rows.map((r, i) => (
              <PunchRow key={r.id} r={r} first={i === 0} onDetail={() => setDetail(r)} onOpen={(which) => openPhoto(r, which)} />
            ))}
          </div>
        </div>
      ))}

      {/* While the photo viewer is open the sheet stays underneath; Esc / Close return to it. */}
      <AttendanceDetail row={detail} onClose={() => (photo ? undefined : setDetail(null))} onViewPhotos={(w) => detail && openPhoto(detail, w)} />

      {photo ? (
        <PunchPhotoViewer target={photo.target} which={photo.which} onWhich={(w) => setPhoto({ ...photo, which: w })} onClose={() => setPhoto(null)} />
      ) : null}
    </>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" style={{ ...CARD, margin: "0 18px", padding: 22, textAlign: "center", fontSize: 13, color: M.ink }}>
      {children}
    </div>
  );
}

function PunchRow({ r, first, onDetail, onOpen }: { r: AttRow; first: boolean; onDetail: () => void; onOpen: (w: "in" | "out") => void }) {
  const loc = rowLocation(r);
  const pill = PILL[loc];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${r.employeeName}, in ${r.clockIn ?? "none"}, out ${r.clockOut ?? "none"}, ${LOC_LABEL[loc]}. Open details`}
      onClick={onDetail}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onDetail();
        }
      }}
      style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "10px 14px", borderTop: first ? "none" : "1px solid #F0ECE9", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      <span style={{ flex: "none", display: "flex", gap: 6 }}>
        <Thumb label="In" has={!!r.hasClockInPhoto} src={`/api/attendance/${encodeURIComponent(r.id)}/photo?which=in`} onClick={() => onOpen("in")} />
        <Thumb label="Out" has={!!r.hasClockOutPhoto} src={`/api/attendance/${encodeURIComponent(r.id)}/photo?which=out`} onClick={() => onOpen("out")} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.employeeName || r.employeeId}
        </span>
        <span style={{ display: "block", fontSize: 12.5, color: M.ink, marginTop: 3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          In {r.clockIn ?? "—"} · Out {r.clockOut ?? "—"}
        </span>
      </span>
      <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: pill.bg, color: pill.fg, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
        {LOC_LABEL[loc]}
      </span>
      <ChevronRight size={16} strokeWidth={2} color="#B5AC9C" style={{ flex: "none", marginLeft: -4 }} />
    </div>
  );
}

/**
 * The punch selfie as a 38px circle that opens the viewer. The image comes from the existing photo endpoint, lazily (only
 * rows scrolled near the screen load theirs) and the endpoint is cacheable for a day. A row with no photo shows the
 * camera-off circle; a photo that fails to load falls back to the person icon.
 */
function Thumb({ label, has, src, onClick }: { label: string; has: boolean; src: string; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={has ? `View punch-${label.toLowerCase()} photo` : `No punch-${label.toLowerCase()} photo`}
      style={{ border: "none", background: "none", padding: 0, fontFamily: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}
    >
      <span
        style={{ width: 38, height: 38, borderRadius: "50%", overflow: "hidden", background: has ? "linear-gradient(160deg,#D9CFBF,#B9AC97)" : "#E6E0D9", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}
      >
        {has && !failed ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : has ? (
          <UserRound size={19} strokeWidth={1.6} />
        ) : (
          <CameraOff size={19} strokeWidth={1.6} />
        )}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: M.muted, lineHeight: 1 }}>{label}</span>
    </button>
  );
}
