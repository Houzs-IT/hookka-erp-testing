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
//   • 2026-10-16 phone pass (Updates.dc.html): phone-only visuals, tablet
//     values kept; filter icon (no sort); Announcements "Live" (isActive) and
//     no author (createdBy is a user id).
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
  assert.match(updates, /<TextButton onClick=\{clearAll\} elevated=\{phone\}>\s*Clear search and filters\s*<\/TextButton>/);
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

test("title weight: phone 700 unread / 600 read (raisin); tablet 600 / 500", () => {
  assert.match(
    updates,
    /fontWeight: phone \? \(unread \? 700 : 600\) : unread \? 600 : 500,\s*color: phone \? M\.raisin : unread \? M\.raisin : M\.body,/,
  );
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
    padding: '"14px 14px 13px 17px"', gap: "12", tile: "36", tileRadius: "11", iconSize: "17",
    gapBelow: "11", titleSize: "15", titleTracking: '"-0.2px"',
    messageTop: "4", messageColor: "M.body", metaTop: "10", metaColor: "M.body", chevronColor: "M.muted",
  })) has(phone, k, v);
  // Tablet: exactly the values the card had before the phone polish.
  for (const [k, v] of Object.entries({
    padding: '"12px 13px 12px 16px"', gap: "11", tile: "32", tileRadius: "9", iconSize: "16",
    gapBelow: "10", titleSize: "14", titleTracking: "undefined",
    messageTop: "3", messageColor: "M.muted", metaTop: "8", metaColor: "M.faint", chevronColor: "M.faint",
  })) has(tablet, k, v);
  assert.match(updates, /const phone = useResponsiveLayout\(\)\.mode === "phone";\s*const card = phone \? CARD_PHONE : CARD_TABLET;/);
});

test("phone titles wrap to at most 2 lines; tablet keeps one line with an ellipsis", () => {
  assert.match(updates, /display: "-webkit-box",\s*WebkitLineClamp: 2,\s*WebkitBoxOrient: "vertical" as const,\s*wordBreak: "break-word" as const,/);
  assert.match(updates, /: \{ textOverflow: "ellipsis", whiteSpace: expanded \? "normal" : "nowrap" \}\),/);
  assert.match(updates, /marginTop: phone \? 7 : 0,/);
});

// ── Page chrome follows existing /m conventions (2026-10-13 consistency pass) ─

test("search row = the Sales row (18px gutters, 7px gap, 13px inset, 18px icon)", () => {
  // Tablet branch keeps the original row; phone takes the phone Sales row.
  assert.match(updates, /: \{ display: "flex", gap: 7, padding: "12px 18px 4px", minWidth: 0 \}\}>/);
  assert.match(updates, /phone \? \{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px 4px", minWidth: 0 \}/);
  assert.match(updates, /\.\.\.\(phone \? \{ border: "none", borderRadius: 14, boxShadow: SHADOW_CONTROL \} : null\),/);
  assert.match(updates, /gap: 9,\s*padding: "0 0 0 13px",\s*backgroundColor: M\.card,\s*border: `1px solid \$\{M\.hairline\}`,\s*borderRadius: 12,/);
  assert.match(updates, /placeholder="Search title · message · ref"/);
});

test("filter button = the Sales filter button (count beside the icon, taupe when active)", () => {
  assert.match(updates, /width: activeCount > 0 \? undefined : 44,\s*padding: activeCount > 0 \? "0 14px" : 0,\s*backgroundColor: activeCount > 0 \? M\.taupe : M\.card,/);
  assert.doesNotMatch(updates, /position: "absolute",\s*top: -6,/); // no corner badge any more
});

test("active chips use the selected-chip look; headings use the /m section heading", () => {
  assert.match(updates, /border: `1px solid \$\{M\.taupe\}`,\s*background: M_ACCENT\.gold\.bg,\s*color: M\.taupe,\s*fontSize: 12,\s*fontWeight: 600,/);
  assert.match(updates, /fontSize: 11,\s*fontWeight: 700,\s*letterSpacing: 1,\s*textTransform: "uppercase",/);
  assert.match(updates, /fontSize: 11\.5,\s*color: M\.muted,/); // result count = Sales summary strip
});

test("Mark all read uses the 34×34 / radius-10 header action shape", () => {
  assert.match(updates, /width: 34,\s*height: 34,\s*boxSizing: "border-box",\s*borderRadius: 10,/);
});

test("filter sheet = FilterSheet conventions, without double padding", () => {
  assert.match(filterSheet, /<div style=\{\{ display: "grid", gap: 18 \}\}>/);
  assert.doesNotMatch(filterSheet, /padding: "4px 16px 8px"/); // the Sheet already pads 16px
  assert.match(filterSheet, /fontSize: 12, fontWeight: 700, color: M\.raisin/); // SectionLabel
  assert.match(filterSheet, /border: `1px solid \$\{on \? M\.taupe : M\.border\}`,\s*backgroundColor: on \? M\.taupe : M\.card,\s*color: on \? M\.card : M\.body,\s*fontSize: 12,\s*fontWeight: on \? 700 : 500,/);
  assert.match(filterSheet, /flex: 1,\s*height: 44,\s*borderRadius: 12,/);
  assert.equal((filterSheet.match(/style=\{footerButton\(/g) ?? []).length, 2);
});

// ── Phone visual pass (owner 2026-10-16, Updates.dc.html) ──────────────────

test("phone view switch is local (design / Products pattern); shared SegmentedSwitch untouched", () => {
  // The shared switch has no icon support — Home and every other user unchanged.
  assert.doesNotMatch(sw, /icon/i);
  // Phone renders PhoneViewSwitch; tablet keeps the shared SegmentedSwitch.
  assert.match(updates, /\{phone \? \(\s*<div style=\{\{ padding: "6px 18px 0" \}\}>\s*<PhoneViewSwitch view=\{view\} onChange=\{setView\} unread=\{feed\.unread\} \/>/);
  const fn = updates.match(/function PhoneViewSwitch\([\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.ok(fn, "PhoneViewSwitch found");
  assert.match(fn, /gap: 4,\s*height: 46,\s*boxSizing: "border-box",\s*padding: 4,\s*borderRadius: 14,\s*backgroundColor: M\.divider,/);
  assert.match(fn, /borderRadius: 10,\s*border: "none",\s*backgroundColor: on \? M\.card : "transparent",\s*boxShadow: on \? SHADOW_SEG : "none",\s*color: on \? M\.raisin : M\.ink,/);
  assert.match(fn, /aria-pressed=\{on\}/);
  assert.match(fn, /`Notifications, \$\{count\} unread`/);
  // The count is the real unread number, shown only when > 0.
  assert.match(fn, /const count = unread > 0 \? Math\.floor\(unread\) : 0;/);
  assert.match(fn, /\{shown > 0 \? \(/);
});

test("phone filter button: 44px ArrowDownUp circle (Sales) that opens the FILTER sheet only", () => {
  assert.match(updates, /<ArrowDownUp size=\{16\} strokeWidth=\{1\.9\} aria-hidden \/>/);
  assert.match(updates, /position: "relative",\s*width: 44,\s*height: 44,\s*borderRadius: 999,/);
  assert.match(updates, /data-filter-count/);
  assert.match(updates, /title="Filter"\s*disabled=\{disabled\}\s*onClick=\{\(\) => setSheetOpen\(true\)\}/);
  // Accessible name says Filters; nothing anywhere offers a sort.
  assert.doesNotMatch(updates, /aria-label="[^"]*[Ss]ort/);
});

test("phone card is borderless with the Sales shadow; tablet keeps its border", () => {
  assert.match(updates, /border: phone \? "none" : `1px solid \$\{M\.border\}`,/);
  assert.match(updates, /boxShadow: phone \? SHADOW_CARD : /);
  // Severity-tinted tile only on phone; the tint is the SAME severity token.
  assert.match(updates, /\{phone && severity \? \(\s*<span style=\{\{ position: "absolute", inset: 0, backgroundColor: severity\.color, opacity: 0\.12 \}\} \/>/);
  // Expandable cards say so on phone; navigable ones keep the right chevron.
  assert.match(updates, /<ChevronDown[\s\S]{0,200}transform: expanded \? "rotate\(180deg\)" : "none"/);
});

test("phone header actions are 42px round; tablet keeps 34×34", () => {
  assert.match(updates, /style=\{phone \? markAllPhoneStyle\(feed\.unread === 0\) : \{/);
  assert.match(updates, /boxShadow: SHADOW_HEADER_ACTION,/);
  assert.match(updates, /function markAllPhoneStyle\(none: boolean\): CSSProperties \{\s*return \{\s*width: 42,\s*height: 42,/);
  assert.match(announcements, /width: 42,\s*height: 42,\s*borderRadius: 999,\s*background: `linear-gradient\(135deg, \$\{M\.logoFrom\}, \$\{M\.logoTo\}\)`/);
});

test("Announcements: 'Live', never 'Pinned'; author (a user id) never shown", () => {
  assert.match(announcements, /\{ key: "live", label: "Live" \}/);
  assert.doesNotMatch(announcements, /label: "Pinned"|>Pinned</);
  assert.doesNotMatch(announcements, /str\(r, "createdBy"/);
  assert.match(announcements, /aria-pressed=\{on\}/);
  assert.match(announcements, /aria-label="Search announcements"/);
});

test("phone 'Live' follows the desktop rule: shown AND not expired (timezone-safe)", async () => {
  const { isLiveAnnouncement } = await import(
    pathToFileURL(resolve(process.cwd(), "src/pages/m/lib/announcement-live.ts")).href
  );
  const now = Date.parse("2026-10-16T04:00:00.000Z");
  assert.equal(isLiveAnnouncement({ isActive: true }, now), true); // no expiry
  assert.equal(isLiveAnnouncement({ isActive: true, expiresAt: null }, now), true);
  assert.equal(isLiveAnnouncement({ isActive: true, expiresAt: "" }, now), true);
  assert.equal(isLiveAnnouncement({ isActive: true, expiresAt: "garbage" }, now), true); // unparseable → not expired
  assert.equal(isLiveAnnouncement({ isActive: true, expiresAt: "2026-10-16T04:00:01.000Z" }, now), true);
  assert.equal(isLiveAnnouncement({ isActive: true, expiresAt: "2026-10-16T04:00:00.000Z" }, now), false); // at now → expired
  assert.equal(isLiveAnnouncement({ isActive: true, expires_at: "2026-10-15T00:00:00Z" }, now), false); // snake_case read
  // Same instant written with a +08:00 offset (MYT) → same answer.
  assert.equal(isLiveAnnouncement({ isActive: true, expiresAt: "2026-10-16T12:00:01+08:00" }, now), true);
  assert.equal(isLiveAnnouncement({ isActive: true, expiresAt: "2026-10-16T11:59:59+08:00" }, now), false);
  assert.equal(isLiveAnnouncement({ isActive: false }, now), false);
  assert.equal(isLiveAnnouncement({ isActive: "true" }, now), false);
  // Phone uses it; tablet keeps the isActive-only chip.
  assert.match(announcements, /chip === "live" && \(phone \? !isLiveAnnouncement\(r\) : r\.isActive !== true\)/);
});
