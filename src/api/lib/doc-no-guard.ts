// ---------------------------------------------------------------------------
// doc-no-guard.ts — two documents saved at the same moment cannot take the
// same number (cross-system review pass 2, H3 B2; sister Houzs#5546).
//
// Delivery returns, purchase returns and stock adjustments number themselves
// read-highest-then-+1. Two saves in the same instant read the same highest
// number and both insert it — and those tables have no unique index to stop
// them (prod index state UNMEASURED; old duplicates, if any, would also stop
// one being created, so none is created here).
//
// Instead the insert batch opens with:
//   1. a transaction-scoped advisory lock on the numbering of that table, so
//      two inserts take turns (released at COMMIT); and
//   2. a check, started after the lock is held so it sees the other save's
//      commit, that the number is still free — it raises DOC_NO_TAKEN if not.
// The caller then reads a fresh number and tries again (up to 5 times), the
// same loop the PO / SO numberers run on their unique-index error.
// Nothing about the document's figures changes; only its number.
// ---------------------------------------------------------------------------
export const DOC_NO_TAKEN = "DOC_NO_TAKEN";
export const DOC_NO_RETRY_LIMIT = 5;

/** Tables/columns the guard may name (never caller input). */
const DOC_NO_COLUMNS = {
  delivery_returns: "return_no",
  purchase_returns: "return_no",
  stock_adjustments: "adjNo",
} as const;
export type DocNoTable = keyof typeof DOC_NO_COLUMNS;

/** SQL of the two guard statements. Exported for tests. */
export function docNoGuardSql(table: DocNoTable): { lock: string; free: string } {
  const col = DOC_NO_COLUMNS[table];
  return {
    lock: `SELECT pg_advisory_xact_lock(hashtext(?)::bigint)`,
    // Zero rows when the number is free. When taken, the CAST of a value that
    // names a column (so the planner cannot fold it early) raises an error
    // carrying DOC_NO_TAKEN and the number.
    free: `SELECT CAST('${DOC_NO_TAKEN} ' || ${col} AS INTEGER) AS "docNoFree" FROM ${table} WHERE ${col} = ?`,
  };
}

/** The two statements to put FIRST in the insert batch. */
export function docNoGuardStatements(
  db: D1Database,
  table: DocNoTable,
  docNo: string,
): D1PreparedStatement[] {
  const sql = docNoGuardSql(table);
  return [
    db.prepare(sql.lock).bind(`docno:${table}`),
    db.prepare(sql.free).bind(docNo),
  ];
}

/** True when a save failed because its number was taken meanwhile. */
export function isDocNoTaken(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes(DOC_NO_TAKEN);
}

/**
 * Run `attempt` (which reads a number and runs the guarded batch) again with
 * a fresh number when the number was taken. Other errors pass through.
 */
export async function withDocNoRetry<T>(
  attempt: (tryNo: number) => Promise<T>,
  limit = DOC_NO_RETRY_LIMIT,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt(i);
    } catch (err) {
      if (i + 1 < limit && isDocNoTaken(err)) continue;
      throw err;
    }
  }
}
