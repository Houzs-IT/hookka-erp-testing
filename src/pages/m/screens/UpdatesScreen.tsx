// ===========================================================================
// UpdatesScreen — /m/updates: Notifications | Announcements (owner 2026-10-13,
// Phase 1).
//
// • One page, the shared SegmentedSwitch. Notifications is the default; the
//   view lives in `?view=` (replace, not push) so Back from an announcement
//   detail lands on the Announcements view again.
// • Notifications: /api/notifications through useNotificationFeed. The tab
//   badge is the REAL unread count of those rows. Opening one card marks THAT
//   card read (and follows its link when it has a mobile screen). Switching
//   tabs, loading, searching or filtering marks nothing. "Mark all read" is an
//   explicit header action and always covers ALL unread rows; while a search
//   or filter hides some, it asks first (the /m `window.confirm` pattern).
// • Search + one filter sheet (Category · Read status · Severity, single-select
//   each, AND together) — rules in lib/notification-filters.ts. State lives in
//   the URL (`q`, `cat`, `read`, `sev`), so Back restores it. Counts (tab badge,
//   Home bell) never depend on the search or filters.
// • Card follows the desktop /notifications row: severity dot beside the title
//   + 3px severity left bar (brand colours; M.sev* lifts them in dark mode),
//   a plain-text severity word, the category pill and the date. Read state
//   only changes the title (600 unread / 500 read) — never the severity colour.
// • Announcements: the existing list (AnnouncementsList) + its + create sheet,
//   unchanged. NO badge: office announcements have no per-user read state yet
//   (Phase 2, not approved), and a count we cannot back is a fake count.
//
// Read-state caveat (backend, unchanged): a notification addressed to nobody
// (user_id NULL, a broadcast) has ONE isRead for the whole org, so reading it
// here reads it for everyone. Today's only producer (IT Support) addresses a
// user, so this applies to older rows only. Copy never says "you read this".
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  ChevronRight,
  DollarSign,
  Factory,
  Package,
  Search,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Notification } from "@/types";
import { isUnread } from "@/lib/notifications-feed";
import { MobileHeader, SegmentedSwitch } from "../components";
import { M, titleCaseStatus } from "../theme";
import { useNotificationFeed, type NotificationFeed } from "../lib/use-notification-feed";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { groupNotifications, relativeTime, toMobilePath } from "../lib/notification-links";
import {
  CATEGORY_OPTIONS,
  DEFAULT_FILTERS,
  READ_OPTIONS,
  SEVERITY_OPTIONS,
  activeFilterCount,
  filterNotifications,
  optionLabel,
  readNotificationParams,
  writeNotificationParams,
  type NotificationFilters,
} from "../lib/notification-filters";
import { useDebounced } from "../lib/use-debounced";
import { AnnouncementsList, NewAnnouncementButton } from "./AnnouncementsScreen";
import { NotificationFilterSheet } from "./NotificationFilterSheet";
import { useNewAnnouncementSheet } from "../lib/use-new-announcement-sheet";

type UpdatesView = "notifications" | "announcements";

export function UpdatesScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: UpdatesView = params.get("view") === "announcements" ? "announcements" : "notifications";
  const feed = useNotificationFeed();
  const create = useNewAnnouncementSheet();
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [markError, setMarkError] = useState(false);

  const setView = (v: UpdatesView) => {
    const next = new URLSearchParams(params);
    if (v === "notifications") next.delete("view");
    else next.set("view", v);
    setParams(next, { replace: true });
  };

  // ALWAYS every unread row, whatever is filtered. Nothing filtered → no
  // prompt (as today, and as the desktop bell / page). Something filtered →
  // the list on screen is not "all", so say so before writing.
  const markAllRead = async () => {
    const ids = feed.items.filter(isUnread).map((n) => n.id);
    if (ids.length === 0 || markAllBusy) return;
    const applied = readNotificationParams(params);
    const filtering = applied.q.trim() !== "" || activeFilterCount(applied.filters) > 0;
    if (
      filtering &&
      !window.confirm(
        `Mark all ${ids.length} unread notification${ids.length === 1 ? "" : "s"} as read? ` +
          "This includes notifications hidden by your search or filters.",
      )
    )
      return;
    setMarkAllBusy(true);
    const ok = await feed.markRead(ids);
    setMarkAllBusy(false);
    setMarkError(!ok);
  };

  return (
    <>
      <MobileHeader
        title="Updates"
        onBack={() => navigate(-1)}
        menu
        trailing={
          view === "notifications" ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={feed.unread === 0 || markAllBusy}
              aria-label="Mark all notifications read"
              title="Mark all read"
              style={{
                width: 44,
                height: 44,
                marginRight: -6,
                borderRadius: 10,
                border: "none",
                background: "transparent",
                color: feed.unread === 0 ? M.faint : M.taupe,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: feed.unread === 0 ? "default" : "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <CheckCheck size={20} strokeWidth={2} />
            </button>
          ) : (
            <NewAnnouncementButton onClick={create.open} />
          )
        }
      />

      <div style={{ padding: "12px 18px 0" }}>
        <SegmentedSwitch
          ariaLabel="Updates view"
          value={view}
          onChange={setView}
          options={[
            {
              key: "notifications",
              label: "Notifications",
              badge: feed.unread,
              badgeLabel: `Notifications, ${feed.unread} unread`,
            },
            { key: "announcements", label: "Announcements" },
          ]}
        />
      </div>

      {view === "notifications" ? (
        <NotificationsView feed={feed} markError={markError} onMarkResult={(ok) => setMarkError(!ok)} />
      ) : (
        <AnnouncementsList />
      )}

      {create.sheet}
    </>
  );
}

// ---------------------------------------------------------------------------
// Notifications view
// ---------------------------------------------------------------------------

const TYPE_ICON: Record<string, LucideIcon> = {
  ORDER: ShoppingCart,
  PRODUCTION: Factory,
  INVENTORY: Package,
  DELIVERY: Truck,
  QUALITY: ShieldCheck,
  FINANCE: DollarSign,
  SYSTEM: Bell,
};

/** Severity → colour (dot + left bar) and its word. Same map for both marks. */
const SEVERITY: Record<string, { color: string; label: string }> = {
  CRITICAL: { color: M.sevCritical, label: "Critical" },
  WARNING: { color: M.sevWarning, label: "Warning" },
  INFO: { color: M.sevInfo, label: "Info" },
};

// Card rhythm. Phone (<720px, owner 2026-10-13) is aligned with the
// Announcements card: 15px title, 13/15 padding (+3px for the severity bar),
// 11px between cards, and the readable M.body for description + date
// (M.muted / M.faint measure 3.1 / 2.5:1). Tablet keeps its original values.
const CARD_PHONE = {
  padding: "13px 15px 13px 18px",
  gapBelow: 11,
  titleSize: 15,
  titleTracking: "-0.2px",
  messageTop: 4,
  messageColor: M.body,
  metaTop: 10,
  metaColor: M.body,
  chevronColor: M.muted,
} as const;
const CARD_TABLET = {
  padding: "12px 13px 12px 16px",
  gapBelow: 10,
  titleSize: 14,
  titleTracking: undefined,
  messageTop: 3,
  messageColor: M.muted,
  metaTop: 8,
  metaColor: M.faint,
  chevronColor: M.faint,
} as const;

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

function NotificationsView({
  feed,
  markError,
  onMarkResult,
}: {
  feed: NotificationFeed;
  markError: boolean;
  onMarkResult: (ok: boolean) => void;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const applied = readNotificationParams(params);
  const filters = applied.filters;
  const [query, setQuery] = useState(applied.q);
  const dq = useDebounced(query, 250);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Clearing the box takes effect at once; typing waits for the debounce.
  const effectiveQ = query.trim() === "" ? "" : dq;
  // The search goes into the URL (replace) so Back restores it. Written only
  // when the debounced value itself changes, so a stale value can never
  // overwrite a "Clear all" that already reset the URL.
  const lastWrittenQ = useRef(effectiveQ);
  useEffect(() => {
    if (effectiveQ === lastWrittenQ.current) return;
    lastWrittenQ.current = effectiveQ;
    setParams((prev) => writeNotificationParams(prev, effectiveQ, readNotificationParams(prev).filters), { replace: true });
  }, [effectiveQ, setParams]);

  const applyFilters = (next: NotificationFilters) =>
    setParams((prev) => writeNotificationParams(prev, readNotificationParams(prev).q, next), { replace: true });

  const clearAll = () => {
    setQuery("");
    setParams((prev) => writeNotificationParams(prev, "", DEFAULT_FILTERS), { replace: true });
  };

  const activeCount = activeFilterCount(filters);
  const filtering = effectiveQ.trim() !== "" || activeCount > 0;
  const shown = useMemo(() => filterNotifications(feed.items, effectiveQ, filters), [feed.items, effectiveQ, filters]);
  const groups = groupNotifications(shown);

  // Opening ONE notification: mark only it read, then follow a mobile-safe
  // link, or expand the card when there is none.
  const open = (n: Notification) => {
    if (isUnread(n)) void feed.markRead([n.id]).then(onMarkResult);
    const target = toMobilePath(n.link);
    if (target) {
      navigate(target);
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n.id)) next.delete(n.id);
      else next.add(n.id);
      return next;
    });
  };

  const activeChips: { key: keyof NotificationFilters; label: string }[] = [];
  if (filters.category !== "all") activeChips.push({ key: "category", label: optionLabel(CATEGORY_OPTIONS, filters.category) });
  if (filters.read !== "all") activeChips.push({ key: "read", label: optionLabel(READ_OPTIONS, filters.read) });
  if (filters.severity !== "all") activeChips.push({ key: "severity", label: optionLabel(SEVERITY_OPTIONS, filters.severity) });

  let body;
  if (feed.loading && !feed.loaded) {
    body = <Msg text="Loading…" />;
  } else if (feed.error && !feed.loaded) {
    body = (
      <Msg text="Couldn’t load notifications.">
        <TextButton onClick={feed.refresh}>Retry</TextButton>
      </Msg>
    );
  } else if (feed.items.length === 0) {
    body = <Msg text="No notifications yet." />;
  } else if (groups.length === 0) {
    body = (
      <Msg text="No notifications match your search or filters.">
        <TextButton onClick={clearAll}>Clear search and filters</TextButton>
      </Msg>
    );
  } else {
    body = (
      <div style={{ padding: "4px 18px 120px" }}>
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".4px",
                textTransform: "uppercase",
                color: M.muted,
                padding: "10px 2px 8px",
              }}
            >
              {g.label}
            </div>
            {g.items.map((n) => (
              <NotificationCard key={n.id} n={n} expanded={expanded.has(n.id)} onOpen={() => open(n)} />
            ))}
          </section>
        ))}
      </div>
    );
  }

  const disabled = !feed.loaded;

  return (
    <>
      {/* Search + filter button */}
      <div style={{ display: "flex", gap: 8, padding: "12px 18px 0" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            height: 44,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 0 0 12px",
            backgroundColor: M.card,
            border: `1px solid ${M.hairline}`,
            borderRadius: 12,
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <Search size={18} strokeWidth={1.75} color={M.faint} aria-hidden />
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search notifications"
            placeholder="Search title, message, ref"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              // 16px: iOS Safari zooms the page into any smaller input.
              fontSize: 16,
              fontFamily: "inherit",
              color: M.raisin,
              padding: 0,
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              style={{
                width: 44,
                height: 42,
                flex: "none",
                border: "none",
                background: "transparent",
                color: M.muted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          ) : (
            <span style={{ width: 4, flex: "none" }} />
          )}
        </div>
        <button
          type="button"
          aria-label={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          disabled={disabled}
          onClick={() => setSheetOpen(true)}
          style={{
            position: "relative",
            width: 44,
            height: 44,
            flex: "none",
            boxSizing: "border-box",
            borderRadius: 12,
            border: `1px solid ${activeCount > 0 ? M.taupe : M.hairline}`,
            backgroundColor: M.card,
            color: activeCount > 0 ? M.taupe : M.ink,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <SlidersHorizontal size={19} strokeWidth={1.75} />
          {activeCount > 0 ? (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                minWidth: 18,
                height: 18,
                boxSizing: "border-box",
                padding: "0 5px",
                borderRadius: 9,
                backgroundColor: M.taupe,
                color: M.card,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: "18px",
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {activeCount}
            </span>
          ) : null}
        </button>
      </div>

      {/* Active filters (only while some are on) */}
      {activeChips.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 4, padding: "4px 14px 0" }}>
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-label={`Remove filter: ${c.label}`}
              onClick={() => applyFilters({ ...filters, [c.key]: "all" })}
              style={{
                height: 44,
                padding: "0 4px",
                border: "none",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span
                style={{
                  height: 30,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "0 9px 0 12px",
                  borderRadius: 999,
                  border: `1px solid ${M.taupe}`,
                  backgroundColor: M.card,
                  color: M.taupe,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
                <X size={14} strokeWidth={2} aria-hidden />
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            style={{
              height: 44,
              padding: "0 8px",
              border: "none",
              background: "transparent",
              color: M.taupe,
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* Result count while searching / filtering; always mounted so screen
          readers hear the change. */}
      <div aria-live="polite" style={{ padding: filtering && feed.loaded ? "8px 20px 0" : 0, fontSize: 12, color: M.muted, fontVariantNumeric: "tabular-nums" }}>
        {filtering && feed.loaded ? `${shown.length} result${shown.length === 1 ? "" : "s"}` : ""}
      </div>

      {feed.error && feed.loaded ? <Notice text="Couldn’t refresh. Showing the last loaded list." onRetry={feed.refresh} /> : null}
      {markError ? <Notice text="Couldn’t mark as read. Please try again." /> : null}

      {body}

      <NotificationFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        countFor={(draft) => filterNotifications(feed.items, effectiveQ, draft).length}
        onApply={(next) => {
          applyFilters(next);
          setSheetOpen(false);
        }}
      />
    </>
  );
}

function NotificationCard({ n, expanded, onOpen }: { n: Notification; expanded: boolean; onOpen: () => void }) {
  const unread = isUnread(n);
  const Icon = TYPE_ICON[n.type] ?? Bell;
  const navigable = toMobilePath(n.link) != null;
  const severity = SEVERITY[n.severity];
  const phone = useResponsiveLayout().mode === "phone";
  const card = phone ? CARD_PHONE : CARD_TABLET;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={navigable ? undefined : expanded}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        gap: 11,
        background: M.card,
        border: `1px solid ${M.border}`,
        borderRadius: 16,
        padding: card.padding,
        marginBottom: card.gapBelow,
        cursor: "pointer",
        boxShadow: "0 1px 0 rgba(31,29,27,.03),0 6px 20px -12px rgba(31,29,27,.14)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Severity left bar (desktop border-l), inside the card so the 16px
          corners stay. Same colour as the dot; read state never changes it. */}
      <span
        aria-hidden
        data-severity-bar
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          backgroundColor: severity ? severity.color : M.hairline,
        }}
      />

      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          flex: "none",
          borderRadius: 9,
          backgroundColor: M.divider,
          color: M.taupe,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={16} strokeWidth={1.75} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Phone: the title may wrap to 2 lines, so the dot sits level with
            the FIRST line (15px × 1.5 line box → 7px down). */}
        <div style={{ display: "flex", alignItems: phone ? "flex-start" : "center", gap: 7 }}>
          {severity ? (
            <span
              aria-hidden
              data-severity-dot
              style={{
                width: 8,
                height: 8,
                flex: "none",
                borderRadius: "50%",
                backgroundColor: severity.color,
                marginTop: phone ? 7 : 0,
              }}
            />
          ) : null}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: card.titleSize,
              letterSpacing: card.titleTracking,
              fontWeight: unread ? 600 : 500,
              color: unread ? M.raisin : M.body,
              overflow: "hidden",
              ...(phone
                ? expanded
                  ? { wordBreak: "break-word" as const }
                  : {
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical" as const,
                      wordBreak: "break-word" as const,
                    }
                : { textOverflow: "ellipsis", whiteSpace: expanded ? "normal" : "nowrap" }),
            }}
          >
            {unread ? <span style={VISUALLY_HIDDEN}>Unread: </span> : null}
            {n.title || "—"}
          </div>
        </div>

        {n.message ? (
          <div
            style={{
              fontSize: 12.5,
              color: card.messageColor,
              marginTop: card.messageTop,
              whiteSpace: expanded ? "pre-wrap" : undefined,
              wordBreak: "break-word",
              ...(expanded
                ? null
                : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }),
            }}
          >
            {n.message}
          </div>
        ) : null}

        {expanded && n.link && !navigable ? (
          <div style={{ fontSize: 11.5, color: M.faint, marginTop: 6 }}>Open the desktop app for more detail.</div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: card.metaTop, fontSize: 11, color: card.metaColor, minWidth: 0 }}>
          {/* Plain-text severity word: the colour alone is not enough
              (Critical vs Warning are close for colour-blind readers). Same
              colour as the dot + bar; every severity token passes 4.5:1 as
              text in both modes. */}
          {severity ? (
            <span data-severity-label style={{ flex: "none", fontWeight: 600, color: severity.color }}>
              {severity.label}
            </span>
          ) : null}
          <span
            style={{
              flex: "none",
              height: 20,
              boxSizing: "border-box",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 8px",
              borderRadius: 999,
              backgroundColor: M.divider,
              color: M.taupe,
              border: `1px solid ${M.hairline}`,
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {titleCaseStatus(n.type) || "Other"}
          </span>
          <span aria-hidden>·</span>
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {relativeTime(n.createdAt)}
          </span>
          {navigable ? (
            <ChevronRight size={16} strokeWidth={1.75} color={card.chevronColor} aria-hidden style={{ marginLeft: "auto", flex: "none" }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Notice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div
      role="status"
      style={{
        margin: "8px 18px 0",
        padding: "9px 12px",
        borderRadius: 10,
        border: `1px solid ${M.border}`,
        backgroundColor: M.divider,
        color: M.body,
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {onRetry ? (
        <TextButton onClick={onRetry} compact>
          Retry
        </TextButton>
      ) : null}
    </div>
  );
}

function TextButton({ onClick, children, compact = false }: { onClick: () => void; children: ReactNode; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: compact ? 32 : 44,
        padding: "0 16px",
        marginTop: compact ? 0 : 14,
        borderRadius: 999,
        border: `1px solid ${M.taupe}`,
        background: "transparent",
        color: M.taupe,
        fontFamily: "inherit",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        flex: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

function Msg({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div style={{ padding: "40px 18px", textAlign: "center", color: M.muted, fontSize: 14 }}>
      <div>{text}</div>
      {children}
    </div>
  );
}
