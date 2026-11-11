// Full-screen overlay shell (Phase 4 prototype: Report an issue, section editors, legacy order,
// issue part) and the dark photo viewer. These two are the only intentional fixed-position
// layers of the Service Cases screens (see tests/mobile-floating-layer.test.mjs).
import { useEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { M } from "../../theme";

export function Overlay({
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 640,
  closeLabel = "Close",
  headerH = 56,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  closeLabel?: string;
  headerH?: number;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 55, background: M.paper, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, minHeight: headerH, padding: "env(safe-area-inset-top, 0px) 14px 0 12px", boxSizing: "border-box" }}>
        <button type="button" onClick={onClose} aria-label={closeLabel} style={{ width: 44, height: 44, marginLeft: -10, background: "none", border: "none", padding: 0, flex: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: M.raisin }}>
          <X size={22} strokeWidth={1.9} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: subtitle ? 17 : 18, fontWeight: 700, color: M.raisin, lineHeight: subtitle ? "22px" : "24px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div> : null}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ maxWidth, margin: "0 auto", padding: "6px 18px 24px", display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 16 }}>{children}</div>
      </div>
      {footer ? (
        <div style={{ flex: "none", padding: "10px 16px calc(14px + env(safe-area-inset-bottom, 0px))", background: M.paper, boxShadow: "0 -1px 0 #E6E0D9" }}>
          <div style={{ maxWidth, margin: "0 auto" }}>{footer}</div>
        </div>
      ) : null}
    </div>
  );
}

export function PhotoViewer({ photos, index, onIndex, onClose }: { photos: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const n = photos.length;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndex((index + n - 1) % n);
      if (e.key === "ArrowRight") onIndex((index + 1) % n);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [index, n, onIndex, onClose]);
  if (!n) return null;
  const nav = { flex: 1, height: 46, border: "none", borderRadius: 12, background: "rgba(255,255,255,.1)", color: "#FAF8F4", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 } as const;
  return (
    <div role="dialog" aria-modal="true" aria-label="Issue photo" style={{ position: "fixed", inset: 0, zIndex: 85, background: "#1F1D1B", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "calc(12px + env(safe-area-inset-top, 0px)) 12px 10px" }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "#FAF8F4", fontVariantNumeric: "tabular-nums" }}>Photo {index + 1} of {n}</span>
        <button type="button" onClick={onClose} aria-label="Close photo" style={{ width: 44, height: 44, border: "none", borderRadius: "50%", background: "rgba(255,255,255,.1)", color: "#FAF8F4", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}><X size={20} strokeWidth={2} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
        <img src={photos[index]} alt={`Issue photo ${index + 1}`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 14 }} />
      </div>
      <div style={{ flex: "none", display: "flex", gap: 10, padding: "12px 16px calc(24px + env(safe-area-inset-bottom, 0px))" }}>
        <button type="button" onClick={() => onIndex((index + n - 1) % n)} aria-label="Previous photo" style={nav}><ChevronLeft size={18} strokeWidth={2} />Previous</button>
        <button type="button" onClick={() => onIndex((index + 1) % n)} aria-label="Next photo" style={nav}>Next<ChevronRight size={18} strokeWidth={2} /></button>
      </div>
    </div>
  );
}

/** Centered confirm dialog (prototype "Discard your changes?" alertdialog). */
export function ConfirmDialog({
  open,
  title,
  text,
  keepLabel = "Keep editing",
  goLabel = "Discard",
  onKeep,
  onGo,
}: {
  open: boolean;
  title: string;
  text: string;
  keepLabel?: string;
  goLabel?: string;
  onKeep: () => void;
  onGo: () => void;
}) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 92, background: "rgba(31,29,27,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div role="alertdialog" aria-modal="true" aria-label={title} style={{ width: "100%", maxWidth: 340, background: M.card, borderRadius: 18, padding: "18px 18px 14px", boxShadow: "0 20px 50px -20px rgba(31,29,27,.5)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin }}>{title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: M.ink, marginTop: 6 }}>{text}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button type="button" onClick={onKeep} style={{ flex: 1, height: 44, border: "none", borderRadius: 12, background: "#F4EFE6", color: "#6B5C32", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{keepLabel}</button>
          <button type="button" onClick={onGo} style={{ flex: 1, height: 44, border: "none", borderRadius: 12, background: "#7A2E24", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{goLabel}</button>
        </div>
      </div>
    </div>
  );
}
