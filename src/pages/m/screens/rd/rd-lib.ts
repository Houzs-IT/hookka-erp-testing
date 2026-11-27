// ===========================================================================
// R&D Projects (Final Batch 5, Claude Design "R&D Projects") — data layer.
// Pure: no React. Unit-tested by tests/m-rd-projects.test.mjs.
//
// Reads (existing endpoints only; nothing new on the API):
//   list         GET /api/rd-projects                       (ungated; labourCost is ZERO here)
//   detail       GET /api/rd-projects/:id                    (ungated; real labourCost summary)
//   issuances    GET /api/rd-projects/:id/issuances          (READ-ONLY on mobile)
//   labour       GET /api/rd-projects/:id/labour-hours
//   team         GET /api/rd-team-members?active=true        (rd-projects:read)
//   files        GET /api/files?resourceType=RD_PROJECT&resourceId=
//   history      GET /api/audit-events?resource=rd-projects&resourceId=  (rd-projects:read)
// Writes:
//   create       POST /api/rd-projects                       (rd-projects:create)
//   lifecycle    POST /api/rd-projects/:id/{start,hold,resume,move-to-draft,complete,reopen} (rd-projects:update)
//   advance / milestone / prototype   PUT /api/rd-projects/:id (rd-projects:update)
//   hours        POST /api/rd-projects/:id/labour-hours      (rd-projects:create — not update)
//   files        POST /api/files multipart                   (files:create; RD_PROJECT is not a flow type)
// Never: material issue / remove, labour delete, manual labour cost, project
// edit / delete, cover upload — those stay on desktop.
//
// Money is integer sen. "Today" is the Malaysia day (todayYmdMY).
// ===========================================================================
import { invalidateCachePrefix } from "../../../../lib/cached-fetch";
import { parseMoneyToSen } from "../../../../lib/parse-money";
import { getMilestoneHealth, getProjectHealth } from "../../../rd/health";
import type { RDProject } from "../../../../types";

export type RawRow = Record<string, unknown>;
export type Envelope = { success?: boolean; data?: unknown; error?: string; total?: number };

// ---- enums (API codes) -------------------------------------------------------------------
export const STAGES = ["CONCEPT", "DESIGN", "PROTOTYPE", "TESTING", "APPROVED", "PRODUCTION_READY"] as const;
export type Stage = (typeof STAGES)[number];
export type Status = "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type PType = "DEVELOPMENT" | "IMPROVEMENT" | "CLONE";
export type Category = "SOFA" | "BEDFRAME" | "ACCESSORY";
export type ProtoType = "FABRIC_SEWING" | "FRAMING";
export type Tone = "ok" | "warn" | "bad" | "neu" | "info" | "br";

export const STATUS_LABEL: Record<Status, string> = {
  DRAFT: "Draft", ACTIVE: "Active", ON_HOLD: "On Hold", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
/** Owner decision (prototype §13-9): Draft neutral, Active info, On Hold warning, Completed ok, Cancelled bad. */
export const STATUS_TONE: Record<Status, Tone> = { DRAFT: "neu", ACTIVE: "info", ON_HOLD: "warn", COMPLETED: "ok", CANCELLED: "bad" };
/** DEVELOPMENT is shown as "Research" (desktop wording). */
export const TYPE_LABEL: Record<PType, string> = { DEVELOPMENT: "Research", IMPROVEMENT: "Improvement", CLONE: "Clone" };
export const CATEGORY_LABEL: Record<Category, string> = { SOFA: "Sofa", BEDFRAME: "Bedframe", ACCESSORY: "Accessory" };
export const PROTO_LABEL: Record<ProtoType, string> = { FABRIC_SEWING: "Fabric Sewing", FRAMING: "Framing" };

const BASE_STAGE_LABEL: Record<Stage, string> = {
  CONCEPT: "Concept", DESIGN: "Design", PROTOTYPE: "Prototype", TESTING: "Testing", APPROVED: "Approved", PRODUCTION_READY: "Production Ready",
};
/** Same as desktop getStageLabels (src/pages/rd/index.tsx + detail.tsx): only the labels change per type, never the codes. */
export function stageLabels(t: PType): Record<Stage, string> {
  if (t === "IMPROVEMENT") return { ...BASE_STAGE_LABEL, CONCEPT: "Issue Analysis", DESIGN: "Fix Design" };
  if (t === "CLONE") return { ...BASE_STAGE_LABEL, CONCEPT: "Source Analysis" };
  return BASE_STAGE_LABEL;
}
export const defaultStageLabel = (s: Stage) => BASE_STAGE_LABEL[s];
/** Desktop STAGE_COLORS (src/pages/rd/index.tsx) — the ERP's own stage palette, readable on both themes. */
export const STAGE_COLOR: Record<Stage, string> = {
  CONCEPT: "#6366F1", DESIGN: "#3B82F6", PROTOTYPE: "#F59E0B", TESTING: "#F97316", APPROVED: "#10B981", PRODUCTION_READY: "#06B6D4",
};
export const stageIndex = (s: Stage) => STAGES.indexOf(s);

// ---- row shapes ----------------------------------------------------------------------------
export type Milestone = { stage: Stage; targetDate: string; actualDate: string; approvedBy: string; photos: string[]; raw: RawRow };
export type Prototype = {
  id: string; prototypeType: ProtoType; version: string; description: string; materialsCost: number; labourHours: number;
  testResults: string; feedback: string; improvements: string; defects: string; createdDate: string; raw: RawRow;
};
export type LabourCost = {
  laborCostSen: number; partTimeFixedCostSen: number; manualLabourCostSen: number | null; effectiveLabourCostSen: number;
  isManualLabourCost: boolean; totalLabourHours: number;
};
export type Project = {
  id: string; code: string; name: string; description: string; projectType: PType; productCategory: Category; serviceId: string;
  currentStage: Stage; targetLaunchDate: string; assignedTeam: string[]; milestones: Milestone[]; totalBudget: number; actualCost: number;
  prototypes: Prototype[]; sourceProductName: string; sourceBrand: string; sourcePurchaseRef: string; sourcePriceSen: number;
  sourceNotes: string; coverPhotoUrl: string; createdDate: string; status: Status; startedAt: string; labourCost: LabourCost;
};
export type Issuance = {
  id: string; materialCode: string; materialName: string; qty: number; unit: string; unitCostSen: number; totalCostSen: number;
  issuedAt: string; issuedBy: string; notes: string;
};
export type LabourRow = { id: string; memberName: string; employmentType: "FULL_TIME" | "PART_TIME"; workDate: string; hours: number; notes: string; autoCostSen: number };
export type TeamMember = { id: string; name: string; employmentType: "FULL_TIME" | "PART_TIME"; active: boolean };
export type FileRow = { id: string; filename: string; contentType: string; sizeBytes: number; uploadedAt: string };
export type AuditEvent = { id: string; actorUserName: string; actorRole: string; action: string; before: unknown; after: unknown; ts: string };

// ---- dual-key readers -----------------------------------------------------------------------
const str = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null && v !== "") return String(v);
  }
  return "";
};
const num = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null && v !== "" && isFinite(Number(v))) return Number(v);
  }
  return 0;
};
const numOrNull = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null && v !== "" && isFinite(Number(v))) return Number(v);
  }
  return null;
};
const rowsOf = (v: unknown): RawRow[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as RawRow[]) : []);
const oneOf = <T extends string>(v: string, all: readonly T[], dflt: T): T => ((all as readonly string[]).includes(v) ? (v as T) : dflt);

const STATUSES: Status[] = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];
const TYPES: PType[] = ["DEVELOPMENT", "IMPROVEMENT", "CLONE"];
const CATS: Category[] = ["SOFA", "BEDFRAME", "ACCESSORY"];

export function toMilestone(r: RawRow, i: number): Milestone {
  return {
    stage: oneOf(str(r, "stage"), STAGES, STAGES[Math.min(i, 5)]),
    targetDate: str(r, "targetDate", "target_date").slice(0, 10),
    actualDate: str(r, "actualDate", "actual_date").slice(0, 10),
    approvedBy: str(r, "approvedBy", "approved_by"),
    photos: Array.isArray(r.photos) ? (r.photos as unknown[]).filter((p): p is string => typeof p === "string" && !!p) : [],
    raw: r,
  };
}
export function toPrototype(r: RawRow): Prototype {
  return {
    id: str(r, "id"),
    prototypeType: oneOf(str(r, "prototypeType", "prototype_type"), ["FABRIC_SEWING", "FRAMING"] as const, "FABRIC_SEWING"),
    version: str(r, "version"),
    description: str(r, "description"),
    materialsCost: num(r, "materialsCost", "materials_cost"),
    labourHours: num(r, "labourHours", "labour_hours"),
    testResults: str(r, "testResults", "test_results"),
    feedback: str(r, "feedback"),
    improvements: str(r, "improvements"),
    defects: str(r, "defects"),
    createdDate: str(r, "createdDate", "created_date").slice(0, 10),
    raw: r,
  };
}
function toLabourCost(v: unknown): LabourCost {
  const r = (v && typeof v === "object" ? v : {}) as RawRow;
  return {
    laborCostSen: num(r, "laborCostSen"),
    partTimeFixedCostSen: num(r, "partTimeFixedCostSen"),
    manualLabourCostSen: numOrNull(r, "manualLabourCostSen"),
    effectiveLabourCostSen: num(r, "effectiveLabourCostSen"),
    isManualLabourCost: r.isManualLabourCost === true,
    totalLabourHours: num(r, "totalLabourHours"),
  };
}
export function toProject(r: RawRow): Project {
  const team = r.assignedTeam ?? r.assigned_team;
  return {
    id: str(r, "id"),
    code: str(r, "code"),
    name: str(r, "name"),
    description: str(r, "description"),
    projectType: oneOf(str(r, "projectType", "project_type"), TYPES, "DEVELOPMENT"),
    productCategory: oneOf(str(r, "productCategory", "product_category"), CATS, "BEDFRAME"),
    serviceId: str(r, "serviceId", "service_id"),
    currentStage: oneOf(str(r, "currentStage", "current_stage"), STAGES, "CONCEPT"),
    targetLaunchDate: str(r, "targetLaunchDate", "target_launch_date").slice(0, 10),
    assignedTeam: Array.isArray(team) ? (team as unknown[]).map(String).filter(Boolean) : [],
    milestones: rowsOf(r.milestones).map(toMilestone),
    totalBudget: num(r, "totalBudget", "total_budget"),
    actualCost: num(r, "actualCost", "actual_cost"),
    prototypes: rowsOf(r.prototypes).map(toPrototype),
    sourceProductName: str(r, "sourceProductName", "source_product_name"),
    sourceBrand: str(r, "sourceBrand", "source_brand"),
    sourcePurchaseRef: str(r, "sourcePurchaseRef", "source_purchase_ref"),
    sourcePriceSen: num(r, "sourcePriceSen", "source_price_sen"),
    sourceNotes: str(r, "sourceNotes", "source_notes"),
    coverPhotoUrl: str(r, "coverPhotoUrl", "cover_photo_url"),
    createdDate: str(r, "createdDate", "created_date"),
    status: oneOf(str(r, "status"), STATUSES, "DRAFT"),
    startedAt: str(r, "startedAt", "started_at"),
    labourCost: toLabourCost(r.labourCost ?? r.labour_cost),
  };
}
export function toIssuance(r: RawRow): Issuance {
  return {
    id: str(r, "id"),
    materialCode: str(r, "materialCode", "material_code"),
    materialName: str(r, "materialName", "material_name"),
    qty: num(r, "qty"),
    unit: str(r, "unit"),
    unitCostSen: num(r, "unitCostSen", "unit_cost_sen"),
    totalCostSen: num(r, "totalCostSen", "total_cost_sen"),
    issuedAt: str(r, "issuedAt", "issued_at").slice(0, 10),
    issuedBy: str(r, "issuedBy", "issued_by"),
    notes: str(r, "notes"),
  };
}
export function toLabour(r: RawRow): LabourRow {
  return {
    id: str(r, "id"),
    memberName: str(r, "memberName", "member_name"),
    employmentType: str(r, "employmentType", "employment_type") === "PART_TIME" ? "PART_TIME" : "FULL_TIME",
    workDate: str(r, "workDate", "work_date").slice(0, 10),
    hours: num(r, "hours"),
    notes: str(r, "notes"),
    autoCostSen: num(r, "autoCostSen", "auto_cost_sen"),
  };
}
export function toMember(r: RawRow): TeamMember {
  return {
    id: str(r, "id"),
    name: str(r, "name"),
    employmentType: str(r, "employmentType", "employment_type") === "PART_TIME" ? "PART_TIME" : "FULL_TIME",
    active: r.active !== false,
  };
}
export function toFile(r: RawRow): FileRow {
  return {
    id: str(r, "id"),
    filename: str(r, "filename", "fileName", "file_name") || "File",
    contentType: str(r, "contentType", "content_type"),
    sizeBytes: num(r, "sizeBytes", "size_bytes"),
    uploadedAt: str(r, "uploadedAt", "uploaded_at"),
  };
}
export function toAudit(r: RawRow): AuditEvent {
  return {
    id: str(r, "id"),
    actorUserName: str(r, "actorUserName", "actor_user_name"),
    actorRole: str(r, "actorRole", "actor_role"),
    action: str(r, "action"),
    before: r.before ?? null,
    after: r.after ?? null,
    ts: str(r, "ts"),
  };
}
export const listOf = <T,>(env: Envelope | null | undefined, map: (r: RawRow) => T): T[] => rowsOf(env?.data).map(map);
export const oneOfEnv = (env: Envelope | null | undefined): RawRow | null =>
  env?.data && typeof env.data === "object" && !Array.isArray(env.data) ? (env.data as RawRow) : null;

// ---- health (src/pages/rd/health.ts — imported, never re-implemented) ----------------------
/** health.ts reads the RDProject shape; pass only the fields it uses. */
function asRd(p: Project): RDProject {
  return { status: p.status, targetLaunchDate: p.targetLaunchDate, currentStage: p.currentStage, totalBudget: p.totalBudget, actualCost: p.actualCost } as unknown as RDProject;
}
export const projectHealth = (p: Project, today: string) => getProjectHealth(asRd(p), today);

export type Chip = { l: string; t: Tone };
/** Card / detail chips: desktop hides the on-track and ok readings (no green schedule / budget chip on cards). */
export function healthChips(p: Project, today: string): Chip[] {
  const h = projectHealth(p, today);
  const out: Chip[] = [];
  if (h.schedule === "overdue") out.push({ l: "Overdue", t: "bad" });
  else if (h.schedule === "at-risk") out.push({ l: "At Risk", t: "warn" });
  if (h.budget === "over-budget") out.push({ l: "Over Budget", t: "bad" });
  else if (h.budget === "near-budget") out.push({ l: "Near Budget", t: "warn" });
  return out;
}
export const scheduleChip = (p: Project, today: string): Chip | null => healthChips(p, today).find((c) => c.l === "Overdue" || c.l === "At Risk") ?? null;

/** Milestone chip per getMilestoneHealth. Blank target and not done → no chip ("Not set"). */
export function milestoneChip(m: Milestone, today: string): Chip | null {
  const h = getMilestoneHealth(m, today);
  if (!h.state) return null;
  const d = h.daysToTarget;
  if (h.state === "done") {
    if (d == null) return { l: "Done", t: "ok" };
    return d < 0 ? { l: "Done early", t: "ok" } : d === 0 ? { l: "Done on time", t: "ok" } : { l: "Done late", t: "warn" };
  }
  if (h.state === "overdue") return { l: "Overdue", t: "bad" };
  if (h.state === "due-soon") return d === 0 ? { l: "Due today", t: "warn" } : { l: "Due soon", t: "warn" };
  return { l: `${dayCount(d ?? 0)} remaining`, t: "neu" };
}
export const dayCount = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** Budget used % (0 when there is no budget) — from the server's actualCost (material issuances). */
export const budgetPct = (p: Project) => (p.totalBudget > 0 ? (p.actualCost / p.totalBudget) * 100 : 0);
/** Card bar colour: >90 red, >70 amber, else green (desktop card thresholds; the chips use 80 / 100). */
export const barTone = (pct: number): Tone => (pct > 90 ? "bad" : pct > 70 ? "warn" : "ok");

// ---- tabs, filters, sort ----------------------------------------------------------------------
export type Tab = "summary" | "drafts" | "projects" | "completed" | "pipeline" | "reports";
export const TABS: { k: Tab; l: string }[] = [
  { k: "summary", l: "Summary" },
  { k: "drafts", l: "Drafts" },
  { k: "projects", l: "Projects" },
  { k: "completed", l: "Completed" },
  { k: "pipeline", l: "Pipeline" },
  { k: "reports", l: "Reports" },
];
export const isTab = (v: string | null): v is Tab => !!v && TABS.some((t) => t.k === v);
/** Summary + Pipeline: Active and On Hold only (Cancelled excluded — owner decision). */
export const livePool = (all: Project[]) => all.filter((p) => p.status === "ACTIVE" || p.status === "ON_HOLD");
/** Reports: every non-draft project (desktop index.tsx Reports set). */
export const reportPool = (all: Project[]) => all.filter((p) => p.status !== "DRAFT");
export function tabPool(all: Project[], tab: Tab): Project[] {
  if (tab === "drafts") return all.filter((p) => p.status === "DRAFT");
  if (tab === "completed") return all.filter((p) => p.status === "COMPLETED");
  if (tab === "pipeline" || tab === "summary") return livePool(all);
  if (tab === "reports") return reportPool(all);
  return all.filter((p) => p.status === "ACTIVE" || p.status === "ON_HOLD" || p.status === "CANCELLED");
}

export type Sort = "target" | "code" | "budget";
export const SORT_LABEL: Record<Sort, string> = { target: "Target date", code: "Code", budget: "Budget used" };
export type TypeFilter = "all" | PType;
export type CatFilter = "all" | Category;

export function searchText(p: Project): string {
  return `${p.code} ${p.name} ${TYPE_LABEL[p.projectType]} ${p.projectType} ${CATEGORY_LABEL[p.productCategory]}`.toLowerCase();
}
/** Search + type filter (category chips count AFTER these, as the prototype does). */
export function baseFilter(pool: Project[], q: string, type: TypeFilter): Project[] {
  const qn = q.trim().toLowerCase();
  return pool.filter((p) => (type === "all" || p.projectType === type) && (!qn || searchText(p).includes(qn)));
}
export function sortProjects(list: Project[], sort: Sort): Project[] {
  return [...list].sort((a, b) => {
    if (sort === "code") return a.code.localeCompare(b.code);
    if (sort === "budget") return budgetPct(b) - budgetPct(a) || a.code.localeCompare(b.code);
    // Target date — soonest; a blank target sorts last.
    if (!a.targetLaunchDate !== !b.targetLaunchDate) return a.targetLaunchDate ? -1 : 1;
    return a.targetLaunchDate.localeCompare(b.targetLaunchDate) || a.code.localeCompare(b.code);
  });
}
export const catCount = (base: Project[], c: CatFilter) => (c === "all" ? base.length : base.filter((p) => p.productCategory === c).length);

// ---- Summary ----------------------------------------------------------------------------------
export type Attention = { p: Project; chips: Chip[] };
export type OverdueMilestone = { p: Project; m: Milestone; days: number };
export function summary(all: Project[], today: string) {
  const live = livePool(all);
  const hs = live.map((p) => ({ p, h: projectHealth(p, today) }));
  const overdue = hs.filter((x) => x.h.schedule === "overdue").length;
  const atRisk = hs.filter((x) => x.h.schedule === "at-risk").length;
  const overBudget = hs.filter((x) => x.h.budget === "over-budget").length;
  const tb = live.reduce((a, p) => a + p.totalBudget, 0);
  const ta = live.reduce((a, p) => a + p.actualCost, 0);
  const utilization = tb > 0 ? Math.round((ta / tb) * 1000) / 10 : 0;
  // Desktop order: most overdue first → over-budget % desc → at-risk fewest days → near-budget.
  const rank = (x: (typeof hs)[number]) =>
    x.h.schedule === "overdue" ? 0 : x.h.budget === "over-budget" ? 1 : x.h.schedule === "at-risk" ? 2 : 3;
  const attention: Attention[] = hs
    .filter((x) => x.h.schedule === "overdue" || x.h.schedule === "at-risk" || x.h.budget !== "ok")
    .sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r) return r;
      if (rank(a) === 0 || rank(a) === 2) return (a.h.daysToTarget ?? 0) - (b.h.daysToTarget ?? 0);
      return b.h.budgetPct - a.h.budgetPct;
    })
    .map((x) => ({ p: x.p, chips: healthChips(x.p, today) }));
  const ms: OverdueMilestone[] = [];
  for (const p of live) {
    for (const m of p.milestones) {
      const h = getMilestoneHealth(m, today); // blank target → state null → skipped
      if (h.state === "overdue") ms.push({ p, m, days: -(h.daysToTarget ?? 0) });
    }
  }
  ms.sort((a, b) => b.days - a.days);
  return { overdue, atRisk, overBudget, utilization, attention, overdueMilestones: ms };
}

// ---- Reports (non-draft scope, desktop) --------------------------------------------------------
export function reports(all: Project[]) {
  const pool = reportPool(all);
  const byStage = STAGES.map((s) => ({ s, n: pool.filter((p) => p.currentStage === s).length }));
  const byCategory = CATS.map((c) => ({ c, n: pool.filter((p) => p.productCategory === c).length }));
  return {
    pool,
    total: pool.length,
    active: pool.filter((p) => p.status === "ACTIVE").length,
    totalBudget: pool.reduce((a, p) => a + p.totalBudget, 0),
    /** Desktop "Total R&D Spend" = Σ actualCost (material issuances). List rows carry no labour. */
    spend: pool.reduce((a, p) => a + p.actualCost, 0),
    byStage,
    byCategory,
  };
}

// ---- detail: cost breakdown --------------------------------------------------------------------
export function costBreakdown(p: Project, issuances: Issuance[] | null) {
  const material = issuances ? issuances.reduce((a, x) => a + x.totalCostSen, 0) : p.actualCost;
  const labour = p.labourCost.effectiveLabourCostSen;
  const pt = p.labourCost.partTimeFixedCostSen;
  const pct = budgetPct(p);
  return {
    budget: p.totalBudget,
    actual: p.actualCost,
    remaining: p.totalBudget - p.actualCost,
    over: p.actualCost > p.totalBudget,
    pct,
    material,
    labour,
    manual: p.labourCost.isManualLabourCost,
    pt,
    total: material + labour + pt,
  };
}

/** The cover thumbnail: cover photo, else the first milestone photo (desktop rule), else none. */
export function thumbOf(p: Project): string {
  if (p.coverPhotoUrl) return p.coverPhotoUrl;
  for (const m of p.milestones) if (m.photos.length) return m.photos[0];
  return "";
}
/** Six milestones keyed by stage, in stage order, even if the row is short. */
export function milestonesByStage(p: Project): Milestone[] {
  return STAGES.map(
    (s) => p.milestones.find((m) => m.stage === s) ?? { stage: s, targetDate: "", actualDate: "", approvedBy: "", photos: [], raw: { stage: s, targetDate: "", actualDate: null, approvedBy: null } },
  );
}

// ---- lifecycle -------------------------------------------------------------------------------
export type Lifecycle = "start" | "advance" | "complete" | "hold" | "resume" | "move-to-draft" | "reopen";
/** The dock's primary action for a status (Cancelled: none). */
export function dockAction(p: Project): Lifecycle | null {
  if (p.status === "DRAFT") return "start";
  if (p.status === "ACTIVE") return p.currentStage === "PRODUCTION_READY" ? "complete" : "advance";
  if (p.status === "ON_HOLD") return "resume";
  if (p.status === "COMPLETED") return "reopen";
  return null;
}
export function moreActions(p: Project): Lifecycle[] {
  if (p.status === "ACTIVE") return ["hold", "move-to-draft"];
  if (p.status === "ON_HOLD") return ["move-to-draft"];
  return [];
}
export function nextStage(s: Stage): Stage | null {
  const i = stageIndex(s);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}
/** Client rule for Advance (the server PUT accepts any stage): ACTIVE and below Production Ready. */
export const canAdvance = (p: Pick<Project, "status" | "currentStage">) => p.status === "ACTIVE" && nextStage(p.currentStage) !== null;

/** Lifecycle confirm copy — follows what the server actually does (no milestone stamps on Complete, Hold still evaluates the schedule). */
export function lifecycleCopy(p: Project, k: Lifecycle): { title: string; body: string; okL: string; danger: boolean; done: string } {
  const L = stageLabels(p.projectType);
  const nx = nextStage(p.currentStage);
  switch (k) {
    case "start":
      return { title: "Start this project?", body: `It moves to Projects as Active at its current stage (${L[p.currentStage]}).`, okL: "Start project", danger: false, done: "Project started" };
    case "advance":
      return { title: `Move to ${nx ? L[nx] : "the next stage"}?`, body: `${L[p.currentStage]} is marked done today. Projects move forward one stage at a time.`, okL: "Advance stage", danger: false, done: `Moved to ${nx ? L[nx] : "the next stage"}` };
    case "complete":
      return { title: "Complete this project?", body: "It moves to Completed.", okL: "Complete", danger: false, done: "Project completed" };
    case "hold":
      return { title: "Put this project on hold?", body: "It stays on the Pipeline as On Hold until resumed.", okL: "Hold", danger: false, done: "Project on hold" };
    case "resume":
      return { title: "Resume this project?", body: "It goes back to Active at the same stage.", okL: "Resume", danger: false, done: "Project resumed" };
    case "move-to-draft":
      return { title: "Move back to Drafts?", body: "It leaves Projects. Its stage, budget and records are kept; the start date is cleared.", okL: "Move to Drafts", danger: true, done: "Moved to Drafts" };
    case "reopen":
      return { title: "Reopen this project?", body: "It moves back to Projects as Active at Production Ready.", okL: "Reopen", danger: false, done: "Project reopened" };
  }
}
/** The status a lifecycle call needs (mirrors the server's checks, so a stale screen is caught before the call). */
export const LIFECYCLE_FROM: Record<Exclude<Lifecycle, "advance">, Status[]> = {
  start: ["DRAFT"], hold: ["ACTIVE"], resume: ["ON_HOLD"], "move-to-draft": ["ACTIVE", "ON_HOLD"], complete: ["ACTIVE"], reopen: ["COMPLETED"],
};

/**
 * Advance payload — desktop handleAdvanceStage (src/pages/rd/detail.tsx): the CURRENT stage's milestone gets
 * actualDate = today (MY) and approvedBy = the literal "Current User" (owner decision R-3: same as desktop);
 * every other milestone is sent back untouched. Never sends `status`. Built from a FRESH read.
 */
export function advancePayload(fresh: Project, today: string): { currentStage: Stage; milestones: RawRow[] } | null {
  if (!canAdvance(fresh)) return null;
  const nx = nextStage(fresh.currentStage)!;
  return {
    currentStage: nx,
    milestones: fresh.milestones.map((m) => (m.stage === fresh.currentStage ? { ...m.raw, actualDate: today, approvedBy: "Current User" } : m.raw)),
  };
}
/** Milestone target date (blank allowed = cleared, as desktop). Whole array, from a fresh read. */
export function milestoneDatePayload(fresh: Project, stage: Stage, date: string): { milestones: RawRow[] } {
  return { milestones: patchMilestone(fresh, stage, (m) => ({ ...m.raw, targetDate: date })) };
}
export function milestonePhotoPayload(fresh: Project, stage: Stage, dataUrl: string): { milestones: RawRow[] } {
  return { milestones: patchMilestone(fresh, stage, (m) => ({ ...m.raw, photos: [...m.photos, dataUrl] })) };
}
/** Patch one stage's milestone; a legacy row missing that stage gets it appended (blank), nothing else changes. */
function patchMilestone(fresh: Project, stage: Stage, fn: (m: Milestone) => RawRow): RawRow[] {
  if (fresh.milestones.some((m) => m.stage === stage)) return fresh.milestones.map((m) => (m.stage === stage ? fn(m) : m.raw));
  const blank = milestonesByStage({ ...fresh, milestones: [] }).find((m) => m.stage === stage)!;
  return [...fresh.milestones.map((m) => m.raw), fn(blank)];
}

// ---- prototypes --------------------------------------------------------------------------------
export const protosOf = (p: Project, t: ProtoType) => p.prototypes.filter((x) => x.prototypeType === t);
/** Desktop getNextVersion: v{count of that type + 1}. */
export const nextVersion = (p: Project, t: ProtoType) => `v${protosOf(p, t).length + 1}`;
export const versionNum = (v: string) => {
  const n = parseInt(v.replace(/^\D+/, ""), 10);
  return Number.isFinite(n) ? n : 1;
};
export type ProtoDraft = { createdDate: string; description: string; labourHours: string; improvements: string; defects: string; testResults: string; feedback: string };
/** Add: one new row with a fresh id; the PUT upserts by id and never deletes the others. */
export function newPrototypePayload(p: Project, t: ProtoType, d: ProtoDraft, now: number, today: string) {
  return {
    prototypes: [{
      id: `proto-${now}`, projectId: p.id, prototypeType: t, version: nextVersion(p, t), description: d.description.trim(), materialsCost: 0,
      labourHours: Number(d.labourHours) || 0, testResults: d.testResults.trim(), feedback: d.feedback.trim(), improvements: d.improvements.trim(),
      defects: d.defects.trim(), createdDate: d.createdDate || today,
    }],
  };
}
/** Edit: the stored version (and materials cost) is kept — never renumbered. */
export function editPrototypePayload(x: Prototype, d: ProtoDraft) {
  return {
    prototypes: [{
      ...x.raw, id: x.id, prototypeType: x.prototypeType, version: x.version, materialsCost: x.materialsCost, description: d.description.trim(),
      labourHours: Number(d.labourHours) || 0, testResults: d.testResults.trim(), feedback: d.feedback.trim(), improvements: d.improvements.trim(),
      defects: d.defects.trim(), createdDate: d.createdDate || x.createdDate,
    }],
  };
}
/** Hours like "4.5": blank = 0, otherwise a non-negative number with up to 2 decimals. */
export const isHours = (v: string) => v.trim() === "" || /^\d+(\.\d{1,2})?$/.test(v.trim()) || /^\.\d{1,2}$/.test(v.trim());

// ---- create -------------------------------------------------------------------------------------
export type CreateDraft = {
  name: string; projectType: PType; productCategory: Category | ""; serviceId: string; sourceProductName: string; sourceBrand: string;
  sourcePurchaseRef: string; sourcePrice: string; sourceNotes: string; description: string; targetLaunchDate: string; budget: string; team: string[];
};
/** RM text → sen. Blank = 0. Unreadable or negative = null (refuse; never `?? 0`). */
export function moneyToSen(v: string): number | null {
  if (v.trim() === "") return 0;
  const sen = parseMoneyToSen(v);
  return sen === null || sen < 0 ? null : sen;
}
export function createErrors(d: CreateDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.name.trim()) e.name = "Project name is required.";
  if (!d.productCategory) e.cat = "Pick a category.";
  if (moneyToSen(d.budget) === null) e.budget = "Enter an amount like 15000.00.";
  if (d.projectType === "CLONE" && moneyToSen(d.sourcePrice) === null) e.price = "Enter an amount like 890.00.";
  return e;
}
/** POST body — the server forces DRAFT + CONCEPT and six blank milestones; no currentStage / status here. */
export function createPayload(d: CreateDraft): RawRow {
  const body: RawRow = {
    name: d.name.trim(),
    projectType: d.projectType,
    productCategory: d.productCategory,
    description: d.description.trim(),
    totalBudget: moneyToSen(d.budget) ?? 0,
    assignedTeam: d.team,
  };
  if (d.targetLaunchDate) body.targetLaunchDate = d.targetLaunchDate;
  if (d.projectType === "IMPROVEMENT" && d.serviceId.trim()) body.serviceId = d.serviceId.trim();
  if (d.projectType === "CLONE") {
    body.sourceProductName = d.sourceProductName.trim();
    body.sourceBrand = d.sourceBrand.trim();
    body.sourcePurchaseRef = d.sourcePurchaseRef.trim();
    body.sourcePriceSen = moneyToSen(d.sourcePrice) ?? 0;
    body.sourceNotes = d.sourceNotes.trim();
  }
  return body;
}

// ---- history (8 real audit actions; never render a data URL) ----------------------------------
export const AUDIT_ACTION: Record<string, Chip> = {
  create: { l: "Created", t: "ok" },
  update: { l: "Updated", t: "neu" },
  start: { l: "Started", t: "info" },
  hold: { l: "Put on hold", t: "warn" },
  resume: { l: "Resumed", t: "info" },
  complete: { l: "Completed", t: "ok" },
  "move-to-draft": { l: "Moved to Drafts", t: "neu" },
  reopen: { l: "Reopened", t: "info" },
};
export const auditChip = (a: string): Chip => AUDIT_ACTION[a] ?? { l: a ? a.charAt(0).toUpperCase() + a.slice(1).replace(/-/g, " ") : "Changed", t: "neu" };
export const roleLabel = (r: string) =>
  r === "R_AND_D" || r === "RND" ? "R&D" : r.split("_").filter(Boolean).map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ") || "—";

const FIELD: Record<string, string> = {
  name: "Name", description: "Description", projectType: "Project Type", productCategory: "Category", currentStage: "Stage", status: "Status",
  targetLaunchDate: "Target Launch", totalBudget: "R&D Budget", actualCost: "Actual Cost", assignedTeam: "Team", serviceId: "Service reference",
  sourceProductName: "Source product", sourceBrand: "Brand / supplier", sourcePurchaseRef: "Purchase reference", sourcePriceSen: "Purchase price",
  sourceNotes: "Source notes", coverPhotoUrl: "Cover Photo", startedAt: "Started", manualLabourCostSen: "Manual labour cost",
};
const MONEY_FIELDS = new Set(["totalBudget", "actualCost", "sourcePriceSen", "manualLabourCostSen"]);
/** Pricing targets stay hidden on mobile (owner R-5); prototypes / labour / derived blobs are not field edits. */
const SKIP = new Set(["targetSellingPriceSen", "targetMaterialCostSen", "prototypes", "labourCost", "labourLogs", "productionBOM", "materialIssuances", "id", "code", "createdDate", "updatedAt", "createdAt"]);

const isDataUrl = (v: unknown) => typeof v === "string" && /^data:/i.test(v);
function fmtValue(key: string, v: unknown, type: PType): string {
  if (v == null || v === "") return "—";
  if (isDataUrl(v)) return "Photo";
  if (MONEY_FIELDS.has(key) && typeof v === "number") return rm(v);
  if (key === "status" && typeof v === "string") return STATUS_LABEL[v as Status] ?? v;
  if (key === "currentStage" && typeof v === "string") return stageLabels(type)[v as Stage] ?? v;
  if (key === "projectType" && typeof v === "string") return TYPE_LABEL[v as PType] ?? v;
  if (key === "productCategory" && typeof v === "string") return CATEGORY_LABEL[v as Category] ?? v;
  if (key === "targetLaunchDate" && typeof v === "string") return fmtDate(v);
  if (key === "startedAt" && typeof v === "string") return fmtDateTime(v);
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "object") return "—";
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
export type DiffLine = { k: string; v: string };
/** Field-level lines for one audit event. Photo fields read "Photo added / changed", never the base64 text. */
export function auditLines(e: AuditEvent, type: PType): DiffLine[] {
  const isObj = (x: unknown): x is RawRow => typeof x === "object" && x !== null && !Array.isArray(x);
  const b = isObj(e.before) ? e.before : {};
  const a = isObj(e.after) ? e.after : {};
  const out: DiffLine[] = [];
  if (e.action === "create") {
    for (const k of ["name", "productCategory", "projectType", "totalBudget"]) {
      if (a[k] != null && a[k] !== "") out.push({ k: FIELD[k], v: fmtValue(k, a[k], type) });
    }
    return out;
  }
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter((k) => !SKIP.has(k));
  for (const k of keys) {
    if (!(k in a)) continue;
    const av = b[k];
    const bv = a[k];
    if (JSON.stringify(av ?? null) === JSON.stringify(bv ?? null)) continue;
    if (k === "milestones") {
      out.push(...milestoneLines(av, bv, type));
      continue;
    }
    if (k === "coverPhotoUrl") {
      out.push({ k: "Updated Cover Photo", v: bv ? (av ? "Photo changed" : "Photo added") : "Photo removed" });
      continue;
    }
    const label = FIELD[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
    const from = fmtValue(k, av, type);
    const to = fmtValue(k, bv, type);
    out.push({ k: `Updated ${label}`, v: av == null || av === "" ? to : `${from} → ${to}` });
  }
  return out;
}
function milestoneLines(before: unknown, after: unknown, type: PType): DiffLine[] {
  const L = stageLabels(type);
  const B = rowsOf(before).map(toMilestone);
  const A = rowsOf(after).map(toMilestone);
  const out: DiffLine[] = [];
  for (const m of A) {
    const o = B.find((x) => x.stage === m.stage);
    const name = L[m.stage];
    if ((o?.targetDate ?? "") !== m.targetDate) out.push({ k: `${name} target`, v: `${fmtDate(o?.targetDate ?? "")} → ${fmtDate(m.targetDate)}` });
    if ((o?.actualDate ?? "") !== m.actualDate) out.push({ k: `${name} done`, v: m.actualDate ? fmtDate(m.actualDate) : "Cleared" });
    const n0 = o?.photos.length ?? 0;
    if (n0 !== m.photos.length) out.push({ k: `${name} photos`, v: m.photos.length > n0 ? `Photo added (${m.photos.length})` : `Photo removed (${m.photos.length})` });
  }
  return out;
}

// ---- urls ---------------------------------------------------------------------------------------
const enc = encodeURIComponent;
export const LIST_URL = "/api/rd-projects";
export const FILE_RESOURCE = "RD_PROJECT";
export const projectUrl = (id: string) => `/api/rd-projects/${enc(id)}`;
export const issuancesUrl = (id: string) => `/api/rd-projects/${enc(id)}/issuances`;
export const labourUrl = (id: string) => `/api/rd-projects/${enc(id)}/labour-hours`;
export const lifecycleUrl = (id: string, k: Exclude<Lifecycle, "advance">) => `/api/rd-projects/${enc(id)}/${k}`;
export const TEAM_URL = "/api/rd-team-members?active=true";
export const filesUrl = (id: string) => `/api/files?resourceType=${FILE_RESOURCE}&resourceId=${enc(id)}`;
export const fileDownloadUrl = (fileId: string) => `/api/files/${enc(fileId)}/download`;
export const historyUrl = (id: string) => `/api/audit-events?resource=rd-projects&resourceId=${enc(id)}`;

/** After any write: every cached R&D read refetches (list, detail, issuances, labour, files, history). */
export function invalidateRd(): void {
  invalidateCachePrefix(LIST_URL);
  invalidateCachePrefix(`/api/files?resourceType=${FILE_RESOURCE}`);
  invalidateCachePrefix("/api/audit-events?resource=rd-projects");
}

// ---- writes -------------------------------------------------------------------------------------
export type SendResult = { ok: true; data: RawRow | null } | { ok: false; error: string; status: number };
export const NETWORK_ERROR = "Couldn't save. Nothing changed — check your connection and try again.";
export const FORBIDDEN_ERROR = "You don't have permission to do this.";

/** JSON (or FormData) mutation; the server's own `error` text is what the user reads, verbatim. */
export async function send(url: string, method: "POST" | "PUT", body?: unknown): Promise<SendResult> {
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: RawRow };
    if (!res.ok || json.success === false) return { ok: false, status: res.status, error: httpError(res.status, json.error) };
    return { ok: true, data: json.data ?? null };
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
}
export function httpError(status: number, serverError?: string): string {
  if (status === 403) return FORBIDDEN_ERROR;
  if (serverError) return serverError;
  return status >= 500 ? `The server couldn't save this (HTTP ${status}). Nothing changed — try again.` : `Request failed (HTTP ${status})`;
}
/** verifiedSave's http body is raw text; pull the server's `error` out of it. */
export function errorFromBody(status: number, body: string): string {
  let msg = "";
  try {
    msg = (JSON.parse(body) as { error?: string }).error ?? "";
  } catch {
    /* not JSON */
  }
  return httpError(status, msg);
}
/** A fresh, uncached read of one project (before any read-modify-write). */
export async function readFresh(id: string): Promise<{ ok: true; p: Project } | { ok: false; error: string; notFound: boolean }> {
  try {
    const r = await fetch(`${projectUrl(id)}?_v=${Date.now()}`, { credentials: "include", cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Envelope;
    if (!r.ok || !j.data) return { ok: false, notFound: r.status === 404, error: r.status === 404 ? "This project no longer exists." : httpError(r.status, j.error) };
    return { ok: true, p: toProject(j.data as RawRow) };
  } catch {
    return { ok: false, notFound: false, error: NETWORK_ERROR };
  }
}

// ---- formatting --------------------------------------------------------------------------------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const rm = (sen: number) => `${sen < 0 ? "-" : ""}RM ${(Math.abs(sen) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const hrs = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;
export const qtyText = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-MY", { maximumFractionDigits: 2 });
/** "YYYY-MM-DD…" → "3 Dec 2026"; blank → "—". String maths only (no timezone shift). */
export function fmtDate(v: string): string {
  const k = (v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return "—";
  return `${+k.slice(8, 10)} ${MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
}
/** An ISO timestamp → "2026-11-21 11:05" in Malaysia time (UTC+8). */
export function fmtDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso || "—";
  const my = new Date(t + 8 * 3600 * 1000).toISOString();
  return `${my.slice(0, 10)} ${my.slice(11, 16)}`;
}
export function fileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
