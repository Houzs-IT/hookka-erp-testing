// ===========================================================================
// notification-links — pure helpers for the /m Updates → Notifications view.
//
// Notification links are DESKTOP paths (the IT Support hook writes
// `/it-support?ticket=HK-0001`; older rows carry `/sales/SO-…`, `/inventory`,
// `/finance/invoices`, …). Following one verbatim from /m would drop the user
// out of the phone shell onto a desktop page, and a stored link is data, so it
// must never be trusted as a URL. `toMobilePath` therefore:
//   • accepts only a same-origin absolute path ("/x", never "//x", "http:",
//     "javascript:", backslashes or whitespace);
//   • maps a known desktop path to its mobile LIST screen (no guessed detail
//     ids: e.g. /sales/SO-2604-045 is a document number, and the mobile sales
//     detail route is keyed by id);
//   • returns null for anything else, and the caller expands the card instead
//     of navigating.
//
// No React and no config imports, so the node tests load this file directly.
// ===========================================================================
import type { Notification } from "@/types";

/** Desktop path prefix → mobile screen. First match wins; most specific first. */
const DESKTOP_TO_MOBILE: { from: string; to: string }[] = [
  { from: "/finance/invoices", to: "/m/invoices" },
  { from: "/invoices", to: "/m/invoices" },
  { from: "/sales", to: "/m/sales" },
  { from: "/delivery", to: "/m/delivery" },
  { from: "/inventory", to: "/m/inventory" },
  { from: "/production", to: "/m/production" },
  { from: "/announcements", to: "/m/announcements" },
];

/** /m screens a link may already point at (first segment after /m/). */
const MOBILE_SEGMENTS = new Set([
  "sales",
  "delivery",
  "invoices",
  "inventory",
  "production",
  "announcements",
  "updates",
  "it-support",
]);

// A path that starts with exactly one "/", followed by safe URL characters only.
const SAFE_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/;

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** The mobile route for a stored notification link, or null if there is none. */
export function toMobilePath(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const raw = link.trim();
  if (!raw || !SAFE_PATH.test(raw)) return null;

  const hashAt = raw.indexOf("#");
  const noHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const qAt = noHash.indexOf("?");
  const path = (qAt === -1 ? noHash : noHash.slice(0, qAt)).replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(qAt === -1 ? "" : noHash.slice(qAt + 1));
  // No "." / ".." segments (plain or %-encoded): a link must not walk out of
  // the screen it names.
  for (const seg of path.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (decoded === "." || decoded === "..") return null;
  }

  // IT Support is the one deep link the mobile screen understands (?ticket=).
  if (underPrefix(path, "/it-support") || underPrefix(path, "/m/it-support")) {
    const ticket = query.get("ticket");
    return ticket ? `/m/it-support?ticket=${encodeURIComponent(ticket)}` : "/m/it-support";
  }

  if (underPrefix(path, "/m")) {
    const segment = path.split("/")[2] ?? "";
    return MOBILE_SEGMENTS.has(segment) ? path : null;
  }

  for (const { from, to } of DESKTOP_TO_MOBILE) {
    if (underPrefix(path, from)) return to;
  }
  return null;
}

export type NotificationGroup = { label: string; items: Notification[] };

const GROUP_ORDER = ["Today", "Yesterday", "This Week", "Older"] as const;

/** Same buckets as the desktop /notifications page, by the device's local day. */
export function dateGroupLabel(createdAt: string, now: Date = new Date()): string {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return "Older";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= today) return "Today";
  if (t >= today - 86400000) return "Yesterday";
  if (t >= today - 6 * 86400000) return "This Week";
  return "Older";
}

/** Rows grouped Today / Yesterday / This Week / Older, newest first, empty groups dropped. */
export function groupNotifications(
  list: readonly Notification[],
  now: Date = new Date(),
): NotificationGroup[] {
  const byNewest = [...list].sort((a, b) =>
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
  const map = new Map<string, Notification[]>();
  for (const n of byNewest) {
    const label = dateGroupLabel(n.createdAt, now);
    const bucket = map.get(label);
    if (bucket) bucket.push(n);
    else map.set(label, [n]);
  }
  return GROUP_ORDER.filter((l) => map.has(l)).map((label) => ({ label, items: map.get(label)! }));
}

/** "Just now" / "5 min ago" / "3 hours ago" / "Yesterday" / "4 days ago" / a date. */
export function relativeTime(createdAt: string, now: Date = new Date()): string {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((now.getTime() - t) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
}
