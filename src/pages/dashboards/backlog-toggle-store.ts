// ---------------------------------------------------------------------------
// backlog-toggle-store.ts — the Sofa / Bedframe and customer-delivery-month
// toggles of Department Backlog, shared by every Command Center section on
// the page.
//
// Operations mounts Department Backlog and Plant Load as two separate
// <CommandCenterSections> (OperationsView.tsx), each its own DashboardBPage
// instance, so component state did not reach across: live check 2026-11-22,
// hiding Overdue changed the department bars but Plant Load stayed 17.4d.
// One module-level store, read with useSyncExternalStore, keeps both (and the
// drills) on the same toggles. Not persisted: a reload starts with all on.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from "react";

export type BacklogToggles = {
  hiddenCat: ReadonlySet<string>;
  hiddenMonth: ReadonlySet<string>;
};

let state: BacklogToggles = { hiddenCat: new Set(), hiddenMonth: new Set() };
const subscribers = new Set<() => void>();

function flip(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function publish(next: BacklogToggles): void {
  state = next;
  for (const fn of subscribers) fn();
}

/** Sofa / Bedframe. */
export function toggleBacklogCategory(key: string): void {
  publish({ ...state, hiddenCat: flip(state.hiddenCat, key) });
}

/** A customer-delivery bucket ("overdue", "YYYY-MM", "none"). */
export function toggleBacklogMonth(key: string): void {
  publish({ ...state, hiddenMonth: flip(state.hiddenMonth, key) });
}

export function getBacklogToggles(): BacklogToggles {
  return state;
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useBacklogToggles(): BacklogToggles {
  return useSyncExternalStore(subscribe, getBacklogToggles, getBacklogToggles);
}
