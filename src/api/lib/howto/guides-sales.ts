// ---------------------------------------------------------------------------
// howto/guides-sales.ts — "how do I…" guides for the sales chain:
// sales order → delivery order → invoice → customer receipt, plus delivery
// returns and printing. Written from the real frontend + API code
// (src/pages/sales, delivery, invoices, delivery-returns, accounting;
// src/api/routes/sales-orders.ts, delivery-orders.ts, invoices.ts,
// payments.ts, delivery-returns.ts). See ./types.ts for the writing rules.
// ---------------------------------------------------------------------------
import type { HowToGuide } from "./types";

export const GUIDES: HowToGuide[] = [
  // -------------------------------------------------------------------------
  {
    id: "create-sales-order",
    title: "Create a sales order",
    keywords: [
      "sales order", "create sales order", "new sales order", "SO", "new SO", "customer order", "book order",
      "开单", "销售单", "开销售单", "新订单", "下单", "客户订单",
      "pesanan jualan", "buat pesanan", "pesanan baru", "order jualan",
    ],
    module: "Sales",
    purpose:
      "Record a customer's order in the ERP. Saving it as a draft keeps it editable; creating it confirms the order, checks every product has a complete BOM and releases the production orders so the factory starts work.",
    prerequisites: [
      // src/api/routes/sales-orders.ts:1799 — "Customer not found"; :1807 assertCustomerBillable rejects a POTENTIAL (pipeline) customer
      "The customer exists under SALES & CUSTOMERS → Customers and is a confirmed (billable) customer, not a Sales Pipeline prospect.",
      // src/api/routes/sales-orders.ts:2608 — confirm refuses an order with no delivery hub
      "The customer has at least one delivery hub set up (an order without a hub can be saved as a draft but cannot be confirmed).",
      // src/api/routes/sales-orders.ts:2723-2729 — confirm returns 422 when any product's BOM is incomplete
      "Every product you will sell exists under PRODUCTS & BOM → Products, and has a complete BOM if you want to confirm the order straight away.",
      // src/pages/sales/create.tsx:1800 — save blocked when a line has no fabric
      "The fabric code for each line exists.",
    ],
    who: "Sales admin / sales coordinator",
    // src/api/routes/sales-orders.ts:1773 (POST create) and :2567 (POST /:id/confirm)
    permission: ["sales-orders:create", "sales-orders:confirm"],
    companies: ["ALL"],
    variants: [
      {
        // src/pages/consignment/index.tsx:629, :517; src/pages/consignment/note.tsx:2919, :2926; src/api/routes/delivery-orders/_helpers.ts:2739
        case: "Goods placed with the customer on consignment (paid only when sold)",
        differences: [
          "Do not create a sales order. Use SALES & CUSTOMERS → Consignment → Consignment Order and click \"New Consignment Order\" (permission consignments:create).",
          "Goods leave on a Consignment Note (\"Create Consignment Note\"), not a delivery order — a delivery order refuses consignment production orders.",
          "Sold pieces are billed from the note with \"Transfer to Sales Invoice\"; unsold pieces come back with \"Transfer to Consignment Return\".",
        ],
      },
      {
        // src/pages/sales/create.tsx:2152-2156 (hub auto-pick), :2187 (hub picker); src/api/routes/sales-orders.ts:2608
        case: "Customer with more than one delivery hub",
        differences: [
          "\"Delivery Hub *\" is not filled for you — pick the hub this order ships to; with one hub it is filled and shown read-only.",
          "Each hub needs its own order if the goods go to different hubs, because one delivery order can only go to one hub.",
        ],
      },
      {
        // src/pages/sales/create.tsx:1006 — customer price list first, product master as fallback; :1775 customer-specific combo
        case: "Customer with its own price list or combo prices",
        differences: [
          "\"Base Price (RM)\" fills from that customer's price list first and only falls back to the product's master price.",
          "A sofa set that matches a combo shows a \"Combo discount\" line in the Summary; a customer-only combo is marked \"customer-specific\".",
        ],
      },
      {
        // src/pages/sales/create.tsx:2164 — company pre-filled from customer's defaultCompanyCode; src/api/routes/sales-orders.ts:2406 resolveCompanyCode
        case: "Order booked under a sister company (e.g. OHANA)",
        differences: [
          "Pick the company in \"Company\" (pre-filled from the customer's default company). It records which company the order is under; the rest of the flow is the same.",
        ],
      },
      {
        // src/lib/so-mode.ts:47; src/pages/sales/create.tsx:2104-2110 ("Copy from SO/CO"); src/api/routes/sales-orders.ts:2656 (PO uniqueness exempt)
        case: "Aftersales / repair order (service order)",
        differences: [
          "Use QUALITY → Service Order and click \"New Service Order\"; fill it with \"Copy from SO/CO\" from the original order.",
          "Line prices default to 0, and the order may reuse the original customer PO number.",
        ],
      },
    ],
    page: "/sales",
    sidebar: "SALES & CUSTOMERS → Sales Orders",
    steps: [
      {
        do: "In the sidebar open SALES & CUSTOMERS → Sales Orders, then click \"New Sales Order\" at the top right.",
        page: "/sales",
        highlight: "New Sales Order",
        then: "The \"Create a new sales order for a customer\" form opens on /sales/create.",
      },
      {
        do: "Fill the \"Order Details\" card.",
        page: "/sales/create",
        highlight: "Order Details",
        fields: [
          // src/pages/sales/create.tsx:1798 save blocker; src/api/routes/sales-orders.ts:1799, :1807
          { label: "Customer *", required: true, value: "Pick from the list (shows code - name). Saving is blocked with \"Please select a customer\" if empty. Picking a customer pre-fills the hub (if it has only one) and the company.", example: "'C001 - Demo Furniture Sdn Bhd'" },
          { label: "Delivery Hub *", required: true, value: "Pick the hub the goods go to. Shown read-only when the customer has only one hub.", example: "'KL HQ'" },
          // src/api/routes/sales-orders.ts:1817-1830 duplicate ref → DRAFT + warning; :2677 confirm refuses duplicate customer PO
          { label: "Customer PO No.", required: false, value: "The customer's own purchase order number. If the same PO / SO number is already on another open order for this customer, the order is saved as a DRAFT with a warning instead of being confirmed.", example: "'PO-DEMO-2612-001'" },
          { label: "Customer SO No.", required: false, value: "The customer's own sales order number, if they give one.", example: "'SO-12345'" },
          { label: "Reference", required: false, value: "Free text reference.", example: "'Showroom display set'" },
          { label: "Company", required: false, value: "Which company the order is booked under. Defaults to HOOKKA or the customer's mapped company.", example: "'HOOKKA'" },
          { label: "Company SO Date", required: false, value: "Date picker (DD/MM/YYYY). The order date.", example: "'2026-12-01'" },
          // src/api/routes/sales-orders.ts:1789 normaliseBodyDates rejects unreadable dates
          { label: "Customer Delivery Date", required: false, value: "Date picker. The date the customer wants the goods. An unreadable date is refused by the server.", example: "'2026-12-20'" },
          // src/pages/sales/create.tsx:2251 maxLength 5000
          { label: "Notes", required: false, value: "Internal notes, up to 5000 characters.", example: "'Call before delivery'" },
        ],
        check: "The grey box under the fields shows the customer's \"Terms:\", \"Limit:\" and \"Outstanding:\" — confirm the customer is not over its credit limit before you continue.",
      },
      {
        do: "In the \"Line Items\" card fill the first line; click \"Add Item\" for each extra line.",
        page: "/sales/create",
        highlight: "Add Item",
        fields: [
          // src/pages/sales/create.tsx:1799
          { label: "Product *", required: true, value: "Search any product (code - name · category). Blocked with \"Please select a product for all line items\" if empty. For a sofa the label reads \"Module(s) *\" and you tick the modules instead.", example: "'BF-1001 - Demo Bedframe Queen · BEDFRAME'" },
          // src/pages/sales/create.tsx:1802-1804
          { label: "Model *", required: true, value: "Sofa lines only: pick the sofa model first. Blocked with \"Please select a model for all sofa items\".", example: "'MILAN'" },
          // src/pages/sales/create.tsx:1800
          { label: "Fabric *", required: true, value: "Pick the fabric code. Blocked with \"Please select a fabric for all line items\". Picking it can auto-fill the base price.", example: "'FAB-GREY-01'" },
          // src/pages/sales/create.tsx:1805-1807
          { label: "Seat Size *", required: true, value: "Sofa lines only. Blocked with \"Please select a seat size for all sofa items\".", example: "'24'" },
          // src/pages/sales/create.tsx:1815 findInvalidSofaQty; src/api/routes/sales-orders.ts:1946
          { label: "Qty", required: true, value: "Whole number. Sofa lines must stay at 1 unit per line (add another line for a second unit).", example: "'2'" },
          { label: "Base Price (RM)", required: true, value: "Unit price in RM, auto-filled from the price list when possible; type it if blank. Stored in sen, 2 decimals.", example: "'1250.00'" },
          { label: "Leg", required: false, value: "Leg option where offered; may add a surcharge.", example: "'Wooden leg'" },
          { label: "Divan Height", required: false, value: "Bedframe height option where offered.", example: "'12'" },
          { label: "Line Notes", required: false, value: "Notes for this line only.", example: "'Left-hand chaise'" },
        ],
        check: "Do not mix SOFA and BEDFRAME lines on one order — the system refuses it. Check the \"Summary\" card: \"Total Qty\", \"Subtotal\", any \"Combo discount\" and \"Total\".",
      },
      {
        do: "Click \"Save as Draft\" to keep it editable, or \"Create Order\" to confirm it now.",
        page: "/sales/create",
        highlight: "Create Order",
        check: "The note under \"Total\" says the status will be DRAFT or IN_PRODUCTION. Use \"Create Order\" only when prices, quantities and the delivery date are final.",
        then: "\"Save as Draft\" saves a DRAFT order and opens its page (toast \"Draft saved\"). \"Create Order\" saves and confirms in one go: the server checks the BOM of every product and, if complete, moves the order to IN_PRODUCTION and creates the production orders (toast \"Order created and in production\"). If a BOM is incomplete or another check fails, the order stays a DRAFT and you land on its page with the reason.",
      },
      {
        do: "For a draft order: open it from the Sales Orders list and click \"Confirm Order\" when it is ready.",
        page: "/sales/:id",
        highlight: "Confirm Order",
        then: "Same as \"Create Order\": BOM check, status IN_PRODUCTION, production orders released to PRODUCTION.",
      },
    ],
    checkBefore: [
      "Right customer and right delivery hub.",
      "Customer PO No. matches the customer's purchase order (no duplicate warning).",
      "Every line has product, fabric and price; sofa lines have model and seat size and qty 1.",
      "Total matches the customer's purchase order.",
      "Customer has credit headroom (\"Outstanding:\" vs \"Limit:\").",
    ],
    result:
      "A new sales order with an SO number appears in SALES & CUSTOMERS → Sales Orders. A confirmed order is IN_PRODUCTION and its production orders show in PRODUCTION → Production and in Delivery Order → \"Planning\".",
    warnings: [
      // src/pages/sales/create.tsx:1942-1950 — CONFIRMED path chains POST /:id/confirm (BOM guard + production cascade → IN_PRODUCTION)
      "\"Create Order\" releases production orders to the factory immediately — materials and labour start being committed.",
      // src/pages/sales/detail.tsx:1197-1201 canEdit; :761-763 canOverride = ADMIN / SUPER_ADMIN only
      "Once the first job card is close to its due date the order locks: the detail page shows \"Edit (locked)\" and only an ADMIN or SUPER_ADMIN can use \"Override Lock\" (a reason is required).",
      // src/api/routes/sales-orders.ts:1817-1830 — duplicate ref saves DRAFT + warning; src/pages/sales/create.tsx:1940-1941 skips auto-confirm; sales-orders.ts:2677 confirm refuses a duplicate customer PO
      "A duplicate customer PO / SO number never auto-confirms; it is left as a DRAFT, and a true duplicate customer PO can never be confirmed.",
      // src/api/routes/sales-orders.ts:1923 SO_MIXED_CATEGORY_ERROR; :1946 sofa qty > 1
      "The server refuses SOFA and BEDFRAME on one order, and a sofa line with qty above 1.",
      // src/api/routes/sales-orders.ts:1786 textCapError; :1789 normaliseBodyDates
      "Over-long text and unreadable dates are refused, never silently cut or blanked.",
    ],
    // src/pages/sales/detail.tsx:1470 (Delete only when DRAFT), :1202 canCancel, :1203 canHold, :828-829 canEditPrices; src/api/routes/sales-orders.ts:6174 (delete), :3327 (update)
    undo:
      "A DRAFT order can be changed with \"Edit\" or removed with \"Delete\" on its detail page (sales-orders:delete). A DRAFT, CONFIRMED or IN_PRODUCTION order can be cancelled with \"Cancel Order\" or paused with \"Put On Hold\" (a reason is required), both sales-orders:update; a cancelled order can be restored with \"Undo Cancel\". \"Edit Prices\" stays available until the order is invoiced or has a live invoice; anything else after the lock needs an admin's \"Override Lock\".",
    // src/api/routes/sales-orders.ts:2567 — separate sales-orders:confirm action; :2649 only DRAFT orders can be confirmed
    approvals: "No approval workflow in the system. Confirming is a separate permission (sales-orders:confirm) that can be given to a different role than create; only a DRAFT order can be confirmed.",
    // src/pages/sales/detail.tsx:1436-1446 — production_window lock: first job card due date within the 2-day cutoff
    deadlines: "Edits lock automatically when the first job card's due date is within the 2-day production cutoff.",
    commonMistakes: [
      { mistake: "Putting a sofa and a bedframe on the same order.", fix: "Create two sales orders, one per category." },
      { mistake: "Typing qty 2 on one sofa line.", fix: "Keep qty 1 and click \"Add Item\" for each extra sofa unit." },
      { mistake: "Clicking \"Create Order\" while a product has no complete BOM.", fix: "The order stays DRAFT. Ask the BOM owner to finish the BOM, then click \"Confirm Order\"." },
      { mistake: "Re-keying an order that was already scanned in.", fix: "Search the Sales Orders list by customer PO first; the duplicate warning means it probably exists." },
    ],
    workedExample:
      "Demo Furniture Sdn Bhd sends PO-DEMO-2612-001 for 2 queen bedframes in FAB-GREY-01 at RM 1,250 each. Sales admin opens New Sales Order, picks the customer (hub auto-fills), types the PO number, sets Customer Delivery Date 20/12/2026, adds one line BF-1001 qty 2, checks Total RM 2,500.00 and clicks Create Order. The order lands IN_PRODUCTION with its production orders released.",
    related: ["create-delivery-order", "create-invoice", "print-documents", "create-production-order"],
    nextStep: "When production finishes, create the delivery order (create-delivery-order).",
    contact: "Sales manager",
  },

  // -------------------------------------------------------------------------
  {
    id: "create-delivery-order",
    title: "Create a delivery order from a sales order",
    keywords: [
      "delivery order", "create DO", "new DO", "DO", "dispatch", "deliver", "packing list", "mark delivered",
      "送货单", "开送货单", "出货", "派送", "发货", "交货",
      "pesanan penghantaran", "buat DO", "penghantaran", "hantar barang",
    ],
    module: "Delivery",
    purpose:
      "Turn finished production orders of a sales order into a delivery order (DO), assign the transport, dispatch it and mark it delivered. A DO is never typed by hand — it is always built from production orders that are complete.",
    prerequisites: [
      // src/pages/delivery/index.tsx:5079-5103 — Pending Delivery grid lists ready production orders; src/api/routes/delivery-orders/_helpers.ts:2794 DO for an SO must come from its production orders
      "The sales order is confirmed (IN_PRODUCTION) and its production orders are complete — they show on the \"Pending Delivery\" tab.",
      // src/api/routes/delivery-orders/_helpers.ts:2506 — once-only delivery guard
      "The goods are not on another live delivery order (a production order can only be delivered once).",
      // src/api/routes/delivery-orders/_helpers.ts:3130-3138 — outstanding + DO value > credit limit → 409 "Credit limit exceeded"
      "The customer has credit headroom: current outstanding plus this DO's value must not exceed the customer's credit limit.",
      // src/api/routes/delivery-orders/_helpers.ts:2739 — consignment-order POs refused
      "Consignment orders are not delivered here — they use a Consignment Note.",
    ],
    who: "Logistics / delivery coordinator",
    // src/api/routes/delivery-orders.ts:2082 (POST create), :3345 (PUT — every status change)
    permission: ["delivery-orders:create", "delivery-orders:update"],
    companies: ["ALL"],
    variants: [
      {
        // src/api/routes/delivery-orders/_helpers.ts:2739; src/pages/consignment/note.tsx:4635, :3357
        case: "Consignment order",
        differences: [
          "Ship it from SALES & CUSTOMERS → Consignment → Consignment Note with \"Create Consignment Note\" (or \"Create Packing List\" there); a delivery order refuses consignment production orders.",
        ],
      },
      {
        // src/api/routes/delivery-orders/_helpers.ts:2573 (one customer), :2583 (one hub); src/api/routes/delivery-orders.ts:2106-2116 packing-list-first groups by customer + hub
        case: "Several customers, or one customer with goods for different hubs",
        differences: [
          "\"Create DO\" refuses a mix of customers or hubs. Tick all the rows and use \"Create Packing List\" instead: it makes one DO per customer per hub and puts them all on one packing list.",
          "With \"Create Packing List\" the credit limit is checked across all of a customer's DOs together and nothing is created if any check fails.",
        ],
      },
      {
        // src/pages/delivery/index.tsx:4537 QR — Driver Scan; src/components/delivery/do-qr-dialog.tsx:10-12
        case: "Driver confirms dispatch / delivery on the road",
        differences: [
          "Print \"QR — Driver Scan\" for the DO; the driver scans it with a phone camera (no login) to mark it dispatched or delivered — the same checks run as for an office click.",
        ],
      },
    ],
    page: "/delivery",
    sidebar: "SALES & CUSTOMERS → Delivery Order",
    steps: [
      {
        do: "In the sidebar open SALES & CUSTOMERS → Delivery Order and click the \"Pending Delivery\" tab.",
        page: "/delivery",
        highlight: "Pending Delivery",
        then: "The grid \"Production Complete — Ready for DO\" lists the finished production orders, grouped by state.",
      },
      {
        do: "Tick the checkbox of every production order row that goes on this delivery. Search the grid by SO number to find them quickly.",
        page: "/delivery",
        check: "All ticked rows must be for ONE customer and ONE delivery hub — otherwise the system refuses with \"A delivery order can only be for one customer\". To ship several customers at once, use \"Create Packing List\" instead, which splits into one DO per customer and hub.",
      },
      {
        do: "Click \"Create DO\" (it shows the number of ticked rows). The \"Create Delivery Order\" dialog opens.",
        page: "/delivery",
        highlight: "Create DO",
        fields: [
          { label: "3PL Provider", required: false, value: "Pick the transport company from the active providers. Can be left blank and set later.", example: "'Demo Logistics Sdn Bhd'" },
          { label: "Vehicle", required: false, value: "Enabled after a provider is picked; lists that provider's vehicles.", example: "'WXY 1234'" },
          { label: "Driver", required: false, value: "Enabled after a provider is picked; lists that provider's drivers.", example: "'Ali'" },
          { label: "Delivery Destinations", required: true, value: "One block per drop; pick the hub for each drop from the customer's hubs (pre-selected). Drag to reorder drops.", example: "'KL HQ'" },
          { label: "Delivery Date", required: false, value: "Date picker, the planned delivery day.", example: "'2026-12-18'" },
          { label: "Remarks", required: false, value: "Free text printed for the driver / customer.", example: "'Deliver after 10am'" },
        ],
        check: "Check \"Est. Delivery Cost\" and that each drop's hub is right.",
      },
      {
        do: "Click \"Create DO\" at the bottom of the dialog.",
        page: "/delivery",
        highlight: "Create DO",
        then: "A DRAFT delivery order with a new DO number is created and shows on the \"Pending Dispatch\" tab. No stock moves yet. The sales order is stamped with the DO number.",
      },
      {
        do: "When the lorry is loaded: on the \"Pending Dispatch\" tab right-click the DO row and choose \"Mark Dispatched\".",
        page: "/delivery",
        highlight: "Mark Dispatched",
        check: "Only a DRAFT DO can be dispatched. Make sure everything on the DO is physically on the lorry.",
        then: "The DO moves to the \"Dispatched\" tab (status LOADED); finished-goods stock is taken out, the sales order moves to SHIPPED, and a dispatch email with the DO PDF goes to the customer if the customer has an email.",
      },
      {
        do: "After the customer receives the goods: on the \"Dispatched\" tab right-click the DO row and choose \"Mark Delivered\" (optionally \"Mark Out for Delivery (In Transit)\" first). Drivers can do the same by scanning the DO QR.",
        page: "/delivery",
        highlight: "Mark Delivered",
        then: "The DO becomes DELIVERED and moves to the \"Delivered\" tab; cost of goods sold is posted, the sales order is updated, and an invoice is created automatically (already posted, status SENT) and emailed to the customer with the invoice PDF. A warning appears if the customer has no email on file.",
      },
    ],
    checkBefore: [
      "Only one customer and one hub in the selection.",
      "Quantities on the DO match what is physically loaded.",
      "Transport company, vehicle and driver are right (they print on the DO).",
      "Customer email is on file if they should receive the dispatch / invoice email.",
    ],
    result:
      "A delivery order exists on SALES & CUSTOMERS → Delivery Order; it moves through \"Pending Dispatch\" → \"Dispatched\" → \"Delivered\". On delivery the invoice is auto-created and appears on SALES & CUSTOMERS → Invoices.",
    warnings: [
      // src/api/routes/delivery-orders/_helpers.ts:4753-4756 — STOCK_OUT on dispatch + SO SHIPPED cascade; src/pages/delivery/index.tsx:4575 dispatch notice email
      "\"Mark Dispatched\" takes finished goods out of stock and emails the customer.",
      // src/api/routes/delivery-orders/_helpers.ts:4756 (FIFO COGS + auto-invoice), :2162-2165 (auto-invoice created already SENT)
      "\"Mark Delivered\" posts cost of goods sold, creates and posts the invoice (customer outstanding goes up) and emails it to the customer.",
      // src/api/routes/delivery-orders/_helpers.ts:2506
      "A production order can be on only one live DO; the system refuses duplicates.",
      // src/api/routes/delivery-orders/_helpers.ts:3138
      "A DO over the customer's credit limit is refused (\"Credit limit exceeded\").",
      // src/api/routes/delivery-orders/_helpers.ts:117-130 VALID_TRANSITIONS; src/pages/delivery/index.tsx:4581 (dispatch only from DRAFT), :4664 (deliver only from LOADED / IN_TRANSIT)
      "Status only moves DRAFT → LOADED (dispatched) → IN_TRANSIT → DELIVERED → INVOICED; any other jump is refused.",
    ],
    // src/api/routes/delivery-orders.ts:3379 (delete DRAFT only), :2963-3040 reverse-to-dispatched refusals, :3058 invoices:void; src/api/routes/delivery-orders/_helpers.ts:1209 (cancel blocked by live invoice), :1230 (cancel blocked by delivery return)
    undo:
      "A DRAFT DO can be deleted (delivery-orders:delete). A dispatched DO can be sent back with \"Reverse to Pending Dispatch\". A DO marked delivered by mistake can be undone with \"Reverse to Dispatched\" — it voids the unpaid auto-invoice too, and is refused if a payment, an issued credit / debit note, a delivery return or an e-invoice already submitted to LHDN exists. Any live DO can be cancelled with \"Cancel Delivery Order\" (cancelling a DO whose invoice is still live needs invoices:void, and the invoice must be voided first). The freed production orders can then go on a new DO.",
    commonMistakes: [
      { mistake: "Ticking rows for two customers and clicking \"Create DO\".", fix: "Create one DO per customer, or use \"Create Packing List\", which splits automatically." },
      { mistake: "Clicking \"Mark Delivered\" before the customer actually received the goods.", fix: "Use \"Reverse to Dispatched\" straight away, before any payment is recorded." },
      { mistake: "Looking for a manual DO button to type items.", fix: "There is none — DOs come only from completed production orders on \"Pending Delivery\"." },
    ],
    workedExample:
      "Sales order for Demo Furniture Sdn Bhd (2 queen bedframes) has finished production. Logistics opens Delivery Order → Pending Delivery, ticks the 2 rows, clicks Create DO, picks Demo Logistics Sdn Bhd, lorry WXY 1234, driver Ali, delivery date 18/12/2026, and clicks Create DO. Next morning they right-click the DO → Mark Dispatched; after the customer signs, Mark Delivered — the invoice is created and emailed automatically.",
    related: ["create-sales-order", "create-invoice", "print-documents", "delivery-return"],
    nextStep: "Check the auto-created invoice (create-invoice), then collect payment (record-customer-payment).",
    contact: "Logistics supervisor",
  },

  // -------------------------------------------------------------------------
  {
    id: "create-invoice",
    title: "Create an invoice from a delivery order",
    keywords: [
      "invoice", "create invoice", "new invoice", "sales invoice", "billing", "bill customer", "transfer to invoice",
      "发票", "开发票", "开票", "开单据", "账单",
      "invois", "buat invois", "invois jualan", "bil",
    ],
    module: "Invoices",
    purpose:
      "Bill the customer for goods that were delivered. Normally the invoice is created automatically when a DO is marked delivered; use this when it was not (for example a delivery marked delivered with issues, a partial bill, or an invoice that was voided and must be re-raised).",
    prerequisites: [
      // src/api/routes/invoices.ts:1840-1844 — refuses a DO that is not DELIVERED
      "The delivery order is DELIVERED — the server refuses any other status (\"Only DELIVERED delivery orders can be invoiced\").",
      // src/api/routes/invoices.ts:1948 (nothing left to invoice), :2122 (invoice already exists for the DO)
      "The DO still has un-invoiced lines (an invoice cannot bill the same goods twice).",
    ],
    who: "Account / billing clerk",
    // src/api/routes/invoices.ts:1775 (POST create), :2502 (DRAFT → SENT needs invoices:post)
    permission: ["invoices:create", "invoices:post"],
    companies: ["ALL"],
    variants: [
      {
        // src/pages/consignment/note.tsx:2919, :4604, :5032
        case: "Consignment goods that the customer has sold",
        differences: [
          "Bill from SALES & CUSTOMERS → Consignment → Consignment Note: right-click the note and choose \"Transfer to Sales Invoice\" (or \"Convert to Sales Invoice\" on the note), not from a delivery order.",
        ],
      },
      {
        // src/api/routes/delivery-orders/_helpers.ts:4137-4140 — delivered-with-issues withholds the auto-invoice until resolved (POST /:id/resolve-incomplete)
        case: "DO delivered with issues (driver scan)",
        differences: [
          "No invoice is auto-created; it is created once the office resolves the delivery, or you raise it by hand with \"Transfer to Invoice\" after resolving.",
        ],
      },
    ],
    page: "/invoices",
    sidebar: "SALES & CUSTOMERS → Invoices",
    steps: [
      {
        do: "First check whether the invoice already exists: open SALES & CUSTOMERS → Invoices and search by DO number or customer.",
        page: "/invoices",
        then: "If an invoice with that DO No is listed (status \"Sent\"), it was auto-created on delivery — skip to the last step.",
      },
      {
        do: "Option A (from the Invoices page): click \"New Invoice\".",
        page: "/invoices",
        highlight: "New Invoice",
        fields: [
          { label: "Select Delivery Order", required: true, value: "Pick the DO (shows DO number - customer). The button stays disabled until one is picked.", example: "'DO-2612-015 - Demo Furniture Sdn Bhd'" },
        ],
        then: "Click \"Create Invoice\". The whole un-invoiced remainder of the DO is billed and you land on the new invoice's page.",
      },
      {
        do: "Option B (from the delivery order, lets you bill only some lines): open SALES & CUSTOMERS → Delivery Order, tab \"Delivered\", right-click the DO row and choose \"Transfer to Invoice\".",
        page: "/delivery",
        highlight: "Transfer to Invoice",
        fields: [
          { label: "Lines to invoice", required: true, value: "Each line is pre-filled with the quantity still un-invoiced. Lower a quantity to bill part now and the rest later; a line already fully billed is greyed out.", example: "'2'" },
        ],
        check: "In the \"Transfer to Sales Invoice\" dialog check DO Number, Customer and Items.",
        then: "Click \"Create Invoice\". Toast \"Invoice generated\"; the DO moves to INVOICED when its last line is billed (a partial bill leaves it DELIVERED).",
      },
      {
        do: "On the invoice page check the lines and prices, then click \"Send Invoice\" (shown only while the invoice is a draft).",
        page: "/invoices/:id",
        highlight: "Send Invoice",
        check: "Fix wrong prices first with \"Edit Prices\" — after posting and payment, changes need a credit or debit note.",
        then: "The invoice becomes SENT (posted): its ledger entries are written. \"Send Invoice\" does not email; to email the PDF tick the invoice on the list and click \"Email to Customer\".",
      },
    ],
    checkBefore: [
      "The DO is DELIVERED and no other live invoice already bills the same lines.",
      "Customer, quantities and unit prices match the sales order / customer PO.",
      "Due date follows the customer's credit terms.",
    ],
    result:
      "The invoice appears on SALES & CUSTOMERS → Invoices; the customer's outstanding balance goes up and the invoice shows in FINANCE → Debtors → Debtor Aging. The DO shows INVOICED once fully billed.",
    warnings: [
      // src/api/routes/invoices.ts:2069 — outstandingSen bumped at create (manual invoice starts DRAFT, :2018); :3143-3148 DRAFT → SENT writes the ledger legs
      "Creating the invoice raises the customer's outstanding balance; \"Send Invoice\" posts it to the ledger.",
      // src/pages/invoices/index.tsx:914-920 — Email to Customer finalises drafts and emails each customer
      "\"Email to Customer\" sends the PDF to the customer — check it first.",
      // src/api/routes/invoices.ts:2463-2479 — checkInvoiceLocked: field edits refused (403) once a payment is recorded
      "Once a payment is recorded the invoice is locked; corrections go through a credit or debit note.",
      // src/api/routes/invoices.ts:326-331 INV_VALID_TRANSITIONS — DRAFT → SENT → PARTIAL_PAID / PAID / OVERDUE; PAID is final
      "Status only moves DRAFT → SENT → PARTIAL_PAID / OVERDUE → PAID; a PAID invoice cannot change status any more.",
    ],
    // src/api/routes/invoices.ts:3316-3319 (delete DRAFT only), :2506 (void needs invoices:void), :2510-2513 (void refused while a credit / debit note is issued)
    undo:
      "A DRAFT invoice can be removed with \"Delete\" on its page (invoices:delete). A posted invoice that is not yet paid is voided by cancelling it (invoices:void) — this hands the DO back to DELIVERED so it can be re-invoiced; it is refused while a credit / debit note is issued against it. After payment use a credit note (FINANCE → Debtors → Credit Notes).",
    // src/api/routes/invoices.ts:2451 (base invoices:update), :2502 (post), :2506 (void)
    approvals: "No approval workflow. Posting (DRAFT → SENT) needs invoices:post; voiding needs invoices:void.",
    commonMistakes: [
      // src/pages/invoices/index.tsx:221 lists LOADED DOs too, but src/api/routes/invoices.ts:1840 refuses anything not DELIVERED
      { mistake: "Picking a dispatched (LOADED) DO in \"Select Delivery Order\" — the list shows it, but the server refuses it.", fix: "Mark the DO delivered first, then create the invoice." },
      { mistake: "Creating a second invoice for a DO that was already auto-invoiced on delivery.", fix: "Search the Invoices list by DO No first; the system also refuses a duplicate." },
      { mistake: "Trying to invoice a DO that is only dispatched.", fix: "Mark the DO delivered first (\"Mark Delivered\")." },
      { mistake: "Changing a price after the customer paid.", fix: "Raise a credit note or debit note instead of editing the invoice." },
    ],
    workedExample:
      "DO-2612-015 for Demo Furniture Sdn Bhd was delivered with issues, so no invoice was auto-created. After the office resolves it, the billing clerk opens Invoices → New Invoice, selects DO-2612-015 - Demo Furniture Sdn Bhd, clicks Create Invoice, checks the 2 lines at RM 1,250.00, clicks Send Invoice, then ticks it on the list and clicks Email to Customer.",
    related: ["create-delivery-order", "record-customer-payment", "print-documents"],
    nextStep: "Record the customer's payment when it arrives (record-customer-payment).",
    contact: "Accounts executive",
  },

  // -------------------------------------------------------------------------
  {
    id: "record-customer-payment",
    title: "Record a customer payment (receipt) against invoices",
    keywords: [
      "customer payment", "receipt", "record payment", "receive payment", "collection", "knock off", "customer receipt", "deposit",
      "收款", "收钱", "客户付款", "收据", "销账", "回款",
      "bayaran", "terima bayaran", "resit", "bayaran pelanggan", "kutipan",
    ],
    module: "Finance",
    purpose:
      "Record money a customer paid and knock it off one or more of their invoices. The receipt posts to the bank / cash account, reduces the customer's outstanding balance and marks the invoices PARTIAL_PAID or PAID. Money above the invoices you tick is held on account (an advance).",
    prerequisites: [
      // src/api/routes/payments.ts:580 — customerId, amount and method required; :609 "Customer not found"
      "The customer exists and the money has actually reached the bank or cash.",
      // src/pages/invoices/payments.tsx:114-126 — allocation list = the customer's invoices that are not CANCELLED, not PAID and not pre-opening
      "The invoices to knock off are open (not paid, not cancelled) and are not pre-opening invoices.",
      // src/api/routes/payments.ts:596 — bankAccount must be a bank (SBK) or cash (SCH) account
      "The bank / cash account exists in the chart of accounts as a bank or cash account.",
    ],
    who: "Accounts / AR clerk",
    // src/api/routes/payments.ts:565 (POST create)
    permission: ["payments:create"],
    companies: ["ALL"],
    variants: [
      {
        // src/pages/invoices/payments.tsx:178-195 — Amount received editable; amount above allocations held on account
        case: "Customer pays a deposit / advance before any invoice",
        differences: [
          "Type the amount in \"Amount received (RM)\" and allocate nothing (or less than received); the rest is held on account and can be knocked off later by editing the receipt.",
        ],
      },
      {
        // src/pages/accounting/index.tsx:14008-14010 — the three receipt doors
        case: "Money that is not from a trade customer (e.g. refund, sundry income)",
        differences: [
          "Use \"New Other Debtor Receipt\" or \"New Official Receipt\" on the same Receipts page instead of \"New Customer Receipt\".",
        ],
      },
      {
        // src/pages/consignment/note.tsx:2919 — consignment sales are billed to a normal sales invoice
        case: "Consignment customer",
        differences: [
          "No difference once the sold consignment goods are on a sales invoice (\"Transfer to Sales Invoice\"): receive the money against that invoice in the same form.",
        ],
      },
    ],
    page: "/accounting",
    sidebar: "FINANCE → Daily → Receipts",
    steps: [
      {
        do: "In the sidebar open FINANCE → Daily → Receipts and click \"New Customer Receipt\". (The same form is on the Payment Tracking page, /invoices/payments.)",
        page: "/accounting?tab=receipts",
        highlight: "New Customer Receipt",
        then: "The \"Record Payment\" form opens above the receipts list.",
      },
      {
        do: "Fill the receipt header.",
        page: "/accounting?tab=receipts",
        fields: [
          // src/pages/invoices/payments.tsx:198 canSubmit requires a customer
          { label: "Customer", required: true, value: "Type the customer name and pick it. Picking a customer lists its open invoices oldest first.", example: "'Demo Furniture Sdn Bhd'" },
          { label: "Date", required: true, value: "Date picker, defaults to today. Use the day the money landed — it decides the accounting month.", example: "'2026-12-28'" },
          // src/api/routes/payments.ts:596
          { label: "Deposit To", required: true, value: "The bank or cash account the money went into (must be a bank or cash account). Defaults to the main bank.", example: "'Hong Leong Bank'" },
          { label: "Method", required: true, value: "One of Bank Transfer, Cheque, Cash, Credit Card. Defaults to Bank Transfer.", example: "'Bank Transfer'" },
          { label: "Reference", required: false, value: "Cheque number or transfer reference from the bank slip.", example: "'TRF-20261228-778'" },
          // src/pages/invoices/payments.tsx:194-198 — unreadable or 0 amount, or over-allocation, keeps the button disabled; src/api/routes/payments.ts:673 server refuses allocations above the receipt
          { label: "Amount received (RM)", required: true, value: "Follows the total you allocate until you type in it; type the exact amount on the bank slip. Numbers only, 2 decimals. Must be more than 0 and not less than the allocated total.", example: "'2500.00'" },
        ],
      },
      {
        do: "Under \"Allocate to Invoices\" type the amount for each invoice in \"This Payment\", or tick \"Full\" to pay that invoice's whole outstanding.",
        page: "/accounting?tab=receipts",
        fields: [
          // src/api/routes/payments.ts:697 (no negative amounts), :717 (cannot overpay an invoice)
          { label: "This Payment", required: false, value: "RM amount to knock off that invoice; leave blank to skip it. Cannot be negative, cannot be more than the invoice's outstanding, and all lines together cannot exceed the amount received.", example: "'2500.00'" },
          { label: "Full", required: false, value: "Checkbox: fills This Payment with the invoice's full outstanding.", example: "'ticked'" },
        ],
        check: "If you allocate more than received the amount turns red (\"more than received\") and the button stays disabled. A blue line shows any amount held on account.",
      },
      {
        do: "Click \"Record Payment\" at the top right of the form.",
        page: "/accounting?tab=receipts",
        highlight: "Record Payment",
        then: "A receipt number is issued and the receipt appears in the list. The bank / cash ledger is debited and the customer's balance credited; each allocated invoice becomes PARTIAL_PAID or PAID, and when every invoice of a sales order is paid the sales order closes. The customer's Outstanding drops on the Customers page.",
      },
      {
        do: "Quick alternative for one invoice: on SALES & CUSTOMERS → Invoices right-click a Sent or Partial Paid invoice and choose \"Record Payment\" (or click \"Record Payment\" on the invoice page), fill \"Payment Amount (RM)\", \"Payment Date\", \"Reference (Cheque No / Transfer Ref)\" and \"Payment Method\", then click \"Record Payment\".",
        page: "/invoices",
        highlight: "Record Payment",
        then: "The payment is added to that invoice and its status moves to PARTIAL_PAID or PAID. This path needs invoices:update and has no Deposit To choice — prefer the receipt form above so the bank account is right.",
      },
    ],
    checkBefore: [
      "Amount received equals the bank slip exactly.",
      "Deposit To is the bank the money actually went into.",
      "The allocations go to the right invoices (oldest first unless the customer said otherwise).",
      "Date is the day the money landed, not today, if keyed in late.",
    ],
    result:
      "The receipt is listed under FINANCE → Daily → Receipts and on Payment Tracking (/invoices/payments). Invoices show the new Paid amount and status; Debtor Aging and the customer's Outstanding go down.",
    warnings: [
      // src/api/routes/payments.ts:821-822 (invoice → PARTIAL_PAID / PAID), :851 (customer outstandingSen reduced), :898 (SO → CLOSED when all its invoices are paid)
      "Posts money to the ledger (bank and customer balance) immediately, and can close the sales order.",
      // src/api/routes/invoices.ts:2463-2479 — checkInvoiceLocked once a payment exists
      "Once an invoice has a payment it is locked against edits; corrections need a credit note or editing the receipt.",
      // src/pages/invoices/payments.tsx:120-126
      "Pre-opening invoices are hidden from the allocation list on purpose — money knocked onto one would disappear from the aging.",
      // src/api/routes/payments.ts:697 — refunds are not negative receipts
      "A refund to the customer is not a negative receipt — the system refuses negative amounts; use a credit note.",
    ],
    // src/api/routes/payments.ts:1278-1279 (lifecycle void / delete / unvoid, payments:update), :1343-1344 (restate = edit in place)
    undo:
      "Right-click the receipt in FINANCE → Daily → Receipts: \"Edit\" re-states it in place (same number, ledger reversed and re-posted), or void / delete it, which reverses the ledger and re-opens the invoices; a voided receipt can be restored. Needs payments:update. On Payment Tracking, open the receipt and use \"Edit\", \"Void\", \"Delete\" or \"Restore\".",
    commonMistakes: [
      { mistake: "Recording the full amount against the newest invoice when the customer paid the oldest.", fix: "Edit the receipt and move the allocation to the right invoice." },
      { mistake: "Typing 12,000 with a comma in the amount box.", fix: "Type 12000.00 — an unreadable amount blocks the save." },
      { mistake: "Leaving Deposit To on the default bank when the money went to another account.", fix: "Edit the receipt and pick the right Deposit To account." },
    ],
    workedExample:
      "Demo Furniture Sdn Bhd transfers RM 2,500.00 on 28/12/2026 for invoice INV-2612-031. The AR clerk opens FINANCE → Daily → Receipts → New Customer Receipt, picks the customer, sets Date 28/12/2026, Deposit To Hong Leong Bank, Method Bank Transfer, Reference TRF-20261228-778, ticks Full on INV-2612-031 (RM 2,500.00) and clicks Record Payment. The invoice turns Paid.",
    related: ["create-invoice", "print-documents"],
    nextStep: "Print or email the receipt voucher if the customer asks for it (right-click the receipt → Print).",
    contact: "Finance manager",
  },

  // -------------------------------------------------------------------------
  {
    id: "delivery-return",
    title: "Record a delivery return",
    keywords: [
      "delivery return", "return", "goods returned", "customer return", "damaged goods", "return to stock", "credit note",
      "退货", "客户退货", "送货退回", "退回", "回仓",
      "pulangan", "pulangan barang", "barang rosak", "pulang stok",
    ],
    module: "Delivery",
    purpose:
      "Record goods that came back after delivery (damaged, wrong, not accepted), then either put them back into stock (with a credit note if they were already invoiced) or send them for repair and re-delivery through a service case.",
    prerequisites: [
      // src/pages/delivery-returns/index.tsx:228-233 — only DELIVERED / INVOICED DOs offered; src/pages/delivery/index.tsx:4687-4690 Convert to Delivery Return enabled only for those statuses
      "The original delivery order is DELIVERED or INVOICED.",
      // src/api/lib/delivery-return-create.ts:312 (qty > 0), :344 (line must name its production order), :382 (cannot return more than delivered minus earlier returns)
      "You know which lines and how many pieces came back (never more than were delivered, less anything already returned), and what the problem is.",
    ],
    who: "Logistics / customer service, with Accounts for the credit note",
    // src/api/routes/delivery-returns.ts:258 — POST create gated by delivery-returns:update (no separate create action); :511, :567, :632, :667 same gate for outcomes / cancel
    permission: ["delivery-returns:update"],
    companies: ["ALL"],
    variants: [
      {
        // src/pages/consignment/note.tsx:2926, :5070 — consignment goods come back via a Consignment Return
        case: "Consignment goods coming back unsold",
        differences: [
          "Do not use Delivery Return. Open SALES & CUSTOMERS → Consignment → Consignment Note, right-click the note and choose \"Transfer to Consignment Return\"; the returns are listed under Consignment Return.",
        ],
      },
      {
        // src/api/lib/delivery-return-create.ts:5-8 — the public driver scan "Not received" writes the same return record for the whole DO
        case: "Customer refuses the whole delivery at the door",
        differences: [
          "The driver can record it from the DO QR scan (not received); the system creates the delivery return for the whole DO, and the office continues from \"Return to stock\" or the service-case route on the return page.",
        ],
      },
      {
        // src/pages/delivery-returns/detail.tsx:312-330 — the invoice decides: invoiced → PURE_RETURN + credit note, not invoiced → return-to-stock only
        case: "DO already invoiced vs not invoiced",
        differences: [
          "Invoiced: \"Return to stock\" also opens the pre-filled credit note (needs credit-notes:create to raise it). Not invoiced: stock only, no credit note.",
        ],
      },
    ],
    page: "/delivery-returns",
    sidebar: "SALES & CUSTOMERS → Delivery Return",
    steps: [
      {
        do: "In the sidebar open SALES & CUSTOMERS → Delivery Return and click \"New return\". (Shortcut: on Delivery Order right-click a delivered DO and choose \"Convert to Delivery Return\" — the DO is pre-selected.)",
        page: "/delivery-returns",
        highlight: "New return",
        then: "The \"New delivery return\" dialog opens.",
      },
      {
        do: "Pick the DO and tick the lines that came back.",
        page: "/delivery-returns",
        fields: [
          // src/pages/delivery-returns/index.tsx:318-320 — needs a DO and at least one ticked line; src/api/routes/delivery-returns.ts:266
          { label: "Delivered order", required: true, value: "Pick from \"Select a delivered DO…\" — only DELIVERED or INVOICED DOs are listed (DO number · customer).", example: "'DO-2612-015 · Demo Furniture Sdn Bhd'" },
          // src/pages/delivery-returns/index.tsx:323-329 (1 … returnable); src/api/lib/delivery-return-create.ts:382 server over-return guard
          { label: "Qty returned", required: true, value: "Appears after you tick a line. Whole number from 1 up to the returnable quantity shown next to the box; otherwise refused with a message naming the product.", example: "'1'" },
          { label: "What's the problem? (e.g. fabric torn)", required: false, value: "The box under each ticked line: describe the problem.", example: "'Headboard fabric torn'" },
        ],
        check: "Each line shows its SO / PO / fabric / size so you can tell two identical products apart — tick the right one.",
      },
      {
        do: "Click \"Create return\".",
        page: "/delivery-returns",
        highlight: "Create return",
        then: "The return is created (open status) and its page opens. Nothing moves in stock yet.",
      },
      {
        do: "Decide the outcome on the return page. Goods back to the warehouse: click \"Return to stock\".",
        page: "/delivery-returns/:id",
        highlight: "Return to stock",
        then: "The goods go back into finished-goods stock and cost of goods sold is reversed. If the DO was never invoiced: done, no credit note. If it was invoiced: you are taken to the credit note form pre-filled from the return — confirm the refund amount there (or later with \"Create credit note\").",
      },
      {
        do: "Goods to be repaired and sent again: click the button ending \"re-deliver → service case\" instead.",
        page: "/delivery-returns/:id",
        highlight: "re-deliver → service case",
        then: "A service case is opened from the original sales order with the returned items, and you land on it to spawn the replacement service order. When the goods go back to the customer, return here and click \"Mark re-delivered\".",
      },
    ],
    checkBefore: [
      "Right DO and right lines; quantity equals the pieces physically returned.",
      "The problem text is clear enough for QC / production.",
      "Whether the DO was invoiced (the \"Invoiced?\" column) — that decides if a credit note follows.",
    ],
    result:
      "The return is listed on SALES & CUSTOMERS → Delivery Return and on the original DO. Return to stock adds the goods back to stock; an invoiced return gets a credit note under FINANCE → Debtors → Credit Notes; a repair return links to a service case.",
    warnings: [
      // src/api/routes/delivery-returns.ts:301-345 — return-to-stock reverses COGS / FG value and writes FG ledger IN rows
      "\"Return to stock\" moves stock and reverses cost of goods sold.",
      // src/pages/delivery-returns/detail.tsx:316-322 — invoiced DO → navigates to the credit note form; the credit happens only when that note is raised
      "For an invoiced DO the customer is only credited once the credit note is raised — do not forget it.",
      // src/api/routes/delivery-orders/_helpers.ts:1230 (DO cancel refused), src/api/routes/delivery-orders.ts:3001 (reverse-to-dispatched refused) once a return exists
      "Once goods are returned, the original DO can no longer be cancelled or reversed; handle remaining lines through the return.",
      // src/api/routes/delivery-returns.ts:585-588 — an outcome can be set only while the return is OPEN
      "The outcome (stock or repair) can be chosen only once, while the return is open.",
    ],
    // src/api/routes/delivery-returns.ts:680-683 (cancel refused for CLOSED / REDELIVERED / CN_ISSUED), :688-696 (RETURNED_TO_STOCK → undo stock then cancel); src/pages/delivery-returns/detail.tsx:151, :400-425
    undo:
      "While open, \"Cancel return\" voids the return. After return to stock, \"Undo return to stock\" takes the goods back off stock, puts the units back to delivered and cancels the return. Both need delivery-returns:update. A return whose credit note is issued, or that is re-delivered or closed, cannot be cancelled.",
    commonMistakes: [
      { mistake: "Ticking the whole DO when only one piece came back.", fix: "Cancel the return and create it again with only the returned line and \"Qty returned\"." },
      { mistake: "Returning to stock an invoiced DO and leaving the credit note unconfirmed.", fix: "Open the return and click \"Create credit note\", then confirm it." },
    ],
    workedExample:
      "Demo Furniture Sdn Bhd sends back 1 headboard from DO-2612-015 with torn fabric. Customer service opens Delivery Return → New return, picks DO-2612-015 · Demo Furniture Sdn Bhd, ticks the headboard line, Qty returned 1, problem 'Headboard fabric torn', clicks Create return, then chooses the repair route to open a service case for a replacement.",
    related: ["create-delivery-order", "create-invoice", "record-customer-payment"],
    nextStep: "For an invoiced return, confirm the credit note; for a repair, spawn the service order from the service case.",
    contact: "Customer service supervisor",
  },

  // -------------------------------------------------------------------------
  {
    id: "print-documents",
    title: "Print or download sales documents and stickers",
    keywords: [
      "print", "PDF", "download", "print SO", "print DO", "print invoice", "packing list", "sticker", "QR", "label", "email invoice",
      "打印", "打印送货单", "打印发票", "下载", "贴纸", "二维码", "标签",
      "cetak", "cetak invois", "muat turun", "pelekat", "kod QR", "label",
    ],
    module: "Sales",
    purpose:
      "Get the PDF of a sales order, delivery order, packing list or invoice to print, download or send, and print the QR stickers / labels for finished goods and job cards.",
    prerequisites: [
      // src/pages/sales/detail.tsx:1408-1417 (generateSOPdf), src/pages/invoices/detail.tsx:533-546 (printInvoicePdf) — PDFs are generated in the browser from the loaded record
      "The document exists (PDFs are built in the browser from the saved record).",
      "A printer is set up on your computer; sticker printing needs the sticker printer.",
      // src/api/lib/nav-permissions.ts:51, :53, :59, :67 — each page has its own read gate
      "You can open the page of the document you print: sales orders, delivery orders, invoices or production each need their own read permission.",
    ],
    who: "Sales admin, logistics, accounts, production supervisor. Each part needs the read permission of its own page (sales orders, delivery orders, invoices, production).",
    // Pure OR: any one of the four page read gates is enough (see permissionAny).
    permission: [],
    // src/api/lib/nav-permissions.ts:53, :59, :67 — DO, invoice and sticker parts are gated by their own page
    permissionAny: ["sales-orders:read", "delivery-orders:read", "invoices:read", "production-orders:read"],
    companies: ["ALL"],
    variants: [
      {
        // src/pages/consignment/note.tsx:2919-2926 — consignment documents live on the Consignment Note page
        case: "Consignment documents",
        differences: [
          "Consignment orders and notes print from SALES & CUSTOMERS → Consignment (\"Consignment Orders\", \"Consignment Notes\"), not from the Sales Orders or Delivery Order pages.",
        ],
      },
      {
        // src/lib/generate-invoice-pdf.ts:206-207 — invoice letterhead name = invoice.companyName, falling back to HOOKKA
        case: "Invoice booked under a sister company",
        differences: [
          "The invoice PDF letterhead shows the invoice's own company name; everything else (buttons, steps) is the same.",
        ],
      },
      {
        // src/components/delivery/do-qr-dialog.tsx:10-12 — a packing-list QR moves ALL its DOs; a DO QR only that DO
        case: "Several DOs on one packing list",
        differences: [
          "A packing-list QR moves every DO on that list together; a DO's own \"QR — Driver Scan\" moves only that DO.",
        ],
      },
    ],
    page: "/sales",
    sidebar: "SALES & CUSTOMERS → Sales Orders",
    steps: [
      {
        do: "Sales order: open SALES & CUSTOMERS → Sales Orders, click the order, then click \"Preview\" (opens the PDF on screen with print / download) or \"PDF\" (downloads it).",
        page: "/sales/:id",
        highlight: "Preview",
      },
      {
        do: "Delivery order: open SALES & CUSTOMERS → Delivery Order, find the DO on its tab, right-click the row and choose \"Print DO\" (or \"Print Packing List\"). On the DO's own page use \"Preview\", \"Download DO PDF\" or \"Print Packing List\".",
        page: "/delivery",
        highlight: "Print DO",
        then: "The standard DO PDF opens for printing; the packing list shows the rack for each piece.",
      },
      {
        do: "Driver QR for a DO: right-click the DO row and choose \"QR — Driver Scan\", then print or show the QR to the driver.",
        page: "/delivery",
        highlight: "QR — Driver Scan",
        check: "The QR encodes the site you print from — print it from the live ERP, not a test site.",
        then: "The driver scans it to mark the DO in transit / delivered from their phone.",
      },
      {
        do: "Invoice: open SALES & CUSTOMERS → Invoices, click the invoice (or right-click → \"Print Invoice\"), then click \"View Documentation\" to view / print or \"PDF\" to download.",
        page: "/invoices/:id",
        highlight: "View Documentation",
      },
      {
        do: "Several invoices at once: on the Invoices list tick the invoices, then click \"Download PDF\" (one merged file) or \"Email to Customer\" (emails each customer its PDF).",
        page: "/invoices",
        highlight: "Email to Customer",
        check: "\"Email to Customer\" finalises any draft invoices first and re-emails already-sent ones — tick only the ones you mean to send.",
      },
      {
        do: "Finished-goods / packing stickers: open PRODUCTION → Production, choose the Upholstery or Packing department tab, filter the grid to the orders you need, then click \"Print Packing Stickers\" (or \"Show QR\" to preview first).",
        page: "/production",
        highlight: "Print Packing Stickers",
        then: "The sticker sheet prints; each sticker's QR is scanned later to set the rack and track the piece.",
      },
      {
        do: "Job-card stickers for the sewing team: on PRODUCTION → Production, Fab Cut tab, filter the grid, then click \"Print Fab Sew Stickers\".",
        page: "/production",
        highlight: "Print Fab Sew Stickers",
      },
    ],
    checkBefore: [
      "You are printing the latest version (re-open the document after any edit).",
      "For emails: the customer's email is on file and the invoice amounts are final.",
      "For stickers / QR: you are on the live ERP site, and the grid filter shows only the orders you want.",
    ],
    result:
      "A PDF opens or downloads, or the sticker sheet goes to the printer. Printing changes nothing in the ERP; only \"Email to Customer\" changes data (drafts become sent and an email goes out).",
    warnings: [
      // src/pages/invoices/index.tsx:405-410 — emailSelected PUTs status SENT on drafts (invoices:post, src/api/routes/invoices.ts:2502) before emailing
      "\"Email to Customer\" sends to the customer and posts any draft invoice it includes (needs invoices:post for drafts).",
      // src/lib/qr-utils.ts:143-149 — QR URLs are built from the current page origin
      "QR codes point to the site they were printed from; a sticker printed on a test site will not work on the live one.",
    ],
    undo:
      "Printing and downloading cannot harm data — just print again. An invoice emailed by mistake cannot be unsent; tell the customer and, if needed, void the invoice (invoices:void) or raise a credit note.",
    commonMistakes: [
      { mistake: "Looking for the DO print button on the Pending Delivery tab.", fix: "A DO exists only after \"Create DO\"; print it from \"Pending Dispatch\" or later tabs." },
      { mistake: "Printing stickers with no grid filter and getting hundreds.", fix: "Filter the grid or tick rows first; the tooltip on the button says how many orders it will cover." },
      { mistake: "Clicking \"Send Invoice\" to email the customer.", fix: "\"Send Invoice\" only posts the invoice; use \"Email to Customer\" on the list to email it." },
    ],
    workedExample:
      "Logistics needs the paperwork for DO-2612-015 (Demo Furniture Sdn Bhd): on Delivery Order → Pending Dispatch they right-click the DO → Print DO, then Print Packing List, then QR — Driver Scan for the driver. Accounts later opens the invoice and clicks PDF to attach it to a statement.",
    related: ["create-sales-order", "create-delivery-order", "create-invoice", "record-customer-payment"],
    contact: "Sales admin",
  },
];
