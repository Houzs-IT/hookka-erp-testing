// ---------------------------------------------------------------------------
// chart-look.tsx — the design's chart look for recharts (owner 2026-10-20:
// the Financial Dashboard's animation, colours and curves as designed). Axes
// in warm grey with their line drawn, a faint grid, bars rounded 3 that ease
// over half a second, the pointed period's bars lifting 4px while the others
// fade, and hollow dots on smooth lines that fill at the pointed period.
// Colours and timings live in src/lib/finance-chart-look.ts.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { AXIS, CHART_MS, HOVER_MS } from "@/lib/finance-chart-look";

export const gridProps = { stroke: AXIS.grid, vertical: false } as const;
export const xAxisProps = {
  axisLine: { stroke: AXIS.line },
  tickLine: false,
  tick: { fontSize: 12, fontWeight: 600, fill: AXIS.label },
} as const;
export const yAxisProps = {
  axisLine: { stroke: AXIS.line },
  tickLine: { stroke: AXIS.line },
  tickSize: 4,
  tick: { fontSize: 12, fontWeight: 500, fill: AXIS.tick },
} as const;
/** Every series eases into a new state (tab, period, a band shown / hidden). */
export const anim = { isAnimationActive: true, animationDuration: CHART_MS, animationEasing: "ease-out" } as const;

/** Which period the pointer is over (null = none), for one chart. */
export function useChartHover() {
  const [hover, setHover] = useState<number | null>(null);
  return {
    hover,
    chartProps: {
      // recharts 3 hands the index over as a number or its string form.
      onMouseMove: (s: { activeTooltipIndex?: number | string | null }) => {
        const raw = s?.activeTooltipIndex;
        const n = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
        const i = Number.isFinite(n) ? n : null;
        setHover((h) => (h === i ? h : i));
      },
      onMouseLeave: () => setHover(null),
    },
  };
}

type BarShapeProps = { x?: number; y?: number; width?: number; height?: number; fill?: string; index?: number };

/** A bar as the design draws it: rounded 3 (a stacked band keeps a 1px white
 *  seam); the pointed period lifts 4px with a shadow, the rest fade to .45. */
export function liftBar(hover: number | null, opts: { stacked?: boolean } = {}) {
  return function LiftBar(props: BarShapeProps) {
    const { x = 0, y = 0, width = 0, height = 0, fill, index } = props;
    if (!width || !height) return <g />;
    const top = height < 0 ? y + height : y;
    const h = Math.abs(height);
    const me = hover !== null && hover === index;
    const dim = hover !== null && !me;
    return (
      <rect
        x={x}
        y={top}
        width={width}
        height={h}
        rx={3}
        ry={3}
        fill={fill}
        stroke={opts.stacked ? "#FFFFFF" : "none"}
        strokeWidth={opts.stacked ? 1 : 0}
        style={{
          opacity: dim ? 0.45 : 1,
          transform: me ? "translateY(-4px)" : "none",
          filter: me ? "drop-shadow(0 4px 6px rgba(31,42,68,.22))" : "none",
          transition: `opacity ${HOVER_MS + 100}ms, transform ${HOVER_MS}ms ease, filter ${HOVER_MS}ms ease`,
        }}
      />
    );
  };
}

/** A line's dot: hollow; the active (pointed) one filled and larger. */
export const dotOf = (color: string) => ({ r: 3, fill: "#FFFFFF", stroke: color, strokeWidth: 2 });
export const activeDotOf = (color: string) => ({ r: 5, fill: color, stroke: color, strokeWidth: 2 });
