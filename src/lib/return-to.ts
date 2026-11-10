// ---------------------------------------------------------------------------
// Return-to-opener — review pass 2, H2-9 (Houzs#4822).
//
// A document opened from another page (a report, a map, another document,
// a search result) gets a Back button that returns to THAT page, in the same
// spot, labelled with its name — instead of always dumping you on the
// document's own list.
//
// How: the app shell (WorkspaceTabs) records, on every PUSH navigation, which
// page the new location was opened from, plus that page's scroll position
// and its history index. ObjectPageHeader asks `openerFor(currentHref,
// backTo)`; when the opener is a page other than the document's own list it
// shows "Back to <name>". Going back is a history POP when the opener is the
// previous history entry (the router's ScrollRestoration puts it back in the
// same spot), else a navigate to the opener plus a one-off scroll restore.
//
// Back/forward (POP) never records an opener, so doc A → doc B → Back does
// not make B the opener of A. Per browser tab (sessionStorage, capped,
// 2-hour expiry); a stored href must be a same-origin path.
// ---------------------------------------------------------------------------
import { titleForPath } from "./route-titles";

export const RETURN_TO_KEY = "hookka.returnTo.v1";
const MAX_ENTRIES = 40;
const TTL_MS = 2 * 60 * 60 * 1000;

export type Opener = { href: string; scrollY: number; idx: number | null; at: number };
type Store = { openers: Record<string, Opener> };

let current: { href: string; idx: number | null } | null = null;
let liveScrollY = 0;
let memo: Store | null = null;

const samePath = (v: unknown): v is string => typeof v === "string" && /^\/(?!\/)/.test(v);
const pathOf = (href: string) => href.split("?")[0].replace(/\/+$/, "") || "/";

function load(): Store {
  if (memo) return memo;
  let parsed: Store = { openers: {} };
  try {
    const raw = sessionStorage.getItem(RETURN_TO_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Store>;
      if (v && typeof v === "object" && v.openers && typeof v.openers === "object") {
        for (const [k, o] of Object.entries(v.openers)) {
          if (samePath(k) && o && samePath((o as Opener).href)) parsed.openers[k] = o as Opener;
        }
      }
    }
  } catch {
    parsed = { openers: {} };
  }
  memo = parsed;
  return parsed;
}

function save(s: Store): void {
  memo = s;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked — in-memory only */
  }
}

/** The shell's scroll listener keeps this current (window scroll). */
export function noteScroll(y: number): void {
  liveScrollY = Number.isFinite(y) ? y : 0;
}

/**
 * Record a navigation. `action` is the router's navigation type. Only a PUSH
 * records the page left behind as the new location's opener.
 */
export function recordReturnVisit(
  href: string,
  action: "PUSH" | "POP" | "REPLACE",
  idx: number | null,
  now: number = Date.now(),
): void {
  const prev = current;
  current = { href, idx };
  if (action !== "PUSH" || !prev || prev.href === href) return;
  const s = load();
  const openers = { ...s.openers, [href]: { href: prev.href, scrollY: liveScrollY, idx: prev.idx, at: now } };
  // Cap: drop the oldest entries.
  const keys = Object.keys(openers);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => openers[a].at - openers[b].at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete openers[k]);
  }
  save({ openers });
}

/**
 * The page this document was opened from, when it is worth its own Back:
 * not the document's own list (`backTo` — the normal Back already goes
 * there), not the document itself, not a create page, not expired.
 */
export function openerFor(href: string, backTo?: string, now: number = Date.now()): Opener | null {
  const o = load().openers[href];
  if (!o || !samePath(o.href)) return null;
  if (now - o.at > TTL_MS) return null;
  const from = pathOf(o.href);
  if (from === pathOf(href)) return null;
  if (backTo && from === pathOf(backTo)) return null;
  if (/\/(create|new)$/.test(from)) return null;
  return o;
}

/** "Back to Purchase Order" — the opener named by its page title. */
export function openerLabel(o: Opener): string {
  return `Back to ${titleForPath(pathOf(o.href))}`;
}

/** True when the opener is the previous history entry (a POP restores it in place). */
export function openerIsPreviousEntry(o: Opener, currentIdx: number | null): boolean {
  return o.idx !== null && currentIdx !== null && currentIdx === o.idx + 1;
}

export function resetReturnToForTests(): void {
  current = null;
  liveScrollY = 0;
  memo = { openers: {} };
}
