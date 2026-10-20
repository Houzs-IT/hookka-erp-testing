// ---------------------------------------------------------------------------
// note-edit.ts — credit / debit notes: edit a draft, delete a draft, and the
// rule every list uses to leave a deleted note out (owner 2026-10-20 「edit,
// duplicate, delete 可以做， approve 不需要」). A delete HIDES the note and keeps
// the row (the owner's rule for every finance document): its document_lifecycle
// state turns DELETED, the same table the vouchers and receipts use. Only a
// draft can be edited or deleted — a draft has touched nothing (no ledger, no
// customer balance, no invoice), so neither needs anything undone; a posted
// note goes Back to Draft first.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";

type Db = Env["Variables"]["DB"];

export type NoteKind = "credit_note" | "debit_note";
export type NoteItem = { description: string; quantity: number; unitPriceSen: number; totalSen: number };
type NoteLabel = "Credit note" | "Debit note";

/** The reasons the tables accept (their CHECK constraints). */
export const CREDIT_NOTE_REASONS = ["RETURN", "PRICE_ADJUSTMENT", "DAMAGE", "OVERCHARGE", "OTHER"] as const;
export const DEBIT_NOTE_REASONS = ["UNDERCHARGE", "ADDITIONAL_CHARGE", "PRICE_ADJUSTMENT", "OTHER"] as const;

/** Why this note cannot be edited or deleted — null when it can (a draft). */
export function noteDraftOnly(label: NoteLabel, noteNumber: string, status: string | null, verb: "edited" | "deleted"): string | null {
  if ((status ?? "DRAFT") === "DRAFT") return null;
  return `${label} ${noteNumber} is ${status === "APPROVED" ? "approved" : "posted"} — only a draft can be ${verb}. Put it back to draft first.`;
}

/** The lines as the create routes check them: `unitPriceSen` a non-negative
 *  integer (never the legacy RM `unitPrice`), quantity above 0. */
export function parseNoteItems(raw: unknown, label: NoteLabel): { items: NoteItem[]; totalSen: number } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: `${label} lines are required.` };
  const items: NoteItem[] = [];
  for (const item of raw as { description?: unknown; quantity?: unknown; unitPriceSen?: unknown; unitPrice?: unknown }[]) {
    if (item.unitPriceSen === undefined && item.unitPrice !== undefined) {
      return { error: `${label} item must send 'unitPriceSen' (integer sen), not 'unitPrice'. Use Math.round(rm * 100) on the client.` };
    }
    const unitPriceSen = Number(item.unitPriceSen);
    if (!Number.isInteger(unitPriceSen) || unitPriceSen < 0) {
      return { error: `${label} unitPriceSen must be a non-negative integer (got ${String(item.unitPriceSen)}).` };
    }
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `${label} quantity must be > 0 (got ${String(item.quantity)}).` };
    }
    items.push({ description: String(item.description ?? ""), quantity, unitPriceSen, totalSen: Math.round(quantity * unitPriceSen) });
  }
  return { items, totalSen: items.reduce((s, i) => s + i.totalSen, 0) };
}

/** SQL: the note on `alias` (the table or its alias) is not deleted. */
export const notDeletedSql = (kind: NoteKind, alias: string) =>
  `NOT EXISTS (SELECT 1 FROM document_lifecycle dl WHERE dl.sourceType = '${kind}' AND dl.sourceId = ${alias}.id AND dl.state = 'DELETED')`;

/** Has this note been deleted? */
export async function noteIsDeleted(db: Db, orgId: string, kind: NoteKind, id: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT state FROM document_lifecycle WHERE orgId = ? AND sourceType = ? AND sourceId = ?")
    .bind(orgId, kind, id)
    .first<{ state: string }>()
    .catch(() => null);
  return row?.state === "DELETED";
}

/** The statement that marks a note deleted — hidden from every list, the row kept. */
export function noteDeleteStatement(db: Db, orgId: string, kind: NoteKind, id: string, actorUserId: string | null) {
  const now = new Date().toISOString();
  return db
    .prepare(
      `INSERT INTO document_lifecycle (id, sourceType, sourceId, state, actionAt, actorUserId, orgId)
       VALUES (?, ?, ?, 'DELETED', ?, ?, ?)
       ON CONFLICT (orgId, sourceType, sourceId) DO UPDATE SET state = 'DELETED', actionAt = ?, actorUserId = ?`,
    )
    .bind(`dl-${crypto.randomUUID().slice(0, 10)}`, kind, id, now, actorUserId, orgId, now, actorUserId);
}
