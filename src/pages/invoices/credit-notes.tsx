import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
import type { CreditNote, Invoice } from "@/types";
import { fetchJson } from "@/lib/fetch-json";
import { mutationWithData } from "@/lib/schemas/common";
import { CreditNoteSchema } from "@/lib/schemas/invoice";
import { COMPANY } from "@/lib/constants";
import { amountInWords } from "@/lib/amount-in-words";
import { printVouchers, type VoucherSpec, type VoucherLine } from "@/lib/print-voucher";
import { BatchActionsBar } from "@/components/accounting/batch-actions-bar";
import { parseMoneyInput } from "@/lib/parse-money";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { getCurrentUser } from "@/lib/auth";
import { returnCandidateBlock, type ReturnCreditCandidate } from "@/lib/cn-from-return";
import { NotePopup } from "@/components/finance/note-popup";

const CNMutationSchema = mutationWithData(CreditNoteSchema);

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

// One credit note → a CREDIT NOTE voucher: one line per credited item
// (Description · Qty · Unit Price · Amount), total = the note's totalAmount.
// Money stays integer sen (unitPrice / total / totalAmount are all sen),
// formatted with formatCurrency. Mirrors buildSupplierPaymentVoucher's shape.
// CreditNote has no lifecycle/void state (status is DRAFT/APPROVED/POSTED), so
// the defensive (lifecycleState ?? "ACTIVE") check always yields the live title.
function buildCreditNoteVoucher(cn: CreditNote): VoucherSpec {
  const active = ((cn as { lifecycleState?: string }).lifecycleState ?? "ACTIVE") === "ACTIVE";
  const lines: VoucherLine[] = cn.items.map((item) => ({
    cells: [
      item.description ?? "",
      String(item.quantity ?? ""),
      formatCurrency(item.unitPriceSen ?? item.unitPrice ?? 0),
      formatCurrency(item.totalSen ?? item.total ?? 0),
    ],
  }));
  const remarks = [cn.reason, cn.reasonDetail].filter(Boolean).join(" — ") || undefined;
  return {
    title: active ? "CREDIT NOTE" : "CREDIT NOTE — VOID",
    company: VOUCHER_COMPANY,
    docNo: cn.noteNumber,
    date: formatDateDMY(cn.date),
    partyLabel: "Customer",
    partyName: cn.customerName ?? "",
    amountBox: { label: "Credit amount", value: formatCurrency(cn.totalAmount) },
    facts: [{ label: "Against invoice", value: cn.invoiceNumber || "—" }],
    columns: [
      { label: "Description" },
      { label: "Qty", align: "right" },
      { label: "Unit Price", align: "right" },
      { label: "Amount", align: "right" },
    ],
    lines,
    totalCells: ["", "", "Total", formatCurrency(cn.totalAmount)],
    remarks,
    amountWords: amountInWords(cn.totalAmount),
    signatures: [{ label: "Issued by" }, { label: "Approved by" }],
    printedOn: formatDateDMY(new Date()),
  };
}


export default function CreditNotesPage() {
  const { data: cnResp, loading, refresh: refreshCreditNotes } = useCachedJson<{ success?: boolean; data?: CreditNote[] }>("/api/credit-notes");
  const creditNotes: CreditNote[] = useMemo(
    () => (cnResp?.success ? cnResp.data ?? [] : Array.isArray(cnResp) ? cnResp : []),
    [cnResp]
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
  // 不需要」): the same form, filled from a note. Edit saves over the draft
  // (PUT /:id/edit); Duplicate saves a new draft, without the delivery return
  // (one note per return). Double-click opens the note (viewNote).
  const [editingNote, setEditingNote] = useState<CreditNote | null>(null);
  const [copyOf, setCopyOf] = useState("");
  const [viewNote, setViewNote] = useState<CreditNote | null>(null);
  const { confirm } = useConfirm();
  const { toast } = useToast();
  // #5: pick the customer first, then list only their not-yet-settled invoices
  // (and, on Edit, the draft's own invoice, so it never drops out of the pick).
  const cnCustomers = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of invoices) if (inv.customerId) m.set(inv.customerId, inv.customerName);
    return [...m].map(([id, name]) => ({ value: id, label: name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [invoices]);
  const keepInvoiceId = editingNote?.invoiceId ?? "";
  const cnInvoices = useMemo(
    () => invoices.filter((inv) => inv.customerId === selectedCustomerId && ((inv.status !== "PAID" && inv.status !== "CANCELLED") || inv.id === keepInvoiceId)),
    [invoices, selectedCustomerId, keepInvoiceId],
  );
  const [reason, setReason] = useState<CreditNote["reason"]>("RETURN");
  const [reasonDetail, setReasonDetail] = useState("");
  // Editor rows carry a client-only `_uid` so React keys stay stable across
  // add / remove / reorder. The uid is stripped before POST in handleCreate().
  // PR 0 (2026-05-20) — field renamed from `unitPrice` to `unitPriceSen` so
  // the unit is explicit at the contract surface. Value is integer sen
  // (RM × 100), matching the backend after the rename in credit-notes.ts.
  // priceStr keeps the raw text being typed so the controlled input never
  // reformats mid-entry (owner bug 2026-06-12); unitPriceSen derives from it.
  type CreditNoteItemRow = { _uid: string; description: string; quantity: number; unitPriceSen: number; priceStr?: string };
  const newCNItem = (): CreditNoteItemRow => ({
    _uid: crypto.randomUUID(),
    description: "",
    quantity: 1,
    unitPriceSen: 0,
  });
  const [items, setItems] = useState<CreditNoteItemRow[]>([newCNItem()]);
  const [creating, setCreating] = useState(false);

  // A note from a delivery return (owner 2026-07-15 → priced 2026-10-17,
  // Finance v2 "create a Credit Note from a Delivery Return"): the New CN form
  // opens with the customer, the invoice that billed the return's delivery
  // order, reason RETURN and one line per returned item at that invoice's
  // price per unit (GET /api/credit-notes/from-returns). Reached from the
  // "From Delivery Return" picker on this page or from a return's own page
  // (?fromReturn=<id>). The note remembers its return (deliveryReturnId).
  const [searchParams, setSearchParams] = useSearchParams();
  const fromReturn = searchParams.get("fromReturn") || "";
  const [fromReturnDraft, setFromReturnDraft] = useState<ReturnCreditCandidate | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [candidates, setCandidates] = useState<ReturnCreditCandidate[] | null>(null);
  // The invoice is applied once the invoices list has loaded (it loads lazily
  // when the modal opens).
  const pendingInvoiceId = useRef<string>("");
  const prefillRan = useRef(false);

  const applyReturn = (d: ReturnCreditCandidate) => {
    setEditingNote(null);
    setCopyOf("");
    setFromReturnDraft(d);
    setSelectedCustomerId(d.customerId);
    pendingInvoiceId.current = d.invoice?.id ?? "";
    setSelectedInvoiceId(d.invoice?.id ?? "");
    setReason("RETURN");
    setReasonDetail(`Delivery Return ${d.returnNo}`.trim());
    setItems(d.lines.map((l) => ({
      _uid: crypto.randomUUID(),
      description: l.description,
      quantity: l.quantity,
      unitPriceSen: l.unitPriceSen ?? 0,
      priceStr: l.unitPriceSen != null ? (l.unitPriceSen / 100).toFixed(2) : "",
    })));
    setPickOpen(false);
    refreshInvoices();
    setShowCreateModal(true);
  };

  useEffect(() => {
    if (!fromReturn || prefillRan.current) return;
    prefillRan.current = true;
    void (async () => {
      try {
        const res = await fetch(`/api/credit-notes/from-returns?returnId=${encodeURIComponent(fromReturn)}`);
        const j = (await res.json()) as { success?: boolean; data?: ReturnCreditCandidate[] };
        const d = j?.success ? j.data?.[0] : undefined;
        if (d) applyReturn(d);
      } catch {
        /* best-effort — the operator can still use the picker */
      } finally {
        setSearchParams({});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot, ref-guarded
  }, [fromReturn]);

  // Once the invoices list is loaded, apply the pending invoice (the select
  // only offers invoices it has loaded).
  useEffect(() => {
    const id = pendingInvoiceId.current;
    if (!id || invoices.length === 0) return;
    if (invoices.some((i) => i.id === id)) setSelectedInvoiceId(id);
    pendingInvoiceId.current = "";
  }, [invoices]);

  const openPicker = () => {
    setPickOpen(true);
    setCandidates(null);
    fetch("/api/credit-notes/from-returns")
      .then((r) => r.json() as Promise<{ success?: boolean; data?: ReturnCreditCandidate[] }>)
      .then((j) => setCandidates(j?.success ? (j.data ?? []) : []))
      .catch(() => setCandidates([]));
  };

  // Ticked rows for the batch actions bar (print vouchers + Excel/CSV export).
  const [selectedCreditNotes, setSelectedCreditNotes] = useState<CreditNote[]>([]);

  const openCreate = () => {
    refreshInvoices();
    setShowCreateModal(true);
  };

  const fillFromNote = (cn: CreditNote) => {
    setFromReturnDraft(null);
    setSelectedCustomerId(cn.customerId);
    pendingInvoiceId.current = cn.invoiceId;
    setSelectedInvoiceId(cn.invoiceId);
    setReason(cn.reason);
    setReasonDetail(cn.reasonDetail);
    setItems(cn.items.length
      ? cn.items.map((it) => {
          const sen = it.unitPriceSen ?? it.unitPrice ?? 0;
          return { _uid: crypto.randomUUID(), description: it.description, quantity: it.quantity, unitPriceSen: sen, priceStr: (sen / 100).toFixed(2) };
        })
      : [newCNItem()]);
    openCreate();
  };
  const openEdit = (cn: CreditNote) => { setEditingNote(cn); setCopyOf(""); fillFromNote(cn); };
  const openDuplicate = (cn: CreditNote) => { setEditingNote(null); setCopyOf(cn.noteNumber); fillFromNote(cn); };
  const resetForm = () => {
    setFromReturnDraft(null);
    setEditingNote(null);
    setCopyOf("");
    setSelectedCustomerId("");
    setSelectedInvoiceId("");
    setReason("RETURN");
    setReasonDetail("");
    setItems([newCNItem()]);
  };
  // A cancelled Edit / Duplicate leaves nothing behind for the next New.
  const closeForm = () => {
    setShowCreateModal(false);
    if (editingNote || copyOf) resetForm();
    else setFromReturnDraft(null);
  };

  const addItem = () => {
    setItems([...items, newCNItem()]);
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
      // PR 0 (2026-05-20) — send `unitPriceSen` (matches backend rename).
      const payloadItems = items
        .filter((i) => i.description && i.unitPriceSen > 0)
        .map((i) => ({ description: i.description, quantity: i.quantity, unitPriceSen: i.unitPriceSen }));
      const body = { invoiceId: selectedInvoiceId, reason, reasonDetail, items: payloadItems };
      const data = editingNote
        ? await fetchJson(`/api/credit-notes/${encodeURIComponent(editingNote.id)}/edit`, CNMutationSchema, { method: "PUT", body })
        : await fetchJson("/api/credit-notes", CNMutationSchema, {
            method: "POST",
            body: {
              ...body,
              ...(fromReturnDraft ? { deliveryReturnId: fromReturnDraft.id } : {}),
            },
          });
      if (data.success) {
        const no = data.data?.noteNumber ?? editingNote?.noteNumber ?? "The credit note";
        toast.success(editingNote ? `${no} saved` : `${no} created${copyOf ? ` from ${copyOf}` : ""}`);
        setShowCreateModal(false);
        if (editingNote || copyOf) resetForm();
        else {
          setFromReturnDraft(null);
          setSelectedInvoiceId("");
          setReason("RETURN");
          setReasonDetail("");
          setItems([newCNItem()]);
        }
        invalidateCachePrefix("/api/credit-notes");
        invalidateCachePrefix("/api/invoices");
        refreshCreditNotes();
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Could not save the credit note");
    }
    setCreating(false);
  };

  const columns = useMemo<Column<CreditNote>[]>(() => [
    {
      key: "noteNumber",
      label: "CN Number",
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
        <span className="font-medium text-[#9A3A2D]">
          -{formatRM(row.totalAmount)}
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

  // Post / Back to Draft (owner 2026-10-17, Finance v2). Posting applies the
  // note — the customer owes less, the invoice's total drops, the books take
  // the entries; Back to Draft undoes all three in one go.
  const afterNoteChange = () => {
    invalidateCachePrefix("/api/credit-notes");
    invalidateCachePrefix("/api/invoices");
    invalidateCachePrefix("/api/accounting");
    refreshCreditNotes();
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
  const postNote = async (cn: CreditNote) => {
    if (!(await confirm({
      title: `Post ${cn.noteNumber}?`,
      message: `${formatCurrency(cn.totalAmount)} comes off invoice ${cn.invoiceNumber || "—"} and off what ${cn.customerName} owes, and goes into the books.`,
      confirmLabel: "Post",
    }))) return;
    await sendNote(`/api/credit-notes/${encodeURIComponent(cn.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "POSTED", approvedBy: getCurrentUser()?.displayName?.trim() || undefined }),
    }, `${cn.noteNumber} posted`, "Could not post the credit note");
  };
  const unpostNote = async (cn: CreditNote) => {
    if (!(await confirm({
      title: `Put ${cn.noteNumber} back to draft?`,
      message: `${formatCurrency(cn.totalAmount)} goes back on invoice ${cn.invoiceNumber || "—"} and on what ${cn.customerName} owes, and its entries come out of the books. You can post it again later.`,
      confirmLabel: "Back to Draft",
      danger: true,
    }))) return;
    await sendNote(`/api/credit-notes/${encodeURIComponent(cn.id)}/unpost`, { method: "POST" },
      `${cn.noteNumber} is a draft again`, "Could not put the credit note back to draft");
  };
  // Delete (owner 2026-10-20): a draft only — it is hidden, the record kept.
  const deleteNote = async (cn: CreditNote) => {
    if (!(await confirm({
      title: `Delete ${cn.noteNumber}?`,
      message: "The draft goes from the list. It was never posted, so nothing else changes. Its number is not used again.",
      confirmLabel: "Delete",
      danger: true,
    }))) return;
    await sendNote(`/api/credit-notes/${encodeURIComponent(cn.id)}`, { method: "DELETE" },
      `${cn.noteNumber} deleted`, "Could not delete the credit note");
  };
  const printNote = async (cn: CreditNote) => {
    try {
      const { generateCreditNotePdf } = await import("@/lib/generate-credit-note-pdf");
      generateCreditNotePdf(cn);
    } catch {
      /* generator handles its own draw; nothing to surface here */
    }
  };

  // Edit and Delete only on a draft; Duplicate on any note. No Approve step
  // (owner 2026-10-20 「approve 不需要」) — a draft is posted straight.
  const contextMenuItems = (row: CreditNote): ContextMenuItem[] => [
    { label: "Print PDF", action: (r: CreditNote) => void printNote(r) },
    ...(row.status === "DRAFT" ? [{ label: "Edit", action: (r: CreditNote) => openEdit(r) }] : []),
    { label: "Duplicate", action: (r: CreditNote) => openDuplicate(r) },
    ...(row.status === "DRAFT"
      ? [{ label: "Post", action: (r: CreditNote) => void postNote(r) }]
      : [{ label: "Back to Draft", danger: true, action: (r: CreditNote) => void unpostNote(r) }]),
    ...(row.status === "DRAFT" ? [{ label: "Delete", danger: true, action: (r: CreditNote) => void deleteNote(r) }] : []),
    {
      label: "Refresh",
      separator: true,
      action: () => refreshCreditNotes(),
    },
  ];

  // Summary stats
  const totalCNValue = creditNotes.reduce((s, cn) => s + cn.totalAmount, 0);
  const draftCount = creditNotes.filter((cn) => cn.status === "DRAFT").length;
  const postedCount = creditNotes.filter((cn) => cn.status === "POSTED").length;

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
        title="Credit Notes"
        explain="Credit notes for returns, price adjustments and damages."
        actions={
          <>
            <Button variant="outline" onClick={openPicker}>From Delivery Return</Button>
            <Button onClick={() => { if (editingNote || copyOf) resetForm(); setFromReturnDraft(null); openCreate(); }}>
              <Plus className="h-4 w-4 mr-2" /> New Credit Note
            </Button>
          </>
        }
      />

      {/* Summary (finance v2: KPI cards, same figures) */}
      <KpiCards
        items={[
          { label: "Total CN value", value: `-${formatCurrency(totalCNValue)}`, tone: "err", note: `${creditNotes.length} note${creditNotes.length === 1 ? "" : "s"}` },
          { label: "Draft", value: String(draftCount) },
          { label: "Posted", value: String(postedCount) },
        ]}
      />

      {/* Data Grid */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="text-[14px] font-semibold text-[#1F1D1B]">All Credit Notes</h3>
          <span className="text-[12px] text-[#6B7280]">{creditNotes.length} note{creditNotes.length === 1 ? "" : "s"}</span>
        </div>
        <BatchActionsBar
          count={selectedCreditNotes.length}
          onPrint={() => printVouchers(selectedCreditNotes.map(buildCreditNoteVoucher))}
          exportName="credit-notes"
          exportAoa={() => [
            ["Note No", "Date", "Customer", "Status", "Invoice No", "Reason", "Voucher Total (RM)", "Description", "Qty", "Unit Price (RM)", "Amount (RM)"],
            ...selectedCreditNotes.flatMap((cn) =>
              cn.items.map((item) => [
                cn.noteNumber,
                formatDateDMY(cn.date),
                cn.customerName ?? "",
                cn.status ?? "ACTIVE",
                cn.invoiceNumber ?? "",
                cn.reason ?? "",
                (Number(cn.totalAmount ?? 0) / 100).toFixed(2),
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
              data={creditNotes}
              keyField="id"
              virtualize
              gridId="credit-notes"
              selectable
              onSelectionChange={setSelectedCreditNotes}
              contextMenuItems={contextMenuItems}
              headerMenu
              reorderableHeaders
              exportName="Credit Notes"
              onDoubleClick={setViewNote}
            />
          </CardContent>
        </Card>
      </div>

      {/* Double-click: the note, with the row's actions. */}
      {viewNote && (
        <NotePopup
          kind="credit"
          note={viewNote}
          onClose={() => setViewNote(null)}
          actions={<>
            <Button variant="outline" size="sm" onClick={() => void printNote(viewNote)}>Print PDF</Button>
            <Button variant="outline" size="sm" onClick={() => { setViewNote(null); openDuplicate(viewNote); }}>Duplicate</Button>
            {viewNote.status === "DRAFT" ? (
              <>
                <Button variant="outline" size="sm" onClick={() => { setViewNote(null); void deleteNote(viewNote); }}>Delete</Button>
                <Button variant="outline" size="sm" onClick={() => { setViewNote(null); openEdit(viewNote); }}>Edit</Button>
                <Button size="sm" onClick={() => { setViewNote(null); void postNote(viewNote); }}>Post</Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => { setViewNote(null); void unpostNote(viewNote); }}>Back to Draft</Button>
            )}
          </>}
        />
      )}

      {/* From Delivery Return — pick a return, the form fills in. */}
      {pickOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onMouseDown={(e) => { if (e.target === e.currentTarget) setPickOpen(false); }}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 max-h-[85vh] overflow-y-auto" data-cn-return-picker="">
            <div className="flex items-center justify-between p-5 border-b">
              <div>
                <h2 className="text-lg font-semibold">Credit Note from Delivery Return</h2>
                <p className="text-[12px] text-[#6B7280]">Pick a return — customer, invoice and returned items fill in at the invoice's prices; check them, then save.</p>
              </div>
              <button onClick={() => setPickOpen(false)} aria-label="Close"><X className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="p-4">
              {candidates === null ? (
                <p className="py-8 text-center text-sm text-[#6B7280]">Loading…</p>
              ) : candidates.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#6B7280]">No delivery returns yet.</p>
              ) : (
                <table data-fin-list className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left">Return No</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Invoice</th>
                      <th className="px-3 py-2 text-right">Items</th>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((d) => {
                      const why = returnCandidateBlock(d);
                      return (
                        <tr
                          key={d.id}
                          data-fin-nolift={why ? "" : undefined}
                          className={why ? "bg-[#F7F5F1] text-[#9CA3AF]" : "cursor-pointer"}
                          onClick={why ? undefined : () => applyReturn(d)}
                          title={why || "Fill a new credit note from this return"}
                        >
                          <td className="px-3 py-2 font-mono">{d.returnNo}</td>
                          <td className="px-3 py-2">{d.date ? formatDateDMY(d.date) : "-"}</td>
                          <td className="px-3 py-2">{d.customerName}</td>
                          <td className="px-3 py-2">{d.invoice?.invoiceNo ?? "-"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{d.lines.reduce((s, l) => s + l.quantity, 0)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{d.invoice ? formatRM(d.valueSen) : "-"}{d.unpriced ? <span className="block text-[11px] text-[#9C6F1E]">{d.unpriced} unpriced</span> : null}</td>
                          <td className="px-3 py-2 text-right text-[12px]">{why ? <span className={d.creditNote ? "text-[#27500A]" : ""}>{why}</span> : <span className="text-[#6B5C32]">Use →</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">
                {editingNote ? `Edit Credit Note ${editingNote.noteNumber}` : "Create Credit Note"}
                {fromReturnDraft ? <span className="ml-2 text-sm font-normal text-[#6B7280]">from {fromReturnDraft.returnNo}</span> : null}
                {copyOf ? <span className="ml-2 text-sm font-normal text-[#6B7280]">copy of {copyOf}</span> : null}
              </h2>
              <button onClick={closeForm} aria-label="Close">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {fromReturnDraft && fromReturnDraft.unpriced > 0 && (
                <p className="rounded-md border border-[#F2D9A6] bg-[#FBF3E4] px-3 py-2 text-[12px] text-[#7A5B12]" data-cn-unpriced="">
                  {fromReturnDraft.unpriced} returned line{fromReturnDraft.unpriced === 1 ? " was" : "s were"} not on the invoice — enter {fromReturnDraft.unpriced === 1 ? "its" : "their"} price.
                </p>
              )}
              {/* #5: Customer first → only their not-yet-settled invoices. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <SearchableSelect
                  value={selectedCustomerId}
                  onChange={(v) => { setSelectedCustomerId(v); setSelectedInvoiceId(""); }}
                  options={cnCustomers}
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
                    {selectedCustomerId ? (cnInvoices.length ? "Select invoice..." : "No unsettled invoices") : "Select a customer first"}
                  </option>
                  {cnInvoices.map((inv) => (
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
                  onChange={(e) => setReason(e.target.value as CreditNote["reason"])}
                >
                  <option value="RETURN">Return</option>
                  <option value="PRICE_ADJUSTMENT">Price Adjustment</option>
                  <option value="DAMAGE">Damage</option>
                  <option value="OVERCHARGE">Overcharge</option>
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
                        // Owner bug 2026-06-12: this was a controlled input
                        // re-formatted with toFixed(2) on EVERY keystroke, so
                        // typing "127" got mangled mid-entry. Keep the raw
                        // text the user types; derive sen from it on change.
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
                  Total: <span className="text-[#9A3A2D]">-{formatCurrency(totalAmount)}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-6 border-t">
              <Button variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !selectedInvoiceId || items.every((i) => !i.description)}
              >
                {editingNote ? (creating ? "Saving..." : "Save Changes") : creating ? "Creating..." : "Create Credit Note"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
