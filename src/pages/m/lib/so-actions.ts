// so-actions — which Sales Order actions exist in each status, for ONE adaptive screen (phone,
// fold and tablet). This is the DESKTOP rule set (src/pages/sales/detail.tsx), not the old tablet
// matrix, because the owner's requirement is that what desktop can do, mobile can do:
//
//   DRAFT          Edit · Confirm · Cancel
//   CONFIRMED      Edit · Put On Hold · Cancel
//   IN_PRODUCTION  Edit (only while /edit-eligibility says so) · Put On Hold · Cancel
//   READY_TO_SHIP  Issue Delivery Order (desktop "Create Delivery" opens the Delivery page)
//   ON_HOLD        Resume Order
//   CANCELLED      Undo Cancel
//   anything else  no status action ("No further status actions for this state")
//
// It is data, so it can be tested and rendered by one component. Permissions are the SAME strings
// the server checks, so a button the user could not use is not offered (the server still enforces
// every action): Confirm -> sales-orders:confirm; Edit / Hold / Resume / Cancel / Undo Cancel ->
// sales-orders:update; Issue DO -> delivery-orders:create. Omit the context and nothing is hidden.
//
// Added 2026-11-04 (the remaining desktop actions, same rules, no new ones):
//   DRAFT                                  Delete Draft      DELETE /api/sales-orders/:id (sales-orders:delete); the server refuses anything but a DRAFT
//   DELIVERED                              Generate Invoice  desktop opens the Invoices page, so this opens the Invoices module (invoices:create)
//   SHIPPED / DELIVERED / INVOICED / CLOSED Open Service Case POST /api/service-cases, source SO (service-cases:create)
// Change customer / Change delivery hub are not status actions: they are pencils on the order, locked by its delivery orders and
// invoices (`soEditLocks`), by the same rule the server enforces on PATCH /:id/customer and /:id/hub (sales-orders:update).
export type SoActionKind =
  | "edit-draft"
  | "edit"
  | "override-edit"
  | "confirm"
  | "hold"
  | "resume"
  | "cancel"
  | "undo-cancel"
  | "issue-do"
  | "generate-invoice"
  | "service-case"
  | "delete-draft";

export type SoActionAllow = { confirm?: boolean; update?: boolean; issueDo?: boolean; invoice?: boolean; serviceCase?: boolean; del?: boolean };

/** GET /api/sales-orders/:id/edit-eligibility */
export type SoEligibility = {
  editable?: boolean;
  reason?: "status" | "production_window" | "dept_completed";
  completedDept?: string;
  completedAt?: string;
} | null;

export type SoActionCtx = {
  can?: SoActionAllow;
  /** The order's `lockReason`: a downstream production order is already completed, so item / header edits are blocked. */
  locked?: boolean;
  eligibility?: SoEligibility;
  /** ADMIN / SUPER_ADMIN may override a production-window lock. */
  isAdmin?: boolean;
};

export type SoActionPlan = {
  /** A line shown above the buttons. */
  note?: string;
  /** Button rows, left to right; each row is a line of buttons. */
  rows: SoActionKind[][];
  /** Why a shown button cannot be used right now. */
  disabled?: Partial<Record<SoActionKind, string>>;
};

const dayOf = (iso?: string): string => (iso ? iso.slice(0, 10) : "");

export function soActionPlan(status: string, ctx?: SoActionCtx): SoActionPlan {
  const can = ctx?.can;
  const update = can?.update !== false;
  const confirmOk = can?.confirm !== false;
  const issueOk = can?.issueDo !== false;
  const invoiceOk = can?.invoice !== false;
  const caseOk = can?.serviceCase !== false;
  const deleteOk = can?.del !== false;
  const locked = ctx?.locked === true;
  const elig = ctx?.eligibility ?? null;
  const notes: string[] = [];
  const disabled: SoActionPlan["disabled"] = {};
  const buttons: SoActionKind[] = [];

  // Edit: DRAFT / CONFIRMED always (unless locked); IN_PRODUCTION only while the server says so.
  const eligibleEdit = elig?.editable ?? true;
  const canEdit = !locked && (status === "DRAFT" || status === "CONFIRMED" || (status === "IN_PRODUCTION" && eligibleEdit));
  const canOverride = !!ctx?.isAdmin && elig?.reason === "production_window" && !locked && (status === "CONFIRMED" || status === "IN_PRODUCTION");
  const cancelLocked = elig?.reason === "dept_completed";
  const cancelNote = cancelLocked ? `Cannot cancel — ${elig?.completedDept || "A department"} completed${elig?.completedAt ? ` on ${dayOf(elig.completedAt)}` : ""}.` : "";

  if (status === "DRAFT") {
    if (canEdit && update) buttons.push("edit-draft");
    if (confirmOk) buttons.push("confirm");
    else notes.push("Confirming this order needs the Confirm permission.");
    if (update) buttons.push("cancel");
    if (deleteOk) buttons.push("delete-draft");
  } else if (status === "CONFIRMED" || status === "IN_PRODUCTION") {
    if (canEdit && update) buttons.push("edit");
    else if (canOverride && update) buttons.push("override-edit");
    if (update) buttons.push("hold", "cancel");
    if (locked) notes.push("Editing is locked: a production order is already completed.");
    else if (status === "IN_PRODUCTION" && !eligibleEdit && !canOverride) notes.push("Editing is locked once production is under way.");
  } else if (status === "READY_TO_SHIP") {
    if (issueOk) buttons.push("issue-do");
  } else if (status === "ON_HOLD") {
    if (update) buttons.push("resume");
  } else if (status === "CANCELLED") {
    notes.push("This order was cancelled.");
    if (update) buttons.push("undo-cancel");
  } else if (status === "DELIVERED") {
    if (invoiceOk) buttons.push("generate-invoice");
  } else if (["SHIPPED", "INVOICED", "CLOSED"].includes(status)) {
    notes.push("No further status actions for this state.");
  }
  // A customer-defect claim can be opened once goods have shipped (the server re-validates).
  if (["SHIPPED", "DELIVERED", "INVOICED", "CLOSED"].includes(status) && caseOk) buttons.push("service-case");

  if (buttons.includes("cancel") && cancelLocked) {
    disabled.cancel = cancelNote;
    notes.push(cancelNote);
  }
  if (buttons.length === 0 && !update && ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "ON_HOLD", "CANCELLED"].includes(status)) {
    notes.push("You do not have permission to change this order.");
  }

  // Rows: the forward action alone on top, the rest below (max two per row).
  const forward: SoActionKind[] = ["confirm", "issue-do", "resume", "undo-cancel", "generate-invoice"];
  const lead = buttons.filter((b) => forward.includes(b));
  const rest = buttons.filter((b) => !forward.includes(b));
  const rows: SoActionKind[][] = [];
  for (const b of lead) rows.push([b]);
  for (let i = 0; i < rest.length; i += 2) rows.push(rest.slice(i, i + 2));
  const plan: SoActionPlan = { rows };
  if (notes.length) plan.note = [...new Set(notes)].join(" ");
  if (Object.keys(disabled).length) plan.disabled = disabled;
  return plan;
}

export const SO_ACTION_LABEL: Record<SoActionKind, string> = {
  "edit-draft": "Edit Draft",
  edit: "Edit",
  "override-edit": "Override Edit Lock",
  confirm: "Confirm Order",
  hold: "Put On Hold",
  resume: "Resume Order",
  cancel: "Cancel Order",
  "undo-cancel": "Undo Cancel",
  "issue-do": "Issue Delivery Order",
  "generate-invoice": "Generate Invoice",
  "service-case": "Open Service Case",
  "delete-draft": "Delete Draft",
};

// ---- Change customer / Change delivery hub: which pencils are open ------------------------------------------------
// Desktop (sales/detail.tsx) closes both once goods have left the warehouse (a linked DO that is LOADED / IN_TRANSIT / DELIVERED /
// INVOICED) and the customer also once an invoice has been issued (any linked invoice that is not DRAFT / CANCELLED). The server
// re-checks both on PATCH /:id/customer and /:id/hub. Empty string = open.
const SHIPPED_DO = ["LOADED", "IN_TRANSIT", "DELIVERED", "INVOICED"];
export function soEditLocks(
  dos: { doNo?: unknown; status?: unknown }[],
  invoices: { invoiceNo?: unknown; status?: unknown }[],
): { customer: string; hub: string } {
  const s = (v: unknown) => (v == null ? "" : String(v));
  const shipped = dos.find((d) => SHIPPED_DO.includes(s(d.status).toUpperCase()));
  const issued = invoices.find((i) => !["DRAFT", "CANCELLED"].includes(s(i.status).toUpperCase()));
  const hub = shipped ? `Hub locked: DO ${s(shipped.doNo)} already ${s(shipped.status)}.` : "";
  const customer = shipped
    ? `Customer locked: DO ${s(shipped.doNo)} already ${s(shipped.status)}.`
    : issued ? `Customer locked: invoice ${s(issued.invoiceNo)} already ${s(issued.status)}.` : "";
  return { customer, hub };
}
