// ---------------------------------------------------------------------------
// howto/screens-sales.ts — screen map for the sales chain: sales orders,
// service orders, delivery orders, delivery returns, invoices (and the
// finance pages that still live under /invoices), consignment, customers and
// the sales pipeline. Written by reading src/pages/{sales,service-order,
// delivery,delivery-returns,invoices,consignment,leads}, src/pages/customers.tsx
// and the matching src/api/routes/* permission checks. See ./screen-types.ts.
// ---------------------------------------------------------------------------
import type { ScreenEntry } from "./screen-types";

export const SCREENS: ScreenEntry[] = [
  // =========================================================================
  // SALES ORDERS
  // =========================================================================
  {
    // src/pages/sales/index.tsx
    path: "/sales",
    title: "Sales Orders",
    purpose:
      "List of every customer sales order, split into Draft and Confirmed tabs, with KPI cards (Total Orders, Outstanding, Pending Delivery, Completed), filters, bulk confirm / delete / re-assign company, and a right-click menu to print, transfer to a delivery order or invoice, and view the status log.",
    sidebar: "SALES & CUSTOMERS → Sales Orders",
    sections: ["Sales Orders", "Total Orders", "Outstanding", "Pending Delivery", "Completed", "Draft", "Confirmed", "Detail Listing"],
    detail: "full",
    keywords: [
      "sales order", "SO", "SO list", "customer order", "order list",
      "销售单", "销售订单", "开单", "订单列表", "客户订单",
      "pesanan jualan", "senarai pesanan", "order jualan",
    ],
    actions: [
      { label: "Scan PO", kind: "button", does: "Opens the PO scanner: upload a customer's purchase order (photo / PDF) and the system reads it and creates draft sales orders from it, then opens the new order." },
      { label: "Import", kind: "button", does: "Opens \"Import sales orders from a Detail Listing\": upload the grid's Detail Listing spreadsheet to create or edit sales orders in bulk.", permission: "sales-orders:create" },
      { label: "New Sales Order", kind: "button", does: "Opens the new sales order form (/sales/create)." },
      { label: "Filters", kind: "button", does: "Shows / hides the filter panel (Status, Customer, Company, Date From / To, Category, DD from / to) and quick presets." },
      { label: "This Month", kind: "filter", does: "Quick filter: order date in the current month." },
      { label: "Last Month", kind: "filter", does: "Quick filter: order date in the previous month." },
      { label: "This Year", kind: "filter", does: "Quick filter: order date in the current year." },
      { label: "Sofa", kind: "filter", does: "Quick filter: orders that contain sofa lines." },
      { label: "Bedframe", kind: "filter", does: "Quick filter: orders that contain bedframe lines." },
      { label: "Clear", kind: "button", does: "Clears every active filter." },
      { label: "Show all orders", kind: "button", does: "Leaves the KPI drill-down (late-to-customer orders opened from a KPI) and shows the full list again." },
      { label: "Draft", kind: "tab", does: "Shows draft orders (not yet confirmed, no production started), with their count and order value." },
      { label: "Confirmed", kind: "tab", does: "Shows every order past draft (confirmed, in production, shipped, delivered, invoiced, closed, on hold, cancelled), with count and order value." },
      { label: "Review items", kind: "button", does: "Draft tab only: opens one flat table of every line item across all draft orders so they can be checked before confirming; click a row to open its order." },
      { label: "Download PDF", kind: "button", does: "Appears when rows are ticked: downloads the sales order PDFs of all ticked orders." },
      { label: "Convert to Confirmed", kind: "button", does: "Draft tab, rows ticked: confirms each ticked draft one by one (POST /api/sales-orders/:id/confirm) and reports how many succeeded or failed.", permission: "sales-orders:confirm", sideEffects: "Each confirmed order automatically creates its production orders (factory work starts). A draft with an incomplete BOM fails and stays draft." },
      { label: "Delete", kind: "button", does: "Draft tab, rows ticked: permanently deletes the ticked draft orders and their lines (DELETE /api/sales-orders/:id); only drafts are deleted.", permission: "sales-orders:delete", sideEffects: "Cannot be undone. The order number is freed only if it was the month's latest." },
      { label: "Re-assign", kind: "button", does: "Rows ticked: pick a company in \"Select company…\" and click to move the ticked orders to that company (POST /api/sales-orders/batch-company). Orders already in production, shipped or invoiced are skipped.", permission: "sales-orders:update", sideEffects: "Changes which company the orders are booked under." },
      { label: "View", kind: "row-action", does: "Right-click menu: opens the order's detail page (double-click a row does the same)." },
      { label: "Edit", kind: "row-action", does: "Right-click menu: opens the order's edit page.", permission: "sales-orders:update" },
      { label: "Print / Preview", kind: "row-action", does: "Right-click menu: generates the sales order PDF." },
      { label: "Transfer to Delivery Order", kind: "row-action", does: "Right-click menu: opens the Transfer to Delivery Order dialog listing this order's finished production orders that are ready to deliver; \"Create DO\" there creates the delivery order (POST /api/delivery-orders).", permission: "delivery-orders:create", sideEffects: "Creates a DRAFT delivery order (no stock moves until it is dispatched)." },
      { label: "Transfer to Invoice", kind: "row-action", does: "Right-click menu: finds the order's delivery order and opens the Transfer to Invoice dialog; \"Create Invoice\" there creates the invoice from that DO (POST /api/invoices). Warns \"Please create a Delivery Order first before generating an invoice.\" when there is no DO.", permission: "invoices:create", sideEffects: "Creates an invoice and raises the customer's outstanding balance." },
      { label: "View Document Status Change Log", kind: "row-action", does: "Right-click menu: opens the order detail page at its status history." },
      { label: "Refresh", kind: "row-action", does: "Right-click menu: reloads the list." },
      { label: "Delete draft", kind: "row-action", does: "Right-click menu, draft rows only: permanently deletes that draft order after confirmation (DELETE /api/sales-orders/:id).", permission: "sales-orders:delete", sideEffects: "Cannot be undone." },
      { label: "Create DO", kind: "button", does: "In the Transfer to Delivery Order dialog: creates the delivery order from the listed ready production orders.", permission: "delivery-orders:create" },
      { label: "Create Invoice", kind: "button", does: "In the Transfer to Invoice dialog: creates the invoice from the linked delivery order.", permission: "invoices:create" },
      { label: "Go to Delivery Orders", kind: "button", does: "After a DO is created from the dialog: opens SALES & CUSTOMERS → Delivery Order." },
      { label: "Go to Invoices", kind: "button", does: "After an invoice is created from the dialog: opens SALES & CUSTOMERS → Invoices." },
    ],
  },
  {
    // src/pages/sales/create.tsx
    path: "/sales/create",
    title: "New Sales Order",
    purpose:
      "Form to enter a new customer sales order: Order Details (customer, hub, PO / SO numbers, company, dates, notes), Line Items (product, size, fabric, variants, special orders, quantity, price) and a Summary with totals. Save it as a draft or create (confirm) it straight away.",
    sidebar: "SALES & CUSTOMERS → Sales Orders → click \"New Sales Order\"",
    sections: ["Order Details", "Summary", "Line Items", "Customer PO No.", "Customer SO No.", "Reference", "Company", "Company SO Date", "Customer Delivery Date", "Notes", "Base Price (RM)", "Line Total", "Line Notes"],
    detail: "full",
    keywords: [
      "new sales order", "create SO", "new SO", "book order", "enter order",
      "开单", "新建销售单", "下单", "录入订单", "开销售单",
      "buat pesanan", "pesanan baru", "masukkan pesanan",
    ],
    actions: [
      { label: "Restore", kind: "button", does: "Shown in the \"Restore your draft?\" banner when an unsaved form from earlier is found: fills the form back with those entries (kept in this browser only)." },
      { label: "Discard", kind: "button", does: "In the \"Restore your draft?\" banner: throws away the unsaved entries and starts with an empty form." },
      { label: "Cancel", kind: "button", does: "Leaves the form and goes back to the Sales Orders list without saving." },
      { label: "Save as Draft", kind: "button", does: "Saves the order as DRAFT (POST /api/sales-orders). It stays editable and no production starts.", permission: "sales-orders:create" },
      { label: "Create Order", kind: "button", does: "Saves the order (POST /api/sales-orders) and immediately confirms it (POST /api/sales-orders/:id/confirm), then opens the order. If a product's BOM is incomplete the \"Cannot Confirm — BOM Incomplete\" box appears and the order stays DRAFT. If the customer PO / SO number is already on another open order the order is kept as a draft with a warning.", permission: "sales-orders:confirm", sideEffects: "Confirming creates the production orders, so the factory starts work." },
      { label: "Add Item", kind: "button", does: "Adds another empty line to Line Items." },
      { label: "Select All", kind: "button", does: "Sofa line, module picker: ticks every listed module (click again for Deselect All)." },
      { label: "Add custom", kind: "button", does: "Inside a line's Special Orders section: adds a free-text special request with its own surcharge." },
      { label: "Open SO as Draft", kind: "button", does: "In the \"Cannot Confirm — BOM Incomplete\" box: opens the order that was saved as DRAFT." },
      { label: "Open BOM for", kind: "button", does: "In the \"Cannot Confirm — BOM Incomplete\" box when only one product is missing its BOM: opens that product's BOM so it can be completed." },
    ],
  },
  {
    // src/pages/sales/detail.tsx
    path: "/sales/:id",
    title: "Sales Order detail",
    purpose:
      "One sales order: header buttons (preview / PDF / clone / edit / delete), an Actions bar for status changes (confirm, hold, resume, cancel, undo cancel, open a service case), Order Information with editable customer / hub / dates, Summary, Stock Allocation, Order Progress, Linked Production Orders, Items, Price Override History and the Status Timeline.",
    sidebar: "Open a row on SALES & CUSTOMERS → Sales Orders",
    sections: ["Order Information", "Summary", "Stock Allocation", "Order Progress", "Linked Production Orders", "Price Override History", "Status Timeline", "Actions:"],
    detail: "full",
    keywords: [
      "sales order detail", "SO detail", "open SO", "confirm order", "hold order", "cancel order",
      "销售单详情", "订单详情", "确认订单", "取消订单", "暂停订单",
      "butiran pesanan", "sahkan pesanan", "batal pesanan",
    ],
    actions: [
      { label: "Preview", kind: "button", does: "Opens the sales order PDF in an on-screen preview (print / download / new tab from there)." },
      { label: "PDF", kind: "button", does: "Downloads the sales order PDF." },
      { label: "Clone", kind: "button", does: "Opens a new order form pre-filled with this order's customer, lines and dates (customer PO / SO numbers left blank). Nothing is saved until you save the new form." },
      { label: "Edit", kind: "button", does: "Opens the edit page. Shown only while the order can still be edited.", permission: "sales-orders:update" },
      { label: "Edit (locked)", kind: "button", does: "Disabled button shown when production has started or the first job card is within the 2-day cutoff; the tooltip says why editing is locked." },
      { label: "Edit Prices", kind: "button", does: "Shown when the order is locked for editing but prices may still change: opens a dialog to change line prices only (PATCH /api/sales-orders/:id/prices).", permission: "sales-orders:update", sideEffects: "Each price change is recorded in Price Override History." },
      { label: "Override Lock", kind: "button", does: "ADMIN / SUPER_ADMIN only, when the order is in the production window: asks for a reason (at least 5 characters) and \"Override and Edit\" opens the edit page anyway (POST /api/sales-orders/:id/override-edit-lock).", sideEffects: "The override and its reason are recorded in the status timeline." },
      { label: "Delete", kind: "button", does: "Draft orders only: deletes the order after confirmation (DELETE /api/sales-orders/:id).", permission: "sales-orders:delete", sideEffects: "Cannot be undone." },
      { label: "Confirm Order", kind: "button", does: "Draft only: confirms the order (POST /api/sales-orders/:id/confirm) after the \"Confirm & Create POs\" prompt. Shows \"Cannot Confirm — BOM Incomplete\" if a product has no WIP components.", permission: "sales-orders:confirm", sideEffects: "Creates production orders for every line and sets the order to CONFIRMED." },
      { label: "Create Delivery", kind: "button", does: "Ready-to-ship orders: opens SALES & CUSTOMERS → Delivery Order to create the DO." },
      { label: "Generate Invoice", kind: "button", does: "Delivered orders: opens SALES & CUSTOMERS → Invoices." },
      { label: "Put On Hold", kind: "button", does: "Opens a box that requires a reason, then sets the order ON_HOLD (PUT /api/sales-orders/:id).", permission: "sales-orders:update", sideEffects: "Production of the order is paused; the hold reason is shown to production." },
      { label: "Resume Order", kind: "button", does: "On-hold orders: returns the order to the status it had before the hold (PUT /api/sales-orders/:id).", permission: "sales-orders:update" },
      { label: "Cancel Order", kind: "button", does: "Cancels the order after confirmation (PUT status CANCELLED). Disabled when a job card already has completed work — the \"Cannot cancel order — completed work in production\" box explains.", permission: "sales-orders:update", sideEffects: "Cancels its production orders and non-completed job cards. Can be reversed with \"Undo Cancel\"." },
      { label: "Undo Cancel", kind: "button", does: "Cancelled orders: restores the order, its production orders and job cards to their earlier statuses (PUT /api/sales-orders/:id).", permission: "sales-orders:update", sideEffects: "Re-posts the reversed WIP cost." },
      { label: "Open Service Case", kind: "button", does: "Shipped, delivered, invoiced or closed orders: opens the new service case form for a customer complaint against this order, then goes to the new case." },
      { label: "Change customer", kind: "button", does: "Pencil next to Customer (tooltip text): changes the order's customer (PATCH /api/sales-orders/:id/customer). Locked once the order has shipped / been invoiced; the tooltip gives the reason.", permission: "sales-orders:update" },
      { label: "Change delivery hub", kind: "button", does: "Pencil next to Delivery Hub: changes the hub the goods go to (PATCH /api/sales-orders/:id/hub). Locked after shipment.", permission: "sales-orders:update" },
      { label: "Change delivery dates", kind: "button", does: "Pencil next to Customer DD / Hookka Expected DD: changes the customer delivery date and the expected delivery date (PATCH /api/sales-orders/:id/dates).", permission: "sales-orders:update" },
      { label: "View the original customer PO", kind: "button", does: "Next to Customer PO: opens the scanned original customer PO in a new tab." },
      { label: "Allocate", kind: "button", does: "Stock Allocation card: reserves finished (or still-in-production) stock pieces for this order line (POST /api/stock-allocations).", permission: "sales-orders:edit", sideEffects: "The reserved pieces are no longer free for other orders." },
      { label: "Release", kind: "button", does: "Stock Allocation card: releases pieces this order had reserved (POST /api/stock-allocations/release).", permission: "sales-orders:edit" },
      { label: "Pause this PO (production stops; can resume later)", kind: "row-action", does: "Pause icon in Linked Production Orders: asks for a reason and puts that production order on hold (POST /api/production-orders/:id/hold).", permission: "production-orders:update" },
      { label: "Resume this PO back to PENDING", kind: "row-action", does: "Play icon on an on-hold production order: resumes it (POST /api/production-orders/:id/resume).", permission: "production-orders:update" },
      { label: "Cancel this PO (also cancels its non-completed job cards)", kind: "row-action", does: "X icon: asks for a reason and confirmation, then cancels that production order (POST /api/production-orders/:id/cancel).", permission: "production-orders:update", sideEffects: "Its non-completed job cards are cancelled too; completed work stays." },
      { label: "View", kind: "row-action", does: "Linked Production Orders row: opens that production order." },
    ],
  },
  {
    // src/pages/sales/edit.tsx
    path: "/sales/:id/edit",
    title: "Edit Sales Order",
    purpose:
      "Change an order's details and line items while it is still editable. Save is disabled (with a banner) when a downstream production order is already completed.",
    sidebar: "Open a sales order (SALES & CUSTOMERS → Sales Orders) and click \"Edit\"",
    sections: ["Order Details", "Summary", "Line Items"],
    detail: "basic",
    keywords: ["edit sales order", "change SO", "修改销售单", "改订单", "ubah pesanan", "edit pesanan"],
    actions: [
      { label: "Save Changes", kind: "button", does: "Saves the changes (PUT /api/sales-orders/:id) and reads the order back to confirm they landed.", permission: "sales-orders:update", sideEffects: "Line changes flow through to the order's production orders." },
      { label: "Cancel", kind: "button", does: "Goes back to the order detail page without saving." },
      { label: "Add Item", kind: "button", does: "Adds another line." },
    ],
  },

  // =========================================================================
  // SERVICE ORDERS (same pages as sales, in service-order mode)
  // =========================================================================
  {
    // src/pages/service-order/index.tsx → src/pages/sales/index.tsx in service-order mode
    path: "/service-order",
    title: "Service Orders",
    purpose:
      "Aftersales orders cloned from a Sales / Consignment Order (warranty repairs, replacements). Same list as Sales Orders but filtered to service orders; prices default to 0 and the cards count orders instead of money.",
    sidebar: "QUALITY → Service Order",
    sections: ["Service Orders", "Total Service Orders", "In Production", "Draft", "Confirmed"],
    detail: "basic",
    keywords: ["service order", "SV", "aftersales order", "repair order", "warranty", "售后单", "维修单", "服务单", "pesanan servis", "pembaikan"],
    actions: [
      { label: "New Service Order", kind: "button", does: "Opens the new service order form (/service-order/create)." },
      { label: "Draft", kind: "tab", does: "Shows draft service orders." },
      { label: "Confirmed", kind: "tab", does: "Shows confirmed service orders." },
      { label: "Transfer to Delivery Order", kind: "row-action", does: "Right-click: creates a delivery order from the order's ready production orders.", permission: "delivery-orders:create" },
      { label: "Transfer to Invoice", kind: "row-action", does: "Right-click: creates an invoice from the order's delivery order.", permission: "invoices:create" },
    ],
  },
  {
    path: "/service-order/create",
    title: "New Service Order",
    purpose:
      "The sales order form in service-order mode: copy lines from an existing Sales / Consignment Order with \"Copy from SO/CO\", then edit each line's price (defaults to 0). The order may reuse the original customer PO number.",
    sidebar: "QUALITY → Service Order → click \"New Service Order\"",
    sections: ["Order Details", "Summary", "Line Items"],
    detail: "basic",
    keywords: ["new service order", "create service order", "开售后单", "新建维修单", "buat pesanan servis"],
    actions: [
      { label: "Copy from SO/CO", kind: "button", does: "Opens \"Copy from Sales / Consignment Order\": type the source order number, click \"Next\", tick the lines and \"Copy Selected\" to fill this form (POST /api/sales-orders/copy-for-service-order).", permission: "sales-orders:create" },
      { label: "Save as Draft", kind: "button", does: "Saves the service order as DRAFT.", permission: "sales-orders:create" },
      { label: "Create Order", kind: "button", does: "Saves and confirms the service order.", permission: "sales-orders:confirm", sideEffects: "Creates production orders." },
    ],
  },
  {
    path: "/service-order/:id",
    title: "Service Order detail",
    purpose: "One service order — the same page and buttons as a sales order's detail page (confirm, hold, cancel, production orders, timeline), labelled as a Service Order.",
    sidebar: "Open a row on QUALITY → Service Order",
    sections: ["Order Information", "Summary", "Linked Production Orders", "Status Timeline"],
    detail: "basic",
    keywords: ["service order detail", "售后单详情", "butiran pesanan servis"],
    actions: [
      { label: "Confirm Order", kind: "button", does: "Confirms the draft service order and creates its production orders.", permission: "sales-orders:confirm" },
      { label: "Edit", kind: "button", does: "Opens the edit page.", permission: "sales-orders:update" },
      { label: "Cancel Order", kind: "button", does: "Cancels the service order.", permission: "sales-orders:update" },
    ],
  },
  {
    path: "/service-order/:id/edit",
    title: "Edit Service Order",
    purpose: "Edit a service order's details and lines; the service-order flag is kept.",
    sidebar: "Open a service order (QUALITY → Service Order) and click \"Edit\"",
    sections: ["Order Details", "Line Items"],
    detail: "basic",
    keywords: ["edit service order", "修改售后单", "ubah pesanan servis"],
    actions: [
      { label: "Save Changes", kind: "button", does: "Saves the changes (PUT /api/sales-orders/:id).", permission: "sales-orders:update" },
      { label: "Cancel", kind: "button", does: "Goes back without saving." },
    ],
  },

  // =========================================================================
  // DELIVERY ORDERS
  // =========================================================================
  {
    // src/pages/delivery/index.tsx
    path: "/delivery",
    title: "Delivery Orders",
    purpose:
      "Plan and track deliveries: see finished production orders ready to ship, create delivery orders and packing lists, then move each DO through Pending Dispatch → Dispatched → Delivered (which posts cost of goods, creates the invoice and emails the customer). Also hosts the 3PL Providers and Delivery Agent tabs.",
    sidebar: "SALES & CUSTOMERS → Delivery Order",
    sections: [
      "Delivery Orders", "3PL Providers", "Delivery Agent",
      "Pending Dispatch", "Dispatched", "In Transit", "Delivered (MTD)",
      "Planning", "Pending Delivery", "Delivered", "Cancelled", "Packing List",
      "Production Complete — Ready for DO", "Packing Lists", "Detail Listing",
    ],
    detail: "full",
    keywords: [
      "delivery order", "DO", "dispatch", "deliver", "packing list", "lorry", "truck", "3PL",
      "送货单", "出货", "送货", "装车单", "派送", "物流",
      "pesanan penghantaran", "penghantaran", "senarai pembungkusan", "lori",
    ],
    actions: [
      { label: "Delivery Orders", kind: "tab", does: "Page tab: the delivery order workflow (default)." },
      { label: "3PL Providers", kind: "tab", does: "Page tab: list of third-party transport companies with their fleet and drivers; \"New 3PL\" adds one." },
      { label: "Delivery Agent", kind: "tab", does: "Page tab: load-plan / invoice-gap / POD proposals. \"Generate Proposals\" builds them; \"Approve\" / \"Reject\" only records the decision (no DO is created automatically).", permission: "delivery-orders:update" },
      { label: "Import", kind: "button", does: "Opens \"Import delivery orders from a Detail Listing\": edit delivery dates / remarks in bulk or create DOs from a spreadsheet.", permission: "delivery-orders:create" },
      { label: "Planning", kind: "tab", does: "Production orders of confirmed sales orders still being made, grouped by state — for planning upcoming deliveries." },
      { label: "Pending Delivery", kind: "tab", does: "Finished production orders ready for a DO (\"Production Complete — Ready for DO\"). Tick rows to create a DO or packing list. Sofa sets show Set Status; an incomplete set cannot be ticked." },
      { label: "Pending Dispatch", kind: "tab", does: "Draft DOs waiting to be loaded on the lorry." },
      { label: "Dispatched", kind: "tab", does: "DOs that left the warehouse (loaded / in transit)." },
      { label: "Delivered", kind: "tab", does: "DOs the customer received (delivered / invoiced)." },
      { label: "Cancelled", kind: "tab", does: "Cancelled DOs (kept on record)." },
      { label: "Packing List", kind: "tab", does: "Saved packing lists (one per truck run) with Dispatch / Delivered buttons for the whole truck." },
      { label: "Create DO", kind: "button", does: "Pending Delivery tab, rows ticked: opens the \"Create Delivery Order\" dialog (3PL provider, vehicle, driver, delivery destinations, date, remarks); \"Create DO\" at the bottom creates it (POST /api/delivery-orders). One customer and one hub per DO.", permission: "delivery-orders:create", sideEffects: "Creates a DRAFT DO (Pending Dispatch). No stock moves yet. Refused if the customer's credit limit would be exceeded." },
      { label: "Create Packing List", kind: "button", does: "Pending Delivery tab, rows ticked (mixed customers / hubs allowed): creates one DO per customer + hub and puts them all on one packing list (POST /api/delivery-orders/packing-list-first).", permission: "delivery-orders:create", sideEffects: "Creates several DRAFT DOs at once; nothing is created if any credit check fails." },
      { label: "Create as Packing List", kind: "button", does: "Pending Dispatch / Dispatched tab, DOs ticked: opens the \"Create Packing List\" dialog and saves a packing list for those DOs (POST /api/packing-lists).", permission: "delivery-orders:create" },
      { label: "Mark Dispatched", kind: "button", does: "DOs ticked (or right-click one row): sets each draft DO to LOADED (PUT /api/delivery-orders/:id).", permission: "delivery-orders:update", sideEffects: "Takes the finished goods out of stock, moves the sales order to SHIPPED and emails the customer a dispatch notice with the DO PDF." },
      { label: "Mark Delivered", kind: "button", does: "DOs ticked (or right-click one row): sets each loaded / in-transit DO to DELIVERED (PUT /api/delivery-orders/:id). No proof-of-delivery form is required.", permission: "delivery-orders:update", sideEffects: "Posts cost of goods sold, creates and posts the invoice (customer outstanding goes up) and emails it to the customer." },
      { label: "Select all", kind: "toggle", does: "Ticks every DO in the current tab." },
      { label: "View Details", kind: "row-action", does: "Right-click (or double-click a row): opens the DO in a side drawer with its lines; drafts can be edited or deleted there." },
      { label: "Print DO", kind: "row-action", does: "Right-click: generates the delivery order PDF." },
      { label: "Print Packing List", kind: "row-action", does: "Right-click: prints the packing list for this DO." },
      { label: "QR — Driver Scan", kind: "row-action", does: "Right-click: shows the DO's QR code; a driver scans it with a phone (no login) to mark it dispatched or delivered." },
      { label: "Reverse to Pending Dispatch", kind: "row-action", does: "Right-click, dispatched (LOADED) DO: sends it back to draft after confirmation (PUT status DRAFT).", permission: "delivery-orders:update", sideEffects: "Puts the dispatched goods back into stock." },
      { label: "Mark Out for Delivery (In Transit)", kind: "row-action", does: "Right-click, dispatched DO: records that the lorry has left (status IN_TRANSIT).", permission: "delivery-orders:update" },
      { label: "Transfer to Invoice", kind: "row-action", does: "Right-click, delivered DO: opens \"Transfer to Sales Invoice\" with each line pre-filled with the quantity still un-invoiced; lower quantities to bill part now. \"Create Invoice\" creates it (POST /api/invoices).", permission: "invoices:create", sideEffects: "Raises the customer's outstanding. The DO becomes INVOICED when its last line is billed." },
      { label: "Resend invoice email", kind: "row-action", does: "Right-click, delivered / invoiced DO: after confirmation re-sends the customer the invoice email (POST /api/delivery-orders/:id/resend-notice).", permission: "delivery-orders:update", sideEffects: "Sends an email to the customer." },
      { label: "Convert to Delivery Return", kind: "row-action", does: "Right-click, delivered / invoiced DO: opens SALES & CUSTOMERS → Delivery Return with this DO pre-selected in the new return dialog." },
      { label: "Reverse to Dispatched", kind: "row-action", does: "Right-click, delivered / invoiced DO marked delivered by mistake: after confirmation voids its unpaid invoice and undoes the delivery (POST /api/delivery-orders/:id/reverse-to-dispatched). Refused with a reason if a payment, note or delivery return exists.", permission: "delivery-orders:update", sideEffects: "Voids the invoice (needs invoices:void) and reverses cost of goods sold." },
      { label: "Cancel Delivery Order", kind: "row-action", does: "Right-click: after confirmation cancels the DO (PUT status CANCELLED). Refused with a reason while a live invoice or a delivery return exists.", permission: "delivery-orders:update", sideEffects: "Units go back to stock, delivered cost of goods is credited back, the sales order returns to Ready to Ship and the production orders become free for a new DO. Cannot be undone." },
      { label: "Refresh", kind: "row-action", does: "Right-click: reloads the list." },
      { label: "Dispatch", kind: "row-action", does: "Packing List tab row: marks every pending DO on that packing list dispatched in one go.", permission: "delivery-orders:update", sideEffects: "Same as \"Mark Dispatched\" for each DO: stock out and dispatch emails." },
      { label: "Delivered", kind: "row-action", does: "Packing List tab row: marks every dispatched DO on that packing list delivered.", permission: "delivery-orders:update", sideEffects: "Same as \"Mark Delivered\" for each DO: cost of goods, invoice created and emailed." },
      { label: "QR — drivers scan to mark Dispatched / Delivered", kind: "row-action", does: "Packing List tab, QR icon: shows the packing list QR for drivers." },
      { label: "Edit", kind: "row-action", does: "Packing List tab, pencil icon: edit which DOs and remarks are on the packing list.", permission: "delivery-orders:create" },
      { label: "Print", kind: "row-action", does: "Packing List tab, printer icon: downloads the packing list PDF (the eye icon, View, opens it on screen)." },
      { label: "Delete", kind: "row-action", does: "Packing List tab, bin icon: deletes the packing list record after confirmation (DELETE /api/packing-lists/:id). The DOs themselves stay.", permission: "delivery-orders:delete" },
      { label: "Edit DO", kind: "button", does: "In the DO drawer, draft DOs only: switch to edit mode and change lines, then \"Save Changes\".", permission: "delivery-orders:update" },
      { label: "Delete DO (DRAFT only)", kind: "button", does: "In the DO drawer: deletes a draft DO after confirmation (DELETE /api/delivery-orders/:id); its items return to Pending Delivery.", permission: "delivery-orders:delete" },
      { label: "New 3PL", kind: "button", does: "3PL Providers tab: adds a transport provider (info, fleet, drivers & contacts)." },
    ],
  },
  {
    // src/pages/delivery/detail.tsx
    path: "/delivery/:id",
    title: "Delivery Order detail",
    purpose:
      "Full page for one delivery order: QR / preview / PDF / packing list, the next status step, customer and delivery information, loading & volume with lorry assignment, proof of delivery, items, linked delivery returns and the delivery timeline.",
    sidebar: "Open a DO from SALES & CUSTOMERS → Delivery Order (drawer → full page), or follow a DO link from a sales order or invoice",
    sections: ["Customer Information", "Delivery Information", "Proof of Delivery", "Delivery Timeline", "Assigned Lorry", "Assign to Lorry"],
    detail: "full",
    keywords: [
      "delivery order detail", "DO detail", "proof of delivery", "POD", "assign lorry",
      "送货单详情", "签收", "送货证明", "派车",
      "butiran penghantaran", "bukti penghantaran",
    ],
    actions: [
      { label: "QR", kind: "button", does: "Shows the DO's QR code for the driver to scan." },
      { label: "Preview", kind: "button", does: "Opens the DO PDF on screen." },
      { label: "Download DO PDF", kind: "button", does: "Downloads the DO PDF." },
      { label: "Print Packing List", kind: "button", does: "Generates the packing list PDF for this DO (with per-piece rack locations)." },
      { label: "Load & Generate DO", kind: "button", does: "Draft DO: moves it to LOADED (dispatched) (PUT /api/delivery-orders/:id).", permission: "delivery-orders:update", sideEffects: "Takes the goods out of finished-goods stock and moves the sales order to SHIPPED." },
      { label: "Dispatch", kind: "button", does: "Loaded DO: moves it to IN_TRANSIT (out for delivery).", permission: "delivery-orders:update" },
      { label: "Mark Delivered", kind: "button", does: "Loaded or in-transit DO: sets it DELIVERED straight away.", permission: "delivery-orders:update", sideEffects: "Posts cost of goods sold, creates and posts the invoice and emails it to the customer." },
      { label: "Mark documents complete & invoice", kind: "button", does: "Shown when the DO was delivered with issues (\"Delivered with issues — invoice on hold\"): clears the hold and creates the withheld invoice (POST /api/delivery-orders/:id/resolve-incomplete).", permission: "delivery-orders:update", sideEffects: "Creates the invoice and moves the DO and sales order to INVOICED." },
      { label: "Convert to Invoice", kind: "button", does: "Delivered DO: sets the DO status to INVOICED (PUT /api/delivery-orders/:id). This is a status change only — the invoice itself is normally created automatically when the DO was marked delivered.", permission: "delivery-orders:update" },
      { label: "Convert to Delivery Return", kind: "button", does: "Delivered / invoiced DO: opens SALES & CUSTOMERS → Delivery Return with this DO pre-selected." },
      { label: "Capture POD", kind: "button", does: "Opens the proof-of-delivery form to add photos / signature (optional; not needed to mark delivered).", permission: "delivery-orders:update" },
      { label: "POD photos PDF", kind: "button", does: "Downloads the captured proof-of-delivery photos as one PDF." },
      { label: "Back to Deliveries", kind: "link", does: "Shown when the DO cannot be found: goes back to the Delivery Orders list." },
    ],
  },

  // =========================================================================
  // DELIVERY RETURNS
  // =========================================================================
  {
    // src/pages/delivery-returns/index.tsx
    path: "/delivery-returns",
    title: "Delivery Returns",
    purpose:
      "List of goods returned after delivery. Each return is either put back to stock (with a credit note if the DO was invoiced) or sent for repair & re-delivery through a service case. \"New return\" records a new one.",
    sidebar: "SALES & CUSTOMERS → Delivery Return",
    sections: ["Delivery Returns", "New delivery return"],
    detail: "full",
    keywords: [
      "delivery return", "return", "goods returned", "customer return", "damaged goods",
      "退货", "客户退货", "送货退回", "退回",
      "pulangan", "pulangan barang", "barang rosak",
    ],
    actions: [
      { label: "New return", kind: "button", does: "Opens the \"New delivery return\" dialog: pick a delivered DO from \"Select a delivered DO…\" (only DELIVERED / INVOICED DOs), tick the lines that came back, set \"Qty returned\" and describe the problem." },
      { label: "Create return", kind: "button", does: "In the dialog: creates the return (POST /api/delivery-returns) and opens it. Refused if more is returned than was delivered.", permission: "delivery-returns:update", sideEffects: "Nothing moves in stock yet; the outcome is chosen on the return page." },
      { label: "Cancel", kind: "button", does: "Closes the dialog without creating anything." },
      { label: "Return", kind: "row-action", does: "Click any row to open that return's page." },
    ],
  },
  {
    // src/pages/delivery-returns/detail.tsx
    path: "/delivery-returns/:id",
    title: "Delivery Return detail",
    purpose:
      "One delivery return: its items (with whether each was invoiced), files, and the outcome buttons — return to stock (credit note follows when invoiced), repair & re-deliver via a service case, mark re-delivered, cancel or undo.",
    sidebar: "Open a row on SALES & CUSTOMERS → Delivery Return, or the Delivery Returns card on a DO",
    sections: ["Returned item", "Invoiced?", "Files"],
    detail: "full",
    keywords: ["delivery return detail", "return to stock", "credit note", "退货详情", "回仓", "退货开红字", "pulang ke stok"],
    actions: [
      { label: "Back", kind: "link", does: "Goes back to the Delivery Returns list." },
      { label: "Print", kind: "button", does: "Generates the delivery return PDF." },
      { label: "Return to stock", kind: "button", does: "Open returns: if the DO was invoiced, sets the outcome PURE_RETURN (POST /api/delivery-returns/:id/set-outcome) and opens the credit note form pre-filled from the return; if never invoiced, returns the goods to stock only (POST /api/delivery-returns/:id/return-to-stock).", permission: "delivery-returns:update", sideEffects: "Goods go back into finished-goods stock and cost of goods sold is reversed. For an invoiced DO the customer is credited only when the credit note is raised." },
      { label: "Create credit note", kind: "button", does: "Shown when the goods are back in stock but the credit note was not raised yet: opens FINANCE → Debtors → Credit Notes pre-filled from this return.", permission: "credit-notes:create" },
      { label: "re-deliver → service case", kind: "button", does: "The repair & re-deliver button: opens a service case from the original sales order with the returned items (POST /api/service-cases), sets the outcome REPAIR_REDELIVER and goes to the case to spawn the replacement service order.", permission: "delivery-returns:update", sideEffects: "Creates a service case." },
      { label: "Mark re-delivered", kind: "button", does: "After the repaired / replacement goods reached the customer: marks the return re-delivered (POST /api/delivery-returns/:id/mark-redelivered).", permission: "delivery-returns:update" },
      { label: "Cancel return", kind: "button", does: "Open returns: voids the return after confirmation (POST /api/delivery-returns/:id/cancel).", permission: "delivery-returns:update" },
      { label: "Undo return to stock", kind: "button", does: "Returned-to-stock returns: takes the goods back off stock, puts the units back to delivered and cancels the return (POST /api/delivery-returns/:id/cancel).", permission: "delivery-returns:update", sideEffects: "Moves stock back out." },
    ],
  },

  // =========================================================================
  // INVOICES
  // =========================================================================
  {
    // src/pages/invoices/index.tsx
    path: "/invoices",
    title: "Invoices",
    purpose:
      "Customer sales invoices: KPI cards (Total Invoices, Outstanding, Collected (MTD), Overdue), status tabs, filters, bulk PDF download and email, quick payment recording, and an AR Aging report tab. Most invoices are created automatically when a DO is marked delivered.",
    sidebar: "SALES & CUSTOMERS → Invoices",
    sections: ["Invoices", "AR Aging", "All Invoices", "Accounts Receivable Aging Report", "Total Invoices", "Outstanding", "Collected (MTD)", "Overdue", "Detail Listing"],
    detail: "full",
    keywords: [
      "invoice", "sales invoice", "billing", "AR", "aging", "email invoice", "receivable",
      "发票", "开发票", "销售发票", "账龄", "应收",
      "invois", "invois jualan", "bil", "penghutang",
    ],
    actions: [
      { label: "Import", kind: "button", does: "Opens \"Import invoices from a Detail Listing\": edit invoices in bulk from the exported spreadsheet.", permission: "invoices:update" },
      { label: "New Invoice", kind: "button", does: "Opens \"Create Invoice from Delivery Order\": pick a DO in \"Select Delivery Order\" and click \"Create Invoice\" (POST /api/invoices). The server only accepts DELIVERED DOs.", permission: "invoices:create", sideEffects: "Creates a DRAFT invoice for the DO's un-invoiced remainder and raises the customer's outstanding." },
      { label: "Invoices", kind: "tab", does: "Page tab: the invoice list." },
      { label: "AR Aging", kind: "tab", does: "Page tab: \"Accounts Receivable Aging Report\" over the whole table, following the status / customer / date filters." },
      { label: "Draft", kind: "tab", does: "Status tab: invoices not yet posted." },
      { label: "Sent", kind: "tab", does: "Status tab: posted invoices awaiting payment." },
      { label: "Partial Paid", kind: "tab", does: "Status tab: invoices partly paid." },
      { label: "Paid", kind: "tab", does: "Status tab: fully paid invoices." },
      { label: "Overdue", kind: "tab", does: "Status tab: invoices past their due date." },
      { label: "Cancelled", kind: "tab", does: "Status tab: voided invoices." },
      { label: "Clear", kind: "button", does: "Clears the Customer / From Date / To Date filters (or, in the selection bar, unticks all rows)." },
      { label: "Download PDF", kind: "button", does: "Rows ticked: renders every ticked invoice's PDF into one download." },
      { label: "Email to Customer", kind: "button", does: "Rows ticked: after the confirm box, finalises each draft (PUT status SENT) and emails each customer its invoice PDF (POST /api/delivery-orders/:id/resend-notice); already-sent invoices are re-emailed. Customers without an email are skipped and listed.", permission: "invoices:post", sideEffects: "Finalising a draft writes its accounting entries and cannot be undone. Sends emails to customers." },
      { label: "View", kind: "row-action", does: "Right-click (or double-click): opens the invoice page." },
      { label: "Print Invoice", kind: "row-action", does: "Right-click: opens the invoice page, where the PDF is printed." },
      { label: "Record Payment", kind: "row-action", does: "Right-click, Sent / Partial Paid invoices: opens the Record Payment box (Payment Amount (RM), Payment Date, reference, Payment Method) and adds the payment to that invoice (PUT /api/invoices/:id). No bank-account choice — prefer FINANCE → Daily → Receipts.", permission: "invoices:update", sideEffects: "Invoice moves to PARTIAL_PAID or PAID; the invoice is then locked against edits." },
      { label: "Send to Customer", kind: "row-action", does: "Right-click, drafts only: posts the invoice (PUT status SENT). It does not email.", permission: "invoices:post", sideEffects: "Writes the invoice's ledger entries." },
      { label: "Refresh", kind: "row-action", does: "Right-click: reloads the list and KPI cards." },
    ],
  },
  {
    // src/pages/invoices/detail.tsx
    path: "/invoices/:id",
    title: "Invoice detail",
    purpose:
      "One invoice: From / Bill To / Invoice Details, line items, payment history, the customer statement, last payment, invoice lifecycle and linked credit / debit note adjustments. Buttons to view or download the PDF, edit prices, send (post) a draft, delete a draft and record a payment.",
    sidebar: "Open a row on SALES & CUSTOMERS → Invoices",
    sections: ["From", "Bill To", "Invoice Details", "Line Items", "Payment History", "Customer Statement", "Last Payment", "Invoice Lifecycle", "Adjustments", "Credit Notes", "Debit Notes"],
    detail: "full",
    keywords: ["invoice detail", "send invoice", "post invoice", "invoice PDF", "发票详情", "过账发票", "打印发票", "butiran invois", "cetak invois"],
    actions: [
      { label: "View Documentation", kind: "button", does: "Opens the invoice PDF on screen." },
      { label: "PDF", kind: "button", does: "Downloads the invoice PDF." },
      { label: "Edit Prices", kind: "button", does: "Shown while prices may still change: turns the line prices into editable boxes.", permission: "invoices:update" },
      { label: "Save Prices", kind: "button", does: "Saves the edited line prices (PUT /api/invoices/:id) and reads them back.", permission: "invoices:update", sideEffects: "Changes the invoice total and the customer's outstanding." },
      { label: "Cancel", kind: "button", does: "Leaves price editing without saving." },
      { label: "Delete", kind: "button", does: "Drafts only: deletes the invoice after confirmation (DELETE /api/invoices/:id).", permission: "invoices:delete", sideEffects: "Cannot be undone; the DO can be invoiced again." },
      { label: "Send Invoice", kind: "button", does: "Drafts only: posts the invoice (PUT status SENT). It does not email — use \"Email to Customer\" on the list.", permission: "invoices:post", sideEffects: "Writes the ledger entries; the invoice can then only be corrected by credit / debit note or voiding." },
      { label: "Record Payment", kind: "button", does: "Sent / Partial Paid: opens the Record Payment box and adds the payment to this invoice (PUT /api/invoices/:id).", permission: "invoices:update", sideEffects: "Invoice moves to PARTIAL_PAID or PAID and is locked against edits." },
    ],
  },
  {
    // src/pages/invoices/payments.tsx
    path: "/invoices/payments",
    title: "Payment Tracking",
    purpose:
      "Record customer receipts and knock them off invoices, and see every receipt. The same Record Payment form is on FINANCE → Daily → Receipts (\"New Customer Receipt\").",
    sidebar: "Not in the sidebar — FINANCE → Daily → Receipts has the same form; open /invoices/payments directly",
    sections: ["Payment Tracking", "Record Payment", "All Payments", "Total Received", "Cleared", "Pending", "Bounced", "Allocate to Invoices", "Date", "Deposit To", "Method", "Reference", "Amount received (RM)", "This Payment", "Full"],
    detail: "full",
    keywords: [
      "customer payment", "receipt", "record payment", "collection", "knock off", "payment tracking",
      "收款", "客户付款", "收据", "销账", "回款",
      "bayaran", "terima bayaran", "resit", "kutipan",
    ],
    actions: [
      { label: "Record Payment", kind: "button", does: "Saves the receipt from the form: customer, date, Deposit To bank / cash account, method, reference, amount received and the allocation per invoice (POST /api/payments). Money above the allocations is held on account.", permission: "payments:create", sideEffects: "Posts to the bank / cash ledger, reduces the customer's outstanding, marks invoices PARTIAL_PAID / PAID and can close the sales order." },
      { label: "Update receipt", kind: "button", does: "While editing a receipt: re-states it in place with the same number (POST /api/payments/:id/restate).", permission: "payments:update", sideEffects: "Reverses and re-posts the ledger entries." },
      { label: "Cancel", kind: "button", does: "Leaves edit / copy mode without saving." },
      { label: "Full", kind: "toggle", does: "Allocation row checkbox: fills This Payment with the invoice's whole outstanding." },
      { label: "Edit", kind: "button", does: "Receipt pop-up (click a row): loads the receipt into the form for editing." },
      { label: "Void", kind: "button", does: "Receipt pop-up: voids the receipt after confirmation (POST /api/payments/:id/lifecycle).", permission: "payments:update", sideEffects: "Reverses the receipt in the ledger and re-opens the invoices (nothing is deleted)." },
      { label: "Delete", kind: "button", does: "Receipt pop-up: deletes the receipt after confirmation (POST /api/payments/:id/lifecycle).", permission: "payments:update", sideEffects: "Hidden from the GL (still visible in the audit log); invoices re-open." },
      { label: "Restore", kind: "button", does: "Receipt pop-up on a voided / deleted receipt: restores it (POST /api/payments/:id/lifecycle).", permission: "payments:update", sideEffects: "Re-posts the receipt." },
      { label: "Print / PDF", kind: "button", does: "Rows ticked: prints the receipt vouchers of the ticked receipts." },
      { label: "Excel", kind: "button", does: "Rows ticked: exports the ticked receipts with their invoice allocations to Excel." },
      { label: "Refresh", kind: "row-action", does: "Right-click: reloads the list." },
    ],
  },
  {
    // src/pages/invoices/supplier-payments.tsx
    path: "/invoices/supplier-payments",
    title: "Supplier Payment",
    purpose:
      "Pay supplier purchase invoices — partial, several PIs at once, and foreign-currency with FX; also knock supplier advances off purchase invoices and repay trade-finance. Linked from FINANCE → Daily → Payment Vouchers.",
    sidebar: "Not in the sidebar — reached from FINANCE → Daily → Payment Vouchers, or open /invoices/supplier-payments",
    sections: ["Supplier Payment", "All Payments"],
    detail: "basic",
    keywords: ["supplier payment", "pay supplier", "AP payment", "FX payment", "付款给供应商", "供应商付款", "付货款", "bayaran pembekal"],
    actions: [
      { label: "Post Payment", kind: "button", does: "Posts the supplier payment from the Record Payment form (POST /api/supplier-payments).", permission: "invoices:update", sideEffects: "Posts to the ledger and marks the purchase invoices partly / fully paid." },
      { label: "Update Payment", kind: "button", does: "While editing: re-states the payment in place.", permission: "invoices:update", sideEffects: "Reverses and re-posts the ledger entries." },
      { label: "Apply", kind: "button", does: "Knock-off box: applies a supplier advance against a purchase invoice (POST /api/supplier-payments/knock-off).", permission: "invoices:update" },
    ],
  },
  {
    // src/pages/invoices/credit-notes.tsx
    path: "/invoices/credit-notes",
    title: "Credit Notes",
    purpose: "Customer credit notes (refunds, returns, overcharges) against an invoice. Create, edit drafts, post, send back to draft, duplicate, print or delete.",
    sidebar: "FINANCE → Debtors → Credit Notes",
    sections: ["Credit Notes", "Create Credit Note", "Credit Note from Delivery Return"],
    detail: "basic",
    keywords: ["credit note", "CN", "refund", "红字发票", "退款单", "贷项通知单", "nota kredit"],
    actions: [
      { label: "New Credit Note", kind: "button", does: "Opens the Create Credit Note form; \"Create Credit Note\" saves it as a draft (POST /api/credit-notes).", permission: "credit-notes:create" },
      { label: "From Delivery Return", kind: "button", does: "Opens \"Credit Note from Delivery Return\": pick a return and the customer, invoice and returned items fill in at the invoice's prices.", permission: "credit-notes:create" },
      { label: "Post", kind: "button", does: "Note pop-up, drafts: posts the credit note (PUT status POSTED).", permission: "credit-notes:update", sideEffects: "Takes the amount off the invoice and off what the customer owes, and posts it to the books." },
      { label: "Back to Draft", kind: "button", does: "Note pop-up, posted notes: un-posts it (POST /api/credit-notes/:id/unpost).", permission: "credit-notes:update", sideEffects: "Reverses its ledger entries." },
      { label: "Edit", kind: "button", does: "Note pop-up, drafts: opens it for editing.", permission: "credit-notes:update" },
      { label: "Duplicate", kind: "button", does: "Note pop-up: opens a new credit note pre-filled from this one." },
      { label: "Print PDF", kind: "button", does: "Note pop-up: downloads the credit note PDF." },
      { label: "Delete", kind: "button", does: "Note pop-up, drafts: deletes the note (DELETE /api/credit-notes/:id).", permission: "credit-notes:delete" },
    ],
  },
  {
    // src/pages/invoices/debit-notes.tsx
    path: "/invoices/debit-notes",
    title: "Debit Notes",
    purpose: "Debit notes for undercharges and additional charges against a customer invoice. Create, edit drafts, post, send back to draft, duplicate, print or delete.",
    sidebar: "FINANCE → Debtors → Debit Notes",
    sections: ["Debit Notes", "Create Debit Note"],
    detail: "basic",
    keywords: ["debit note", "DN", "extra charge", "undercharge", "借项通知单", "补收", "加收", "nota debit"],
    actions: [
      { label: "New Debit Note", kind: "button", does: "Opens the Create Debit Note form; \"Create Debit Note\" saves it as a draft (POST /api/debit-notes).", permission: "debit-notes:create" },
      { label: "Post", kind: "button", does: "Note pop-up, drafts: posts the debit note.", permission: "debit-notes:update", sideEffects: "Adds the amount to the invoice and to what the customer owes, and posts it to the books." },
      { label: "Back to Draft", kind: "button", does: "Note pop-up, posted notes: un-posts it (POST /api/debit-notes/:id/unpost).", permission: "debit-notes:update" },
      { label: "Edit", kind: "button", does: "Note pop-up, drafts: opens it for editing.", permission: "debit-notes:update" },
      { label: "Duplicate", kind: "button", does: "Note pop-up: opens a new debit note pre-filled from this one." },
      { label: "Print PDF", kind: "button", does: "Note pop-up: downloads the debit note PDF." },
      { label: "Delete", kind: "button", does: "Note pop-up, drafts: deletes the note (DELETE /api/debit-notes/:id).", permission: "debit-notes:delete" },
    ],
  },
  {
    // src/pages/invoices/e-invoice.tsx
    path: "/invoices/e-invoice",
    title: "e-Invoice",
    purpose:
      "LHDN MyInvois: builds and stores the UBL XML for each sales invoice and records what MyInvois / LHDN answered (submitted, valid, rejected, cancelled). The ERP does not upload to MyInvois itself — staff record each step.",
    sidebar: "FINANCE → e-Invoice",
    sections: ["Dashboard", "Generate e-Invoice", "XML Preview", "e-Invoice Submissions", "Sales Invoices Without An e-Invoice"],
    detail: "basic",
    keywords: ["e-invoice", "einvoice", "MyInvois", "LHDN", "UBL XML", "电子发票", "e-invois"],
    actions: [
      { label: "Refresh", kind: "button", does: "Reloads the submissions and candidates." },
      { label: "Generate All Ready", kind: "button", does: "Generate tab: builds the XML for every invoice whose buyer has a TIN on file (POST /api/e-invoices).", permission: "e-invoices:create" },
      { label: "Generate XML", kind: "row-action", does: "Right-click a candidate invoice: builds its e-invoice XML.", permission: "e-invoices:create" },
      { label: "Mark as Submitted", kind: "row-action", does: "Right-click a submission: records that the XML was uploaded to MyInvois (PUT /api/e-invoices/:id).", permission: "e-invoices:update" },
      { label: "Record Result", kind: "row-action", does: "Right-click: records LHDN's answer — \"Record Valid\" (with the UUID) or \"Record Rejected\" (with a reason).", permission: "e-invoices:update" },
      { label: "View XML", kind: "row-action", does: "Right-click: shows the XML on the XML Preview tab." },
      { label: "Copy XML", kind: "button", does: "XML Preview: copies the XML to the clipboard." },
      { label: "Download", kind: "button", does: "XML Preview: downloads the XML file." },
    ],
  },
  {
    // src/pages/invoices/price-summary.tsx
    path: "/invoices/price-summary",
    title: "Invoice Price Summary",
    purpose: "Every invoice line in a month or date range, to check selling prices and correct them in place. Lines on locked invoices (paid, etc.) show why they cannot be edited.",
    sidebar: "SALES & CUSTOMERS → Invoice Price Summary",
    sections: ["Invoice Price Summary", "Unit Price", "Invoice Status", "Editable"],
    detail: "basic",
    keywords: ["invoice price summary", "price check", "selling price", "发票价格汇总", "核对价格", "harga invois"],
    actions: [
      { label: "Month", kind: "toggle", does: "Pick a single month as the period." },
      { label: "Date range", kind: "toggle", does: "Pick a from / to date range instead." },
      { label: "Show", kind: "button", does: "Loads the invoice lines for the chosen period." },
      { label: "Apply to selected", kind: "button", does: "Puts the typed price on every ticked line (not saved yet)." },
      { label: "Save", kind: "button", does: "Saves the changed prices invoice by invoice (PUT /api/invoices/:id).", permission: "invoices:update", sideEffects: "Changes invoice totals and customer outstanding." },
      { label: "Discard", kind: "button", does: "Throws away the unsaved price changes." },
    ],
  },

  // =========================================================================
  // CONSIGNMENT
  // =========================================================================
  {
    // src/pages/consignment/index.tsx
    path: "/consignment",
    title: "Consignment Orders",
    purpose: "Orders for goods placed with a customer on consignment (paid only when sold). Goods ship on a Consignment Note, not a delivery order.",
    sidebar: "SALES & CUSTOMERS → Consignment → Consignment Order",
    sections: ["Consignment Orders"],
    detail: "basic",
    keywords: ["consignment order", "CO", "consignment", "寄卖单", "寄售", "寄卖订单", "konsainan", "pesanan konsainan"],
    actions: [
      { label: "Scan PO", kind: "button", does: "Opens the PO scanner to create consignment orders from a customer PO." },
      { label: "New Consignment Order", kind: "button", does: "Opens the new consignment order form (/consignment/create)." },
      { label: "Create Consignment Note", kind: "row-action", does: "Right-click: goes to Consignment Note — consignment stock moves on a consignment note, not a delivery order." },
      { label: "Print / Preview", kind: "row-action", does: "Right-click: generates the consignment order PDF." },
      { label: "View Document Status Change Log", kind: "row-action", does: "Right-click: opens the order at its status history." },
    ],
  },
  {
    // src/pages/consignment/detail.tsx
    path: "/consignment/:id",
    title: "Consignment Order detail",
    purpose: "One consignment order: preview / PDF / clone / edit, status actions (confirm, hold, resume, cancel, open service case), order information, production orders and the document flow.",
    sidebar: "Open a row on SALES & CUSTOMERS → Consignment → Consignment Order",
    sections: ["Order Information", "Summary", "Order Progress"],
    detail: "basic",
    keywords: ["consignment order detail", "寄卖单详情", "butiran pesanan konsainan"],
    actions: [
      { label: "Confirm Order", kind: "button", does: "Draft: confirms the consignment order (POST /api/consignment-orders/:id/confirm).", permission: "consignments:create", sideEffects: "Creates production orders." },
      { label: "Edit", kind: "button", does: "Opens the edit page.", permission: "consignments:update" },
      { label: "Clone", kind: "button", does: "Opens a new consignment order form pre-filled from this one." },
      { label: "Put On Hold", kind: "button", does: "Puts the order on hold with a reason.", permission: "consignments:update" },
      { label: "Cancel Order", kind: "button", does: "Soft-cancels the order (keeps the record).", permission: "consignments:update" },
      { label: "Delete", kind: "button", does: "Draft only: deletes the order.", permission: "consignments:delete", sideEffects: "Cannot be undone." },
    ],
  },
  {
    // src/pages/consignment/create.tsx
    path: "/consignment/create",
    title: "New Consignment Order",
    purpose: "Form to enter a new consignment order (order details, line items, summary). Save as draft or create (confirm) it.",
    sidebar: "SALES & CUSTOMERS → Consignment → Consignment Order → click \"New Consignment Order\"",
    sections: ["Order Details", "Summary"],
    detail: "basic",
    keywords: ["new consignment order", "开寄卖单", "新建寄卖单", "buat pesanan konsainan"],
    actions: [
      { label: "Save as Draft", kind: "button", does: "Saves the consignment order as DRAFT (POST /api/consignment-orders).", permission: "consignments:create" },
      { label: "Create", kind: "button", does: "Saves and confirms it (POST /api/consignment-orders, then /confirm).", permission: "consignments:create", sideEffects: "Creates production orders." },
      { label: "Cancel", kind: "button", does: "Leaves the form without saving." },
    ],
  },
  {
    // src/pages/consignment/edit.tsx
    path: "/consignment/:id/edit",
    title: "Edit Consignment Order",
    purpose: "Modify consignment order details and line items while still editable.",
    sidebar: "Open a consignment order and click \"Edit\"",
    sections: ["Order Details", "Summary"],
    detail: "basic",
    keywords: ["edit consignment order", "修改寄卖单", "ubah pesanan konsainan"],
    actions: [
      { label: "Save Changes", kind: "button", does: "Saves the changes (PUT /api/consignment-orders/:id).", permission: "consignments:update" },
      { label: "Cancel", kind: "button", does: "Goes back without saving." },
    ],
  },
  {
    // src/pages/consignment/note.tsx
    path: "/consignment/note",
    title: "Consignment Notes",
    purpose: "Ship consignment goods to the customer's branch and track them: create consignment notes and packing lists, mark dispatched / delivered / acknowledged, then bill sold pieces to a sales invoice or bring unsold pieces back as a consignment return.",
    sidebar: "SALES & CUSTOMERS → Consignment → Consignment Note",
    sections: ["Consignment Notes", "Planning", "Pending CN", "Pending Dispatch", "Dispatched", "Delivered", "Acknowledged", "Packing List"],
    detail: "basic",
    keywords: ["consignment note", "CN", "consignment delivery", "寄卖送货单", "寄卖出货", "nota konsainan"],
    actions: [
      { label: "Create CN", kind: "button", does: "Pending CN tab, rows ticked: creates the consignment note (POST /api/consignment-notes).", permission: "consignment-notes:create" },
      { label: "Create Packing List", kind: "button", does: "Saves a packing list (truck run) for the ticked notes." },
      { label: "Mark Dispatched", kind: "button", does: "Marks the ticked / right-clicked notes dispatched.", permission: "consignment-notes:update" },
      { label: "Mark Delivered", kind: "button", does: "Marks notes delivered.", permission: "consignment-notes:update" },
      { label: "Mark Acknowledged", kind: "button", does: "Records that the branch acknowledged receipt.", permission: "consignment-notes:update" },
      { label: "Transfer to Sales Invoice", kind: "row-action", does: "Right-click: bills the sold pieces to a sales invoice (POST /api/consignment-notes/:id/convert-to-invoice).", permission: "consignment-notes:create", sideEffects: "Creates a sales invoice; the customer's outstanding goes up." },
      { label: "Transfer to Consignment Return", kind: "row-action", does: "Right-click: records unsold pieces coming back (POST /api/consignment-notes/:id/return).", permission: "consignment-notes:create", sideEffects: "Moves stock back." },
      { label: "Export CSV", kind: "button", does: "Downloads the list as CSV." },
    ],
  },
  {
    // src/pages/consignment/return.tsx
    path: "/consignment/return",
    title: "Consignment Returns",
    purpose: "List of unsold consignment goods that came back from the customer, with return value. Returns are recorded from a consignment note.",
    sidebar: "SALES & CUSTOMERS → Consignment → Consignment Return",
    sections: ["Consignment Returns", "Returned Lines", "Return Value"],
    detail: "basic",
    keywords: ["consignment return", "寄卖退货", "寄卖退回", "pulangan konsainan"],
    actions: [
      { label: "Record a Return", kind: "button", does: "Opens Consignment Note, where a return is recorded with \"Transfer to Consignment Return\"." },
      { label: "Export CSV", kind: "button", does: "Downloads the list as CSV." },
      { label: "Open Consignment Note", kind: "row-action", does: "Right-click: opens the consignment note the return came from." },
    ],
  },

  // =========================================================================
  // CUSTOMERS & PIPELINE
  // =========================================================================
  {
    // src/pages/customers.tsx
    path: "/customers",
    title: "Customers",
    purpose: "Customer accounts with credit terms, credit limit, outstanding and available credit, delivery hubs and per-customer product / price lists. Confirmed customers can be billed; Potential ones come from the Sales Pipeline.",
    sidebar: "SALES & CUSTOMERS → Customers",
    sections: ["Customers", "All Customers", "Confirmed", "Potential", "All", "Delivery Hubs", "Credit Limit", "Outstanding", "Available"],
    detail: "basic",
    keywords: ["customer", "customer list", "debtor", "credit limit", "delivery hub", "客户", "客户资料", "客户列表", "信用额度", "pelanggan", "senarai pelanggan", "had kredit"],
    actions: [
      { label: "Add Customer", kind: "button", does: "Opens the add-customer form; \"Create Customer\" saves it (POST /api/customers).", permission: "customers:create" },
      { label: "Edit", kind: "row-action", does: "Right-click: edit company information, credit & terms.", permission: "customers:update" },
      { label: "Add Hub", kind: "button", does: "Expanded customer: adds a delivery hub.", permission: "customers:update" },
      { label: "Assign SKU", kind: "button", does: "Customer Products panel: assigns products (with customer prices) to this customer.", permission: "customers:update" },
      { label: "Delete", kind: "row-action", does: "Right-click: deletes the customer after confirmation (DELETE /api/customers/:id).", permission: "customers:delete" },
    ],
  },
  {
    // src/pages/leads/index.tsx
    path: "/leads",
    title: "Sales Pipeline",
    purpose: "Potential customers (leads) on a board or list by stage — Potential, Contacted, Quoted, Negotiating, Confirmed, Dropped — with follow-ups due. Confirming a lead turns it into a real customer.",
    sidebar: "SALES & CUSTOMERS → Sales Pipeline",
    sections: ["Sales Pipeline", "Board", "List", "Open pipeline", "Potential", "Contacted", "Quoted", "Negotiating", "Confirmed", "Dropped"],
    detail: "basic",
    keywords: ["sales pipeline", "lead", "prospect", "potential customer", "CRM", "潜在客户", "销售漏斗", "跟进", "bakal pelanggan", "prospek"],
    actions: [
      { label: "New Potential", kind: "button", does: "Opens \"New potential customer\" to add a lead (POST /api/sales-leads).", permission: "customers:update" },
      { label: "Open", kind: "row-action", does: "Right-click (or click a card): opens the lead drawer to log activities and follow-ups." },
      { label: "Convert", kind: "button", does: "In \"Confirm customer\": turns the lead into a billable customer (POST /api/sales-leads/:id/convert).", permission: "customers:update", sideEffects: "Creates / confirms a customer account." },
      { label: "Delete", kind: "row-action", does: "Right-click: deletes the lead (DELETE /api/sales-leads/:id).", permission: "customers:delete" },
    ],
  },
];
