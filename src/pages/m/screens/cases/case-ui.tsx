// Presentational pieces shared by the Service Cases screens, built from the approved Phase 4
// prototype's exact styles (card anatomy, pills, chips, 8-segment stage bar, section labels,
// segmented control, state cards). Status / stage / category tints come from case-model.
import { type CSSProperties, type ReactNode } from "react";
import { Info, type LucideIcon } from "lucide-react";
import { M } from "../../theme";
import { CASE_PIPELINE_STEPS, DEFAULT_TONE } from "./case-model";
import { CC, SH_CARD, SH_CTRL, SH_FIELD, SH_ON, SH_PRIMARY, SH_ROUND, SH_SEG } from "./case-style";

type Tone = { bg: string; fg: string };

/** Status / order pill: 22px, optional leading dot (prototype `pill`). */
export function Pill({ label, tone, dot }: { label: string; tone: Tone; dot?: string; size?: "sm" | "md" }) {
  return (
    <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: dot ? "0 9px" : "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", background: tone.bg, color: tone.fg }}>
      {dot ? <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} /> : null}
      {label}
    </span>
  );
}

/** Small rounded tag: 22px (prototype category / type / part chips). */
export function Tag({ label, tone = DEFAULT_TONE, upper, h = 22, weight = 700 }: { label: string; tone?: Tone; upper?: boolean; h?: number; weight?: number }) {
  return (
    <span style={{ height: h, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 6, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: weight, letterSpacing: upper ? ".3px" : 0, textTransform: upper ? "uppercase" : "none", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

/** Key / value reference chip ("SO  SO-2610-019"). */
export function RefChip({ k, v, h = 22, fs = 11, r = 7, onClick, icon }: { k: string; v: string; h?: number; fs?: number; r?: number; onClick?: () => void; icon?: ReactNode }) {
  const body = (
    <>
      <span style={{ color: "#6B6252" }}>{k}</span>
      <span style={{ fontWeight: 700, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
      {icon}
    </>
  );
  const style: CSSProperties = { maxWidth: "100%", height: h, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: h > 22 ? 5 : 4, padding: h > 22 ? "0 9px" : "0 8px", borderRadius: r, background: CC.tile, fontSize: fs, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums", border: "none", fontFamily: "inherit" };
  return onClick ? <button type="button" onClick={onClick} style={{ ...style, cursor: "pointer" }}>{body}</button> : <span style={style}>{body}</span>;
}

/** 8 segments; filled up to `index`, all grey when cancelled. */
export function StageBar({ index, cancelled, h = 5 }: { index: number; cancelled?: boolean; h?: number }) {
  return (
    <div aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(8,minmax(0,1fr))", gap: 3 }}>
      {CASE_PIPELINE_STEPS.map((s, i) => (
        <span key={s} style={{ height: h, borderRadius: 999, background: !cancelled && i <= index ? CC.brown : CC.track }} />
      ))}
    </div>
  );
}

/** Beige "Edit" pill with the pencil (prototype `PencilLine`). */
export function EditPill({ onClick, label = "Edit", aria }: { onClick: () => void; label?: string; aria?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={aria ?? label} style={{ flex: "none", height: 30, padding: "0 11px", border: "none", borderRadius: 999, background: CC.tile, color: CC.brown, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, WebkitTapHighlightColor: "transparent" }}>
      <PencilIcon />{label}
    </button>
  );
}
function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" /><path d="m15 5 3 3" />
    </svg>
  );
}

/** 11px brown letter-spaced section label with an optional count and right-hand slot. */
export function SectionLabel({ children, count, right, hint }: { children: ReactNode; count?: number | string; right?: ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 10px" }}>
      <span style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: "1px", color: CC.brown, textTransform: "uppercase" }}>
        {children}{count !== undefined ? ` · ${count}` : ""}
      </span>
      {hint ? <span style={{ fontSize: 11.5, color: M.ink }}>{hint}</span> : null}
      {right}
    </div>
  );
}

export function Card({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "14px 15px", cursor: clickable ? "pointer" : undefined, WebkitTapHighlightColor: "transparent", minWidth: 0, ...style }}
    >
      {children}
    </div>
  );
}

/** Centered note card used for empty lists inside a section ("No photos…"). */
export function EmptyCard({ children }: { children: ReactNode }) {
  return <div style={{ background: M.card, borderRadius: 16, boxShadow: SH_CARD, padding: "18px 16px", textAlign: "center", fontSize: 13, color: M.ink }}>{children}</div>;
}

/** Full-page state (forbidden / error / empty): icon tile, title, text, optional action. */
export function Msg({ text, sub, action, icon: Icon, tone = "neutral", card = true }: { text: string; sub?: string; action?: ReactNode; icon?: LucideIcon; tone?: "neutral" | "danger"; card?: boolean }) {
  const I = Icon ?? Info;
  const tile = tone === "danger" ? { bg: "#F9E1DA", fg: CC.danger } : { bg: CC.sep, fg: CC.brown };
  if (!card) {
    return (
      <div role="status" style={{ padding: "44px 18px 120px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <span style={{ width: 52, height: 52, borderRadius: 16, background: CC.sep, display: "flex", alignItems: "center", justifyContent: "center" }}><I size={22} strokeWidth={1.75} color={CC.brownSoft} /></span>
        <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin }}>{text}</div>
        {sub ? <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, maxWidth: 280 }}>{sub}</div> : null}
        {action}
      </div>
    );
  }
  return (
    <div role="alert" style={{ margin: "40px 18px", background: M.card, borderRadius: 18, padding: "28px 22px", textAlign: "center", boxShadow: SH_CARD }}>
      <div style={{ width: 48, height: 48, margin: "0 auto", borderRadius: "50%", background: tile.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><I size={22} strokeWidth={1.9} color={tile.fg} /></div>
      <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, marginTop: 14 }}>{text}</div>
      {sub ? <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>{sub}</div> : null}
      {action ? <div style={{ marginTop: 18 }}>{action}</div> : null}
    </div>
  );
}

/** Note banner (icon + text on a tinted rounded box). */
export function Note({ children, icon: Icon = Info, bg = CC.tile, fg = CC.brown, color }: { children: ReactNode; icon?: LucideIcon; bg?: string; fg?: string; color?: string }) {
  return (
    <div role="note" style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, background: bg, fontSize: 12.5, lineHeight: 1.45, color: color ?? M.ink }}>
      <span style={{ flex: "none", marginTop: 2, display: "flex" }}><Icon size={14} strokeWidth={2} color={fg} /></span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

export const Caption = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 11.5, color: CC.hint, marginTop: 8, padding: "0 2px" }}>{children}</div>;

export function Btn({ children, onClick, kind = "primary", disabled, icon, full, danger, h = 44 }: { children: ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "ghost"; disabled?: boolean; icon?: ReactNode; full?: boolean; danger?: boolean; h?: number }) {
  const primary = kind === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: h, minWidth: 44, padding: "0 14px", borderRadius: 12, border: "none",
        background: primary ? (danger ? "#9A3A2D" : M.taupe) : M.card,
        color: primary ? "var(--m-text-on-accent)" : danger ? CC.danger : M.taupe,
        fontFamily: "inherit", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, width: full ? "100%" : undefined, whiteSpace: "nowrap",
        boxShadow: primary ? SH_PRIMARY : SH_CTRL, WebkitTapHighlightColor: "transparent",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/** 42px round header button (white, brown glyph) — or the brown gradient "+" when `primary`. */
export function IconBtn({ children, label, onClick, disabled, primary }: { children: ReactNode; label: string; onClick?: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 42, height: 42, borderRadius: "50%", border: "none", flex: "none", padding: 0,
        background: primary ? "linear-gradient(135deg,#8B7A4E,#6B5C32)" : M.card,
        color: primary ? "#FFFFFF" : M.taupe,
        boxShadow: primary ? "0 8px 18px -8px rgba(107,92,50,.65),inset 0 1px 0 rgba(255,255,255,.18)" : SH_ROUND,
        display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

/** Pill chip: 34px, solid brown when on (prototype status / tab / filter chips). */
export function Chip({ label, on, onClick, count, dot, h = 34, fs = 12.5, role, pad = 13 }: { label: string; on: boolean; onClick: () => void; count?: number | string; dot?: string; h?: number; fs?: number; role?: string; pad?: number }) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : on}
      aria-selected={role === "tab" ? on : undefined}
      aria-checked={role === "radio" || role === "checkbox" ? on : undefined}
      onClick={onClick}
      style={{
        flex: "none", height: h, boxSizing: "border-box", padding: `0 ${pad}px`, borderRadius: 999, border: "none", cursor: "pointer", whiteSpace: "nowrap",
        display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: fs, fontWeight: on ? 700 : 600,
        background: on ? CC.brown : M.card, color: on ? "#FFFFFF" : CC.chipText, boxShadow: on ? SH_ON : SH_CTRL, WebkitTapHighlightColor: "transparent",
      }}
    >
      {dot ? <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: dot, boxShadow: on ? "0 0 0 1.5px rgba(255,255,255,.85)" : "none" }} /> : null}
      {label}
      {count !== undefined ? <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>{count}</span> : null}
    </button>
  );
}

/** 3-way segmented control on a grey track (prototype source type / RM-WIP-FG). */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "grid", gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))`, gap: 4, height: 44, boxSizing: "border-box", padding: 4, borderRadius: 12, background: CC.sep }}>
      {options.map(([k, l]) => {
        const on = value === k;
        return (
          <button key={k} type="button" role="radio" aria-checked={on} onClick={() => onChange(k)} style={{ minWidth: 0, height: "100%", borderRadius: 9, border: "none", background: on ? M.card : "transparent", color: on ? M.raisin : M.ink, fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 4px", cursor: "pointer", boxShadow: on ? SH_SEG : "none" }}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

/** 30–34px rounded icon tile (summary rows, menu rows, field icon). */
export function IconTile({ icon: I, size = 30, r = 9, bg = CC.tile, fg = CC.brown, iconSize = 15 }: { icon: LucideIcon; size?: number; r?: number; bg?: string; fg?: string; iconSize?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, flex: "none", borderRadius: r, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <I size={iconSize} strokeWidth={1.9} color={fg} />
    </span>
  );
}

/** White search field (44px, 14px radius) used on the list, source sheet and catalogue. */
export function SearchField({ value, onChange, placeholder, label, trailing }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; trailing?: ReactNode }) {
  return (
    <label style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 4px 0 13px", boxSizing: "border-box", background: M.card, borderRadius: 14, boxShadow: SH_FIELD }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9A9082" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      <input type="search" aria-label={label ?? placeholder} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, lineHeight: 1.5, color: M.raisin, fontFamily: "inherit", padding: 0 }} />
      {trailing}
    </label>
  );
}


/** Qty − / + stepper in a white pill. */
export function Stepper({ value, onDec, onInc, decDisabled, incDisabled, label }: { value: number | string; onDec: () => void; onInc: () => void; decDisabled?: boolean; incDisabled?: boolean; label: string }) {
  const b = (disabled: boolean | undefined, glyph: string, aria: string, fn: () => void) => (
    <button type="button" aria-label={aria} onClick={fn} disabled={disabled} style={{ width: 32, height: 30, border: "none", background: "none", color: CC.brown, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, fontSize: 18, fontWeight: 700, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{glyph}</button>
  );
  return (
    <div role="group" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 2, height: 36, padding: "0 3px", borderRadius: 10, background: M.card, boxShadow: SH_CTRL }}>
      {b(decDisabled, "−", "Less", onDec)}
      <span style={{ minWidth: 28, textAlign: "center", fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {b(incDisabled, "+", "More", onInc)}
    </div>
  );
}
