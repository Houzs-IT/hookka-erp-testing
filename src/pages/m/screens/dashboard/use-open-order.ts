// Hook and pill helpers shared by the Overdue / Due soon cards and their full-page worklists (Home Operations v3).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "@/lib/use-permission";
import { cachedFetchJsonResult } from "@/lib/cached-fetch";
import { duePill, type ProdOrder } from "./ops-lib";
import { PILL } from "./ops-glass-style";

/**
 * Opening an order from a list: the feed carries the production order NUMBER but not its id, so the number is looked up on the
 * mobile Production board (GET /api/production-orders/board, the endpoint /m Production already reads, same production-orders:read
 * gate as the section) when the row is tapped, then /m/production/:id opens. No new endpoint; nothing is fetched until a tap.
 */
export function useOpenOrder() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const can = hasPermission("production-orders", "read");
  const open = async (poNo: string | null) => {
    if (!poNo || busy) return;
    setErr(null);
    setBusy(poNo);
    const r = await cachedFetchJsonResult<{ data?: { id: string; poNo: string }[] }>("/api/production-orders/board");
    setBusy(null);
    if (!r.ok) { setErr(`Couldn’t open ${poNo}: the production board could not be loaded.`); return; }
    const hit = (r.data?.data ?? []).find((o) => o.poNo === poNo);
    if (!hit) { setErr(`Couldn’t find ${poNo} on the production board.`); return; }
    navigate(`/m/production/${encodeURIComponent(hit.id)}`);
  };
  return { can, busy, err, open };
}
export type OpenOrder = ReturnType<typeof useOpenOrder>;

export type Pill = { label: string; bg: string; fg: string };
export const latePill = (o: ProdOrder): Pill => ({ label: o.daysToDD == null ? "—" : `${-o.daysToDD} d late`, ...PILL.red });
export const duePillOf = (o: ProdOrder): Pill => {
  const p = duePill(o.daysToDD);
  return { label: p.label, ...(p.urgent === true ? PILL.red : p.urgent === false ? PILL.amber : PILL.grey) };
};

