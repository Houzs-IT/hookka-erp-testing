// ---------------------------------------------------------------------------
// howto/guides-production.ts — "how do I…" guides for PRODUCTION, the worker
// phone app, QC, FG scan, planning and outsource work. Written from the real
// frontend + API code (see types.ts for the rules the test enforces). Every
// enforced business rule carries a code citation in a comment next to it.
// ---------------------------------------------------------------------------
import type { HowToGuide } from "./types";

export const GUIDES: HowToGuide[] = [
  // -------------------------------------------------------------------------
  {
    id: "create-production-order",
    title: "Create production orders and job cards, then view and print the job cards",
    keywords: [
      "production order", "job card", "create production order", "print job card", "QR sticker", "stock PO",
      "生产单", "工单", "开生产单", "打印工单", "贴纸", "二维码",
      "pesanan pengeluaran", "kad kerja", "cetak kad kerja", "pelekat",
    ],
    module: "Production",
    companies: ["ALL"],
    purpose:
      `Production orders and their job cards are NOT typed in by hand. They are created automatically when a Sales Order (or Consignment Order) is confirmed: one production order per piece for bed frames / accessories, one per line for a sofa, each with one job card per department step from the product's BOM. Use this guide to trigger that, find the orders on the Production board, and print the job-card QR stickers the floor scans. A stock (make-to-stock) order is the only one created on the Production page itself.`,
    prerequisites: [
      // src/pages/sales/detail.tsx:1560 — "Confirm Order" only renders for DRAFT; src/api/routes/sales-orders.ts:2649 — refuses any other status
      `The Sales Order is in DRAFT status (only DRAFT orders can be confirmed).`,
      // src/api/routes/sales-orders.ts:2728 — 422 "BOM incomplete — cannot confirm", order stays DRAFT
      `Every product on the order has a complete BOM — otherwise confirm is refused and the order stays DRAFT.`,
      // src/api/routes/sales-orders.ts:2608 — refuses when no hub and the customer has hubs configured
      `If the customer has delivery hubs, a hub is selected (customers without hubs are exempt).`,
      // src/api/routes/sales-orders.ts:2677 — refuses a duplicate customer PO for the same customer
      `The customer PO number is not already used on another live order of the same customer.`,
      // src/api/routes/sales-orders.ts:2701 — refuses mixed SOFA + BEDFRAME lines
      `Sofa and bed-frame lines are not on the same order.`,
      // src/api/routes/sales-orders.ts:2714 — refuses a SOFA line with quantity above 1
      `Every sofa line has quantity 1.`,
    ],
    who:
      `Sales admin / sales coordinator confirms the order (sales-orders confirm; for a consignment order, consignments create). Production admin / planner views the board and prints stickers (production-orders read; Create Stock PO needs production-orders create).`,
    permission: ["production-orders:read"],
    // src/api/routes/sales-orders.ts:2567 — sales-orders:confirm; src/api/routes/consignment-orders.ts:1682 — consignments:create
    permissionAny: ["sales-orders:confirm", "consignments:create"],
    page: "/sales",
    sidebar: "SALES & CUSTOMERS → Sales Orders",
    steps: [
      {
        do: `Go to SALES & CUSTOMERS → Sales Orders and open the DRAFT order (double-click its row).`,
        page: "/sales",
        check: `The status shows DRAFT, the hub is set, and every line has the right product, size, fabric and quantity — after confirm these become production orders.`,
      },
      {
        do: `In the "Actions:" bar press "Confirm Order".`,
        page: "/sales/:id",
        highlight: "Confirm Order",
        then: `A dialog "Confirm Sales Order" opens explaining that production orders will be created for all line items.`,
      },
      {
        do: `In the dialog press "Confirm & Create POs".`,
        page: "/sales/:id",
        highlight: "Confirm & Create POs",
        check: `Read the dialog once more — confirming is the lock-in moment.`,
        // src/api/routes/sales-orders.ts:2780 — free stock auto-allocated first; :2831 — SO set to IN_PRODUCTION
        then: `The system first allocates any free finished stock to the order, then creates production orders only for what stock could not cover, each with its job cards. The Sales Order moves to IN_PRODUCTION. If a BOM is incomplete you get "Cannot Confirm — BOM Incomplete" with the product list and the order stays DRAFT.`,
      },
      {
        do: `Scroll down to "Linked Production Orders" on the same page to see the new orders, their current department, progress and status.`,
        page: "/sales/:id",
        highlight: "Linked Production Orders",
        check: `There is one row per piece you expect to be built (lines filled from stock have no production order).`,
      },
      {
        do: `Go to PRODUCTION → Production → Overview ("Production Tracking") and type the SO number in the search box "Search SO / customer / model / fabric…" to see the orders across all departments.`,
        page: "/production",
        highlight: "Production Tracking",
        fields: [
          { label: "Search SO / customer / model / fabric…", required: false, value: `Free text — SO number, customer, model or fabric.`, example: `'SO-2611-045'` },
        ],
      },
      {
        do: `To print job-card stickers, open the department page in the sidebar (for example PRODUCTION → Production → Fab Cut). In the "QR Stickers" panel press "Show QR" to preview the tiles, then "Print All".`,
        page: "/production/fab-cut",
        highlight: "Print All",
        check: `The sticker count in the "QR Stickers" heading matches the rows on the production sheet after your filters — the print uses exactly what the sheet shows.`,
        then: `A print view opens with one QR sticker per job card (Fab Cut / Fab Sew use the large 100×150 mm sticker). On Fab Cut you can also press "Print Fab Sew Stickers" for the next stage. On Upholstery and Packing use "Print Packing Stickers" instead.`,
      },
      {
        do: `Optional — to print the floor schedule, pick the mode ("Detailed" or "Total Listing") next to "Mode:" and press "Print Schedule".`,
        page: "/production/fab-cut",
        highlight: "Print Schedule",
      },
      {
        // src/pages/production/index.tsx:1711 — button only shown with production-orders:create; src/api/routes/production-orders.ts:1268 — same gate on the API
        do: `Optional — to build for stock (no customer order), on the Production page press "Create Stock PO". In "Create Stock Production Order" pick the "Type" (WIP or FG), pick the item from the list of historical items, then fill the fields and press "Create Stock PO".`,
        page: "/production",
        highlight: "Create Stock PO",
        fields: [
          // src/api/routes/production-orders.ts:1284 — type must be WIP or FG
          { label: "Type", required: true, value: `WIP (a sub-assembly such as a divan) or FG (a full finished good). An item from the list must be picked.`, example: `'FG'` },
          // src/api/routes/production-orders.ts:1296 — quantity must be >= 1; :1405 — one order per piece except a sofa set
          { label: "Quantity", required: true, value: `Whole number, 1 or more. Non-sofa items become one production order per piece; a sofa set stays one order.`, example: `'4'` },
          // src/api/routes/production-orders.ts:1300 — targetEndDate must be YYYY-MM-DD
          { label: "Target End Date", required: true, value: `Date, YYYY-MM-DD.`, example: `'2026-12-15'` },
        ],
        then: `A stock sales order plus its production orders and job cards are created; they appear on the Production board.`,
      },
    ],
    checkBefore: [
      `The order is DRAFT and all lines are final — changing lines after confirm means cancelling the production orders.`,
      `Hub selected (if the customer has hubs) and the customer PO is unique.`,
      `BOMs of all products are complete; no sofa and bed frame on one order; sofa lines qty 1.`,
    ],
    result:
      `The Sales Order becomes IN_PRODUCTION; production orders and job cards exist and show under "Linked Production Orders" on the order and on every PRODUCTION → Production department page, ready for stickers and scanning.`,
    warnings: [
      `Confirming locks the order in: it allocates free stock and creates production orders and job cards.`,
      // src/api/routes/production-orders.ts:2118 — scans of an ON_HOLD order are refused; :2133 — cancelled orders cannot be scanned
      `Pausing a production order (the pause icon in "Linked Production Orders") stops all scanning of it until it is resumed; a cancelled order can never be scanned.`,
      `Printed stickers carry the QR of the website you printed from — print from the live ERP, not a test site.`,
    ],
    // src/api/routes/production-orders.ts:4244 — cancel needs production-orders:update; src/pages/sales/detail.tsx:917 — reason of 3+ characters; src/api/routes/sales-orders.ts:2639 — re-confirm only when every PO is cancelled
    undo:
      `On the Sales Order, in "Linked Production Orders", the red X button "Cancel this PO (also cancels its non-completed job cards)" cancels a production order (needs production-orders update; a reason of 3+ characters is asked). Completed work stays. When every production order of the order is cancelled, the confirm can be run again to rebuild them from the current lines; while any is still active the re-confirm is refused. Ask the Production Manager.`,
    commonMistakes: [
      { mistake: `Trying to create a production order by hand for a customer order.`, fix: `Confirm the Sales Order instead — that is the only way customer production orders are created.` },
      { mistake: `Confirm fails with "Cannot Confirm — BOM Incomplete".`, fix: `Ask R&D / BOM admin to complete the listed products' BOMs, then press "Confirm Order" again.` },
      { mistake: `Confirm refused with "Sofa and Bedframe cannot be on the same Sales Order. Please split into two orders."`, fix: `Split the order into one sofa order and one bed-frame order.` },
      { mistake: `Printing stickers with a filter still on, so some job cards have no sticker.`, fix: `Clear the filters (or set them to the batch you want) and check the count in "QR Stickers" before "Print All".` },
    ],
    workedExample:
      `Sales admin Mei confirms SO-2611-045 (2 queen bed frames for Bayu Home). Two production orders appear under "Linked Production Orders". Planner Hafiz opens PRODUCTION → Production → Fab Cut, searches SO-2611-045, presses "Show QR" then "Print All", and hands the stickers to the cutting line.`,
    related: ["create-sales-order", "production-planning", "worker-scan-job-card", "mrp-shortages-to-po"],
    nextStep: `Workers scan the stickers on their phones as each department finishes (guide: worker-scan-job-card).`,
    contact: "Production Manager",
    variants: [
      {
        // src/api/routes/_shared/production-builder.ts:524 — sofa = one PO per line; others one PO per piece
        case: "Bed frame / accessory vs sofa",
        differences: [
          `Bed frame and accessory lines become one production order per piece (qty 3 = 3 orders).`,
          // src/lib/so-category.ts:55 — sofa qty must be 1 per line
          `A sofa line is one production order for the whole set, and must have quantity 1 — otherwise confirm is refused with "Sofa lines must use 1 unit each. Add separate lines for additional units (each line qty=1)."`,
        ],
      },
      {
        // src/api/routes/consignment-orders.ts:1682 — consignments:create; same createProductionOrdersForOrder engine
        case: "Consignment order",
        differences: [
          `Open SALES & CUSTOMERS → Consignment → Consignment Order instead; the same "Confirm Order" then "Confirm & Create POs" buttons create the production orders (needs consignments create).`,
        ],
      },
      {
        case: "Confirming straight from the new-order form",
        differences: [
          // src/pages/sales/create.tsx:2127 — "Create Order" saves and immediately calls /confirm
          `On the new Sales Order form, "Create Order" saves and confirms in one go (same checks); "Save as Draft" only saves.`,
        ],
      },
      {
        // src/api/routes/sales-orders.ts:2780 — allocation runs before PO creation
        case: "Free finished stock already available",
        differences: [
          `Lines covered by free stock are allocated and get no production order; a line fully covered shows "Filled entirely from stock — nothing to produce."`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "worker-scan-job-card",
    title: "Worker: log in on the phone and scan a job card to complete a department task",
    keywords: [
      "worker app", "worker login", "PIN", "scan job card", "complete job card", "department QR", "clock in",
      "扫码", "扫描", "工单", "员工登录", "完成工单", "打卡",
      "imbas", "kad kerja", "log masuk pekerja", "siap", "punch in",
    ],
    module: "Production",
    companies: ["ALL"],
    purpose:
      `A shop-floor worker marks a job card done for his department by scanning its QR sticker on his own phone. The scan credits the job's standard minutes to the worker's production hours and moves the work to the next department.`,
    prerequisites: [
      // src/api/routes/worker-auth.ts:155 — inactive employee refused
      `The worker exists in HR as an active employee with an employee number and a department.`,
      `Job-card stickers have been printed (guide: create-production-order).`,
      // src/api/routes/worker.ts:1286 — clock refused without location; src/pages/worker/index.tsx:692 — punch needs a photo
      `The phone allows camera and location for the browser — clock-in is refused without location and needs a photo.`,
      // src/api/lib/scan-gate.ts:47 — must be punched in and not punched out today
      `You are clocked in today and not yet clocked out.`,
      // src/api/lib/scan-gate.ts:51 — a department QR must be scanned today
      `You scanned your department QR today.`,
      // src/api/routes/production-orders.ts:2118 / :2133 — ON_HOLD or cancelled orders cannot be scanned
      `The production order is not paused (ON_HOLD) or cancelled.`,
    ],
    who:
      `Production workers, on their own phone with their own employee number + 6-digit PIN (the worker portal, not an ERP user account).`,
    permission: ["worker-portal:use"],
    page: "/worker/login",
    sidebar: "Not in the ERP sidebar — the worker opens /worker/login on the ERP website on the phone (add it to the home screen).",
    steps: [
      {
        do: `On the phone open the ERP website at /worker/login. Type your "Employee No", then tap your 6-digit "PIN" on the keypad.`,
        page: "/worker/login",
        highlight: "Employee No",
        fields: [
          { label: "Employee No", required: true, value: `Your employee number from HR (not case-sensitive).`, example: `'EMP-0088'` },
          // src/api/routes/worker-auth.ts:257 — PIN must be 6 digits; :139 — 10 attempts per 15 minutes per employee number
          { label: "PIN", required: true, value: `Exactly 6 digits, tapped on the keypad; the app signs in by itself after the 6th digit. More than 10 tries in 15 minutes is blocked for a while.`, example: `'482916'` },
        ],
        // src/api/routes/worker-auth.ts:169 — no PIN on file → setup screen; :279 — reset needs matching last 4 phone digits
        then: `You land on the worker home screen. First time ever: the screen "First-time setup" asks you to create a PIN — enter it in "New PIN" and again in "Confirm PIN". Forgotten PIN: tap "Forgot PIN?" and give the last 4 digits of the phone number HR has on file (it must match).`,
      },
      {
        do: `On the home screen tap "Clock in" (take the photo it asks for; location must be on).`,
        page: "/worker",
        highlight: "Clock in",
        then: `Your punch-in time shows. Without a punch-in the system refuses job-card completions.`,
      },
      {
        // src/api/routes/worker.ts:1576 — department scan refused before punch-in
        do: `Scan the department QR poster of the line you are working at: tap "Scan" in the bottom bar (or "SCAN JOB CARD" on home) and point the camera at the department QR.`,
        page: "/worker/scan",
        highlight: "Scan",
        then: `A green box shows "Now working in" with the department name. Your hours count to that department from now. Scan again when you move to another line.`,
      },
      {
        do: `Scan the job-card sticker of the piece you finished: tap "Scan QR / Barcode" and point at the sticker QR. If the camera will not read it, use "Upload photo", or type the number under the barcode in "Manual entry" and tap the search button.`,
        page: "/worker/scan",
        highlight: "Scan QR / Barcode",
        fields: [
          { label: "Number under the barcode · PO · Job card", required: false, value: `Only when the camera fails: the number printed under the barcode, or the PO / job card number.`, example: `'PO-2611-0451-01'` },
        ],
        check: `The card shown has the right PO number, customer, product and size, and the department matches where you are.`,
      },
      {
        do: `Tap "Complete".`,
        page: "/worker/scan",
        highlight: "Complete",
        // src/api/routes/production-orders.ts:2407 / :3593 — max 2 PICs per piece / department
        then: `The job card is completed with you as PIC (up to 2 workers can share one piece). Its standard minutes count to your production hours for today; the WIP moves on to the next department. When Fab Cut completes, the raw material is consumed; when Upholstery completes, the piece becomes finished-goods stock. On a Packing sticker the app then asks for the "Rack number" — pick it and tap "Save".`,
      },
    ],
    checkBefore: [
      `You are clocked in and have scanned the department QR of the line you are at today.`,
      `The sticker you scan is for your department and the piece is really finished.`,
    ],
    result:
      `The job card shows as done for your department on PRODUCTION → Production (the department pill turns DONE) and the minutes appear in your hours on the worker home / History.`,
    warnings: [
      `Completing a job card moves WIP stock and credits production time — only scan pieces that are really finished.`,
      `Fab Cut completion consumes the raw material for that production order.`,
      // src/api/lib/scan-gate.ts:56 — card department must equal the last department QR scanned
      `The card must belong to the department you last scanned; otherwise it is refused until you scan that department's QR.`,
      // src/api/routes/production-orders.ts:2354 / :2407 — same worker cannot take both slots; no third PIC
      `You cannot scan the same piece twice, and a third person cannot scan a piece that already has 2 PICs.`,
      // src/api/routes/qc-pending.ts:2309-2314 — a WIP QC FAIL resets the card to BLOCKED and zeroes its production time
      `If a quality check FAILs your job card, it is reset to BLOCKED, your PIC slot is cleared and its production minutes are taken off — rework it and scan again.`,
    ],
    // src/pages/production/index.tsx:3708 — clearing the completion date reverts the card to WAITING; src/api/routes/production-orders.ts:4199 — PATCH needs production-orders:update
    undo:
      `A worker cannot undo a scan. The production office opens the department page of PRODUCTION → Production and clears the completion date on the department pill (the card goes back to WAITING) — needs production-orders update. Ask your supervisor.`,
    // src/api/lib/scan-gate.ts:47 — punched in and not yet punched out, Malaysia day
    deadlines: `Completions count only while you are punched in today (Malaysia time); after punch-out the scan is refused until you punch in again.`,
    commonMistakes: [
      { mistake: `Scan refused with "Please punch in first, then scan the department code."`, fix: `Tap "Clock in" on home, scan the department QR, then scan the sticker again.` },
      { mistake: `"Wrong department" appears.`, fix: `Scan the department QR of the sticker's department first (if you really moved there), then scan the sticker again.` },
      { mistake: `"Fabric Sewing for this item is not completed yet." on an Upholstery scan.`, fix: `Fab Sew must complete that piece first; ask the sewing line to scan it.` },
      { mistake: `"This Production Order is ON_HOLD. Supervisor must resume before scanning."`, fix: `Ask the supervisor to resume the order on the Sales Order, then scan again.` },
      { mistake: `"You already scanned this — it is already done."`, fix: `Nothing to do — the piece is already yours. Scan the next one.` },
    ],
    workedExample:
      `Ali (EMP-0088, Fab Sew) signs in, taps "Clock in", scans the Fab Sew department QR ("Now working in" Fabric Sewing), sews a divan cover, scans its sticker for PO-2611-0451-01 and taps "Complete". His 35 standard minutes are added to today's production hours.`,
    related: ["create-production-order", "complete-qc", "outsource-work", "fg-scan"],
    nextStep: `If your department has a quality slot today, a "Quality Check" button appears on home (guide: complete-qc).`,
    contact: "Production Supervisor",
    variants: [
      {
        // src/api/routes/production-orders.ts:2850 — the department sticker path only accepts FAB_CUT / FAB_SEW
        case: "Fab Cut / Fab Sew department sticker",
        differences: [
          `One scan completes that department's job card for the whole item (all its pieces on the sticker).`,
        ],
      },
      {
        // src/api/routes/production-orders.ts:3266-3270 — department resolved by who scans; :3400 — Upholstery waits for Fab Sew
        case: "Shared Sew / Upholstery sticker — bed frame vs sofa",
        differences: [
          `The department is decided by who scans: a Fab Sew / Fab Cut worker completes Fab Sew, any other worker completes Upholstery.`,
          `Bed frame: each compartment (e.g. divan, headboard) and each piece is completed separately; Upholstery of a compartment is refused until its own Fab Sew is done ("Fabric Sewing for this item is not completed yet.").`,
          // src/api/routes/production-orders.ts:3174 — sofa compartments fan out to the whole department
          `Sofa: base, cushions and armrests are sewn as one set, so one scan completes the whole department for the sofa.`,
        ],
      },
      {
        // src/api/routes/production-orders.ts:2245 — BLOCKED / CANCELLED pieces cannot be packed
        case: "Packing sticker",
        differences: [
          `Completes exactly the scanned piece, then asks for the "Rack number". A piece that failed QC (BLOCKED) or was cancelled is refused.`,
        ],
      },
      {
        // src/api/lib/scan-gate.ts:45 — outsource workers skip the punch / department checks; src/api/routes/production-orders.ts:2433 — issued items go to approval
        case: "Outsourced worker",
        differences: [
          `No clock-in or department QR is needed. An item issued to you is not completed by your scan — the phone shows "Sent to the office" and the office approves it (guide: outsource-work).`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "complete-qc",
    title: "Complete a quality check (QC) — on the office QC page or the worker phone",
    keywords: [
      "QC", "quality check", "inspection", "IPQC", "IQC", "OQC", "pass fail", "defect",
      "质检", "品检", "检查", "合格", "不合格",
      "kawalan kualiti", "pemeriksaan kualiti", "lulus", "gagal",
    ],
    module: "Quality",
    companies: ["ALL"],
    purpose:
      `Record the result of a scheduled quality inspection: PASS / FAIL / N/A for every checklist item, with a reason and a photo for every FAIL. The office QC page handles all stages (raw material on receipt, in-process, finished goods), skips and history; floor workers can also do today's in-process checks for their own department on the phone (see the variant).`,
    prerequisites: [
      `An active checklist template exists for the department / stage (QUALITY → QC / Quality, "Templates" tab).`,
      `An inspection slot is open (slots are raised automatically; the office can also press "Generate Today's Slot").`,
      // src/api/routes/qc-pending.ts:2115 — completed / skipped inspections cannot be submitted again
      `The inspection is still PENDING or IN_PROGRESS — a completed or skipped one cannot be submitted again.`,
    ],
    who:
      `QC inspectors in the office (qc-inspections create). Floor workers / line leaders use the phone with their own worker PIN login (no ERP permission) — see the variant.`,
    // src/api/routes/qc-pending.ts:2410 — submit needs qc-inspections:create; :1996 — skip same gate
    permission: ["qc-inspections:create"],
    page: "/quality",
    sidebar: "QUALITY → QC / Quality",
    steps: [
      {
        do: `Go to QUALITY → QC / Quality ("QA / Quality Management"), tab "Pending Inspections". Choose the window in the slot selector (use "All slots" for the backlog) and click an inspection row to expand it.`,
        highlight: "Pending Inspections",
      },
      {
        do: `Pick the "Subject (what was sampled)" (job card, raw material receipt or FG unit), optionally fill "Overall notes (optional)", then press "PASS", "FAIL" or "NA" on every checklist item. For a FAIL type the detail and use "Add photo".`,
        highlight: "Subject (what was sampled)",
        fields: [
          // src/api/routes/qc-pending.ts:2128 — subjectId required
          { label: "Subject (what was sampled)", required: true, value: `The job card / receipt / FG unit you actually inspected (FG and RM rows come pre-set).`, example: `'PO-2611-0451-01 · Divan'` },
          { label: "Overall notes (optional)", required: false, value: `Free text.`, example: `'Line clean, no issue'` },
        ],
        // src/api/routes/qc-pending.ts:2147 — mandatory items must be answered; :2162 — FAIL needs text; :2183 — FAIL needs a photo
        check: `Every item marked "required" is answered, and every FAIL has text and a photo — the server refuses the submit otherwise, and the button stays disabled.`,
      },
      {
        do: `Press "Submit" (the button shows PASS or FAIL in brackets). If there was no production at that stage, type a reason in "Skip reason — e.g., No production at this stage today" and press "Skip" instead.`,
        highlight: "Submit",
        // src/api/routes/qc-pending.ts:2254 — issue tag + defect per FAIL item; :2297-2314 — WIP job-card FAIL resets the card to BLOCKED
        then: `The inspection moves to "Inspection History" with result, inspector, defects and photos. Each FAIL item creates an issue tag and a defect; a FAIL on a WIP job card resets that card to BLOCKED (completion, quantity and production minutes cleared, PIC slots emptied) so it must be reworked and scanned again.`,
      },
    ],
    checkBefore: [
      `You picked the job card / item you really inspected.`,
      `Every FAIL has a one-line reason and a photo.`,
    ],
    result:
      `The inspection is COMPLETED (or SKIPPED) and shows in QUALITY → QC / Quality → "Inspection History". A FAIL blocks the sampled WIP job card until it is reworked and scanned again.`,
    warnings: [
      `A WIP FAIL resets the job card to BLOCKED, clears its completion and removes the workers' production minutes for it.`,
      // src/api/routes/production-orders.ts:2245 — BLOCKED pieces cannot be packed
      `A BLOCKED piece cannot be packed until it is reworked and scanned again.`,
      // src/api/routes/qc-pending.ts:2115 — no re-submit of a COMPLETED / SKIPPED inspection
      `A submitted or skipped inspection cannot be changed.`,
    ],
    // src/api/routes/qc-pending.ts:2525 — delete only for PENDING / IN_PROGRESS, needs qc-inspections:delete
    undo:
      `A submitted or skipped inspection cannot be edited or deleted (delete only works on a still-pending one and needs qc-inspections delete). A wrongly failed job card is cleared by reworking it and scanning it again. Ask the QC Manager.`,
    commonMistakes: [
      { mistake: `Cannot submit a FAIL.`, fix: `Every FAIL needs a reason and a photo.` },
      { mistake: `Pressing "Skip" because the subject list shows a red load error.`, fix: `A red error is a fault, not a quiet factory — report it instead of skipping.` },
      { mistake: `Picking a different job card from the one actually checked.`, fix: `A FAIL resets the job card you pick — choose the exact card you inspected.` },
    ],
    workedExample:
      `At 4 pm inspector Kumar opens "Pending Inspections", expands the Upholstery slot, picks PO-2611-0450-02 · Sofa, marks 6 items PASS and 1 FAIL ("fabric pulled at armrest", photo) and presses "Submit". The job card goes BLOCKED; the upholsterer reworks and rescans it.`,
    related: ["worker-scan-job-card", "fg-scan", "create-production-order"],
    nextStep: `Rework any FAILED job card and scan it again (guide: worker-scan-job-card).`,
    contact: "QC Manager",
    variants: [
      {
        // src/api/routes/worker.ts:3287 — POST /api/worker/qc/:id/complete, worker token, no RBAC
        case: "Worker phone (in-process check, own worker PIN login)",
        differences: [
          `On the worker home screen tap "Quality Check" (only shown when your department has a check due today) — permission is your own worker PIN login, not an ERP role.`,
          // src/api/routes/worker.ts:3312 — own current department only; :3315 — WIP stage only; src/api/routes/worker.ts:3229 — today's PENDING / IN_PROGRESS slots
          `Only today's in-process (WIP) checks of your current department are listed; raw material, finished goods and older slots are done in the office.`,
          // src/api/routes/worker.ts:3325 / :3332 — subject required and must be a live card of the same department
          `Pick the card in "Which job card did you check?" — it must be a live job card of your department.`,
          `Tap "PASS", "FAIL" or "N/A" on every item; a FAIL needs "What went wrong? (required)" and "Take photo" ("Photo required").`,
          `Tap "Submit check" — the same FAIL effects apply (issue tags, job card reset to BLOCKED). There is no Skip on the phone.`,
        ],
      },
      {
        case: "Raw material (on goods receipt) and finished goods (sampled unit)",
        differences: [
          `Templates are set per stage: "RM (Incoming)", "WIP (In-Process)" or "FG (Outgoing)". RM and FG rows open with their receipt / unit already chosen, and an FG row shows why the unit was drawn for sampling.`,
        ],
      },
      {
        case: "Sofa vs bed frame",
        differences: [
          `Templates can be set per "Category" (Sofa, Bed Frame, Accessory, General), so the checklist items differ by product category.`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "fg-scan",
    title: "Scan finished-goods units (Pack / Load / Deliver / Return) on the FG Unit Scan page",
    keywords: [
      "FG scan", "finished goods", "pack", "packing scan", "load", "deliver", "return", "serial",
      "成品", "成品扫描", "包装", "装车", "扫码",
      "barang siap", "imbas barang siap", "bungkus", "muat",
    ],
    module: "Production",
    companies: ["ALL"],
    purpose:
      `Move individual finished-goods units (by their serial / short code) through Pack → Load → Deliver, or mark a Return. Note: a piece already becomes finished-goods stock when its Upholstery job card is completed — this page records packing and dispatch of units that are already stock, it does not create stock.`,
    prerequisites: [
      // src/api/routes/fg-units.ts:1071 — unknown serial refused
      `The FG unit exists with a serial (created by production, printed on the packing sticker).`,
      // src/api/routes/fg-units.ts:1098 / :1108 — PACK needs a valid worker
      `For Pack: the packer exists as a worker (the list shows Packing workers by default).`,
    ],
    who: `Packing / warehouse / dispatch staff with an ERP login (fg-units create).`,
    // src/api/routes/fg-units.ts:1048 — fg-units:create
    permission: ["fg-units:create"],
    page: "/production/fg-scan",
    sidebar: "Not in the sidebar — open /production/fg-scan directly on the ERP (page title FG Scanner).",
    steps: [
      {
        do: `Open /production/fg-scan ("FG Unit Scan"). Under "Action" press the step you are recording: "Pack", "Load", "Deliver" or "Return".`,
        highlight: "Pack",
        check: `The highlighted action is the right one — it stays selected for every following scan.`,
      },
      {
        do: `For Pack, choose the packer in "Worker" (the list shows Packing workers; press "All" to show everyone). For the other actions the worker is optional.`,
        highlight: "Worker",
        fields: [
          // src/api/routes/fg-units.ts:1098 — workerId required for PACK
          { label: "Worker", required: true, value: `Required for Pack (the pack is credited to this worker); optional for Load / Deliver / Return.`, example: `'Rahman (EMP-0102)'` },
        ],
      },
      {
        do: `Scan the unit's sticker with the handheld scanner, or type it in "Serial / Short code" and press Enter (or the scan button).`,
        highlight: "Serial / Short code",
        fields: [
          { label: "Serial / Short code", required: true, value: `The FG unit serial or short code from the packing sticker.`, example: `'FG-2611-0451-01-1'` },
        ],
        then: `A green box confirms the unit "marked as" packed / loaded / delivered / returned and shows product, customer, unit / piece and SO / PO. The field clears for the next scan; the last 10 scans show under "Recent scans (this session)".`,
      },
    ],
    checkBefore: [
      `The right "Action" is selected.`,
      `For Pack, the right worker is selected (the pack is credited to that worker).`,
    ],
    result:
      `The unit's status changes (PENDING → PACKED → LOADED → DELIVERED, or RETURNED from any state) and the change is written to the FG ledger.`,
    warnings: [
      // src/api/routes/fg-units.ts:1091 — PACK only from PENDING; :1122 — LOAD needs PACKED; :1138 — DELIVER needs LOADED
      `Steps must go in order: Pack only from PENDING, Load needs PACKED, Deliver needs LOADED; a second Pack of the same unit is refused.`,
      // src/api/routes/fg-units.ts:1152 — RETURN accepted from any state
      `Return is accepted from any state — use it only for a real return.`,
    ],
    undo:
      `There is no undo button on this page and no backward step (e.g. LOADED back to PACKED). Ask the Warehouse / Production Manager to correct the unit status.`,
    commonMistakes: [
      { mistake: `"Please select a worker before PACK scan."`, fix: `Pick the packer in "Worker" first, then scan.` },
      { mistake: `"Scan failed" with "must be PACKED first".`, fix: `The unit was never packed — switch to "Pack", scan it, then "Load".` },
      { mistake: `Expecting this page to put goods into stock.`, fix: `Stock comes from completing the Upholstery job card; racking is done by scanning the Packing sticker / rack QR on the worker phone.` },
    ],
    workedExample:
      `Packing leader Rahman opens FG Unit Scan, keeps "Pack" selected, picks himself in "Worker" and scans 12 sofa boxes one after another with the handheld scanner. Next morning the driver's assistant selects "Load" and scans the same 12 serials onto the lorry.`,
    related: ["worker-scan-job-card", "create-delivery-order", "complete-qc"],
    nextStep: `Create the delivery order for the packed goods (guide: create-delivery-order).`,
    contact: "Warehouse Manager",
    variants: [
      {
        case: "Load / Deliver / Return",
        differences: [
          `"Worker" is optional ("(no worker)"); the change is recorded against the signed-in user.`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "production-planning",
    title: "Schedule job-card due dates with Planning → Schedule Proposals",
    keywords: [
      "planning", "schedule", "production schedule", "due date", "capacity", "schedule proposals",
      "排产", "排期", "生产计划", "交期", "产能",
      "perancangan pengeluaran", "jadual", "tarikh siap",
    ],
    module: "Production",
    companies: ["ALL"],
    purpose:
      `Let the planning engine propose a due date for every waiting job card that is unscheduled, overdue or off-plan, then approve (or reject) the proposals so the departments work in the right order. Nothing changes until you approve.`,
    prerequisites: [
      `Production orders and job cards exist (guide: create-production-order).`,
      // src/api/routes/schedule-proposals.ts:106 — generate refused while the production agent is paused
      `The production agent is not paused (Agent Console).`,
      // src/api/lib/nav-permissions.ts:69 — /planning menu link needs the scheduling resource
      `You can see the Planning page (scheduling access) and hold production-orders update.`,
    ],
    who: `Production planner / production manager (production-orders update).`,
    // src/api/routes/schedule-proposals.ts:100 / :163 / :185 — generate, approve, reject all need production-orders:update
    permission: ["production-orders:update"],
    page: "/planning",
    sidebar: "PRODUCTION → Planning",
    steps: [
      {
        do: `Go to PRODUCTION → Planning ("Production Planning") and open the tab "Schedule Proposals".`,
        highlight: "Schedule Proposals",
      },
      {
        do: `Press "Generate now".`,
        highlight: "Generate now",
        then: `The engine runs over all waiting job cards and lists one row per proposal: SO / PO, Dept, Lane, Fabric, "Current due", "Proposed" and "Reason". A message tells how many were proposed (unscheduled · overdue · superseded).`,
      },
      {
        do: `Tick the rows you agree with (or the header box "Select all proposals"). Use "Show all" if the list is cut at 100 rows.`,
        highlight: "Select all proposals",
        check: `Compare "Current due" with "Proposed" and read the "Reason" — a red current date is earlier than the proposal.`,
      },
      {
        do: `Press "Approve selected" (or "Reject" for rows you do not want).`,
        highlight: "Approve selected",
        // src/api/lib/schedule-proposals.ts:457-458 — only WAITING cards not yet sent to the floor are moved
        then: `Approved: the job cards' due dates are updated and the proposals are marked APPROVED; the new dates show on the PRODUCTION → Production department pages. Cards already sent to the floor or no longer waiting are not moved. Rejected proposals are closed without change.`,
      },
    ],
    checkBefore: [
      `The proposed dates fit the customer delivery dates (see the "Master Tracker" tab).`,
      `You ticked only the rows you reviewed.`,
    ],
    result:
      `Job-card due dates follow the approved plan; departments see them on their production sheets and in "Today's Schedule".`,
    warnings: [
      `Approving rewrites due dates on many job cards at once.`,
      // src/api/lib/schedule-proposals.ts:458 — sent-lock: cards with distributedAt set are never moved
      `A job card already sent to workers' phones, or already started / completed, keeps its due date even if its proposal is approved.`,
    ],
    // src/pages/production/index.tsx:3770 — due-date pill click opens the date picker; src/api/routes/production-orders.ts:4199 — PATCH needs production-orders:update
    undo:
      `There is no "un-approve". Change a single due date on the department page of PRODUCTION → Production by clicking the date pill ("Click to reschedule") — needs production-orders update. Ask the Production Manager for bulk corrections.`,
    // src/api/lib/schedule-proposals.ts:140 — PENDING proposals older than 24 h are expired
    deadlines: `Pending proposals expire automatically about 24 hours after they were generated — press "Generate now" again for a fresh list.`,
    commonMistakes: [
      { mistake: `"Production agent is paused — resume it in the Agent Console."`, fix: `Ask the Super Admin to resume the production agent, then generate again.` },
      { mistake: `Approving yesterday's list.`, fix: `Old proposals expire — generate a fresh list before approving.` },
    ],
    workedExample:
      `Planner Hafiz opens Planning → "Schedule Proposals", presses "Generate now" (86 proposals), reviews the Fab Cut rows for next week's bed frames, ticks 40 of them and presses "Approve selected". The Fab Cut sheet now shows the new due dates.`,
    related: ["create-production-order", "mrp-shortages-to-po", "worker-scan-job-card"],
    nextStep: `Print the department schedules and stickers (guide: create-production-order).`,
    contact: "Production Manager",
  },

  // -------------------------------------------------------------------------
  {
    id: "outsource-work",
    title: "Issue work to an outsourced worker and approve it when it comes back",
    keywords: [
      "outsource", "outsourced worker", "issue work", "subcontract", "approve outsource",
      "外包", "外发", "发外包", "外包审批",
      "kerja luar", "pekerja luar", "sub-kontrak", "keluarkan kerja",
    ],
    module: "Production",
    companies: ["ALL"],
    purpose:
      `Record which item (by its production sticker) is handed to which outsourced worker, then approve it when the worker brings it back and scans it finished — the approval completes that department's job card.`,
    prerequisites: [
      // src/api/routes/outsource-issues.ts:93 — must be an active outsourced worker; :105 — worker must have a department
      `The outsourced worker is active in HR, flagged as outsourced, and has a department.`,
      // src/api/routes/outsource-issues.ts:137 — refused when the worker's departments make the target ambiguous
      `The worker's departments do not overlap so that more than one job card of the item could be his.`,
      // src/api/routes/outsource-issues.ts:127 — the order must have a job card of the worker's department
      `The item's production order has a job card for that worker's department (guide: create-production-order).`,
    ],
    who:
      `Production office / outsource coordinator issues (outsource-issues create). Approving needs production-orders create; "Send back" needs outsource-issues update; "Undo" of an issue needs outsource-issues delete. The outsourced worker uses his own worker PIN login.`,
    // src/api/routes/outsource-issues.ts:79 — issue needs outsource-issues:create
    permission: ["outsource-issues:create"],
    page: "/production/outsource-issue",
    sidebar: "PRODUCTION → Outsource Work",
    steps: [
      {
        do: `Go to PRODUCTION → Outsource Work. In "Issue Work", step 1, choose the worker in "Worker".`,
        highlight: "Issue Work",
        fields: [
          { label: "Worker", required: true, value: `An active outsourced worker; the list shows employee no, name, department and how many items are open.`, example: `'OSC-0007 · Ahmad · Upholstery'` },
        ],
      },
      {
        do: `Step 2: scan the QR on the item's production sticker or job card into "Scan sticker" and press "Issue" — or press "Scan QR" to use the camera.`,
        highlight: "Issue",
        fields: [
          // src/api/routes/outsource-issues.ts:112 / :118 — must be a production sticker of an existing order
          { label: "Scan sticker", required: true, value: `The production sticker / job-card QR code of an existing order; each scan issues one item to the selected worker.`, example: `'PO-2611-0451-01'` },
        ],
        check: `The green message names the right worker and item. Press "Issued this session" to see everything issued in this sitting.`,
        then: `The item appears in the list below with status Incomplete and in the worker's "My task" on his phone.`,
      },
      {
        do: `Worker side: when finished, the outsourced worker opens "My task" on the phone, taps "Scan finished item" and scans the sticker.`,
        page: "/worker/tasks",
        highlight: "Scan finished item",
        // src/api/lib/outsource-issue.ts:754 — a holder's phone scan goes to approval instead of completing
        then: `The phone shows "Sent to the office"; the item status becomes "Waiting for office" and the office list shows it under "Pending approval".`,
      },
      {
        do: `Office: when the item is physically back, open the "Pending approval" filter and press "Approve" on its row (or "Send back" if it must be redone).`,
        highlight: "Approve",
        check: `Inspect the returned item before approving.`,
        // src/pages/production/use-outsource-issue.ts:314 — Approve replays the worker's scan-complete call; src/api/routes/outsource-issues.ts:219 — send back only while pending approval
        then: `Approve replays the worker's finished scan: the department's job card is completed and the issue becomes Completed (counts for the worker's payroll). Send back returns it to Incomplete for the worker to finish and rescan.`,
      },
    ],
    checkBefore: [
      `The right worker is selected before scanning — each scan issues immediately.`,
      `The item is physically back and acceptable before "Approve".`,
    ],
    result:
      `Each issued item is tracked as Incomplete → Pending approval → Completed on PRODUCTION → Outsource Work; approval completes the department job card on the Production board.`,
    warnings: [
      `"Approve" completes the job card (moves WIP to the next department) and makes the piece payable to the outsourced worker.`,
      // src/api/routes/outsource-issues.ts:155 — refused when the department's work is already done; :165 — refused when issued to someone else
      `An item whose department work is already done, or that is already issued to another worker, cannot be issued.`,
      // src/api/lib/outsource-issue.ts:744-762 — enforce switch refuses other workers' / un-issued items
      `With "Only allow issued items" switched on (Super Admin), an outsourced worker can finish only items issued to him here, and nobody else can complete an item issued to him.`,
    ],
    // src/api/routes/outsource-issues.ts:181 — undo needs outsource-issues:delete; :192 — completed items cannot be undone
    undo:
      `A wrong issue: open "Issued this session" and press "Undo" (needs outsource-issues delete); a completed item cannot be undone ("This item is already completed and cannot be undone."). A wrongly approved job card is reopened by the production office on the department page (needs production-orders update).`,
    // src/api/routes/production-orders.ts:2096 / :2795 / :3196 — the replayed completion needs production-orders:create
    approvals: `Every finished item the worker holds an issue for must be approved by the office ("Approve", needs production-orders create) before the job card counts as done.`,
    commonMistakes: [
      { mistake: `Scanning before choosing a worker.`, fix: `Pick the worker in "Worker" first — the scan box stays disabled until then.` },
      { mistake: `"Already issued to" another worker.`, fix: `Check who holds it; undo that issue first if it went to the wrong person.` },
      { mistake: `"This item has no finished scan to approve. Send it back and ask the worker to scan it again."`, fix: `Press "Send back"; the worker scans it with "Scan finished item", then approve.` },
    ],
    workedExample:
      `Coordinator Lina selects OSC-0007 Ahmad (Upholstery) and scans 3 sofa stickers — "Issued this session" shows 3. Two days later Ahmad scans them finished on his phone; Lina checks the sofas, opens "Pending approval" and presses "Approve" on each. The Upholstery job cards complete.`,
    related: ["worker-scan-job-card", "create-production-order", "complete-qc"],
    nextStep: `The work continues to the next department (often Packing).`,
    contact: "Production Manager",
    variants: [
      {
        // src/api/lib/outsource-issue.ts:759 — without enforce, an un-issued outsourced scan completes directly
        case: "\"Only allow issued items\" switched off",
        differences: [
          `An outsourced worker can also scan an item that was never issued to him; that scan completes the job card directly with no office approval. Items that were issued still go through "Pending approval".`,
        ],
      },
      {
        // src/api/lib/scan-gate.ts:45 — outsource workers skip punch-in / department QR
        case: "Outsourced worker on the phone",
        differences: [
          `No clock-in or department QR scan is needed; "My task" lists only his own issued items ("My task is only for outsourced workers." for anyone else).`,
        ],
      },
    ],
  },
];
