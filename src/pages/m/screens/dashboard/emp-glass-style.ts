// Style constants and helpers of the Home Employees v3 glass pieces (kept out of emp-glass.tsx so that file only exports
// components). Tints are the tone colour mixed into the card surface, so they follow dark mode.
import { M } from "../../theme";
import { CREAM, PAPER_ROW } from "./ops-oc-style";

/** A colour mixed into the card surface. */
export const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, ${M.card})`;
export const tint = mix;
export type Tone = { fg: string; bg: string };
export const TONES = {
  blue: { fg: "#2B5797", bg: "#E4ECF6" },
  taupe: { fg: "#6B5C32", bg: "#F4EFE6" },
  green: { fg: "#4F7C3A", bg: "#EEF3E4" },
  amber: { fg: "#9C6F1E", bg: "#FBF3DC" },
  red: { fg: "#9A3A2D", bg: "#FBE7E3" },
} as const;
/** Row washes of the design (green top rows, red bottom rows, red non-production rows). */
export const WASH = { green: mix("#4F7C3A", 7), red: mix("#9A3A2D", 8) };
export const RAIL = { green: "#4F7C3A", red: "#9A3A2D" };
export const TOTAL_BG = PAPER_ROW;

/** Gold / silver / bronze rank badge of the ranking tables; plain cream after the third. */
export function medal(n: number): { bg: string; fg: string; sh: string } {
  if (n === 1) return { bg: "linear-gradient(145deg,#F3D77A,#C9A24B)", fg: "#5A4510", sh: "inset 0 1px 0 rgba(255,255,255,.6),0 3px 8px -3px rgba(201,162,75,.8)" };
  if (n === 2) return { bg: "linear-gradient(145deg,#E6E8EC,#B4B9C1)", fg: "#3D434B", sh: "inset 0 1px 0 rgba(255,255,255,.7),0 3px 8px -3px rgba(120,126,135,.7)" };
  if (n === 3) return { bg: "linear-gradient(145deg,#E9C2A0,#B9824F)", fg: "#4A2E14", sh: "inset 0 1px 0 rgba(255,255,255,.5),0 3px 8px -3px rgba(185,130,79,.7)" };
  return { bg: CREAM, fg: M.taupe, sh: "none" };
}
