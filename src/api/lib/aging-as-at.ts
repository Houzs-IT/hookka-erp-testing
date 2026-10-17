// ---------------------------------------------------------------------------
// aging-as-at.ts — Debtor / Creditor Aging as at a past date (owner
// 2026-10-17, Finance v2: aging as at a chosen month-end).
//
// Every open item is worked BACK from today: what it owes now, plus what was
// settled on it AFTER the as-at date — receipts; supplier payments (a supplier
// credit note's knock-off and a trade-finance payment are supplier_payments
// rows too); other-party payments; trade-finance repayments — with the notes
// issued after it put back the other way. An item dated after the as-at date
// is left out. Rolling back from today, instead of adding up from zero, means
// everything settled BEFORE the date (opening balances, imports) is already
// right: only the movements after it have to be known. Measured on prod
// 2026-10-17: every posted invoice's paid amount equals its live receipts'
// allocations, and every purchase invoice's equals its supplier_payments rows.
// ---------------------------------------------------------------------------
import type { Env } from "../worker";

type Db = Env["Variables"]["DB"];

const add = (m: Map<string, number>, k: string, v: number) => {
  if (!k || !v) return;
  m.set(k, (m.get(k) ?? 0) + v);
};

/** `monthsOverdue`'s "now" for an as-at date (noon UTC, so no timezone can
 *  move it into the next or previous day). */
export function asAtNow(asOf: string): Date {
  return new Date(`${asOf}T12:00:00Z`);
}

/** What an item owed at the as-at date: what it owes now plus what was
 *  settled on it after (a note's put-back is signed). Pure. */
export function owedAt(liveOwedSen: number, settledAfterSen: number): number {
  return (Number(liveOwedSen) || 0) + (Number(settledAfterSen) || 0);
}

/** Receipt allocations dated after `asOf`, per invoice id — live receipts
 *  only (a voided / deleted one settles nothing now), bounced ones left out
 *  (their allocations no longer count either). */
export async function receiptsAfter(db: Db, asOf: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const res = await db
    .prepare(
      `SELECT p.allocations AS allocations, p.status AS status
         FROM payment_records p
        WHERE p.date > ?
          AND NOT EXISTS (
            SELECT 1 FROM document_lifecycle dl
             WHERE dl.source_type = 'payment' AND dl.source_id = p.id AND dl.state <> 'ACTIVE'
          )`,
    )
    .bind(asOf)
    .all<{ allocations?: string | null; status?: string | null }>();
  for (const r of res.results ?? []) {
    if (r.status === "BOUNCED") continue;
    try {
      const parsed = JSON.parse(String(r.allocations ?? "[]")) as { invoiceId?: string; amount?: number }[];
      if (Array.isArray(parsed)) for (const a of parsed) add(out, String(a?.invoiceId ?? ""), Math.round(Number(a?.amount) || 0));
    } catch {
      /* malformed JSON settles nothing */
    }
  }
  return out;
}

/** Notes issued after `asOf`, per invoice id, as the amount to put back on
 *  what is owed: a credit note came off the invoice (+), a debit note was
 *  added to it (−). The same issue rules as the note cascades. */
export async function notesAfter(db: Db, asOf: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const [cn, dn] = await Promise.all([
    db.prepare("SELECT invoiceId, totalAmount FROM credit_notes WHERE status IN ('APPROVED','POSTED') AND date > ?")
      .bind(asOf).all<Record<string, unknown>>(),
    db.prepare("SELECT invoiceId, totalAmount FROM debit_notes WHERE status = 'POSTED' AND date > ?")
      .bind(asOf).all<Record<string, unknown>>(),
  ]);
  for (const r of cn.results ?? []) add(out, String(r.invoiceId ?? r.invoice_id ?? ""), Math.round(Number(r.totalAmount ?? r.total_amount) || 0));
  for (const r of dn.results ?? []) add(out, String(r.invoiceId ?? r.invoice_id ?? ""), -Math.round(Number(r.totalAmount ?? r.total_amount) || 0));
  return out;
}

/** Supplier payments dated after `asOf`, per purchase invoice id: the BOOKED
 *  amount (what came off the bill — a foreign payment's bank amount can
 *  differ; a supplier credit note's knock-off books with no bank amount and
 *  is dated by the note, as the creditor ledger has it). Live payments only. */
export async function supplierPaymentsAfter(db: Db, orgId: string, asOf: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const res = await db
    .prepare(
      `SELECT sp.purchase_invoice_id AS purchase_invoice_id, sp.booked_sen AS booked_sen, sp.amount_sen AS amount_sen
         FROM supplier_payments sp
         LEFT JOIN purchase_credit_notes pcn ON sp.method = 'CREDIT_NOTE' AND pcn.note_number = sp.payment_no
        WHERE sp.org_id = ? AND sp.purchase_invoice_id IS NOT NULL AND COALESCE(pcn.date, sp.date) > ?
          AND NOT EXISTS (
            SELECT 1 FROM document_lifecycle dl
             WHERE dl.source_type = 'supplier_payment' AND dl.source_id = sp.payment_no AND dl.state <> 'ACTIVE'
          )`,
    )
    .bind(orgId, asOf)
    .all<Record<string, unknown>>();
  for (const r of res.results ?? []) {
    const booked = Math.round(Number(r.bookedSen ?? r.booked_sen) || 0);
    const amount = Math.round(Number(r.amountSen ?? r.amount_sen) || 0);
    add(out, String(r.purchaseInvoiceId ?? r.purchase_invoice_id ?? ""), booked > 0 ? booked : amount);
  }
  return out;
}

/** Other-party payments dated after `asOf`, per bill id (live payments only). */
export async function otherPartyPaymentsAfter(db: Db, orgId: string, asOf: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const res = await db
    .prepare(
      `SELECT pp.billId AS bill_id, pp.amountSen AS amount_sen
         FROM other_party_payments pp
        WHERE pp.orgId = ? AND pp.date > ?
          AND NOT EXISTS (
            SELECT 1 FROM document_lifecycle dl
             WHERE dl.sourceType = 'other_party_payment' AND dl.sourceId = pp.paymentNo AND dl.state <> 'ACTIVE'
          )`,
    )
    .bind(orgId, asOf)
    .all<Record<string, unknown>>();
  for (const r of res.results ?? []) add(out, String(r.billId ?? r.bill_id ?? ""), Math.round(Number(r.amountSen ?? r.amount_sen) || 0));
  return out;
}

type AheadItem = { no: string; date: string; sen: number };

/** Money received by the as-at date but knocked off an invoice dated AFTER it
 *  (a prepayment): at the date it was money on account, so it shows as an
 *  advance — without it the customer's aging would not tie to their ledger
 *  balance at the date. Per customer. */
export async function receiptsAheadOf(
  db: Db,
  asOf: string,
  invoiceDate: Map<string, string>,
): Promise<Map<string, { name: string; items: AheadItem[] }>> {
  const out = new Map<string, { name: string; items: AheadItem[] }>();
  const res = await db
    .prepare(
      `SELECT p.customerId AS customer_id, p.customerName AS customer_name, p.receiptNumber AS receipt_number,
              p.date AS date, p.allocations AS allocations, p.status AS status
         FROM payment_records p
        WHERE p.date <= ?
          AND NOT EXISTS (
            SELECT 1 FROM document_lifecycle dl
             WHERE dl.source_type = 'payment' AND dl.source_id = p.id AND dl.state <> 'ACTIVE'
          )`,
    )
    .bind(asOf)
    .all<Record<string, unknown>>();
  for (const r of res.results ?? []) {
    if (r.status === "BOUNCED") continue;
    let sen = 0;
    try {
      const parsed = JSON.parse(String(r.allocations ?? "[]")) as { invoiceId?: string; amount?: number }[];
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          const d = invoiceDate.get(String(a?.invoiceId ?? ""));
          if (d && d > asOf) sen += Math.round(Number(a?.amount) || 0);
        }
      }
    } catch {
      /* malformed JSON → nothing ahead */
    }
    if (sen <= 0) continue;
    const id = String(r.customerId ?? r.customer_id ?? "");
    if (!id) continue;
    const cur = out.get(id) ?? { name: String(r.customerName ?? r.customer_name ?? ""), items: [] };
    cur.items.push({ no: String(r.receiptNumber ?? r.receipt_number ?? ""), date: String(r.date ?? "").slice(0, 10), sen });
    out.set(id, cur);
  }
  return out;
}

/** The supplier mirror: paid by the as-at date but knocked off a bill dated
 *  after it — an advance at the date. Per supplier. */
export async function supplierPaymentsAheadOf(
  db: Db,
  orgId: string,
  asOf: string,
  billDate: Map<string, string>,
): Promise<Map<string, { name: string; items: AheadItem[] }>> {
  const out = new Map<string, { name: string; items: AheadItem[] }>();
  const res = await db
    .prepare(
      `SELECT sp.supplier_id AS supplier_id, sp.supplier_name AS supplier_name, sp.payment_no AS payment_no,
              COALESCE(pcn.date, sp.date) AS date,
              sp.purchase_invoice_id AS purchase_invoice_id, sp.booked_sen AS booked_sen, sp.amount_sen AS amount_sen
         FROM supplier_payments sp
         LEFT JOIN purchase_credit_notes pcn ON sp.method = 'CREDIT_NOTE' AND pcn.note_number = sp.payment_no
        WHERE sp.org_id = ? AND sp.purchase_invoice_id IS NOT NULL AND COALESCE(pcn.date, sp.date) <= ?
          AND NOT EXISTS (
            SELECT 1 FROM document_lifecycle dl
             WHERE dl.source_type = 'supplier_payment' AND dl.source_id = sp.payment_no AND dl.state <> 'ACTIVE'
          )`,
    )
    .bind(orgId, asOf)
    .all<Record<string, unknown>>();
  for (const r of res.results ?? []) {
    const d = billDate.get(String(r.purchaseInvoiceId ?? r.purchase_invoice_id ?? ""));
    if (!d || d <= asOf) continue;
    const booked = Math.round(Number(r.bookedSen ?? r.booked_sen) || 0);
    const sen = booked > 0 ? booked : Math.round(Number(r.amountSen ?? r.amount_sen) || 0);
    if (sen <= 0) continue;
    const id = String(r.supplierId ?? r.supplier_id ?? "");
    if (!id) continue;
    const no = String(r.paymentNo ?? r.payment_no ?? "");
    const cur = out.get(id) ?? { name: String(r.supplierName ?? r.supplier_name ?? ""), items: [] };
    const same = cur.items.find((x) => x.no === no);
    if (same) same.sen += sen;
    else cur.items.push({ no, date: String(r.date ?? "").slice(0, 10), sen });
    out.set(id, cur);
  }
  return out;
}
