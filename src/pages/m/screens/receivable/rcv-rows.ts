// ---------------------------------------------------------------------------
// The Receivable hub's rows (Batch 3 prototype order) and their desktop gates.
// Plain module so ReceivableRoute.tsx exports components only (react-refresh).
// ---------------------------------------------------------------------------
import { Banknote, BookUser, FileMinus2, HandCoins, Receipt, ScrollText, type LucideIcon } from "lucide-react";

export type RcvView = "debt" | "rlist" | "rinv" | "rstmt" | "rcpt" | "rnote";
type RcvRow = { k: RcvView; l: string; s: string; icon: LucideIcon; c: string; bg: string; gates: string[] };

/** The hub's rows, in the prototype's order, each with the desktop gate(s) it follows. */
export const RCV_ROWS: RcvRow[] = [
  { k: "debt", l: "Debtor Aging", s: "Who owes us, by month", icon: HandCoins, c: "#4F7C3A", bg: "#EEF3E4", gates: ["/accounting?tab=ar"] },
  { k: "rlist", l: "Debtor List", s: "Customers and other debtors", icon: BookUser, c: "#2B5797", bg: "#E3EAF5", gates: ["/accounting?tab=debtors"] },
  { k: "rinv", l: "AR Invoices", s: "Invoices and other-debtor bills", icon: Receipt, c: "#6B5C32", bg: "#F4EFE6", gates: ["/accounting?tab=arinvoices"] },
  { k: "rstmt", l: "Customer Statement", s: "Balance over a date range", icon: ScrollText, c: "#6B4A6D", bg: "#F1E9F0", gates: ["/accounting?tab=arinvoices"] },
  { k: "rcpt", l: "Receipts", s: "Money received", icon: Banknote, c: "#1F9E89", bg: "#DDF1EC", gates: ["/accounting?tab=receipts"] },
  { k: "rnote", l: "Credit & Debit Notes", s: "Adjustments to invoices", icon: FileMinus2, c: "#85600F", bg: "#FAEFCB", gates: ["/invoices/credit-notes", "/invoices/debit-notes"] },
];

/** The rows a role may open (any one of a row's gates is enough). */
export function allowedRcvRows(isAllowed: (href: string) => boolean): RcvRow[] {
  return RCV_ROWS.filter((r) => r.gates.some((g) => isAllowed(g)));
}
