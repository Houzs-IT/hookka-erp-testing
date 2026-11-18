// ---------------------------------------------------------------------------
// Board Report action titles (owner 2026-11-19, batch 2 of the investment-bank
// standard): a chart's title states its conclusion — "Revenue RM 463k in
// Oct 26, +24.7% on Sep 26, 0.4% below forecast" — and the old descriptive
// title becomes the small label under it. Worked out from the same points the
// chart draws, so the sentence can never disagree with the picture. Money in sen.
// ---------------------------------------------------------------------------
import { rmShort } from "./format";

export type HeadPoint = { label: string; value: number | null | undefined; forecast?: number | null; actual: boolean };

const rmS = (sen: number) => `RM ${rmShort(Math.abs(sen))}`;
const pctAbs = (p: number) => `${Math.abs(p).toFixed(1)}%`;

/** Change of `cur` on `base` in % (null when the base is missing or zero). */
export const changeOn = (cur: number, base: number | null | undefined): number | null =>
  base === null || base === undefined || base === 0 ? null : ((cur - base) / Math.abs(base)) * 100;

/**
 * "<Name> RM x in <month>, +y% on <prev month>, z% above/below forecast".
 * The month is the LAST actual point. `lossName` replaces the name when the
 * value is negative ("Net loss RM 106k in Aug 26"). Null when there is no actual.
 */
export function trendHeadline(name: string, points: HeadPoint[], opts: { lossName?: string } = {}): string | null {
  const actual = points.filter((p) => p.actual && typeof p.value === "number");
  const cur = actual[actual.length - 1];
  if (!cur || typeof cur.value !== "number") return null;
  const v = cur.value;
  const prev = actual[actual.length - 2];
  const parts = [`${v < 0 && opts.lossName ? opts.lossName : name} ${rmS(v)} in ${cur.label}`];
  if (prev && typeof prev.value === "number") {
    const c = changeOn(v, prev.value);
    if (c !== null && Math.abs(c) < 1000) parts.push(`${c >= 0 ? "+" : "−"}${pctAbs(c)} on ${prev.label}`);
  }
  if (typeof cur.forecast === "number" && cur.forecast !== 0) {
    const g = changeOn(v, cur.forecast);
    if (g !== null && Math.abs(g) < 1000) parts.push(Math.abs(g) < 0.05 ? "on forecast" : `${pctAbs(g)} ${g > 0 ? "above" : "below"} forecast`);
  }
  return parts.join(", ");
}

/** "Cash fell RM 2k in Oct 26: operating −45k, investing −13k, financing +58k". */
export function cashHeadline(label: string, m: { operating: number; investing: number; financing: number; net: number }): string {
  const s = (v: number) => `${v < 0 ? "−" : "+"}${rmShort(Math.abs(v))}`;
  const verb = m.net === 0 ? "was flat" : m.net > 0 ? `rose ${rmS(m.net)}` : `fell ${rmS(m.net)}`;
  return `Cash ${verb} in ${label}: operating ${s(m.operating)}, investing ${s(m.investing)}, financing ${s(m.financing)}`;
}

/** "Equity RM 110k at Oct 26 month end, +RM 40k on Sep 26". */
export function equityHeadline(points: { label: string; equity: number }[]): string | null {
  const cur = points[points.length - 1];
  if (!cur) return null;
  const prev = points[points.length - 2];
  const base = `Equity ${cur.equity < 0 ? "−" : ""}${rmS(cur.equity)} at ${cur.label} month end`;
  if (!prev) return base;
  const d = cur.equity - prev.equity;
  return `${base}, ${d >= 0 ? "+" : "−"}${rmS(d)} on ${prev.label}`;
}

/** "Forecast revenue RM 600k in Nov 26 rising to RM 680k by Dec 26". */
export function outlookHeadline(points: { label: string; sales: number | null }[]): string | null {
  const ps = points.filter((p): p is { label: string; sales: number } => typeof p.sales === "number");
  if (!ps.length) return null;
  const a = ps[0], b = ps[ps.length - 1];
  if (ps.length === 1) return `Forecast revenue ${rmS(a.sales)} in ${a.label}`;
  const verb = b.sales > a.sales ? "rising to" : b.sales < a.sales ? "easing to" : "holding at";
  return `Forecast revenue ${rmS(a.sales)} in ${a.label}, ${verb} ${rmS(b.sales)} by ${b.label}`;
}
