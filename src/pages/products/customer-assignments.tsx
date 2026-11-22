// ---------------------------------------------------------------------------
// Customer Assignments — which customers buy this product and at what price.
// Moved out of products/index.tsx (2026-11-22) so the product page's
// Customers tab (D13) and the Products list dropdown share one component.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { invalidateCachePrefix, useCachedJson } from "@/lib/cached-fetch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";

// ---------- Customer Assignments Section (expanded row) ----------
type CustomerAssignment = {
  id: string;
  customerId: string;
  customerName: string;
  basePriceSen?: number | null;
  price1Sen?: number | null;
  seatHeightPrices?: { height: string; priceSen: number }[] | null;
  notes?: string | null;
};

type CustomerLite = { id: string; name: string };

export function CustomerAssignmentsSection({ productId, active }: { productId: string; active: boolean }) {
  const { data: cpResp, refresh: refreshCP } = useCachedJson<{
    success?: boolean;
    data?: CustomerAssignment[];
  }>(active ? `/api/customer-products/by-product/${productId}` : null);
  const { data: customersResp } = useCachedJson<{ data?: CustomerLite[] }>(
    active ? "/api/customers" : null,
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm } = useConfirm();

  const assignments: CustomerAssignment[] = Array.isArray(cpResp?.data) ? cpResp!.data! : [];
  const allCustomers: CustomerLite[] = Array.isArray(customersResp?.data) ? customersResp!.data! : [];
  const assignedIds = new Set(assignments.map((a) => a.customerId));
  const unassigned = allCustomers.filter(
    (c) =>
      !assignedIds.has(c.id) &&
      (pickerQuery === "" || c.name.toLowerCase().includes(pickerQuery.toLowerCase())),
  );

  async function handleAssign(customerId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/customer-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, productId }),
      });
      if (res.ok) {
        invalidateCachePrefix("/api/customer-products");
        refreshCP();
        setPickerOpen(false);
        setPickerQuery("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(assignmentId: string, customerName: string) {
    if (busy) return;
    if (!(await confirm({ title: "Remove assignment?", message: `Remove assignment to ${customerName}?`, danger: true }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/customer-products/${assignmentId}`, { method: "DELETE" });
      if (res.ok) {
        invalidateCachePrefix("/api/customer-products");
        refreshCP();
      }
    } finally {
      setBusy(false);
    }
  }

  function formatSeatHeights(sh: CustomerAssignment["seatHeightPrices"]): string {
    if (!sh || sh.length === 0) return "-";
    return sh
      .map((s) => `${String(s.height).replace('"', "")}:${(s.priceSen / 100).toFixed(0)}`)
      .join(" ");
  }

  const N = assignments.length;

  return (
    <div className="bg-[#FAF9F7] border border-[#E5E7EB] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-[#374151]">
          Customer Assignments {N > 0 && <span className="text-[#6B7280] font-normal">({N} customer{N === 1 ? "" : "s"})</span>}
        </h4>
      </div>

      {N === 0 ? (
        <div className="text-xs text-[#9CA3AF] italic mb-3">Not assigned to any customer</div>
      ) : (
        <div className="overflow-x-auto mb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-medium text-[#6B7280] uppercase border-b border-[#E5E7EB]">
                <th className="px-2 py-1.5">Customer</th>
                <th className="px-2 py-1.5 text-right">Base Price</th>
                <th className="px-2 py-1.5 text-right">Price 1</th>
                <th className="px-2 py-1.5">Seat Heights</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id} className="border-b border-[#F3F4F6] last:border-0">
                  <td className="px-2 py-1.5 text-[#111827]">{a.customerName}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#111827]">
                    {a.basePriceSen != null && a.basePriceSen > 0 ? formatCurrency(a.basePriceSen) : <span className="text-[#9CA3AF]">-</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#111827]">
                    {a.price1Sen != null && a.price1Sen > 0 ? formatCurrency(a.price1Sen) : <span className="text-[#9CA3AF]">-</span>}
                  </td>
                  <td className="px-2 py-1.5 text-[#6B7280] font-mono text-[11px]">
                    {formatSeatHeights(a.seatHeightPrices)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRemove(a.id, a.customerName)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#B91C1C] hover:bg-[#FEE2E2] rounded disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4F7C3A] bg-[#EEF3E4] border border-[#C6DBA8] rounded-md hover:bg-[#EEF3E4] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Assign to customer
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-[#E5E7EB] rounded-md shadow-lg z-10">
              <input
                autoFocus
                type="text"
                placeholder="Search customers..."
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border-b border-[#E5E7EB] focus:outline-none"
              />
              <div className="max-h-56 overflow-y-auto">
                {unassigned.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-[#9CA3AF] italic">
                    {allCustomers.length === 0 ? "Loading..." : "No unassigned customers"}
                  </div>
                ) : (
                  unassigned.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => handleAssign(c.id)}
                      className="block w-full text-left px-2 py-1.5 text-xs text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
                    >
                      {c.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <span className="text-[10px] text-[#9CA3AF] italic">(edit prices on customer page)</span>
      </div>
    </div>
  );
}

