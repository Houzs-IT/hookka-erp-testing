// Types + helper for GET /api/dashboard/overview/revenue-split (owner
// 2026-10-15), shared by the Revenue chart toggle and DeptRevenueCard.
export type CatSplit = { bedframe: number; sofa: number; accessory: number; unclassified: number; total: number };
export type RevCat = "all" | "bedframe" | "sofa";

export type RevenueSplitResp = {
  period?: string;
  granularity?: "day" | "week";
  revenue?: { bucket: string; salesOrder: CatSplit; invoice: CatSplit; production: CatSplit }[];
  departments?: { code: string; label: string; period: CatSplit; byBucket: CatSplit[] }[];
};

/** The part of a split a category toggle selects (All = everything, Accessory and Unclassified included). */
export const pickCat = (s: CatSplit | undefined, cat: RevCat): number =>
  !s ? 0 : cat === "bedframe" ? s.bedframe : cat === "sofa" ? s.sofa : s.total;

