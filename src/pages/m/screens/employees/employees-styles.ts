// employees-styles.ts — inline-style constants shared by the Employees sections (from Employees 3.dc.html).
import type { CSSProperties } from "react";
import { M } from "../../theme";

/** The white section card (Time adjustment requests, Daily working hours, lists). */
export const CARD: CSSProperties = {
  background: M.card,
  borderRadius: 16,
  boxShadow: "0 0 0 1px rgba(31,29,27,.04), 0 2px 4px rgba(31,29,27,.06), 0 14px 30px -14px rgba(31,29,27,.30)",
  overflow: "hidden",
};

/** A request / hours card inside a section card. */
export const INNER: CSSProperties = {
  padding: "11px 12px",
  borderRadius: 12,
  background: M.paper,
  boxShadow: "inset 0 0 0 1px #EEE9E4",
};

export const CARD_HEAD: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "13px 14px 10px" };
export const CARD_TITLE: CSSProperties = { flex: 1, fontSize: 14, fontWeight: 700, color: M.raisin };

export const COUNT_PILL: CSSProperties = {
  minWidth: 22,
  height: 22,
  boxSizing: "border-box",
  padding: "0 7px",
  borderRadius: 999,
  background: "#F4EFE6",
  color: "#6B5C32",
  fontSize: 11.5,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontVariantNumeric: "tabular-nums",
};
export const AMBER_PILL: CSSProperties = { ...COUNT_PILL, background: "#FAEFCB", color: "#85600F" };

export const LINK_BUTTON: CSSProperties = {
  width: "100%",
  height: 44,
  border: "none",
  borderTop: "1px solid #F0ECE9",
  background: "none",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 700,
  color: M.taupe,
  cursor: "pointer",
};

/** Tag / pill tints (fixed, like the status pills elsewhere in /m). */
export const TONE = {
  green: { bg: "#EEF3E4", fg: "#4F7C3A", dot: "#4F7C3A" },
  red: { bg: "#F6E2DE", fg: "#9A3A2D", dot: "#9A3A2D" },
  amber: { bg: "#FAEFCB", fg: "#85600F", dot: "#9C6F1E" },
  grey: { bg: "#F0ECE9", fg: "#4D4630", dot: "#B5AC9C" },
  teal: { bg: "#E0EDF0", fg: "#3E6570", dot: "#3E6570" },
} as const;

export const SEARCH_BOX: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 40,
  boxSizing: "border-box",
  padding: "0 11px",
  borderRadius: 10,
  background: M.card,
  boxShadow: "inset 0 0 0 1px #E6E0D9",
  display: "flex",
  alignItems: "center",
  gap: 8,
};
export const SEARCH_INPUT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  outline: "none",
  background: "transparent",
  fontFamily: "inherit",
  fontSize: 15,
  color: M.raisin,
  padding: 0,
};

/** The white rounded card inside the detail sheet (label / value rows, department table). */
export const SHEET_CARD: CSSProperties = {
  background: M.card,
  borderRadius: 16,
  boxShadow: "0 1px 2px rgba(31,29,27,.05), 0 12px 28px -16px rgba(31,29,27,.22)",
};

/** The day tag's tone (OT / short / full day) → its pill colours. */
export const TAG_TONE = { ot: TONE.amber, short: TONE.red, full: TONE.green } as const;
