// ---------------------------------------------------------------------------
// CustomerEditModal — move an SO keyed under the wrong customer to the right
// one (HK-0094). Sibling of HubEditModal: same look, same in-place error
// rendering, PATCHes /api/sales-orders/:id/customer which re-checks the lock.
// Hubs belong to a customer, so the hub is picked here too.
// ---------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCachedJson } from "@/lib/cached-fetch";
import type { Customer } from "@/types";

export interface CustomerCascadeResult {
  productionOrdersUpdated: number;
  deliveryOrdersUpdated: number;
  invoicesUpdated: number;
}

interface CustomerEditModalProps {
  open: boolean;
  endpoint: string;
  currentCustomerId: string;
  onClose: () => void;
  onSaved: (
    customerName: string,
    hubName: string,
    cascade: CustomerCascadeResult | null,
  ) => void;
}

export function CustomerEditModal(props: CustomerEditModalProps) {
  if (!props.open) return null;
  return <CustomerEditModalBody {...props} />;
}

function CustomerEditModalBody({
  endpoint,
  currentCustomerId,
  onClose,
  onSaved,
}: CustomerEditModalProps) {
  const { data: customersResp } = useCachedJson<{ data?: Customer[] }>(
    "/api/customers",
    300,
  );
  // POTENTIAL customers are refused server-side (assertCustomerBillable);
  // hide them so nobody picks one only to be rejected on save.
  const customers = useMemo(
    () =>
      (customersResp?.data || []).filter(
        (c) =>
          c.id !== currentCustomerId &&
          (c.customerStage ?? "CONFIRMED") !== "POTENTIAL",
      ),
    [customersResp, currentCustomerId],
  );
  const [customerId, setCustomerId] = useState("");
  const [hubId, setHubId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const selected = customers.find((c) => c.id === customerId);
  const hubs = selected?.deliveryHubs ?? [];

  const handleSave = async () => {
    if (!customerId) {
      setErrMsg("Pick a customer before saving.");
      return;
    }
    if (hubs.length > 0 && !hubId) {
      setErrMsg("Pick a delivery hub for the new customer.");
      return;
    }
    setSaving(true);
    setErrMsg("");
    let res: Response;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          hubId: hubId || undefined,
          reason: reason.trim() || undefined,
        }),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      setSaving(false);
      setErrMsg(e instanceof Error ? e.message : "Network error.");
      return;
    }
    setSaving(false);
    if (!res.ok || !data?.success) {
      setErrMsg(data?.error || `Failed to update customer (HTTP ${res.status}).`);
      return;
    }
    const cascade: CustomerCascadeResult | null =
      data?.cascade && typeof data.cascade === "object" ? data.cascade : null;
    onSaved(
      selected?.name || "(new customer)",
      hubs.find((h) => h.id === hubId)?.shortName || "",
      cascade,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={() => (saving ? null : onClose())}
      />
      <div className="relative bg-white rounded-lg shadow-xl border border-[#E2DDD8] w-full max-w-md mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#1F1D1B]">
            Change Customer
          </h3>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-[#9CA3AF] hover:text-[#374151] disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-[#6B7280]">
          Moves this order, its production orders and any draft DO / invoice to
          the new customer. Item prices stay the same. Locks once goods leave
          the warehouse or an invoice is issued.
        </p>

        <div className="space-y-2">
          <label className="text-xs font-medium text-[#374151]">Customer</label>
          <SearchableSelect
            value={customerId}
            onChange={(cid) => {
              setCustomerId(cid);
              const next = customers.find((c) => c.id === cid)?.deliveryHubs ?? [];
              setHubId(next.length === 1 ? next[0].id : "");
              setErrMsg("");
            }}
            options={customers.map((c) => ({
              value: c.id,
              label: c.code ? `${c.code} - ${c.name}` : c.name,
            }))}
            placeholder="Select customer..."
          />
        </div>

        {selected && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-[#374151]">
              Delivery Hub
            </label>
            <select
              value={hubId}
              onChange={(e) => setHubId(e.target.value)}
              disabled={saving || hubs.length === 0}
              className="flex h-10 w-full rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-sm text-[#1F1D1B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32] disabled:opacity-50"
            >
              <option value="">— Select a hub —</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.shortName}
                  {h.state ? ` (${h.state})` : ""}
                  {h.isDefault ? "  — default" : ""}
                </option>
              ))}
            </select>
            {hubs.length === 0 && (
              <p className="text-xs text-[#6B7280]">
                This customer has no delivery hubs. The order will have no hub.
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-medium text-[#374151]">
            Reason (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            rows={2}
            maxLength={500}
            placeholder="e.g. PO belongs to another customer"
            className="w-full rounded-md border border-[#E2DDD8] bg-white px-3 py-2 text-sm text-[#1F1D1B] placeholder:text-[#9CA3AF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B5C32] disabled:opacity-50"
          />
        </div>

        {errMsg && (
          <div className="rounded-md border border-[#E8B2A1] bg-[#F9E1DA] px-3 py-2 text-xs text-[#7A2E24]">
            {errMsg}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !customerId}
          >
            {saving ? "Saving…" : "Save Customer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
