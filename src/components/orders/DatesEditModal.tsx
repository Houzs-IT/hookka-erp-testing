// ---------------------------------------------------------------------------
// DatesEditModal — change Customer DD / Hookka Expected DD on an SO without
// the full edit page (HK-0121). PATCH /api/sales-orders/:id/dates re-dates
// the production orders + job cards the same way a PUT date change does.
// Mount it only while open so the inputs start from the current dates.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface DatesCascadeResult {
  productionOrders: number;
  jobCards: number;
}

interface DatesEditModalProps {
  open: boolean;
  endpoint: string;
  currentCustomerDD: string | null | undefined;
  currentHookkaDD: string | null | undefined;
  onClose: () => void;
  onSaved: (cascade: DatesCascadeResult | null) => void;
}

const ymd = (v: string | null | undefined) => (v ?? "").slice(0, 10);

export function DatesEditModal({
  open,
  endpoint,
  currentCustomerDD,
  currentHookkaDD,
  onClose,
  onSaved,
}: DatesEditModalProps) {
  const [customerDD, setCustomerDD] = useState(ymd(currentCustomerDD));
  const [hookkaDD, setHookkaDD] = useState(ymd(currentHookkaDD));
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  if (!open) return null;

  const customerChanged = customerDD !== ymd(currentCustomerDD);
  const hookkaChanged = hookkaDD !== ymd(currentHookkaDD);

  const handleSave = async () => {
    if (!customerDD) {
      setErrMsg("Customer DD cannot be blank.");
      return;
    }
    const payload: Record<string, string> = {};
    if (customerChanged) payload.customerDeliveryDate = customerDD;
    if (hookkaChanged) payload.hookkaExpectedDD = hookkaDD;
    setSaving(true);
    setErrMsg("");
    let res: Response;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      setSaving(false);
      setErrMsg(e instanceof Error ? e.message : "Network error.");
      return;
    }
    setSaving(false);
    if (!res.ok || !data?.success) {
      setErrMsg(data?.error || `Failed to update dates (HTTP ${res.status}).`);
      return;
    }
    onSaved(data?.cascade && typeof data.cascade === "object" ? data.cascade : null);
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
            Change Delivery Dates
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
          Saves immediately and writes an audit row. Production target dates and
          job card due dates follow, except cards already sent to the floor.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#374151]">Customer DD</label>
            <Input
              type="date"
              value={customerDD}
              onChange={(e) => setCustomerDD(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#374151]">Hookka Expected DD</label>
            <Input
              type="date"
              value={hookkaDD}
              onChange={(e) => setHookkaDD(e.target.value)}
              disabled={saving}
            />
          </div>
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
            disabled={saving || (!customerChanged && !hookkaChanged)}
          >
            {saving ? "Saving…" : "Save Dates"}
          </Button>
        </div>
      </div>
    </div>
  );
}
