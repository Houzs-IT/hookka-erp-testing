// Segmented switch + filter chip styles — the approved Claude Design handoff
// (owner 2026-10-21). One source for every /m screen that opts in: Home view
// switch (SegmentedSwitch variant="prominent"), Products ViewSwitch +
// category chips, Sales Orders status chips, Delivery section switch + stage
// chips. Other screens keep their own styles. Tokens only, so dark mode
// follows body[data-theme].
import type { CSSProperties } from "react";
import { M } from "../theme";

// ---- Segmented switch --------------------------------------------------------

/** Outer wrapper around the track (drop the sides when the parent already pads 18px). */
export const SEGMENT_WRAP: CSSProperties = { padding: "6px 18px 0" };

export function segmentTrack(n: number): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    gap: 4,
    height: 46,
    boxSizing: "border-box",
    padding: 4,
    borderRadius: 14,
    background: "var(--m-segment-track)",
  };
}

export function segmentButton(on: boolean): CSSProperties {
  return {
    minWidth: 0,
    height: "100%",
    padding: "0 8px",
    borderRadius: 10,
    border: "none",
    background: on ? M.card : "transparent",
    boxShadow: on ? "var(--m-shadow-segment-on)" : "none",
    color: on ? M.raisin : M.ink,
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: on ? 700 : 600,
    whiteSpace: "nowrap",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    WebkitTapHighlightColor: "transparent",
  };
}

/** Lucide icon props inside a segment. */
export const SEGMENT_ICON = { size: 15, strokeWidth: 1.9 } as const;

// ---- Filter chips ------------------------------------------------------------

/** Pair with CHIP_ROW_CLASS so the scrollbar is hidden on WebKit too. */
export const CHIP_ROW: CSSProperties = {
  display: "flex",
  gap: 8,
  overflowX: "auto",
  padding: "12px 18px 4px",
  scrollbarWidth: "none",
  WebkitOverflowScrolling: "touch",
};
export const CHIP_ROW_CLASS = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function chip(on: boolean): CSSProperties {
  return {
    flex: "none",
    height: 34,
    padding: "0 13px",
    borderRadius: 999,
    border: "none",
    background: on ? M.taupe : M.card,
    color: on ? "var(--m-text-on-accent)" : "var(--m-chip-text)",
    boxShadow: on ? "var(--m-shadow-chip-on)" : "var(--m-shadow-chip)",
    fontFamily: "inherit",
    fontSize: 12.5,
    fontWeight: on ? 700 : 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };
}

/** Count after the chip label. */
export const CHIP_COUNT: CSSProperties = { opacity: 0.8, fontVariantNumeric: "tabular-nums" };

/** Optional 7px status dot before the label. */
export function chipDot(color: string): CSSProperties {
  return { width: 7, height: 7, borderRadius: "50%", background: color, flex: "none" };
}
