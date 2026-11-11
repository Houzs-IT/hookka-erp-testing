// `/m/sales/:id` is the long-standing deep link for ANY sales_orders row. An SV Service Order opened through it
// (Service Case child links, old bookmarks, notifications) is redirected to the SV detail screen; a normal Sales Order
// renders exactly as before. Reads the same cached GET the detail already makes, so there is no extra request.
import { Navigate, useParams } from "react-router-dom";
import { useCachedJson } from "@/lib/cached-fetch";
import { SalesDetailScreen } from "../SalesDetailScreen";
import { svDetailPath } from "./order-model";

export function SalesDetailGate() {
  const { id = "" } = useParams();
  const { data } = useCachedJson<{ data?: { isServiceOrder?: unknown; id?: unknown } }>(id ? `/api/sales-orders/${encodeURIComponent(id)}` : null);
  if (data?.data?.isServiceOrder === true) return <Navigate to={svDetailPath(String(data.data.id ?? id))} replace />;
  return <SalesDetailScreen />;
}
