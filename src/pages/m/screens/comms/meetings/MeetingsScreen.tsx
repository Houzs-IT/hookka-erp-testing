// ---------------------------------------------------------------------------
// /m/meetings — Meetings v3 (Batch 2, approved Claude Design prototype
// "Meetings v2", 2026-11-26). Phone, tablet and foldable; light and dark.
// Replaces the embedded desktop page (src/pages/m/meetings-route.tsx).
//
// Everything is read from and written to /api/meetings/* (routes/meetings.ts
// relays the Houzs IT Hub). The hub decides every rule (busy people, a taken
// room, the room's gap, closed dates, longest booking); a 409 opens the
// "Can't book" sheet built from its reply, as on desktop.
//
// Views by query string (desktop's own names where it has them):
//   ?tab=calendar|mine|rooms|links|email|log   &view=day|week|month|rooms|list   &date=YYYY-MM-DD
//   ?m=ID            one meeting (beside the list on a tablet)
//   ?edit=new|ID     the booking editor;  &sub=people | &sub=find  its two sub-pages
//   ?room=new|ID     add / edit a room (room managers)
// Room managers = bootstrap.canManage (meeting-rooms:update, decided by the API).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bell, CalendarDays, CalendarX, CloudOff, DoorClosed, DoorOpen, Ellipsis, Loader, Repeat, Search, Square, User, X, type LucideIcon } from "lucide-react";
import { refreshMeetingsUnread, useMeetingsUnread } from "@/lib/meetings-unread";
import {
  addDays, bestRoom, draftBody, draftFrom, emptyDraft, fromIsoDay, isoDay, ms, nextStart, readConflict, startOfDay,
  type Bootstrap, type Draft, type GuestLink, type Meeting, type Notice, type Room,
} from "@/lib/meetings";
import { useResponsiveLayout } from "../../../lib/responsive-layout";
import { BTN, C, Column, CommsHeader, CommsScreen, CommsSplit, NUM, PrimaryButton, RoundPlus, SH, StateCard, useToast } from "../comms-kit";
import {
  busyRooms, colourOf, dLab, hm, isCalView, isIsoDay, isSection, legendOf, linkExpired, mondayOf, optionsCount, readColorBy, rangeFor, roomBody, roomFormOf,
  searchAll, sectionAllowed, stepAnchor, tintOf, visibleMeetings, type CalView, type ColorBy, type DetailAct, type RoomFormValue, type Section,
} from "./meet-lib";
import { RINGCARD, Seg, rowTop } from "./meet-ui";
import { api, copyText, errText, openLoadedTab, useGet, useMeetingsBetween, useMinuteTick } from "./meet-data";
import { CalendarPane } from "./CalendarPane";
import { EmailPane, LinksPane, LogPane, MinePane, RoomsPane } from "./MeetingsSections";
import { MeetingDetail, type MeetingFile } from "./MeetingDetail";
import { FindTime, MeetingEditor, NoDraft, PeoplePicker, onlinePatch, type EditorState } from "./MeetingEditor";
import { RoomForm } from "./RoomForm";
import { ColleagueSheet, ConflictSheet, DateSheet, GuestLinkSheet, MORE_ICONS, MoreSheet, OptionsSheet, QuickBookSheet, type LinkForm, type MoreItem } from "./MeetSheets";
import { MeetDialog, type DialogSpec } from "./meetings-overlay";

const COLOR_KEY = "meetings.colorBy";
type SheetKind = "qb" | "opts" | "date" | "more" | "pick" | "gl" | null;
type Mine = { meetings: Meeting[]; notifications: Notice[] };

export default function MeetingsScreen() {
  const [params, setParams] = useSearchParams();
  const layout = useResponsiveLayout();
  const [tick, reload, now] = useMinuteTick();
  const [toastNode, toast] = useToast();
  const unread = useMeetingsUnread();

  // ---- where we are ---------------------------------------------------------------------------
  const tabParam = params.get("tab");
  const viewParam = params.get("view");
  const dateParam = params.get("date");
  const view: CalView = isCalView(viewParam) ? viewParam : "day";
  const anchor = isIsoDay(dateParam) ? fromIsoDay(dateParam) : startOfDay(now);
  const mParam = params.get("m");
  const mId = mParam && /^\d{1,12}$/.test(mParam) ? Number(mParam) : null;
  const edit = params.get("edit");
  const sub = params.get("sub");
  const roomParam = params.get("room");
  const go = useCallback((patch: Record<string, string | null>, replace = false) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) n.delete(k);
        else n.set(k, v);
      }
      return n;
    }, { replace });
  }, [setParams]);

  // ---- who and what --------------------------------------------------------------------------------
  const bootR = useGet<Bootstrap>("/api/meetings/bootstrap", tick);
  const boot = bootR.data;
  const me = boot?.me ?? "";
  const canManage = !!boot?.canManage;
  const rooms: Room[] = useMemo(() => boot?.rooms ?? [], [boot]);
  const peopleList = useMemo(() => boot?.people ?? [], [boot]);
  const people = useMemo(() => new Map(peopleList.map((p) => [p.key, p])), [peopleList]);
  const companies = useMemo(() => [...new Set(peopleList.map((p) => p.company).filter(Boolean))].sort(), [peopleList]);
  const sec: Section = isSection(tabParam) && sectionAllowed(tabParam, canManage) ? tabParam : "calendar";

  // ---- calendar options (desktop sidebar) --------------------------------------------------------------
  const [colorBy, setColorBy] = useState<ColorBy>(() => { try { return readColorBy(localStorage.getItem(COLOR_KEY)); } catch { return "room"; } });
  useEffect(() => { try { localStorage.setItem(COLOR_KEY, colorBy); } catch { /* a private window keeps the default */ } }, [colorBy]);
  const [roomFilter, setRoomFilter] = useState<Record<number, boolean>>({});
  const [onlyMine, setOnlyMine] = useState(false);
  const [overlay, setOverlay] = useState<string[]>([]);
  const [searchOn, setSearchOn] = useState(false);
  const [q, setQ] = useState("");
  const searching = searchOn && !!q.trim();

  const [from, to] = rangeFor(view, anchor, searching);
  const calOn = !!boot && (sec === "calendar" || searching);
  const cal = useMeetingsBetween(calOn ? from : null, calOn ? to : null, tick);
  const colourFn = useCallback((m: Meeting) => colourOf(m, colorBy, me, rooms, people, companies), [colorBy, me, rooms, people, companies]);
  const shown = useMemo(() => visibleMeetings(cal.meetings, { roomFilter, onlyMine, overlay, me }), [cal.meetings, roomFilter, onlyMine, overlay, me]);
  const legend = legendOf(colorBy, rooms, companies, roomFilter);

  // ---- other sections -------------------------------------------------------------------------------------
  const [mineSub, setMineSub] = useState<"up" | "notif">("up");
  const mine = useGet<Mine>(boot && sec === "mine" ? "/api/meetings/mine" : null, tick);
  const marked = useRef(false);
  useEffect(() => {
    // Desktop: opening the notices marks every one read, then the menu badge refreshes.
    if (sec !== "mine" || mineSub !== "notif") { marked.current = false; return; }
    if (!mine.data || marked.current) return;
    if (!mine.data.notifications.some((n) => !n.read)) return;
    marked.current = true;
    api.post("/api/meetings/notifications/read").then(refreshMeetingsUnread).catch(() => { marked.current = false; });
  }, [sec, mineSub, mine.data]);
  const links = useGet<{ links: GuestLink[] }>(boot && sec === "links" ? "/api/meetings/links" : null, tick);
  const log = useGet<{ log: { at: string; who: string; text: string }[] }>(boot && sec === "log" && canManage ? "/api/meetings/log" : null, tick);
  const weekStart = mondayOf(now);
  const roomsWeek = useMeetingsBetween(boot && (sec === "rooms" || roomParam) ? weekStart : null, boot && (sec === "rooms" || roomParam) ? addDays(weekStart, 7) : null, tick);

  // ---- sheets, editor, dialogs -----------------------------------------------------------------------------
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ReturnType<typeof readConflict>>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [linkErr, setLinkErr] = useState("");
  const [linkBusy, setLinkBusy] = useState<number | null>(null);
  const [roomErr, setRoomErr] = useState("");
  const setD = useCallback((p: Partial<Draft>) => setEditor((e) => (e ? { ...e, d: { ...e.d, ...p } } : e)), []);
  const setOnline = useCallback((on: boolean) => setEditor((e) => (e ? { ...e, online: on } : e)), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const newState = (start?: number, roomId?: number | null): EditorState => {
    const s = start ?? nextStart(Date.now(), anchor);
    const e = s + 3_600_000;
    const rid = roomId !== undefined ? roomId : bestRoom(rooms, 1, busyRooms(cal.meetings, { id: null, start: s, end: e }))?.id ?? null;
    return { d: emptyDraft(me, s, e, rid), isNew: true, scope: "one", online: false };
  };
  const quick = (start?: number, roomId?: number | null) => {
    if (!boot) return;
    setEditor(newState(start, roomId));
    setFiles([]);
    setConflict(null);
    setSheet("qb");
  };
  // Opened from a link with no draft held: a new one starts; an edit goes back to its meeting.
  useEffect(() => {
    if (!edit || editor || !boot) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a deep link (?edit=new) opens the editor once
    if (edit === "new") setEditor(newState());
    else go({ edit: null, sub: null, m: /^\d+$/.test(edit) ? edit : null }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the address asks for an editor
  }, [edit, editor, boot]);

  const uploadFiles = async (id: number) => {
    if (!files.length) return;
    const form = new FormData();
    for (const f of files) form.append("files", f, f.name);
    await api.postForm(`/api/meetings/meetings/${id}/files`, form);
  };

  /** Save a new or changed meeting (desktop save); a 409 opens Can't book. */
  const save = async (override?: Partial<Draft>) => {
    if (!editor) return;
    const st = { ...editor, d: { ...editor.d, ...override } };
    if (override) setEditor(st);
    setSaving(true);
    try {
      if (st.isNew) {
        const r = await api.post<{ ids: number[]; created: number; skipped: number }>("/api/meetings/meetings", draftBody(st.d));
        let note = "";
        if (r.ids?.[0]) await uploadFiles(r.ids[0]).catch((e) => { note = `Booked, but the files did not upload: ${errText(e)}`; });
        if (r.skipped) {
          setDialog({ title: `${r.created} of ${r.created + r.skipped} meetings booked`, icon: Repeat, tone: "warn", body: `${r.skipped} ${r.skipped === 1 ? "date was" : "dates were"} skipped because a room or person was busy. Book them separately in another room or time.${note ? `\n\n${note}` : ""}`, buttons: [{ label: "OK", kind: "primary", onTap: closeDialog }] });
        } else toast(note || (r.created > 1 ? `Booked ${r.created} meetings` : `Booked ${st.d.title.trim() || "(No title)"}`));
        go({ edit: null, sub: null, m: null, tab: null, date: isoDay(st.d.start) });
      } else {
        const r = await api.patch<{ changed: number; skipped: number }>(`/api/meetings/meetings/${st.d.id}`, { ...draftBody(st.d), scope: st.scope });
        let note = "";
        if (st.d.id) await uploadFiles(st.d.id).catch((e) => { note = `Saved, but the files did not upload: ${errText(e)}`; });
        toast(note || (r.skipped ? `Saved ${r.changed}; ${r.skipped} later meetings kept their time because someone was busy` : `Saved ${st.d.title.trim() || "(No title)"}`));
        go({ edit: null, sub: null, m: String(st.d.id) });
      }
      setEditor(null);
      setFiles([]);
      setSheet(null);
      setConflict(null);
      reload();
    } catch (e) {
      const c = readConflict(e);
      if (c) setConflict(c);
      else toast(errText(e));
    } finally {
      setSaving(false);
    }
  };

  // ---- meeting actions (desktop act) -----------------------------------------------------------------------
  const run = async (fn: () => Promise<void>) => {
    setDialogBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errText(e));
    } finally {
      setDialogBusy(false);
      setDialog(null);
    }
  };
  const askScope = (m: Meeting, verb: "Change" | "Cancel", then: (scope: "one" | "following") => void) => {
    if (!m.seriesId) { then("one"); return; }
    setDialog({
      title: "This is a repeating meeting", icon: Repeat, tone: "gold",
      body: `${verb} only ${dLab(ms(m.start))}, or this and every meeting after it?`,
      buttons: [
        { label: "This meeting", kind: "primary", onTap: () => then("one") },
        { label: "This and following", kind: "secondary", onTap: () => then("following") },
        { label: "Back", kind: "ghost", onTap: closeDialog },
      ],
    });
  };
  const onAct = (m: Meeting, a: DetailAct) => {
    if (a === "start") {
      void run(async () => { await api.post(`/api/meetings/meetings/${m.id}/start`, {}); toast(`Started ${m.title}`); reload(); });
      return;
    }
    if (a === "end") {
      setDialog({
        title: "End this meeting now?", icon: Square, tone: "danger", body: `The room is free for others to book from ${hm(Date.now())}.`,
        buttons: [
          { label: "End meeting", kind: "danger", onTap: () => run(async () => { await api.post(`/api/meetings/meetings/${m.id}/end`, {}); toast(`Ended ${m.title}. The room is free from now.`); reload(); }) },
          { label: "Keep going", kind: "ghost", onTap: closeDialog },
        ],
      });
      return;
    }
    if (a === "edit") {
      askScope(m, "Change", (scope) => {
        setDialog(null);
        setEditor({ d: draftFrom(m), isNew: false, scope, online: m.roomId === null });
        setFiles([]);
        setConflict(null);
        go({ edit: String(m.id), m: null, sub: null });
      });
      return;
    }
    askScope(m, "Cancel", (scope) => {
      const guests = (m.guestEmails ?? []).length;
      setDialog({
        title: scope === "following" ? "Cancel this and all following meetings?" : "Cancel this meeting?", icon: CalendarX, tone: "danger",
        body: `Everyone in it is told${guests ? ", outside guests by email too" : ""}.`,
        buttons: [
          { label: "Cancel meeting", kind: "danger", onTap: () => run(async () => { await api.post(`/api/meetings/meetings/${m.id}/cancel`, { scope }); toast(`Cancelled ${m.title}. Everyone in it was told.`); go({ m: null }); reload(); }) },
          { label: "Keep it", kind: "ghost", onTap: closeDialog },
        ],
      });
    });
  };
  const openFile = (m: Meeting, f: MeetingFile) => {
    openLoadedTab(() => api.fetchBlobUrl(`/api/meetings/meetings/${m.id}/files/${f.id}`, f.mime_type), 60_000).catch((e) => toast(errText(e)));
  };

  // ---- rooms and links --------------------------------------------------------------------------------------
  const saveRoom = async (f: RoomFormValue) => {
    setSaving(true);
    setRoomErr("");
    try {
      if (f.id) await api.patch(`/api/meetings/rooms/${f.id}`, roomBody(f));
      else await api.post("/api/meetings/rooms", roomBody(f));
      toast(`Saved room ${f.name}`);
      go({ room: null, tab: "rooms" });
      reload();
    } catch (e) {
      setRoomErr(errText(e));
    } finally {
      setSaving(false);
    }
  };
  const createLink = async (l: LinkForm) => {
    setSaving(true);
    setLinkErr("");
    try {
      await api.post("/api/meetings/links", { ...l, name: l.name.trim() });
      toast("Link created. Copy it from the list.");
      setSheet(null);
      go({ tab: "links", m: null });
      reload();
    } catch (e) {
      setLinkErr(errText(e));
    } finally {
      setSaving(false);
    }
  };
  const toggleLink = async (l: GuestLink) => {
    if (linkExpired(l, now)) { toast("This link has expired. Create a new link instead."); return; }
    setLinkBusy(l.id);
    try {
      await api.patch(`/api/meetings/links/${l.id}`, { active: !l.active });
      toast(l.active ? "Link turned off — nobody can book with it" : "Link turned on");
      reload();
    } catch (e) {
      toast(errText(e));
    } finally {
      setLinkBusy(null);
    }
  };

  // ---- full-page views ---------------------------------------------------------------------------------------
  const dialogs = (
    <>
      <MeetDialog spec={dialog} busy={dialogBusy} onClose={closeDialog} />
      <ConflictSheet reply={conflict} draft={editor?.d ?? null} rooms={rooms} people={people} saving={saving} onClose={() => setConflict(null)}
        onUseRoom={(id) => { setOnline(false); void save({ roomId: id }); }} onMove={(t) => void save({ start: t, end: t + ((editor?.d.end ?? 0) - (editor?.d.start ?? 0)) })} />
      {toastNode}
    </>
  );

  if (edit) {
    if (!editor || !boot) return <>{<NoDraft onBack={() => go({ edit: null, sub: null })} />}{dialogs}</>;
    if (sub === "people") return <>{<PeoplePicker st={editor} set={setD} me={me} people={peopleList} onDone={() => go({ sub: null })} toast={toast} />}{dialogs}</>;
    if (sub === "find") {
      return (
        <>
          <FindTime st={editor} rooms={rooms} people={people} now={now} tick={tick} onBack={() => go({ sub: null })}
            onPick={(p) => {
              setOnline(p.roomId === null);
              setD(p.roomId === null ? { ...p, ...onlinePatch(editor.d) } : p);
              const r = rooms.find((x) => x.id === p.roomId);
              if (p.start) toast(`${dLab(p.start)} ${hm(p.start)} · ${r ? r.name : "Online"}`);
              go({ sub: null });
            }} />
          {dialogs}
        </>
      );
    }
    return (
      <>
        <MeetingEditor st={editor} set={setD} setOnline={setOnline} tick={tick} me={me} rooms={rooms} people={people} meetConnected={!!boot.meetConnected}
          files={files} onFiles={setFiles} saving={saving} toast={toast} onSave={() => void save()}
          onPeople={() => go({ sub: "people" })} onFind={() => go({ sub: "find" })}
          onCancel={() => {
            if (editor.isNew) { go({ edit: null, sub: null }); setSheet("qb"); }
            else { const id = editor.d.id; setEditor(null); go({ edit: null, sub: null, m: id ? String(id) : null }); }
          }} />
        {dialogs}
      </>
    );
  }

  if (roomParam && boot) {
    const r = roomParam === "new" ? null : rooms.find((x) => String(x.id) === roomParam) ?? null;
    if (!canManage || (roomParam !== "new" && !r)) {
      return (
        <CommsScreen>
          <CommsHeader title="Meetings" onBack={() => go({ room: null })} />
          <Column><div style={{ padding: "12px 16px" }}><StateCard icon={DoorClosed} title={canManage ? "That room is not in the list any more." : "You need Manage meeting rooms for that."} action={<PrimaryButton height={44} onClick={() => go({ room: null })} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5 }}>Back to rooms</PrimaryButton>} /></div></Column>
        </CommsScreen>
      );
    }
    return (
      <>
        <RoomForm key={roomParam} initial={roomFormOf(r, rooms.length)} locations={[...new Set(rooms.map((x) => x.location).filter(Boolean))]}
          futureBookings={r ? roomsWeek.meetings.filter((m) => m.roomId === r.id && ms(m.start) > now).length : 0}
          saving={saving} error={roomErr} onCancel={() => { setRoomErr(""); go({ room: null }); }} onSave={(f) => void saveRoom(f)}
          onCloseRoom={(n, confirm) => setDialog({
            title: `Close ${r?.name ?? "this room"} for booking?`, icon: DoorClosed, tone: "warn",
            body: `It has ${n} upcoming booking${n === 1 ? "" : "s"} this week. Those meetings stay as they are — check with their organisers.`,
            buttons: [{ label: "Close for booking", kind: "danger", onTap: () => { confirm(); closeDialog(); } }, { label: "Keep open", kind: "ghost", onTap: closeDialog }],
          })} />
        {dialogs}
      </>
    );
  }

  // ---- the list side ------------------------------------------------------------------------------------------
  const hits = searching ? searchAll(q, cal.meetings, peopleList, rooms, me) : null;
  const moreItems: MoreItem[] = [
    { key: "links", label: "Guest links", sub: "Links outside people use to book", icon: MORE_ICONS.links, fg: "var(--c-teal)", bg: C.tealBg, on: sec === "links" },
    ...(canManage ? [
      { key: "email", label: "Email and WhatsApp", sub: "How meeting messages are sent", icon: MORE_ICONS.email, fg: "var(--c-gold)", bg: C.cream, tag: "Room managers", on: sec === "email" },
      { key: "log", label: "Change log", sub: "Room and guest-link changes", icon: MORE_ICONS.log, fg: "var(--c-plum)", bg: C.plumBg, tag: "Room managers", on: sec === "log" },
    ] : []),
  ];
  const activeRooms = rooms.filter((r) => r.active).length;
  const bootFailed = !boot && !!bootR.error;

  const main = (
    <CommsScreen>
      <CommsHeader title="Meetings" trailing={
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CircleBtn icon={Bell} label={`Meeting notifications, ${unread} unread`} onClick={() => { setSearchOn(false); setQ(""); setMineSub("notif"); go({ tab: "mine", m: null }); }} badge={unread} />
          <CircleBtn icon={Search} label="Search meetings, people and rooms" pressed={searchOn} onClick={() => { setSearchOn((v) => !v); setQ(""); }} />
          <CircleBtn icon={Ellipsis} label="More sections" onClick={() => setSheet("more")} />
          <RoundPlus label="Book a meeting" onClick={() => quick()} />
        </div>
      } />
      <Column max={900}>
        <div style={{ padding: "6px 18px 0" }}>
          <Seg label="Meetings sections" height={46} radius={14} fontSize={12.5} cols="minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1fr)"
            value={sec === "calendar" || sec === "mine" || sec === "rooms" ? sec : null}
            onChange={(k) => { setSearchOn(false); setQ(""); go({ tab: k === "calendar" ? null : k, m: null }); }}
            items={[{ key: "calendar", label: "Calendar" }, { key: "mine", label: "My meetings", badge: unread ? String(unread > 99 ? "99+" : unread) : undefined, badgeRed: true }, { key: "rooms", label: "Rooms", badge: boot ? String(activeRooms) : undefined }]} />
        </div>
        {searchOn ? (
          <div style={{ padding: "10px 18px 0" }}>
            <label style={{ height: 44, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 9, padding: "0 6px 0 13px", background: C.card, borderRadius: 14, boxShadow: SH.field }}>
              <Search size={18} strokeWidth={1.75} color="var(--c-faint)" aria-hidden />
              <input autoFocus className="c-input" type="text" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Meetings, people, rooms" aria-label="Search meetings, people and rooms"
                style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: C.ink, padding: 0 }} />
              <button type="button" aria-label="Close search" onClick={() => { setSearchOn(false); setQ(""); }} style={{ ...BTN, width: 36, height: 36, flex: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: C.track, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} strokeWidth={2.4} color="var(--c-muted)" /></span>
              </button>
            </label>
          </div>
        ) : null}

        {!boot ? (
          <div style={{ padding: "12px 16px 32px" }}>
            {bootFailed ? (
              <StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't load meetings" text={bootR.error}
                action={<PrimaryButton height={44} onClick={reload} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5, marginTop: 4 }}>Try again</PrimaryButton>} />
            ) : <StateCard icon={Loader} role="status" title="Loading meetings…" />}
          </div>
        ) : hits ? (
          <SearchResults q={q} hits={hits} rooms={rooms} overlay={overlay} colourOf={colourFn} loading={cal.loading}
            onMeeting={(m) => go({ m: String(m.id) })}
            onPerson={(k, n) => {
              if (overlay.includes(k)) { toast(`${n}'s calendar is already shown`); return; }
              setOverlay((o) => [...o, k]);
              setOnlyMine(true);
              toast(`Showing ${n}'s calendar`);
            }}
            onRoom={(r) => {
              setRoomFilter(Object.fromEntries(rooms.filter((x) => x.id !== r.id).map((x) => [x.id, false])));
              setSearchOn(false);
              setQ("");
              go({ tab: null, view: "rooms", m: null });
            }} />
        ) : sec === "calendar" ? (
          <CalendarPane view={view} anchor={anchor} now={now} meetings={shown} loading={cal.loading} error={cal.error} rooms={rooms.filter((r) => r.active && roomFilter[r.id] !== false)}
            colourOf={colourFn} legend={legend} onlyMine={onlyMine} optsCount={optionsCount(roomFilter, onlyMine, overlay)}
            onView={(v) => go({ view: v }, true)} onAnchor={(t) => go({ date: isoDay(t) }, true)} onStep={(dir) => go({ date: isoDay(stepAnchor(view, anchor, dir)) }, true)}
            onPickDate={() => setSheet("date")} onOptions={() => setSheet("opts")} onOpen={(m) => go({ m: String(m.id) })} onQuick={(t, rid) => quick(t, rid)} />
        ) : sec === "mine" ? (
          <MinePane data={mine.data} error={mine.error} sub={mineSub} onSub={setMineSub} unread={unread} me={me} rooms={rooms} people={people} colourOf={colourFn} now={now} onOpen={(id) => go({ m: String(id) })} />
        ) : sec === "rooms" ? (
          <RoomsPane rooms={rooms} meetings={roomsWeek.meetings} weekStart={weekStart} now={now} canManage={canManage} error={roomsWeek.error}
            onAdd={() => { setRoomErr(""); go({ room: "new" }); }} onEdit={(r) => { setRoomErr(""); go({ room: String(r.id) }); }} onBook={(r) => quick(undefined, r.id)} />
        ) : sec === "links" ? (
          <LinksPane links={links.data?.links ?? null} error={links.error} rooms={rooms} people={people} now={now} origin={window.location.origin} busyId={linkBusy}
            onCreate={() => { setLinkErr(""); setSheet("gl"); }} onToggle={(l) => void toggleLink(l)}
            onCopy={async (url) => toast((await copyText(url)) ? "Link copied" : "Copy is blocked here. Select the link text instead.")} />
        ) : sec === "email" ? <EmailPane /> : <LogPane log={log.data?.log ?? null} error={log.error} people={people} />}
      </Column>

      <QuickBookSheet st={sheet === "qb" ? editor : null} set={setD} setOnline={setOnline} rooms={rooms} people={people} tick={tick} saving={saving}
        onClose={() => { setSheet(null); setEditor(null); }} onSave={() => void save()}
        onMore={() => { setSheet(null); go({ edit: "new", m: null }); }} onPeople={() => { setSheet(null); go({ edit: "new", sub: "people", m: null }); }} />
      <OptionsSheet open={sheet === "opts"} onClose={() => setSheet(null)} colorBy={colorBy} onColorBy={setColorBy} legend={legend} onlyMine={onlyMine} onOnlyMine={setOnlyMine}
        rooms={rooms} roomFilter={roomFilter} onRoomFilter={setRoomFilter} overlay={overlay} people={people}
        onRemoveOverlay={(k) => setOverlay((o) => o.filter((x) => x !== k))} onAddColleague={() => setSheet("pick")} onGuestLink={() => { setLinkErr(""); setSheet("gl"); }} />
      {sheet === "date" ? <DateSheet open onClose={() => setSheet(null)} selected={anchor} now={now} onPick={(t) => { setSheet(null); go({ date: isoDay(t) }, true); }} /> : null}
      <MoreSheet open={sheet === "more"} onClose={() => setSheet(null)} items={moreItems} onPick={(k) => { setSheet(null); setSearchOn(false); setQ(""); go({ tab: k, m: null }); }} />
      {sheet === "pick" ? <ColleagueSheet open onClose={() => setSheet("opts")} people={peopleList} me={me} overlay={overlay}
        onAdd={(k) => { setOverlay((o) => [...o, k]); setOnlyMine(true); toast(`Showing ${people.get(k)?.name ?? k}'s calendar`); setSheet("opts"); }} /> : null}
      {sheet === "gl" ? <GuestLinkSheet open onClose={() => setSheet(null)} people={peopleList} now={now} saving={saving} error={linkErr} onCreate={(l) => void createLink(l)} /> : null}
    </CommsScreen>
  );

  if (mId !== null) {
    const seed = cal.meetings.find((m) => m.id === mId) ?? mine.data?.meetings.find((m) => m.id === mId) ?? roomsWeek.meetings.find((m) => m.id === mId) ?? null;
    const detail = (
      <MeetingDetail key={mId} id={mId} seed={seed} tick={tick} me={me} rooms={rooms} people={people} colourOf={colourFn} busy={dialogBusy}
        onBack={() => go({ m: null })} onAct={onAct} onFile={openFile} />
    );
    return <>{layout.canSplitDetail ? <CommsSplit left={main} right={detail} /> : detail}{dialogs}</>;
  }
  return <>{main}{dialogs}</>;
}

function CircleBtn({ icon: Icon, label, onClick, badge, pressed }: { icon: LucideIcon; label: string; onClick: () => void; badge?: number; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed}
      style={{ ...BTN, position: "relative", width: 42, height: 42, flex: "none", borderRadius: "50%", background: pressed ? C.tint : C.card, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: SH.chip }}>
      <Icon size={18} strokeWidth={2} />
      {badge ? (
        <span aria-hidden style={{ position: "absolute", top: 2, right: 1, minWidth: 16, height: 16, boxSizing: "border-box", padding: "0 4px", borderRadius: 999, background: C.red, color: "#FFFFFF", fontSize: 9.5, fontWeight: 700, lineHeight: "16px", textAlign: "center", boxShadow: "0 0 0 2px var(--c-paper)", ...NUM }}>{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </button>
  );
}

function SearchResults({ q, hits, rooms, overlay, colourOf, loading, onMeeting, onPerson, onRoom }: {
  q: string; hits: ReturnType<typeof searchAll>; rooms: Room[]; overlay: string[]; colourOf: (m: Meeting) => string; loading: boolean;
  onMeeting: (m: Meeting) => void; onPerson: (k: string, name: string) => void; onRoom: (r: Room) => void;
}) {
  const none = !hits.meetings.length && !hits.people.length && !hits.rooms.length;
  const head = (t: string) => <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px 4px" }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: C.gold }}>{t}</span><span style={{ flex: 1, height: 1, background: C.divider }} /></div>;
  const row = (key: string | number, i: number, icon: LucideIcon, bg: string, fg: string, t: string, s: string, act: string, onTap: () => void) => {
    const Icon = icon;
    return (
      <button key={key} type="button" onClick={onTap} style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "9px 12px", borderTop: rowTop(i), background: "none", textAlign: "left", color: C.ink }}>
        <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={15} strokeWidth={2} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t}</span>
          <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...NUM }}>{s}</span>
        </span>
        {act ? <span style={{ flex: "none", fontSize: 11.5, fontWeight: 700, color: C.gold }}>{act}</span> : null}
      </button>
    );
  };
  return (
    <div style={{ padding: "8px 16px 32px", display: "flex", flexDirection: "column", gap: 6 }}>
      {none ? <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13.5, color: C.muted }}>{loading ? "Searching…" : `Nothing matches "${q.trim()}".`}</div> : null}
      {hits.meetings.length ? <>{head("MEETINGS")}<div style={RINGCARD}>{hits.meetings.map((m, i) => {
        const c = colourOf(m);
        const r = rooms.find((x) => x.id === m.roomId);
        return row(m.id, i, CalendarDays, tintOf(c, 18), c, m.title || "(No title)", `${dLab(ms(m.start))} · ${hm(ms(m.start))} · ${r ? r.name : m.roomId ? "Room" : "Online"}`, "", () => onMeeting(m));
      })}</div></> : null}
      {hits.people.length ? <>{head("PEOPLE")}<div style={RINGCARD}>{hits.people.map((p, i) => row(p.key, i, User, C.cream, "var(--c-gold)", p.name, [p.company, p.department].filter(Boolean).join(" · "), overlay.includes(p.key) ? "Shown" : "Add calendar", () => onPerson(p.key, p.name)))}</div></> : null}
      {hits.rooms.length ? <>{head("ROOMS")}<div style={RINGCARD}>{hits.rooms.map((r, i) => row(r.id, i, DoorOpen, tintOf(r.color, 18), r.color, r.name, [r.location, r.floor, `${r.seats} seats`].filter(Boolean).join(" · "), "View", () => onRoom(r)))}</div></> : null}
    </div>
  );
}
