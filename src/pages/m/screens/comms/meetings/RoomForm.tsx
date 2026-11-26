// Meetings v3 — Add / Edit room (?room=new|ID), room managers only. The desktop
// RoomDialog's fields and option lists exactly (MeetingsAdmin.tsx; audit rule 4),
// drawn as the prototype's full-page form.
import { useState } from "react";
import { AlertCircle, CalendarX, Check, ChevronDown, Minus, Plus, TriangleAlert, X } from "lucide-react";
import { BTN, C, Column, ErrorBox, FormBar, NUM, PrimaryButton, SH, BottomBar } from "../comms-kit";
import { ROOM_COLORS } from "@/lib/meetings";
import { type RoomFormValue, AHEAD_OPTIONS, EQUIPMENT, GAP_OPTIONS, LONGEST_OPTIONS, OPEN_FROM, OPEN_TO, WD, dayRange, optionLabel, stepOption } from "./meet-lib";
import { INPUT, LABEL, RINGCARD, SELECT, SwitchRow, chipCss, rowTop } from "./meet-ui";

export function RoomForm({ initial, locations, futureBookings, saving, error, onCancel, onSave, onCloseRoom }: {
  initial: RoomFormValue; locations: string[]; futureBookings: number; saving: boolean; error: string;
  onCancel: () => void; onSave: (f: RoomFormValue) => void; onCloseRoom: (n: number, confirm: () => void) => void;
}) {
  const [x, setX] = useState(initial);
  const [cl, setCl] = useState({ from: "", to: "", reason: "" });
  const [tried, setTried] = useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((a) => a !== v) : [...list, v]);
  const nameBad = tried && !x.name.trim();
  const text = (label: string, key: "name" | "location" | "floor" | "address", ph: string, req = false, hint?: string) => (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", marginBottom: 6, ...LABEL }}>{label}{req ? <span style={{ color: C.red }}> *</span> : null}</span>
      <input className="c-input" value={x[key]} placeholder={ph} list={key === "location" ? "mt-locations" : undefined} onChange={(e) => setX({ ...x, [key]: e.target.value })}
        style={{ ...INPUT, boxShadow: key === "name" && nameBad ? "0 0 0 1.5px var(--c-red)" : SH.ring }} />
      {key === "location" ? <datalist id="mt-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist> : null}
      {hint ? <span style={{ display: "block", marginTop: 5, fontSize: 11, color: C.faint }}>{hint}</span> : null}
      {key === "name" && nameBad ? <span style={{ display: "block", marginTop: 5, fontSize: 11.5, color: C.red }}>Give the room a name.</span> : null}
    </label>
  );
  const hourSelect = (label: string, value: number, opts: number[], on: (v: number) => void) => (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", marginBottom: 6, ...LABEL }}>{label}</span>
      <span style={{ position: "relative", display: "block" }}>
        <select value={value} onChange={(e) => on(Number(e.target.value))} style={{ ...SELECT, fontSize: 15 }}>{opts.map((h) => <option key={h} value={h}>{h}:00</option>)}</select>
        <span style={{ position: "absolute", right: 12, top: 13, pointerEvents: "none", color: C.goldMid, display: "flex" }}><ChevronDown size={18} strokeWidth={2} /></span>
      </span>
    </label>
  );
  const rules: [string, [number, string][], "bufferMin" | "maxHours" | "advanceDays"][] = [["Gap between meetings", GAP_OPTIONS, "bufferMin"], ["Longest booking", LONGEST_OPTIONS, "maxHours"], ["Book ahead up to", AHEAD_OPTIONS, "advanceDays"]];
  const save = () => {
    setTried(true);
    if (!x.name.trim()) return;
    onSave({ ...x, name: x.name.trim(), seats: Math.max(1, Math.min(500, Number(x.seats) || 1)) });
  };
  const toggleOpen = () => {
    if (x.active && futureBookings > 0) onCloseRoom(futureBookings, () => setX((v) => ({ ...v, active: false })));
    else setX({ ...x, active: !x.active });
  };

  return (
    <div style={{ minHeight: "100%", background: C.paper }}>
      <FormBar title={x.id ? "Edit room" : "Add room"} onCancel={onCancel} cancelDisabled={saving} />
      <Column>
        <div style={{ padding: "14px 16px 150px", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
          <SwitchRow on={x.active} title="Open for booking" sub={x.active ? "People can book it" : "Hidden from booking"} onToggle={toggleOpen} />
          {!x.active && futureBookings > 0 ? (
            <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 12, background: C.amberBg, color: C.amber, fontSize: 12.5, lineHeight: 1.45 }}>
              <TriangleAlert size={15} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} />
              <span>{futureBookings} meeting{futureBookings === 1 ? " is" : "s are"} still booked in this room. They stay booked; tell the organisers to move them, or add closed dates instead so only those days are blocked.</span>
            </div>
          ) : null}
          {text("Room name", "name", "e.g. Boardroom", true)}
          {text("Location", "location", "e.g. Head office")}
          {text("Floor or area", "floor", "e.g. Level 2")}
          {text("Address for visitors", "address", "Street, postcode, city", false, "Shown with a Google Maps link in the emails outside guests get.")}
          <label style={{ display: "block" }}>
            <span style={{ display: "block", marginBottom: 6, ...LABEL }}>How many people</span>
            <input className="c-input" type="number" inputMode="numeric" min={1} max={500} value={x.seats} onChange={(e) => setX({ ...x, seats: Number(e.target.value) })} style={INPUT} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {hourSelect("Opens", x.openFrom, OPEN_FROM, (v) => setX({ ...x, openFrom: v }))}
            {hourSelect("Closes", x.openTo, OPEN_TO, (v) => setX({ ...x, openTo: v }))}
          </div>
          <div>
            <div style={{ marginBottom: 6, ...LABEL }}>Open days</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = x.days.includes(d);
                return <button key={d} type="button" role="checkbox" aria-checked={on} aria-label={WD[d]} onClick={() => setX({ ...x, days: toggle(x.days, d) })} style={{ ...BTN, ...chipCss(on), height: 40, borderRadius: 10, fontSize: 12 }}>{WD[d].slice(0, 2)}</button>;
              })}
            </div>
          </div>
          <div>
            <div style={{ marginBottom: 6, ...LABEL }}>Equipment</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EQUIPMENT.map((q) => {
                const on = x.equipment.includes(q);
                return <button key={q} type="button" role="checkbox" aria-checked={on} onClick={() => setX({ ...x, equipment: toggle(x.equipment, q) })} style={{ ...BTN, ...chipCss(on), height: 34, padding: "0 12px", borderRadius: 999, fontSize: 12.5, display: "flex", alignItems: "center", gap: 5 }}>{on ? <Check size={12} strokeWidth={2.8} /> : null}{q}</button>;
              })}
            </div>
          </div>
          <div>
            <div style={{ marginBottom: 6, ...LABEL }}>Colour in the calendar</div>
            <div role="radiogroup" aria-label="Colour" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {ROOM_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={x.color === c} aria-label={`Colour ${c}`} onClick={() => setX({ ...x, color: c })}
                  style={{ ...BTN, width: 36, height: 36, borderRadius: "50%", background: c, boxShadow: x.color === c ? `0 0 0 3px var(--c-paper), 0 0 0 5px ${c}` : "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF" }}>
                  {x.color === c ? <Check size={16} strokeWidth={3} /> : null}
                </button>
              ))}
            </div>
          </div>
          <div style={RINGCARD}>
            {rules.map(([l, list, key], i) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: rowTop(i) }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{l}</span>
                <button type="button" aria-label={`Less: ${l.toLowerCase()}`} onClick={() => setX({ ...x, [key]: stepOption(list, x[key], -1) })} style={{ ...BTN, width: 34, height: 34, borderRadius: "50%", background: C.paper, boxShadow: SH.ring, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={14} strokeWidth={2.4} /></button>
                <span style={{ minWidth: 72, textAlign: "center", fontSize: 13.5, fontWeight: 800, ...NUM }}>{optionLabel(list, x[key])}</span>
                <button type="button" aria-label={`More: ${l.toLowerCase()}`} onClick={() => setX({ ...x, [key]: stepOption(list, x[key], 1) })} style={{ ...BTN, width: 34, height: 34, borderRadius: "50%", background: C.paper, boxShadow: SH.ring, color: C.gold, display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={14} strokeWidth={2.4} /></button>
              </div>
            ))}
          </div>
          <div>
            <div style={{ marginBottom: 6, ...LABEL }}>Closed dates <span style={{ fontWeight: 500, color: C.faint }}>repairs, events, holidays</span></div>
            <div style={{ display: "grid", gap: 6 }}>
              {x.closures.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 12px", borderRadius: 12, background: C.card, boxShadow: SH.panel }}>
                  <CalendarX size={14} strokeWidth={2} color="var(--c-note)" style={{ flex: "none" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}><b>{dayRange(c.from, c.to)}</b>{c.reason ? ` · ${c.reason}` : ""}</span>
                  <button type="button" aria-label={`Remove closed dates ${dayRange(c.from, c.to)}`} onClick={() => setX({ ...x, closures: x.closures.filter((_, j) => j !== i) })} style={{ ...BTN, width: 36, height: 36, background: "none", color: C.faint, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} strokeWidth={2} /></button>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 6 }}>
                <input type="date" aria-label="Closed from" value={cl.from} onChange={(e) => setCl({ ...cl, from: e.target.value })} style={{ ...INPUT, height: 42, padding: "0 8px", fontSize: 14, colorScheme: "light dark" }} />
                <input type="date" aria-label="Closed to" value={cl.to} min={cl.from || undefined} onChange={(e) => setCl({ ...cl, to: e.target.value })} style={{ ...INPUT, height: 42, padding: "0 8px", fontSize: 14, colorScheme: "light dark" }} />
                <input className="c-input" aria-label="Reason" placeholder="Reason" value={cl.reason} onChange={(e) => setCl({ ...cl, reason: e.target.value })} style={{ ...INPUT, height: 42, padding: "0 10px" }} />
                <button type="button" disabled={!cl.from} onClick={() => { setX({ ...x, closures: [...x.closures, { from: cl.from, to: cl.to && cl.to >= cl.from ? cl.to : cl.from, reason: cl.reason.trim() }] }); setCl({ from: "", to: "", reason: "" }); }}
                  style={{ ...BTN, height: 42, padding: "0 12px", borderRadius: 10, background: "#6B5C32", color: "#FFFFFF", fontSize: 12.5, fontWeight: 700, opacity: cl.from ? 1 : 0.55 }}>Add</button>
              </div>
            </div>
          </div>
          {error ? <ErrorBox icon={AlertCircle}>{error}</ErrorBox> : null}
        </div>
      </Column>
      <BottomBar>
        <div style={{ padding: "12px 16px calc(12px + env(safe-area-inset-bottom))" }}>
          <PrimaryButton busy={saving} onClick={save}>{x.id ? "Save room" : "Add room"}</PrimaryButton>
        </div>
      </BottomBar>
    </div>
  );
}
