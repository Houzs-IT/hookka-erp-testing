// ---------------------------------------------------------------------------
// _ledger-mock.mjs — an in-memory database that reads the SQL the finance
// edit / void / unvoid routes send (official receipts, payment vouchers), so
// tests can run the REAL routes and look at the books afterwards. It enforces
// the real ledger uniqueness (orgId, sourceType, sourceId, legNo) and runs a
// batch all-or-nothing. Unknown SQL throws, naming the statement — a route
// that starts sending something new fails loudly instead of passing over it.
// Shared by tests/official-receipt-edit-flow.test.mjs and
// tests/edit-keeps-bank-match-flow.test.mjs.
// ---------------------------------------------------------------------------
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
const src = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
export const { default: accountingApp } = await import(src("src/api/routes/accounting.ts"));
export const { bankMatchedEditError } = await import(src("src/lib/bank-leg-carry.ts"));

export const ORG = "hookka";

export const DEFAULT_COA = [
  { code: "310-0001", type: "ASSET", specialAccountType: "SBK", isPostable: 1 },
  { code: "310-0002", type: "ASSET", specialAccountType: "SBK", isPostable: 1 },
  { code: "520-0001", type: "INCOME", specialAccountType: null, isPostable: 1 },
  { code: "520-0002", type: "INCOME", specialAccountType: null, isPostable: 1 },
  { code: "900-0001", type: "EXPENSE", specialAccountType: null, isPostable: 1 },
  { code: "900-0002", type: "EXPENSE", specialAccountType: null, isPostable: 1 },
];

export function makeLedgerDb({ coa = DEFAULT_COA, aliases = [], kv = {} } = {}) {
  const st = {
    coa, aliases,
    receipts: [], lines: [], vouchers: [], pvLines: [],
    legs: [], lifecycle: [], stmt: [], splits: [], ticks: [], counter: 1, seq: 0,
    // Trade finance (tests/tf-repay-from-ap-payment.test.mjs).
    kv: new Map(Object.entries(kv)), suppliers: [], supplierPayments: [], tfDraws: [], tfAllocs: [], pvAllocs: [], pis: [],
  };
  const like = (v, pat) => String(v).startsWith(String(pat).replace(/%$/, ""));
  const exec = (rawSql, a, mode) => {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    let m;
    // ── setup / reference data
    if (/^(ALTER TABLE|CREATE (TABLE|INDEX)|UPDATE payment_vouchers SET approval_state = 'APPROVED' WHERE approval_state IS NULL)/.test(sql)) return null;
    if (/^SELECT code, type, specialAccountType, .* FROM chart_of_accounts$/.test(sql)) return st.coa;
    if (/^SELECT oldCode, newCode FROM account_aliases$/.test(sql)) return st.aliases;
    if (/^SELECT value FROM kv_config WHERE key = \?$/.test(sql)) return st.kv.has(a[0]) ? { value: st.kv.get(a[0]) } : null;
    if (/^INSERT INTO kv_config \(key, value, updated_at\)/.test(sql)) {
      // The supplier-payments rev bump names its key in the SQL; others bind it.
      if (/VALUES \('supplier_payments_rev'/.test(sql)) st.kv.set("supplier_payments_rev", a[0]); else st.kv.set(a[0], a[1]);
      return null;
    }
    if (/FROM kv_config/.test(sql)) return mode === "all" ? [] : null;
    // ── trade finance
    if (/^SELECT sourceType, sourceId, debitSen, creditSen FROM ledger_journal_entries WHERE accountCode = \? AND hidden = 0$/.test(sql)) {
      return st.legs.filter((l) => l.accountCode === a[0] && l.hidden === 0);
    }
    if (/^SELECT draw_source_id, draw_date, due_date FROM trade_finance_draws WHERE account_code = \?$/.test(sql)) {
      return st.tfDraws.filter((d) => d.account_code === a[0]).map((d) => ({ drawSourceId: d.draw_source_id, drawDate: d.draw_date, dueDate: d.due_date }));
    }
    if (/^INSERT INTO trade_finance_draws \(draw_source_id, account_code, draw_date, due_date(, org_id)?\)/.test(sql)) {
      if (!st.tfDraws.some((d) => d.draw_source_id === a[0])) st.tfDraws.push({ draw_source_id: a[0], account_code: a[1], draw_date: a[2], due_date: a[3] });
      return null;
    }
    if (/^SELECT repay_payment_no, draw_source_id, amount_sen FROM trade_finance_repay_allocs$/.test(sql)) {
      return st.tfAllocs.map((x) => ({ repayPaymentNo: x.repay_payment_no, drawSourceId: x.draw_source_id, amountSen: x.amount_sen }));
    }
    if (/^INSERT INTO trade_finance_repay_allocs \(id, repay_payment_no, draw_source_id, amount_sen, org_id\)/.test(sql)) {
      st.tfAllocs.push({ id: a[0], repay_payment_no: a[1], draw_source_id: a[2], amount_sen: a[3] });
      return null;
    }
    if (/^SELECT DISTINCT paymentNo FROM supplier_payments WHERE method = 'TF_REPAYMENT'$/.test(sql)) {
      return [...new Set(st.supplierPayments.filter((p) => p.method === "TF_REPAYMENT").map((p) => p.paymentNo))].map((paymentNo) => ({ paymentNo }));
    }
    if (/^SELECT date FROM supplier_payments WHERE paymentNo = \? LIMIT 1$/.test(sql)) return st.supplierPayments.find((p) => p.paymentNo === a[0]) ?? null;
    if (/^SELECT date FROM supplier_payments WHERE payment_no = \? LIMIT 1$/.test(sql)) return st.supplierPayments.find((p) => p.paymentNo === a[0]) ?? null;
    if (/^SELECT date FROM fund_transfers WHERE transfer_no = \?$/.test(sql)) return null;
    if (/^SELECT paymentNo, supplierName FROM supplier_payments WHERE paymentNo IN \(/.test(sql)) {
      return st.supplierPayments.filter((p) => a.includes(p.paymentNo)).map((p) => ({ paymentNo: p.paymentNo, supplierName: p.supplierName }));
    }
    if (/^INSERT INTO supplier_payments \( id, paymentNo, supplierId, supplierName, purchaseInvoiceId, date, amountSen, bookedSen, foreignSen, payFxRate, method, reference, notes, orgId \) VALUES \(\?, \?, \?, \?, NULL, \?, \?, \?, NULL, NULL, 'TF_REPAYMENT', \?, \?, \?\)$/.test(sql)) {
      const [id, paymentNo, supplierId, supplierName, date, amountSen, bookedSen, reference] = a;
      st.supplierPayments.push({ id, paymentNo, supplierId, supplierName, purchaseInvoiceId: null, date, amountSen, bookedSen, method: "TF_REPAYMENT", reference });
      return null;
    }
    if (/^SELECT id, name FROM suppliers WHERE id = \?$/.test(sql)) return st.suppliers.find((x) => x.id === a[0]) ?? null;
    if (/^SELECT name FROM suppliers WHERE id = \?$/.test(sql)) return st.suppliers.find((x) => x.id === a[0]) ?? null;
    // ── purchase invoices (a supplier payment that settles them)
    if (/^SELECT id, pi_no, amount_sen, paid_amount_sen, status, currency, fx_rate, supplier_id, supplier_name FROM purchase_invoices WHERE id = \?$/.test(sql)) {
      return st.pis.find((p) => p.id === a[0]) ?? null;
    }
    if (/^SELECT id, pi_no, supplier_invoice_no, invoice_date, due_date, amount_sen, paid_amount_sen, status, currency, is_opening, fx_rate FROM purchase_invoices WHERE supplier_id = \? AND status IN \('CONFIRMED','APPROVED','PARTIAL_PAID'\) ORDER BY invoice_date ASC, pi_no ASC$/.test(sql)) {
      return st.pis.filter((p) => p.supplier_id === a[0] && ["CONFIRMED", "APPROVED", "PARTIAL_PAID"].includes(p.status));
    }
    if (/^SELECT COALESCE\(SUM\(sp\.amount_sen\), 0\) AS adv_sen FROM supplier_payments sp/.test(sql)) return { adv_sen: 0 };
    if (/^UPDATE purchase_invoices SET paid_amount_sen = paid_amount_sen \+ \?, status = CASE/.test(sql)) {
      const p = st.pis.find((x) => x.id === a[3]);
      p.paid_amount_sen += a[0];
      p.status = p.paid_amount_sen >= p.amount_sen ? "PAID" : p.paid_amount_sen > 0 ? "PARTIAL_PAID" : p.status;
      return null;
    }
    if (/^INSERT INTO supplier_payments \( id, paymentNo, supplierId, supplierName, purchaseInvoiceId, date, amountSen, bookedSen, foreignSen, payFxRate, method, reference, notes, orgId \) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\)$/.test(sql)) {
      const [id, paymentNo, supplierId, supplierName, purchaseInvoiceId, date, amountSen, bookedSen, foreignSen, payFxRate, method, reference] = a;
      st.supplierPayments.push({ id, paymentNo, supplierId, supplierName, purchaseInvoiceId, date, amountSen, bookedSen, foreignSen, payFxRate, method, reference });
      return null;
    }
    if (/^INSERT INTO supplier_payments \( id, paymentNo, supplierId, supplierName, purchaseInvoiceId, date, amountSen, bookedSen, foreignSen, payFxRate, method, reference, notes, orgId \) VALUES \(\?, \?, \?, \?, NULL, \?, \?, \?, NULL, NULL, \?, \?, \?, \?\)$/.test(sql)) {
      const [id, paymentNo, supplierId, supplierName, date, amountSen, bookedSen, method, reference] = a;
      st.supplierPayments.push({ id, paymentNo, supplierId, supplierName, purchaseInvoiceId: null, date, amountSen, bookedSen, method, reference });
      return null;
    }
    // ── a supplier payment edited in place (restate) — Confirm bank amount
    // (tests/fx-confirm-bank.test.mjs) runs the real builder.
    if (/^SELECT 1 AS x FROM supplier_payments WHERE payment_no = \? AND method = 'TF_REPAYMENT' LIMIT 1$/.test(sql)) {
      return st.supplierPayments.some((p) => p.paymentNo === a[0] && p.method === "TF_REPAYMENT") ? { x: 1 } : null;
    }
    if (/^SELECT purchaseInvoiceId, booked_sen, amount_sen, supplierId, supplierName, date FROM supplier_payments WHERE payment_no = \? AND COALESCE\(method,''\) <> 'CREDIT_NOTE'$/.test(sql)) {
      return st.supplierPayments.filter((p) => p.paymentNo === a[0] && p.method !== "CREDIT_NOTE")
        .map((p) => ({ purchaseInvoiceId: p.purchaseInvoiceId, bookedSen: p.bookedSen, amountSen: p.amountSen, supplierId: p.supplierId, supplierName: p.supplierName, date: p.date }));
    }
    if (/^SELECT purchaseInvoiceId, booked_sen, amount_sen, foreign_sen, date, reference FROM supplier_payments WHERE payment_no = \? AND COALESCE\(method,''\) <> 'CREDIT_NOTE'$/.test(sql)) {
      return st.supplierPayments.filter((p) => p.paymentNo === a[0] && p.method !== "CREDIT_NOTE")
        .map((p) => ({ purchaseInvoiceId: p.purchaseInvoiceId, bookedSen: p.bookedSen, amountSen: p.amountSen, foreignSen: p.foreignSen ?? null, date: p.date, reference: p.reference }));
    }
    if (/^UPDATE purchase_invoices SET paid_amount_sen = GREATEST\(0, paid_amount_sen - \?\), status = CASE/.test(sql)) {
      const p = st.pis.find((x) => x.id === a[3]);
      const after = p.paid_amount_sen - a[0];
      p.status = after <= 0 ? "CONFIRMED" : after < p.amount_sen ? "PARTIAL_PAID" : "PAID";
      p.paid_amount_sen = Math.max(0, after);
      return null;
    }
    if (/^DELETE FROM supplier_payments WHERE payment_no = \? AND COALESCE\(method,''\) <> 'CREDIT_NOTE' AND purchaseInvoiceId IS NOT NULL$/.test(sql)) {
      st.supplierPayments = st.supplierPayments.filter((p) => !(p.paymentNo === a[0] && p.method !== "CREDIT_NOTE" && p.purchaseInvoiceId));
      return null;
    }
    if (/^UPDATE purchase_invoices SET paid_amount_sen = \( SELECT COALESCE\(SUM\(sp\.booked_sen\), 0\) FROM supplier_payments sp/.test(sql)) {
      // The truth guard: paid = what the live payments booked on it.
      const p = st.pis.find((x) => x.id === a[0]);
      const live = (no) => (st.lifecycle.find((l) => l.sourceType === "supplier_payment" && l.sourceId === no)?.state ?? "ACTIVE") === "ACTIVE";
      const paid = st.supplierPayments.filter((s) => s.purchaseInvoiceId === p.id && live(s.paymentNo)).reduce((s, x) => s + x.bookedSen, 0);
      p.status = paid >= p.amount_sen ? "PAID" : paid > 0 ? "PARTIAL_PAID" : ["PAID", "PARTIAL_PAID"].includes(p.status) ? "CONFIRMED" : p.status;
      p.paid_amount_sen = paid;
      return null;
    }
    // ── chart of accounts (an account created on first use)
    if (/^INSERT INTO chart_of_accounts \(code, name, type, parentCode, balanceSen, isActive, cashFlowCategory, specialAccountType, pnlCategory, isPostable\) VALUES \(\?, \?, 'EXPENSE', \?, 0, 1, NULL, NULL, NULL, 1\) ON CONFLICT \(code\) DO NOTHING$/.test(sql)) {
      if (!st.coa.some((x) => x.code === a[0])) st.coa.push({ code: a[0], name: a[1], type: "EXPENSE", specialAccountType: null, isPostable: 1, parentCode: a[2] });
      return null;
    }
    if (/^SELECT name FROM chart_of_accounts WHERE code = \?$/.test(sql)) { const x = st.coa.find((c) => c.code === a[0]); return x ? { name: x.name ?? "" } : null; }
    if (/^SELECT a\.voucher_id, a\.doc_kind, a\.doc_id, a\.amount_sen, v\.pvNo FROM payment_voucher_allocs a JOIN payment_vouchers v ON v\.id = a\.voucher_id WHERE v\.status <> 'VOID' AND COALESCE\(v\.approval_state, 'APPROVED'\) <> 'APPROVED'$/.test(sql)) {
      return st.pvAllocs.map((x) => ({ ...x, v: st.vouchers.find((v) => v.id === x.voucher_id) }))
        .filter((x) => x.v && x.v.status !== "VOID" && (x.v.approvalState ?? "APPROVED") !== "APPROVED")
        .map((x) => ({ voucherId: x.voucher_id, docKind: x.doc_kind, docId: x.doc_id, amountSen: x.amount_sen, pvNo: x.v.pvNo }));
    }
    if (/^INSERT INTO doc_no_counters/.test(sql)) { st.counter += 1; return { next_no: st.counter }; }
    if (/^INSERT INTO audit_events/.test(sql) || /^SELECT displayName FROM users/.test(sql)) return null;
    // ── ledger
    if (/^SELECT rowHash FROM ledger_journal_entries WHERE orgId = \? ORDER BY postedAt DESC, id DESC LIMIT 1$/.test(sql)) return st.legs.length ? { rowHash: st.legs[st.legs.length - 1].rowHash } : null;
    if (/^SELECT pg_advisory_xact_lock/.test(sql)) return null;
    if (/^INSERT INTO ledger_journal_entries \(/.test(sql)) {
      const [id, sourceType, sourceId, legNo, accountCode, debitSen, creditSen, description, prevHash, rowHash, actorUserId, orgId] = a;
      if (st.legs.some((l) => l.orgId === orgId && l.sourceType === sourceType && l.sourceId === sourceId && l.legNo === legNo)) {
        throw new Error(`duplicate ledger leg ${sourceType}/${sourceId}/${legNo}`);
      }
      st.legs.push({ id, sourceType, sourceId, legNo, accountCode, debitSen, creditSen, description, prevHash, rowHash, actorUserId, orgId, hidden: 0, postedAt: String(++st.seq).padStart(6, "0") });
      return null;
    }
    if ((m = /^SELECT id, accountCode, debitSen, creditSen FROM ledger_journal_entries WHERE sourceId = \? AND orgId = \? AND hidden = 0 AND sourceType LIKE '([^']+)'$/.exec(sql))) {
      return st.legs.filter((l) => l.sourceId === a[0] && l.orgId === a[1] && l.hidden === 0 && like(l.sourceType, m[1]));
    }
    if (/^SELECT sourceType, MIN\(postedAt\) AS first_at FROM ledger_journal_entries WHERE sourceId = \? AND orgId = \? AND sourceType LIKE \? GROUP BY sourceType$/.test(sql)) {
      const fams = new Map();
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && like(l.sourceType, a[2])) if (!fams.has(l.sourceType) || l.postedAt < fams.get(l.sourceType)) fams.set(l.sourceType, l.postedAt);
      return [...fams].map(([sourceType, first_at]) => ({ sourceType, firstAt: first_at }));
    }
    if ((m = /^UPDATE ledger_journal_entries SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE ('([^']+)'|\?)( AND sourceType <> \?)?$/.exec(sql))) {
      const pat = m[1] === "?" ? a[2] : m[2];
      const not = m[3] ? a[m[1] === "?" ? 3 : 2] : null;
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && like(l.sourceType, pat) && (not === null || l.sourceType !== not)) l.hidden = 1;
      return null;
    }
    if (/^UPDATE ledger_journal_entries SET hidden = 0 WHERE sourceId = \? AND orgId = \? AND sourceType = \?$/.test(sql)) {
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && l.sourceType === a[2]) l.hidden = 0;
      return null;
    }
    if (/^UPDATE ledger_journal_entries SET hidden = \? WHERE sourceType = \? AND sourceId = \? AND orgId = \?$/.test(sql)) {
      for (const l of st.legs) if (l.sourceType === a[1] && l.sourceId === a[2] && l.orgId === a[3]) l.hidden = a[0];
      return null;
    }
    if (/^SELECT id FROM ledger_journal_entries WHERE orgId = \? AND sourceType = \? AND sourceId = \? LIMIT 1$/.test(sql)) {
      return st.legs.find((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]) ?? null;
    }
    if (/^SELECT accountCode, debitSen, creditSen, legNo FROM ledger_journal_entries WHERE sourceType IN \(.*\) AND sourceId = \? AND orgId = \? ORDER BY legNo$/.test(sql)) {
      const types = a.slice(0, -2), [sid, org] = a.slice(-2);
      return st.legs.filter((l) => types.includes(l.sourceType) && l.sourceId === sid && l.orgId === org).sort((x, y) => x.legNo - y.legNo);
    }
    // ── document lifecycle
    if (/^SELECT state FROM document_lifecycle WHERE orgId = \? AND sourceType = \? AND sourceId = \?$/.test(sql)) {
      const row = st.lifecycle.find((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]);
      return row ? { state: row.state } : null;
    }
    if (/^INSERT INTO document_lifecycle/.test(sql)) {
      const [, sourceType, sourceId, state, , , orgId] = a;
      const row = st.lifecycle.find((l) => l.orgId === orgId && l.sourceType === sourceType && l.sourceId === sourceId);
      if (row) row.state = state; else st.lifecycle.push({ orgId, sourceType, sourceId, state });
      return null;
    }
    // ── bank side
    if (/^SELECT matchedLegId FROM bank_statement_lines WHERE matchedLegId IN \(/.test(sql)) return st.stmt.filter((s) => a.includes(s.matchedLegId)).map((s) => ({ matchedLegId: s.matchedLegId }));
    if (/^SELECT leg_id FROM bank_line_leg_splits WHERE leg_id IN \(/.test(sql)) return st.splits.filter((s) => a.includes(s.leg_id)).map((s) => ({ legId: s.leg_id }));
    if (/^SELECT leg_id FROM bank_board_cleared WHERE leg_id IN \(/.test(sql)) return st.ticks.filter((s) => a.includes(s.leg_id)).map((s) => ({ legId: s.leg_id }));
    if (/^UPDATE bank_statement_lines SET matchedLegId = \? WHERE matchedLegId = \?$/.test(sql)) { for (const s of st.stmt) if (s.matchedLegId === a[1]) s.matchedLegId = a[0]; return null; }
    if (/^UPDATE bank_line_leg_splits SET leg_id = \? WHERE leg_id = \?$/.test(sql)) { for (const s of st.splits) if (s.leg_id === a[1]) s.leg_id = a[0]; return null; }
    if (/^UPDATE bank_board_cleared SET leg_id = \? WHERE leg_id = \?$/.test(sql)) { for (const s of st.ticks) if (s.leg_id === a[1]) s.leg_id = a[0]; return null; }
    // ── official receipts
    if (/^INSERT INTO official_receipts \(/.test(sql)) {
      const [id, orNo, date, receivedFrom, description, payTo, totalSen] = a;
      st.receipts.push({ id, orNo, date, receivedFrom, description, payTo, totalSen, status: "POSTED" });
      return null;
    }
    if (/^INSERT INTO official_receipt_lines \(/.test(sql)) {
      const [id, receiptId, accountCode, description, amountSen, lineOrder] = a;
      st.lines.push({ id, receiptId, accountCode, description, amountSen, lineOrder });
      return null;
    }
    if (/^SELECT \* FROM official_receipts WHERE id = \?$/.test(sql) || /^SELECT id, orNo, (date, )?status FROM official_receipts WHERE id = \?$/.test(sql)) {
      return st.receipts.find((r) => r.id === a[0]) ?? null;
    }
    if (/^UPDATE official_receipts SET date = \?, receivedFrom = \?, description = \?, payTo = \?, totalSen = \?, updated_at = \? WHERE id = \?$/.test(sql)) {
      Object.assign(st.receipts.find((x) => x.id === a[6]), { date: a[0], receivedFrom: a[1], description: a[2], payTo: a[3], totalSen: a[4] });
      return null;
    }
    if (/^UPDATE official_receipts SET status = \?, updated_at = \? WHERE id = \?$/.test(sql)) { st.receipts.find((x) => x.id === a[2]).status = a[0]; return null; }
    if (/^DELETE FROM official_receipt_lines WHERE receiptId = \?$/.test(sql)) { st.lines = st.lines.filter((l) => l.receiptId !== a[0]); return null; }
    if (/^SELECT accountCode, description, amountSen FROM official_receipt_lines WHERE receiptId = \? ORDER BY lineOrder$/.test(sql)) return st.lines.filter((l) => l.receiptId === a[0]);
    if (/^SELECT official_receipts\.\*, dl\.state AS lifecycleState FROM official_receipts LEFT JOIN document_lifecycle dl/.test(sql)) {
      return st.receipts.map((r) => ({ ...r, lifecycleState: st.lifecycle.find((l) => l.sourceType === "official_receipt" && l.sourceId === r.id)?.state ?? null }));
    }
    if (/^SELECT \* FROM official_receipt_lines ORDER BY lineOrder$/.test(sql)) return [...st.lines].sort((x, y) => x.lineOrder - y.lineOrder);
    // ── payment vouchers
    if (/^SELECT id, pvNo, (date, )?status, approval_state, pv_kind(, party_kind)? FROM payment_vouchers WHERE id = \?$/.test(sql)) {
      const v = st.vouchers.find((x) => x.id === a[0]);
      return v ? { id: v.id, pvNo: v.pvNo, date: v.date ?? null, status: v.status, approvalState: v.approvalState, pvKind: v.pvKind ?? null, partyKind: null } : null;
    }
    if (/^UPDATE payment_vouchers SET date = \?, payee = \?, description = \?, payFrom = \?, accrued = \?, accrualAccount = \?, settledAt = NULL, productLine = \?, totalSen = \?, notes = \?, bill_no = \?, bill_date = \?, (reference = \?, )?status = 'POSTED', updated_at = \? WHERE id = \?$/.test(sql)) {
      // (+ reference since 2026-10-19 — the id is the last bind either way.)
      Object.assign(st.vouchers.find((x) => x.id === a[a.length - 1]), { date: a[0], payee: a[1], description: a[2], payFrom: a[3], totalSen: a[7] });
      return null;
    }
    if (/^UPDATE payment_vouchers SET status = \? WHERE id = \?$/.test(sql)) { st.vouchers.find((x) => x.id === a[1]).status = a[0]; return null; }
    if (/^SELECT \* FROM payment_vouchers WHERE id = \?$/.test(sql)) return st.vouchers.find((x) => x.id === a[0]) ?? null;
    if (/^UPDATE payment_vouchers SET fx_rate = \?, totalSen = \?, fx_bank_confirmed_at = \?, fx_bank_confirmed_by = \?, updated_at = \? WHERE id = \?$/.test(sql)) {
      Object.assign(st.vouchers.find((x) => x.id === a[5]), { fxRate: a[0], totalSen: a[1], fxBankConfirmedAt: a[2], fxBankConfirmedBy: a[3] });
      return null;
    }
    if (/^UPDATE payment_vouchers SET fx_bank_confirmed_at = \?, fx_bank_confirmed_by = \?, updated_at = \? WHERE id = \?$/.test(sql)) {
      Object.assign(st.vouchers.find((x) => x.id === a[3]), { fxBankConfirmedAt: a[0], fxBankConfirmedBy: a[1] });
      return null;
    }
    if (/^DELETE FROM payment_voucher_lines WHERE voucherId = \?$/.test(sql)) { st.pvLines = st.pvLines.filter((l) => l.voucherId !== a[0]); return null; }
    if (/^INSERT INTO payment_voucher_lines \(id, voucherId, accountCode, description, amountSen, lineOrder\) VALUES/.test(sql)) {
      const [id, voucherId, accountCode, description, amountSen, lineOrder] = a;
      st.pvLines.push({ id, voucherId, accountCode, description, amountSen, lineOrder });
      return null;
    }
    throw new Error(`unmocked SQL: ${sql}`);
  };
  const prepare = (sql) => {
    const mk = (args) => ({
      sql, args,
      bind: (...b) => mk(b),
      first: async () => exec(sql, args, "first"),
      all: async () => ({ results: exec(sql, args, "all") ?? [] }),
      run: async () => { exec(sql, args, "run"); return { success: true }; },
    });
    return mk([]);
  };
  const batch = async (stmts) => {
    const snap = structuredClone(st);
    try { for (const s of stmts) exec(s.sql, s.args, "run"); } catch (e) { Object.assign(st, snap); throw e; }
    return stmts.map(() => ({ success: true }));
  };
  // Seed a posted document's legs the way its poster writes them.
  const seedLegs = (sourceType, sourceId, legs) => {
    legs.forEach((l, i) => st.legs.push({ id: l.id ?? `lje-seed-${sourceId}-${i + 1}`, sourceType, sourceId, legNo: i + 1, accountCode: l.accountCode, debitSen: l.debitSen ?? 0, creditSen: l.creditSen ?? 0, description: "", prevHash: "", rowHash: `h${++st.seq}`, actorUserId: null, orgId: ORG, hidden: 0, postedAt: String(st.seq).padStart(6, "0") }));
  };
  return { st, prepare, batch, seedLegs };
}

export function mountAccounting(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => { c.set("DB", db); c.set("orgId", ORG); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "user-1"); await next(); });
  parent.route("/", accountingApp);
  return parent;
}

export const post = (app, path, body) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// The books as the reports read them: visible legs only, per account.
export const visible = (st, id) => st.legs.filter((l) => l.sourceId === id && l.hidden === 0);
export const balances = (st, id) => {
  const b = {};
  for (const l of visible(st, id)) b[l.accountCode] = (b[l.accountCode] ?? 0) + l.debitSen - l.creditSen;
  for (const k of Object.keys(b)) if (b[k] === 0) delete b[k];
  return b;
};
