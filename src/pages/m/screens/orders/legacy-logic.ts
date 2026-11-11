// ===========================================================================
// legacy-logic — React-free rules for the mobile Legacy Repair Orders screens
// (table service_orders, API /api/service-orders). Pure so it is unit-tested
// (tests/legacy-orders.test.mjs). Desktop / backend are the source of truth:
//   transitions : src/api/routes/service-orders.ts STATUS_TRANSITIONS
//   buttons     : src/pages/service-orders/detail.tsx (Ready to Ship / Delivered / Close / Cancel / Undo)
//   returns     : src/api/routes/service-orders.ts POST /:id/returns, PUT /:id/returns/:rid
//   exchange    : src/api/lib/service-approval.ts (409 until the parent case has an APPROVED EXCHANGE)
// There is NO rule that returns must be repaired before Ready to ship.
// Return rows / Log return mirror desktop ReturnRow + LogReturnModal (src/pages/service-orders/detail.tsx).
// ===========================================================================
import { EXCHANGE_MODES, LEGACY_MODE_LABEL, LEGACY_STATUSES, LEGACY_STATUS_LABEL, LEGACY_TRANSITIONS, ORDERS_LIST, legacyDetailPath } from "./order-model";

// ---- Paths (the family lives in the URL: ServiceOrdersScreen reads ?fam=legacy) ----------------------
/** Legacy list. The tablet split view's left pane renders ServiceOrdersScreen, which reads `fam` from the URL. */
export const LEGACY_LIST_PATH = `${ORDERS_LIST}?fam=legacy`;
/** Legacy detail that keeps the left pane on the legacy family. Bare legacyDetailPath(id) deep links still work. */
export const legacyDetailHref = (id: string): string => `${legacyDetailPath(id)}?fam=legacy`;

// ---- Types ---------------------------------------------------------------------------------------
export type LegacyLine = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  qty: number;
  issueSummary: string;
  resolutionProductionOrderId: string;
  resolutionFgBatchId: string;
};
export type LegacyReturn = {
  id: string;
  serviceOrderLineId: string;
  productId: string;
  productCode: string;
  receivedAt: string;
  receivedByName: string;
  condition: string;
  repairedAt: string;
  repairedByName: string;
  scrappedViaAdjustmentId: string;
  notes: string;
};
export type LegacyOrder = {
  id: string;
  no: string;
  caseId: string;
  sourceType: string;
  sourceId: string;
  sourceNo: string;
  customerName: string;
  mode: string | null;
  status: string;
  preCancelStatus: string;
  createdByName: string;
  createdAt: string;
  notes: string;
  lines: LegacyLine[];
  returns: LegacyReturn[];
};

const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

/** API row (rowToApi in service-orders.ts) -> typed order. Tolerates snake_case siblings and missing arrays. */
export function normalizeLegacyOrder(r: Raw): LegacyOrder {
  const mode = s(r.mode);
  return {
    id: s(r.id),
    no: s(r.serviceOrderNo ?? r.service_order_no),
    caseId: s(r.caseId ?? r.case_id),
    sourceType: s(r.sourceType ?? r.source_type),
    sourceId: s(r.sourceId ?? r.source_id),
    sourceNo: s(r.sourceNo ?? r.source_no),
    customerName: s(r.customerName ?? r.customer_name),
    mode: mode ? mode : null,
    status: s(r.status),
    preCancelStatus: s(r.preCancelStatus ?? r.pre_cancel_status),
    createdByName: s(r.createdByName ?? r.created_by_name),
    createdAt: s(r.createdAt ?? r.created_at),
    notes: s(r.notes),
    lines: arr(r.lines).map((l) => ({
      id: s(l.id),
      productId: s(l.productId),
      productCode: s(l.productCode),
      productName: s(l.productName),
      qty: n(l.qty),
      issueSummary: s(l.issueSummary),
      resolutionProductionOrderId: s(l.resolutionProductionOrderId),
      resolutionFgBatchId: s(l.resolutionFgBatchId),
    })),
    returns: arr(r.returns).map((x) => ({
      id: s(x.id),
      serviceOrderLineId: s(x.serviceOrderLineId),
      productId: s(x.productId),
      productCode: s(x.productCode),
      receivedAt: s(x.receivedAt),
      receivedByName: s(x.receivedByName),
      condition: s(x.condition),
      repairedAt: s(x.repairedAt),
      repairedByName: s(x.repairedByName),
      scrappedViaAdjustmentId: s(x.scrappedViaAdjustmentId),
      notes: s(x.notes),
    })),
  };
}

export const legacyUnits = (o: LegacyOrder): number => o.lines.reduce((a, l) => a + l.qty, 0);

// ---- List: search + status chips -----------------------------------------------------------------
export function matchesLegacyQuery(o: LegacyOrder, q: string, caseNo: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const hay = [o.no, o.customerName, caseNo, o.sourceNo, ...o.lines.map((l) => `${l.productName} ${l.productCode}`)].join(" ").toLowerCase();
  return hay.includes(t);
}
export const LEGACY_CHIPS = ["ALL", ...LEGACY_STATUSES] as const;
export function normalizeChip(v: string | null | undefined): string {
  return v && (LEGACY_CHIPS as readonly string[]).includes(v) ? v : "ALL";
}
/** Counts follow the search (prototype: chip counts are of the search-filtered set). */
export function chipCounts(searched: LegacyOrder[]): Record<string, number> {
  const out: Record<string, number> = { ALL: searched.length };
  for (const st of LEGACY_STATUSES) out[st] = 0;
  for (const o of searched) if (o.status in out) out[o.status] += 1;
  return out;
}
export function filterLegacy(all: LegacyOrder[], q: string, chip: string, caseNoOf: (o: LegacyOrder) => string): { searched: LegacyOrder[]; rows: LegacyOrder[] } {
  const searched = all.filter((o) => matchesLegacyQuery(o, q, caseNoOf(o)));
  const c = normalizeChip(chip);
  return { searched, rows: c === "ALL" ? searched : searched.filter((o) => o.status === c) };
}

// ---- Status path ("Repair path") -----------------------------------------------------------------
/** OPEN -> mode-specific middle step -> Ready to ship -> Delivered -> Closed. Unknown mode: the middle depends on the mode. */
export function repairPath(mode: string | null): { steps: string[]; note: string } {
  const mid = mode === "REPRODUCE" ? "IN_PRODUCTION" : mode === "STOCK_SWAP" ? "RESERVED" : "IN_REPAIR";
  return {
    steps: ["OPEN", mid, "READY_TO_SHIP", "DELIVERED", "CLOSED"],
    note: mode ? `${LEGACY_MODE_LABEL[mode] ?? mode} path` : "Middle step depends on the mode",
  };
}
/** Index of the current step on the path, -1 when cancelled / not on the path. */
export function pathIndex(o: Pick<LegacyOrder, "status" | "mode">): number {
  if (o.status === "CANCELLED") return -1;
  return repairPath(o.mode).steps.indexOf(o.status);
}

// ---- Actions -------------------------------------------------------------------------------------
export type Perms = { create: boolean; update: boolean };
export type PrimaryAction =
  | { kind: "choose-mode" }
  | { kind: "log-return" }
  | { kind: "status"; to: "READY_TO_SHIP" | "DELIVERED" | "CLOSED" }
  | { kind: "undo-cancel"; to: string };

const NEXT: Record<string, "READY_TO_SHIP" | "DELIVERED" | "CLOSED" | undefined> = {
  IN_PRODUCTION: "READY_TO_SHIP",
  RESERVED: "READY_TO_SHIP",
  IN_REPAIR: "READY_TO_SHIP",
  READY_TO_SHIP: "DELIVERED",
  DELIVERED: "CLOSED",
};

/** Where Undo cancel goes: the stage the cancel interrupted (OPEN when unknown / not a legal target). */
export function undoTarget(o: Pick<LegacyOrder, "preCancelStatus">): string {
  return LEGACY_TRANSITIONS.CANCELLED.includes(o.preCancelStatus) ? o.preCancelStatus : "OPEN";
}

export const canLogReturn = (o: Pick<LegacyOrder, "status">, p: Perms): boolean => p.create && o.status !== "CANCELLED" && o.status !== "CLOSED";
export const canCancel = (o: Pick<LegacyOrder, "status">, p: Perms): boolean => p.update && LEGACY_TRANSITIONS[o.status]?.includes("CANCELLED") === true;
/** Terminal for return edits (prototype `term`). */
export const isTerminal = (status: string): boolean => status === "CLOSED" || status === "CANCELLED";

/** The single primary button of the header card (null when nothing applies / view only). */
export function primaryAction(o: Pick<LegacyOrder, "status" | "mode" | "preCancelStatus">, p: Perms): PrimaryAction | null {
  if (o.status === "CANCELLED") return p.update ? { kind: "undo-cancel", to: undoTarget(o) } : null;
  if (o.status === "OPEN") {
    if (!o.mode) return p.update ? { kind: "choose-mode" } : null;
    // REPAIR: stays OPEN until the first return is logged (server flips it to IN_REPAIR).
    if (o.mode === "REPAIR") return p.create ? { kind: "log-return" } : null;
    return null;
  }
  const next = NEXT[o.status];
  if (next && p.update && LEGACY_TRANSITIONS[o.status]?.includes(next)) return { kind: "status", to: next };
  return null;
}

// ---- Cancel / confirm copy -----------------------------------------------------------------------
export function cancelEffect(mode: string | null): string {
  if (mode === "REPRODUCE") return "Its resolution production orders are cancelled too.";
  if (mode === "STOCK_SWAP") return "The reserved FG batch goes back to stock.";
  return "No production or stock changes.";
}
export function cancelSubline(mode: string | null): string {
  if (mode === "REPRODUCE") return "Also cancels resolution production";
  if (mode === "STOCK_SWAP") return "Restores reserved FG stock";
  return "No production or stock change";
}
export type ConfirmCopy = { title: string; text: string; go: string; danger: boolean };
export function confirmCopy(kind: "READY_TO_SHIP" | "DELIVERED" | "CLOSED" | "CANCEL" | "UNDO", o: Pick<LegacyOrder, "no" | "mode" | "preCancelStatus">, caseNo: string): ConfirmCopy {
  const parent = caseNo || "The parent case";
  switch (kind) {
    case "READY_TO_SHIP": return { title: "Mark ready to ship?", text: `${o.no} moves to Ready to ship.`, go: "Mark ready", danger: false };
    case "DELIVERED": return { title: "Mark delivered?", text: `${o.no} moves to Delivered. ${parent} is not closed automatically.`, go: "Mark delivered", danger: false };
    case "CLOSED": return { title: "Close this repair order?", text: `Closed repair orders can’t be reopened. ${parent} stays as it is.`, go: "Close order", danger: true };
    case "CANCEL": return { title: "Cancel this repair order?", text: `${cancelEffect(o.mode)} ${parent} is not cancelled. You can undo this.`, go: "Cancel order", danger: true };
    case "UNDO": {
      const to = undoTarget(o);
      const tail = o.mode === "REPRODUCE" ? " Its resolution production is restored." : o.mode === "STOCK_SWAP" ? " FG stock is reserved again only if the batch still has enough units." : "";
      return { title: "Undo cancel?", text: `Restores ${o.no} to ${LEGACY_STATUS_LABEL[to] ?? to}.${tail}`, go: "Undo cancel", danger: false };
    }
  }
}
export function modeConfirmCopy(mode: "REPRODUCE" | "REPAIR", o: Pick<LegacyOrder, "no" | "lines">): ConfirmCopy {
  if (mode === "REPAIR") return { title: "Resolve by repair?", text: `Mode becomes Repair. ${o.no} stays Open until the first return is logged, then moves to In repair. No production or stock change.`, go: "Set Repair", danger: false };
  const k = o.lines.length;
  return { title: "Start reproduction?", text: `Creates ${k} production order${k === 1 ? "" : "s"} (cost category Repair) and moves ${o.no} to In production. If the parent case has no approved exchange approval, the server files a pending approval request instead and creates nothing.`, go: "Start", danger: false };
}

// ---- Resolution modes (sheet) --------------------------------------------------------------------
export type ModeOption = { mode: "REPRODUCE" | "STOCK_SWAP" | "REPAIR"; label: string; desc: string; needsApproval: boolean; blocked: boolean };
/** STOCK_SWAP is blocked on mobile (see the findings in order-model.ts); never sent. */
export const MODE_OPTIONS: ModeOption[] = [
  { mode: "REPRODUCE", label: "Reproduce", desc: "Make a new unit. Creates a production order per line (cost category Repair) and starts In production. Catalogue products only.", needsApproval: true, blocked: false },
  { mode: "STOCK_SWAP", label: "Stock swap", desc: "Send a finished unit from stock. Reserves an FG batch and starts Reserved. Catalogue products only.", needsApproval: true, blocked: true },
  { mode: "REPAIR", label: "Repair", desc: "Fix the customer’s unit. Stays Open until the first return is logged, then In repair. Free-text items allowed.", needsApproval: false, blocked: false },
];
export const isExchangeMode = (m: string | null | undefined): boolean => !!m && (EXCHANGE_MODES as readonly string[]).includes(m);

// ---- Server conflict classification --------------------------------------------------------------
export type ConflictKind = "approval" | "stock" | "transition" | "forbidden" | "other";
/** Not every 409 is an approval problem: tell them apart by the server's message, never by status alone. */
export function classifyConflict(status: number, message: string): ConflictKind {
  if (status === 403) return "forbidden";
  if (status !== 409) return "other";
  const m = message.toLowerCase();
  if (/cannot transition|can only set mode|mode is already set/.test(m)) return "transition";
  if (/exchange|approval|rejected/.test(m)) return "approval";
  if (/stock|batch|remaining/.test(m)) return "stock";
  return "other";
}
export const CONFLICT_COPY: Record<ConflictKind, { title: string }> = {
  approval: { title: "Exchange approval needed" },
  stock: { title: "Not enough FG stock" },
  transition: { title: "Status changed elsewhere" },
  forbidden: { title: "Not allowed" },
  other: { title: "Couldn’t complete that" },
};
/** Plain text for the error sheet: the server's own message, plus a refresh note for a stale status. */
export function conflictText(kind: ConflictKind, message: string): string {
  if (kind !== "transition") return message;
  const base = message.trim();
  const sep = base === "" || /[.!?…]$/.test(base) ? " " : ". ";
  return `${base}${base ? sep : ""}The order has been refreshed — check its status and try again.`;
}
/** Pending / rejected / needs-request, read from the server's own words (the case payload carries no approval state). */
export function approvalStateFromMessage(message: string): "PENDING" | "REJECTED" | null {
  const m = message.toLowerCase();
  if (m.includes("rejected")) return "REJECTED";
  if (m.includes("waiting for approval") || m.includes("needs approval") || m.includes("request has been filed")) return "PENDING";
  return null;
}

// ---- Returns -------------------------------------------------------------------------------------
export type ReturnAction = "mark-repaired" | "scrap";
/** Row actions, as desktop ReturnRow: only a PENDING_DECISION row has any. "Repaired" = ONE PUT straight from
 * PENDING_DECISION; "Scrap…" is listed but always blocked on mobile (never sends /scrap). Desktop does not gate the
 * row on the order status (the server doesn't either); only the update permission applies here. */
export function returnActions(r: Pick<LegacyReturn, "condition">, _orderStatus: string, p: Perms): { action: ReturnAction; blocked: boolean }[] {
  if (!p.update || r.condition !== "PENDING_DECISION") return [];
  return [{ action: "mark-repaired", blocked: false }, { action: "scrap", blocked: true }];
}
/** PUT /:id/returns/:rid  — exactly desktop's "Repaired": REPAIRABLE + repaired_* ("Repaired" is not a condition). */
export function markRepairedBody(user: { id?: string | null; name?: string | null } | null, nowIso: string) {
  return { condition: "REPAIRABLE" as const, repairedAt: nowIso, repairedBy: user?.id ?? null, repairedByName: user?.name ?? null };
}

/** Desktop LogReturnModal always logs PENDING_DECISION; Repairable / Scrapped are not offered when logging. */
export const RETURN_COND_OPTIONS = [
  { value: "PENDING_DECISION", label: "Pending decision", sub: "Decide after inspection" },
] as const;

export type ReturnForm = { lineId: string; notes: string };
/** POST /:id/returns body — the same fields desktop sends (receivedAt defaults to now on the server). lineId "" = "(unspecified)". */
export function logReturnBody(
  f: ReturnForm,
  lines: Pick<LegacyLine, "id" | "productId" | "productCode">[],
  user: { id?: string | null; name?: string | null } | null,
) {
  const line = lines.find((l) => l.id === f.lineId);
  return {
    serviceOrderLineId: f.lineId || null,
    productId: line?.productId || null,
    productCode: line?.productCode || null,
    condition: "PENDING_DECISION" as const,
    notes: f.notes || null,
    receivedBy: user?.id ?? null,
    receivedByName: user?.name ?? null,
  };
}
/** The first return on a REPAIR order that is still OPEN moves it to In repair (server does it). */
export const firstReturnStartsRepair = (o: Pick<LegacyOrder, "status" | "mode" | "returns">): boolean => o.status === "OPEN" && o.mode === "REPAIR" && o.returns.length === 0;
