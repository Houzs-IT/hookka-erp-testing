// ---------------------------------------------------------------------------
// howto/guides-procurement.ts — process help for Procurement (PO → GRN → PI →
// supplier payment, MRP shortages, PO notes). Written from the real pages:
//   src/pages/procurement/{index,create,detail}.tsx
//   src/pages/procurement/grn.tsx, grn/create.tsx, grn-detail.tsx
//   src/pages/procurement/pi.tsx, pi/create.tsx, PurchaseInvoiceDetail.tsx
//   src/pages/planning/mrp.tsx
//   src/pages/accounting/index.tsx (Payment Vouchers → New AP Payment)
// and the API routes they call (purchase-orders.ts, grn.ts,
// purchase-invoices.ts, mrp.ts, accounting.ts). Every enforced rule carries a
// code citation in a comment beside it; the user text never cites code.
//
// Companies: every flow here is the same for every company in the
// organisations registry (HOOKKA, OHANA, …). The purchase company only picks
// the letterhead (and the inter-company mirror for group-company suppliers);
// accounting stays HOOKKA. So companies = ["ALL"] everywhere, with the
// purchase-company behaviour described as a variant.
// Note: procurement/maintenance.tsx ~1018 only colours the supplier's
// "Purchase Company" badge per code (HOOKKA / OHANA / other) — no
// OHANA-specific flow exists in the code, so none is described.
// ---------------------------------------------------------------------------
import type { HowToGuide } from "./types";

export const GUIDES: HowToGuide[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "create-purchase-order",
    title: "Create a purchase order (PO) and send it to the supplier",
    keywords: [
      "purchase order", "create PO", "new PO", "raise PO", "order from supplier", "email PO",
      "采购单", "开PO", "下单", "采购", "订货", "发PO给供应商",
      "pesanan belian", "buat PO", "pesan dari pembekal",
    ],
    module: "Procurement",
    companies: ["ALL"],
    purpose:
      "Order raw materials from one supplier. A PO created here is active straight away (status CONFIRMED) and is what the goods receipt (GRN) and the purchase invoice are later matched against.",
    prerequisites: [
      // src/api/routes/purchase-orders.ts:594 — rejects "Supplier not found" when the supplier id does not exist
      "The supplier exists (PROCUREMENT → Suppliers). Only ACTIVE suppliers are offered in the \"Supplier\" picker.",
      // src/pages/procurement/create.tsx:489 — blocks save with unbound lines ("Pick supplier for unbound material")
      "Each material you order is bound to that supplier (supplier SKU + price) — only bound materials appear in \"Select Materials\".",
      // src/pages/procurement/detail.tsx:641 — "Email to Supplier" only from SUBMITTED / CONFIRMED / PARTIAL_RECEIVED / RECEIVED
      "For emailing: the supplier has an email address on file.",
    ],
    who: "Purchasing / procurement staff.",
    // src/api/routes/purchase-orders.ts:548 — POST /api/purchase-orders requires purchase-orders:create
    permission: ["purchase-orders:create"],
    page: "/procurement/create",
    sidebar: "PROCUREMENT → Purchase Order",
    steps: [
      {
        do: "Open PROCUREMENT → Purchase Order and click \"New Purchase Order\" at the top right.",
        page: "/procurement",
        highlight: "New Purchase Order",
        then: "The \"New Purchase Order\" page opens (/procurement/create).",
      },
      {
        do: "Fill the \"Order Details\" card.",
        fields: [
          {
            label: "Supplier",
            required: true,
            // src/api/routes/purchase-orders.ts:567 — supplierId, supplierName and items are required
            value:
              "Required. Pick from the list (type the code or name). It filters the material picker to this supplier's materials. The PO's supplier is taken from the lines, so every line must belong to this one supplier.",
            example: "'SUP-021 - Demo Foam Supplier'",
          },
          {
            label: "Purchase company",
            required: true,
            // src/api/routes/purchase-orders.ts:604 — form value, else supplier's default, else HOOKKA; never empty
            value: "The company the PO is issued under. Defaults to HOOKKA; if left empty the supplier's own purchase company is used.",
            example: "'HOOKKA'",
          },
          {
            label: "Expected Delivery Date",
            required: false,
            value: "Date picker. The date you expect the goods; drives the overdue-PO list.",
            example: "'2026-12-10'",
          },
          {
            label: "Notes",
            required: false,
            // src/pages/procurement/create.tsx:782 — textarea maxLength 5000
            value: "Free text, up to 5000 characters: delivery instructions, payment terms, special handling. Prints on the PO.",
            example: "'Deliver to Factory B loading bay, before 12pm'",
          },
        ],
      },
      {
        do: "In the \"Order Items\" card click \"Add Materials from Supplier\". In the \"Select Materials\" window search by RM code or description, click \"Add\" on each material, then click \"Done\".",
        highlight: "Add Materials from Supplier",
        // src/pages/procurement/create.tsx:487 — blocks save with "Add at least one item"
        then: "Each material becomes a line with the supplier's bound SKU, price, unit, lead time and MOQ filled in. At least one line is required.",
      },
      {
        do: "On each line check and adjust the quantity and price.",
        fields: [
          {
            label: "Qty",
            required: true,
            // src/pages/procurement/create.tsx:963 — input min 1; src/api/routes/purchase-orders.ts:615 — quantity must be a number >= 0
            value: "Number, at least 1. Pre-filled with the supplier's MOQ. Unit is shown in the \"Unit\" column.",
            example: "'120'",
          },
          {
            label: "Price (RM)",
            required: true,
            // src/api/routes/purchase-orders.ts:618 — unitPriceSen must be a number >= 0
            value: "Unit price in RM (two decimals, stored in sen), not negative. Pre-filled from the supplier binding; change only if the supplier quoted differently.",
            example: "'18.50'",
          },
        ],
        // src/pages/procurement/create.tsx:489-494 — unbound / mixed-supplier lines block save
        check:
          "Every line shows a supplier (no \"Pick supplier for unbound material(s)\" warning) and all lines are the same supplier. If lines belong to several suppliers, use \"Split by Supplier\" instead of saving one PO.",
      },
      {
        do: "Check the \"Summary\" card, then click \"Create Purchase Order\".",
        highlight: "Create Purchase Order",
        check: "\"Total Qty\", \"Line Items\" and \"Total\" match what you intend to order. The card says \"Status will be set to CONFIRMED\".",
        // src/pages/procurement/create.tsx:464 — payload status CONFIRMED (no draft)
        then:
          "Toast \"Purchase order created\". The PO is saved as CONFIRMED with the next PO number and you return to the Purchase Order list. Nothing is sent to the supplier yet.",
      },
      {
        do: "Open the new PO from the list (double-click the row) and click \"Email to Supplier\".",
        page: "/procurement/:id",
        highlight: "Email to Supplier",
        check: "The email draft's To address is the supplier's, and the PO PDF is attached.",
        // src/api/routes/purchase-orders.ts:1344 — mark-emailed stamps lastEmailedAt (purchase-orders:update)
        then:
          "A Mail Center draft opens with the PO PDF attached. Click \"Send\". The PO is stamped with the send time (\"Last sent:\"), and the button changes to \"Resend Email\". You can also use \"Download PDF\" or \"Preview\" to send it another way.",
      },
    ],
    checkBefore: [
      "Right supplier and right \"Purchase company\".",
      "Quantities and unit prices match the supplier's quotation; units are correct (MTR vs ROLL, PCS vs SET).",
      "No line is missing a supplier and all lines are one supplier.",
    ],
    result:
      "A CONFIRMED purchase order appears on PROCUREMENT → Purchase Order. Its open quantity counts as \"PO Outstanding\" in MRP and in fabric tracking. No stock moves and no money is booked until goods are received (GRN) and the supplier invoice is confirmed.",
    warnings: [
      // src/pages/procurement/create.tsx:464 — created CONFIRMED
      "The PO is active the moment it is created — there is no draft step.",
      "\"Send\" in the email draft really emails the supplier.",
      // src/api/routes/purchase-orders.ts:745 — mirror SO raised when supplier is a group company and auto-mirror config is on
      "If the supplier is a group (sister) company and inter-company mirroring is switched on, a mirror sales order is raised automatically in the selling company.",
      // src/api/routes/purchase-orders.ts:937 — supplier + lines locked once a POSTED/CONFIRMED GRN exists
      "Once goods are received against the PO (a posted GRN), its supplier and lines are locked.",
    ],
    // src/pages/procurement/detail.tsx:697 — Edit only while not cancelled/RECEIVED/CLOSED, no posted GRN, nothing received
    // src/pages/procurement/detail.tsx:482 — cancel/close reason must be at least 10 characters
    // src/pages/procurement/detail.tsx:647,650 — Cancel PO from SUBMITTED/CONFIRMED/PARTIAL_RECEIVED; Close PO from CONFIRMED/PARTIAL_RECEIVED
    // src/api/routes/purchase-orders.ts:892 — PUT requires purchase-orders:update; :915 — refuses a stale save
    undo:
      "While nothing has been received, open the PO and use \"Edit\" to change lines, date or notes, then \"Save Changes\" (refused if someone else saved the PO after you opened it). To stop it, use \"Cancel PO\" — a reason of at least 10 characters is required and is appended to the PO notes; stock already received is NOT reversed. For a short delivery where nothing more is coming use \"Close PO\" (same reason rule). Both need purchase-orders:update. Once a GRN is posted, supplier and lines stay locked — cancel the GRN first.",
    approvals: "None — a manually created PO is CONFIRMED immediately.",
    commonMistakes: [
      {
        mistake: "Adding materials from two suppliers to one PO, so \"Create Purchase Order\" stays disabled.",
        fix: "Click \"Split by Supplier\" — it creates one PO per supplier in one go.",
      },
      {
        mistake: "A material does not appear in the \"Select Materials\" list.",
        fix: "It is not bound to that supplier. Bind it on PROCUREMENT → Suppliers (supplier materials), or ask the procurement lead.",
      },
      {
        mistake: "Creating the PO and assuming the supplier got it.",
        fix: "Open the PO and click \"Email to Supplier\", then \"Send\" — or send the \"Download PDF\" yourself.",
      },
    ],
    workedExample:
      "Order 120 sheets of 2-inch foam from 'Demo Foam Supplier' at RM 18.50: New Purchase Order → Supplier 'Demo Foam Supplier' → Add Materials from Supplier → Add 'FOAM-2IN' → Done → Qty '120' → Create Purchase Order (total RM 2,220.00) → open the PO → Email to Supplier → Send.",
    related: ["mrp-shortages-to-po", "receive-goods-grn", "add-po-note", "record-purchase-invoice"],
    nextStep: "When the goods arrive, receive them against this PO (receive-goods-grn).",
    contact: "Procurement lead / purchasing manager.",
    variants: [
      {
        // src/pages/procurement/create.tsx:548-552 — split uses each supplier's own purchase company, else the form's, else HOOKKA
        case: "Cart with suppliers that belong to different purchase companies (e.g. a HOOKKA supplier and an OHANA supplier)",
        differences: [
          "\"Split by Supplier\" creates one PO per supplier, and each PO takes that supplier's own \"Purchase Company\" (set on the supplier record); the form's \"Purchase company\" is used only for a supplier that has none.",
          "A toast reports how many POs were created; if some fail, the rest are still created — fix the failed ones and retry.",
        ],
      },
      {
        // src/pages/procurement/detail.tsx:760,773 — Preview / Download PDF letterhead from the SUPPLIER's purchaseOrgCode, default HOOKKA
        // src/pages/procurement/supplier-form-dialog.tsx:229 — supplier "Purchase Company" field
        case: "Purchase company and the printed PO",
        differences: [
          "\"Preview\" and \"Download PDF\" print under the letterhead of the supplier's \"Purchase Company\" (HOOKKA when the supplier has none). Accounting stays HOOKKA whichever company prints.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "receive-goods-grn",
    title: "Receive goods against a PO (GRN)",
    keywords: [
      "GRN", "goods receipt", "receive goods", "goods received note", "stock in", "delivery arrived",
      "收货", "进货", "入库", "收货单", "到货",
      "terima barang", "nota penerimaan barang", "barang sampai", "stok masuk",
    ],
    module: "Procurement",
    companies: ["ALL"],
    purpose:
      "Record what the supplier actually delivered against a PO, so raw-material stock goes up and the PO's received quantity is updated.",
    prerequisites: [
      // src/pages/procurement/detail.tsx:684 — "Receive Goods" only on CONFIRMED / PARTIAL_RECEIVED POs
      "A CONFIRMED (or partly received) purchase order exists for this supplier.",
      "You have the supplier's delivery order (DO) in hand and have counted the goods.",
    ],
    who: "Store / warehouse receiving staff; procurement for imports.",
    // src/api/routes/grn.ts:1457 — POST requires grn:create; :1966 — PUT (Post to Stock) requires grn:update; :2480 — arrival advance requires grn:update
    permission: ["grn:create", "grn:update"],
    page: "/procurement/grn",
    sidebar: "PROCUREMENT → Goods Receipt",
    steps: [
      {
        do: "Open PROCUREMENT → Goods Receipt and click \"From PO\". (Shortcut: on the PO's page click \"Create GRN\" or \"Receive Goods\" — the PO is then pre-selected and you can skip the next step.)",
        highlight: "From PO",
        then: "The \"New Goods Receipt Note\" page opens with the \"Convert from Purchase Order\" window.",
      },
      {
        do: "In \"Convert from Purchase Order\" search the PO number or supplier, click the PO, tick the lines that arrived, then click the \"Add\" lines button.",
        page: "/procurement/grn/create",
        check: "You picked the PO that matches the supplier's DO.",
        then: "The lines appear in the items card with \"Ordered\" and any quantity already received.",
      },
      {
        do: "Fill the \"GRN Details\" card.",
        page: "/procurement/grn/create",
        fields: [
          {
            label: "Received By *",
            required: true,
            // src/pages/procurement/grn/create.tsx:577 — blocks save "Enter the name of the person who received the goods"
            value: "Required. Name of the person who physically received the goods.",
            example: "'Ahmad bin Ismail'",
          },
          {
            label: "Supplier DO No.",
            required: false,
            value: "The supplier's delivery order number, for matching with the invoice later.",
            example: "'DO-88123'",
          },
          {
            label: "Purchase company",
            required: true,
            value: "Taken from the PO; leave as is unless the PO was issued under another company.",
            example: "'HOOKKA'",
          },
          {
            label: "Notes",
            required: false,
            value: "Free text: discrepancy remarks, damaged cartons, short delivery.",
            example: "'2 rolls wet, rejected'",
          },
        ],
      },
      {
        do: "For each line enter the quantities actually delivered.",
        page: "/procurement/grn/create",
        fields: [
          {
            label: "Received",
            required: true,
            // src/pages/procurement/grn/create.tsx:580 — at least one line with a received quantity
            // src/api/routes/grn.ts:1686 + :1189 — refuses when already received + this receipt exceeds 110% of ordered (cumulative)
            value: "Number, 0 or more, in the PO line's unit. At least one line must be above 0. The total received on a PO line (earlier receipts plus this one) may not pass 110% of the ordered quantity — the field turns red with \"Exceeds 110%\" and saving is refused.",
            example: "'100'",
          },
          {
            label: "Rejected",
            required: false,
            value: "Number from 0 up to the received quantity. \"Accepted\" is calculated as Received minus Rejected.",
            example: "'2'",
          },
          {
            label: "Rejection Reason",
            required: false,
            value: "Shown once Rejected is above 0. Say why.",
            example: "'Water damage'",
          },
        ],
        check: "Received quantities match the physical count, not the DO.",
      },
      {
        do: "Click \"Create GRN\".",
        page: "/procurement/grn/create",
        highlight: "Create GRN",
        // src/api/routes/grn.ts:1523,1546 — PO-linked → arrival NOT_ARRIVED → status DRAFT; manual → ARRIVED → POSTED
        then:
          "Toast \"GRN created\". A GRN received against a PO is saved as DRAFT with arrival status \"Planning\" (it is treated as a shipment until marked arrived) — stock has NOT moved yet. Choose \"Open GRN\" in the prompt to go to the GRN.",
      },
      {
        do: "On the GRN page advance the arrival with the arrival button: \"Mark In Transit\", then \"Mark At Customs\", then \"Mark Arrived\" (one click each; for local goods just click through).",
        page: "/procurement/grn/:id",
        highlight: "Mark Arrived",
        then: "The arrival badge reads \"Arrived\" and \"Post to Stock\" becomes clickable.",
      },
      {
        do: "Click \"Post to Stock\".",
        page: "/procurement/grn/:id",
        highlight: "Post to Stock",
        // src/api/routes/grn.ts:2061 — posting refused until arrival_state is ARRIVED
        check: "Quantities are right — posting moves stock.",
        then:
          "A success toast appears. Status becomes POSTED: accepted quantities are added to raw-material stock (FIFO lots and cost ledger), and the PO's received quantity and status update (PARTIAL_RECEIVED or RECEIVED). If a line had no matching raw material, a red toast says that stock did NOT land.",
      },
    ],
    checkBefore: [
      "The PO is the one on the supplier's DO.",
      "Received and Rejected match the physical count.",
      "\"Received By *\" is filled.",
    ],
    result:
      "A POSTED GRN on PROCUREMENT → Goods Receipt; raw-material stock increased by the accepted quantity; the PO shows the received percentage and moves to PARTIAL_RECEIVED or RECEIVED. \"Convert to Invoice\" is now available on the GRN.",
    warnings: [
      "\"Post to Stock\" moves inventory and cost — check quantities first.",
      // src/api/routes/grn.ts:2061 — 409 "Goods not yet marked arrived" before ARRIVED
      "A PO-linked GRN does not touch stock until it is marked arrived and posted; \"Post to Stock\" is refused before \"Mark Arrived\".",
      // src/api/routes/grn.ts:1686 — over-receipt is a hard refusal (no override path in the route)
      "Receiving more than 110% of a PO line (counting earlier receipts) is refused.",
      // src/api/routes/grn.ts:2033 — a POSTED GRN's status cannot be changed; use Cancel Receipt
      "Once POSTED, the GRN's status cannot be changed back — the only way out is \"Cancel Receipt\".",
    ],
    // src/api/routes/grn.ts:2632 — cancel requires grn:delete
    // src/api/routes/grn.ts:2676 — cancel refused while a purchase invoice still bills these lines (void the invoice first)
    // src/api/routes/grn.ts:2711 — cancel refused once received stock has been issued/used
    // src/api/routes/grn.ts:2656 — cancel refused while a live purchase return exists
    // src/api/routes/grn.ts:2016 — a CANCELLED GRN cannot be edited; create a new receipt
    undo:
      "Before posting, the DRAFT GRN can still be changed. After posting, \"Cancel Receipt\" on the GRN reverses the stock and releases the PO quantity. It is refused while a purchase invoice still bills those lines (void the invoice first), while a purchase return is open on it, or once the received stock has been used. Needs grn:delete. A cancelled GRN cannot be edited — create a new receipt. To send goods back instead, use \"Create Purchase Return\".",
    // src/pages/procurement/grn-detail.tsx — "Approve" sets CONFIRMED; Post to Stock is not gated on it
    approvals: "Optional: \"Approve\" on the GRN sets it CONFIRMED; posting to stock does not require it.",
    commonMistakes: [
      {
        mistake: "Saving the GRN and thinking stock is in, but the GRN is still DRAFT / \"Planning\".",
        fix: "Open the GRN, click the arrival button up to \"Mark Arrived\", then \"Post to Stock\".",
      },
      {
        mistake: "Using \"Create GRN\" on the list (manual) for goods that have a PO.",
        fix: "Use \"From PO\" (or \"Receive Goods\" on the PO) so the PO's received quantity is drawn down.",
      },
      {
        mistake: "Entering the DO quantity instead of the counted quantity.",
        fix: "Enter what was counted; put the shortfall reason in \"Notes\".",
      },
    ],
    workedExample:
      "'Demo Foam Supplier' delivers 100 of the 120 sheets on PO-2612-004: From PO → pick PO-2612-004 → tick 'FOAM-2IN' → Received '100' → Received By 'Ahmad bin Ismail' → Supplier DO No. 'DO-88123' → Create GRN → Open GRN → Mark In Transit → Mark At Customs → Mark Arrived → Post to Stock. The PO is now PARTIAL_RECEIVED (83%).",
    related: ["create-purchase-order", "record-purchase-invoice", "stock-adjustment"],
    nextStep: "Record the supplier's invoice for these goods (record-purchase-invoice) — \"Convert to Invoice\" on the GRN pre-fills it.",
    contact: "Store supervisor / procurement lead.",
    variants: [
      {
        // src/api/routes/grn.ts:1523,1546 — no PO → ARRIVED → born POSTED
        // src/pages/procurement/grn/create.tsx:582-590 — manual: supplier + a line with name and qty required
        // src/api/routes/grn.ts:1482 — manual GRN: duplicate Supplier DO No. for the same supplier refused
        case: "Goods without a PO (manual GRN)",
        differences: [
          "Start with \"Create GRN\" on the Goods Receipt list instead of \"From PO\".",
          "Pick the supplier in \"Supplier *\", click \"Add Line\" and fill \"Material Name *\", \"Received\" and \"Unit Price (RM)\" per line; at least one line with a name and received quantity is required.",
          "The save button reads \"Receive & Post to Stock\": the receipt is posted to stock immediately — no arrival steps.",
          "A \"Supplier DO No.\" already used on another GRN of the same supplier is refused as a duplicate.",
        ],
      },
      {
        // src/pages/procurement/grn/create.tsx:963-1000 — Shipment Details (PO-linked only)
        // src/pages/procurement/grn-detail.tsx:86-88 — arrival advance labels; :762 — Post disabled until Arrived
        case: "Imported / foreign supplier shipment (sea, air, customs)",
        differences: [
          "Open \"Shipment Details\" on the new GRN and fill \"Shipping Method\", \"Carrier\" and \"Expected Arrival\".",
          "Advance the GRN as the shipment moves: \"Mark In Transit\" when it ships, \"Mark At Customs\" at customs, \"Mark Arrived\" when it reaches the factory — only then \"Post to Stock\".",
          "Landed cost can be entered on the GRN page (\"Landed Cost (MYR)\").",
        ],
      },
      {
        // src/pages/procurement/grn/create.tsx — "Purchase company" select; letterhead only
        case: "Purchase company",
        differences: [
          "\"Purchase company\" is taken from the PO and only changes the letterhead on the printed GRN; stock and accounting are the same for every company.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "record-purchase-invoice",
    title: "Record a supplier (purchase) invoice",
    keywords: [
      "purchase invoice", "supplier invoice", "PI", "bill from supplier", "enter supplier bill",
      "供应商发票", "采购发票", "进货发票", "录发票", "供应商账单",
      "invois pembekal", "invois belian", "bil pembekal",
    ],
    module: "Procurement",
    companies: ["ALL"],
    purpose:
      "Record what the supplier billed, so the amount owed (accounts payable) is booked and the invoice can be paid. Confirming the invoice posts it to the ledger.",
    prerequisites: [
      "The supplier's invoice (paper or PDF) is in hand.",
      // src/api/routes/purchase-invoices.ts:1626 — only a POSTED goods receipt can be invoiced
      "Normally a PO, and ideally a POSTED GRN, exists for the goods — a GRN that is not yet posted cannot be invoiced.",
      // src/pages/procurement/detail.tsx:798 + backend 409 — one live invoice per PO
      "The PO does not already have a live invoice (its \"Create Invoice\" button then shows \"Invoiced\").",
    ],
    who: "Procurement / accounts-payable clerk.",
    // src/api/routes/purchase-invoices.ts:1433 — POST requires purchase-invoices:create; :2319 — PUT (Confirm) requires purchase-invoices:update
    permission: ["purchase-invoices:create", "purchase-invoices:update"],
    page: "/procurement/pi/create",
    sidebar: "PROCUREMENT → Purchase Invoice",
    steps: [
      {
        do: "Open PROCUREMENT → Purchase Invoice and click \"Create Invoice\". (Shortcuts: \"Convert to Invoice\" on a posted GRN, or \"Create Invoice\" on the PO page, pre-fill everything.)",
        page: "/procurement/pi",
        highlight: "Create Invoice",
        then: "The \"New Purchase Invoice\" page opens.",
      },
      {
        do: "Click \"Convert from GR or PO\". In the window choose the \"Goods Receipts (GRN)\" tab (or \"Purchase Orders\"), click the document, tick the lines on this invoice, and click the \"Add\" lines button.",
        highlight: "Convert from GR or PO",
        // src/api/routes/purchase-invoices.ts:1578 — line-level double-bill guard
        check: "Only lines that appear on the supplier's invoice are ticked. A line already billed on another invoice cannot be billed again beyond what is left.",
        then: "Supplier, purchase company and the lines (description, code, SKU, qty, unit price) are filled in from the GRN / PO.",
      },
      {
        do: "Complete the \"Invoice Details\" card.",
        fields: [
          {
            label: "Supplier *",
            required: true,
            // src/pages/procurement/pi/create.tsx:551 + src/api/routes/purchase-invoices.ts:1485 — supplier required
            value: "Required. Filled by the convert; pick from the list if entering by hand.",
            example: "'SUP-021 - Demo Foam Supplier'",
          },
          {
            label: "Invoice Date *",
            required: true,
            // src/api/routes/purchase-invoices.ts:1489-1494 — future invoice date refused (also on edit :2350)
            value: "Required. The date printed on the supplier's invoice. Must not be in the future — saving is refused, because the payment term is counted from this date.",
            example: "'2026-12-12'",
          },
          {
            label: "Supplier Invoice No.",
            required: false,
            // src/api/routes/purchase-invoices.ts:1547 — number already on a live PI of this supplier is refused as a duplicate
            value: "The supplier's own invoice number. A number already on another live invoice of this supplier is refused as a duplicate.",
            example: "'INV-55120'",
          },
          {
            label: "Supplier DO No.",
            required: false,
            // src/api/routes/purchase-invoices.ts:1547 — same duplicate check covers the DO number
            value: "The supplier's delivery order number (three-way match with the GRN). Also checked for duplicates.",
            example: "'DO-88123'",
          },
          {
            label: "Purchase company",
            required: true,
            value: "Taken from the PO / GRN / supplier. Leave as is.",
            example: "'HOOKKA'",
          },
          {
            label: "Remarks",
            required: false,
            value: "Free text.",
            example: "'Price per quotation Q-778'",
          },
        ],
      },
      {
        do: "Check each line against the supplier's invoice.",
        fields: [
          {
            label: "Qty",
            required: true,
            value: "Quantity billed, in the line's unit.",
            example: "'100'",
          },
          {
            label: "Unit Price (RM)",
            required: true,
            value: "Price per unit as billed, in RM.",
            example: "'18.50'",
          },
          {
            label: "SST (RM)",
            required: false,
            value: "Per-line SST in RM; leave 0 for non-taxable lines. Alternatively type the invoice's total SST in the Summary box and it is spread across lines.",
            example: "'0.00'",
          },
        ],
        // src/pages/procurement/pi/create.tsx:552 — at least one line with a description
        check: "At least one line has a description. The \"Total\" in the Summary equals the supplier invoice total.",
      },
      {
        do: "Click \"Create Invoice\" (top right).",
        highlight: "Create Invoice",
        // src/pages/procurement/pi/create.tsx:561 — created as DRAFT
        then:
          "The invoice is saved as DRAFT with a PI number (a success toast names the new PI number). The Summary note says \"Status will be set to DRAFT — confirm from the invoice detail page when ready.\" You land on the invoice (or are offered to go back to the source document).",
      },
      {
        do: "On the invoice page check it once more and click \"Confirm\".",
        page: "/procurement/pi/:id",
        highlight: "Confirm",
        // src/api/routes/purchase-invoices.ts:2710 — CONFIRMED posts purchase + AP to the GL
        // src/api/routes/purchase-invoices.ts:3055 + src/api/lib/pi-auto-grn.ts — CONFIRMED auto-receives matched, unreceived PO lines via a system GRN
        then:
          "A success toast appears. Status becomes CONFIRMED: the purchase and accounts-payable entries are posted to the ledger, and any line matched to an open PO line that has not been received yet is stocked in automatically through a system GRN. The invoice now shows as an open bill for payment.",
      },
    ],
    checkBefore: [
      "Supplier, \"Invoice Date *\" and \"Supplier Invoice No.\" match the paper invoice.",
      "Quantities and prices match the invoice; the Summary \"Total\" equals the invoice total.",
      "Only one live invoice per PO — the PO's \"Create Invoice\" button shows \"Invoiced\" when one exists.",
    ],
    result:
      "A CONFIRMED purchase invoice on PROCUREMENT → Purchase Invoice; the amount owed appears in Creditor Aging and as an open bill on New AP Payment.",
    warnings: [
      // src/api/routes/purchase-invoices.ts:2710 — GL posting on CONFIRMED; status change refused if the GL posting fails
      "\"Confirm\" posts to the general ledger (purchase + accounts payable). If the posting cannot be built, the status change is not saved.",
      // src/api/lib/pi-auto-grn.ts header — voiding the invoice does not undo the auto receipt
      "\"Confirm\" can also add stock: matched PO lines not yet received are auto-received. Voiding the invoice later does not undo that receipt — cancel the GRN itself.",
      // src/api/routes/purchase-invoices.ts:1489 — future date refused
      "A future invoice date is refused.",
      // src/api/routes/purchase-invoices.ts:389 — DRAFT → CONFIRMED → PAID only; no way back to DRAFT
      "Status only moves forward: DRAFT → CONFIRMED → PAID.",
    ],
    // src/lib/purchase-edit-rules.ts:32 + src/api/routes/purchase-invoices.ts:2387 — editable while DRAFT or CONFIRMED only
    // src/api/routes/purchase-invoices.ts:3165 — only DRAFT invoices can be deleted (purchase-invoices:delete, :3150)
    // src/api/routes/purchase-invoices.ts:3298 + src/api/lib/rbac.ts:349 — Void / Restore only FINANCE, ADMIN or SUPER_ADMIN role
    undo:
      "A DRAFT invoice can be edited (\"Edit\") or removed (\"Delete\" — only DRAFT invoices can be deleted; needs purchase-invoices:delete). A CONFIRMED invoice can still be edited; the ledger is corrected by a correction entry. A PAID or cancelled invoice cannot be edited. To cancel a confirmed invoice use \"Void\" (and \"Restore\" to bring it back) — only the Finance, Admin or Super Admin role can.",
    approvals: "None beyond \"Confirm\".",
    commonMistakes: [
      {
        mistake: "Leaving the invoice as DRAFT, so it never shows as payable.",
        fix: "Open it and click \"Confirm\".",
      },
      {
        mistake: "Typing the date the invoice was received instead of the invoice date.",
        fix: "Use the date printed on the invoice — the payment due date is counted from it.",
      },
      {
        mistake: "Keying lines by hand instead of converting, so the invoice is not linked to the PO / GRN.",
        fix: "Use \"Convert from GR or PO\" (or \"Convert to Invoice\" on the GRN).",
      },
    ],
    workedExample:
      "'Demo Foam Supplier' bills INV-55120 for 100 sheets at RM 18.50: GRN-2612-010 → Convert to Invoice → Invoice Date '2026-12-12' → Supplier Invoice No. 'INV-55120' → total RM 1,850.00 matches → Create Invoice → Confirm.",
    related: ["receive-goods-grn", "record-supplier-payment", "create-purchase-order"],
    nextStep: "Pay the invoice when due (record-supplier-payment).",
    contact: "Accounts-payable / finance desk.",
    variants: [
      {
        // src/api/routes/purchase-invoices.ts:1503,1510 — currency + rate fixed at creation, positive rate required
        // src/api/routes/purchase-invoices.ts:2787 — Mark Paid on a foreign PI needs the payment-day rate
        case: "Foreign-currency supplier invoice (e.g. USD, created through \"Scan PI\")",
        differences: [
          "The invoice is held in its own currency with a booking exchange rate; currency and rate cannot be changed later — a wrong rate means voiding and re-raising the invoice.",
          "Paying it needs the payment-day rate; pay foreign bills on their own AP payment (one currency per payment).",
        ],
      },
      {
        case: "Purchase company",
        differences: [
          "\"Purchase company\" follows the PO / GRN / supplier and only changes the letterhead; the ledger entries are booked in HOOKKA accounting for every company.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "mrp-shortages-to-po",
    title: "Check material shortages (MRP) and raise POs from them",
    keywords: [
      "MRP", "material shortage", "shortages", "what to order", "raw material requirement", "proceed PO",
      "缺料", "物料需求", "缺货", "要订什么料", "缺料开PO",
      "kekurangan bahan", "keperluan bahan mentah", "bahan tak cukup",
    ],
    module: "Procurement",
    companies: ["ALL"],
    purpose:
      "See which raw materials open production orders need but stock and open POs do not cover, and raise the purchase orders for the shortfall in one step.",
    prerequisites: [
      "Production orders exist with BOMs, so material needs can be calculated.",
      // src/api/routes/mrp.ts:551 — every line needs a supplier (MRP_NO_SUPPLIER)
      "Each short material has a supplier, or you pick one on the line.",
    ],
    who: "Planner / procurement staff.",
    // src/api/routes/mrp.ts:421 — GET /plan requires mrp:read; :534 — POST /proceed-po requires purchase-orders:create
    // Both are required together (AND) — the code has no OR gate here, so permissionAny is not used.
    permission: ["mrp:read", "purchase-orders:create"],
    page: "/planning/mrp",
    sidebar: "PROCUREMENT → MRP",
    steps: [
      {
        do: "Open PROCUREMENT → MRP. Click \"REFRESH\" to recalculate.",
        highlight: "REFRESH",
        then: "The table lists each raw material with \"Needed\", \"Stock\", \"PO Outstanding\", \"Short\" and \"Status\" (\"Short\", \"Waiting PO\" or \"Ready\"). Tabs above the table split by material group; a red number on a tab counts short materials.",
      },
      {
        do: "Choose how POs are grouped with the mode switch: \"COMBINED\" (one PO per supplier) or \"PER SO\" (one PO per supplier per order).",
        highlight: "COMBINED",
      },
      {
        do: "Tick the shortage lines to order: the checkbox on a material row ticks all its short lines; or click the row to expand it and tick single production-order lines.",
        // src/pages/planning/mrp.tsx:365-371 — Proceed blocked "Pick a supplier first" when a ticked line has no supplier
        check: "Each ticked line has a supplier in its Supplier column. If it shows \"— choose supplier —\", pick one (\"Other supplier… (will be bound)\" binds a new supplier to the material).",
      },
      {
        do: "Click \"Proceed PO\" (the button shows how many lines are ticked).",
        highlight: "Proceed PO",
        // src/pages/planning/mrp.tsx:361 — "Nothing to order" when no shortage line is ticked
        then: "The \"Proceed PO\" window shows the number of lines and the mode.",
      },
      {
        do: "Optionally set the expected delivery date, then click \"Confirm\".",
        fields: [
          {
            label: "Expected delivery date",
            required: false,
            value: "Date picker. Leave blank to use each order's own need-by date.",
            example: "'2026-12-08'",
          },
        ],
        highlight: "Confirm",
        // src/api/routes/mrp.ts:576 — MRP_PLAN_STALE when a PO was raised after the plan; :593 — MRP_LINE_COVERED when no longer short
        check: "The plan time shown next to REFRESH (as of ...) is recent; if someone ordered since, the system refuses and asks you to refresh.",
        then:
          "\"Purchase orders created\" lists the new PO numbers (status CONFIRMED). Each line orders its current shortage only, never twice; new supplier bindings are saved. Click \"Open Purchase Orders\" to see them, or \"Stay here\". The MRP refreshes and those lines now show as covered.",
      },
    ],
    checkBefore: [
      "The plan was refreshed recently.",
      "Every ticked line has the right supplier.",
      "The mode (\"COMBINED\" / \"PER SO\") is the one you want.",
    ],
    result:
      "CONFIRMED purchase orders on PROCUREMENT → Purchase Order, one per supplier (or per supplier per order); the MRP shows those quantities as \"PO Outstanding\".",
    warnings: [
      // src/pages/planning/mrp.tsx:382-386 — one server call, all or nothing
      "\"Confirm\" creates real, active POs immediately — all of them or none.",
      "The POs are not emailed — open each and use \"Email to Supplier\".",
      "Picking \"Other supplier… (will be bound)\" permanently links that supplier to the material.",
      // src/api/routes/mrp.ts:576,593 — stale plan / covered lines refused, nothing ordered
      "If a PO for the same materials was raised after your plan was calculated, or a line is no longer short, nothing is ordered until you refresh.",
    ],
    // src/api/routes/purchase-orders.ts:892 — PO edit/cancel needs purchase-orders:update
    undo:
      "Open each PO and \"Edit\" it (while nothing is received) or \"Cancel PO\" with a reason of at least 10 characters. Needs purchase-orders:update.",
    approvals: "None.",
    commonMistakes: [
      {
        mistake: "\"Pick a supplier first\" appears on Proceed PO.",
        fix: "Expand the listed materials and choose a supplier in each short line's Supplier column.",
      },
      {
        mistake: "\"Plan changed — refresh first\" appears.",
        fix: "Click \"Refresh now\", re-tick the lines and Proceed PO again — nothing was ordered.",
      },
      {
        mistake: "Assuming suppliers were informed.",
        fix: "Open each new PO and click \"Email to Supplier\".",
      },
    ],
    workedExample:
      "MRP shows 'FAB-GREY-01' short 180 MTR for three production orders: tick the material row → supplier 'Demo Fabric Trading' → COMBINED → Proceed PO (3) → Confirm → one PO for 180 MTR is created → Open Purchase Orders → Email to Supplier.",
    related: ["create-purchase-order", "create-production-order", "receive-goods-grn"],
    nextStep: "Email each new PO to its supplier (create-purchase-order, last step).",
    contact: "Planning lead / procurement lead.",
    variants: [
      {
        // src/pages/planning/mrp.tsx:400 — mode combined | perso sent to /api/mrp/proceed-po
        case: "Ordering per sales order instead of combined",
        differences: [
          "Switch to \"PER SO\" before \"Proceed PO\": one PO is created per supplier per order instead of one per supplier.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "add-po-note",
    title: "Add or change a note on a purchase order",
    keywords: [
      "PO note", "add note", "PO remark", "edit PO notes", "delivery instruction",
      "备注", "加备注", "PO备注", "采购单备注",
      "nota", "catatan PO", "tambah nota",
    ],
    module: "Procurement",
    companies: ["ALL"],
    purpose:
      "Put delivery instructions, payment terms or other remarks on a PO. There is no separate notes thread: the PO has one \"Notes\" field, set on creation and changed through \"Edit\".",
    prerequisites: [
      // src/pages/procurement/detail.tsx:697 — Edit shown only when not cancelled / RECEIVED / CLOSED, no posted GRN, nothing received
      "The PO exists and nothing has been received against it yet (no posted GRN, not RECEIVED / CLOSED / CANCELLED) — otherwise \"Edit\" is not shown.",
    ],
    who: "Purchasing / procurement staff.",
    // src/api/routes/purchase-orders.ts:892 — PUT requires purchase-orders:update
    permission: ["purchase-orders:update"],
    page: "/procurement",
    sidebar: "PROCUREMENT → Purchase Order",
    steps: [
      {
        do: "Open PROCUREMENT → Purchase Order and double-click the PO to open it.",
        then: "The PO page opens; existing notes show under \"Order Details\" → \"Notes\".",
      },
      {
        do: "Click \"Edit\" at the top right.",
        page: "/procurement/:id",
        highlight: "Edit",
        then: "The \"Edit Purchase Order\" card opens.",
      },
      {
        do: "Type the note in the \"Notes\" field. Keep the existing text and add the new remark after it — whatever is in the field replaces the old notes.",
        page: "/procurement/:id",
        fields: [
          {
            label: "Notes",
            required: false,
            // src/pages/procurement/detail.tsx:438 — notes sent whole in the PUT payload (replaces)
            value: "Free text. Replaces the PO's notes on save.",
            example: "'Supplier agreed delivery split: 60 on 5 Dec, 60 on 12 Dec'",
          },
        ],
      },
      {
        do: "Click \"Save Changes\".",
        page: "/procurement/:id",
        highlight: "Save Changes",
        then:
          "Toast \"Purchase order updated\". The note shows under \"Notes\" on the PO page and prints on the PO PDF. The supplier is not told — re-send with \"Resend Email\" / \"Email to Supplier\" if they need it.",
      },
    ],
    checkBefore: [
      "You kept the earlier notes you still need.",
      "You did not change lines or the delivery date by accident while in edit mode.",
    ],
    result: "The PO's notes are updated; visible on the PO page and on the printed / emailed PO.",
    warnings: [
      "Saving replaces the whole notes text.",
      // src/api/routes/purchase-orders.ts:915 — stale save refused (409)
      "If someone else saved the PO after you opened it, the save is refused — reload and redo the edit.",
      // src/pages/procurement/detail.tsx:697 — no Edit after receipt
      "Once goods are received the PO can no longer be edited from the page.",
      // src/pages/procurement/detail.tsx:490 — cancel / close reason appended to notes as a tagged line
      "\"Cancel PO\" and \"Close PO\" append their reason to the notes automatically.",
    ],
    undo: "Click \"Edit\" again, correct the \"Notes\" text and \"Save Changes\". Same permission (purchase-orders:update).",
    commonMistakes: [
      {
        mistake: "Looking for \"Edit\" on a PO that has already been received.",
        fix: "Edit is hidden after receipt. For a short delivery use \"Close PO\" — its reason is appended to the notes. Otherwise ask the procurement lead.",
      },
      {
        mistake: "Deleting the old notes when adding a new one.",
        fix: "Add to the existing text instead of overwriting it.",
      },
    ],
    workedExample:
      "PO-2612-004 for 'Demo Foam Supplier': open it → Edit → Notes: add 'Deliver after 2pm, gate 3' → Save Changes → Resend Email.",
    related: ["create-purchase-order", "receive-goods-grn"],
    contact: "Procurement lead.",
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "record-supplier-payment",
    title: "Pay a supplier (AP Payment)",
    keywords: [
      "supplier payment", "pay supplier", "AP payment", "payment voucher", "pay invoice", "knock off",
      "付款", "付供应商", "供应商付款", "付款单", "还款",
      "bayar pembekal", "pembayaran pembekal", "baucar bayaran",
    ],
    module: "Finance",
    companies: ["ALL"],
    purpose:
      "Record money paid to a supplier against its confirmed purchase invoices, so the bills are knocked off and the bank is credited in the ledger.",
    prerequisites: [
      // src/api/routes/accounting.ts:13157 — a bill must be an open bill of this creditor
      "The supplier's purchase invoices are CONFIRMED and still outstanding (draft or fully paid invoices are not offered).",
      "You know the bank / cash account paid from and the payment reference (TT or cheque number).",
    ],
    who: "Finance / accounts-payable staff; approval by the finance approver.",
    // src/api/routes/accounting.ts:13845 — POST /payment-vouchers requires accounting:create
    permission: ["accounting:create"],
    page: "/accounting",
    sidebar: "FINANCE → Daily → Payment Vouchers",
    steps: [
      {
        do: "Open FINANCE → Daily → Payment Vouchers and click \"New AP Payment\" (top right).",
        highlight: "New AP Payment",
        then: "The \"New AP payment\" window opens on the \"Supplier (purchase invoices)\" choice.",
      },
      {
        do: "Fill the \"Header\" section.",
        fields: [
          {
            label: "Supplier *",
            required: true,
            // src/api/routes/accounting.ts:13108 — "Pick the creditor to pay"
            value: "Required. Type the supplier code or name and pick it. Its open bills load below.",
            example: "'SUP-021 - Demo Foam Supplier'",
          },
          {
            label: "Payment date *",
            required: true,
            // src/api/routes/accounting.ts:13855 — date must be YYYY-MM-DD
            value: "Required. Date the money left the bank (YYYY-MM-DD).",
            example: "'2026-12-20'",
          },
          {
            label: "Paid from (credit) *",
            required: true,
            // src/api/routes/accounting.ts:13119-13125 — trade-finance drawdown rules (supplier only, due date not before payment date)
            value: "Required. The bank or cash account that paid. A trade-finance line can also be chosen (then no bank money moves now and a due date is required, not before the payment date).",
            example: "'310-B001 · Maybank Current'",
          },
          {
            label: "Reference",
            required: false,
            value: "TT reference or cheque number, up to 120 characters. Printed.",
            example: "'TT 778812'",
          },
          {
            label: "Description",
            required: false,
            value: "Printed on the voucher.",
            example: "'Dec foam invoices'",
          },
        ],
      },
      {
        do: "In the bills table tick each bill being paid (ticking pays it in full); for a part payment, type the amount in the Pay column instead.",
        fields: [
          {
            label: "Pay (",
            required: true,
            // src/api/routes/accounting.ts:13154 — amounts must be positive; :13178 — amount may not exceed what is still payable; :13191 — tick at least one bill or enter an advance
            value: "Amount in RM, two decimals, positive, not more than what is still payable on that bill. At least one bill (or an advance) is needed.",
            example: "'1850.00'",
          },
          {
            label: "Advance / unallocated (RM)",
            required: false,
            // src/api/routes/accounting.ts:13185 — advance only for suppliers; :13184 — no advance on a foreign-currency payment
            value: "Money paid on top of the bills; sits as a prepayment on the supplier to knock off later. Not allowed on a foreign-currency payment.",
            example: "'0.00'",
          },
        ],
        check: "The \"Total\" equals the amount on the bank slip.",
      },
      {
        do: "Click \"Save as draft\" to send it for approval (normal route), or \"Post now\" to post immediately.",
        highlight: "Save as draft",
        // src/api/routes/accounting.ts:13873 — saveAs draft: no number, no ledger legs; otherwise POSTED + APPROVED at once
        then:
          "\"Save as draft\": toast \"Draft saved — Prepare it when ready\" — no number yet, nothing knocked off. \"Post now\": toast \"AP payment posted — bills knocked off\" — a PV number is issued, the bills' outstanding drops and the ledger is posted (DR creditor control, CR the paid-from account).",
      },
      {
        do: "For a draft: right-click the voucher row (or its ⋮ menu) and choose \"Prepare →\". The checker then chooses \"Check →\" (the formal PV number is given here) and the approver chooses \"Approve & post\".",
        highlight: "Prepare →",
        // src/api/routes/accounting.ts:14134-14177 — DRAFT → PREPARED → CHECKED → APPROVED, each only from the previous state
        then: "After \"Approve & post\" the payment is posted and the bills are knocked off; the voucher shows as Approved.",
      },
    ],
    checkBefore: [
      "Right supplier and right bills ticked; amounts do not exceed \"Outstanding\".",
      "\"Paid from (credit) *\" is the bank that actually paid, and \"Payment date *\" matches the bank statement.",
      "\"Total\" equals the bank slip.",
    ],
    result:
      "An AP Payment voucher on Payment Vouchers; the paid invoices' outstanding goes down (fully paid ones drop out of Creditor Aging); the bank account is credited in the general ledger once posted.",
    warnings: [
      "\"Post now\" and \"Approve & post\" post to the ledger and knock off the bills.",
      "This records a payment; it does not transfer money — pay through the bank first.",
      // src/api/routes/accounting.ts:13160,13173 — one currency per payment
      "One currency per payment: RM bills and foreign-currency bills go on separate AP payments.",
      // src/api/routes/accounting.ts:13109 — an AP payment cannot be accrued
      "An AP payment cannot be accrued — the bill already carries the liability.",
      "Prefer this over \"Mark Paid\" on the invoice page, so the payment carries a voucher, the bank account and the approval ladder.",
    ],
    // src/pages/accounting/index.tsx:12711 — Edit only for DRAFT / PREPARED AP payments
    // src/api/routes/accounting.ts:14142,14150 — Withdraw only from PREPARED; Reject from PREPARED/CHECKED and needs a reason
    // src/api/routes/accounting.ts:14434 — void/delete lifecycle requires accounting:update
    undo:
      "A draft or prepared voucher can be changed with \"Edit\" (row menu); a prepared one can be sent back with \"Withdraw\", and a prepared or checked one with \"Reject\" (a reason is required). A posted voucher is voided from its row menu (needs accounting:update), which reverses its ledger entries and reopens the bills.",
    // src/api/routes/accounting.ts:14093 — PV_APPROVAL_PERM: prepare=update, check=check, approve=approve, reject=check
    // src/api/routes/accounting.ts:13873 — "Post now" (no saveAs draft) posts directly with accounting:create
    approvals:
      "Draft route: \"Prepare →\" (accounting:update) → \"Check →\" (accounting:check) → \"Approve & post\" (accounting:approve); each step only from the one before. \"Reject\" needs accounting:check. \"Remind approver\" nudges the approver. \"Post now\" skips the ladder.",
    commonMistakes: [
      {
        mistake: "The supplier shows \"No open bills for this creditor.\"",
        fix: "Its invoices are still DRAFT or already paid — open PROCUREMENT → Purchase Invoice and \"Confirm\" the invoice first.",
      },
      {
        mistake: "Saving as draft and assuming the supplier is paid in the books.",
        fix: "Take the draft through \"Prepare →\", \"Check →\" and \"Approve & post\".",
      },
      {
        mistake: "Paying more than the bills by mistake, creating an advance.",
        fix: "Leave \"Advance / unallocated (RM)\" empty unless you really prepaid; an existing advance is applied on the Supplier Payment page.",
      },
    ],
    workedExample:
      "Pay 'Demo Foam Supplier' RM 1,850.00 for INV-55120 by TT: New AP Payment → Supplier 'Demo Foam Supplier' → Payment date '2026-12-20' → Paid from 'Maybank Current' → Reference 'TT 778812' → tick the PI → Total RM 1,850.00 → Save as draft → Prepare → (checker) Check → (approver) Approve & post.",
    related: ["record-purchase-invoice", "receive-goods-grn"],
    contact: "Finance manager / accounts-payable lead.",
    variants: [
      {
        // src/api/routes/accounting.ts:13163 — foreign bills need the payment's rate; :13184 — no advance
        case: "Foreign-currency supplier (bills in USD, RMB, …)",
        differences: [
          "Tick only bills of one currency; the payment needs that currency's rate (RM per 1 unit), pre-filled from Setup when the month's rate exists. The FX gain or loss against the invoice rate is shown and posted.",
          "No advance can be paid on a foreign-currency payment.",
        ],
      },
      {
        // src/api/routes/accounting.ts:13119-13127 — trade-finance drawdown rules
        case: "Paid through a trade-finance line",
        differences: [
          "Pick the trade-finance line in \"Paid from (credit) *\": the lender pays the supplier, no bank money moves now, and \"Due date *\" (not before the payment date) and \"Interest at drawdown (RM)\" are asked for.",
        ],
      },
      {
        case: "Other creditor instead of a supplier",
        differences: [
          "Choose \"Other creditor (bills)\" at the top; pick the creditor in \"Other creditor *\". Advances are only for suppliers.",
        ],
      },
    ],
  },
];
