// ---------------------------------------------------------------------------
// Suppliers (Batch 4, Claude Design "Suppliers (standalone)") — the pure half:
// row readers, status / PO / price-change maps, list filter + sort, money and
// date text, and the add / edit form's validation and payload.
//
// Every figure comes from the server: money is integer (or sub-cent) sen and is
// only turned into text here, never into a float that is stored or summed.
// ---------------------------------------------------------------------------
import { isOneEmailAddress, supplierMainEmailError } from "@/lib/supplier-emails";
import { normalisePartyCurrency } from "@/lib/party-finance";

export type Row = Record<string, unknown>;

export const s = (r: Row | null | undefined, ...keys: string[]): string => {
  if (!r) return "";
  for (const k of keys) {
    const v = r[k];
    if (v != null && v !== "") return String(v);
  }
  return "";
};
export const n = (r: Row | null | undefined, ...keys: string[]): number => {
  if (!r) return 0;
  for (const k of keys) {
    const v = Number(r[k]);
    if (r[k] != null && r[k] !== "" && Number.isFinite(v)) return v;
  }
  return 0;
};

/** `{ data: [...] }` or a bare array → the rows. */
export function rowsOf(resp: unknown): Row[] {
  if (Array.isArray(resp)) return resp as Row[];
  const d = (resp as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as Row[]) : [];
}

// ---- supplier status ------------------------------------------------------------
export type SupStatus = "ACTIVE" | "INACTIVE" | "BLACKLISTED";
export const STATUS: Record<SupStatus, { l: string; c: string; b: string }> = {
  ACTIVE: { l: "Active", c: "var(--xo-ok)", b: "var(--xo-okb)" },
  INACTIVE: { l: "Inactive", c: "var(--xo-neu)", b: "var(--xo-neub)" },
  BLACKLISTED: { l: "Blacklisted", c: "var(--xo-bad)", b: "var(--xo-badb)" },
};
/** The supplier's `status` (never `isActive`); anything unknown reads as Active, like the API default. */
export function statusOf(r: Row): SupStatus {
  const v = s(r, "status").toUpperCase();
  return v === "INACTIVE" || v === "BLACKLISTED" ? v : "ACTIVE";
}

// ---- payment terms -----------------------------------------------------------------
export const TERMS = ["COD", "NET15", "NET30", "NET45", "NET60"] as const;
const TERM_L: Record<string, string> = { COD: "COD", NET15: "Net 15", NET30: "Net 30", NET45: "Net 45", NET60: "Net 60", NET90: "Net 90" };
export const termsLabel = (t: string): string => (t ? TERM_L[t.toUpperCase()] ?? t : "—");

// ---- supplier row ------------------------------------------------------------------
export type Supplier = {
  id: string; code: string; name: string; contact: string; phone: string; email: string; email2: string; email3: string;
  address: string; ssm: string; terms: string; rating: number; status: SupStatus; org: string; currency: string;
};
export function toSupplier(r: Row): Supplier {
  const lines = [s(r, "addressLine1"), s(r, "addressLine2"), s(r, "addressLine3"), s(r, "addressLine4")].filter(Boolean).join(", ");
  return {
    id: s(r, "id"),
    code: s(r, "code"),
    name: s(r, "name"),
    contact: s(r, "contactPerson", "contact_person"),
    phone: s(r, "phone"),
    email: s(r, "email"),
    email2: s(r, "email2", "email_2"),
    email3: s(r, "email3", "email_3"),
    address: s(r, "address") || lines,
    ssm: s(r, "registrationNo", "registration_no"),
    terms: s(r, "paymentTerms", "payment_terms"),
    rating: Math.max(0, Math.min(5, n(r, "rating"))),
    status: statusOf(r),
    org: s(r, "purchaseOrgCode", "purchase_org_code") || "HOOKKA",
    currency: normalisePartyCurrency(s(r, "currency") || "MYR"),
  };
}

// ---- list -------------------------------------------------------------------------------
export type Chip = "all" | SupStatus;
export type SortKey = "name" | "code" | "rating";
export type ListOpts = { chip: Chip; q: string; sort: SortKey; terms: string; org: string };

export function filterSort(all: Supplier[], o: ListOpts): Supplier[] {
  const q = o.q.trim().toLowerCase();
  const L = all.filter(
    (p) =>
      (o.chip === "all" || p.status === o.chip) &&
      (o.terms === "all" || p.terms === o.terms) &&
      (o.org === "all" || p.org === o.org) &&
      (!q || `${p.code} ${p.name} ${p.contact} ${p.phone}`.toLowerCase().includes(q)),
  );
  return [...L].sort((a, b) =>
    o.sort === "code" ? a.code.localeCompare(b.code) : o.sort === "rating" ? b.rating - a.rating || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
  );
}

// ---- text ---------------------------------------------------------------------------------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-20…" → "20 Nov 2026"; blank → "—". */
export function dl(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || "");
  if (!m) return v ? v : "—";
  return `${+m[3]} ${MON[+m[2] - 1] ?? ""} ${m[1]}`;
}
export const ymd = (v: string): string => (/^\d{4}-\d{2}-\d{2}/.test(v || "") ? v.slice(0, 10) : "");

const prefix = (cur: string) => (!cur || cur === "MYR" ? "RM " : `${cur} `);
/** Sen → "RM 1,234.50" (2 dp). */
export function money(sen: number, cur = "MYR"): string {
  return prefix(cur) + (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** A unit price in sen, which may carry sub-cent digits → 2 to 4 dp. */
export function price(sen: number, cur = "MYR"): string {
  return prefix(cur) + (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
export const qty = (v: number): string => v.toLocaleString("en-MY");

/** A binding's currency: MYR or CNY only (an old RMB reads as CNY). */
export function bindingCurrency(v: string): "MYR" | "CNY" {
  return normalisePartyCurrency(v) === "CNY" ? "CNY" : "MYR";
}

// ---- purchase orders -------------------------------------------------------------------
/** The real PO enum (purchase-orders.ts VALID_TRANSITIONS). */
export const PO_STATUS: Record<string, { l: string; c: string; b: string }> = {
  DRAFT: { l: "Draft", c: "var(--xo-neu)", b: "var(--xo-neub)" },
  SUBMITTED: { l: "Submitted", c: "var(--xo-info)", b: "var(--xo-infob)" },
  CONFIRMED: { l: "Confirmed", c: "var(--xo-info)", b: "var(--xo-infob)" },
  PARTIAL_RECEIVED: { l: "Partially received", c: "var(--xo-warn)", b: "var(--xo-warnb)" },
  RECEIVED: { l: "Received", c: "var(--xo-ok)", b: "var(--xo-okb)" },
  CLOSED: { l: "Closed", c: "var(--xo-neu)", b: "var(--xo-neub)" },
  CANCELLED: { l: "Cancelled", c: "var(--xo-bad)", b: "var(--xo-badb)" },
};
export function poStatus(v: string) {
  const k = (v || "").toUpperCase();
  return PO_STATUS[k] ?? { l: v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") : "—", c: "var(--xo-neu)", b: "var(--xo-neub)" };
}
/** Early / On time / Late — received date against expected date (date parts only). */
export function deliveryTag(expected: string, received: string): { l: string; c: string; b: string } | null {
  const e = ymd(expected), r = ymd(received);
  if (!e || !r) return null;
  if (r < e) return { l: "Early", c: "var(--xo-info)", b: "var(--xo-infob)" };
  if (r === e) return { l: "On time", c: "var(--xo-ok)", b: "var(--xo-okb)" };
  return { l: "Late", c: "var(--xo-bad)", b: "var(--xo-badb)" };
}

export type PoLine = { key: string; poId: string; poNo: string; date: string; code: string; name: string; qty: number; unitSen: number; totalSen: number };
/** This supplier's PO lines, newest first — the desktop rule (supplierId match, item totalSen). */
export function poLinesOf(pos: Row[], supplierId: string): PoLine[] {
  const out: PoLine[] = [];
  for (const po of pos) {
    if (s(po, "supplierId", "supplier_id") !== supplierId) continue;
    const items = Array.isArray(po.items) ? (po.items as Row[]) : [];
    items.forEach((it, i) => {
      out.push({
        key: `${s(po, "id")}-${s(it, "id") || i}`,
        poId: s(po, "id"),
        poNo: s(po, "poNo", "po_no"),
        date: s(po, "orderDate", "order_date"),
        code: s(it, "materialCode", "material_code"),
        name: s(it, "materialName", "material_name"),
        qty: n(it, "quantity"),
        unitSen: n(it, "unitPriceSen", "unit_price_sen"),
        totalSen: n(it, "totalSen", "total_sen"),
      });
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.poNo.localeCompare(b.poNo));
}

// ---- price changes ---------------------------------------------------------------------
export const APPROVAL: Record<string, { l: string; c: string; b: string }> = {
  APPROVED: { l: "Approved", c: "var(--xo-ok)", b: "var(--xo-okb)" },
  PENDING: { l: "Pending", c: "var(--xo-warn)", b: "var(--xo-warnb)" },
  REJECTED: { l: "Rejected", c: "var(--xo-bad)", b: "var(--xo-badb)" },
};
export const approvalOf = (v: string) => APPROVAL[(v || "PENDING").toUpperCase()] ?? APPROVAL.PENDING;
/** Change % text; an opening price (old 0) has none. */
export function changePct(oldSen: number, newSen: number): { t: string; up: boolean | null } {
  if (!oldSen) return { t: "—", up: null };
  const p = ((newSen - oldSen) / oldSen) * 100;
  return { t: `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`, up: p > 0 };
}

// ---- form -------------------------------------------------------------------------------
export type FormV = {
  code: string; name: string; ssm: string; contact: string; phone: string; email: string; email2: string; email3: string;
  address: string; terms: string; org: string; status: SupStatus;
};
export const EMPTY_FORM: FormV = { code: "", name: "", ssm: "", contact: "", phone: "", email: "", email2: "", email3: "", address: "", terms: "NET30", org: "HOOKKA", status: "ACTIVE" };
export function formOf(p: Supplier): FormV {
  return { code: p.code, name: p.name, ssm: p.ssm, contact: p.contact, phone: p.phone, email: p.email, email2: p.email2, email3: p.email3, address: p.address, terms: p.terms || "NET30", org: p.org, status: p.status };
}
export type FormErrors = Partial<Record<"code" | "name" | "email" | "email2" | "email3", string>>;
export function formErrors(v: FormV): FormErrors {
  const e: FormErrors = {};
  if (!v.code.trim()) e.code = "Supplier code is required.";
  if (!v.name.trim()) e.name = "Supplier name is required.";
  const main = supplierMainEmailError(v.email);
  if (main) e.email = main;
  if (v.email2.trim() && !isOneEmailAddress(v.email2)) e.email2 = "One valid email address.";
  if (v.email3.trim() && !isOneEmailAddress(v.email3)) e.email3 = "One valid email address.";
  return e;
}
/** Only the fields this form edits — a PUT keeps everything else (incl. SKU bindings: no `materials`). */
export function payloadOf(v: FormV): Record<string, string> {
  return {
    code: v.code.trim(), name: v.name.trim(), registrationNo: v.ssm.trim(), contactPerson: v.contact.trim(), phone: v.phone.trim(),
    email: v.email.trim(), email2: v.email2.trim(), email3: v.email3.trim(), address: v.address.trim(),
    paymentTerms: v.terms, purchaseOrgCode: v.org, status: v.status,
  };
}
/** A failed save's text: the server's own message, a 403's missing permission, else the prototype's line. */
export function saveErrorText(status: number, body: unknown): string {
  const b = (body ?? {}) as { error?: unknown; missingPermission?: unknown };
  if (status === 403) {
    return b.missingPermission ? `You don't have permission to do this (needs ${String(b.missingPermission)}).` : "You don't have permission to do this.";
  }
  if (status > 0 && typeof b.error === "string" && b.error.trim()) return b.error.trim();
  return "Couldn't save. Check your connection and try again.";
}
