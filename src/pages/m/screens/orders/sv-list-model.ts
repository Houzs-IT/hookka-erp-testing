// ===========================================================================
// sv-list-model — pure derivations for the SV Service Orders list (no React,
// no "@/" imports, so a test can load it). Rows are GET /api/sales-orders?isServiceOrder=true.
//
// Rules come from the desktop, not the prototype:
//   • Confirmed tab = every status except DRAFT; Drafts tab = DRAFT      (desktop sales/index.tsx tabs)
//   • Chip buckets come from src/lib/so-status.ts (OUTSTANDING / PENDING_DELIVERY / COMPLETED); the prototype's
//     "On hold" and "Cancelled" chips are single-status filters on top of them.
//   • Production "Done" only when EVERY linked production order is COMPLETED — never because a rounded % is 100.
// ===========================================================================
type Row = Record<string, unknown>;

const s = (r: Row, ...keys: string[]): string => {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};
const n = (r: Row, ...keys: string[]): number => {
  for (const k of keys) {
    const v = Number(r[k]);
    if (Number.isFinite(v)) return v;
  }
  return 0;
};

export type SvRow = {
  id: string;
  no: string;
  status: string;
  customerName: string;
  orderDate: string;
  expectedDD: string;
  customerDD: string;
  customerPO: string;
  customerSO: string;
  reference: string;
  /** Fallback only (rows carry no case field today); the case filter uses the resolved link. */
  caseId: string;
  qty: number;
  lines: number;
  totalSen: number;
  createdAt: string;
};

export function toSvRow(r: Row): SvRow {
  const items = Array.isArray(r.items) ? (r.items as Row[]) : [];
  return {
    id: s(r, "id"),
    no: s(r, "companySOId", "companySO", "company_so_id"),
    status: s(r, "status").toUpperCase(),
    customerName: s(r, "customerName", "customer_name"),
    orderDate: s(r, "companySODate", "company_so_date").slice(0, 10),
    expectedDD: s(r, "hookkaExpectedDD", "hookka_expected_dd").slice(0, 10),
    customerDD: s(r, "customerDeliveryDate", "customer_delivery_date").slice(0, 10),
    customerPO: s(r, "customerPOId", "customerPO", "customer_po_id", "customer_po"),
    customerSO: s(r, "customerSOId", "customerSO", "customer_so_id", "customer_so"),
    reference: s(r, "reference"),
    caseId: s(r, "caseId", "caseid", "case_id"),
    qty: items.reduce((t, it) => t + n(it, "quantity", "qty"), 0),
    lines: items.length,
    totalSen: n(r, "totalSen", "total_sen"),
    createdAt: s(r, "createdAt", "created_at", "companySODate"),
  };
}

// ---- Tabs + chips ----------------------------------------------------------------------------------
export type SvTab = "confirmed" | "drafts";
export type SvChip = "ALL" | "OUTSTANDING" | "PENDING_DELIVERY" | "COMPLETED" | "ON_HOLD" | "CANCELLED";
export const SV_CHIPS: { key: SvChip; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OUTSTANDING", label: "Outstanding" },
  { key: "PENDING_DELIVERY", label: "Pending delivery" },
  { key: "COMPLETED", label: "Completed" },
  { key: "ON_HOLD", label: "On hold" },
  { key: "CANCELLED", label: "Cancelled" },
];
/** Mirrors src/lib/so-status.ts (kept literal so this file stays dependency-free; the test pins the sets). */
const OUTSTANDING = new Set(["CONFIRMED", "IN_PRODUCTION", "READY_TO_SHIP", "ON_HOLD"]);
const PENDING_DELIVERY = new Set(["SHIPPED"]);
const COMPLETED = new Set(["DELIVERED", "INVOICED", "CLOSED"]);

export const inTab = (status: string, tab: SvTab): boolean => (tab === "drafts" ? status === "DRAFT" : status !== "DRAFT");
export function inChip(status: string, chip: SvChip): boolean {
  switch (chip) {
    case "ALL": return true;
    case "OUTSTANDING": return OUTSTANDING.has(status);
    case "PENDING_DELIVERY": return PENDING_DELIVERY.has(status);
    case "COMPLETED": return COMPLETED.has(status);
    case "ON_HOLD": return status === "ON_HOLD";
    case "CANCELLED": return status === "CANCELLED";
  }
}

// ---- Search + sort + filter -------------------------------------------------------------------------
export type SvSort = "newest" | "expected" | "customerDD" | "customer" | "total";
export const SV_SORT_LABEL: Record<SvSort, string> = {
  newest: "Newest first",
  expected: "Expected DD (soonest)",
  customerDD: "Customer DD (soonest)",
  customer: "Customer A–Z",
  total: "Total (high to low)",
};
export type SvCaseFilter = "any" | "linked" | "standalone";
export type SvFilters = { sort: SvSort; caseLink: SvCaseFilter };
export const EMPTY_SV_FILTERS: SvFilters = { sort: "newest", caseLink: "any" };
export const svFilterCount = (f: SvFilters): number => (f.sort !== "newest" ? 1 : 0) + (f.caseLink !== "any" ? 1 : 0);

// ---- Case link resolution ------------------------------------------------------------------------------
// GET /api/sales-orders rows carry NO case field. The only link source is GET /api/service-cases (each case's
// `orders[]`), which is LIMIT 500 newest with no truncation flag (`total` is just data.length). So an order is
// "standalone" ONLY when that list loaded successfully AND is known complete (fewer than the cap); otherwise the
// absence of a link proves nothing and the order is "unknown".
export const CASE_LIST_CAP = 500; // mirrors LIST_CAP (cases/case-model.ts) + `LIMIT 500` in api/routes/service-cases.ts
export type CaseLink = "linked" | "standalone" | "unknown";
export type CaseCoverage = "complete" | "capped" | "loading" | "error";

/** `loaded` = the case list arrived as an array; `count` its length; `hasError` = the last fetch failed. */
export function caseCoverage(s: { loaded: boolean; count: number; hasError: boolean }): CaseCoverage {
  if (!s.loaded) return s.hasError ? "error" : "loading";
  return s.count >= CASE_LIST_CAP ? "capped" : "complete";
}

export function resolveCaseLink(positivelyLinked: boolean, coverage: CaseCoverage): CaseLink {
  if (positivelyLinked) return "linked";
  return coverage === "complete" ? "standalone" : "unknown";
}

/** Note shown under the filter row while the case filter is active and links are not fully resolved. */
export function caseLinkNote(filter: SvCaseFilter, coverage: CaseCoverage): string | null {
  if (filter === "any" || coverage === "complete") return null;
  if (coverage === "loading") return "Case links are still loading, so orders without a known link are hidden for now.";
  if (coverage === "error") return "Couldn’t load case links, so this filter can’t tell which orders are standalone. Orders without a known link are hidden.";
  return `Case links are checked against the newest ${CASE_LIST_CAP} cases only. Older orders without a known link are hidden${filter === "standalone" ? " and may still belong to an older case" : ""}.`;
}

/** Load failure class for a list: only a real 403 means "no access". 401 = signed out; the rest is a load failure. */
export type ListFailureKind = "none" | "forbidden" | "unauthorized" | "error";
export function classifyListFailure(failure: { status?: number } | null | undefined): ListFailureKind {
  if (!failure) return "none";
  if (failure.status === 403) return "forbidden";
  if (failure.status === 401) return "unauthorized";
  return "error";
}

export function matchesSv(r: SvRow, q: string, f: SvFilters, caseNo: string, link: CaseLink = "unknown"): boolean {
  if (f.caseLink === "linked" && link !== "linked") return false;
  if (f.caseLink === "standalone" && link !== "standalone") return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.no, r.customerName, r.customerPO, r.customerSO, r.reference, caseNo].some((v) => v.toLowerCase().includes(needle));
}

const dateKey = (d: string) => d || "9999-99-99";
export function sortSv(rows: SvRow[], sort: SvSort): SvRow[] {
  const out = [...rows];
  switch (sort) {
    case "expected": return out.sort((a, b) => dateKey(a.expectedDD).localeCompare(dateKey(b.expectedDD)) || a.no.localeCompare(b.no));
    case "customerDD": return out.sort((a, b) => dateKey(a.customerDD).localeCompare(dateKey(b.customerDD)) || a.no.localeCompare(b.no));
    case "customer": return out.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.no.localeCompare(b.no));
    case "total": return out.sort((a, b) => b.totalSen - a.totalSen || a.no.localeCompare(b.no));
    default: return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || b.no.localeCompare(a.no));
  }
}

// ---- Production summary ------------------------------------------------------------------------------
export type PoLite = { salesOrderId?: string | null; status?: string; quantity?: number; progress?: number; currentDepartment?: string };
export type SvProduction = { kind: "none" | "progress" | "done"; dept: string; pct: number };

/** Quantity-weighted progress across the order's production orders. `done` ONLY when every non-cancelled PO is COMPLETED. */
export function svProduction(pos: PoLite[]): SvProduction {
  const live = pos.filter((p) => String(p.status ?? "").toUpperCase() !== "CANCELLED");
  if (live.length === 0) return { kind: "none", dept: "", pct: 0 };
  if (live.every((p) => String(p.status ?? "").toUpperCase() === "COMPLETED")) return { kind: "done", dept: "", pct: 100 };
  let w = 0;
  let acc = 0;
  for (const p of live) {
    const q = Math.max(1, Number(p.quantity) || 1);
    const pct = String(p.status ?? "").toUpperCase() === "COMPLETED" ? 100 : Math.max(0, Math.min(100, Number(p.progress) || 0));
    w += q;
    acc += q * pct;
  }
  // never show 100 while any PO is unfinished
  const pct = Math.min(99, Math.round(acc / (w || 1)));
  const active = live.find((p) => String(p.status ?? "").toUpperCase() !== "COMPLETED" && p.currentDepartment);
  return { kind: "progress", dept: active?.currentDepartment ?? "", pct };
}

export function groupPosBySo(pos: PoLite[]): Map<string, PoLite[]> {
  const m = new Map<string, PoLite[]>();
  for (const p of pos) {
    const k = String(p.salesOrderId ?? "");
    if (!k) continue;
    const a = m.get(k);
    if (a) a.push(p);
    else m.set(k, [p]);
  }
  return m;
}
