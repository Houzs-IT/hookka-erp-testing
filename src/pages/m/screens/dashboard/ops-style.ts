// Style constants of the /m Home Operations view (kept out of ops-ui.tsx so that file only exports components).
// Source of truth: the approved Home Operations HTML (colours, sizes, shadows). Neutral text and surfaces use the
// M.* tokens (they equal the HTML's hexes in light mode and follow the dark theme); status and category colours are
// the HTML's fixed hexes.
import type { CSSProperties } from "react";
import { M } from "../../theme";

/** Bedframe / Sofa category colours (HTML C_BF / C_SF). */
export const CAT = { bedframe: "#1F4654", sofa: "#8A6A3B" } as const;

/** Status colours of the HTML. */
export const C = {
  danger: "#9A3A2D", dangerBg: "#FBE7E3", warn: "#9C6F1E", warnBg: "#FAEFCB", warnFg: "#85600F", warnInk: "#3A352C",
  ok: "#4F7C3A", okBg: "#EEF3E4", live: "#4B7A52", liveBg: "#EEF3EE", teal: "#3E6570", tealBg: "#E0EDF0",
  chevron: "#B5AC9C", chevronGold: "#8B7A4E", amberTagFg: "#9A7B2E", amberTagBg: "#FBF3E2",
  gaugeRed: "#9A3A2D", gaugeAmber: "#9C6F1E", gaugeGreen: "#4F7C3A",
  neutralRail: "#C9BFAE", neutralPill: "#F0ECE9",
} as const;

export const TAG_STYLE = {
  live: { bg: C.liveBg, fg: C.live },
  own: { bg: "#F4EFE6", fg: "#6B5C32" },
  warn: { bg: C.amberTagBg, fg: C.amberTagFg },
  info: { bg: "#EEF1F4", fg: "#5B6675" },
} as const;

/** Department Revenue dot / bar colours (HTML DV_DEPTS), keyed by the API's department code. */
export const DEPT_COLOR: Record<string, string> = {
  FAB_CUT: "#5C5230", FAB_SEW: "#C9A961", WOOD_CUT: "#8A6A3B", FOAM_CUTTING: "#4F7C3A", FOAM_CUT: "#4F7C3A", FOAM: "#3E6570",
  FIBRE: "#9A3A2D", FRAMING: "#6B4A6D", WEBBING: "#C0652A", UPHOLSTERY: "#1F1D1B", PACKING: "#A8A196",
};
export const deptColor = (code: string): string => DEPT_COLOR[code] ?? "#A8A196";

export const SHADOW_SECTION = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
export const SHADOW_TILE = "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)";
export const SHADOW_ACTIVE = "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)";
export const SHADOW_CHIP_ON = "0 6px 14px -6px rgba(107,92,50,.6)";

/** HTML chipS / segS. */
export const chipStyle = (on: boolean) => ({
  bg: on ? M.taupe : M.card, fg: on ? "#FFFFFF" : "#3A352C", shadow: on ? SHADOW_CHIP_ON : SHADOW_TILE, weight: on ? 700 : 600,
});
export const segStyle = (on: boolean) => ({ bg: on ? M.card : "transparent", fg: on ? M.raisin : M.ink, shadow: on ? SHADOW_ACTIVE : "none", weight: on ? 700 : 600 });

export const searchInput: CSSProperties = { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 14, color: M.raisin };

/** White rounded card of a sheet body (HTML: radius 16, section shadow). */
export const sheetCard: CSSProperties = { backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_SECTION };
