// The sheets behind the Sales Order actions that open a form (desktop: CustomerEditModal, HubEditModal; the
// Service Case sheet moved to screens/cases/QuickReport.tsx with the Service Cases rebuild). Same requests, bodies, validation and wording as desktop; phone styling from the Delivery
// sheets. No new rules: what the server refuses (a locked order, a customer that is only a prospect, a hub of another customer…)
// comes back as its own error text and is shown inline.
//   Customer      PATCH /api/sales-orders/:id/customer     sales-orders:update; the hub of the NEW customer is picked here too
//   Hub           PATCH /api/sales-orders/:id/hub          sales-orders:update
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import type { Customer } from "@/types";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { mutateJson } from "../../config/mutate";
import { INPUT, sem } from "../delivery/ui-tokens";
import { FieldLabel, SheetFooter, SheetSub } from "../delivery/ui";

const area = { ...INPUT, height: 96, padding: "10px 13px", resize: "none" as const, lineHeight: 1.4 };
const err = (t: string) => <div role="alert" style={{ fontSize: 12.5, color: sem("danger"), marginTop: 8, overflowWrap: "anywhere" }}>{t}</div>;

// ---- Change customer ---------------------------------------------------------------------------------------------
type CustomerCascade = { productionOrdersUpdated?: number; deliveryOrdersUpdated?: number; invoicesUpdated?: number };

export function CustomerChangeSheet({ open, orderId, currentCustomerId, onClose, onSaved }: { open: boolean; orderId: string; currentCustomerId: string; onClose: () => void; onSaved: (message: string) => void }) {
  const { data } = useCachedJson<{ data?: Customer[] }>(open ? "/api/customers" : null, 300);
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [hubId, setHubId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A prospect cannot be billed (the server refuses it): hide them, as desktop does.
  const customers = useMemo(() => (data?.data ?? []).filter((c) => c.id !== currentCustomerId && (c.customerStage ?? "CONFIRMED") !== "POTENTIAL"), [data, currentCustomerId]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? customers.filter((c) => `${c.code ?? ""} ${c.name ?? ""}`.toLowerCase().includes(t)) : customers).slice(0, 40);
  }, [customers, q]);
  const selected = customers.find((c) => c.id === customerId);
  const hubs = selected?.deliveryHubs ?? [];

  const save = async () => {
    if (!customerId) return setError("Pick a customer before saving.");
    if (hubs.length > 0 && !hubId) return setError("Pick a delivery hub for the new customer.");
    setBusy(true);
    setError("");
    const r = await mutateJson<{ cascade?: CustomerCascade }>(`/api/sales-orders/${encodeURIComponent(orderId)}/customer`, "PATCH", { customerId, hubId: hubId || undefined, reason: reason.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error || `Failed to update customer (HTTP ${r.status}).`);
    const c = r.body?.cascade;
    const parts: string[] = [];
    if (c) {
      if ((c.productionOrdersUpdated ?? 0) > 0) parts.push(`${c.productionOrdersUpdated} production order${c.productionOrdersUpdated === 1 ? "" : "s"}`);
      if ((c.deliveryOrdersUpdated ?? 0) > 0) parts.push(`${c.deliveryOrdersUpdated} draft DO${c.deliveryOrdersUpdated === 1 ? "" : "s"}`);
      if ((c.invoicesUpdated ?? 0) > 0) parts.push(`${c.invoicesUpdated} draft invoice${c.invoicesUpdated === 1 ? "" : "s"}`);
    }
    const hubName = hubs.find((h) => h.id === hubId)?.shortName || "";
    let msg = `Customer changed to ${selected?.name || "(new customer)"}${hubName ? ` (${hubName})` : ""}.`;
    if (parts.length) msg += ` Also updated: ${parts.join(", ")}.`;
    onSaved(msg);
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Change Customer">
      <SheetSub>Move this order to the right customer. Documents already raised for it are refreshed where the server allows. Editable until goods leave the warehouse or an invoice is issued.</SheetSub>
      <div style={{ position: "relative" }}>
        <Search size={15} strokeWidth={2} color={M.muted} style={{ position: "absolute", left: 12, top: 15 }} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer code or name" aria-label="Search customers" style={{ ...INPUT, paddingLeft: 34 }} />
      </div>
      <div style={{ background: M.card, borderRadius: 12, padding: "0 12px", marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
        {shown.length === 0 ? <div style={{ padding: "14px 0", fontSize: 13, color: M.ink }}>{data ? "No customer matches." : "Loading customers…"}</div> : null}
        {shown.map((c, i) => (
          <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setHubId(""); setError(""); }} aria-pressed={c.id === customerId} style={{ width: "100%", textAlign: "left", display: "block", padding: "9px 0", border: "none", borderTop: i ? `1px solid ${M.divider}` : "none", background: "none", fontFamily: "inherit", cursor: "pointer", fontWeight: c.id === customerId ? 700 : 500, fontSize: 13.5, color: M.raisin }}>
            {c.code ? `${c.code} · ` : ""}{c.name}{c.id === customerId ? "  ✓" : ""}
          </button>
        ))}
      </div>
      {hubs.length > 0 ? (
        <>
          <div style={{ height: 12 }} />
          <FieldLabel required>Delivery hub of the new customer</FieldLabel>
          <select value={hubId} onChange={(e) => setHubId(e.target.value)} aria-label="New delivery hub" style={INPUT}>
            <option value="">Pick the delivery hub</option>
            {hubs.map((h) => <option key={h.id} value={h.id}>{h.shortName}{h.state ? ` · ${h.state}` : ""}</option>)}
          </select>
        </>
      ) : null}
      <div style={{ height: 12 }} />
      <FieldLabel>Reason (optional)</FieldLabel>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" style={{ ...area, height: 64 }} />
      {error ? err(error) : null}
      <SheetFooter onCancel={onClose} onConfirm={() => void save()} confirmLabel="Change Customer" busy={busy} disabled={!customerId} />
    </Sheet>
  );
}

// ---- Change delivery hub -----------------------------------------------------------------------------------------
type HubCascade = { deliveryOrdersUpdated?: number; invoicesUpdated?: number; productionOrdersUpdated?: number; warningDOs?: { doNo: string; reason: string }[] };

export function HubChangeSheet({ open, orderId, customerId, currentHubId, onClose, onSaved }: { open: boolean; orderId: string; customerId: string; currentHubId: string; onClose: () => void; onSaved: (message: string, warnings: string[]) => void }) {
  const { data } = useCachedJson<{ data?: Customer }>(open && customerId ? `/api/customers/${encodeURIComponent(customerId)}` : null);
  const hubs = data?.data?.deliveryHubs ?? [];
  const [hubId, setHubId] = useState(currentHubId);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!hubId) return setError("Pick a delivery hub.");
    if (hubId === currentHubId) return setError("That is already the order's delivery hub.");
    setBusy(true);
    setError("");
    const r = await mutateJson<{ cascade?: HubCascade }>(`/api/sales-orders/${encodeURIComponent(orderId)}/hub`, "PATCH", { hubId, reason: reason.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error || `Failed to update hub (HTTP ${r.status}).`);
    const c = r.body?.cascade;
    const parts: string[] = [];
    if (c) {
      if ((c.deliveryOrdersUpdated ?? 0) > 0) parts.push(`${c.deliveryOrdersUpdated} draft DO${c.deliveryOrdersUpdated === 1 ? "" : "s"}`);
      if ((c.invoicesUpdated ?? 0) > 0) parts.push(`${c.invoicesUpdated} draft invoice${c.invoicesUpdated === 1 ? "" : "s"}`);
    }
    let msg = `Hub updated to ${hubs.find((h) => h.id === hubId)?.shortName || "the new hub"}.`;
    if (parts.length) msg += ` Cascaded to: ${parts.join(", ")}.`;
    if (c && (c.productionOrdersUpdated ?? 0) > 0) msg += ` ${c.productionOrdersUpdated} production sheet${c.productionOrdersUpdated === 1 ? "" : "s"} will auto-update via join on next print.`;
    onSaved(msg, (c?.warningDOs ?? []).map((w) => `Did not update ${w.doNo} (${w.reason}). Please review manually.`));
  };

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} title="Change Delivery Hub">
      <SheetSub>Editable until goods leave the warehouse.</SheetSub>
      <FieldLabel required>Delivery hub</FieldLabel>
      <select value={hubId} onChange={(e) => { setHubId(e.target.value); setError(""); }} aria-label="Delivery hub" style={INPUT}>
        <option value="">{data ? "Pick the delivery hub" : "Loading hubs…"}</option>
        {hubs.map((h) => <option key={h.id} value={h.id}>{h.shortName}{h.state ? ` · ${h.state}` : ""}</option>)}
      </select>
      <div style={{ height: 12 }} />
      <FieldLabel>Reason (optional)</FieldLabel>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" style={{ ...area, height: 64 }} />
      {error ? err(error) : null}
      <SheetFooter onCancel={onClose} onConfirm={() => void save()} confirmLabel="Change Hub" busy={busy} disabled={!hubId || hubId === currentHubId} />
    </Sheet>
  );
}
