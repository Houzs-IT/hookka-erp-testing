// ===========================================================================
// notification-filters — pure search + filter rules for /m/updates →
// Notifications (owner 2026-10-13).
//
// Everything runs over the rows GET /api/notifications already returned; no
// new request. The option values are the DB's own CHECK values
// (migrations/0001_init.sql: type IN ORDER…SYSTEM, severity IN INFO / WARNING
// / CRITICAL). A row whose type / severity is missing or unknown only appears
// while that group is on "All".
//
// Search: the row's title + message + link REFERENCE, lower-cased; every word
// of the query must appear. The reference is the `ticket` query value, else the
// last path segment when it carries a digit (`/sales/SO-2604-045` →
// `SO-2604-045`), so a bare module path like `/finance/invoices` adds nothing.
//
// The groups AND together and with the search. Filters live in the URL
// (`q`, `cat`, `read`, `sev`; defaults omitted) so Back restores them.
//
// `isUnread` is imported by a relative path: this file is loaded directly by
// node tests, where the `@/` alias is not resolved at runtime.
// ===========================================================================
import type { Notification } from "@/types";
import { isUnread } from "../../../lib/notifications-feed";

export type CategoryFilter = "all" | Notification["type"];
export type ReadFilter = "all" | "unread" | "read";
export type SeverityFilter = "all" | Notification["severity"];

export type NotificationFilters = {
  category: CategoryFilter;
  read: ReadFilter;
  severity: SeverityFilter;
};

export const DEFAULT_FILTERS: NotificationFilters = { category: "all", read: "all", severity: "all" };

export const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "ORDER", label: "Orders" },
  { value: "PRODUCTION", label: "Production" },
  { value: "INVENTORY", label: "Inventory" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "QUALITY", label: "Quality" },
  { value: "FINANCE", label: "Finance" },
  { value: "SYSTEM", label: "System" },
];

export const READ_OPTIONS: { value: ReadFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

export const SEVERITY_OPTIONS: { value: SeverityFilter; label: string }[] = [
  { value: "all", label: "All severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "WARNING", label: "Warning" },
  { value: "INFO", label: "Info" },
];

const has = <T extends string>(opts: { value: T }[], v: string | null): v is T =>
  v != null && opts.some((o) => o.value === v);

/** The ticket / document number a link points at, or "" for a bare module path. */
export function notificationReference(link: unknown): string {
  if (typeof link !== "string" || !link.startsWith("/")) return "";
  const qAt = link.indexOf("?");
  const path = (qAt === -1 ? link : link.slice(0, qAt)).split("#")[0];
  if (qAt !== -1) {
    const ticket = new URLSearchParams(link.slice(qAt + 1).split("#")[0]).get("ticket");
    if (ticket) return ticket;
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return "";
  let last = segments[segments.length - 1];
  try {
    last = decodeURIComponent(last);
  } catch {
    return "";
  }
  return /\d/.test(last) ? last : "";
}

/** Every whitespace-separated word of `query` appears in title + message + reference. */
export function matchesQuery(n: Notification, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${n.title ?? ""} ${n.message ?? ""} ${notificationReference(n.link)}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function matchesFilters(n: Notification, f: NotificationFilters): boolean {
  if (f.category !== "all" && n.type !== f.category) return false;
  if (f.read === "unread" && !isUnread(n)) return false;
  if (f.read === "read" && isUnread(n)) return false;
  if (f.severity !== "all" && n.severity !== f.severity) return false;
  return true;
}

/** Search AND category AND read status AND severity. Order is kept. */
export function filterNotifications(
  list: readonly Notification[],
  query: string,
  f: NotificationFilters,
): Notification[] {
  return list.filter((n) => matchesFilters(n, f) && matchesQuery(n, query));
}

/** How many of the three groups are off "All" (the filter button's count). */
export function activeFilterCount(f: NotificationFilters): number {
  return (f.category !== "all" ? 1 : 0) + (f.read !== "all" ? 1 : 0) + (f.severity !== "all" ? 1 : 0);
}

/** Search + filters from the URL. Unknown values fall back to "All". */
export function readNotificationParams(params: URLSearchParams): { q: string; filters: NotificationFilters } {
  const cat = params.get("cat");
  const read = params.get("read");
  const sev = params.get("sev");
  return {
    q: params.get("q") ?? "",
    filters: {
      category: has(CATEGORY_OPTIONS, cat) ? cat : "all",
      read: has(READ_OPTIONS, read) ? read : "all",
      severity: has(SEVERITY_OPTIONS, sev) ? sev : "all",
    },
  };
}

/** A copy of `params` with search + filters written in; defaults are removed. */
export function writeNotificationParams(
  params: URLSearchParams,
  q: string,
  f: NotificationFilters,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string, isDefault: boolean) => {
    if (isDefault) next.delete(key);
    else next.set(key, value);
  };
  set("q", q, q.trim() === "");
  set("cat", f.category, f.category === "all");
  set("read", f.read, f.read === "all");
  set("sev", f.severity, f.severity === "all");
  return next;
}

/** Label of a value in its option list (for the active-filter row). */
export function optionLabel<T extends string>(opts: { value: T; label: string }[], v: T): string {
  return opts.find((o) => o.value === v)?.label ?? v;
}
