// Meetings v3 — the bottom sheets: Quick booking, Calendar options, Go to a date,
// More sections, Add a colleague's calendar, Create a guest link, Can't book.
// All on the kit's CommsSheet (the shared Sheet).
import { useMemo, useState } from "react";
import { Armchair, ChevronRight, DoorClosed, DoorOpen, Globe, History, Link as LinkIcon, Mail, Scale, ShieldCheck, UserPlus, UserX, Users, Video, X, Check, type LucideIcon } from "lucide-react";
import { BTN, C, CommsSheet, NUM, SH, Spinner, ErrorBox } from "../comms-kit";
import { addDays, isoDay, startOfDay, type ConflictReply, type Draft, type Person, type Room } from "@/lib/meetings";
import { busyRooms, conflictLines, dLab, hm, peopleLine, repeatOptions, roomStates, type ColorBy } from "./meet-lib";
import { Avatar, CheckBox, INPUT, LABEL, RINGCARD, RadioDot, SMALL_LABEL, Seg, SwitchRow, chipCss, rowTop, toneOf } from "./meet-ui";
import { DatePickerGrid } from "./CalendarPane";
import { SelectBox, onlinePatch, type EditorState } from "./MeetingEditor";
import { useMeetingsBetween } from "./meet-data";

const FOOT = { padding: "14px 16px calc(16px + env(safe-area-inset-bottom))" } as const;

// ---- quick booking --------------------------------------------------------------------------------------
export function QuickBookSheet({ st, set, setOnline, rooms, people, tick, saving, onClose, onMore, onPeople, onSave }: {
  st: EditorState | null; set: (p: Partial<Draft>) => void; setOnline: (on: boolean) => void; rooms: Room[]; people: Map<string, Person>; tick: number; saving: boolean;
  onClose: () => void; onMore: () => void; onPeople: () => void; onSave: () => void;
}) {
  const d = st?.d ?? null;
  const day = d ? startOfDay(d.start) : null;
  const data = useMeetingsBetween(day, day !== null ? addDays(day, 1) : null, tick);
  const busy = useMemo(() => (d ? busyRooms(data.meetings, d) : new Set<number>()), [data.meetings, d]);
  if (!st || !d) return <CommsSheet open={false} onClose={onClose} title="Quick booking"><span /></CommsSheet>;
  const states = roomStates(rooms, d, busy);
  const names = d.attendees.filter((a) => a !== d.organizer).map((k) => people.get(k)?.name ?? k);
  return (
    <CommsSheet open onClose={onClose} title="Quick booking"
      footer={
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 8, ...FOOT }}>
          <button type="button" onClick={onMore} style={{ ...BTN, height: 48, borderRadius: 14, background: C.card, color: C.gold, fontSize: 13.5, fontWeight: 700, boxShadow: SH.secondary }}>More options</button>
          <button type="button" onClick={onSave} disabled={saving} aria-busy={saving || undefined} style={{ ...BTN, height: 48, borderRadius: 14, background: C.grad, color: "#FFFFFF", fontSize: 14.5, fontWeight: 700, boxShadow: SH.cta, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: saving ? 0.7 : 1 }}>
            {saving ? <Spinner size={13} color="#FFFFFF" /> : null}Save
          </button>
        </div>
      }>
      <div style={{ padding: "4px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
        <input className="c-input" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Add a title" aria-label="Title" maxLength={200} style={{ ...INPUT, height: 46, fontWeight: 600 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 12, background: C.card, boxShadow: SH.panel }}>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, ...NUM }}>{dLab(d.start)} · {hm(d.start)} – {hm(d.end)}</span>
        </div>
        <Seg label="Meeting type" role="radiogroup" value={st.online ? "online" : "person"}
          onChange={(k) => {
            if (k === "online") { setOnline(true); set(onlinePatch(d)); }
            else { setOnline(false); set({ roomId: d.roomId ?? states.find((s) => s.best)?.room.id ?? null }); }
          }}
          items={[{ key: "person", label: <><DoorOpen size={14} strokeWidth={2} />In person</> }, { key: "online", label: <><Video size={14} strokeWidth={2} />Online</> }]} />
        {!st.online ? (
          <div>
            <div style={{ marginBottom: 6, ...SMALL_LABEL }}>ROOM</div>
            {states.length === 0 ? <div style={{ fontSize: 12.5, color: C.muted }}>No rooms yet. Choose Online.</div> : (
              <div role="radiogroup" aria-label="Room" className="mt-x" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                {states.map((s) => {
                  const on = d.roomId === s.room.id;
                  return (
                    <button key={s.room.id} type="button" role="radio" aria-checked={on} disabled={s.disabled} onClick={() => set({ roomId: s.room.id })}
                      style={{ ...BTN, flex: "none", minWidth: 116, padding: "8px 10px", borderRadius: 12, background: C.card, boxShadow: on ? "0 0 0 1.5px var(--c-gold), 0 6px 14px -8px rgba(107,92,50,.5)" : SH.ring, textAlign: "left", cursor: s.disabled ? "default" : "pointer", opacity: s.disabled ? 0.5 : 1, color: C.ink }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: s.room.color }} /><span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{s.room.name}</span></span>
                      <span style={{ display: "block", fontSize: 10.5, color: toneOf(s.tone).fg, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap" }}>{s.tag} · {s.room.seats} seats</span>
                    </button>
                  );
                })}
              </div>
            )}
            {data.error ? <div style={{ marginTop: 6, fontSize: 11.5, color: C.red }}>Couldn't check which rooms are free: {data.error}</div> : null}
          </div>
        ) : <div style={{ fontSize: 12, color: C.muted }}>No room. Only you and the people you add can see this meeting.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: 8 }}>
          <SelectBox label="Repeat" value={d.repeat} onChange={(v) => set({ repeat: v as Draft["repeat"], repeatUntil: d.repeatUntil ?? isoDay(addDays(d.start, 56)) })} options={repeatOptions(d.start)} />
          <input type="date" aria-label="Repeat until" value={d.repeat === "none" ? "" : d.repeatUntil ?? ""} min={isoDay(d.start)} disabled={d.repeat === "none"} onChange={(e) => set({ repeatUntil: e.target.value || null })}
            style={{ minWidth: 0, height: 46, boxSizing: "border-box", padding: "0 8px", borderRadius: 12, border: "none", background: C.card, boxShadow: SH.ring, fontFamily: "inherit", fontSize: 14, color: C.ink, opacity: d.repeat === "none" ? 0.5 : 1, colorScheme: "light dark" }} />
        </div>
        <button type="button" onClick={onPeople} style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 12px", borderRadius: 12, background: C.card, boxShadow: SH.ring, textAlign: "left", color: C.ink }}>
          <Users size={16} strokeWidth={2} color="var(--c-gold-mid)" />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {names.length || d.guestEmails.length ? `${peopleLine(d)} · ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}` : "Add people"}
          </span>
          <ChevronRight size={16} strokeWidth={2} color="var(--c-chev)" />
        </button>
      </div>
    </CommsSheet>
  );
}

// ---- calendar options --------------------------------------------------------------------------------------
export function OptionsSheet({ open, onClose, colorBy, onColorBy, legend, onlyMine, onOnlyMine, rooms, roomFilter, onRoomFilter, overlay, people, onRemoveOverlay, onAddColleague, onGuestLink }: {
  open: boolean; onClose: () => void; colorBy: ColorBy; onColorBy: (c: ColorBy) => void; legend: { l: string; c: string }[];
  onlyMine: boolean; onOnlyMine: (v: boolean) => void; rooms: Room[]; roomFilter: Record<number, boolean>; onRoomFilter: (f: Record<number, boolean>) => void;
  overlay: string[]; people: Map<string, Person>; onRemoveOverlay: (k: string) => void; onAddColleague: () => void; onGuestLink: () => void;
}) {
  const active = rooms.filter((r) => r.active);
  const anyHidden = active.some((r) => roomFilter[r.id] === false);
  return (
    <CommsSheet open={open} onClose={onClose} title="Calendar options">
      <div style={{ padding: "4px 16px calc(24px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Colour meetings by</div>
          <Seg label="Colour meetings by" role="radiogroup" value={colorBy} onChange={onColorBy} items={[{ key: "room", label: "Room" }, { key: "company", label: "Company" }, { key: "me", label: "Me" }]} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 8 }}>
            {legend.map((g) => <span key={g.l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.body }}><span style={{ width: 9, height: 9, borderRadius: 3, background: g.c }} />{g.l}</span>)}
          </div>
        </div>
        <SwitchRow on={onlyMine} title="Only my meetings" sub="Plus calendars you've added below" onToggle={() => onOnlyMine(!onlyMine)} />
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Rooms</span>
            <button type="button" onClick={() => onRoomFilter({})} disabled={!anyHidden} style={{ ...BTN, height: 28, padding: "0 4px", background: "none", color: C.gold, fontSize: 12, fontWeight: 700, opacity: anyHidden ? 1 : 0.7 }}>{anyHidden ? "Show all rooms" : "All rooms shown"}</button>
          </div>
          <div style={RINGCARD}>
            {active.length === 0 ? <div style={{ padding: 14, fontSize: 12.5, color: C.muted }}>No rooms yet.</div> : null}
            {active.map((r, i) => {
              const on = roomFilter[r.id] !== false;
              return (
                <button key={r.id} type="button" role="checkbox" aria-checked={on} onClick={() => onRoomFilter({ ...roomFilter, [r.id]: !on })}
                  style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 12px", borderTop: rowTop(i), background: "none", textAlign: "left", color: C.ink }}>
                  <CheckBox on={on} />
                  <span style={{ width: 9, height: 9, flex: "none", borderRadius: 3, background: r.color }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11.5, color: C.muted, ...NUM }}><Armchair size={12} strokeWidth={2} />{r.seats}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Colleagues' calendars</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {overlay.map((k) => {
              const n = people.get(k)?.name ?? k;
              return (
                <button key={k} type="button" aria-label={`Remove ${n}`} onClick={() => onRemoveOverlay(k)} style={{ ...BTN, height: 32, padding: "0 9px 0 4px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <Avatar name={n} size={24} font={9.5} />{n}<X size={12} strokeWidth={2.4} />
                </button>
              );
            })}
            <button type="button" onClick={onAddColleague} style={{ ...BTN, height: 32, padding: "0 12px", borderRadius: 999, background: C.card, boxShadow: SH.secondary, color: C.gold, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
              <UserPlus size={13} strokeWidth={2.2} />Add a colleague's calendar
            </button>
          </div>
        </div>
        <button type="button" onClick={onGuestLink} style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "0 14px", borderRadius: 14, background: C.card, boxShadow: SH.ring, textAlign: "left", color: C.ink }}>
          <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: C.tealBg, display: "flex", alignItems: "center", justifyContent: "center" }}><LinkIcon size={15} strokeWidth={2} color="var(--c-teal)" /></span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>Make a guest booking link</span>
          <ChevronRight size={16} strokeWidth={2} color="var(--c-chev)" />
        </button>
      </div>
    </CommsSheet>
  );
}

export function DateSheet({ open, onClose, selected, now, onPick }: { open: boolean; onClose: () => void; selected: number; now: number; onPick: (t: number) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date(selected).getFullYear(), new Date(selected).getMonth(), 1).getTime());
  return (
    <CommsSheet open={open} onClose={onClose} title="Go to a date">
      <DatePickerGrid month={month} selected={selected} now={now} onMonth={setMonth} onPick={onPick} />
    </CommsSheet>
  );
}

export type MoreItem = { key: string; label: string; sub: string; icon: LucideIcon; fg: string; bg: string; tag?: string; on: boolean };
export function MoreSheet({ open, onClose, items, onPick }: { open: boolean; onClose: () => void; items: MoreItem[]; onPick: (k: string) => void }) {
  return (
    <CommsSheet open={open} onClose={onClose} title="More">
      <div style={{ display: "grid", gap: 8, padding: "4px 16px calc(24px + env(safe-area-inset-bottom))" }}>
        {items.map((o) => {
          const Icon = o.icon;
          return (
            <button key={o.key} type="button" onClick={() => onPick(o.key)} aria-current={o.on || undefined}
              style={{ ...BTN, display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "8px 14px", borderRadius: 14, background: C.card, boxShadow: o.on ? "0 0 0 1.5px var(--c-gold)" : SH.ring, textAlign: "left", color: C.ink }}>
              <span style={{ width: 36, height: 36, flex: "none", borderRadius: 10, background: o.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={17} strokeWidth={2} color={o.fg} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{o.label}</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{o.sub}</span>
              </span>
              {o.tag ? <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 7px", borderRadius: 999, background: C.track, color: C.muted, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{o.tag}</span> : null}
              <ChevronRight size={16} strokeWidth={2} color="var(--c-chev)" />
            </button>
          );
        })}
      </div>
    </CommsSheet>
  );
}
// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const MORE_ICONS = { links: LinkIcon, email: Mail, log: History };

export function ColleagueSheet({ open, onClose, people, me, overlay, onAdd }: { open: boolean; onClose: () => void; people: Person[]; me: string; overlay: string[]; onAdd: (k: string) => void }) {
  const [q, setQ] = useState("");
  const n = q.trim().toLowerCase();
  const list = people.filter((p) => p.key !== me && (!n || `${p.name} ${p.company} ${p.department}`.toLowerCase().includes(n))).slice(0, 60);
  return (
    <CommsSheet open={open} onClose={onClose} title="Add a colleague's calendar" sub="Their meetings show alongside yours">
      <div style={{ padding: "4px 16px 0" }}>
        <input className="c-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colleagues" aria-label="Search colleagues" style={INPUT} />
      </div>
      <div style={{ padding: "10px 16px calc(24px + env(safe-area-inset-bottom))" }}>
        <div style={RINGCARD}>
          {list.length === 0 ? <div style={{ padding: 14, fontSize: 12.5, color: C.muted }}>Nobody matches.</div> : null}
          {list.map((p, i) => {
            const on = overlay.includes(p.key);
            return (
              <button key={p.key} type="button" onClick={() => { if (!on) onAdd(p.key); }} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", borderTop: rowTop(i), background: "none", textAlign: "left", color: C.ink }}>
                <Avatar name={p.name} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>{p.name}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{[p.company, p.department].filter(Boolean).join(" · ")}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: on ? C.green : C.gold }}>{on ? "Added" : "Add"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </CommsSheet>
  );
}

// ---- create a guest link (desktop LinkDialog: presets no room and no length) --------------------------------
export type LinkForm = { name: string; until: string | null; hosts: string[]; audience: "anyone" | "staff" };
export function GuestLinkSheet({ open, onClose, people, now, saving, error, onCreate }: { open: boolean; onClose: () => void; people: Person[]; now: number; saving: boolean; error: string; onCreate: (f: LinkForm) => void }) {
  const [x, setX] = useState<LinkForm>({ name: "", until: null, hosts: [], audience: "anyone" });
  const [q, setQ] = useState("");
  const byKey = new Map(people.map((p) => [p.key, p]));
  const needle = q.trim().toLowerCase();
  const pool = needle ? people.filter((p) => `${p.name} ${p.company} ${p.department}`.toLowerCase().includes(needle)).slice(0, 30) : [];
  const toggle = (k: string) => setX((v) => ({ ...v, hosts: v.hosts.includes(k) ? v.hosts.filter((h) => h !== k) : [...v.hosts, k] }));
  const plus30 = isoDay(addDays(startOfDay(now), 30));
  return (
    <CommsSheet open={open} onClose={onClose} title="Create a guest link" sub="Guests pick the room, the day and the time themselves"
      footer={<div style={FOOT}><button type="button" disabled={saving} onClick={() => onCreate(x)} style={{ ...BTN, width: "100%", height: 50, borderRadius: 14, background: C.grad, color: "#FFFFFF", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: saving ? 0.7 : 1 }}>{saving ? <Spinner size={14} color="#FFFFFF" /> : null}Create link</button></div>}>
      <div style={{ padding: "4px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", marginBottom: 6, ...LABEL }}>Name <span style={{ fontWeight: 500, color: C.faint }}>optional, only staff see it</span></span>
          <input className="c-input" value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} placeholder="e.g. Supplier visits" style={INPUT} />
        </label>
        <div>
          <div style={{ marginBottom: 6, ...LABEL }}>Link works until</div>
          <Seg label="Link works until" role="radiogroup" value={x.until === null ? "none" : "date"} onChange={(k) => setX({ ...x, until: k === "none" ? null : x.until ?? plus30 })} items={[{ key: "none", label: "No end date" }, { key: "date", label: "Until a date" }]} />
          {x.until !== null ? (
            <input type="date" aria-label="Works until" value={x.until} min={isoDay(now)} onChange={(e) => setX({ ...x, until: e.target.value || plus30 })} style={{ ...INPUT, marginTop: 8, fontSize: 15, colorScheme: "light dark" }} />
          ) : <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint }}>Works until you turn it off.</div>}
        </div>
        <div>
          <div style={{ marginBottom: 6, ...LABEL }}>Who can use it</div>
          <div role="radiogroup" aria-label="Who can use it" style={{ display: "grid", gap: 8 }}>
            {([["anyone", "Anyone with the link", "Visitors type their own company", Globe], ["staff", "Our staff only", "Company must be one of ours", ShieldCheck]] as const).map(([k, l, s, Icon]) => {
              const on = x.audience === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setX({ ...x, audience: k })} style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 50, padding: "6px 12px", borderRadius: 12, background: C.card, boxShadow: on ? "0 0 0 1.5px var(--c-gold)" : SH.ring, textAlign: "left", color: C.ink }}>
                  <Icon size={16} strokeWidth={2} color="var(--c-gold)" />
                  <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13.5, fontWeight: on ? 700 : 600 }}>{l}</span><span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 1 }}>{s}</span></span>
                  <RadioDot on={on} />
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={LABEL}>Tell someone about each booking <span style={{ fontWeight: 500, color: C.faint }}>optional</span></span>
            <span style={{ fontSize: 11, color: C.faint }}>{x.hosts.length ? `${x.hosts.length} picked` : "Nobody yet"}</span>
          </div>
          {x.hosts.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {x.hosts.map((k) => (
                <button key={k} type="button" aria-label={`Remove ${byKey.get(k)?.name ?? k}`} onClick={() => toggle(k)} style={{ ...BTN, ...chipCss(true), height: 32, padding: "0 9px 0 11px", borderRadius: 999, fontSize: 12.5, display: "flex", alignItems: "center", gap: 5 }}>
                  <Check size={12} strokeWidth={2.8} />{byKey.get(k)?.name ?? k}<X size={12} strokeWidth={2.4} />
                </button>
              ))}
            </div>
          ) : null}
          <input className="c-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name to add someone" aria-label="Search staff" style={{ ...INPUT, height: 40 }} />
          {needle ? (
            <div style={{ ...RINGCARD, marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
              {pool.length === 0 ? <div style={{ padding: 12, fontSize: 12.5, color: C.muted }}>Nobody matches.</div> : null}
              {pool.map((p, i) => (
                <button key={p.key} type="button" onClick={() => { toggle(p.key); setQ(""); }} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "6px 12px", borderTop: rowTop(i), background: "none", textAlign: "left", color: C.ink }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.hosts.includes(p.key) ? "Remove " : ""}{p.name}</span>
                  <span style={{ flex: "none", fontSize: 11.5, color: C.faint }}>{[p.company, p.department].filter(Boolean).join(" · ")}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 6, fontSize: 11.5, color: C.faint, lineHeight: 1.4 }}>Bookings always show on the calendar. The people added here also get a notice.</div>
        </div>
        {error ? <ErrorBox icon={Scale}>{error}</ErrorBox> : null}
      </div>
    </CommsSheet>
  );
}

// ---- can't book (409) ------------------------------------------------------------------------------------------
export function ConflictSheet({ reply, draft, rooms, people, saving, onClose, onUseRoom, onMove }: {
  reply: ConflictReply | null; draft: Draft | null; rooms: Room[]; people: Map<string, Person>; saving: boolean; onClose: () => void; onUseRoom: (id: number) => void; onMove: (t: number) => void;
}) {
  const open = !!reply && !!draft;
  const lines = reply && draft ? conflictLines(reply, rooms, people, draft.roomId) : [];
  const t = reply?.suggestTime ? Date.parse(reply.suggestTime) : null;
  const len = draft ? draft.end - draft.start : 0;
  const r = draft ? rooms.find((x) => x.id === draft.roomId) : undefined;
  const roomOrRule = !!reply && (!!reply.conflict.room || reply.conflict.rules.length > 0);
  return (
    <CommsSheet open={open} onClose={onClose} title="Can't book this time" sub="Something else is already booked"
      footer={<div style={FOOT}><button type="button" onClick={onClose} style={{ ...BTN, width: "100%", height: 48, borderRadius: 14, background: C.card, color: C.body, fontSize: 14, fontWeight: 700, boxShadow: SH.ring }}>Back to editing</button></div>}>
      {reply && draft ? (
        <div style={{ padding: "4px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ borderRadius: 14, padding: 12, background: C.redBg, boxShadow: "0 0 0 1px var(--c-red-ring)" }}>
            {lines.map((w, i) => {
              const Icon = w.kind === "person" ? UserX : w.kind === "room" ? DoorClosed : Scale;
              return <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0", fontSize: 12.5, lineHeight: 1.45, color: C.red }}><Icon size={14} strokeWidth={2.2} style={{ flex: "none", marginTop: 2 }} /><span>{w.text}</span></div>;
            })}
          </div>
          {roomOrRule ? (
            reply.suggestRooms.length ? (
              <div>
                <div style={{ ...SMALL_LABEL, letterSpacing: 0.6, marginBottom: 6 }}>FREE AT THE SAME TIME</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {reply.suggestRooms.map((a, i) => (
                    <button key={a.id} type="button" disabled={saving} onClick={() => onUseRoom(a.id)} style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 12px", borderRadius: 12, background: C.card, boxShadow: i === 0 ? "0 0 0 1.5px var(--c-gold)" : SH.ring, textAlign: "left", color: C.ink }}>
                      <span style={{ width: 9, height: 9, flex: "none", borderRadius: 3, background: rooms.find((x) => x.id === a.id)?.color ?? "#8A8F98" }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700 }}>{a.name}{i === 0 ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: C.green }}>Best fit</span> : null}</span>
                      <span style={{ fontSize: 11.5, color: C.muted }}>{a.seats} seats</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>Use</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : <div style={{ fontSize: 12.5, color: C.muted }}>No other room with enough seats is free then.</div>
          ) : null}
          {t !== null && Number.isFinite(t) ? (
            <div>
              <div style={{ ...SMALL_LABEL, letterSpacing: 0.6, marginBottom: 6 }}>{reply.conflict.people.length ? "EVERYONE IS FREE FROM" : `OTHER TIME${r ? ` IN ${r.name.toUpperCase()}` : ""}`}</div>
              <button type="button" disabled={saving} onClick={() => onMove(t)} style={{ ...BTN, height: 36, padding: "0 12px", borderRadius: 999, background: C.card, boxShadow: "inset 0 0 0 1.5px var(--c-gold)", color: C.ink, fontSize: 12.5, fontWeight: 700, ...NUM }}>
                Move to {dLab(t)} · {hm(t)} – {hm(t + len)}
              </button>
            </div>
          ) : <div style={{ fontSize: 12.5, color: C.muted }}>No common free time left that day. Pick another day.</div>}
          {reply.conflict.people.length ? <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.45 }}>To go ahead without someone, remove them yourself in the People list. The system never drops anyone for you.</div> : null}
        </div>
      ) : null}
    </CommsSheet>
  );
}
