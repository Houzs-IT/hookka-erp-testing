// Meetings v3 — small drawing pieces shared by the screens (prototype sizes; colours from
// comms-theme.css + meetings-theme.css, so light and dark both hold).
import type { CSSProperties, ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { BTN, C, NUM, SH, avatarOf } from "../comms-kit";
import type { Tone } from "./meet-lib";
import "./meetings-theme.css";

export const BLUE = "var(--mt-blue)";
export const BLUE_BG = "var(--mt-blue-bg)";

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function toneOf(t: Tone): { fg: string; bg: string } {
  switch (t) {
    case "green": return { fg: C.green, bg: C.greenBg };
    case "red": return { fg: C.red, bg: C.redBg };
    case "amber": return { fg: C.amber, bg: C.amberBg };
    case "teal": return { fg: C.teal, bg: C.tealBg };
    case "blue": return { fg: BLUE, bg: BLUE_BG };
    case "gold": return { fg: C.gold, bg: C.tint };
    default: return { fg: C.grey, bg: C.greyBg };
  }
}

export function TonePill({ label, tone, dot = true, h = 22, size = 10.5 }: { label: ReactNode; tone: Tone; dot?: boolean; h?: number; size?: number }) {
  const t = toneOf(tone);
  return (
    <span style={{ flex: "none", height: h, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 8px", borderRadius: 999, background: t.bg, color: t.fg, fontSize: size, fontWeight: 700, whiteSpace: "nowrap", ...NUM }}>
      {dot ? <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.fg }} /> : null}
      {label}
    </span>
  );
}

/** "TODAY · THU 26 NOV ———" */
export function DayLine({ label, red, right, style, icon: Icon }: { label: string; red?: boolean; right?: ReactNode; style?: CSSProperties; icon?: LucideIcon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 4px 6px", ...style }}>
      {Icon ? <Icon size={12} strokeWidth={2.2} color="var(--c-gold)" /> : null}
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: red ? C.red : C.gold, whiteSpace: "nowrap", ...NUM }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: C.divider }} />
      {right}
    </div>
  );
}

export type SegOpt<K extends string> = { key: K; label: ReactNode; badge?: string; badgeRed?: boolean };
/** The prototype's segmented track (sections 46px, views 40px, sheets 44px). */
export function Seg<K extends string>({ items, value, onChange, label, height = 44, radius = 12, cols, fontSize = 13, role = "group" }: {
  items: SegOpt<K>[]; value: K | null; onChange: (k: K) => void; label: string; height?: number; radius?: number; cols?: string; fontSize?: number; role?: "group" | "radiogroup";
}) {
  return (
    <div role={role} aria-label={label} style={{ display: "grid", gridTemplateColumns: cols ?? `repeat(${items.length}, minmax(0, 1fr))`, gap: height <= 40 ? 3 : 4, height, boxSizing: "border-box", padding: height <= 40 ? 3 : 4, borderRadius: radius, background: C.track }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button key={it.key} type="button" onClick={() => onChange(it.key)}
            role={role === "radiogroup" ? "radio" : undefined} aria-checked={role === "radiogroup" ? on : undefined} aria-pressed={role === "group" ? on : undefined}
            style={{ ...BTN, minWidth: 0, height: "100%", borderRadius: radius - 3, background: on ? C.card : "transparent", color: on ? C.ink : C.body, fontWeight: on ? 700 : 600, boxShadow: on ? SH.segOn : "none", fontSize, whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 4px" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 6 }}>{it.label}</span>
            {it.badge ? (
              <span style={{ minWidth: 17, height: 17, boxSizing: "border-box", padding: "0 4px", borderRadius: 999, background: it.badgeRed ? C.red : on ? C.tint : "var(--c-skel)", color: it.badgeRed ? "#FFFFFF" : C.gold, fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", ...NUM }}>{it.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Round chip (32–34px): on = gold fill. */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function chipCss(on: boolean): CSSProperties {
  return { background: on ? "#6B5C32" : C.card, color: on ? "#FFFFFF" : C.chipText, boxShadow: on ? SH.chipOn : SH.chip, fontWeight: on ? 700 : 600 };
}

export function Avatar({ name, size = 32, font = 11 }: { name: string; size?: number; font?: number }) {
  const a = avatarOf(name);
  return <span aria-hidden style={{ width: size, height: size, flex: "none", borderRadius: "50%", background: a.bg, color: a.fg, fontSize: font, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{a.ini}</span>;
}

export function RadioDot({ on }: { on: boolean }) {
  return <span aria-hidden style={{ width: 20, height: 20, flex: "none", borderRadius: "50%", boxShadow: on ? "inset 0 0 0 6px #6B5C32" : "inset 0 0 0 1.5px var(--c-sand)", background: C.card }} />;
}
export function CheckBox({ on }: { on: boolean }) {
  return (
    <span aria-hidden style={{ width: 22, height: 22, flex: "none", borderRadius: 7, background: on ? "#6B5C32" : C.card, boxShadow: on ? "none" : "inset 0 0 0 1.5px var(--c-sand)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
      {on ? <Check size={14} strokeWidth={3} /> : null}
    </span>
  );
}

/** Icon tile (32px, radius 10). */
export function Tile({ icon: Icon, bg, fg, size = 32, radius = 10, iconSize = 15 }: { icon: LucideIcon; bg: string; fg: string; size?: number; radius?: number; iconSize?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, flex: "none", borderRadius: radius, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon size={iconSize} strokeWidth={2} color={fg} />
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const LABEL: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: C.ink };
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const SMALL_LABEL: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: C.gold };
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", height: 44, padding: "0 13px", borderRadius: 12, border: "none", background: C.card, boxShadow: SH.ring, fontFamily: "inherit", fontSize: 16, color: C.ink, outline: "none" };
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const SELECT: CSSProperties = { ...INPUT, padding: "0 40px 0 13px", appearance: "none", WebkitAppearance: "none" };
/** White card with a hairline ring (prototype "0 0 0 1px #E6E0D9 …"). */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const RINGCARD: CSSProperties = { borderRadius: 16, background: C.card, boxShadow: SH.panel, overflow: "hidden" };
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const rowTop = (i: number) => (i ? `1px solid ${C.hair}` : "none");

/** Gold primary pill (round). */
export function GoldPill({ children, onClick, icon: Icon, height = 40, disabled }: { children: ReactNode; onClick: () => void; icon?: LucideIcon; height?: number; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...BTN, height, padding: "0 12px 0 10px", borderRadius: 999, background: C.grad, color: "#FFFFFF", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", opacity: disabled ? 0.55 : 1, flex: "none" }}>
      {Icon ? <Icon size={15} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

/** Switch row (Open for booking, Only my meetings). */
export function SwitchRow({ on, title, sub, onToggle }: { on: boolean; title: string; sub: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "0 14px", borderRadius: 14, background: C.card, boxShadow: SH.ring, textAlign: "left", width: "100%" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{sub}</span>
      </span>
      <span aria-hidden style={{ width: 44, height: 26, flex: "none", borderRadius: 999, background: on ? "#6B5C32" : "var(--c-sand)", position: "relative" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(31,29,27,.3)" }} />
      </span>
    </button>
  );
}
