// Meetings v3 — the Calendar section: toolbar (Today, ‹ date ›, options), the five views
// (Day / Week / Month / Rooms / List) and the colour legend. Draws only; the screen
// decides what a tap does (open a meeting, quick-book a free time).
import type { MouseEvent } from "react";
import { ArrowDownUp, ChevronDown, ChevronLeft, ChevronRight, DoorOpen, Hand, Repeat, UserCheck, Video } from "lucide-react";
import { BTN, C, NUM, SH, Skeletons } from "../comms-kit";
import { GRID_FROM, GRID_TO, MIN, addDays, layoutDay, ms, startOfDay, type Meeting, type Room } from "@/lib/meetings";
import {
  CAL_VIEWS, WD, closedOn, dLong, durL, gridBox, groupByDay, hm, mondayOf, monthCells, onDay, periodTitle, shortStatus, tintOf, type CalView,
} from "./meet-lib";
import { DayLine, Seg, TonePill } from "./meet-ui";

export type CalProps = {
  view: CalView;
  anchor: number;
  now: number;
  meetings: Meeting[];
  loading: boolean;
  error: string;
  rooms: Room[];
  colourOf: (m: Meeting) => string;
  legend: { l: string; c: string }[];
  onlyMine: boolean;
  optsCount: number;
  onView: (v: CalView) => void;
  onAnchor: (t: number) => void;
  onStep: (dir: number) => void;
  onPickDate: () => void;
  onOptions: () => void;
  onOpen: (m: Meeting) => void;
  onQuick: (start: number, roomId?: number | null) => void;
};

const VIEW_LABEL: Record<CalView, string> = { day: "Day", week: "Week", month: "Month", rooms: "Rooms", list: "List" };
const CALCARD = { borderRadius: 20, background: C.card, boxShadow: SH.card } as const;
const H = 56;
const WH = 34;
const SPAN = (GRID_TO - GRID_FROM) * 60;

export function CalendarPane(p: CalProps) {
  return (
    <>
      <div style={{ padding: "6px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" onClick={() => p.onAnchor(startOfDay(p.now))} style={{ ...BTN, height: 38, padding: "0 12px", borderRadius: 999, background: C.card, color: C.gold, fontSize: 12.5, fontWeight: 700, boxShadow: "0 0 0 1px rgba(201,169,97,.3), 0 6px 14px -8px rgba(107,92,50,.4)", flex: "none" }}>Today</button>
          <button type="button" aria-label="Previous" onClick={() => p.onStep(-1)} style={{ ...BTN, width: 38, height: 38, flex: "none", borderRadius: "50%", background: "none", color: C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeft size={19} strokeWidth={2} /></button>
          <button type="button" aria-label="Pick a date" onClick={p.onPickDate} style={{ ...BTN, flex: 1, minWidth: 0, height: 38, background: "none", fontSize: 15, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, whiteSpace: "nowrap", ...NUM }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{periodTitle(p.view, p.anchor)}</span>
            <ChevronDown size={15} strokeWidth={2.2} color="var(--c-gold-mid)" style={{ flex: "none" }} />
          </button>
          <button type="button" aria-label="Next" onClick={() => p.onStep(1)} style={{ ...BTN, width: 38, height: 38, flex: "none", borderRadius: "50%", background: "none", color: C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRight size={19} strokeWidth={2} /></button>
          <button type="button" aria-label={p.optsCount ? `Calendar options, ${p.optsCount} on` : "Calendar options"} aria-haspopup="dialog" onClick={p.onOptions}
            style={{ ...BTN, position: "relative", width: 40, height: 40, flex: "none", borderRadius: "50%", background: p.optsCount ? "#6B5C32" : C.card, color: p.optsCount ? "#FFFFFF" : C.gold, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: p.optsCount ? SH.chipOn : SH.field }}>
            <ArrowDownUp size={16} strokeWidth={1.9} />
            {p.optsCount ? <span aria-hidden style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: C.red, color: "#FFFFFF", fontSize: 9.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px var(--c-paper)" }}>{p.optsCount}</span> : null}
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <Seg label="Calendar view" height={40} radius={12} fontSize={12.5} value={p.view} onChange={p.onView} items={CAL_VIEWS.map((v) => ({ key: v, label: VIEW_LABEL[v] }))} />
        </div>
        <div className="mt-x" style={{ display: "flex", alignItems: "center", gap: 10, overflowX: "auto", padding: "9px 2px 2px" }}>
          {p.legend.map((g) => (
            <span key={g.l} style={{ flex: "none", display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.body, whiteSpace: "nowrap" }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: g.c }} />{g.l}
            </span>
          ))}
          {p.onlyMine ? (
            <span style={{ flex: "none", height: 22, display: "flex", alignItems: "center", gap: 4, padding: "0 8px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
              <UserCheck size={11} strokeWidth={2.2} />Only my meetings
            </span>
          ) : null}
        </div>
      </div>
      {p.error ? (
        <div role="alert" style={{ margin: "8px 16px 0", padding: "9px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5, lineHeight: 1.4 }}>The calendar could not be loaded: {p.error}</div>
      ) : null}
      {p.loading && !p.meetings.length ? (
        <div style={{ padding: "10px 16px 0" }}><Skeletons n={2} h={140} label="Loading the calendar" /></div>
      ) : p.view === "day" ? <DayView {...p} />
        : p.view === "week" ? <WeekView {...p} />
        : p.view === "month" ? <MonthView {...p} />
        : p.view === "rooms" ? <RoomsView {...p} />
        : <ListView {...p} />}
    </>
  );
}

function Hint({ children }: { children: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0 0 14px", fontSize: 11, color: C.faint }}><Hand size={12} strokeWidth={2} />{children}</div>;
}

function DayView(p: CalProps) {
  const day = startOfDay(p.anchor);
  const items = p.meetings.filter((m) => onDay(m, day)).map((m) => ({ start: ms(m.start), end: ms(m.end), m }));
  const laid = layoutDay(items);
  const hours = Array.from({ length: GRID_TO - GRID_FROM + 1 }, (_, i) => GRID_FROM + i);
  const slots: number[] = [];
  for (let t = day + GRID_FROM * 60 * MIN; t < day + GRID_TO * 60 * MIN; t += 30 * MIN) if (t + 30 * MIN > p.now) slots.push(t);
  const isToday = day === startOfDay(p.now);
  const nowTop = ((new Date(p.now).getHours() * 60 + new Date(p.now).getMinutes() - GRID_FROM * 60) / 60) * H;
  return (
    <div style={{ margin: "8px 16px 32px", ...CALCARD, padding: "10px 10px 10px 0", position: "relative" }}>
      <div style={{ position: "relative", height: (GRID_TO - GRID_FROM) * H }}>
        {hours.map((h) => (
          <div key={h} style={{ position: "absolute", left: 0, right: 0, top: (h - GRID_FROM) * H, display: "flex", alignItems: "flex-start", pointerEvents: "none" }}>
            <span style={{ width: 46, flex: "none", textAlign: "right", paddingRight: 8, boxSizing: "border-box", fontSize: 10.5, color: C.faint, marginTop: -6, ...NUM }}>{String(h).padStart(2, "0")}:00</span>
            <span style={{ flex: 1, height: 1, background: "var(--mt-grid)" }} />
          </div>
        ))}
        {slots.map((t) => (
          <button key={t} type="button" className="mt-slot" aria-label={`Book at ${hm(t)}`} onClick={() => p.onQuick(t)}
            style={{ ...BTN, position: "absolute", left: 46, right: 0, top: ((t - day) / MIN / 60 - GRID_FROM) * H, height: H / 2, background: "transparent" }} />
        ))}
        {isToday && nowTop >= 0 && nowTop <= (GRID_TO - GRID_FROM) * H ? (
          <div aria-hidden style={{ position: "absolute", left: 40, right: 0, top: nowTop, height: 2, background: C.red, pointerEvents: "none", zIndex: 3 }}>
            <span style={{ position: "absolute", left: -4, top: -4, width: 10, height: 10, borderRadius: "50%", background: C.red }} />
            <span style={{ position: "absolute", left: -42, top: -8, height: 16, padding: "0 5px", borderRadius: 999, background: C.red, color: "#FFFFFF", fontSize: 9.5, fontWeight: 700, lineHeight: "16px" }}>Now</span>
          </div>
        ) : null}
        {laid.map(({ item, lane, lanes }) => {
          const m = item.m;
          const c = p.colourOf(m);
          const b = gridBox(m, H, 26);
          const room = p.rooms.find((r) => r.id === m.roomId);
          return (
            <button key={m.id} type="button" onClick={(e: MouseEvent) => { e.stopPropagation(); p.onOpen(m); }} aria-label={`${m.title}, ${hm(ms(m.start))} to ${hm(ms(m.end))}`}
              style={{ ...BTN, position: "absolute", top: b.top, height: b.h, left: `calc(48px + (100% - 50px) * ${lane / lanes})`, width: `calc((100% - 50px) / ${lanes} - 3px)`, boxSizing: "border-box", borderRadius: 10, background: tintOf(c), boxShadow: `inset 3px 0 0 ${c}, 0 4px 10px -6px rgba(31,29,27,.3)`, padding: "5px 7px 5px 9px", textAlign: "left", overflow: "hidden", zIndex: 2, opacity: m.status === "ended" ? 0.6 : 1 }}>
              <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title || "(No title)"}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: C.body, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden" }}>
                {m.video.url ? <Video size={10} strokeWidth={2.2} style={{ flex: "none" }} /> : null}
                {m.seriesId ? <Repeat size={10} strokeWidth={2.2} style={{ flex: "none" }} /> : null}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", ...NUM }}>{hm(ms(m.start))}–{hm(ms(m.end))} · {room ? room.name : m.roomId ? "Room" : "Online"}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Hint>Tap an empty time to book</Hint>
    </div>
  );
}

function WeekView(p: CalProps) {
  const m0 = mondayOf(p.anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(m0, i));
  const today = startOfDay(p.now);
  const cols = "34px repeat(7, minmax(0, 1fr))";
  const hours: number[] = [];
  for (let h = GRID_FROM + 1; h < GRID_TO; h += 2) hours.push(h);
  return (
    <div style={{ margin: "8px 16px 32px", ...CALCARD, padding: "8px 6px 10px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 2, paddingBottom: 6 }}>
        <span />
        {days.map((d) => {
          const on = d === startOfDay(p.anchor);
          const td = d === today;
          return (
            <button key={d} type="button" aria-label={dLong(d)} onClick={() => { p.onAnchor(d); p.onView("day"); }}
              style={{ ...BTN, height: 44, background: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: 0.3 }}>{WD[new Date(d).getDay()].slice(0, 2).toUpperCase()}</span>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: on ? "#6B5C32" : td ? C.tint : "transparent", color: on ? "#FFFFFF" : C.ink, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", ...NUM }}>{new Date(d).getDate()}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 2 }}>
        <div style={{ position: "relative", height: (GRID_TO - GRID_FROM) * WH }}>
          {hours.map((h) => <span key={h} style={{ position: "absolute", right: 4, top: (h - GRID_FROM) * WH, fontSize: 9.5, color: C.faint, marginTop: -6, ...NUM }}>{h}</span>)}
        </div>
        {days.map((d) => (
          <div key={d} style={{ position: "relative", height: (GRID_TO - GRID_FROM) * WH, borderRadius: 8, background: d === today ? "var(--mt-col-today)" : "var(--mt-col)", backgroundImage: `repeating-linear-gradient(180deg, var(--mt-grid) 0, var(--mt-grid) 1px, transparent 1px, transparent ${WH}px)` }}>
            {p.meetings.filter((m) => onDay(m, d)).map((m) => {
              const c = p.colourOf(m);
              const b = gridBox(m, WH, 16);
              return (
                <button key={m.id} type="button" onClick={() => p.onOpen(m)} aria-label={`${m.title}, ${hm(ms(m.start))} to ${hm(ms(m.end))}`}
                  style={{ ...BTN, position: "absolute", left: 1, right: 1, top: b.top, height: b.h, boxSizing: "border-box", borderRadius: 6, background: tintOf(c, 16), boxShadow: `inset 2px 0 0 ${c}`, padding: "2px 3px 2px 5px", textAlign: "left", fontSize: 9.5, fontWeight: 700, lineHeight: 1.2, color: C.ink, overflow: "hidden", opacity: m.status === "ended" ? 0.6 : 1 }}>
                  {m.title || "(No title)"}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <Hint>Tap a day for its full schedule</Hint>
    </div>
  );
}

function MonthView(p: CalProps) {
  const cells = monthCells(p.anchor);
  const today = startOfDay(p.now);
  const sel = startOfDay(p.anchor);
  return (
    <div style={{ margin: "8px 16px 32px", ...CALCARD, padding: "10px 8px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2, marginBottom: 4 }}>
        {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((h) => <span key={h} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: 0.3 }}>{h}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>
        {cells.map(({ day, inMonth }) => {
          const ms_ = p.meetings.filter((m) => onDay(m, day));
          const on = day === sel;
          const td = day === today;
          return (
            <button key={day} type="button" aria-label={`${dLong(day)}, ${ms_.length} meeting${ms_.length === 1 ? "" : "s"}`} onClick={() => { p.onAnchor(day); p.onView("day"); }}
              style={{ ...BTN, height: 60, borderRadius: 10, background: on ? C.card : "transparent", boxShadow: on ? "0 0 0 1.5px var(--c-gold)" : "none", padding: "5px 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: inMonth ? 1 : 0.4 }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", background: td ? "#6B5C32" : "transparent", color: td ? "#FFFFFF" : C.ink, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", ...NUM }}>{new Date(day).getDate()}</span>
              <span style={{ display: "flex", gap: 2, alignItems: "center", height: 8 }}>
                {ms_.slice(0, 3).map((m) => <span key={m.id} style={{ width: 6, height: 6, borderRadius: "50%", background: p.colourOf(m) }} />)}
              </span>
              {ms_.length > 3 ? <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, lineHeight: 1 }}>+{ms_.length - 3}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoomsView(p: CalProps) {
  const day = startOfDay(p.anchor);
  const ticks = [8, 11, 14, 17, 20].filter((h) => h > GRID_FROM && h < GRID_TO);
  const pct = (t: number) => ((Math.min(Math.max((t - day) / MIN, GRID_FROM * 60), GRID_TO * 60) - GRID_FROM * 60) / SPAN) * 100;
  if (!p.rooms.length) return <div style={{ margin: "12px 16px 32px", padding: "28px 16px", textAlign: "center", fontSize: 13.5, color: C.muted, ...CALCARD }}>No rooms yet. Someone with Manage meeting rooms adds them under Rooms.</div>;
  return (
    <div style={{ margin: "8px 16px 32px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", padding: "0 12px" }}>
        <span />
        <div style={{ position: "relative", height: 14 }}>
          {ticks.map((h) => <span key={h} style={{ position: "absolute", left: `${((h - GRID_FROM) / (GRID_TO - GRID_FROM)) * 100}%`, transform: "translateX(-50%)", fontSize: 9.5, color: C.faint, ...NUM }}>{h}</span>)}
        </div>
      </div>
      {p.rooms.map((r) => {
        const cl = closedOn(r, day);
        const closedTxt = cl ? `Closed${cl.reason ? ` · ${cl.reason}` : ""}` : !r.open_days.includes(new Date(day).getDay()) ? "Not open this day" : "";
        const evs = p.meetings.filter((m) => m.roomId === r.id && onDay(m, day));
        const onTrack = (e: MouseEvent<HTMLDivElement>) => {
          if (cl || e.target !== e.currentTarget) return;
          const rc = e.currentTarget.getBoundingClientRect();
          let mins = GRID_FROM * 60 + Math.floor((((e.clientX - rc.left) / rc.width) * SPAN) / 30) * 30;
          let t = day + mins * MIN;
          if (t < p.now) {
            mins = Math.ceil((p.now - day) / MIN / 30) * 30;
            t = day + mins * MIN;
          }
          p.onQuick(t, r.id);
        };
        return (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", alignItems: "center", padding: "10px 12px", ...CALCARD, borderRadius: 16, opacity: closedTxt ? 0.6 : 1 }}>
            <span style={{ minWidth: 0, paddingRight: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, flex: "none", borderRadius: 3, background: r.color }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              </span>
              <span style={{ display: "block", fontSize: 10.5, color: C.faint, marginTop: 2, paddingLeft: 13 }}>{r.seats} seats</span>
            </span>
            <div role="button" tabIndex={cl ? -1 : 0} aria-label={`${r.name} timeline, tap to book`} onClick={onTrack}
              onKeyDown={(e) => { if (!cl && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); p.onQuick(Math.max(day + 9 * 60 * MIN, Math.ceil(p.now / (30 * MIN)) * 30 * MIN), r.id); } }}
              style={{ position: "relative", height: 34, borderRadius: 8, background: cl ? "repeating-linear-gradient(135deg, var(--mt-closed-a) 0, var(--mt-closed-a) 6px, var(--mt-closed-b) 6px, var(--mt-closed-b) 12px)" : C.paper, cursor: cl ? "default" : "pointer" }}>
              {ticks.map((h) => <span key={h} aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: `${((h - GRID_FROM) / (GRID_TO - GRID_FROM)) * 100}%`, width: 1, background: "var(--mt-grid)", pointerEvents: "none" }} />)}
              {closedTxt ? <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, color: C.faint, pointerEvents: "none" }}>{closedTxt}</span> : null}
              {evs.map((m) => (
                <button key={m.id} type="button" onClick={(e) => { e.stopPropagation(); p.onOpen(m); }} aria-label={`${m.title}, ${hm(ms(m.start))} to ${hm(ms(m.end))}`}
                  style={{ ...BTN, position: "absolute", top: 3, bottom: 3, left: `${pct(ms(m.start))}%`, width: `${Math.max(1.5, pct(ms(m.end)) - pct(ms(m.start)))}%`, borderRadius: 6, background: r.color, opacity: m.status === "ended" ? 0.55 : 1 }} />
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px", fontSize: 11, color: C.faint }}><Hand size={12} strokeWidth={2} />Tap a free part of a room's line to book it</div>
    </div>
  );
}

function ListView(p: CalProps) {
  const groups = groupByDay(p.meetings.filter((m) => ms(m.end) >= startOfDay(p.anchor)), p.now);
  return (
    <div style={{ padding: "4px 16px 32px" }}>
      {groups.length === 0 ? <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13.5, color: C.muted }}>No meetings in the next two weeks.</div> : null}
      {groups.map((g) => (
        <div key={g.day}>
          <DayLine label={g.label} red={g.today} />
          <div style={{ display: "grid", gap: 8 }}>
            {g.rows.map((m) => {
              const room = p.rooms.find((r) => r.id === m.roomId);
              const st = m.status === "live" ? "green" : m.status === "ended" ? "grey" : "teal";
              return (
                <button key={m.id} type="button" onClick={() => p.onOpen(m)} className="c-press"
                  style={{ ...BTN, display: "flex", alignItems: "stretch", gap: 12, padding: "11px 12px", borderRadius: 16, background: C.card, boxShadow: SH.card, textAlign: "left", color: C.ink, opacity: m.status === "ended" ? 0.65 : 1, width: "100%" }}>
                  <span style={{ width: 4, flex: "none", borderRadius: 999, background: p.colourOf(m) }} />
                  <span style={{ width: 46, flex: "none", ...NUM }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 800 }}>{hm(ms(m.start))}</span>
                    <span style={{ display: "block", fontSize: 11, color: C.faint, marginTop: 2 }}>{durL(Math.round((ms(m.end) - ms(m.start)) / MIN))}</span>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, lineHeight: 1.3 }}>{m.title || "(No title)"}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: C.muted, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden" }}>
                      {m.roomId ? <DoorOpen size={11} strokeWidth={2} style={{ flex: "none" }} /> : <Video size={11} strokeWidth={2} style={{ flex: "none" }} />}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{room ? room.name : m.roomId ? "Room" : "Online"}</span>
                    </span>
                  </span>
                  <span style={{ flex: "none", alignSelf: "center" }}><TonePill label={shortStatus(m)} tone={st} dot={false} h={20} size={10} /></span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mini month for the "Go to a date" sheet. */
export function DatePickerGrid({ month, selected, now, onMonth, onPick }: { month: number; selected: number; now: number; onMonth: (t: number) => void; onPick: (t: number) => void }) {
  const cells = monthCells(month);
  const mm = new Date(month);
  const step = (n: number) => onMonth(new Date(mm.getFullYear(), mm.getMonth() + n, 1).getTime());
  const today = startOfDay(now);
  const round = { ...BTN, width: 40, height: 40, borderRadius: "50%", background: C.card, boxShadow: SH.ring, display: "flex", alignItems: "center", justifyContent: "center", color: C.ink } as const;
  return (
    <div style={{ padding: "4px 16px calc(24px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} style={round}><ChevronLeft size={18} strokeWidth={2} /></button>
        <span style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 700 }}>{periodTitle("month", month)}</span>
        <button type="button" aria-label="Next month" onClick={() => step(1)} style={round}><ChevronRight size={18} strokeWidth={2} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((h) => <span key={h} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: C.faint, padding: "4px 0" }}>{h}</span>)}
        {cells.map(({ day, inMonth }) => {
          const on = day === startOfDay(selected);
          const td = day === today;
          return (
            <button key={day} type="button" aria-label={dLong(day)} aria-pressed={on} onClick={() => onPick(day)}
              style={{ ...BTN, height: 44, borderRadius: "50%", background: on ? "#6B5C32" : "transparent", color: on ? "#FFFFFF" : C.ink, fontSize: 14, fontWeight: on || td ? 800 : 500, opacity: inMonth ? 1 : 0.35, boxShadow: td && !on ? "inset 0 0 0 1.5px #C9A24B" : "none", ...NUM }}>
              {new Date(day).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
