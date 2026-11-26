// Meetings v3 — one meeting (?m=ID): the prototype's detail page over the desktop
// MeetingDetail rules (who booked it, people, notes and files, reminders, outside
// guests, the emails by kind, history, Join, and Start / End / Edit / Cancel for the
// organiser or the person who booked it only).
import { useState } from "react";
import { AtSign, BellRing, ChevronDown, Clock, CloudOff, DoorOpen, History, Info, Link as LinkIcon, Mail, Paperclip, Pencil, Play, Repeat, Square, CalendarX, Video } from "lucide-react";
import { BTN, C, Column, NUM, PageBar, SH, Skeletons, StateCard } from "../comms-kit";
import { BottomBar } from "../comms-kit";
import { ms, peopleOf, type Meeting, type Person, type Room } from "@/lib/meetings";
import { autoNote, channelLabel, dLab, dLong, detailActs, emailRows, emailSummary, hm, lockNote, remLabel, statusPill, type DetailAct } from "./meet-lib";
import { Avatar, BLUE, BLUE_BG, DayLine, RINGCARD, TonePill, rowTop } from "./meet-ui";
import { useGet } from "./meet-data";

export type MeetingFile = { id: number; file_name: string; size_bytes: number; mime_type?: string };
type Detail = { meeting: Meeting; history: { at: string; who: string; text: string }[]; files: MeetingFile[] };

export function MeetingDetail({ id, seed, tick, me, rooms, people, colourOf, busy, onBack, onAct, onFile }: {
  id: number; seed: Meeting | null; tick: number; me: string; rooms: Room[]; people: Map<string, Person>; colourOf: (m: Meeting) => string; busy: boolean;
  onBack: () => void; onAct: (m: Meeting, act: DetailAct) => void; onFile: (m: Meeting, f: MeetingFile) => void;
}) {
  const r = useGet<Detail>(`/api/meetings/meetings/${id}`, tick);
  const [mailOpen, setMailOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const m = r.data?.meeting ?? seed;
  const st = m ? statusPill(m) : null;
  const bar = <PageBar title="Meeting" onBack={onBack} backLabel="Back" right={st ? <TonePill label={st.label} tone={st.tone} h={24} size={11.5} /> : null} />;

  if (!m) {
    return (
      <div style={{ minHeight: "100%", background: C.paper }}>
        {bar}
        <Column>
          <div style={{ padding: "4px 16px 32px" }}>
            {r.error ? <StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't open this meeting" text={r.error} /> : <Skeletons n={3} h={120} label="Loading the meeting" />}
          </div>
        </Column>
      </div>
    );
  }

  const room = rooms.find((x) => x.id === m.roomId);
  const c = colourOf(m);
  const acts = detailActs(m, me);
  const lock = lockNote(m, me, people);
  const files = r.data?.files ?? [];
  const history = r.data?.history ?? null;
  const ppl = peopleOf(m);
  const guests = m.guestEmails ?? [];
  const emails = m.emails ?? [];
  const name = (k: string) => people.get(k)?.name ?? (k === "guest" ? "Guest" : k);
  const sub = (k: string) => [people.get(k)?.company, people.get(k)?.department].filter(Boolean).join(" · ");
  const videoLabel = m.video.type === "meet" ? "Join Google Meet" : m.video.type === "zoom" ? "Join Zoom" : "Join video call";
  const row = { display: "flex", gap: 10, padding: "11px 14px" } as const;

  return (
    <div style={{ minHeight: "100%", background: C.paper }}>
      {bar}
      <Column>
        <div style={{ padding: `0 16px ${acts.length ? 150 : 32}px`, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
          {r.error ? <div role="alert" style={{ padding: "9px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5 }}>Showing what the calendar had. {r.error}</div> : null}
          <section style={{ position: "relative", overflow: "hidden", borderRadius: 22, padding: "16px 16px 16px 19px", background: "var(--c-glass-bg)", boxShadow: "var(--c-glass-sh)" }}>
            <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: c }} />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-.3px", lineHeight: 1.3, color: C.ink, wordBreak: "break-word" }}>{m.title || "(No title)"}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13.5, fontWeight: 600, color: C.ink, ...NUM }}>
              <Clock size={15} strokeWidth={2} color="var(--c-gold-mid)" style={{ flex: "none" }} />{dLong(ms(m.start))} · {hm(ms(m.start))} – {hm(ms(m.end))}
            </div>
            {m.seriesId ? <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12.5, color: C.body }}><Repeat size={14} strokeWidth={2} color="var(--c-gold-mid)" />Repeating meeting</div> : null}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "10px 12px", borderRadius: 14, background: "var(--mt-tile)", boxShadow: `0 0 0 1px ${C.hair}` }}>
              <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: room ? room.color : "#8A8F98", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {m.roomId ? <DoorOpen size={15} strokeWidth={2} color="#FFFFFF" /> : <Video size={15} strokeWidth={2} color="#FFFFFF" />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{room ? room.name : m.roomId ? "A room" : "No room"}</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{room ? [room.floor, room.location, `${room.seats} seats`].filter(Boolean).join(" · ") : m.roomId ? "" : "Online only · only the people in it can see it"}</span>
              </span>
            </div>
            {m.video.url ? (
              <a href={m.video.url} target="_blank" rel="noopener noreferrer"
                style={{ marginTop: 10, width: "100%", height: 46, borderRadius: 12, background: BLUE, color: "#FFFFFF", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, boxShadow: "var(--mt-join-sh)", textDecoration: "none" }}>
                <Video size={17} strokeWidth={2.2} />{videoLabel}
              </a>
            ) : null}
            {m.video.url ? <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint, wordBreak: "break-all" }}>{m.video.url}</div> : null}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 10, fontSize: 11.5, lineHeight: 1.45, color: C.note }}>
              <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><Info size={14} strokeWidth={2} color="var(--c-note)" /></span>
              <span>{autoNote(m, me)}</span>
            </div>
          </section>

          {m.guest ? (
            <section style={{ borderRadius: 16, padding: "12px 14px", background: C.tealBg, boxShadow: "0 0 0 1px var(--mt-guest-ring)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.teal }}><LinkIcon size={13} strokeWidth={2.2} />GUEST BOOKING</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 5 }}>{[m.guest.name, m.guest.company].filter(Boolean).join(" · ")}</div>
              <div style={{ fontSize: 12, color: C.body, marginTop: 2, wordBreak: "break-word" }}>{[m.guest.email, m.guest.phone].filter(Boolean).join(" · ") || "No contact left"}</div>
              <div style={{ fontSize: 11.5, color: C.teal, marginTop: 6 }}>Booked through a guest link and confirmed automatically. Guest bookings can't be edited.</div>
            </section>
          ) : null}

          <section style={{ ...RINGCARD, boxShadow: SH.info }}>
            <div style={row}>
              <span style={{ width: 84, flex: "none", fontSize: 12, color: C.muted, paddingTop: 2 }}>Booked by</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 13, fontWeight: 600 }}>
                {m.guest ? `${m.guest.name} (guest link)` : `${name(m.bookedBy)}${m.bookedBy === me ? " (you)" : ""}${m.bookedBy !== m.organizer ? `, for ${name(m.organizer)}` : ""}`}
              </span>
            </div>
            <div style={{ ...row, borderTop: `1px solid ${C.hair}` }}>
              <span style={{ width: 84, flex: "none", fontSize: 12, color: C.muted, paddingTop: 2 }}>{m.guest ? "Host" : "Organiser"}</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 13, fontWeight: 600 }}>{name(m.organizer)}{m.organizer === me ? " (you)" : ""}</span>
            </div>
          </section>

          <DayLine label={`PEOPLE · ${ppl.length + guests.length}`} style={{ padding: "4px 4px 0" }} />
          <section style={RINGCARD}>
            {ppl.map((k, i) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: rowTop(i) }}>
                <Avatar name={name(k)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name(k)}</span>
                    {k === m.organizer ? <TonePill label={m.guest ? "Host" : "Organiser"} tone="amber" dot={false} h={18} size={9.5} /> : null}
                    {k === me ? <span style={{ flex: "none", height: 18, display: "inline-flex", alignItems: "center", padding: "0 6px", borderRadius: 999, background: BLUE_BG, color: BLUE, fontSize: 9.5, fontWeight: 700 }}>You</span> : null}
                  </span>
                  {sub(k) ? <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 1 }}>{sub(k)}</span> : null}
                </span>
              </div>
            ))}
            {guests.map((g) => (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: `1px solid ${C.hair}` }}>
                <span style={{ width: 32, height: 32, flex: "none", borderRadius: "50%", background: C.tealBg, color: C.teal, display: "flex", alignItems: "center", justifyContent: "center" }}><AtSign size={15} strokeWidth={2} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, wordBreak: "break-all" }}>{g}</span>
                  <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 1 }}>Outside guest · by email</span>
                </span>
              </div>
            ))}
          </section>

          {m.notes || files.length ? (
            <section style={{ ...RINGCARD, padding: "12px 14px", overflow: "visible" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold }}>NOTES{files.length ? " AND FILES" : ""}</div>
              {m.notes ? <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.55, color: C.body, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.notes}</p> : null}
              {files.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {files.map((f) => (
                    <button key={f.id} type="button" onClick={() => onFile(m, f)} style={{ ...BTN, height: 32, maxWidth: "100%", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 999, background: C.cream, color: C.gold, fontSize: 12, fontWeight: 600 }}>
                      <Paperclip size={12} strokeWidth={2} style={{ flex: "none" }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {m.reminders && m.reminders.length ? (
            <section style={{ ...RINGCARD, padding: "12px 14px", overflow: "visible" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold }}>REMINDERS</div>
              {m.reminders.map((x, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
                  <BellRing size={14} strokeWidth={2} color="var(--c-gold-mid)" style={{ flex: "none" }} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{remLabel(x.min)}</span>
                  <span style={{ fontSize: 11.5, color: C.muted }}>{x.ch.map(channelLabel).join(" · ")}</span>
                </div>
              ))}
            </section>
          ) : null}

          {emails.length || (history && history.length) ? (
            <section style={RINGCARD}>
              {emails.length ? (
                <>
                  <button type="button" onClick={() => setMailOpen((v) => !v)} aria-expanded={mailOpen} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "0 14px", background: "none", textAlign: "left", color: C.ink }}>
                    <Mail size={16} strokeWidth={2} color="var(--c-gold)" /><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>Emails</span>
                    <span style={{ fontSize: 11.5, color: C.muted }}>{emailSummary(emails)}</span>
                    <ChevronDown size={16} strokeWidth={2} color="var(--c-chev)" style={{ transform: mailOpen ? "rotate(180deg)" : "none" }} />
                  </button>
                  {mailOpen ? (
                    <div style={{ padding: "0 14px 10px" }}>
                      {emailRows(emails).map((e, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0", borderTop: `1px solid ${C.track}`, fontSize: 12 }}>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 700 }}>{e.kind}</span>
                            <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 1, wordBreak: "break-word" }}>To {e.to}</span>
                            <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 1 }}>{e.detail}</span>
                          </span>
                          <span style={{ flex: "none", fontSize: 11, fontWeight: 700, color: e.state === "sent" ? C.green : e.state === "failed" ? C.red : C.note }}>{e.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              {history && history.length ? (
                <>
                  <button type="button" onClick={() => setHistOpen((v) => !v)} aria-expanded={histOpen} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "0 14px", background: "none", textAlign: "left", color: C.ink, borderTop: emails.length ? `1px solid ${C.hair}` : "none" }}>
                    <History size={16} strokeWidth={2} color="var(--c-gold)" /><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>Meeting history</span>
                    <span style={{ fontSize: 11.5, color: C.muted }}>{history.length} change{history.length === 1 ? "" : "s"}</span>
                    <ChevronDown size={16} strokeWidth={2} color="var(--c-chev)" style={{ transform: histOpen ? "rotate(180deg)" : "none" }} />
                  </button>
                  {histOpen ? (
                    <div style={{ padding: "0 14px 10px" }}>
                      {history.map((h, i) => (
                        <div key={i} style={{ padding: "7px 0", borderTop: `1px solid ${C.track}`, fontSize: 12, lineHeight: 1.45 }}>
                          <b>{name(h.who)}</b> {h.text}
                          <span style={{ display: "block", fontSize: 11, color: C.faint, ...NUM }}>{dLab(ms(h.at))} · {hm(ms(h.at))}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {lock ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "0 4px", fontSize: 11.5, lineHeight: 1.45, color: C.note }}>
              <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><Info size={14} strokeWidth={2} color="var(--c-note)" /></span><span>{lock}</span>
            </div>
          ) : null}
        </div>
      </Column>
      {acts.length ? (
        <BottomBar background="var(--c-paper)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, padding: "10px 16px calc(12px + env(safe-area-inset-bottom))" }}>
            {acts.map((a, i) => <ActButton key={a} act={a} busy={busy} wide={i === 0 && acts.length % 2 === 1} onClick={() => onAct(m, a)} />)}
          </div>
        </BottomBar>
      ) : null}
    </div>
  );
}

const ACT: Record<DetailAct, { l: string; icon: typeof Play; bg: string; fg: string; sh: string }> = {
  start: { l: "Start meeting", icon: Play, bg: "var(--c-green)", fg: "#FFFFFF", sh: "none" },
  end: { l: "End meeting", icon: Square, bg: "var(--c-red)", fg: "#FFFFFF", sh: "none" },
  edit: { l: "Edit", icon: Pencil, bg: "var(--c-card)", fg: "var(--c-gold)", sh: "0 0 0 1px rgba(201,169,97,.4)" },
  cancel: { l: "Cancel meeting", icon: CalendarX, bg: "var(--c-card)", fg: "var(--c-red)", sh: "0 0 0 1px var(--c-red-ring)" },
};
function ActButton({ act, busy, wide, onClick }: { act: DetailAct; busy: boolean; wide: boolean; onClick: () => void }) {
  const a = ACT[act];
  const Icon = a.icon;
  return (
    <button type="button" onClick={onClick} disabled={busy} style={{ ...BTN, gridColumn: wide ? "1 / -1" : undefined, minWidth: 0, height: 48, borderRadius: 14, background: a.bg, color: a.fg, boxShadow: a.sh, fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>
      <Icon size={16} strokeWidth={2.2} style={{ flex: "none" }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.l}</span>
    </button>
  );
}
