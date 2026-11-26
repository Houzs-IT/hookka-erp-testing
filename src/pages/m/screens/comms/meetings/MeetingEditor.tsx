// Meetings v3 — the full booking editor (?edit=new|ID) and its two sub-pages:
// the people picker (&sub=people: company → department → people, outside guests)
// and Find a time (&sub=find). The desktop MeetingEditor's fields and rules
// (src/pages/meetings/MeetingsDialogs.tsx); the prototype's layout.
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Building2, CalendarSearch, Check, ChevronDown, ChevronRight, Crown, DoorOpen, Minus, Paperclip, Plus, Repeat, Search, Trash2, TriangleAlert, UserPlus, Users, Video, X,
} from "lucide-react";
import { BTN, C, Column, FormBar, NUM, PageBar, SH, Spinner, BottomBar, PrimaryButton } from "../comms-kit";
import { REMINDER_OPTIONS, addDays, directoryTree, hhmm, isoDay, startOfDay, withTime, type Draft, type Person, type Room } from "@/lib/meetings";
import {
  FIND_LENGTHS, LENGTHS, busyRooms, dLab, durL, findSlots, hm, isoPlus, parseGuestEmails, peopleCount, peopleLine, repeatOptions, roomStates, roomWarnings, shiftTime, spacedSlots,
} from "./meet-lib";
import { Avatar, CheckBox, DayLine, INPUT, LABEL, RINGCARD, RadioDot, SELECT, SMALL_LABEL, Seg, chipCss, rowTop, toneOf } from "./meet-ui";
import { api, errText, useMeetingsBetween } from "./meet-data";

export type EditorState = { d: Draft; isNew: boolean; scope: "one" | "following"; online: boolean };
type SetD = (patch: Partial<Draft>) => void;

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;
const box = { borderRadius: 16, background: C.card, boxShadow: SH.panel } as const;

/** Online drops the room; choosing it also picks Google Meet when no video was set (desktop onOnline). */
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export function onlinePatch(d: Draft): Partial<Draft> {
  return { roomId: null, videoType: d.videoType === "none" ? "meet" : d.videoType };
}

export function MeetingEditor({ st, set, setOnline, tick, me, rooms, people, meetConnected, files, onFiles, saving, onCancel, onSave, onPeople, onFind, toast }: {
  st: EditorState; set: SetD; setOnline: (on: boolean) => void; tick: number; me: string; rooms: Room[]; people: Map<string, Person>; meetConnected: boolean;
  files: File[]; onFiles: (f: File[]) => void; saving: boolean; onCancel: () => void; onSave: () => void; onPeople: () => void; onFind: () => void; toast: (m: string) => void;
}) {
  const { d, isNew, scope } = st;
  const day = startOfDay(d.start);
  const dayData = useMeetingsBetween(day, addDays(day, 1), tick);
  const busy = useMemo(() => busyRooms(dayData.meetings, d), [dayData.meetings, d]);
  const isOnline = st.online;
  const states = roomStates(rooms, d, busy);
  const warns = isOnline ? [] : roomWarnings(rooms, d, busy);
  const len = Math.round((d.end - d.start) / 60000);
  const fileRef = useRef<HTMLInputElement>(null);
  const [meetBusy, setMeetBusy] = useState(false);
  const [meetErr, setMeetErr] = useState("");

  const newMeet = async () => {
    setMeetBusy(true);
    setMeetErr("");
    try {
      const r = await api.post<{ url: string }>("/api/meetings/meet-link");
      set({ videoType: "meet", videoUrl: r.url });
    } catch (e) {
      setMeetErr(errText(e));
    } finally {
      setMeetBusy(false);
    }
  };
  const chooseVideo = (k: Draft["videoType"]) => {
    set({ videoType: k });
    if (k === "meet" && meetConnected && !d.videoUrl) void newMeet();
  };
  const goOnline = () => {
    setOnline(true);
    set(onlinePatch(d));
    if (d.videoType === "none" && meetConnected && !d.videoUrl) void newMeet();
  };
  const goInPerson = () => {
    setOnline(false);
    const best = states.find((s) => s.best);
    set({ roomId: d.roomId ?? best?.room.id ?? states.find((s) => !s.disabled)?.room.id ?? null });
  };
  const addFiles = (list: FileList) => {
    const all = [...list];
    const big = all.filter((f) => f.size > MAX_BYTES);
    const ok = all.filter((f) => f.size <= MAX_BYTES);
    const next = [...files, ...ok];
    if (big.length) toast(`${big.map((f) => f.name).join(", ")} wasn't added — files can be up to 25 MB`);
    else if (next.length > MAX_FILES) toast("Up to 10 files per meeting");
    onFiles(next.slice(0, MAX_FILES));
  };

  return (
    <div style={{ minHeight: "100%", background: C.paper }}>
      <FormBar title={isNew ? "Book a meeting" : "Edit meeting"} onCancel={onCancel} cancelDisabled={saving} />
      <Column>
        <div style={{ padding: "14px 16px 150px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 18 }}>
          {!isNew && d.seriesId ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 12, background: C.tint, color: C.gold, fontSize: 12.5, fontWeight: 600 }}>
              <Repeat size={14} strokeWidth={2.2} />{scope === "following" ? "Changing this and following meetings" : `Changing only ${dLab(d.start)}`}
            </div>
          ) : null}
          <div>
            <label htmlFor="mt-title" style={{ display: "block", marginBottom: 6, ...LABEL }}>Title</label>
            <input id="mt-title" className="c-input" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Weekly sales review" maxLength={200} style={{ ...INPUT, height: 46 }} />
          </div>

          <div style={{ ...box, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={LABEL}>When</span>
              <input type="date" aria-label="Date" value={isoDay(d.start)} onChange={(e) => { const v = e.target.value; if (v) set({ start: withTime(v, hhmm(d.start)), end: withTime(v, hhmm(d.end)) }); }}
                style={{ height: 38, boxSizing: "border-box", padding: "0 10px", borderRadius: 10, border: "none", background: C.paper, boxShadow: SH.ring, fontFamily: "inherit", fontSize: 15, color: C.ink, colorScheme: "light dark" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
              {(["start", "end"] as const).map((w) => (
                <div key={w} style={{ padding: 8, borderRadius: 12, background: C.paper, boxShadow: `0 0 0 1px ${C.hair}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: C.gold, textAlign: "center" }}>{w === "start" ? "START" : "END"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                    <StepBtn label={`${w} 15 minutes earlier`} onClick={() => set(shiftTime(d, w, -15))} icon={Minus} />
                    <span style={{ flex: 1, textAlign: "center", fontSize: 17, fontWeight: 800, ...NUM }}>{hm(w === "start" ? d.start : d.end)}</span>
                    <StepBtn label={`${w} 15 minutes later`} onClick={() => set(shiftTime(d, w, 15))} icon={Plus} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-x" style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 10 }}>
              {LENGTHS.map((n) => (
                <button key={n} type="button" aria-pressed={len === n} onClick={() => set({ end: d.start + n * 60000 })} style={{ ...BTN, ...chipCss(len === n), flex: "none", height: 32, padding: "0 11px", borderRadius: 999, fontSize: 12, whiteSpace: "nowrap" }}>{durL(n)}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>Times move in 15-minute steps · {durL(len)}</div>
            <button type="button" onClick={onFind} style={{ ...BTN, marginTop: 10, width: "100%", height: 42, borderRadius: 999, background: "var(--c-ghost-bg)", boxShadow: SH.ghost, color: C.gold, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <CalendarSearch size={15} strokeWidth={2} />Find a time that suits everyone
            </button>
          </div>

          {isNew ? (
            <div>
              <div style={{ marginBottom: 6, ...LABEL }}>Repeat</div>
              <SelectBox label="Repeat" value={d.repeat} onChange={(v) => set({ repeat: v as Draft["repeat"], repeatUntil: d.repeatUntil ?? isoDay(addDays(d.start, 56)) })} options={repeatOptions(d.start)} />
              {d.repeat !== "none" ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 12.5, color: C.body }}>Repeat until</span>
                  <input type="date" aria-label="Repeat until" value={d.repeatUntil ?? ""} min={isoDay(d.start)} onChange={(e) => set({ repeatUntil: e.target.value || null })}
                    style={{ height: 40, boxSizing: "border-box", padding: "0 10px", borderRadius: 10, border: "none", background: C.card, boxShadow: SH.ring, fontFamily: "inherit", fontSize: 15, color: C.ink, colorScheme: "light dark" }} />
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}><span style={LABEL}>People</span><span style={{ fontSize: 11, color: C.faint }}>{peopleLine(d)}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 12, background: C.card, boxShadow: SH.panel }}>
              <Crown size={14} strokeWidth={2} color="#C9A24B" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.body }}>Organiser <b style={{ color: C.ink }}>{people.get(d.organizer)?.name ?? d.organizer}{d.organizer === me ? " (you)" : ""}</b></span>
            </div>
            {d.attendees.length || d.guestEmails.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {d.attendees.filter((a) => a !== d.organizer).map((k) => {
                  const n = people.get(k)?.name ?? k;
                  return <span key={k} style={{ height: 30, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 10px 0 4px", borderRadius: 999, background: C.cream, color: C.body, fontSize: 12, fontWeight: 600 }}><Avatar name={n} size={22} font={9.5} />{n}{k === me ? " (you)" : ""}</span>;
                })}
                {d.guestEmails.map((g) => <span key={g} style={{ height: 30, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 10px 0 4px", borderRadius: 999, background: C.tealBg, color: C.teal, fontSize: 12, fontWeight: 600, maxWidth: "100%" }}><span style={{ width: 22, height: 22, borderRadius: "50%", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flex: "none" }}>@</span><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{g}</span></span>)}
              </div>
            ) : null}
            <button type="button" onClick={onPeople} style={{ ...BTN, marginTop: 8, width: "100%", height: 44, borderRadius: 12, border: "1.5px dashed var(--c-sand)", background: C.dashBg, color: C.gold, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <UserPlus size={16} strokeWidth={2} />Add or change people
            </button>
          </div>

          <div>
            <div style={{ marginBottom: 6, ...LABEL }}>Where</div>
            <Seg label="Meeting type" role="radiogroup" value={isOnline ? "online" : "person"} onChange={(k) => (k === "online" ? goOnline() : goInPerson())}
              items={[{ key: "person", label: <><DoorOpen size={14} strokeWidth={2} />In person</> }, { key: "online", label: <><Video size={14} strokeWidth={2} />Online</> }]} />
            {isOnline ? (
              <div style={{ marginTop: 8, fontSize: 12, color: C.muted, lineHeight: 1.45 }}>No room. Only you and the people you add can see this meeting.</div>
            ) : (
              <>
                <div role="radiogroup" aria-label="Room" style={{ ...RINGCARD, marginTop: 8 }}>
                  {states.length === 0 ? <div style={{ padding: 14, fontSize: 12.5, color: C.muted }}>No rooms yet. Choose Online, or ask a room manager to add one.</div> : null}
                  {dayData.loading && !dayData.meetings.length ? <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 11.5, color: C.faint }}><Spinner size={10} />Checking which rooms are free…</div> : null}
                  {states.map((s, i) => {
                    const on = d.roomId === s.room.id;
                    const t = toneOf(s.tone);
                    return (
                      <button key={s.room.id} type="button" role="radio" aria-checked={on} disabled={s.disabled} onClick={() => set({ roomId: s.room.id })}
                        style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "8px 12px", borderTop: rowTop(i), background: on ? C.rowOn : "transparent", textAlign: "left", cursor: s.disabled ? "default" : "pointer", opacity: s.disabled ? 0.55 : 1, color: C.ink }}>
                        <RadioDot on={on} />
                        <span style={{ width: 8, height: 8, flex: "none", borderRadius: 3, background: s.room.color }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{s.room.name}</span>
                          <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 1 }}>{[s.room.floor, `${s.room.seats} seats`].filter(Boolean).join(" · ")}{s.small ? " · too small" : ""}</span>
                        </span>
                        <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, background: t.bg, color: t.fg, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{s.tag}</span>
                      </button>
                    );
                  })}
                </div>
                {dayData.error ? <div style={{ marginTop: 8, fontSize: 11.5, color: C.red }}>Couldn't check which rooms are free: {dayData.error}</div> : null}
                {warns.map((w, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8, fontSize: 11.5, lineHeight: 1.45, color: C.note }}>
                    <span style={{ flex: "none", display: "flex", height: 17, alignItems: "center" }}><TriangleAlert size={14} strokeWidth={2} color="var(--c-note)" /></span>
                    <span>{w.text}{w.use ? <> <button type="button" onClick={() => set({ roomId: w.use!.id })} style={{ ...BTN, background: "none", color: C.gold, fontSize: 11.5, fontWeight: 700, textDecoration: "underline" }}>Use {w.use.name} ({w.use.seats} seats)</button></> : null}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div>
            <div style={{ marginBottom: 6, ...LABEL }}>Video</div>
            <Seg label="Video" role="radiogroup" value={d.videoType === "zoom" ? "link" : d.videoType} onChange={chooseVideo} fontSize={12.5}
              items={[{ key: "meet", label: "Google Meet" }, { key: "link", label: "Paste a link" }, { key: "none", label: "None" }]} />
            {d.videoType !== "none" ? (
              <input aria-label="Video link" className="c-input" value={d.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} placeholder={d.videoType === "meet" ? "https://meet.google.com/..." : "Paste a Meet, Teams or other link"} style={{ ...INPUT, marginTop: 8 }} />
            ) : null}
            {d.videoType === "meet" && meetConnected ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" disabled={meetBusy} onClick={() => void newMeet()} style={{ ...BTN, height: 32, padding: "0 12px", borderRadius: 999, ...chipCss(false), fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  {meetBusy ? <Spinner size={11} /> : <Video size={13} strokeWidth={2} />}{meetBusy ? "Creating…" : d.videoUrl ? "New Meet link" : "Create Meet link"}
                </button>
                <span style={{ flex: 1, minWidth: 160, fontSize: 11.5, color: C.muted, lineHeight: 1.4 }}>Anyone with the link can join, outside guests too.</span>
              </div>
            ) : null}
            {d.videoType !== "none" && !(d.videoType === "meet" && meetConnected) ? (
              <div style={{ marginTop: 7, fontSize: 11.5, color: C.muted, lineHeight: 1.4 }}>Paste the link from {d.videoType === "meet" ? "Google Meet" : "your video app"}. You can also add it later; everyone in the meeting is told.</div>
            ) : null}
            {meetErr ? <div style={{ marginTop: 7, fontSize: 11.5, color: C.note }}>{meetErr}</div> : null}
          </div>

          <div>
            <div style={{ marginBottom: 6, ...LABEL }}>Reminders</div>
            <div style={{ display: "grid", gap: 8 }}>
              {d.reminders.map((rm, i) => (
                <div key={i} style={{ padding: 10, borderRadius: 14, background: C.card, boxShadow: SH.panel }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SelectBox label="Reminder time" value={String(rm.min)} small onChange={(v) => set({ reminders: d.reminders.map((x, j) => (j === i ? { ...x, min: Number(v) } : x)) })} options={REMINDER_OPTIONS.map(([v, l]) => [String(v), l] as [string, string])} />
                    </div>
                    <button type="button" aria-label="Remove reminder" onClick={() => set({ reminders: d.reminders.filter((_, j) => j !== i) })} style={{ ...BTN, width: 40, height: 40, flex: "none", background: "none", color: C.faint, display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={2} /></button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {(["erp", "email"] as const).map((ch) => {
                      const on = rm.ch.includes(ch);
                      return (
                        <button key={ch} type="button" role="checkbox" aria-checked={on} onClick={() => set({ reminders: d.reminders.map((x, j) => (j === i ? { ...x, ch: on ? x.ch.filter((y) => y !== ch) : [...x.ch, ch] } : x)) })}
                          style={{ ...BTN, ...chipCss(on), height: 32, padding: "0 10px", borderRadius: 999, fontSize: 12, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                          {on ? <Check size={12} strokeWidth={2.8} /> : null}{ch === "erp" ? "ERP" : "Email"}
                        </button>
                      );
                    })}
                    <span role="checkbox" aria-checked={false} aria-disabled="true" title="WhatsApp reminders are coming soon" style={{ height: 32, padding: "0 10px", borderRadius: 999, background: C.track, color: C.faint, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                      WhatsApp<span style={{ fontSize: 9.5, fontWeight: 700, color: C.amber, background: C.amberBg, padding: "1px 5px", borderRadius: 999 }}>Coming soon</span>
                    </span>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => set({ reminders: [...d.reminders, { min: 1440, ch: ["erp", "email"] }] })} style={{ ...BTN, height: 42, borderRadius: 12, background: "transparent", color: C.gold, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: "inset 0 0 0 1px rgba(201,169,97,.35)" }}>
                <Plus size={15} strokeWidth={2.2} />Add reminder
              </button>
              <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.4 }}>ERP reminders show in the ERP. Email reminders go to everyone in the meeting who has an email address, outside guests too.</div>
            </div>
          </div>

          <div>
            <label htmlFor="mt-notes" style={{ display: "block", marginBottom: 6, ...LABEL }}>Notes or agenda</label>
            <textarea id="mt-notes" className="c-input" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Agenda, what to prepare" style={{ ...INPUT, height: "auto", padding: "11px 13px", lineHeight: 1.45, resize: "vertical" }} />
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "4px 4px 4px 12px", borderRadius: 12, background: C.card, boxShadow: SH.panel }}>
                  <Paperclip size={14} strokeWidth={2} color="var(--c-gold-mid)" style={{ flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: C.faint, ...NUM }}>{f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onFiles(files.filter((_, j) => j !== i))} style={{ ...BTN, width: 36, height: 36, background: "none", color: C.faint, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} strokeWidth={2} /></button>
                </div>
              ))}
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
              <button type="button" onClick={() => (files.length >= MAX_FILES ? toast("Up to 10 files per meeting") : fileRef.current?.click())}
                style={{ ...BTN, height: 42, borderRadius: 12, border: "1.5px dashed var(--c-sand)", background: C.dashBg, color: C.gold, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Paperclip size={15} strokeWidth={2} />Attach files <span style={{ fontWeight: 500, color: C.faint }}>{files.length} / {MAX_FILES} · 25 MB each</span>
              </button>
              {!isNew ? <div style={{ fontSize: 11.5, color: C.faint }}>Files already on the meeting stay; these are added when you save.</div> : null}
            </div>
          </div>
        </div>
      </Column>
      <BottomBar>
        <div style={{ padding: "12px 16px calc(12px + env(safe-area-inset-bottom))" }}>
          <PrimaryButton icon={Check} busy={saving} onClick={onSave}>{isNew ? "Book meeting" : "Save changes"}</PrimaryButton>
        </div>
      </BottomBar>
    </div>
  );
}

function StepBtn({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon: typeof Plus }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} style={{ ...BTN, width: 36, height: 36, flex: "none", borderRadius: "50%", background: C.card, boxShadow: SH.ring, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon size={15} strokeWidth={2.4} />
    </button>
  );
}

export function SelectBox({ label, value, options, onChange, small }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div style={{ position: "relative" }}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...SELECT, height: small ? 40 : 46, fontSize: small ? 15 : 16, background: small ? C.paper : C.card, borderRadius: small ? 10 : 12 }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <span style={{ position: "absolute", right: 12, top: small ? 11 : 14, pointerEvents: "none", color: C.goldMid, display: "flex" }}><ChevronDown size={18} strokeWidth={2} /></span>
    </div>
  );
}

// ---- people picker (&sub=people) ---------------------------------------------------------------------------
export function PeoplePicker({ st, set, me, people, onDone, toast }: { st: EditorState; set: SetD; me: string; people: Person[]; onDone: () => void; toast: (m: string) => void }) {
  const { d, isNew } = st;
  const byKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people]);
  const tree = useMemo(() => directoryTree(people.filter((p) => p.key !== d.organizer)), [people, d.organizer]);
  // Opens on the organiser's own company and department (owner 2026-11-24; desktop PeoplePicker).
  const own = byKey.get(d.organizer);
  const [path, setPath] = useState<string[]>(() => {
    const co = tree.find((t) => t.company === own?.company);
    if (!co) return [];
    return co.departments.some((x) => x.name === (own?.department || "No department")) ? [co.company, own?.department || "No department"] : [co.company];
  });
  const [q, setQ] = useState("");
  const [gq, setGq] = useState("");
  const [gErr, setGErr] = useState("");
  const value = d.attendees.filter((a) => a !== d.organizer);
  const toggle = (k: string) => set({ attendees: value.includes(k) ? value.filter((x) => x !== k) : [...value, k] });
  const needle = q.trim().toLowerCase();
  const comp = path[0] ? tree.find((t) => t.company === path[0]) : null;
  const dep = comp && path[1] ? comp.departments.find((x) => x.name === path[1]) : null;
  const personRow = (p: Person, i: number) => {
    const on = value.includes(p.key);
    return (
      <button key={p.key} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(p.key)}
        style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", borderTop: rowTop(i), background: on ? C.rowOn : "transparent", textAlign: "left", color: C.ink }}>
        <CheckBox on={on} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{p.name}{p.key === me ? " (you)" : ""}</span>
          <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{[p.company, p.department].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
    );
  };
  const groupRow = (key: string, t: string, s: string, n: string, icon: "co" | "dep", onTap: () => void, i: number) => (
    <button key={key} type="button" onClick={onTap} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", borderTop: rowTop(i), background: "transparent", textAlign: "left", color: C.ink }}>
      <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon === "co" ? <Building2 size={15} strokeWidth={2} color="var(--c-gold)" /> : <Users size={15} strokeWidth={2} color="var(--c-gold)" />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{t}</span>
        <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{s}</span>
      </span>
      {n ? <span style={{ fontSize: 11.5, fontWeight: 700, color: C.gold, ...NUM }}>{n}</span> : null}
      <ChevronRight size={16} strokeWidth={2} color="var(--c-chev)" />
    </button>
  );
  let rows: ReactNode[] = [];
  if (needle) {
    rows = people.filter((p) => p.key !== d.organizer && `${p.name} ${p.company} ${p.department} ${p.email ?? ""}`.toLowerCase().includes(needle)).slice(0, 40).map(personRow);
  } else if (!comp) {
    rows = tree.map((t, i) => {
      const picked = t.departments.reduce((a, x) => a + x.people.filter((p) => value.includes(p.key)).length, 0);
      return groupRow(t.company, t.company, `${t.departments.length} department${t.departments.length === 1 ? "" : "s"}`, picked ? `${picked} picked` : "", "co", () => setPath([t.company]), i);
    });
  } else if (!dep) {
    rows = comp.departments.map((x, i) => {
      const picked = x.people.filter((p) => value.includes(p.key)).length;
      return groupRow(x.name, x.name, peopleCount(x.people.length), picked ? `${picked} picked` : "", "dep", () => setPath([comp.company, x.name]), i);
    });
  } else {
    rows = dep.people.map(personRow);
  }
  const allOn = !!dep && dep.people.length > 0 && dep.people.every((p) => value.includes(p.key));
  const addGuest = () => {
    const r = parseGuestEmails(gq, d.guestEmails);
    if ("error" in r) { setGErr(r.error); return; }
    set({ guestEmails: r.ok });
    setGq("");
    setGErr("");
  };
  const crumbs = comp ? [{ l: "All", p: [] as string[] }, { l: comp.company, p: [comp.company] }, ...(dep ? [{ l: dep.name, p: [comp.company, dep.name] }] : [])] : null;

  return (
    <div style={{ minHeight: "100%", background: C.paper }}>
      <PageBar title="People" onBack={() => (path.length && !needle ? setPath(path.slice(0, -1)) : onDone())} backLabel={path.length && !needle ? "Up one level" : "Back to booking"}
        right={<button type="button" onClick={onDone} style={{ ...BTN, height: 40, padding: "0 14px", borderRadius: 999, background: C.grad, color: "#FFFFFF", fontSize: 13, fontWeight: 700, flex: "none" }}>Done</button>} />
      <Column>
        <div style={{ padding: "12px 16px 40px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
          {isNew ? (
            <div>
              <div style={{ marginBottom: 6, ...LABEL }}>Organiser</div>
              <SelectBox label="Organiser" value={d.organizer} onChange={(v) => set({ organizer: v, attendees: d.attendees.filter((a) => a !== v) })}
                options={people.map((p) => [p.key, `${p.key === me ? "Me" : p.name} · ${[p.company, p.department].filter(Boolean).join(" · ")}`] as [string, string])} />
              <div style={{ marginTop: 5, fontSize: 11, color: C.faint }}>Pick someone else to book on their behalf</div>
            </div>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button type="button" onClick={() => toast("The organiser stays in the meeting")} style={{ ...BTN, height: 30, padding: "0 11px", borderRadius: 999, background: C.amberBg, color: C.amber, fontSize: 12, fontWeight: 600 }}>{byKey.get(d.organizer)?.name ?? d.organizer} · organiser</button>
            {value.map((k) => (
              <button key={k} type="button" aria-label={`Remove ${byKey.get(k)?.name ?? k}`} onClick={() => toggle(k)} style={{ ...BTN, height: 30, padding: "0 8px 0 11px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                {byKey.get(k)?.name ?? k}<X size={12} strokeWidth={2.4} />
              </button>
            ))}
            {d.guestEmails.map((g) => (
              <button key={g} type="button" aria-label={`Remove ${g}`} onClick={() => set({ guestEmails: d.guestEmails.filter((x) => x !== g) })} style={{ ...BTN, height: 30, maxWidth: "100%", padding: "0 8px 0 11px", borderRadius: 999, background: C.tealBg, color: C.teal, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{g}</span><X size={12} strokeWidth={2.4} style={{ flex: "none" }} />
              </button>
            ))}
          </div>
          <label style={{ height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: C.card, borderRadius: 12, boxShadow: SH.ring }}>
            <Search size={16} strokeWidth={1.9} color="var(--c-faint)" />
            <input className="c-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everyone" aria-label="Search people" style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: C.ink, padding: 0 }} />
          </label>
          {!needle && crumbs ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, flexWrap: "wrap" }}>
              {crumbs.map((c, i) => (
                <span key={c.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button type="button" onClick={() => setPath(c.p)} style={{ ...BTN, height: 28, padding: "0 4px", background: "none", fontSize: 12, fontWeight: i === crumbs.length - 1 ? 700 : 600, color: i === crumbs.length - 1 ? C.ink : C.gold }}>{c.l}</button>
                  {i < crumbs.length - 1 ? <ChevronRight size={12} strokeWidth={2} color="var(--c-chev)" /> : null}
                </span>
              ))}
            </div>
          ) : null}
          {!needle && dep ? (
            <button type="button" role="checkbox" aria-checked={allOn} onClick={() => set({ attendees: allOn ? value.filter((v) => !dep.people.some((p) => p.key === v)) : [...new Set([...value, ...dep.people.map((p) => p.key)])] })}
              style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 12px", borderRadius: 12, background: allOn ? C.rowOn : C.card, boxShadow: SH.ring, textAlign: "left", color: C.ink }}>
              <CheckBox on={allOn} /><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>Whole {dep.name} department · {dep.people.length}</span>
            </button>
          ) : null}
          <div style={RINGCARD}>
            {rows.length ? rows : <div style={{ padding: 14, fontSize: 12.5, color: C.muted }}>{needle ? "Nobody matches." : "No one in the staff list yet."}</div>}
          </div>
          <div style={{ ...box, padding: 12 }}>
            <div style={LABEL}>Outside guests</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>They get the invitation, any change, the reminder and the meeting link by email.</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input type="email" className="c-input" value={gq} onChange={(e) => { setGq(e.target.value); setGErr(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGuest(); } }}
                placeholder="name@company.com" aria-label="Guest email" aria-invalid={!!gErr}
                style={{ flex: 1, minWidth: 0, height: 42, boxSizing: "border-box", padding: "0 12px", borderRadius: 10, border: "none", background: C.paper, boxShadow: gErr ? "0 0 0 1.5px var(--c-red)" : SH.ring, fontFamily: "inherit", fontSize: 16, color: C.ink, outline: "none" }} />
              <button type="button" onClick={addGuest} disabled={!gq.trim()} style={{ ...BTN, height: 42, padding: "0 14px", borderRadius: 10, background: "#6B5C32", color: "#FFFFFF", fontSize: 13, fontWeight: 700, opacity: gq.trim() ? 1 : 0.55 }}>Add</button>
            </div>
            {gErr ? <div role="alert" style={{ marginTop: 5, fontSize: 11.5, color: C.red }}>{gErr}</div> : null}
          </div>
        </div>
      </Column>
    </div>
  );
}

// ---- find a time (&sub=find) --------------------------------------------------------------------------------
export function FindTime({ st, rooms, people, now, tick, onPick, onBack }: {
  st: EditorState; rooms: Room[]; people: Map<string, Person>; now: number; tick: number; onPick: (p: Partial<Draft>) => void; onBack: () => void;
}) {
  const d = st.d;
  const base = Math.max(startOfDay(d.start), startOfDay(now));
  const [from, setFrom] = useState(isoDay(base));
  const [to, setTo] = useState(isoPlus(base, 6));
  const [len, setLen] = useState(() => {
    const l = Math.round((d.end - d.start) / 60000);
    return FIND_LENGTHS.includes(l) ? l : 60;
  });
  const [open, setOpen] = useState<number | null>(null);
  const fromT = withTime(from, "00:00");
  const toT = withTime(to < from ? from : to, "00:00");
  const data = useMeetingsBetween(fromT, addDays(toT, 1), tick);
  const result = useMemo(() => findSlots(d, rooms, data.meetings, now, from, to < from ? from : to, len), [d, rooms, data.meetings, now, from, to, len]);
  const who = [d.organizer, ...d.attendees.filter((a) => a !== d.organizer)];
  const name = (k: string) => people.get(k)?.name ?? k;
  const L = len * 60000;
  const dateIn = { width: "100%", height: 42, boxSizing: "border-box", padding: "0 10px", borderRadius: 10, border: "none", background: C.card, boxShadow: SH.ring, fontFamily: "inherit", fontSize: 15, color: C.ink, colorScheme: "light dark" } as const;
  return (
    <div style={{ minHeight: "100%", background: C.paper }}>
      <PageBar title="Find a time" onBack={onBack} backLabel="Back to booking" />
      <Column>
        <div style={{ padding: "12px 16px 40px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <label style={{ display: "block" }}><span style={{ display: "block", marginBottom: 4, ...SMALL_LABEL }}>FROM</span><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} style={dateIn} /></label>
            <label style={{ display: "block" }}><span style={{ display: "block", marginBottom: 4, ...SMALL_LABEL }}>TO</span><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} style={dateIn} /></label>
          </div>
          <div>
            <div style={{ marginBottom: 6, ...SMALL_LABEL }}>HOW LONG</div>
            <div className="mt-x" style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {FIND_LENGTHS.map((n) => <button key={n} type="button" aria-pressed={len === n} onClick={() => setLen(n)} style={{ ...BTN, ...chipCss(len === n), flex: "none", height: 34, padding: "0 12px", borderRadius: 999, fontSize: 12.5, whiteSpace: "nowrap" }}>{durL(n)}</button>)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.body }}>
            <Users size={14} strokeWidth={2} color="var(--c-gold-mid)" />
            <span>Checking {peopleCount(who.length)}{d.roomId === null ? "" : ` and rooms with ${who.length}+ seats`} · times when everyone is free</span>
          </div>
          {data.error ? <div role="alert" style={{ padding: "9px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5 }}>Couldn't check who is free: {data.error}</div> : null}
          {data.loading ? <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.faint }}><Spinner />Checking calendars…</div> : result.map(({ day, slots }) => {
            const shown = open === day ? slots : spacedSlots(slots);
            return (
              <div key={day} style={{ display: "grid", gap: 8 }}>
                <DayLine label={dLab(day).toUpperCase()} style={{ padding: "6px 4px 0" }} />
                {slots.length === 0 ? <div style={{ padding: "4px 4px", fontSize: 12, color: C.faint }}>No time where everyone and a room are free.</div> : null}
                {shown.map((s) => (
                  <div key={s.t} style={{ borderRadius: 16, background: C.card, boxShadow: "0 0 0 1.5px var(--c-green-ring)", padding: "11px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, ...NUM }}>{hm(s.t)} – {hm(s.t + L)}</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: C.greenBg, color: C.green, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>All {who.length} free</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8 }}>
                      {who.slice(0, 7).map((k) => (
                        <span key={k} title={`${name(k)} — free`} style={{ position: "relative" }}>
                          <Avatar name={name(k)} size={26} font={9.5} />
                          <span style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: "50%", background: C.green, boxShadow: "0 0 0 1.5px var(--c-card)" }} />
                        </span>
                      ))}
                      {who.length > 7 ? <span style={{ marginLeft: 4, fontSize: 11, color: C.muted }}>+{who.length - 7}</span> : null}
                    </div>
                    <div style={{ marginTop: 10, ...SMALL_LABEL, fontSize: 10.5 }}>PICK A ROOM</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {s.rooms.slice(0, 4).map((r) => (
                        <button key={r.id} type="button" onClick={() => onPick({ start: s.t, end: s.t + L, roomId: r.id })}
                          style={{ ...BTN, height: 34, padding: "0 11px", borderRadius: 999, background: C.card, boxShadow: `inset 0 0 0 1.5px ${r.color}`, color: C.ink, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: r.color }} />{r.name}<span style={{ fontWeight: 500, color: C.faint }}>{r.seats}</span>
                        </button>
                      ))}
                      <button type="button" onClick={() => onPick({ start: s.t, end: s.t + L, ...onlinePatch(d) })}
                        style={{ ...BTN, height: 34, padding: "0 11px", borderRadius: 999, background: C.track, color: C.body, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
                        <Video size={12} strokeWidth={2} />Online
                      </button>
                    </div>
                  </div>
                ))}
                {slots.length > shown.length ? (
                  <button type="button" onClick={() => setOpen(day)} style={{ ...BTN, justifySelf: "start", height: 30, padding: "0 4px", background: "none", color: C.gold, fontSize: 12, fontWeight: 700 }}>{slots.length - shown.length} more times</button>
                ) : null}
              </div>
            );
          })}
        </div>
      </Column>
    </div>
  );
}

/** Editor shell when the screen holds no draft yet (opened from a link). */
export function NoDraft({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ minHeight: "100%", background: C.paper }}>
      <PageBar title="Meeting" onBack={onBack} backLabel="Back" />
      <div style={{ padding: "48px 16px", display: "flex", justifyContent: "center" }}><Spinner /></div>
    </div>
  );
}
