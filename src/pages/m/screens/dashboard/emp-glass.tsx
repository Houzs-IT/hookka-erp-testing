// Home Employees v3 — glass building blocks. Visual source of truth: the approved "Home Employees v3" HTML (cards, KPI tiles,
// cream-headed tables, sheet tiles). Built on the Sales v12 / Operations v3 glass system (sales-glass G, ops-glass, ops-oc-style),
// so neutrals come from the M.* theme vars and tints are the tone colour mixed into the card surface: dark mode keeps working.
// Only the Employees view imports this file. No data or rule lives here.
import type { CSSProperties, ReactNode } from "react";
import {
  Building2, CalendarDays, ChevronRight, Circle, Clock, Gauge, Hammer, Percent, TriangleAlert, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { M } from "../../theme";
import { TNUM } from "./home-style";
import { G } from "./sales-glass";
import { CREAM } from "./ops-oc-style";
import { TONES, mix, type Tone } from "./emp-glass-style";

export const TILE_BG = "linear-gradient(145deg,#A08C5B,#6B5C32)";
export const BLUE = "#2B5797";
export const SOFA_TEAL = "#1F9E89";
export const ACC_GREY = "#A8A29A";
/** Hairline of the design's tables (#DDD5CA / #E6E0D9 in light mode). */
export const T_LINE = `color-mix(in srgb, #C9A961 26%, ${M.card})`;
/** Chart fills that follow dark mode: the picked-day column (#F4EFE6) and the "Working" area (#E9E3DA) in light mode. */
export const CHART_SEL = `color-mix(in srgb, #C9A961 14%, ${M.card})`;
export const CHART_AREA = `color-mix(in srgb, #B9AE9F 32%, ${M.card})`;
export const ROW_DIV = `color-mix(in srgb, ${M.raisin} 6%, ${M.card})`;

// ---------------------------------------------------------------------------
// Section card: 36 px taupe tile + title (+ sub beside it, or a sub line under the header), optional divider.
// ---------------------------------------------------------------------------
export function ECardG({
  icon: Icon, title, sub, below, divider = false, id, label, style, children,
}: { icon: LucideIcon; title: ReactNode; sub?: ReactNode; below?: ReactNode; divider?: boolean; id?: string; label: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <section id={id} aria-label={label} style={{ ...G.card, margin: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: TILE_BG, boxShadow: "inset 0 1px 0 rgba(255,255,255,.28),0 8px 16px -8px rgba(107,92,50,.75)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
          <Icon size={16} strokeWidth={2} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>{title}</span>
          {sub ? <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 2 }}>{sub}</span> : null}
        </span>
      </div>
      {below ? <div style={{ fontSize: 12, lineHeight: 1.45, color: M.ink, marginTop: 3 }}>{below}</div> : null}
      {divider ? <div aria-hidden="true" style={{ height: 1, background: G.rule, margin: "14px 0 12px" }} /> : null}
      {children}
    </section>
  );
}

/** Pill button under a list ("All 13 departments ›", "View all 12 · upper half ›"). */
export function MorePill({ label, onClick, top = 10 }: { label: ReactNode; onClick: () => void; top?: number }) {
  return (
    <button type="button" onClick={onClick}
      style={{ width: "100%", height: 42, marginTop: top, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, border: "none", borderRadius: 999, background: `linear-gradient(180deg,color-mix(in srgb, ${M.card} 95%, transparent),color-mix(in srgb, ${M.card} 72%, transparent))`, boxShadow: `inset 0 1px 0 ${M.card}, 0 0 0 1px rgba(201,169,97,.25), 0 6px 14px -8px rgba(107,92,50,.45)`, fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      {label}<ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Workforce tiles: 3 px rail, 20 px icon chip, uppercase label, 15/800 value, badge, sub
// ---------------------------------------------------------------------------
/** The tone mixed into the card surface: the design's pale chip / wash in light mode, a dark wash in dark mode. */
const toneBg = (t: Tone) => mix(t.fg, 12);

export function KpiTile({
  icon: Icon, tone, label, value, valueColor, badge, badgeTone = "neutral", sub, subColor, onTap, aria, span, children,
}: {
  icon: LucideIcon; tone: Tone; label: string; value: ReactNode; valueColor?: string; badge?: string; badgeTone?: "good" | "bad" | "neutral";
  sub?: ReactNode; subColor?: string; onTap?: () => void; aria: string; span?: boolean; children?: ReactNode;
}) {
  const bb = badgeTone === "good" ? { fg: TONES.green.fg, bg: mix(TONES.green.fg, 12) } : badgeTone === "bad" ? { fg: TONES.red.fg, bg: mix(TONES.red.fg, 13) } : { fg: M.taupe, bg: CREAM };
  return (
    <button type="button" onClick={onTap} disabled={!onTap} aria-label={aria}
      style={{ gridColumn: span ? "1 / -1" : undefined, position: "relative", overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "stretch", padding: "10px 11px 10px 14px", border: "none", borderRadius: 14, background: `linear-gradient(150deg,${M.card} 50%,${toneBg(tone)})`, boxShadow: `inset 0 1px 0 ${M.card}, inset 0 0 0 1px rgba(31,29,27,.05), 0 8px 18px -12px rgba(107,92,50,.40)`, fontFamily: "inherit", textAlign: "left", cursor: onTap ? "pointer" : "default", color: "inherit", WebkitTapHighlightColor: "transparent", opacity: 1 }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: tone.fg }} />
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span aria-hidden="true" style={{ width: 20, height: 20, flex: "none", borderRadius: 6, background: toneBg(tone), display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={11} strokeWidth={2.2} color={tone.fg} /></span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: "13px", fontWeight: 700, letterSpacing: 0.3, color: M.taupe, textTransform: "uppercase" }}>{label}</span>
        {onTap ? <ChevronRight size={13} strokeWidth={2.2} color={tone.fg} aria-hidden="true" style={{ flex: "none" }} /> : null}
      </span>
      {children ?? (
        <>
          <span style={{ display: "block", marginTop: 7, fontSize: 15, lineHeight: "20px", fontWeight: 800, color: valueColor ?? M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{value}</span>
          {badge ? <span style={{ alignSelf: "flex-start", height: 18, display: "inline-flex", alignItems: "center", marginTop: 4, padding: "0 6px", borderRadius: 999, background: bb.bg, color: bb.fg, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{badge}</span> : null}
          {sub ? <span style={{ display: "block", marginTop: 3, fontSize: 11, lineHeight: 1.35, color: subColor ?? M.ink, overflowWrap: "anywhere", ...TNUM }}>{sub}</span> : null}
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tables: white card, ring, cream header strip, rows with a 3 px rail
// ---------------------------------------------------------------------------
export function TBox({ children, top = 12, r = 12 }: { children: ReactNode; top?: number; r?: number }) {
  return <div style={{ marginTop: top, borderRadius: r, background: M.card, boxShadow: `inset 0 0 0 1px ${T_LINE}, 0 10px 22px -16px rgba(107,92,50,.40)`, overflow: "hidden", ...TNUM }}>{children}</div>;
}
export function THead({ grid, cols, pad = "8px 10px", gap = 6 }: { grid: string; cols: ReactNode[]; pad?: string; gap?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: grid, gap, padding: pad, background: CREAM, borderBottom: `1px solid ${T_LINE}`, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: M.taupe, textTransform: "uppercase" }}>
      {cols.map((c, i) => <span key={i} style={{ textAlign: i ? "right" : "left", whiteSpace: "nowrap", minWidth: 0 }}>{c}</span>)}
    </div>
  );
}
/** One table row: a button when it opens something, a plain row otherwise. */
export function TRow({ grid, rail, bg, first, onTap, aria, pad = "8px 10px", gap = 6, borderTop, fontSize = 12.5, children }: {
  grid: string; rail?: string; bg?: string; first: boolean; onTap?: () => void; aria?: string; pad?: string; gap?: number; borderTop?: string; fontSize?: number; children: ReactNode;
}) {
  const style: CSSProperties = { width: "100%", boxSizing: "border-box", display: "grid", gridTemplateColumns: grid, gap, alignItems: "center", padding: pad, border: "none", borderTop: borderTop ?? (first ? "none" : `1px solid ${ROW_DIV}`), background: bg ?? "transparent", boxShadow: rail ? `inset 3px 0 0 ${rail}` : "none", fontFamily: "inherit", textAlign: "left", fontSize, color: M.raisin, cursor: onTap ? "pointer" : "default", WebkitTapHighlightColor: "transparent" };
  return onTap ? <button type="button" onClick={onTap} aria-label={aria} style={style}>{children}</button> : <div style={style}>{children}</div>;
}

export function RankDot({ n, m, size = 22, style }: { n: string; m?: { bg: string; fg: string; sh: string }; size?: number; style?: CSSProperties }) {
  const c = m ?? { bg: CREAM, fg: M.taupe, sh: "none" };
  return <span style={{ flex: "none", width: size, height: size, borderRadius: "50%", background: c.bg, boxShadow: c.sh, color: c.fg, fontSize: size > 20 ? 11 : 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", ...TNUM, ...style }}>{n}</span>;
}
/** Name + grey sub line (+ optional ochre second line) of a table row. */
export function NameCell({ n, s, s2, rank, color, weight = 700 }: { n: ReactNode; s?: ReactNode; s2?: ReactNode; rank?: ReactNode; color?: string; weight?: number }) {
  return (
    <span style={{ minWidth: 0, display: "flex", alignItems: "flex-start", gap: 6 }}>
      {rank}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: weight, color: color ?? M.raisin, lineHeight: "17px", overflowWrap: "anywhere" }}>{n}</span>
        {s ? <span style={{ display: "block", fontSize: 11, color: M.muted, marginTop: 1 }}>{s}</span> : null}
        {s2 ? <span style={{ display: "block", fontSize: 10.5, color: "#9C6F1E", marginTop: 1 }}>{s2}</span> : null}
      </span>
    </span>
  );
}
export const Num = ({ children, color, weight = 400 }: { children: ReactNode; color?: string; weight?: number }) => (
  <span style={{ textAlign: "right", whiteSpace: "nowrap", color: color ?? M.ink, fontWeight: weight, minWidth: 0 }}>{children}</span>
);

/** Output split bar of the department tables (Bedframe · Sofa · Accessory). */
export function OutBar({ bf, sofa, acc }: { bf: number; sofa: number; acc: number }) {
  const o = bf + sofa + acc;
  const w = (v: number) => `${o > 0 ? (v / o) * 100 : 0}%`;
  return (
    <span aria-hidden="true" style={{ display: "flex", gap: 1, height: 4, margin: "4px 0 0 auto", width: 64, borderRadius: 999, overflow: "hidden", background: `color-mix(in srgb, ${M.divider} 80%, transparent)` }}>
      <span style={{ width: w(bf), background: BLUE }} /><span style={{ width: w(sofa), background: SOFA_TEAL }} /><span style={{ width: w(acc), background: ACC_GREY }} />
    </span>
  );
}
export function OutLegend() {
  const sw = (c: string, l: string) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8, padding: "0 4px", fontSize: 11, color: M.ink }}>
      {sw(BLUE, "Bedframe")}{sw(SOFA_TEAL, "Sofa")}{sw(ACC_GREY, "Accessory")}<span style={{ whiteSpace: "nowrap" }}>· hours = production / working</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet KPI tiles (6-column grid; spans like the design)
// ---------------------------------------------------------------------------
const SHEET_ICON: Record<string, LucideIcon> = {
  "Labour cost": Wallet, "Total salary": Wallet, Labour: Wallet, Salary: Wallet, People: Users, Workers: Users, "People with any": Users, Departments: Building2,
  Overall: Gauge, Efficiency: Gauge, "Below target": TriangleAlert, Days: CalendarDays, Working: Clock, Production: Hammer, "Non-prod": Clock, "% of clocked": Percent,
};
export type SheetKpi = { k: string; v: ReactNode; c?: string; full?: boolean };
function sheetTone(c: string | undefined): { rail: string; tint: string; chip: string } {
  if (c === "#9A3A2D") return { rail: c, tint: mix(c, 14), chip: mix(c, 16) };
  if (c === "#4F7C3A") return { rail: c, tint: mix(c, 12), chip: mix(c, 14) };
  if (c === BLUE) return { rail: c, tint: mix(c, 12), chip: mix(c, 14) };
  if (c === "#9C6F1E" || c === "#B98A1E" || c === "#85600F") return { rail: "#B98A1E", tint: mix("#C9A24B", 22), chip: mix("#C9A24B", 26) };
  return { rail: "#A08C5B", tint: CREAM, chip: CREAM };
}
export function SheetKpis({ items }: { items: SheetKpi[] }) {
  const full = items.filter((q) => q.full).length;
  const rest = items.length - full;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 6, marginBottom: 12 }}>
      {items.map((q, i) => {
        const j = i - full;
        const sp = q.full ? 6 : rest === 5 ? (j < 3 ? 2 : 3) : rest === 4 ? 3 : rest === 2 ? 3 : rest === 1 ? 6 : 2;
        const t = sheetTone(q.c);
        const Icon = SHEET_ICON[q.k] ?? Circle;
        return (
          <div key={q.k} style={{ minWidth: 0, gridColumn: `span ${sp}`, padding: "9px 10px 9px 12px", borderRadius: 14, background: `linear-gradient(150deg,${M.card} 45%,${t.tint})`, boxShadow: `inset 3px 0 0 ${t.rail}, inset 0 0 0 1px rgba(31,29,27,.06), 0 8px 18px -14px rgba(107,92,50,.45)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span aria-hidden="true" style={{ width: 18, height: 18, flex: "none", borderRadius: 6, background: t.chip, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={11} strokeWidth={2.2} color={t.rail} /></span>
              <span style={{ minWidth: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: M.taupe, textTransform: "uppercase", lineHeight: 1.2 }}>{q.k}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: q.c ?? M.raisin, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{q.v}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Sheet "chips" (Today / Yesterday / This month): taupe when lit, white with a shadow otherwise. */
export function SheetChips<K extends string>({ options, value, onChange }: { options: readonly (readonly [K, string])[]; value: K | null; onChange: (k: K | null) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
      {options.map(([k, l]) => {
        const on = value === k;
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onChange(on ? null : k)}
            style={{ flex: "none", height: 32, padding: "0 12px", border: "none", borderRadius: 999, background: on ? M.taupe : M.card, color: on ? "#FFFFFF" : M.raisin, boxShadow: on ? "0 6px 14px -6px rgba(107,92,50,.6)" : "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>{l}</button>
        );
      })}
    </div>
  );
}

/** White panel of a sheet (radius 16, soft shadow). */
export function SheetPanel({ children, pad = 16, style }: { children: ReactNode; pad?: number | string; style?: CSSProperties }) {
  return <div style={{ background: M.card, borderRadius: 16, boxShadow: "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.22)", padding: pad, ...style }}>{children}</div>;
}
export function SheetEmpty({ children }: { children: ReactNode }) {
  return <SheetPanel style={{ textAlign: "center", fontSize: 13, color: M.muted }}>{children}</SheetPanel>;
}
