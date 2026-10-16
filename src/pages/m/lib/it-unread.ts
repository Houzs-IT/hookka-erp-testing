// The IT Support count on the phone menu: how many of the person's requests IT
// has answered since they last opened them. The desktop sidebar reads the same
// endpoint for its badge. One shared request for every reader, at most once a
// minute while the tab is looked at; any failure (hub not connected or down)
// keeps the last known count, because a badge is a nudge, not a fact a page
// depends on.
import { useEffect, useState } from "react";
import { useInterval } from "@/lib/scheduler";
import type { ModuleGroup } from "../nav";

const PATH = "/m/it-support";
let count = 0;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(n: number) => void>();

/** Asks the server unless a reader already did within `maxAgeMs`. */
function load(maxAgeMs: number): Promise<void> {
  if (inflight) return inflight;
  if (Date.now() - fetchedAt < maxAgeMs) return Promise.resolve();
  inflight = fetch("/api/it-support/unread-count")
    .then(async (res) => {
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { data?: { unread?: number } } | null;
      count = Number(body?.data?.unread) || 0;
      listeners.forEach((l) => l(count));
    })
    .catch(() => {})
    .finally(() => { fetchedAt = Date.now(); inflight = null; });
  return inflight;
}

/** Call after opening a request: the hub has just marked it seen. */
export function refreshItUnread(): void {
  void load(0);
}

export function useItUnread(): number {
  const [n, setN] = useState(count);
  useEffect(() => {
    listeners.add(setN);
    void load(15_000);
    return () => { listeners.delete(setN); };
  }, []);
  // Several readers share one answer: a tick within 45 s of another reader's is skipped.
  useInterval(() => { void load(45_000); }, 60_000);
  return n;
}

/** The menu groups with the IT Support row carrying the count. */
export function withItBadge(groups: ModuleGroup[], n: number): ModuleGroup[] {
  if (n <= 0) return groups;
  return groups.map((g) => ({ ...g, items: g.items.map((it) => (it.path === PATH ? { ...it, badge: n } : it)) }));
}
