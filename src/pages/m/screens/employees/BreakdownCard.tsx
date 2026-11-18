// BreakdownCard — one Daily Breakdown job card on Employee Performance (Employees 3.dc.html `ep.rows`): the product title with the
// "JC" tag INLINE right after it (so it follows the last word when the title wraps) and the real status pill top-aligned on the
// right, the parent product code under the title, then two columns: Date · Department, and Qty · Total JC Time (one date, as on
// desktop). Total JC Time is the card's full duration. A shared job adds "Credited time" (this worker's half, with a ½ marker) on a
// third row. Shared by the section and the "View all" page.
import { SHEET_CARD } from "./employees-styles";
import { fmtHM } from "./efficiency-model";
import { breakdownStats, type BreakdownRow } from "./employee-performance-model";
import { M } from "../../theme";

const STATUS_TONE = {
  COMPLETED: { bg: "#EEF3E4", fg: "#3D6229" },
  TRANSFERRED: { bg: "#E0EDF0", fg: "#3E6570" },
  OTHER: { bg: "#F0ECE9", fg: "#4D4630" },
} as const;

const dmy = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd);

/**
 * The title split so the JC tag can never be left alone on a line: the LAST word (when it is short enough to keep unbroken) and
 * the tag are one unbreakable unit, so a wrapping title ends "… PC151-01 JC".
 */
function splitTitle(title: string): { head: string; tail: string } {
  const i = title.search(/\S+$/);
  const tail = title.slice(i);
  return i > 0 && tail.length <= 24 ? { head: title.slice(0, i), tail } : { head: "", tail: title };
}

export default function BreakdownCard({ r }: { r: BreakdownRow }) {
  const tone = STATUS_TONE[r.status];
  const { head, tail } = splitTitle(r.primary);
  return (
    <article style={{ ...SHEET_CARD, padding: "12px 14px" }} aria-label={`${r.primary}, ${r.statusLabel}`}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", minWidth: 0, fontSize: 13.5, fontWeight: 700, color: M.raisin, overflowWrap: "anywhere" }}>
            {head}
            <span style={{ whiteSpace: "nowrap" }}>
              {tail}
              <span style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle", position: "relative", top: -2, height: 16, marginLeft: 6, padding: "0 4px", borderRadius: 3, background: "#E0EDF0", color: "#3E6570", fontSize: 10, fontWeight: 700, lineHeight: 1 }}>JC</span>
            </span>
          </span>
          {r.secondary ? <span style={{ display: "block", fontSize: 11, color: "#6B7280", marginTop: 1 }}>{r.secondary}</span> : null}
        </span>
        <span style={{ flex: "none", alignSelf: "flex-start", marginTop: -1, height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{r.statusLabel}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 10px", marginTop: 10, padding: "9px 10px", borderRadius: 10, background: "#FAF8F4" }}>
        {breakdownStats(r).map((c) => (
          <div key={c.k} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.2, color: "#9A9082", whiteSpace: "nowrap" }}>{c.k}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", gap: 5 }}>
              {c.kind === "date" ? (
                dmy(c.v)
              ) : c.kind === "text" ? (
                c.v
              ) : c.kind === "minutes" ? (
                c.minutes > 0 ? fmtHM(c.minutes) : "—"
              ) : (
                <>
                  <span>{c.minutes > 0 ? fmtHM(c.minutes) : "—"}</span>
                  <span title={`Shared with a partner — this worker's half of ${fmtHM(r.totalMin)}`} aria-label="Shared job, half credited" style={{ flex: "none", height: 16, display: "inline-flex", alignItems: "center", padding: "0 4px", borderRadius: 3, background: "#FAEFCB", color: "#9C6F1E", fontSize: 10, fontWeight: 700 }}>
                    ½
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
