// The Meetings count on the menu (desktop sidebar and phone menus): invites,
// changes and cancellations not yet seen, from the Houzs IT Hub through
// /api/meetings/unread-count. One shared request a minute for the whole app,
// paused while the tab is hidden. A badge is a nudge: when the hub is not
// connected or down, the count is 0 and nothing shows.
import { useEffect, useState } from "react";

/** The count in the relay's answer ({ count }, or wrapped in { data }), never negative or garbage. */
export function meetingsCount(body: unknown): number {
  const b = body as { count?: unknown; data?: { count?: unknown } } | null;
  const n = Number(b?.count ?? b?.data?.count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

let unread = 0;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(n: number) => void>();

function load(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < 15_000) return Promise.resolve();
  inflight = fetch("/api/meetings/unread-count")
    .then(async (res) => { unread = res.ok ? meetingsCount(await res.json()) : 0; })
    .catch(() => { unread = 0; })
    .finally(() => { listeners.forEach((l) => l(unread)); fetchedAt = Date.now(); inflight = null; });
  return inflight;
}

/** Call after My meetings marked the updates read. */
export function refreshMeetingsUnread(): void { void load(true); }

let timer: number | undefined;
const onVisible = () => { if (document.visibilityState === "visible") void load(); };

export function useMeetingsUnread(): number {
  const [n, setN] = useState(unread);
  useEffect(() => {
    listeners.add(setN);
    if (listeners.size === 1) {
      // eslint-disable-next-line no-restricted-syntax -- one timer shared by every subscriber, owned by the module, not one component
      timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 60_000);
      document.addEventListener("visibilitychange", onVisible);
    }
    void load();
    return () => {
      listeners.delete(setN);
      if (listeners.size === 0) { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); }
    };
  }, []);
  return n;
}
