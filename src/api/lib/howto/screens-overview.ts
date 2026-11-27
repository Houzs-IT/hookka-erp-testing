// ---------------------------------------------------------------------------
// howto/screens-overview.ts — screen map for the overview / finance hub / HR /
// system / public / phone-shell pages. Written by reading each page's code
// (handlers, fetch URLs) and the server route's requirePermission call.
// Checked by tests/mcp-screen-map.test.mjs (paths in the router, labels in src/).
// ---------------------------------------------------------------------------
import type { ScreenEntry } from "./screen-types";

export const SCREENS: ScreenEntry[] = [
  // =========================================================================
  // OVERVIEW
  // =========================================================================
  {
    path: "/dashboard",
    title: "Dashboard (old address)",
    purpose:
      "Old dashboard address. It no longer has its own page: it redirects straight to the merged Dashboard at /dashboard-experimental, keeping any ?tab= and period in the URL.",
    sidebar: "Not in the sidebar on its own — OVERVIEW → Dashboard opens /dashboard-experimental. Old bookmarks to /dashboard land there.",
    sections: [],
    actions: [],
    detail: "basic",
    keywords: ["dashboard", "home", "仪表板", "首页", "papan pemuka", "laman utama"],
  },
  {
    path: "/dashboard-experimental",
    title: "Dashboard",
    purpose:
      "The company dashboard: sales, operations (production), employees (efficiency, attendance) and service charts in one page, all read from one cached GET /api/dashboard/prototype feed. A problems strip at the top links to things that need action. A period picker (month / YTD) under the tabs filters every tab with a date column. Read-only.",
    sidebar: "OVERVIEW → Dashboard",
    sections: ["Sales", "Operations", "Employees", "Service", "OCR"],
    actions: [
      { label: "Sales", kind: "tab", does: "Shows sales orders, invoices and pipeline charts for the chosen period." },
      { label: "Operations", kind: "tab", does: "Shows production, backlog and plant-load charts; has its own sub-tabs." },
      { label: "Employees", kind: "tab", does: "Shows worker efficiency and attendance charts; has its own sub-tabs." },
      { label: "Service", kind: "tab", does: "Shows service cases and approvals; has its own sub-tabs." },
      { label: "OCR", kind: "tab", does: "Shows the accuracy of the purchase-order scanner models (GET /api/ocr-accuracy/models). Desktop only." },
      { label: "Previous month", kind: "button", does: "Steps the period picker back one month (all tabs follow)." },
      { label: "Next month", kind: "button", does: "Steps the period picker forward one month." },
    ],
    detail: "basic",
    keywords: ["dashboard", "overview", "charts", "KPI", "仪表板", "总览", "图表", "papan pemuka", "carta", "ringkasan"],
  },
  {
    path: "/daily-report",
    title: "Hookka Report (daily report)",
    purpose:
      "Daily process / SOP exception report: what needs attention today (documents stuck too long at a step, late items). Each card opens a detail list. Step back and forward through days. Grace days per check are set in Settings and saved to kv-config.",
    sidebar: "OVERVIEW → Hookka Report",
    sections: [],
    actions: [
      { label: "◀", kind: "button", does: "Goes to the previous day's report." },
      { label: "▶", kind: "button", does: "Goes to the next day's report." },
      { label: "Print", kind: "button", does: "Opens the browser print dialog for the report." },
      { label: "Settings", kind: "button", does: "Opens the grace-days settings dialog for the checks." },
      { label: "Reset to defaults", kind: "button", does: "Puts the grace days in the dialog back to the built-in defaults (not saved until Save)." },
      { label: "Save", kind: "button", does: "Saves the grace days with PUT /api/kv-config/<daily report key>.", permission: "users:update", sideEffects: "Changes the thresholds for everyone who opens the report." },
      { label: "Back to overview", kind: "button", does: "Closes a card's detail list and returns to the overview." },
    ],
    detail: "basic",
    keywords: ["daily report", "Hookka Report", "exceptions", "SOP", "日报", "每日报告", "异常", "laporan harian", "pengecualian"],
  },
  {
    path: "/notifications",
    title: "Notifications",
    purpose:
      "Your system notifications (orders, production, inventory, delivery, quality, finance), with unread / critical / warning / info counts. Opening a notification marks it read.",
    sidebar: "OVERVIEW → Notifications (also the bell in the top bar)",
    sections: [],
    actions: [
      { label: "Mark All Read", kind: "button", does: "Marks every unread notification read with PUT /api/notifications; the top-bar bell clears at the same time.", permission: "notifications:update" },
      { label: "Mark Read", kind: "row-action", does: "Marks that one notification read (PUT /api/notifications).", permission: "notifications:update" },
      { label: "All", kind: "filter", does: "Shows every notification." },
      { label: "Unread", kind: "filter", does: "Shows unread notifications only." },
      { label: "Orders", kind: "filter", does: "Shows order notifications only." },
      { label: "Production", kind: "filter", does: "Shows production notifications only." },
      { label: "Finance", kind: "filter", does: "Shows finance notifications only." },
    ],
    detail: "basic",
    keywords: ["notifications", "alerts", "bell", "通知", "提醒", "notifikasi", "pemberitahuan"],
  },
  {
    path: "/announcements",
    title: "Announcements",
    purpose:
      "Post a notice that shows on workers' phones (and staff phones), optionally to chosen departments, with attachments; see who has read / acknowledged it and remind them.",
    sidebar: "OVERVIEW → Announcements",
    sections: [],
    actions: [
      { label: "Post Announcement", kind: "button", does: "Publishes the announcement with POST /api/announcements to the chosen audience.", permission: "announcements:create", sideEffects: "Appears on the recipients' phones immediately." },
      { label: "Attach files", kind: "button", does: "Uploads files (POST /api/files) and attaches them to the draft announcement." },
      { label: "Read receipts", kind: "button", does: "Shows who has read / acknowledged the announcement (GET /api/announcements/:id/acks)." },
      { label: "Remind un-acknowledged", kind: "button", does: "Sends a reminder to everyone who has not acknowledged it (POST /api/announcements/:id/remind).", permission: "announcements:update", sideEffects: "Sends push reminders." },
      { label: "Remind all", kind: "button", does: "Sends a reminder to every recipient (POST /api/announcements/:id/remind).", permission: "announcements:update", sideEffects: "Sends push reminders." },
      { label: "Hide", kind: "row-action", does: "Deactivates the announcement so phones stop showing it (PATCH /api/announcements/:id). Shows as Show when hidden.", permission: "announcements:update" },
      { label: "Delete", kind: "row-action", does: "Deletes the announcement (DELETE /api/announcements/:id).", permission: "announcements:delete", sideEffects: "Cannot be undone." },
    ],
    detail: "basic",
    keywords: ["announcement", "notice", "broadcast", "公告", "通告", "pengumuman", "notis"],
  },

  // =========================================================================
  // FINANCE — the /accounting hub (one page, ?tab= views)
  // =========================================================================
  {
    path: "/accounting",
    title: "Finance (accounting hub)",
    purpose:
      "The whole finance module on one page. Each FINANCE sidebar entry opens a view through /accounting?tab=<key> (the in-page tab bar was removed; the sidebar is the navigation). The title row carries the view's buttons and an (i) explanation. Money is entered in RM and stored as sen. Postings go to the general ledger. Gated by accounting:read; each write checks its own permission on the server.",
    sidebar: "FINANCE → Reports / Daily / Monthly / Debtors / Creditors / Setup (each child is one ?tab= view)",
    sections: [
      "Overview", "P&L", "Monthly P&L", "Cost Structure", "Cash Flow", "Balance Sheet", "Trial Balance", "General Ledger", "Stock Summary",
      "Payment Vouchers", "Receipts", "Fund Transfer", "Daily Cash Position",
      "Journal Entries", "Cash Book", "Stock Take", "Labour", "Fixed Assets", "Contra", "Self-check", "Corrections",
      "Debtor Aging", "Debtor List", "AR Invoices", "Other Debtor", "Other Debtor Bills", "Other Debtor Receipts",
      "Creditor Aging", "Creditor List", "AP Invoices", "Supplier Discount", "Other Creditor", "Other Creditor Bills", "Other Creditor Payments",
      "Chart of Accounts", "Currency & FX", "Stock Mapping", "Opening Stock", "Opening Balance", "Audit Log", "Maintenance",
    ],
    actions: [
      // ---- Reports (?tab=overview|pl|cashflow|bs|tb|gl|stock) ----
      { label: "Overview", kind: "tab", does: "?tab=overview — sales, profit, cost trends and AR / AP aging summary (reads /api/accounting/aging). Sidebar FINANCE → Reports → Overview." },
      { label: "P&L", kind: "tab", does: "?tab=pl — profit and loss. One page, three views switched on the title row; ?tab=plmonthly and ?tab=coststruct open the other two views. Sidebar FINANCE → Reports → P&L." },
      { label: "P&L Statement", kind: "toggle", does: "P&L view switch: one period, the full statement." },
      { label: "Monthly P&L", kind: "toggle", does: "P&L view switch: month by month side by side (?tab=plmonthly)." },
      { label: "Cost Structure", kind: "toggle", does: "P&L view switch: fixed / variable / other cost classes (?tab=coststruct)." },
      { label: "Overall", kind: "toggle", does: "Product-line switch on the P&L: all lines." },
      { label: "Sofa", kind: "toggle", does: "Product-line switch on the P&L: sofa only." },
      { label: "Bedframe", kind: "toggle", does: "Product-line switch on the P&L: bedframe only." },
      { label: "Cash Flow", kind: "tab", does: "?tab=cashflow — monthly cash flow with forecast rows. Sidebar FINANCE → Reports → Cash Flow." },
      { label: "Balance Sheet", kind: "tab", does: "?tab=bs — balance sheet with drill-down per account. Sidebar FINANCE → Reports → Balance Sheet." },
      { label: "Trial Balance", kind: "tab", does: "?tab=tb — trial balance as of a date (GET /api/accounting/trial-balance). Sidebar FINANCE → Reports → Trial Balance." },
      { label: "General Ledger", kind: "tab", does: "?tab=gl — every ledger line for an account and date range. Sidebar FINANCE → Reports → General Ledger." },
      { label: "Stock Summary", kind: "tab", does: "?tab=stock — month-end stock value summary and WIP detail. Sidebar FINANCE → Reports → Stock Summary." },
      // ---- Daily ----
      { label: "Payment Vouchers", kind: "tab", does: "?tab=payments — every payment out: expense vouchers, AP payments to suppliers / other creditors, transfers; with the Draft → Prepared → Checked → Approved ladder. Sidebar FINANCE → Daily → Payment Vouchers." },
      { label: "Receipts", kind: "tab", does: "?tab=receipts — every receipt in: customer receipts, other-debtor receipts, official receipts. Sidebar FINANCE → Daily → Receipts." },
      { label: "Fund Transfer", kind: "tab", does: "?tab=transfer — the old fund-transfer page (no longer in the menu; a transfer is now made from New Payment Voucher). Still opens by URL." },
      { label: "Daily Cash Position", kind: "tab", does: "?tab=dailycash — what is in each bank today, money due in and out. Sidebar FINANCE → Daily → Daily Cash Position." },
      // ---- Monthly ----
      { label: "Journal Entries", kind: "tab", does: "?tab=journals — manual journal vouchers (JV). Sidebar FINANCE → Monthly → Journal Entries." },
      { label: "Cash Book", kind: "tab", does: "?tab=cashbook — bank / cash book per account. Sidebar FINANCE → Monthly → Cash Book." },
      { label: "Stock Take", kind: "tab", does: "?tab=stocktake — month-end stock-take import and valuation for the books. Sidebar FINANCE → Monthly → Stock Take." },
      { label: "Labour", kind: "tab", does: "?tab=labor — production labour cost posting per department. Sidebar FINANCE → Monthly → Labour." },
      { label: "Fixed Assets", kind: "tab", does: "?tab=assets — fixed asset register and depreciation. Sidebar FINANCE → Monthly → Fixed Assets." },
      { label: "Contra", kind: "tab", does: "?tab=contra — offset what a party owes against what is owed to it. Sidebar FINANCE → Monthly → Contra." },
      { label: "Self-check", kind: "tab", does: "?tab=selfcheck — automatic consistency checks of the books. Sidebar FINANCE → Monthly → Self-check." },
      { label: "Corrections", kind: "tab", does: "?tab=corrections — list of correction entries. Sidebar FINANCE → Monthly → Corrections." },
      // ---- Debtors ----
      { label: "Debtor Aging", kind: "tab", does: "?tab=ar — who owes us, by age bucket (re-fetches /api/accounting/aging each time it opens). Sidebar FINANCE → Debtors → Debtor Aging." },
      { label: "Debtor List", kind: "tab", does: "?tab=debtors — every customer and other debtor in one list. Sidebar FINANCE → Debtors → Debtor List." },
      { label: "AR Invoices", kind: "tab", does: "?tab=arinvoices — sales invoices plus other-debtor bills in one list, with the customer statement below (?tab=odebtorbills lands here too). Sidebar FINANCE → Debtors → AR Invoices." },
      { label: "Other Debtor", kind: "tab", does: "?tab=odebtor — register of non-trade debtors (by URL only)." },
      { label: "Other Debtor Receipts", kind: "tab", does: "?tab=odebtorpay — receipts from other debtors (by URL only; new ones are made from Receipts)." },
      // ---- Creditors ----
      { label: "Creditor Aging", kind: "tab", does: "?tab=ap — what we owe, by age bucket. Sidebar FINANCE → Creditors → Creditor Aging." },
      { label: "Creditor List", kind: "tab", does: "?tab=creditors — every supplier and other creditor; other creditors are added and edited in a popup here. Sidebar FINANCE → Creditors → Creditor List." },
      { label: "AP Invoices", kind: "tab", does: "?tab=apinvoices — purchase invoices plus other-creditor bills, with the supplier statement below. Sidebar FINANCE → Creditors → AP Invoices." },
      { label: "Supplier Discount", kind: "tab", does: "?tab=supplier-discount — supplier discount records. Sidebar FINANCE → Creditors → Supplier Discount." },
      { label: "Other Creditor", kind: "tab", does: "?tab=ocreditor — register of other creditors (by URL only)." },
      { label: "Other Creditor Bills", kind: "tab", does: "?tab=ocreditorbills — bills from other creditors (by URL only)." },
      { label: "Other Creditor Payments", kind: "tab", does: "?tab=ocreditorpay — payments to other creditors (by URL only; new ones are AP payments on Payment Vouchers)." },
      // ---- Setup ----
      { label: "Chart of Accounts", kind: "tab", does: "?tab=coa — the account list. Sidebar FINANCE → Setup → Chart of Accounts." },
      { label: "Currency & FX", kind: "tab", does: "?tab=fx — currencies and exchange rates. Sidebar FINANCE → Setup → Currency & FX." },
      { label: "Stock Mapping", kind: "tab", does: "?tab=stockmap — which ledger account each stock group posts to. Sidebar FINANCE → Setup → Stock Mapping." },
      { label: "Opening Stock", kind: "tab", does: "?tab=openstock — opening stock values. Sidebar FINANCE → Setup → Opening Stock." },
      { label: "Opening Balance", kind: "tab", does: "?tab=opening — opening balances per account. Sidebar FINANCE → Setup → Opening Balance." },
      { label: "Audit Log", kind: "tab", does: "?tab=audit — who changed what in finance. Sidebar FINANCE → Setup → Audit Log." },
      { label: "Settings", kind: "tab", does: "?tab=maint (page heading Maintenance) — GST rate, financial years, cleanup report, landed cost, document numbering, trade-finance lines. Sidebar FINANCE → Setup → Settings." },

      // ---- Payment Vouchers (?tab=payments) buttons ----
      { label: "Print footer", kind: "button", does: "Payment Vouchers: gear button; edits the extra text printed at the foot of every voucher." },
      { label: "Scan", kind: "button", does: "Payment Vouchers: scan receipts / bills (POST /api/scan-finance/extract), one draft voucher each or merge several into one (POST /api/accounting/payment-vouchers).", permission: "accounting:create" },
      { label: "New Payment Voucher", kind: "button", does: "Payment Vouchers: opens the expense voucher form (pay an expense straight to its account, or a transfer)." },
      { label: "New AP Payment", kind: "button", does: "Payment Vouchers: opens the AP payment form (pay a supplier's purchase invoices or an other creditor's bills)." },
      { label: "Save as draft", kind: "button", does: "Payment Vouchers form: POST /api/accounting/payment-vouchers with saveAs draft — no number, nothing posted; goes onto the approval ladder.", permission: "accounting:create" },
      { label: "Post now", kind: "button", does: "Payment Vouchers form: POST /api/accounting/payment-vouchers — number issued and posted at once (AP: bills knocked off).", permission: "accounting:create", sideEffects: "Posts to the ledger immediately." },
      { label: "Save changes", kind: "button", does: "Payment Vouchers form when editing: PUT /api/accounting/payment-vouchers/:id.", permission: "accounting:update", sideEffects: "On a posted voucher the ledger is reversed and re-posted." },
      { label: "Prepare →", kind: "row-action", does: "Payment Vouchers: moves a draft to Prepared (POST approval action prepare).", permission: "accounting:update" },
      { label: "Withdraw", kind: "row-action", does: "Payment Vouchers: takes a prepared voucher back to draft.", permission: "accounting:update" },
      { label: "Check →", kind: "row-action", does: "Payment Vouchers: moves a prepared voucher to Checked and issues its formal PV number.", permission: "accounting:check" },
      { label: "Reject", kind: "row-action", does: "Payment Vouchers: sends a prepared or checked voucher back to draft with a reason.", permission: "accounting:check" },
      { label: "Approve & post", kind: "row-action", does: "Payment Vouchers: approves a checked voucher and posts it (row menu, detail popup, or the batch button above the list).", permission: "accounting:approve", sideEffects: "Posts to the ledger; AP payments knock off the bills." },
      { label: "Remind approver", kind: "row-action", does: "Payment Vouchers: POST /api/accounting/payment-vouchers/:id/remind — nudges the approver.", permission: "accounting:update", sideEffects: "Sends a notification." },
      { label: "Settle", kind: "row-action", does: "Payment Vouchers: settles an accrued posted voucher (POST /api/accounting/payment-vouchers/:id/settle).", permission: "accounting:update", sideEffects: "Posts the bank leg to the ledger." },
      { label: "Confirm bank amount", kind: "row-action", does: "Payment Vouchers: for a foreign-currency voucher, records the RM amount the bank actually debited." , permission: "accounting:update" },
      { label: "Print + files", kind: "row-action", does: "Payment Vouchers: prints the voucher together with its attached documents." },
      { label: "Edit description", kind: "row-action", does: "Payment Vouchers: edits the description of a fund-transfer row listed on the hub." },
      { label: "Open on its page ↗", kind: "link", does: "Payment Vouchers: opens a row that belongs to another page (e.g. supplier payment, fund transfer) on that page." },

      // ---- Receipts (?tab=receipts) buttons ----
      { label: "New Official Receipt", kind: "button", does: "Receipts: opens the official receipt form (money in that is not from a debtor); saves with POST /api/accounting/official-receipts.", permission: "accounting:create", sideEffects: "Posts to the ledger." },
      { label: "New Other Debtor Receipt", kind: "button", does: "Receipts: opens the other-debtor receipt form (non-trade debtor pays a bill).", permission: "accounting:create", sideEffects: "Posts to the ledger." },
      { label: "New Customer Receipt", kind: "button", does: "Receipts: opens the customer receipt form (allocate money to sales invoices); saves with the \"Record Payment\" button.", permission: "payments:create", sideEffects: "Posts to the ledger; invoices become paid / partly paid." },
      { label: "Record Payment", kind: "button", does: "Customer receipt form: saves the receipt (POST /api/payments).", permission: "payments:create", sideEffects: "Debits the bank, credits the customer, updates invoice status; can close the sales order." },

      // ---- Row menus shared by Payment Vouchers / Receipts (right-click or ⋮) ----
      { label: "Open", kind: "row-action", does: "Payment Vouchers / Receipts: opens the document's detail popup (double-click does the same)." },
      { label: "Print", kind: "row-action", does: "Prints the voucher / receipt." },
      { label: "Edit", kind: "row-action", does: "Re-opens the voucher / receipt in its form. Receipts: re-states in place (same number). Customer receipts use payments:update, others accounting:update.", permission: "accounting:update" },
      { label: "Duplicate", kind: "row-action", does: "Opens a new form pre-filled from this document (nothing saved until you save)." },
      { label: "Void", kind: "row-action", does: "Voids the document (POST …/lifecycle action void). Customer receipts check payments:update.", permission: "accounting:update", sideEffects: "Posts a reversal entry; nothing is deleted." },
      { label: "Delete", kind: "row-action", does: "Deletes the document (POST …/lifecycle action delete); hidden from the GL, still in the audit log.", permission: "accounting:update", sideEffects: "Removed from the ledger." },
      { label: "Unvoid", kind: "row-action", does: "Restores a voided or deleted document (POST …/lifecycle action unvoid).", permission: "accounting:update", sideEffects: "Re-posts it to the ledger." },

      // ---- Journal Entries (?tab=journals) ----
      { label: "New Journal Entry", kind: "button", does: "Journal Entries: opens a blank journal form." },
      { label: "Add Line", kind: "button", does: "Journal form: adds a debit / credit line (Insert key does the same)." },
      { label: "Save Journal Entry", kind: "button", does: "Journal form: saves with POST /api/accounting/journals (PUT /api/accounting/journals/:id when editing). Enabled only when debits equal credits.", permission: "accounting:create" },
      { label: "View detail", kind: "row-action", does: "Journal Entries: opens the entry's detail popup." },
      { label: "Print voucher", kind: "row-action", does: "Journal Entries: prints the journal voucher." },
      { label: "Post", kind: "row-action", does: "Journal Entries (draft only): PUT /api/accounting/journals/:id with status POSTED.", permission: "accounting:update", sideEffects: "Posts to the ledger." },
      { label: "Duplicate as draft (template)", kind: "row-action", does: "Journal Entries: copies the entry into a new DRAFT dated today (POST /api/accounting/journals).", permission: "accounting:create" },
      { label: "Refresh", kind: "row-action", does: "Journal Entries: reloads the list." },
    ],
    detail: "full",
    keywords: [
      "accounting", "finance", "ledger", "payment voucher", "receipt", "journal", "aging", "P&L", "balance sheet",
      "会计", "财务", "收款", "付款", "付款单", "收据", "日记账", "总账", "账龄", "损益表", "资产负债表",
      "akaun", "kewangan", "baucar bayaran", "resit", "jurnal", "lejar", "untung rugi", "kunci kira-kira",
    ],
  },
  {
    path: "/accounting/cash-flow",
    title: "Cash Flow & Bank Reconciliation (legacy)",
    purpose:
      "Older standalone cash page: 12-week cash forecast, matching bank statement lines to journal entries, and the bank account list. Superseded by FINANCE → Reports → Cash Flow and the Cash Book; still opens by URL.",
    sidebar: "Not in the sidebar — open /accounting/cash-flow directly.",
    sections: ["Cash Flow Forecast", "Bank Reconciliation", "Bank Accounts"],
    actions: [
      { label: "Cash Flow Forecast", kind: "tab", does: "Shows current cash, expected inflows / outflows for 12 weeks and net cash flow." },
      { label: "Bank Reconciliation", kind: "tab", does: "Lists a bank account's unmatched statement lines beside journal entries." },
      { label: "Match Selected", kind: "button", does: "Matches the selected bank line to the selected journal entry (POST /api/cash-flow, action reconcile).", permission: "cash-flow:create" },
      { label: "Add Transaction", kind: "button", does: "Adds a bank transaction (POST /api/cash-flow).", permission: "cash-flow:create" },
    ],
    detail: "basic",
    keywords: ["bank reconciliation", "cash flow", "银行对账", "现金流", "penyesuaian bank", "aliran tunai"],
  },
  {
    path: "/reports",
    title: "Reports (legacy hub)",
    purpose:
      "The old reports hub from before the finance module: sales, production, inventory, financial and employee reports with CSV export. Retired from the menu (the accounting views replace it); still opens by URL. Read-only.",
    sidebar: "Not in the sidebar (retired 2026-07-29) — open /reports directly.",
    sections: ["Sales", "Production", "Inventory", "Financial", "Employee"],
    actions: [
      { label: "Generate", kind: "button", does: "Builds the selected report for the chosen dates." },
      { label: "Generate Inventory Report", kind: "button", does: "Builds the stock valuation and product listing." },
      { label: "Generate Financial Report", kind: "button", does: "Builds the profit-and-loss summary." },
      { label: "Export CSV", kind: "button", does: "Downloads the report table as a CSV file." },
    ],
    detail: "basic",
    keywords: ["reports", "legacy reports", "报表", "报告", "laporan"],
  },
  {
    path: "/forecast",
    title: "Forecast P&L",
    purpose:
      "Planning only, nothing touches the books: each month's Actual beside its Forecast in the P&L layout. Key the forecast as RM or a % of that month's sales; the same sheet as the Monthly P&L's Edit forecast. Saved forecasts feed the Monthly P&L, Cash Flow and the Dashboard.",
    sidebar: "FORECASTING → Forecast P&L",
    sections: [],
    actions: [
      { label: "Save", kind: "button", does: "Saves the forecast with PUT /api/accounting/forecast.", permission: "accounting:update", sideEffects: "Changes the forecast rows on the Monthly P&L, Cash Flow and Dashboard." },
    ],
    detail: "basic",
    keywords: ["forecast", "budget", "P&L forecast", "预测", "预算", "ramalan", "belanjawan"],
  },
  {
    path: "/finance-dashboard",
    title: "Financial Dashboard",
    purpose:
      "Forecasting dashboard: revenue, COGS, raw material, production salary, overhead, gross and net profit by month, plus cash-flow and balance-sheet forecasts and ratios (reads /api/accounting/dashboard, /cashflow-forecast, /bs-forecast). Read-only.",
    sidebar: "FORECASTING → Dashboard",
    sections: [],
    actions: [
      { label: "Show all", kind: "button", does: "Shows every series on the chart." },
      { label: "Clear", kind: "button", does: "Hides every series on the chart." },
    ],
    detail: "basic",
    keywords: ["finance dashboard", "financial dashboard", "forecast", "财务仪表板", "papan pemuka kewangan"],
  },
  {
    path: "/board-report",
    title: "Board Report",
    purpose:
      "The monthly board report, live from the ERP (GET /api/reports/board?month=…), laid out as A4 pages to print or save as PDF.",
    sidebar: "FORECASTING → Board Report",
    sections: [],
    actions: [
      { label: "Refresh", kind: "button", does: "Rebuilds the report from the latest figures." },
      { label: "Download PDF", kind: "button", does: "Opens the browser print dialog (choose Save as PDF)." },
    ],
    detail: "basic",
    keywords: ["board report", "monthly report", "董事会报告", "月报", "laporan lembaga"],
  },

  // =========================================================================
  // HR
  // =========================================================================
  {
    path: "/employees",
    title: "Employees",
    purpose:
      "Workers, their hours, attendance, efficiency, labour cost and payroll. Summary cards on top, then tabs. Page gated by workers (nav-permissions); payroll actions need payslips permissions, worker edits need workers permissions, hour edits need attendance permissions.",
    sidebar: "HR & OPERATIONS → Employees",
    sections: [
      "Working Hours", "Attendance", "Labor Cost", "Efficiency Overview", "Department Labor", "Employee Performance",
      "Department Performance", "Payroll", "Advances", "Worker Penalty", "Outsource", "Employee Master",
    ],
    actions: [
      { label: "Working Hours", kind: "tab", does: "Per-day working-hour entries per worker (GET /api/working-hour-entries), with non-production hour requests to approve." },
      { label: "Attendance", kind: "tab", does: "Workers' phone punches (clock in / out) for a day with a soft geofence badge and punch photos." },
      { label: "Labor Cost", kind: "tab", does: "What the hours cost against the revenue produced, per department; month settlement of hour deductions." },
      { label: "Efficiency Overview", kind: "tab", does: "Efficiency per worker for a date range; click a worker to jump to Employee Performance." },
      { label: "Department Labor", kind: "tab", does: "Hours and labour cost per department and product category." },
      { label: "Employee Performance", kind: "tab", does: "One worker's job cards, hours, efficiency and OT for a date range." },
      { label: "Department Performance", kind: "tab", does: "Efficiency per department with daily drill-down." },
      { label: "Payroll", kind: "tab", does: "Monthly payslips: generate, approve, export, print; pay rules." },
      { label: "Advances", kind: "tab", does: "Salary advances paid early; deducted on the Payroll tab." },
      { label: "Worker Penalty", kind: "tab", does: "Penalties deducted from pay, with a draft → submit → approve flow." },
      { label: "Outsource", kind: "tab", does: "Outsource piece-rate rates and work summary." },
      { label: "Employee Master", kind: "tab", does: "The worker list: add, edit, PINs, salary changes." },

      // Working Hours
      { label: "Copy yesterday", kind: "button", does: "Working Hours: copies yesterday's entries as drafts onto the working date (nothing saved until Save)." },
      { label: "Add Row", kind: "button", does: "Working Hours: adds a blank entry row." },
      { label: "Save All", kind: "button", does: "Working Hours: saves every changed row (POST /api/working-hour-entries/bulk).", permission: "attendance:create" },
      { label: "Print", kind: "button", does: "Working Hours: prints the day's entries." },
      { label: "Delete entry", kind: "row-action", does: "Working Hours: deletes that entry (DELETE /api/working-hour-entries/:id).", permission: "attendance:delete" },
      { label: "Confirm Reject", kind: "button", does: "Working Hours: rejects a non-production hour request with a reason (POST …/nonprod-requests/:id/reject).", permission: "attendance:update" },
      { label: "Remove", kind: "row-action", does: "Working Hours: removes an approved adjustment, reversing it (POST …/nonprod-requests/:id/remove).", permission: "attendance:update" },

      // Employee Master
      { label: "Add Employee", kind: "button", does: "Employee Master: opens the add form, pre-filled with the next Emp No." },
      { label: "Save Employee", kind: "button", does: "Employee Master: creates the worker (POST /api/workers).", permission: "workers:create" },
      { label: "View Details", kind: "row-action", does: "Employee Master: opens the worker's details." },
      { label: "Set / Reset PIN", kind: "row-action", does: "Employee Master: sets a worker's phone PIN (POST /api/workers/:id/set-pin).", permission: "workers:update" },
      { label: "Delete employee", kind: "row-action", does: "Employee Master: deletes the worker (DELETE /api/workers/:id).", permission: "workers:delete", sideEffects: "Cannot be undone." },
      { label: "Confirm change", kind: "button", does: "Employee Master: records a salary change with its effective date (POST /api/workers/:id/salary-history).", permission: "workers:update", sideEffects: "Affects payroll from the effective date." },
      { label: "Generate PINs for new workers", kind: "button", does: "Employee Master: opens the bulk PIN dialog; Generate PINs calls POST /api/workers/bulk-generate-pins.", permission: "workers:update" },
      { label: "Download CSV", kind: "button", does: "Employee Master: downloads the generated PINs as CSV (shown once)." },

      // Department Labor
      { label: "Manage Departments", kind: "button", does: "Department Labor: opens the department list to add / edit / delete departments (/api/departments; create / update / delete each check their departments permission)." },
      { label: "Add Department", kind: "button", does: "Department manager: creates a department (POST /api/departments).", permission: "departments:create" },
      { label: "Dept QR Codes", kind: "button", does: "Department Labor: prints the department QR poster." },
      { label: "Print Report", kind: "button", does: "Prints the current tab's report (several tabs)." },

      // Labor Cost
      { label: "Settle month", kind: "button", does: "Labor Cost: settles the month's hour deductions from punches (POST /api/payroll-hour-deductions/settle-period) and regenerates payslips.", permission: "payslips:update", sideEffects: "Changes payslip amounts for the month." },

      // Payroll
      { label: "Generate Payslips", kind: "button", does: "Payroll: generates the month's payslips (POST /api/payslips with the period).", permission: "payslips:create" },
      { label: "Regenerate", kind: "button", does: "Payroll: rebuilds the month's payslips from current worker data (POST /api/payslips, regenerate).", permission: "payslips:create", sideEffects: "Overwrites the draft payslips." },
      { label: "Approve All", kind: "button", does: "Payroll: sets every payslip of the period to APPROVED (PUT /api/payslips).", permission: "payslips:update", sideEffects: "Posts the month's worker penalties; locks the month." },
      { label: "Withdraw Approval", kind: "button", does: "Payroll: puts the period's payslips back to DRAFT (PUT /api/payslips).", permission: "payslips:update", sideEffects: "Un-posts the month's penalties; the month is editable again." },
      { label: "Export CSV", kind: "button", does: "Payroll: downloads the payroll as CSV." },
      { label: "Calculation Guide", kind: "button", does: "Payroll: prints how each payslip figure is calculated." },
      { label: "Print Payslip", kind: "row-action", does: "Payroll: prints one worker's payslip." },
      { label: "Schedule a change", kind: "button", does: "Payroll → pay rules: opens a form for a future-dated pay-rule change.", permission: "payslips:update" },
      { label: "Save scheduled change", kind: "button", does: "Payroll → pay rules: saves the change (POST /api/pay-rules).", permission: "payslips:update", sideEffects: "Changes pay calculation from its effective date." },

      // Advances
      { label: "Export Payout Listing", kind: "button", does: "Advances: downloads the payout listing CSV." },

      // Worker Penalty
      { label: "New Penalty", kind: "button", does: "Worker Penalty: opens a new penalty form.", permission: "worker-penalties:create" },
      { label: "Save Draft", kind: "button", does: "Worker Penalty: saves the penalty as a draft (POST /api/worker-penalties).", permission: "worker-penalties:create" },
      { label: "Submit for Approval", kind: "button", does: "Worker Penalty: submits a draft (POST /api/worker-penalties/:id/submit).", permission: "worker-penalties:update" },
      { label: "Approve", kind: "button", does: "Worker Penalty: approves it (POST /api/worker-penalties/:id/approve).", permission: "worker-penalties:approve", sideEffects: "Deducted from pay in that payroll month." },

      // Outsource
      { label: "Upload Excel", kind: "button", does: "Outsource: reads a rates Excel file into the table." },
      { label: "Save Rates", kind: "button", does: "Outsource: saves the piece rates." },
      { label: "Export Summary", kind: "button", does: "Outsource: downloads the work summary CSV." },
    ],
    detail: "full",
    keywords: [
      "employees", "workers", "payroll", "payslip", "salary", "attendance", "working hours", "efficiency", "advance", "penalty",
      "员工", "工人", "工资", "薪水", "工资单", "考勤", "工时", "效率", "预支", "罚款",
      "pekerja", "gaji", "slip gaji", "kehadiran", "waktu kerja", "kecekapan", "pendahuluan",
    ],
  },

  // =========================================================================
  // SYSTEM
  // =========================================================================
  {
    path: "/settings",
    title: "Settings",
    purpose:
      "System configuration stored in kv-config: the two company profiles (HOOKKA INDUSTRIES SDN BHD and OHANA MARKETING), document numbering, production settings (departments, working calendar, lead times, special-order surcharges) and system settings (display, session, fiscal year). Every Save is PUT /api/kv-config/<key>, which the server gates with users:update. If nothing is saved yet, the page offers Initialize defaults. Note: the System Information card shows fixed sample figures, not live counts.",
    sidebar: "SYSTEM → Settings",
    sections: [
      "Company Profile", "Numbering", "Production", "System",
      "Document Numbering Configuration", "Department Configuration", "Working Calendar", "Lead Times by Product Category",
      "Special Order Surcharges", "Display Settings", "Session Settings", "Fiscal Year", "System Information",
    ],
    actions: [
      { label: "Company Profile", kind: "tab", does: "Company name, registration no., address, phone, email, website and bank details of both companies." },
      { label: "Numbering", kind: "tab", does: "Prefix / format / reset (Monthly or Yearly) per document type, with a preview number." },
      { label: "Production", kind: "tab", does: "Departments, working days calendar, lead times by product category, special-order surcharges." },
      { label: "System", kind: "tab", does: "Currency, date format, timezone, language, session timeout, max sessions, fiscal year start / end month." },
      { label: "Save Changes", kind: "button", does: "Company Profile: saves both company profiles (two kv-config PUTs).", permission: "users:update", sideEffects: "Changes the company details used on printed documents." },
      { label: "Save", kind: "row-action", does: "Numbering: saves the numbering rules (kv-config PUT).", permission: "users:update", sideEffects: "Changes how new document numbers are formed." },
      { label: "Save Production Settings", kind: "button", does: "Production: saves departments, calendar, lead times and surcharges (kv-config PUT).", permission: "users:update" },
      { label: "Save System Settings", kind: "button", does: "System: saves display, session and fiscal-year settings (kv-config PUT).", permission: "users:update" },
      { label: "Initialize defaults", kind: "button", does: "Shown only when nothing is saved yet: seeds every settings key with the recommended defaults.", permission: "users:update" },
    ],
    detail: "full",
    keywords: ["settings", "configuration", "company profile", "numbering", "设置", "配置", "公司资料", "编号", "tetapan", "konfigurasi", "profil syarikat"],
  },
  {
    path: "/settings/organisations",
    title: "Organisation Management",
    purpose:
      "Sister companies whose letterhead can print on a supplier's purchase order (HOOKKA stays the actual buyer), plus the HOOKKA ↔ OHANA inter-company configuration.",
    sidebar: "SYSTEM → Organisations",
    sections: [],
    actions: [
      { label: "Add Organisation", kind: "button", does: "Opens the form and creates an organisation (POST /api/organisations).", permission: "organisations:update" },
      { label: "Edit", kind: "row-action", does: "Edits an organisation (PUT /api/organisations/:id).", permission: "organisations:update" },
      { label: "Remove", kind: "row-action", does: "Deletes an organisation (DELETE /api/organisations/:id).", permission: "organisations:update" },
      { label: "Save Configuration", kind: "button", does: "Saves the inter-company configuration.", permission: "organisations:update" },
    ],
    detail: "basic",
    keywords: ["organisation", "company", "letterhead", "inter-company", "公司", "组织", "抬头", "organisasi", "syarikat"],
  },
  {
    path: "/settings/ai-connector",
    title: "AI Connector",
    purpose:
      "Connect Claude or ChatGPT to the ERP. Each person requests access and sees their own connections; the AI sees only what that person's ERP permissions allow. Super Admin also approves requests, turns access on / off per person, and controls AI actions (book a meeting, send an email) and write actions.",
    sidebar: "SYSTEM → AI Connector",
    sections: [],
    actions: [
      { label: "Request access", kind: "button", does: "Sends your access request to Super Admin (POST /api/mcp-admin/me/request)." },
      { label: "Disconnect", kind: "button", does: "Ends your AI connection (POST /api/mcp-admin/me/revoke); Super Admin's Disconnect ends someone else's (Super Admin only)." },
      { label: "Copy", kind: "button", does: "Copies the connector URL to paste into Claude / ChatGPT." },
      { label: "Approve", kind: "row-action", does: "Super Admin only: approves a pending access request." },
      { label: "Reject", kind: "row-action", does: "Super Admin only: rejects a pending access request." },
      { label: "Turn on", kind: "button", does: "Super Admin only: turns access on for a person without a request." },
      { label: "Remove", kind: "row-action", does: "Super Admin only: removes a person's access." },
      { label: "Allow AI actions (meetings, email)", kind: "toggle", does: "Super Admin only: main switch for AI actions; each one is shown to the person and done only after they confirm.", sideEffects: "Lets connected AIs book meetings / send email as the person." },
      { label: "Run check", kind: "button", does: "Super Admin only: runs the leak check of what the connector exposes." },
    ],
    detail: "basic",
    keywords: ["AI connector", "Claude", "ChatGPT", "MCP", "AI 连接", "人工智能", "penyambung AI"],
  },
  {
    path: "/settings/users",
    title: "User Management",
    purpose:
      "Super Admin page to manage logins: add users or send invites, edit name / department / position / reports-to / role, enable or disable, reset passwords, delete; the org chart; per-user permission overrides; and which mailboxes each user can open in Mail Center. Route guarded by role SUPER_ADMIN; the server also requires Super Admin for every write.",
    sidebar: "SYSTEM → User Management (shown to Super Admin only)",
    sections: ["Users", "Org Chart", "Permissions", "Mailbox Access", "Active Users", "Pending Invites", "Send New Invite"],
    actions: [
      { label: "Users", kind: "tab", does: "Active users table, pending invites and the invite form." },
      { label: "Org Chart", kind: "tab", does: "Reporting lines by department; add organisation departments." },
      { label: "Permissions", kind: "tab", does: "Per-user permission overrides on top of the role." },
      { label: "Mailbox Access", kind: "tab", does: "Which @hookka.com mailboxes each user can work in Mail Center, and their view level (L1 / L2 / L3)." },

      // Users tab
      { label: "Add user", kind: "button", does: "Opens the add-user drawer; Create account creates the login with a password (POST /api/users).", permission: "users:create", sideEffects: "Creates a working login immediately." },
      { label: "Create account", kind: "button", does: "Add-user drawer: POST /api/users.", permission: "users:create" },
      { label: "Edit details (name, department, position, reports to, role)", kind: "row-action", does: "Opens the user drawer; its Save writes PUT /api/users/:id (role, name, department, position) and the reporting line.", permission: "users:update", sideEffects: "A role change changes what the user can see and do." },
      { label: "Disable", kind: "row-action", does: "Disables the account (PUT /api/users/:id); shows Enable for a disabled account. You cannot disable yourself.", permission: "users:update", sideEffects: "The user can no longer sign in." },
      { label: "Enable", kind: "row-action", does: "Re-enables a disabled account (PUT /api/users/:id).", permission: "users:update" },
      { label: "Reset password", kind: "row-action", does: "Sets a new password for the user (POST /api/users/:id/reset-password).", permission: "users:update", sideEffects: "The old password stops working." },
      { label: "Delete", kind: "row-action", does: "Deletes the user after a confirm (DELETE /api/users/:id). You cannot delete yourself.", permission: "users:delete", sideEffects: "Cannot be undone." },
      { label: "Yes, delete", kind: "button", does: "User drawer: confirms the delete (DELETE /api/users/:id).", permission: "users:delete", sideEffects: "Cannot be undone." },
      { label: "Add alias", kind: "row-action", does: "Super Admin only: creates and assigns a @hookka.com mail alias for the user (POST /api/mail-center/addresses)." },
      { label: "Send Invite", kind: "button", does: "Sends an invite email with a 72-hour acceptance link (POST /api/users/invite).", permission: "users:create", sideEffects: "Sends an email." },
      { label: "Copy invite link", kind: "row-action", does: "Copies a pending invite's link." },
      { label: "Resend email", kind: "row-action", does: "Resends the invite email (POST /api/users/invites/:token/resend).", permission: "users:create", sideEffects: "Sends an email." },
      { label: "Revoke", kind: "row-action", does: "Cancels a pending invite (DELETE /api/users/invites/:token).", permission: "users:delete" },

      // Org Chart
      { label: "Add Department", kind: "button", does: "Org Chart: adds an organisation department (kv-config PUT).", permission: "users:update" },

      // Permissions tab
      { label: "Reset to role", kind: "button", does: "Permissions: removes the user's overrides so they get their role's permissions (DELETE /api/user-permissions/:id). Super Admin only." },
      { label: "Discard", kind: "button", does: "Permissions: throws away unsaved ticks." },
      { label: "Save", kind: "button", does: "Permissions: saves the user's permission overrides (PUT /api/user-permissions/:id). Super Admin only.", sideEffects: "Changes what the user can see and do." },

      // Mailbox Access tab
      { label: "Edit", kind: "row-action", does: "Mailbox Access: starts editing a user's mailbox ticks and view level; Save writes /api/mail-center/access and /scope-level. Super Admin only." },
    ],
    detail: "full",
    keywords: [
      "users", "user management", "login", "role", "invite", "permission", "reset password",
      "用户", "用户管理", "账号", "角色", "邀请", "权限", "重置密码",
      "pengguna", "pengurusan pengguna", "peranan", "jemputan", "kebenaran", "set semula kata laluan",
    ],
  },
  {
    path: "/settings/email-reports",
    title: "Email Reports",
    purpose:
      "Choose when each scheduled report email goes out (Malaysia time) and who receives it; send a test.",
    sidebar: "SYSTEM → Email Reports (shown to Super Admin only)",
    sections: [],
    actions: [
      { label: "Add time", kind: "button", does: "Adds a send time to the report." },
      { label: "Add", kind: "button", does: "Adds a recipient." },
      { label: "Send test now", kind: "button", does: "Sends the report now (POST /api/reports/<kind>/send).", sideEffects: "Sends an email." },
      { label: "Save", kind: "button", does: "Saves times and recipients (PUT /api/reports/settings). Super Admin only." },
    ],
    detail: "basic",
    keywords: ["email reports", "scheduled report", "邮件报告", "定时报告", "laporan e-mel"],
  },
  {
    path: "/admin/health",
    title: "System Health",
    purpose: "Super Admin monitoring: live load, slow pages / endpoints and failing requests for a chosen time range. Read-only.",
    sidebar: "SYSTEM → System Health (shown to Super Admin only)",
    sections: ["Right Now", "Speed — where it's slow", "Errors — what's failing"],
    actions: [
      { label: "Clear", kind: "button", does: "Clears the module filter." },
      { label: "Dismiss", kind: "button", does: "Hides the cold-start hint." },
    ],
    detail: "basic",
    keywords: ["system health", "monitoring", "errors", "系统健康", "监控", "kesihatan sistem"],
  },
  {
    path: "/kpi",
    title: "KPI",
    purpose:
      "Monthly KPI cards. Every login sees My KPI; Super Admin also has the KPI Library (define KPIs, assign people, set bonus and bands) and People (open anyone's card).",
    sidebar: "SYSTEM → KPI",
    sections: ["Library", "People", "My KPI"],
    actions: [
      { label: "Library", kind: "tab", does: "Super Admin: the KPI definitions and who is assigned." },
      { label: "People", kind: "tab", does: "Super Admin: pick a person to see their KPI card." },
      { label: "My KPI", kind: "tab", does: "Your own KPI card for the chosen month." },
      { label: "Assign", kind: "button", does: "Super Admin: assigns the selected people to a KPI (POST /api/kpi/kpi/:key/assignees)." },
      { label: "Set bonus", kind: "button", does: "Super Admin: opens the bonus and bands form for a KPI (saved to /api/kpi/payout)." },
    ],
    detail: "basic",
    keywords: ["KPI", "performance", "bonus", "绩效", "奖金", "prestasi", "bonus"],
  },
  {
    path: "/it-support",
    title: "IT Support",
    purpose: "Report a problem or request a change to IT; follow your own requests and IT's replies on this page. Every login, own tickets only.",
    sidebar: "SYSTEM → IT Support",
    sections: ["All", "Active", "Resolved"],
    actions: [
      { label: "Report a problem", kind: "button", does: "Opens the report form; submitting sends the ticket to IT (/api/it-support).", sideEffects: "Creates an IT ticket." },
      { label: "All my requests", kind: "button", does: "Goes back to your request list." },
    ],
    detail: "basic",
    keywords: ["IT support", "help", "ticket", "problem", "IT 支持", "报修", "问题", "sokongan IT", "tiket", "masalah"],
  },
  {
    path: "/meetings",
    title: "Meetings",
    purpose: "Book meeting rooms (shared with every company), see your meetings, manage rooms and guest booking links.",
    sidebar: "SYSTEM → Meetings",
    sections: ["Calendar", "My meetings", "Guest links", "Email and WhatsApp", "Change log"],
    actions: [
      { label: "Book a room", kind: "button", does: "Opens the meeting editor to book a room.", sideEffects: "Invitees are notified." },
      { label: "Today", kind: "button", does: "Jumps the calendar to today." },
      { label: "Make a guest booking link", kind: "button", does: "Opens Guest links to create a link outsiders can book with." },
    ],
    detail: "basic",
    keywords: ["meetings", "meeting room", "booking", "会议", "会议室", "预约", "mesyuarat", "bilik mesyuarat", "tempahan"],
  },
  {
    path: "/agents",
    title: "Agent Console",
    purpose: "Status and control of the ERP's automatic agents. Each login sees only the agents related to them; every control is Super Admin only.",
    sidebar: "SYSTEM → Agent Console",
    sections: [],
    actions: [
      { label: "Refresh", kind: "button", does: "Reloads agent status." },
      { label: "Kill all", kind: "button", does: "Super Admin only: stops every agent (shows Lift kill switch while on).", sideEffects: "All agents stop running." },
      { label: "Run now", kind: "button", does: "Super Admin only: runs that agent immediately." },
      { label: "Pause", kind: "button", does: "Super Admin only: pauses the agent (Resume restarts it)." },
      { label: "Rollback last batch", kind: "button", does: "Super Admin only: undoes the last approved batch of the production agent." },
    ],
    detail: "basic",
    keywords: ["agents", "automation", "agent console", "代理", "自动化", "ejen", "automasi"],
  },
  {
    path: "/setup-2fa",
    title: "Two-factor sign-in setup",
    purpose: "Turn on two-factor sign-in with an authenticator app (scan the code, enter the 6-digit number).",
    sidebar: "Not in the sidebar — offered after sign-in when two-factor is not on yet.",
    sections: [],
    actions: [
      { label: "Turn on two-factor sign-in", kind: "button", does: "Confirms the authenticator code (POST /api/auth/totp/setup-confirm).", sideEffects: "Future sign-ins ask for a code." },
      { label: "Skip for now", kind: "button", does: "Dismisses the prompt (POST /api/auth/totp/dismiss-prompt)." },
    ],
    detail: "basic",
    keywords: ["2FA", "two-factor", "authenticator", "双重验证", "两步验证", "pengesahan dua faktor"],
  },
  {
    path: "/analytics/forecast",
    title: "Demand Forecasting & Analytics",
    purpose: "Older demand-forecast page: product demand forecasts (moving averages), forecast accuracy and promise dates. Read-only.",
    sidebar: "Not in the sidebar — open /analytics/forecast directly.",
    sections: ["Dashboard", "Forecast Detail", "Accuracy", "Promise Date"],
    actions: [
      { label: "Forecast Detail", kind: "tab", does: "Per-product forecast by method." },
      { label: "Accuracy", kind: "tab", does: "Forecast error against actuals." },
    ],
    detail: "basic",
    keywords: ["demand forecast", "analytics", "需求预测", "分析", "ramalan permintaan"],
  },

  // =========================================================================
  // PUBLIC (no login)
  // =========================================================================
  {
    path: "/login",
    title: "Sign in",
    purpose: "Sign in with email and password (POST /api/auth/login).",
    sidebar: "Public page — opens when you are not signed in.",
    sections: [],
    actions: [
      { label: "Sign In", kind: "button", does: "Signs in." },
      { label: "Forgot Password?", kind: "link", does: "Opens /forgot-password." },
    ],
    detail: "basic",
    keywords: ["login", "sign in", "登录", "log masuk"],
  },
  {
    path: "/forgot-password",
    title: "Forgot password",
    purpose: "Request a password reset email (POST /api/auth/forgot-password).",
    sidebar: "Public page — Forgot Password? on the sign-in page.",
    sections: [],
    actions: [
      { label: "Send reset link", kind: "button", does: "Emails a reset link if the address has an account.", sideEffects: "Sends an email." },
      { label: "← Back to sign in", kind: "link", does: "Returns to /login." },
    ],
    detail: "basic",
    keywords: ["forgot password", "忘记密码", "lupa kata laluan"],
  },
  {
    path: "/reset-password",
    title: "Reset password",
    purpose: "Set a new password from the emailed reset link (POST /api/auth/reset-password).",
    sidebar: "Public page — opened from the reset email link.",
    sections: [],
    actions: [
      { label: "Set password", kind: "button", does: "Saves the new password.", sideEffects: "The old password stops working." },
    ],
    detail: "basic",
    keywords: ["reset password", "重置密码", "set semula kata laluan"],
  },
  {
    path: "/invite/:token",
    title: "Accept invite",
    purpose: "Accept a user invite: set your password and sign in (POST /api/auth/accept-invite). The token in the link is the credential.",
    sidebar: "Public page — opened from the invite email.",
    sections: [],
    actions: [
      { label: "Accept & Sign In", kind: "button", does: "Creates your login from the invite and signs you in." },
    ],
    detail: "basic",
    keywords: ["invite", "accept invite", "邀请", "接受邀请", "jemputan"],
  },
  {
    path: "/book/:code",
    title: "Book a meeting room (guest)",
    purpose: "Public guest booking page from a guest booking link: pick a slot and room and book; also shows / cancels an existing booking.",
    sidebar: "Public page — opened from a guest booking link made on Meetings → Guest links.",
    sections: [],
    actions: [
      { label: "Book room", kind: "button", does: "Books the room (/api/public/meetings).", sideEffects: "Creates a booking." },
      { label: "Cancel this booking", kind: "button", does: "Cancels the guest's booking.", sideEffects: "Frees the room." },
    ],
    detail: "basic",
    keywords: ["guest booking", "book room", "访客预约", "tempahan tetamu"],
  },
  {
    path: "/track",
    title: "Product Tracking",
    purpose: "Public page customers reach by scanning the QR sticker on a finished unit: shows that unit's status. No login.",
    sidebar: "Public page — opened by scanning a unit's QR sticker.",
    sections: [],
    actions: [
      { label: "Try again", kind: "button", does: "Retries loading the unit when the system could not be reached." },
    ],
    detail: "basic",
    keywords: ["track", "product tracking", "QR", "追踪", "产品追踪", "jejak produk"],
  },
  {
    path: "/s/:token",
    title: "Customer Feedback",
    purpose: "Public customer survey reached from a link: five questions plus a comment (POST /api/public/survey/:token).",
    sidebar: "Public page — opened from the survey link sent to the customer.",
    sections: [],
    actions: [
      { label: "Send my answers", kind: "button", does: "Submits the survey (all five questions must be answered)." },
    ],
    detail: "basic",
    keywords: ["survey", "feedback", "问卷", "反馈", "tinjauan", "maklum balas"],
  },

  // =========================================================================
  // PHONE SHELL (/m)
  // =========================================================================
  {
    path: "/m",
    title: "Phone Home (Dashboard)",
    purpose:
      "The phone app's home: header with search and bell, greeting, Scan to Create tiles, a dashboard view selector and the period bar, then the chosen view. Sales, Operations and Employees are built; Service and Finance show Coming soon. A user without dashboard access gets a permission-filtered module list instead.",
    sidebar: "Phone: open the ERP on a phone (or /m); the left menu button opens the module drawer.",
    sections: ["Sales", "Operations", "Employees", "Service", "Finance"],
    actions: [
      { label: "Search", kind: "button", does: "Opens the phone search." },
      { label: "Open Employees", kind: "button", does: "Opens the phone Employees screen from the Employees view." },
    ],
    detail: "basic",
    keywords: ["phone", "mobile", "home", "手机", "首页", "telefon", "mudah alih"],
  },
  {
    path: "/m/more",
    title: "More (phone)",
    purpose: "Phone profile and module menu: profile card with sign out, dark mode, signed-in devices, install app, the grouped module list and a link to the desktop app.",
    sidebar: "Phone: tablet rail More, or the left drawer (same content); also /m/more.",
    sections: [],
    actions: [
      { label: "Sign out", kind: "button", does: "Signs out (POST /api/auth/logout)." },
      { label: "Dark mode", kind: "toggle", does: "Switches the phone app between light and dark." },
      { label: "Signed-in devices", kind: "button", does: "Lists and ends this account's sessions." },
      { label: "Install app", kind: "button", does: "Installs the ERP as a home-screen app." },
      { label: "Open the full desktop app", kind: "link", does: "Opens the desktop dashboard." },
    ],
    detail: "basic",
    keywords: ["more", "menu", "profile", "sign out", "更多", "菜单", "退出", "lagi", "menu", "log keluar"],
  },
  {
    path: "/m/dashboard",
    title: "Phone dashboard (old address)",
    purpose: "Old phone dashboard address; redirects to /m with the matching view.",
    sidebar: "Not in the menu — old links land on /m.",
    sections: [],
    actions: [],
    detail: "basic",
    keywords: ["phone dashboard", "手机仪表板"],
  },
  {
    path: "/m/dashboard/:tab",
    title: "Phone dashboard tab (old address)",
    purpose: "Old phone dashboard tab address; redirects to /m?view=<matching view>.",
    sidebar: "Not in the menu — old links land on /m.",
    sections: [],
    actions: [],
    detail: "basic",
    keywords: ["phone dashboard", "手机仪表板"],
  },
  {
    path: "/m/meetings",
    title: "Meetings (phone)",
    purpose: "Phone version of Meetings: calendar, my meetings, rooms, guest links; book, end or cancel meetings.",
    sidebar: "Phone: left drawer → Meetings.",
    sections: ["Calendar", "My meetings", "Rooms", "Guest links"],
    actions: [
      { label: "End meeting", kind: "button", does: "Ends a running meeting early (frees the room)." },
      { label: "Cancel meeting", kind: "button", does: "Cancels the meeting.", sideEffects: "Invitees are notified." },
    ],
    detail: "basic",
    keywords: ["meetings", "phone", "会议", "mesyuarat"],
  },
  {
    path: "/m/it-support",
    title: "IT Support (phone)",
    purpose: "Phone version of IT Support: your requests, report a problem, IT's replies.",
    sidebar: "Phone: left drawer → IT Support.",
    sections: ["All", "Active", "Resolved"],
    actions: [
      { label: "View request", kind: "button", does: "Opens the request just sent." },
      { label: "Back to my requests", kind: "button", does: "Returns to the list." },
      { label: "Clear search and filters", kind: "button", does: "Resets search and filters." },
    ],
    detail: "basic",
    keywords: ["IT support", "phone", "报修", "sokongan IT"],
  },
  {
    path: "/m/updates",
    title: "Updates (phone)",
    purpose: "Phone page with two views: Notifications (default) and Announcements. Opening a notification marks it read.",
    sidebar: "Phone: the bell in the header, or the left drawer.",
    sections: ["Notifications", "Announcements"],
    actions: [
      { label: "Mark all read", kind: "button", does: "Marks every notification read (PUT /api/notifications).", permission: "notifications:update" },
    ],
    detail: "basic",
    keywords: ["updates", "notifications", "announcements", "通知", "公告", "notifikasi", "pengumuman"],
  },
  {
    path: "/m/outsource-issue",
    title: "Outsource Work (phone)",
    purpose: "Issue job-card stickers to outsource workers by scanning or typing the code, and track outsourced work (approve / send back records).",
    sidebar: "Phone: left drawer → Outsource Work.",
    sections: ["Outsource Work", "Tracking"],
    actions: [
      { label: "Tracking", kind: "tab", does: "Lists outsourced records with status chips, search and filters." },
    ],
    detail: "basic",
    keywords: ["outsource", "issue", "外包", "发外", "luar", "penyumberan luar"],
  },
  {
    path: "/m/finance",
    title: "Finance (phone menu)",
    purpose: "Phone Finance app menu: lists only the finance screens your role may open and the phone has. Report screens are read-only; Payment Vouchers is the one screen that writes.",
    sidebar: "Phone: left drawer → Finance.",
    sections: ["Finance Dashboard", "Daily Cash Position", "Overview", "P&L", "Cash Flow", "Balance Sheet", "Debtor Aging", "Creditor Aging", "Payment Vouchers"],
    actions: [
      { label: "Payment Vouchers", kind: "link", does: "Opens the phone voucher list (/m/finance/vouchers)." },
    ],
    detail: "basic",
    keywords: ["finance", "phone", "财务", "kewangan"],
  },
  {
    path: "/m/finance/:screen",
    title: "Finance screen (phone)",
    purpose: "One phone finance screen: dashboard, cash, overview, pl, cashflow, bs, debtors, creditors or vouchers. A screen your role may not open shows No access.",
    sidebar: "Phone: Finance menu → a row.",
    sections: [],
    actions: [
      { label: "Scan a bill to create a draft", kind: "button", does: "Vouchers screen: scans a bill into a draft payment voucher.", permission: "accounting:create" },
    ],
    detail: "basic",
    keywords: ["finance", "phone", "payment voucher", "财务", "付款单", "kewangan"],
  },
  {
    path: "/m/finance/:screen/:id",
    title: "Payment voucher detail (phone)",
    purpose: "One payment voucher on the phone with its approval ladder, edit (expense vouchers only) and documents.",
    sidebar: "Phone: Finance → Payment Vouchers → a voucher.",
    sections: [],
    actions: [
      { label: "Prepare", kind: "button", does: "Moves the draft to Prepared. Nothing is posted.", permission: "accounting:update" },
      { label: "Withdraw", kind: "button", does: "Takes a prepared voucher back to draft.", permission: "accounting:update" },
      { label: "Check", kind: "button", does: "Moves it to Checked and issues its formal number.", permission: "accounting:check" },
      { label: "Approve & post", kind: "button", does: "Approves the voucher and posts it to the ledger.", permission: "accounting:approve", sideEffects: "Posts to the ledger." },
      { label: "Void", kind: "button", does: "Voids the voucher; a posted one gets a reversal entry.", permission: "accounting:update" },
      { label: "Take a photo", kind: "button", does: "Attaches a photo to the voucher (POST …/payment-vouchers/:id/attachments)." },
      { label: "Upload a file", kind: "button", does: "Attaches a file to the voucher." },
    ],
    detail: "basic",
    keywords: ["payment voucher", "approve", "付款单", "审批", "baucar bayaran", "lulus"],
  },
  {
    path: "/m/receivables",
    title: "Receivables (phone hub)",
    purpose: "Phone Receivable app: six read-only views, each shown only if your role may open the matching desktop page. Nothing here writes.",
    sidebar: "Phone: left drawer → Receivables.",
    sections: ["Debtor Aging", "Debtor List", "AR Invoices", "Customer Statement", "Receipts", "Credit & Debit Notes"],
    actions: [],
    detail: "basic",
    keywords: ["receivables", "debtors", "应收", "账龄", "penghutang", "akaun belum terima"],
  },
  {
    path: "/m/receivables/:view",
    title: "Receivable view (phone)",
    purpose: "One read-only receivable view (debt, rlist, rinv, rstmt, rcpt or rnote), with a chip rail to hop between views.",
    sidebar: "Phone: Receivables → a view.",
    sections: [],
    actions: [],
    detail: "basic",
    keywords: ["receivables", "应收", "penghutang"],
  },
  {
    path: "/m/receivables/:view/:id",
    title: "Receivable record (phone)",
    purpose: "One record inside a receivable view (read-only); sales invoices and customers open their own detail screens.",
    sidebar: "Phone: Receivables → a view → a row.",
    sections: [],
    actions: [],
    detail: "basic",
    keywords: ["receivables", "应收", "penghutang"],
  },
  {
    path: "/m/serviceorders/sv/new",
    title: "New service order (phone)",
    purpose: "Create an SV service order on the phone: blank, copied from a sales / consignment order, from a service case, or cloned.",
    sidebar: "Phone: Service Orders → new.",
    sections: [],
    actions: [
      { label: "Save draft", kind: "button", does: "Saves the order as a draft (POST /api/sales-orders).", permission: "sales-orders:create" },
      { label: "Save & confirm", kind: "button", does: "Saves, then confirms (POST /api/sales-orders/:id/confirm).", permission: "sales-orders:confirm", sideEffects: "Confirming creates production orders for every line." },
      { label: "Discard", kind: "button", does: "Leaves without saving." },
    ],
    detail: "basic",
    keywords: ["service order", "SV", "repair", "售后单", "维修", "pesanan servis"],
  },
  {
    path: "/m/serviceorders/sv/:id/edit",
    title: "Edit service order (phone)",
    purpose: "Edit an SV service order while the server says it is editable (locked once production has started).",
    sidebar: "Phone: service order detail → Edit order.",
    sections: [],
    actions: [
      { label: "Save changes", kind: "button", does: "Saves the edited order (PUT /api/sales-orders/:id).", permission: "sales-orders:update" },
    ],
    detail: "basic",
    keywords: ["service order", "edit", "售后单", "pesanan servis"],
  },
  {
    path: "/m/serviceorders/sv/:id",
    title: "Service order detail (phone)",
    purpose: "SV service order detail: status, production progress from job cards, order information, items, document flow. Actions follow the desktop sales-order rules.",
    sidebar: "Phone: Service Orders → an order.",
    sections: ["Order information", "Summary", "Production progress"],
    actions: [
      { label: "Confirm order", kind: "button", does: "Confirms a draft (POST /api/sales-orders/:id/confirm).", permission: "sales-orders:confirm", sideEffects: "Creates production orders." },
      { label: "Create delivery", kind: "button", does: "Creates a delivery order when ready to ship.", permission: "delivery-orders:create" },
      { label: "Generate invoice", kind: "button", does: "Creates the invoice once delivered.", permission: "invoices:create" },
      { label: "Edit order", kind: "menu", does: "Opens the edit form (locked once production started).", permission: "sales-orders:update" },
      { label: "Put on hold", kind: "menu", does: "Puts the order on hold.", permission: "sales-orders:update" },
      { label: "Resume order", kind: "menu", does: "Resumes an on-hold order.", permission: "sales-orders:update" },
      { label: "Cancel order", kind: "menu", does: "Cancels the order.", permission: "sales-orders:update" },
      { label: "Undo cancel", kind: "menu", does: "Restores a cancelled order.", permission: "sales-orders:update" },
      { label: "Clone", kind: "menu", does: "Starts a new service order from this one.", permission: "sales-orders:create" },
      { label: "Files", kind: "menu", does: "Shows the order's attached files." },
    ],
    detail: "basic",
    keywords: ["service order", "SV", "售后单", "pesanan servis"],
  },
];
