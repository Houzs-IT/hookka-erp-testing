// ---------------------------------------------------------------------------
// chart-standard.ts — THE house chart standard for every report and dashboard.
// Owner 2026-11-19 chose the Board Report look as the company standard
// (「各大种类的reporting有尽量standardise？」 → "用我刚做的 Board Report 新版").
// Every chart colour, forecast style and status colour comes from here; a page
// does not invent its own palette. Rules (financial-report practice):
//   - series colours in CAT order, never cycled; a 7th+ series folds into
//     "Other" in NEUTRAL;
//   - green / red mean good / bad ONLY (STATUS) — never a series colour;
//   - a forecast is hatched/hollow (bars) or dashed FORECAST ink (lines);
//   - amounts are selective, outside the bar end, in ink — never in a series colour.
// The palette passed the dataviz validator (lightness band, chroma floor,
// colour-blind separation, normal-vision floor).
// ---------------------------------------------------------------------------

/** Series colours, in fixed order. */
export const CAT = ["#2B5797", "#D19A32", "#1F9E89", "#8E5DB5", "#4FA3D9", "#B5651D"] as const;
/** "Other" / folded series. */
export const NEUTRAL = "#8A8F98";
/** A forecast line: neutral ink, dashed. */
export const FORECAST = "#5B6270";
export const FORECAST_DASH = "4 4";
/** Good / bad — for deltas, flags and ranks, never for a series. */
export const STATUS = { good: "#1B7F5A", bad: "#B4233C" } as const;
/** Brand: page chrome only (titles, rules, kicker). */
export const BRAND = { navy: "#13294B", gold: "#B7862C" } as const;
/** Text and chart furniture. */
export const INK = { text: "#1F2430", muted: "#6B7280", axis: "#C9CED6", grid: "#E6E8EC" } as const;
/** The one face for reports — bundled (finance-v2.css), so screen and PDF match. */
export const REPORT_FONT = `"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

/** Colour of the i-th series (fixed order; past the palette → NEUTRAL). */
export const seriesColor = (i: number): string => (i < CAT.length ? CAT[i] : NEUTRAL);
