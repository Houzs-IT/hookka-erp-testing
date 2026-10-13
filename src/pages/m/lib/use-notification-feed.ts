// ===========================================================================
// useNotificationFeed — the /m read of /api/notifications (Home bell dot +
// Updates → Notifications). Built on the shared desktop feed helpers
// (src/lib/notifications-feed.ts) so both apps count "unread" the same way and
// a mark-read on either surface broadcasts to the other.
//
// Differences from the desktop bell, on purpose:
//   • A failed load is an ERROR, not an empty list (`loadNotifications()`
//     returns [] on failure, which would print "No notifications").
//   • A rejected mark-read is rolled back and reported (`ok === false`), so
//     the badge never claims a read the server refused.
//   • It also re-reads when the page becomes visible again: an installed iOS
//     web app resumes without a window focus event.
//
// NOT real-time: rows are read on mount, on focus / resume, and after any
// mark-read. A notification created meanwhile shows up on the next of those.
// ===========================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { Notification } from "@/types";
import {
  NOTIFICATIONS_URL,
  markNotificationsRead,
  parseNotificationList,
  subscribeNotifications,
  unreadCount,
} from "@/lib/notifications-feed";

type LoadResult = { ok: true; items: Notification[] } | { ok: false };

async function loadFeed(): Promise<LoadResult> {
  try {
    const res = await fetch(NOTIFICATIONS_URL);
    if (!res.ok) return { ok: false };
    return { ok: true, items: parseNotificationList(await res.json()) };
  } catch {
    return { ok: false };
  }
}

export type NotificationFeed = {
  items: Notification[];
  /** Real unread count over `items`. 0 → no dot, no badge. */
  unread: number;
  /** True until the first load settles. */
  loading: boolean;
  /** The last load failed. With `loaded`, the list shown is the previous one. */
  error: boolean;
  /** At least one load has succeeded. */
  loaded: boolean;
  refresh: () => void;
  /** Mark these ids read. Resolves false (and restores them) if the server refused. */
  markRead: (ids: string[]) => Promise<boolean>;
};

export function useNotificationFeed(): NotificationFeed {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Only the newest request may write state: a slow focus refetch must not
  // overwrite the fresher read that follows a mark-read.
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++seq.current;
    void loadFeed().then((r) => {
      if (mine !== seq.current) return;
      if (r.ok) {
        setItems(r.items);
        setLoaded(true);
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const requests = seq;
    refresh();
    const unsub = subscribeNotifications(refresh);
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      requests.current++; // drop any in-flight result
    };
  }, [refresh]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return true;
      const target = new Set(ids);
      setItems((prev) => prev.map((n) => (target.has(n.id) ? { ...n, isRead: true } : n)));
      // On success this broadcasts, and every mounted feed (this one included) re-reads.
      const ok = await markNotificationsRead(ids);
      if (!ok) {
        setItems((prev) => prev.map((n) => (target.has(n.id) ? { ...n, isRead: false } : n)));
        refresh();
      }
      return ok;
    },
    [refresh],
  );

  return { items, unread: unreadCount(items), loading, error, loaded, refresh, markRead };
}
