// Shared pieces of the /m Home Operations view, built to the approved Home Operations HTML
// (section card, header row, tags, pills, switches, chips, search, split bars, sheet table).
import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, ChevronRight, Lock, Search, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import type { Status } from "./ops-lib";
import { SectionState } from "./home-ui";
import { SHADOW_SECTION, TAG_STYLE, C, CAT, chipStyle, segStyle, searchInput, SHADOW_TILE, sheetCard } from "./ops-style";
import { TNUM } from "./home-style";

// ---------------------------------------------------------------------------
// Section card + header (HTML: section radius 16, padding 16, 15/700 title, 12px sub)
// ---------------------------------------------------------------------------
export function OCard({ label, id, children, pad = 16 }: { label: string; id?: string; children: ReactNode; pad?: number }) {
  return (
    <section id={id} aria-label={label} style={{ backgroundColor: M.card, borderRadius: 16, boxShadow: SHADOW_SECTION, padding: pad, minWidth: 0 }}>
      {children}
    </section>
  );
}

/** Title row: title left, tag / text / pill right. `center` aligns a right-hand pill with the title (Overdue, Due soon). */
export function OHead({ title, right, sub, center, subLeading }: { title: string; right?: ReactNode; sub?: ReactNode; center?: boolean; subLeading?: number }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: center ? "center" : "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: -0.2 }}>{title}</div>
        {right}
      </div>
      {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 3, lineHeight: subLeading ?? "normal" }}>{sub}</div> : null}
    </>
  );
}

export function Tag({ kind, children }: { kind: keyof typeof TAG_STYLE; children: ReactNode }) {
  const t = TAG_STYLE[kind];
  return <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, backgroundColor: t.bg, color: t.fg, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}

/** Right-hand text of a header (the period it follows). */
export function PeriodText({ children }: { children: ReactNode }) {
  return <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: M.ink, whiteSpace: "nowrap" }}>{children}</span>;
}

export function CountPill({ n, tone }: { n: string; tone: "danger" | "warn" }) {
  const bg = tone === "danger" ? C.dangerBg : C.warnBg;
  const fg = tone === "danger" ? C.danger : C.warnFg;
  return <span style={{ flex: "none", minWidth: 28, height: 26, boxSizing: "border-box", padding: "0 9px", borderRadius: 999, backgroundColor: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, ...TNUM }}>{n}</span>;
}

export function IconTile({ icon: Icon, bg, fg, size = 40, radius = 12, iconSize = 20 }: { icon: LucideIcon; bg: string; fg: string; size?: number; radius?: number; iconSize?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, flex: "none", borderRadius: radius, backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon size={iconSize} strokeWidth={1.9} color={fg} />
    </span>
  );
}

export const Chev = ({ size = 15, color = C.chevron }: { size?: number; color?: string }) => <ChevronRight size={size} strokeWidth={2} color={color} aria-hidden="true" style={{ flex: "none" }} />;

/** Small taupe section label (11 / 700 / 1px). */
export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, ...style }}>{children}</span>;
}

// ---------------------------------------------------------------------------
// States (loading / error / permission denied) — not in the HTML; the HTML's own card styling is reused
// ---------------------------------------------------------------------------
export function StatusBlock({ status, what, need, reason, onRetry, minHeight = 96 }: { status: Exclude<Status, "ready">; what: string; need?: string; reason?: string; onRetry?: () => void; minHeight?: number }) {
  if (status === "denied") {
    return (
      <div role="status" style={{ minHeight, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center", color: M.ink, fontSize: 13, padding: "14px 8px" }}>
        <Lock size={18} strokeWidth={1.9} aria-hidden="true" color={M.taupe} />
        <span style={{ fontWeight: 700, color: M.raisin }}>Not available for your role</span>
        <span style={{ fontSize: 12, lineHeight: 1.45, maxWidth: 270 }}>{what} {need ? `needs ${need}.` : "is outside your role's access."} This is a permission, not an empty result.</span>
      </div>
    );
  }
  if (status === "error") return <SectionState kind="error" text={reason ? `Could not load ${what.toLowerCase()} (${reason}).` : `Could not load ${what.toLowerCase()}.`} onRetry={onRetry} minHeight={minHeight} />;
  return <SectionState kind="loading" minHeight={minHeight} />;
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------
export function Bar({ frac, color, h = 6, track, inset }: { frac: number; color: string; h?: number; track?: string; inset?: string }) {
  return (
    <span aria-hidden="true" style={{ display: "block", height: h, borderRadius: 999, backgroundColor: track ?? M.divider, overflow: "hidden", margin: inset }}>
      <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, frac)) * 100}%`, borderRadius: 999, backgroundColor: color }} />
    </span>
  );
}

/** Two-part bar (first part, then second part) on a track; widths are shares of `max`. */
export function SplitBar({ a, b, max, aColor, bColor, h = 8, margin }: { a: number; b: number; max: number; aColor: string; bColor: string; h?: number; margin?: string }) {
  const w = (v: number) => `${max > 0 ? Math.min(100, (v / max) * 100) : 0}%`;
  return (
    <span aria-hidden="true" style={{ display: "flex", height: h, marginTop: margin, borderRadius: 999, backgroundColor: M.divider, overflow: "hidden" }}>
      <span style={{ width: w(a), backgroundColor: aColor }} />
      <span style={{ width: w(b), backgroundColor: bColor }} />
    </span>
  );
}

export const SofaBedBar = ({ sofa, bed, max, h }: { sofa: number; bed: number; max: number; h?: number }) => <SplitBar a={sofa} b={bed} max={max} aColor={CAT.sofa} bColor={CAT.bedframe} h={h} />;

// ---------------------------------------------------------------------------
// Switches, chips, search
// ---------------------------------------------------------------------------
/** Segmented switch. sm = the 36 px Plan / Fabric switch; md = the 44 px Overdue switch. */
export function Seg<K extends string>({ options, value, onChange, aria, size = "sm" }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; aria: string; size?: "sm" | "md" }) {
  const md = size === "md";
  return (
    <div role="group" aria-label={aria} style={{ display: "grid", gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))`, gap: md ? 4 : 3, height: md ? 44 : 36, boxSizing: "border-box", padding: md ? 4 : 3, borderRadius: md ? 12 : 10, backgroundColor: M.divider }}>
      {options.map(([k, l]) => {
        const on = k === value;
        const s = segStyle(on);
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onChange(k)}
            style={{ minWidth: 0, border: "none", borderRadius: md ? 9 : 8, backgroundColor: s.bg, boxShadow: s.shadow, color: s.fg, fontFamily: "inherit", fontSize: md ? 12.5 : 12, fontWeight: s.weight, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: md ? "0 6px" : "0 2px", WebkitTapHighlightColor: "transparent" }}>{l}</button>
        );
      })}
    </div>
  );
}

/** Horizontally scrolling chips (HTML chipS: 32 px, dark taupe when on, white with shadow when off). */
export function ChipScroll<K extends string>({ options, value, onChange, aria, margin = "10px -16px 0" }: { options: readonly { key: K; label: string; dot?: string }[]; value: K; onChange: (k: K) => void; aria: string; margin?: string }) {
  return (
    <div role="group" aria-label={aria} className="ops-chip-scroll" style={{ display: "flex", gap: 6, overflowX: "auto", margin, padding: "0 16px 2px", scrollbarWidth: "none" }}>
      {options.map((o) => {
        const on = o.key === value;
        const s = chipStyle(on);
        return (
          <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)}
            style={{ flex: "none", height: 32, padding: "0 12px", border: "none", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", backgroundColor: s.bg, color: s.fg, boxShadow: s.shadow, fontFamily: "inherit", fontSize: 12.5, fontWeight: s.weight, WebkitTapHighlightColor: "transparent", display: "inline-flex", alignItems: "center", gap: 6 }}>
            {o.dot ? <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: o.dot }} /> : null}{o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pill legend toggle (HTML Backlog / Purchasing legend): white with shadow when on, grey when off. */
export function LegendPill({ label, color, on, onToggle, h = 8, w = 8, height = 30, weight = 700 }: { label: string; color: string; on: boolean; onToggle: () => void; h?: number; w?: number; height?: number; weight?: number }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle}
      style={{ height, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 11px", borderRadius: 999, border: "none", backgroundColor: on ? M.card : M.divider, color: on ? M.raisin : M.muted, boxShadow: on ? SHADOW_TILE : "none", fontFamily: "inherit", fontSize: 12, fontWeight: weight, cursor: "pointer", whiteSpace: "nowrap", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ width: w, height: h, borderRadius: 2, backgroundColor: color, opacity: on ? 1 : 0.35 }} />{label}
    </button>
  );
}

/** Search field (HTML: 40 px, radius 12, icon left). `raised` = the white one inside a sheet. */
export function SearchField({ value, onChange, placeholder, aria, raised }: { value: string; onChange: (v: string) => void; placeholder: string; aria: string; raised?: boolean }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, height: raised ? 42 : 40, marginTop: raised ? 0 : 10, padding: "0 12px", borderRadius: 12, backgroundColor: raised ? M.card : M.paper, boxShadow: raised ? SHADOW_TILE : "none" }}>
      <Search size={16} strokeWidth={2} color={M.muted} aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={aria} style={searchInput} />
    </label>
  );
}

/** Full-width text button under a list ("Show all", "View all N ›"). */
export function MoreButton({ label, onClick, expanded, chevron = "down", height = 44, margin = "4px 0 -6px" }: { label: string; onClick: () => void; expanded?: boolean; chevron?: "down" | "right"; height?: number; margin?: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded}
      style={{ width: "100%", height, margin, border: "none", borderTop: `1px solid ${M.divider}`, background: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: M.taupe, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
      {label}
      {chevron === "down" ? <span style={{ display: "flex", transform: expanded ? "rotate(180deg)" : "none" }}><ChevronDown size={15} strokeWidth={2} aria-hidden="true" /></span> : <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sheet pieces (HTML sheet bodies)
// ---------------------------------------------------------------------------
/** Sheet table: header row (10.5 / 700 / taupe), rows 44 px, hairline between (HTML isTable). */
export function TableSheet({ grid, head, rows, none }: { grid: string; head: { t: string; right?: boolean }[]; rows: { cells: { t: ReactNode; right?: boolean; w?: number; color?: string }[]; bg?: string }[]; none?: string }) {
  return (
    <div style={{ ...sheetCard, padding: "0 14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, padding: "12px 0 8px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: M.taupe }}>
        {head.map((h) => <span key={h.t} style={{ textAlign: h.right ? "right" : "left", whiteSpace: "nowrap" }}>{h.t}</span>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: grid, gap: 10, alignItems: "center", minHeight: 44, padding: "6px 0", borderTop: `1px solid ${M.divider}`, backgroundColor: r.bg ?? "transparent" }}>
          {r.cells.map((c, j) => <span key={j} style={{ minWidth: 0, textAlign: c.right ? "right" : "left", fontSize: 13, fontWeight: c.w ?? 500, color: c.color ?? M.raisin, overflowWrap: "anywhere", ...TNUM }}>{c.t}</span>)}
        </div>
      ))}
      {rows.length === 0 && none ? <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: M.muted, borderTop: `1px solid ${M.divider}` }}>{none}</div> : null}
    </div>
  );
}

/** Two-column totals card with a divider and coloured squares (Active Jobs / Completed / Total backlog). */
export function TotalsCard({ items }: { items: { label: string; value: string; dot?: string; color?: string }[] }) {
  return (
    <div style={{ ...sheetCard, padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
      {items.map((t, i) => (
        <div key={t.label} style={{ minWidth: 0, paddingLeft: i ? 14 : 0, borderLeft: i ? `1px solid ${M.divider}` : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: M.ink }}>
            {t.dot ? <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: t.dot }} /> : null}{t.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: t.color ?? M.raisin, marginTop: 2, ...TNUM }}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

export function SwatchLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: M.ink }}>
      {items.map((i) => <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: i.color }} />{i.label}</span>)}
    </div>
  );
}

export function SheetNote2({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, color: M.muted, marginTop: 10, padding: "0 2px", lineHeight: 1.45 }}>{children}</div>;
}

export function InfoBox({ icon: Icon, children, tone = "warn" }: { icon: LucideIcon; children: ReactNode; tone?: "warn" | "neutral" }) {
  const bg = tone === "warn" ? C.warnBg : "#F4EFE6";
  const fg = tone === "warn" ? C.warn : M.taupe;
  return (
    <div role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 11px", borderRadius: 12, backgroundColor: bg, fontSize: 12, lineHeight: 1.45, color: tone === "warn" ? C.warnInk : M.ink }}>
      <Icon size={14} strokeWidth={2} color={fg} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}
