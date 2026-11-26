// Style helpers of the Home Operations v3 Output & Cost cards (kept out of ops-oc-kit.tsx so that file only exports components).
import { M } from "../../theme";

/** A tone colour mixed into the card surface, so tints follow dark mode. */
export const mixInto = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, ${M.card})`;
/** The cream header strip / total row of the design's tables (#F4EFE6 in light mode). */
export const CREAM = `color-mix(in srgb, #C9A961 14%, ${M.card})`;
/** The light off-white row of the design's tables (#FAF8F4 in light mode). */
export const PAPER_ROW = `color-mix(in srgb, #C9A961 5%, ${M.card})`;
/** Hairline colour of the design's table rows. */
export const ROW_LINE = `color-mix(in srgb, ${M.raisin} 8%, ${M.card})`;
export const OCHRE = "#9C6F1E";
