// useSalesOrderActions — the Sales Order status actions on mobile, with the DESKTOP behaviour
// (src/pages/sales/detail.tsx): the same requests, bodies, confirmation wording and error handling.
//   Confirm       POST /api/sales-orders/:id/confirm  { changedBy } + Idempotency-Key.
//                 422 + details.incompleteProducts -> the BOM-incomplete list (the order stays DRAFT).
//   Cancel / Undo / Hold / Resume
//                 PUT  /api/sales-orders/:id  { status, changedBy [, holdReason] }.
//                 409 + blockingItems -> the "completed work blocks cancel" list.
//                 Success message says how many production orders / job cards the cascade touched.
//   Hold          a reason is required (the server rejects a blank one).
//   Edit          the SoEditSheet (lib/so-edit.ts keeps every line field); `override-edit` first asks
//                 POST …/override-edit-lock for a token (reason >= 5 chars; ADMIN / SUPER_ADMIN, production-window lock).
//   Issue DO      the Delivery module (desktop "Create Delivery" opens the Delivery page).
//   Delete Draft  DELETE /api/sales-orders/:id after a confirmation (desktop: "Delete order?"); the server refuses anything but a DRAFT.
//   Generate Invoice  the Invoices module (desktop's button opens the Invoices page; there is no request).
//   Service case / Customer / Hub  open their sheets (screens/so/so-change-sheets.tsx).
// What each button asks and says is injected (`ask`, `info`, `notify`), so the same handlers serve the
// phone, fold and tablet screens and can be run in a test. Permissions are enforced by the API; the
// screen only hides what lib/so-actions.ts says the user cannot use.
import { useState } from "react";
import { getCurrentUser } from "@/lib/auth";
import { invalidateCache } from "@/lib/cached-fetch";
import { str } from "../config/helpers";
import { mutateJson, refreshList, refreshOne } from "../config/mutate";
import type { ConfirmSpec } from "../screens/delivery/ui";

type Row = Record<string, unknown>;
export type SoNotify = (text: string, tone: "success" | "error") => void;
export type SoInfo = { title: string; intro: string; items: string[]; foot?: string };

type Cascade = { affectedPoCount?: number; affectedJcCount?: number } | null | undefined;
type StatusBody = { cascade?: Cascade; blockingItems?: { poNo?: string; departmentName?: string; completedDate?: string }[] };
type ConfirmBody = { message?: string; details?: { incompleteProducts?: { productCode: string; productName: string }[] } };

/** Desktop's toast after a status change: how much the cascade touched, or a plain line. */
export function statusMessage(target: string, cascade: Cascade): string {
  const po = cascade?.affectedPoCount ?? 0;
  const jc = cascade?.affectedJcCount ?? 0;
  if (po > 0 || jc > 0) {
    const parts: string[] = [];
    if (po > 0) parts.push(`${po} production order${po === 1 ? "" : "s"}`);
    if (jc > 0) parts.push(`${jc} job card${jc === 1 ? "" : "s"}`);
    return `Status → ${target}. ${parts.join(" + ")} updated.`;
  }
  return `Status updated to ${target}.`;
}

const dateOf = (v?: string): string => (v ? v.slice(0, 10) : "");

export function useSalesOrderActions({
  url,
  id,
  doc,
  notify,
  ask,
  info,
  goDelivery,
  goInvoices,
  afterDelete,
}: {
  /** `/api/sales-orders/<id>` */
  url: string;
  id: string;
  doc: Row | null;
  notify: SoNotify;
  /** Show a confirmation; resolves true when the user confirms. */
  ask: (spec: ConfirmSpec) => Promise<boolean>;
  /** Show a read-only list (BOM incomplete / blocked cancel). */
  info: (spec: SoInfo) => void;
  goDelivery: () => void;
  goInvoices: () => void;
  /** The order no longer exists: leave its page. */
  afterDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideToken, setOverrideToken] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);

  const reload = () => {
    refreshOne(url);
    refreshList("/api/sales-orders");
    // Confirming, cancelling, holding… all move production orders.
    refreshList("/api/production-orders");
  };
  // Who made the change, for the audit row (a session with no stored user falls back to "Admin", as desktop does).
  const actor = () => {
    try { return getCurrentUser()?.displayName?.trim() || "Admin"; } catch { return "Admin"; }
  };

  const confirmOrder = async () => {
    if (busy) return;
    const ok = await ask({
      title: "Confirm Sales Order",
      sub: str(doc ?? {}, "companySO", "companySOId") || undefined,
      lines: [
        { icon: "list", text: "This will create Production Orders for all line items and change the status to CONFIRMED." },
        { icon: "warning", text: "It starts production and purchasing, so check the order before you continue." },
      ],
      confirmLabel: "Confirm & Create POs",
    });
    if (!ok) return;
    setBusy(true);
    const r = await mutateJson<ConfirmBody>(`${url}/confirm`, "POST", { changedBy: actor() }, { "Idempotency-Key": crypto.randomUUID() });
    setBusy(false);
    if (!r.ok) {
      const bad = r.body?.details?.incompleteProducts;
      if (r.status === 422 && bad?.length) {
        info({
          title: "Cannot confirm",
          intro: "These products have no WIP components in their BOM yet:",
          items: bad.map((p) => `${p.productCode}: ${p.productName}`),
          foot: "Fill in their WIP components under Products → BOM first, then retry. The order stays in DRAFT.",
        });
      } else notify(r.error || `Failed to confirm order (HTTP ${r.status})`, "error");
      return;
    }
    reload();
    notify(r.body?.message || "Order confirmed", "success");
  };

  const changeStatus = async (target: string, holdReason?: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    const body = target === "ON_HOLD" ? { status: target, holdReason: (holdReason || "").trim(), changedBy: actor() } : { status: target, changedBy: actor() };
    const r = await mutateJson<StatusBody>(url, "PUT", body);
    setBusy(false);
    if (!r.ok) {
      const blocking = r.body?.blockingItems;
      if (r.status === 409 && Array.isArray(blocking)) {
        info({
          title: "Cannot cancel",
          intro: "These items have completion dates that block cancellation:",
          items: blocking.map((b) => [b.poNo, b.departmentName, dateOf(b.completedDate)].filter(Boolean).join(" · ")),
          foot: "Clear those completion dates on the Production page, or move the completed units to another order. Then this order can be cancelled.",
        });
      } else notify(r.error || `Failed to update status (HTTP ${r.status})`, "error");
      return false;
    }
    reload();
    notify(statusMessage(target, r.body?.cascade), "success");
    return true;
  };

  const onCancel = async () => {
    const ok = await ask({
      title: "Cancel Order",
      sub: str(doc ?? {}, "companySO", "companySOId") || undefined,
      lines: [{ icon: "warning", text: "Are you sure you want to cancel this order? This action cannot be easily undone." }],
      confirmLabel: "Cancel Order",
    });
    if (ok) await changeStatus("CANCELLED");
  };

  const onUndoCancel = async () => {
    const target = str(doc ?? {}, "preCancelStatus") || "IN_PRODUCTION";
    const ok = await ask({
      title: "Undo Cancel",
      lines: [{ icon: "info", text: `This order and the production orders / job cards cancelled with it will be restored. The order returns to ${target}. Completed work was never cancelled and is unaffected.` }],
      confirmLabel: "Undo Cancel",
    });
    if (ok) await changeStatus(target);
  };

  const onResume = async () => {
    const target = str(doc ?? {}, "preHoldStatus") || "CONFIRMED";
    const ok = await ask({
      title: "Resume Order",
      lines: [{ icon: "info", text: `Are you sure you want to resume this order? The order will return to ${target} status.` }],
      confirmLabel: "Resume Order",
    });
    if (ok) await changeStatus(target);
  };

  const submitHold = async (reason: string): Promise<boolean> => {
    if (!reason.trim()) return false;
    const done = await changeStatus("ON_HOLD", reason);
    if (done) setHoldOpen(false);
    return done;
  };

  /** Admin override of a production-window edit lock: a reason of 5+ characters buys one edit token. */
  const submitOverride = async (reason: string): Promise<string | null> => {
    const why = reason.trim();
    if (why.length < 5) return "Please enter a reason of at least 5 characters.";
    setBusy(true);
    const r = await mutateJson<{ overrideToken?: string }>(`${url}/override-edit-lock`, "POST", { reason: why });
    setBusy(false);
    if (!r.ok || !r.body?.overrideToken) return r.error || `Failed (HTTP ${r.status})`;
    refreshOne(url);
    setOverrideToken(r.body.overrideToken);
    setOverrideOpen(false);
    setEditOpen(true);
    notify("Override granted — opening the editor.", "success");
    return null;
  };

  const openEdit = () => { if (doc) setEditOpen(true); };

  /** Desktop deleteOrder: confirm, DELETE, drop the order from the caches (its linked production orders go with it), leave the page. */
  const onDelete = async () => {
    if (busy) return;
    const ok = await ask({
      title: "Delete order?",
      sub: str(doc ?? {}, "companySO", "companySOId") || undefined,
      lines: [
        { icon: "warning", text: "Delete this order?" },
        { icon: "info", text: "Only a draft can be deleted. Its linked production orders are deleted with it." },
      ],
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    const r = await mutateJson(url, "DELETE");
    setBusy(false);
    if (!r.ok) {
      notify(`Failed to delete order: ${r.error || `HTTP ${r.status}`}`, "error");
      return;
    }
    refreshList("/api/sales-orders");
    refreshList("/api/production-orders");
    invalidateCache(url);
    afterDelete();
  };

  return {
    id, busy, reload,
    editOpen, setEditOpen, overrideToken, setOverrideToken,
    holdOpen, setHoldOpen, overrideOpen, setOverrideOpen,
    onConfirm: confirmOrder, onCancel, onUndoCancel, onResume, submitHold, submitOverride,
    openEdit, openIssueDo: goDelivery,
    onDelete, openGenerateInvoice: goInvoices,
    caseOpen, setCaseOpen, customerOpen, setCustomerOpen, hubOpen, setHubOpen,
  };
}
