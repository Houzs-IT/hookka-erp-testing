// ===========================================================================
// Planning (mobile) — Master Tracker rules, ported from the desktop page
// (src/pages/planning/index.tsx): getOverdueDisplay (L237), TRACKER_DEPARTMENTS
// (L253), the per-department cell state (L2845-2859) and the search / category
// filters (L1337-1353). Mobile additions (owner-approved in the design): the
// "Late only" chip and a Target End sort.
// ===========================================================================
import { nowMY, type PlanOrder } from "./planning-capacity";

export const TRACKER_DEPARTMENTS = [
  { name: "Fab Cut", code: "FAB_CUT" },
  { name: "Fab Sew", code: "FAB_SEW" },
  { name: "Wood Cut", code: "WOOD_CUT" },
  { name: "Foam Cut", code: "FOAM_CUTTING" },
  { name: "Foam Bonding", code: "FOAM" },
  { name: "Fibre", code: "FIBRE" },
  { name: "Framing", code: "FRAMING" },
  { name: "Webbing", code: "WEBBING" },
  { name: "Upholstery", code: "UPHOLSTERY" },
  { name: "Packing", code: "PACKING" },
] as const;

export type TrackerCategory = "ALL" | "BEDFRAME" | "SOFA" | "LATE";

export type TargetState =
  | { kind: "none" }
  | { kind: "done" }
  | { kind: "late"; days: number }
  | { kind: "left"; days: number };

/**
 * Desktop getOverdueDisplay: COMPLETED -> done; target before today -> "Nd overdue"; else "Nd left".
 * "Today" is the Malaysia day (nowMY); the target is read as a LOCAL Y-M-D (not a
 * UTC parse of "YYYY-MM-DD"), so the day difference is timezone-proof.
 */
export function targetState(order: Pick<PlanOrder, "status" | "targetEndDate">, now: Date = nowMY()): TargetState {
  if (order.status === "COMPLETED") return { kind: "done" };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(order.targetEndDate ?? "");
  if (!m) return { kind: "none" };
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const diff = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (!Number.isFinite(diff)) return { kind: "none" };
  return diff < 0 ? { kind: "late", days: Math.abs(diff) } : { kind: "left", days: diff };
}

export const isLate = (o: PlanOrder, now?: Date): boolean => targetState(o, now).kind === "late";

export type SegState = "none" | "done" | "current" | "pending";

export function segments(order: PlanOrder): { code: string; state: SegState }[] {
  return TRACKER_DEPARTMENTS.map((dept) => {
    const jc = order.jobCards.find((j) => j.departmentCode === dept.code);
    if (!jc) return { code: dept.code, state: "none" as const };
    const done = jc.status === "COMPLETED" || jc.status === "TRANSFERRED";
    if (done) return { code: dept.code, state: "done" as const };
    if (order.currentDepartment === dept.code) return { code: dept.code, state: "current" as const };
    return { code: dept.code, state: "pending" as const };
  });
}

export function progressOf(order: PlanOrder): { done: number; total: number } {
  const segs = segments(order);
  return { done: segs.filter((s) => s.state === "done").length, total: segs.filter((s) => s.state !== "none").length };
}

export function deptLabel(order: PlanOrder): string {
  if (order.status === "COMPLETED") return "Done";
  const hit = TRACKER_DEPARTMENTS.find((d) => d.code === order.currentDepartment);
  return hit?.name ?? ((order.currentDepartment ?? "").trim() || "—");
}

export function matchesSearch(o: PlanOrder, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [o.poNo, o.salesOrderNo, o.companySOId, o.customerName, o.productCode, o.productName, o.customerPOId].some((v) =>
    (v ?? "").toLowerCase().includes(n),
  );
}

export function trackerCount(orders: PlanOrder[], search: string, cat: TrackerCategory, now?: Date): number {
  return filterTracker(orders, search, cat, now).length;
}

/** Search first, then the chip; sorted by Target End (earliest first, undated last). */
export function filterTracker(orders: PlanOrder[], search: string, cat: TrackerCategory, now?: Date): PlanOrder[] {
  return orders
    .filter((o) => matchesSearch(o, search))
    .filter((o) => (cat === "ALL" ? true : cat === "LATE" ? isLate(o, now) : o.itemCategory === cat))
    .sort((a, b) => {
      const ta = a.targetEndDate || "9999-99-99";
      const tb = b.targetEndDate || "9999-99-99";
      return ta === tb ? a.poNo.localeCompare(b.poNo) : ta.localeCompare(tb);
    });
}
