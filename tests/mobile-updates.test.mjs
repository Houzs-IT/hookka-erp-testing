// ---------------------------------------------------------------------------
// mobile-updates.test.mjs — /m/updates: Notifications | Announcements (Phase 1,
// owner 2026-10-13).
//
// Pins:
//   • notification links: only same-origin paths with a known mobile screen
//     navigate; everything else returns null (the card expands instead);
//   • date grouping / relative time used by the Notifications view;
//   • the screen: Notifications default, view in ?view= (replace), a REAL
//     unread badge on Notifications only, no Announcements badge, opening a
//     card marks only that id, switching tabs marks nothing, no announcement
//     read / ack call anywhere;
//   • the Home bell: no hardcoded dot, rendered only when unread > 0, opens
//     /m/updates;
//   • SegmentedSwitch: a badge renders only for a count > 0, and an option
//     without one renders its bare label (Home unchanged).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }

const links = await import(
  pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/notification-links.ts")).href
);
const read = (p) => readFileSync(new URL(`../src/pages/m/${p}`, import.meta.url), "utf8");
const updates = read("screens/UpdatesScreen.tsx");
const home = read("screens/Home.tsx");
const sw = read("components/SegmentedSwitch.tsx");
const announcements = read("screens/AnnouncementsScreen.tsx");
const layout = read("MobileLayout.tsx");
const feedHook = read("lib/use-notification-feed.ts");

// ── Link mapping ───────────────────────────────────────────────────────────

test("known desktop links map to their mobile list screen", () => {
  const { toMobilePath } = links;
  assert.equal(toMobilePath("/sales/SO-2604-045"), "/m/sales");
  assert.equal(toMobilePath("/sales"), "/m/sales");
  assert.equal(toMobilePath("/finance/invoices"), "/m/invoices");
  assert.equal(toMobilePath("/invoices/abc"), "/m/invoices");
  assert.equal(toMobilePath("/delivery"), "/m/delivery");
  assert.equal(toMobilePath("/inventory"), "/m/inventory");
  assert.equal(toMobilePath("/production"), "/m/production");
  assert.equal(toMobilePath("/announcements"), "/m/announcements");
});

test("IT Support keeps only the ticket deep link", () => {
  const { toMobilePath } = links;
  assert.equal(toMobilePath("/it-support?ticket=HK-0001"), "/m/it-support?ticket=HK-0001");
  assert.equal(toMobilePath("/it-support?ticket=HK-0001&new=1"), "/m/it-support?ticket=HK-0001");
  assert.equal(toMobilePath("/it-support"), "/m/it-support");
  assert.equal(toMobilePath("/m/it-support?ticket=HK 1".replace(" ", "%20")), "/m/it-support?ticket=HK%201");
});

test("existing /m links pass only for known screens", () => {
  const { toMobilePath } = links;
  assert.equal(toMobilePath("/m/sales/123"), "/m/sales/123");
  assert.equal(toMobilePath("/m/updates"), "/m/updates");
  assert.equal(toMobilePath("/m/usermgmt"), null);
  assert.equal(toMobilePath("/m"), null);
});

test("unsafe or unknown links never navigate", () => {
  const { toMobilePath } = links;
  for (const bad of [
    null,
    undefined,
    "",
    "   ",
    42,
    "https://evil.example/x",
    "http:/sales",
    "//evil.example/sales",
    "/\\evil.example",
    "javascript:alert(1)",
    "/javascript:alert(1)",
    "sales/SO-1",
    "/sales/../../admin".replace("/sales", "/m/sales"),
    "/m/sales/%2e%2e/%2e%2e/admin",
    "/m/sales/%E0%A4%A",
    "/quality",
    "/finance",
    "/settings/users",
    "/sales\n/x",
  ]) {
    assert.equal(toMobilePath(bad), null, String(bad));
  }
});

// ── Grouping + time ────────────────────────────────────────────────────────

const now = new Date(2026, 9, 13, 15, 0, 0); // 13 Oct 2026, 15:00 local
const at = (d, h = 9) => new Date(2026, 9, d, h, 0, 0).toISOString();
const n = (id, createdAt) => ({ id, type: "SYSTEM", title: id, message: "", severity: "INFO", isRead: false, createdAt });

test("groups Today / Yesterday / This Week / Older, newest first, empty groups dropped", () => {
  const groups = links.groupNotifications(
    [n("old", at(1)), n("today-early", at(13, 8)), n("yday", at(12)), n("today-late", at(13, 14)), n("week", at(9))],
    now,
  );
  assert.deepEqual(groups.map((g) => g.label), ["Today", "Yesterday", "This Week", "Older"]);
  assert.deepEqual(groups[0].items.map((x) => x.id), ["today-late", "today-early"]);
  assert.deepEqual(links.groupNotifications([n("y", at(12))], now).map((g) => g.label), ["Yesterday"]);
  assert.equal(links.dateGroupLabel("not a date", now), "Older");
});

test("relativeTime", () => {
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  assert.equal(links.relativeTime(ago(10_000), now), "Just now");
  assert.equal(links.relativeTime(ago(5 * 60_000), now), "5 min ago");
  assert.equal(links.relativeTime(ago(3 * 3_600_000), now), "3 hours ago");
  assert.equal(links.relativeTime(ago(26 * 3_600_000), now), "Yesterday");
  assert.equal(links.relativeTime("garbage", now), "");
});

// ── Updates screen ─────────────────────────────────────────────────────────

test("route: /m/updates is mounted; /m/announcements routes are unchanged", () => {
  assert.match(layout, /<Route path="updates" element=\{<UpdatesScreen \/>\} \/>/);
  assert.match(layout, /announcements: AnnouncementsScreen,/);
});

test("Notifications is the default view and the view lives in ?view= (replace)", () => {
  assert.match(updates, /params\.get\("view"\) === "announcements" \? "announcements" : "notifications"/);
  assert.match(updates, /setParams\(next, \{ replace: true \}\)/);
});

test("only Notifications carries a badge, and it is the real unread count", () => {
  assert.match(updates, /key: "notifications",\s*label: "Notifications",\s*badge: feed\.unread,/);
  assert.match(updates, /\{ key: "announcements", label: "Announcements" \}/);
  const code = updates.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal((code.match(/\bbadge:/g) ?? []).length, 1);
});

test("switching tabs marks nothing; opening a card marks only that id", () => {
  const setView = updates.match(/const setView = \([\s\S]*?\n  \};/)?.[0] ?? "";
  assert.ok(setView, "setView found");
  assert.doesNotMatch(setView, /markRead|markNotificationsRead/);
  assert.match(updates, /if \(isUnread\(n\)\) void feed\.markRead\(\[n\.id\]\)/);
  // Mark-all is an explicit header action only.
  assert.equal((updates.match(/feed\.markRead\(ids\)/g) ?? []).length, 1);
  assert.match(updates, /aria-label="Mark all notifications read"/);
});

test("no announcement read / ack write anywhere in Updates or the list", () => {
  for (const src of [updates, announcements]) {
    assert.doesNotMatch(src, /\/ack\b|\/view\b|method:\s*"(POST|PUT|PATCH)"/);
  }
});

test("links go through toMobilePath, never straight to navigate(n.link)", () => {
  assert.doesNotMatch(updates, /navigate\(n\.link\)/);
  assert.match(updates, /const target = toMobilePath\(n\.link\);/);
});

test("explicit loading, error, empty and no-results states", () => {
  assert.match(updates, /"Loading…"/);
  assert.match(updates, /"Couldn’t load notifications\."/);
  assert.match(updates, /"No notifications yet\."/);
  assert.match(updates, /"No notifications match your search or filters\."/);
  assert.match(updates, /<TextButton onClick=\{clearAll\}>Clear search and filters<\/TextButton>/);
  // Search + filter controls stay disabled until the first load succeeds.
  assert.match(updates, /const disabled = !feed\.loaded;/);
  // A failed load is not an empty list.
  assert.match(feedHook, /if \(!res\.ok\) return \{ ok: false \};/);
  assert.match(feedHook, /void loadFeed\(\)\.then\(/);
  assert.match(feedHook, /\} else \{\s*setError\(true\);\s*\}/);
});

test("a refused mark-read is rolled back, not left looking read", () => {
  assert.match(feedHook, /const ok = await markNotificationsRead\(ids\);\s*if \(!ok\) \{\s*setItems\(\(prev\) => prev\.map\(\(n\) => \(target\.has\(n\.id\) \? \{ \.\.\.n, isRead: false \} : n\)\)\);/);
});

// ── Home bell ──────────────────────────────────────────────────────────────

test("Home bell: no hardcoded dot; real unread only; opens /m/updates", () => {
  assert.doesNotMatch(home, /TODO\(wave-x\): wire to a real notifications surface/);
  assert.doesNotMatch(home, /navigate\("\/m\/announcements"\)/);
  assert.match(home, /onClick=\{\(\) => navigate\("\/m\/updates"\)\}/);
  assert.match(home, /\{unreadNotifications > 0 \? \(\s*<span\s*data-testid="mobile-notification-unread-dot"/);
  assert.match(home, /const \{ unread: unreadNotifications \} = useNotificationFeed\(\);/);
});

// ── SegmentedSwitch badge ──────────────────────────────────────────────────

test("SegmentedSwitch: badge only for a count > 0, bare label otherwise", () => {
  assert.match(sw, /typeof o\.badge === "number" && o\.badge > 0/);
  assert.match(sw, /\{count > 99 \? "99\+" : count\}/);
  assert.match(sw, /\) : \(\s*o\.label\s*\)\}/);
  // Home passes no badge, so its switch is unchanged.
  assert.doesNotMatch(home, /badge:/);
});

// ── Card: desktop visual language (approved 2026-10-13) ────────────────────

const css = read("theme-vars.css");
const theme = read("theme.ts");
const filterSheet = read("screens/NotificationFilterSheet.tsx");

test("severity tokens: light = desktop dot hex (Warning darkened for text), dark lifted", () => {
  const light = css.slice(0, css.indexOf('body[data-theme="dark"]'));
  const dark = css.slice(css.indexOf('body[data-theme="dark"]'));
  assert.match(light, /--m-sev-critical: #9A3A2D;/);
  assert.match(light, /--m-sev-warning: #976B1C;/); // darkened for 4.5:1 as text
  assert.match(light, /--m-sev-info: #3E6570;/);
  assert.match(dark, /--m-sev-critical: #D67B6B;/);
  assert.match(dark, /--m-sev-warning: #D9A441;/);
  assert.match(dark, /--m-sev-info: #6FA3B0;/);
  assert.match(theme, /sevCritical: "var\(--m-sev-critical\)"/);
});

test("dot and left bar share ONE severity map; read state never changes it", () => {
  assert.match(updates, /CRITICAL: \{ color: M\.sevCritical, label: "Critical" \}/);
  assert.match(updates, /WARNING: \{ color: M\.sevWarning, label: "Warning" \}/);
  assert.match(updates, /INFO: \{ color: M\.sevInfo, label: "Info" \}/);
  assert.match(updates, /data-severity-bar[\s\S]{0,200}backgroundColor: severity \? severity\.color : M\.hairline/);
  assert.match(updates, /data-severity-dot[\s\S]{0,200}backgroundColor: severity\.color/);
  // Nothing about the severity colour mentions read/unread.
  assert.doesNotMatch(updates, /unread \? M\.sev|severity\.color[^;\n]*unread/);
});

test("plain-text severity word in the SAME colour as dot + bar, no pills, no unread dot", () => {
  assert.match(updates, /data-severity-label style=\{\{ flex: "none", fontWeight: 600, color: severity\.color \}\}>\s*\{severity\.label\}/);
  assert.doesNotMatch(updates, /StatusPill/);
  assert.doesNotMatch(updates, /aria-label="Unread"/);
});

test("title weight 600 unread / 500 read", () => {
  assert.match(updates, /fontWeight: unread \? 600 : 500,\s*color: unread \? M\.raisin : M\.body,/);
});

test("category pill + date stay on one line", () => {
  assert.match(updates, /\{titleCaseStatus\(n\.type\) \|\| "Other"\}/);
  assert.match(updates, /fontSize: 11,\s*fontWeight: 500,\s*whiteSpace: "nowrap",/);
});

// ── Search + filters ───────────────────────────────────────────────────────

test("All / Unread chips are gone; one search + filter button instead", () => {
  assert.doesNotMatch(updates, /label: "Unread"/);
  assert.doesNotMatch(updates, /Unread · \$\{feed\.unread\}/);
  assert.match(updates, /aria-label="Search notifications"/);
  assert.match(updates, /fontSize: 16,/); // no iOS zoom
  assert.match(updates, /aria-label=\{activeCount > 0 \? `Filters, \$\{activeCount\} active` : "Filters"\}/);
  assert.match(updates, /<NotificationFilterSheet/);
});

test("search + filters live in the URL (replace) and a stale search cannot undo Clear all", () => {
  assert.match(updates, /const applied = readNotificationParams\(params\);/);
  assert.match(updates, /if \(effectiveQ === lastWrittenQ\.current\) return;/);
  assert.equal((updates.match(/\{ replace: true \}/g) ?? []).length, 4);
});

test("counts and Mark all read ignore search and filters", () => {
  assert.match(updates, /badge: feed\.unread,/);
  assert.match(updates, /const ids = feed\.items\.filter\(isUnread\)\.map\(\(n\) => n\.id\);/);
  // Confirm ONLY while something is filtered, using the /m window.confirm pattern.
  assert.match(updates, /filtering &&\s*!window\.confirm\(/);
  assert.match(updates, /This includes notifications hidden by your search or filters\./);
});

test("filter sheet: single-select radiogroups, draft discarded on close, Reset + Show N", () => {
  assert.equal((filterSheet.match(/<ChipGroup/g) ?? []).length, 3);
  assert.match(filterSheet, /role="radiogroup"/);
  assert.match(filterSheet, /role="radio"\s*aria-checked=\{on\}\s*tabIndex=\{on \? 0 : -1\}/);
  assert.match(filterSheet, /if \(open && !wasOpen\) \{\s*setWasOpen\(true\);\s*setDraft\(filters\);/);
  assert.match(filterSheet, /onClick=\{\(\) => setDraft\(DEFAULT_FILTERS\)\}/);
  assert.match(filterSheet, /onClick=\{\(\) => onApply\(draft\)\}/);
  assert.match(filterSheet, /`Show \$\{count\} results`/);
  assert.match(filterSheet, /height: 44,/);
});

// ── Card polish: phone only (owner 2026-10-13) ─────────────────────────────

test("phone card rhythm matches Announcements; tablet keeps its original values", () => {
  const phone = updates.match(/const CARD_PHONE = \{[\s\S]*?\} as const;/)?.[0] ?? "";
  const tablet = updates.match(/const CARD_TABLET = \{[\s\S]*?\} as const;/)?.[0] ?? "";
  const has = (block, k, v) => assert.ok(block.includes(`${k}: ${v},`), `${k}: ${v}`);
  for (const [k, v] of Object.entries({
    padding: '"13px 15px 13px 18px"', gapBelow: "11", titleSize: "15", titleTracking: '"-0.2px"',
    messageTop: "4", messageColor: "M.body", metaTop: "10", metaColor: "M.body", chevronColor: "M.muted",
  })) has(phone, k, v);
  // Tablet: exactly the values the card had before the phone polish.
  for (const [k, v] of Object.entries({
    padding: '"12px 13px 12px 16px"', gapBelow: "10", titleSize: "14", titleTracking: "undefined",
    messageTop: "3", messageColor: "M.muted", metaTop: "8", metaColor: "M.faint", chevronColor: "M.faint",
  })) has(tablet, k, v);
  assert.match(updates, /const phone = useResponsiveLayout\(\)\.mode === "phone";\s*const card = phone \? CARD_PHONE : CARD_TABLET;/);
});

test("phone titles wrap to at most 2 lines; tablet keeps one line with an ellipsis", () => {
  assert.match(updates, /display: "-webkit-box",\s*WebkitLineClamp: 2,\s*WebkitBoxOrient: "vertical" as const,\s*wordBreak: "break-word" as const,/);
  assert.match(updates, /: \{ textOverflow: "ellipsis", whiteSpace: expanded \? "normal" : "nowrap" \}\),/);
  assert.match(updates, /marginTop: phone \? 7 : 0,/);
});
