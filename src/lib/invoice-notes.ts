// ---------------------------------------------------------------------------
// invoice-notes.ts — an invoice and the credit / debit notes raised on it.
//
// An issued credit note (APPROVED or POSTED) is taken off invoices.totalSen
// the moment it is issued, and a posted debit note is added to it (the note
// cascades in credit-notes.ts / debit-notes.ts). Every reader that works out
// what is still owed as totalSen − paid is therefore right without knowing
// about notes. A report that ALSO lists the notes as their own lines — the
// customer statement, the debtor ledger, the invoice page, Debtor Aging —
// must show the invoice at the amount it was issued at, or each note counts
// twice (BUG-2026-10-17-315). Pure; shared by the API and the pages.
// ---------------------------------------------------------------------------

export type NoteKind = "CN" | "DN";

/** A credit note counts once it is APPROVED or POSTED, a debit note once it
 *  is POSTED — the same rules the two cascades apply. */
export function noteIsIssued(kind: NoteKind, status: string | null | undefined): boolean {
  return kind === "CN" ? status === "APPROVED" || status === "POSTED" : status === "POSTED";
}

export type NoteSums = { creditSen: number; debitSen: number };

type NoteRow = Record<string, unknown>;
const noteInvoiceId = (n: NoteRow) => String(n.invoiceId ?? n.invoice_id ?? "");
const noteAmount = (n: NoteRow) => Math.round(Number(n.totalAmount ?? n.total_amount) || 0);

/** Σ of the issued notes on each invoice (rows read dual-keyed). */
export function sumIssuedNotesByInvoice(cns: NoteRow[], dns: NoteRow[]): Map<string, NoteSums> {
  const out = new Map<string, NoteSums>();
  const add = (n: NoteRow, kind: NoteKind) => {
    const id = noteInvoiceId(n);
    if (!id || !noteIsIssued(kind, n.status as string | null)) return;
    const s = out.get(id) ?? { creditSen: 0, debitSen: 0 };
    if (kind === "CN") s.creditSen += noteAmount(n);
    else s.debitSen += noteAmount(n);
    out.set(id, s);
  };
  for (const n of cns) add(n, "CN");
  for (const n of dns) add(n, "DN");
  return out;
}

/** The amount an invoice was issued at: what it carries now, with its issued
 *  credit notes put back and its posted debit notes taken off. */
export function invoiceIssuedSen(totalSen: number, sums: NoteSums | undefined): number {
  return (Number(totalSen) || 0) + (sums?.creditSen ?? 0) - (sums?.debitSen ?? 0);
}

/** Debtor Aging (owner 2026-10-17: a credit note is its own aging line). An
 *  invoice still owing `outstandingSen` — already net of its notes — splits
 *  into the invoice at what was owed before the notes, plus each note as its
 *  own line (`sen` signed: a credit note negative, a debit note positive).
 *  Returns the invoice line, or null when the split would leave it negative
 *  (a debit note the customer has already paid): the caller then keeps the
 *  one combined line it showed before. */
export function splitOutstandingByNotes(outstandingSen: number, notes: { sen: number }[]): number | null {
  const invoiceSen = outstandingSen - notes.reduce((s, n) => s + n.sen, 0);
  return invoiceSen >= 0 ? invoiceSen : null;
}
