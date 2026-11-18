// ---------------------------------------------------------------------------
// Board Report charts — small hand-drawn SVG, not recharts: a printed A4 page
// needs a chart that is exactly the size of the box it sits in, renders the
// same on screen and in print, and does not resize itself mid-print. Each
// page has ONE elastic chart (<Elastic>), which takes whatever height is left
// on the page, so a page always fills to its footer and never overflows.
// Money in sen.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { C, PALETTE, pctText, rmShort } from "./format";

function niceStep(range: number, target = 5): number {
  if (range <= 0) return 1;
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** A box that takes the rest of the page's height and hands its pixel size to the chart. */
export function Elastic({ children, min = 120 }: { children: (w: number, h: number) => ReactNode; min?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="brp-elastic" style={{ minHeight: min }}>
      {size.w > 0 && size.h > 0 ? children(size.w, size.h) : null}
    </div>
  );
}

export type Series = { key: string; label: string; color: string; type: "bar" | "line"; stack?: string; dashed?: boolean };
export type Datum = { label: string; values: Record<string, number | null | undefined>; faded?: boolean; note?: string };

/** Bars (grouped or stacked by `stack`) with lines over them, a zero line and a legend. */
/** Every bar and line point carries its amount (owner 2026-11-18 「bar chart 数字都没有给」):
 *  a single bar's amount sits inside its top when the bar is tall enough (so it
 *  does not collide with a line point's label above it), else just above it; a
 *  stack writes each tall-enough segment inside and its total above; a line point
 *  writes its amount above the dot (below it when the dot sits in a bar's top, on that bar's amount) in the line's colour on a white halo (skipped
 *  where it equals the bar's amount, e.g. a forecast month drawn from the forecast).
 *  `labels={false}` turns all of it off. */
export function ComboChart({ data, series, w, h, legend = true, labels = true }: { data: Datum[]; series: Series[]; w: number; h: number; legend?: boolean; labels?: boolean }) {
  const legendH = legend ? 18 : 0;
  const pad = { l: 44, r: 8, t: 8 + legendH + (labels ? 14 : 0), b: 20 };
  const iw = Math.max(10, w - pad.l - pad.r);
  const ih = Math.max(10, h - pad.t - pad.b);
  const bars = series.filter((s) => s.type === "bar");
  const lines = series.filter((s) => s.type === "line");
  const stacks = [...new Set(bars.map((s) => s.stack ?? s.key))];
  let lo = 0, hi = 0;
  for (const d of data) {
    for (const st of stacks) {
      let pos = 0, neg = 0;
      for (const s of bars.filter((b) => (b.stack ?? b.key) === st)) {
        const v = d.values[s.key] ?? 0;
        if (v >= 0) pos += v; else neg += v;
      }
      hi = Math.max(hi, pos); lo = Math.min(lo, neg);
    }
    for (const s of lines) {
      const v = d.values[s.key];
      if (typeof v === "number") { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    }
  }
  if (hi === lo) hi = lo + 100;
  const step = niceStep(hi - lo);
  const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step;
  const y = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  const band = iw / Math.max(1, data.length);
  const groupW = band * 0.7;
  const barW = groupW / Math.max(1, stacks.length);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);
  // Label font follows the bar width so a 12-month grouped chart stays legible.
  const fs = barW >= 34 ? 9.5 : barW >= 22 ? 8.5 : 7.5;
  const showBarLabels = labels && barW >= 14;
  const halo = { stroke: "#fff", strokeWidth: 3, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
  // Legend: each entry as wide as its text, not a fixed slot.
  const legendW = series.map((s) => 15 + s.label.length * 5.2 + 16);
  const legendPos = legendW.map((_, i) => pad.l + legendW.slice(0, i).reduce((t, x) => t + x, 0));
  return (
    <svg width={w} height={h} role="img" fontFamily="inherit">
      {legend && (
        <g fontSize={9} fill={C.muted}>
          {series.map((s, i) => (
            <g key={s.key} transform={`translate(${legendPos[i]},6)`}>
              {s.type === "bar" ? <rect width={9} height={9} rx={2} fill={s.color} /> : <line x1={0} x2={12} y1={5} y2={5} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "4 3" : undefined} />}
              <text x={15} y={8.5}>{s.label}</text>
            </g>
          ))}
        </g>
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.light : C.grid} strokeDasharray={t === 0 ? undefined : "2 3"} />
          <text x={pad.l - 4} y={y(t) + 3} fontSize={9} textAnchor="end" fill={C.muted}>{rmShort(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x0 = pad.l + i * band + (band - groupW) / 2;
        return (
          <g key={d.label} opacity={d.faded ? 0.5 : 1}>
            {stacks.map((st, si) => {
              const members = bars.filter((b) => (b.stack ?? b.key) === st);
              const stacked = members.length > 1;
              const bx = x0 + si * barW + 1, bw = Math.max(1, barW - 2), cx = x0 + si * barW + barW / 2;
              let pos = 0, neg = 0;
              const segs = members.map((s) => {
                const v = d.values[s.key];
                if (typeof v !== "number" || v === 0) return null;
                const base = v >= 0 ? pos : neg;
                const top = base + v;
                if (v >= 0) pos = top; else neg = top;
                const ya = y(Math.max(base, top)), yb = y(Math.min(base, top));
                const hgt = Math.max(0.5, yb - ya);
                // Single bar: amount inside the top when there is room, else outside.
                const inside = hgt >= fs + 8;

                const label = !showBarLabels ? null
                  : stacked
                    ? (hgt >= fs + 6 && bw >= 26 ? <text x={cx} y={(ya + yb) / 2 + fs / 3} fontSize={fs - 0.5} textAnchor="middle" fill="#fff">{rmShort(v)}</text> : null)
                    : inside
                      ? <text x={cx} y={v >= 0 ? ya + fs + 3 : yb - 5} fontSize={fs} fontWeight={600} textAnchor="middle" fill="#fff">{rmShort(v)}</text>
                      : <text x={cx} y={v >= 0 ? ya - 3 : yb + fs + 2} fontSize={fs} fontWeight={600} textAnchor="middle" fill={C.ink}>{rmShort(v)}</text>;
                return (
                  <g key={s.key}>
                    <rect x={bx} y={ya} width={bw} height={hgt} rx={stacked ? 0 : Math.min(2.5, bw / 4)} fill={s.color} />
                    {label}
                  </g>
                );
              });
              const total = pos + neg;
              return (
                <g key={st}>
                  {segs}
                  {showBarLabels && stacked && total !== 0 && (
                    <text x={cx} y={pos > 0 ? y(pos) - 3 : y(neg) + fs + 2} fontSize={fs} fontWeight={700} textAnchor="middle" fill={C.ink}>{rmShort(total)}</text>
                  )}
                </g>
              );
            })}
            <text x={pad.l + i * band + band / 2} y={h - 6} fontSize={9} textAnchor="middle" fill={d.faded ? C.muted : C.ink}>{d.label}</text>
          </g>
        );
      })}
      {lines.map((s) => {
        // A point just inside a bar's top would sit on the bar's own amount: label it below the dot.
        const underTop = (d: Datum, v: number) => bars.some((b) => {
          const bv = d.values[b.key];
          if (typeof bv !== "number" || bv <= 0) return false;
          const ya = y(bv), ly = y(v);
          return ly >= ya + 8 && ly <= ya + 2 * fs + 12;
        });
        const pts = data.map((d, i) => ({ x: pad.l + i * band + band / 2, v: d.values[s.key], same: bars.some((b) => d.values[b.key] === d.values[s.key]), d })).filter((p): p is { x: number; v: number; same: boolean; d: Datum } => typeof p.v === "number");
        if (!pts.length) return null;
        return (
          <g key={s.key}>
            <polyline points={pts.map((p) => `${p.x},${y(p.v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
            {pts.map((p) => <circle key={p.x} cx={p.x} cy={y(p.v)} r={2.8} fill="#fff" stroke={s.color} strokeWidth={1.6} />)}
            {labels && pts.filter((p) => !p.same).map((p) => (
              <text key={`l${p.x}`} x={p.x} y={showBarLabels && underTop(p.d, p.v) ? y(p.v) + 13 : y(p.v) - 6} fontSize={8.5} fontWeight={600} textAnchor="middle" fill={s.color} {...halo}>{rmShort(p.v)}</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** A donut of shares with its legend beside it (fixed size). */
export function Donut({ items, size = 150, centre }: { items: { label: string; value: number }[]; size?: number; centre?: string }) {
  const total = items.reduce((t, x) => t + Math.max(0, x.value), 0);
  const r = size / 2 - 4, ri = r * 0.6, cx = size / 2, cy = size / 2;
  const fracs = items.map((it) => (total > 0 ? Math.max(0, it.value) / total : 0));
  const arcs = items.map((it, i) => {
    const frac = fracs[i];
    const a0 = -Math.PI / 2 + fracs.slice(0, i).reduce((t, f) => t + f, 0) * Math.PI * 2;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
    const d = frac >= 0.9999
      ? `M ${p(0, r)} A ${r} ${r} 0 1 1 ${p(Math.PI, r)} A ${r} ${r} 0 1 1 ${p(0, r)} M ${p(0, ri)} A ${ri} ${ri} 0 1 0 ${p(Math.PI, ri)} A ${ri} ${ri} 0 1 0 ${p(0, ri)} Z`
      : `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, ri)} A ${ri} ${ri} 0 ${large} 0 ${p(a0, ri)} Z`;
    return { d, color: PALETTE[i % PALETTE.length], it, frac };
  });
  return (
    <div className="brp-donut">
      <svg width={size} height={size} role="img">
        {arcs.map((a) => <path key={a.it.label} d={a.d} fill={a.color} fillRule="evenodd" />)}
        {centre && <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.ink}>{centre}</text>}
      </svg>
      <ul>
        {arcs.map((a) => (
          <li key={a.it.label}>
            <span className="sw" style={{ background: a.color }} />
            <span className="lb">{a.it.label}</span>
            <span className="vl">{(a.frac * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal share bars as plain HTML (fixed rows; the list is capped upstream). */
export function ShareBars({ rows, color = C.navy }: { rows: { label: string; value: number; pct: number | null }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="brp-sharebars">
      {rows.map((r) => (
        <div key={r.label} className="row">
          <span className="lb">{r.label}</span>
          <span className="bar"><span style={{ width: `${Math.max(0, (r.value / max) * 100)}%`, background: color }} /></span>
          <span className="vl">{pctText(r.pct)}</span>
        </div>
      ))}
    </div>
  );
}
