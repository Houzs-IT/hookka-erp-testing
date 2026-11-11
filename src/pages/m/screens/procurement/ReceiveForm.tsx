// ===========================================================================
// ReceiveForm — full-screen "New Goods Receipt" (prototype form) on top of the
// EXISTING mobile receive workflow (owner 2026-10-21): the request body is
// GrnReceiveSheet's, byte for byte — goods in hand, arrival ARRIVED, so the
// server posts the receipt to stock on create (status Posted) and draws the
// PO down. Received By is required, as on desktop grn/create.tsx. No shipment
// fields: on desktop they make the receipt NOT_ARRIVED (a Draft), a different
// workflow.
// ===========================================================================
import { useMemo, useState } from "react";
import { useCachedJson } from "@/lib/cached-fetch";
import { useIdempotencyKey } from "@/lib/idempotency-key";
import { M } from "../../theme";
import {
  grnReceiveBody, n, receiveRemaining, rows, s, statusOf, type RawRow,
} from "../../lib/procurement-mobile";
import { FieldLabel, Notice, SelectField } from "../delivery/ui";
import { pill } from "../delivery/ui-tokens";
import { refreshProcurementCaches, send } from "./actions";
import { AreaInput, FormIntro, FormLineCard, FullScreenForm, NumberBox, TextInput } from "./parts";

const ELIGIBLE = ["CONFIRMED", "PARTIAL_RECEIVED", "SUBMITTED"];

export function ReceiveForm({
  open,
  presetPoId,
  onClose,
  onDone,
}: {
  open: boolean;
  presetPoId: string;
  onClose: () => void;
  onDone: (message: string, newId: string | null) => void;
}) {
  const [lastOpen, setLastOpen] = useState(false);
  const [poId, setPoId] = useState(presetPoId);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [receivedBy, setReceivedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useIdempotencyKey();
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setPoId(presetPoId);
      setQty({});
      setReceivedBy("");
      setNotes("");
      setError(null);
    }
  }

  const list = useCachedJson<{ data?: RawRow[] }>(open && !presetPoId ? "/api/purchase-orders" : null);
  const eligible = useMemo(() => rows(list.data?.data).filter((p) => ELIGIBLE.includes(s(p, "status"))), [list.data]);
  const detail = useCachedJson<{ data?: RawRow }>(open && poId ? `/api/purchase-orders/${encodeURIComponent(poId)}` : null);
  const po = (detail.data?.data ?? null) as RawRow | null;
  // poItemIndex = the line's position in the PO GET's canonical order (see GrnReceiveSheet).
  const items = po ? rows(po.items) : [];
  const qtyFor = (i: number) => (qty[i] != null ? parseFloat(qty[i]) || 0 : receiveRemaining(items[i]));

  const submit = async () => {
    if (busy) return;
    if (!poId || !po) {
      setError("Select a purchase order");
      return;
    }
    const built = grnReceiveBody(po, qtyFor, receivedBy, notes);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await idem.withKey((key) => send("/api/grn", "POST", built.body, { "Idempotency-Key": key }));
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "Couldn't create the goods receipt.");
      return;
    }
    refreshProcurementCaches();
    const data = (r.body?.data ?? null) as RawRow | null;
    const no = data ? s(data, "grnNumber") : "";
    const st = data ? statusOf("grn", s(data, "status")).label : "";
    onDone(no ? `${no} created${st ? ` — ${st}` : ""}` : "Goods received.", data ? s(data, "id") || null : null);
  };

  return (
    <FullScreenForm open={open} title="New Goods Receipt" onClose={onClose} submitLabel="Receive & Post to Stock" onSubmit={() => void submit()} busy={busy} error={error}>
      <FormIntro>Goods in hand: saving posts the received quantities to stock straight away and updates the purchase order. Shipment, customs and landed cost stay on desktop.</FormIntro>

      {!presetPoId ? (
        <div>
          <FieldLabel required>Purchase Order</FieldLabel>
          {list.loading && !list.data ? (
            <Notice>Loading purchase orders…</Notice>
          ) : eligible.length === 0 ? (
            <Notice>No purchase orders waiting for goods (Confirmed, Submitted or Partial Received).</Notice>
          ) : (
            <SelectField
              ariaLabel="Purchase Order"
              value={poId}
              onChange={(v) => {
                setPoId(v);
                setQty({});
                setError(null);
              }}
            >
              <option value="">Select a purchase order…</option>
              {eligible.map((p) => (
                <option key={s(p, "id")} value={s(p, "id")}>
                  {`${s(p, "poNo")} · ${s(p, "supplierName")} · ${statusOf("po", s(p, "status")).label}`}
                </option>
              ))}
            </SelectField>
          )}
          <div style={{ fontSize: 11.5, color: M.ink, marginTop: 5 }}>Confirmed, Submitted or Partial Received POs.</div>
        </div>
      ) : null}

      <div>
        <FieldLabel required>Received By</FieldLabel>
        <TextInput value={receivedBy} onChange={(v) => { setReceivedBy(v); setError(null); }} ariaLabel="Received By" placeholder="Name of the person who received the goods" />
      </div>
      <div>
        <FieldLabel optional>Notes</FieldLabel>
        <AreaInput value={notes} onChange={setNotes} ariaLabel="Notes" />
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: M.raisin, marginBottom: 8 }}>Received quantities</div>
        {!poId ? (
          <FormLineCard>
            <div style={{ textAlign: "center", fontSize: 12.5, color: M.ink }}>Select a purchase order to load its lines.</div>
          </FormLineCard>
        ) : detail.loading && !po ? (
          <Notice>Loading purchase order…</Notice>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {items.map((it, i) => {
              const remaining = receiveRemaining(it);
              const over = qtyFor(i) > remaining;
              const unit = s(it, "unit");
              return (
                <FormLineCard key={s(it, "id") || i}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{s(it, "materialName") || s(it, "materialCode") || "Material"}</div>
                  <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>
                    {[s(it, "materialCode"), `ordered ${n(it, "quantity")}`, `received ${n(it, "receivedQty")}`, `outstanding ${remaining}${unit ? ` ${unit}` : ""}`].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    <span style={{ flex: "none", fontSize: 12, color: M.ink }}>Receiving now</span>
                    <NumberBox value={qty[i] ?? String(remaining)} onChange={(v) => { setQty((p) => ({ ...p, [i]: v })); setError(null); }} ariaLabel={`Receiving now — ${s(it, "materialName")}`} />
                    <span style={{ flex: 1, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: over ? pill("warning").fg : M.ink }}>{over ? "Over outstanding" : ""}</span>
                  </div>
                </FormLineCard>
              );
            })}
            {items.length === 0 ? <Notice>This purchase order has no lines.</Notice> : null}
          </div>
        )}
      </div>
    </FullScreenForm>
  );
}
