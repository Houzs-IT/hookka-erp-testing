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

type SummaryTile = { label: string; value: number | null; prev: number | null; forecast: number | null };
/**
 * The cover's executive summary (owner 2026-11-19, batch 3): three or four
 * sentences a director can stop after — performance, cash, and what to watch.
 * Built only from figures printed elsewhere in the report.
 */
export function execSummary(o: {
  month: string;
  prevMonth: string;
  tiles: SummaryTile[];
  materials?: { name: string; spend: number; forecast: number | null }[];
  /** The month's materials used vs forecast — the SAME pair the page-4 chart
   *  headline uses, so the cover and page 4 quote one percentage. */
  materialsMonth?: { actual: number | null; forecast: number | null } | null;
  largest?: { name: string | null; pct: number | null } | null;
}): string[] {
  const out: string[] = [];
  const t = (l: string) => o.tiles.find((x) => x.label.toLowerCase().startsWith(l));
  const vs = (x: SummaryTile | undefined) => {
    if (!x || x.value === null) return [];
    const a: string[] = [];
    const c = changeOn(x.value, x.prev);
    if (c !== null && Math.abs(c) < 1000) a.push(`${c >= 0 ? "+" : "−"}${pctAbs(c)} on ${o.prevMonth}`);
    const g = changeOn(x.value, x.forecast);
    if (g !== null && Math.abs(g) < 1000) a.push(`${pctAbs(g)} ${g >= 0 ? "above" : "below"} forecast`);
    return a;
  };
  const rev = t("revenue"), np = t("net"), cash = t("cash");
  if (rev && rev.value !== null) {
    let s = `Revenue ${rmS(rev.value)}${vs(rev).length ? ` (${vs(rev).join(", ")})` : ""}`;
    if (np && np.value !== null) {
      const margin = rev.value ? ` — ${((np.value / rev.value) * 100).toFixed(1)}% margin` : "";
      s += `; ${np.value < 0 ? "net loss" : "net profit"} ${rmS(np.value)}${margin}${vs(np).length ? `, ${vs(np).join(", ")}` : ""}`;
    }
    out.push(`${s}.`);
  }
  if (cash && cash.value !== null) {
    const c = changeOn(cash.value, cash.prev);
    out.push(`Cash at bank ${cash.value < 0 ? "−" : ""}${rmS(cash.value)} at ${o.month} end${c !== null && Math.abs(c) < 1000 ? `, ${c >= 0 ? "+" : "−"}${pctAbs(c)} on ${o.prevMonth}` : ""}.`);
  }
  const mats = (o.materials ?? []).filter((m): m is { name: string; spend: number; forecast: number } => typeof m.forecast === "number" && m.forecast > 0);
  const mm = o.materialsMonth;
  if (mats.length && mm && typeof mm.actual === "number") {
    const g = changeOn(mm.actual, mm.forecast);
    if (g !== null && g >= 5) {
      const worst = [...mats].sort((a, b) => (b.spend - b.forecast) - (a.spend - a.forecast))[0];
      const wg = changeOn(worst.spend, worst.forecast);
      out.push(`Watch: raw materials ${pctAbs(g)} above forecast, led by ${worst.name.toLowerCase()} (+${rmS(worst.spend - worst.forecast)}${wg !== null ? `, +${pctAbs(wg)}` : ""}).`);
    }
  }
  if (o.largest && o.largest.name && o.largest.pct !== null && o.largest.pct >= 40) {
    out.push(`Watch: ${o.largest.name} is ${o.largest.pct.toFixed(0)}% of confirmed orders — a customer-concentration risk.`);
  }
  return out;
}
