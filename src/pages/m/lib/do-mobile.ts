// ===========================================================================
// do-mobile.ts — the rules behind the PHONE Delivery screens
// (screens/DeliveryScreen.tsx, screens/DeliveryDetailPhone.tsx).
//
// Every rule here is a copy of what desktop already does — nothing new:
//   • tabs, status buckets, labels, per-tab browse URL  → src/pages/delivery/index.tsx
//     (ALL_TABS, TAB_DO_STATUSES, STATUS_LABEL, doBrowseUrl, DO_SEARCH_KEYS,
//     PO_SEARCH_KEYS, searchJumpIndex)
//   • per-status DO actions, timeline, overdue          → src/pages/delivery/detail.tsx
//     (STATUS_FLOW, the extra buttons, calculateOverdueDays + the badge rule)
//   • proof-of-delivery limits + submit rule            → src/components/delivery/POD-dialog.tsx
//   • Create DO drops, one-customer guard, est. cost,
//     bulk eligibility, packing-list-first cost         → src/pages/delivery/index.tsx
//     (openCreateDODialog, confirmCreateDO, handleMarkDispatched /
//     handleMarkDelivered, runPlBulkTransition)
// tests/m-do-mobile.test.mjs pins each one against the desktop source.
//
// Dependency-free (no React, no "@/" imports) so node:test can import it.
// ===========================================================================

export type RawRow = Record<string, unknown>;

export type DOStatus = "DRAFT" | "LOADED" | "IN_TRANSIT" | "DELIVERED" | "INVOICED" | "CANCELLED";

// ---------------------------------------------------------------------------
// Small readers (dual-key, same contract as config/helpers.ts str/num).
// ---------------------------------------------------------------------------
function pick(row: RawRow | null | undefined, keys: string[]): unknown {
  if (!row) return undefined;
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
export function s(row: RawRow | null | undefined, ...keys: string[]): string {
  const v = pick(row, keys);
  return v == null ? "" : String(v);
}
export function n(row: RawRow | null | undefined, ...keys: string[]): number {
  const v = Number(pick(row, keys));
  return Number.isFinite(v) ? v : 0;
}
export function rows(v: unknown): RawRow[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as RawRow[]) : [];
}

// ---------------------------------------------------------------------------
// Tabs + status buckets (desktop ALL_TABS / TAB_DO_STATUSES / STATUS_LABEL).
// ---------------------------------------------------------------------------
export const DELIVERY_TABS = [
  { key: "planning", label: "Planning" },
  { key: "pending_delivery", label: "Pending Delivery" },
  { key: "pending_dispatch", label: "Pending Dispatch" },
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
  { key: "packing_list", label: "Packing List" },
] as const;

export type DeliveryTab = (typeof DELIVERY_TABS)[number]["key"];

export const TAB_DO_STATUSES: Partial<Record<DeliveryTab, DOStatus[]>> = {
  pending_dispatch: ["DRAFT"],
  dispatched: ["LOADED", "IN_TRANSIT"],
  delivered: ["DELIVERED", "INVOICED"],
  cancelled: ["CANCELLED"],
};

export const PO_TABS: ReadonlySet<string> = new Set(["planning", "pending_delivery"]);

export const DO_STATUS_LABEL: Record<DOStatus, string> = {
  DRAFT: "Pending Dispatch",
  LOADED: "Dispatched",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

export function doStatusLabel(status: string): string {
  return DO_STATUS_LABEL[status as DOStatus] ?? (status ? status.replace(/_/g, " ") : "—");
}

/** Which DO tab a status lives on (desktop TAB_FOR_STATUS). */
export function tabForStatus(status: string): DeliveryTab | null {
  for (const [tab, statuses] of Object.entries(TAB_DO_STATUSES)) {
    if ((statuses as string[]).includes(status)) return tab as DeliveryTab;
  }
  return null;
}

export const DO_PAGE_SIZE = 50;

/** Desktop doBrowseUrl: each stage tab pages ITS OWN statuses server-side;
 *  Packing List reads the newest 200 LIVE DOs (the only ones its bulk
 *  buttons can move); the PO tabs fetch no DOs at all. */
export function doBrowseUrl(tab: string, page: number): string | null {
  if (tab === "packing_list") {
    return "/api/delivery-orders?page=1&limit=200&status=DRAFT,LOADED,IN_TRANSIT";
  }
  const statuses = TAB_DO_STATUSES[tab as DeliveryTab];
  if (!statuses) return null;
  return `/api/delivery-orders?page=${page}&limit=${DO_PAGE_SIZE}&status=${statuses.join(",")}`;
}

/** Desktop's cross-status server search (whole table, every status). */
export function doSearchUrl(q: string): string | null {
  const t = q.trim();
  return t ? `/api/delivery-orders?search=${encodeURIComponent(t)}&limit=2000` : null;
}

/** Whole-table tab counts: DO tabs from /stats byStatus, PO tabs from
 *  /ready-planning, Packing List from /api/packing-lists. */
export function tabCounts(input: {
  byStatus?: Record<string, number> | null;
  planning?: number;
  ready?: number;
  packingLists?: number;
}): Record<DeliveryTab, number> {
  const by = input.byStatus ?? {};
  const sum = (tab: DeliveryTab) =>
    (TAB_DO_STATUSES[tab] ?? []).reduce((a, st) => a + (Number(by[st]) || 0), 0);
  return {
    planning: input.planning ?? 0,
    pending_delivery: input.ready ?? 0,
    pending_dispatch: sum("pending_dispatch"),
    dispatched: sum("dispatched"),
    delivered: sum("delivered"),
    cancelled: sum("cancelled"),
    packing_list: input.packingLists ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Search (desktop DataGrid alwaysSearchKeys).
// ---------------------------------------------------------------------------
export const DO_SEARCH_KEYS = [
  "doNo", "companySO", "salesOrderNos", "customerPOId", "customerSO", "customerRef", "customerName", "vehicleNo",
];
export const PO_SEARCH_KEYS = [
  "salesOrderNo", "poNo", "customerPOId", "customerReference", "customerSO", "customerName",
];

export function matchesSearch(row: RawRow, keys: string[], q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return keys.some((k) => String(row[k] ?? "").toLowerCase().includes(t));
}

/** Distinct SO numbers a DO covers (desktop mapDOToRow salesOrderNos). */
export function salesOrderNos(d: RawRow): string {
  const fromItems = rows(d.items).map((i) => s(i, "salesOrderNo")).filter(Boolean);
  const set = Array.from(new Set(fromItems.length ? fromItems : [s(d, "companySO", "companySOId")].filter(Boolean)));
  return set.join(", ");
}

/** Desktop search jump: when every match sits on exactly ONE tab, go there. */
export function searchJumpTab(matchTabs: (DeliveryTab | null)[]): DeliveryTab | null {
  const set = new Set(matchTabs.filter((t): t is DeliveryTab => !!t));
  return set.size === 1 ? [...set][0] : null;
}

// ---------------------------------------------------------------------------
// DO detail actions (desktop detail.tsx STATUS_FLOW + extra buttons).
// ---------------------------------------------------------------------------
export type DoActionKey = "LOAD" | "DISPATCH" | "DELIVER" | "RESOLVE" | "CONVERT_INVOICE";
export type DoAction = { key: DoActionKey; label: string };

export type DoDetailActions = {
  primary: DoAction | null;
  secondary: DoAction | null;
  /** Assign to Lorry — DRAFT / LOADED only. */
  canAssignLorry: boolean;
  /** Capture POD — LOADED / IN_TRANSIT / DELIVERED with no POD yet. */
  canCapturePod: boolean;
  /** Convert to Delivery Return — DELIVERED / INVOICED. */
  canConvertToReturn: boolean;
};

export function doDetailActions(status: string, deliveryIncomplete: boolean, hasPod: boolean): DoDetailActions {
  let primary: DoAction | null = null;
  let secondary: DoAction | null = null;
  if (status === "DRAFT") primary = { key: "LOAD", label: "Load & Generate DO" };
  if (status === "LOADED") {
    primary = { key: "DISPATCH", label: "Dispatch" };
    secondary = { key: "DELIVER", label: "Mark Delivered" };
  }
  if (status === "IN_TRANSIT") primary = { key: "DELIVER", label: "Mark Delivered" };
  if (status === "DELIVERED" && deliveryIncomplete) {
    primary = { key: "RESOLVE", label: "Complete & invoice" };
  }
  if (status === "DELIVERED" && !deliveryIncomplete) {
    primary = { key: "CONVERT_INVOICE", label: "Convert to Invoice" };
  }
  return {
    primary,
    secondary,
    canAssignLorry: status === "DRAFT" || status === "LOADED",
    canCapturePod: !hasPod && ["LOADED", "IN_TRANSIT", "DELIVERED"].includes(status),
    canConvertToReturn: status === "DELIVERED" || status === "INVOICED",
  };
}

/** The status each action PUTs (RESOLVE posts /resolve-incomplete instead). */
export const ACTION_TARGET: Record<Exclude<DoActionKey, "RESOLVE">, DOStatus> = {
  LOAD: "LOADED",
  DISPATCH: "IN_TRANSIT",
  DELIVER: "DELIVERED",
  CONVERT_INVOICE: "INVOICED",
};

/** Statuses the read-back accepts after each target (desktop advanceStatus:
 *  DELIVERED auto-creates the invoice and may land as INVOICED). */
export function acceptedAfter(target: DOStatus): DOStatus[] {
  return target === "DELIVERED" ? ["DELIVERED", "INVOICED"] : [target];
}

/** Confirm-line icon (prototype: Info / Mail / Receipt / TriangleAlert / ClipboardList). */
export type ConfirmIcon = "info" | "mail" | "receipt" | "warning" | "list";
export type ConfirmLine = { icon: ConfirmIcon; text: string };

/** The confirm sheet copy per action — states what the server really does. */
export function actionConfirmLines(key: DoActionKey): ConfirmLine[] {
  switch (key) {
    case "LOAD":
      return [
        { icon: "info", text: "Moves this DO to Dispatched (Loaded)." },
        { icon: "mail", text: "A dispatch notice is emailed to the customer if an email is on file." },
      ];
    case "DISPATCH":
      return [{ icon: "info", text: "Moves this DO to In Transit." }];
    case "DELIVER":
      return [{ icon: "receipt", text: "Delivering auto-creates the invoice, so this DO may move straight to Invoiced." }];
    case "CONVERT_INVOICE":
      return [
        { icon: "receipt", text: "Updates this delivery order’s status to Invoiced." },
        { icon: "info", text: "It does not create an invoice. The invoice is created when the order is delivered." },
      ];
    case "RESOLVE":
      return [
        { icon: "warning", text: "Confirms the paperwork is sorted." },
        { icon: "receipt", text: "Creates the sales invoice that was held back for this delivery." },
      ];
  }
}

/** Bulk confirm copy (prototype bulk + packing-list sheets). */
export function bulkConfirmLines(target: BulkTarget, fromPackingList: boolean): ConfirmLine[] {
  if (target === "DELIVERED") {
    return [
      { icon: "receipt", text: "Each delivered DO auto-creates its invoice." },
      { icon: "warning", text: "Bulk delivery doesn’t capture proof of delivery per DO." },
    ];
  }
  return fromPackingList
    ? [{ icon: "info", text: "Runs the same per-DO transition as Dispatch, one DO at a time." }]
    : [{ icon: "mail", text: "Dispatch notices are emailed where the customer has an email on file." }];
}

export const PL_FROM_DOS_LINES: ConfirmLine[] = [
  { icon: "list", text: "Groups the selected DOs into one packing list (one truck run). 3PL provider, vehicle, driver and remarks are optional." },
  { icon: "warning", text: "DOs already in a packing list are skipped." },
];

// ---------------------------------------------------------------------------
// Overdue (desktop detail.tsx calculateOverdueDays + the badge rule, as is:
// days past deliveryDate, measured to deliveredAt or now; badge when > 0 and
// the status is not DELIVERED / INVOICED).
// ---------------------------------------------------------------------------
export function calculateOverdueDays(deliveryDate: string, deliveredAt: string | null, now: Date = new Date()): number {
  if (!deliveryDate) return 0;
  const target = new Date(deliveryDate);
  const comparison = deliveredAt ? new Date(deliveredAt) : now;
  return Math.floor((comparison.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

/** Days to show on the mobile overdue badge / "Delivery date" warning.
 *  Desktop's count (calculateOverdueDays on deliveryDate), with one mobile
 *  PRESENTATION rule (owner 2026-10-20): a CANCELLED delivery order shows no
 *  overdue badge or text. Desktop, the backend overdue field and reports are
 *  unchanged — this only decides what the phone displays. */
export function overdueBadgeDays(d: RawRow, now: Date = new Date()): number {
  const status = s(d, "status");
  if (status === "DELIVERED" || status === "INVOICED" || status === "CANCELLED") return 0;
  const days = calculateOverdueDays(s(d, "deliveryDate"), s(d, "deliveredAt") || null, now);
  return days > 0 ? days : 0;
}

// ---------------------------------------------------------------------------
// Timeline (desktop detail.tsx Delivery Timeline: the five forward steps).
// ---------------------------------------------------------------------------
export const TIMELINE_STEPS: DOStatus[] = ["DRAFT", "LOADED", "IN_TRANSIT", "DELIVERED", "INVOICED"];

export type TimelineStep = {
  status: DOStatus;
  label: string;
  state: "done" | "current" | "pending";
  /** ISO date/time to show under the step, or "". */
  when: string;
};

export function timeline(d: RawRow): TimelineStep[] | null {
  const status = s(d, "status") as DOStatus;
  const idx = TIMELINE_STEPS.indexOf(status);
  if (idx < 0) return null; // CANCELLED: shown as a terminal panel instead
  const whenOf: Record<DOStatus, string> = {
    DRAFT: s(d, "deliveryDate"),
    LOADED: s(d, "dispatchedAt"),
    IN_TRANSIT: s(d, "dispatchedAt"),
    DELIVERED: s(d, "deliveredAt"),
    INVOICED: "",
    CANCELLED: "",
  };
  return TIMELINE_STEPS.map((st, i) => {
    const state = i < idx ? "done" : i === idx ? "current" : "pending";
    return { status: st, label: DO_STATUS_LABEL[st], state, when: state === "pending" ? "" : whenOf[st] };
  });
}

// ---------------------------------------------------------------------------
// Proof of delivery (desktop POD-dialog.tsx).
// ---------------------------------------------------------------------------
export const POD_MAX_PHOTOS = 5;
export const POD_MAX_INPUT_FILE_BYTES = 10 * 1024 * 1024;
export const POD_PHOTO_MAX_DIMENSION = 1280;
export const POD_PHOTO_JPEG_QUALITY = 0.7;
export const POD_MAX_PHOTO_BYTES = 200 * 1024;
export const POD_MAX_JSON_BYTES = 700 * 1024;

/** Receiver name AND (a signature OR at least one photo). */
export function podCanSubmit(receiverName: string, hasSignature: boolean, photoCount: number): boolean {
  return receiverName.trim().length > 0 && (hasSignature || photoCount > 0);
}

/** The 700 KB payload guard; returns the desktop message, or null if it fits. */
export function podSizeError(pod: unknown): string | null {
  const size = JSON.stringify(pod).length;
  if (size <= POD_MAX_JSON_BYTES) return null;
  return `POD payload is ${Math.round(size / 1024)} KB, over the ${Math.round(POD_MAX_JSON_BYTES / 1024)} KB limit. Remove a photo and try again.`;
}

export function podOversizeFileError(name: string): string {
  return `"${name}" is larger than 10 MB. Please choose a smaller photo.`;
}

// ---------------------------------------------------------------------------
// Pending Delivery selection + Create DO (desktop index.tsx).
// ---------------------------------------------------------------------------
/** Sofa sets that are not complete cannot be selected (desktop drops them). */
export function poSelectable(po: RawRow): boolean {
  return po.setComplete !== false;
}

/** Prototype pill for SOFA rows only ("Set 3 / 5 ready"); BF / ACC ship per
 *  piece and show no set pill. Same data as desktop's Set Status column. */
export function setStatusLabel(po: RawRow): string {
  if (s(po, "itemCategory").toUpperCase() !== "SOFA") return "";
  const total = n(po, "setTotalSiblings") || 1;
  const ready = n(po, "setReadySiblings") || (po.setComplete === false ? 0 : total);
  return `Set ${ready} / ${total} ready`;
}

/** The one-customer guard; returns the message, or null when OK. Desktop's
 *  copy points at "Quick Dispatch", which is the button now called Create
 *  Packing List — the phone names it as the user sees it. */
export function oneCustomerError(pos: RawRow[]): string | null {
  const ids = new Set(pos.map((p) => s(p, "customerId")).filter(Boolean));
  if (ids.size <= 1) return null;
  const names = Array.from(new Set(pos.map((p) => s(p, "customerName")).filter(Boolean))).join(", ");
  return `A delivery order can only be for one customer. You picked ${ids.size} (${names}). Create one DO per customer, or use Create Packing List, which splits automatically.`;
}

export type Hub = { id: string; shortName?: string; state?: string; address?: string; contactName?: string; phone?: string; isDefault?: boolean };
export type Drop = {
  customerId: string;
  customerName: string;
  hubId: string;
  address: string;
  contactName: string;
  contactPhone: string;
  poIds: string[];
};

/** Desktop openCreateDODialog: one drop per customer + state, with the hub
 *  auto-picked (same state → default → first). */
export function buildDrops(pos: RawRow[], hubsByCustomer: Record<string, Hub[]>): Drop[] {
  const map = new Map<string, { customerId: string; customerName: string; state: string; poIds: string[] }>();
  for (const po of pos) {
    const key = `${s(po, "customerId")}__${s(po, "customerState")}`;
    const hit = map.get(key);
    if (hit) hit.poIds.push(s(po, "id"));
    else map.set(key, { customerId: s(po, "customerId"), customerName: s(po, "customerName"), state: s(po, "customerState"), poIds: [s(po, "id")] });
  }
  return Array.from(map.values()).map((d) => {
    const hubs = hubsByCustomer[d.customerId] ?? [];
    const hub = hubs.find((h) => h.state === d.state) || hubs.find((h) => h.isDefault) || hubs[0];
    return {
      customerId: d.customerId,
      customerName: d.customerName,
      hubId: hub?.id || "",
      address: hub?.address || "",
      contactName: hub?.contactName || "",
      contactPhone: hub?.phone || "",
      poIds: d.poIds,
    };
  });
}

export type CreateDoForm = {
  providerId: string;
  vehicleId: string;
  driverPersonId: string;
  deliveryDate: string;
  remarks: string;
};

export const EMPTY_CREATE_FORM: CreateDoForm = { providerId: "", vehicleId: "", driverPersonId: "", deliveryDate: "", remarks: "" };

/** Desktop confirmCreateDO body (convert mode). */
export function createDoBody(poIds: string[], form: CreateDoForm, drops: Drop[]): Record<string, unknown> {
  const deliveryAddress =
    drops.length === 1
      ? drops[0].address
      : drops.map((d, i) => `Drop ${i + 1} (${d.customerName}): ${d.address}`).join("\n");
  return {
    productionOrderIds: poIds,
    providerId: form.providerId || null,
    vehicleId: form.vehicleId || null,
    driverId: form.driverPersonId || null,
    deliveryAddress,
    dropPoints: drops.length,
    remarks: form.remarks,
    deliveryDate: form.deliveryDate || "",
  };
}

/** Desktop confirmCreatePlFirst body. */
export function plFirstBody(poIds: string[], form: CreateDoForm): Record<string, unknown> {
  return {
    productionOrderIds: poIds,
    providerId: form.providerId || null,
    vehicleId: form.vehicleId || null,
    driverId: form.driverPersonId || null,
    deliveryDate: form.deliveryDate || "",
    remarks: form.remarks,
  };
}

type Rated = { ratePerTripSen?: number; ratePerExtraDropSen?: number } | null | undefined;

/** Est. Delivery Cost (sen): vehicle rate beats the provider rate; extra
 *  drops scale by ratePerExtraDropSen. null when nothing is picked. */
export function estDeliveryCostSen(drops: number, vehicle: Rated, provider: Rated): number | null {
  const d = Math.max(1, drops);
  const r = vehicle ?? provider;
  if (!r) return null;
  return (Number(r.ratePerTripSen) || 0) + Math.max(0, d - 1) * (Number(r.ratePerExtraDropSen) || 0);
}

/** Packing-list-first: each new DO is one drop, so per-trip × DO count. */
export function plFirstCostSen(doCount: number, vehicle: Rated, provider: Rated): { perTripSen: number; totalSen: number } | null {
  const r = vehicle ?? provider;
  if (!doCount || !r || r.ratePerTripSen == null) return null;
  const perTripSen = Number(r.ratePerTripSen) || 0;
  return { perTripSen, totalSen: perTripSen * doCount };
}

// ---------------------------------------------------------------------------
// Bulk moves (desktop handleMarkDispatched / handleMarkDelivered /
// runPlBulkTransition): only the eligible DOs of a selection move.
// ---------------------------------------------------------------------------
export type BulkTarget = "LOADED" | "DELIVERED";

export function bulkEligible(dos: RawRow[], target: BulkTarget): RawRow[] {
  return dos.filter((d) => {
    const st = s(d, "status");
    return target === "LOADED" ? st === "DRAFT" : st === "LOADED" || st === "IN_TRANSIT";
  });
}

export function plNoneEligibleMessage(packingNo: string, target: BulkTarget): string {
  return target === "LOADED"
    ? `No pending DOs in ${packingNo} — they are already dispatched or delivered.`
    : `No dispatched DOs in ${packingNo} — dispatch them first, or they are already delivered.`;
}

/** Packing List per-status tally: the live server counts when present. */
export function plStatusCounts(pl: RawRow): { pending: number; dispatched: number; delivered: number } {
  const c = (pl.doStatusCounts ?? null) as RawRow | null;
  return { pending: n(c, "pending"), dispatched: n(c, "dispatched"), delivered: n(c, "delivered") };
}

// ---------------------------------------------------------------------------
// Display helpers.
// ---------------------------------------------------------------------------
/** 3PL provider / vehicle / driver status label. */
export function providerStatusLabel(v: string): string {
  return v === "ACTIVE" ? "Active" : v === "ON_LEAVE" ? "On Leave" : v === "INACTIVE" ? "Inactive" : v || "—";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-22…" → "22 Oct 2026"; "" when absent. */
export function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${Number(d)} ${MONTHS[Math.max(0, Math.min(11, Number(m) - 1))]} ${y}`;
}

/** "2026-10-22…" → "22 Oct"; "" when absent. */
export function fmtShort(iso: string): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  if (!m || !d) return iso;
  return `${Number(d)} ${MONTHS[Math.max(0, Math.min(11, Number(m) - 1))]}`;
}

/** Local date + time ("22 Oct, 14:22"); "" when absent. */
export function fmtDateTime(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return fmtShort(iso);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${t.getDate()} ${MONTHS[t.getMonth()]}, ${hh}:${mm}`;
}

export function totalQty(d: RawRow): number {
  return rows(d.items).reduce((a, i) => a + n(i, "quantity"), 0);
}

/** DO total m³: the server's totalM3, else Σ itemM3 × qty. */
export function totalM3(d: RawRow): number {
  const t = n(d, "totalM3");
  if (t) return t;
  return rows(d.items).reduce((a, i) => a + n(i, "itemM3") * n(i, "quantity"), 0);
}

export function m3(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2);
}
