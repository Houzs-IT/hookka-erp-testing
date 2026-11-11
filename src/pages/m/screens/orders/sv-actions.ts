// sv-actions — which actions the SV Service Order detail offers (pure, no React).
// Rule source: DESKTOP src/pages/sales/detail.tsx (~1146-1162) + src/api/routes/sales-orders/_helpers.ts
// VALID_TRANSITIONS. Mirrors the desktop UI, not the prototype:
//   Edit    DRAFT / CONFIRMED / IN_PRODUCTION; locked by production_started (any job card not WAITING/CANCELLED).
//   Hold    CONFIRMED / IN_PRODUCTION.       Cancel  DRAFT / CONFIRMED / IN_PRODUCTION.
//   Resume  ON_HOLD.  Undo cancel  CANCELLED.  Delete  DRAFT.
//   Override edit lock is NOT supported (server ignores overrideToken) — there is no such action.
// Permissions are the strings the server checks; the server enforces regardless.

export type SvActionKey =
  | "confirm" | "create-delivery" | "generate-invoice" | "resume" | "undo-cancel"
  | "edit" | "hold" | "cancel" | "clone" | "files" | "pdf" | "delete"
  | "change-customer" | "change-hub" | "open-case";

export type SvPerms = {
  update: boolean; // sales-orders:update
  confirm: boolean; // sales-orders:confirm
  create: boolean; // sales-orders:create (clone)
  del: boolean; // sales-orders:delete
  deliveryCreate: boolean; // delivery-orders:create
  invoiceCreate: boolean; // invoices:create
  caseCreate: boolean; // service-cases:create
};

/** GET /api/sales-orders/:id/edit-eligibility */
export type SvEligibility = {
  editable?: boolean;
  reason?: "status" | "production_started" | string;
  startedDept?: string;
  startedDeptCode?: string;
  jcStatus?: string;
  completedAt?: string;
} | null;

export type SvActionCtx = {
  status: string;
  perms: SvPerms;
  eligibility?: SvEligibility;
  /** The order's `lockReason` (a downstream PO already COMPLETED): item / header edits blocked. */
  lockReason?: string | null;
  /** From soEditLocks(): "" = open. */
  locks?: { customer: string; hub: string };
};

export type SvAction = {
  key: SvActionKey;
  label: string;
  /** Greyed out; `reason` says why. */
  disabled?: boolean;
  /** Tapping explains instead of acting (e.g. "Editing is locked"). */
  lockedReason?: string;
  reason?: string;
  danger?: boolean;
};

export type SvActionPlan = {
  primary: SvAction | null;
  menu: SvAction[];
  /** No mutating control is offered for this user. */
  viewOnly: boolean;
  /** Edit lock message for the current state ("" when editable or not applicable). */
  editLock: string;
};

export const SV_EDITABLE_STATUSES = ["DRAFT", "CONFIRMED", "IN_PRODUCTION"];
export const SV_CANCEL_STATUSES = ["DRAFT", "CONFIRMED", "IN_PRODUCTION"];
export const SV_HOLD_STATUSES = ["CONFIRMED", "IN_PRODUCTION"];
const SHIPPED_PLUS = ["SHIPPED", "DELIVERED", "INVOICED", "CLOSED"];

/** The server's wording for production_started. */
export function svEditLockMessage(e: SvEligibility, lockReason?: string | null): string {
  if (lockReason) return lockReason;
  if (!e || e.editable !== false) return "";
  if (e.reason === "production_started") {
    return `Cannot edit — ${e.startedDept || e.startedDeptCode || "A department"} has started production (job card status: ${e.jcStatus || "in progress"})`;
  }
  if (e.reason === "status") return "Cannot edit — this order's status no longer allows edits.";
  return "Cannot edit this order right now.";
}

/** Copy for the cancel confirmation (the shared hook's "cannot be easily undone" wording is replaced). */
export const SV_CANCEL_COPY = "Cancel this order? You can undo this until it ships.";

export function svActionPlan(ctx: SvActionCtx): SvActionPlan {
  const { status: s, perms: p } = ctx;
  const locks = ctx.locks ?? { customer: "", hub: "" };
  const A = (key: SvActionKey, label: string, extra?: Partial<SvAction>): SvAction => ({ key, label, ...extra });

  let primary: SvAction | null = null;
  if (s === "DRAFT" && p.confirm) primary = A("confirm", "Confirm order");
  else if (s === "READY_TO_SHIP" && p.deliveryCreate) primary = A("create-delivery", "Create delivery");
  else if (s === "DELIVERED" && p.invoiceCreate) primary = A("generate-invoice", "Generate invoice");
  else if (s === "ON_HOLD" && p.update) primary = A("resume", "Resume order");
  else if (s === "CANCELLED" && p.update) primary = A("undo-cancel", "Undo cancel");

  // Edit lock only applies to CONFIRMED / IN_PRODUCTION (DRAFT has nothing to lock but a completed PO).
  const lockMsg = SV_EDITABLE_STATUSES.includes(s) ? svEditLockMessage(s === "DRAFT" ? null : ctx.eligibility ?? null, ctx.lockReason) : "";

  const menu: SvAction[] = [];
  if (SV_EDITABLE_STATUSES.includes(s) && p.update) menu.push(A("edit", "Edit order", lockMsg ? { lockedReason: lockMsg, reason: "Locked" } : undefined));
  if (SV_HOLD_STATUSES.includes(s) && p.update) menu.push(A("hold", "Put on hold"));
  if (s === "ON_HOLD" && p.update) menu.push(A("resume", "Resume order"));
  if (SV_CANCEL_STATUSES.includes(s) && p.update) menu.push(A("cancel", "Cancel order", { danger: true }));
  if (s === "CANCELLED" && p.update) menu.push(A("undo-cancel", "Undo cancel"));
  if (p.update && s !== "CANCELLED") {
    menu.push(A("change-customer", "Change customer", locks.customer ? { disabled: true, reason: locks.customer } : undefined));
    menu.push(A("change-hub", "Change delivery hub", locks.hub ? { disabled: true, reason: locks.hub } : undefined));
  }
  if (p.create) menu.push(A("clone", "Clone"));
  menu.push(A("files", "Files"));
  menu.push(A("pdf", "Download PDF"));
  if (SHIPPED_PLUS.includes(s) && p.caseCreate) menu.push(A("open-case", "Open service case"));
  if (s === "DRAFT" && p.del) menu.push(A("delete", "Delete draft", { danger: true }));

  const mutating = new Set<SvActionKey>(["edit", "hold", "resume", "cancel", "undo-cancel", "change-customer", "change-hub", "open-case", "clone", "delete"]);
  const viewOnly = !primary && !menu.some((m) => mutating.has(m.key));
  return { primary, menu, viewOnly, editLock: lockMsg };
}

/**
 * The status Resume / Undo-cancel will request. SAME logic as useSalesOrderActions (src/pages/m/lib/use-so-actions.ts):
 *   resume      -> doc.preHoldStatus   || "CONFIRMED"
 *   undo-cancel -> doc.preCancelStatus || "IN_PRODUCTION"
 * Status history is never consulted. null when the status is neither ON_HOLD nor CANCELLED.
 */
export function svRestoreTarget(status: string, doc: Record<string, unknown> | null | undefined): string | null {
  const str = (k: string): string => {
    const v = doc?.[k];
    return v === undefined || v === null || v === "" ? "" : String(v);
  };
  if (status === "ON_HOLD") return str("preHoldStatus") || "CONFIRMED";
  if (status === "CANCELLED") return str("preCancelStatus") || "IN_PRODUCTION";
  return null;
}

/**
 * What tapping a menu row does. Locked / disabled rows never close the menu silently: the lock reason is shown
 * (edit -> the lock sheet; disabled rows -> toast with the reason).
 */
export type SvTapOutcome =
  | { kind: "lock-sheet"; message: string; closeMenu: true }
  | { kind: "toast"; message: string; closeMenu: false }
  | { kind: "run"; closeMenu: true };
export function svTapOutcome(a: Pick<SvAction, "disabled" | "lockedReason" | "reason">): SvTapOutcome {
  if (a.disabled) return { kind: "toast", message: a.reason || "This action isn’t available right now.", closeMenu: false };
  if (a.lockedReason) return { kind: "lock-sheet", message: a.lockedReason, closeMenu: true };
  return { kind: "run", closeMenu: true };
}
