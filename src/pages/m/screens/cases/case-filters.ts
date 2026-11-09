// Filter / sort state for the Service Cases list.
import { isAged, ordersLabel, type CaseRow, type SourceType } from "./case-model";

export type SortKey = "created" | "daysOpen" | "statusDays" | "stage" | "orders" | "no";
export const SORT_LABEL: Record<SortKey, string> = {
  created: "Newest first",
  daysOpen: "Days open",
  statusDays: "Status days",
  stage: "Stage",
  orders: "Orders",
  no: "Case no",
};
export type CreatedRange = "all" | "month" | "30";
export type CaseFilters = {
  src: SourceType[];
  cats: string[];
  depts: string[];
  stages: number[];
  created: CreatedRange;
  aged: boolean;
  sort: SortKey;
};
export const EMPTY_FILTERS: CaseFilters = { src: [], cats: [], depts: [], stages: [], created: "all", aged: false, sort: "created" };

export function filterCount(f: CaseFilters): number {
  return f.src.length + f.cats.length + f.depts.length + f.stages.length + (f.created !== "all" ? 1 : 0) + (f.aged ? 1 : 0) + (f.sort !== "created" ? 1 : 0);
}

export function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}


const DAY = 86400000;

export function matchesCase(r: CaseRow, q: string, f: CaseFilters, now: number): boolean {
  if (q) {
    const hay = [
      r.caseNo, r.customerName, r.sourceNo, r.externalRef, r.sourceType === "EXTERNAL" ? "external" : "",
      r.customerPO, r.department, r.stageLabel, r.categoriesText, ordersLabel(r),
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.src.length && !f.src.includes(r.sourceType)) return false;
  if (f.cats.length && !r.categoryCodes.some((c) => f.cats.includes(c))) return false;
  if (f.depts.length && !f.depts.includes(r.department)) return false;
  if (f.stages.length && !f.stages.includes(r.stageIndex)) return false;
  if (f.created !== "all") {
    const d = new Date(r.createdAt);
    if (isNaN(d.getTime())) return false;
    if (f.created === "30" && (now - d.getTime()) / DAY > 30) return false;
    if (f.created === "month") {
      const n = new Date(now);
      if (d.getMonth() !== n.getMonth() || d.getFullYear() !== n.getFullYear()) return false;
    }
  }
  if (f.aged && !isAged(r)) return false;
  return true;
}

export function sortCases(rows: CaseRow[], key: CaseFilters["sort"]): CaseRow[] {
  const out = [...rows];
  const days = (r: CaseRow) => (r.status === "CANCELLED" ? -1 : r.daysOpen ?? -1);
  const sdays = (r: CaseRow) => (r.status === "CANCELLED" ? -1 : r.stageDays);
  const t = (r: CaseRow) => new Date(r.createdAt).getTime() || 0;
  const cmp: Record<CaseFilters["sort"], (a: CaseRow, b: CaseRow) => number> = {
    created: (a, b) => t(b) - t(a),
    daysOpen: (a, b) => days(b) - days(a),
    statusDays: (a, b) => sdays(b) - sdays(a),
    stage: (a, b) => b.stageIndex - a.stageIndex,
    orders: (a, b) => b.ordersCount - a.ordersCount,
    no: (a, b) => b.caseNo.localeCompare(a.caseNo),
  };
  return out.sort(cmp[key]);
}

