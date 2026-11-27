// ---------------------------------------------------------------------------
// howto/guides-aftersales.ts — after-sales, mail, HR and maintenance "how do I…"
// guides. Written from the real frontend + API code (2026-11-27):
//   service cases  — src/pages/service-cases/{index,detail}.tsx, src/api/routes/service-cases.ts,
//                    src/api/routes/service-case-approvals.ts, src/api/lib/service-approval.ts
//   service order  — src/pages/sales/create.tsx in service-order mode (src/lib/so-mode.ts),
//                    POST /api/sales-orders (isServiceOrder: true)
//   mail center    — src/pages/mail-center/detail.tsx, POST /api/mail-center/threads/:id/reply
//   leave          — src/pages/worker/me.tsx (SHOW_LEAVES = false) and the employees.tsx
//                    Leave Management tab (commented out of TABS): both hidden until rollout
//   attendance     — src/pages/employees.tsx AttendanceTab + WorkingHoursTab, src/pages/worker/index.tsx
//   maintenance    — src/pages/maintenance.tsx, PUT /api/equipment/:id { logMaintenance }
// ---------------------------------------------------------------------------
import type { HowToGuide } from "./types";

export const GUIDES: HowToGuide[] = [
  // -------------------------------------------------------------------------
  {
    id: "open-service-case",
    title: "Open a service case (customer complaint / after-sales issue)",
    keywords: [
      "service case", "open case", "new case", "complaint", "after-sales", "aftersales", "warranty claim", "defect report",
      "售后", "开case", "开案", "投诉", "客诉", "维修", "保修",
      "kes servis", "aduan", "buka kes", "selepas jualan",
    ],
    module: "Quality / After-sales",
    purpose:
      "Log every customer-facing service issue (damage, defect, wrong item, missing part) as one case so it can be investigated, tracked through its pipeline and, if rework is needed, turned into a Service Order.",
    prerequisites: [
      // src/api/routes/service-cases.ts:714,731 — SO/CO source must exist; :707 — EXTERNAL needs a customer
      "The customer's Sales Order or Consignment Order exists in the ERP — or, for an old/paper order, the customer exists in the customer master.",
      "Photos of the problem from the customer (optional but strongly recommended).",
      // src/api/routes/service-cases.ts:686 — POST gated by service-cases:create
      "Your role has create permission on service cases.",
    ],
    who: "After-sales / customer service staff, sales coordinators.",
    permission: ["service-cases:create"],
    page: "/service-cases",
    sidebar: "QUALITY → Service Cases",
    steps: [
      {
        do: "Open the Service Cases list and click \"New Service Case\" (top right).",
        highlight: "New Service Case",
        then: "The \"New Service Case\" form opens as a pop-up.",
      },
      {
        do: "Choose where the order came from and pick it.",
        fields: [
          {
            label: "Source Order Type",
            required: true,
            value:
              "Pick \"Sales Order\", \"Consignment Order\" or \"External / Old order (no record in system)\". Defaults to Sales Order.",
            example: "'Sales Order'",
          },
          {
            label: "Source Order",
            required: true,
            value:
              "For Sales / Consignment Order: type the order number or customer name and click the matching result. For External: search the customer by code or name and click it (a free-typed name is not accepted), and optionally type the paper order number in the external reference box.",
            example: "'SO-2611-042'",
          },
        ],
        check: "The picked order shows its number, customer and status in the box; click \"Change\" if it is the wrong one.",
      },
      {
        do: "Tick the affected product line(s) and describe the problem.",
        fields: [
          {
            label: "Which product has the issue?",
            required: false,
            value:
              "Appears only after a Sales / Consignment Order is picked. Click one or more order lines; for a line with a BOM you can narrow down to the damaged parts. Can also be added later on the case page.",
            example: "'BF-QUEEN-01 — Queen bedframe'",
          },
          {
            label: "Issue Description",
            required: false,
            value:
              "Free text using the 5W template shown in the box: when, who, where, what happened, result. Not enforced, but the case is useless without it.",
            example: "'2026-11-25 14:00, 3PL driver dropped the headboard while unloading at customer house in Klang; left corner cracked.'",
          },
          {
            label: "Photos",
            required: false,
            value: "Click \"Add photos\" and pick image files; they are compressed before upload. Remove one with the small x on the thumbnail.",
          },
          {
            label: "Root Cause",
            required: false,
            value:
              "Pick a category now only if you already know it (e.g. \"Transport / 3PL\", \"Production / workmanship\"); otherwise leave \"Category — not yet assigned\" and fill it later.",
            example: "'Transport / 3PL'",
          },
        ],
      },
      {
        do: "Click \"Open Case\".",
        highlight: "Open Case",
        check: "If a red message appears (for example asking you to pick a Sales Order or a customer from the master list), fix that field and click again.",
        then:
          "The case is created with status OPEN and a new case number, a \"Service case opened\" message appears, and you land on the new case's detail page.",
      },
    ],
    checkBefore: [
      "The source order (or external customer) is the right one — the customer name on the case is copied from it.",
      "The Issue Description answers when / who / where / what / result.",
      "Photos are attached if the customer sent any.",
    ],
    result:
      "A service case with status OPEN appears at the top of QUALITY → Service Cases and on its own detail page (/service-cases/:id), with the \"Case Pipeline\" at step Opened. Nothing is sent to the customer and no stock moves.",
    warnings: [
      "Opening a case does not create any rework — if the item must be repaired, swapped or remade, create a Service Order from the case afterwards.",
      // src/api/routes/service-cases.ts:750 — rootCauseCategory must be one of the fixed categories
      "Root Cause only accepts the categories in the drop-down; anything else is rejected.",
    ],
    // src/pages/service-cases/detail.tsx:633 — Edit hidden on CANCELLED; src/api/routes/service-cases.ts:829 — PUT needs service-cases:update
    // src/api/routes/service-cases.ts:68,74 — OPEN→CANCELLED and CANCELLED→OPEN/IN_PROGRESS allowed
    undo:
      "On the case page click \"Edit\" to correct the description, photos, products or root cause (not possible while the case is cancelled). A wrongly opened case can be cancelled with \"Cancel\" and restored with \"Undo Cancel\" by anyone with service-cases update permission.",
    commonMistakes: [
      {
        mistake: "Typing a customer name for an old order without clicking a search result.",
        fix: "Click the customer in the drop-down list so the case is linked to the customer master; the form refuses to open otherwise.",
      },
      {
        mistake: "Opening a second case for the same complaint.",
        fix: "Search the Service Cases list by customer or order first; add further information to the existing case instead.",
      },
    ],
    workedExample:
      "Customer Lim Furniture reports a cracked headboard on SO-2611-042. Aisha clicks \"New Service Case\", keeps Sales Order, searches 2611-042, ticks the headboard line, writes the 5W story, adds 3 photos, picks Transport / 3PL and clicks \"Open Case\". Case SC-2611-018 opens at status OPEN.",
    related: ["move-service-case-stage", "add-case-note", "create-service-order"],
    nextStep: "Investigate and log your actions (add-case-note), then mark it in progress (move-service-case-stage).",
    contact: "After-sales supervisor",
    // Cases carry no company / sales-org column; the flow is the same for every company.
    companies: ["ALL"],
    variants: [
      {
        case: "Sales Order or Consignment Order source",
        differences: [
          // src/api/routes/service-cases.ts:714 — sourceId is required for SO/CO; :731 — 404 when the order does not exist
          "The order must be picked from the search results; the customer name and state are copied from that order, not typed.",
          // src/pages/service-cases/index.tsx:1436 — affected-products picker renders only for SO/CO with a picked order
          "The \"Which product has the issue?\" list appears so you can tick the affected lines and damaged parts.",
          // src/api/routes/service-cases.ts:717 — an in-flight (not yet shipped) order is accepted
          "The order does not need to be shipped yet — a case can be opened against an order still in production.",
        ],
      },
      {
        case: "External / old order (no record in the ERP)",
        differences: [
          // src/pages/service-cases/index.tsx:1235 + src/api/routes/service-cases.ts:707 — customer from the master is required
          "Pick \"External / Old order (no record in system)\", then search and click a customer from the master list — a free-typed name is refused.",
          "There is no product list; add affected products later from the case page with \"Edit\".",
        ],
      },
      {
        case: "Phone (/m app)",
        differences: [
          // src/pages/m/screens/cases/QuickReport.tsx:225,236 — phone create flow
          "Use \"Report an issue\" in the phone Service Cases screen: take photos, pick the related order or customer, describe the issue and tap \"Open case\".",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "move-service-case-stage",
    title: "Move a service case through its stages to closed",
    keywords: [
      "service case status", "close case", "in progress", "cancel case", "case pipeline", "investigating", "undo cancel",
      "售后进度", "关闭case", "结案", "处理中", "取消case",
      "tutup kes", "status kes", "dalam proses", "batal kes",
    ],
    module: "Quality / After-sales",
    purpose:
      "Advance a service case from OPEN to IN_PROGRESS (investigating) and finally CLOSED, or cancel it. The other pipeline steps light up on their own from the linked Service Order and delivery.",
    prerequisites: [
      "The service case exists (open-service-case).",
      "To close: the customer issue is resolved (repair delivered, part sent, or no action needed).",
      // src/api/routes/service-cases.ts:1003 — PUT /:id/status gated by service-cases:update
      "Your role has update permission on service cases.",
    ],
    who: "After-sales / customer service staff.",
    permission: ["service-cases:update"],
    page: "/service-cases",
    sidebar: "QUALITY → Service Cases",
    steps: [
      {
        do: "Click the case number in the Service Cases list to open the case detail page.",
        page: "/service-cases",
        then: "The case page opens; the status badge is next to the case number and the \"Case Pipeline\" shows 8 steps: Opened, Investigating, Service Order, Repair in progress, Repair done, Delivery arranged, Delivered, Closed.",
      },
      {
        do: "When you start working on it, click \"Mark In Progress\".",
        page: "/service-cases/:id",
        highlight: "Mark In Progress",
        then:
          "Status changes OPEN → IN_PROGRESS, the Investigating date is stamped (first time only) and a confirmation message shows the new status. The button disappears.",
      },
      {
        do: "If rework is needed, click \"Spawn Service Order\" on the Service Orders card (see create-service-order). The Service Order, Repair and Delivery steps of the pipeline tick themselves from that order and its delivery order — there is nothing to click for them.",
        page: "/service-cases/:id",
        highlight: "Spawn Service Order",
      },
      {
        do: "When the issue is fully resolved, click \"Close Case\", then confirm with \"Close Case\" in the pop-up.",
        page: "/service-cases/:id",
        highlight: "Close Case",
        check: "The pop-up warns that a closed case can't be reopened or have new service orders spawned — make sure every repair/part has been delivered first.",
        then: "Status becomes CLOSED, the closed date is stamped, and the Closed step of the pipeline ticks.",
      },
      {
        do: "To stop a case that should not continue, click \"Cancel\" and confirm with \"Cancel Case\" (or \"Keep Open\" to back out).",
        page: "/service-cases/:id",
        highlight: "Cancel",
        then: "Status becomes CANCELLED; a red note on the pipeline says the case was cancelled. An \"Undo Cancel\" button appears.",
      },
    ],
    checkBefore: [
      "Before \"Close Case\": all spawned Service Orders show a delivered status in the Service Orders card.",
      "Root cause is filled on the case (click \"Edit\") so quality reports are complete.",
    ],
    result:
      "The case status (OPEN / IN_PROGRESS / CLOSED / CANCELLED) updates on the detail page and in the Stage column of the Service Cases list. Allowed moves: OPEN → IN_PROGRESS, CLOSED or CANCELLED; IN_PROGRESS → CLOSED or CANCELLED; CANCELLED → back to the stage it was cancelled from. No email is sent.",
    warnings: [
      // src/api/routes/service-cases.ts:70 — CLOSED: [] ; :1026-1031 — any other move is refused with 409
      "Closing is irreversible: a CLOSED case has no allowed next status, cannot be reopened and cannot spawn new service orders.",
      // src/pages/service-cases/detail.tsx:804 — Spawn button hidden on CLOSED / CANCELLED
      "On a closed or cancelled case the \"Spawn Service Order\" button is hidden.",
      // src/api/routes/service-case-approvals.ts:68-70 — approval requests refused on CLOSED / CANCELLED cases
      "An approval cannot be requested on a closed or cancelled case.",
      // src/api/routes/service-cases.ts:69 — IN_PROGRESS cannot go back to OPEN
      "A case cannot go back from IN_PROGRESS to OPEN.",
    ],
    // src/api/routes/service-cases.ts:74 + detail.tsx:710-731 — Undo Cancel returns to pre_cancel_status (OPEN if unknown)
    // src/pages/service-cases/detail.tsx:633 — Edit stays available on CLOSED cases (RCA can still be added)
    undo:
      "A cancel can be undone with \"Undo Cancel\" (returns to the stage it was cancelled from). A close cannot be undone in the ERP — open a new case instead; the closed case can still be corrected with \"Edit\" (description, photos, root cause, action log). Needs service-cases update permission.",
    approvals:
      "No approval is needed to change stages. A 1-to-1 exchange (stock swap / remake) raised through the legacy service-order modal needs a service-cases approve holder to click \"Approve\" in the \"Pending approvals\" list on the Dashboard service view; the request is auto-filed and nothing is created until approved.",
    commonMistakes: [
      {
        mistake: "Closing the case as soon as the Service Order is created.",
        fix: "Wait until the pipeline shows Delivered; after closing you cannot spawn another service order for missing items.",
      },
      {
        mistake: "Cancelling instead of closing a resolved case.",
        fix: "Click \"Undo Cancel\" and then \"Close Case\" so the case counts as resolved in the reports.",
      },
    ],
    workedExample:
      "Case SC-2611-018 (cracked headboard): Aisha clicks \"Mark In Progress\" after calling the customer, spawns SV-2611-007, and once the delivery order shows Delivered she clicks \"Close Case\" and confirms.",
    related: ["open-service-case", "add-case-note", "create-service-order", "create-delivery-order"],
    nextStep: "Review the closed case's root cause and prevention action with QC.",
    contact: "After-sales supervisor",
    companies: ["ALL"],
    variants: [
      {
        case: "Case mode: repair / remake on an SV service order (case from a Sales or Consignment Order)",
        differences: [
          // src/pages/service-cases/detail.tsx:814 — SO/CO cases navigate to /service-order/create?fromCase=
          "\"Spawn Service Order\" opens the \"New Service Order\" page pre-filled from the case; no approval is needed.",
        ],
      },
      {
        case: "Case mode: 1-to-1 exchange (stock swap / reproduce) through the legacy modal (external case)",
        differences: [
          // src/api/routes/service-orders.ts:608 + src/api/lib/service-approval.ts:105-125 — exchange gate
          "Choosing \"Stock Swap\" or \"Reproduce\" under \"Resolution Mode\" and clicking \"Spawn Order\" files an approval request and creates nothing until it is approved.",
          // src/api/routes/service-case-approvals.ts:87,94 — service-cases:approve; reject needs a reason
          "An approver clicks \"Approve\" or \"Reject\" (with a reason, then \"Confirm reject\") in \"Pending approvals\"; after approval, spawn the order again.",
          "\"Repair\" mode is not gated.",
        ],
      },
      {
        case: "Phone (/m app)",
        differences: [
          // src/pages/m/screens/cases/CaseDetailScreen.tsx:226-231,537,556
          "The case header shows \"Mark in progress\" and \"Close\" (OPEN) or \"Close case\" (IN_PROGRESS); cancel is under \"Case actions\" → \"Cancel case\"; a cancelled case shows \"Undo cancel\".",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "add-case-note",
    title: "Add a note (action log entry) to a service case",
    keywords: [
      "case note", "service case note", "action log", "log action", "follow up", "remark",
      "备注", "加备注", "跟进记录", "售后记录",
      "nota kes", "catatan", "tindakan susulan",
    ],
    module: "Quality / After-sales",
    purpose:
      "Record each action taken on a case (called customer, scheduled inspection, sent missing part) with a date, so anyone can see the history. Notes go in the \"Action Taken (Service Agent Log)\" card.",
    prerequisites: [
      // src/pages/service-cases/detail.tsx:633 — Edit button rendered only when status !== CANCELLED
      "The service case exists and is not CANCELLED (the Edit button is hidden on a cancelled case). Closed cases can still get log entries.",
      // src/api/routes/service-cases.ts:829 — PUT /:id (saves actionLog) gated by service-cases:update
      "Your role has update permission on service cases.",
    ],
    who: "After-sales / customer service staff.",
    permission: ["service-cases:update"],
    page: "/service-cases",
    sidebar: "QUALITY → Service Cases",
    steps: [
      {
        do: "Click the case number in the Service Cases list to open the case.",
        page: "/service-cases",
      },
      {
        do: "Click \"Edit\" at the top right of the case page.",
        page: "/service-cases/:id",
        highlight: "Edit",
        then: "An editing banner appears and every section, including the action log, is unlocked.",
      },
      {
        do: "Scroll to the \"Action Taken (Service Agent Log)\" card and click \"Add Entry\".",
        page: "/service-cases/:id",
        highlight: "Add Entry",
        fields: [
          {
            label: "Date",
            required: false,
            value: "Date picker; defaults to today (Malaysia time). Change it if you are logging an earlier action.",
            example: "'2026-11-26'",
          },
          {
            label: "Description",
            required: true,
            value: "What you did, in one line. A row with neither date nor description is dropped on save.",
            example: "'Called customer, on-site inspection booked for 28 Nov 10am'",
          },
        ],
      },
      {
        do: "Click \"Save\" at the bottom of the action log card.",
        page: "/service-cases/:id",
        highlight: "Save",
        check: "The card shows \"Unsaved changes\" before you save; the Save button is disabled when nothing changed.",
        then: "The log is saved to the case and the label changes to \"All changes saved\". Click \"Done Editing\" to lock the page again.",
      },
    ],
    checkBefore: ["The date and description are correct — each section saves separately, so save the log card before leaving."],
    result:
      "The entry appears in the \"Action Taken (Service Agent Log)\" card on the case page and in the action log section of the case PDF (\"Download PDF\"). Nobody is notified.",
    warnings: [
      // src/pages/service-cases/detail.tsx:3033-3041 — Save persists the whole log; nothing auto-saves on blur
      "Navigating away without clicking \"Save\" on the card loses the new entry.",
      // src/pages/service-cases/detail.tsx:3035 — rows with neither date nor description are dropped on save
      "An entry with no date and no description is silently dropped when you save.",
    ],
    undo:
      "Click \"Edit\", change the text or remove the row with the x next to it, then click \"Save\" on the card. Any user with service-cases update permission can do this.",
    commonMistakes: [
      {
        mistake: "Typing the follow-up into the Issue Description instead of the log.",
        fix: "Keep the Issue Description for the original 5W story; add each later action as a log entry with \"Add Entry\".",
      },
      {
        mistake: "Clicking \"Done Editing\" before saving the card.",
        fix: "Always click the card's \"Save\" first; the banner's Done Editing only locks the page.",
      },
    ],
    workedExample:
      "Ben opens case SC-2611-018, clicks \"Edit\", then \"Add Entry\", keeps today's date, types 'Sent replacement bracket via Lalamove', clicks \"Save\" and then \"Done Editing\".",
    related: ["open-service-case", "move-service-case-stage"],
    nextStep: "Move the case to the next stage when appropriate (move-service-case-stage).",
    contact: "After-sales supervisor",
    companies: ["ALL"],
    variants: [
      {
        case: "Phone (/m app)",
        differences: [
          // src/pages/m/screens/cases/CaseEditSheets.tsx:457-463 — "Action taken" editor with its own save bar
          "Open the case, open the \"Action taken\" section editor, tap \"Add entry\", type the action and save; \"Action log saved\" confirms it.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "create-service-order",
    title: "Create a Service Order (aftersales rework / replacement order)",
    keywords: [
      "service order", "SV order", "repair order", "rework", "replacement", "warranty repair", "spawn service order",
      "服务单", "售后单", "维修单", "返工", "补货",
      "pesanan servis", "pembaikan", "ganti",
    ],
    module: "Quality / After-sales",
    purpose:
      "Create an SV-numbered aftersales order (a Sales Order flagged as a service order, prices default to 0) so production remakes or repairs the item and it can be delivered back to the customer.",
    prerequisites: [
      "Ideally an open service case for the issue (open-service-case) — creating from the case links the order to it.",
      "The original Sales Order or Consignment Order exists, to copy the lines from.",
      // src/api/lib/nav-permissions.ts:107 — /service-order page maps to service-orders
      "To open QUALITY → Service Order you need service-orders read access.",
      // src/api/routes/sales-orders.ts:1773 — POST /api/sales-orders gated by sales-orders:create
      "Your role has create permission on sales orders (a service order is saved as a sales order).",
      // src/pages/service-cases/detail.tsx:804 — spawn button only while the case is not CLOSED / CANCELLED
      "When starting from a case, the case must still be open or in progress.",
    ],
    who: "After-sales / customer service staff, sales coordinators.",
    permission: ["sales-orders:create"],
    page: "/service-order",
    sidebar: "QUALITY → Service Order",
    steps: [
      {
        do: "Recommended route: on the service case page click \"Spawn Service Order\" (or \"Spawn for New Items\" when one already exists). For a case from a Sales / Consignment Order this opens the \"New Service Order\" page pre-filled with the case's affected lines. Otherwise open QUALITY → Service Order and click \"New Service Order\".",
        page: "/service-cases/:id",
        highlight: "Spawn Service Order",
        then: "You land on the \"New Service Order\" page; when it came from a case the header says it is linked to that case.",
      },
      {
        do: "If the lines were not pre-filled, click \"Copy from SO/CO\", choose \"Sales Order\" or \"Consignment Order\", type the order number (our SO, customer PO, customer SO or CO number), click \"Next\", tick the lines and adjust Copy Qty, then click \"Copy Selected\".",
        page: "/service-order/create",
        highlight: "Copy from SO/CO",
        then: "The customer, hub and the chosen lines are filled in; all prices are reset to 0.",
      },
      {
        do: "Check the order details.",
        page: "/service-order/create",
        fields: [
          { label: "Customer *", required: true, value: "Pick from the list (pre-filled when copied).", example: "'C-0123 - Lim Furniture'" },
          { label: "Delivery Hub *", required: true, value: "Pick the customer's hub to deliver the repaired item to.", example: "'KLANG — Lot 5, Jalan Kapar'" },
          { label: "Customer PO No.", required: false, value: "Customer's reference if they issued one.", example: "'PO-HKL-2611-030'" },
          { label: "Customer SO No.", required: false, value: "Customer's own SO number, optional." },
          { label: "Reference", required: false, value: "Free text, e.g. the service case number.", example: "'SC-2611-018'" },
          { label: "Customer Delivery Date", required: false, value: "Date the customer expects the item back.", example: "'2026-12-10'" },
          { label: "Notes", required: false, value: "Internal notes for the order." },
        ],
      },
      {
        do: "For every line, set the repair scope and the line price.",
        page: "/service-order/create",
        fields: [
          {
            label: "Repair Scope",
            required: true,
            value:
              "\"Full remake\" (default) or \"Partial repair — pick departments…\" and tick the departments that redo work (Upholstery and Packing are always ticked). A partial repair must keep at least one department/component ticked.",
            example: "'Full remake'",
          },
          { label: "Line Notes", required: false, value: "What exactly to fix on this line.", example: "'Replace left headboard panel only'" },
        ],
        check: "Every line has a product and fabric; prices stay 0 unless the customer pays for the repair.",
      },
      {
        do: "Click \"Create Order\" to create and send it to production, or \"Save as Draft\" to finish later.",
        page: "/service-order/create",
        highlight: "Create Order",
        then:
          "\"Create Order\" saves the SV order and immediately confirms it (BOM check + production cascade), landing on the service order detail page. If the BOM is incomplete or the customer reference duplicates another order, it stays a draft and a message explains why. A linked case shows the order in its Service Orders card.",
      },
    ],
    checkBefore: [
      "Only the affected lines and quantities are on the order — not the whole original order.",
      "Repair Scope is right per line (a full remake re-runs every department).",
      "Delivery hub is the address the item should go back to.",
    ],
    result:
      "An SV-YYMM-NNN service order appears under QUALITY → Service Order (status in production after \"Create Order\", or draft). Production orders are created for it on confirm, and it is linked to the service case when created from the case.",
    warnings: [
      // src/pages/sales/create.tsx:1938-1945 — CONFIRMED chains POST /:id/confirm (BOM guard + production cascade)
      "\"Create Order\" starts production immediately (job cards / production orders are generated) — use \"Save as Draft\" if anything is still unclear.",
      // src/api/routes/sales-orders.ts:1923 — SOFA and BEDFRAME lines may not be on the same order
      "Sofa and bedframe lines cannot be on the same service order — create two orders.",
      // src/api/lib/iso-date.ts:27 — dates must be DD/MM/YYYY or YYYY-MM-DD
      "Customer Delivery Date must be a valid date (DD/MM/YYYY or YYYY-MM-DD) or the save is refused.",
      // src/pages/sales/create.tsx:1028 — line prices default to 0 in service-order mode
      "Line prices start at 0 — enter a price only if the customer is paying for the repair.",
    ],
    undo:
      "A draft can be edited from its detail page. After it is confirmed, changes or cancellation follow the normal sales-order rules on the service order detail page; ask the sales/after-sales supervisor.",
    approvals:
      "None for the SV order. Only the older exchange modes (stock swap / remake from an external case through the legacy modal) need a service-cases approve holder to approve first.",
    commonMistakes: [
      {
        mistake: "Starting from QUALITY → Service Order instead of the case, so the order is not linked to the case.",
        fix: "Start from the case's \"Spawn Service Order\" button so the case pipeline tracks the repair.",
      },
      {
        mistake: "Copying all lines of the original order.",
        fix: "Untick the lines that are fine before \"Copy Selected\", or lower Copy Qty to the defective quantity.",
      },
    ],
    workedExample:
      "From case SC-2611-018, Aisha clicks \"Spawn Service Order\"; the page arrives pre-filled with the headboard line from SO-2611-042. She sets Repair Scope to a partial repair with Upholstery and Packing, writes 'Replace left panel' in Line Notes and clicks \"Create Order\". SV-2611-007 goes to production.",
    related: ["open-service-case", "move-service-case-stage", "create-delivery-order", "delivery-return"],
    nextStep: "When the repair is ready, create the delivery order (create-delivery-order), then close the case.",
    contact: "After-sales supervisor",
    // src/api/routes/sales-orders.ts:2406 — salesOrgCode = resolveCompanyCode(body.salesOrgCode), blank → HOOKKA; any active company allowed
    companies: ["ALL"],
    variants: [
      {
        case: "Booking under a sister company (sales org other than HOOKKA)",
        differences: [
          // src/pages/sales/create.tsx:416 — defaults to HOOKKA; the "Company" select lists active organisations
          "Pick the company in \"Company\" on the create form (defaults to HOOKKA); it sets the letterhead company on the order. Accounting stays under HOOKKA.",
        ],
      },
      {
        case: "Customer with several delivery hubs",
        differences: [
          // src/api/routes/sales-orders.ts:1864-1900 — hub resolved by picked hub, else by state, else the only hub, else left unset
          "Pick the right hub in \"Delivery Hub *\". If none is picked the system uses the customer's hub in the order's state, or the customer's only hub — otherwise the hub is left empty, never guessed.",
        ],
      },
      {
        case: "Customer still marked as potential",
        differences: [
          // src/api/routes/sales-orders.ts:1803-1813 + src/api/lib/customer-stage.ts:95-101 — POTENTIAL customers refused
          "The order is refused until the customer is confirmed in the customer master.",
        ],
      },
      {
        case: "External case (no source order) — legacy repair order",
        differences: [
          // src/pages/service-cases/detail.tsx:814-818 — EXTERNAL cases open the legacy modal; src/api/routes/service-orders.ts:561 — service-orders:create
          "\"Spawn Service Order\" opens a pop-up instead: pick \"Repair\", \"Stock Swap\" or \"Reproduce\" under \"Resolution Mode\", list the affected items and click \"Spawn Order\". Stock Swap and Reproduce need an approved exchange first.",
        ],
      },
      {
        case: "Phone (/m app)",
        differences: [
          // src/pages/m/screens/orders/SvOrderForm.tsx:405-411 — Customer (required), Delivery hub, Company
          "The phone service-order form has \"Customer\", \"Delivery hub\" and \"Company\" at the top, then dates and references; the Company choice is only shown when creating, not when editing.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "mail-center-reply",
    title: "Reply to an email in Mail Center",
    keywords: [
      "reply email", "mail center", "answer email", "reply all", "customer email", "inbox",
      "回复邮件", "回邮件", "邮件", "邮箱",
      "balas emel", "emel", "peti masuk",
    ],
    module: "Mail Center",
    purpose: "Answer an incoming customer / supplier email from inside the ERP so the reply is stored on the same conversation and visible to colleagues.",
    prerequisites: [
      // src/api/routes/mail-center.ts:2637 — reply gated by mail-center:create
      "Your role has create permission on Mail Center.",
      // src/api/routes/mail-center.ts:2696-2697 — non-admins can only reply on threads of a mailbox in their scope (else "Thread not found")
      "The conversation's mailbox is one of yours (admins can reply on any mailbox).",
    ],
    who: "Any staff who handle email: sales, customer service, purchasing, accounts.",
    permission: ["mail-center:create"],
    page: "/mail-center",
    sidebar: "OVERVIEW → Mail Center",
    steps: [
      {
        do: "In the Mail Center list (\"Inbox\"), find the email — use \"Search mail…\" if needed — and click the row.",
        page: "/mail-center",
        then: "The conversation opens on its own page with the reply box at the bottom.",
      },
      {
        do: "Click \"Reply\" (answers whoever wrote last) or \"Reply all\" (everyone on the latest message).",
        page: "/mail-center/:id",
        highlight: "Reply",
        then: "The page scrolls to the reply box and fills To (and Cc for Reply all).",
      },
      {
        do: "Check the recipients and write the reply.",
        page: "/mail-center/:id",
        fields: [
          { label: "To", required: true, value: "Pre-filled; add or remove addresses. At least one valid recipient is needed.", example: "'purchasing@limfurniture.com.my'" },
          { label: "Cc", required: false, value: "Click \"Add Cc\" to show it." },
          { label: "Bcc", required: false, value: "Click \"Add Bcc\" to show it." },
          { label: "From", required: false, value: "Your own mailbox by default; switchable only if you have 2 or more mailboxes." },
          { label: "Type your reply…", required: true, value: "The message text; Send stays disabled while it is empty.", example: "'Dear Mr Lim, your replacement panel will be delivered on 10 Dec.'" },
          { label: "Attach", required: false, value: "Images or PDF only, max 10 files and 5 MB in total." },
          { label: "Request acknowledgement", required: false, value: "Tick to ask staff recipients to confirm they read it, and pick the deadline; overdue ones are reminded by email." },
        ],
      },
      {
        do: "Click \"Send reply\".",
        page: "/mail-center/:id",
        highlight: "Send reply",
        check: "If a colleague replied while you were typing, a box shows their reply instead of sending: choose \"Send mine too\" or \"Discard mine\".",
        then: "The email is sent from the shown mailbox (via Brevo), \"Reply sent.\" appears, the box clears and your message shows in the conversation.",
      },
    ],
    checkBefore: [
      "Recipients are right — Reply all may include people who should not see your answer.",
      "Nothing confidential (cost prices, other customers' data) is in the text or attachments.",
    ],
    result: "The reply is emailed to the recipients and stored as an outbound message on the same conversation, visible to everyone who can see this mailbox.",
    warnings: [
      "Sends an email outside the company immediately — it cannot be recalled.",
      // src/api/routes/mail-center.ts:2674 — empty body refused
      "An empty reply is refused.",
      // src/api/routes/mail-center.ts:2684 + src/api/lib/mail-attachments.ts:21-22 — max 10 files, 5 MB total
      "Attachments over 10 files or 5 MB in total are refused and nothing is sent.",
      // src/api/routes/mail-center.ts:2735-2738 — reply guard: a colleague's newer reply blocks the send once
      "If a colleague replied after the newest message you saw, the first send is stopped so you can choose.",
      // src/api/routes/mail-center.ts:2753,2756 — no correspondent / invalid recipient set refused
      "A reply with no valid recipient is refused.",
    ],
    undo: "A sent email cannot be unsent. Send a follow-up correction with \"Reply\" on the same conversation.",
    commonMistakes: [
      { mistake: "Using \"Forward\" to answer the customer.", fix: "Use \"Reply\" so the answer stays on the same conversation with the customer." },
      { mistake: "Two colleagues answering the same email.", fix: "Watch the banner showing who else is replying; if the already-replied box appears, choose \"Discard mine\" unless your reply adds something." },
    ],
    workedExample:
      "Siti opens the email from Lim Furniture asking about delivery, clicks \"Reply\", types the delivery date, attaches the DO PDF with \"Attach\" and clicks \"Send reply\".",
    related: ["open-service-case"],
    nextStep: "If the email is a complaint, open a service case for it (open-service-case).",
    contact: "Mail Center administrator (Super Admin)",
    companies: ["ALL"],
    variants: [
      {
        case: "You have more than one mailbox",
        differences: [
          // src/pages/mail-center/detail.tsx:1395 + src/api/routes/mail-center.ts:2707-2713 — From honoured only for a mailbox in your scope
          "A \"From\" drop-down appears; pick the mailbox the reply should come from. A mailbox outside your scope is ignored and the reply goes from the conversation's own mailbox.",
        ],
      },
      {
        case: "Phone (/m app)",
        differences: [
          // src/pages/m/screens/comms/mail/MailThread.tsx:257 + MailComposer.tsx:367
          "Open the conversation in the phone Mail Center, tap \"Reply\" or \"Reply all\", type the message and tap \"Send\".",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "apply-leave",
    title: "Apply for leave (currently not available in the ERP)",
    keywords: [
      "apply leave", "leave application", "annual leave", "medical leave", "MC", "time off",
      "请假", "年假", "病假", "申请假期",
      "cuti", "mohon cuti", "cuti tahunan", "cuti sakit",
    ],
    module: "HR / Employees",
    purpose:
      "Explain how leave is handled today. The leave screens exist in the code but are switched off until rollout (owner decision 2026-05-10): the worker app Me page has no leave card and the Employees page has no leave tab, so there is no on-screen way to apply for or approve leave right now.",
    prerequisites: [
      // src/pages/worker/me.tsx:226 — SHOW_LEAVES = false; src/pages/employees.tsx:11683 — leave tab hidden until rollout
      "None in the ERP — leave is arranged directly with your supervisor / HR.",
    ],
    who: "Workers ask; supervisors and HR / payroll staff record the outcome.",
    permission: ["leaves:create"],
    page: "/employees",
    sidebar: "HR & OPERATIONS → Employees",
    steps: [
      {
        do: "Worker: tell your supervisor or HR the leave type (annual, medical, unpaid, emergency), the dates and the reason before the leave starts; hand in the medical certificate for medical leave. There is no ERP form for this at present.",
      },
      {
        do: "HR: after the leave, open the \"Working Hours\" tab on the Employees page, set the date range to the leave days and check that the worker has no hours keyed for them.",
        page: "/employees",
        highlight: "Working Hours",
        check: "A day with no hours is treated as Pending for 2 working days and then counts as an absence (salary ÷ 26 deducted) in Payroll.",
      },
      {
        do: "HR: open the \"Payroll\" tab and check the worker's month; agree with the payroll owner how approved paid leave is treated before pressing Generate.",
        page: "/employees",
        highlight: "Payroll",
      },
    ],
    checkBefore: ["The supervisor has agreed to the dates before the worker takes the leave."],
    result:
      "No leave record is created in the ERP today. Leave days show as days without hours in Working Hours and the worker's \"Daily Attendance\" on the worker app Pay page.",
    warnings: [
      // src/lib/pay-rules.ts:133 — absenceGraceWorkingDays: 2 (editable in the Pay Rules panel)
      "Unrecorded days become absences after 2 working days (default pay rule) and reduce pay — HR must sort out paid leave before the month's payroll is finalised.",
    ],
    undo: "Not applicable in the ERP. Payroll corrections are made by the payroll owner before Generate.",
    approvals:
      "Today: the supervisor / HR approve outside the system. When the leave screens are switched on, requests are filed as PENDING and an office user with leaves update permission approves or rejects them.",
    commonMistakes: [
      { mistake: "Looking for a leave button in the worker app.", fix: "It is switched off for now — ask your supervisor or HR directly." },
    ],
    workedExample:
      "Worker Ahmad needs 2 days of annual leave on 3–4 Dec. He tells his supervisor on 25 Nov. After the leave, HR checks \"Working Hours\" for 3–4 Dec and settles the pay treatment with the payroll owner before month-end.",
    related: ["attendance-working-hours"],
    contact: "HR / payroll officer",
    companies: ["ALL"],
    variants: [
      {
        case: "Once the leave screens are switched on (not yet)",
        differences: [
          // src/pages/worker/me.tsx:226 SHOW_LEAVES=false; src/api/routes/worker.ts:3021,3026,3038 — type+dates required, end not before start, filed PENDING
          "Workers would file leave from the worker app Me page: type, from and to dates are required, the end date may not be before the start date, and the request is saved as PENDING.",
          // src/pages/employees.tsx:11683 — Leave Management tab commented out; src/api/routes/leaves.ts:251 — status change needs leaves:update
          "The office would approve or reject in the Employees leave tab, which needs leaves update permission.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "attendance-working-hours",
    title: "Record and check attendance and working hours",
    keywords: [
      "attendance", "clock in", "clock out", "punch", "working hours", "time sheet", "late", "overtime", "OT",
      "考勤", "打卡", "上班打卡", "下班打卡", "工时", "出勤", "加班",
      "kehadiran", "daftar masuk", "daftar keluar", "waktu kerja", "lebih masa",
    ],
    module: "HR / Employees",
    purpose:
      "Workers punch in and out on the worker app; the office checks punches on the Attendance tab and keys or verifies hours on the Working Hours tab, which is what payroll uses.",
    prerequisites: [
      // src/api/routes/worker.ts:1276-1287 — punch without location refused; src/pages/worker/index.tsx:687-693 — selfie required in the app
      "Worker: an employee number and PIN for the worker app, a phone with camera and location turned on.",
      // src/api/lib/nav-permissions.ts:120 — /employees maps to workers; src/api/routes/attendance.ts:217 — list needs attendance:read
      "Office: access to HR & OPERATIONS → Employees and read permission on attendance; keying hours also needs attendance create / update.",
    ],
    who: "Workers (punching); HR / payroll staff and supervisors (checking and keying hours).",
    permission: ["attendance:read"],
    page: "/employees",
    sidebar: "HR & OPERATIONS → Employees",
    steps: [
      {
        do: "Worker: open the worker app, sign in with \"Employee No\" and \"PIN\", then on Home tap \"Clock in\" (and \"Clock out\" at the end of the day).",
        page: "/worker",
        highlight: "Clock in",
        check: "A selfie is required (cancelling the camera cancels the punch) and location must be on, or the punch is refused.",
        then: "The punch time (Malaysia time), location badge and selfie go straight to the office Attendance tab and pre-fill the Working Hours punch column. On clock-out the day's Working Hours rows are created automatically.",
      },
      {
        do: "Office: open the \"Attendance\" tab and pick the \"Date\".",
        page: "/employees",
        highlight: "Attendance",
        then: "Each worker's \"Clock In\", \"Clock Out\", location (\"At factory\", \"Off-site\" or \"No GPS\") and selfie thumbnails are listed.",
      },
      {
        do: "Office: open the \"Working Hours\" tab, set the date range, and check or key hours. Click \"Add Row\" for a missing entry, or \"Copy yesterday\" to start from yesterday's pattern.",
        page: "/employees",
        highlight: "Working Hours",
        fields: [
          { label: "Employee", required: true, value: "Pick the worker.", example: "'Ahmad bin Ali'" },
          { label: "Department", required: true, value: "The department the hours were worked in.", example: "'Upholstery'" },
          // src/api/routes/working-hour-entries.ts:158-162 — required for production depts (SOFA/BEDFRAME/ACCESSORY), refused for non-production
          { label: "Category", required: false, value: "Required for production departments (sofa, bedframe or accessory); must stay empty for non-production departments." },
          { label: "Punch (in / out)", required: false, value: "HH:MM clock-in / clock-out; Hours auto-fills (lunch deducted, late rounded, OT blocks).", example: "'08:02' / '18:30'" },
          // src/api/routes/working-hour-entries.ts:165-166 — hours must be a non-negative number
          { label: "Hours", required: true, value: "Non-negative number of hours worked in that department; split across rows if the worker moved departments.", example: "'9'" },
          { label: "Notes", required: false, value: "Free text." },
        ],
      },
      {
        do: "Office: click \"Save All\" to save every changed row.",
        page: "/employees",
        highlight: "Save All",
        check: "A row without employee or department shows an error and is not saved.",
        then: "Rows are saved; the worker's My Pay estimate and the Payroll tab update from them.",
      },
    ],
    checkBefore: [
      "Off-site punches are explained by the supervisor.",
      "Each worker's daily total matches the punch (the chip over 9h shows OT in amber).",
    ],
    result:
      "Punches show on the \"Attendance\" tab; hours show on the \"Working Hours\" tab and feed Payroll, Labor Cost and the worker's \"Daily Attendance\" on the worker app Pay page.",
    warnings: [
      // src/lib/pay-rules.ts:133 — absenceGraceWorkingDays: 2
      "Hours drive pay: late or short days are deducted automatically and blank days become absences after 2 working days.",
      // src/pages/employees.tsx:1446 — row without employee/department not saved
      "A row without an employee or department is not saved.",
      // src/api/routes/worker.ts:1414 — clock-out without a clock-in today is refused
      "A worker cannot clock out without a clock-in for the same day.",
    ],
    undo:
      "Edit or delete a Working Hours row (the row's delete action) and save; a wrong automatic late/short deduction can be undone in the under-recorded review on the \"Labor Cost\" tab. Needs attendance update / delete permission.",
    deadlines: "Hours must be verified before payroll is finalised with Generate at month-end; after that the payslip is locked.",
    commonMistakes: [
      { mistake: "Worker refuses camera or location, so the punch never records.", fix: "Allow camera and location in the phone settings and tap \"Clock in\" again." },
      { mistake: "Editing rows and leaving without saving.", fix: "Click \"Save All\" — the button shows how many rows are unsaved." },
    ],
    workedExample:
      "Ahmad taps \"Clock in\" at 07:58 and \"Clock out\" at 18:35. Next morning HR opens \"Attendance\", sees At factory for both punches, then on \"Working Hours\" confirms the auto rows (9h + OT) and clicks \"Save All\" after adding a note.",
    related: ["apply-leave"],
    contact: "HR / payroll officer",
    companies: ["ALL"],
    variants: [
      {
        case: "Phone (/m app, office staff)",
        differences: [
          // src/pages/m/screens/employees/employees-sections.ts:9-10
          "Open Employees on the phone app and pick the \"Attendance\" or \"Working Hours\" section from the section bar.",
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "maintenance-log",
    title: "Log equipment maintenance",
    keywords: [
      "maintenance log", "equipment maintenance", "machine service", "repair log", "preventive maintenance", "breakdown",
      "设备保养", "保养记录", "机器维修", "维修记录",
      "penyelenggaraan", "log penyelenggaraan", "servis mesin", "baiki mesin",
    ],
    module: "HR & Operations / Maintenance",
    purpose:
      "Record preventive, corrective or emergency maintenance done on a machine so the next due date is recalculated and the history, cost and downtime are kept.",
    prerequisites: [
      "The equipment is registered in the \"Equipment List\" (add it with \"Save Equipment\" in the add-equipment form if not).",
      // src/api/routes/equipment.ts:238 — PUT /api/equipment/:id (logMaintenance) gated by equipment:update; nav-permissions.ts:121 — /maintenance → equipment
      "Your role has update permission on equipment.",
    ],
    who: "Maintenance technician, production supervisor, factory admin.",
    permission: ["equipment:update"],
    page: "/maintenance",
    sidebar: "HR & OPERATIONS → Maintenance",
    steps: [
      {
        do: "On the \"Equipment List\" tab find the machine and click \"Log\" in its Actions column (or click \"Log Maintenance\" next to it on the \"Maintenance Schedule\" tab).",
        highlight: "Log",
        then: "A \"Log Maintenance\" form for that machine opens below the list.",
      },
      {
        do: "Fill in the maintenance details.",
        fields: [
          { label: "Preventive", required: true, value: "Type drop-down: \"Preventive\", \"Corrective\" or \"Emergency\".", example: "'Corrective'" },
          { label: "Date", required: true, value: "The date the work was done. The box starts with a fixed old date, so always set it.", example: "'2026-11-26'" },
          { label: "Performed By", required: true, value: "Name of the technician or vendor.", example: "'Tan Ah Kow (vendor)'" },
          { label: "Description of work done", required: true, value: "What was done.", example: "'Replaced needle bar and timing belt'" },
          { label: "Cost (RM)", required: false, value: "Ringgit, 2 decimals; stored in sen.", example: "'250.00'" },
          { label: "Downtime (hours)", required: false, value: "Hours the machine was out of use, steps of 0.5.", example: "'3.5'" },
        ],
      },
      {
        do: "Click \"Submit Log\".",
        highlight: "Submit Log",
        check: "Date and type are right — the next due date is calculated from this date.",
        then:
          "The log is saved, the machine's last maintenance date becomes this date, the next date = this date + its cycle days, and a machine marked MAINTENANCE or REPAIR goes back to OPERATIONAL. The form closes; the entry appears on the \"Maintenance History\" tab.",
      },
    ],
    checkBefore: ["The right machine name is shown in the form title.", "The date is the actual work date, not the pre-filled one."],
    result:
      "A new row in the \"Maintenance History\" tab (date, equipment, type, description, performed by, cost, downtime) and an updated next maintenance date on the \"Equipment List\" and \"Maintenance Schedule\" tabs.",
    warnings: [
      // src/api/routes/equipment.ts:281-284 — MAINTENANCE / REPAIR → OPERATIONAL on log
      "Logging resets the machine's status to OPERATIONAL if it was under maintenance or repair.",
      // src/api/routes/equipment.ts:279 — next date = log date + maintenanceCycleDays
      "The next maintenance date is recalculated from the log date plus the machine's cycle days — a wrong date shifts the whole schedule.",
      // src/pages/maintenance.tsx:580 — date input defaults to a fixed 2026-04-14
      "The date box starts on a fixed old date; change it every time.",
    ],
    undo:
      "There is no delete button for a log on this page. Correct the machine's status or dates with \"Edit\" on the Equipment List; ask an admin with maintenance-logs delete permission to remove a wrong log.",
    commonMistakes: [
      { mistake: "Leaving the pre-filled date, so the next due date is calculated from the wrong day.", fix: "Always pick the real work date before \"Submit Log\"." },
      { mistake: "Logging against the wrong machine.", fix: "Check the machine name in the \"Log Maintenance\" title before submitting." },
    ],
    workedExample:
      "Sewing machine EQ-SEW-005 broke down. After the vendor fixed it, Rahim clicks \"Log\", picks Corrective, sets the date 2026-11-26, Performed By 'Tan Ah Kow', describes the repair, enters 250.00 and 3.5 hours, and clicks \"Submit Log\".",
    related: [],
    contact: "Factory / maintenance supervisor",
    companies: ["ALL"],
  },
];
