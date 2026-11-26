// ---------------------------------------------------------------------------
// Mail Center (Batch 2 v3) — small drawing pieces shared by the list, the
// conversation and the composer, at the approved prototype's sizes. Colours
// are comms-kit (--c-*) or mail-theme.css (--mc-*) variables, light + dark.
// ---------------------------------------------------------------------------
import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useResponsiveLayout } from "../../../lib/responsive-layout";
import { BTN, C, NUM, avatarOf } from "../comms-kit";
import { usePane } from "./mail-store";
import "./mail-theme.css";

export const LIST_PATH = "/m/mail-center";

/** Where things open: the thread route, or a full-width conversation on a tablet set to "No split". */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function useMailNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const layout = useResponsiveLayout();
  const pane = usePane();
  const fullTablet = layout.mode !== "phone" && pane === "full";
  const openThread = useCallback(
    (id: string, replace = false) => navigate(fullTablet ? `${LIST_PATH}?thread=${encodeURIComponent(id)}` : `${LIST_PATH}/${encodeURIComponent(id)}`, { replace }),
    [navigate, fullTablet],
  );
  const toList = useCallback(() => navigate(LIST_PATH), [navigate]);
  const compose = useCallback((draftId?: string) => navigate(`${LIST_PATH}?compose=1${draftId ? `&draft=${encodeURIComponent(draftId)}` : ""}`), [navigate]);
  /** Open the reply / reply-all / forward page for the conversation on screen. */
  const reply = useCallback(
    (mode: "reply" | "reply_all" | "forward") => {
      const next = new URLSearchParams(params);
      next.set("reply", mode);
      setParams(next);
    },
    [params, setParams],
  );
  const closeReply = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("reply");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const openOutbox = useCallback((id: string) => navigate(`${LIST_PATH}?outbox=${encodeURIComponent(id)}`), [navigate]);
  return { openThread, toList, compose, reply, closeReply, openOutbox, onThreadRoute: location.pathname.startsWith(`${LIST_PATH}/`), fullTablet };
}

/** 42px round white (or gold) icon button in a 44px target. */
export function RoundBtn({ icon: Icon, label, onClick, gold, disabled, fg, fill, size = 18, pressed, spin, haspopup }: { icon: LucideIcon; label: string; onClick: () => void; gold?: boolean; disabled?: boolean; fg?: string; fill?: string; size?: number; pressed?: boolean; spin?: boolean; haspopup?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      aria-haspopup={haspopup ? "dialog" : undefined}
      className="c-press"
      style={{ ...BTN, width: 44, height: 44, flex: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "default" : "pointer" }}
    >
      <span style={{ width: 42, height: 42, borderRadius: "50%", background: disabled ? C.line : gold ? C.grad : C.card, color: disabled ? C.faint : gold ? "#FFFFFF" : fg ?? C.gold, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: disabled ? "none" : gold ? "var(--c-sh-primary)" : "var(--c-sh-field)" }}>
        <span className={spin ? "c-anim" : undefined} style={{ display: "flex", animation: spin ? "c-spin .8s linear infinite" : undefined }}>
          <Icon size={size} strokeWidth={2} fill={fill ?? "none"} />
        </span>
      </span>
    </button>
  );
}

export function Avatar({ name, size = 36, font = 12 }: { name: string; size?: number; font?: number }) {
  const a = avatarOf(name.replace(/[^A-Za-z0-9 ]/g, " ").trim() || "@");
  return (
    <span aria-hidden style={{ width: size, height: size, flex: "none", borderRadius: "50%", background: a.bg, color: a.fg, fontSize: font, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {a.ini || "@"}
    </span>
  );
}

/** Small rounded pill (18–22px). */
export function MiniPill({ children, fg, bg, icon: Icon, h = 18, size = 10, shadow }: { children: ReactNode; fg: string; bg: string; icon?: LucideIcon; h?: number; size?: number; shadow?: string }) {
  return (
    <span style={{ flex: "none", height: h, display: "inline-flex", alignItems: "center", gap: 3, padding: "0 6px", borderRadius: 999, background: bg, color: fg, boxShadow: shadow, fontSize: size, fontWeight: 700, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
      {Icon ? <Icon size={size} strokeWidth={2.2} style={{ flex: "none" }} /> : null}
      {children}
    </span>
  );
}

/** "LABELS ———— action" heading inside sheets. */
export function SheetHead({ title, action, onAction, icon: Icon }: { title: string; action?: string; onAction?: () => void; icon?: LucideIcon }) {
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "4px 2px 0" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: C.divider }} />
      {action && onAction ? (
        <button type="button" onClick={onAction} style={{ ...BTN, minHeight: 32, padding: "0 4px", background: "none", color: C.gold, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
          {Icon ? <Icon size={13} strokeWidth={2.2} /> : null}
          {action}
        </button>
      ) : null}
    </div>
  );
}

export type RowSpec = {
  key: string;
  label: string;
  sub?: string;
  icon?: LucideIcon;
  iconFg?: string;
  iconBg?: string;
  dot?: string;
  fg?: string;
  tag?: { text: string; fg: string; bg: string };
  count?: string;
  check?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

/** A white card of 50px rows (the prototype's sheet list). */
export function RowGroup({ rows }: { rows: RowSpec[] }) {
  return (
    <div style={{ flex: "none", borderRadius: 14, background: C.card, boxShadow: "var(--c-sh-panel)", overflow: "hidden" }}>
      {rows.map((r, i) => {
        const Icon = r.icon;
        const body = (
          <>
            {Icon ? (
              <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: r.iconBg ?? C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={15} strokeWidth={2} color={r.iconFg ?? "var(--c-gold)"} />
              </span>
            ) : null}
            {r.dot ? <span style={{ width: 10, height: 10, flex: "none", borderRadius: "50%", background: r.dot }} /> : null}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: r.fg ?? C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
              {r.sub ? <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</span> : null}
            </span>
            {r.tag ? <MiniPill fg={r.tag.fg} bg={r.tag.bg} size={9.5}>{r.tag.text}</MiniPill> : null}
            {r.count ? <span style={{ flex: "none", minWidth: 20, height: 20, boxSizing: "border-box", padding: "0 6px", borderRadius: 999, background: C.track, color: C.body, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", ...NUM }}>{r.count}</span> : null}
            {r.check ? <Check size={16} strokeWidth={2.6} color="var(--c-gold)" style={{ flex: "none" }} /> : null}
          </>
        );
        const style: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "6px 12px", borderTop: i ? `1px solid ${C.hair}` : "none", background: "transparent", textAlign: "left", boxSizing: "border-box", opacity: r.disabled ? 0.5 : 1 };
        return r.onClick ? (
          <button key={r.key} type="button" onClick={r.onClick} disabled={r.disabled} aria-pressed={r.pressed} style={{ ...BTN, ...style, borderTop: style.borderTop }}>
            {body}
          </button>
        ) : (
          <div key={r.key} style={style}>{body}</div>
        );
      })}
    </div>
  );
}

/** A native select drawn as the prototype's plain bold value with a chevron. */
export function PlainSelect({ value, onChange, options, label, disabled, size = 13 }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; label: string; disabled?: boolean; size?: number }) {
  return (
    <span style={{ position: "relative", display: "block", minWidth: 0, flex: 1 }}>
      <select
        className="mc-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        disabled={disabled}
        style={{ width: "100%", minHeight: 24, border: "none", background: "transparent", padding: "0 20px 0 0", fontFamily: "inherit", fontSize: size, fontWeight: 700, color: C.ink, outline: "none", textOverflow: "ellipsis", opacity: disabled ? 0.7 : 1 }}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={2} color="var(--c-gold-mid)" style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
    </span>
  );
}
