// ---------------------------------------------------------------------------
// note-popup.tsx — a credit or debit note opened by double-click on its list
// (the owner's rule for every finance document): who, which invoice, why and
// its lines, with the row's own actions at the foot.
// ---------------------------------------------------------------------------
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DocPopup, PopupField } from "@/components/finance/doc-popup";
import { formatCurrency } from "@/lib/utils";
import { fmtDocDate } from "@/lib/finance-daily";
import type { CreditNote, DebitNote } from "@/types";

export function NotePopup({ kind, note, onClose, actions }: {
  kind: "credit" | "debit"; note: CreditNote | DebitNote; onClose: () => void; actions: ReactNode;
}) {
  const sign = kind === "credit" ? "-" : "+";
  const tone = kind === "credit" ? "text-[#9A3A2D]" : "text-[#3E6570]";
  return (
    <DocPopup
      title={`${kind === "credit" ? "Credit Note" : "Debit Note"} ${note.noteNumber}`}
      badges={<Badge variant="status" status={note.status}>{note.status}</Badge>}
      onClose={onClose}
      actions={actions}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <PopupField label="Customer" span={2}>{note.customerName || "—"}</PopupField>
        <PopupField label="Invoice">{note.invoiceNumber || "—"}</PopupField>
        <PopupField label="Date">{fmtDocDate(note.date) || "—"}</PopupField>
        <PopupField label="Reason">{note.reason.replace(/_/g, " ")}</PopupField>
        <PopupField label="Amount"><span className={`tabular-nums ${tone}`}>{sign}{formatCurrency(note.totalAmount)}</span></PopupField>
        {note.status !== "DRAFT" && <PopupField label="Posted by">{note.approvedBy || "—"}</PopupField>}
        <PopupField label="Detail" span={4}>{note.reasonDetail || "—"}</PopupField>
      </div>
      <div className="border border-[#E2DDD8] rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#FAF8F5]">
            <tr className="text-xs text-[#6B7280]">
              <th className="text-left px-3 py-1.5 font-medium">Description</th>
              <th className="text-right px-3 py-1.5 font-medium">Qty</th>
              <th className="text-right px-3 py-1.5 font-medium">Unit price</th>
              <th className="text-right px-3 py-1.5 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {note.items.map((it, i) => (
              <tr key={i} className="border-t border-[#F0ECE9]">
                <td className="px-3 py-1.5">{it.description || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{it.quantity}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(it.unitPriceSen ?? it.unitPrice ?? 0)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(it.totalSen ?? it.total ?? 0)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#1F1D1B] font-semibold">
              <td className="px-3 py-1.5" colSpan={3}>Total</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${tone}`}>{sign}{formatCurrency(note.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocPopup>
  );
}
