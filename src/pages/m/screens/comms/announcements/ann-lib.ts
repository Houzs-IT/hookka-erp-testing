// ---------------------------------------------------------------------------
// Announcements (Batch 2 v3) — pure helpers. No React, no fetch: the screens
// pass in what /api/announcements, /:id/acks, /api/departments and /api/workers
// answered. Tested by tests/m-comms-announcements.test.mjs.
//
// Rules come from the desktop page (src/pages/announcements.tsx) and the API
// (src/api/routes/announcements.ts), never from the prototype's demo data:
//   • status: hidden (isActive false) > expired (expiresAt passed) > live
//   • list order: newest first (the API's ORDER BY created_at DESC, id DESC)
//   • a notice targets ALL / DEPTS / WORKERS / MIXED (empty lists = ALL)
//   • order notices carry priority URGENT | OVERDUE | PRIORITY and orderNo
// ---------------------------------------------------------------------------
import { kindOf, type FileKind } from "../comms-files";

export type AnnCategory = "GENERAL" | "WARNING" | "SOP" | "LEARNING";
export type AnnStatus = "live" | "expired" | "hidden";
export type AnnTarget = "ALL" | "DEPTS" | "WORKERS" | "MIXED";

export type AnnAttachment = { fileId: string; name: string; mime: string; kind: FileKind };

export type Ann = {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string | null;
  createdByName: string | null;
  category: AnnCategory;
  targetType: AnnTarget;
  targetDeptCodes: string[];
  targetWorkerIds: string[];
  attachments: AnnAttachment[];
  priority: "URGENT" | "OVERDUE" | "PRIORITY" | null;
  orderNo: string | null;
};

type Raw = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));
const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const CATS: AnnCategory[] = ["GENERAL", "WARNING", "SOP", "LEARNING"];
const TARGETS: AnnTarget[] = ["ALL", "DEPTS", "WORKERS", "MIXED"];
const PRIOS = ["URGENT", "OVERDUE", "PRIORITY"] as const;

/** One API row → Ann (read dual-keyed, unknowns defaulted the way the API does). */
export function normalizeAnn(r: Raw): Ann {
  const cat = s(r.category).toUpperCase() as AnnCategory;
  const tt = s(r.targetType ?? r.target_type).toUpperCase() as AnnTarget;
  const prio = s(r.priority).toUpperCase();
  const atts = Array.isArray(r.attachments) ? (r.attachments as Raw[]) : [];
  const depts = arr(r.targetDeptCodes ?? r.target_dept_codes);
  const workers = arr(r.targetWorkerIds ?? r.target_worker_ids);
  return {
    id: s(r.id),
    title: s(r.title),
    body: s(r.body ?? r.description ?? r.content),
    isActive: r.isActive === true || r.is_active === true || r.isActive === 1 || r.is_active === 1,
    expiresAt: s(r.expiresAt ?? r.expires_at) || null,
    createdAt: s(r.createdAt ?? r.created_at) || null,
    createdByName: s(r.createdByName ?? r.created_by_name) || null,
    category: CATS.includes(cat) ? cat : "GENERAL",
    targetType: TARGETS.includes(tt) ? tt : depts.length && workers.length ? "MIXED" : depts.length ? "DEPTS" : workers.length ? "WORKERS" : "ALL",
    targetDeptCodes: depts,
    targetWorkerIds: workers,
    attachments: atts
      .map((a) => ({ fileId: s(a.fileId ?? a.file_id), name: s(a.name) || "attachment", mime: s(a.mime) }))
      .filter((a) => a.fileId)
      .map((a) => ({ ...a, kind: kindOf(a.mime, a.name) })),
    priority: (PRIOS as readonly string[]).includes(prio) ? (prio as Ann["priority"]) : null,
    orderNo: s(r.orderNo ?? r.order_no) || null,
  };
}

/** The list endpoint's body → newest-first announcements. */
export function readAnnList(body: unknown): Ann[] {
  const rows = Array.isArray((body as { data?: unknown })?.data) ? ((body as { data: Raw[] }).data) : Array.isArray(body) ? (body as Raw[]) : [];
  return rows.map(normalizeAnn).sort(byNewest);
}

export function byNewest(a: Ann, b: Ann): number {
  const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
  const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
  return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Desktop rule: hidden first, then expired (expiresAt at or before now), else live. */
export function annStatus(a: Pick<Ann, "isActive" | "expiresAt">, now: number = Date.now()): AnnStatus {
  if (!a.isActive) return "hidden";
  if (a.expiresAt) {
    const t = Date.parse(a.expiresAt);
    if (!Number.isNaN(t) && t <= now) return "expired";
  }
  return "live";
}

export const STATUS_LABEL: Record<AnnStatus, string> = { live: "Live", expired: "Expired", hidden: "Hidden" };

export const CATEGORY_LABEL: Record<AnnCategory, string> = {
  GENERAL: "General Memo",
  WARNING: "Warning",
  SOP: "SOP",
  LEARNING: "Learning",
};

/** Order-notice chip: "Urgent · PO-2611-088" (+n when the notice names several orders). */
export function orderChip(a: Pick<Ann, "priority" | "orderNo">): string {
  if (!a.priority) return "";
  const label = a.priority === "URGENT" ? "Urgent" : a.priority === "OVERDUE" ? "Overdue" : "Priority";
  const orders = (a.orderNo ?? "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!orders.length) return label;
  return `${label} · ${orders[0]}${orders.length > 1 ? ` +${orders.length - 1}` : ""}`;
}

/**
 * "To" summary from the stored target — exact, no head-count guess:
 * "All workers" / "Wood Cutting, Framing" / "3 departments" / "2 people" /
 * "Packing · 2 people".
 */
export function recipientLabel(a: Pick<Ann, "targetType" | "targetDeptCodes" | "targetWorkerIds">, deptName: (code: string) => string): string {
  const d = a.targetDeptCodes;
  const w = a.targetWorkerIds.length;
  const people = `${w} ${w === 1 ? "person" : "people"}`;
  const depts = d.length === 0 ? "" : d.length <= 2 ? d.map(deptName).join(", ") : `${d.length} departments`;
  if (a.targetType === "ALL" || (!d.length && !w)) return "All workers";
  if (depts && w) return `${depts} · ${people}`;
  return depts || people;
}

/** Detail "Sent to": the summary plus the audience size the acks endpoint counted. */
export function sentToLine(label: string, total: number | null, targetType: AnnTarget): string {
  if (total == null || targetType === "WORKERS") return label;
  return `${label} · ${total}`;
}

export type ListFilter = { q: string; chip: "all" | "live"; cats: AnnCategory[] };

export function filterAnns(list: Ann[], f: ListFilter, now: number = Date.now()): Ann[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((a) => {
    if (f.chip === "live" && annStatus(a, now) !== "live") return false;
    if (f.cats.length && !f.cats.includes(a.category)) return false;
    if (q && !`${a.title} ${a.body} ${CATEGORY_LABEL[a.category]}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** "6 POSTED" / "2 OF 6 POSTED". */
export function countLabel(shown: number, total: number, filtering: boolean): string {
  return filtering ? `${shown} OF ${total} POSTED` : `${total} POSTED`;
}

// ---- read receipts (GET /api/announcements/:id/acks) --------------------------------
export type Receipts = {
  total: number;
  ackedCount: number;
  acked: { id: string; name: string; empNo: string; ackedAt: string | null }[];
  pending: { id: string; name: string; empNo: string }[];
};

export function readReceipts(body: unknown): Receipts | null {
  const d = (body as { data?: Raw })?.data;
  if (!d || typeof d !== "object") return null;
  const acked = Array.isArray(d.acked) ? (d.acked as Raw[]).map((w) => ({ id: s(w.id), name: s(w.name), empNo: s(w.empNo ?? w.emp_no), ackedAt: s(w.ackedAt ?? w.acked_at) || null })) : [];
  const pending = Array.isArray(d.pending) ? (d.pending as Raw[]).map((w) => ({ id: s(w.id), name: s(w.name), empNo: s(w.empNo ?? w.emp_no) })) : [];
  const total = Number(d.total);
  return { total: Number.isFinite(total) ? total : acked.length + pending.length, ackedCount: acked.length, acked, pending };
}

/** Percentage read (0 when nobody is in the audience) and its tone. */
export function readPct(r: Pick<Receipts, "total" | "ackedCount">): { pct: number; tone: "green" | "amber" | "red" } {
  const pct = r.total ? Math.round((r.ackedCount / r.total) * 100) : 0;
  return { pct, tone: pct >= 80 ? "green" : pct >= 50 ? "amber" : "red" };
}

// ---- composer --------------------------------------------------------------------------
export type Audience = "all" | "depts" | "people";

/** POST body exactly as the desktop composer sends it (empty lists = everyone). */
export function composeBody(f: {
  title: string;
  message: string;
  category: AnnCategory;
  audience: Audience;
  depts: string[];
  people: string[];
  hideOn: boolean;
  hideDate: string;
  hideTime: string;
  attachments: { fileId: string; name: string; mime: string }[];
}) {
  return {
    title: f.title.trim(),
    body: f.message.trim(),
    expiresAt: f.hideOn ? localToIso(f.hideDate, f.hideTime) : undefined,
    attachments: f.attachments,
    targetDeptCodes: f.audience === "depts" ? f.depts : [],
    targetWorkerIds: f.audience === "people" ? f.people : [],
    category: f.category,
  };
}

/** The phone's local date + time → an ISO instant ("" when either is missing or invalid). */
export function localToIso(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Composer checks, in the prototype's wording. Empty = ready to post. */
export function composerErrors(f: { title: string; audience: Audience; depts: string[]; people: string[]; hideOn: boolean; hideDate: string; hideTime: string; uploading: boolean; failed: boolean }): string[] {
  const e: string[] = [];
  if (!f.title.trim()) e.push("Add a title");
  if (f.audience === "depts" && !f.depts.length) e.push("pick a department");
  if (f.audience === "people" && !f.people.length) e.push("pick at least one person");
  if (f.hideOn && !localToIso(f.hideDate, f.hideTime)) e.push("set the date and time to hide it");
  if (f.uploading) e.push("wait for uploads");
  if (f.failed) e.push("retry or remove the failed file");
  return e;
}

/** ["Add a title", "pick a department"] → "Add a title, pick a department." */
export function errorSentence(errs: string[]): string {
  if (!errs.length) return "";
  const t = errs.join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}
