// ===========================================================================
// Delivery create sheets — the desktop dialogs, laid out as the Claude Design
// `Delivery.dc.html` sheets:
//   • Create Delivery Order   (index.tsx openCreateDODialog / confirmCreateDO)
//   • Create Packing List     (openPlFirstDialog / confirmCreatePlFirst — the
//     server preview decides the split; the phone never guesses it)
//   • Packing list from DOs   (handlePrintPackingList /
//     handleConfirmCreatePackingList)
// Same endpoints, bodies, optional/required fields, credit-override retry and
// Idempotency-Key as desktop. Drag-reordering drops stays on desktop.
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { useCachedJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import { useIdempotencyKey } from "@/lib/idempotency-key";
import { isCreditBlock } from "@/pages/delivery/credit-override";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import { mutateJson } from "../../config/mutate";
import {
  EMPTY_CREATE_FORM, PL_FROM_DOS_LINES, buildDrops, createDoBody, estDeliveryCostSen, oneCustomerError, plFirstBody, plFirstCostSen, rows, s, n,
  type CreateDoForm, type Hub, type RawRow,
} from "../../lib/do-mobile";
import type { AskCredit } from "./actions";
import { refreshDeliveryCaches } from "./actions";
import { ConfirmLines, FieldLabel, Notice, RadioRow, SelectField, SheetFooter, SheetSub } from "./ui";
import { DL, INPUT, SHADOW_FIELD } from "./ui-tokens";

type Envelope = { success?: boolean; data?: RawRow[] };

// ---------------------------------------------------------------------------
// Provider → vehicle → driver pickers (shared by all three sheets).
// ---------------------------------------------------------------------------
function useFleet(open: boolean, providerId: string) {
  const providers = useCachedJson<Envelope>(open ? "/api/drivers" : null);
  const vehicles = useCachedJson<Envelope>(open && providerId ? `/api/three-pl-vehicles?providerId=${encodeURIComponent(providerId)}` : null);
  const drivers = useCachedJson<Envelope>(open && providerId ? `/api/three-pl-drivers?providerId=${encodeURIComponent(providerId)}` : null);
  return {
    providers: rows(providers.data?.data).filter((p) => s(p, "status") === "ACTIVE"),
    providersLoading: providers.loading && !providers.data,
    vehicles: rows(vehicles.data?.data).filter((v) => s(v, "status") === "ACTIVE"),
    drivers: rows(drivers.data?.data).filter((d) => s(d, "status") === "ACTIVE"),
  };
}

function FleetFields({
  form,
  setForm,
  fleet,
  providerRequired,
}: {
  form: CreateDoForm;
  setForm: (f: CreateDoForm) => void;
  fleet: ReturnType<typeof useFleet>;
  providerRequired?: boolean;
}) {
  return (
    <>
      <div>
        <FieldLabel required={providerRequired} optional={!providerRequired}>3PL Provider</FieldLabel>
        {fleet.providersLoading ? (
          <div style={{ fontSize: 12.5, color: M.ink }}>Loading providers…</div>
        ) : fleet.providers.length === 0 ? (
          <div style={{ fontSize: 12.5, color: M.ink }}>No active 3PL providers. Add one on desktop.</div>
        ) : (
          <div role="radiogroup" aria-label="3PL provider" style={{ display: "grid", gap: 6 }}>
            {fleet.providers.map((p) => {
              const on = form.providerId === s(p, "id");
              return (
                <RadioRow
                  key={s(p, "id")}
                  on={on}
                  label={s(p, "name")}
                  // Optional on Create DO: tapping the picked provider clears it.
                  onClick={() => setForm({ ...form, providerId: on && !providerRequired ? "" : s(p, "id"), vehicleId: "", driverPersonId: "" })}
                />
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <label style={{ display: "block", minWidth: 0 }}>
          <FieldLabel>Vehicle</FieldLabel>
          <SelectField ariaLabel="Vehicle" value={form.vehicleId} disabled={!form.providerId} onChange={(v) => setForm({ ...form, vehicleId: v })}>
            <option value="">{form.providerId ? "Optional" : "Pick provider"}</option>
            {fleet.vehicles.map((v) => (
              <option key={s(v, "id")} value={s(v, "id")}>
                {s(v, "plateNo")} — {s(v, "vehicleType") || "—"} (RM{(n(v, "ratePerTripSen") / 100).toFixed(0)}/trip)
              </option>
            ))}
          </SelectField>
        </label>
        <label style={{ display: "block", minWidth: 0 }}>
          <FieldLabel>Driver</FieldLabel>
          <SelectField ariaLabel="Driver" value={form.driverPersonId} disabled={!form.providerId} onChange={(v) => setForm({ ...form, driverPersonId: v })}>
            <option value="">Optional</option>
            {fleet.drivers.map((d) => (
              <option key={s(d, "id")} value={s(d, "id")}>
                {s(d, "name")}{s(d, "phone") ? ` — ${s(d, "phone")}` : ""}
              </option>
            ))}
          </SelectField>
        </label>
      </div>
    </>
  );
}

function DateRemarks({ form, setForm }: { form: CreateDoForm; setForm: (f: CreateDoForm) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
      <label style={{ display: "block", minWidth: 0 }}>
        <FieldLabel>Delivery date</FieldLabel>
        <input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} style={{ ...INPUT, padding: "0 10px", fontSize: 15 }} />
      </label>
      <label style={{ display: "block", minWidth: 0 }}>
        <FieldLabel>Remarks</FieldLabel>
        <input className="dl-input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} style={{ ...INPUT, padding: "0 12px" }} />
      </label>
    </div>
  );
}

/** Prototype est.-cost row: track background, label left, value right. */
function CostRow({ value }: { value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 13px", borderRadius: 12, background: DL.track }}>
      <span style={{ fontSize: 12.5, color: M.ink }}>Est. delivery cost</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{value}</span>
    </div>
  );
}

/** Prototype items box (#E0EDF0 / #3E6570 / #2F5560). */
function ItemsBox({ pos }: { pos: RawRow[] }) {
  return (
    <div style={{ background: DL.itemsBg, borderRadius: 14, padding: "11px 13px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: DL.itemsTitle, marginBottom: 6 }}>Items ({pos.length})</div>
      <div style={{ maxHeight: 140, overflowY: "auto" }}>
        {pos.map((po) => (
          <div key={s(po, "id")} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: DL.itemsRow, padding: "2px 0" }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s(po, "productCode")} — {s(po, "sizeLabel") || "—"}
            </span>
            <span style={{ flex: "none" }}>
              {s(po, "customerName").split(" ")[0]} · Qty {n(po, "quantity")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Prototype destination / new-DO card. */
function DropCard({ name, right, children }: { name: string; right: string; children: React.ReactNode }) {
  return (
    <div style={{ background: M.card, borderRadius: 12, padding: "10px 12px", boxShadow: SHADOW_FIELD }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: M.raisin, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <span style={{ fontSize: 11.5, color: M.ink, flex: "none", fontVariantNumeric: "tabular-nums" }}>{right}</span>
      </div>
      {children}
    </div>
  );
}

function rated(r: RawRow | undefined) {
  return r ? { ratePerTripSen: n(r, "ratePerTripSen"), ratePerExtraDropSen: n(r, "ratePerExtraDropSen") } : null;
}

// ---------------------------------------------------------------------------
// Create Delivery Order
// ---------------------------------------------------------------------------
export function CreateDoSheet({
  open,
  pos,
  onClose,
  onCreated,
  askCredit,
}: {
  open: boolean;
  pos: RawRow[];
  onClose: () => void;
  onCreated: (message: string) => void;
  askCredit: AskCredit;
}) {
  const [form, setForm] = useState<CreateDoForm>(EMPTY_CREATE_FORM);
  const [hubPick, setHubPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fleet = useFleet(open, form.providerId);
  const customers = useCachedJson<Envelope>(open ? "/api/customers" : null);
  const idem = useIdempotencyKey();

  // Reset whenever the sheet opens on a new selection.
  const openKey = open ? pos.map((p) => s(p, "id")).join(",") : "";
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    setForm(EMPTY_CREATE_FORM);
    setHubPick({});
    setErr(null);
  }

  const hubsByCustomer = useMemo(() => {
    const m: Record<string, Hub[]> = {};
    for (const c of rows(customers.data?.data)) m[s(c, "id")] = rows(c.deliveryHubs) as unknown as Hub[];
    return m;
  }, [customers.data]);

  const drops = useMemo(
    () =>
      buildDrops(pos, hubsByCustomer).map((d, i) => {
        const picked = hubPick[`${d.customerId}#${i}`];
        const hub = picked ? (hubsByCustomer[d.customerId] ?? []).find((h) => h.id === picked) : undefined;
        return hub ? { ...d, hubId: hub.id, address: hub.address || "", contactName: hub.contactName || "", contactPhone: hub.phone || "" } : d;
      }),
    [pos, hubsByCustomer, hubPick],
  );

  const vehicle = fleet.vehicles.find((v) => s(v, "id") === form.vehicleId);
  const provider = fleet.providers.find((p) => s(p, "id") === form.providerId);
  const cost = estDeliveryCostSen(drops.length, rated(vehicle), rated(provider));

  const submit = async () => {
    if (busy) return;
    const guard = oneCustomerError(pos);
    if (guard) {
      setErr(guard);
      return;
    }
    const poIds = pos.map((p) => s(p, "id"));
    if (!poIds.length) return;
    setBusy(true);
    setErr(null);
    const body = createDoBody(poIds, form, drops);
    const post = (b: Record<string, unknown>) =>
      idem.withKey((key) => mutateJson<{ data?: { id?: string; doNo?: string } }>("/api/delivery-orders", "POST", b, { "Idempotency-Key": key }));
    let res = await post(body);
    if (!res.ok && isCreditBlock(res.body)) {
      const reason = await askCredit(res.body);
      if (!reason) {
        setBusy(false);
        return;
      }
      res = await post({ ...body, creditOverride: { reason } });
    }
    setBusy(false);
    if (!res.ok) {
      setErr(res.error || "Failed to create delivery order");
      return;
    }
    refreshDeliveryCaches();
    const doNo = res.body?.data?.doNo;
    onCreated(doNo ? `${doNo} created in Pending Dispatch` : "Delivery order created in Pending Dispatch");
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Create Delivery Order">
      <SheetSub>Assign 3PL provider, delivery address, and generate DO</SheetSub>
      <div style={{ display: "grid", gap: 14 }}>
        <ItemsBox pos={pos} />
        <FleetFields form={form} setForm={setForm} fleet={fleet} />
        <div>
          <FieldLabel>
            Delivery destinations ({drops.length} drop{drops.length === 1 ? "" : "s"})
          </FieldLabel>
          {customers.loading && !customers.data ? (
            <div style={{ fontSize: 12.5, color: M.ink }}>Loading delivery hubs…</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {drops.map((d, i) => {
                const hubs = hubsByCustomer[d.customerId] ?? [];
                return (
                  <DropCard key={`${d.customerId}-${i}`} name={drops.length > 1 ? `Drop ${i + 1} · ${d.customerName}` : d.customerName} right={`${d.poIds.length} item(s)`}>
                    <div style={{ marginTop: 6 }}>
                      <SelectField
                        bare
                        ariaLabel={`Hub for ${d.customerName}`}
                        value={d.hubId}
                        disabled={!hubs.length}
                        onChange={(v) => setHubPick((p) => ({ ...p, [`${d.customerId}#${i}`]: v }))}
                      >
                        {hubs.length ? null : <option value="">No hubs configured</option>}
                        {hubs.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.shortName} ({h.state}){h.isDefault ? " · default hub" : ""}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <div style={{ fontSize: 12, color: M.ink, marginTop: 3, lineHeight: 1.4 }}>{d.address || "—"}</div>
                    {d.contactName || d.contactPhone ? (
                      <div style={{ fontSize: 11.5, color: M.muted, marginTop: 2 }}>{[d.contactName, d.contactPhone].filter(Boolean).join(" · ")}</div>
                    ) : null}
                  </DropCard>
                );
              })}
            </div>
          )}
        </div>
        <CostRow value={cost == null ? "—" : money(cost)} />
        <DateRemarks form={form} setForm={setForm} />
        {err ? <div role="alert" style={{ fontSize: 12.5, color: "var(--dl-sem-danger)", fontWeight: 600 }}>{err}</div> : null}
      </div>
      <SheetFooter onCancel={onClose} onConfirm={submit} confirmLabel="Create DO" busy={busy} disabled={!pos.length} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Create Packing List (packing-list-first auto-split)
// ---------------------------------------------------------------------------
type PreviewGroup = { customerId: string; customerName: string; hubId: string; hubName: string; customerState: string; poCount: number; unitCount: number };

export function PlFirstSheet({
  open,
  pos,
  onClose,
  onCreated,
  askCredit,
}: {
  open: boolean;
  pos: RawRow[];
  onClose: () => void;
  onCreated: (message: string) => void;
  askCredit: AskCredit;
}) {
  const [form, setForm] = useState<CreateDoForm>(EMPTY_CREATE_FORM);
  const [groups, setGroups] = useState<PreviewGroup[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fleet = useFleet(open, form.providerId);
  const poIds = useMemo(() => pos.map((p) => s(p, "id")), [pos]);

  // The server's grouping preview, each time the sheet opens on a new
  // selection (preview: true creates nothing — desktop openPlFirstDialog).
  const openKey = open ? poIds.join(",") : "";
  const [lastKey, setLastKey] = useState("");
  if (openKey !== lastKey) {
    setLastKey(openKey);
    setForm(EMPTY_CREATE_FORM);
    setGroups(null);
    setWarnings([]);
    setPreviewErr(null);
    setErr(null);
  }
  useEffect(() => {
    if (!openKey) return;
    let cancelled = false;
    void (async () => {
      const res = await mutateJson<{ groups?: PreviewGroup[]; creditWarnings?: string[] }>(
        "/api/delivery-orders/packing-list-first",
        "POST",
        { productionOrderIds: openKey.split(","), preview: true },
      );
      if (cancelled) return;
      if (!res.ok) {
        setPreviewErr(res.error || "Could not load the grouping preview.");
        return;
      }
      setGroups(res.body?.groups ?? []);
      setWarnings(res.body?.creditWarnings ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [openKey]);

  const vehicle = fleet.vehicles.find((v) => s(v, "id") === form.vehicleId);
  const provider = fleet.providers.find((p) => s(p, "id") === form.providerId);
  const cost = plFirstCostSen(groups?.length ?? 0, rated(vehicle), rated(provider));

  const submit = async () => {
    if (busy) return;
    if (!form.providerId) {
      setErr("Pick a 3PL provider first");
      return;
    }
    setBusy(true);
    setErr(null);
    const body = plFirstBody(poIds, form);
    let res = await mutateJson<{ data?: { packingList?: { packingNo?: string } | null; deliveryOrders?: { doNo: string }[] } }>(
      "/api/delivery-orders/packing-list-first",
      "POST",
      body,
    );
    if (!res.ok && (res.status === 409 || res.status === 403) && isCreditBlock(res.body)) {
      const reason = await askCredit(res.body);
      if (!reason) {
        setBusy(false);
        return;
      }
      res = await mutateJson("/api/delivery-orders/packing-list-first", "POST", { ...body, creditOverride: { reason } });
    }
    setBusy(false);
    if (!res.ok) {
      setErr(res.error || "Failed to create the packing list");
      return;
    }
    refreshDeliveryCaches();
    const data = (res.body as { data?: { packingList?: { packingNo?: string } | null; deliveryOrders?: { doNo: string }[] } } | null)?.data;
    const doNos = (data?.deliveryOrders ?? []).map((d) => d.doNo);
    onCreated(`Packing list ${data?.packingList?.packingNo ?? ""} created with ${doNos.join(", ")}`.replace("  ", " "));
  };

  const n2 = groups?.length ?? 0;
  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Create Packing List">
      <SheetSub>Splits the selected orders into one delivery order per customer + hub, then groups every new DO into one packing list.</SheetSub>
      <div style={{ display: "grid", gap: 14 }}>
        <Notice>The whole truck run shares one 3PL provider — required here.</Notice>
        <ItemsBox pos={pos} />
        <FleetFields form={form} setForm={setForm} fleet={fleet} providerRequired />
        <div>
          <FieldLabel>New delivery orders{groups ? ` (${n2} DO${n2 === 1 ? "" : "s"})` : ""}</FieldLabel>
          {warnings.length ? (
            <div style={{ marginBottom: 8 }}>
              <Notice tone="warning">
                {warnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
                <div style={{ fontWeight: 700, marginTop: 4 }}>Creating will ask for an override reason.</div>
              </Notice>
            </div>
          ) : null}
          {previewErr ? (
            <Notice tone="danger">{previewErr}</Notice>
          ) : groups === null ? (
            <div style={{ fontSize: 12.5, color: M.ink }}>Loading grouping preview…</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {groups.map((g, i) => (
                <DropCard key={`${g.customerId}-${g.hubId}-${i}`} name={g.customerName} right={`${g.poCount} item(s)`}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: M.taupe, marginTop: 6 }}>
                    {[g.hubName, g.customerState].filter(Boolean).join(" · ") || "—"} → 1 DO
                  </div>
                  <div style={{ fontSize: 12, color: M.ink, marginTop: 3 }}>
                    {g.unitCount} unit{g.unitCount === 1 ? "" : "s"}
                  </div>
                </DropCard>
              ))}
            </div>
          )}
        </div>
        <CostRow value={cost ? `${n2} DO × ${money(cost.perTripSen)} = ${money(cost.totalSen)}` : "—"} />
        <DateRemarks form={form} setForm={setForm} />
        {err ? <div role="alert" style={{ fontSize: 12.5, color: "var(--dl-sem-danger)", fontWeight: 600 }}>{err}</div> : null}
      </div>
      <SheetFooter
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel={`Create Packing List${n2 ? ` + ${n2} DO${n2 === 1 ? "" : "s"}` : ""}`}
        busy={busy}
        disabled={groups === null || n2 === 0 || !!previewErr}
      />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Packing list from selected DOs
// ---------------------------------------------------------------------------
export function PlFromDosSheet({
  open,
  dos,
  onClose,
  onCreated,
  onWarn,
}: {
  open: boolean;
  /** Selected DOs NOT already in a packing list. */
  dos: RawRow[];
  onClose: () => void;
  onCreated: (message: string) => void;
  onWarn: (message: string) => void;
}) {
  const [form, setForm] = useState<CreateDoForm>(EMPTY_CREATE_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fleet = useFleet(open, form.providerId);
  const openKey = open ? dos.map((d) => s(d, "id")).join(",") : "";
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    setForm(EMPTY_CREATE_FORM);
    setErr(null);
  }

  const submit = async () => {
    if (busy || !dos.length) return;
    setBusy(true);
    setErr(null);
    const res = await mutateJson<{ data?: { packingNo?: string } }>("/api/packing-lists", "POST", {
      doIds: dos.map((d) => s(d, "id")),
      remarks: form.remarks.trim() || undefined,
    });
    if (!res.ok) {
      setBusy(false);
      setErr(res.error || "Failed to create packing list");
      return;
    }
    // Same as desktop: stamp the chosen provider / vehicle / driver on every
    // DO of the run, one at a time.
    if (form.providerId || form.vehicleId || form.driverPersonId) {
      const truck = { providerId: form.providerId || null, vehicleId: form.vehicleId || null, driverId: form.driverPersonId || null };
      const failed: string[] = [];
      for (const d of dos) {
        const r = await mutateJson(`/api/delivery-orders/${encodeURIComponent(s(d, "id"))}`, "PUT", truck);
        if (!r.ok) failed.push(s(d, "doNo"));
      }
      if (failed.length) {
        onWarn(`Packing list created, but driver/lorry didn't save on ${failed.length} DO(s): ${failed.slice(0, 3).join(", ")}`);
      }
    }
    setBusy(false);
    invalidateCachePrefix("/api/packing-lists");
    invalidateCachePrefix("/api/delivery-orders");
    onCreated(`Packing list ${res.body?.data?.packingNo ?? ""} created`.replace("  ", " "));
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Create packing list">
      <SheetSub>
        {dos.length} delivery order{dos.length === 1 ? "" : "s"}
      </SheetSub>
      <div style={{ display: "grid", gap: 14 }}>
        <ConfirmLines lines={PL_FROM_DOS_LINES} />
        <FleetFields form={form} setForm={setForm} fleet={fleet} />
        <label style={{ display: "block" }}>
          <FieldLabel>Remarks</FieldLabel>
          <input className="dl-input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} style={INPUT} />
        </label>
        {err ? <div role="alert" style={{ fontSize: 12.5, color: "var(--dl-sem-danger)", fontWeight: 600 }}>{err}</div> : null}
      </div>
      <SheetFooter onCancel={onClose} onConfirm={submit} confirmLabel="Create packing list" busy={busy} disabled={!dos.length} />
    </Sheet>
  );
}
