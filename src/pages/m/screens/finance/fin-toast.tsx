// ---------------------------------------------------------------------------
// The Finance / Receivable kit's toast hook (Batch 3 prototype): the dark
// toast above the tab bar. Its own file so fin-kit.tsx exports components only.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";
import { F } from "./fin-format";

/** The prototype's dark toast, above the tab bar, gone after 2.6s. */
export function useFinToast(): { show: (m: string) => void; node: ReactNode } {
  const [msg, setMsg] = useState("");
  const t = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    window.clearTimeout(t.current);
    setMsg(m);
    // eslint-disable-next-line no-restricted-syntax -- the toast hides itself; cleared on the next show and on unmount
    t.current = window.setTimeout(() => setMsg(""), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const node = msg ? (
    <ResponsiveActionDock scope="auto" phoneBottom={86} tabletBottom={24} zIndex={90}>
      <div role="status" style={{ display: "flex", justifyContent: "center", padding: "0 16px", pointerEvents: "none" }}>
        <div style={{ maxWidth: "100%", background: F.ink, color: F.paper, fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, padding: "10px 14px", borderRadius: 12, boxShadow: "0 10px 30px -10px rgba(31,29,27,.5)" }}>{msg}</div>
      </div>
    </ResponsiveActionDock>
  ) : null;
  return { show, node };
}
