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
