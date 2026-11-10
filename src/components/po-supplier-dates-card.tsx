// Review H2-8 — supplier delivery dates on the PO detail page: Date 1, then
// revised Date 2 / 3 / 4. Recorded dates are read-only (the server refuses an
// overwrite with 409); a new date goes into the next empty slot through
// POST /api/purchase-orders/:id/supplier-date. Dates only — no figure moves.
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { supplierDateLabel, type SupplierDates } from "@/lib/po-supplier-dates";

export function PoSupplierDatesCard({
  poId,
  dates,
  cancelled,
  onRecorded,
}: {
  poId: string;
  dates: SupplierDates | null | undefined;
  cancelled: boolean;
  onRecorded: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const list: SupplierDates = dates ?? [null, null, null, null];
  const nextIdx = list.findIndex((d) => !d);
  const canRecord = !cancelled && nextIdx >= 0;

  const record = async () => {
    if (busy || !value) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-orders/${encodeURIComponent(poId)}/supplier-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: value, slot: "next" }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; unchanged?: boolean; slot?: number };
      if (!res.ok || !body.success) {
        toast.error(body.error || `Couldn't record the supplier date (HTTP ${res.status})`);
        if (res.status === 409) onRecorded();
        return;
      }
      toast.success(body.unchanged ? "That date is already recorded" : `${supplierDateLabel(body.slot ?? nextIdx + 1)} recorded`);
      setValue("");
      onRecorded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error recording the supplier date");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="h-4 w-4 text-[#6B5C32]" /> Supplier Delivery Dates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-3 text-sm max-md:grid-cols-2">
          {list.map((d, i) => (
            <div key={i}>
              <div className="text-xs text-[#6B7280]">{supplierDateLabel(i + 1)}</div>
              <div className={d ? "font-medium text-[#1F1D1B]" : "text-[#9CA3AF]"}>{d ? formatDate(d) : "—"}</div>
            </div>
          ))}
        </div>
        {canRecord ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-[#6B7280] mb-1">
                {nextIdx === 0 ? "Date the supplier gave" : "Supplier's revised date"}
              </label>
              <Input type="date" className="h-9 w-44" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={record} disabled={busy || !value}>
              {busy ? "Recording…" : `Record ${supplierDateLabel(nextIdx + 1)}`}
            </Button>
            <span className="text-xs text-[#6B7280]">A recorded date can't be changed later.</span>
          </div>
        ) : !cancelled ? (
          <p className="text-xs text-[#6B7280]">All four supplier dates are recorded.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
