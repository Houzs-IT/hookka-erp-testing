// Types + helper for GET /api/dashboard/overview/revenue-split (owner
// 2026-10-15), shared by the Revenue chart toggle and DeptRevenueCard.
export type CatSplit = { bedframe: number; sofa: number; accessory: number; unclassified: number; total: number };
export type RevCat = "all" | "bedframe" | "sofa" | "accessory";
/** Sets per department (HK-0148) — see countSets in src/api/lib/dept-revenue.ts. */
export type SetCount = { bedframe: number; sofa: number; total: number; hbOnly: number; divanOnly: number; unknown: number };

export type RevenueSplitResp = {
  period?: string;
  granularity?: "day" | "week";
  revenue?: { bucket: string; salesOrder: CatSplit; invoice: CatSplit; production: CatSplit }[];
  departments?: { code: string; label: string; period: CatSplit; byBucket: CatSplit[]; sets?: SetCount; setsByBucket?: SetCount[] }[];
};

/** Index of `day` (YYYY-MM-DD) in a per-day split, or -1 (no day, weekly buckets, or a day with no bucket). */
export const dayBucketIndex = (data: RevenueSplitResp | null | undefined, day: string | undefined): number =>
  !day || data?.granularity !== "day" ? -1 : (data.revenue ?? []).findIndex((r) => r.bucket === day);

/** Sets the category toggle selects; Accessory makes no sets → null. */
export const pickSets = (s: SetCount | undefined, cat: RevCat): number | null =>
  cat === "accessory" ? null : !s ? 0 : cat === "bedframe" ? s.bedframe : cat === "sofa" ? s.sofa : s.total;

/** Bedframe pieces the set rule does not pair, for the Sets cell's tooltip. */
export const looseSetPieces = (s: SetCount | undefined): string => {
  if (!s) return "";
  const parts = [
    s.hbOnly ? `${s.hbOnly} headboard-only` : "",
    s.divanOnly ? `${s.divanOnly} divan-only` : "",
    s.unknown ? `${s.unknown} bedframe with no HB/divan cards` : "",
  ].filter(Boolean);
  return parts.length ? `Not counted as sets: ${parts.join(", ")}` : "";
};

/** The part of a split a category toggle selects (All = everything, Accessory and Unclassified included). */
export const pickCat = (s: CatSplit | undefined, cat: RevCat): number =>
  !s ? 0 : cat === "bedframe" ? s.bedframe : cat === "sofa" ? s.sofa : cat === "accessory" ? s.accessory : s.total;

