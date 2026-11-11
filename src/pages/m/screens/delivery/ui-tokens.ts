// ===========================================================================
// Style constants for the Delivery screens.
//
// Colours, shadows, radii and spacing: Claude Design `Delivery.dc.html` (the
// source of truth for every visual except type). Light-mode values are the
// prototype's hex via ./delivery-theme.css (--dl-*) or the M.* token that
// equals it. Typography: the committed /m Sales screens (sizes + weights) and
// the --m-type-* Foundation tokens — owner 2026-10-20, for one type system
// across mobile modules.
// ===========================================================================
import type { CSSProperties } from "react";
import { M, type SemanticStyle } from "../../theme";
import "./delivery-theme.css";

/** Prototype palette (CSS variables; see delivery-theme.css). */
export const DL = {
  track: "var(--dl-track)",
  body: "var(--dl-body)",
  icon: "var(--dl-icon)",
  ring: "var(--dl-ring)",
  disabled: "var(--dl-disabled)",
  noteBg: "var(--dl-note-bg)",
  tile: "var(--dl-tile)",
  line: "var(--dl-line)",
  dotRing: "var(--dl-dot-ring)",
  stepNum: "var(--dl-step-num)",
  linked: "var(--dl-linked)",
  linkedLine: "var(--dl-linked-line)",
  itemsBg: "var(--dl-items-bg)",
  itemsTitle: "var(--dl-items-title)",
  itemsRow: "var(--dl-items-row)",
  overlay: "var(--dl-overlay)",
} as const;

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Semantic hex (design-tokens maps) → the prototype's tone name. */
const TONE_BY_HEX: Record<string, Tone> = {
  "#6B7280": "neutral",
  "#3E6570": "info",
  "#4F7C3A": "success",
  "#9C6F1E": "warning",
  "#9A3A2D": "danger",
};

export function toneOf(style: SemanticStyle): Tone {
  return TONE_BY_HEX[style.hex] ?? "neutral";
}

/** Prototype PILL map: { bg, fg }. */
export function pill(tone: Tone): { bg: string; fg: string } {
  return { bg: `var(--dl-pill-${tone}-bg)`, fg: `var(--dl-pill-${tone}-fg)` };
}

/** Prototype HEX map (rails, dots, status icons). */
export function sem(tone: Tone): string {
  return `var(--dl-sem-${tone})`;
}

// Prototype shadows.
export const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 10px 24px -14px rgba(31,29,27,.22)";
export const SHADOW_SECTION = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)";
export const SHADOW_BLOCK = "0 1px 2px rgba(31,29,27,.05),0 10px 24px -14px rgba(31,29,27,.2)";
export const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
export const SHADOW_FIELD = "0 1px 2px rgba(31,29,27,.05),0 6px 18px -10px rgba(31,29,27,.18)";
export const SHADOW_MENU = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -12px rgba(31,29,27,.18)";
export const SHADOW_PRIMARY = "0 10px 22px -10px rgba(107,92,50,.7)";
export const SHADOW_SHEET_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65)";
export const SHADOW_SELECTED = "0 0 0 2px var(--m-taupe), 0 10px 24px -14px rgba(31,29,27,.22)";
export const SHADOW_CHIP = "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)";
export const SHADOW_CHIP_ON = "0 6px 14px -6px rgba(107,92,50,.6)";
export const SHADOW_SEGMENT_ON = "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)";
export const SHADOW_ROUND = "0 1px 2px rgba(31,29,27,.06),0 6px 16px -8px rgba(31,29,27,.22)";
export const SHADOW_RADIO_ON = "0 0 0 1.5px var(--m-taupe), 0 6px 16px -8px rgba(107,92,50,.45)";
export const SHADOW_BAR_TOP = `0 -1px 0 ${DL.line}, 0 -10px 24px -14px rgba(31,29,27,.18)`;

// Typography (Sales / Foundation).
export const T = {
  label: {
    fontSize: "var(--m-type-label-size)",
    fontWeight: "var(--m-type-label-weight)",
    letterSpacing: "var(--m-type-label-tracking)",
    lineHeight: "var(--m-type-label-line-height)",
  },
  meta: { fontSize: "var(--m-type-metadata-size)", lineHeight: "var(--m-type-metadata-line-height)" },
  body: { fontSize: "var(--m-type-description-size)", lineHeight: "var(--m-type-description-line-height)" },
  cardTitle: {
    fontSize: "var(--m-type-card-title-size)",
    fontWeight: 700,
    lineHeight: "var(--m-type-card-title-line-height)",
    letterSpacing: "var(--m-type-card-title-tracking)",
  },
} as const;

/** Prototype text-field surface: white, soft shadow, no border. */
export const INPUT: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 44,
  padding: "0 13px",
  border: "none",
  borderRadius: 12,
  background: M.card,
  fontFamily: "inherit",
  fontSize: 16,
  color: M.raisin,
  outline: "none",
  boxShadow: SHADOW_FIELD,
};
