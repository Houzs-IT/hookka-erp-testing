// ---------------------------------------------------------------------------
// Outsource Work (mobile, Batch 4 — approved Claude Design prototype
// "Outsource Work"): the screen's building blocks, drawn to the prototype's
// sizes with its --xo-* colour tokens (light + dark, xops-theme.css).
// The kit only draws; every value comes from the use-outsource-issue hook.
// ---------------------------------------------------------------------------
import type { ReactNode } from "react";
import { ChevronLeft, CircleAlert, Menu, X as XIcon, type LucideIcon } from "lucide-react";
import { Sheet } from "../../components";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";
import { M_MAX_WIDTH } from "../../theme";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { STATUS_STYLE, type BannerView, type DeptChip, type IssueStatus } from "./os-format";
import { BRAND, ELLIPSIS, KEYFRAMES, NUM, TONE, X } from "./os-style";

// ---- header -------------------------------------------------------------------------
export function OsHeader({ title, left, onLeft, right }: {
  title: string;
  left: "menu" | "back" | null;
  onLeft?: () => void;
  right?: ReactNode;
}) {
  return (
    <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, height: 56, padding: "0 14px 0 12px", boxSizing: "border-box" }}>
      {left && onLeft ? (
        <button type="button" onClick={onLeft} aria-label={left === "menu" ? "Open menu" : "Back"}
          style={{ width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer", color: X.ink }}>
          {left === "menu" ? <Menu size={22} strokeWidth={1.9} /> : <ChevronLeft size={22} strokeWidth={2} />}
        </button>
      ) : <span style={{ width: 4 }} />}
      <h1 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.2px", ...ELLIPSIS, ...NUM }}>{title}</h1>
      {right}
    </header>
  );
}

export function RoundButton({ icon: Icon, aria, onTap, spin }: { icon: LucideIcon; aria: string; onTap: () => void; spin?: boolean }) {
  return (
    <button type="button" onClick={onTap} aria-label={aria}
      style={{ width: 42, height: 42, borderRadius: "50%", background: X.card, border: "none", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0, cursor: "pointer", color: X.br, boxShadow: `0 0 0 1px ${X.ring},0 6px 16px -8px ${X.shd}` }}>
      <span style={{ display: "flex", animation: spin ? "os-spin .8s linear infinite" : "none" }}><Icon size={17} strokeWidth={2} /></span>
    </button>
  );
}

// ---- small blocks -------------------------------------------------------------------------
/** "WORKER ———— right". */
export function OsLabel({ icon: Icon, l, r, pad = "0 4px" }: { icon?: LucideIcon; l: string; r?: string; pad?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: pad }}>
      {Icon ? <Icon size={14} strokeWidth={2.2} color={X.br} /> : null}
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: X.br, textTransform: "uppercase", whiteSpace: "nowrap" }}>{l}</span>
      <span style={{ flex: 1, height: 1, background: X.ln }} />
      {r ? <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: X.mut, ...NUM }}>{r}</span> : null}
    </div>
  );
}

/** The feedback strip: tone icon, bold title, server message under it. */
export function OsBanner({ view, role = "status" }: { view: BannerView; role?: "status" | "alert" }) {
  const t = TONE[view.tone];
  const Icon = t.icon;
  return (
    <div role={role} aria-live="polite" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", borderRadius: 14, background: t.bg, boxShadow: `inset 3px 0 0 ${t.c}` }}>
      <Icon size={18} strokeWidth={2} color={t.c} style={{ flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: t.c }}>{view.t}</span>
        {view.s ? <span style={{ display: "block", fontSize: 12, color: X.sub, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{view.s}</span> : null}
      </span>
    </div>
  );
}

/** A plain note strip (permission notice, truncated list, check note). */
export function OsNote({ icon: Icon, children, c, bg, rail }: { icon: LucideIcon; children: ReactNode; c: string; bg: string; rail?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "11px 12px", borderRadius: rail ? 14 : 12, background: bg, color: c, fontSize: 12.5, lineHeight: 1.45, boxShadow: rail ? `inset 3px 0 0 ${X.bad}` : undefined }}>
      <Icon size={15} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

export function OsState({ icon: Icon, c, bg, t, s, btn, role = "note" }: {
  icon: LucideIcon; c: string; bg: string; t: string; s?: ReactNode; btn?: { l: string; onTap: () => void } | null; role?: "note" | "alert";
}) {
  return (
    <div role={role} style={{ padding: "28px 20px", borderRadius: 20, background: X.card, boxShadow: `0 0 0 1px ${X.ring},0 12px 24px -12px ${X.shd}`, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <span style={{ width: 50, height: 50, borderRadius: 16, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={22} strokeWidth={1.8} color={c} /></span>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t}</div>
      {s ? <div style={{ fontSize: 13, color: X.sub, lineHeight: 1.45, overflowWrap: "anywhere" }}>{s}</div> : null}
      {btn ? (
        <button type="button" onClick={btn.onTap}
          style={{ marginTop: 4, height: 44, padding: "0 20px", borderRadius: 999, border: "none", background: BRAND, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{btn.l}</button>
      ) : null}
    </div>
  );
}

export function OsSkel({ n = 3, h = 132 }: { n?: number; h?: number }) {
  return (
    <div aria-busy="true" style={{ display: "grid", gap: 8 }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} aria-hidden="true" style={{ height: h, borderRadius: 16, background: X.card, animation: "os-pulse 1.2s ease-in-out infinite" }} />
      ))}
      <span role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Loading…</span>
    </div>
  );
}

export function Spinner({ size = 13, light = true }: { size?: number; light?: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, flex: "none", borderRadius: "50%", border: `2px solid ${light ? "rgba(255,255,255,.4)" : X.ln}`, borderTopColor: light ? "#FFFFFF" : X.br, animation: "os-spin .8s linear infinite", boxSizing: "border-box" }} />
  );
}

export function StatusPill({ status, big }: { status: IssueStatus; big?: boolean }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ height: big ? 26 : 21, display: "inline-flex", alignItems: "center", gap: big ? 6 : 4, padding: big ? "0 11px" : "0 8px", borderRadius: 999, background: s.b, color: s.c, fontSize: big ? 12.5 : 10.5, fontWeight: 700, whiteSpace: "nowrap", flex: "none" }}>
      <span style={{ width: big ? 7 : 5, height: big ? 7 : 5, borderRadius: "50%", background: s.c }} />{s.l}
    </span>
  );
}

export function CheckPill({ big }: { big?: boolean }) {
  return (
    <span style={{ height: big ? 26 : 21, display: "inline-flex", alignItems: "center", gap: big ? 4 : 3, padding: big ? "0 10px" : "0 8px", borderRadius: 999, background: X.badb, color: X.bad, fontSize: big ? 12 : 10.5, fontWeight: 700, flex: "none" }}>
      <CircleAlert size={big ? 13 : 11} strokeWidth={2.4} />Check
    </span>
  );
}

export function DeptPills({ depts, small }: { depts: DeptChip[]; small?: boolean }) {
  if (depts.length === 0) {
    return <span style={{ fontSize: small ? 10.5 : 11, color: X.mut, fontWeight: 600 }}>No department</span>;
  }
  return (
    <>
      {depts.map((d) => (
        <span key={d.key} style={{ height: small ? 21 : 22, maxWidth: "100%", boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: small ? 4 : 5, padding: small ? "0 8px" : "0 9px", borderRadius: 999, background: d.bg, fontSize: small ? 10.5 : 11, fontWeight: 700, color: d.c, whiteSpace: "nowrap", overflow: "hidden" }}>
          <span style={{ width: small ? 5 : 6, height: small ? 5 : 6, flex: "none", borderRadius: "50%", background: d.dot }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.l}</span>
        </span>
      ))}
    </>
  );
}

// ---- action bar ------------------------------------------------------------------------
/**
 * The solid bottom action bar. `inline` = inside a fixed-height tablet pane;
 * otherwise docked above the phone tab bar (or at the bottom of a tablet's content).
 */
export function OsBar({ inline, children }: { inline?: boolean; children: ReactNode }) {
  const { mode } = useResponsiveLayout();
  const bar = (
    <div data-os-bar="" style={{ pointerEvents: "auto", width: "100%", maxWidth: !inline && mode === "phone" ? M_MAX_WIDTH : undefined, boxSizing: "border-box", padding: "10px 16px", background: X.nav, boxShadow: `0 -1px 0 ${X.ln}` }}>
      {children}
    </div>
  );
  if (inline) return <div style={{ flex: "none" }}>{bar}</div>;
  return (
    <ResponsiveActionDock scope="content" phoneBottom={56} zIndex={31}>
      <div style={{ width: "100%", display: "flex", justifyContent: "center", background: X.nav, pointerEvents: "none" }}>{bar}</div>
    </ResponsiveActionDock>
  );
}

// ---- bottom sheet ------------------------------------------------------------------------
export function OsSheet({ open, onClose, title, sub, children, closeDisabled }: {
  open: boolean; onClose: () => void; title: string; sub?: ReactNode; children: ReactNode; closeDisabled?: boolean;
}) {
  const close = closeDisabled ? () => undefined : onClose;
  return (
    <Sheet open={open} onClose={close} title={title} bare portal
      panelStyle={{ background: X.bg, color: X.ink, maxHeight: "84dvh", display: "flex", flexDirection: "column", overflowY: "hidden", animation: "os-sheet .22s ease-out", paddingBottom: 0 }}>
      <div data-os="" style={{ display: "contents" }}>
        <style>{KEYFRAMES}</style>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}><div style={{ width: 40, height: 4, borderRadius: 999, background: X.ln }} /></div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 16px 6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {sub ? <div style={{ fontSize: 12, color: X.mut, marginTop: 2, lineHeight: 1.4 }}>{sub}</div> : null}
          </div>
          <button type="button" onClick={close} disabled={closeDisabled} aria-label="Close"
            style={{ width: 40, height: 40, margin: "-6px -8px 0 0", border: "none", background: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: X.mut }}>
            <XIcon size={20} strokeWidth={1.9} />
          </button>
        </div>
        {children}
      </div>
    </Sheet>
  );
}
