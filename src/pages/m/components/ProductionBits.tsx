// Small presentational pieces shared by the phone Production Orders list and
// detail (Claude Design "Production Orders v3", owner 2026-10-29).
import { M, titleCaseStatus } from "../theme";
import { statusTint } from "../lib/production-ui";

/** Status pill used on the card (22px, 6px dot). */
export function StatusDotPill({ hex, label }: { hex: string; label: string }) {
  const tint = statusTint(hex);
  return (
    <span
      style={{
        flexShrink: 0,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "0 9px",
        borderRadius: 9999,
        backgroundColor: tint.bg,
        color: tint.fg,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: tint.fg }} />
      {titleCaseStatus(label)}
    </span>
  );
}

/** "LABEL" with the 14x3 gold dash used on the summary and department cards. */
export function DashLabel({ children }: { children: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1,
        color: M.taupe,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 14, height: 3, flex: "none", borderRadius: 2, backgroundColor: M.gold }} />
      {children}
    </span>
  );
}
