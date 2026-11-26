// ---------------------------------------------------------------------------
// The Batch 2 comms full-screen layers: the centred confirm dialog and the dark
// media viewer (approved Claude Design prototypes). Both are portals into
// document.body, so a card with backdrop-filter cannot trap them, and both
// close on Esc. Everything else in the kit stays in the page flow or on the
// shared ResponsiveActionDock.
// ---------------------------------------------------------------------------
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X, type LucideIcon } from "lucide-react";
import { BTN, C, FONT, Spinner } from "./comms-kit";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export type ConfirmSpec = {
  title: string;
  body: ReactNode;
  okLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: LucideIcon;
  onOk: () => void | Promise<void>;
};

/** Centred alert dialog (330px, icon tile, two buttons). `busy` disables both. */
export function ConfirmDialog({ spec, busy, onCancel }: { spec: ConfirmSpec | null; busy?: boolean; onCancel: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEscape(!!spec, () => {
    if (!busy) onCancel();
  });
  useEffect(() => {
    if (spec) requestAnimationFrame(() => okRef.current?.focus());
  }, [spec]);
  if (!spec) return null;
  const Icon = spec.icon;
  const danger = !!spec.danger;
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--c-scrim-strong)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT }}>
      <div role="alertdialog" aria-modal="true" aria-label={spec.title} className="c-anim" style={{ width: "100%", maxWidth: 330, borderRadius: 20, background: C.paper, color: C.ink, padding: "20px 18px 16px", boxShadow: "var(--c-sh-dialog)", animation: "c-pop .18s ease-out", boxSizing: "border-box" }}>
        {Icon ? (
          <span style={{ width: 44, height: 44, borderRadius: 14, background: danger ? C.redBg : C.cream, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Icon size={20} strokeWidth={2} color={danger ? "var(--c-red)" : "var(--c-gold)"} />
          </span>
        ) : null}
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.2px" }}>{spec.title}</div>
        <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.5, color: C.body }}>{spec.body}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onCancel} disabled={busy} style={{ ...BTN, height: 46, borderRadius: 12, background: C.card, color: C.body, fontSize: 14, fontWeight: 700, boxShadow: "var(--c-sh-ring)", opacity: busy ? 0.6 : 1 }}>
            {spec.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={() => void spec.onOk()}
            disabled={busy}
            aria-busy={busy || undefined}
            style={{ ...BTN, height: 46, borderRadius: 12, background: danger ? "var(--c-red)" : C.grad, color: "#FFFFFF", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy ? 0.75 : 1 }}
          >
            {busy ? <Spinner size={13} color="#FFFFFF" /> : null}
            {spec.okLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export type ViewerItem = { name: string; url: string; kind: "image" | "video" };

/** Dark full-screen viewer for an image or a video, with "Open" for the original file. */
export function MediaViewer({ item, onClose }: { item: ViewerItem | null; onClose: () => void }) {
  useEscape(!!item, onClose);
  if (!item) return null;
  return createPortal(
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={item.name} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(20,18,16,.94)", display: "flex", flexDirection: "column", fontFamily: FONT, paddingTop: "env(safe-area-inset-top)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 0 18px", minHeight: 52, color: "#FFFFFF" }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
        <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.name}`} style={{ width: 44, height: 44, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ExternalLink size={19} strokeWidth={2} />
        </a>
        <button type="button" onClick={onClose} aria-label="Close preview" style={{ ...BTN, width: 44, height: 44, background: "none", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={22} strokeWidth={2} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        {item.kind === "video" ? (
          <video onClick={(e) => e.stopPropagation()} src={item.url} controls playsInline style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 14, background: "#000" }} />
        ) : (
          <img onClick={(e) => e.stopPropagation()} src={item.url} alt={item.name} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 14, objectFit: "contain" }} />
        )}
      </div>
    </div>,
    document.body,
  );
}
