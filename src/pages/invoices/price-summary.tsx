// Invoice Price Summary (HK-0158) — every invoice line in a month or date range,
// one row per line with its variant, so month-end can check selling prices and
// fix wrong ones in place. Saves go through PUT /api/invoices/:id { priceEdits }
// (the invoice editor's own path: totals, tax, customer balance and GL restate
// there). Rules: src/lib/invoice-price-summary.ts.
//
// The list is the shared DataGrid: its header ▼ filters on every column
// (Payment and Editable included), search, and 15 invoices a page (`pageBy`).
// Typed prices live in `draft` here, outside the grid, so changing page or
// filter never drops them; Save writes every changed line on every page.
import { createContext, useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
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
  payment: string;
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

// The typed prices reach the cells through context, so the grid's `columns`
// stay the same object while typing (DataGrid re-sorts, and resets its page,
// whenever `columns` changes).
type DraftCtx = {
  draft: Record<string, number | undefined>;
  setPrice: (id: string, sen: number | undefined) => void;
  lineErrors: Record<string, string>;
  canEdit: boolean;
};
const Draft = createContext<DraftCtx>({ draft: {}, setPrice: () => {}, lineErrors: {}, canEdit: false });

const isDirty = (l: Line, draft: DraftCtx["draft"]) =>
  draft[l.id] !== undefined && draft[l.id] !== l.unitPriceSen;

function PriceCell({ line }: { line: Line }) {
  const { draft, setPrice, lineErrors, canEdit } = useContext(Draft);
  const price = draft[line.id] ?? line.unitPriceSen;
  return (
    // Keep clicks inside the box from selecting the row / starting a cell range.
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {canEdit && line.editable ? (
        <div className={`ml-auto w-28 ${isDirty(line, draft) ? "rounded ring-2 ring-[#E8B04B]" : ""}`}>
          <MoneyInput
            value={price / 100}
            onChange={(v) => setPrice(line.id, v === null ? undefined : Math.round(v * 100))}
          />
        </div>
      ) : (
        <span title={line.lockReason ?? undefined}>{formatCurrency(line.unitPriceSen)}</span>
      )}
      {lineErrors[line.id] && <div className="whitespace-normal text-xs text-red-600">{lineErrors[line.id]}</div>}
    </div>
  );
}

function TotalCell({ line }: { line: Line }) {
  const { draft } = useContext(Draft);
  if (!isDirty(line, draft)) return <>{formatCurrency(line.totalSen)}</>;
  return <>{formatCurrency(Math.max(0, draft[line.id]! * line.quantity - line.discountSen))}</>;
}

const COLUMNS: Column<Line>[] = [
  { key: "invoiceDate", label: "Doc Date", type: "date", width: "100px" },
  {
    key: "invoiceNo",
    label: "Invoice",
    type: "docno",
    width: "120px",
    render: (_v, l) => (
      <Link className="text-[#6B5C32] hover:underline" to={`/invoices/${l.invoiceId}`} onClick={(e) => e.stopPropagation()}>
        {l.invoiceNo}
      </Link>
    ),
  },
  { key: "customerName", label: "Customer", width: "160px" },
  { key: "productCode", label: "Item Code", width: "110px" },
  { key: "productName", label: "Description", width: "200px" },
  {
    key: "variant",
    label: "Variant",
    width: "240px",
    filterAccessor: variantText,
    sortAccessor: variantText,
    exportValue: variantText,
    render: (_v, l, _i, hl) => hl(variantText(l)),
  },
  {
    key: "uom",
    label: "UOM",
    width: "70px",
    filterAccessor: (l) => uomFor(l.itemCategory),
    exportValue: (l) => uomFor(l.itemCategory),
    render: (_v, l) => uomFor(l.itemCategory),
  },
  { key: "quantity", label: "Qty", type: "number", align: "right", width: "60px" },
  {
    key: "unitPriceSen",
    label: "Unit Price",
    type: "currency",
    align: "right",
    width: "140px",
    noClip: true,
    render: (_v, l) => <PriceCell line={l} />,
  },
  { key: "discountSen", label: "Discount", type: "currency", align: "right", width: "100px" },
  {
    key: "totalSen",
    label: "Total",
    type: "currency",
    align: "right",
    width: "120px",
    total: "sum",
    render: (_v, l) => <TotalCell line={l} />,
  },
  { key: "status", label: "Invoice Status", type: "status", width: "110px" },
  { key: "payment", label: "Payment", width: "100px" },
  {
    key: "editable",
    label: "Editable",
    width: "200px",
    filterAccessor: (l) => (l.editable ? "Editable" : `Locked: ${l.lockReason ?? ""}`),
    sortAccessor: (l) => (l.editable ? "Editable" : `Locked: ${l.lockReason ?? ""}`),
    exportValue: (l) => (l.editable ? "Editable" : `Locked: ${l.lockReason ?? ""}`),
    render: (_v, l) =>
      l.editable ? "Editable" : <span className="text-[#9CA3AF]">Locked: {l.lockReason}</span>,
  },
];

export default function InvoicePriceSummary() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("invoices", "update");

  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(thisMonth());
  const [from, setFrom] = useState(monthRange(thisMonth()).from);
  const [to, setTo] = useState(monthRange(thisMonth()).to);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Typed prices in sen, by line id. A line with no entry is never written.
  const [draft, setDraft] = useState<Record<string, number | undefined>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Line[]>([]);
  const [clearSel, setClearSel] = useState(0);
  const [batchPrice, setBatchPrice] = useState<number | null>(null);

  const changed = useMemo(() => (lines ?? []).filter((l) => isDirty(l, draft)), [lines, draft]);

  const load = async (force = false) => {
    const range = mode === "month" ? monthRange(month) : { from, to };
    if (!range.from || !range.to || range.from > range.to) {
      toast.error("Pick a valid period.");
      return false;
    }
    if (
      !force &&
      changed.length &&
      !(await confirm({
        title: "Discard unsaved prices?",
        message: `${changed.length} price change(s) are not saved yet. Showing a new period drops them.`,
        confirmLabel: "Discard",
        danger: true,
      }))
    )
      return false;
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
      setSelected([]);
      setClearSel((n) => n + 1);
      return true;
    } catch (e) {
      toast.error(`Could not load invoice lines: ${(e as Error).message}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const applyBatch = () => {
    if (batchPrice === null) return;
    const sen = Math.round(batchPrice * 100);
    const open = selected.filter((l) => l.editable);
    setDraft((d) => {
      const next = { ...d };
      for (const l of open) next[l.id] = sen;
      return next;
    });
    const skipped = selected.length - open.length;
    if (skipped) toast.error(`${skipped} locked line(s) skipped.`);
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
    await load(true);
    setLineErrors(errs);
  };

  const ctx = useMemo<DraftCtx>(
    () => ({
      draft,
      lineErrors,
      canEdit,
      setPrice: (id, sen) => setDraft((d) => ({ ...d, [id]: sen })),
    }),
    [draft, lineErrors, canEdit],
  );

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
          <Button onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Show"}
          </Button>
        </CardContent>
      </Card>

      {lines && canEdit && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-[#6B7280]">{selected.length} selected</span>
          <span>Set unit price</span>
          <div className="w-32">
            <MoneyInput value={batchPrice} onChange={setBatchPrice} />
          </div>
          <Button size="sm" variant="outline" onClick={applyBatch} disabled={!selected.length || batchPrice === null}>
            Apply to selected
          </Button>
          <span className="ml-auto text-xs text-[#6B7280]">Unsaved changes stay when you change page or filter.</span>
          <Button size="sm" onClick={save} disabled={saving || changed.length === 0}>
            {saving ? "Saving…" : `Save ${changed.length} change${changed.length === 1 ? "" : "s"}`}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDraft({})} disabled={saving || changed.length === 0}>
            Discard
          </Button>
        </div>
      )}

      {lines && (
        <Draft.Provider value={ctx}>
          <DataGrid<Line>
            gridId="invoice-price-summary"
            columns={COLUMNS}
            data={lines}
            keyField="id"
            selectable={canEdit}
            checkboxSelectOnly
            cellCopy={false}
            onSelectionChange={setSelected}
            clearSelectionToken={clearSel}
            rowClassName={(l) => (isDirty(l, draft) ? "bg-[#FFF7E6]" : "")}
            pageBy={(l) => l.invoiceId}
            pageSize={15}
            pageNoun="invoices"
            emptyMessage="No invoice lines in this period."
            searchPlaceholder="Invoice, customer, item, colour…"
            exportName="invoice-price-summary"
          />
        </Draft.Provider>
      )}
    </div>
  );
}
