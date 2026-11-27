// ---------------------------------------------------------------------------
// Suppliers toast hook: the prototype's dark toast, above the tab bar on a phone
// (never over a bottom action bar — the form closes before it shows), gone
// after 2.6s. Its own file so sup-kit.tsx exports components only.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, FileText, Info, type LucideIcon } from "lucide-react";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";

export type ToastIcon = "ok" | "info" | "file" | "error";
const ICONS: Record<ToastIcon, LucideIcon> = { ok: CircleCheck, info: Info, file: FileText, error: CircleAlert };

export function useSupToast(): { show: (m: string, ic?: ToastIcon) => void; node: ReactNode } {
  const [msg, setMsg] = useState<{ t: string; ic: ToastIcon } | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = useCallback((m: string, ic: ToastIcon = "ok") => {
    window.clearTimeout(t.current);
    setMsg({ t: m, ic });
    // eslint-disable-next-line no-restricted-syntax -- the toast hides itself; cleared on the next show and on unmount
    t.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const Icon = msg ? ICONS[msg.ic] : null;
  const node = msg && Icon ? (
    <ResponsiveActionDock scope="auto" phoneBottom={86} tabletBottom={24} zIndex={90}>
      <div role="status" style={{ display: "flex", justifyContent: "center", padding: "0 16px", pointerEvents: "none", maxWidth: "100%", boxSizing: "border-box" }}>
        <div style={{ maxWidth: "100%", display: "flex", alignItems: "center", gap: 8, background: "#1F1D1B", color: "#FFFFFF", fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, padding: "10px 14px", borderRadius: 12, boxShadow: "0 10px 30px -10px rgba(0,0,0,.5)" }}>
          <Icon size={15} strokeWidth={2.2} style={{ flex: "none" }} aria-hidden />
          <span style={{ minWidth: 0 }}>{msg.t}</span>
        </div>
      </div>
    </ResponsiveActionDock>
  ) : null;
  return { show, node };
}
