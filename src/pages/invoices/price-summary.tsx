// Invoice Price Summary (HK-0158) — every invoice line in a month or date range,
// one row per line with its variant, so month-end can check selling prices and
// fix wrong ones in place. Saves go through PUT /api/invoices/:id { priceEdits }
// (the invoice editor's own path: totals, tax, customer balance and GL restate
// there). Rules: src/lib/invoice-price-summary.ts.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDateDMY } from "@/lib/utils";
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { uomFor } from "@/lib/doc-columns";
import { editsByInvoice, monthRange, type SummaryLine } from "@/lib/invoice-price-summary";

type Line = SummaryLine & {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  status: string;
  customerName: string;
  doNo: string;
  productCode: string;
  productName: string;
  sizeLabel: string;
  fabricCode: string;
  itemCategory: string | null;
  gapInches: number | null;
  divanHeightInches: number | null;
  legHeightInches: number | null;
  specialOrder: string | null;
  quantity: number;
  totalSen: number;
  editable: boolean;
  lockReason: string | null;
};

const inch = (v: number | null) => (v === null || v === undefined || v === 0 ? "" : `${v}"`);

/** "Detail Description 2" in the AutoCount sample: colour / size / divan / leg / gap / special. */
function variantText(l: Line): string {
  return [
    l.fabricCode && `Col: ${l.fabricCode}`,
    l.sizeLabel,
    inch(l.divanHeightInches) && `Divan: ${inch(l.divanHeightInches)}`,
    inch(l.legHeightInches) && `Leg: ${inch(l.legHeightInches)}`,
    inch(l.gapInches) && `Gap: ${inch(l.gapInches)}`,
    l.specialOrder,
  ]
    .filter(Boolean)
    .join(" / ");
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function InvoicePriceSummary() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("invoices", "update");

  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(thisMonth());
  const [from, setFrom] = useState(monthRange(thisMonth()).from);
  const [to, setTo] = useState(monthRange(thisMonth()).to);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Typed prices in sen, by line id. A line with no entry is never written.
  const [draft, setDraft] = useState<Record<string, number | undefined>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchPrice, setBatchPrice] = useState<number | null>(null);

  const load = async () => {
    const range = mode === "month" ? monthRange(month) : { from, to };
    if (!range.from || !range.to || range.from > range.to) {
      toast.error("Pick a valid period.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(
        `/api/invoices/line-summary?from=${range.from}&to=${range.to}`,
        { credentials: "include", cache: "no-store" },
      );
      const j = (await r.json()) as { success?: boolean; data?: Line[]; error?: string };
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      setLines(j.data ?? []);
      setDraft({});
      setLineErrors({});
      setSelected(new Set());
    } catch (e) {
      toast.error(`Could not load invoice lines: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!lines || !q) return lines ?? [];
    return lines.filter((l) =>
      [l.invoiceNo, l.customerName, l.productCode, l.productName, variantText(l)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [lines, search]);

  const changed = useMemo(
    () => (lines ?? []).filter((l) => draft[l.id] !== undefined && draft[l.id] !== l.unitPriceSen),
    [lines, draft],
  );
  const editableShown = shown.filter((l) => l.editable);

  const applyBatch = () => {
    if (batchPrice === null) return;
    const sen = Math.round(batchPrice * 100);
    setDraft((d) => {
      const next = { ...d };
      for (const id of selected) next[id] = sen;
      return next;
    });
  };

  const save = async () => {
    if (!lines) return;
    const { groups, errors } = editsByInvoice(lines, draft);
    const errs: Record<string, string> = {};
    for (const e of errors) errs[e.id] = e.error;
    // One PUT per invoice, one at a time, so a refusal names its invoice and
    // the others still save.
    const failed: string[] = [];
    let ok = 0;
    setSaving(true);
    for (const [invoiceId, priceEdits] of groups) {
      const invNo = lines.find((l) => l.invoiceId === invoiceId)?.invoiceNo ?? invoiceId;
      try {
        const r = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priceEdits }),
        });
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
        ok++;
      } catch (e) {
        failed.push(`${invNo}: ${(e as Error).message}`);
        for (const pe of priceEdits) errs[pe.id] = (e as Error).message;
      }
    }
    setSaving(false);
    invalidateCachePrefix("/api/invoices");
    if (ok) toast.success(`${ok} invoice${ok === 1 ? "" : "s"} updated.`);
    if (failed.length) toast.error(`Not saved — ${failed.join("; ")}`);
    if (errors.length) toast.error(`${errors.length} line(s) not saved — see the red notes.`);
    // Reload so every row shows what is now stored, then keep only the errors.
    await load();
    setLineErrors(errs);
  };

  const totalSen = shown.reduce((s, l) => s + l.totalSen, 0);
  const allTicked = editableShown.length > 0 && editableShown.every((l) => selected.has(l.id));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1D1B]">Invoice Price Summary</h1>
        <p className="text-sm text-[#6B7280]">
          Every invoice line in the period. Check selling prices and correct them here; each
          save updates that invoice's totals the same way editing the invoice does.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex gap-1">
            <Button variant={mode === "month" ? "primary" : "outline"} size="sm" onClick={() => setMode("month")}>
              Month
            </Button>
            <Button variant={mode === "range" ? "primary" : "outline"} size="sm" onClick={() => setMode("range")}>
              Date range
            </Button>
          </div>
          {mode === "month" ? (
            <label className="text-sm">
              <span className="block text-xs text-[#6B7280]">Month</span>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          ) : (
            <>
              <label className="text-sm">
                <span className="block text-xs text-[#6B7280]">From</span>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-[#6B7280]">To</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
          <Button onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Show"}
          </Button>
          {lines && (
            <label className="ml-auto text-sm">
              <span className="block text-xs text-[#6B7280]">Search</span>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Invoice, customer, item, colour…"
              />
            </label>
          )}
        </CardContent>
      </Card>

      {lines && canEdit && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[#6B7280]">{selected.size} selected</span>
          <span>Set unit price</span>
          <div className="w-32">
            <MoneyInput value={batchPrice} onChange={setBatchPrice} />
          </div>
          <Button size="sm" variant="outline" onClick={applyBatch} disabled={!selected.size || batchPrice === null}>
            Apply to selected
          </Button>
          <Button size="sm" onClick={save} disabled={saving || changed.length === 0} className="ml-auto">
            {saving ? "Saving…" : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDraft({})} disabled={saving || changed.length === 0}>
            Discard
          </Button>
        </div>
      )}

      {lines && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-[#F5F3EF] text-left text-xs text-[#6B7280]">
                <tr>
                  {canEdit && (
                    <th className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all editable lines"
                        checked={allTicked}
                        onChange={() =>
                          setSelected(allTicked ? new Set() : new Set(editableShown.map((l) => l.id)))
                        }
                      />
                    </th>
                  )}
                  <th className="px-2 py-2">Doc Date</th>
                  <th className="px-2 py-2">Invoice</th>
                  <th className="px-2 py-2">Customer</th>
                  <th className="px-2 py-2">Item Code</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Variant</th>
                  <th className="px-2 py-2">UOM</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit Price</th>
                  <th className="px-2 py-2 text-right">Discount</th>
                  <th className="px-2 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const price = draft[l.id] ?? l.unitPriceSen;
                  const dirty = draft[l.id] !== undefined && draft[l.id] !== l.unitPriceSen;
                  const lineTotal = Math.max(0, price * l.quantity - l.discountSen);
                  return (
                    <tr key={l.id} className={`border-t ${dirty ? "bg-[#FFF7E6]" : ""}`}>
                      {canEdit && (
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            aria-label={`Select ${l.invoiceNo} ${l.productCode}`}
                            disabled={!l.editable}
                            checked={selected.has(l.id)}
                            onChange={() =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(l.id)) n.delete(l.id);
                                else n.add(l.id);
                                return n;
                              })
                            }
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-2 py-1">{formatDateDMY(l.invoiceDate)}</td>
                      <td className="whitespace-nowrap px-2 py-1">
                        <Link className="text-[#6B5C32] hover:underline" to={`/invoices/${l.invoiceId}`}>
                          {l.invoiceNo}
                        </Link>
                      </td>
                      <td className="px-2 py-1">{l.customerName}</td>
                      <td className="whitespace-nowrap px-2 py-1">{l.productCode}</td>
                      <td className="px-2 py-1">{l.productName}</td>
                      <td className="px-2 py-1">{variantText(l)}</td>
                      <td className="px-2 py-1">{uomFor(l.itemCategory)}</td>
                      <td className="px-2 py-1 text-right">{l.quantity}</td>
                      <td className="px-2 py-1 text-right">
                        {canEdit && l.editable ? (
                          <div className="ml-auto w-28">
                            <MoneyInput
                              value={price / 100}
                              onChange={(v) =>
                                setDraft((d) => ({ ...d, [l.id]: v === null ? undefined : Math.round(v * 100) }))
                              }
                            />
                          </div>
                        ) : (
                          <span title={l.lockReason ?? undefined}>{formatCurrency(l.unitPriceSen)}</span>
                        )}
                        {lineErrors[l.id] && <div className="text-xs text-red-600">{lineErrors[l.id]}</div>}
                        {!l.editable && l.lockReason && (
                          <div className="text-xs text-[#9CA3AF]">Locked: {l.lockReason}</div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">{l.discountSen ? formatCurrency(l.discountSen) : ""}</td>
                      <td className="px-2 py-1 text-right">{formatCurrency(dirty ? lineTotal : l.totalSen)}</td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-2 py-6 text-center text-[#6B7280]">
                      No invoice lines in this period.
                    </td>
                  </tr>
                )}
              </tbody>
              {shown.length > 0 && (
                <tfoot>
                  <tr className="border-t font-medium">
                    <td colSpan={canEdit ? 11 : 10} className="px-2 py-2 text-right">
                      {shown.length} lines · Total
                    </td>
                    <td className="px-2 py-2 text-right">{formatCurrency(totalSen)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
