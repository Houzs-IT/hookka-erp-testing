// ---------------------------------------------------------------------------
// rm-merge.ts (pure) — which raw material rows are the same item, and which one
// stays (owner 2026-11-07: keep the code people actually use).
//
// Two rows are one item when their codes match after dropping a HOK- or FABRIC
// prefix, spaces, dashes and leading zeros: HOK-BO315-21 = BO315-21,
// ORION-1 = ORION-01, RICH 2239-02 = RICH2239-02. Rows in different item groups
// are never merged, because group decides where their cost is reported.
// ---------------------------------------------------------------------------

export type RmRow = {
  id: string;
  itemCode: string;
  description: string | null;
  itemGroup: string | null;
  createdAt: string | null;
};

export type RmMergeGroup = {
  key: string;
  keep: RmRow;
  losers: RmRow[];
  /** A better name for the kept row when it only says FABRIC. Null keeps its own. */
  description: string | null;
};

export type RmMergePlan = { groups: RmMergeGroup[]; skippedMixedGroup: RmRow[][] };

export function rmMergeKey(code: unknown): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/^HOK[- ]/, "")
    .replace(/^FABRIC[- ]?(?=[A-Z0-9])/, "")
    .replace(/[\s-]+/g, "")
    .replace(/(\D)0+(?=\d)/g, "$1");
}

const isGeneric = (d: string | null): boolean => /^\s*(FABRIC)?\s*$/i.test(d ?? "");

export function planRmMerge(
  rows: readonly RmRow[],
  usageByCode: ReadonlyMap<string, number>,
  stockByRow: ReadonlyMap<string, number>,
): RmMergePlan {
  const byKey = new Map<string, RmRow[]>();
  for (const r of rows) {
    const key = rmMergeKey(r.itemCode);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const usage = (r: RmRow) => usageByCode.get(r.itemCode.trim().toUpperCase()) ?? 0;
  const stock = (r: RmRow) => stockByRow.get(r.id) ?? 0;

  const plan: RmMergePlan = { groups: [], skippedMixedGroup: [] };
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    if (new Set(group.map((r) => r.itemGroup)).size > 1) {
      plan.skippedMixedGroup.push(group);
      continue;
    }
    const [keep, ...losers] = [...group].sort(
      (a, b) =>
        usage(b) - usage(a) ||
        stock(b) - stock(a) ||
        String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) ||
        a.id.localeCompare(b.id),
    );
    const named = losers.find((r) => !isGeneric(r.description));
    plan.groups.push({
      key,
      keep,
      losers,
      description: isGeneric(keep.description) && named ? named.description : null,
    });
  }
  return plan;
}

/** A retired row with the kept code gets a code of its own, so lookups by code cannot land on it. */
export function retiredCode(loser: Pick<RmRow, "id" | "itemCode">, keepCode: string): string {
  const same = loser.itemCode.trim().toUpperCase() === keepCode.trim().toUpperCase();
  return same ? `${loser.itemCode.trim()}~MERGED~${loser.id.slice(-6)}` : loser.itemCode;
}
