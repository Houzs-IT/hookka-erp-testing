// ===========================================================================
// Planning (mobile) — Lead Times view model (view only). Pure: the history API
// stores only the NEW value of each row and no actor, so "1 day → 2 days" is
// derived from the previous row of the same (category, department).
// ===========================================================================
import { PLAN_DEPARTMENTS } from "./planning-capacity";

export type LeadPayload = {
  BEDFRAME?: Record<string, number>;
  SOFA?: Record<string, number>;
  hookkaDDBuffer?: { BEDFRAME?: number; SOFA?: number };
  pending?: { count?: number; nearestEffectiveFrom?: string | null };
  autoScheduleEnabled?: boolean;
};
export type LeadHistoryRow = {
  id: string;
  kind: "leadTime" | "hookkaBuffer";
  category: string;
  deptCode?: string;
  days: number;
  effectiveFrom: string;
  notes?: string;
  createdAt?: string;
  status: "Pending" | "Active" | "Past";
};
export type LeadHistory = { leadTimes?: LeadHistoryRow[]; hookkaBuffer?: LeadHistoryRow[] };

/** Desktop LEADTIME_ROWS order (index.tsx:805). */
export const LEAD_ROW_ORDER = [
  "FAB_CUT", "FAB_SEW", "FOAM_CUTTING", "FOAM", "FIBRE", "WOOD_CUT", "FRAMING", "UPHOLSTERY", "PACKING", "WEBBING",
] as const;

const deptName = (code: string) => PLAN_DEPARTMENTS.find((d) => d.code === code)?.name ?? code;
const catName = (c: string) => (c === "SOFA" ? "Sofa" : c === "BEDFRAME" ? "Bedframe" : c);

export type LeadRow = { n: number; code: string; dept: string; days: number };
export type LeadChange = { id: string; title: string; from: string; change: string; notes: string; status: LeadHistoryRow["status"] };

export type LeadView = {
  rows: LeadRow[];
  /** Sum of the department lead days (the lead-times library's "end-to-end total"). */
  total: number;
  buffer: number;
  autoSchedule: boolean;
  pending: LeadChange[];
  history: LeadChange[];
};

const rowKey = (r: LeadHistoryRow) => (r.kind === "hookkaBuffer" ? `${r.category}|BUFFER` : `${r.category}|${r.deptCode ?? ""}`);
const byNewest = (a: LeadHistoryRow, b: LeadHistoryRow) =>
  a.effectiveFrom === b.effectiveFrom
    ? (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
    : b.effectiveFrom.localeCompare(a.effectiveFrom);

/**
 * The history API stores only the NEW value of each row (and no actor), so
 * "1 day → 2 days" is derived from the previous row of the same
 * (category, department); the first row of a key shows just its value.
 */
export function buildLeadView(lead: LeadPayload | null, history: LeadHistory | null, cat: "BEDFRAME" | "SOFA"): LeadView {
  const map = (cat === "SOFA" ? lead?.SOFA : lead?.BEDFRAME) ?? {};
  const rows: LeadRow[] = LEAD_ROW_ORDER.map((code, i) => ({ n: i + 1, code, dept: deptName(code), days: Number(map[code] ?? 0) || 0 }));
  const buffer = Number(lead?.hookkaDDBuffer?.[cat] ?? 0) || 0;

  const all = [...(history?.leadTimes ?? []), ...(history?.hookkaBuffer ?? [])];
  const groups = new Map<string, LeadHistoryRow[]>();
  for (const r of all) {
    const k = rowKey(r);
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  // A pending change with no earlier history row still has a CURRENT value (the
  // live map) to change from.
  const currentOf = (r: LeadHistoryRow): number | undefined => {
    const v = r.kind === "hookkaBuffer" ? lead?.hookkaDDBuffer?.[r.category as "BEDFRAME" | "SOFA"] : (r.category === "SOFA" ? lead?.SOFA : lead?.BEDFRAME)?.[r.deptCode ?? ""];
    return typeof v === "number" ? v : undefined;
  };
  const toChange = (r: LeadHistoryRow, prev: LeadHistoryRow | undefined): LeadChange => {
    const unit = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
    const before = prev ? prev.days : r.status === "Pending" ? currentOf(r) : undefined;
    return {
      id: r.id,
      title: `${r.kind === "hookkaBuffer" ? "Hookka DD buffer" : deptName(r.deptCode ?? "")} · ${catName(r.category)}`,
      from: r.effectiveFrom,
      change: before !== undefined ? `${unit(before)} → ${unit(r.days)}` : unit(r.days),
      notes: (r.notes ?? "").trim(),
      status: r.status,
    };
  };
  const pending: LeadChange[] = [];
  const hist: LeadChange[] = [];
  for (const list of groups.values()) {
    const sorted = list.slice().sort(byNewest);
    sorted.forEach((r, i) => {
      if (r.status === "Pending") {
        const active = sorted.slice(i + 1).find((x) => x.status !== "Pending");
        pending.push(toChange(r, active));
      } else {
        hist.push(toChange(r, sorted.slice(i + 1).find((x) => x.status !== "Pending")));
      }
    });
  }
  const dateOf = new Map(all.map((r) => [r.id, r]));
  const sortChanges = (a: LeadChange, b: LeadChange) => {
    const ra = dateOf.get(a.id);
    const rb = dateOf.get(b.id);
    return ra && rb ? byNewest(ra, rb) : 0;
  };
  pending.sort((a, b) => a.from.localeCompare(b.from));
  hist.sort(sortChanges);
  return {
    rows,
    total: rows.reduce((s, r) => s + r.days, 0),
    buffer,
    autoSchedule: lead?.autoScheduleEnabled !== false,
    pending,
    history: hist,
  };
}

