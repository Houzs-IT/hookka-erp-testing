// Supplier-payment print voucher, shared by the Supplier Payment page
// (src/pages/invoices/supplier-payments.tsx) and the Payments hub
// (src/pages/accounting/index.tsx › PaymentsTab, owner 2026-09-28
// 「other creditor 的 payment 没出现在 payment voucher?」). Pure: no React, no DOM.
//
// It lives here and not on the page because react-refresh's
// `only-export-components` forbids exporting a plain function from a module
// that exports a component — the same lesson as src/lib/customer-receipt.ts.
import { formatCurrency, formatDateDMY } from "@/lib/utils";
import { COMPANY } from "@/lib/constants";
import { amountInWords } from "@/lib/amount-in-words";
import type { VoucherSpec, VoucherLine } from "@/lib/print-voucher";
import { apBillsBlock, type ApPrintDetail } from "@/lib/ap-payment-print";

// COMPANY.HOOKKA → the VoucherSpec.company shape (single source of truth);
// mirrors VOUCHER_COMPANY in customer-receipt.ts / accounting/index.tsx.
const VOUCHER_COMPANY: VoucherSpec["company"] = {
  name: COMPANY.HOOKKA.name,
  addressLines: COMPANY.HOOKKA.addressLines,
  regNo: COMPANY.HOOKKA.regNo,
  tin: COMPANY.HOOKKA.tin,
  phone: COMPANY.HOOKKA.phone,
  email: COMPANY.HOOKKA.email,
};

// The least a payment must carry to print — both callers' own row types
// (the page's `PaymentGroup`, the hub's `SupplierPaymentGroup`) satisfy it.
export type SupplierPaymentVoucherInput = {
  paymentNo: string;
  supplierName?: string | null;
  date: string;
  totalBankSen: number;
  lifecycleState?: string | null;
  lines: { piNo?: string | null; supplierInvoiceNo?: string | null; amountSen: number }[];
  /** The bank it was paid from, already labelled ("310-0010 · …"); omitted when unknown. */
  bankLabel?: string | null;
};

// One supplier payment → a SUPPLIER PAYMENT VOUCHER (print design 1a): the
// supplier with the bank it was paid from, the amount boxed beside it, one line
// per purchase invoice paid, total = totalBankSen. With the print detail
// (GET /api/accounting/ap-payment-print) the lines carry the bill date, due
// date and the balance before, and a strip shows the supplier's balance before
// / after; without it, the plain PI No · bank amount lines. Money stays integer
// sen, formatted with formatCurrency. Mirrors buildPvVoucher in accounting/index.
export function buildSupplierPaymentVoucher(p: SupplierPaymentVoucherInput, detail?: ApPrintDetail): VoucherSpec {
  const active = (p.lifecycleState ?? "ACTIVE") === "ACTIVE";
  const lines: VoucherLine[] = p.lines.map((l) => ({
    // A line with no PI is an advance / unallocated payment (the Supplier
    // Payment page's own knock-off case) — it prints as such, never blank.
    cells: [l.piNo || "Advance / unallocated", l.supplierInvoiceNo || "—", formatCurrency(l.amountSen)],
  }));
  const bills = detail
    ? apBillsBlock(detail, { totalSen: p.totalBankSen, money: formatCurrency, docLabel: "Purchase invoice", refLabel: "Supplier inv no.", partyWord: "Supplier" })
    : null;
  return {
    title: active ? "SUPPLIER PAYMENT VOUCHER" : "SUPPLIER PAYMENT VOUCHER — VOID",
    company: VOUCHER_COMPANY,
    docNo: p.paymentNo,
    date: formatDateDMY(p.date),
    partyLabel: "Pay To (Supplier)",
    partyName: p.supplierName ?? "",
    partyDetails: [{ label: "Payee bank", value: detail?.payeeBank ?? "" }, { label: "Paid from", value: p.bankLabel ?? "" }],
    amountBox: { label: "Amount paid", value: formatCurrency(p.totalBankSen) },
    columns: bills ? bills.columns : [{ label: "Purchase Invoice" }, { label: "Supplier Inv No" }, { label: "Amount", align: "right" }],
    lines: bills ? bills.lines : lines,
    totalCells: bills ? bills.totalCells : ["Total", "", formatCurrency(p.totalBankSen)],
    balanceStrip: bills?.balanceStrip,
    amountWords: amountInWords(p.totalBankSen),
    signatures: [{ label: "Prepared by" }, { label: "Approved by" }, { label: "Received by" }],
    printedOn: formatDateDMY(new Date()),
  };
}
