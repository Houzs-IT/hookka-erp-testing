// Style constants of the Home Operations v3 glass cards (kept out of ops-glass.tsx so that file only exports components).
import type { CSSProperties } from "react";
import { G } from "./sales-glass";

/** Inner translucent panel of a card. */
export const panelStyle = (extra?: CSSProperties): CSSProperties => ({ ...G.panel, ...extra });

/** Row tone pills (days late / due). */
export const PILL = {
  red: { bg: "#FBE7E3", fg: "#9A3A2D" },
  amber: { bg: "#FAEFCB", fg: "#9C6F1E" },
  grey: { bg: "#F0ECE9", fg: "#6B5C32" },
} as const;
