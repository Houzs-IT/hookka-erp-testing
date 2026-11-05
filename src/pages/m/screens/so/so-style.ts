// Inline styles shared by the Sales Order phone sheets (scan review + order editor). M.* tokens only.
import type { CSSProperties } from "react";
import { M, M_ACCENT } from "../../theme";
import { SHADOW_CARD, TNUM } from "../dashboard/home-style";

export const input = (flagged?: "missing" | "check"): CSSProperties => ({
  width: "100%", boxSizing: "border-box", marginTop: 5, height: 40, padding: "0 11px", fontFamily: "inherit", fontSize: 14, color: M.raisin, outline: "none", borderRadius: 10,
  border: `1px solid ${flagged === "missing" ? M_ACCENT.danger.fg : flagged === "check" ? M_ACCENT.warning.fg : M.border}`,
  backgroundColor: flagged === "missing" ? M_ACCENT.danger.bg : flagged === "check" ? M_ACCENT.warning.bg : M.card,
});
export const small: CSSProperties = { ...input(), height: 36, marginTop: 3, padding: "0 10px", fontSize: 13.5, textAlign: "right", ...TNUM };
export const card: CSSProperties = { backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_CARD };
export const primary: CSSProperties = { height: 44, border: "none", borderRadius: 12, backgroundColor: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" };
export const ghost: CSSProperties = { height: 44, border: `1px solid ${M.border}`, borderRadius: 12, backgroundColor: M.card, color: M.raisin, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" };
export const sectionLabel: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe };
export const miniLabel: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.muted };
