// Home Operations v3 · Output & Cost — small building blocks shared by Costing, Plan, Purchasing, Fabric and Material shortage.
// Visual source: the approved Home Operations HTML. Neutrals come from the M.* theme vars and tints are the tone colour mixed into
// the card surface, so dark mode keeps working. Data and rules stay in the cards.
import type { ReactNode } from "react";
import { M } from "../../theme";
import { TNUM } from "./home-style";
import { CREAM } from "./ops-oc-style";

/** Segmented switch (design: track, white "on" segment). `radius` is 12 on the Plan view switch and 10 on the Fabric ones. */
export function OcSeg<K extends string>({ options, value, onChange, aria, radius = 10 }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; aria: string; radius?: number }) {
  return (
    <div role="group" aria-label={aria} style={{ display: "grid", gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))`, gap: 3, height: 36, boxSizing: "border-box", padding: 3, borderRadius: radius, background: `color-mix(in srgb, ${M.divider} 75%, transparent)` }}>
      {options.map(([k, l]) => {
        const on = k === value;
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onChange(k)}
            style={{ minWidth: 0, border: "none", borderRadius: radius - 2, background: on ? M.card : "transparent", boxShadow: on ? "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)" : "none", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 12, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>{l}</button>
        );
      })}
    </div>
  );
}

/** The translucent chart panel under a switch (design: radius 16, white 70 %). */
export function ChartPanel({ children, pad = "12px 10px 10px" }: { children: ReactNode; pad?: string }) {
  return <div style={{ marginTop: 10, padding: pad, borderRadius: 16, background: `color-mix(in srgb, ${M.card} 70%, transparent)`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05)` }}>{children}</div>;
}

/** Legend toggle of a chart: swatch + label; off = faded and struck through. */
export function LegendToggle({ label, color, on, onToggle, h = 8, round = true }: { label: string; color: string; on: boolean; onToggle: () => void; h?: number; round?: boolean }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 0", border: "none", background: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 600, color: M.raisin, cursor: "pointer", opacity: on ? 1 : 0.45, textDecoration: on ? "none" : "line-through", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>
      <span aria-hidden="true" style={{ width: round ? h : 10, height: h, borderRadius: round ? "50%" : 2, background: color }} />{label}
    </button>
  );
}

/** "SECTION LABEL" in the card body (design: 11 / 700, letter-spacing 1). */
export function CapsLabel({ children, top = 0 }: { children: ReactNode; top?: number }) {
  return <div style={{ marginTop: top, padding: "0 2px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>{children}</div>;
}

/** Grey value chip of a day card / row card: small label, value. */
export function ValueChip({ k, v, bg }: { k: string; v: ReactNode; bg?: string }) {
  return (
    <div style={{ minWidth: 0, padding: "7px 9px", borderRadius: 10, background: bg ?? `color-mix(in srgb, ${M.card} 85%, transparent)`, boxShadow: "inset 0 0 0 1px rgba(31,29,27,.06)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: M.muted, whiteSpace: "nowrap" }}>{k}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{v}</div>
    </div>
  );
}

/** A neutral rounded pill (design: 22 px, cream). */
export function SoftPill({ children, bg, fg }: { children: ReactNode; bg?: string; fg?: string }) {
  return <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: bg ?? CREAM, color: fg ?? M.taupe, fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap", ...TNUM }}>{children}</span>;
}
