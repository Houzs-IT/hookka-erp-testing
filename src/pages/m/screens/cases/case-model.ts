// ===========================================================================
// Mobile Service Cases — shared model (types, labels, derived row fields).
//
// Business logic is NOT re-derived here: stage / ages come from
// src/lib/case-pipeline.ts (the desktop's single source) and the label sets
// mirror src/pages/service-cases/index.tsx + detail.tsx (kept local because
// importing a desktop page into /m would drag the whole page bundle along).
// ===========================================================================
import {
  CASE_PIPELINE_STEPS,
  caseDaysOpen,
  caseStageDays,
  computeCasePipeline,
} from "../../../../lib/case-pipeline";
import { formatDateDMY } from "../../../../lib/utils";
import type { CsvColumn } from "../../../../lib/export-csv";

export type CaseStatus = "OPEN" | "IN_PROGRESS" | "CLOSED" | "CANCELLED";
export type SourceType = "SO" | "CO" | "EXTERNAL";

export const CASE_STATUSES: CaseStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED", "CANCELLED"];

export const STATUS_LABEL: Record<CaseStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** Pill colours, straight from the Phase 4 prototype (STATUS map). */
export const STATUS_TONE: Record<CaseStatus, { bg: string; fg: string }> = {
  OPEN: { bg: "#F4EFE3", fg: "#6B5C32" },
  IN_PROGRESS: { bg: "#E0EAF4", fg: "#3A5670" },
  CLOSED: { bg: "#E2DDD8", fg: "#5A5550" },
  CANCELLED: { bg: "#F5DCDC", fg: "#7A2E24" },
};

export const ROOT_CAUSE_LABELS: Record<string, string> = {
  PRODUCTION: "Production / workmanship",
  DESIGN: "Design / R&D",
  MATERIAL: "Material / supplier",
  PROCESS: "Process / SOP gap",
  CUSTOMER: "Customer (not our fault)",
  TRANSPORT: "Transport / 3PL",
  SALES: "Sales / order-taking error",
  PICKING: "Picking / packing error",
  OTHER: "Other",
};
export const ROOT_CAUSE_KEYS = Object.keys(ROOT_CAUSE_LABELS);
/** Short names used on chips / tags (prototype CATS labels). */
export const ROOT_CAUSE_SHORT: Record<string, string> = {
  PRODUCTION: "Production", DESIGN: "Design", MATERIAL: "Material", PROCESS: "Process", CUSTOMER: "Customer",
  TRANSPORT: "Transport", SALES: "Sales", PICKING: "Picking", OTHER: "Other",
};

/** Stage chip tint by label (prototype STAGE map == desktop STAGE_COLOR). */
export const STAGE_TONE: Record<string, { bg: string; fg: string }> = {
  Opened: { bg: "#F4EFE3", fg: "#6B5C32" },
  Investigating: { bg: "#E8D8B2", fg: "#6B5C32" },
  "Service Order": { bg: "#E0EAF4", fg: "#3A5670" },
  "Repair in progress": { bg: "#E0EAF4", fg: "#3A5670" },
  "Repair done": { bg: "#E0EAF4", fg: "#3A5670" },
  "Delivery arranged": { bg: "#DCEBDC", fg: "#3A6B3A" },
  Delivered: { bg: "#DCEBDC", fg: "#3A6B3A" },
  Closed: { bg: "#E2DDD8", fg: "#5A5550" },
  Cancelled: { bg: "#F5DCDC", fg: "#7A2E24" },
};

export const CATEGORY_TONE: Record<string, { bg: string; fg: string }> = {
  PRODUCTION: { bg: "#F4EFE3", fg: "#6B5C32" },
  DESIGN: { bg: "#E0EAF4", fg: "#3A5670" },
  MATERIAL: { bg: "#E8D8B2", fg: "#6B5C32" },
  PROCESS: { bg: "#E2DDD8", fg: "#5A5550" },
  CUSTOMER: { bg: "#F5DCDC", fg: "#7A2E24" },
  TRANSPORT: { bg: "#FAF7F0", fg: "#6B5C32" },
  OTHER: { bg: "#F0ECE9", fg: "#5A5550" },
};
export const DEFAULT_TONE = { bg: "#F0ECE9", fg: "#5A5550" };

/** Active-case ages go red at this many days (desktop list rule). */
export const AGED_DAYS = 7;
/** The list endpoint is capped server-side (ORDER BY created_at DESC LIMIT 500). */
export const LIST_CAP = 500;

export type CaseOrder = {
  id: string;
  serviceOrderNo: string;
  status: string;
  mode: string | null;
  isSv?: boolean;
  createdAt?: string;
};

export type RootCause = { category: string; details?: Record<string, unknown> };

export type CaseProduct = {
  productId: string;
  code: string;
  name: string;
  qty?: number | null;
  components?: Array<{ key: string; label: string; qty: number }>;
};

export type ActionLogEntry = {
  id?: string;
  date: string;
  description: string;
  createdAt?: string;
  createdByName?: string;
};

/** Case as returned by GET /api/service-cases (list) and /:id (detail). */
export type ServiceCaseApi = {
  id: string;
  caseNo: string;
  sourceType: SourceType;
  sourceId?: string | null;
  sourceNo: string;
  customerId?: string | null;
  customerName: string;
  customerState?: string | null;
  status: CaseStatus;
  preCancelStatus?: string | null;
  createdAt: string;
  closedAt: string;
  investigatingAt?: string | null;
  createdByName?: string | null;
  rootCauseCategory: string | null;
  rootCauses?: RootCause[];
  rootCauseDetails?: Record<string, unknown> | null;
  responsibleUnit: string | null;
  issueDescription: string;
  issuePhotos?: string[];
  actionLog?: ActionLogEntry[];
  preventionAction?: string | null;
  preventionOwner?: string | null;
  preventionStatus?: string | null;
  notes?: string | null;
  affectedProducts: CaseProduct[];
  orders: CaseOrder[];
  coveredProductIds?: string[];
  externalRef?: string;
  customerPO?: string;
};

export type DeliveryOrderApi = {
  id: string;
  salesOrderId?: string | null;
  status?: string;
  createdAt?: string | null;
  dispatchedAt?: string | null;
  deliveredAt?: string | null;
};
export type ProductionOrderApi = {
  id: string;
  salesOrderId?: string | null;
  jobCards?: Array<{ completedDate?: string | null }>;
};

export type CaseRow = ServiceCaseApi & {
  source: string;
  categoryCodes: string[];
  categoriesText: string;
  department: string;
  stageLabel: string;
  stageIndex: number;
  /** null = CANCELLED (no meaningful age). */
  daysOpen: number | null;
  stageDays: number;
  ordersCount: number;
  /** pipeline doneFlags (length 8). */
  doneFlags: boolean[];
  enteredAt: string | null;
  cancelled: boolean;
};

export function deptForCase(details: Record<string, unknown> | null | undefined): string {
  if (!details || typeof details !== "object") return "";
  for (const key of ["departmentName", "designDeptName"]) {
    const v = details[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function categoryCodesForCase(c: Pick<ServiceCaseApi, "rootCauses" | "rootCauseCategory">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (code: string | null | undefined) => {
    if (!code || !(code in ROOT_CAUSE_LABELS) || seen.has(code)) return;
    seen.add(code);
    out.push(code);
  };
  if (Array.isArray(c.rootCauses) && c.rootCauses.length > 0) {
    for (const rc of c.rootCauses) push(rc?.category);
  } else {
    push(c.rootCauseCategory);
  }
  return out;
}

export const categoriesLabel = (codes: string[]) => codes.map((k) => ROOT_CAUSE_LABELS[k] ?? k).join(", ");

export function sourceLabel(c: Pick<ServiceCaseApi, "sourceNo" | "sourceType" | "externalRef">): string {
  return (
    c.sourceNo ||
    (c.sourceType === "EXTERNAL" ? `EXTERNAL${c.externalRef ? ` (${c.externalRef})` : ""}` : c.sourceType)
  );
}

/** Run the desktop pipeline for ONE case. Pure; `now` is passed in. */
export function pipelineFor(
  c: ServiceCaseApi,
  dosBySo: Map<string, DeliveryOrderApi[]>,
  posBySo: Map<string, ProductionOrderApi[]>,
  now: number,
) {
  const svOrderIds = c.orders.filter((o) => o.isSv).map((o) => o.id);
  const pipe = computeCasePipeline({
    caseStatus: c.status,
    createdAt: c.createdAt,
    investigatingAt: c.investigatingAt ?? null,
    closedAt: c.closedAt || null,
    orders: c.orders.map((o) => ({ isSv: o.isSv, status: o.status, createdAt: o.createdAt })),
    dos: svOrderIds.flatMap((so) => dosBySo.get(so) ?? []),
    pos: svOrderIds.flatMap((so) => posBySo.get(so) ?? []),
    svOrderIds,
  });
  const frozenClose = c.status === "CLOSED" || c.status === "CANCELLED" ? c.closedAt || null : null;
  return {
    pipe,
    daysOpen: c.status === "CANCELLED" ? null : caseDaysOpen(c.createdAt, frozenClose, now),
    stageDays: caseStageDays(pipe.enteredAt, frozenClose, now),
  };
}

export function toRow(
  c: ServiceCaseApi,
  dosBySo: Map<string, DeliveryOrderApi[]>,
  posBySo: Map<string, ProductionOrderApi[]>,
  now: number,
): CaseRow {
  const { pipe, daysOpen, stageDays } = pipelineFor(c, dosBySo, posBySo, now);
  const categoryCodes = categoryCodesForCase(c);
  return {
    ...c,
    source: sourceLabel(c),
    categoryCodes,
    categoriesText: categoriesLabel(categoryCodes),
    department: deptForCase(c.rootCauseDetails),
    stageLabel: pipe.cancelled ? "Cancelled" : pipe.label,
    stageIndex: pipe.index,
    daysOpen,
    stageDays,
    ordersCount: c.orders.length,
    doneFlags: pipe.doneFlags,
    enteredAt: pipe.enteredAt,
    cancelled: pipe.cancelled,
  };
}

export function indexBy<T extends { salesOrderId?: string | null }>(list: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const d of list) {
    if (!d.salesOrderId) continue;
    const arr = m.get(d.salesOrderId);
    if (arr) arr.push(d);
    else m.set(d.salesOrderId, [d]);
  }
  return m;
}

// ---- display labels (identical formulas to the desktop list / CSV) ----------
export function daysOpenLabel(r: Pick<CaseRow, "status" | "daysOpen">): string {
  if (r.status === "CANCELLED" || r.daysOpen == null) return "—";
  if (r.status !== "CLOSED" && r.daysOpen < 1) return "today";
  return `${r.daysOpen}d`;
}
export function stageDaysLabel(r: Pick<CaseRow, "status" | "stageDays">): string {
  return r.status === "CANCELLED" ? "—" : `${r.stageDays}d`;
}
export function ordersLabel(r: Pick<CaseRow, "orders">): string {
  const nos = (r.orders ?? []).map((o) => o.serviceOrderNo).filter(Boolean);
  return nos.length === 0 ? "none" : nos.join(", ");
}
export const isAged = (r: Pick<CaseRow, "status" | "daysOpen">) =>
  (r.status === "OPEN" || r.status === "IN_PROGRESS") && (r.daysOpen ?? 0) >= AGED_DAYS;
export const isStageAged = (r: Pick<CaseRow, "status" | "stageDays">) =>
  (r.status === "OPEN" || r.status === "IN_PROGRESS") && r.stageDays >= AGED_DAYS;

/** The desktop's 11 CSV columns, one-for-one (index.tsx handleExportCsv). */
export const CASE_CSV_COLUMNS: CsvColumn<CaseRow>[] = [
  { header: "Case No", accessor: (r) => r.caseNo },
  { header: "Customer", accessor: (r) => r.customerName },
  { header: "Source", accessor: (r) => r.source },
  { header: "Customer PO", accessor: (r) => r.customerPO ?? "" },
  { header: "Category", accessor: (r) => r.categoriesText },
  { header: "Department", accessor: (r) => r.department },
  { header: "Stage", accessor: (r) => r.stageLabel },
  { header: "Days Open", accessor: (r) => r.daysOpen ?? "" },
  { header: "Status Days", accessor: (r) => (r.status === "CANCELLED" ? "" : r.stageDays) },
  { header: "Orders", accessor: (r) => ordersLabel(r) },
  { header: "Created", accessor: (r) => formatDateDMY(r.createdAt) },
];

export { CASE_PIPELINE_STEPS };

// ---- status transitions (server SC:63-71; client copy only gates buttons) ---
export const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  OPEN: ["IN_PROGRESS", "CLOSED", "CANCELLED"],
  IN_PROGRESS: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: ["OPEN", "IN_PROGRESS"],
};

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export function fmtDayYear(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "In Progress" style label for order statuses (prototype tc()). */
export const tc = (s: string) =>
  (s || "")
    .split("_")
    .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
