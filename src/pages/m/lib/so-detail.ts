// ===========================================================================
// so-detail — pure mapping behind the PHONE Sales Order detail
// (screens/SalesOrderDetail.tsx). Every value comes from GET
// /api/sales-orders/:id (rowToSO / rowToItem / linkedPOs / linkedDOs /
// linkedInvoices / statusHistory / priceOverrides) or /api/audit-events.
// Display rules mirror the desktop page (src/pages/sales/detail.tsx) so the
// phone never disagrees with it: SO-ID rule, DO labels, production labels,
// override row prefix, priceOverrides lineIndex.
//
// Phone is read-only and money-light: no Paid / Balance / payment fields are
// read here on purpose.
// ===========================================================================

type Row = Record<string, unknown>;

function val(row: Row, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
function s(row: Row, ...keys: string[]): string {
  const v = val(row, ...keys);
  return v == null ? "" : String(v);
}
function n(row: Row, ...keys: string[]): number {
  const v = Number(val(row, ...keys));
  return Number.isFinite(v) ? v : 0;
}

export function rows(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : [];
}

// ---------------------------------------------------------------------------
// Production orders (linkedPOs)
// ---------------------------------------------------------------------------

/** Desktop displaySoId (sales/detail.tsx): a SOFA set spans several variant
 *  POs, so its trailing -NN is stripped; BF / ACC keep the per-piece suffix. */
export function displaySoId(poNo: string, itemCategory: string): string {
  if ((itemCategory || "").toUpperCase() === "SOFA") return poNo.replace(/-\d+$/, "");
  return poNo;
}

/** Desktop OrderProgressCard productionLabel, minus "by <worker>" (phone row
 *  is narrow; the name stays on desktop). */
export function productionLabel(po: Row, fmtDate: (d: string) => string): string {
  const st = s(po, "status").toUpperCase();
  if (st === "COMPLETED") {
    const d = s(po, "completedDate");
    return d ? `Completed ${fmtDate(d)}` : "Completed";
  }
  if (st === "PENDING") return "Not started";
  if (st === "ON_HOLD") return "On hold";
  if (st === "CANCELLED") return "Cancelled";
  const dept = s(po, "currentDepartment").replace(/_/g, " ");
  return dept ? `In production — ${titleCase(dept)}` : "In production";
}

/** Bar / legend order: done first, then active, then waiting, then stopped. */
export const PO_STATUS_ORDER = ["COMPLETED", "IN_PROGRESS", "PENDING", "ON_HOLD", "PAUSED", "CANCELLED"];

export type CountRow = { status: string; label: string; count: number };

export function productionSummary(pos: Row[]): {
  total: number;
  completed: number;
  counts: CountRow[];
} {
  const by = new Map<string, number>();
  for (const p of pos) {
    const st = s(p, "status").toUpperCase() || "PENDING";
    by.set(st, (by.get(st) ?? 0) + 1);
  }
  const known = PO_STATUS_ORDER.filter((k) => by.has(k));
  const other = [...by.keys()].filter((k) => !PO_STATUS_ORDER.includes(k)).sort();
  return {
    total: pos.length,
    completed: by.get("COMPLETED") ?? 0,
    counts: [...known, ...other].map((k) => ({ status: k, label: titleCase(k), count: by.get(k) ?? 0 })),
  };
}

/** POs sorted for the expanded list: unfinished first (operators care about
 *  what is still moving), finished last; stable otherwise. */
export function sortPOs(pos: Row[]): Row[] {
  const rank = (p: Row) => {
    const i = ["IN_PROGRESS", "ON_HOLD", "PAUSED", "PENDING", "COMPLETED", "CANCELLED"].indexOf(
      s(p, "status").toUpperCase(),
    );
    return i < 0 ? 2 : i;
  };
  return pos.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

// ---------------------------------------------------------------------------
// Delivery orders (linkedDOs)
// ---------------------------------------------------------------------------

/** Desktop DO_STATUS_LABEL (sales/detail.tsx), matching the Delivery tabs. */
export const DO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Pending Dispatch",
  LOADED: "Dispatched",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
};

export function doLabel(status: string): string {
  const k = (status || "").toUpperCase();
  return DO_STATUS_LABEL[k] ?? titleCase(k);
}

export function deliverySummary(dos: Row[]): CountRow[] {
  const by = new Map<string, number>();
  for (const d of dos) {
    const st = s(d, "status").toUpperCase();
    by.set(st, (by.get(st) ?? 0) + 1);
  }
  return [...by.entries()].map(([status, count]) => ({ status, label: doLabel(status), count }));
}

/** The dated facts the API carries for one DO. `scheduledDate` is the DO's
 *  own Hookka expected DD (sales-orders.ts linkedDOs), so it reads "Expected". */
export function doFacts(d: Row, fmtDate: (x: string) => string): string[] {
  const out: string[] = [];
  const driver = s(d, "driverName");
  if (driver) out.push(`Driver ${driver}`);
  const del = s(d, "deliveredAt");
  const dis = s(d, "dispatchedAt");
  const exp = s(d, "scheduledDate");
  if (del) out.push(`Delivered ${fmtDate(del)}`);
  else if (dis) out.push(`Dispatched ${fmtDate(dis)}`);
  else if (exp) out.push(`Expected ${fmtDate(exp)}`);
  return out;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Desktop marks a line overridden when `priceOverrides[].lineIndex ===
 *  item.lineNo - 1`. Several overrides on one line → the newest wins. */
export function overrideForLine(overrides: Row[], lineNo: number): Row | null {
  const hits = overrides.filter((o) => n(o, "lineIndex") === lineNo - 1 && val(o, "lineIndex") !== undefined);
  if (!hits.length) return null;
  return [...hits].sort((a, b) => s(b, "timestamp").localeCompare(s(a, "timestamp")))[0];
}

export type SpecChip = { key: "gap" | "divan" | "leg" | "special"; text: string };

/** Spec chips from the real height / gap / special fields (not prices). */
export function specChips(it: Row): SpecChip[] {
  const out: SpecChip[] = [];
  const gap = n(it, "gapInches");
  const divan = n(it, "divanHeightInches");
  const leg = n(it, "legHeightInches");
  const special = s(it, "specialOrder");
  if (gap > 0) out.push({ key: "gap", text: `Gap ${gap}"` });
  if (divan > 0) out.push({ key: "divan", text: `Divan ${divan}"` });
  if (leg > 0) out.push({ key: "leg", text: `Leg ${leg}"` });
  if (special) out.push({ key: "special", text: special.replace(/_/g, " ") });
  return out;
}

/** Surcharges carried on the line, listed as facts — deliberately NOT laid
 *  out as base + surcharges = unit, because the unit price can also carry
 *  totalHeightPriceSen / discounts / overrides that would not add up. */
export function surcharges(it: Row): { label: string; sen: number }[] {
  const out: { label: string; sen: number }[] = [];
  const divan = n(it, "divanPriceSen");
  const leg = n(it, "legPriceSen");
  const special = n(it, "specialOrderPriceSen");
  if (divan > 0) out.push({ label: `Divan ${n(it, "divanHeightInches")}"`, sen: divan });
  if (leg > 0) out.push({ label: `Leg ${n(it, "legHeightInches")}"`, sen: leg });
  if (special > 0) out.push({ label: titleCase(s(it, "specialOrder")) || "Special order", sen: special });
  for (const c of rows(it.customSpecials)) {
    const sen = n(c, "surchargeSen");
    const d = s(c, "description");
    if (d && sen > 0) out.push({ label: d, sen });
  }
  return out;
}

/** "SO-2610-012-01" — the SO line reference (companySOId + lineSuffix). */
export function soLineRef(companySOId: string, it: Row): string {
  const suffix = s(it, "lineSuffix");
  if (companySOId && suffix) return `${companySOId}${suffix}`;
  return "";
}

// ---------------------------------------------------------------------------
// Header banners (ON_HOLD / CANCELLED) — real fields only.
// ---------------------------------------------------------------------------

export type Banner = { tone: "warning" | "danger"; title: string; text: string; meta: string };

export function statusBanner(
  doc: Row,
  history: Row[],
  fmtDateTime: (d: string) => string,
): Banner | null {
  const st = s(doc, "status").toUpperCase();
  if (st === "ON_HOLD") {
    const by = s(doc, "heldBy");
    const at = s(doc, "heldAt");
    return {
      tone: "warning",
      title: "Order on hold",
      text: s(doc, "holdReason") || "No hold reason recorded.",
      meta: [by ? `by ${by}` : "", at ? fmtDateTime(at) : ""].filter(Boolean).join(" · "),
    };
  }
  if (st === "CANCELLED") {
    const ev = [...history]
      .filter((h) => s(h, "toStatus").toUpperCase() === "CANCELLED")
      .sort((a, b) => s(b, "timestamp").localeCompare(s(a, "timestamp")))[0];
    const by = ev ? s(ev, "changedBy") : "";
    const at = ev ? s(ev, "timestamp") : "";
    return {
      tone: "danger",
      title: "Order cancelled",
      text: (ev && s(ev, "notes")) || "No further production or delivery is expected for this order.",
      meta: [by ? `by ${by}` : "", at ? fmtDateTime(at) : ""].filter(Boolean).join(" · "),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Desktop OVERRIDE_NOTE_PREFIX: an edit-lock override is logged as a status
 *  row whose notes start with this prefix. */
export const OVERRIDE_NOTE_PREFIX = "EDIT_LOCK_OVERRIDDEN: ";

export type StatusEvent = {
  key: string;
  override: boolean;
  from: string;
  to: string;
  note: string;
  autoActions: string[];
  by: string;
  at: string;
};

/** statusHistory newest first (the API already sends newest first; sorted
 *  again so the phone does not depend on it). */
export function statusEvents(history: Row[]): StatusEvent[] {
  return [...history]
    .sort((a, b) => s(b, "timestamp").localeCompare(s(a, "timestamp")))
    .map((h, i) => {
      const notes = s(h, "notes");
      const override = notes.startsWith(OVERRIDE_NOTE_PREFIX);
      return {
        key: s(h, "id") || String(i),
        override,
        from: s(h, "fromStatus").toUpperCase(),
        to: s(h, "toStatus").toUpperCase(),
        note: override ? notes.slice(OVERRIDE_NOTE_PREFIX.length) : notes,
        autoActions: Array.isArray(h.autoActions) ? (h.autoActions as unknown[]).map(String).filter(Boolean) : [],
        by: s(h, "changedBy"),
        at: s(h, "timestamp"),
      };
    });
}

/** Desktop AuditHistoryPanel actionChip vocabulary, spelled out (desktop's
 *  suffix rule yields "Canceld" / "Voidd"). */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  void: "Voided",
  cancel: "Cancelled",
  confirm: "Confirmed",
  approve: "Approved",
  post: "Posted",
  submit: "Submitted",
  reject: "Rejected",
};
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[(action || "").toLowerCase()] ?? (titleCase(action) || "Event");
}

/** Desktop fieldLabels for sales-orders, minus the balance / deposit keys:
 *  the phone shows no paid or balance figures, not even as a field name. */
const AUDIT_FIELD_LABELS: Record<string, string> = {
  companySOId: "SO Number",
  customerId: "Customer",
  customerPO: "Customer PO",
  poDate: "PO Date",
  deliveryDate: "Delivery Date",
  processingDate: "Processing Date",
  totalSen: "Total",
  status: "Status",
  remarks: "Remarks",
  items: "Items",
  shippingAddress: "Shipping Address",
  // rowToSO keys, named as the phone page names them.
  customerPOId: "Customer PO",
  customerSOId: "Customer SO",
  customerSO: "Customer SO",
  customerPODate: "Customer PO Date",
  companySODate: "Order Date",
  customerDeliveryDate: "Customer DD",
  hookkaExpectedDD: "Hookka Expected DD",
  hookkaDeliveryOrder: "Hookka Delivery Order",
  hubId: "Delivery Hub",
  notes: "Notes",
  reference: "Reference",
  subtotalSen: "Subtotal",
};
const AUDIT_HIDDEN = new Set([
  "updatedAt", "createdAt", "syncedAt", "lastSyncedAt", "lastModifiedAt", "version", "revision", "etag",
  "updatedBy",
  "balanceSen", "depositSen", "paidSen", "paidAmount", "paymentDate", "paymentStatus",
]);

function humanizeKey(key: string): string {
  // "hookkaExpectedDD" → "Hookka Expected DD" (acronyms stay together).
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).trim();
}

/** Names of the fields an audit event changed (values are not shown on the
 *  phone — the diff stays on desktop). */
export function auditChangedFields(before: unknown, after: unknown): string[] {
  const isObj = (x: unknown): x is Row => typeof x === "object" && x !== null && !Array.isArray(x);
  if (!isObj(before) || !isObj(after)) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const out: string[] = [];
  for (const k of keys) {
    if (AUDIT_HIDDEN.has(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(AUDIT_FIELD_LABELS[k] ?? humanizeKey(k));
  }
  return out;
}

export type AuditEvent = { key: string; title: string; fields: string[]; by: string; at: string };

export function auditEvents(events: Row[]): AuditEvent[] {
  return events.map((e, i) => ({
    key: s(e, "id") || String(i),
    title: auditActionLabel(s(e, "action")),
    fields: auditChangedFields(e.before, e.after),
    // /api/audit-events returns `actorUserName` (audit-events.ts).
    by: s(e, "actorUserName", "actor_user_name"),
    at: s(e, "ts"),
  }));
}

// ---------------------------------------------------------------------------

export function titleCase(raw: string): string {
  return (raw || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** "2026-10-23" / ISO → "23 Oct 2026"; "" when absent or unparsable. */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return "";
  return `${Number(m[3])} ${months[mi]} ${m[1]}`;
}

/** ISO timestamp → "14 Oct 2026, 15:20" in the device's local time. */
export function fmtDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return fmtDate(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDate(`${y}-${mo}-${da}`)}, ${hh}:${mi}`;
}
