// ---------------------------------------------------------------------------
// howto/modules.ts — module_overview data. One entry per ERP sidebar section
// (src/components/layout/sidebar.tsx, the NAV groups) with its key pages as
// the sidebar names them. tests/mcp-howto.test.mjs checks every page name
// appears in sidebar.tsx and every path exists in the router.
// ---------------------------------------------------------------------------

export type ModulePage = { name: string; path: string };

export type ModuleOverview = {
  id: string;
  /** The sidebar section label, exactly as the sidebar shows it. */
  section: string;
  oneLine: string;
  purpose: string;
  pages: ModulePage[];
  usedBy: string;
  /** How it links to the other modules. */
  links: string[];
  /** Related how-to guide ids. */
  guides: string[];
  keywords: string[];
};

export const MODULES: ModuleOverview[] = [
  {
    id: "overview",
    section: "OVERVIEW",
    oneLine: "Dashboard, the daily Hookka Report, notifications, announcements and the shared Mail Center.",
    purpose: "The starting point each day: headline numbers, what changed, messages to staff and the company mailbox.",
    pages: [
      { name: "Dashboard", path: "/dashboard-experimental" },
      { name: "Hookka Report", path: "/daily-report" },
      { name: "Notifications", path: "/notifications" },
      { name: "Announcements", path: "/announcements" },
      { name: "Mail Center", path: "/mail-center" },
    ],
    usedBy: "Everyone; the Dashboard figures follow each role's permissions.",
    links: ["Mail Center emails can be linked to sales orders, POs and service cases.", "Dashboard numbers come from Sales, Production, Delivery and Finance."],
    guides: ["mail-center-reply"],
    keywords: ["dashboard", "home", "report", "mail", "email", "邮件", "主页", "公告", "emel", "pengumuman"],
  },
  {
    id: "sales",
    section: "SALES & CUSTOMERS",
    oneLine: "Sales orders, delivery orders, delivery returns, invoices, consignment, customers and the sales pipeline.",
    purpose: "Everything from the customer's order to the invoice: take the order, deliver it, bill it, and keep customer records and prices.",
    pages: [
      { name: "Sales Orders", path: "/sales" },
      { name: "Delivery Order", path: "/delivery" },
      { name: "Delivery Return", path: "/delivery-returns" },
      { name: "Invoices", path: "/invoices" },
      { name: "Invoice Price Summary", path: "/invoices/price-summary" },
      { name: "Consignment Order", path: "/consignment" },
      { name: "Consignment Note", path: "/consignment/note" },
      { name: "Consignment Return", path: "/consignment/return" },
      { name: "Customers", path: "/customers" },
      { name: "Sales Pipeline", path: "/leads" },
    ],
    usedBy: "Sales / sales admin (orders, customers), logistics (delivery orders), finance (invoices).",
    links: [
      "Confirming a sales order creates production orders and job cards in Production.",
      "Finished goods from Production become delivery orders here; delivering creates the invoice.",
      "Invoices feed Debtors (AR aging) and receipts in Finance.",
      "Delivery returns can open a service case in Quality.",
    ],
    guides: ["create-sales-order", "create-delivery-order", "create-invoice", "delivery-return", "print-documents"],
    keywords: ["sales", "SO", "DO", "invoice", "customer", "销售", "客户", "送货", "发票", "jualan", "pelanggan", "invois"],
  },
  {
    id: "production",
    section: "PRODUCTION",
    oneLine: "Production orders and job cards per department, planning, outsource work and folders.",
    purpose: "Make what was sold: follow each order through the departments (Fab Cut to Packing), plan the work and send work to outsourcers.",
    pages: [
      { name: "Overview", path: "/production" },
      { name: "Fab Cut", path: "/production/fab-cut" },
      { name: "Fab Sew", path: "/production/fab-sew" },
      { name: "Foam Cutting", path: "/production/foam-cutting" },
      { name: "Foam Bonding", path: "/production/foam" },
      { name: "Fibre", path: "/production/fibre" },
      { name: "Wood Cut", path: "/production/wood-cut" },
      { name: "Framing", path: "/production/framing" },
      { name: "Webbing", path: "/production/webbing" },
      { name: "Upholstery", path: "/production/upholstery" },
      { name: "Packing", path: "/production/packing" },
      { name: "Planning", path: "/planning" },
      { name: "Outsource Work", path: "/production/outsource-issue" },
      { name: "Folders", path: "/production/folders" },
    ],
    usedBy: "Production / factory managers and department leaders; floor workers use the worker app (/worker) to scan.",
    links: [
      "Production orders come from confirmed sales orders (Sales).",
      "Materials come from Warehouse stock; shortages show in MRP (Procurement).",
      "Worker scans record working hours that feed payroll (HR) and efficiency.",
      "Completed goods go to delivery orders (Sales).",
    ],
    guides: ["create-production-order", "worker-scan-job-card", "complete-qc", "fg-scan", "production-planning", "outsource-work"],
    keywords: ["production", "job card", "生产", "工单", "扫码", "外包", "pengeluaran", "kad kerja"],
  },
  {
    id: "products",
    section: "PRODUCTS & BOM",
    oneLine: "Products, CNC templates, BOMs, WIP times, component kits and sofa combos.",
    purpose: "The product master: what we make, what goes into it (BOM), how long each step takes and what it costs.",
    pages: [
      { name: "Products", path: "/products" },
      { name: "CNC Templates", path: "/cnc-templates" },
      { name: "BOM", path: "/bom" },
      { name: "WIP Times", path: "/bom/wip-times" },
      { name: "Component Kits", path: "/bom/component-kits" },
      { name: "Sofa Combos", path: "/maintenance/sofa-combos" },
    ],
    usedBy: "R&D, production planning, admin; costing figures only for Admin / Finance / R&D.",
    links: [
      "Sales orders pick products and their variants.",
      "BOMs drive job cards (Production) and material needs (MRP).",
      "WIP times drive job-card minutes and worker efficiency.",
      "Product costing feeds gross profit in Finance.",
    ],
    guides: ["create-product", "create-variant", "edit-bom", "product-costing", "set-selling-price"],
    keywords: ["product", "BOM", "costing", "产品", "物料清单", "成本", "produk", "kos"],
  },
  {
    id: "warehouse",
    section: "WAREHOUSE",
    oneLine: "Inventory, fabrics, stock value, stock adjustments, stock take and warehouse racks.",
    purpose: "What we hold: raw materials and finished goods on hand, their value, corrections and counts.",
    pages: [
      { name: "Inventory", path: "/inventory" },
      { name: "Fabrics", path: "/inventory/fabrics" },
      { name: "Stock Value", path: "/inventory/stock-value" },
      { name: "Stock Adjustments", path: "/inventory/adjustments" },
      { name: "Stock Take", path: "/inventory/stock-take" },
      { name: "Warehouse", path: "/warehouse" },
    ],
    usedBy: "Warehouse / store keepers, purchasing, finance (stock value).",
    links: [
      "Goods receipts (Procurement) add stock; production consumes it.",
      "Stock adjustments post to the cost ledger (Finance).",
      "MRP compares stock with what open production orders need.",
    ],
    guides: ["stock-adjustment", "stock-take", "create-product"],
    keywords: ["inventory", "stock", "库存", "盘点", "仓库", "stok", "gudang"],
  },
  {
    id: "procurement",
    section: "PROCUREMENT",
    oneLine: "Purchase orders, goods receipts, purchase invoices, purchase returns, MRP, suppliers and procurement reports.",
    purpose: "Buy what production needs: see shortages, order from suppliers, receive the goods and record the supplier's invoice.",
    pages: [
      { name: "Purchase Order", path: "/procurement" },
      { name: "Goods Receipt", path: "/procurement/grn" },
      { name: "Purchase Invoice", path: "/procurement/pi" },
      { name: "Purchase Return", path: "/purchase-returns" },
      { name: "MRP", path: "/planning/mrp" },
      { name: "Suppliers", path: "/procurement/maintenance" },
      { name: "Procurement Reports", path: "/procurement/reports" },
    ],
    usedBy: "Purchasing staff; warehouse receives goods; finance records and pays purchase invoices.",
    links: [
      "MRP reads open production orders (Production) and stock (Warehouse).",
      "Goods receipts add stock in Warehouse.",
      "Purchase invoices feed Creditors (AP aging) and payment vouchers in Finance.",
    ],
    guides: ["mrp-shortages-to-po", "create-purchase-order", "receive-goods-grn", "record-purchase-invoice", "add-po-note", "record-supplier-payment"],
    keywords: ["purchase", "PO", "GRN", "supplier", "采购", "收货", "供应商", "belian", "pembekal"],
  },
  {
    id: "rd",
    section: "R&D",
    oneLine: "R&D projects and R&D maintenance.",
    purpose: "New product development projects and the R&D team's own master data.",
    pages: [
      { name: "R&D Projects", path: "/rd" },
      { name: "R&D Maintenance", path: "/rd/maintenance" },
    ],
    usedBy: "The R&D team and management.",
    links: ["Finished R&D projects become products and BOMs (Products & BOM)."],
    guides: ["create-product", "edit-bom"],
    keywords: ["R&D", "研发", "new design", "penyelidikan"],
  },
  {
    id: "quality",
    section: "QUALITY",
    oneLine: "QC / Quality inspections, service cases and service orders.",
    purpose: "Check quality in production and look after customers after delivery: complaints, repairs, exchanges.",
    pages: [
      { name: "QC / Quality", path: "/quality" },
      { name: "Service Cases", path: "/service-cases" },
      { name: "Service Order", path: "/service-order" },
    ],
    usedBy: "QC inspectors, after-sales / customer service.",
    links: [
      "QC sits between department scans in Production.",
      "Service cases can come from delivery returns (Sales) and lead to service orders, repairs or re-deliveries.",
    ],
    guides: ["complete-qc", "open-service-case", "move-service-case-stage", "add-case-note", "create-service-order"],
    keywords: ["QC", "quality", "service case", "after-sales", "质检", "售后", "维修", "kualiti", "aduan"],
  },
  {
    id: "finance",
    section: "FINANCE",
    oneLine: "Accounting reports, receipts and payment vouchers, journals, debtors (AR), creditors (AP), e-Invoice and setup.",
    purpose: "The books: P&L, balance sheet, cash, money owed to and by us, and LHDN e-Invoice.",
    pages: [
      { name: "Overview", path: "/accounting" },
      { name: "Receipts", path: "/accounting" },
      { name: "Payment Vouchers", path: "/accounting" },
      { name: "Debtor Aging", path: "/accounting" },
      { name: "Creditor Aging", path: "/accounting" },
      { name: "Credit Notes", path: "/invoices/credit-notes" },
      { name: "Debit Notes", path: "/invoices/debit-notes" },
      { name: "e-Invoice", path: "/invoices/e-invoice" },
    ],
    usedBy: "Finance / accounts staff and management (accounting:read).",
    links: [
      "Invoices (Sales) and purchase invoices (Procurement) post here.",
      "Stock movements and labour feed the cost ledger.",
      "Payroll uses attendance / working hours (HR).",
    ],
    guides: ["record-customer-payment", "record-supplier-payment", "create-invoice"],
    keywords: ["finance", "accounting", "AR", "AP", "会计", "财务", "应收", "应付", "kewangan", "akaun"],
  },
  {
    id: "forecasting",
    section: "FORECASTING",
    oneLine: "Finance dashboard, forecast P&L and the board report.",
    purpose: "Look ahead: cash-flow and P&L forecasts and the monthly board report.",
    pages: [
      { name: "Dashboard", path: "/finance-dashboard" },
      { name: "Forecast P&L", path: "/forecast" },
      { name: "Board Report", path: "/board-report" },
    ],
    usedBy: "Owner, management and finance.",
    links: ["Built from Finance actuals plus open sales and purchase orders."],
    guides: [],
    keywords: ["forecast", "board report", "预测", "董事会报告", "ramalan"],
  },
  {
    id: "hr",
    section: "HR & OPERATIONS",
    oneLine: "Employees (workers, attendance, working hours, payroll) and equipment maintenance.",
    purpose: "People and machines: worker records, attendance and hours, payroll inputs, and equipment maintenance logs.",
    pages: [
      { name: "Employees", path: "/employees" },
      { name: "Maintenance", path: "/maintenance" },
    ],
    usedBy: "HR / admin (employees, payroll — only roles with payroll access), maintenance staff.",
    links: [
      "Working hours come from worker scans in Production.",
      "Payroll figures are visible only to roles with payroll permission.",
    ],
    guides: ["attendance-working-hours", "apply-leave", "maintenance-log"],
    keywords: ["HR", "employee", "attendance", "payroll", "maintenance", "员工", "考勤", "工资", "保养", "pekerja", "gaji", "penyelenggaraan"],
  },
  {
    id: "system",
    section: "SYSTEM",
    oneLine: "Organisations (companies), the AI Connector and system settings.",
    purpose: "Admin set-up: the companies in the group (letterheads), users and roles, the AI Connector and other settings.",
    pages: [
      { name: "Organisations", path: "/settings/organisations" },
      { name: "AI Connector", path: "/settings/ai-connector" },
      { name: "Settings", path: "/settings" },
    ],
    usedBy: "Admins.",
    links: ["Organisations set the letterhead used on POs / GRNs / PIs and other documents.", "Users and roles decide what every other module shows."],
    guides: [],
    keywords: ["settings", "admin", "user", "role", "organisation", "设置", "权限", "tetapan"],
  },
];
