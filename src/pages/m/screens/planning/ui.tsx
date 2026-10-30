// ===========================================================================
// Planning v2 — shared pieces for the Planning screens.
//
// Visuals: Claude Design `Planning v2.dc.html` (colours, shadows, radii,
// spacing, icons). Typography: the /m Delivery / Sales screens. Pills, tones,
// shadows and the switch / chip styles are the Delivery ones
// (../delivery/ui-tokens, ../../lib/control-styles) — nothing shared is edited.
// ===========================================================================
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, CircleAlert, Ellipsis, Inbox, Loader2, Lock, RefreshCw } from "lucide-react";
import { M } from "../../theme";
import { TilePill } from "../delivery/ui";
import { SHADOW_CARD, SHADOW_ROUND, SHADOW_SECTION, DL, sem, type Tone } from "../delivery/ui-tokens";
import { onKey } from "./tones";
import "./planning-theme.css";

export { TilePill };
export type { Tone };

/** Prototype card: white, 16 radius, 4px status rail, soft shadow. */
export function RailCard({
  tone,
  onClick,
  ariaLabel,
  children,
  dim,
}: {
  tone: Tone;
  onClick?: () => void;
  ariaLabel?: string;
  children: ReactNode;
  dim?: boolean;
}) {
  const style: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    textAlign: "left",
    background: M.card,
    borderRadius: 16,
    padding: "13px 14px 12px 17px",
    boxShadow: SHADOW_SECTION,
    border: "none",
    fontFamily: "inherit",
    color: "inherit",
    display: "block",
    cursor: onClick ? "pointer" : "default",
    opacity: dim ? 0.85 : 1,
    WebkitTapHighlightColor: "transparent",
  };
  const rail = <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: sem(tone) }} />;
  if (onClick) {
    return (
      <div role="button" tabIndex={0} aria-label={ariaLabel} onClick={onClick} onKeyDown={onKey(onClick)} style={style}>
        {rail}
        {children}
      </div>
    );
  }
  return (
    <div aria-label={ariaLabel} style={style}>
      {rail}
      {children}
    </div>
  );
}

/** White surface (summary / week cards). */
export function Panel({ children, style, ariaLabel }: { children: ReactNode; style?: CSSProperties; ariaLabel?: string }) {
  return (
    <section aria-label={ariaLabel} style={{ background: M.card, borderRadius: 20, boxShadow: SHADOW_SECTION, ...style }}>
      {children}
    </section>
  );
}

/** Taupe small-caps heading with the gold dash (prototype section label). */
export function DashLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: M.gold }} />
      {children}
    </div>
  );
}

export function SectionRow({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "18px 20px 8px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, whiteSpace: "nowrap" }}>{left}</span>
      {right ? (
        <span style={{ minWidth: 0, fontSize: 12, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>
          {right}
        </span>
      ) : null}
    </div>
  );
}

/** `key value` chip (Customer / Fabric / SO …). */
export function RefChip({ k, v }: { k: string; v: string }) {
  return (
    <span
      style={{
        maxWidth: "100%", height: 22, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 7,
        background: "var(--pl-chip)", fontSize: 11.5, fontWeight: 600, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ color: "var(--pl-chip-key)", fontWeight: 500 }}>{k}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
    </span>
  );
}

/** Tinted label + value cell (DEPT DUE / CUSTOMER DD / TARGET END …). */
export function Cell({
  label,
  value,
  suffix,
  tone,
  icon,
  align,
  qty,
  grow,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: Tone;
  icon?: ReactNode;
  align?: "right";
  qty?: boolean;
  grow?: boolean;
}) {
  const bg = tone && tone !== "neutral" ? `var(--dl-pill-${tone}-bg)` : qty ? "var(--pl-cell-qty)" : "var(--pl-cell)";
  const fg = tone && tone !== "neutral" ? `var(--dl-pill-${tone}-fg)` : qty ? M.taupe : M.ink;
  return (
    <div style={{ minWidth: 0, flex: grow ? 1 : undefined, padding: "7px 9px", borderRadius: 10, background: bg, textAlign: align }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: align === "right" ? "flex-end" : "flex-start", gap: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {icon}
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <div style={{ marginTop: 3, fontSize: 13, fontWeight: 700, color: M.raisin, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>
        {value}
        {suffix ? <span style={{ color: fg }}>{suffix}</span> : null}
      </div>
    </div>
  );
}

export function CardTitleRow({ code, pill, chevron = true }: { code: string; pill?: ReactNode; chevron?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {code}
      </span>
      {pill}
      {chevron ? <ChevronRight size={18} strokeWidth={1.9} color={DL.icon} aria-hidden style={{ flexShrink: 0 }} /> : null}
    </div>
  );
}

export function ProductLine({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 15, fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.2px", color: M.raisin, marginTop: 6, overflowWrap: "anywhere",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

export function RefRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>{children}</div>;
}

// ── Header ⋯ button (Delivery detail pattern) ───────────────────────────────
export function MoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="More options"
      aria-haspopup="dialog"
      style={{
        width: 42, height: 42, borderRadius: "50%", background: M.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 0, cursor: "pointer", color: M.taupe, boxShadow: SHADOW_ROUND, WebkitTapHighlightColor: "transparent",
      }}
    >
      <Ellipsis size={20} strokeWidth={2} />
    </button>
  );
}

// ── States ──────────────────────────────────────────────────────────────────
export function StateCard({
  icon,
  title,
  text,
  action,
  role = "status",
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
  role?: "status" | "alert";
}) {
  return (
    <div role={role} style={{ background: M.card, borderRadius: 16, padding: "26px 18px", textAlign: "center", boxShadow: SHADOW_CARD }}>
      <div style={{ color: DL.icon, display: "flex", justifyContent: "center" }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 8 }}>{title}</div>
      {text ? <div style={{ fontSize: 12.5, color: M.ink, marginTop: 3, lineHeight: 1.45 }}>{text}</div> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: 12, height: 40, padding: "0 16px", borderRadius: 999, border: "none", background: "var(--pl-round-btn)", color: M.taupe,
            fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <RefreshCw size={14} strokeWidth={2} aria-hidden />
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export const EmptyState = ({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) => (
  <StateCard icon={icon ?? <Inbox size={22} strokeWidth={1.9} />} title={title} text={text} />
);
export const ErrorState = ({ title = "Could not load", text, onRetry }: { title?: string; text?: string; onRetry: () => void }) => (
  <StateCard role="alert" icon={<CircleAlert size={22} strokeWidth={1.9} />} title={title} text={text} action={{ label: "Try again", onClick: onRetry }} />
);
export const NoAccessState = ({ text }: { text: string }) => (
  <StateCard icon={<Lock size={22} strokeWidth={1.9} />} title="No access" text={text} />
);

/** Grey shimmer-less skeleton blocks (loading). */
export function SkeletonCards({ n = 3, h = 132 }: { n?: number; h?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ height: h, borderRadius: 16, background: M.card, boxShadow: SHADOW_CARD, opacity: 0.7 }} />
      ))}
    </div>
  );
}

export function InlineSpinner({ label }: { label: string }) {
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "20px 0", color: M.muted, fontSize: 12.5 }}>
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Pill({ tone, label, dot = true }: { tone: Tone; label: string; dot?: boolean }) {
  return <TilePill tone={tone} label={label} dot={dot} />;
}
