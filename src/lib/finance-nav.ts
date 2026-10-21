// ---------------------------------------------------------------------------
// finance-nav.ts — the name and the (i) explanation of every finance page
// (finance v2, owner 2026-10-16: page title 22px/700, explanations behind an
// (i) icon instead of a grey sub-line). One record per `?tab=` of the
// accounting page; FinancePageTitle reads it.
// ---------------------------------------------------------------------------

export type FinancePageInfo = {
  title: string;
  /** What the page is for — shown when the (i) next to the title is opened. */
  explain: string;
  /** Pages the explanation points to, shown as links under it. */
  links?: { label: string; to: string }[];
};

export const FINANCE_PAGES: Record<string, FinancePageInfo> = {
  overview: { title: "Overview", explain: "Sales, profit and production, month by month. Point at a bar, a point or a figure to see how it is made." },
  pl: { title: "Profit & Loss", explain: "Sales, cost of goods sold and expenses. A cell marked est. is a recurring cost not recorded yet this month, taken from last month." },
  plmonthly: { title: "Profit & Loss", explain: "The P&L month by month for the financial year, with the year so far first." },
  coststruct: { title: "Profit & Loss", explain: "Where the money went: spend, purchases and closing stock by material group." },
  cashflow: { title: "Cash Flow", explain: "Money in and out of the bank, month by month. Money in is positive; money out is in brackets." },
  bs: { title: "Balance Sheet", explain: "What the company owns and owes at a month-end." },
  tb: { title: "Trial Balance", explain: "Every account's balance at a date; total debits equal total credits." },
  gl: { title: "General Ledger", explain: "Every entry posted to an account, with the balance brought forward and carried forward." },
  stock: { title: "Stock Summary", explain: "Opening, purchases, consumption and closing stock by material group, plus work in progress and finished goods." },
  payments: {
    title: "Payment Vouchers",
    explain: "Every payment out, in one list. AP Payment pays a creditor's bills (purchase invoices or other creditor bills); Payment Voucher pays an expense. A voucher goes Draft → Prepared → Checked → Approved, and only Approved posts to the books (or Post now). A foreign-currency bill is paid in its own currency at the payment month's rate from Setup › Currency & FX (it can be changed). Advance knock-off is done on the Supplier Payment page. Payments recorded there and on Other Creditor Payments are listed here too (SP / OCP), in the same HPV number series.",
    links: [
      { label: "Supplier Payment page", to: "/invoices/supplier-payments" },
      { label: "Other Creditor Payments", to: "/accounting?tab=ocreditorpay" },
    ],
  },
  receipts: { title: "Receipts", explain: "Every payment in, in one list. Customer Receipt settles sales invoices; Other Debtor Receipt settles other debtor bills; Official Receipt books sundry income. Each posts on save." },
  transfer: { title: "Fund Transfer", explain: "Money moved between your own bank and cash accounts." },
  dailycash: { title: "Daily Cash Position", explain: "Each bank today, and what is still to come in or go out (receipts first, then payments). Tick a row when your banking app shows it went through — the estimate turns daily-accurate. Statements still referee at month end." },
  journals: { title: "Journal Entries", explain: "Journals keyed by hand, and the postings the system makes (read-only)." },
  cashbook: { title: "Cash Book", explain: "Bank reconciliation: each month's bank statement matched against the books, then finalised." },
  selfcheck: { title: "Self-check", explain: "Consistency checks across the books, each with where to fix it." },
  corrections: { title: "Corrections", explain: "Posted documents that were edited or cancelled afterwards." },
  assets: { title: "Fixed Assets", explain: "The asset register and its monthly depreciation." },
  contra: { title: "Contra", explain: "A customer who is also a supplier: offset what we owe them against what they owe us, through 490-0000. Both sides settle in one entry." },
  ar: { title: "Debtor Aging", explain: "What customers owe, by how long it has been outstanding." },
  ap: { title: "Creditor Aging", explain: "What we owe suppliers, other creditors and the trade-finance lender, by how long it has been outstanding. Each trade-finance line has a card with its limit, what is used and what is still available; open a drawdown's row (›) to change its due date, interest or bank charges. Repay with an AP Payment on Payment Vouchers." },
  debtors: { title: "Debtor List", explain: "Everyone who owes us money — trade customers and other debtors — in one place. Double-click a row to edit it: an other debtor opens right here (+ New Other Debtor adds one; its right-click sets it inactive or deletes it), a customer on Customers." },
  creditors: { title: "Creditor List", explain: "Everyone we owe — suppliers and other creditors — in one place. Double-click a row to edit it: an other creditor opens right here (+ New Other Creditor adds one; its right-click sets it inactive or deletes it), a supplier on its own page." },
  apinvoices: { title: "AP Invoices", explain: "Everything owed on paper in one list: purchase invoices and other creditor bills. A supplier's statement is at the foot." },
  "supplier-discount": { title: "Supplier Discount", explain: "Discounts and credits received from suppliers." },
  odebtor: { title: "Other Debtors", explain: "Parties other than customers who owe us." },
  arinvoices: { title: "AR Invoices", explain: "Everything owed to us on paper in one list: sales invoices and other debtor bills. Receive opens Receipts with the document ticked. A customer's statement is at the foot." },
  // The old address renders AR Invoices (2026-10-21).
  odebtorbills: { title: "AR Invoices", explain: "Everything owed to us on paper in one list: sales invoices and other debtor bills. Receive opens Receipts with the document ticked. A customer's statement is at the foot." },
  odebtorpay: { title: "Other Debtor Receipts", explain: "Money in from parties other than customers." },
  ocreditor: { title: "Other Creditors", explain: "Parties other than suppliers that we owe." },
  ocreditorbills: { title: "Other Creditor Bills", explain: "Bills from parties other than suppliers." },
  ocreditorpay: { title: "Other Creditor Payments", explain: "Money out to parties other than suppliers." },
  coa: { title: "Chart of Accounts", explain: "Accounts, their types and the report sections they go to." },
  fx: { title: "Currency & FX", explain: "Monthly rates keyed by Finance (1 unit = RM). A form fills in the rate for its document's month — it can be changed there, and each document keeps its own rate. A realised FX gain or loss on a payment posts to the accounts set here." },
  labor: { title: "Labour", explain: "Month-end posting of production wages and the employer's contributions." },
  stockmap: { title: "Stock Mapping", explain: "Which accounts each material group posts to." },
  openstock: { title: "Opening Stock", explain: "Quantity and cost on hand at the switch date." },
  stocktake: { title: "Stock Take", explain: "Month-end stock counts by material group; the P&L closing stock reads them." },
  opening: { title: "Opening Balance", explain: "Balances brought into the books on the opening date." },
  audit: { title: "Audit Log", explain: "All changes: everything done in Finance month by month — postings, edits (the entry before and after), voids, restores, deletes, payment voucher approvals and settings — who did it and when. Voided & deleted: the documents voided or deleted now, with Unvoid where allowed." },
  maint: { title: "Settings", explain: "Tax rate, financial year, document numbering, landed cost and clean-up checks." },
};

/** The page a `?tab=` value names; an unknown or missing tab is the Overview,
 *  as the accounting page itself falls back. Only {title, explain}, so it can
 *  be spread onto FinancePageTitle. */
export function financePage(tab: string | null | undefined): FinancePageInfo {
  const p = (tab && FINANCE_PAGES[tab]) || FINANCE_PAGES.overview;
  return p.links ? { title: p.title, explain: p.explain, links: p.links } : { title: p.title, explain: p.explain };
}
