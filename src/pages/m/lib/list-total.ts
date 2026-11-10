// ===========================================================================
// list-total — the phone (/m) document lists' total line (review G4 on the
// phone, item 121). Same rules as the desktop footer total from #1251
// (src/lib/grid-layout.ts): cancelled / voided rows stay on the list but are
// not added up, and the line says "loaded rows only" when the phone holds
// fewer rows than the server has. Display only — nothing is written.
//
// Pure (no React), so tests import it directly.
// ===========================================================================
import { isCancelledStatusRow, splitForTotals, totalFooterText } from "../../../lib/grid-layout";

/** The server's own row count for the list, when the envelope carries one
 *  (`{ total }` or `{ pagination: { total } }`). */
export function serverTotalOf(resp: unknown): number | undefined {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) return undefined;
  const o = resp as { total?: unknown; pagination?: { total?: unknown } };
  if (typeof o.total === "number" && Number.isFinite(o.total)) return o.total;
  const p = o.pagination?.total;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  return undefined;
}

/** The server said it cut the list short (newest-N cap, #1215). */
export function isCappedResponse(resp: unknown): boolean {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) return false;
  const o = resp as { truncated?: unknown; capped?: unknown; hasMore?: unknown };
  return o.truncated === true || o.capped === true || o.hasMore === true;
}

export type MobileListTotal = {
  /** Sum of the counted rows, integer sen. */
  sumSen: number;
  /** Rows added up. */
  counted: number;
  /** Cancelled rows left out. */
  skipped: number;
  /** The phone holds only part of the list. */
  loadedOnly: boolean;
  /** "Total · 12 shown of 40 · 1 cancelled not counted · loaded rows only". */
  text: string;
};

export function mobileListTotal<T extends { status?: unknown }>(o: {
  /** The rows on screen (after tab, search and filters). */
  rows: T[];
  /** Every row the phone loaded for this list. */
  all: number;
  /** Amount of one row in sen. */
  amountSen: (row: T) => number;
  /** The server's row count, when it sent one. */
  serverTotal?: number;
  /** The server said it cut the list short. */
  capped?: boolean;
}): MobileListTotal {
  const { counted, skipped } = splitForTotals(o.rows, isCancelledStatusRow);
  let sumSen = 0;
  for (const r of counted) {
    const n = Number(o.amountSen(r));
    if (Number.isFinite(n)) sumSen += n;
  }
  // A capped list without a count is still "more than we hold".
  const totalRows = o.capped ? Math.max(o.serverTotal ?? 0, o.all + 1) : o.serverTotal;
  return {
    sumSen,
    counted: counted.length,
    skipped,
    loadedOnly: totalRows !== undefined && totalRows > o.all,
    text: totalFooterText({ shown: o.rows.length, all: o.all, skipped, totalRows }),
  };
}
