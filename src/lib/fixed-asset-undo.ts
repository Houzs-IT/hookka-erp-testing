// ---------------------------------------------------------------------------
// fixed-asset-undo.ts — undoing a month's depreciation (owner 2026-10-20,
// from the design list: Fixed Assets "undo a month's depreciation" 「这个要
// 做」). Each run of the month (ledger sourceId dep-YYYY-MM-<stamp>) is
// reversed leg by leg under depreciation_reversal — the same shape as the
// labour undo, so the Journal list folds the pair into one REVERSED · UNDONE
// row and the reports net the month to nothing. A run whose legs already net
// to nothing (undone before) is left alone. Months are undone latest first,
// so no month's figure was worked out on top of one that is gone. Pure.
// ---------------------------------------------------------------------------

export type DepLeg = {
  sourceType: string;
  sourceId: string;
  accountCode: string;
  debitSen: number;
  creditSen: number;
  description: string | null;
};

export type DepUndoLeg = { sourceId: string; accountCode: string; debitSen: number; creditSen: number; description: string };

/** The legs that undo `month` (YYYY-MM): every run of the month that still
 *  stands, mirrored leg by leg. */
export function depreciationUndoLegs(legs: readonly DepLeg[], month: string): DepUndoLeg[] {
  const prefix = `dep-${month}-`;
  const runs = new Map<string, DepLeg[]>();
  for (const l of legs) {
    if (!l.sourceId.startsWith(prefix)) continue;
    if (l.sourceType !== "depreciation" && l.sourceType !== "depreciation_reversal") continue;
    const arr = runs.get(l.sourceId) ?? [];
    arr.push(l);
    runs.set(l.sourceId, arr);
  }
  const out: DepUndoLeg[] = [];
  for (const [sourceId, ls] of [...runs].sort(([a], [b]) => a.localeCompare(b))) {
    const net = ls.reduce((s, l) => s + Math.abs((Number(l.debitSen) || 0) - (Number(l.creditSen) || 0)) * (l.sourceType === "depreciation" ? 1 : -1), 0);
    if (net <= 0) continue; // already undone
    for (const l of ls.filter((x) => x.sourceType === "depreciation")) {
      out.push({
        sourceId,
        accountCode: l.accountCode,
        debitSen: Number(l.creditSen) || 0,
        creditSen: Number(l.debitSen) || 0,
        description: `${l.description || `Depreciation ${month}`} · undone`,
      });
    }
  }
  return out;
}

/** Why `month` cannot be undone — null when it can: it must have posted
 *  depreciation and be the latest month that has. */
export function depreciationUndoBlock(month: string, latestPostedMonth: string | null, monthHasRows: boolean): string | null {
  if (!monthHasRows || !latestPostedMonth) return `No depreciation is posted for ${month}.`;
  if (month < latestPostedMonth) return `Undo ${latestPostedMonth} first — months are undone latest first.`;
  return null;
}
