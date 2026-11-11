// ===========================================================================
// invoices-mobile.ts — pure rules behind the phone Invoices list v2
// (src/pages/m/screens/invoices/InvoicesScreen.tsx).
//
// Visuals: Claude Design `Invoices v2.dc.html`. Rules: the desktop's
// (src/pages/invoices/index.tsx + src/api/routes/invoices.ts), plus the owner's
// 2026-10-21 decisions:
//   • Status colours = desktop getStatusColor (Overdue is WARNING_HIGH orange,
//     Cancelled grey, Partial Paid amber).
//   • "Overdue" = the BACKEND status. "Past due" = CALCULATED from the due date
//     and the remaining balance. The two are never mixed: status chips count
//     statuses only; the Past Due tile / filter / chip wording use the date.
//   • Outstanding = Σ(total − paid) over SENT / PARTIAL_PAID / OVERDUE — the
//     exact /api/invoices/stats SQL (invoices.ts:1452).
//   • A paid invoice shows "PAID IN FULL" with no date (list rows ship
//     `payments: []`, so there is no payment date to show).
//
// No React, no "@/" imports (node:test imports it directly).
// ===========================================================================
import { formatCurrency, getStatusColor } from "../../../lib/utils";
import { invoiceIssuedSen, noteIsIssued } from "../../../lib/invoice-notes";
import { n, rows, s, type RawRow } from "./do-mobile";

export { rows, type RawRow };

// ---------------------------------------------------------------------------
// Status → tone (desktop semantics).
// ---------------------------------------------------------------------------
export type InvTone = "neutral" | "info" | "success" | "warning" | "warningHigh" | "danger";

const TONE_BY_HEX: Record<string, InvTone> = {
  "#6B7280": "neutral",
  "#3E6570": "info",
  "#4F7C3A": "success",
  "#9C6F1E": "warning",
  "#B8601A": "warningHigh",
  "#9A3A2D": "danger",
};

/** The desktop Invoices status colour, as a tone name. */
export function invoiceTone(status: string): InvTone {
  return TONE_BY_HEX[getStatusColor((status || "").toUpperCase()).hex] ?? "neutral";
}

/** Desktop `statusTabs` order and labels (src/pages/invoices/index.tsx). */
export const INVOICE_STATUSES: { key: string; label: string }[] = [
  { key: "DRAFT", label: "Draft" },
  { key: "SENT", label: "Sent" },
  { key: "PARTIAL_PAID", label: "Partial Paid" },
  { key: "PAID", label: "Paid" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "CANCELLED", label: "Cancelled" },
];

export function statusLabel(status: string): string {
  const st = (status || "").toUpperCase();
  const known = INVOICE_STATUSES.find((x) => x.key === st);
  if (known) return known.label;
  if (!st) return "—";
  return st
    .split("_")
    .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** The statuses that still owe money (the /stats outstanding set). */
export const OPEN_STATUSES = new Set(["SENT", "PARTIAL_PAID", "OVERDUE"]);

export function statusOf(r: RawRow): string {
  return s(r, "status").toUpperCase();
}
export function totalSen(r: RawRow): number {
  return n(r, "totalSen", "total_sen");
}
export function paidSen(r: RawRow): number {
  return n(r, "paidAmount", "paid_amount");
}
/** total − paid, unclamped (same as /stats). */
export function balanceSen(r: RawRow): number {
  return totalSen(r) - paidSen(r);
}
export function dueDateOf(r: RawRow): string {
  return s(r, "dueDate", "due_date").slice(0, 10);
}

// ---------------------------------------------------------------------------
// Dates (YYYY-MM-DD strings; "today" is passed in — the screen uses the
// Malaysia calendar day, todayYmdMY()).
// ---------------------------------------------------------------------------
function dayNum(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** Whole days from `today` to `due` (negative = past). null if either is not a date. */
export function daysUntil(due: string, today: string): number | null {
  const a = dayNum(due);
  const b = dayNum(today);
  return a == null || b == null ? null : Math.round(a - b);
}

/**
 * Past due = still owes money, has a due date, and that date is before today.
 * Independent of whether the backend status says OVERDUE.
 */
export function isPastDue(r: RawRow, today: string): boolean {
  if (!OPEN_STATUSES.has(statusOf(r))) return false;
  if (balanceSen(r) <= 0) return false;
  const d = daysUntil(dueDateOf(r), today);
  return d != null && d < 0;
}

// ---------------------------------------------------------------------------
// Card pieces.
// ---------------------------------------------------------------------------
export type DueChip =
  | { kind: "paid" }
  | { kind: "due"; date: string; tone: "past" | "soon" | "plain"; countdown: string };

export function dueChip(r: RawRow, today: string): DueChip {
  const st = statusOf(r);
  if (st === "PAID") return { kind: "paid" };
  const date = dueDateOf(r);
  // Countdown only for an invoice that still owes money; Draft / Cancelled /
  // a fully-settled balance just show the date.
  if (!OPEN_STATUSES.has(st) || balanceSen(r) <= 0) return { kind: "due", date, tone: "plain", countdown: "" };
  const d = daysUntil(date, today);
  if (d == null) return { kind: "due", date, tone: "plain", countdown: "" };
  if (d < 0) return { kind: "due", date, tone: "past", countdown: `${-d} day${d === -1 ? "" : "s"} past due` };
  if (d === 0) return { kind: "due", date, tone: "soon", countdown: "Due today" };
  if (d <= 7) return { kind: "due", date, tone: "soon", countdown: `In ${d} day${d === 1 ? "" : "s"}` };
  return { kind: "due", date, tone: "plain", countdown: "" };
}

/** BALANCE while partly paid, else TOTAL (v1 / desktop rule). */
export function amountBox(r: RawRow): { key: "BALANCE" | "TOTAL"; sen: number } {
  const paid = paidSen(r);
  const bal = balanceSen(r);
  return paid > 0 && bal > 0 ? { key: "BALANCE", sen: bal } : { key: "TOTAL", sen: totalSen(r) };
}

/** Payment bar — only while partly paid. pct is 0–100, whole numbers. */
export function payProgress(r: RawRow): { paidSen: number; totalSen: number; pct: number } | null {
  const paid = paidSen(r);
  const total = totalSen(r);
  if (!(paid > 0 && total - paid > 0) || total <= 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round((paid / total) * 100)));
  return { paidSen: paid, totalSen: total, pct };
}

/** DO / SO reference chips; an empty value hides its chip. */
export function refChips(r: RawRow): { k: string; v: string }[] {
  return [
    { k: "DO", v: s(r, "doNo", "do_no") },
    { k: "SO", v: s(r, "companySOId", "company_so_id") },
  ].filter((x) => !!x.v);
}

// ---------------------------------------------------------------------------
// List: completeness, search, chips, summary.
// ---------------------------------------------------------------------------

/**
 * GET /api/invoices with no page/limit returns every row the caller may see
 * plus `total: data.length` (invoices.ts !paginate branch). Totals and counts
 * are only authoritative when that holds; a paged or malformed answer is not.
 */
export function invoiceList(resp: unknown): { rows: RawRow[]; complete: boolean } {
  if (!resp || typeof resp !== "object") return { rows: [], complete: false };
  const o = resp as { success?: boolean; data?: unknown; total?: unknown; page?: unknown };
  if (!Array.isArray(o.data)) return { rows: [], complete: false };
  const list = rows(o.data);
  const complete =
    o.success !== false &&
    o.page === undefined &&
    (o.total === undefined || Number(o.total) === list.length);
  return { rows: list, complete };
}

/** The desktop/server search keys: invoice no, customer, DO, SO, customer PO. */
export function matchesInvoiceQuery(r: RawRow, q: string): boolean {
  const ql = q.trim().toLowerCase();
  if (!ql) return true;
  return [
    s(r, "invoiceNo", "invoice_no"),
    s(r, "customerName", "customer_name"),
    s(r, "doNo", "do_no"),
    s(r, "companySOId", "company_so_id"),
    s(r, "customerPOId", "customer_po_id"),
  ]
    .join(" ")
    .toLowerCase()
    .includes(ql);
}

/** Count per backend status; "" = All (every row, legacy statuses included). */
export function statusCounts(list: RawRow[]): Record<string, number> {
  const out: Record<string, number> = { "": list.length };
  for (const x of INVOICE_STATUSES) out[x.key] = 0;
  for (const r of list) {
    const st = statusOf(r);
    if (st in out && st !== "") out[st] += 1;
  }
  return out;
}

export type InvoiceSummary = {
  /** Invoices in the selected status chip ("" = all). */
  count: number;
  /** Σ totalSen of those invoices (desktop tab money = invoiced total). */
  invoicedSen: number;
  /** Σ(total − paid) over SENT / PARTIAL_PAID / OVERDUE (independent of the chip). */
  outstandingSen: number;
  /** Σ(total − paid) over past-due invoices (independent of the chip). */
  pastDueSen: number;
  pastDueCount: number;
};

export function summarize(list: RawRow[], chip: string, today: string): InvoiceSummary {
  let count = 0;
  let invoicedSen = 0;
  let outstandingSen = 0;
  let pastDueSen = 0;
  let pastDueCount = 0;
  for (const r of list) {
    const st = statusOf(r);
    if (!chip || st === chip) {
      count += 1;
      invoicedSen += totalSen(r);
    }
    if (OPEN_STATUSES.has(st)) outstandingSen += balanceSen(r);
    if (isPastDue(r, today)) {
      pastDueSen += balanceSen(r);
      pastDueCount += 1;
    }
  }
  return { count, invoicedSen, outstandingSen, pastDueSen, pastDueCount };
}

/** Status chip ∩ Past Due filter ∩ search. */
export function filterInvoices(
  list: RawRow[],
  opts: { chip: string; pastDue: boolean; q: string; today: string },
): RawRow[] {
  return list.filter(
    (r) =>
      (!opts.chip || statusOf(r) === opts.chip) &&
      (!opts.pastDue || isPastDue(r, opts.today)) &&
      matchesInvoiceQuery(r, opts.q),
  );
}

// ===========================================================================
// Module tabs (two-tab handoff, owner 2026-10-22): Invoices · AR Aging.
// Each needs the read permission its API checks — both routes check
// `invoices` (GET /api/invoices, GET /api/invoices/aging). The five former
// tabs (Payments, Supplier Pay, Credit Notes, Debit Notes, e-Invoice) left the
// Invoices UI only; their sources stay in invoicesConfig (global search) and
// their card mappers below stay for a future Finance home.
// ===========================================================================
export const TAB_READ_RESOURCE: Record<string, string> = {
  invoices: "invoices",
  aging: "invoices",
};

// ---------------------------------------------------------------------------
// AR Aging access — ONE rule for every role (owner 2026-10-22, round 5).
//
// GET /api/invoices/aging has no customer scope in its SQL; the scoped role
// (customer-scope.ts SCOPED_ROLES) is narrowed only by customer NAME in the
// response middleware (BUG-2026-10-22-349). Until the backend scopes it by
// customer id, the tab is shown only to accounts the backend serves the WHOLE
// book, and that must be confirmed by the same column the backend decides on:
//   • `wildcard` — /api/auth/me/permissions returned the "*" sentinel. Not
//     enough alone: that endpoint resolves the role via users.roleId first,
//     while the gate (auth-middleware → rbac.ts / customer-scope.ts) reads
//     users.role, and a role edit (users.ts PUT) never updates roleId.
//   • `accountRole` — users.role as the server reports it, read FRESH from
//     GET /api/auth/me on every screen mount (no cache; owner approved
//     2026-10-22, round 6); null while loading, on any failure, or when the
//     body is not a user. A stale "*" from the permissions cache can therefore
//     only HIDE the tab, never show it to a role the fresh read rejects.
// The frontend only decides visibility; the backend still decides the rows.
// ---------------------------------------------------------------------------
/** Roles the backend serves the whole book: rbac.ts short-circuit, never in SCOPED_ROLES. */
export const UNRESTRICTED_ROLES: ReadonlySet<string> = new Set(["SUPER_ADMIN", "ADMIN"]);

/** True only once the BUG-2026-10-22-349 backend fix (customer-id SQL scope) is verified on production. */
export const AGING_SERVER_SCOPED: boolean = false;

export interface AgingAccess {
  /** invoices:read — the permission GET /api/invoices/aging checks. */
  canRead: boolean;
  /** /api/auth/me/permissions carried the "*" sentinel. */
  wildcard: boolean;
  /** users.role as reported by the server; null = not verified. */
  accountRole: string | null;
  /** The backend scopes /aging by customer id (AGING_SERVER_SCOPED). */
  serverScoped: boolean;
}

/**
 * users.role from a GET /api/auth/me body (`{ success: true, data: { user: { role } } }`,
 * auth.ts publicUser), upper-cased; null for anything else (error body, no user, blank role).
 */
export function meRole(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { success?: unknown; data?: { user?: { role?: unknown } } };
  if (b.success !== true) return null;
  const role = b.data?.user?.role;
  return typeof role === "string" && role.trim() !== "" ? role.trim().toUpperCase() : null;
}

/** May this viewer see the AR Aging tab (and fetch its data)? */
export function canUseArAging(a: AgingAccess): boolean {
  if (!a.canRead) return false;
  if (a.serverScoped) return true;
  return a.wildcard && a.accountRole != null && UNRESTRICTED_ROLES.has(a.accountRole.trim().toUpperCase());
}

/** Tabs the viewer may read, in their original order. */
export function allowedTabs<T extends { key: string }>(tabs: T[], canRead: (resource: string) => boolean): T[] {
  return tabs.filter((t) => canRead(TAB_READ_RESOURCE[t.key] ?? "invoices"));
}

/** The requested tab when allowed, else the first allowed one (null when none). */
export function pickTab<T extends { key: string }>(allowed: T[], requested: string): T | null {
  return allowed.find((t) => t.key === requested) ?? allowed[0] ?? null;
}

/** A 403 from the list API — "no access", not a connection problem. */
export function isForbidden(failure: { status?: number } | null | undefined): boolean {
  return failure?.status === 403;
}

// ===========================================================================
// AR Aging — GET /api/invoices/aging (invoices.ts app.get("/aging")).
// Rows: { customerName, current, days31_60, days61_90, days90plus, total },
// all in SEN (each is a sum of totalSen − paidAmount). Buckets are computed on
// the SERVER by due date (≤30 days past due incl. not yet due = current);
// PAID / CANCELLED / DRAFT and settled invoices excluded. The client never
// re-buckets: it only sums the returned rows. Grouped by customerName with no
// customerId, so a name is NOT a unique key.
// ===========================================================================
export type AgingKey = "current" | "days31_60" | "days61_90" | "days90plus";

/** Exact handoff labels; tone → --m-age-<tone>(-bg / -fg) tokens. */
export const AGING_BUCKETS: { key: AgingKey; label: string; tone: string }[] = [
  { key: "current", label: "Current (0-30)", tone: "current" },
  { key: "days31_60", label: "31-60 Days", tone: "d31" },
  { key: "days61_90", label: "61-90 Days", tone: "d61" },
  { key: "days90plus", label: "90+ Days", tone: "d90" },
];

export type AgingRowVM = { key: string; name: string; total: number } & Record<AgingKey, number>;

/**
 * Desktop rule: rows used only when `success && Array.isArray(data)`. `ok`
 * false (error envelope, wrong shape) must render as an error, never as
 * "No outstanding invoices found." Keys carry the index — names can repeat.
 */
export function agingList(resp: unknown): { rows: AgingRowVM[]; ok: boolean } {
  if (!resp || typeof resp !== "object") return { rows: [], ok: false };
  const o = resp as { success?: boolean; data?: unknown };
  if (o.success === false || !Array.isArray(o.data)) return { rows: [], ok: false };
  const list = rows(o.data).map((r, i) => {
    const name = s(r, "customerName", "customer_name") || "—";
    return {
      key: `${i}|${name}`,
      name,
      current: n(r, "current"),
      days31_60: n(r, "days31_60"),
      days61_90: n(r, "days61_90"),
      days90plus: n(r, "days90plus"),
      total: n(r, "total"),
    };
  });
  return { rows: list, ok: true };
}

/** Column totals = sum of the returned rows (desktop `agingTotals`). */
export function agingTotals(list: AgingRowVM[]): Record<AgingKey, number> & { total: number; count: number } {
  const out = { current: 0, days31_60: 0, days61_90: 0, days90plus: 0, total: 0, count: list.length };
  for (const r of list) {
    out.current += r.current;
    out.days31_60 += r.days31_60;
    out.days61_90 += r.days61_90;
    out.days90plus += r.days90plus;
    out.total += r.total;
  }
  return out;
}

/** The oldest bucket with a balance (drives the card rail + pill); null when none. */
export function oldestBucket(r: Record<AgingKey, number>): AgingKey | null {
  for (let i = AGING_BUCKETS.length - 1; i >= 0; i--) {
    if (r[AGING_BUCKETS[i].key] > 0) return AGING_BUCKETS[i].key;
  }
  return null;
}

/** Pill text for the oldest bucket (handoff: "Current (0-30)" / "Oldest · 31-60 Days"). */
export function oldestLabel(k: AgingKey | null): string {
  if (!k) return "No balance";
  const b = AGING_BUCKETS.find((x) => x.key === k)!;
  return k === "current" ? b.label : `Oldest · ${b.label}`;
}

/** Bar segments: non-zero buckets only, flex = amount (display only). */
export function agingSegments(r: Record<AgingKey, number>): { key: AgingKey; tone: string; sen: number }[] {
  return AGING_BUCKETS.filter((b) => r[b.key] > 0).map((b) => ({ key: b.key, tone: b.tone, sen: r[b.key] }));
}

/** Bucket amount: money when > 0, an en dash when zero (handoff + desktop "-"). */
export function agingAmount(sen: number): string {
  return sen > 0 ? formatCurrency(sen) : "–";
}

/** Customer-name filter over the loaded rows (mobile proposal; not authorisation). */
export function filterAging(list: AgingRowVM[], q: string): AgingRowVM[] {
  const ql = q.trim().toLowerCase();
  return ql ? list.filter((r) => r.name.toLowerCase().includes(ql)) : list;
}

// ===========================================================================
// Former tabs — the HTML's record card, fed by the REAL list fields
// (audited 2026-10-21 against each route's rowTo… mapper).
// ===========================================================================
export type RecordMeta = { k: string; v: string; align?: "right"; tone?: "danger" | "muted" };
export type RecordCard = {
  id: string;
  code: string;
  title: string;
  sub: string;
  /** Left rail: a status tone, or the fixed taupe of Supplier Pay. */
  rail: InvTone | "taupe";
  status: { label: string; tone: InvTone } | null;
  metas: [RecordMeta, RecordMeta];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function titleCase(v: string): string {
  return v
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Sen → "RM 1,234.00"; null (unknown) → "—", never a fake zero. */
export function moneyOrDash(sen: number | null): string {
  return sen == null ? "—" : formatCurrency(sen);
}

/** Record dates as "11 Oct 2026" (the HTML's fmtDate); "—" when missing. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || "").slice(0, 10));
  if (!m) return "—";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function senOrNull(r: RawRow, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = r[k];
    if (v === null || v === undefined || v === "") continue;
    const x = Number(v);
    if (Number.isFinite(x)) return Math.round(x);
  }
  return null;
}

/** Payment methods (mobile Record Payment options + desktop). */
export function methodLabel(code: string): string {
  const c = (code || "").toUpperCase();
  const known: Record<string, string> = {
    BANK_TRANSFER: "Bank Transfer",
    CHEQUE: "Cheque",
    CASH: "Cash",
    CREDIT_CARD: "Credit Card",
    E_WALLET: "E-Wallet",
    OTHER: "Other",
  };
  return known[c] ?? (c ? titleCase(c) : "—");
}

/** GET /api/payments row: receiptNumber · customerName · method · date · amount (sen). */
export function paymentCard(r: RawRow): RecordCard {
  return {
    id: s(r, "id", "receiptNumber"),
    code: s(r, "receiptNumber", "receipt_number") || "—",
    title: s(r, "customerName", "customer_name") || "—",
    sub: methodLabel(s(r, "method")),
    rail: "success",
    status: null,
    metas: [
      { k: "DATE", v: longDate(s(r, "date")) },
      { k: "AMOUNT", v: moneyOrDash(senOrNull(r, "amount")), align: "right" },
    ],
  };
}

/** GET /api/supplier-payments row: paymentNo · supplierName · date · bank total (sen). */
export function supplierPayCard(r: RawRow): RecordCard {
  return {
    id: s(r, "id", "paymentNo"),
    code: s(r, "paymentNo") || "—",
    title: s(r, "supplierName") || "—",
    sub: "",
    rail: "taupe",
    status: null,
    metas: [
      { k: "DATE", v: longDate(s(r, "date", "paymentDate")) },
      { k: "AMOUNT", v: moneyOrDash(senOrNull(r, "totalBankSen", "totalSen", "amountSen")), align: "right" },
    ],
  };
}

/** Note statuses DRAFT / APPROVED / POSTED / CANCELLED — desktop colours. */
export function noteTone(status: string): InvTone {
  return invoiceTone(status);
}

/** GET /api/credit-notes | /api/debit-notes row. Credit "− RM x" (red), debit "+ RM x". */
export function noteCard(kind: "CN" | "DN", r: RawRow): RecordCard {
  const st = s(r, "status").toUpperCase();
  const sen = senOrNull(r, "totalAmount", "total_amount");
  return {
    id: s(r, "id", "noteNumber"),
    code: s(r, "noteNumber", "note_number") || "—",
    title: s(r, "customerName", "customer_name") || "—",
    sub: [s(r, "invoiceNumber", "invoice_number"), s(r, "reason") ? titleCase(s(r, "reason")) : ""].filter(Boolean).join(" · "),
    rail: st ? noteTone(st) : "neutral",
    status: st ? { label: statusLabel(st), tone: noteTone(st) } : null,
    metas: [
      { k: "DATE", v: longDate(s(r, "date")) },
      {
        k: "AMOUNT",
        v: sen == null ? "—" : `${kind === "CN" ? "− " : "+ "}${formatCurrency(sen)}`,
        align: "right",
        tone: kind === "CN" && sen != null ? "danger" : undefined,
      },
    ],
  };
}

/** e-Invoice statuses (e-invoices.ts): PENDING / SUBMITTED / VALID / CANCELLED. */
export function eInvoiceTone(status: string): InvTone {
  return (status || "").toUpperCase() === "VALID" ? "success" : invoiceTone(status);
}

/**
 * `totalIncludingTax` is stored in RINGGIT (desktop prints it with
 * toFixed(2)); converted to sen once, here. null when absent — never 0.
 */
export function eInvoiceSen(r: RawRow): number | null {
  const v = r.totalIncludingTax ?? r.total_including_tax;
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 100) : null;
}

export function eInvoiceCard(r: RawRow): RecordCard {
  const st = s(r, "status").toUpperCase() || "PENDING";
  const submitted = s(r, "submittedAt", "submitted_at");
  return {
    id: s(r, "id", "invoiceNo"),
    code: s(r, "invoiceNo", "invoice_no") || "—",
    title: s(r, "customerName", "customer_name") || "—",
    sub: "LHDN MyInvois",
    rail: eInvoiceTone(st),
    status: { label: statusLabel(st), tone: eInvoiceTone(st) },
    metas: [
      { k: "SUBMISSION", v: submitted ? longDate(submitted) : "Not submitted", tone: submitted ? undefined : "muted" },
      { k: "AMOUNT", v: moneyOrDash(eInvoiceSen(r)), align: "right" },
    ],
  };
}

// ===========================================================================
// Invoice Detail — GET /api/invoices/:id → { data, lockReason,
// linkedCreditNotes, linkedDebitNotes, sourceConsignmentNote }.
// ===========================================================================

/** Record Payment eligibility (owner D2): an open status AND invoices:update. */
export const PAYABLE_STATUSES = new Set(["SENT", "PARTIAL_PAID", "OVERDUE"]);
export function canRecordPayment(status: string, canUpdate: boolean): boolean {
  return canUpdate && PAYABLE_STATUSES.has((status || "").toUpperCase());
}

export type LifeStep = { label: string; state: "done" | "current" | "pending"; stateText: string };
export type Lifecycle = { inFlow: true; steps: LifeStep[] } | { inFlow: false; note: string };

/**
 * Draft → Sent → Paid from the REAL status. Partial Paid sits ON the Paid step
 * as "Partially paid" — never done. Overdue / Cancelled / anything else are
 * off the linear flow: no tracker, a note instead (no misleading progress).
 */
export function lifecycle(status: string): Lifecycle {
  const st = (status || "").toUpperCase();
  const mk = (states: LifeStep["state"][], current = "Current"): Lifecycle => ({
    inFlow: true,
    steps: ["Draft", "Sent", "Paid"].map((label, i) => ({
      label,
      state: states[i],
      stateText: states[i] === "done" ? "Done" : states[i] === "current" ? current : "",
    })),
  });
  if (st === "DRAFT") return mk(["current", "pending", "pending"]);
  if (st === "SENT") return mk(["done", "current", "pending"]);
  if (st === "PARTIAL_PAID") return mk(["done", "done", "current"], "Partially paid");
  if (st === "PAID") return mk(["done", "done", "done"]);
  if (st === "OVERDUE") {
    return { inFlow: false, note: "Overdue is a special status outside the Draft → Sent → Paid lifecycle: the invoice was sent and is not fully paid." };
  }
  if (st === "CANCELLED") return { inFlow: false, note: "Cancelled is a special status outside the Draft → Sent → Paid lifecycle." };
  return { inFlow: false, note: `${statusLabel(st)} is outside the Draft → Sent → Paid lifecycle.` };
}

/** Header banner: calculated past due (any open status), or cancelled. */
export function detailBanner(r: RawRow, today: string): { tone: "danger" | "neutral"; text: string } | null {
  if (statusOf(r) === "CANCELLED") return { tone: "neutral", text: "This invoice was cancelled." };
  if (isPastDue(r, today)) {
    const d = -(daysUntil(dueDateOf(r), today) ?? 0);
    return { tone: "danger", text: `${d} day${d === 1 ? "" : "s"} past due · ${formatCurrency(balanceSen(r))} outstanding` };
  }
  return null;
}

/** Balance tile tone: owing + past due → danger; owing → warning; settled → success. */
export function balanceTone(r: RawRow, today: string): "danger" | "warning" | "success" {
  if (balanceSen(r) <= 0) return "success";
  return isPastDue(r, today) ? "danger" : "warning";
}

/** Expanded line rows: real fields only (an invoice line carries no SO-line reference). */
export function itemRows(it: RawRow): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = [];
  if (s(it, "sizeLabel")) out.push({ k: "Size", v: s(it, "sizeLabel") });
  if (s(it, "fabricCode")) out.push({ k: "Fabric", v: s(it, "fabricCode") });
  out.push({ k: "Unit price", v: formatCurrency(n(it, "unitPriceSen")) });
  if (n(it, "discountSen") > 0) out.push({ k: "Discount", v: `− ${formatCurrency(n(it, "discountSen"))}` });
  out.push({ k: "Line total", v: formatCurrency(n(it, "totalSen")) });
  return out;
}

export type PaymentRowVM = { key: string; method: string; methodCode: string; date: string; reference: string; amountSen: number };

/**
 * Real invoice_payments rows. When the invoice says money was paid but no rows
 * came back (older invoices), `unitemisedSen` is that paid amount — shown as a
 * summary, never as a made-up transaction.
 */
export function paymentHistory(doc: RawRow): { rows: PaymentRowVM[]; unitemisedSen: number | null } {
  const list = rows(doc.payments).map((p, i) => ({
    key: s(p, "id") || `pay-${i}`,
    method: methodLabel(s(p, "method")),
    methodCode: s(p, "method").toUpperCase(),
    date: s(p, "date").slice(0, 10),
    reference: s(p, "reference"),
    amountSen: n(p, "amountSen", "amount_sen"),
  }));
  const paid = paidSen(doc);
  return { rows: list, unitemisedSen: list.length === 0 && paid > 0 ? paid : null };
}

export type DocNode = { label: string; doc: string; sub: string; current?: boolean; href?: string };

/** SO → DO (or the source consignment note) → this invoice. Real links only. */
export function relatedChain(doc: RawRow, sourceCn: { id?: string; noteNumber?: string } | null | undefined): DocNode[] {
  const out: DocNode[] = [];
  const soId = s(doc, "salesOrderId");
  const soNo = s(doc, "companySOId");
  if (soId || soNo) {
    out.push({ label: "Sales Order", doc: soNo || soId, sub: "Opens the sales order", href: `/m/sales/${encodeURIComponent(soId || soNo)}` });
  }
  const doId = s(doc, "deliveryOrderId");
  const doNo = s(doc, "doNo");
  if (doId || doNo) {
    out.push({
      label: "Delivery Order",
      doc: doNo || doId,
      sub: "Delivery order this invoice was raised from",
      href: doId ? `/m/delivery/${encodeURIComponent(doId)}` : undefined,
    });
  }
  if (sourceCn && (sourceCn.noteNumber || sourceCn.id)) {
    out.push({ label: "Consignment Note", doc: sourceCn.noteNumber || String(sourceCn.id), sub: "Consignment note this invoice was converted from" });
  }
  out.push({ label: "Sales Invoice", doc: s(doc, "invoiceNo") || "—", sub: "This invoice", current: true });
  return out;
}

export type AdjustmentVM = { kind: "CN" | "DN"; key: string; no: string; status: string; tone: InvTone; sub: string; amountSen: number | null };

/**
 * Linked credit / debit notes. `issuedSen` (desktop's "Invoice as issued",
 * src/lib/invoice-notes.ts) only when at least one note is issued
 * (CN APPROVED / POSTED, DN POSTED).
 */
export function adjustments(
  resp: { linkedCreditNotes?: unknown; linkedDebitNotes?: unknown } | null | undefined,
  invoiceTotalSen: number,
): { rows: AdjustmentVM[]; issuedSen: number | null } {
  const map = (kind: "CN" | "DN", list: unknown): AdjustmentVM[] =>
    rows(list).map((x, i) => {
      const st = s(x, "status").toUpperCase();
      return {
        kind,
        key: s(x, "id") || `${kind}-${i}`,
        no: s(x, "noteNumber") || "—",
        status: st,
        tone: noteTone(st),
        sub: [kind === "CN" ? "Credit note" : "Debit note", s(x, "reason") ? titleCase(s(x, "reason")) : "", s(x, "date") ? longDate(s(x, "date")) : ""]
          .filter(Boolean)
          .join(" · "),
        amountSen: senOrNull(x, "totalAmount"),
      };
    });
  const cn = map("CN", resp?.linkedCreditNotes);
  const dn = map("DN", resp?.linkedDebitNotes);
  const issuedCn = cn.filter((x) => noteIsIssued("CN", x.status));
  const issuedDn = dn.filter((x) => noteIsIssued("DN", x.status));
  const creditSen = issuedCn.reduce((a, x) => a + (x.amountSen ?? 0), 0);
  const debitSen = issuedDn.reduce((a, x) => a + (x.amountSen ?? 0), 0);
  const anyIssued = issuedCn.length + issuedDn.length > 0;
  return { rows: [...cn, ...dn], issuedSen: anyIssued ? invoiceIssuedSen(invoiceTotalSen, { creditSen, debitSen }) : null };
}

export type AuditLine = { key: string; title: string; detail: string; actor: string; ts: string };

/** /api/audit-events rows → timeline lines; detail only from real before / after values. */
export function auditLines(events: unknown): AuditLine[] {
  const verb: Record<string, string> = { create: "Created", update: "Updated", post: "Posted", void: "Voided", delete: "Deleted" };
  return rows(events).map((e, i) => {
    const action = s(e, "action");
    const before = (e.before && typeof e.before === "object" ? e.before : null) as RawRow | null;
    const after = (e.after && typeof e.after === "object" ? e.after : null) as RawRow | null;
    const b = before ? s(before, "status").toUpperCase() : "";
    const a = after ? s(after, "status").toUpperCase() : "";
    let detail = "";
    if (b && a && b !== a) detail = `Status: ${statusLabel(b)} → ${statusLabel(a)}`;
    else if (before && after && before.paidAmount !== undefined && after.paidAmount !== undefined && n(before, "paidAmount") !== n(after, "paidAmount")) {
      detail = `Paid: ${formatCurrency(n(before, "paidAmount"))} → ${formatCurrency(n(after, "paidAmount"))}`;
    }
    return {
      key: s(e, "id") || `ev-${i}`,
      title: verb[action.toLowerCase()] ?? (action ? titleCase(action) : "Event"),
      detail,
      actor: s(e, "actorUserName") || "—",
      ts: s(e, "ts"),
    };
  });
}
