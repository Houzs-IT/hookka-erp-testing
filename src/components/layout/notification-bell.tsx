// ---------------------------------------------------------------------------
// NotificationBell — the top-bar bell, wired to the real notification feed.
//
// Before this it was a `<button>` with no onClick and a hardcoded pink dot, so
// it was both unclickable and permanently "unread". The dot now renders ONLY
// when `unreadCount(...) > 0` over the same rows /notifications renders, and
// clicking opens a popover of the most recent items (unread first) with a
// "View all" link to the page. A popover, not a navigation, because the common
// case — glance, see it's the nightly stock alert, move on — should not cost
// the operator their current page.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useInterval } from "@/lib/scheduler";
import type { Notification } from "@/types";
import {
  addSeen,
  tryLoadNotifications,
  markNotificationsRead,
  recentForBell,
  subscribeNotifications,
  unreadCount,
  isUnread,
  newArrivals,
  notificationTarget,
} from "@/lib/notifications-feed";

// HK-0155: ERP users have no push, so the bell polls and pops up new rows
// itself. Keeps polling in a background tab so the OS notification still fires.
const POLL_MS = 60_000;
const POPUP_MS = 10_000;

/** OS-level pop-up, only when the user allowed it. Best-effort: some browsers
 *  (Android Chrome) have no Notification constructor and throw. */
function showSystemNotification(n: Notification, onClick: () => void) {
  try {
    if (typeof window.Notification === "undefined" || window.Notification.permission !== "granted") return;
    const sys = new window.Notification(n.title, { body: n.message, tag: n.id, icon: "/pwa-icon-erp-192.png" });
    sys.onclick = () => {
      window.focus();
      sys.close();
      onClick();
    };
  } catch {
    /* no OS pop-up on this browser — the in-app card still shows */
  }
}

const SEVERITY_DOT: Record<Notification["severity"], string> = {
  CRITICAL: "bg-[#9A3A2D]",
  WARNING: "bg-[#9C6F1E]",
  INFO: "bg-[#3E6570]",
};

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  if (!Number.isFinite(diffMs)) return "";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [popup, setPopup] = useState<{ n: Notification; more: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string> | null>(null);
  const openItemRef = useRef<(n: Notification) => void>(() => {});

  const refresh = useCallback(() => {
    void tryLoadNotifications().then((list) => {
      // A failed load changes nothing, so the next good one can't pop the whole backlog.
      if (!list) return;
      const fresh = newArrivals(seenRef.current, list);
      seenRef.current = addSeen(seenRef.current, list);
      setItems(list);
      if (fresh.length === 0) return;
      setPopup({ n: fresh[0], more: fresh.length - 1 });
      // OS notification only when the tab is out of sight; in front, the card is enough.
      if (document.hidden) {
        for (const n of fresh.slice(0, 3)) showSystemNotification(n, () => openItemRef.current(n));
      }
    });
  }, []);

  useInterval(refresh, POLL_MS, { pauseOnHidden: false });

  useEffect(() => {
    if (!popup) return;
    // eslint-disable-next-line no-restricted-syntax -- must re-arm for each new pop-up; useTimeout re-arms only when ms changes
    const t = window.setTimeout(() => setPopup(null), POPUP_MS);
    return () => window.clearTimeout(t);
  }, [popup]);

  // First paint, plus whenever the OTHER surface (the /notifications page)
  // marks something read, plus when the tab regains focus.
  useEffect(() => {
    refresh();
    const unsub = subscribeNotifications(refresh);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = unreadCount(items);
  const recent = recentForBell(items);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    // Optimistic — the broadcast from markNotificationsRead re-reads the
    // server copy right after, so a rejected write self-corrects.
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n)));
    await markNotificationsRead(ids);
  }

  function openItem(n: Notification) {
    setOpen(false);
    setPopup(null);
    if (isUnread(n)) void markRead([n.id]);
    navigate(notificationTarget(n));
  }
  useEffect(() => {
    openItemRef.current = openItem;
  });

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
        onClick={() => {
          const next = !open;
          setOpen(next);
          setPopup(null);
          if (next) refresh();
          // Ask once, on a click (browsers ignore a prompt without one), so new
          // notices can also pop up as OS notifications while the tab is hidden.
          if (typeof window.Notification !== "undefined" && window.Notification.permission === "default") {
            // Old Safari returns undefined (callback form), hence Promise.resolve.
            void Promise.resolve(window.Notification.requestPermission()).catch(() => {});
          }
        }}
        className={cn(
          "relative rounded-md p-2 text-[#6B7280] hover:bg-[#F0ECE9] transition-colors",
          open && "bg-[#F0ECE9] text-[#1F1D1B]",
        )}
      >
        <Bell className="h-5 w-5" />
        {/* Real unread state only. No unread → no dot. */}
        {unread > 0 && (
          <span
            data-testid="notification-unread-dot"
            className="absolute -right-0.5 -top-0.5 min-w-[1rem] rounded-full bg-[#EC4899] px-1 text-[10px] font-semibold leading-4 text-white tabular-nums"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {popup && !open && (
        <div
          role="alert"
          className="absolute right-0 top-full mt-1 w-80 max-w-[90vw] rounded-md border border-[#E2DDD8] bg-white shadow-lg z-50"
        >
          <button
            type="button"
            onClick={() => openItem(popup.n)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#F0ECE9]"
          >
            <span
              className={cn(
                "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                SEVERITY_DOT[popup.n.severity] ?? "bg-[#3E6570]",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[#1F1D1B]">{popup.n.title}</span>
              <span className="block truncate text-xs text-[#6B7280]">{popup.n.message}</span>
              {popup.more > 0 && (
                <span className="mt-0.5 block text-[10px] text-[#9CA3AF]">
                  +{popup.more} more new notification{popup.more === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setPopup(null)}
            className="absolute right-1 top-1 rounded px-1 text-xs text-[#9CA3AF] hover:text-[#1F1D1B]"
          >
            ×
          </button>
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 w-96 max-w-[90vw] rounded-md border border-[#E2DDD8] bg-white shadow-lg z-50">
          <div className="flex items-center justify-between border-b border-[#E2DDD8] px-3 py-2">
            <span className="text-sm font-semibold text-[#1F1D1B]">
              Notifications{unread > 0 ? ` · ${unread} unread` : ""}
            </span>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-[#6B5C32] hover:text-[#4D4224] disabled:text-[#C9C3BC]"
              disabled={unread === 0}
              onClick={() => void markRead(items.filter(isUnread).map((n) => n.id))}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-[#6B7280]">
                No notifications to show
              </div>
            ) : (
              recent.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b border-[#F0ECE9] px-3 py-2 text-left hover:bg-[#F0ECE9]",
                    isUnread(n) ? "bg-[#FAF9F7]" : "bg-white",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                      SEVERITY_DOT[n.severity] ?? "bg-[#3E6570]",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm",
                        isUnread(n)
                          ? "font-semibold text-[#1F1D1B]"
                          : "font-medium text-[#4B5563]",
                      )}
                    >
                      {n.title}
                    </span>
                    <span className="block truncate text-xs text-[#6B7280]">{n.message}</span>
                    <span className="mt-0.5 block text-[10px] text-[#9CA3AF]">
                      {n.type} · {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            className="w-full border-t border-[#E2DDD8] px-3 py-2 text-center text-xs font-medium text-[#6B5C32] hover:bg-[#F0ECE9]"
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
