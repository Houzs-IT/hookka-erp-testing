// The Mail Center count on the menu (Houzs parity row 13): open emails whose
// last word is the customer's, assigned to me or unassigned in my own mailbox,
// from /api/mail-center/waiting-count. One shared request a minute for the
// whole app, paused while the tab is hidden; same shape as meetings-unread.ts.
// The poll also drives the Mail Center's retry + delivery refresh server-side
// (lib/mail-delivery-refresh.ts mailMaintenanceSoon), since Pages has no cron.
import { useEffect, useState } from "react";

/** The count in the answer ({ count }), never negative or garbage. */
export function waitingCount(body: unknown): number {
  const n = Number((body as { count?: unknown } | null)?.count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

let waiting = 0;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(n: number) => void>();

function load(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedAt < 15_000) return Promise.resolve();
  inflight = fetch("/api/mail-center/waiting-count", { credentials: "include" })
    .then(async (res) => {
      waiting = res.ok ? waitingCount(await res.json()) : 0;
    })
    .catch(() => {
      waiting = 0;
    })
    .finally(() => {
      listeners.forEach((l) => l(waiting));
      fetchedAt = Date.now();
      inflight = null;
    });
  return inflight;
}

let timer: number | undefined;
const onVisible = () => {
  if (document.visibilityState === "visible") void load();
};

/** `enabled` false (no Mail Center access) = no requests, count 0. */
export function useMailWaiting(enabled: boolean): number {
  const [n, setN] = useState(waiting);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setN);
    if (listeners.size === 1) {
      // eslint-disable-next-line no-restricted-syntax -- one timer shared by every subscriber, owned by the module, not one component
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void load(true);
      }, 60_000);
      document.addEventListener("visibilitychange", onVisible);
    }
    void load();
    return () => {
      listeners.delete(setN);
      if (listeners.size === 0) {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [enabled]);
  return enabled ? n : 0;
}
