// Meetings v3 — the other sections: My meetings (upcoming + notifications), Rooms
// (cards), Guest links, Email and WhatsApp, Change log. Desktop MeetingsAdmin.tsx
// decides what each shows; the prototype decides how it looks.
import {
  ArrowRightLeft, Bell, CalendarPlus, CalendarX, Check, CloudOff, Copy, DoorOpen, ExternalLink, History, Info, Link as LinkIcon, Mail, MapPin, MessageCircle, Pencil, Plus, Power, Video,
} from "lucide-react";
import { BTN, C, NUM, SH, Skeletons, StateCard } from "../comms-kit";
import { daysLabel, guestLinkUrl, ms, occupancy, type GuestLink, type Meeting, type Notice, type Person, type Room } from "@/lib/meetings";
import { dLab, groupByDay, hm, linkRows, linkState, mineBadges, noticeKind, roomClosures, roomLive, roomNext, roomToday } from "./meet-lib";
import { BLUE, DayLine, RINGCARD, Seg, Tile, TonePill, rowTop, toneOf } from "./meet-ui";

const CARD18 = { borderRadius: 18, background: C.card, boxShadow: SH.card } as const;

function ErrorCard({ text }: { text: string }) {
  return <div style={{ paddingTop: 12 }}><StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't load this" text={text} /></div>;
}

// ---- My meetings ---------------------------------------------------------------------------------
export function MinePane({ data, error, sub, onSub, unread, me, rooms, people, colourOf, now, onOpen }: {
  data: { meetings: Meeting[]; notifications: Notice[] } | null; error: string; sub: "up" | "notif"; onSub: (s: "up" | "notif") => void; unread: number;
  me: string; rooms: Room[]; people: Map<string, Person>; colourOf: (m: Meeting) => string; now: number; onOpen: (id: number) => void;
}) {
  const groups = data ? groupByDay(data.meetings, now, true) : [];
  const notices = data?.notifications ?? [];
  const unreadNow = notices.filter((n) => !n.read).length;
  return (
    <div style={{ padding: "6px 16px 32px" }}>
      <Seg label="My meetings view" value={sub} onChange={onSub}
        items={[{ key: "up", label: "Upcoming" }, { key: "notif", label: "Notifications", badge: unread ? String(unread) : undefined, badgeRed: true }]} />
      {error && !data ? <ErrorCard text={error} /> : !data ? <div style={{ paddingTop: 14 }}><Skeletons n={3} h={96} label="Loading my meetings" /></div> : sub === "up" ? (
        groups.length === 0 ? <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13.5, color: C.muted }}>Nothing booked with you yet.</div> : groups.map((g) => (
          <div key={g.day}>
            <DayLine label={g.label} red={g.today} style={{ padding: "14px 4px 6px" }} />
            <div style={{ display: "grid", gap: 8 }}>
              {g.rows.map((m) => {
                const room = rooms.find((r) => r.id === m.roomId);
                const mine = m.organizer === me || m.bookedBy === me;
                return (
                  <button key={m.id} type="button" onClick={() => onOpen(m.id)} className="c-press"
                    style={{ ...BTN, position: "relative", overflow: "hidden", display: "block", width: "100%", padding: "12px 13px 11px 16px", ...CARD18, textAlign: "left", color: C.ink, opacity: m.status === "ended" ? 0.65 : 1 }}>
                    <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: colourOf(m) }} />
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 800, ...NUM }}>{hm(ms(m.start))} – {hm(ms(m.end))}</span>
                      {m.video.url ? <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: BLUE }}><Video size={12} strokeWidth={2} />Video</span> : null}
                      <span style={{ flex: 1 }} />
                      {mineBadges(m, me).map((b) => <TonePill key={b.label} label={b.label} tone={b.tone} dot={!!b.dot} h={20} size={10} />)}
                    </span>
                    <span style={{ display: "block", marginTop: 5, fontSize: 14.5, fontWeight: 700, letterSpacing: "-.2px", lineHeight: 1.3 }}>{m.title || "(No title)"}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 11.5, color: C.muted, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.roomId ? <DoorOpen size={12} strokeWidth={2} color="var(--c-gold-mid)" style={{ flex: "none" }} /> : <Video size={12} strokeWidth={2} color="var(--c-gold-mid)" style={{ flex: "none" }} />}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{room ? [room.name, room.floor].filter(Boolean).join(" · ") : m.roomId ? "Room" : "Online"}</span>
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ flex: "none", whiteSpace: "nowrap" }}>{mine ? "You organise" : `By ${people.get(m.organizer)?.name ?? m.organizer}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      ) : (
        <>
          <DayLine label={unreadNow ? `${unreadNow} NEW` : notices.length ? "ALL READ" : "NOTIFICATIONS"} style={{ padding: "14px 4px 6px" }} />
          {notices.length === 0 ? <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13.5, color: C.muted }}>No notifications yet.</div> : (
            <div style={RINGCARD}>
              {notices.map((n, i) => {
                const k = noticeKind(n.text);
                const Icon = k === "cancel" ? CalendarX : k === "guest" ? LinkIcon : k === "change" ? ArrowRightLeft : k === "invite" ? CalendarPlus : Bell;
                const body = (
                  <>
                    <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: n.read ? C.track : C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={15} strokeWidth={2} color={n.read ? "var(--c-faint)" : "var(--c-gold)"} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: n.read ? 500 : 700, lineHeight: 1.4, color: C.ink }}>{n.text}</span>
                      <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 3, ...NUM }}>{dLab(ms(n.at))} · {hm(ms(n.at))}</span>
                    </span>
                    {!n.read ? <span aria-label="New" style={{ width: 8, height: 8, flex: "none", marginTop: 6, borderRadius: "50%", background: C.red }} /> : null}
                  </>
                );
                const style = { display: "flex", alignItems: "flex-start", gap: 10, padding: 12, borderTop: rowTop(i), background: n.read ? "transparent" : "var(--mt-unread)", width: "100%", boxSizing: "border-box", textAlign: "left" } as const;
                return n.meetingId ? <button key={n.id} type="button" onClick={() => onOpen(n.meetingId as number)} style={{ ...BTN, ...style }}>{body}</button> : <div key={n.id} style={style}>{body}</div>;
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Rooms ------------------------------------------------------------------------------------------
export function RoomsPane({ rooms, meetings, weekStart, now, canManage, error, onAdd, onEdit, onBook }: {
  rooms: Room[]; meetings: Meeting[]; weekStart: number; now: number; canManage: boolean; error: string; onAdd: () => void; onEdit: (r: Room) => void; onBook: (r: Room) => void;
}) {
  const locs = [...new Set(rooms.map((r) => r.location || "No location"))];
  const tile = { padding: "8px 10px", borderRadius: 12, background: "var(--mt-tile)", boxShadow: `0 0 0 1px ${C.hair}`, minWidth: 0 } as const;
  const head = { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, color: C.gold } as const;
  return (
    <div style={{ padding: "6px 16px 32px" }}>
      {canManage ? (
        <button type="button" onClick={onAdd} style={{ ...BTN, width: "100%", height: 44, marginTop: 4, borderRadius: 12, border: "1.5px dashed var(--c-sand)", background: C.dashBg, color: C.gold, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Plus size={16} strokeWidth={2.2} />Add room
        </button>
      ) : (
        <div style={{ padding: "4px 4px 0", fontSize: 12, color: C.muted, lineHeight: 1.45 }}>Shared by every company. Only people with Manage meeting rooms can add or change rooms.</div>
      )}
      {error ? <div role="alert" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5 }}>Bookings could not be loaded: {error}</div> : null}
      {rooms.length === 0 ? (
        <div style={{ paddingTop: 14 }}><StateCard icon={DoorOpen} title="No rooms yet" text={canManage ? "Press Add room to set up the first one." : "Someone with Manage meeting rooms adds them here."} /></div>
      ) : null}
      {locs.map((loc) => (
        <div key={loc}>
          <DayLine label={loc.toUpperCase()} icon={MapPin} style={{ padding: "14px 4px 6px" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 10 }}>
            {rooms.filter((r) => (r.location || "No location") === loc).map((r) => {
              const live = roomLive(r, meetings, now);
              const lt = toneOf(live.tone);
              const occ = occupancy(r, meetings, weekStart);
              const closed = roomClosures(r, now);
              return (
                <section key={r.id} aria-label={r.name} style={{ borderRadius: 20, padding: 14, background: "var(--mt-room-glass)", boxShadow: "var(--mt-room-sh)", opacity: r.active ? 1 : 0.8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ width: 36, height: 36, flex: "none", borderRadius: 11, background: r.color, display: "flex", alignItems: "center", justifyContent: "center" }}><DoorOpen size={16} strokeWidth={2} color="#FFFFFF" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.2px" }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{[r.floor, r.location].filter(Boolean).join(" · ") || "No floor set"} · {r.seats} seats</div>
                    </div>
                    <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 8px", borderRadius: 999, background: lt.bg, color: lt.fg, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: lt.fg }} />{live.label}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
                    {r.equipment.length ? r.equipment.map((q) => <span key={q} style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: C.cream, color: C.gold, fontSize: 10.5, fontWeight: 600 }}>{q}</span>)
                      : <span style={{ fontSize: 11.5, color: C.faint }}>No equipment</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 10 }}>
                    <div style={tile}><div style={head}>NEXT BOOKING</div><div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, lineHeight: 1.3 }}>{roomNext(r, meetings, now)}</div></div>
                    <div style={tile}><div style={head}>TODAY</div><div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, lineHeight: 1.3, ...NUM }}>{roomToday(r, meetings, now)}</div></div>
                    <div style={tile}><div style={head}>OPEN</div><div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, lineHeight: 1.3 }}>{daysLabel(r.open_days)} · {r.open_from}:00–{r.open_to}:00</div></div>
                    <div style={tile}>
                      <div style={head}>THIS WEEK</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span style={{ flex: 1, height: 5, borderRadius: 999, background: C.track, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.min(100, occ.percent)}%`, background: r.color, borderRadius: 999 }} /></span>
                        <span style={{ fontSize: 11.5, fontWeight: 800, ...NUM }}>{occ.percent}%</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>{occ.afterHours ? `${occ.afterHours} h after hours` : "No after-hours use"}</div>
                    </div>
                  </div>
                  {closed ? (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8, fontSize: 11.5, lineHeight: 1.4, color: C.note }}>
                      <span style={{ flex: "none", display: "flex", height: 16, alignItems: "center" }}><CalendarX size={13} strokeWidth={2} color="var(--c-note)" /></span><span>{closed}</span>
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={() => onBook(r)} disabled={!r.active}
                      style={{ ...BTN, flex: 1, height: 42, borderRadius: 999, background: r.active ? C.grad : C.track, color: r.active ? "#FFFFFF" : C.faint, fontSize: 13, fontWeight: 700, cursor: r.active ? "pointer" : "default", boxShadow: r.active ? "0 8px 16px -10px rgba(107,92,50,.7)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <CalendarPlus size={15} strokeWidth={2} />{r.active ? "Book this room" : "Closed for booking"}
                    </button>
                    {canManage ? (
                      <button type="button" onClick={() => onEdit(r)} aria-label={`Edit ${r.name}`} style={{ ...BTN, width: 42, height: 42, flex: "none", borderRadius: "50%", background: C.card, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 1px rgba(201,169,97,.3)" }}>
                        <Pencil size={16} strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ))}
      {rooms.length ? <div style={{ padding: "12px 4px 0", fontSize: 11.5, lineHeight: 1.45, color: C.faint }}>This week = hours booked inside the room's usual hours, divided by those hours. Rooms can still be booked outside usual hours; that time shows as after hours.</div> : null}
    </div>
  );
}

// ---- Guest links ----------------------------------------------------------------------------------------
export function LinksPane({ links, error, rooms, people, now, origin, busyId, onCreate, onCopy, onToggle }: {
  links: GuestLink[] | null; error: string; rooms: Room[]; people: Map<string, Person>; now: number; origin: string; busyId: number | null;
  onCreate: () => void; onCopy: (url: string) => void; onToggle: (l: GuestLink) => void;
}) {
  const btn = { ...BTN, height: 40, borderRadius: 10, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, textDecoration: "none" } as const;
  const ghost = { ...btn, background: C.card, boxShadow: "0 0 0 1px rgba(201,169,97,.35)", color: C.gold } as const;
  return (
    <div style={{ padding: "8px 16px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 4px 10px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Guest links</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>People outside the company book a room with these, without logging in.</div>
        </div>
        <button type="button" onClick={onCreate} style={{ ...BTN, height: 40, padding: "0 12px 0 10px", borderRadius: 999, background: C.grad, color: "#FFFFFF", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", flex: "none" }}>
          <LinkIcon size={15} strokeWidth={2.2} />Create link
        </button>
      </div>
      {error && !links ? <ErrorCard text={error} /> : !links ? <Skeletons n={2} h={220} label="Loading guest links" /> : links.length === 0 ? (
        <StateCard icon={LinkIcon} title="No links yet" text="Create one and send it to a customer or supplier. They pick a day, a room and a time, and it is confirmed straight away." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 10 }}>
          {links.map((l) => {
            const st = linkState(l, now);
            const t = toneOf(st.tone);
            const url = guestLinkUrl(origin, l.code);
            const expired = st.label === "Expired";
            const tog = expired ? { bg: C.track, fg: C.grey, l: "Expired" } : l.active ? { bg: C.redBg, fg: C.red, l: "Turn off" } : { bg: C.greenBg, fg: C.green, l: "Turn on" };
            return (
              <section key={l.id} aria-label={l.name || "Guest link"} style={{ borderRadius: 18, background: C.card, boxShadow: SH.info, padding: "13px 14px", opacity: st.on ? 1 : 0.78 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{l.name || "Untitled link"}</div>
                    <div style={{ fontSize: 11.5, color: BLUE, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url.replace(/^https?:\/\//, "")}</div>
                  </div>
                  <span style={{ flex: "none", height: 22, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 8px", borderRadius: 999, background: t.bg, color: t.fg, fontSize: 10.5, fontWeight: 700 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.fg }} />{st.label}
                  </span>
                </div>
                <div style={{ marginTop: 10, borderRadius: 12, background: C.paper, overflow: "hidden" }}>
                  {linkRows(l, rooms, people, now, daysLabel).map(([k, v], i) => (
                    <div key={k} style={{ display: "flex", gap: 10, padding: "7px 10px", borderTop: rowTop(i), fontSize: 12 }}>
                      <span style={{ width: 104, flex: "none", color: C.muted }}>{k}</span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontWeight: 600, color: C.ink, lineHeight: 1.4, ...NUM }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 10 }}>
                  <button type="button" onClick={() => onCopy(url)} style={ghost}><Copy size={14} strokeWidth={2} />Copy</button>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={ghost}><ExternalLink size={14} strokeWidth={2} />Open</a>
                  <button type="button" onClick={() => onToggle(l)} disabled={busyId === l.id} aria-busy={busyId === l.id || undefined}
                    style={{ ...btn, background: tog.bg, color: tog.fg, opacity: busyId === l.id ? 0.6 : 1 }}><Power size={14} strokeWidth={2} />{tog.l}</button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Email and WhatsApp (information only, desktop EmailPage) ------------------------------------------------
const MAIL_ROWS = [
  "Invitations when someone is added to a meeting",
  "Changes when the time, room or people change",
  "Cancellations",
  "Email reminders, when the organiser picks Email",
  "Booking emails for guest links, to the people chosen on each link",
];
export function EmailPane() {
  return (
    <div style={{ padding: "8px 16px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ padding: "2px 4px" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Email and WhatsApp</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>How meeting messages reach people · room managers only</div>
      </div>
      <section style={{ borderRadius: 20, padding: 14, background: "var(--mt-room-glass)", boxShadow: "var(--mt-room-sh)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Tile icon={Mail} bg="var(--c-grad-tile)" fg="#FFFFFF" size={36} radius={11} iconSize={16} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 700 }}>Email</div><div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>On · sent from this ERP's own mailbox</div></div>
          <TonePill label="On" tone="green" />
        </div>
        <div style={{ height: 1, background: C.divider, margin: "12px 0 10px" }} />
        {MAIL_ROWS.map((r) => (
          <div key={r} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 12.5, lineHeight: 1.45, color: C.body }}>
            <Check size={14} strokeWidth={2.4} color="var(--c-green)" style={{ flex: "none", marginTop: 2 }} /><span>{r}</span>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>They go to everyone in the meeting who has an email address, outside guests included, and also show as the bell notice in each person's own ERP and in My meetings. Each meeting's detail shows which emails were sent.</div>
      </section>
      <section style={{ borderRadius: 20, padding: 14, ...RINGCARD, overflow: "visible" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Tile icon={MessageCircle} bg={C.track} fg="var(--c-muted)" size={36} radius={11} iconSize={16} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 700 }}>WhatsApp</div><div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Through Houzs Connect</div></div>
          <TonePill label="Coming soon" tone="amber" dot={false} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 10, fontSize: 11.5, lineHeight: 1.45, color: C.note }}>
          <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><Info size={14} strokeWidth={2} color="var(--c-note)" /></span>
          <span>Nothing is sent by WhatsApp yet. The reminder option shows it as Coming soon.</span>
        </div>
      </section>
    </div>
  );
}

// ---- Change log -------------------------------------------------------------------------------------------------
export function LogPane({ log, error, people }: { log: { at: string; who: string; text: string }[] | null; error: string; people: Map<string, Person> }) {
  return (
    <div style={{ padding: "8px 16px 32px" }}>
      <div style={{ padding: "2px 4px 10px" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Change log</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Changes to rooms and guest links · room managers only</div>
      </div>
      {error && !log ? <ErrorCard text={error} /> : !log ? <Skeletons n={3} h={56} label="Loading the change log" /> : log.length === 0 ? (
        <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13.5, color: C.muted }}>No room or link changes yet.</div>
      ) : (
        <div style={RINGCARD}>
          {log.map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", borderTop: rowTop(i) }}>
              <Tile icon={History} bg={C.cream} fg="var(--c-gold)" size={30} radius={9} iconSize={14} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, lineHeight: 1.4 }}><b>{people.get(l.who)?.name ?? l.who}</b> {l.text}</span>
                <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 2, ...NUM }}>{dLab(ms(l.at))} · {hm(ms(l.at))}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
