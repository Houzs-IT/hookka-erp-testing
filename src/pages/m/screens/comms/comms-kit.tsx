// ---------------------------------------------------------------------------
// The Batch 2 communication kit (Announcements and IT Support now; Meetings and
// Mail Centre will reuse it). Drawn to the approved Claude Design prototypes'
// own sizes, radii and spacing; every colour is a --c-* variable from
// comms-theme.css, so light mode is the prototype exactly and dark mode follows
// the /m dark palette without touching the shared theme files.
//
// The kit only draws. It never fetches, decides a permission or computes a
// business value: the screens pass in what the server said.
//
// Full-screen layers (confirm dialog, media viewer) live in comms-overlay.tsx;
// toasts and bottom bars sit on the shared ResponsiveActionDock.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ListFilter, Plus, Search, X, type LucideIcon } from "lucide-react";
import { MenuButton, ResponsiveActionDock, Sheet } from "../../components";
import { useNavDrawer } from "../../lib/nav-drawer";
import { PaneProvider, estimatePaneWidths, resolveContainerLayout, useObservedWidth, useResponsiveLayout } from "../../lib/responsive-layout";
import "./comms-theme.css";

// ---- palette (CSS variables; values in comms-theme.css) --------------------------
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const C = {
  ink: "var(--c-ink)",
  body: "var(--c-body)",
  muted: "var(--c-muted)",
  faint: "var(--c-faint)",
  chev: "var(--c-chev)",
  paper: "var(--c-paper)",
  card: "var(--c-card)",
  cream: "var(--c-cream)",
  track: "var(--c-track)",
  line: "var(--c-line)",
  hair: "var(--c-hair)",
  grabber: "var(--c-grabber)",
  gold: "var(--c-gold)",
  goldMid: "var(--c-gold-mid)",
  sand: "var(--c-sand)",
  tint: "var(--c-tint)",
  chipText: "var(--c-chip-text)",
  note: "var(--c-note)",
  onAccent: "var(--c-on-accent)",
  grad: "var(--c-grad)",
  gradTile: "var(--c-grad-tile)",
  gradOk: "var(--c-grad-ok)",
  barOk: "var(--c-bar-ok)",
  dashBg: "var(--c-dash-bg)",
  rowOn: "var(--c-row-on)",
  divider: "var(--c-divider)",
  skel: "var(--c-skel)",
  green: "var(--c-green)", greenBg: "var(--c-green-bg)", greenRing: "var(--c-green-ring)", greenInk: "var(--c-green-ink)",
  red: "var(--c-red)", redBg: "var(--c-red-bg)", redRing: "var(--c-red-ring)",
  amber: "var(--c-amber)", amberBg: "var(--c-amber-bg)",
  grey: "var(--c-grey)", greyBg: "var(--c-grey-bg)",
  teal: "var(--c-teal)", tealBg: "var(--c-teal-bg)",
  plum: "var(--c-plum)", plumBg: "var(--c-plum-bg)",
} as const;

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const SH = {
  card: "var(--c-sh-card)",
  cardUnread: "var(--c-sh-card-unread)",
  field: "var(--c-sh-field)",
  panel: "var(--c-sh-panel)",
  info: "var(--c-sh-info)",
  ring: "var(--c-sh-ring)",
  chip: "var(--c-sh-chip)",
  chipOn: "var(--c-sh-chip-on)",
  segOn: "var(--c-sh-seg-on)",
  primary: "var(--c-sh-primary)",
  cta: "var(--c-sh-cta)",
  ghost: "var(--c-sh-ghost)",
  secondary: "var(--c-sh-secondary)",
  glass: "var(--c-glass-sh)",
} as const;

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TAP: CSSProperties = { WebkitTapHighlightColor: "transparent" };

/** Reset for every <button> the kit draws. */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const BTN: CSSProperties = { border: "none", padding: 0, fontFamily: "inherit", cursor: "pointer", ...TAP };

// ---- the screen ----------------------------------------------------------------
/** Root of a comms screen: paper background, prototype font and text colour. */
export function CommsScreen({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ minHeight: "100%", background: C.paper, color: C.ink, fontFamily: FONT, WebkitFontSmoothing: "antialiased", ...style }}>
      {children}
    </div>
  );
}

/**
 * List | detail side by side on a tablet / unfolded foldable — the shell's own
 * TwoPane geometry (MobileLayout.tsx), for a screen that is not a module
 * config (IT Support). Each pane gets its PaneProvider, so docks and toasts
 * with scope "auto" land under the right pane.
 */
export function CommsSplit({ left, right }: { left: ReactNode; right: ReactNode }) {
  const estimate = estimatePaneWidths(useResponsiveLayout());
  const [leftRef, leftWidth] = useObservedWidth<HTMLDivElement>(estimate.list);
  const [rightRef, rightWidth] = useObservedWidth<HTMLDivElement>(estimate.detail);
  const leftPane = useMemo(() => resolveContainerLayout(leftWidth, "list"), [leftWidth]);
  const rightPane = useMemo(() => resolveContainerLayout(rightWidth, "detail"), [rightWidth]);
  return (
    <div data-comms-split-view style={{ display: "flex", height: "100dvh", overflow: "hidden", background: C.paper }}>
      <div ref={leftRef} style={{ width: "clamp(320px, 38%, 340px)", flex: "none", borderRight: `1px solid ${C.line}`, overflowY: "auto", overflowX: "hidden" }}>
        <PaneProvider value={leftPane}>{left}</PaneProvider>
      </div>
      <div ref={rightRef} style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden" }}>
        <PaneProvider value={rightPane}>{right}</PaneProvider>
      </div>
    </div>
  );
}

/** Content column: full width on a phone, a readable centred column on wider panes. */
export function Column({ children, max = 720, style }: { children: ReactNode; max?: number; style?: CSSProperties }) {
  return <div style={{ width: "100%", maxWidth: max, margin: "0 auto", boxSizing: "border-box", ...style }}>{children}</div>;
}

/**
 * The list header (prototype: 52px, menu, 18px title, round gold +). On a phone
 * the hamburger opens the shell's NavDrawer; on a tablet the LeftRail is the
 * navigation, so the slot is empty (or a back arrow when `onBack` is given).
 */
export function CommsHeader({ title, badge, trailing, onBack }: { title: string; badge?: ReactNode; trailing?: ReactNode; onBack?: () => void }) {
  const phone = useResponsiveLayout().mode === "phone";
  const drawer = useNavDrawer();
  const showMenu = phone && drawer !== null;
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper, paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, height: 52, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
        {showMenu ? <MenuButton /> : onBack ? <BackButton onClick={onBack} label="Back" /> : <span style={{ width: 6 }} />}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.2px", lineHeight: "24px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
          {badge}
        </div>
        {trailing}
      </div>
    </header>
  );
}

/** Sub-page header: back chevron + title (+ optional right slot). */
export function PageBar({ title, onBack, backLabel, right, sticky = true }: { title: ReactNode; onBack: () => void; backLabel: string; right?: ReactNode; sticky?: boolean }) {
  return (
    <div style={{ position: sticky ? "sticky" : undefined, top: 0, zIndex: 20, background: C.paper, paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 52, padding: "0 16px" }}>
        <BackButton onClick={onBack} label={backLabel} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: C.ink, ...NUM }}>{title}</div>
        {right}
      </div>
    </div>
  );
}

/** Form header: Cancel · centred title · spacer, hairline below. */
export function FormBar({ title, onCancel, cancelDisabled }: { title: string; onCancel: () => void; cancelDisabled?: boolean }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.paper, paddingTop: "env(safe-area-inset-top)", borderBottom: `1px solid ${C.hair}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 52, padding: "0 16px" }}>
        <button type="button" onClick={onCancel} disabled={cancelDisabled} style={{ ...BTN, height: 44, marginLeft: -6, padding: "0 6px", background: "none", fontSize: 14, fontWeight: 600, color: C.muted, opacity: cancelDisabled ? 0.5 : 1 }}>
          Cancel
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 16, fontWeight: 700 }}>{title}</div>
        <span style={{ width: 56 }} />
      </div>
    </div>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} style={{ ...BTN, width: 44, height: 44, marginLeft: -10, background: "none", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", color: C.ink }}>
      <ChevronLeft size={22} strokeWidth={2} />
    </button>
  );
}

/** The round 42px gold "+" in a 44px target. */
export function RoundPlus({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="c-press" style={{ ...BTN, width: 44, height: 44, flex: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 42, height: 42, borderRadius: "50%", background: C.grad, color: C.onAccent, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SH.primary }}>
        <Plus size={20} strokeWidth={2.2} />
      </span>
    </button>
  );
}

/** Small red count badge (header unread). */
export function CountBadge({ n, label }: { n: number; label: string }) {
  if (n <= 0) return null;
  return (
    <span aria-label={label} style={{ minWidth: 18, height: 18, boxSizing: "border-box", padding: "0 5px", borderRadius: 999, background: C.red, color: C.onAccent, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", ...NUM }}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

// ---- search, chips, segmented, filter ------------------------------------------
export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label style={{ flex: 1, minWidth: 0, height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: C.card, borderRadius: 14, boxShadow: SH.field }}>
      <Search size={18} strokeWidth={1.75} color="var(--c-faint)" aria-hidden />
      <input
        className="c-input"
        type="text"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: C.ink, padding: 0 }}
      />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} style={{ ...BTN, width: 36, height: 36, flex: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: C.track, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={13} strokeWidth={2.4} color="var(--c-muted)" />
          </span>
        </button>
      ) : null}
    </label>
  );
}

/** Filter chip (34px) — on: gold fill, white text. */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function chipStyle(on: boolean): CSSProperties {
  return {
    background: on ? "#6B5C32" : C.card,
    color: on ? "#FFFFFF" : C.chipText,
    boxShadow: on ? SH.chipOn : SH.chip,
    fontWeight: on ? 700 : 600,
  };
}

export function Chip({ on, label, count, dot, onClick, role = "button", height = 34 }: { on: boolean; label: string; count?: number | string; dot?: string; onClick: () => void; role?: "button" | "checkbox"; height?: number }) {
  return (
    <button
      type="button"
      role={role === "checkbox" ? "checkbox" : undefined}
      aria-pressed={role === "button" ? on : undefined}
      aria-checked={role === "checkbox" ? on : undefined}
      onClick={onClick}
      style={{ ...BTN, ...chipStyle(on), flex: "none", height, padding: "0 13px", borderRadius: 999, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
    >
      {dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, boxShadow: on ? "0 0 0 1.5px #FFFFFF" : "none" }} /> : null}
      {label}
      {count != null ? <span style={{ opacity: 0.8, ...NUM }}>{count}</span> : null}
    </button>
  );
}

export type SegItem<K extends string> = { key: K; label: ReactNode; count?: number | string; dot?: string };

/** Segmented control on a track (44px default, 46px for the IT tabs). */
export function Segmented<K extends string>({ items, value, onChange, height = 44, radius = 12, label, role = "group" }: { items: SegItem<K>[]; value: K; onChange: (k: K) => void; height?: number; radius?: number; label: string; role?: "group" | "radiogroup" }) {
  return (
    <div role={role} aria-label={label} style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 4, height, boxSizing: "border-box", padding: 4, borderRadius: radius, background: C.track }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role={role === "radiogroup" ? "radio" : undefined}
            aria-checked={role === "radiogroup" ? on : undefined}
            aria-pressed={role === "group" ? on : undefined}
            onClick={() => onChange(it.key)}
            style={{ ...BTN, height: "100%", borderRadius: radius - 3, background: on ? C.card : "transparent", color: on ? C.ink : C.body, fontWeight: on ? 700 : 600, boxShadow: on ? SH.segOn : "none", fontSize: 13, whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0 }}
          >
            {it.dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: it.dot }} /> : null}
            {it.label}
            {it.count != null && it.count !== "" ? <span style={{ opacity: 0.8, ...NUM }}>{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Round filter button with the active-count dot. */
export function FilterButton({ count, onClick, size = 38 }: { count: number; onClick: () => void; size?: number }) {
  const on = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? `Filter, ${count} on` : "Filter"}
      title="Filter"
      aria-haspopup="dialog"
      style={{ ...BTN, position: "relative", width: size, height: size, borderRadius: "50%", flex: "none", background: on ? "#6B5C32" : C.card, color: on ? "#FFFFFF" : C.gold, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: on ? SH.chipOn : SH.field }}
    >
      <ListFilter size={16} strokeWidth={1.9} />
      {on ? (
        <span aria-hidden style={{ position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: C.red, color: "#FFFFFF", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px var(--c-paper)" }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** "6 POSTED ———" section label with an optional right slot. */
export function CountLine({ label, right, style }: { label: string; right?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, ...style }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold, whiteSpace: "nowrap", ...NUM }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: C.divider }} />
      {right}
    </div>
  );
}

// ---- pills ----------------------------------------------------------------------
export function Pill({ label, fg, bg, dot = true, icon: Icon, h = 20, size = 10.5, title }: { label: ReactNode; fg: string; bg: string; dot?: boolean; icon?: LucideIcon; h?: number; size?: number; title?: string }) {
  return (
    <span title={title} style={{ height: h, display: "inline-flex", alignItems: "center", gap: Icon ? 4 : 5, padding: "0 8px", borderRadius: 999, background: bg, color: fg, fontSize: size, fontWeight: 700, whiteSpace: "nowrap", flex: "none", ...NUM }}>
      {Icon ? <Icon size={size + 0.5} strokeWidth={2.2} /> : dot ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: fg }} /> : null}
      {label}
    </span>
  );
}

// ---- cards, states, skeleton -------------------------------------------------------
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const CARD: CSSProperties = { background: C.card, borderRadius: 18, boxShadow: SH.card };
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const PANEL: CSSProperties = { background: C.card, borderRadius: 18, boxShadow: SH.panel, overflow: "hidden" };
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const GLASS: CSSProperties = { borderRadius: 22, padding: 16, background: "var(--c-glass-bg)", boxShadow: SH.glass, backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)" };

/** Grid of list cards: one column on a phone, more where the pane is wide. */
export function CardGrid({ children, min = 320, style }: { children: ReactNode; min?: number; style?: CSSProperties }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`, gap: 10, ...style }}>{children}</div>;
}

export function StateCard({ icon: Icon, tone = "gold", title, text, action, role }: { icon: LucideIcon; tone?: "gold" | "red"; title?: string; text?: ReactNode; action?: ReactNode; role?: "alert" | "status" }) {
  const red = tone === "red";
  return (
    <div role={role} style={{ padding: "28px 20px", borderRadius: 20, background: C.card, boxShadow: red ? `0 0 0 1px var(--c-red-ring)` : SH.card, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <span style={{ width: 48, height: 48, borderRadius: 15, background: red ? C.redBg : C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={21} strokeWidth={1.8} color={red ? "var(--c-red)" : "var(--c-gold)"} />
      </span>
      {title ? <div style={{ fontSize: red ? 15 : 14.5, fontWeight: 700, color: C.ink }}>{title}</div> : null}
      {text ? <div style={{ fontSize: 13, lineHeight: 1.45, color: C.body, maxWidth: 320 }}>{text}</div> : null}
      {action}
    </div>
  );
}

export function Skeletons({ n = 3, h = 112, label }: { n?: number; h?: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label} style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="c-anim" style={{ height: h, borderRadius: 18, background: C.skel, boxShadow: SH.card, animation: "c-pulse 1.2s ease-in-out infinite" }} />
      ))}
    </div>
  );
}

export function Spinner({ size = 10, color = "var(--c-gold)" }: { size?: number; color?: string }) {
  return <span aria-hidden className="c-anim" style={{ width: size, height: size, flex: "none", borderRadius: "50%", border: `2px solid var(--c-line)`, borderTopColor: color, animation: "c-spin .8s linear infinite", boxSizing: "border-box", display: "inline-block" }} />;
}

/** Amber info note (ⓘ + text). */
export function InfoNote({ icon: Icon, children, style }: { icon: LucideIcon; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11.5, lineHeight: 1.45, color: C.note, ...style }}>
      <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><Icon size={14} strokeWidth={2} color="var(--c-note)" /></span>
      <span>{children}</span>
    </div>
  );
}

/** Red alert box (form errors). */
export function ErrorBox({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div role="alert" style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5, lineHeight: 1.45 }}>
      <span style={{ flex: "none", display: "flex", paddingTop: 1 }}><Icon size={16} strokeWidth={2} /></span>
      <span>{children}</span>
    </div>
  );
}

// ---- buttons ------------------------------------------------------------------------
export function PrimaryButton({ children, onClick, disabled, busy, height = 50, icon: Icon, style, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; height?: number; icon?: LucideIcon; style?: CSSProperties; type?: "button" | "submit" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      style={{ ...BTN, width: "100%", height, borderRadius: 14, background: C.grad, color: "#FFFFFF", fontSize: 15, fontWeight: 700, opacity: busy ? 0.7 : disabled ? 0.55 : 1, cursor: disabled || busy ? "default" : "pointer", boxShadow: SH.cta, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, ...style }}
    >
      {busy ? <Spinner size={14} color="#FFFFFF" /> : Icon ? <Icon size={17} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled, height = 46, style }: { children: ReactNode; onClick?: () => void; disabled?: boolean; height?: number; style?: CSSProperties }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...BTN, width: "100%", height, borderRadius: 12, background: C.card, color: C.body, fontSize: 14, fontWeight: 700, boxShadow: SH.ring, opacity: disabled ? 0.55 : 1, ...style }}>
      {children}
    </button>
  );
}

/** Ghost pill (white glass, gold text) — "See all", "Clear search", … */
export function GhostButton({ children, onClick, height = 42, style }: { children: ReactNode; onClick: () => void; height?: number; style?: CSSProperties }) {
  return (
    <button type="button" onClick={onClick} style={{ ...BTN, height, padding: "0 16px", borderRadius: 999, background: "var(--c-ghost-bg)", boxShadow: SH.ghost, color: C.gold, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, ...style }}>
      {children}
    </button>
  );
}

// ---- form fields ------------------------------------------------------------------------
export function FieldHead({ label, htmlFor, required, optional, right }: { label: string; htmlFor?: string; required?: boolean; optional?: boolean; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>
        {label}
        {required ? <span style={{ color: C.red }}> *</span> : null}
        {optional ? <span style={{ fontWeight: 500, color: C.faint }}> optional</span> : null}
      </label>
      {right}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function fieldStyle(invalid = false): CSSProperties {
  return { width: "100%", boxSizing: "border-box", borderRadius: 12, border: "none", background: C.card, boxShadow: invalid ? "0 0 0 1.5px var(--c-red)" : SH.ring, fontFamily: "inherit", fontSize: 16, color: C.ink, outline: "none" };
}

export function Counter({ text, warn }: { text: string; warn?: boolean }) {
  return <span style={{ fontSize: 11, color: warn ? C.red : C.faint, ...NUM }}>{text}</span>;
}

export function FieldError({ children }: { children: ReactNode }) {
  return <div style={{ marginTop: 5, fontSize: 11.5, color: C.red }}>{children}</div>;
}

export function Switch({ on }: { on: boolean }) {
  return (
    <span aria-hidden style={{ width: 44, height: 26, flex: "none", borderRadius: 999, background: on ? "#6B5C32" : "var(--c-sand)", position: "relative", transition: "background .15s" }} className="c-anim">
      <span className="c-anim" style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(31,29,27,.3)", transition: "left .15s" }} />
    </span>
  );
}

/** Dashed "Add files" button. */
export function DashedButton({ icon: Icon, children, onClick, disabled }: { icon: LucideIcon; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...BTN, height: 46, borderRadius: 12, border: "1.5px dashed var(--c-sand)", background: C.dashBg, color: C.gold, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: disabled ? 0.55 : 1 }}>
      <Icon size={16} strokeWidth={2} />
      {children}
    </button>
  );
}

// ---- bottom sheet (the shared Sheet, drawn as the prototype) -------------------------------
export function CommsSheet({ open, onClose, title, sub, children, footer }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} bare portal panelStyle={{ background: C.paper, color: C.ink, fontFamily: FONT, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}><div style={{ width: 40, height: 4, borderRadius: 999, background: C.grabber }} /></div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 6px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{sub}</div> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ ...BTN, width: 40, height: 40, margin: "-6px -8px 0 0", background: "none", display: "flex", alignItems: "center", justifyContent: "center", color: C.faint }}>
          <X size={20} strokeWidth={1.9} />
        </button>
      </div>
      <div className="c-scroll" style={{ overflowY: "auto", flex: "1 1 auto" }}>{children}</div>
      {footer}
    </Sheet>
  );
}

/** Sheet footer: Reset · Apply. */
export function SheetFooter({ onReset, onApply, applyLabel }: { onReset: () => void; onApply: () => void; applyLabel: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 18, padding: "12px 16px calc(16px + env(safe-area-inset-bottom))", boxShadow: "0 -1px 0 var(--c-line)" }}>
      <button type="button" onClick={onReset} style={{ ...BTN, flex: 1, height: 46, borderRadius: 12, background: C.card, color: C.body, fontSize: 14, fontWeight: 700, boxShadow: SH.ring }}>Reset</button>
      <button type="button" onClick={onApply} style={{ ...BTN, flex: 1, height: 46, borderRadius: 12, background: C.grad, color: "#FFFFFF", fontSize: 14, fontWeight: 700 }}>{applyLabel}</button>
    </div>
  );
}

/** A big option row in a picker sheet (Camera / Library / Files). */
export function PickRow({ icon: Icon, label, sub, fg, bg, onClick }: { icon: LucideIcon; label: string; sub: string; fg: string; bg: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...BTN, display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "10px 14px", borderRadius: 14, background: C.card, boxShadow: SH.ring, textAlign: "left", width: "100%" }}>
      <span style={{ width: 36, height: 36, flex: "none", borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={18} strokeWidth={1.9} color={fg} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.ink }}>{label}</span>
        <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{sub}</span>
      </span>
    </button>
  );
}

// ---- bottom bars + toast on the shared ResponsiveActionDock -------------------------------
/**
 * A bar pinned above the phone tab bar (or at the bottom of the tablet pane),
 * e.g. the composer's Post button or the IT reply box. The page must leave room
 * for it (`DOCK_PAD`).
 */
// The height of the BottomBar on screen right now (0 = none), so a toast can sit above it
// instead of covering it. One bar per page; module-level so the toast needs no context.
let barHeight = 0;
const barListeners = new Set<(h: number) => void>();
function publishBar(h: number) {
  barHeight = h;
  barListeners.forEach((f) => f(h));
}

export function BottomBar({ children, background = "var(--c-paper)" }: { children: ReactNode; background?: string }) {
  const phone = useResponsiveLayout().mode === "phone";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => publishBar(el.offsetHeight));
    ro.observe(el);
    publishBar(el.offsetHeight);
    return () => {
      ro.disconnect();
      publishBar(0);
    };
  }, []);
  return (
    <ResponsiveActionDock scope="auto" phoneBottom={phone ? 56 : 0} zIndex={30}>
      <div ref={ref} style={{ pointerEvents: "auto", width: "100%", maxWidth: phone ? 414 : 760, background, boxShadow: "0 -1px 0 var(--c-line)", boxSizing: "border-box" }}>{children}</div>
    </ResponsiveActionDock>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((m: string) => {
    clearTimeout(timer.current);
    setMsg(m);
    timer.current = setTimeout(() => setMsg(""), 2600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [bar, setBar] = useState(barHeight);
  useEffect(() => {
    barListeners.add(setBar);
    return () => {
      barListeners.delete(setBar);
    };
  }, []);
  // Above the tab bar (phone) or the pane's bottom (tablet), and above a BottomBar when one is showing.
  const node = msg ? (
    <ResponsiveActionDock scope="auto" phoneBottom={bar ? Math.max(104, 56 + bar + 12) : 104} tabletBottom={bar ? Math.max(84, bar + 12) : 84} zIndex={90}>
      <div role="status" style={{ maxWidth: "min(358px, calc(100% - 32px))", background: "var(--c-toast-bg)", color: "var(--c-toast-fg)", fontFamily: FONT, fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, padding: "10px 14px", borderRadius: 12, boxShadow: "0 10px 30px -10px rgba(31,29,27,.5)", pointerEvents: "auto" }}>
        {msg}
      </div>
    </ResponsiveActionDock>
  ) : null;
  return [node, show];
}

// ---- dates -------------------------------------------------------------------------------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const asDate = (v: string | number | Date | null | undefined): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** "26 Nov 2026" */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function fmtDate(v: string | number | Date | null | undefined): string {
  const d = asDate(v);
  return d ? `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : "—";
}
/** "26 Nov" */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function fmtDay(v: string | number | Date | null | undefined): string {
  const d = asDate(v);
  return d ? `${d.getDate()} ${MON[d.getMonth()]}` : "—";
}
/** "10:40" */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function fmtTime(v: string | number | Date | null | undefined): string {
  const d = asDate(v);
  return d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
}
/** "5 min ago" / "3 h ago" / "Yesterday" / "4 days ago" / "12 Nov". */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function fmtAgo(v: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = asDate(v);
  if (!d) return "—";
  const m = Math.floor((now - d.getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "Yesterday" : days < 7 ? `${days} days ago` : fmtDay(d);
}

/** Two-letter initials + one of five avatar tones, picked from the name. */
const AV = [["var(--c-cream)", "var(--c-gold)"], ["var(--c-teal-bg)", "var(--c-teal)"], ["var(--c-green-bg)", "var(--c-green)"], ["var(--c-amber-bg)", "var(--c-amber)"], ["var(--c-plum-bg)", "var(--c-plum)"]] as const;
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function avatarOf(name: string): { ini: string; bg: string; fg: string } {
  const clean = (name || "?").trim() || "?";
  const c = AV[[...clean].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV.length];
  return { ini: clean.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase(), bg: c[0], fg: c[1] };
}
