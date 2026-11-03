// Donut of the v10 customer / state cards: 326x236 SVG, outside leader-line
// labels ("Name 19%") for slices of 5% or more, centre read-out. Geometry is
// home-lib donutArcs (a port of the prototype's arcPath).
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { M, M_FONT } from "../../theme";
import { DONUT, donutArcs, wrapLabel, type Slice } from "./home-lib";

// Label text width in the donut's own units (10.5px type). Canvas measuring keeps the fit honest for any font;
// without a canvas (tests) a flat average is used.
let ctx: CanvasRenderingContext2D | null | undefined;
function measure(t: string): number {
  if (ctx === undefined) {
    try { ctx = document.createElement("canvas").getContext("2d"); if (ctx) ctx.font = `10.5px ${M_FONT}`; } catch { ctx = null; }
  }
  return ctx ? ctx.measureText(t).width : t.length * 5.9;
}

export function Donut({
  slices, ariaLabel, centreTitle, centreValue, centreSub, selected, onSlice,
}: {
  slices: Slice[];
  ariaLabel: string;
  /** e.g. "LARGEST CUSTOMER" (two lines). */
  centreTitle: [string, string];
  centreValue: string;
  centreSub: string;
  /** Slice name to keep bright; the rest dim (state card). */
  selected?: string | null;
  onSlice?: (name: string) => void;
}) {
  const arcs = useMemo(() => donutArcs(slices), [slices]);
  // Labels may use the card's side padding (12px) as well as the donut box, as far as the screen allows.
  const box = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState(0);
  useLayoutEffect(() => {
    const fit = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r || r.width <= 0) return;
      const px = Math.max(0, Math.min(12, window.innerWidth - r.right - 4, r.left - 4));
      setExtra((px * DONUT.w) / r.width);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div ref={box} role="img" aria-label={ariaLabel} style={{ position: "relative", width: "100%", height: DONUT.h, marginTop: 8 }}>
      <svg viewBox={`0 0 ${DONUT.w} ${DONUT.h}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }} aria-hidden="true">
        {arcs.map(({ slice, d }) => (
          <path
            key={slice.name}
            d={d}
            fill={slice.color}
            opacity={selected && selected !== slice.name ? 0.3 : 1}
            onClick={onSlice && slice.tappable ? () => onSlice(slice.name) : undefined}
            style={{ cursor: onSlice && slice.tappable ? "pointer" : "default" }}
          />
        ))}
        {arcs.map(({ slice, label }) => {
          if (!label) return null;
          const pct = `${Math.round(slice.share * 100)}%`;
          // The label may use the room between its leader line and the donut box edge.
          const room = (label.right ? DONUT.w - 2 - (label.tx + 4) : label.tx - 4 - 2) + extra;
          // Two lines need ~26 units of free height on the same side.
          const crowded = arcs.some((o) => o.label && o !== arcs.find((a) => a.slice === slice) && o.label.right === label.right && Math.abs(o.label.ky - label.ky) < 26);
          const { lines } = wrapLabel(slice.name, pct, room, measure, !crowded);
          const x = label.right ? label.tx + 4 : label.tx - 4;
          const y0 = lines.length === 2 ? label.ky - 2.5 : label.ky + 3.5;
          return (
            <g key={`l-${slice.name}`}>
              <polyline points={`${label.ex},${label.ey} ${label.kx},${label.ky} ${label.tx},${label.ky}`} fill="none" style={{ stroke: M.faint }} strokeWidth={1} />
              <text x={x} y={y0} textAnchor={label.right ? "start" : "end"} style={{ fontSize: "10.5px", fontFamily: "inherit" }}>
                <title>{`${slice.name} ${pct}`}</title>
                {lines.map((ln, li) => (
                  <tspan key={li} x={x} dy={li === 0 ? 0 : 12} style={{ fill: M.raisin }}>
                    {ln}
                    {li === lines.length - 1 ? <tspan style={{ fill: M.muted }}>{` ${pct}`}</tspan> : null}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", pointerEvents: "none", maxWidth: 104 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.muted, lineHeight: "12px" }}>{centreTitle[0]}<br />{centreTitle[1]}</span>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.6, color: M.raisin, marginTop: 3, lineHeight: "26px", fontVariantNumeric: "tabular-nums" }}>{centreValue}</span>
        <span style={{ fontSize: 10, color: M.muted, lineHeight: "12px" }}>{centreSub}</span>
      </div>
    </div>
  );
}
