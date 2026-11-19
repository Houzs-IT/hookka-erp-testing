import { useCallback, useEffect, useState } from "react";

// ---- open / close, including the phone's own Back -----------------------------
export type CompletedTarget = { code: string; name: string };

/** Open state of the detail. Opening adds ONE history entry, so the browser /
 *  phone Back closes the detail and returns to the same Floor Live view. The
 *  entry is pushed from the tap, not from an effect, so React StrictMode cannot
 *  add it twice. */
export function useCompletedDetail() {
  const [target, setTarget] = useState<CompletedTarget | null>(null);
  const open = useCallback((t: CompletedTarget) => {
    try { window.history.pushState({ ...(window.history.state ?? {}), flCompleted: t.code }, ""); } catch { /* history unavailable: Back button still closes */ }
    setTarget(t);
  }, []);
  const close = useCallback(() => {
    if (window.history.state?.flCompleted) window.history.back(); // popstate below closes it
    else setTarget(null);
  }, []);
  useEffect(() => {
    if (!target) return;
    const onPop = () => setTarget(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [target]);
  return { target, open, close };
}
