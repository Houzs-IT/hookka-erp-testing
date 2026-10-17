// ---------------------------------------------------------------------------
// note-ledger.ts — double-entry legs for credit notes & debit notes.
//
// Phase 1 (finance) 2026-06: CN/DN previously mutated only the subledger
// (customers.outstandingSen + invoice totals) and never touched the GL, so
// the 300-x debtor control drifted from Σ customer outstanding and revenue
// stayed overstated after a credit note. This module mirrors the sales-
// invoice posting in invoices.ts (buildInvoiceLedgerLegs) so a CN/DN lands
// in ledger_journal_entries in the SAME batch as its subledger cascade.
//
//   Credit note (reduces what the customer owes):
//     DR 510-0000 RETURN INWARDS        amount   (reason RETURN / DAMAGE)
//        — or 520-0000 DISCOUNT ALLOWED          (other reasons)
//     DR 350-0000 GST/SST output        tax      (only if rate > 0)
//     CR <debtor control 300-x>         amount + tax
//
//   Debit note (adds to what the customer owes):
//     DR <debtor control 300-x>         amount + tax
//     CR 500-0000 SALES                 amount
//     CR 350-0000 GST/SST output        tax      (only if rate > 0)
//
// Tax mirrors the invoice posting: operator-configured `gst_rate_pct` in
// kv_config applied to the note amount at posting time (notes store amounts
// excluding tax, same convention as invoices.totalSen / subtotalSen).
//
// Failure model: callers build these statements BEFORE the batch and FAIL
// the request when the build throws — a note must never apply its subledger
// cascade without the matching GL legs (Phase-1 decision: no silent skips).
// ---------------------------------------------------------------------------
import type { Env } from "../worker";
import { parseDebtorCode } from "../../lib/debtor";
import { buildJournalEntryStatements, type LedgerEntryInput } from "./journal-hash";

type Db = Env["Variables"]["DB"];

// Reason → P&L account for the credit-note debit leg. Physical goods coming
// back (RETURN / DAMAGE) hit RETURN INWARDS; pure price concessions
// (PRICE_ADJUSTMENT / OVERCHARGE / OTHER) hit DISCOUNT ALLOWED.
const CN_RETURN_ACCT = "510-0000"; // RETURN INWARDS
const CN_DISCOUNT_ACCT = "520-0000"; // DISCOUNT ALLOWED
const DN_SALES_ACCT = "500-0000"; // SALES (generic)
const TAX_OUTPUT_ACCT = "350-0000"; // GST PAYABLES (output tax)
const FALLBACK_DEBTOR_CONTROL = "300-0000"; // TRADE DEBTORS

function cnDebitAccount(reason: string | null | undefined): string {
  return reason === "RETURN" || reason === "DAMAGE"
    ? CN_RETURN_ACCT
    : CN_DISCOUNT_ACCT;
}

// Operator-configured GST/SST rate — same source as the invoice posting
// (invoices.ts buildInvoiceLedgerLegs step 3). 0 / missing / invalid → 0%.
export async function readGstRatePct(db: Db): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM kv_config WHERE key = ?")
    .bind("gst_rate_pct")
    .first<{ value: string }>();
  try {
    const v = JSON.parse(row?.value ?? "null") as { pct?: number } | null;
    if (v && typeof v.pct === "number" && isFinite(v.pct) && v.pct > 0)
      return v.pct;
  } catch {
    /* fall through */
  }
  return 0;
}

// Debtor control account from the customer's debtor code — same resolution
// as the invoice posting so CN/DN legs always hit the SAME control account
// the original invoice debited.
export async function resolveDebtorControl(
  db: Db,
  customerId: string,
): Promise<string> {
  const cust = await db
    .prepare("SELECT code FROM customers WHERE id = ?")
    .bind(customerId)
    .first<{ code: string }>();
  const parsed = parseDebtorCode(cust?.code);
  return parsed.ok ? parsed.controlCode : FALLBACK_DEBTOR_CONTROL;
}

export interface NoteForLedger {
  id: string;
  noteNumber: string;
  customerId: string;
  reason: string | null;
}

// Phase 2 (2026-06) — note amounts are GROSS (invoice totals are now
// subtotal + SST, so the operator enters what the customer actually gets
// back / additionally owes). The tax portion is BACKED OUT of the gross:
//   tax = round(gross × pct / (100 + pct)), net = gross − tax
// so the debtor-control leg always equals the entered amount exactly.
function backOutTax(
  grossSen: number,
  pct: number,
): { netSen: number; taxSen: number } {
  if (pct <= 0) return { netSen: grossSen, taxSen: 0 };
  const taxSen = Math.round((grossSen * pct) / (100 + pct));
  return { netSen: grossSen - taxSen, taxSen };
}

export async function buildCreditNoteLedgerLegs(
  db: Db,
  orgId: string,
  note: NoteForLedger,
  amountSen: number,
  actorUserId: string | null,
  sourceType: string = "credit_note",
): Promise<LedgerEntryInput[]> {
  const amount = Math.max(0, Math.round(amountSen) || 0);
  if (amount === 0) return [];
  const controlCode = await resolveDebtorControl(db, note.customerId);
  const pct = await readGstRatePct(db);
  const { netSen, taxSen } = backOutTax(amount, pct);
  const legs: LedgerEntryInput[] = [];
  let legNo = 1;
  legs.push({
    id: `lje-${crypto.randomUUID().slice(0, 12)}`,
    sourceType,
    sourceId: note.id,
    legNo: legNo++,
    accountCode: cnDebitAccount(note.reason),
    debitSen: netSen,
    creditSen: 0,
    description: `CN ${note.noteNumber} · ${note.reason ?? "OTHER"}`,
    actorUserId,
    orgId,
  });
  if (taxSen > 0) {
    legs.push({
      id: `lje-${crypto.randomUUID().slice(0, 12)}`,
      sourceType,
      sourceId: note.id,
      legNo: legNo++,
      accountCode: TAX_OUTPUT_ACCT,
      debitSen: taxSen,
      creditSen: 0,
      description: `CN ${note.noteNumber} · tax reversal`,
      actorUserId,
      orgId,
    });
  }
  legs.push({
    id: `lje-${crypto.randomUUID().slice(0, 12)}`,
    sourceType,
    sourceId: note.id,
    legNo: legNo++,
    accountCode: controlCode,
    debitSen: 0,
    creditSen: amount,
    description: `CN ${note.noteNumber} · AR credit`,
    actorUserId,
    orgId,
  });
  return legs;
}

export async function buildDebitNoteLedgerLegs(
  db: Db,
  orgId: string,
  note: NoteForLedger,
  amountSen: number,
  actorUserId: string | null,
  sourceType: string = "debit_note",
): Promise<LedgerEntryInput[]> {
  const amount = Math.max(0, Math.round(amountSen) || 0);
  if (amount === 0) return [];
  const controlCode = await resolveDebtorControl(db, note.customerId);
  const pct = await readGstRatePct(db);
  const { netSen, taxSen } = backOutTax(amount, pct);
  const legs: LedgerEntryInput[] = [];
  let legNo = 1;
  legs.push({
    id: `lje-${crypto.randomUUID().slice(0, 12)}`,
    sourceType,
    sourceId: note.id,
    legNo: legNo++,
    accountCode: controlCode,
    debitSen: amount,
    creditSen: 0,
    description: `DN ${note.noteNumber} · AR debit`,
    actorUserId,
    orgId,
  });
  legs.push({
    id: `lje-${crypto.randomUUID().slice(0, 12)}`,
    sourceType,
    sourceId: note.id,
    legNo: legNo++,
    accountCode: DN_SALES_ACCT,
    debitSen: 0,
    creditSen: netSen,
    description: `DN ${note.noteNumber} · ${note.reason ?? "OTHER"}`,
    actorUserId,
    orgId,
  });
  if (taxSen > 0) {
    legs.push({
      id: `lje-${crypto.randomUUID().slice(0, 12)}`,
      sourceType,
      sourceId: note.id,
      legNo: legNo++,
      accountCode: TAX_OUTPUT_ACCT,
      debitSen: 0,
      creditSen: taxSen,
      description: `DN ${note.noteNumber} · output tax`,
      actorUserId,
      orgId,
    });
  }
  return legs;
}

// ---------------------------------------------------------------------------
// Post / Back to Draft (owner 2026-10-17, Finance v2: credit and debit notes
// can be posted and put back to draft). A note's ledger family is every
// sourceType starting with its kind, all under the note's id: the first post
// ("credit_note"), a Back to Draft's mirror ("credit_note_restate_rev:<t>")
// and a later re-post ("credit_note_restate_post:<t>"). The restate suffixes
// are the ones the rest of the ledger already knows: the document-date
// resolver dates them on the note's own date, and the Corrections report
// lists them. At any moment at most one set is live (hidden = 0).
// ---------------------------------------------------------------------------
export type NoteKind = "credit_note" | "debit_note";

const familyLike = (kind: NoteKind) => `${kind}%`;

/** The source type a post of this note must use: its kind the first time, a
 *  fresh "<kind>_restate_post:<stamp>" once earlier legs exist (hidden by a
 *  Back to Draft) — null when a live set already exists, so nothing is posted
 *  twice. */
export async function noteLedgerSourceType(db: Db, orgId: string, kind: NoteKind, noteId: string): Promise<string | null> {
  const rows = ((await db
    .prepare(`SELECT hidden FROM ledger_journal_entries WHERE orgId = ? AND sourceId = ? AND sourceType LIKE ?`)
    .bind(orgId, noteId, familyLike(kind))
    .all<Record<string, unknown>>()).results ?? []);
  if (rows.some((r) => Number(r.hidden ?? 0) === 0)) return null;
  if (!rows.length) return kind;
  return `${kind}_restate_post:${Date.now()}`;
}

/** Back to Draft, ledger side: post the mirror of the note's live legs under
 *  "<kind>_restate_rev:<stamp>", then hide the whole family, so the books read
 *  as if the note had never been issued and the trail stays. [] when nothing
 *  is live. Run in the same batch as the subledger reversal. */
export async function buildNoteUnpostStatements(
  db: Db,
  orgId: string,
  kind: NoteKind,
  note: { id: string; noteNumber: string },
  actorUserId: string | null,
) {
  const live = ((await db
    .prepare(`SELECT accountCode, debitSen, creditSen FROM ledger_journal_entries WHERE orgId = ? AND sourceId = ? AND sourceType LIKE ? AND hidden = 0`)
    .bind(orgId, note.id, familyLike(kind))
    .all<Record<string, unknown>>()).results ?? []);
  if (!live.length) return [];
  const stamp = Date.now();
  const label = kind === "credit_note" ? "CN" : "DN";
  const legs: LedgerEntryInput[] = live.map((l, i) => ({
    id: `lje-${crypto.randomUUID().slice(0, 12)}`,
    sourceType: `${kind}_restate_rev:${stamp}`,
    sourceId: note.id,
    legNo: i + 1,
    accountCode: String(l.accountCode ?? l.account_code ?? ""),
    debitSen: Number(l.creditSen ?? l.credit_sen) || 0,
    creditSen: Number(l.debitSen ?? l.debit_sen) || 0,
    description: `${label} ${note.noteNumber} · back to draft`,
    actorUserId,
    orgId,
  }));
  const { statements } = await buildJournalEntryStatements(db, orgId, legs);
  return [
    ...statements,
    db.prepare(`UPDATE ledger_journal_entries SET hidden = 1 WHERE orgId = ? AND sourceId = ? AND sourceType LIKE ?`)
      .bind(orgId, note.id, familyLike(kind)),
  ];
}

/** An invoice's totals once a note's amount is put back (Back to Draft): a
 *  credit note's amount returns to the invoice, a debit note's comes off.
 *  Status follows what is now paid against the new total. Pure. The caller
 *  refuses a debit note whose amount is already paid (the total would drop
 *  below what was received). */
export function invoiceAfterNoteReversal(
  inv: { totalSen: number; subtotalSen: number; paidAmount: number; status: string },
  kind: NoteKind,
  amountSen: number,
): { totalSen: number; subtotalSen: number; status: string } {
  const sign = kind === "credit_note" ? 1 : -1;
  const totalSen = Math.max(0, (Number(inv.totalSen) || 0) + sign * amountSen);
  const subtotalSen = Math.max(0, (Number(inv.subtotalSen) || 0) + sign * amountSen);
  const paid = Number(inv.paidAmount) || 0;
  const status = paid > 0 && paid >= totalSen ? "PAID" : paid > 0 ? "PARTIAL_PAID" : inv.status === "PAID" ? "SENT" : inv.status;
  return { totalSen, subtotalSen, status };
}
