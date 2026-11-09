// Shared colours / shadows for the Service Cases screens. Values are the Phase 4 prototype's
// (Service Cases Phase 4.dc.html); surfaces and text use the M.* theme variables, whose
// light-mode values are the same hexes (raisin #1F1D1B, taupe #6B5C32, paper #FAF8F4,
// card #FFFFFF, ink #4D4630, muted #9A9082), so dark mode keeps working.
import type { CSSProperties } from "react";
import { M } from "../../theme";

export const CC = {
  brown: "#6B5C32",
  brownSoft: "#8B7A4E",
  track: "#E2DDD8",
  trackMap: "#EDE7DD",
  danger: "#9A3A2D",
  dangerDark: "#7A2E24",
  neutralDays: "#6B7280",
  sep: "#F0ECE9",
  tile: "#F4EFE6",
  tileWarm: "#F0EAD8",
  linked: "#2F6E62",
  linkedLine: "#A9CCC3",
  warnBg: "#FAEFCB",
  warnFg: "#85600F",
  errBg: "#F5DCDC",
  hint: "#9A9082",
  chipText: "#3A352C",
} as const;

export const SH_CARD = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
export const SH_FIELD = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
export const SH_CTRL = "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)";
export const SH_ROUND = "0 1px 2px rgba(31,29,27,.06),0 6px 16px -8px rgba(31,29,27,.22)";
export const SH_ON = "0 6px 14px -6px rgba(107,92,50,.6)";
export const SH_PRIMARY = "0 8px 18px -10px rgba(107,92,50,.7)";
export const SH_SEG = "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)";
/** Kept for existing imports. */
export const CARD_SHADOW = SH_CARD;

/** Evidence/field container with an optional red ring. */
export const ringStyle = (bad: boolean): CSSProperties => (bad ? { boxShadow: "0 0 0 1.5px #C0574A" } : {});

/** White rounded input / textarea style (prototype fields). */
export const fieldStyle = (extra?: CSSProperties): CSSProperties => ({ width: "100%", boxSizing: "border-box", border: "none", borderRadius: 14, background: M.card, fontFamily: "inherit", fontSize: 16, color: M.raisin, outline: "none", boxShadow: SH_FIELD, ...extra });
