// ---------------------------------------------------------------------------
// ready-to-ship-guard.ts — which order statuses production completion may
// move FORWARD to READY_TO_SHIP.
//
// BUG-2026-10-17: the production-completion cascades (SO and CO) set
// READY_TO_SHIP whenever the order was "not already READY_TO_SHIP". An order
// that had already shipped, been delivered, invoiced or closed — e.g. the last
// job card was scanned a few days after the goods left — was pulled BACK to
// READY_TO_SHIP. Prod had 830 SOs sitting there: 98 already invoiced, 688 with
// every finished-goods unit delivered. Production finishing can only ever move
// an order out of the production stages; anything later, or on hold, is left
// alone.
// ---------------------------------------------------------------------------
export const ADVANCES_TO_READY_TO_SHIP = ["CONFIRMED", "IN_PRODUCTION"] as const;

export function canAdvanceToReadyToShip(status: string | null | undefined): boolean {
  return (ADVANCES_TO_READY_TO_SHIP as readonly string[]).includes(String(status ?? "").toUpperCase());
}

/** SQL fragment for the same rule, so the UPDATE itself refuses a backslide. */
export const READY_TO_SHIP_FROM_SQL = `status IN (${ADVANCES_TO_READY_TO_SHIP.map((s) => `'${s}'`).join(", ")})`;

/**
 * The status an SO stuck at READY_TO_SHIP should really have, read from its OWN
 * documents — the same statuses the normal flow gives (BUG-2026-10-17 repair):
 *   non-cancelled invoice(s), every one PAID → CLOSED; any invoice → INVOICED;
 *   every finished-goods unit DELIVERED → DELIVERED; every unit out
 *   (LOADED / DELIVERED) → SHIPPED. Anything else stays (null + the reason).
 */
export function correctedReadyToShipStatus(
  invoiceStatuses: string[],
  unitStatuses: string[],
): { to: "CLOSED" | "INVOICED" | "DELIVERED" | "SHIPPED"; why: string } | { to: null; why: string } {
  const iv = invoiceStatuses.map((s) => String(s ?? "").toUpperCase());
  const us = unitStatuses.map((s) => String(s ?? "").toUpperCase());
  if (iv.length) {
    return { to: iv.every((s) => s === "PAID") ? "CLOSED" : "INVOICED", why: `${iv.length} invoice(s): ${[...new Set(iv)].join("/")}` };
  }
  if (us.length && us.every((s) => s === "DELIVERED")) return { to: "DELIVERED", why: `all ${us.length} finished-goods units delivered` };
  if (us.length && us.every((s) => s === "DELIVERED" || s === "LOADED")) return { to: "SHIPPED", why: `all ${us.length} units out (loaded / delivered)` };
  if (!us.length) return { to: null, why: "no finished-goods units" };
  return { to: null, why: us.some((s) => s === "DELIVERED" || s === "LOADED") ? "part shipped" : "goods still in the warehouse" };
}
