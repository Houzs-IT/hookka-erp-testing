// ---------------------------------------------------------------------------
// howto/screens-procurement.ts — screen map for Procurement + Warehouse + MRP.
// Written from the page code:
//   src/pages/procurement/{index,create,detail,grn,grn-detail,maintenance,reports,pi,PurchaseInvoiceDetail}.tsx
//   src/pages/procurement/grn/create.tsx, pi/create.tsx
//   src/pages/purchase-returns/index.tsx, src/pages/suppliers/detail.tsx
//   src/pages/inventory/{index,fabrics,stock-value,adjustments,stock-take}.tsx
//   src/pages/warehouse.tsx, src/pages/planning/mrp.tsx
// and the API routes they call (purchase-orders.ts, grn.ts, purchase-invoices.ts,
// purchase-returns.ts, suppliers.ts, supplier-materials.ts, doc-import.ts,
// products.ts, raw-materials.ts, fabric-tracking.ts, stock-value.ts,
// stock-adjustments.ts, warehouse.ts, mrp.ts).
// ---------------------------------------------------------------------------
import type { ScreenEntry } from "./screen-types";

export const SCREENS: ScreenEntry[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement",
    title: "Purchase Orders",
    purpose:
      "List of all purchase orders (POs) to suppliers, with KPI cards (Total POs, Pending Delivery, Overdue POs, Outstanding Qty), low-stock and forecasted-shortage banners, filters, and bulk actions (combined PDF, bulk convert to GRN, submit drafts). Double-click a row to open the PO.",
    sidebar: "PROCUREMENT → Purchase Order",
    sections: ["Purchase Orders", "Total POs", "Pending Delivery", "Overdue POs", "Outstanding Qty", "Draft", "Confirmed"],
    actions: [
      { label: "New Purchase Order", kind: "button", does: "Opens the full-page PO form (/procurement/create).", permission: "purchase-orders:create" },
      {
        label: "Import",
        kind: "button",
        does: "Opens the Detail Listing import window (POST /api/doc-import/po). A dry run shows the plan per row first; applying is all-or-nothing. Edits Doc Date, Qty and Unit Price on POs with nothing received, adds lines, or creates new POs.",
        permission: "purchase-orders:update",
        sideEffects: "Creates or changes POs when applied (needs purchase-orders update or create).",
      },
      { label: "Overdue POs", kind: "filter", does: "Clicking the Overdue POs card toggles the table to overdue POs only (click again to clear)." },
      {
        label: "Create PO from Low Stock",
        kind: "button",
        does: "Shown when raw materials are below their minStock. Opens the compact New Purchase Order window pre-filled with those materials; saving it calls POST /api/purchase-orders (one PO, or one per supplier with Split by Supplier).",
        permission: "purchase-orders:create",
        sideEffects: "Creates CONFIRMED purchase orders when saved.",
      },
      { label: "Top Shortages", kind: "button", does: "View / Hide the forecasted-shortage panel: top 25 items short across CONFIRMED + IN_PRODUCTION sales orders after stock and open POs (read-only; MRP has the full plan)." },
      { label: "Filters", kind: "button", does: "Shows the filter panel: quick date presets (This Month / Last Month / This Year), Status, Supplier, Company, Date From, Date To." },
      { label: "Clear", kind: "button", does: "Clears all filters." },
      { label: "This Month", kind: "filter", does: "Sets the order-date range to this month." },
      { label: "Last Month", kind: "filter", does: "Sets the order-date range to last month." },
      { label: "This Year", kind: "filter", does: "Sets the order-date range to this year." },
      { label: "Download PDF", kind: "button", does: "Appears once rows are ticked. Builds one combined PDF of the selected POs in the browser, each under its supplier's purchase-company letterhead." },
      {
        label: "to GRN",
        kind: "button",
        does: "The Convert N to GRN button (appears when rows are ticked). For each selected PO creates a full-receipt GRN for every outstanding line (POST /api/grn) and immediately posts it (PUT /api/grn/:id status POSTED). Disabled if any selected PO is not in an eligible status.",
        permission: "grn:create",
        sideEffects: "Posts stock for the whole outstanding quantity, updates the PO received qty/status and clears In Transit. Also needs grn:update to post.",
      },
      { label: "Draft", kind: "tab", does: "Shows DRAFT POs only (normally empty — manual POs are created CONFIRMED)." },
      { label: "Confirmed", kind: "tab", does: "Shows every non-draft PO." },
      {
        label: "drafts",
        kind: "button",
        does: "The Submit N drafts button on the Draft tab: moves each selected DRAFT PO to SUBMITTED via PUT /api/purchase-orders/:id, after a confirm.",
        permission: "purchase-orders:update",
      },
      { label: "Export", kind: "button", does: "Grid export menu: Listing → Excel / CSV of the visible columns, or Detail Listing (one row per PO line, also the import template)." },
      { label: "View", kind: "row-action", does: "Right-click menu: opens the PO page." },
      { label: "Edit", kind: "row-action", does: "Right-click menu: opens the PO page (enabled only for DRAFT POs; editing is done on the PO page)." },
      { label: "Copy as new", kind: "row-action", does: "Right-click menu: opens a new PO pre-filled with this PO's supplier, lines and prices (any status).", permission: "purchase-orders:create" },
      { label: "Print / Preview", kind: "row-action", does: "Right-click menu: generates the PO PDF under the supplier's purchase-company letterhead." },
      { label: "Refresh", kind: "row-action", does: "Right-click menu: reloads suppliers, POs, inventory and supplier bindings." },
      { label: "Prev", kind: "button", does: "Previous server page (only in the unfiltered view)." },
      { label: "Next", kind: "button", does: "Next server page (only in the unfiltered view)." },
    ],
    detail: "full",
    keywords: ["purchase order", "PO list", "PO", "采购单", "采购订单", "订货单", "pesanan belian", "PO pembekal", "senarai PO"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/create",
    title: "New Purchase Order",
    purpose:
      "Full-page form to raise a purchase order to one supplier. The PO is saved as CONFIRMED straight away (no draft). Also used for Copy as new (?copyFrom=).",
    sidebar: "PROCUREMENT → Purchase Order → New Purchase Order",
    sections: ["New Purchase Order", "Order Details", "Summary", "Order Items", "Select Materials"],
    actions: [
      { label: "Add Materials from Supplier", kind: "button", does: "Opens the Select Materials window listing the materials bound to the chosen supplier (supplier SKU, price, unit)." },
      { label: "Add", kind: "button", does: "In Select Materials: adds the material as a line with the bound SKU, price, unit, lead time and MOQ (button turns to Added)." },
      { label: "Done", kind: "button", does: "Closes the Select Materials window." },
      { label: "Remove line", kind: "button", does: "Trash icon on a line: removes the line." },
      {
        label: "Split by Supplier",
        kind: "button",
        does: "Shown only when lines belong to several suppliers. Creates one PO per supplier (one POST /api/purchase-orders each), each under that supplier's own purchase company; reports how many were created and lists failures.",
        permission: "purchase-orders:create",
        sideEffects: "Creates several CONFIRMED POs at once; failed ones are reported, the rest are still created.",
      },
      {
        label: "Create Purchase Order",
        kind: "button",
        does: "Saves the PO (POST /api/purchase-orders) with status CONFIRMED and the next PO number, then returns to the PO list. Disabled with no lines, unbound lines, or mixed suppliers.",
        permission: "purchase-orders:create",
        sideEffects: "The PO is active immediately; nothing is emailed to the supplier. For a group-company supplier with mirroring on, a mirror sales order may be raised automatically.",
      },
      { label: "Cancel", kind: "button", does: "Leaves without saving and returns to the PO list." },
    ],
    detail: "full",
    keywords: ["new PO", "create PO", "raise PO", "开PO", "新建采购单", "下单", "buat PO", "PO baru"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/reports",
    title: "Procurement Reports",
    purpose:
      "Read-only reports: which suppliers deliver late (supplier delay score) and every PO line still to come (outstanding PO lines).",
    sidebar: "PROCUREMENT → Procurement Reports",
    sections: ["Procurement Reports", "Supplier delay score", "Outstanding PO lines"],
    actions: [
      { label: "Supplier delay score", kind: "tab", does: "Per-supplier score over the last months: on time %, average days late, overdue lines and value, quality cases. Clicking a supplier opens its late lines on the other tab." },
      { label: "Outstanding PO lines", kind: "tab", does: "Every open PO line with days late, PO No., supplier, item and expected date." },
    ],
    detail: "basic",
    keywords: ["supplier delay", "late delivery", "outstanding PO", "供应商迟交", "未到货", "采购报表", "pembekal lewat", "laporan perolehan"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/:id",
    title: "Purchase Order detail",
    purpose:
      "One purchase order: status timeline, order details, items, supplier delivery dates, three-way match, linked GRNs / invoices, and every action on the PO (edit, email, print, receive, invoice, cancel, close).",
    sidebar: "PROCUREMENT → Purchase Order, then double-click a PO (or right-click → View).",
    sections: ["Status Timeline", "Order Details", "Supplier Delivery Dates", "Three-Way Match", "Document Lineage", "Edit Purchase Order"],
    actions: [
      { label: "Edit", kind: "button", does: "Opens the Edit Purchase Order card (lines, supplier SKU, price, expected date, notes). Shown only while nothing is received (no posted GRN) and the PO is not RECEIVED / CLOSED / CANCELLED.", permission: "purchase-orders:update" },
      {
        label: "Save Changes",
        kind: "button",
        does: "In edit mode: saves via PUT /api/purchase-orders/:id. Refused if lines have no supplier, mix suppliers, or someone else saved the PO after you opened it.",
        permission: "purchase-orders:update",
        sideEffects: "Replaces the PO lines and the whole notes text. The supplier is not told.",
      },
      { label: "Cancel", kind: "button", does: "In edit mode: discards the edits." },
      { label: "Copy as new", kind: "button", does: "Opens a new PO with this supplier, lines and prices (dates and number blank).", permission: "purchase-orders:create" },
      {
        label: "Email to Supplier",
        kind: "button",
        does: "Shown once the PO is SUBMITTED / CONFIRMED / PARTIAL_RECEIVED / RECEIVED. Builds the PO PDF and opens a Mail Center compose draft to the supplier's email(s) with the PDF attached. After you send it, the PO is stamped as emailed (POST /api/purchase-orders/:id/mark-emailed) and Last sent shows.",
        permission: "purchase-orders:update",
        sideEffects: "Sending the draft really emails the supplier from your mailbox. Refused if the supplier has no email on file.",
      },
      { label: "Resend Email", kind: "button", does: "Same as Email to Supplier once the PO was emailed before." },
      { label: "Preview", kind: "button", does: "Opens the PO PDF in the in-app preview (print / download / new tab), under the supplier's purchase-company letterhead." },
      { label: "Download PDF", kind: "button", does: "Downloads the PO PDF under the supplier's purchase-company letterhead." },
      { label: "Print GRN", kind: "button", does: "Shown on PARTIAL_RECEIVED / RECEIVED POs: opens a goods-received printout of this PO in the preview." },
      { label: "Create Invoice", kind: "button", does: "Opens New Purchase Invoice pre-filled from this PO (/procurement/pi/create?poId=). Shows Invoiced and is disabled when a live invoice already exists.", permission: "purchase-invoices:create" },
      { label: "Record", kind: "button", does: "Supplier Delivery Dates card: records the next supplier date (Date 1, then Revised date 2-4) via POST /api/purchase-orders/:id/supplier-date.", permission: "purchase-orders:update", sideEffects: "A recorded date can't be changed later." },
      { label: "Create GRN", kind: "button", does: "Shown on CONFIRMED / PARTIAL_RECEIVED POs with no posted GRN yet: opens New Goods Receipt Note with this PO locked.", permission: "grn:create" },
      { label: "Receive Goods", kind: "button", does: "Same as Create GRN once a posted GRN exists (for another partial receipt).", permission: "grn:create" },
      {
        label: "Mark Confirmed",
        kind: "button",
        does: "On a SUBMITTED PO: moves it to CONFIRMED (PUT /api/purchase-orders/:id).",
        permission: "purchase-orders:approve",
      },
      {
        label: "Mark Partially Received",
        kind: "button",
        does: "On a CONFIRMED PO: sets status PARTIAL_RECEIVED.",
        permission: "purchase-orders:receive",
      },
      {
        label: "Mark Fully Received",
        kind: "button",
        does: "Only when a POSTED GRN exists: sets status RECEIVED (refused otherwise — create and post a GRN first).",
        permission: "purchase-orders:receive",
      },
      {
        label: "Delete PO",
        kind: "button",
        does: "DRAFT POs only: permanently deletes the PO (DELETE /api/purchase-orders/:id) after a confirm.",
        permission: "purchase-orders:delete",
        sideEffects: "Cannot be undone.",
      },
      {
        label: "Close PO",
        kind: "button",
        does: "On CONFIRMED / PARTIAL_RECEIVED POs (short-close) or a RECEIVED PO: asks for a reason of at least 10 characters and sets status CLOSED. Use when the supplier delivered or billed less and nothing more is coming.",
        permission: "purchase-orders:update",
        sideEffects: "The reason is appended to the PO notes; the PO leaves Overdue POs. Received stock, bills and payments stay as they are.",
      },
      {
        label: "Cancel PO",
        kind: "button",
        does: "On SUBMITTED / CONFIRMED / PARTIAL_RECEIVED POs: asks for a reason of at least 10 characters (Keep PO backs out) and sets status CANCELLED.",
        permission: "purchase-orders:update",
        sideEffects: "The reason is appended to the PO notes. Stock already received from posted GRNs is NOT reversed.",
      },
      { label: "Show", kind: "toggle", does: "Three-Way Match card: Show / Hide the PO vs GRN vs invoice line comparison with variances." },
    ],
    detail: "full",
    keywords: ["PO detail", "email PO", "cancel PO", "close PO", "采购单详情", "发PO给供应商", "取消采购单", "butiran PO", "batal PO", "emel PO"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/grn",
    title: "Goods Receipt Notes",
    purpose:
      "List of goods receipts (GRNs): what suppliers delivered. KPI cards, arrival-stage tabs (Planning / In Transit / At Customs / Arrived), bulk arrival moves, bulk approve, and per-row approve / post to stock / invoice / cancel.",
    sidebar: "PROCUREMENT → Goods Receipt",
    sections: ["Goods Receipt Notes", "Total GRNs", "Pending QC", "Approved (MTD)", "Total Value", "All GRNs", "Planning", "In Transit", "At Customs", "Arrived"],
    actions: [
      { label: "Create GRN", kind: "button", does: "Opens New Goods Receipt Note in manual mode (goods without a PO).", permission: "grn:create" },
      { label: "From PO", kind: "button", does: "Opens New Goods Receipt Note with the Convert from Purchase Order picker.", permission: "grn:create" },
      { label: "Scan GRN", kind: "button", does: "Opens New Goods Receipt Note with the scan wizard open (upload supplier delivery notes to auto-create GRNs).", permission: "grn:create" },
      {
        label: "Import",
        kind: "button",
        does: "Opens the Detail Listing import window (POST /api/doc-import/grn): dry run first, then apply all-or-nothing.",
        permission: "grn:update",
      },
      { label: "All GRNs", kind: "tab", does: "Clears the arrival-stage filter." },
      { label: "Planning", kind: "tab", does: "Filters to GRNs not yet shipped (arrival NOT_ARRIVED). Click again to clear." },
      { label: "In Transit", kind: "tab", does: "Filters to GRNs in transit." },
      { label: "At Customs", kind: "tab", does: "Filters to GRNs at customs." },
      { label: "Arrived", kind: "tab", does: "Filters to arrived GRNs." },
      { label: "Filters", kind: "button", does: "Shows the filter panel (status, supplier, dates, quick presets)." },
      { label: "Clear", kind: "button", does: "Clears all filters." },
      { label: "Mark In Transit", kind: "button", does: "With rows ticked: moves each eligible GRN's arrival to In Transit (PUT /api/grn/:id/arrival).", permission: "grn:update" },
      { label: "Mark At Customs", kind: "button", does: "With rows ticked: moves eligible GRNs to At Customs.", permission: "grn:update" },
      { label: "Mark Arrived", kind: "button", does: "With rows ticked: moves eligible GRNs to Arrived (unlocks Post to Stock).", permission: "grn:update" },
      { label: "Download PDF", kind: "button", does: "With rows ticked: one combined GRN PDF built in the browser." },
      { label: "Draft", kind: "tab", does: "DRAFT GRNs." },
      { label: "Confirmed", kind: "tab", does: "Non-draft GRNs." },
      {
        label: "Confirm selected",
        kind: "button",
        does: "With DRAFT rows ticked: moves each from DRAFT to CONFIRMED one by one (PUT /api/grn/:id), listing refusals at the end.",
        permission: "grn:update",
        sideEffects: "No stock is posted — Post to Stock stays per GRN.",
      },
      { label: "Export", kind: "button", does: "Grid export: Listing → Excel / CSV, or Detail Listing per line." },
      { label: "View", kind: "row-action", does: "Right-click menu: opens the GRN page." },
      { label: "Print GRN", kind: "row-action", does: "Right-click menu: prints this GRN under the supplier's purchase-company letterhead." },
      { label: "Approve", kind: "row-action", does: "Right-click menu: sets the GRN CONFIRMED (PUT /api/grn/:id). Disabled once CONFIRMED or POSTED.", permission: "grn:update" },
      {
        label: "Post to Stock",
        kind: "row-action",
        does: "Right-click menu: sets the GRN POSTED (PUT /api/grn/:id). Refused until the goods are marked arrived.",
        permission: "grn:update",
        sideEffects: "Adds accepted quantities to raw-material stock (FIFO lots + cost ledger) and updates the PO received qty and status. A line with no matching raw material does NOT land in stock (red toast).",
      },
      { label: "Convert to Invoice", kind: "row-action", does: "Right-click menu (POSTED GRNs only): opens New Purchase Invoice pre-filled from this GRN.", permission: "purchase-invoices:create" },
      {
        label: "Cancel Receipt",
        kind: "row-action",
        does: "Right-click menu: after a confirm, cancels the GRN (POST /api/grn/:id/cancel). Refused while a purchase invoice still bills the lines, a purchase return is open, or the stock was already used.",
        permission: "grn:delete",
        sideEffects: "Removes the posted stock from on hand and gives the PO quantity back. The GRN stays as CANCELLED and cannot be reopened.",
      },
      { label: "Refresh", kind: "row-action", does: "Right-click menu: reloads the list." },
    ],
    detail: "full",
    keywords: ["GRN", "goods receipt", "receive goods", "收货", "收货单", "入库", "到货", "terima barang", "nota penerimaan barang", "stok masuk"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/grn/create",
    title: "New Goods Receipt Note",
    purpose:
      "Record a delivery. Against a PO (Convert from PO / deep-link from the PO) it is saved as DRAFT with arrival Planning and does not touch stock until marked arrived and posted. Without a PO (manual) it is posted to stock immediately.",
    sidebar: "PROCUREMENT → Goods Receipt → From PO (or Create GRN for goods without a PO)",
    sections: ["New Goods Receipt Note", "GRN Details", "Summary", "Shipment Details", "Received By", "Supplier DO No.", "Purchase company"],
    actions: [
      { label: "Convert from PO", kind: "button", does: "Opens the Convert from Purchase Order window: pick a PO and tick the lines that arrived to pre-fill the receipt. Reads Add another PO once lines exist. Hidden when the PO is locked by a deep-link." },
      {
        label: "Create GRNs",
        kind: "button",
        does: "The Scan & Create GRNs button: upload one or more supplier delivery notes; the wizard reads them and creates one DRAFT GRN per document.",
        permission: "grn:create",
        sideEffects: "Creates DRAFT GRNs (no stock moves until posted).",
      },
      { label: "Scan supplier document", kind: "button", does: "Upload / snap a supplier delivery note or invoice to auto-fill received quantities on this form (PO mode needs a PO; manual mode needs a supplier)." },
      { label: "Add Line", kind: "button", does: "Manual mode: adds an empty line (Material Name, Received, Unit Price)." },
      { label: "Remove line", kind: "button", does: "Manual mode: removes the line." },
      { label: "Shipment Details", kind: "toggle", does: "Expands Shipping Method, Carrier and Expected Arrival for imported goods (PO-linked GRNs)." },
      {
        label: "Create GRN",
        kind: "button",
        does: "PO-linked: saves the GRN (POST /api/grn) as DRAFT with arrival Planning. Requires Received By and at least one received quantity; a PO line may not pass 110% of ordered in total.",
        permission: "grn:create",
        sideEffects: "No stock moves yet — open the GRN, mark arrived and Post to Stock.",
      },
      {
        label: "Receive & Post to Stock",
        kind: "button",
        does: "Manual (no PO) mode: saves the GRN and posts it in one step. A Supplier DO No. already used on another GRN of the same supplier is refused.",
        permission: "grn:create",
        sideEffects: "Raw-material stock goes up immediately.",
      },
      { label: "Open GRN", kind: "button", does: "After saving from a PO: the prompt offers to go back to the PO or open the new GRN." },
      { label: "Cancel", kind: "button", does: "Leaves without saving." },
    ],
    detail: "full",
    keywords: ["new GRN", "receive goods", "goods received", "开收货单", "收货", "进货", "terima barang", "GRN baru"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/grn/:id",
    title: "Goods Receipt Note detail",
    purpose:
      "One GRN: details, arrival progress, received items, shipment details, landed cost and linked invoices; advance arrival, approve, post to stock, invoice, return or cancel.",
    sidebar: "PROCUREMENT → Goods Receipt, then double-click a GRN (or a GRN number on the PO list / PO page).",
    sections: ["GRN Details", "Arrival Progress", "Shipment Details", "Landed Cost", "Document Lineage"],
    actions: [
      { label: "Print", kind: "button", does: "Prints the GRN PDF under the supplier's purchase-company letterhead." },
      { label: "Create Purchase Return", kind: "button", does: "Opens Purchase Returns with this GRN preselected (return received goods; reverses stock, no Debit Note since not invoiced).", permission: "purchase-returns:create" },
      { label: "Mark In Transit", kind: "button", does: "Arrival button when Planning: moves arrival to In Transit (PUT /api/grn/:id/arrival).", permission: "grn:update" },
      { label: "Mark At Customs", kind: "button", does: "Arrival button when In Transit: moves arrival to At Customs.", permission: "grn:update" },
      { label: "Mark Arrived", kind: "button", does: "Arrival button when At Customs: marks the goods arrived, which enables Post to Stock.", permission: "grn:update" },
      {
        label: "Cancel Receipt",
        kind: "button",
        does: "After a confirm, cancels the GRN (POST /api/grn/:id/cancel). Refused while an invoice bills the lines, a return is open, or the stock was used.",
        permission: "grn:delete",
        sideEffects: "Reverses posted stock and releases the PO quantity. Cannot be reopened.",
      },
      { label: "Approve", kind: "button", does: "Sets the GRN CONFIRMED (optional; posting does not require it).", permission: "grn:update" },
      {
        label: "Post to Stock",
        kind: "button",
        does: "Sets the GRN POSTED (PUT /api/grn/:id). Disabled until arrival is Arrived.",
        permission: "grn:update",
        sideEffects: "Moves stock and cost; updates the PO to PARTIAL_RECEIVED / RECEIVED. Once POSTED the only way out is Cancel Receipt.",
      },
      {
        label: "Convert to Invoice",
        kind: "button",
        does: "POSTED GRNs: after a confirm and a currency prompt (MYR, or USD / CNY with a booking rate), creates a DRAFT purchase invoice from the accepted lines (POST /api/purchase-invoices) and opens it.",
        permission: "purchase-invoices:create",
      },
      { label: "Edit", kind: "button", does: "Next to Supplier DO No.: edit the supplier's DO number, then Save (PUT /api/grn/:id).", permission: "grn:update" },
      {
        label: "Edit Quantities",
        kind: "button",
        does: "Edit accepted quantities per line, then Save Quantities (PUT /api/grn/:id). Lines already billed on an invoice are locked.",
        permission: "grn:update",
        sideEffects: "On a POSTED GRN the change moves stock and posts a matching cost entry.",
      },
      { label: "Save Quantities", kind: "button", does: "Saves the edited accepted quantities after a confirm.", permission: "grn:update" },
      { label: "Edit Shipment Details", kind: "button", does: "Edit shipping method, carrier, tracking, container, expected / actual arrival and customs data, then Save Shipment Details (PUT /api/grn/:id/arrival).", permission: "grn:update" },
      { label: "Edit Landed Cost", kind: "button", does: "Edit shipping cost, customs duty, currency and exchange rate, then Save Landed Cost.", permission: "grn:update" },
    ],
    detail: "full",
    keywords: ["GRN detail", "post to stock", "mark arrived", "cancel receipt", "收货单详情", "过账入库", "到货", "butiran GRN", "pos ke stok"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/maintenance",
    title: "Suppliers",
    purpose:
      "Supplier master list (code, contact, terms, purchase company, rating, status) and a cross-supplier price comparison per material.",
    sidebar: "PROCUREMENT → Suppliers",
    sections: ["Suppliers", "Price Comparison", "Active Suppliers", "Total Suppliers", "Blacklisted", "Avg Rating", "Supplier Comparison"],
    actions: [
      { label: "Add Supplier", kind: "button", does: "Opens the supplier form; saving calls POST /api/suppliers.", permission: "suppliers:create" },
      { label: "Batch Edit", kind: "button", does: "With suppliers ticked: edit fields on all of them (PUT /api/suppliers/:id each).", permission: "suppliers:update" },
      { label: "View Scorecard", kind: "row-action", does: "Right-click menu: opens the supplier page (/suppliers/:id)." },
      { label: "Edit", kind: "row-action", does: "Right-click menu: opens the supplier form (PUT /api/suppliers/:id).", permission: "suppliers:update" },
      { label: "Delete", kind: "row-action", does: "Right-click menu: deletes the supplier (DELETE /api/suppliers/:id).", permission: "suppliers:delete", sideEffects: "The supplier reappears if the server refuses." },
      { label: "Price Comparison", kind: "tab", does: "Compares the bound prices of each material across suppliers." },
    ],
    detail: "basic",
    keywords: ["supplier list", "suppliers", "vendor", "供应商", "供应商资料", "比价", "pembekal", "senarai pembekal"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/pi",
    title: "Purchase Invoices",
    purpose:
      "List of supplier (purchase) invoices with KPI cards (Total PIs, Pending Payment, Overdue, Total Value), a clickable status pipeline, Draft / Confirmed tabs, bulk confirm and per-row confirm / mark paid.",
    sidebar: "PROCUREMENT → Purchase Invoice",
    sections: ["Purchase Invoices", "Total PIs", "Pending Payment", "Overdue", "Total Value", "Draft", "Confirmed"],
    actions: [
      {
        label: "Post to GL",
        kind: "button",
        does: "One-time repair: previews (dry run) CONFIRMED invoices missing from the general ledger, asks to confirm the count and total, then posts them (POST /api/purchase-invoices/backfill-gl-postings). Already-posted invoices are skipped.",
        permission: "purchase-invoices:update",
        sideEffects: "Posts journal entries to the general ledger.",
      },
      { label: "Scan PI", kind: "button", does: "Opens New Purchase Invoice with the scan wizard (creates DRAFT invoices from scanned supplier invoices).", permission: "purchase-invoices:create" },
      { label: "From PO / GRN", kind: "button", does: "Opens a picker of POs / GRNs; the chosen one opens New Purchase Invoice pre-filled.", permission: "purchase-invoices:create" },
      { label: "Import", kind: "button", does: "Opens the Detail Listing import window (POST /api/doc-import/pi): dry run, then apply all-or-nothing.", permission: "purchase-invoices:update" },
      { label: "Create Invoice", kind: "button", does: "Opens the blank New Purchase Invoice page.", permission: "purchase-invoices:create" },
      { label: "Paid", kind: "filter", does: "Status pipeline (Draft → Confirmed → Paid): clicking a stage filters the list to that status; click again to clear." },
      { label: "Draft", kind: "tab", does: "DRAFT invoices only." },
      { label: "Confirmed", kind: "tab", does: "Everything not DRAFT (CONFIRMED, PAID, CANCELLED)." },
      { label: "Export CSV", kind: "button", does: "Downloads the filtered list as CSV." },
      {
        label: "Confirm selected",
        kind: "button",
        does: "With DRAFT rows ticked: confirms each one (PUT /api/purchase-invoices/:id status CONFIRMED), listing refusals at the end.",
        permission: "purchase-invoices:update",
        sideEffects: "Posts purchase + accounts payable to the ledger and may auto-receive matched unreceived PO lines.",
      },
      { label: "Export", kind: "button", does: "Grid export: Listing → Excel / CSV, or Detail Listing per line." },
      { label: "View", kind: "row-action", does: "Right-click menu: opens the invoice page." },
      { label: "Print PI", kind: "row-action", does: "Right-click menu: prints the invoice PDF under the supplier's purchase-company letterhead." },
      {
        label: "Confirm",
        kind: "row-action",
        does: "Right-click menu (DRAFT only): sets CONFIRMED.",
        permission: "purchase-invoices:update",
        sideEffects: "Posts to the general ledger; matched unreceived PO lines are stocked in through a system GRN.",
      },
      {
        label: "Mark Paid",
        kind: "row-action",
        does: "Right-click menu (CONFIRMED only): sets PAID. A foreign-currency invoice first asks for the payment-day rate.",
        permission: "purchase-invoices:update",
        sideEffects: "For a foreign invoice the exchange difference is posted to the FX accounts.",
      },
      { label: "Refresh", kind: "row-action", does: "Right-click menu: reloads the list." },
    ],
    detail: "full",
    keywords: ["purchase invoice", "supplier invoice", "PI", "供应商发票", "采购发票", "进货发票", "invois pembekal", "invois belian"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/pi/create",
    title: "New Purchase Invoice",
    purpose:
      "Enter a supplier invoice, normally converted from a GRN or PO. Saved as DRAFT; confirm it on the invoice page to post it.",
    sidebar: "PROCUREMENT → Purchase Invoice → Create Invoice (or Convert to Invoice on a posted GRN / Create Invoice on a PO)",
    sections: ["New Purchase Invoice", "Invoice Details", "Summary", "Invoice Items"],
    actions: [
      { label: "Convert from GR or PO", kind: "button", does: "Opens the convert window (Goods Receipts (GRN) / Purchase Orders tabs): pick a document, tick the lines on this invoice, add them. Fills supplier, purchase company and lines. Reads Add another PO once lines exist." },
      { label: "Add line", kind: "button", does: "Adds an empty invoice line (description, code, qty, unit price, SST)." },
      {
        label: "Create Invoice",
        kind: "button",
        does: "Saves the invoice (POST /api/purchase-invoices) as DRAFT with a PI number. Requires a supplier and at least one line with a description; a future invoice date or a duplicate supplier invoice / DO number is refused.",
        permission: "purchase-invoices:create",
        sideEffects: "Nothing is posted yet — Confirm on the invoice page posts it.",
      },
      { label: "Open invoice", kind: "button", does: "After saving from a GRN / PO: the prompt offers to go back to the source or open the new invoice." },
      { label: "Cancel", kind: "button", does: "Leaves without saving." },
    ],
    detail: "full",
    keywords: ["new purchase invoice", "enter supplier bill", "录发票", "新建采购发票", "供应商账单", "invois pembekal baru", "bil pembekal"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/procurement/pi/:id",
    title: "Purchase Invoice detail",
    purpose: "One supplier invoice: details, items and linked documents; confirm, mark paid, edit, void, return or delete.",
    sidebar: "PROCUREMENT → Purchase Invoice, then double-click an invoice.",
    sections: ["Invoice Details", "Document Lineage", "Edit Invoice"],
    actions: [
      { label: "Confirm", kind: "button", does: "DRAFT invoices: sets CONFIRMED (PUT /api/purchase-invoices/:id).", permission: "purchase-invoices:update", sideEffects: "Posts purchase + accounts payable to the ledger; matched unreceived PO lines are auto-received." },
      { label: "Mark Paid", kind: "button", does: "CONFIRMED invoices: sets PAID.", permission: "purchase-invoices:update" },
      { label: "Edit", kind: "button", does: "Edit the invoice (DRAFT or CONFIRMED only), then Save Changes. A confirmed invoice's ledger is corrected by a correction entry.", permission: "purchase-invoices:update" },
      { label: "Void", kind: "button", does: "Cancels a posted, unpaid invoice (POST /api/purchase-invoices/:id/void). Finance / Admin / Super Admin role only.", sideEffects: "Reverses the ledger posting; does not undo an auto receipt." },
      { label: "Restore", kind: "button", does: "Brings a voided invoice back. Same role gate as Void." },
      { label: "Create Purchase Return", kind: "button", does: "Opens Purchase Returns with this invoice preselected.", permission: "purchase-returns:create" },
      { label: "View source document", kind: "button", does: "Opens the scanned source PDF in a new tab (invoices created from a scan)." },
      { label: "Print", kind: "button", does: "Prints the invoice PDF." },
      { label: "Delete", kind: "button", does: "DRAFT invoices only: deletes the invoice.", permission: "purchase-invoices:delete", sideEffects: "Cannot be undone." },
    ],
    detail: "basic",
    keywords: ["purchase invoice detail", "confirm PI", "void PI", "发票详情", "确认发票", "作废发票", "butiran invois belian"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/purchase-returns",
    title: "Purchase Returns",
    purpose:
      "Return goods to a supplier from a purchase invoice (or a goods receipt): create the return, remove the goods from stock, then issue the supplier Debit Note.",
    sidebar: "PROCUREMENT → Purchase Return",
    sections: ["Purchase Returns", "New Purchase Return"],
    actions: [
      { label: "New Purchase Return", kind: "button", does: "Opens the form: pick the purchase invoice, tick lines and quantities, Resolution (Supplier refund / Credit against next PI), Reason, Notes; Create return saves it as OPEN (POST /api/purchase-returns).", permission: "purchase-returns:create" },
      {
        label: "Confirm (remove stock)",
        kind: "button",
        does: "OPEN returns: after a confirm, removes the returned goods from stock (POST /api/purchase-returns/:id/confirm).",
        permission: "purchase-returns:update",
        sideEffects: "Reverses inventory (FIFO).",
      },
      {
        label: "Issue Debit Note",
        kind: "button",
        does: "Stock-removed returns from an invoice: issues the supplier Debit Note (POST /api/purchase-returns/:id/issue-dn).",
        permission: "purchase-returns:update",
        sideEffects: "Reduces accounts payable to the supplier and posts a GL journal.",
      },
      { label: "Delete purchase return", kind: "row-action", does: "Trash icon on an OPEN return: deletes it after a confirm.", permission: "purchase-returns:delete" },
    ],
    detail: "basic",
    keywords: ["purchase return", "return to supplier", "debit note", "退货给供应商", "采购退货", "退货", "pulangan belian", "pulang kepada pembekal", "nota debit"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/suppliers/:id",
    title: "Supplier scorecard",
    purpose:
      "One supplier: info, delivery KPIs, the materials it supplies with prices (SKU mappings), price history and the last 10 purchase orders.",
    sidebar: "PROCUREMENT → Suppliers, then right-click a supplier → View Scorecard.",
    sections: ["Supplier Info", "Price History", "Last 10 Purchase Orders"],
    actions: [
      { label: "Quotation PDF", kind: "button", does: "Builds a PDF of all the supplier's bound materials and prices." },
      { label: "Edit Supplier", kind: "button", does: "Opens the supplier form (PUT /api/suppliers/:id).", permission: "suppliers:update" },
      { label: "Add SKU Mapping", kind: "button", does: "Binds a material to this supplier with supplier code, price, lead time and MOQ (POST /api/supplier-materials).", permission: "supplier-materials:create" },
      { label: "Price History", kind: "tab", does: "Shows past PO line prices for this supplier." },
    ],
    detail: "basic",
    keywords: ["supplier detail", "supplier scorecard", "supplier price", "供应商详情", "供应商价格", "供应商评分", "butiran pembekal", "harga pembekal"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/inventory",
    title: "Inventory",
    purpose:
      "Stock on hand in three tabs: Finished Products (available, on draft DO, cost, value, FIFO age), WIP (completed work-in-progress pieces) and Raw Materials. Click a row for the stock breakdown; double-click to edit. Also creates / imports / exports products and raw materials.",
    sidebar: "WAREHOUSE → Inventory",
    sections: ["Inventory", "Finished Products", "WIP", "Raw Materials", "Total SKUs", "Bedframe SKUs", "Sofa SKUs", "Total Materials", "Zero Stock"],
    actions: [
      { label: "Finished Products", kind: "tab", does: "Finished-goods SKUs with stock, cost and value." },
      { label: "WIP", kind: "tab", does: "Work-in-progress pieces; click for the breakdown, double-click for the production detail (job cards)." },
      { label: "Raw Materials", kind: "tab", does: "Raw materials with stock qty; filter by category." },
      { label: "Batch Import", kind: "button", does: "Finished Products tab: import an Excel of products (POST /api/products/bulk-import). Raw Materials tab: import raw materials (POST /api/raw-materials/bulk-import).", permission: "products:create", sideEffects: "Creates or updates products / raw materials (needs create or update on that resource)." },
      { label: "Export", kind: "button", does: "Export (N): downloads the currently filtered rows as an Excel file in the import format." },
      { label: "Add FG", kind: "button", does: "Opens the Add Finished Product card: Single (one product) or Bulk generate (one product per size / compartment).", permission: "products:create" },
      { label: "Save Product", kind: "button", does: "Add card: creates the product (POST /api/products). Edit dialog: saves changes (PUT /api/products/:id).", permission: "products:create" },
      { label: "Generate", kind: "button", does: "Bulk generate mode: creates each previewed variant (POST /api/products each), skipping codes that exist, and copies the chosen default BOM template onto each.", permission: "products:create", sideEffects: "Creates several products at once." },
      { label: "Batch Edit", kind: "button", does: "Raw Materials tab: grid editor for many raw materials (Fill / Clear helpers), saving each changed row (PUT /api/raw-materials/:id).", permission: "raw-materials:update" },
      { label: "RM Settings", kind: "button", does: "Per-category material variants, extra units, default sheet size and whole-number units — saved to the shared variants config." },
      { label: "Add RM", kind: "button", does: "Opens the Add Raw Material card; Save Material creates it (POST /api/raw-materials).", permission: "raw-materials:create" },
      { label: "Save Material", kind: "button", does: "Creates the raw material.", permission: "raw-materials:create" },
      { label: "Stock breakdown", kind: "link", does: "In the raw-material edit dialog: opens the stock breakdown drawer (where the stock sits / source batches)." },
      { label: "Save", kind: "button", does: "Raw-material edit dialog: saves the material (PUT /api/raw-materials/:id).", permission: "raw-materials:update" },
      { label: "Delete", kind: "button", does: "Raw-material edit dialog: deletes the material after a confirm; refused while still in use. FG right-click Delete removes the product (DELETE /api/products/:id).", permission: "raw-materials:delete", sideEffects: "Cannot be undone." },
      { label: "Edit", kind: "row-action", does: "Right-click menu (Finished Products / Raw Materials): opens the edit dialog." },
      { label: "View", kind: "row-action", does: "Right-click menu (WIP): opens the WIP production detail." },
      { label: "Refresh", kind: "row-action", does: "Right-click menu: reloads the page data." },
      { label: "Close", kind: "button", does: "Closes the WIP detail." },
    ],
    detail: "full",
    keywords: ["inventory", "stock on hand", "raw material", "finished goods", "库存", "存货", "原料", "成品", "stok", "inventori", "bahan mentah"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/inventory/fabrics",
    title: "Fabric Tracking",
    purpose:
      "Fabric inventory: per fabric code its price tiers, stock on hand (SOH), PO outstanding, last 30 days used and shortage.",
    sidebar: "WAREHOUSE → Fabrics",
    sections: ["Fabric Tracking", "Fabric Inventory"],
    actions: [
      { label: "Edit", kind: "button", does: "Lets you change each fabric's Sofa / Bedframe price tier in the grid." },
      { label: "Save", kind: "button", does: "Saves the changed tiers (PUT /api/fabric-tracking/:id per changed row).", permission: "fabric-tracking:update" },
      { label: "Cancel", kind: "button", does: "Discards tier edits." },
    ],
    detail: "basic",
    keywords: ["fabric", "fabric stock", "布料", "布库存", "面料", "kain", "stok kain"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/inventory/stock-value",
    title: "Monthly Stock Value",
    purpose:
      "Month-end stock account valuation (AutoCount 330-xxxx series): enter physical counts, calculate and post the month, view trend and reports.",
    sidebar: "WAREHOUSE → Stock Value",
    sections: ["Monthly Stock Value", "Stock Value Entry", "Dashboard", "Reports", "Stock Value Trend", "Monthly Stock Value Summary"],
    actions: [
      { label: "Initialize Month", kind: "button", does: "Creates the month's stock-value entries (POST /api/stock-value).", permission: "stock-value:create" },
      { label: "Edit Counts", kind: "button", does: "Makes the Physical Count cells editable; Save commits changed rows (PUT /api/stock-value/:id).", permission: "stock-value:update" },
      { label: "Calculate & Post", kind: "button", does: "Posts every DRAFT entry of the month.", permission: "stock-value:update" },
      { label: "Reopen Period", kind: "button", does: "After a confirm, returns all POSTED entries of the month to DRAFT.", permission: "stock-value:update" },
      { label: "Export CSV", kind: "button", does: "Reports tab: downloads the summary as CSV." },
    ],
    detail: "basic",
    keywords: ["stock value", "month end stock", "库存价值", "月结库存", "nilai stok", "stok akhir bulan"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/inventory/adjustments",
    title: "Stock Adjustments",
    purpose:
      "Correct on-hand quantities for RM / WIP / FG in a multi-row batch; each row posts its own stock + cost-ledger entry. History of past adjustments below.",
    sidebar: "WAREHOUSE → Stock Adjustments",
    sections: ["Stock Adjustments", "Adjustment History"],
    actions: [
      { label: "Add Row", kind: "button", does: "Adds a blank row: Type, Category, Item, Dir (+ In / − Out), Qty, Unit Cost, Reason, Notes." },
      {
        label: "Submit All",
        kind: "button",
        does: "Posts every complete row (item, qty above 0, reason) in parallel (POST /api/stock-adjustments each). Saved rows are cleared; failed rows stay red with the reason.",
        permission: "inventory:create",
        sideEffects: "Moves stock and posts the cost impact for each row.",
      },
      { label: "Duplicate row", kind: "button", does: "Copies the row." },
      { label: "Remove row", kind: "button", does: "Deletes the row from the batch (nothing posted)." },
      { label: "+ In", kind: "filter", does: "Dir choice: adds stock." },
      { label: "− Out", kind: "filter", does: "Dir choice: removes stock." },
    ],
    detail: "full",
    keywords: ["stock adjustment", "adjust stock", "write off", "库存调整", "调整库存", "报废", "pelarasan stok", "laras stok", "hapus kira"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/inventory/stock-take",
    title: "Stock Take",
    purpose:
      "Month-end physical count in quantities: download a blank count sheet, import the filled sheet for the month, read usage. Does not change system stock or post money.",
    sidebar: "WAREHOUSE → Stock Take",
    sections: ["Counted quantities", "Types"],
    actions: [
      { label: "Download count sheet (Excel)", kind: "button", does: "Downloads a blank count sheet per ticked type." },
      { label: "Import filled sheet", kind: "button", does: "Reads a filled count sheet (.xlsx / .xls / .csv).", permission: "inventory:create" },
      { label: "Save count for", kind: "button", does: "Saves the imported count for the month (POST /api/stock-count/count); confirm Replace if one exists.", permission: "inventory:create" },
      { label: "Download for Finance", kind: "button", does: "Downloads the file Accounting's stock take imports." },
      { label: "Export usage (Excel)", kind: "button", does: "Downloads the usage table." },
      { label: "Only rows to check", kind: "toggle", does: "Shows only rows with negative usage or unit questions." },
      { label: "Counted types", kind: "button", does: "Re-ticks the types Finance counts at month end." },
    ],
    detail: "basic",
    keywords: ["stock take", "stock count", "physical count", "盘点", "月底盘点", "点货", "kira stok", "stok fizikal"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/warehouse",
    title: "Warehouse",
    purpose: "Rack location management: rack grid with occupancy, stock in / out to racks, item and rack QR codes, movement history.",
    sidebar: "WAREHOUSE → Warehouse",
    sections: ["Rack Overview", "Stock In/Out", "Movement History", "Rack Grid Layout", "Recent Movements", "Full Movement History"],
    actions: [
      { label: "Create Rack", kind: "button", does: "Creates a rack (POST /api/warehouse/racks).", permission: "warehouse:create" },
      { label: "Create Item QR", kind: "button", does: "Opens the Create Item QR form to print an item QR label." },
      { label: "Download all rack QRs", kind: "button", does: "Downloads QR labels for every rack." },
      { label: "Refresh", kind: "button", does: "Reloads racks and movements." },
      { label: "Confirm Stock In", kind: "button", does: "Stock In/Out tab: puts an item into a rack slot and logs the movement (POST /api/warehouse/movements).", permission: "warehouse:create" },
      { label: "Confirm Stock Out", kind: "button", does: "Stock In/Out tab: takes an item out of a rack and logs the movement.", permission: "warehouse:create" },
    ],
    detail: "basic",
    keywords: ["warehouse", "rack", "location", "仓库", "货架", "库位", "gudang", "rak", "lokasi stok"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    path: "/planning/mrp",
    title: "MRP · Raw Material Stock Status",
    purpose:
      "Material requirements: for every raw material, what open production orders need vs stock and open POs, the shortage, need-by date and supplier. Tick short lines and raise purchase orders for them in one step.",
    sidebar: "PROCUREMENT → MRP",
    sections: ["MRP · Raw Material Stock Status", "Needed", "Stock", "PO Outstanding", "Short", "Need-by", "Main supplier"],
    actions: [
      { label: "COMBINED", kind: "toggle", does: "PO mode: one PO per supplier." },
      { label: "PER SO", kind: "toggle", does: "PO mode: one PO per supplier per order." },
      { label: "COLLAPSE", kind: "button", does: "Collapses all material rows." },
      { label: "EXPAND", kind: "button", does: "Expands all material rows to their production-order lines." },
      { label: "REFRESH", kind: "button", does: "Recalculates the plan (GET /api/mrp/plan); the time shows next to it (as of …)." },
      { label: "LEAD TIMES", kind: "button", does: "Opens the Lead times window: days from PO to receipt per supplier; Save stores them (PUT /api/mrp/lead-times). A lead time on the supplier's material price wins.", permission: "mrp:create" },
      {
        label: "Proceed PO",
        kind: "button",
        does: "Opens the Proceed PO window for the ticked lines (optional expected delivery date); Confirm calls POST /api/mrp/proceed-po and lists the new PO numbers (Open Purchase Orders / Stay here).",
        permission: "purchase-orders:create",
        sideEffects: "Creates CONFIRMED POs immediately, all or none; new supplier bindings are saved. Refused (refresh first) if the plan changed since it was calculated. POs are not emailed.",
      },
      { label: "Refresh now", kind: "button", does: "Shown when the plan changed: recalculates; nothing was ordered." },
      { label: "Need-by date", kind: "filter", does: "DATE choice (Need-by / Customer due date / SO date) with FROM / TO range." },
      { label: "SHOW NO-DATE", kind: "toggle", does: "Includes lines with no date." },
      { label: "ONLY SHORTAGES", kind: "toggle", does: "Shows only short materials." },
      { label: "EXPORT ALL", kind: "button", does: "Excel export of all rows in the date window." },
      { label: "EXPORT CURRENT TAB", kind: "button", does: "Excel export of the current material tab." },
      { label: "WRAP", kind: "toggle", does: "Wraps long text in cells." },
      { label: "FILTERS", kind: "button", does: "Shows per-column filter boxes." },
      { label: "Columns", kind: "button", does: "Show / hide columns (Show all, Done)." },
      { label: "— choose supplier —", kind: "filter", does: "Supplier picker on a short line; Other supplier… (will be bound) binds a new supplier to the material." },
    ],
    detail: "full",
    keywords: ["MRP", "material shortage", "what to order", "缺料", "物料需求", "缺料开PO", "kekurangan bahan", "keperluan bahan mentah"],
  },
];
