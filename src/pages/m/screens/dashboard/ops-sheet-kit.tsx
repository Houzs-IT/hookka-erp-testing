// Home Operations v3 — building blocks of the opened details (bottom sheets), from the approved design: the summary panel with
// its tiles, the "SECTION ——— hint" rule, the rail-and-tint detail card, the small value chips and the ochre note list.
// Neutrals come from the M.* theme vars and tints are the tone colour mixed into the card surface, so dark mode keeps working.
import type { ReactNode } from "react";
import { Info, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { TNUM } from "./home-style";
import { G } from "./sales-glass";

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, ${M.card})`;

/** Summary panel (design: radius 16, glass white, 14 padding): a scope line, then the tiles. */
export function SumPanel({ icon: Icon, scope, scope2, children }: { icon: LucideIcon; scope: ReactNode; scope2?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 16, background: `color-mix(in srgb, ${M.card} 82%, transparent)`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 10px 22px -16px rgba(107,92,50,.40)` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={14} strokeWidth={2} color={M.taupe} aria-hidden="true" />
        <span style={{ flex: "none", fontSize: 12.5, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap" }}>{scope}</span>
        {scope2 ? <span style={{ fontSize: 12, color: M.muted, whiteSpace: "nowrap" }}>· {scope2}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Two-up tile grid of a summary panel. */
export function TileGrid({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 8, marginTop: 12 }}>{children}</div>;
}

/** Summary tile: uppercase label (tone), big value. `tone` is mixed into the surface for the wash. */
export function SumTile({ k, v, tone, big = 17, valueColor, dot, sub }: { k: string; v: ReactNode; tone: string; big?: number; valueColor?: string; dot?: string; sub?: ReactNode }) {
  return (
    <div style={{ minWidth: 0, padding: "9px 11px", borderRadius: 12, background: mix(tone, 11) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: tone === "#6B5C32" ? M.taupe : tone, textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {dot ? <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} /> : null}{k}
      </div>
      <div style={{ fontSize: big, fontWeight: 800, color: valueColor ?? M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{v}</div>
      {sub ? <div style={{ fontSize: 11, color: M.muted, marginTop: 1 }}>{sub}</div> : null}
    </div>
  );
}

/** "BY DEPARTMENT ————— Longest first". */
export function SecRule({ label, hint, top = 16 }: { label: string; hint?: string; top?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: `${top}px 2px 8px` }}>
      <span style={{ flex: "none", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe }}>{label}</span>
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: G.rule }} />
      {hint ? <span style={{ flex: "none", fontSize: 11.5, color: M.muted, whiteSpace: "nowrap" }}>{hint}</span> : null}
    </div>
  );
}

/** Detail card (design: radius 18, 4 px rail, a wash of the rail colour). */
export function DCard({ rail, tint, children }: { rail: string; tint?: string; children: ReactNode }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", padding: "12px 12px 12px 16px", borderRadius: 18, background: `linear-gradient(150deg,${M.card} 55%,${tint ?? mix(rail, 10)})`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 12px 24px -16px rgba(107,92,50,.45)` }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: rail }} />
      {children}
    </div>
  );
}
export const DCards = ({ children }: { children: ReactNode }) => <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 10 }}>{children}</div>;

/** Small value chip inside a detail card: dot or icon + label, then the value. */
export function MiniChip({ k, v, dot, icon: Icon }: { k: string; v: ReactNode; dot?: string; icon?: LucideIcon }) {
  return (
    <div style={{ minWidth: 0, padding: "7px 9px", borderRadius: 10, background: `color-mix(in srgb, ${M.card} 85%, transparent)`, boxShadow: "inset 0 0 0 1px rgba(31,29,27,.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 600, color: M.muted, whiteSpace: "nowrap" }}>
        {dot ? <span aria-hidden="true" style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", background: dot }} /> : null}
        {Icon ? <Icon size={11} strokeWidth={2} color="#8B7A4E" aria-hidden="true" /> : null}{k}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: M.raisin, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{v}</div>
    </div>
  );
}
export const ChipRow = ({ cols, children }: { cols: number; children: ReactNode }) => <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: 6, marginTop: 10 }}>{children}</div>;

/** Ochre note box at the foot of a detail (design: Info icon, one line each, tinted background). */
export function NoteList({ lines }: { lines: ReactNode[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr)", columnGap: 7, rowGap: 5, alignItems: "start", marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "rgba(201,169,97,.08)", fontSize: 11.5, lineHeight: 1.45, color: G.hint }}>
      <span style={{ display: "flex", height: 17, alignItems: "center" }}><Info size={14} strokeWidth={2} aria-hidden="true" /></span>
      {lines.map((l, i) => (i === 0 ? <span key={i} style={{ minWidth: 0 }}>{l}</span> : [<span key={`s${i}`} />, <span key={i} style={{ minWidth: 0 }}>{l}</span>]))}
    </div>
  );
}

/** Day pill ("▲ +1h 02m vs avg"). */
export function DeltaPill({ up, children }: { up: boolean; children: ReactNode }) {
  const c = up ? "#4F7C3A" : "#9A3A2D";
  return <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", gap: 3, padding: "0 8px", borderRadius: 999, background: mix(c, 14), color: c, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", ...TNUM }}>{children}</span>;
}

/** Table card of the department drill (design: white card, ring, cream header strip). */
export function TableCard({ children }: { children: ReactNode }) {
  return <div style={{ borderRadius: 16, background: M.card, boxShadow: `0 0 0 1px ${M.hairline}, 0 10px 22px -16px rgba(107,92,50,.40)`, overflow: "hidden" }}>{children}</div>;
}
