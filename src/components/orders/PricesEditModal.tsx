// ---------------------------------------------------------------------------
// PricesEditModal — HK-0156. Change line base prices on an SO the full Edit
// page has locked (production started). PATCH /api/sales-orders/:id/prices
// changes prices only; items, qty and specs stay. Mount only while open.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { formatCurrency, roundSen } from "@/lib/utils";
import { useFormDiscardGuard } from "@/lib/use-discard-guard";

export interface PriceEditLine {
  id: string;
  lineSuffix?: string;
  productCode?: string;
  productName?: string;
  quantity: number;
  basePriceSen: number;
}

interface PricesEditModalProps {
  open: boolean;
  endpoint: string;
  lines: PriceEditLine[];
  onClose: () => void;
  onSaved: (changed: number) => void;
}

export function PricesEditModal({ open, endpoint, lines, onClose, onSaved }: PricesEditModalProps) {
  const [prices, setPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, Number(l.basePriceSen) || 0])),
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const guard = useFormDiscardGuard({ prices, reason }, { open, onClose, busy: saving });

  if (!open) return null;

  const edits = lines
    .filter((l) => prices[l.id] !== (Number(l.basePriceSen) || 0))
    .map((l) => ({ id: l.id, basePriceSen: prices[l.id] }));

  const handleSave = async () => {
    setSaving(true);
    setErrMsg("");
    let res: Response;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: edits, reason: reason.trim() }),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      setSaving(false);
      setErrMsg(e instanceof Error ? e.message : "Network error.");
      return;
    }
    setSaving(false);
    if (!res.ok || !data?.success) {
      setErrMsg(data?.error || `Failed to update prices (HTTP ${res.status}).`);
      return;
    }
    onSaved(Number(data?.changed) || 0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onMouseDown={guard.onBackdrop} />
      <div className="relative bg-white rounded-lg shadow-xl border border-[#E2DDD8] w-full max-w-lg mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#1F1D1B]">Edit Prices</h3>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-[#9CA3AF] hover:text-[#374151] disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-[#6B7280]">
          Production has started, so items cannot change. You can still change the base
          price of each line until the order is invoiced. Each change is logged.
        </p>

        <div className="max-h-[50vh] overflow-y-auto space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#1F1D1B] truncate">
                  {l.lineSuffix} {l.productName || l.productCode}
                </div>
                <div className="text-xs text-[#9CA3AF]">
                  Qty {l.quantity} · was {formatCurrency(Number(l.basePriceSen) || 0)}
                </div>
              </div>
              <div className="w-32">
                <MoneyInput
                  value={prices[l.id] / 100}
                  onChange={(rm) =>
                    setPrices((p) => ({ ...p, [l.id]: rm == null ? 0 : roundSen(rm * 100) }))
                  }
                  disabled={saving}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-[#374151]">Reason (optional)</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} />
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
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || edits.length === 0}>
            {saving ? "Saving…" : "Save Prices"}
          </Button>
        </div>
      </div>
    </div>
  );
}
