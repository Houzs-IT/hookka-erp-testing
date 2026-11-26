// ---------------------------------------------------------------------------
// Meetings v3 — the one full-screen layer of the module: the prototype's centred
// alert dialog with STACKED buttons (up to three: "This meeting" / "This and
// following" / "Back", End / Keep going, Close room / Keep open, OK). The kit's
// ConfirmDialog (comms-overlay.tsx) has two side-by-side buttons only, so the
// repeat-scope question cannot use it. Portal into document.body, Esc = the last
// (ghost) button, like the kit's dialog.
// ---------------------------------------------------------------------------
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { BTN, C, FONT, Spinner } from "../comms-kit";

export type DialogButton = { label: string; kind: "primary" | "secondary" | "danger" | "ghost"; onTap: () => void | Promise<void> };
export type DialogSpec = { title: string; body: ReactNode; icon: LucideIcon; tone?: "danger" | "warn" | "gold"; buttons: DialogButton[] };

const KIND: Record<DialogButton["kind"], { bg: string; fg: string; sh: string }> = {
  primary: { bg: "var(--c-grad)", fg: "#FFFFFF", sh: "none" },
  secondary: { bg: "var(--c-card)", fg: "var(--c-gold)", sh: "0 0 0 1px rgba(201,169,97,.4)" },
  danger: { bg: "var(--c-red)", fg: "#FFFFFF", sh: "none" },
  ghost: { bg: "transparent", fg: "var(--c-body)", sh: "var(--c-sh-ring)" },
};

export function MeetDialog({ spec, busy, onClose }: { spec: DialogSpec | null; busy?: boolean; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!spec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => first.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [spec, busy, onClose]);
  if (!spec) return null;
  const Icon = spec.icon;
  const tone = spec.tone === "danger" ? { bg: C.redBg, fg: "var(--c-red)" } : spec.tone === "warn" ? { bg: C.amberBg, fg: "var(--c-amber)" } : { bg: C.cream, fg: "var(--c-gold)" };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--c-scrim-strong)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT }}>
      <div role="alertdialog" aria-modal="true" aria-label={spec.title} className="c-anim" style={{ width: "100%", maxWidth: 330, borderRadius: 20, background: C.paper, color: C.ink, padding: "20px 18px 16px", boxShadow: "var(--c-sh-dialog)", animation: "c-pop .18s ease-out", boxSizing: "border-box" }}>
        <span style={{ width: 44, height: 44, borderRadius: 14, background: tone.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} strokeWidth={2} color={tone.fg} />
        </span>
        <div style={{ marginTop: 12, fontSize: 17, fontWeight: 700, letterSpacing: "-.2px" }}>{spec.title}</div>
        <div style={{ marginTop: 6, fontSize: 13.5, lineHeight: 1.5, color: C.body, whiteSpace: "pre-line" }}>{spec.body}</div>
        <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
          {spec.buttons.map((b, i) => {
            const k = KIND[b.kind];
            return (
              <button key={b.label} ref={i === 0 ? first : undefined} type="button" disabled={busy} onClick={() => void b.onTap()}
                style={{ ...BTN, height: 46, borderRadius: 12, background: k.bg, color: k.fg, boxShadow: k.sh, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy && b.kind !== "ghost" ? 0.75 : busy ? 0.55 : 1 }}>
                {busy && i === 0 ? <Spinner size={13} color={b.kind === "ghost" || b.kind === "secondary" ? "var(--c-gold)" : "#FFFFFF"} /> : null}
                {b.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
