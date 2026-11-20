// Home Sales v12 — shared glass primitives. Visual source of truth:
// design_handoff_home_sales_v12/Home Sales v12.dc.html (HANDOFF.md "Shared design rules").
//
// SCOPE: only the Home → Sales view imports this file. home-ui.tsx / home-style.ts are shared with
// Operations, Employees, the Scan sheets and Finance, so the v12 look lives here instead of
// restyling them. Surfaces are derived from the M.* theme vars (color-mix), so the existing dark mode
// keeps working: in light mode the mixes land on the HTML's rgba(255,255,255,.82) glass.
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Info, X, type LucideIcon } from "lucide-react";
import { Sheet } from "../../components/Sheet";
import { M } from "../../theme";
import { TNUM } from "./home-style";
import { SheetCard } from "./home-ui";

const mix = (c: string, pct: number, into = "transparent") => `color-mix(in srgb, ${c} ${pct}%, ${into})`;
const HI = `color-mix(in srgb, ${M.card} 85%, white)`; // top rim highlight (white in light mode)

// eslint-disable-next-line react-refresh/only-export-components
export const G = {
  /** Card: glass gradient, 22 radius, 16 padding. */
  card: {
    background: `linear-gradient(160deg, ${mix(M.card, 82)}, ${mix(M.card, 58)} 55%, ${mix(M.paper, 62)})`,
    backdropFilter: "blur(22px) saturate(170%)",
    WebkitBackdropFilter: "blur(22px) saturate(170%)",
    borderRadius: 22,
    padding: 16,
    margin: "0 -6px",
    minWidth: 0,
    boxShadow: `inset 0 1px 0 ${HI}, inset 0 0 0 1px ${mix(M.card, 55)}, inset 0 -1px 0 rgba(201,169,97,.18), 0 1px 2px rgba(31,29,27,.04), 0 10px 24px -14px rgba(107,92,50,.30), 0 28px 48px -30px rgba(31,29,27,.32)`,
  } satisfies CSSProperties,
  /** Inner panel: radius 16, translucent white, 1px neutral inset. */
  panel: {
    borderRadius: 16,
    background: mix(M.card, 70),
    boxShadow: `inset 0 1px 0 ${HI}, inset 0 0 0 1px ${mix(M.raisin, 5)}`,
    minWidth: 0,
  } satisfies CSSProperties,
  rule: mix(M.raisin, 7),
  tileGradient: "linear-gradient(145deg,#A08C5B,#6B5C32)",
  hint: "#9C6F1E",
  /** Late / overdue pill. */
  late: { bg: "#FBE7E3", fg: "#9A3A2D" },
} as const;

/** Card with the 36×36 taupe icon tile header + divider. */
export function GCard({
  icon: Icon, title, sub, right, children, id, label,
}: { icon: LucideIcon; title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; id?: string; label?: string }) {
  return (
    <section id={id} aria-label={label ?? title} style={G.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, borderBottom: `1px solid ${G.rule}`, marginBottom: 12 }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: G.tileGradient, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin, lineHeight: 1.25 }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2, lineHeight: 1.35 }}>{sub}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function GPanel({ children, pad = 12, style }: { children: ReactNode; pad?: number | string; style?: CSSProperties }) {
  return <div style={{ ...G.panel, padding: pad, ...style }}>{children}</div>;
}

/** Segmented switch (All / Bedframe / Sofa, Month / Quarter / Year): track + white "on" segment. */
export function GSwitch<K extends string>({
  options, value, onChange, aria,
}: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; aria: string }) {
  return (
    <div role="group" aria-label={aria} style={{ display: "flex", gap: 2, padding: 4, borderRadius: 12, background: mix(M.divider, 75) }}>
      {options.map(([k, label]) => {
        const on = k === value;
        return (
          <button
            key={k} type="button" aria-pressed={on} onClick={() => onChange(k)}
            style={{
              flex: 1, height: 32, border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600,
              background: on ? M.card : "transparent", color: on ? M.raisin : M.ink,
              boxShadow: on ? "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)" : "none", WebkitTapHighlightColor: "transparent",
            }}
          >{label}</button>
        );
      })}
    </div>
  );
}

/** Legend toggle tile (3 equal tiles in a row): marker + label; off = faded + line-through. */
export function GLegend({
  label, marker, on, onToggle,
}: { label: string; marker: ReactNode; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" aria-pressed={on} onClick={onToggle}
      style={{
        flex: 1, minWidth: 0, height: 32, borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, color: M.raisin, background: M.card,
        boxShadow: `inset 0 0 0 1px ${mix(M.raisin, 8)}`, opacity: on ? 1 : 0.45, textDecoration: on ? "none" : "line-through", whiteSpace: "nowrap",
        WebkitTapHighlightColor: "transparent",
      }}
    >{marker}{label}</button>
  );
}
export const GLegendRow = ({ children }: { children: ReactNode }) => <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{children}</div>;

/** 8px colour dot (circles everywhere, never squares). */
export const Dot = ({ color, style }: { color: string; style?: CSSProperties }) => (
  <span aria-hidden="true" style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", backgroundColor: color, display: "inline-block", ...style }} />
);
/** Legend line marker, series colour (dashed when `dashed`). */
export const Line = ({ color, dashed }: { color: string; dashed?: boolean }) => (
  <span aria-hidden="true" style={{ width: 14, height: 0, flex: "none", borderTop: `2.5px ${dashed ? "dashed" : "solid"} ${color}`, borderRadius: 2 }} />
);

/** Section label (11/700, 1px tracking, taupe) followed by a 1px rule. */
export function GLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0 8px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap", textTransform: "uppercase" }}>{children}</span>
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: G.rule }} />
      {right}
    </div>
  );
}

/** Hint / note line at the BOTTOM of a card: 11.5px ochre + Info icon. */
export function GHint({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 12, fontSize: 11.5, lineHeight: 1.4, color: G.hint }}>
      <Info size={13} strokeWidth={2} aria-hidden="true" style={{ flex: "none", marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

/** Late / status pill. */
export const GPill = ({ children, bg = G.late.bg, fg = G.late.fg }: { children: ReactNode; bg?: string; fg?: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px", borderRadius: 999, background: bg, color: fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>
);

/** Sheet summary strip: TOTAL full width (20/800) on top, 2–3 stats below. */
export function GSummary({ total, totalLabel = "TOTAL", stats, sticky }: { total: ReactNode; totalLabel?: string; stats?: { k: string; v: ReactNode; n?: ReactNode; n2?: ReactNode }[]; sticky?: boolean }) {
  return (
    <div
      style={{
        marginBottom: 10, borderRadius: 16, background: `linear-gradient(160deg, ${mix(M.card, 95)}, ${mix(M.card, 78)})`,
        boxShadow: `inset 0 1px 0 ${HI}, 0 0 0 1px rgba(201,169,97,.16), 0 10px 22px -14px rgba(31,29,27,.28)`,
        ...(sticky ? { position: "sticky", top: 0, zIndex: 1 } : null),
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: stats?.length ? `1px solid ${G.rule}` : "none" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: M.taupe }}>{totalLabel}</div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: M.raisin, marginTop: 3, whiteSpace: "nowrap", ...TNUM }}>{total}</div>
      </div>
      {stats?.length ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))`, padding: "12px 4px" }}>
          {stats.map((s, i) => (
            <div key={s.k} style={{ minWidth: 0, padding: "0 10px", borderLeft: i ? `1px solid ${G.rule}` : "none" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: M.taupe, textTransform: "uppercase" }}>{s.k}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{s.v}</div>
              {s.n ? <div style={{ fontSize: 11.5, fontWeight: 600, color: M.ink, marginTop: 2, whiteSpace: "nowrap" }}>{s.n}</div> : null}
              {s.n2 ? <div style={{ fontSize: 11, color: M.muted, marginTop: 1, whiteSpace: "nowrap" }}>{s.n2}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
/** Cream-glass bottom sheet (radius 26 top): handle, title + subtitle, back / close, scrolling body. */
export function GSheetFrame({
  open, title, sub, onBack, onClose, children,
}: { open: boolean; title: string; sub?: ReactNode; onBack?: () => void; onClose: () => void; children: ReactNode }) {
  const btn: CSSProperties = { width: 40, height: 40, flex: "none", border: "none", background: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: M.muted, WebkitTapHighlightColor: "transparent" };
  return (
    <Sheet
      open={open} onClose={onClose} title={title} bare portal phoneRadius={26}
      panelStyle={{
        display: "flex", flexDirection: "column", overflowY: "hidden", paddingBottom: 0,
        background: `linear-gradient(160deg, ${mix(M.paper, 96)}, ${mix(M.paper, 94, "rgba(236,226,206,.9)")})`,
        backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)",
        boxShadow: `inset 0 1px 0 ${HI}, 0 -12px 40px rgba(31,29,27,.22)`,
      }}
    >
      <div style={{ flex: "none" }}>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: M.hairline }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px 10px 16px" }}>
          {onBack ? <button type="button" onClick={onBack} aria-label="Back" style={{ ...btn, marginLeft: -12, color: M.raisin }}><ChevronLeft size={21} strokeWidth={2} aria-hidden="true" /></button> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, lineHeight: 1.3 }}>{title}</div>
            {sub ? <div style={{ fontSize: 12, lineHeight: 1.4, color: M.ink, marginTop: 2 }}>{sub}</div> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...btn, marginRight: -4 }}><X size={20} strokeWidth={1.9} aria-hidden="true" /></button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px max(28px, env(safe-area-inset-bottom))", display: "grid", gridTemplateColumns: "minmax(0,1fr)", gridAutoRows: "max-content", gap: 10 }}>
        {children}
      </div>
    </Sheet>
  );
}

/** Sticky taupe TOTAL card of a list sheet, with the sort / filter button (dot = a sort or filter is active). */
export function GTotalBar({
  total, count, note, onMenu, menuOpen, active,
}: { total: ReactNode; count: ReactNode; note?: ReactNode; onMenu: () => void; menuOpen: boolean; active: boolean }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "linear-gradient(150deg,#6B5C32,#8B7A4E)", boxShadow: "0 10px 22px -12px rgba(107,92,50,.7)" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: "#E9D9A8" }}>TOTAL</span>
        <span style={{ display: "block", fontSize: 20, fontWeight: 800, letterSpacing: -0.4, color: "#FFFFFF", marginTop: 2, whiteSpace: "nowrap", ...TNUM }}>{total}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "#F0E6CC", marginTop: 1 }}>{count}</span>
        {note ? <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#F1D58A", marginTop: 1, ...TNUM }}>{note}</span> : null}
      </span>
      <button type="button" onClick={onMenu} aria-label="Sort and filter" aria-expanded={menuOpen} style={{ position: "relative", flex: "none", width: 42, height: 42, borderRadius: "50%", border: "none", background: "rgba(255,255,255,.18)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", cursor: "pointer", padding: 0 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /></svg>
        {active ? <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 7, width: 8, height: 8, borderRadius: "50%", background: "#F1D58A", boxShadow: "0 0 0 2px #7A6A3E" }} /> : null}
      </button>
    </div>
  );
}

/** White list card of a sheet (rows 56px). */
export const GListCard = ({ children }: { children: ReactNode }) => (
  <div style={{ background: M.card, borderRadius: 16, boxShadow: "0 1px 2px rgba(31,29,27,.05),0 8px 22px -12px rgba(31,29,27,.18)", padding: "0 13px", overflow: "hidden" }}>{children}</div>
);

/** Sort / filter option chip (selected = taupe). */
export const GOption = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
  <button type="button" aria-pressed={on} onClick={onClick} style={{ flex: "none", height: 32, padding: "0 12px", borderRadius: 999, border: "none", background: on ? M.taupe : M.card, color: on ? M.paper : M.raisin, boxShadow: `inset 0 0 0 1px ${M.hairline}`, fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}>{label}</button>
);

/** The taupe "Open … →" destination button at the bottom of a sheet. */
export function GLinkButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ height: 48, border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, background: M.taupe, color: M.paper, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 18px -10px rgba(107,92,50,.7)" }}>
      <Icon size={16} strokeWidth={2} aria-hidden="true" />{label}<ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}

/** v12 row chevron: 14px, #8B7A4E (kept in the layout when `hidden`, so columns line up). */
export function Chev({ hidden }: { hidden?: boolean }) {
  return (
    <span style={{ flex: "none", width: 14, display: "flex", justifyContent: "flex-end", color: "#8B7A4E", visibility: hidden ? "hidden" : "visible" }}>
      <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

/** A table cell: a value, optionally with a second small line (v12 "value + units/sets"). */
export type Cell = ReactNode | { v: ReactNode; v2?: ReactNode };
const isTwoLine = (c: Cell): c is { v: ReactNode; v2?: ReactNode } => typeof c === "object" && c !== null && "v" in (c as object) && !("props" in (c as object));

/** v12 sheet table: 11px taupe uppercase header, first column bold, rows min 48px, fixed-width columns. */
export function GTable({ grid, head, rows, empty = "Nothing here." }: { grid: string; head: string[]; rows: Cell[][]; empty?: string }) {
  const align = (i: number): CSSProperties["textAlign"] => (i ? "right" : "left");
  return (
    <SheetCard pad="2px 12px">
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, padding: "12px 0 8px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: M.taupe, textTransform: "uppercase" }}>
        {head.map((h, i) => <span key={h + i} style={{ textAlign: align(i), minWidth: 0 }}>{h}</span>)}
      </div>
      {rows.length === 0 ? <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: M.ink }}>{empty}</div> : null}
      {rows.map((r, ri) => (
        <div key={ri} style={{ display: "grid", gridTemplateColumns: grid, gap: 8, alignItems: "center", minHeight: 48, borderTop: `1px solid ${M.divider}`, fontSize: 13, color: M.raisin }}>
          {r.map((c, i) => {
            const two = isTwoLine(c);
            const v = two ? c.v : c;
            const v2 = two ? c.v2 : null;
            return (
              <span key={i} style={{ textAlign: align(i), minWidth: 0, padding: "6px 0" }}>
                <span style={{ display: "block", fontWeight: i === 0 || v2 ? 700 : 500, fontSize: i === 0 ? 13.5 : 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...TNUM }}>{v}</span>
                {v2 ? <span style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: M.ink, marginTop: 2, whiteSpace: "nowrap", ...TNUM }}>{v2}</span> : null}
              </span>
            );
          })}
        </div>
      ))}
    </SheetCard>
  );
}
