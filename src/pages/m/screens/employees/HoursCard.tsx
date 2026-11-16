// HoursCard — one worker's day, as in Employees 3.dc.html: name + day-total tag, punch in / out, then the Department /
// Category / Hours / Notes table. Read-only (no Edit / Delete). Used by the Working Hours list and its "View all" page.
// Every box in here may shrink (minWidth 0): a long note must be cut with an ellipsis, never widen the card past the screen.
import { Clock } from "lucide-react";
import { M } from "../../theme";
import { fmtHours } from "./employees-format";
import { INNER, TAG_TONE } from "./employees-styles";
import type { WhRow } from "./working-hours-model";

/** One worker's day, as in the HTML: name + day-total tag, punch in / out, then the department table. Read-only. */
export default function HoursCard({ r }: { r: WhRow }) {
  const tone = TAG_TONE[r.tag.tone];
  return (
    <div style={{ ...INNER, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.name}
        </span>
        <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {r.tag.label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums" }}>
        <Clock size={13} strokeWidth={2} color="#8B7A4E" />
        <span>Punch in / out</span>
        <span style={{ fontWeight: 700, color: M.raisin }}>
          {r.punchIn ?? "—"} → {r.punchOut ?? "—"}
        </span>
      </div>
      {r.segs.length > 1 ? <div style={{ fontSize: 11, color: M.muted, marginTop: 3 }}>Split the day’s hours across the departments</div> : null}

      <div style={{ marginTop: 8, borderRadius: 9, background: M.card, boxShadow: "inset 0 0 0 1px #EEE9E4", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) 46px", gap: 6, padding: "6px 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: M.muted, textTransform: "uppercase" }}>
          <span>Department</span>
          <span>Category</span>
          <span style={{ textAlign: "right" }}>Hours</span>
        </div>
        {r.segs.map((s, i) => (
          <div key={`${s.deptCode}-${s.category}-${i}`} style={{ padding: "6px 10px", borderTop: "1px solid #F0ECE9" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) 46px", gap: 6, alignItems: "center", fontSize: 12.5 }}>
              <span style={{ minWidth: 0, color: M.raisin, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.deptName}</span>
              <span style={{ minWidth: 0, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.category ? s.category.charAt(0) + s.category.slice(1).toLowerCase() : "n/a"}</span>
              <span style={{ textAlign: "right", fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{fmtHours(s.hours)} h</span>
            </div>
            <div style={{ fontSize: 11.5, color: s.notes ? M.raisin : M.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: M.muted }}>Notes:</span> {s.notes || "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
