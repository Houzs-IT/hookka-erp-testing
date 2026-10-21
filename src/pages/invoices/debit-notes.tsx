import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { FinancePageTitle } from "@/components/finance/page-title";
import { KpiCards } from "@/components/finance/report-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataGrid, type Column, type ContextMenuItem } from "@/components/ui/data-grid";
import { formatCurrency, formatDateDMY, formatRM } from "@/lib/utils";
import { useCachedJson, invalidateCachePrefix } from "@/lib/cached-fetch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Plus,
  X,
  Trash2,
} from "lucide-react";
import type { DebitNote, Invoice } from "@/types";
import { fetchJson } from "@/lib/fetch-json";
import { mutationWithData } from "@/lib/schemas/common";
import { DebitNoteSchema } from "@/lib/schemas/invoice";
import { COMPANY } from "@/lib/constants";
import { amountInWords } from "@/lib/amount-in-words";
import { printVouchers, type VoucherSpec, type VoucherLine } from "@/lib/print-voucher";
import { BatchActionsBar } from "@/components/accounting/batch-actions-bar";
import { parseMoneyInput } from "@/lib/parse-money";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { getCurrentUser } from "@/lib/auth";
import { NotePopup } from "@/components/finance/note-popup";

const DNMutationSchema = mutationWithData(DebitNoteSchema);

// COMPANY.HOOKKA → the VoucherSpec.company shape (single source of truth);
// mirrors VOUCHER_COMPANY in supplier-payments.tsx / accounting/index.tsx.
const VOUCHER_COMPANY: VoucherSpec["company"] = {
  name: COMPANY.HOOKKA.name,
  addressLines: COMPANY.HOOKKA.addressLines,
  regNo: COMPANY.HOOKKA.regNo,
  tin: COMPANY.HOOKKA.tin,
  phone: COMPANY.HOOKKA.phone,
  email: COMPANY.HOOKKA.email,
};

// One debit note → a DEBIT NOTE voucher: one line per charged item
// (Description · Qty · Unit Price · Amount), total = the note's totalAmount.
// Money stays integer sen (unitPrice / total / totalAmount are all sen),
// formatted with formatCurrency. Mirrors buildSupplierPaymentVoucher's shape.
// DebitNote has no lifecycle/void state (status is DRAFT/APPROVED/POSTED), so
// the defensive (lifecycleState ?? "ACTIVE") check always yields the live title.
function buildDebitNoteVoucher(dn: DebitNote): VoucherSpec {
  const active = ((dn as { lifecycleState?: string }).lifecycleState ?? "ACTIVE") === "ACTIVE";
  const lines: VoucherLine[] = dn.items.map((item) => ({
    cells: [
      item.description ?? "",
      String(item.quantity ?? ""),
      formatCurrency(item.unitPriceSen ?? item.unitPrice ?? 0),
      formatCurrency(item.totalSen ?? item.total ?? 0),
    ],
  }));
  const remarks = [dn.reason, dn.reasonDetail].filter(Boolean).join(" — ") || undefined;
  return {
    title: active ? "DEBIT NOTE" : "DEBIT NOTE — VOID",
    company: VOUCHER_COMPANY,
    docNo: dn.noteNumber,
    date: formatDateDMY(dn.date),
    partyLabel: "Customer",
    partyName: dn.customerName ?? "",
    amountBox: { label: "Debit amount", value: formatCurrency(dn.totalAmount) },
    facts: [{ label: "Against invoice", value: dn.invoiceNumber || "—" }],
    columns: [
      { label: "Description" },
      { label: "Qty", align: "right" },
      { label: "Unit Price", align: "right" },
      { label: "Amount", align: "right" },
    ],
    lines,
    totalCells: ["", "", "Total", formatCurrency(dn.totalAmount)],
    remarks,
    amountWords: amountInWords(dn.totalAmount),
    signatures: [{ label: "Issued by" }, { label: "Approved by" }],
    printedOn: formatDateDMY(new Date()),
  };
}

export default function DebitNotesPage() {
  const { data: dnResp, loading, refresh: refreshDebitNotes } = useCachedJson<{ success?: boolean; data?: DebitNote[] }>("/api/debit-notes");
  const debitNotes: DebitNote[] = useMemo(
    () => (dnResp?.success ? dnResp.data ?? [] : Array.isArray(dnResp) ? dnResp : []),
    [dnResp]
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { data: invResp, refresh: refreshInvoices } = useCachedJson<{ success?: boolean; data?: Invoice[] }>(showCreateModal ? "/api/invoices" : null);
  const invoices: Invoice[] = useMemo(
    () => (invResp?.success ? invResp.data ?? [] : Array.isArray(invResp) ? invResp : []),
    [invResp]
  );
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  // Edit / Duplicate (owner 2026-10-20 「edit, duplicate, delete 可以做， approve
  // 不需要」), as on the credit-note page: the same form, filled from a note.
  // Edit saves over the draft (PUT /:id/edit); Duplicate saves a new draft.
  // Double-click opens the note (viewNote).
  const [editingNote, setEditingNote] = useState<DebitNote | null>(null);
  const [copyOf, setCopyOf] = useState("");
  const [viewNote, setViewNote] = useState<DebitNote | null>(null);
  const { confirm } = useConfirm();
  const { toast } = useToast();
  // #5: pick the customer first, then list only their not-yet-settled invoices
  // (and, on Edit, the draft's own invoice, so it never drops out of the pick).
  const dnCustomers = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of invoices) if (inv.customerId) m.set(inv.customerId, inv.customerName);
    return [...m].map(([id, name]) => ({ value: id, label: name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [invoices]);
  const keepInvoiceId = editingNote?.invoiceId ?? "";
  const dnInvoices = useMemo(
    () => invoices.filter((inv) => inv.customerId === selectedCustomerId && ((inv.status !== "PAID" && inv.status !== "CANCELLED") || inv.id === keepInvoiceId)),
    [invoices, selectedCustomerId, keepInvoiceId],
  );
  // A note's invoice is applied once the invoices list has loaded (it loads
  // lazily when the form opens), as on the credit-note page.
  const pendingInvoiceId = useRef<string>("");
  useEffect(() => {
    const id = pendingInvoiceId.current;
    if (!id || invoices.length === 0) return;
    if (invoices.some((i) => i.id === id)) setSelectedInvoiceId(id);
    pendingInvoiceId.current = "";
  }, [invoices]);
  const [reason, setReason] = useState<DebitNote["reason"]>("UNDERCHARGE");
  const [reasonDetail, setReasonDetail] = useState("");
  // Editor rows carry a client-only `_uid` so React keys stay stable across
  // add / remove / reorder. The uid is stripped before POST in handleCreate().
  // priceStr keeps the raw text being typed so the controlled input never
  // reformats mid-entry (owner bug 2026-06-12); unitPriceSen derives from it.
  type DebitNoteItemRow = { _uid: string; description: string; quantity: number; unitPriceSen: number; priceStr?: string };
  const newDNItem = (): DebitNoteItemRow => ({
    _uid: crypto.randomUUID(),
    description: "",
    quantity: 1,
    unitPriceSen: 0,
  });
  const [items, setItems] = useState<DebitNoteItemRow[]>([newDNItem()]);
  const [creating, setCreating] = useState(false);

  // Ticked-row selection for batch print voucher + Excel/CSV export. The list
  // uses the shared DataGrid, which owns its own checkbox column (selectable)
  // and reports the picked rows via onSelectionChange — mirror that into state
  // so the BatchActionsBar can act on the selection (twin of payments.tsx).
  const [selected, setSelected] = useState<DebitNote[]>([]);

  const openCreate = () => {
    refreshInvoices();
    setShowCreateModal(true);
  };

  const fillFromNote = (dn: DebitNote) => {
    setSelectedCustomerId(dn.customerId);
    pendingInvoiceId.current = dn.invoiceId;
    setSelectedInvoiceId(dn.invoiceId);
    setReason(dn.reason);
    setReasonDetail(dn.reasonDetail);
    setItems(dn.items.length
      ? dn.items.map((it) => {
          const sen = it.unitPriceSen ?? it.unitPrice ?? 0;
          return { _uid: crypto.randomUUID(), description: it.description, quantity: it.quantity, unitPriceSen: sen, priceStr: (sen / 100).toFixed(2) };
        })
      : [newDNItem()]);
    openCreate();
  };
  const openEdit = (dn: DebitNote) => { setEditingNote(dn); setCopyOf(""); fillFromNote(dn); };
  const openDuplicate = (dn: DebitNote) => { setEditingNote(null); setCopyOf(dn.noteNumber); fillFromNote(dn); };
  const resetForm = () => {
    setEditingNote(null);
    setCopyOf("");
    setSelectedCustomerId("");
    setSelectedInvoiceId("");
    setReason("UNDERCHARGE");
    setReasonDetail("");
    setItems([newDNItem()]);
  };
  // A cancelled Edit / Duplicate leaves nothing behind for the next New.
  const closeForm = () => {
    setShowCreateModal(false);
    if (editingNote || copyOf) resetForm();
  };

  const addItem = () => {
    setItems([...items, newDNItem()]);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, field: string, value: string | number) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPriceSen, 0);

  const handleCreate = async () => {
    if (!selectedInvoiceId || items.length === 0) return;
    setCreating(true);
    try {
      // Strip the client-only `_uid` before POST.
      const payloadItems = items
        .filter((i) => i.description && i.unitPriceSen > 0)
        .map((i) => ({ description: i.description, quantity: i.quantity, unitPriceSen: i.unitPriceSen }));
      const body = { invoiceId: selectedInvoiceId, reason, reasonDetail, items: payloadItems };
      const data = editingNote
        ? await fetchJson(`/api/debit-notes/${encodeURIComponent(editingNote.id)}/edit`, DNMutationSchema, { method: "PUT", body })
        : await fetchJson("/api/debit-notes", DNMutationSchema, { method: "POST", body });
      if (data.success) {
        const no = data.data?.noteNumber ?? editingNote?.noteNumber ?? "The debit note";
        toast.success(editingNote ? `${no} saved` : `${no} created${copyOf ? ` from ${copyOf}` : ""}`);
        setShowCreateModal(false);
        if (editingNote || copyOf) resetForm();
        else {
          setSelectedInvoiceId("");
          setReason("UNDERCHARGE");
          setReasonDetail("");
          setItems([newDNItem()]);
        }
        invalidateCachePrefix("/api/debit-notes");
        invalidateCachePrefix("/api/invoices");
        refreshDebitNotes();
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Could not save the debit note");
    }
    setCreating(false);
  };

  const columns = useMemo<Column<DebitNote>[]>(() => [
    {
      key: "noteNumber",
      label: "DN Number",
      type: "docno",
      render: (_value, row) => (
        <span className="font-mono font-medium text-sm">{row.noteNumber}</span>
      ),
    },
    {
      key: "invoiceNumber",
      label: "Invoice",
      render: (_value, row) => (
        <span className="text-sm text-gray-600">{row.invoiceNumber}</span>
      ),
    },
    {
      key: "customerName",
      label: "Customer",
    },
    {
      key: "date",
      label: "Date",
      type: "date",
      render: (_value, row) => formatDateDMY(row.date),
    },
    {
      key: "totalAmount",
      label: "Amount",
      type: "currency",
      align: "right",
      render: (_value, row) => (
        <span className="font-medium text-[#3E6570]">
          +{formatRM(row.totalAmount)}
        </span>
      ),
    },
    {
      key: "reason",
      label: "Reason",
      render: (_value, row) => (
        <Badge>{row.reason.replace(/_/g, " ")}</Badge>
      ),
    },
    {
      key: "status",
      label: "Status",
      type: "status",
      render: (_value, row) => (
        <Badge variant="status" status={row.status}>
          {row.status}
        </Badge>
      ),
    },
  ], []);

  // Post / Back to Draft (owner 2026-10-17, Finance v2), the mirror of the
  // credit-note page: posting adds the note to the invoice and to what the
  // customer owes and books it; Back to Draft takes all three off again.
  const afterNoteChange = () => {
    invalidateCachePrefix("/api/debit-notes");
    invalidateCachePrefix("/api/invoices");
    invalidateCachePrefix("/api/accounting");
    refreshDebitNotes();
  };
  const sendNote = async (url: string, init: RequestInit, done: string, failed: string) => {
    try {
      const res = await fetch(url, init);
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (res.ok && j.success) {
        toast.success(done);
        afterNoteChange();
      } else toast.error(j.error || failed);
    } catch {
      toast.error(failed);
    }
  };
  const postNote = async (dn: DebitNote) => {
    if (!(await confirm({
      title: `Post ${dn.noteNumber}?`,
      message: `${formatCurrency(dn.totalAmount)} is added to invoice ${dn.invoiceNumber || "—"} and to what ${dn.customerName} owes, and goes into the books.`,
      confirmLabel: "Post",
    }))) return;
    await sendNote(`/api/debit-notes/${encodeURIComponent(dn.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "POSTED", approvedBy: getCurrentUser()?.displayName?.trim() || undefined }),
    }, `${dn.noteNumber} posted`, "Could not post the debit note");
  };
  const unpostNote = async (dn: DebitNote) => {
    if (!(await confirm({
      title: `Put ${dn.noteNumber} back to draft?`,
      message: dn.status === "POSTED"
        ? `${formatCurrency(dn.totalAmount)} comes off invoice ${dn.invoiceNumber || "—"} and off what ${dn.customerName} owes, and its entries come out of the books. You can post it again later.`
        : "It was never posted, so nothing else changes.",
      confirmLabel: "Back to Draft",
      danger: true,
    }))) return;
    await sendNote(`/api/debit-notes/${encodeURIComponent(dn.id)}/unpost`, { method: "POST" },
      `${dn.noteNumber} is a draft again`, "Could not put the debit note back to draft");
  };
  // Delete (owner 2026-10-20): a draft only — it is hidden, the record kept.
  const deleteNote = async (dn: DebitNote) => {
    if (!(await confirm({
      title: `Delete ${dn.noteNumber}?`,
      message: "The draft goes from the list. It was never posted, so nothing else changes. Its number is not used again.",
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    await sendNote(`/api/debit-notes/${encodeURIComponent(dn.id)}`, { method: "DELETE" },
      `${dn.noteNumber} deleted`, "Could not delete the debit note");
  };
  const printNote = async (dn: DebitNote) => {
    try {
      const { generateDebitNotePdf } = await import("@/lib/generate-debit-note-pdf");
      generateDebitNotePdf(dn);
    } catch {
      /* generator draws/saves itself */
    }
  };

  // Edit and Delete only on a draft; Duplicate on any note. No Approve step
  // (owner 2026-10-20 「approve 不需要」) — a draft is posted straight.
  const contextMenuItems = (row: DebitNote): ContextMenuItem[] => [
    { label: "Print PDF", action: (r: DebitNote) => void printNote(r) },
    ...(row.status === "DRAFT" ? [{ label: "Edit", action: (r: DebitNote) => openEdit(r) }] : []),
    { label: "Duplicate", action: (r: DebitNote) => openDuplicate(r) },
    ...(row.status !== "POSTED" ? [{ label: "Post", action: (r: DebitNote) => void postNote(r) }] : []),
    ...(row.status !== "DRAFT" ? [{ label: "Back to Draft", danger: true, action: (r: DebitNote) => void unpostNote(r) }] : []),
    ...(row.status === "DRAFT" ? [{ label: "Delete", danger: true, action: (r: DebitNote) => void deleteNote(r) }] : []),
    {
      label: "Refresh",
      separator: true,
      action: () => refreshDebitNotes(),
    },
  ];

  // Summary stats
  const totalDNValue = debitNotes.reduce((s, dn) => s + dn.totalAmount, 0);
  const draftCount = debitNotes.filter((dn) => dn.status === "DRAFT").length;
  const postedCount = debitNotes.filter((dn) => dn.status === "POSTED").length;

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-md:p-4 max-sm:p-3 max-md:space-y-4" data-fin-ui>
      {/* Header (finance v2: the explanation sits behind the (i)) */}
      <FinancePageTitle
        title="Debit Notes"
        explain="Debit notes for undercharges and additional charges."
        actions={
          <Button onClick={() => { if (editingNote || copyOf) resetForm(); openCreate(); }}>
            <Plus className="h-4 w-4 mr-2" /> New Debit Note
          </Button>
        }
      />

      {/* Summary (finance v2: KPI cards, same figures) */}
      <KpiCards
        items={[
          { label: "Total DN value", value: `+${formatCurrency(totalDNValue)}`, tone: "info", note: `${debitNotes.length} note${debitNotes.length === 1 ? "" : "s"}` },
          { label: "Draft", value: String(draftCount) },
          { label: "Posted", value: String(postedCount) },
        ]}
      />

      {/* Data Grid */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-[14px] font-semibold text-[#1F1D1B]">All Debit Notes</h3>
          <span className="text-[12px] text-[#6B7280]">{debitNotes.length} note{debitNotes.length === 1 ? "" : "s"}</span>
        </div>
        <BatchActionsBar
          count={selected.length}
          onPrint={() => printVouchers(selected.map(buildDebitNoteVoucher))}
          exportName="debit-notes"
          exportAoa={() => [
            ["Note No", "Date", "Customer", "Status", "Invoice No", "Reason", "Voucher Total (RM)", "Description", "Qty", "Unit Price (RM)", "Amount (RM)"],
            ...selected.flatMap((dn) =>
              dn.items.map((item) => [
                dn.noteNumber,
                formatDateDMY(dn.date),
                dn.customerName ?? "",
                dn.status ?? "ACTIVE",
                dn.invoiceNumber ?? "",
                dn.reason ?? "",
                (Number(dn.totalAmount ?? 0) / 100).toFixed(2),
                item.description ?? "",
                String(item.quantity ?? ""),
                (Number(item.unitPriceSen ?? item.unitPrice ?? 0) / 100).toFixed(2),
                (Number(item.totalSen ?? item.total ?? 0) / 100).toFixed(2),
              ]),
            ),
          ]}
        />
        <Card>
          <CardContent className="p-0">
            <DataGrid
              columns={columns}
              data={debitNotes}
              keyField="id"
              virtualize
              gridId="debit-notes"
              selectable
              onSelectionChange={setSelected}
              contextMenuItems={contextMenuItems}
              headerMenu
              reorderableHeaders
              exportName="Debit Notes"
              onDoubleClick={setViewNote}
            />
          </CardContent>
        </Card>
      </div>

      {/* Double-click: the note, with the row's actions. */}
      {viewNote && (
        <NotePopup
          kind="debit"
          note={viewNote}
          onClose={() => setViewNote(null)}
          actions={<>
            <Button variant="outline" size="sm" onClick={() => void printNote(viewNote)}>Print PDF</Button>
            <Button variant="outline" size="sm" onClick={() => { setViewNote(null); openDuplicate(viewNote); }}>Duplicate</Button>
            {viewNote.status === "DRAFT" && (
              <>
                <Button variant="outline" size="sm" onClick={() => { setViewNote(null); void deleteNote(viewNote); }}>Delete</Button>
                <Button variant="outline" size="sm" onClick={() => { setViewNote(null); openEdit(viewNote); }}>Edit</Button>
              </>
            )}
            {viewNote.status !== "DRAFT" && (
              <Button variant="outline" size="sm" onClick={() => { setViewNote(null); void unpostNote(viewNote); }}>Back to Draft</Button>
            )}
            {viewNote.status !== "POSTED" && (
              <Button size="sm" onClick={() => { setViewNote(null); void postNote(viewNote); }}>Post</Button>
            )}
          </>}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">
                {editingNote ? `Edit Debit Note ${editingNote.noteNumber}` : "Create Debit Note"}
                {copyOf ? <span className="ml-2 text-sm font-normal text-[#6B7280]">copy of {copyOf}</span> : null}
              </h2>
              <button onClick={closeForm} aria-label="Close">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* #5: Customer first → only their not-yet-settled invoices. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <SearchableSelect
                  value={selectedCustomerId}
                  onChange={(v) => { setSelectedCustomerId(v); setSelectedInvoiceId(""); }}
                  options={dnCustomers}
                  placeholder="Type customer name..."
                  allowClear
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invoice <span className="font-normal text-gray-400">(unsettled only)</span>
                </label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:bg-gray-100"
                  value={selectedInvoiceId}
                  onChange={(e) => setSelectedInvoiceId(e.target.value)}
                  disabled={!selectedCustomerId}
                >
                  <option value="">
                    {selectedCustomerId ? (dnInvoices.length ? "Select invoice..." : "No unsettled invoices") : "Select a customer first"}
                  </option>
                  {dnInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNo} ({formatCurrency(inv.totalSen)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <select
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as DebitNote["reason"])}
                >
                  <option value="UNDERCHARGE">Undercharge</option>
                  <option value="ADDITIONAL_CHARGE">Additional Charge</option>
                  <option value="PRICE_ADJUSTMENT">Price Adjustment</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              {/* Reason Detail */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Detail</label>
                <textarea
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  rows={2}
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value)}
                  placeholder="Describe the reason..."
                />
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Items</label>
                  <Button variant="ghost" size="sm" onClick={addItem}>
                    <Plus className="h-4 w-4 mr-1" /> Add Item
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={item._uid} className="flex gap-2 items-start">
                      <input
                        className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
                        placeholder="Description"
                        value={item.description}
                        onChange={(e) => updateItem(idx, "description", e.target.value)}
                      />
                      <input
                        className="w-20 border border-gray-300 rounded-md px-3 py-2 text-sm"
                        type="number" onFocus={(e) => e.currentTarget.select()}
                        min="1"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, "quantity", parseInt(e.target.value) || 1)}
                      />
                      <input
                        className="w-32 border border-gray-300 rounded-md px-3 py-2 text-sm"
                        type="number" onFocus={(e) => e.currentTarget.select()}
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="Unit Price (RM)"
                        // Keep the raw text being typed (as the credit-note
                        // page since 2026-06-12): re-formatting on every key
                        // mangled "127" mid-entry. Sen derives from the text.
                        value={item.priceStr ?? (item.unitPriceSen ? (item.unitPriceSen / 100).toFixed(2) : "")}
                        onChange={(e) => {
                          const txt = e.target.value;
                          // `type="number"` - the browser refuses a comma before
                          // this runs, so this was never the truncation bug.
                          // Converted so the guard survives an input-type change.
                          const rm = parseMoneyInput(txt);
                          const sen = rm !== null && rm >= 0 ? Math.round(rm * 100) : 0;
                          setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, priceStr: txt, unitPriceSen: sen } : it)));
                        }}
                      />
                      <span className="text-sm text-gray-500 py-2 w-28 text-right">
                        {formatCurrency(item.quantity * item.unitPriceSen)}
                      </span>
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="p-2 text-[#9A3A2D] hover:text-[#7A2E24]">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-right font-medium text-sm">
                  Total: <span className="text-[#3E6570]">+{formatCurrency(totalAmount)}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t">
              <Button variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !selectedInvoiceId || items.every((i) => !i.description)}
              >
                {editingNote ? (creating ? "Saving..." : "Save Changes") : creating ? "Creating..." : "Create Debit Note"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
