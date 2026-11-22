// ---------------------------------------------------------------------------
// Customer Assignments — which customers buy this product and at what price.
// Moved out of products/index.tsx (2026-11-22) so the product page's
// Customers tab (D13) and the Products list dropdown share one component.
//
// Round 2 (owner 2026-11-22, design "Customers tab v2"): change a customer's
// price right here. It is the SAME effective-dated price history the customer
// page uses (POST /api/customer-products/:id/prices — a new row with an
// effective date; the old price stays until then, nothing is overwritten), so
// every screen that reads customer prices sees the change. With `costSen`
// the margin on today's total cost shows beside each price.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { invalidateCachePrefix, useCachedJson } from "@/lib/cached-fetch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { bedframePrice3Sen, formatCurrency, todayYmdMY } from "@/lib/utils";

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
type PriceRow = { basePriceSen: number | null; price1Sen: number | null; effectiveFrom: string };

const pctText = (price: number, cost: number) => `${formatCurrency(price - cost)} · ${(((price - cost) / price) * 100).toFixed(1)}%`;

export function CustomerAssignmentsSection({
  productId,
  active,
  costSen,
  category,
}: {
  productId: string;
  active: boolean;
  /** Product category — a BEDFRAME also shows its Price 3 (Price 2 × 1.1, worked out, not stored). */
  category?: string | null;
  /** Today's total cost of the product; shows the margin column when given. */
  costSen?: number | null;
}) {
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
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  // The customer's "base price" IS Price 2 — named the same as the product
  // page (owner 2026-11-22: 「改名叫 Price 2，床架显示 Price 3 就好」).
  const isBed = category === "BEDFRAME";
  const [form, setForm] = useState({ base: "", p1: "", from: todayYmdMY(), reason: "" });
  const [nextChange, setNextChange] = useState<Record<string, PriceRow | null>>({});

  const assignments: CustomerAssignment[] = Array.isArray(cpResp?.data) ? cpResp!.data! : [];
  const allCustomers: CustomerLite[] = Array.isArray(customersResp?.data) ? customersResp!.data! : [];
  const assignedIds = new Set(assignments.map((a) => a.customerId));
  const unassigned = allCustomers.filter(
    (c) =>
      !assignedIds.has(c.id) &&
      (pickerQuery === "" || c.name.toLowerCase().includes(pickerQuery.toLowerCase())),
  );
  const hasSeat = assignments.some((a) => (a.seatHeightPrices?.length ?? 0) > 0);
  const idsKey = assignments.map((a) => a.id).join(",");

  // The next scheduled price per customer (a history row dated after today).
  useEffect(() => {
    if (!active || !idsKey) return;
    let live = true;
    const today = todayYmdMY();
    Promise.all(
      idsKey.split(",").map(async (id) => {
        try {
          const r = await fetch(`/api/customer-products/${encodeURIComponent(id)}/price-history`);
          const j = (await r.json()) as { data?: PriceRow[] };
          const future = (j.data ?? []).filter((p) => String(p.effectiveFrom).slice(0, 10) > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
          return [id, future[0] ?? null] as const;
        } catch {
          return [id, null] as const;
        }
      }),
    ).then((pairs) => {
      if (live) setNextChange(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [active, idsKey]);

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

  function openChange(a: CustomerAssignment) {
    setEditing(a.id);
    setForm({
      base: a.basePriceSen ? (a.basePriceSen / 100).toFixed(2) : "",
      p1: a.price1Sen ? (a.price1Sen / 100).toFixed(2) : "",
      from: todayYmdMY(),
      reason: "",
    });
  }

  async function saveChange(a: CustomerAssignment) {
    const base = Math.round(Number(form.base) * 100);
    const p1 = form.p1.trim() === "" ? null : Math.round(Number(form.p1) * 100);
    if (!(base > 0)) return toast.error("Enter the new Price 2.");
    if (p1 != null && !(p1 > 0)) return toast.error("Price 1 must be above 0, or left empty.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.from)) return toast.error("Pick the effective date.");
    setBusy(true);
    try {
      const res = await fetch(`/api/customer-products/${encodeURIComponent(a.id)}/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basePriceSen: base, price1Sen: p1, effectiveFrom: form.from, notes: form.reason || null }),
      });
      const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || j.success === false) {
        toast.error(j.error || "Could not save the price.");
        return;
      }
      // Same price history as the customer page — refresh every reader.
      invalidateCachePrefix("/api/customer-products");
      invalidateCachePrefix("/api/customers");
      invalidateCachePrefix("/api/products");
      refreshCP();
      setEditing(null);
      setNextChange((m) => ({ ...m, [a.id]: form.from > todayYmdMY() ? { basePriceSen: base, price1Sen: p1, effectiveFrom: form.from } : null }));
      toast.success(form.from > todayYmdMY() ? `New price saved — starts ${form.from}.` : "New price saved.");
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
  const showMargin = costSen != null && costSen > 0;

  return (
    <div className="bg-[#FAF9F7] border border-[#E5E7EB] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-[#374151]">
          Customer prices {N > 0 && <span className="text-[#6B7280] font-normal">({N} customer{N === 1 ? "" : "s"}{showMargin ? ` · total cost today ${formatCurrency(costSen!)}` : ""})</span>}
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
                {isBed && <th className="px-2 py-1.5 text-right" title="Price 2 × 1.1, worked out automatically">Price 3 (auto)</th>}
                <th className="px-2 py-1.5 text-right">Price 2</th>
                {showMargin && <th className="px-2 py-1.5 text-right">Margin on cost</th>}
                <th className="px-2 py-1.5 text-right">Price 1</th>
                {hasSeat && <th className="px-2 py-1.5">Seat Heights</th>}
                <th className="px-2 py-1.5">Next change</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => {
                const nx = nextChange[a.id];
                return (
                  <tr key={a.id} className={`border-b border-[#F3F4F6] last:border-0 ${editing === a.id ? "bg-[#FFFDF7]" : ""}`}>
                    <td className="px-2 py-1.5 text-[#111827] font-medium">{a.customerName}</td>
                    {isBed && (
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">
                        {bedframePrice3Sen(a.basePriceSen) != null ? formatCurrency(bedframePrice3Sen(a.basePriceSen)!) : <span className="text-[#9CA3AF]">-</span>}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#111827]">
                      {a.basePriceSen != null && a.basePriceSen > 0 ? formatCurrency(a.basePriceSen) : <span className="text-[#9CA3AF]">-</span>}
                    </td>
                    {showMargin && (
                      <td className={`px-2 py-1.5 text-right tabular-nums ${a.basePriceSen && a.basePriceSen > costSen! ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
                        {a.basePriceSen && a.basePriceSen > 0 ? pctText(a.basePriceSen, costSen!) : "—"}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#111827]">
                      {a.price1Sen != null && a.price1Sen > 0 ? formatCurrency(a.price1Sen) : <span className="text-[#9CA3AF]">-</span>}
                    </td>
                    {hasSeat && <td className="px-2 py-1.5 text-[#6B7280] font-mono text-[11px]">{formatSeatHeights(a.seatHeightPrices)}</td>}
                    <td className="px-2 py-1.5">
                      {nx?.basePriceSen ? (
                        <span className="rounded bg-[#FDF3D8] px-1.5 py-0.5 text-[11px] text-[#8A6A12]">
                          Price 2 {formatCurrency(nx.basePriceSen)} from {String(nx.effectiveFrom).slice(0, 10)}
                        </span>
                      ) : (
                        <span className="text-[#9CA3AF]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {(a.seatHeightPrices?.length ?? 0) === 0 && (
                        <button type="button" disabled={busy} onClick={() => openChange(a)} className="mr-1 rounded border border-[#D8D1C3] bg-white px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50">
                          Change price
                        </button>
                      )}
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (() => {
        const a = assignments.find((x) => x.id === editing);
        if (!a) return null;
        const newBase = Math.round(Number(form.base) * 100);
        return (
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-[#D8CBA8] bg-[#FFFDF7] p-3 text-xs">
            <b className="w-full text-[13px]">Change price — {a.customerName}</b>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#6B7280]">New Price 2 (RM)</span>
              <input inputMode="decimal" value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value })} className="h-9 w-28 rounded border border-[#CFC8BB] px-2 text-right text-sm" />
            </label>
            {isBed && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6B7280]">Price 3 (auto = Price 2 × 1.1)</span>
                <span className="flex h-9 w-28 items-center justify-end rounded border border-dashed border-[#CFC8BB] bg-[#FAF8F4] px-2 text-sm tabular-nums text-[#6B7280]">
                  {newBase > 0 ? formatCurrency(bedframePrice3Sen(newBase)!) : "—"}
                </span>
              </div>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#6B7280]">Price 1 (RM, optional)</span>
              <input inputMode="decimal" value={form.p1} onChange={(e) => setForm({ ...form, p1: e.target.value })} className="h-9 w-28 rounded border border-[#CFC8BB] px-2 text-right text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#6B7280]">Effective from</span>
              <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="h-9 rounded border border-[#CFC8BB] px-2 text-sm" />
            </label>
            <label className="flex min-w-[180px] flex-1 flex-col gap-1">
              <span className="text-[11px] text-[#6B7280]">Reason</span>
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="h-9 rounded border border-[#CFC8BB] px-2 text-sm" />
            </label>
            {showMargin && newBase > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-[#6B7280]">Margin at new price</span>
                <b className={`text-sm ${newBase > costSen! ? "text-[#15803D]" : "text-[#B91C1C]"}`}>{pctText(newBase, costSen!)}</b>
              </div>
            )}
            <span className="flex gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded border border-[#D8D1C3] bg-white px-3 py-1.5 text-xs">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void saveChange(a)} className="rounded bg-[#6B5A2E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save price</button>
            </span>
            <span className="w-full text-[11px] text-[#6B7280]">
              The old price stays until the effective date; nothing is overwritten — the change is added to this customer&apos;s price history, the same one the customer page shows.
            </span>
          </div>
        );
      })()}

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
        {hasSeat && <span className="text-[10px] text-[#9CA3AF] italic">Sofa seat-height prices: change them on the customer page</span>}
      </div>
    </div>
  );
}
