// ---------------------------------------------------------------------------
// R&D Projects — the prototype's toast (dark, icon + text, gone after 2.4s;
// errors stay 5s). Floats above the bottom tab bar, and above the detail's
// action dock when one is showing (`raised`). Rendered through
// ResponsiveActionDock so it lands in the pane it was raised from.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";

export type RdToastTone = "ok" | "neu" | "err";

export function useRdToast(raised = false): { show: (m: string, tone?: RdToastTone) => void; node: ReactNode } {
  const [t, setT] = useState<{ m: string; tone: RdToastTone } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string, tone: RdToastTone = "ok") => {
    window.clearTimeout(timer.current);
    setT({ m, tone });
    // eslint-disable-next-line no-restricted-syntax -- the toast hides itself; cleared on the next show and on unmount
    timer.current = window.setTimeout(() => setT(null), tone === "err" ? 5000 : 2400);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const Icon = t?.tone === "err" ? CircleAlert : t?.tone === "neu" ? Info : CircleCheck;
  const node = t ? (
    <ResponsiveActionDock scope="auto" phoneBottom={raised ? 150 : 86} tabletBottom={raised ? 96 : 24} zIndex={90}>
      <div role={t.tone === "err" ? "alert" : "status"} style={{ display: "flex", justifyContent: "center", padding: "0 16px", pointerEvents: "none", maxWidth: "100%", boxSizing: "border-box" }}>
        <div
          style={{
            maxWidth: "100%", display: "flex", alignItems: "center", gap: 8, boxSizing: "border-box",
            background: t.tone === "err" ? "#9A3A2D" : "#1F1D1B", color: "#FFFFFF",
            fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, padding: "10px 14px", borderRadius: 12, boxShadow: "0 10px 30px -10px rgba(0,0,0,.5)",
          }}
        >
          <Icon size={15} strokeWidth={2.2} style={{ flex: "none" }} aria-hidden />
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{t.m}</span>
        </div>
      </div>
    </ResponsiveActionDock>
  ) : null;
  return { show, node };
}
