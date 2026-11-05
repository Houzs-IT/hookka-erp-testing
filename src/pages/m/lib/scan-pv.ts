// ---------------------------------------------------------------------------
// scan-pv — the pure logic of "scan a bill / receipt → DRAFT Payment Voucher" on mobile.
//
// The desktop's Payment Vouchers "Scan" (src/pages/accounting/index.tsx, ScanVouchers) on the phone, with the same
// shared libs: src/lib/scan-account-learn.ts for the account each line probably goes to (learned from what finance
// saved before) and for "is this bill number already on our books", and the same body — a DRAFT, paid from the default
// bank, never prepared / checked / approved / posted / settled by a scan.
//
// The extraction is POST /api/scan-finance/extract: synchronous, one file, `docs[]` (a PDF may hold several bills), amounts
// already in sen. It is not on the scan queue, so a result cannot be recovered after the sheet closes.
// Nothing here talks to the network.
// ---------------------------------------------------------------------------
import { findDuplicate, guessAccount, linesWithTax, normDocNo, normPayee, type AccountGuess, type KnownDoc, type LearnedLine } from "../../../lib/scan-account-learn";
import { defaultBankCode } from "../../../lib/default-bank";
import { moneyFieldToSen } from "../../../lib/money-field";
import { bankAccounts, pvBillNo, pvIsVoid, pvKind, pvState, senToField, type CoaAccount, type PvForm, type PvFormLine, type PvRaw } from "./pv-mobile";

export type FinanceDoc = {
  partyName?: string | null; docType?: string | null; docNo?: string | null; docDate?: string | null;
  lines?: { description: string; amountSen: number }[]; subtotalSen?: number | null; taxSen?: number | null; totalSen?: number | null;
};
export type ScanMemory = { history: LearnedLine[]; known: KnownDoc[] };
export const EMPTY_MEMORY: ScanMemory = { history: [], known: [] };

/** What a finance scan learns from: approved expense vouchers' lines, and the bill numbers already on the books. */
export function buildMemory(vouchers: PvRaw[], bills: PvRaw[], invoices: PvRaw[]): ScanMemory {
  const history: LearnedLine[] = [];
  const known: KnownDoc[] = [];
  const s = (v: unknown) => (v == null ? "" : String(v));
  for (const r of vouchers) {
    if (pvIsVoid(r)) continue;
    const approved = r.status === "POSTED" && pvState(r) === "APPROVED";
    if (approved && pvKind(r) === "EXPENSE") {
      for (const l of (Array.isArray(r.lines) ? r.lines : []) as PvRaw[]) history.push({ payee: s(r.payee), description: s(l.description) || s(r.description), accountCode: s(l.accountCode), date: s(r.date) });
    }
    for (const no of pvBillNo(r).split(/[,;]/)) if (no.trim()) known.push({ docNo: no.trim(), payee: s(r.payee), ref: s(r.pvNo) });
  }
  for (const b of bills) {
    if (s(b.lifecycleState || "ACTIVE") !== "ACTIVE" || b.status === "CANCELLED") continue;
    for (const it of (Array.isArray(b.items) ? b.items : []) as PvRaw[]) history.push({ payee: s(b.partyName), description: s(it.description) || s(b.description), accountCode: s(it.counterAccount), date: s(b.billDate) });
    if (b.referenceNo) known.push({ docNo: s(b.referenceNo), payee: s(b.partyName), ref: s(b.billNo) });
  }
  for (const p of invoices) {
    if (p.status === "CANCELLED" || !p.supplierInvoiceNo) continue;
    known.push({ docNo: s(p.supplierInvoiceNo), payee: s(p.supplierName), ref: s(p.piNo) });
  }
  return { history, known };
}

export const knownRefLabel = (ref: string): string => (ref.startsWith("DRAFT-") ? "a draft voucher" : ref);

export type ScanLineMeta = { guess: AccountGuess; isTax: boolean };
export type PvCard = PvForm & {
  docType: string;
  duplicateOf: string | null;
  /** Per line: what the account was guessed from (the line's key). */
  meta: Record<string, ScanLineMeta>;
  totalSen: number;
};

export const SST_ACCOUNT = "706-0000";

/** One extracted bill → an editable voucher card. Mirrors the desktop's createTicked inputs. */
export function buildPvCard(doc: FinanceDoc, memory: ScanMemory, coa: CoaAccount[], opts: { today: string; fileName: string }): PvCard | null {
  const printed = (doc.lines ?? []).length ? (doc.lines as { description: string; amountSen: number }[]) : doc.totalSen ? [{ description: doc.docNo || opts.fileName, amountSen: doc.totalSen }] : [];
  if (printed.length === 0) return null;
  const payee = (doc.partyName ?? "").trim();
  const meta: Record<string, ScanLineMeta> = {};
  const lines: PvFormLine[] = linesWithTax(printed, doc.taxSen, doc.totalSen).map((l, i) => {
    const key = `l${i}`;
    if (l.isTax) {
      meta[key] = { guess: null, isTax: true };
      return { key, accountCode: coa.some((a) => a.code === SST_ACCOUNT) || coa.length === 0 ? SST_ACCOUNT : "", description: l.description, amount: senToField(l.amountSen) };
    }
    const guess = guessAccount(memory.history, payee, l.description);
    meta[key] = { guess, isTax: false };
    return { key, accountCode: guess?.accountCode ?? "", description: l.description, amount: senToField(l.amountSen) };
  });
  const dup = findDuplicate(memory.known, doc.docNo, payee);
  return {
    date: opts.today, payee, description: [doc.docType, doc.docNo].filter(Boolean).join(" · ") || opts.fileName,
    billNo: doc.docNo ?? "", billDate: doc.docDate ?? "", notes: "", accrued: false,
    payFrom: defaultBankCode(bankAccounts(coa).map((a) => ({ code: a.code, name: a.name }))), accrualAccount: "", lines,
    docType: doc.docType ?? "", duplicateOf: dup ? knownRefLabel(dup.ref) : null, meta, totalSen: lines.reduce((s, l) => s + (moneyFieldToSen(l.amount) ?? 0), 0),
  };
}

/**
 * After an unknown outcome (a timeout, a dropped response) the server may or may not have made the draft. The create has no
 * idempotency key, so before sending it again look for the same draft in the list: same payee, same bill number, same total,
 * still a DRAFT. Returns it so the caller can adopt it instead of making a second one.
 */
export function findDraftTwin(vouchers: PvRaw[], body: { payee?: unknown; billNo?: unknown; lines?: unknown }): PvRaw | null {
  const payee = normPayee(String(body.payee ?? ""));
  const billNo = normDocNo(String(body.billNo ?? ""));
  const total = ((body.lines as { amountSen?: number }[] | undefined) ?? []).reduce((s, l) => s + (Number(l.amountSen) || 0), 0);
  for (const r of vouchers) {
    if (pvIsVoid(r) || pvState(r) !== "DRAFT" || pvKind(r) !== "EXPENSE") continue;
    if (normPayee(String(r.payee ?? "")) !== payee) continue;
    if (Math.round(Number(r.totalSen) || 0) !== total) continue;
    if (normDocNo(pvBillNo(r)) !== billNo) continue;
    return r;
  }
  return null;
}

export const scanBlockers = (card: PvCard, coa: CoaAccount[]): string[] => {
  const out: string[] = [];
  if (!card.payee.trim()) out.push("Enter the payee.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(card.date)) out.push("Enter the voucher date.");
  if (card.lines.length === 0) out.push("Add at least one line.");
  card.lines.forEach((l, i) => {
    const sen = moneyFieldToSen(l.amount);
    if (sen == null) out.push(`Line ${i + 1}: the amount can't be read.`);
    else if (sen <= 0) out.push(`Line ${i + 1}: enter an amount above zero.`);
    if (!l.accountCode) out.push(`Line ${i + 1}: pick an account.`);
  });
  if (!card.accrued && !card.payFrom) out.push("Pick the bank or cash account it is paid from.");
  if (card.accrued && !card.accrualAccount) out.push("Pick the accrual account.");
  void coa;
  return out;
};
