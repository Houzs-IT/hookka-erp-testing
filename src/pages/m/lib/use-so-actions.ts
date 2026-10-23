// useSalesOrderActions — the Sales Order status actions, moved out of the legacy
// tablet screen (SalesDetailScreen.tsx SalesDetailTablet) WITHOUT changing them:
// the same endpoints, methods, bodies, confirmation texts and cache refreshes.
//   Confirm      POST  /api/sales-orders/:id/confirm
//   Cancel       PUT   /api/sales-orders/:id   { status: "CANCELLED" }   (window.confirm first)
//   Undo cancel  PUT   /api/sales-orders/:id   { status: preCancelStatus || "IN_PRODUCTION" }  (window.confirm first)
//   Edit         the existing SO edit form (FormSheet spec)
//   Issue DO     the existing New Delivery Order form (FormSheet spec)
// Permissions are enforced by the API; nothing here decides who may act.
import { useState } from "react";
import { str } from "../config/helpers";
import { mutateJson, refreshList, refreshOne } from "../config/mutate";
import { editSalesOrderSpec, newDeliveryOrderSpec } from "../config/forms";
import { type FormSpec } from "../config/form-types";

type Row = Record<string, unknown>;
export type SoNotify = (text: string, tone: "success" | "error") => void;

export function useSalesOrderActions({
  url,
  id,
  doc,
  notify,
}: {
  /** `/api/sales-orders/<id>` */
  url: string;
  id: string;
  doc: Row | null;
  notify: SoNotify;
}) {
  const [busy, setBusy] = useState(false);
  const [editSpec, setEditSpec] = useState<FormSpec | null>(null);

  const reload = () => {
    refreshOne(url);
    refreshList("/api/sales-orders");
  };

  const onConfirm = async () => {
    if (busy) return;
    setBusy(true);
    const r = await mutateJson(`${url}/confirm`, "POST");
    setBusy(false);
    if (r.ok) {
      reload();
      notify("Order confirmed", "success");
    } else notify(r.error || "Confirm failed", "error");
  };

  const onCancel = async () => {
    if (busy) return;
    if (!window.confirm(`Cancel ${str(doc ?? {}, "companySO") || "this order"}? You can undo this from the order page.`)) return;
    setBusy(true);
    const r = await mutateJson(url, "PUT", { status: "CANCELLED" });
    setBusy(false);
    if (r.ok) {
      reload();
      notify("Order cancelled", "success");
    } else notify(r.error || "Cancel failed", "error");
  };

  // Undo a cancel: the order, its production orders and the job cards this cancel took
  // down all return to their own prior statuses. Falls back to IN_PRODUCTION for rows
  // cancelled before pre_cancel_status existed.
  const onUndoCancel = async () => {
    if (busy) return;
    const target = str(doc ?? {}, "preCancelStatus") || "IN_PRODUCTION";
    if (!window.confirm(`Restore this order to ${target}? Cancelled production orders and job cards will be restored too.`)) return;
    setBusy(true);
    const r = await mutateJson(url, "PUT", { status: target });
    setBusy(false);
    if (r.ok) {
      reload();
      notify("Cancel undone", "success");
    } else notify(r.error || "Undo failed", "error");
  };

  const openEdit = () => {
    if (doc) setEditSpec(editSalesOrderSpec(doc, id));
  };
  const openIssueDo = () => setEditSpec(newDeliveryOrderSpec());

  return { busy, editSpec, setEditSpec, reload, onConfirm, onCancel, onUndoCancel, openEdit, openIssueDo };
}
