// ===========================================================================
// order-model — shared constants for the mobile Service Orders screens
// (Claude Design "Service Orders.dc.html"). Two record families that are NEVER
// merged:
//   • SV Service Orders   = sales_orders with isServiceOrder=true   /api/sales-orders
//   • Legacy Repair Orders = service_orders                          /api/service-orders
// Business rules come from the desktop code, not the prototype:
//   SV statuses / transitions : src/api/routes/sales-orders/_helpers.ts VALID_TRANSITIONS
//   SV status buckets         : src/lib/so-status.ts
//   Legacy transitions        : src/api/routes/service-orders.ts STATUS_TRANSITIONS
// ===========================================================================

export type Tone = { bg: string; fg: string };

// ---- Routes (every deep link that already exists keeps working) --------------------------------
export const ORDERS_LIST = "/m/serviceorders";
export const svDetailPath = (id: string) => `/m/serviceorders/sv/${encodeURIComponent(id)}`;
export const svEditPath = (id: string) => `/m/serviceorders/sv/${encodeURIComponent(id)}/edit`;
/** `?from=so|co` copies a source order; `?fromCase=<caseId>` hands off from a Service Case. */
export const SV_NEW_PATH = "/m/serviceorders/sv/new";
export const legacyDetailPath = (id: string) => `/m/serviceorders/${encodeURIComponent(id)}`;
export const casePath = (id: string) => `/m/servicecases/${encodeURIComponent(id)}`;

// ---- SV Service Orders --------------------------------------------------------------------------
export const SV_STATUSES = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "SHIPPED", "DELIVERED", "INVOICED", "CLOSED", "ON_HOLD", "CANCELLED"] as const;
export type SvStatus = (typeof SV_STATUSES)[number];

export const SV_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  IN_PRODUCTION: "In Production",
  READY_TO_SHIP: "Ready To Ship",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
  CLOSED: "Closed",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
};

const SP = {
  N: { bg: "#E2DDD8", fg: "#5A5550" },
  I: { bg: "#E0EAF4", fg: "#3A5670" },
  S: { bg: "#DCEBDC", fg: "#3A6B3A" },
  W: { bg: "#FAEFCB", fg: "#85600F" },
  D: { bg: "#F5DCDC", fg: "#7A2E24" },
} as const;
const SEM: Record<string, keyof typeof SP> = { DRAFT: "N", CONFIRMED: "I", IN_PRODUCTION: "I", READY_TO_SHIP: "S", SHIPPED: "I", DELIVERED: "S", INVOICED: "S", CLOSED: "N", ON_HOLD: "W", CANCELLED: "D" };
/** Pill tint for an SV status. Unknown statuses fall back to neutral. */
export const svTone = (s: string): Tone => SP[SEM[s] ?? "N"];
/** Left-rail / dot colour of an SV status (the prototype's rail colours). */
const RAIL: Record<keyof typeof SP, string> = { N: "#6B7280", I: "#3A5670", S: "#4F7C3A", W: "#9C6F1E", D: "#9A3A2D" };
export const svRail = (s: string): string => RAIL[SEM[s] ?? "N"];

// ---- Legacy Repair Orders -----------------------------------------------------------------------
export const LEGACY_STATUSES = ["OPEN", "IN_PRODUCTION", "RESERVED", "IN_REPAIR", "READY_TO_SHIP", "DELIVERED", "CLOSED", "CANCELLED"] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];
export const LEGACY_STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PRODUCTION: "In production",
  RESERVED: "Reserved",
  IN_REPAIR: "In repair",
  READY_TO_SHIP: "Ready to ship",
  DELIVERED: "Delivered",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};
const LP = {
  N: { rail: "#6B7280", bg: "#EEEBE6", fg: "#4B5260" },
  I: { rail: "#3E6570", bg: "#E0EDF0", fg: "#3E6570" },
  S: { rail: "#4F7C3A", bg: "#EEF3E4", fg: "#4F7C3A" },
  W: { rail: "#9C6F1E", bg: "#FAEFCB", fg: "#85600F" },
  D: { rail: "#9A3A2D", bg: "#F9E1DA", fg: "#9A3A2D" },
} as const;
const LSEM: Record<string, keyof typeof LP> = { OPEN: "N", IN_PRODUCTION: "I", RESERVED: "I", IN_REPAIR: "W", READY_TO_SHIP: "S", DELIVERED: "S", CLOSED: "N", CANCELLED: "D" };
export const legacyTone = (s: string): Tone & { rail: string } => LP[LSEM[s] ?? "N"];

export const LEGACY_MODE_LABEL: Record<string, string> = { REPRODUCE: "Reproduce", STOCK_SWAP: "Stock swap", REPAIR: "Repair" };
/** Mirrors src/api/routes/service-orders.ts STATUS_TRANSITIONS (the server re-validates; a 409 is shown, not hidden). */
export const LEGACY_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PRODUCTION", "RESERVED", "IN_REPAIR", "CANCELLED"],
  IN_PRODUCTION: ["READY_TO_SHIP", "CANCELLED"],
  RESERVED: ["READY_TO_SHIP", "CANCELLED"],
  IN_REPAIR: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: ["OPEN", "IN_PRODUCTION", "RESERVED", "IN_REPAIR"],
};
export const LEGACY_LIST_CAP = 500; // GET /api/service-orders is LIMIT 500

/** Return condition (service_order_returns.condition). "Repaired" is NOT a condition. */
export const RETURN_CONDITION_LABEL: Record<string, string> = { PENDING_DECISION: "Pending decision", REPAIRABLE: "Repairable", SCRAPPED: "Scrapped" };

/** Exchange modes need an APPROVED exchange approval on the parent case (server answers 409 otherwise). */
export const EXCHANGE_MODES = ["STOCK_SWAP", "REPRODUCE"] as const;

/* ---------------------------------------------------------------------------------------------------
 * STOCK SWAP / SCRAP — kept DISABLED on mobile. Status: UNRESOLVED, pending an owner decision.
 * Findings (contradictory; none of this enables anything):
 *  - HANDOFF says the desktop picker sends a catalogue product id where fgBatchId is expected.
 *    Confirmed for Scrap: POST /:id/returns/:rid/scrap requires a real fg_batches.id
 *    (src/api/routes/service-orders.ts ~1682-1716) and src/pages/service-orders/detail.tsx lists
 *    /api/inventory?buckets=finishedProducts PRODUCTS in its picker.
 *  - BUT the mode handler's resolveSwapBatch (service-orders.ts ~80-125) ignores a non-batch hint and
 *    picks FIFO from the line's own product, so Stock Swap via PUT /:id/mode may work without
 *    lineFgBatches (mobile CaseOpsSheets LegacyOrderSheet already creates Stock Swap orders without batches).
 * Until the owner decides, both stay disabled and nothing is sent. The note below states no cause. */
export const STOCK_SWAP_UNAVAILABLE_NOTE = "Stock swap isn’t available on mobile yet.";
export const SCRAP_UNAVAILABLE_NOTE = "Scrap isn’t available on mobile yet.";
/** Combined wording (kept for callers that show one note for both actions). */
export const FG_BATCH_BLOCKED_NOTE = "Stock swap and scrap aren’t available on mobile yet.";

export const fmtDM = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon}` : "";
};
export const fmtDMY = (iso: string | null | undefined): string => {
  const d = fmtDM(iso);
  return d ? `${d} ${String(iso).slice(0, 4)}` : "";
};
