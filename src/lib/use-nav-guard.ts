// ---------------------------------------------------------------------------
// useNavGuard — unsaved-changes guard for BOTH halves of "leaving":
//
//   1. In-app navigation (breadcrumb / link / back button) — via React
//      Router's useBlocker (the app is on createBrowserRouter, so the data
//      router APIs are available). When `isDirty` is true and the path is
//      about to change, the user gets a confirm; proceed = navigate away,
//      cancel = stay on the form with edits intact.
//   2. Browser unload (tab close / refresh / cross-origin) — delegated to
//      the existing `useUnsavedChanges` (native beforeunload dialog).
//
// This is the in-app counterpart the codebase was missing: `useUnsavedChanges`
// alone only covered tab-close/refresh and intentionally left in-app route
// changes unguarded. Owner 2026-06-18 asked for a prompt on 切頁 (page switch)
// too, so a card's unsaved edits can't be silently dropped by clicking away.
//
// Usage (in any component rendered inside the RouterProvider tree):
//   useNavGuard(isDirty);
//   useNavGuard(isDirty, "You have unsaved Root Cause edits. Leave without saving?");
//
// Pair it with an explicit Save/Cancel: Save persists (isDirty → false),
// Cancel reverts local state to the server value (isDirty → false). The guard
// only fires while edits are genuinely pending.
// ---------------------------------------------------------------------------
//
// Review pass 2 (H3-1 / C2-2, 2026-11-10): extended to the document create /
// edit pages (SO, consignment, PO, GRN, PI, DO, payments). A page that moves
// on by itself right after a successful save calls `allowNext()` first, so
// its own redirect to the saved record never asks "Leave without saving?".
// `useFormDirty` gives an edit page a dirty flag from a snapshot of its form.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DEFAULT_NAV_GUARD_MESSAGE, firstDirtyMessage, formSnapshotKey, shouldBlockNav } from "./nav-guard-rules";

export { DEFAULT_NAV_GUARD_MESSAGE, firstDirtyMessage, formSnapshotKey, shouldBlockNav } from "./nav-guard-rules";

export type NavGuard = {
  /** Let the NEXT in-app navigation through without asking (one shot) —
   *  call it just before a page's own redirect after a successful save. */
  allowNext: () => void;
};

// React Router honours ONE blocker — the newest registered (a second one only
// logs "A router only supports one blocker at a time"). Two guards can be
// mounted together (a form hosted inside another guarded page), so every
// guard's state lives in this registry and whichever blocker is live asks
// about ALL of them: an older dirty form is never let go by a newer clean one.
type GuardEntry = { dirty: boolean; message: string; bypass: boolean };
const registry = new Map<symbol, GuardEntry>();

function dirtyGuardMessage(): string | null {
  return firstDirtyMessage(registry.values());
}

function takeBypass(): boolean {
  let any = false;
  for (const e of registry.values()) {
    if (e.bypass) {
      any = true;
      e.bypass = false;
    }
  }
  return any;
}

export function useNavGuard(
  isDirty: boolean,
  message: string = DEFAULT_NAV_GUARD_MESSAGE,
): NavGuard {
  const { confirm } = useConfirm();
  const [id] = useState(() => Symbol("nav-guard"));

  // Half 1 — browser-level (close tab / refresh / different origin).
  useUnsavedChanges(isDirty);

  // Keep this form's state in the registry (bypass survives re-renders).
  useEffect(() => {
    const prev = registry.get(id);
    registry.set(id, { dirty: isDirty, message, bypass: prev?.bypass ?? false });
  }, [id, isDirty, message]);
  useEffect(() => () => void registry.delete(id), [id]);

  // Half 2 — in-app route changes (menu, link, Back, phone swipe). Only a
  // genuine path change while some form is dirty (same-path search/hash
  // tweaks don't count, so a filter or ?tab= change never trips the prompt).
  // A save that resolves and redirects in the same tick still has the old
  // dirty flag in the registry; allowNext() set the bypass for exactly that.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname) return false;
    const bypass = takeBypass();
    return shouldBlockNav({
      isDirty: dirtyGuardMessage() !== null,
      bypass,
      fromPath: currentLocation.pathname,
      toPath: nextLocation.pathname,
    });
  });

  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== "blocked" || asking.current) return;
    const ask = dirtyGuardMessage();
    // If every form became clean between the nav attempt and this effect
    // (e.g. a Save resolved), let the navigation through silently.
    if (ask === null) {
      blocker.proceed();
      return;
    }
    asking.current = true;
    // The in-app confirm, never window.confirm (owner rule, confirm-dialog.tsx).
    void confirm({
      title: "Leave without saving?",
      message: ask,
      confirmLabel: "Leave",
      cancelLabel: "Stay",
      danger: true,
    }).then((leave) => {
      asking.current = false;
      if (leave) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, confirm]);

  const allowNext = useCallback(() => {
    const e = registry.get(id);
    if (e) e.bypass = true;
    else registry.set(id, { dirty: false, message: DEFAULT_NAV_GUARD_MESSAGE, bypass: true });
  }, [id]);
  return { allowNext };
}

/**
 * Dirty flag for an edit form: the first snapshot taken once `ready` is true
 * is the baseline (the record as loaded); the form is dirty while the current
 * snapshot differs from it; `ready` going false drops the baseline (an edit
 * mode closing). `markClean()` re-bases on the current value (after
 * a save that keeps the page open). A create form passes its blank state with
 * ready = true, so anything typed — or picked from a dropdown — counts.
 */
export function useFormDirty(snapshot: unknown, ready = true): [boolean, () => void] {
  const key = formSnapshotKey(snapshot);
  const [baseline, setBaseline] = useState<string | null>(null);
  useEffect(() => {
    // Baseline when the record arrives (or edit mode opens); dropped when it
    // closes, so the next Edit starts from what is saved then.
    /* eslint-disable react-hooks/set-state-in-effect -- baseline follows ready */
    if (ready && baseline === null) setBaseline(key);
    else if (!ready && baseline !== null) setBaseline(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ready, baseline, key]);
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
  }, [key]);
  const markClean = useCallback(() => setBaseline(latest.current), []);
  return [ready && baseline !== null && baseline !== key, markClean];
}
