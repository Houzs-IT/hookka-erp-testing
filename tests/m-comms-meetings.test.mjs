// m-comms-meetings.test.mjs — /m Meetings v3 (Batch 2, Claude Design "Meetings v2").
// Unit tests over the pure helpers (meet-lib.ts) and over the source: the desktop page's rules
// (src/pages/meetings/*, src/api/routes/meetings.ts) must hold on the phone. NOT authenticated API runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  statusPill, detailActs, lockNote, autoNote, emailRows, emailSummary, linkState, linkRows, parseGuestEmails, repeatOptions, peopleCount, peopleLine,
  roomStates, roomWarnings, busyRooms, conflictLines, findSlots, spacedSlots, sectionAllowed, rangeFor, stepAnchor, monthCells, periodTitle, visibleMeetings,
  optionsCount, colourOf, legendOf, searchAll, groupByDay, mineBadges, noticeKind, shiftTime, roomBody, roomFormOf, stepOption, optionLabel,
  EQUIPMENT, OPEN_FROM, OPEN_TO, GAP_OPTIONS, LONGEST_OPTIONS, AHEAD_OPTIONS, EMAIL_KINDS, roomLive, roomNext, roomToday, roomClosures, MINE, NO_ROOM,
} from "../src/pages/m/screens/comms/meetings/meet-lib.ts";

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const DIR = "pages/m/screens/comms/meetings";
const files = readdirSync(new URL(`../src/${DIR}`, import.meta.url)).filter((f) => /\.(tsx?|css)$/.test(f));
const src = Object.fromEntries(files.map((f) => [f, read(`${DIR}/${f}`)]));
const all = Object.values(src).join("\n");
const dialogs = read("pages/meetings/MeetingsDialogs.tsx");
const admin = read("pages/meetings/MeetingsAdmin.tsx");
const routes = read("api/routes/meetings.ts");

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const iso = (t) => new Date(t).toISOString();
const room = (o) => ({ id: 1, name: "Boardroom", location: "HQ", floor: "L2", seats: 12, equipment: [], open_days: [1, 2, 3, 4, 5], open_from: 8, open_to: 18, color: "#3f51b5", buffer_min: 0, max_hours: 0, advance_days: 0, active: true, closures: [], ...o });
const meeting = (o) => ({ id: 1, title: "Review", start: iso(at(26, 9)), end: iso(at(26, 10)), roomId: 1, organizer: "me", bookedBy: "me", attendees: [], notes: "", video: { type: "none", url: "" }, reminders: null, status: "scheduled", startedAt: null, endedAt: null, seriesId: null, createdIn: "x", linkId: null, guest: null, ...o });
const people = new Map([["me", { key: "me", name: "Sample Office User", email: null, company: "Hookka", department: "Sales" }], ["a", { key: "a", name: "Sample Worker A", email: null, company: "Hookka", department: "Sales" }]]);

test("status is the server's, with its own started / ended times (no end-before-start)", () => {
  assert.deepEqual(statusPill(meeting({})), { label: "Coming up", tone: "teal" });
  const live = meeting({ status: "live", startedAt: iso(at(26, 8, 52)) });
  assert.equal(statusPill(live).label, "In progress · started 08:52");
  assert.equal(statusPill(meeting({ status: "ended", startedAt: iso(at(26, 8, 52)), endedAt: iso(at(26, 9, 5)) })).label, "Ended 09:05");
  assert.match(autoNote(meeting({ status: "ended", startedAt: iso(at(26, 8, 52)), endedAt: iso(at(26, 9, 5)) }), "me"), /^Started 08:52\. Ended 09:05\.$/);
  assert.equal(autoNote(meeting({}), "me"), "Not pressed? It starts at 09:00 and ends at 10:00 by itself.");
  assert.match(dialogs, /Not pressed\? It starts at/);
});

test("Start / End / Edit / Cancel follow desktop MeetingDetail exactly", () => {
  assert.deepEqual(detailActs(meeting({}), "me"), ["start", "end", "edit", "cancel"], "scheduled: all four for the organiser");
  assert.deepEqual(detailActs(meeting({ status: "live" }), "me"), ["end", "edit", "cancel"], "Start only while scheduled");
  assert.deepEqual(detailActs(meeting({ status: "ended" }), "me"), [], "nothing once ended");
  assert.deepEqual(detailActs(meeting({ organizer: "a", bookedBy: "a" }), "me"), [], "only the organiser or booker");
  assert.deepEqual(detailActs(meeting({ organizer: "a", bookedBy: "me" }), "me"), ["start", "end", "edit", "cancel"], "the person who booked it may");
  assert.deepEqual(detailActs(meeting({ guest: { name: "G", phone: "1", email: "g@x.y", company: "" } }), "me"), ["start", "end", "cancel"], "no Edit on a guest booking");
  assert.match(lockNote(meeting({ organizer: "a", bookedBy: "a" }), "me", people), /^Only Sample Worker A /);
  assert.match(dialogs, /m\.status === "scheduled" && <button/);
  assert.match(dialogs, /p\.canChange && m\.status !== "ended" && !m\.guest/);
});

test("emails: grouped by kind, each sent / not sent with its reason / waiting — never per-recipient Delivered", () => {
  const rows = emailRows([
    { kind: "reminder", to: ["a@x.y"], sentAt: null, attempts: 0, error: null },
    { kind: "invite", to: ["a@x.y", "b@x.y"], sentAt: iso(at(20, 9, 13)), attempts: 1, error: null },
    { kind: "changed", to: ["a@x.y"], sentAt: null, attempts: 3, error: "mailbox full" },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ["Invitation", "Change", "Reminder"]);
  assert.deepEqual(rows.map((r) => r.label), ["Sent", "Not sent", "Waiting"]);
  assert.equal(rows[1].detail, "Reason: mailbox full");
  assert.equal(emailSummary([{ kind: "invite", to: [], sentAt: "x", attempts: 1, error: null }, { kind: "changed", to: [], sentAt: null, attempts: 1, error: "no" }]), "1 sent, 1 not sent");
  for (const [k, l] of EMAIL_KINDS) assert.match(dialogs, new RegExp(`${k}: "${l}"`), k);
  assert.doesNotMatch(all, /Delivered|Bounced/);
});

test("room dialog options are the desktop's exactly (no Speakers, no Coffee machine)", () => {
  assert.match(admin, new RegExp(`const EQUIPMENT = \\[${EQUIPMENT.map((e) => `"${e}"`).join(", ")}\\]`));
  assert.match(admin, new RegExp(`\\[${OPEN_FROM.join(", ")}\\]\\.map`));
  assert.match(admin, new RegExp(`\\[${OPEN_TO.join(", ")}\\]\\.map`));
  const lit = (l) => l.map(([v, t]) => `\\[${v}, "${t}"\\]`).join(", ");
  for (const list of [GAP_OPTIONS, LONGEST_OPTIONS, AHEAD_OPTIONS]) assert.match(admin, new RegExp(lit(list)));
  assert.doesNotMatch(all, /Speakers"|Coffee machine/);
  assert.equal(stepOption(LONGEST_OPTIONS, 0, -1), 0);
  assert.equal(stepOption(LONGEST_OPTIONS, 4, 1), 8);
  assert.equal(optionLabel(AHEAD_OPTIONS, 180), "6 months");
  assert.match(src["RoomForm.tsx"], /How many people/);
});

test("room body keys = desktop saveRoom; a new room starts like desktop roomForm", () => {
  const f = roomFormOf(null, 0);
  assert.deepEqual(Object.keys(roomBody(f)), ["name", "location", "address", "floor", "seats", "equipment", "days", "openFrom", "openTo", "color", "bufferMin", "maxHours", "advanceDays", "active", "closures"]);
  const desk = read("pages/meetings/index.tsx").match(/const body = \{ ([^}]+) \}/)[1].split(", ").map((x) => x.split(":")[0]);
  assert.deepEqual(Object.keys(roomBody(f)), desk);
  assert.equal(f.openFrom, 9);
  assert.equal(f.openTo, 18);
  assert.equal(roomFormOf(room({ address: "A" }), 3).address, "A");
});

test("guest links: an expired link is never shown as on; no 'Opened' counter; no room / length preset on create", () => {
  const now = at(26, 12);
  assert.deepEqual(linkState({ until: "2026-10-31", active: true }, now), { label: "Expired", tone: "grey", on: false });
  assert.equal(linkState({ until: null, active: true }, now).label, "Active");
  assert.equal(linkState({ until: "2026-12-31", active: false }, now).label, "Off");
  const rows = linkRows({ id: 1, code: "a-b", name: "", rooms: [], length: 480, days: [0, 1, 2, 3, 4, 5, 6], from: 0, to: 24, until: null, hosts: [], createdIn: "", active: true, createdBy: "", booked: 2 }, [], people, now, () => "");
  assert.deepEqual(rows.map((r) => r[0]), ["Rooms", "Opening hours", "Longest booking", "Works until", "Who can use it", "Booking emails to", "Booked"]);
  assert.equal(rows[1][1], "Each room's own hours");
  assert.doesNotMatch(all, /"Opened|Opened \d|opened: \d/);
  assert.match(src["MeetSheets.tsx"], /LinkForm = \{ name: string; until: string \| null; hosts: string\[\]; audience: "anyone" \| "staff" \}/);
  assert.match(admin, /LinkForm = \{ name: string; until: string \| null; hosts: string\[\]; audience: "anyone" \| "staff" \}/);
  assert.match(src["MeetingsScreen.tsx"], /This link has expired\. Create a new link instead\./);
});

test("outside guests: email shape only (no staff-domain rule); 1 person, not 1 people", () => {
  assert.deepEqual(parseGuestEmails("Someone@Gmail.com, x@y.co", ["a@b.cd"]), { ok: ["a@b.cd", "someone@gmail.com", "x@y.co"] });
  assert.deepEqual(parseGuestEmails("nope", []), { error: "nope is not an email address." });
  assert.equal(peopleCount(1), "1 person");
  assert.equal(peopleCount(3), "3 people");
  assert.equal(peopleLine({ organizer: "me", attendees: [], guestEmails: ["g@x.y"] }), "1 person · 1 guest");
  assert.doesNotMatch(all, /hookka\.my|staff email/i);
});

test("repeat: desktop options, offered on NEW meetings only; series edit / cancel asks This meeting / This and following", () => {
  assert.deepEqual(repeatOptions(at(26, 9)).map((r) => r[0]), ["none", "daily", "weekdays", "weekly", "monthly"]);
  assert.equal(repeatOptions(at(26, 9))[3][1], "Every week on Thursday");
  assert.match(src["MeetingEditor.tsx"], /\{isNew \? \(\n\s+<div>\n\s+<div style=\{\{ marginBottom: 6, \.\.\.LABEL \}\}>Repeat/);
  assert.match(src["MeetingsScreen.tsx"], /askScope\(m, "Cancel"/);
  assert.match(src["MeetingsScreen.tsx"], /\$\{verb\} only \$\{dLab/);
  assert.match(src["MeetingsScreen.tsx"], /label: "This meeting"[\s\S]*label: "This and following"[\s\S]*label: "Back"/);
  assert.match(src["MeetingsScreen.tsx"], /\{ \.\.\.draftBody\(st\.d\), scope: st\.scope \}/);
  assert.match(src["MeetingsScreen.tsx"], /\/cancel`, \{ scope \}/);
});

test("rooms for a draft: closed that day / booked / after hours / best fit (smallest that seats everyone)", () => {
  const rooms = [room({ id: 1, seats: 12 }), room({ id: 2, name: "A", seats: 6 }), room({ id: 3, name: "B", seats: 14, open_from: 10 }), room({ id: 4, name: "C", seats: 16, closures: [{ from: "2026-11-26", to: "2026-11-26", reason: "x" }] }), room({ id: 5, name: "Off", active: false })];
  const d = { id: null, start: at(26, 9), end: at(26, 10), attendees: ["a"], roomId: 1 };
  const busy = busyRooms([meeting({ id: 9, roomId: 2 })], d);
  const st = roomStates(rooms, d, busy);
  assert.deepEqual(st.map((s) => [s.room.id, s.tag]), [[1, "Best fit"], [2, "Booked"], [3, "After hours"], [4, "Closed this day"]], "inactive rooms are not offered");
  assert.equal(st[3].disabled, true);
  const w = roomWarnings(rooms, { ...d, roomId: 3 }, busy);
  assert.match(w[0].text, /Outside this room's usual hours \(10:00 - 18:00\)/);
  const big = roomWarnings([room({ id: 1, seats: 12 }), room({ id: 2, seats: 4 })], { ...d, roomId: 1 }, new Set());
  assert.equal(big[0].text, "Boardroom is large for 2 people.");
  assert.equal(big[0].use.id, 2);
  assert.match(dialogs, /room\.seats > best\.seats \* 2/);
});

test("the 409 reply becomes sentences (rules, busy people, the room and its gap)", () => {
  const lines = conflictLines({ conflict: { room: { id: 1, title: "Launch", start: at(26, 9), end: at(26, 10), organizer: "a" }, people: [{ key: "a", meeting: { id: 2, title: "Call", start: at(26, 9), end: at(26, 9, 30) } }], rules: ["Too long."] }, suggestTime: null, suggestRooms: [] }, [room({ buffer_min: 10 })], people, 1);
  assert.deepEqual(lines.map((l) => l.kind), ["rule", "person", "room"]);
  assert.equal(lines[1].text, 'Sample Worker A is in "Call" 09:00–09:30.');
  assert.equal(lines[2].text, 'Boardroom is booked 09:00–10:00 for "Launch" (needs 10 min between meetings).');
  assert.match(src["MeetingsScreen.tsx"], /readConflict\(e\)/);
});

test("find a time: only when everyone is free and a room fits", () => {
  const rooms = [room({ id: 1, seats: 2 })];
  const busy = [meeting({ id: 5, organizer: "a", bookedBy: "a", attendees: [], roomId: null, start: iso(at(26, 8)), end: iso(at(26, 12)) })];
  const r = findSlots({ id: null, organizer: "me", attendees: ["a"], roomId: 1 }, rooms, busy, at(25, 0), "2026-11-26", "2026-11-26", 60);
  assert.equal(r.length, 1);
  assert.equal(new Date(r[0].slots[0].t).getHours(), 12, "first time after the busy morning");
  assert.equal(findSlots({ id: null, organizer: "me", attendees: ["a", "b"], roomId: 1 }, rooms, [], at(25, 0), "2026-11-26", "2026-11-26", 60)[0].slots.length, 0, "no room seats three");
  const spaced = spacedSlots(r[0].slots);
  assert.equal(spaced.length, 3);
  assert.ok(spaced[1].t - spaced[0].t >= 90 * 60000);
});

test("calendar ranges, steps, month grid, options count, filters, colours", () => {
  const a = at(26, 0);
  const [f, t] = rangeFor("week", a);
  assert.equal(new Date(f).getDay(), 1, "weeks start on Monday");
  assert.equal((t - f) / 86400000, 7);
  assert.equal(rangeFor("list", a)[1] - a, 14 * 86400000);
  assert.equal(new Date(stepAnchor("month", a, 1)).getMonth(), 11);
  assert.equal(periodTitle("week", a), "23 – 29 Nov 2026");
  assert.equal(monthCells(a).length % 7, 0);
  const ms = [meeting({ id: 1, roomId: 1 }), meeting({ id: 2, roomId: 2, organizer: "a", bookedBy: "a" }), meeting({ id: 3, roomId: null, organizer: "a", bookedBy: "a", attendees: ["me"] })];
  assert.deepEqual(visibleMeetings(ms, { roomFilter: { 2: false }, onlyMine: false, overlay: [], me: "me" }).map((m) => m.id), [1, 3]);
  assert.deepEqual(visibleMeetings(ms, { roomFilter: {}, onlyMine: true, overlay: [], me: "me" }).map((m) => m.id), [1, 3]);
  assert.deepEqual(visibleMeetings(ms, { roomFilter: {}, onlyMine: true, overlay: ["a"], me: "me" }).map((m) => m.id), [1, 2, 3]);
  assert.equal(optionsCount({ 2: false, 3: true }, true, ["a"]), 3);
  assert.equal(colourOf(ms[0], "me", "me", [], people, []), MINE);
  assert.equal(colourOf(ms[2], "room", "me", [room({})], people, []), NO_ROOM);
  assert.deepEqual(legendOf("room", [room({}), room({ id: 2, name: "X", active: false })], [], {}).map((l) => l.l), ["Boardroom", "No room"]);
  assert.equal(searchAll("worker a", ms, [...people.values()], [room({})], "me").people.length, 1);
  assert.equal(groupByDay(ms, at(26, 12), true)[0].label, "TODAY · THU 26 NOV");
  assert.deepEqual(mineBadges(meeting({ status: "live", organizer: "a", bookedBy: "a" }), "me").map((b) => b.label), ["Live", "Invited"]);
  assert.equal(noticeKind("Sample Worker B invited you to Month-end close"), "invite");
  assert.equal(noticeKind("Launch was cancelled"), "cancel");
  assert.deepEqual(shiftTime({ start: at(26, 9), end: at(26, 10) }, "start", 15), { start: at(26, 9, 15), end: at(26, 10, 15) });
  assert.deepEqual(shiftTime({ start: at(26, 9), end: at(26, 9, 15) }, "end", -15), { start: at(26, 9), end: at(26, 9, 15) }, "never shorter than 15 minutes");
});

test("rooms page values: live state, next, today, closures", () => {
  const now = at(26, 9, 30);
  const r = room({ closures: [{ from: "2026-12-24", to: "2026-12-26", reason: "Clean" }] });
  const ms = [meeting({ id: 1 }), meeting({ id: 2, start: iso(at(26, 14)), end: iso(at(26, 15)), title: "Later" })];
  assert.equal(roomLive(r, ms, now).label, "In use until 10:00");
  assert.equal(roomLive(room({ active: false }), ms, now).label, "Closed for booking");
  assert.equal(roomNext(r, ms, now), "Today 14:00 · Later");
  assert.equal(roomToday(r, ms, now), "2 bookings · 09:00, 14:00");
  assert.equal(roomClosures(r, now), "Closed Thu 24 Dec – Sat 26 Dec (Clean)");
});

test("room managers only: Email and WhatsApp, Change log, add / edit room (bootstrap.canManage)", () => {
  assert.equal(sectionAllowed("email", false), false);
  assert.equal(sectionAllowed("log", false), false);
  assert.equal(sectionAllowed("links", false), true);
  assert.match(src["MeetingsScreen.tsx"], /const canManage = !!boot\?\.canManage;/);
  assert.match(src["MeetingsScreen.tsx"], /\.\.\.\(canManage \? \[/);
  assert.match(src["MeetingsSections.tsx"], /\{canManage \? \(\n\s+<button type="button" onClick=\{\(\) => onEdit\(r\)\}/);
  assert.match(src["MeetingsSections.tsx"], /\{canManage \? \(\n\s+<button type="button" onClick=\{onAdd\}/);
  assert.match(src["MeetingsScreen.tsx"], /if \(!canManage \|\| \(roomParam !== "new" && !r\)\)/);
  assert.match(routes, /X-Can-Manage-Rooms/);
  assert.match(src["MeetingsSections.tsx"], /Coming soon/);
});

test("every endpoint the screens call exists in routes/meetings.ts; reads mark notices read and refresh the badge", () => {
  const used = [...all.matchAll(/["`]\/api\/meetings(\/[a-z-]+)/g)].map((m) => m[1]);
  for (const u of new Set(used)) assert.match(routes, new RegExp(`app\\.(get|post|patch)\\("${u.replace(/-/g, "\\-")}`), u);
  assert.match(src["MeetingsScreen.tsx"], /api\.post\("\/api\/meetings\/notifications\/read"\)\.then\(refreshMeetingsUnread\)/);
  assert.match(src["MeetingsScreen.tsx"], /useMeetingsUnread\(\)/);
  assert.match(src["MeetingsScreen.tsx"], /\/api\/meetings\/meetings\/\$\{id\}\/files`, form/);
  assert.match(src["MeetingEditor.tsx"], /\/api\/meetings\/meet-link/);
});

test("phone rules: one fixed layer (meetings-overlay.tsx), no 'not found' wording, English, dark-safe colours", () => {
  const fixed = files.filter((f) => /position:\s*"fixed"/.test(src[f]));
  assert.deepEqual(fixed, ["meetings-overlay.tsx"]);
  assert.doesNotMatch(all, /not found/i);
  assert.doesNotMatch(all, /useCachedJson|cachedFetchJson/);
  const css = src["meetings-theme.css"];
  for (const v of ["--mt-blue", "--mt-guest", "--mt-tile", "--mt-room-glass", "--mt-grid", "--mt-unread"]) {
    assert.match(css, new RegExp(`body\\[data-theme="light"\\][\\s\\S]*${v}:`), `${v} light`);
    assert.match(css, new RegExp(`body\\[data-theme="dark"\\][\\s\\S]*${v}:`), `${v} dark`);
  }
  assert.match(src["MeetingsScreen.tsx"], /try \{ return readColorBy\(localStorage\.getItem\(COLOR_KEY\)\); \} catch/);
});
