// ===========================================================================
// 3PL Providers — the prototype's full-page forms: provider (new / edit, with
// its STATE RATE CARD / VEHICLES / DRIVERS links), State Rate Card, vehicle
// and driver. Forms stack: a vehicle opened from the provider form returns to
// it (the provider draft stays mounted underneath). Every save calls the
// existing endpoint; the server's error text is shown as-is.
// ===========================================================================
import { useState } from "react";
import { MapPinned, RotateCcw, Trash2, Truck, UserRound } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { MALAYSIA_STATES } from "@/lib/malaysia-states";
import {
  AreaField, Banner, HeadRow, LinkGroup, NoteBox, SegField, Spinner, TextField, TplDialog, TplPage, type DialogSpec,
} from "./tpl-kit";
import {
  autoCapacity, dimError, driversUrl, fmt2, invalidate3pl, isDecimal, isMoney, listOf, PRICING_RULE, providerUrl, ratesUrl, rm, send, senText,
  served, toDriver, toRates, toSen, toVehicle, vehiclesUrl, type Driver, type Envelope, type Provider, type ProviderStatus, type StateRate,
  type UnitStatus, type Vehicle,
} from "./tpl-lib";
import type { TplPerms } from "./tpl-perms";
import { X } from "./tpl-style";
import type { TplToastTone } from "./tpl-toast";

export type Frame =
  | { kind: "prov"; provider: Provider | null }
  | { kind: "rates"; provider: Provider }
  | { kind: "veh"; provider: Provider; vehicle: Vehicle | null }
  | { kind: "drv"; provider: Provider; driver: Driver | null };

type Ctx = {
  perms: TplPerms;
  toast: (m: string, tone?: TplToastTone) => void;
  push: (f: Frame) => void;
  pop: () => void;
  onCreated?: (id: string) => void;
};

export function FormStack({ frames, ctx }: { frames: Frame[]; ctx: Ctx }) {
  return (
    <>
      {frames.map((f, i) => {
        const active = i === frames.length - 1;
        const key = `${i}-${f.kind}`;
        if (f.kind === "prov") return <ProviderForm key={key} provider={f.provider} active={active} ctx={ctx} />;
        if (f.kind === "rates") return <RatesForm key={key} provider={f.provider} active={active} ctx={ctx} />;
        if (f.kind === "veh") return <VehicleForm key={key} provider={f.provider} vehicle={f.vehicle} active={active} ctx={ctx} />;
        return <DriverForm key={key} provider={f.provider} driver={f.driver} active={active} ctx={ctx} />;
      })}
    </>
  );
}

// ---- shared draft state ------------------------------------------------------------
function useDraft<T extends Record<string, unknown>>(init: T) {
  const [base] = useState(() => JSON.stringify(init));
  const [v, setV] = useState(init);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dlg, setDlg] = useState<DialogSpec | null>(null);
  const dirty = JSON.stringify(v) !== base;
  const set = (o: Partial<T>) => setV((x) => ({ ...x, ...o }));
  return { v, set, setV, dirty, tried, setTried, busy, setBusy, err, setErr, dlg, setDlg };
}

function useCancel(d: { dirty: boolean; busy: boolean; setDlg: (s: DialogSpec | null) => void }, pop: () => void) {
  return () => {
    if (d.busy) return;
    if (d.dirty) d.setDlg({ title: "Discard changes?", body: "What you've changed won't be saved.", okL: "Discard", danger: true, icon: Trash2, onOk: pop });
    else pop();
  };
}

function DiscardDialog({ spec, close }: { spec: DialogSpec | null; close: () => void }) {
  return (
    <TplDialog
      spec={spec}
      onCancel={close}
      onOk={() => {
        const fn = spec?.onOk;
        close();
        void fn?.();
      }}
    />
  );
}

// ---- provider ------------------------------------------------------------------------
function ProviderForm({ provider: p, active, ctx }: { provider: Provider | null; active: boolean; ctx: Ctx }) {
  const d = useDraft({
    name: p?.name ?? "",
    contactPerson: p?.contactPerson ?? "",
    phone: p?.phone ?? "",
    status: (p?.status ?? "ACTIVE") as ProviderStatus,
    remarks: p?.remarks ?? "",
  });
  const e: Record<string, string> = {};
  if (!d.v.name.trim()) e.name = "Provider name is required.";
  if (!d.v.phone.trim()) e.phone = "Phone is required.";
  const show = d.tried ? e : {};
  const cancel = useCancel(d, ctx.pop);

  const save = async () => {
    if (Object.keys(e).length) {
      d.setTried(true);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    const body = { name: d.v.name.trim(), phone: d.v.phone.trim(), contactPerson: d.v.contactPerson.trim(), status: d.v.status, remarks: d.v.remarks };
    const r = p ? await send(providerUrl(p.id), "PUT", body) : await send("/api/drivers", "POST", body);
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidate3pl();
    ctx.pop();
    ctx.toast(p ? "Provider saved" : "Provider created");
    if (!p && r.data && typeof r.data.id === "string") ctx.onCreated?.(r.data.id);
  };

  return (
    <TplPage
      title={p ? "Edit provider" : "New provider"}
      dirty={d.dirty}
      err={d.err || (d.tried && Object.keys(e).length ? "Check the highlighted fields." : "")}
      active={active && !d.dlg}
      onCancel={cancel}
      saveL={p ? "Save changes" : "Create provider"}
      busy={d.busy}
      onSave={() => void save()}
    >
      <TextField l="Name *" v={d.v.name} on={(name) => d.set({ name })} ph="e.g. Kargo Laju Sdn Bhd" err={show.name} />
      <TextField l="Contact person" v={d.v.contactPerson} on={(contactPerson) => d.set({ contactPerson })} ph="Dispatcher or account manager" />
      <TextField l="Phone *" mode="tel" v={d.v.phone} on={(phone) => d.set({ phone })} ph="012-345 6789" err={show.phone} />
      <SegField l="Status" v={d.v.status} on={(status) => d.set({ status })} opts={["ACTIVE", "INACTIVE", "ON_LEAVE"]} />
      {d.v.status !== "ACTIVE" ? <NoteBox>{d.v.status === "ON_LEAVE" ? "On Leave" : "Inactive"} providers can't be picked for new deliveries.</NoteBox> : null}
      <AreaField l="Remarks" v={d.v.remarks} on={(remarks) => d.set({ remarks })} ph="Optional" />
      {p ? <ProviderLinks p={p} ctx={ctx} /> : <NoteBox>After saving, edit the provider to set its rate card, vehicles and drivers.</NoteBox>}
      <DiscardDialog spec={d.dlg} close={() => d.setDlg(null)} />
    </TplPage>
  );
}

function ProviderLinks({ p, ctx }: { p: Provider; ctx: Ctx }) {
  const rates = useCachedJson<Envelope>(ratesUrl(p.id));
  const veh = useCachedJson<Envelope>(vehiclesUrl(p.id));
  const drv = useCachedJson<Envelope>(driversUrl(p.id));
  const rated = rates.data ? toRates(rates.data.data).filter(served) : null;
  const vehicles = listOf(veh.data, toVehicle);
  const drivers = listOf(drv.data, toDriver);
  const viewOnly = () => ctx.toast("View only", "neu");
  const st = (s: UnitStatus): ProviderStatus => s;
  const ratedCodes = rated ?? MALAYSIA_STATES.filter((s) => p.ratedStates.includes(s.code)).map((s) => ({ state: s.code }));
  return (
    <>
      <LinkGroup
        t="STATE RATE CARD"
        rows={[{
          key: "rates",
          l: ratedCodes.length ? ratedCodes.map((r) => r.state).join(" · ") : "No states set",
          s: ratedCodes.length ? `${ratedCodes.length} of 16 states · not used to price DOs yet` : "Tap to set trip and extra-drop rates",
          icon: MapPinned,
          onTap: () => (ctx.perms.rates ? ctx.push({ kind: "rates", provider: p }) : viewOnly()),
        }]}
      />
      <LinkGroup
        t={veh.data ? `VEHICLES · ${vehicles.length}` : "VEHICLES"}
        note={veh.loading && !veh.data ? "Loading vehicles…" : veh.error && !veh.data ? "Couldn't load vehicles." : "No vehicles yet."}
        rows={vehicles.map((v) => ({
          key: v.id,
          l: v.plateNo,
          s: [v.vehicleType, v.capacityM3 ? `${fmt2(v.capacityM3)} m³` : "", v.ratePerTripSen ? `${rm(v.ratePerTripSen)}/trip` : ""].filter(Boolean).join(" · ") || "No details",
          icon: Truck,
          status: st(v.status),
          onTap: () => (ctx.perms.vehUpdate ? ctx.push({ kind: "veh", provider: p, vehicle: v }) : viewOnly()),
        }))}
        add={ctx.perms.vehCreate ? { l: "Add vehicle", onTap: () => ctx.push({ kind: "veh", provider: p, vehicle: null }) } : null}
      />
      <LinkGroup
        t={drv.data ? `DRIVERS · ${drivers.length}` : "DRIVERS"}
        note={drv.loading && !drv.data ? "Loading drivers…" : drv.error && !drv.data ? "Couldn't load drivers." : "No drivers yet."}
        rows={drivers.map((x) => ({
          key: x.id,
          l: x.name,
          s: x.phone || "No phone",
          icon: UserRound,
          status: st(x.status),
          onTap: () => (ctx.perms.drvUpdate ? ctx.push({ kind: "drv", provider: p, driver: x }) : viewOnly()),
        }))}
        add={ctx.perms.drvCreate ? { l: "Add driver", onTap: () => ctx.push({ kind: "drv", provider: p, driver: null }) } : null}
      />
    </>
  );
}

// ---- state rate card ----------------------------------------------------------------
function RatesForm({ provider: p, active, ctx }: { provider: Provider; active: boolean; ctx: Ctx }) {
  const res = useCachedJson<Envelope>(ratesUrl(p.id), 0);
  const ready = !!res.data;
  if (!ready) {
    return (
      <TplPage title="State Rate Card" sub={p.name} dirty={false} active={active} onCancel={ctx.pop} saveL="Save rate card" busy={false} disabled onSave={() => undefined}>
        {res.error && !res.loading ? (
          <div style={{ display: "grid", gap: 10 }}>
            <Banner icon={RotateCcw} tone="bad">Couldn't load the rate card. {res.error}</Banner>
            <button type="button" onClick={() => res.refresh()} style={{ height: 44, borderRadius: 999, border: "none", background: X.grad, color: "#FFFFFF", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
              Try again
            </button>
          </div>
        ) : (
          <div aria-busy="true" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "40px 0", color: X.mut, fontSize: 13 }}>
            <Spinner light={false} /> Loading rate card…
          </div>
        )}
      </TplPage>
    );
  }
  return <RatesGrid p={p} rates={toRates(res.data?.data)} active={active} ctx={ctx} />;
}

function RatesGrid({ p, rates, active, ctx }: { p: Provider; rates: StateRate[]; active: boolean; ctx: Ctx }) {
  const d = useDraft(Object.fromEntries(rates.map((r) => [r.state, { t: senText(r.tripSen), d: senText(r.dropSen) }])) as Record<string, { t: string; d: string }>);
  const bad = new Set<string>();
  for (const s of MALAYSIA_STATES) for (const k of ["t", "d"] as const) if (d.v[s.code][k].trim() !== "" && !isMoney(d.v[s.code][k])) bad.add(s.code + k);
  const cancel = useCancel(d, ctx.pop);
  const save = async () => {
    if (bad.size) {
      d.setTried(true);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    // All 16 states, cleared ones as 0/0 (desktop saveStateRates).
    const body = { providerId: p.id, rates: MALAYSIA_STATES.map((s) => ({ state: s.code, ratePerTripSen: toSen(d.v[s.code].t), ratePerExtraDropSen: toSen(d.v[s.code].d) })) };
    const r = await send("/api/three-pl-state-rates/bulk", "PUT", body);
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidate3pl();
    ctx.pop();
    ctx.toast("Rate card saved");
  };
  const cols = "minmax(0,1fr) 104px 104px";
  return (
    <TplPage
      title="State Rate Card"
      sub={p.name}
      dirty={d.dirty}
      err={d.err || (d.tried && bad.size ? "Some amounts aren't valid. Use numbers like 250.00." : "")}
      active={active && !d.dlg}
      onCancel={cancel}
      saveL="Save rate card"
      busy={d.busy}
      onSave={() => void save()}
    >
      <NoteBox>The State Rate Card is not used to price Delivery Orders yet. {PRICING_RULE}</NoteBox>
      <div style={{ borderRadius: 16, background: X.card, boxShadow: `0 0 0 1px ${X.ring},0 10px 22px -14px ${X.shd}`, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, padding: "9px 12px", background: X.tint, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: X.br, textTransform: "uppercase" }}>
          <span>State</span>
          <span style={{ textAlign: "right" }}>Base / trip</span>
          <span style={{ textAlign: "right" }}>Per extra drop</span>
        </div>
        {MALAYSIA_STATES.map((s) => {
          const r = d.v[s.code];
          const on = (Number(r.t.replace(/,/g, "")) || 0) > 0 || (Number(r.d.replace(/,/g, "")) || 0) > 0;
          return (
            <div key={s.code} style={{ display: "grid", gridTemplateColumns: cols, gap: 6, alignItems: "center", padding: "7px 12px", borderTop: `1px solid ${X.ln}`, background: on ? "transparent" : X.bg }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>{s.label}</span>
                <span style={{ display: "block", fontSize: 10.5, color: on ? X.ok : X.mut, fontWeight: 600 }}>{on ? "Served" : "Not served"}</span>
              </span>
              {(["t", "d"] as const).map((k) => (
                <label key={k} style={{ display: "flex", alignItems: "center", height: 40, padding: "0 8px", borderRadius: 10, background: X.inp, boxShadow: d.tried && bad.has(s.code + k) ? `0 0 0 1.5px ${X.bad}` : `0 0 0 1px ${X.ln}`, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, color: X.mut, marginRight: 4 }}>RM</span>
                  <input
                    className="tpl-in"
                    inputMode="decimal"
                    value={r[k]}
                    onChange={(e) => {
                      const val = e.target.value;
                      d.setV((x) => ({ ...x, [s.code]: { ...x[s.code], [k]: val } }));
                    }}
                    placeholder="—"
                    aria-label={`${s.label} ${k === "t" ? "base per trip" : "per extra drop"}`}
                    style={{ flex: 1, minWidth: 0, width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 15, color: X.ink, padding: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                  />
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <NoteBox>Leave both blank, or 0, for states this provider doesn't serve.</NoteBox>
      <DiscardDialog spec={d.dlg} close={() => d.setDlg(null)} />
    </TplPage>
  );
}

// ---- vehicle ----------------------------------------------------------------------------
const dimText = (n: number | null) => (n == null || !n ? "" : String(n));

function VehicleForm({ provider: p, vehicle: x, active, ctx }: { provider: Provider; vehicle: Vehicle | null; active: boolean; ctx: Ctx }) {
  const d = useDraft({
    plateNo: x?.plateNo ?? "",
    vehicleType: x?.vehicleType ?? "",
    L: dimText(x?.boxLengthFt ?? null),
    W: dimText(x?.boxWidthFt ?? null),
    H: dimText(x?.boxHeightFt ?? null),
    cap: x?.capacityM3 ? String(x.capacityM3) : "",
    rt: senText(x?.ratePerTripSen ?? 0),
    rd: senText(x?.ratePerExtraDropSen ?? 0),
    status: (x?.status ?? "ACTIVE") as UnitStatus,
    remarks: x?.remarks ?? "",
  });
  const v = d.v;
  const setDim = (k: "L" | "W" | "H", val: string) =>
    d.setV((o) => {
      const n = { ...o, [k]: val };
      const cap = autoCapacity(n.L, n.W, n.H);
      return cap ? { ...n, cap } : n;
    });
  const e: Record<string, string> = {};
  if (!v.plateNo.trim()) e.plateNo = "Plate number is required.";
  for (const k of ["L", "W", "H"] as const) {
    const m = dimError(v[k]);
    if (m) e[k] = m;
  }
  if (v.cap.trim() !== "" && !isDecimal(v.cap)) e.cap = "Enter a number like 7.50.";
  for (const k of ["rt", "rd"] as const) if (v[k].trim() !== "" && !isMoney(v[k])) e[k] = "Enter an amount like 250.00.";
  const show = d.tried ? e : {};
  const dimsErr = show.L || show.W || show.H ? `Box sizes: ${[show.L && `length ${show.L.toLowerCase()}`, show.W && `width ${show.W.toLowerCase()}`, show.H && `height ${show.H.toLowerCase()}`].filter(Boolean).join(", ")}.` : "";
  const all = v.L !== "" && v.W !== "" && v.H !== "";
  const cancel = useCancel(d, ctx.pop);

  const save = async () => {
    if (Object.keys(e).length) {
      d.setTried(true);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    const dim = (s: string) => (s.trim() === "" ? null : Number(s));
    const body = {
      providerId: p.id,
      plateNo: v.plateNo.trim(), // stored as typed — the server keeps plate_no verbatim
      vehicleType: v.vehicleType.trim(),
      capacityM3: Number(v.cap) || 0,
      ratePerTripSen: toSen(v.rt),
      ratePerExtraDropSen: toSen(v.rd),
      status: v.status,
      remarks: v.remarks,
      boxLengthFt: dim(v.L),
      boxWidthFt: dim(v.W),
      boxHeightFt: dim(v.H),
    };
    const r = x ? await send(`/api/three-pl-vehicles/${encodeURIComponent(x.id)}`, "PUT", body) : await send("/api/three-pl-vehicles", "POST", body);
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidate3pl();
    ctx.pop();
    ctx.toast(x ? "Vehicle saved" : "Vehicle added");
  };

  const dimBox = (k: "L" | "W" | "H", aria: string) => (
    <label key={k} style={{ display: "flex", alignItems: "center", height: 46, padding: "0 10px", borderRadius: 12, background: X.inp, boxShadow: show[k] ? `0 0 0 1.5px ${X.bad}` : `0 0 0 1px ${X.ln}`, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: X.mut, marginRight: 6 }}>{k}</span>
      <input className="tpl-in" inputMode="decimal" value={v[k]} onChange={(ev) => setDim(k, ev.target.value)} placeholder="0.00" aria-label={`${aria} in feet`} aria-invalid={show[k] ? true : undefined}
        style={{ flex: 1, minWidth: 0, width: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: X.ink, padding: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
    </label>
  );

  return (
    <TplPage
      title={x ? "Edit vehicle" : "Add vehicle"}
      sub={p.name}
      dirty={d.dirty}
      err={d.err || (d.tried && Object.keys(e).length ? "Check the highlighted fields." : "")}
      active={active && !d.dlg}
      onCancel={cancel}
      saveL={x ? "Save changes" : "Add vehicle"}
      busy={d.busy}
      onSave={() => void save()}
    >
      <HeadRow>VEHICLE</HeadRow>
      <TextField l="Plate number *" v={v.plateNo} on={(plateNo) => d.set({ plateNo })} ph="e.g. WXB 4821" err={show.plateNo} />
      <TextField l="Type" v={v.vehicleType} on={(vehicleType) => d.set({ vehicleType })} ph="e.g. 3-ton lorry" />
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12.5, fontWeight: 700 }}>
          Cargo box (ft)<span style={{ fontWeight: 500, color: X.mut }}>optional</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
          {dimBox("L", "Length")}
          {dimBox("W", "Width")}
          {dimBox("H", "Height")}
        </div>
        {dimsErr ? <div style={{ marginTop: 5, fontSize: 11.5, color: X.bad }}>{dimsErr}</div> : null}
        <div style={{ marginTop: 5, fontSize: 11.5, color: X.mut, lineHeight: 1.4 }}>
          {all ? "Capacity fills in from the box size. If you change it by hand, it's replaced the next time a box size changes." : "Fill all three to work out capacity automatically. Each must be more than 0 and under 100 ft."}
        </div>
      </div>
      <TextField l="Capacity" mode="decimal" suf="m³" right ph="0.00" v={v.cap} on={(cap) => d.set({ cap })} err={show.cap}
        help={all ? "Worked out from the box size (ft³ → m³)." : "Enter by hand while any box size is missing."} />
      <HeadRow>OVERRIDE RATES</HeadRow>
      <TextField l="Rate per trip" mode="decimal" pre="RM" right ph="0.00" v={v.rt} on={(rt) => d.set({ rt })} err={show.rt} />
      <TextField l="Rate per extra drop" mode="decimal" pre="RM" right ph="0.00" v={v.rd} on={(rd) => d.set({ rd })} err={show.rd} help={PRICING_RULE} />
      <HeadRow>STATUS</HeadRow>
      <SegField l="Status" v={v.status} on={(status) => d.set({ status })} opts={["ACTIVE", "INACTIVE"] as UnitStatus[]} />
      <AreaField l="Remarks" v={v.remarks} on={(remarks) => d.set({ remarks })} ph="Optional" />
      <DiscardDialog spec={d.dlg} close={() => d.setDlg(null)} />
    </TplPage>
  );
}

// ---- driver ---------------------------------------------------------------------------
function DriverForm({ provider: p, driver: x, active, ctx }: { provider: Provider; driver: Driver | null; active: boolean; ctx: Ctx }) {
  const d = useDraft({ name: x?.name ?? "", phone: x?.phone ?? "", status: (x?.status ?? "ACTIVE") as UnitStatus });
  const e: Record<string, string> = {};
  if (!d.v.name.trim()) e.name = "Driver name is required.";
  const show = d.tried ? e : {};
  const cancel = useCancel(d, ctx.pop);
  const save = async () => {
    if (Object.keys(e).length) {
      d.setTried(true);
      return;
    }
    d.setBusy(true);
    d.setErr("");
    const body = { providerId: p.id, name: d.v.name.trim(), phone: d.v.phone.trim(), status: d.v.status };
    const r = x ? await send(`/api/three-pl-drivers/${encodeURIComponent(x.id)}`, "PUT", body) : await send("/api/three-pl-drivers", "POST", body);
    d.setBusy(false);
    if (!r.ok) {
      d.setErr(r.error);
      return;
    }
    invalidate3pl();
    ctx.pop();
    ctx.toast(x ? "Driver saved" : "Driver added");
  };
  return (
    <TplPage
      title={x ? "Edit driver" : "Add driver"}
      sub={p.name}
      dirty={d.dirty}
      err={d.err || (d.tried && Object.keys(e).length ? "Check the highlighted fields." : "")}
      active={active && !d.dlg}
      onCancel={cancel}
      saveL={x ? "Save changes" : "Add driver"}
      busy={d.busy}
      onSave={() => void save()}
    >
      <TextField l="Name *" v={d.v.name} on={(name) => d.set({ name })} ph="Full name" err={show.name} />
      <TextField l="Phone" mode="tel" v={d.v.phone} on={(phone) => d.set({ phone })} ph="012-345 6789" />
      <SegField l="Status" v={d.v.status} on={(status) => d.set({ status })} opts={["ACTIVE", "INACTIVE"] as UnitStatus[]} />
      <DiscardDialog spec={d.dlg} close={() => d.setDlg(null)} />
    </TplPage>
  );
}

