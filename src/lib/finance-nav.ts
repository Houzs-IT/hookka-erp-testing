// ---------------------------------------------------------------------------
// finance-nav.ts — one record per finance page (owner 2026-10-14: menu name =
// page name). The page header, the breadcrumb strip, the workspace tab label
// and the sidebar's highlight all read it, so a page is called the same thing
// everywhere. Pages with no menu item of their own (`menuKey`) light up the
// item they belong to and take its group.
// ---------------------------------------------------------------------------

export type FinanceGroup = "Reports" | "Daily" | "Monthly" | "Debtors" | "Creditors" | "Setup";

export type FinancePage = {
  title: string;
  group: FinanceGroup;
  /** One line under the title. */
  subtitle: string;
  /** The page shows money: the header adds "amounts in RM". */
  money: boolean;
  /** The menu item this page belongs to when it has none of its own. */
  menuKey?: string;
};

export const FINANCE_PAGES: Record<string, FinancePage> = {
  overview: { title: "Overview", group: "Reports", subtitle: "This month at a glance", money: true },
  pl: { title: "Profit & Loss", group: "Reports", subtitle: "Sales, cost of goods sold and expenses", money: true },
  plmonthly: { title: "Profit & Loss", group: "Reports", subtitle: "Sales, cost of goods sold and expenses", money: true, menuKey: "pl" },
  coststruct: { title: "Profit & Loss", group: "Reports", subtitle: "Sales, cost of goods sold and expenses", money: true, menuKey: "pl" },
  cashflow: { title: "Cash Flow", group: "Reports", subtitle: "Money in and out of the bank, month by month", money: true },
  bs: { title: "Balance Sheet", group: "Reports", subtitle: "What the company owns and owes at a month-end", money: true },
  tb: { title: "Trial Balance", group: "Reports", subtitle: "Every account's balance — debits equal credits", money: true },
  gl: { title: "General Ledger", group: "Reports", subtitle: "Every entry posted to an account", money: true },
  stock: { title: "Stock Summary", group: "Reports", subtitle: "Opening, purchases, consumption and closing stock by material group", money: true },
  payments: { title: "Payment Vouchers", group: "Daily", subtitle: "Money out · Draft → Prepared → Checked → Approved", money: true },
  receipts: { title: "Receipts", group: "Daily", subtitle: "Money in · customer, other debtor and official receipts", money: true },
  transfer: { title: "Fund Transfer", group: "Daily", subtitle: "Money moved between bank accounts", money: true, menuKey: "payments" },
  dailycash: { title: "Cash Position", group: "Daily", subtitle: "The bank today and what is still to come in or go out", money: true },
  odebtorpay: { title: "Other Debtor Receipts", group: "Daily", subtitle: "Money in from parties other than customers", money: true, menuKey: "receipts" },
  ocreditorpay: { title: "Other Creditor Payments", group: "Daily", subtitle: "Money out to parties other than suppliers", money: true, menuKey: "payments" },
  journals: { title: "Journal Entries", group: "Monthly", subtitle: "Journals keyed by hand, and postings the system makes", money: true },
  cashbook: { title: "Cash Book", group: "Monthly", subtitle: "Bank reconciliation — statements matched against the books", money: true },
  stocktake: { title: "Stock Take", group: "Monthly", subtitle: "Month-end stock counts by material group", money: true },
  labor: { title: "Labour", group: "Monthly", subtitle: "Month-end posting of production wages", money: true },
  assets: { title: "Fixed Assets", group: "Monthly", subtitle: "Assets and their depreciation", money: true },
  selfcheck: { title: "Self-check", group: "Monthly", subtitle: "Consistency checks across the books", money: true },
  corrections: { title: "Corrections", group: "Monthly", subtitle: "Posted documents edited or cancelled afterwards", money: true },
  ar: { title: "Debtor Aging", group: "Debtors", subtitle: "What customers owe, by age", money: true },
  odebtorbills: { title: "Other Debtor Bills", group: "Debtors", subtitle: "Bills raised to parties other than customers", money: true },
  odebtor: { title: "Other Debtors", group: "Debtors", subtitle: "Parties other than customers who owe us", money: false, menuKey: "odebtorbills" },
  ap: { title: "Creditor Aging", group: "Creditors", subtitle: "What we owe suppliers, by age", money: true },
  apinvoices: { title: "AP Invoices", group: "Creditors", subtitle: "Everything owed on paper in one list", money: true },
  ocreditorbills: { title: "Other Creditor Bills", group: "Creditors", subtitle: "Bills from parties other than suppliers", money: true, menuKey: "apinvoices" },
  ocreditor: { title: "Other Creditors", group: "Creditors", subtitle: "Parties other than suppliers we owe", money: false },
  "supplier-discount": { title: "Supplier Discount", group: "Creditors", subtitle: "Discounts and credits received from suppliers", money: true },
  coa: { title: "Chart of Accounts", group: "Setup", subtitle: "Accounts, their types and sections", money: false },
  stockmap: { title: "Stock Mapping", group: "Setup", subtitle: "Which accounts each material group posts to", money: false },
  openstock: { title: "Opening Stock", group: "Setup", subtitle: "Quantity and cost on hand at the switch date", money: true },
  opening: { title: "Opening Balance", group: "Setup", subtitle: "Balances brought into the books on the opening date", money: true },
  audit: { title: "Audit Log", group: "Setup", subtitle: "Who changed what, and when", money: false },
  maint: { title: "Settings", group: "Setup", subtitle: "Tax rate, financial year, numbering and other settings", money: false },
};

/** Where each menu group's own link goes (its first page). */
export const FINANCE_GROUP_HOME: Record<FinanceGroup, string> = {
  Reports: "overview",
  Daily: "payments",
  Monthly: "journals",
  Debtors: "ar",
  Creditors: "ap",
  Setup: "coa",
};

/** The page a `?tab=` value names (an unknown or missing tab is the Overview, as the page itself falls back). */
export function financePage(tab: string | null | undefined): FinancePage & { key: string } {
  const key = tab && FINANCE_PAGES[tab] ? tab : "overview";
  return { key, ...FINANCE_PAGES[key] };
}

/** The menu item a `?tab=` value lights up. */
export function financeMenuKey(tab: string | null | undefined): string {
  const p = financePage(tab);
  return p.menuKey ?? p.key;
}

/** The one-line subtitle the page header shows. */
export function financeSubtitle(p: FinancePage): string {
  return p.money ? `${p.subtitle} · amounts in RM` : p.subtitle;
}
