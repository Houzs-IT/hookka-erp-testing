// ---------------------------------------------------------------------------
// status-cas.ts — compare-and-set for a status write that rides in a batch
// (cross-system review pass 2, H3 B1 / B3; same shape as the delivery-return
// guard of review O1, #1255).
//
// The handlers read a row, check the status in memory, then write
// `UPDATE … SET status = ? … WHERE id = ?`. Between the read and the write
// someone else can cancel (or approve) the same document; the late write then
// brings it back. Adding `AND status = ?` to the UPDATE alone is not enough:
// the batch also holds stock / ledger statements, which would still commit
// next to an UPDATE that matched nothing. So a guard SELECT follows the
// UPDATE and divides by zero when the row is not in the state the UPDATE
// should have left it in — the whole batch rolls back and the handler answers
// 409. It only REFUSES a conflicting write; nothing about the figures moves.
// ---------------------------------------------------------------------------

/** Tables the guard may name (never caller input). */
export type CasTable = "delivery_orders" | "consignment_notes" | "payment_vouchers";

/**
 * SQL for the guard: raises "division by zero" unless the row now carries
 * `column = ?` and `updated_at = ?` (the values the UPDATE just wrote).
 * Binds: (id, value, updatedAt).
 */
export function casGuardSql(table: CasTable, column = "status"): string {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`bad CAS column ${column}`);
  return `SELECT 1 / CASE WHEN EXISTS (
     SELECT 1 FROM ${table} WHERE id = ? AND ${column} = ? AND updated_at = ?
   ) THEN 1 ELSE 0 END AS "casOk"`;
}

/** True when a batch failed because a CAS guard found the row had moved. */
export function isCasMiss(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /division by zero/i.test(msg);
}

/** The 409 sentence: what the document is now, and what the write expected. */
export function staleStatusMessage(
  docLabel: string,
  current: string | null | undefined,
  saw: string | null | undefined,
): string {
  const now = current ? current : "gone";
  const was = saw ? `, it was ${saw} when this change started` : "";
  return `This ${docLabel} was changed by someone else just now (it is now ${now}${was}). Nothing was saved. Refresh and check before trying again.`;
}
