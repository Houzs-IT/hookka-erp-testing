import { useCallback, useEffect, useState } from "react";

/**
 * Open state of a full-screen "View all" worklist page (Overdue production orders / Due within 3 days). Opening adds ONE
 * history entry, so the phone's own Back closes the page and returns to the same Overview scroll position. The entry is
 * pushed from the tap, not from an effect, so React StrictMode cannot add it twice (same approach as completed-detail-state).
 */
export type WorklistTarget = { kind: "od" | "ds"; /** Overdue: which list opens first. */ state?: "live" | "done"; /** Due soon: a lane tile that was tapped (days left). */ lane?: number | null };

export function useWorklistPage() {
  const [target, setTarget] = useState<WorklistTarget | null>(null);
  const open = useCallback((t: WorklistTarget) => {
    try { window.history.pushState({ ...(window.history.state ?? {}), opsWorklist: t.kind }, ""); } catch { /* history unavailable: the Back button still closes */ }
    setTarget(t);
  }, []);
  const close = useCallback(() => {
    if (window.history.state?.opsWorklist) window.history.back(); // popstate below closes it
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
