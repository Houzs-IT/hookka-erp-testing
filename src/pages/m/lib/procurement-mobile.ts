// ===========================================================================
// procurement-mobile.ts — the rules behind /m/procurement (Orders · Receipts ·
// Invoices). Spec: docs/mobile/PROCUREMENT-MOBILE.md.
//
// Every rule is a copy of what desktop already does — nothing new:
//   • PO statuses, timeline, per-status buttons, edit lock, cancel note,
//     received gate                       → src/pages/procurement/detail.tsx
//   • PO create checks, binding pick, Split by Supplier → procurement/create.tsx
//   • low-stock rule + prefill, Draft split, bulk submit → procurement/index.tsx
//   • GRN labels, filters, Post / Cancel gates → procurement/grn.tsx, grn-detail.tsx
//   • GRN receive body                    → m/components/GrnReceiveSheet.tsx
//     (+ desktop grn/create.tsx's Received By check)
//   • PI statuses, actions, edit checks, canVoid → procurement/PurchaseInvoiceDetail.tsx
//   • PI create checks, import, payload   → procurement/pi/create.tsx +
//     components/convert-to-pi-modal.tsx; Mark Paid FX → procurement/pi.tsx
// tests/m-procurement-mobile.test.mjs pins each against the desktop source.
//
// No React, no "@/" imports (node:test imports it directly).
// ===========================================================================
import { allocateDiscountSen, roundUnitPriceSen } from "../../../lib/unit-price";
import { isPiEditable } from "../../../lib/purchase-edit-rules";
import { poItemsSearchText } from "../../../lib/po-items-search";
import { n, rows, s, type RawRow } from "./do-mobile";

export { n, rows, s, type RawRow };

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type Section = "po" | "grn" | "pi";

/** Desktop's own date stamp (`new Date().toISOString().split("T")[0]`). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().split("T")[0];
}
export function dateOnly(v: string): string {
  return (v || "").slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sections (prototype switch: Orders · Receipts · Invoices) + the read each needs.
// ---------------------------------------------------------------------------
export const SECTIONS: { key: Section; label: string; title: string; resource: string }[] = [
  { key: "po", label: "Orders", title: "Purchase Orders", resource: "purchase-orders" },
  { key: "grn", label: "Receipts", title: "Goods Receipt", resource: "grn" },
  { key: "pi", label: "Invoices", title: "Purchase Invoice", resource: "purchase-invoices" },
];

export function visibleSections(canRead: (resource: string) => boolean): Section[] {
  return SECTIONS.filter((x) => canRead(x.resource)).map((x) => x.key);
}

// ---------------------------------------------------------------------------
// Status labels + tones.
// ---------------------------------------------------------------------------
export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  CONFIRMED: { label: "Confirmed", tone: "info" },
  PARTIAL_RECEIVED: { label: "Partial Received", tone: "warning" },
  RECEIVED: { label: "Received", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};
export const GRN_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  CONFIRMED: { label: "Approved", tone: "info" },
  POSTED: { label: "Posted", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};
export const PI_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  CONFIRMED: { label: "Confirmed", tone: "info" },
  PARTIAL_PAID: { label: "Partial Paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

/** Desktop normalizePiStatus: legacy PENDING_APPROVAL / APPROVED read as CONFIRMED. */
export function normalizePiStatus(st: string): string {
  return st === "PENDING_APPROVAL" || st === "APPROVED" ? "CONFIRMED" : st;
}

export function statusOf(section: Section, raw: string): { label: string; tone: Tone } {
  const map = section === "po" ? PO_STATUS : section === "grn" ? GRN_STATUS : PI_STATUS;
  const key = section === "pi" ? normalizePiStatus(raw) : raw;
  return map[key] ?? { label: raw ? raw.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—", tone: "neutral" };
}

export const ARRIVAL_LABEL: Record<string, string> = {
  NOT_ARRIVED: "Planning",
  IN_TRANSIT: "In Transit",
  AT_CUSTOMS: "At Customs",
  ARRIVED: "Arrived",
};
/** A GRN row with no arrival_state predates the column — treated as arrived, as desktop. */
export function arrivalOf(g: RawRow): string {
  return s(g, "arrival_state", "arrivalState") || "ARRIVED";
}
export const QC_LABEL: Record<string, string> = { PENDING: "Pending", PASSED: "Passed", PARTIAL: "Partial", FAILED: "Failed" };

// ---------------------------------------------------------------------------
// Filter chips (desktop status filters; PO adds Closed, owner 2026-10-21).
// ---------------------------------------------------------------------------
export type ChipDef = { key: string; label: string; tone?: Tone };
export const CHIPS: Record<Section, ChipDef[]> = {
  po: [
    { key: "", label: "All" },
    { key: "DRAFT", label: "Draft", tone: "neutral" },
    { key: "SUBMITTED", label: "Submitted", tone: "info" },
    { key: "CONFIRMED", label: "Confirmed", tone: "info" },
    { key: "PARTIAL_RECEIVED", label: "Partial Received", tone: "warning" },
    { key: "RECEIVED", label: "Received", tone: "success" },
    { key: "CLOSED", label: "Closed", tone: "neutral" },
    { key: "CANCELLED", label: "Cancelled", tone: "danger" },
  ],
  grn: [
    { key: "", label: "All" },
    { key: "DRAFT", label: "Draft", tone: "neutral" },
    { key: "QC_PENDING", label: "QC Pending", tone: "warning" },
    { key: "CONFIRMED", label: "Approved", tone: "info" },
    { key: "POSTED", label: "Posted", tone: "success" },
  ],
  pi: [
    { key: "", label: "All" },
    { key: "DRAFT", label: "Draft", tone: "neutral" },
    { key: "CONFIRMED", label: "Confirmed", tone: "info" },
    { key: "PAID", label: "Paid", tone: "success" },
    { key: "CANCELLED", label: "Cancelled", tone: "danger" },
  ],
};

export function chipMatches(section: Section, chip: string, row: RawRow): boolean {
  if (!chip) return true;
  const st = s(row, "status");
  if (section === "grn" && chip === "QC_PENDING") return s(row, "qcStatus") === "PENDING";
  if (section === "pi") return normalizePiStatus(st) === chip;
  return st === chip;
}

// ---------------------------------------------------------------------------
// Search (PO: desktop PO_ALWAYS_SEARCH_KEYS incl. line items).
// ---------------------------------------------------------------------------
export function searchText(section: Section, row: RawRow): string {
  if (section === "po") {
    const items = rows(row.items).map((i) => ({ materialCode: s(i, "materialCode"), supplierSKU: s(i, "supplierSKU"), materialName: s(i, "materialName") }));
    return [s(row, "poNo"), s(row, "supplierName"), poItemsSearchText(items)].join(" ");
  }
  if (section === "grn") return [s(row, "grnNumber"), s(row, "poNumber"), s(row, "supplierName"), s(row, "supplier_do_no", "supplierDoNo")].join(" ");
  return [s(row, "piNo"), s(row, "supplierInvoiceNo"), s(row, "supplierName", "supplier"), s(row, "supplierDoNo"), s(row, "poRef")].join(" ");
}
export function matchesQuery(section: Section, row: RawRow, q: string): boolean {
  const t = q.trim().toLowerCase();
  return !t || searchText(section, row).toLowerCase().includes(t);
}

// ---------------------------------------------------------------------------
// Card / detail derivations.
// ---------------------------------------------------------------------------
const OPEN_PO = ["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED"];

/** Σ max(0, quantity − receivedQty) — desktop list Outstanding; null when closed out. */
export function poOutstanding(po: RawRow): number | null {
  if (["RECEIVED", "CANCELLED", "CLOSED"].includes(s(po, "status"))) return null;
  return rows(po.items).reduce((a, i) => a + Math.max(0, n(i, "quantity") - n(i, "receivedQty")), 0);
}
export function poQtyTotals(po: RawRow): { ordered: number; received: number } {
  const it = rows(po.items);
  return { ordered: it.reduce((a, i) => a + n(i, "quantity"), 0), received: it.reduce((a, i) => a + n(i, "receivedQty"), 0) };
}
export function poExpectedLate(po: RawRow, today: string): boolean {
  const d = dateOnly(s(po, "expectedDate"));
  return !!d && d < today && OPEN_PO.includes(s(po, "status"));
}
/** A receipt is "full" when every line received at least what was ordered. */
export function grnIsFull(g: RawRow): boolean {
  const it = rows(g.items);
  return it.length > 0 && it.every((i) => n(i, "receivedQty") >= n(i, "orderedQty"));
}
/** Past-due flag on an unpaid, live invoice (display only). */
export function piPastDue(p: RawRow, today: string): boolean {
  const d = dateOnly(s(p, "dueDate"));
  const st = normalizePiStatus(s(p, "status"));
  return !!d && d < today && (st === "CONFIRMED" || st === "PARTIAL_PAID");
}
export function isForeign(p: RawRow): boolean {
  const c = s(p, "currency");
  return !!c && c !== "MYR";
}

// ---------------------------------------------------------------------------
// Timelines.
// ---------------------------------------------------------------------------
export const PO_FLOW: [string, string][] = [
  ["DRAFT", "Draft"], ["SUBMITTED", "Sent"], ["CONFIRMED", "Confirmed"],
  ["PARTIAL_RECEIVED", "Partially Received"], ["RECEIVED", "Fully Received"], ["CLOSED", "Closed"],
];
export const GRN_FLOW: [string, string][] = [["DRAFT", "Draft"], ["CONFIRMED", "Approved"], ["POSTED", "Posted"]];
export const PI_FLOW: [string, string][] = [["DRAFT", "Draft"], ["CONFIRMED", "Confirmed"], ["PAID", "Paid"]];

export type FlowStep = { label: string; state: "done" | "current" | "pending" };
export function flowSteps(flow: [string, string][], status: string): FlowStep[] {
  const idx = flow.findIndex(([k]) => k === status);
  return flow.map(([, label], i) => ({ label, state: idx >= 0 && i < idx ? "done" : i === idx ? "current" : "pending" }));
}
/** PARTIAL_PAID sits on Confirmed (paid in part, not yet Paid). */
export function piFlowStatus(raw: string): string {
  const st = normalizePiStatus(raw);
  return st === "PARTIAL_PAID" ? "CONFIRMED" : st;
}

// ---------------------------------------------------------------------------
// Purchase order — per-status actions (detail.tsx statusActions + header).
// ---------------------------------------------------------------------------
export type PoActionKey =
  | "EDIT" | "MARK_CONFIRMED" | "CREATE_GRN" | "RECEIVE_GOODS" | "MARK_PARTIAL" | "MARK_RECEIVED" | "CLOSE"
  | "CANCEL" | "DELETE" | "EMAIL" | "PDF" | "PRINT_GRN" | "CREATE_INVOICE";
export type PoActions = { primary: PoActionKey | null; secondary: PoActionKey | null; menu: PoActionKey[]; invoiced: boolean };

/** linkedGRNs → "posted" = POSTED or CONFIRMED (detail.tsx hasPostedGrn). */
export function hasPostedGrn(linkedGrns: RawRow[]): boolean {
  return linkedGrns.some((g) => s(g, "status") === "POSTED" || s(g, "status") === "CONFIRMED");
}
export function hasLivePi(linkedPis: RawRow[]): boolean {
  return linkedPis.some((p) => s(p, "status") !== "CANCELLED");
}

export function poActions(po: RawRow, linkedGrns: RawRow[], linkedPis: RawRow[]): PoActions {
  const st = s(po, "status");
  const posted = hasPostedGrn(linkedGrns);
  const received = poQtyTotals(po).received;
  const editable = st !== "CANCELLED" && st !== "RECEIVED" && st !== "CLOSED" && !posted && received === 0;
  const canEmail = ["SUBMITTED", "CONFIRMED", "PARTIAL_RECEIVED", "RECEIVED"].includes(st);
  const canCancel = OPEN_PO.includes(st);
  const receivable = st === "CONFIRMED" || st === "PARTIAL_RECEIVED";
  let primary: PoActionKey | null = null;
  let secondary: PoActionKey | null = null;
  const menu: PoActionKey[] = [];

  if (st === "DRAFT") primary = "EDIT";
  else if (st === "SUBMITTED") {
    primary = "MARK_CONFIRMED";
    if (editable) secondary = "EDIT";
  } else if (receivable) {
    primary = posted ? "RECEIVE_GOODS" : "CREATE_GRN";
    if (posted) secondary = "MARK_RECEIVED";
    else if (st === "CONFIRMED") secondary = "MARK_PARTIAL";
    if (posted && st === "CONFIRMED") menu.push("MARK_PARTIAL");
    if (editable) menu.push("EDIT");
  } else if (st === "RECEIVED") primary = "CLOSE";

  if (st !== "DRAFT" && st !== "CANCELLED") menu.push("CREATE_INVOICE");
  if (canEmail) menu.push("EMAIL");
  menu.push("PDF");
  if (st === "PARTIAL_RECEIVED" || st === "RECEIVED") menu.push("PRINT_GRN");
  if (st === "DRAFT") menu.push("DELETE");
  if (canCancel) menu.push("CANCEL");
  return { primary, secondary, menu, invoiced: hasLivePi(linkedPis) };
}

/** The server gate each PO action passes (purchase-orders.ts / grn.ts / purchase-invoices.ts). */
export const PO_ACTION_PERMS: Record<PoActionKey, [string, string][]> = {
  EDIT: [["purchase-orders", "update"]],
  MARK_CONFIRMED: [["purchase-orders", "update"], ["purchase-orders", "approve"]],
  MARK_PARTIAL: [["purchase-orders", "update"], ["purchase-orders", "receive"]],
  MARK_RECEIVED: [["purchase-orders", "update"], ["purchase-orders", "receive"]],
  CLOSE: [["purchase-orders", "update"]],
  CANCEL: [["purchase-orders", "update"]],
  DELETE: [["purchase-orders", "delete"]],
  EMAIL: [["purchase-orders", "update"]],
  PDF: [],
  PRINT_GRN: [],
  CREATE_GRN: [["grn", "create"]],
  RECEIVE_GOODS: [["grn", "create"]],
  CREATE_INVOICE: [["purchase-invoices", "create"]],
};

export const PO_ACTION_LABEL: Record<PoActionKey, string> = {
  EDIT: "Edit",
  MARK_CONFIRMED: "Mark Confirmed",
  CREATE_GRN: "Create GRN",
  RECEIVE_GOODS: "Receive Goods",
  MARK_PARTIAL: "Mark Partially Received",
  MARK_RECEIVED: "Mark Fully Received",
  CLOSE: "Close PO",
  CANCEL: "Cancel PO",
  DELETE: "Delete PO",
  EMAIL: "Email to Supplier",
  PDF: "Download PDF",
  PRINT_GRN: "Print GRN",
  CREATE_INVOICE: "Create Invoice",
};

export const PO_STATUS_TARGET: Partial<Record<PoActionKey, string>> = {
  MARK_CONFIRMED: "CONFIRMED",
  MARK_PARTIAL: "PARTIAL_RECEIVED",
  MARK_RECEIVED: "RECEIVED",
  CLOSE: "CLOSED",
};

/** detail.tsx handleAdvanceStatus body (RECEIVED stamps today's receivedDate). */
export function poAdvanceBody(target: string, today: string): Record<string, unknown> {
  return target === "RECEIVED" ? { status: target, receivedDate: today } : { status: target };
}
export const RECEIVED_GATE_ERROR = "Create + post a GRN before marking received";

export const CANCEL_REASON_ERROR = "Reason must be at least 10 characters";
export function cancelReasonError(reason: string): string | null {
  return reason.trim().length < 10 ? CANCEL_REASON_ERROR : null;
}
/** detail.tsx submitCancel: the reason is appended to the PO's notes. */
export function poCancelBody(notes: string, reason: string, today: string): { status: "CANCELLED"; notes: string } {
  const annotation = `[CANCELLED ${today}: ${reason.trim()}]`;
  return { status: "CANCELLED", notes: notes ? `${notes}\n${annotation}` : annotation };
}
export const PARTIAL_CANCEL_WARNING =
  "Inventory already received from posted GRNs will NOT be reverted. Run reverse-GRN manually if needed.";

// ---------------------------------------------------------------------------
// Purchase order — create / edit / split / low stock.
// ---------------------------------------------------------------------------
export type PoLine = {
  rmId: string;
  rmCode: string;
  rmDescription: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  quantity: number;
  unitPriceSen: number;
  unit: string;
  moq: number;
  materialCategory: string;
  /** Client-only React key (lineUid); not part of any request body. */
  uid?: string;
  /** Edit only: the existing PO line id + its received qty (sent back verbatim). */
  id?: string;
  receivedQty?: number;
};

/** create.tsx resolveSupplierName: "CODE - Name" (the string desktop sends). */
export function supplierLabel(sup: RawRow | undefined, fallbackId: string): string {
  return sup ? `${s(sup, "code")} - ${s(sup, "name")}` : fallbackId;
}

/** create.tsx handleSave, in its order. */
export function poCreateError(lines: PoLine[]): string | null {
  if (lines.length === 0) return "Add at least one item";
  const unbound = lines.filter((l) => !l.supplierId).length;
  if (unbound) return `Pick supplier for unbound material${unbound === 1 ? "" : "s"}`;
  if (lines.length > 1 && lines.some((l) => l.supplierId !== lines[0].supplierId)) return "Lines belong to multiple suppliers — use Split by Supplier";
  if (!lines[0].supplierId) return "Supplier missing";
  return null;
}
/** detail.tsx saveEdits, in its order. */
export function poEditError(lines: PoLine[]): string | null {
  if (lines.length === 0) return "PO must have at least one line item";
  if (lines.some((l) => !l.supplierId)) return "Pick a supplier for every line";
  if (lines.length > 1 && lines.some((l) => l.supplierId !== lines[0].supplierId)) return "Lines must share a single supplier";
  return null;
}
export function distinctSuppliers(lines: PoLine[]): string[] {
  return Array.from(new Set(lines.map((l) => l.supplierId).filter(Boolean)));
}

function poItemBody(l: PoLine): Record<string, unknown> {
  return {
    materialCategory: l.materialCategory,
    materialCode: l.rmCode,
    materialName: l.rmDescription,
    supplierSKU: l.supplierSku,
    quantity: l.quantity,
    unitPriceSen: l.unitPriceSen,
    unit: l.unit,
  };
}

/** create.tsx buildPayload — a manual PO is born CONFIRMED. */
export function poCreateBody(lines: PoLine[], h: { purchaseOrgCode: string; expectedDate: string; notes: string }): Record<string, unknown> {
  return {
    supplierId: lines[0]?.supplierId ?? "",
    supplierName: lines[0]?.supplierName ?? "",
    status: "CONFIRMED",
    purchaseOrgCode: h.purchaseOrgCode,
    expectedDate: h.expectedDate,
    notes: h.notes,
    items: lines.map(poItemBody),
  };
}

/** index.tsx POFormDialog handleSubmit — no status (server default DRAFT), no purchase company. */
export function poLowStockBody(lines: PoLine[], h: { expectedDate: string; notes: string }): Record<string, unknown> {
  return {
    supplierId: lines[0]?.supplierId ?? "",
    supplierName: lines[0]?.supplierName ?? "",
    expectedDate: h.expectedDate,
    notes: h.notes,
    items: lines.map(poItemBody),
  };
}

/**
 * Split by Supplier — one body per supplier, in first-seen order.
 *   manual   (create.tsx)  → CONFIRMED, that supplier's purchase company
 *   lowStock (index.tsx)   → no status (DRAFT), no purchase company
 */
export function splitBodies(
  lines: PoLine[],
  h: { expectedDate: string; notes: string; purchaseOrgCode: string },
  mode: "manual" | "lowStock",
  supplierOrg: (supplierId: string) => string,
): Record<string, unknown>[] {
  const by = new Map<string, PoLine[]>();
  for (const l of lines) by.set(l.supplierId, [...(by.get(l.supplierId) ?? []), l]);
  return Array.from(by.entries()).map(([sid, ls]) =>
    mode === "manual"
      ? {
          supplierId: sid,
          supplierName: ls[0].supplierName,
          status: "CONFIRMED",
          purchaseOrgCode: supplierOrg(sid) || h.purchaseOrgCode || "HOOKKA",
          expectedDate: h.expectedDate,
          notes: h.notes,
          items: ls.map(poItemBody),
        }
      : { supplierId: sid, supplierName: ls[0].supplierName, expectedDate: h.expectedDate, notes: h.notes, items: ls.map(poItemBody) },
  );
}
export function splitResultToast(ok: number, groups: number): string {
  return ok === groups ? `Created ${ok} POs across ${groups} suppliers` : `${ok}/${groups} POs created — fix the rest and retry`;
}

/** detail.tsx saveEdits payload. */
export function poEditBody(lines: PoLine[], h: { expectedDate: string; notes: string }): Record<string, unknown> {
  return {
    supplierId: lines[0]?.supplierId ?? "",
    supplierName: lines[0]?.supplierName ?? "",
    expectedDate: h.expectedDate,
    notes: h.notes,
    items: lines.map((l) => ({ id: l.id, ...poItemBody(l), receivedQty: l.receivedQty ?? 0 })),
  };
}

/** Normalised material code (create.tsx normMatCode: case + spacing). */
export function normMatCode(code: string): string {
  return (code || "").trim().toUpperCase().replace(/\s+/g, "");
}

export type PickerRow = { rm: RawRow; binding: RawRow; key: string };
/**
 * The Select Materials rows (create.tsx MaterialPickerModal): active RMs ×
 * their bindings on ACTIVE suppliers — one row per supplier (main first), or
 * only the picked supplier's rows. A material with no live binding is not
 * listed (mobile adds lines from bindings only).
 */
export function materialPickerRows(rawMaterials: RawRow[], bindings: RawRow[], activeSupplierIds: Set<string>, supplierId: string): PickerRow[] {
  const out: PickerRow[] = [];
  for (const rm of rawMaterials) {
    if (!rm.isActive) continue;
    const key = normMatCode(s(rm, "itemCode"));
    const seen = new Set<string>();
    const bs = bindings
      .filter((b) => normMatCode(s(b, "materialCode")) === key && activeSupplierIds.has(s(b, "supplierId")))
      .filter((b) => !supplierId || s(b, "supplierId") === supplierId)
      .sort((a, b) => Number(b.isMainSupplier === true) - Number(a.isMainSupplier === true));
    for (const b of bs) {
      const sid = s(b, "supplierId");
      if (seen.has(sid)) continue;
      seen.add(sid);
      out.push({ rm, binding: b, key: `${s(rm, "id")}|${sid}` });
    }
  }
  return out;
}

/** Desktop `binding?.moq ?? 1`: a missing binding or MOQ → 1, but a stored 0 stays 0. */
export function moqOrOne(b: RawRow | undefined): number {
  return b && b.moq != null && b.moq !== "" ? n(b, "moq") : 1;
}

let uidSeq = 0;
/** Stable client-only id for a form line (React key; never sent). */
export function lineUid(): string {
  uidSeq += 1;
  return `ln-${uidSeq}`;
}

export function lineFromBinding(rm: RawRow, b: RawRow, supplierName: string): PoLine {
  return {
    rmId: s(rm, "id"),
    rmCode: s(rm, "itemCode"),
    rmDescription: s(rm, "description"),
    supplierId: s(b, "supplierId"),
    supplierName,
    supplierSku: s(b, "supplierSku"),
    quantity: moqOrOne(b),
    unitPriceSen: n(b, "unitPrice"),
    unit: s(rm, "baseUOM"),
    moq: n(b, "moq"),
    materialCategory: s(rm, "itemGroup"),
  };
}

/** index.tsx lowStockRMs: active, minStock > 0, balance <= minStock. */
export function lowStockRms(rawMaterials: RawRow[]): RawRow[] {
  return rawMaterials
    .filter((rm) => !!rm.isActive && n(rm, "minStock") > 0 && n(rm, "balanceQty") <= n(rm, "minStock"))
    .sort((a, b) => s(a, "itemGroup").localeCompare(s(b, "itemGroup")) || s(a, "itemCode").localeCompare(s(b, "itemCode")));
}
/** index.tsx buildLowStockPrefill: main binding (else first), qty = max(maxStock − balance, MOQ). */
export function lowStockLines(rawMaterials: RawRow[], bindings: RawRow[], nameOf: (supplierId: string) => string): PoLine[] {
  return lowStockRms(rawMaterials).map((rm) => {
    const bs = bindings.filter((b) => s(b, "materialCode") === s(rm, "itemCode"));
    const main = bs.find((b) => b.isMainSupplier === true) ?? bs[0];
    const moq = moqOrOne(main);
    const sid = main ? s(main, "supplierId") : "";
    return {
      rmId: s(rm, "id"),
      rmCode: s(rm, "itemCode"),
      rmDescription: s(rm, "description"),
      supplierId: sid,
      supplierName: sid ? nameOf(sid) : "",
      supplierSku: main ? s(main, "supplierSku") : "",
      quantity: Math.max(n(rm, "maxStock") - n(rm, "balanceQty"), moq),
      unitPriceSen: main ? n(main, "unitPrice") : 0,
      unit: s(rm, "baseUOM"),
      moq,
      materialCategory: s(rm, "itemGroup"),
    };
  });
}

/** detail.tsx poItemToEditLine — an existing PO line as an editable line. */
export function lineFromPoItem(it: RawRow, supplierId: string, supplierName: string): PoLine {
  return {
    id: s(it, "id"),
    rmId: "",
    rmCode: s(it, "materialCode"),
    rmDescription: s(it, "materialName"),
    supplierId,
    supplierName,
    supplierSku: s(it, "supplierSKU"),
    quantity: n(it, "quantity"),
    unitPriceSen: n(it, "unitPriceSen"),
    unit: s(it, "unit"),
    moq: 0,
    materialCategory: s(it, "materialCategory"),
    receivedQty: n(it, "receivedQty"),
  };
}

export function bulkSubmitEligible(pos: RawRow[]): RawRow[] {
  return pos.filter((p) => s(p, "status") === "DRAFT");
}

// ---------------------------------------------------------------------------
// Goods receipt.
// ---------------------------------------------------------------------------
export const GRN_POST_NEEDS_ARRIVAL = "Mark arrived first before posting to stock";
export const RECEIVED_BY_ERROR = "Enter the name of the person who received the goods";
export const RECEIVE_QTY_ERROR = "Enter a received quantity for at least one line.";

/** GrnReceiveSheet remainingOf: availableQty, else quantity − receivedQty. */
export function receiveRemaining(it: RawRow): number {
  const avail = n(it, "availableQty");
  return avail > 0 ? avail : Math.max(0, n(it, "quantity") - n(it, "receivedQty"));
}

/**
 * The mobile receive body — GrnReceiveSheet's, byte for byte (goods in hand
 * → arrival ARRIVED → the server posts it to stock on create). Received By
 * is checked first, as desktop grn/create.tsx does.
 */
export function grnReceiveBody(
  po: RawRow,
  qtyByIndex: (i: number) => number,
  receivedBy: string,
  notes: string,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!receivedBy.trim()) return { ok: false, error: RECEIVED_BY_ERROR };
  const lines = rows(po.items)
    .map((_it, i) => ({ poItemIndex: i, q: qtyByIndex(i) }))
    .filter((x) => x.q > 0)
    .map(({ poItemIndex, q }) => ({ poItemIndex, receivedQty: q, acceptedQty: q, rejectedQty: 0, rejectionReason: "" }));
  if (lines.length === 0) return { ok: false, error: RECEIVE_QTY_ERROR };
  return {
    ok: true,
    body: {
      poId: s(po, "id"),
      purchaseOrgCode: s(po, "purchaseOrgCode") || "HOOKKA",
      receivedBy: receivedBy.trim(),
      notes: notes.trim(),
      ocrUsed: false,
      arrival_state: "ARRIVED",
      items: lines,
    },
  };
}

export type GrnActionKey = "POST" | "CREATE_INVOICE" | "CANCEL" | "PDF";
export type GrnActions = { primary: GrnActionKey | null; postBlocked: boolean; menu: GrnActionKey[] };
/**
 * grn-detail.tsx header, minus Approve (BUG-2026-10-21-344) and Create
 * Purchase Return (out of scope). Create Invoice shows on every POSTED
 * receipt, as desktop; the PI create caps lines at availableQty.
 */
export function grnActions(g: RawRow): GrnActions {
  const st = s(g, "status");
  const cancelled = st === "CANCELLED";
  const menu: GrnActionKey[] = ["PDF"];
  if (!cancelled) menu.push("CANCEL");
  if (cancelled) return { primary: null, postBlocked: false, menu };
  if (st !== "POSTED") return { primary: "POST", postBlocked: arrivalOf(g) !== "ARRIVED", menu };
  return { primary: "CREATE_INVOICE", postBlocked: false, menu };
}
export const GRN_ACTION_PERMS: Record<GrnActionKey, [string, string][]> = {
  POST: [["grn", "update"]],
  CANCEL: [["grn", "delete"]],
  CREATE_INVOICE: [["purchase-invoices", "create"]],
  PDF: [],
};

/** grn-detail.tsx cancelReceipt lines (an Approved receipt has posted stock too). */
export function grnCancelLines(g: RawRow): string[] {
  const released = rows(g.items)
    .filter((it) => n(it, "acceptedQty") > 0)
    .map((it) => `${s(it, "materialName") || s(it, "materialCode")}: ${n(it, "acceptedQty")}`)
    .join(", ");
  const poLabel = s(g, "poNumber") || s(g, "poId");
  const st = s(g, "status");
  return [
    poLabel
      ? `PO ${poLabel} gets this quantity back and becomes receivable again${released ? ` — ${released}.` : "."}`
      : `This receipt has no linked purchase order${released ? ` — ${released}.` : "."}`,
    st === "POSTED" || st === "CONFIRMED"
      ? "The stock it posted is removed from on hand, and the receipt's inventory lots are reversed."
      : "No stock was posted, so nothing leaves inventory.",
    "The receipt stays on file as CANCELLED and cannot be reopened.",
  ];
}

export type LandedCost = { productSen: number; shippingSen: number; dutySen: number; totalSen: number; currency: string; rate: number };
/** grn-detail.tsx: landed = product total + shipping + duty (no FX applied). */
export function landedCost(g: RawRow): LandedCost {
  const productSen = n(g, "totalAmount");
  const shippingSen = n(g, "shipping_cost_sen");
  const dutySen = n(g, "customs_duty_sen");
  return {
    productSen,
    shippingSen,
    dutySen,
    totalSen: n(g, "landed_cost_sen") || productSen + shippingSen + dutySen,
    currency: s(g, "currency") || "MYR",
    rate: n(g, "exchange_rate"),
  };
}

// ---------------------------------------------------------------------------
// Purchase invoice — actions.
// ---------------------------------------------------------------------------
export type PiActionKey = "CONFIRM" | "MARK_PAID" | "EDIT" | "DELETE" | "VOID" | "RESTORE" | "PDF";
export type PiActions = { primary: PiActionKey | null; menu: PiActionKey[] };

/** PurchaseInvoiceDetail.tsx canVoid (the server's requireFinance is the same three roles). */
export function canVoidRole(role: string | null | undefined): boolean {
  const r = (role || "").toUpperCase();
  return r === "FINANCE" || r === "SUPER_ADMIN" || r === "ADMIN";
}

export function piActions(p: RawRow, canVoid: boolean): PiActions {
  const raw = s(p, "status");
  const st = normalizePiStatus(raw);
  const menu: PiActionKey[] = [];
  let primary: PiActionKey | null = null;
  // PI_STATUS_ACTIONS is keyed on the RAW status: legacy PENDING_APPROVAL → Confirm.
  if (raw === "DRAFT" || raw === "PENDING_APPROVAL") primary = "CONFIRM";
  else if (st === "CONFIRMED") primary = "MARK_PAID";
  else if (st === "CANCELLED" && canVoid) primary = "RESTORE";
  if (isPiEditable(raw)) menu.push("EDIT");
  menu.push("PDF");
  if (st === "DRAFT") menu.push("DELETE");
  if (st !== "DRAFT" && st !== "CANCELLED" && canVoid) menu.push("VOID");
  return { primary, menu };
}
export const PI_STATUS_TARGET: Partial<Record<PiActionKey, string>> = { CONFIRM: "CONFIRMED", MARK_PAID: "PAID" };
export const PI_ACTION_PERMS: Record<PiActionKey, [string, string][]> = {
  CONFIRM: [["purchase-invoices", "update"]],
  MARK_PAID: [["purchase-invoices", "update"]],
  EDIT: [["purchase-invoices", "update"]],
  DELETE: [["purchase-invoices", "delete"]],
  VOID: [],
  RESTORE: [],
  PDF: [],
};

/** pi.tsx Mark Paid: a foreign PI settles at the payment-day rate. */
export function markPaidBody(p: RawRow, rateInput: string): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!isForeign(p)) return { ok: true, body: { status: "PAID" } };
  const r = parseFloat(rateInput);
  if (!Number.isFinite(r) || r <= 0) return { ok: false, error: `Enter the payment-day rate (MYR per 1 ${s(p, "currency")}).` };
  return { ok: true, body: { status: "PAID", payFxRate: r } };
}

// ---------------------------------------------------------------------------
// Purchase invoice — create / import / edit.
// ---------------------------------------------------------------------------
export type PiLine = {
  materialCode: string;
  materialName: string;
  supplierSku: string;
  qty: number;
  unitPriceSen: number;
  grnItemId: string | null;
  poId: string | null;
  /** Client-only React key (lineUid); not part of any request body. */
  uid?: string;
  /** Import ceiling (availableQty), when the line came from a GRN / PO. */
  max?: number;
};

/** Qty × unit price (sen), desktop lineGrossSen. */
export function piLineSen(l: { qty: number; unitPriceSen: number }): number {
  return Math.round((Number(l.qty) || 0) * roundUnitPriceSen(Number(l.unitPriceSen) || 0));
}

/** pi/create.tsx handleSave, in its order. */
export function piCreateError(supplierId: string, lines: PiLine[]): string | null {
  if (!supplierId) return "Select a supplier";
  if (lines.filter((l) => l.materialName.trim()).length === 0) return "Add at least one item";
  if (lines.some((l) => l.max != null && l.qty > l.max)) return "A line exceeds the quantity available to invoice.";
  return null;
}

export function piMismatchError(currentName: string, otherName: string): string {
  return `This invoice is for ${currentName || "this supplier"}. Create a separate PI for ${otherName}.`;
}

/** convert-to-pi-modal.tsx GRN picker: non-cancelled, POSTED first. */
export function grnImportCandidates(grns: RawRow[], supplierId: string): RawRow[] {
  const base = grns.filter((g) => s(g, "status") !== "CANCELLED" && (!supplierId || s(g, "supplierId") === supplierId));
  return [...base.filter((g) => s(g, "status") === "POSTED"), ...base.filter((g) => s(g, "status") !== "POSTED")];
}
/** convert-to-pi-modal.tsx PO picker: not CANCELLED / DRAFT / CLOSED. */
export function poImportCandidates(pos: RawRow[], supplierId: string): RawRow[] {
  return pos.filter((p) => !["CANCELLED", "DRAFT", "CLOSED"].includes(s(p, "status")) && (!supplierId || s(p, "supplierId") === supplierId));
}

export type ImportPick = { id: string; name: string; sub: string; avail: number };
/** Step 2 rows of the picker: every line with its availableQty. */
export function importRows(source: "grn" | "po", doc: RawRow): ImportPick[] {
  return rows(doc.items).map((l) => ({
    id: s(l, "id"),
    name: s(l, "materialName"),
    sub: source === "grn" ? s(l, "materialCode") : s(l, "supplierSKU") || s(l, "materialCode"),
    avail: n(l, "availableQty"),
  }));
}
/** convert-to-pi-modal.tsx handleConfirm — the picked lines as PI lines. */
export function importLines(source: "grn" | "po", doc: RawRow, qty: Record<string, number>): PiLine[] {
  const out: PiLine[] = [];
  for (const l of rows(doc.items)) {
    const want = Number(qty[s(l, "id")]) || 0;
    if (want <= 0) continue;
    out.push(
      source === "grn"
        ? {
            materialCode: s(l, "materialCode"),
            materialName: s(l, "materialName"),
            supplierSku: s(l, "materialCode"),
            qty: want,
            unitPriceSen: n(l, "unitPrice"),
            grnItemId: s(l, "id"),
            poId: s(doc, "poId") || null,
            max: n(l, "availableQty"),
          }
        : {
            materialCode: s(l, "materialCode"),
            materialName: s(l, "materialName"),
            supplierSku: s(l, "supplierSKU"),
            qty: want,
            unitPriceSen: n(l, "unitPriceSen"),
            grnItemId: null,
            poId: s(doc, "id"),
            max: n(l, "availableQty"),
          },
    );
  }
  return out;
}
/** pi/create.tsx ?poId= deep-link (PO "Create Invoice"): every line at full quantity. */
export function poDeepLinkLines(po: RawRow): PiLine[] {
  return rows(po.items).map((it) => ({
    materialCode: s(it, "materialCode"),
    materialName: s(it, "materialName"),
    supplierSku: s(it, "supplierSKU"),
    qty: n(it, "quantity"),
    unitPriceSen: n(it, "unitPriceSen"),
    grnItemId: null,
    poId: s(po, "id"),
  }));
}
/** pi/create.tsx ?grnId= deep-link (GRN "Create Invoice"): lines with something left to invoice. */
export function grnDeepLinkLines(grn: RawRow): PiLine[] {
  return rows(grn.items)
    .map((it) => ({ it, remaining: it.availableQty != null ? n(it, "availableQty") : n(it, "acceptedQty") }))
    .filter((x) => x.remaining > 0)
    .map(({ it, remaining }) => ({
      materialCode: s(it, "materialCode"),
      materialName: s(it, "materialName"),
      supplierSku: "",
      qty: remaining,
      unitPriceSen: n(it, "unitPrice"),
      grnItemId: s(it, "id"),
      poId: s(grn, "poId") || null,
      max: remaining,
    }));
}

/**
 * pi/create.tsx handleConvert merge: a GRN source replaces the lines (only
 * one GRN per PI); a further PO appends, skipping a (PO, material) already
 * billed. Returns the new lines + remark.
 */
export function mergeImport(
  prev: PiLine[],
  incoming: PiLine[],
  opts: { source: "grn" | "po"; hasGrnSource: boolean; prevRemarks: string; docLabel: string },
): { lines: PiLine[]; remarks: string; appended: boolean } {
  const kept = prev.filter((l) => l.materialName.trim() || l.qty > 0);
  const append = kept.length > 0 && opts.source === "po" && !opts.hasGrnSource;
  const label = opts.source === "grn" ? `From GRN ${opts.docLabel}` : `Created from PO ${opts.docLabel}`;
  if (!append) return { lines: incoming, remarks: label, appended: false };
  const seen = new Set(kept.map((l) => `${l.poId ?? ""}:${l.materialCode}`));
  return {
    lines: [...kept, ...incoming.filter((l) => !seen.has(`${l.poId ?? ""}:${l.materialCode}`))],
    remarks: opts.prevRemarks ? `${opts.prevRemarks} + PO ${opts.docLabel}` : label,
    appended: true,
  };
}

/** pi/create.tsx handleSave payload (no per-line tax / discount entry on mobile → 0). */
export function piCreateBody(h: {
  supplierId: string;
  supplierName: string;
  invoiceDate: string;
  remarks: string;
  purchaseOrgCode: string;
  supplierInvoiceNo: string;
  supplierDoNo: string;
  purchaseOrderId: string | null;
  grnId: string | null;
  lines: PiLine[];
}): Record<string, unknown> {
  const valid = h.lines.filter((l) => l.materialName.trim() !== "");
  const body: Record<string, unknown> = {
    supplierId: h.supplierId,
    supplierName: h.supplierName,
    invoiceDate: h.invoiceDate,
    remarks: h.remarks,
    status: "DRAFT",
    purchaseOrgCode: h.purchaseOrgCode,
    supplierInvoiceNo: h.supplierInvoiceNo.trim() || null,
    supplierDoNo: h.supplierDoNo.trim() || null,
    items: valid.map((l) => ({
      materialCode: l.materialCode.trim() || null,
      materialName: l.materialName.trim(),
      supplierSku: l.supplierSku.trim() || null,
      qty: Number(l.qty) || 0,
      unitPriceSen: roundUnitPriceSen(Number(l.unitPriceSen) || 0),
      taxSen: 0,
      discountSen: 0,
      lineType: "STOCKED",
      grnItemId: l.grnItemId ?? null,
      poId: l.poId ?? h.purchaseOrderId ?? null,
    })),
  };
  if (h.purchaseOrderId) body.purchaseOrderId = h.purchaseOrderId;
  if (h.grnId) body.grnId = h.grnId;
  return body;
}

export type PiEditLine = {
  /** Client-only React key; not part of the request body. */
  uid?: string;
  materialCode: string;
  materialName: string;
  supplierSku: string;
  qty: string;
  unitPriceSen: number;
  taxSen: number;
  discountSen: number;
  lineType: string;
  grnItemId: string | null;
};
export function piEditLines(p: RawRow): PiEditLine[] {
  return rows(p.items).map((it) => ({
    uid: lineUid(),
    materialCode: s(it, "materialCode"),
    materialName: s(it, "materialName"),
    supplierSku: s(it, "supplierSku"),
    qty: String(n(it, "qty")),
    unitPriceSen: n(it, "unitPriceSen"),
    taxSen: n(it, "taxSen"),
    discountSen: n(it, "discountSen"),
    lineType: s(it, "lineType") || "STOCKED",
    grnItemId: it.grnItemId == null ? null : String(it.grnItemId),
  }));
}
/** PurchaseInvoiceDetail.tsx handleSaveEdit checks. */
export function piEditError(lines: PiEditLine[]): string | null {
  for (const l of lines) {
    if (!l.materialName.trim()) return "Every line needs a description.";
    if (!(parseFloat(l.qty) >= 0)) return "Every line needs a valid quantity.";
  }
  return null;
}
/**
 * The invoice discount is kept (re-spread over the edited goods lines, as
 * desktop's dDiscountSen = Σ line discount); tax per line is kept as entered.
 */
export function piEditTotals(lines: PiEditLine[]): { totalSen: number; discounts: number[] } {
  const gross = lines.map((l) => Math.round((parseFloat(l.qty) || 0) * roundUnitPriceSen(l.unitPriceSen)));
  const docDiscount = lines.reduce((a, l) => a + l.discountSen, 0);
  const discounts = allocateDiscountSen(gross, docDiscount, lines.map((l) => l.lineType !== "TAX"));
  const goods = gross.reduce((a, g, i) => (lines[i].lineType === "TAX" ? a : a + g), 0);
  const tax = lines.reduce((a, l, i) => a + l.taxSen + (l.lineType === "TAX" ? gross[i] : 0), 0);
  return { totalSen: goods - discounts.reduce((a, v) => a + v, 0) + tax, discounts };
}
export function piEditBody(
  h: { invoiceDate: string; dueDate: string; remarks: string; supplierInvoiceNo: string; supplierDoNo: string },
  lines: PiEditLine[],
): Record<string, unknown> {
  const { discounts } = piEditTotals(lines);
  return {
    invoiceDate: h.invoiceDate || undefined,
    dueDate: h.dueDate || undefined,
    remarks: h.remarks,
    supplierInvoiceNo: h.supplierInvoiceNo.trim() || null,
    supplierDoNo: h.supplierDoNo.trim() || null,
    items: lines.map((l, i) => ({
      materialCode: l.materialCode.trim() || null,
      materialName: l.materialName.trim(),
      supplierSku: l.supplierSku.trim() || null,
      qty: parseFloat(l.qty) || 0,
      unitPriceSen: roundUnitPriceSen(l.unitPriceSen),
      taxSen: Math.max(0, Math.round(l.taxSen)),
      discountSen: discounts[i],
      lineType: l.lineType,
      grnItemId: l.grnItemId,
    })),
  };
}
/** A CONFIRMED (or legacy APPROVED) PI whose total changes asks first. */
export function piEditNeedsConfirm(p: RawRow, newTotalSen: number): boolean {
  return ["CONFIRMED", "APPROVED"].includes(s(p, "status")) && newTotalSen !== n(p, "amountSen");
}
