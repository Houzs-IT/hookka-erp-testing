// ---------------------------------------------------------------------------
// Board Report charts — small hand-drawn SVG, not recharts: a printed A4 page
// needs a chart that is exactly the size of the box it sits in, renders the
// same on screen and in print, and does not resize itself mid-print. Each
// page has ONE elastic chart (<Elastic>), which takes whatever height is left
// on the page, so a page always fills to its footer and never overflows.
// Money in sen.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { C, CAT, pctText, rmShort } from "./format";
import { waterfallBars } from "./chart-math";

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

const STATUS_GOOD = C.green, STATUS_BAD = C.red;

/** A waterfall: an opening total, the steps that move it, a closing total
 *  (owner 2026-11-19: cash flow as opening bank -> operating -> investing ->
 *  financing -> closing bank). Totals in ink grey, rises green, falls red; each
 *  step labelled at its end; thin connectors carry the running level across. */
export function Waterfall({ steps, w, h }: { steps: { label: string; value: number; total?: boolean }[]; w: number; h: number }) {
  const pad = { l: 8, r: 8, t: 18, b: 34 };
  const iw = Math.max(10, w - pad.l - pad.r), ih = Math.max(10, h - pad.t - pad.b);
  const bars = waterfallBars(steps);
  const lo = Math.min(0, ...bars.flatMap((b) => [b.from, b.to])), hi = Math.max(0, ...bars.flatMap((b) => [b.from, b.to]));
  const span = hi - lo || 1;
  const y = (v: number) => pad.t + ih - ((v - lo) / span) * ih;
  const band = iw / Math.max(1, bars.length);
  const bw = Math.min(34, band * 0.56);
  return (
    <svg width={w} height={h} role="img" fontFamily="inherit">
      <line x1={pad.l} x2={pad.l + iw} y1={y(0)} y2={y(0)} stroke={C.light} />
      {bars.map((b, i) => {
        const x = pad.l + i * band + (band - bw) / 2;
        const ya = y(Math.max(b.from, b.to)), yb = y(Math.min(b.from, b.to));
        const fill = b.total ? "#5B6270" : b.value >= 0 ? STATUS_GOOD : STATUS_BAD;
        const next = bars[i + 1];
        const up = b.to >= b.from;
        return (
          <g key={b.label}>
            <rect x={x} y={ya} width={bw} height={Math.max(1, yb - ya)} rx={2} fill={fill} />
            {next && <line x1={x + bw} x2={x + band} y1={y(b.to)} y2={y(b.to)} stroke={C.light} strokeDasharray="2 2" />}
            <text x={x + bw / 2} y={b.total ? (b.to >= 0 ? ya - 4 : yb + 11) : up ? ya - 4 : yb + 11} fontSize={9} fontWeight={600} textAnchor="middle" fill={C.ink}>
              {b.total ? rmShort(b.value) : `${b.value >= 0 ? "+" : "−"}${rmShort(Math.abs(b.value))}`}
            </text>
            <text x={x + bw / 2} y={h - 5} fontSize={8.5} textAnchor="middle" fill={b.total ? C.ink : C.muted} fontWeight={b.total ? 600 : 400}>{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

const hatchId = (c: string) => `brp-hatch-${c.replace(/[^0-9a-z]/gi, "")}`;

/** A column with a 4px rounded data end and a square foot on the baseline. */
function barPath(x: number, w: number, yA: number, yB: number, end: "top" | "bottom" | "none"): string {
  const h = yB - yA;
  const r = end === "none" ? 0 : Math.min(4, w / 2, h);
  if (r <= 0) return `M${x},${yA}h${w}v${h}h${-w}Z`;
  return end === "top"
    ? `M${x},${yB}V${yA + r}Q${x},${yA} ${x + r},${yA}H${x + w - r}Q${x + w},${yA} ${x + w},${yA + r}V${yB}Z`
    : `M${x},${yA}H${x + w}V${yB - r}Q${x + w},${yB} ${x + w - r},${yB}H${x + r}Q${x},${yB} ${x},${yB - r}Z`;
}

/** Bars (grouped or stacked by `stack`) with lines over them, a zero line and a legend.
 *  Labelling follows financial-report practice (owner 2026-11-18 "有点丑 … 美国大型公司
 *  reporting"): numbers are SELECTIVE, sit OUTSIDE the bar end in ink, never inside a
 *  thin bar and never in the series colour.
 *   - one bar series -> its amount on each cap; a stack -> its total on the cap;
 *   - several side-by-side bar series -> no bar amounts (the page table carries them);
 *   - a solid line (an actual: Net profit, Net cash, Equity) labels its points;
 *   - `labels` forces bar amounts on (owner asked for them on the outlook chart),
 *     `labels={false}` turns every amount off. Dashed forecast lines are never labelled. */
/** `variance` adds an actual-vs-forecast strip under the plot (owner 2026-11-19):
 *  a small green bar = better than forecast, red = worse (`invert` for costs,
 *  where above forecast is worse), with the % beside it. Actual months only. */
export type Variance = { a: string; f: string; invert?: boolean };
export function ComboChart({ data, series, w, h, legend = true, labels, variance }: { data: Datum[]; series: Series[]; w: number; h: number; legend?: boolean; labels?: boolean; variance?: Variance }) {
  const bars = series.filter((s) => s.type === "bar");
  const lines = series.filter((s) => s.type === "line");
  const stacks = [...new Set(bars.map((s) => s.stack ?? s.key))];
  const barLabels = labels ?? stacks.length === 1;
  // Solid lines are actual measures (net profit, net cash, equity) -> labelled;
  // dashed lines are forecasts -> the table carries them.
  // Beside labelled bars only the LAST solid line (the bottom line: net profit) is
  // labelled, so two lines' numbers never pile up on the same column.
  const solid = lines.filter((s) => !s.dashed);
  const lineLabelKeys = new Set(labels === false ? [] : (barLabels ? solid.slice(-1) : solid).map((s) => s.key));
  const anyLabels = barLabels || lineLabelKeys.size > 0;
  const legendH = legend ? 20 : 0;
  const varH = variance ? 26 : 0;
  const pad = { l: 40, r: 8, t: 6 + legendH + (anyLabels ? 12 : 0), b: 18 + (anyLabels ? 12 : 0) + varH };
  if (labels !== false && barLabels && lines.length === 0) pad.l = 8;
  const iw = Math.max(10, w - pad.l - pad.r);
  const ih = Math.max(10, h - pad.t - pad.b);
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
  // Thin columns (<= 26px each), 2px air between neighbours; the band's leftover is white.
  const barW = Math.min(26, (band * 0.72) / Math.max(1, stacks.length));
  const groupW = barW * stacks.length;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);
  const fs = 9;
  const halo = { stroke: "#fff", strokeWidth: 3, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
  const legendW = series.map((s) => 16 + s.label.length * 5 + 18);
  const legendPos = legendW.map((_, i) => pad.l + legendW.slice(0, i).reduce((t, x) => t + x, 0));
  const zeroY = y(0);
  // Every value is printed (labelled bars, no line) -> the y-axis and grid only repeat them.
  const showAxis = !(barLabels && lines.length === 0);
  // Bar amounts are drawn last, on a white halo, so a line crossing a cap passes
  // BEHIND the number instead of the number jumping away from its bar.
  const capLabels: { key: string; x: number; y: number; text: string; size: number; faded: boolean }[] = [];
  return (
    <svg width={w} height={h} role="img" fontFamily="inherit">
      <defs>
        {[...new Set(bars.map((b) => b.color))].map((c) => (
          <pattern key={c} id={hatchId(c)} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
            <rect width={4} height={4} fill="#fff" />
            <line x1={0} y1={0} x2={0} y2={4} stroke={c} strokeWidth={1.4} strokeOpacity={0.45} />
          </pattern>
        ))}
      </defs>
      {legend && (
        <g fontSize={9} fill={C.muted}>
          {series.map((s, i) => (
            <g key={s.key} transform={`translate(${legendPos[i]},5)`}>
              {s.type === "bar" ? <rect y={1} width={9} height={9} rx={2} fill={s.color} /> : <line x1={0} x2={12} y1={5.5} y2={5.5} stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeDasharray={s.dashed ? "3 3" : undefined} />}
              <text x={16} y={9}>{s.label}</text>
            </g>
          ))}
        </g>
      )}
      {showAxis && ticks.map((t) => (
        <g key={t}>
          {t !== 0 && <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth={0.75} />}
          <text x={pad.l - 6} y={y(t) + 3} fontSize={8.5} textAnchor="end" fill={C.muted}>{rmShort(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x0 = pad.l + i * band + (band - groupW) / 2;
        return (
          <g key={d.label}>
            {stacks.map((st, si) => {
              const members = bars.filter((b) => (b.stack ?? b.key) === st);
              const bx = x0 + si * barW + 1, bw = Math.max(1, barW - 2), cx = bx + bw / 2;
              const vals = members.map((s) => ({ s, v: d.values[s.key] })).filter((m): m is { s: Series; v: number } => typeof m.v === "number" && m.v !== 0);
              const lastPos = [...vals].reverse().find((m) => m.v > 0)?.s.key;
              const lastNeg = [...vals].reverse().find((m) => m.v < 0)?.s.key;
              let pos = 0, neg = 0;
              const segs = vals.map(({ s, v }) => {
                const base = v >= 0 ? pos : neg;
                const top = base + v;
                if (v >= 0) pos = top; else neg = top;
                const outer = s.key === (v >= 0 ? lastPos : lastNeg);
                let ya = y(Math.max(base, top)), yb = y(Math.min(base, top));
                // 2px surface gap between stacked segments (none at the baseline).
                if (v >= 0) { if (base !== 0) yb -= 1; if (!outer) ya += 1; }
                else { if (base !== 0) ya += 1; if (!outer) yb -= 1; }
                if (yb - ya < 0.5) yb = ya + 0.5;
                const dPath = barPath(bx, bw, ya, yb, outer ? (v >= 0 ? "top" : "bottom") : "none");
                // A forecast month is drawn hollow + hatched (actual = solid), so it
                // reads as "not yet happened" on screen and in black-and-white print.
                return d.faded
                  ? <path key={s.key} d={dPath} fill={`url(#${hatchId(s.color)})`} stroke={s.color} strokeWidth={1} />
                  : <path key={s.key} d={dPath} fill={s.color} />;
              });
              const total = pos + neg;
              if (barLabels && vals.length > 0) {
                const ly = total >= 0 ? y(pos) - 4 : y(neg) + fs + 3;
                capLabels.push({ key: `${d.label}-${st}`, x: cx, y: ly, text: rmShort(total), size: stacks.length > 2 ? 7.5 : fs, faded: !!d.faded });
              }
              return (
                <g key={st}>
                  {segs}
                </g>
              );
            })}
            <text x={pad.l + i * band + band / 2} y={h - 5} fontSize={9} textAnchor="middle" fill={d.faded ? C.muted : C.ink} fontStyle={d.faded ? "italic" : undefined}>{d.label}</text>
          </g>
        );
      })}
      <line x1={pad.l} x2={pad.l + iw} y1={zeroY} y2={zeroY} stroke={C.light} strokeWidth={1} />
      {lines.map((s) => {
        const pts = data.map((d, i) => ({ x: pad.l + i * band + band / 2, v: d.values[s.key] })).filter((p): p is { x: number; v: number } => typeof p.v === "number");
        if (!pts.length) return null;
        const lab = lineLabelKeys.has(s.key);
        return (
          <g key={s.key}>
            <polyline points={pts.map((p) => `${p.x},${y(p.v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "4 4" : undefined} />
            {pts.map((p) => <circle key={p.x} cx={p.x} cy={y(p.v)} r={s.dashed ? 2.5 : 3.5} fill={s.dashed ? "#fff" : s.color} stroke={s.dashed ? s.color : "#fff"} strokeWidth={s.dashed ? 1.5 : 2} />)}
            {lab && pts.map((p) => (
              <text key={`l${p.x}`} x={p.x} y={p.v >= 0 ? y(p.v) - 8 : y(p.v) + fs + 6} fontSize={fs} fontWeight={600} textAnchor="middle" fill={C.ink} {...halo}>{rmShort(p.v)}</text>
            ))}
          </g>
        );
      })}
      {variance && (() => {
        const rows = data.map((d, i) => {
          const a = d.values[variance.a], f = d.values[variance.f];
          if (d.faded || typeof a !== "number" || typeof f !== "number" || f === 0) return null;
          const p = ((a - f) / Math.abs(f)) * 100;
          return { i, p, good: variance.invert ? p <= 0 : p >= 0 };
        }).filter((x): x is { i: number; p: number; good: boolean } => x !== null);
        if (!rows.length) return null;
        const mid = h - 18 - varH / 2;
        const maxAbs = Math.max(...rows.map((r) => Math.min(100, Math.abs(r.p))), 1);
        return (
          <g>
            <text x={pad.l - 6} y={mid + 3} fontSize={7} textAnchor="end" fill={C.muted}>vs fc</text>
            <line x1={pad.l} x2={pad.l + iw} y1={mid} y2={mid} stroke={C.grid} strokeWidth={0.75} />
            {rows.map((r) => {
              const cx = pad.l + r.i * band + band / 2;
              const hh = Math.max(1.5, (Math.min(100, Math.abs(r.p)) / maxAbs) * (varH / 2 - 3));
              const bw2 = Math.min(10, barW * 0.5);
              return (
                <g key={r.i}>
                  <rect x={cx - bw2 - 1} y={r.p >= 0 ? mid - hh : mid} width={bw2} height={hh} rx={1} fill={r.good ? STATUS_GOOD : STATUS_BAD} />
                  <text x={cx + 2} y={mid + 3} fontSize={7.5} fontWeight={600} fill={C.ink}>{`${r.p >= 0 ? "+" : "−"}${Math.abs(r.p).toFixed(1)}%`}</text>
                </g>
              );
            })}
          </g>
        );
      })()}
      {capLabels.map((l) => (
        <text key={l.key} x={l.x} y={l.y} fontSize={l.size} fontWeight={600} textAnchor="middle" fill={l.faded ? C.muted : C.ink} {...halo}>{l.text}</text>
      ))}
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
    return { d, color: i < CAT.length ? CAT[i] : C.grey, it, frac };
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
export function ShareBars({ rows, color = CAT[0] }: { rows: { label: string; value: number; pct: number | null }[]; color?: string }) {
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
