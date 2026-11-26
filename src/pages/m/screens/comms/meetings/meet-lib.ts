// ---------------------------------------------------------------------------
// Meetings v3 (Batch 2) — the pure rules the phone screens draw. No React, no
// fetch: every value here comes from what the hub answered (src/lib/meetings.ts
// shapes, relayed by src/api/routes/meetings.ts), and every rule mirrors the
// desktop page (src/pages/meetings/*). Tested alone in tests/m-comms-meetings.test.mjs.
// ---------------------------------------------------------------------------
import {
  DAY, GRID_FROM, GRID_TO, MIN, REMINDER_OPTIONS, ROOM_COLORS, addDays, atHour, bestRoom, companyColor, inUsualHours, isoDay, minutesOfDay, ms, peopleOf, startOfDay,
  type Closure, type ConflictReply, type Draft, type GuestLink, type Meeting, type Person, type Room,
} from "../../../../../lib/meetings";

export { GRID_FROM, GRID_TO };

// ---- words and dates -------------------------------------------------------------
export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "09:30" (24 h, as the prototype draws times). */
export function hm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** "Thu 26 Nov" */
export function dLab(t: number): string {
  const d = new Date(t);
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
/** "Thu, 26 Nov 2026" */
export function dLong(t: number): string {
  const d = new Date(t);
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
/** "30 min", "1 h", "1 h 30 min" */
export function durL(min: number): string {
  if (min < 60) return `${min} min`;
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
}
/** "1 person" / "3 people" (audit: never "1 people"). */
export const peopleCount = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
/** Monday of t's week (the prototype's week starts on Monday). */
export const mondayOf = (t: number) => addDays(startOfDay(t), -((new Date(t).getDay() + 6) % 7));
export const isIsoDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---- calendar -----------------------------------------------------------------------
export const CAL_VIEWS = ["day", "week", "month", "rooms", "list"] as const;
export type CalView = (typeof CAL_VIEWS)[number];
export const isCalView = (v: string | null): v is CalView => !!v && (CAL_VIEWS as readonly string[]).includes(v);
export const SECTIONS = ["calendar", "mine", "rooms", "links", "email", "log"] as const;
export type Section = (typeof SECTIONS)[number];
export const isSection = (v: string | null): v is Section => !!v && (SECTIONS as readonly string[]).includes(v);
/** Email and WhatsApp and the change log are room managers' pages (desktop tabs `show: canManage`). */
export const sectionAllowed = (s: Section, canManage: boolean) => (s === "email" || s === "log" ? canManage : true);

/** The window a view reads from /api/meetings/calendar. Search reads the desktop List range. */
export function rangeFor(view: CalView, anchor: number, searching = false): [number, number] {
  const a = startOfDay(anchor);
  if (searching) return [a - 7 * DAY, a + 49 * DAY];
  if (view === "day" || view === "rooms") return [a, addDays(a, 1)];
  if (view === "week") return [mondayOf(a), addDays(mondayOf(a), 7)];
  if (view === "list") return [a, addDays(a, 14)];
  const first = new Date(new Date(a).getFullYear(), new Date(a).getMonth(), 1).getTime();
  return [mondayOf(first), addDays(mondayOf(first), 42)];
}

export function stepAnchor(view: CalView, anchor: number, dir: number): number {
  if (view === "month") {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() + dir, 1);
    return startOfDay(d.getTime());
  }
  return addDays(anchor, dir * (view === "week" || view === "list" ? 7 : 1));
}

export function periodTitle(view: CalView, anchor: number): string {
  if (view === "week") {
    const m0 = mondayOf(anchor);
    const m6 = new Date(addDays(m0, 6));
    return `${new Date(m0).getDate()} – ${m6.getDate()} ${MON[m6.getMonth()]} ${m6.getFullYear()}`;
  }
  if (view === "month") return `${MON_LONG[new Date(anchor).getMonth()]} ${new Date(anchor).getFullYear()}`;
  if (view === "list") return `From ${dLab(anchor)}`;
  return dLong(anchor);
}

/** 6 x 7 (or 5 x 7) Monday-first cells of anchor's month. */
export function monthCells(anchor: number): { day: number; inMonth: boolean }[] {
  const a = new Date(anchor);
  const first = new Date(a.getFullYear(), a.getMonth(), 1).getTime();
  const gs = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = addDays(gs, i);
    return { day, inMonth: new Date(day).getMonth() === a.getMonth() };
  });
  return cells.slice(35).every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
}

export const onDay = (m: Meeting, day: number) => startOfDay(ms(m.start)) === startOfDay(day);

/** Top / height in px of a meeting in a time grid drawn from GRID_FROM to GRID_TO. */
export function gridBox(m: Meeting, hourPx: number, minH: number): { top: number; h: number } {
  const from = GRID_FROM * 60;
  const to = GRID_TO * 60;
  const s = Math.max(minutesOfDay(ms(m.start)), from);
  const endDay = startOfDay(ms(m.end)) > startOfDay(ms(m.start)) ? to : minutesOfDay(ms(m.end));
  const e = Math.min(endDay || to, to);
  return { top: ((s - from) / 60) * hourPx, h: Math.max(minH, ((e - s) / 60) * hourPx - 2) };
}

// ---- status -----------------------------------------------------------------------------
export type Tone = "teal" | "green" | "grey" | "red" | "amber" | "blue" | "gold";
/** The server's own status, with its startedAt / endedAt (audit rule 1: never derived from the clock). */
export function statusPill(m: Pick<Meeting, "status" | "startedAt" | "endedAt">): { label: string; tone: Tone } {
  if (m.status === "live") return { label: m.startedAt ? `In progress · started ${hm(ms(m.startedAt))}` : "In progress", tone: "green" };
  if (m.status === "ended") return { label: m.endedAt ? `Ended ${hm(ms(m.endedAt))}` : "Ended", tone: "grey" };
  return { label: "Coming up", tone: "teal" };
}
export const shortStatus = (m: Pick<Meeting, "status">) => (m.status === "live" ? "In progress" : m.status === "ended" ? "Ended" : "Coming up");

// ---- colour -------------------------------------------------------------------------------
export type ColorBy = "room" | "company" | "me";
export const NO_ROOM = "#8A8F98";
export const MINE = "#C9A24B";
export const OTHERS = "#A8A29A";
export const INVITED = "var(--mt-blue)";
export const GUEST_COLOR = "var(--mt-guest)";
export const readColorBy = (v: string | null): ColorBy => (v === "company" || v === "me" ? v : "room");

/** The desktop meetingColor rules (lib/meetings.ts), in the prototype's tones. */
export function colourOf(m: Meeting, by: ColorBy, me: string, rooms: Room[], people: Map<string, Person>, companies: string[]): string {
  if (by === "company") return m.guest ? GUEST_COLOR : companyColor(people.get(m.organizer)?.company ?? "", companies);
  if (by === "me") return m.organizer === me || m.bookedBy === me ? MINE : peopleOf(m).includes(me) ? INVITED : OTHERS;
  return rooms.find((r) => r.id === m.roomId)?.color ?? NO_ROOM;
}
export function legendOf(by: ColorBy, rooms: Room[], companies: string[], hidden: Record<number, boolean>): { l: string; c: string }[] {
  if (by === "company") return [...companies.map((c) => ({ l: c, c: companyColor(c, companies) })), { l: "Guest booking", c: GUEST_COLOR }];
  if (by === "me") return [{ l: "I organise", c: MINE }, { l: "I'm invited", c: INVITED }, { l: "Others", c: OTHERS }];
  return [...rooms.filter((r) => r.active && hidden[r.id] !== false).map((r) => ({ l: r.name, c: r.color })), { l: "No room", c: NO_ROOM }];
}
/** A tinted card behind a meeting, in both themes. */
export const tintOf = (c: string, pct = 14) => `color-mix(in srgb, ${c} ${pct}%, var(--c-card))`;

/** Desktop filter: hidden rooms, Only my meetings (plus colleagues' calendars). */
export function visibleMeetings(list: Meeting[], o: { roomFilter: Record<number, boolean>; onlyMine: boolean; overlay: string[]; me: string }): Meeting[] {
  return list.filter((m) => {
    if (m.roomId && o.roomFilter[m.roomId] === false) return false;
    if (o.onlyMine && !peopleOf(m).includes(o.me) && !o.overlay.some((k) => peopleOf(m).includes(k))) return false;
    return true;
  });
}
export const optionsCount = (roomFilter: Record<number, boolean>, onlyMine: boolean, overlay: string[]) =>
  Object.values(roomFilter).filter((v) => v === false).length + (onlyMine ? 1 : 0) + overlay.length;

// ---- search ------------------------------------------------------------------------------------
export type SearchHits = { meetings: Meeting[]; people: Person[]; rooms: Room[] };
export function searchAll(q: string, meetings: Meeting[], people: Person[], rooms: Room[], me: string): SearchHits {
  const n = q.trim().toLowerCase();
  if (!n) return { meetings: [], people: [], rooms: [] };
  const name = (k: string) => people.find((p) => p.key === k)?.name ?? k;
  return {
    meetings: meetings
      .filter((m) => `${m.title} ${peopleOf(m).map(name).join(" ")} ${rooms.find((r) => r.id === m.roomId)?.name ?? ""} ${m.guest?.name ?? ""}`.toLowerCase().includes(n))
      .sort((a, b) => ms(a.start) - ms(b.start))
      .slice(0, 8),
    people: people.filter((p) => p.key !== me && `${p.name} ${p.company} ${p.department}`.toLowerCase().includes(n)).slice(0, 5),
    rooms: rooms.filter((r) => r.active && `${r.name} ${r.location}`.toLowerCase().includes(n)),
  };
}

// ---- grouping -----------------------------------------------------------------------------------
export type DayGroup = { day: number; label: string; today: boolean; rows: Meeting[] };
/** "TODAY · THU 26 NOV", "TOMORROW · FRI 27 NOV", "MON 30 NOV". */
export function dayHead(day: number, now: number, tomorrow = false): string {
  const t = startOfDay(now);
  const pre = day === t ? "TODAY · " : tomorrow && day === addDays(t, 1) ? "TOMORROW · " : "";
  return pre + dLab(day).toUpperCase();
}
export function groupByDay(list: Meeting[], now: number, tomorrow = false): DayGroup[] {
  const sorted = [...list].sort((a, b) => ms(a.start) - ms(b.start));
  const out: DayGroup[] = [];
  for (const m of sorted) {
    const d = startOfDay(ms(m.start));
    let g = out[out.length - 1];
    if (!g || g.day !== d) {
      g = { day: d, label: dayHead(d, now, tomorrow), today: d === startOfDay(now), rows: [] };
      out.push(g);
    }
    g.rows.push(m);
  }
  return out;
}

/** My meetings badge: Live / Ended / Organiser / Invited (desktop MyMeetings). */
export function mineBadges(m: Meeting, me: string): { label: string; tone: Tone; dot?: boolean }[] {
  const out: { label: string; tone: Tone; dot?: boolean }[] = [];
  if (m.status === "live") out.push({ label: "Live", tone: "green", dot: true });
  if (m.status === "ended") out.push({ label: "Ended", tone: "grey" });
  out.push(m.organizer === me || m.bookedBy === me ? { label: "Organiser", tone: "amber" } : { label: "Invited", tone: "blue" });
  return out;
}

/** A notice's icon, from its own words (the hub sends free text). */
export function noticeKind(text: string): "cancel" | "guest" | "change" | "invite" | "other" {
  if (/cancel/i.test(text)) return "cancel";
  if (/guest|booking link/i.test(text)) return "guest";
  if (/invit|added you/i.test(text)) return "invite";
  if (/move|chang|now at|updated|rescheduled/i.test(text)) return "change";
  return "other";
}

// ---- who may do what (desktop MeetingDetail / index.tsx) ---------------------------------------------
export const canChange = (m: Pick<Meeting, "organizer" | "bookedBy">, me: string) => !!me && (m.organizer === me || m.bookedBy === me);
export type DetailAct = "start" | "end" | "edit" | "cancel";
export function detailActs(m: Meeting, me: string): DetailAct[] {
  if (!canChange(m, me) || m.status === "ended") return [];
  const out: DetailAct[] = [];
  if (m.status === "scheduled") out.push("start");
  out.push("end");
  if (!m.guest) out.push("edit");
  out.push("cancel");
  return out;
}
export function lockNote(m: Meeting, me: string, people: Map<string, Person>): string {
  if (m.status === "ended") return "Ended meetings can't be edited or cancelled.";
  if (!canChange(m, me)) return `Only ${people.get(m.organizer)?.name ?? "the organiser"} or the person who booked it can change this meeting.`;
  if (m.guest) return "Guest bookings can't be edited. You can still cancel it.";
  return "";
}
/** The time note under the room (desktop: "Not pressed? It starts … and ends … by itself"). */
export function autoNote(m: Meeting, me: string): string {
  const parts: string[] = [];
  if (m.startedAt) parts.push(`Started ${hm(ms(m.startedAt))}.`);
  if (m.endedAt) parts.push(`Ended ${hm(ms(m.endedAt))}.`);
  if (m.status === "ended") return parts.length ? parts.join(" ") : `Ended at ${hm(ms(m.end))}.`;
  if (m.status === "live") return `${parts.join(" ")} Ends by itself at ${hm(ms(m.end))}${canChange(m, me) ? ", or press End meeting." : "."}`.trim();
  return canChange(m, me)
    ? `Not pressed? It starts at ${hm(ms(m.start))} and ends at ${hm(ms(m.end))} by itself.`
    : "It starts and ends by itself at the booked times.";
}

// ---- emails, reminders, history --------------------------------------------------------------------
export const EMAIL_KINDS: [string, string][] = [
  ["invite", "Invitation"], ["changed", "Change"], ["cancelled", "Cancellation"], ["reminder", "Reminder"], ["guest_confirm", "Booking confirmation"], ["guest_notice", "Guest booking notice"],
];
export const emailKind = (k: string) => EMAIL_KINDS.find(([v]) => v === k)?.[1] ?? k;
export type EmailRow = { kind: string; to: string; state: "sent" | "failed" | "waiting"; label: string; detail: string };
/** The meeting's emails grouped by kind (desktop order), each sent / not sent with its reason / waiting. */
export function emailRows(emails: NonNullable<Meeting["emails"]>): EmailRow[] {
  const order = (k: string) => {
    const i = EMAIL_KINDS.findIndex(([v]) => v === k);
    return i < 0 ? 99 : i;
  };
  return [...emails]
    .sort((a, b) => order(a.kind) - order(b.kind))
    .map((e) => {
      const state = e.sentAt ? "sent" : e.error ? "failed" : "waiting";
      return {
        kind: emailKind(e.kind),
        to: e.to.length ? e.to.join(", ") : "No one",
        state,
        label: state === "sent" ? "Sent" : state === "failed" ? "Not sent" : "Waiting",
        detail: state === "sent" ? `Sent ${dLab(ms(e.sentAt as string))} · ${hm(ms(e.sentAt as string))}` : state === "failed" ? `Reason: ${e.error}` : "Waiting to send",
      };
    });
}
export function emailSummary(emails: NonNullable<Meeting["emails"]>): string {
  const sent = emails.filter((e) => e.sentAt).length;
  const failed = emails.filter((e) => !e.sentAt && e.error).length;
  return `${sent} sent${failed ? `, ${failed} not sent` : ""}`;
}
export const remLabel = (min: number) => REMINDER_OPTIONS.find(([v]) => v === min)?.[1] ?? `${min} minutes before`;
export const channelLabel = (c: string) => (c === "erp" ? "ERP" : c === "email" ? "Email" : "WhatsApp");

// ---- booking ------------------------------------------------------------------------------------------
export const LENGTHS = [30, 45, 60, 90, 120];
export const FIND_LENGTHS = [30, 45, 60, 90, 120, 180];
export function repeatOptions(start: number): [Draft["repeat"], string][] {
  return [["none", "Does not repeat"], ["daily", "Every day"], ["weekdays", "Every weekday (Mon - Fri)"], ["weekly", `Every week on ${WD_LONG[new Date(start).getDay()]}`], ["monthly", "Every 4 weeks"]];
}
/** Move the start (keeping the length) or the end, in 15-minute steps, inside the day. */
export function shiftTime(d: Pick<Draft, "start" | "end">, which: "start" | "end", by: number): { start: number; end: number } {
  const len = d.end - d.start;
  const day = startOfDay(d.start);
  if (which === "start") {
    const s = Math.min(Math.max(d.start + by * MIN, day), day + DAY - len);
    return { start: s, end: s + len };
  }
  return { start: d.start, end: Math.min(Math.max(d.end + by * MIN, d.start + 15 * MIN), day + DAY) };
}
/** Rooms taken at the draft's time (desktop busyRoomsFor). */
export function busyRooms(meetings: Meeting[], d: Pick<Draft, "id" | "start" | "end">): Set<number> {
  return new Set(meetings.filter((m) => m.id !== d.id && m.roomId && m.status !== "ended" && ms(m.start) < d.end && d.start < ms(m.end)).map((m) => m.roomId as number));
}
export const closedOn = (r: Room, day: number) => r.closures.find((c) => c.from <= isoDay(day) && isoDay(day) <= c.to) ?? null;

/** desktop bestRoom (smallest free room that seats everyone), leaving out rooms closed that day or outside their hours. */
export function bestFor(rooms: Room[], count: number, busy: Set<number>, d: Pick<Draft, "start" | "end">): Room | null {
  const skip = new Set(busy);
  for (const r of rooms) if (closedOn(r, d.start) || !inUsualHours(r, d.start, d.end)) skip.add(r.id);
  return bestRoom(rooms, count, skip);
}

export type RoomState = { room: Room; tag: string; tone: Tone; disabled: boolean; small: boolean; best: boolean };
/** Each active room for the draft: closed that day / taken / after hours / best fit / free (desktop RoomPicker). */
export function roomStates(rooms: Room[], d: Pick<Draft, "start" | "end" | "attendees">, busy: Set<number>): RoomState[] {
  const count = 1 + d.attendees.length;
  const best = bestFor(rooms, count, busy, d);
  return rooms.filter((r) => r.active).map((r) => {
    const cl = closedOn(r, d.start);
    const small = r.seats < count;
    if (cl) return { room: r, tag: "Closed this day", tone: "grey", disabled: true, small, best: false };
    if (busy.has(r.id)) return { room: r, tag: "Booked", tone: "red", disabled: false, small, best: false };
    if (!inUsualHours(r, d.start, d.end)) return { room: r, tag: "After hours", tone: "amber", disabled: false, small, best: false };
    if (best?.id === r.id) return { room: r, tag: "Best fit", tone: "green", disabled: false, small, best: true };
    return { room: r, tag: "Free", tone: "teal", disabled: false, small, best: false };
  });
}
/** The warnings under the room list (desktop RoomPicker sentences). */
export function roomWarnings(rooms: Room[], d: Pick<Draft, "start" | "end" | "attendees" | "roomId">, busy: Set<number>): { text: string; use?: Room }[] {
  const count = 1 + d.attendees.length;
  const room = rooms.find((r) => r.id === d.roomId);
  const best = bestFor(rooms, count, busy, d);
  const out: { text: string; use?: Room }[] = [];
  if (!room) return [{ text: "Pick a room, or choose Online." }];
  if (room.seats < count) out.push({ text: `${count} people, but ${room.name} seats ${room.seats}. You can still book it.`, use: best && best.id !== room.id ? best : undefined });
  else if (best && best.id !== room.id && room.seats > best.seats * 2) out.push({ text: `${room.name} is large for ${peopleCount(count)}.`, use: best });
  if (!inUsualHours(room, d.start, d.end)) out.push({ text: `Outside this room's usual hours (${room.open_from}:00 - ${room.open_to}:00). You can still book it; it counts as after hours.` });
  return out;
}
/** Desktop GuestEmails: one or more addresses, each checked for an email shape only (audit rule 7). */
export function parseGuestEmails(text: string, have: string[]): { ok: string[] } | { error: string } {
  const list = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return { error: "Type an email address first." };
  const wrong = list.find((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  if (wrong) return { error: `${wrong} is not an email address.` };
  return { ok: [...new Set([...have, ...list])] };
}
export function peopleLine(d: Pick<Draft, "attendees" | "organizer" | "guestEmails">): string {
  const n = 1 + d.attendees.filter((a) => a !== d.organizer).length;
  return `${peopleCount(n)}${d.guestEmails.length ? ` · ${d.guestEmails.length} guest${d.guestEmails.length === 1 ? "" : "s"}` : ""}`;
}

/** The conflict reply as sentences (desktop ConflictDialog: rules, busy people, the room). */
export function conflictLines(reply: ConflictReply, rooms: Room[], people: Map<string, Person>, roomId: number | null): { kind: "rule" | "person" | "room"; text: string }[] {
  const c = reply.conflict;
  const name = (k: string) => people.get(k)?.name ?? (k === "guest" ? "Guest" : k);
  const r = rooms.find((x) => x.id === roomId);
  return [
    ...c.rules.map((t) => ({ kind: "rule" as const, text: t })),
    ...c.people.map((p) => ({ kind: "person" as const, text: `${name(p.key)} is in "${p.meeting.title}" ${hm(p.meeting.start)}–${hm(p.meeting.end)}.` })),
    ...(c.room ? [{ kind: "room" as const, text: `${r?.name ?? "The room"} is booked ${hm(c.room.start)}–${hm(c.room.end)} for "${c.room.title}"${r?.buffer_min ? ` (needs ${r.buffer_min} min between meetings)` : ""}.` }] : []),
  ];
}

// ---- find a time (desktop FindTime) -----------------------------------------------------------------------
export type Slot = { t: number; rooms: Room[] };
export function findSlots(d: Pick<Draft, "id" | "organizer" | "attendees" | "roomId">, rooms: Room[], meetings: Meeting[], now: number, fromIso: string, toIso: string, lenMin: number): { day: number; slots: Slot[] }[] {
  const who = [d.organizer, ...d.attendees.filter((a) => a !== d.organizer)];
  const busy = meetings.filter((m) => m.id !== d.id && m.status !== "ended").map((m) => ({ start: ms(m.start), end: ms(m.end), people: peopleOf(m), roomId: m.roomId }));
  const L = lenMin * MIN;
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const days: number[] = [];
  for (let t = new Date(fy, fm - 1, fd).getTime(); t <= new Date(ty, tm - 1, td).getTime() && days.length < 31; t = addDays(t, 1)) days.push(t);
  const freeRoomsAt = (s: number) =>
    rooms.filter((r) => r.active && r.seats >= who.length && !busy.some((b) => b.roomId === r.id && b.start < s + L + r.buffer_min * MIN && s - r.buffer_min * MIN < b.end) && !closedOn(r, s));
  return days.map((day) => {
    const slots: Slot[] = [];
    for (let t = atHour(day, 8); t + L <= atHour(day, 21); t += 30 * MIN) {
      if (t < now) continue;
      if (!who.every((k) => !busy.some((b) => b.people.includes(k) && b.start < t + L && t < b.end))) continue;
      const rs = freeRoomsAt(t);
      if (rs.length || d.roomId === null) slots.push({ t, rooms: rs });
    }
    return { day, slots };
  });
}
/** The prototype shows a few well-spaced times a day (at least 90 minutes apart). */
export function spacedSlots(slots: Slot[], max = 3): Slot[] {
  const out: Slot[] = [];
  for (const s of slots) {
    if (out.length >= max) break;
    if (out.length && s.t < out[out.length - 1].t + 90 * MIN) continue;
    out.push(s);
  }
  return out;
}

// ---- rooms page --------------------------------------------------------------------------------------------------
export function roomLive(r: Room, meetings: Meeting[], now: number): { label: string; tone: Tone } {
  if (!r.active) return { label: "Closed for booking", tone: "amber" };
  const cur = meetings.find((m) => m.roomId === r.id && m.status !== "ended" && ms(m.start) <= now && now < ms(m.end));
  if (cur) return { label: `In use until ${hm(ms(cur.end))}`, tone: "red" };
  return { label: "Free now", tone: "green" };
}
export function roomNext(r: Room, meetings: Meeting[], now: number): string {
  const n = meetings.filter((m) => m.roomId === r.id && ms(m.start) > now).sort((a, b) => ms(a.start) - ms(b.start))[0];
  if (!n) return "None this week";
  return `${startOfDay(ms(n.start)) === startOfDay(now) ? "Today" : dLab(ms(n.start))} ${hm(ms(n.start))} · ${n.title}`;
}
export function roomToday(r: Room, meetings: Meeting[], now: number): string {
  const t = meetings.filter((m) => m.roomId === r.id && onDay(m, now)).sort((a, b) => ms(a.start) - ms(b.start));
  return t.length ? `${t.length} booking${t.length > 1 ? "s" : ""} · ${t.map((m) => hm(ms(m.start))).join(", ")}` : "No bookings";
}
export function dayRange(iso: string, until: string) {
  const f = new Date(`${iso}T00:00:00`).getTime();
  return iso === until ? dLab(f) : `${dLab(f)} – ${dLab(new Date(`${until}T00:00:00`).getTime())}`;
}
export function roomClosures(r: Room, now: number): string {
  const up = r.closures.filter((c) => c.to >= isoDay(now));
  return up.length ? `Closed ${up.map((c) => `${dayRange(c.from, c.to)}${c.reason ? ` (${c.reason})` : ""}`).join(", ")}` : "";
}

// Room dialog options, exactly the desktop's (MeetingsAdmin.tsx RoomDialog; audit rule 4).
export const EQUIPMENT = ["TV", "Video call", "Whiteboard", "Projector", "Speakerphone"];
export const OPEN_FROM = [6, 7, 8, 9, 10];
export const OPEN_TO = [16, 17, 18, 19, 20, 21, 22, 23, 24];
export const GAP_OPTIONS: [number, string][] = [[0, "None"], [10, "10 min"], [15, "15 min"], [30, "30 min"]];
export const LONGEST_OPTIONS: [number, string][] = [[0, "No limit"], [1, "1 hour"], [2, "2 hours"], [3, "3 hours"], [4, "4 hours"], [8, "8 hours"]];
export const AHEAD_OPTIONS: [number, string][] = [[0, "No limit"], [30, "30 days"], [60, "60 days"], [90, "90 days"], [180, "6 months"], [365, "1 year"]];
/** Step through a fixed option list (the prototype's − / + rule rows). */
export function stepOption(list: [number, string][], value: number, dir: number): number {
  const i = list.findIndex(([v]) => v === value);
  const j = Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir));
  return list[j][0];
}
export const optionLabel = (list: [number, string][], value: number) => list.find(([v]) => v === value)?.[1] ?? String(value);

export type RoomFormValue = {
  id: number | null; name: string; location: string; address: string; floor: string; seats: number; equipment: string[]; days: number[]; openFrom: number; openTo: number;
  color: string; bufferMin: number; maxHours: number; advanceDays: number; active: boolean; closures: Closure[];
};
/** desktop ui.ts roomForm */
export const roomFormOf = (r: Room | null, count: number): RoomFormValue =>
  r
    ? { id: r.id, name: r.name, location: r.location, address: r.address ?? "", floor: r.floor, seats: r.seats, equipment: r.equipment, days: r.open_days, openFrom: r.open_from, openTo: r.open_to, color: r.color, bufferMin: r.buffer_min, maxHours: r.max_hours, advanceDays: r.advance_days, active: r.active, closures: r.closures }
    : { id: null, name: "", location: "Head office", address: "", floor: "", seats: 6, equipment: [], days: [1, 2, 3, 4, 5], openFrom: 9, openTo: 18, color: ROOM_COLORS[count % ROOM_COLORS.length], bufferMin: 0, maxHours: 0, advanceDays: 0, active: true, closures: [] };
/** The body POST/PATCH /api/meetings/rooms takes (desktop saveRoom). */
export const roomBody = (f: RoomFormValue) => ({
  name: f.name, location: f.location, address: f.address, floor: f.floor, seats: f.seats, equipment: f.equipment, days: f.days, openFrom: f.openFrom, openTo: f.openTo,
  color: f.color, bufferMin: f.bufferMin, maxHours: f.maxHours, advanceDays: f.advanceDays, active: f.active, closures: f.closures,
});

// ---- guest links ------------------------------------------------------------------------------------------------------
export const linkExpired = (l: Pick<GuestLink, "until">, now: number) => !!l.until && l.until < isoDay(now);
/** On only when switched on AND not past its end date (audit rule 3: an expired link never pretends to be on). */
export function linkState(l: Pick<GuestLink, "until" | "active">, now: number): { label: string; tone: Tone; on: boolean } {
  if (linkExpired(l, now)) return { label: "Expired", tone: "grey", on: false };
  return l.active ? { label: "Active", tone: "green", on: true } : { label: "Off", tone: "grey", on: false };
}
export function linkRows(l: GuestLink, rooms: Room[], people: Map<string, Person>, now: number, days: (d: number[]) => string): [string, string][] {
  const open = l.days.length === 7 && l.from === 0 && l.to === 24 ? "Each room's own hours" : `${days(l.days)}, ${l.from}:00 - ${l.to}:00`;
  return [
    ["Rooms", l.rooms.length ? l.rooms.map((id) => rooms.find((r) => r.id === id)?.name ?? `#${id}`).join(", ") : "Every room open for booking"],
    ["Opening hours", open],
    ["Longest booking", l.length >= 480 || !l.length ? "Room's own limit" : `Up to ${durL(l.length)}`],
    ["Works until", l.until ? `${dLab(new Date(`${l.until}T00:00:00`).getTime())}${linkExpired(l, now) ? " · expired" : ""}` : "No end date"],
    ["Who can use it", l.audience === "staff" ? "Our staff only" : "Anyone with the link"],
    ["Booking emails to", l.hosts.length ? l.hosts.map((h) => people.get(h)?.name ?? h).join(", ") : "Nobody"],
    ["Booked", String(l.booked)],
  ];
}

/** Today's date at 00:00 plus `n` days, as YYYY-MM-DD. */
export const isoPlus = (t: number, n: number) => isoDay(addDays(startOfDay(t), n));
