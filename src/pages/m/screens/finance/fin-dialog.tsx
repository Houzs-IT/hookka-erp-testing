// ---------------------------------------------------------------------------
// useFinDialog: ask with the Finance kit's confirm dialog (Batch 3). Its own
// file so fin-overlay.tsx exports components only.
// ---------------------------------------------------------------------------
import { useCallback, useRef, useState, type ReactNode } from "react";
import { FinDialog, type DialogSpec } from "./fin-overlay";

/** Ask with the dialog: resolves to null when cancelled, otherwise to the
 *  reason / chosen account ("" for a plain confirm). */
export function useFinDialog(): { ask: (spec: DialogSpec) => Promise<string | null>; node: ReactNode } {
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const res = useRef<((v: string | null) => void) | null>(null);
  const close = useCallback((v: string | null) => { res.current?.(v); res.current = null; setSpec(null); setValue(""); setTried(false); }, []);
  const ask = useCallback((s: DialogSpec) => {
    res.current?.(null);
    setSpec(s); setValue(""); setTried(false);
    return new Promise<string | null>((r) => { res.current = r; });
  }, []);
  const onCancel = useCallback(() => close(null), [close]);
  const onOk = () => {
    if (spec && (spec.reason || spec.accounts) && !value.trim()) { setTried(true); return; }
    close(value.trim());
  };
  return { ask, node: <FinDialog spec={spec} value={value} onValue={setValue} tried={tried} onCancel={onCancel} onOk={onOk} /> };
}
