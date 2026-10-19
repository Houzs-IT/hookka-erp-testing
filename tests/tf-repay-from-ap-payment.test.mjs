// ---------------------------------------------------------------------------
// tf-repay-from-ap-payment.test.mjs — repaying trade finance from AP Payment
// (finance backlog item 17, owner 2026-10-17 「这个可以做」). The lender
// picked on an AP Payment → its open DRAWDOWNS are the payable lines (balance
// incl. the interest recorded at drawdown, minus what other unposted vouchers
// promise); the voucher takes drawdowns only, no advance; approve / Post now
// posts the same TF_REPAYMENT document the Supplier Payment page posts
// (paymentNo = the voucher's number, DR <TF account> / CR bank), re-checked
// against the balances at that moment. The real functions run against the
// in-memory ledger of tests/_ledger-mock.mjs. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { makeLedgerDb, DEFAULT_COA, ORG } from "./_ledger-mock.mjs";

const acc = await import(pathToFileURL(resolve(process.cwd(), "src/api/routes/accounting.ts")).href);

const LENDER = "sup-lender";
const TF = "310-0020";
const COA = [...DEFAULT_COA, { code: TF, type: "LIABILITY", specialAccountType: null, isPostable: 1 }, { code: "400-0000", type: "LIABILITY", specialAccountType: "SCC", isPostable: 1 }, { code: "900-I004", type: "EXPENSE", specialAccountType: null, isPostable: 1 }];
const coaMap = new Map(COA.map((a) => [a.code, a]));

function world() {
  const db = makeLedgerDb({ coa: COA, kv: { trade_finance_sources: JSON.stringify([{ accountCode: TF, lenderSupplierId: LENDER, lenderName: "A LENDER SDN BHD", tenorDays: 90 }]) } });
  db.st.suppliers.push({ id: LENDER, name: "A LENDER SDN BHD" }, { id: "sup-fabric", name: "A FABRIC CO" });
  // A drawdown: the lender paid a fabric supplier for us (DR 400 / CR TF),
  // plus the interest recorded at drawdown (DR 900-I004 / CR TF).
  db.st.supplierPayments.push({ id: "sp-1", paymentNo: "HPV-2607-001", supplierId: "sup-fabric", supplierName: "A FABRIC CO", date: "2026-07-05", amountSen: 100000, method: "BANK_TRANSFER" });
  db.seedLegs("supplier_payment", "HPV-2607-001", [{ accountCode: "400-0000", debitSen: 100000 }, { accountCode: TF, creditSen: 100000 }]);
  db.seedLegs("tf_interest", "tfint-2026-07-05-HPV-2607-001", [{ accountCode: "900-I004", debitSen: 2000 }, { accountCode: TF, creditSen: 2000 }]);
  db.st.tfDraws.push({ draw_source_id: "HPV-2607-001", account_code: TF, draw_date: "2026-07-05", due_date: "2026-10-03" });
  return db;
}
const pvHeader = (o = {}) => ({ id: "pv-9", pvNo: "HPV-2610-050", date: "2026-10-10", payFrom: "310-0001", partyKind: "SUPPLIER", partyId: LENDER, reference: null, advanceSen: 0, ...o });

test("validate: the lender's lines are its open drawdowns — balance includes the interest at drawdown; no advance", async () => {
  const db = world();
  const ok = await acc.validatePvAp(db, ORG, coaMap, { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 102000 }] }, null);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.v.allocs, [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 102000 }]);
  assert.equal(ok.v.totalSen, 102000);
  const over = await acc.validatePvAp(db, ORG, coaMap, { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 102001 }] }, null);
  assert.equal(over.ok, false);
  assert.match(over.error, /exceeds/);
  const adv = await acc.validatePvAp(db, ORG, coaMap, { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", advanceSen: 500, allocations: [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 1000 }] }, null);
  assert.equal(adv.ok, false);
  assert.match(adv.error, /no advance/);
  const none = await acc.validatePvAp(db, ORG, coaMap, { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [] }, null);
  assert.equal(none.ok, false);
  assert.match(none.error, /drawdown/);
});

test("validate: what another unposted voucher already promises a drawdown is not available twice", async () => {
  const db = world();
  db.st.vouchers.push({ id: "pv-other", pvNo: "DRAFT-1010-01", status: "DRAFT", approvalState: "DRAFT" });
  db.st.pvAllocs.push({ voucher_id: "pv-other", doc_kind: "TF", doc_id: "HPV-2607-001", amount_sen: 60000 });
  const r = await acc.validatePvAp(db, ORG, coaMap, { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 50000 }] }, null);
  assert.equal(r.ok, false, "102,000 − 60,000 promised leaves 42,000");
  assert.match(r.error, /DRAFT-1010-01/);
  const fine = await acc.validatePvAp(db, ORG, coaMap, { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 42000 }] }, null);
  assert.equal(fine.ok, true);
});

test("approve: posts the TF_REPAYMENT document under the voucher's number — DR the TF account, CR the bank", async () => {
  const db = world();
  const r = await acc.pvApSettlementStatements(db, ORG, "user-1", pvHeader(), [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 50000 }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.totalSen, 50000);
  await db.batch(r.statements);
  const row = db.st.supplierPayments.find((p) => p.paymentNo === "HPV-2610-050");
  assert.ok(row, "the settlement row carries the voucher's number");
  assert.equal(row.method, "TF_REPAYMENT");
  assert.equal(row.amountSen, 50000);
  assert.equal(row.supplierId, LENDER);
  assert.deepEqual(db.st.tfAllocs.map((x) => [x.repay_payment_no, x.draw_source_id, x.amount_sen]), [["HPV-2610-050", "HPV-2607-001", 50000]]);
  const legs = db.st.legs.filter((l) => l.sourceId === "HPV-2610-050");
  assert.deepEqual(legs.map((l) => [l.sourceType, l.accountCode, l.debitSen, l.creditSen]), [["supplier_payment", TF, 50000, 0], ["supplier_payment", "310-0001", 0, 50000]]);
  // The drawdown's balance drops by what was repaid.
  const after = await acc.validatePvAp(db, ORG, coaMap, { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 52001 }] }, null);
  assert.equal(after.ok, false, "only 52,000 left");
});

test("approve: re-checked at that moment; never paid from the trade-finance account", async () => {
  const db = world();
  // Repaid elsewhere in the meantime → the voucher's amount no longer fits.
  db.st.tfAllocs.push({ id: "tfa-x", repay_payment_no: "HPV-2609-001", draw_source_id: "HPV-2607-001", amount_sen: 90000 });
  db.st.supplierPayments.push({ id: "sp-r", paymentNo: "HPV-2609-001", supplierId: LENDER, supplierName: "A LENDER SDN BHD", date: "2026-09-01", amountSen: 90000, method: "TF_REPAYMENT" });
  const late = await acc.pvApSettlementStatements(db, ORG, "user-1", pvHeader(), [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 50000 }]);
  assert.equal(late.ok, false);
  assert.match(late.error, /exceeds/);
  const fromTf = await acc.pvApSettlementStatements(world(), ORG, "user-1", pvHeader({ payFrom: TF }), [{ docKind: "TF", docId: "HPV-2607-001", amountSen: 1000 }]);
  assert.equal(fromTf.ok, false);
  assert.match(fromTf.error, /cannot be paid FROM the trade-finance account/);
});

import { readFileSync } from "node:fs";
const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const api = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");

test("screen: the lender's AP Payment lists drawdowns to repay, with no advance box", () => {
  assert.match(ui, /const apTfLender = apBills\?\.tfLender \?\? null;/);
  assert.match(ui, /const apAdvanceSen = apTfLender \? 0 : apSen\(apForm\.advance\);/);
  assert.match(ui, /\{apTfLender \? "Drawdowns to repay" : "Bills to pay"\}/);
  for (const h of ["Drawdown", "For", "Drawn", "Due", "Balance", "Interest (at drawdown)", "Repay (RM)"]) {
    assert.ok(ui.includes(`<th className="px-2.5 py-1.5 text-left">${h}</th>`) || ui.includes(`<th className="px-2.5 py-1.5 text-right">${h}</th>`), h);
  }
  assert.match(ui, /\{apForm\.partyKind === "SUPPLIER" && !apTfLender \? \(/, "no advance for the lender");
  assert.match(ui, /a\.docKind === "TF" \? "trade-finance drawdown"/);
});

test("server: the open drawdowns come from the same loader as Creditor Aging; the print and the list name a drawdown line", () => {
  assert.match(api, /const lender = tfSources\.find\(\(x\) => x\.lenderSupplierId === partyId\);\n\s*if \(lender\) \{\n\s*await ensureTfTables\(db\);\n\s*const \{ draws \} = await loadTfDraws\(db, lender\);/);
  assert.match(api, /tfRepaySen: allocs\.filter\(\(a\) => a\.docKind === "TF"\)\.reduce\(\(s, a\) => s \+ a\.amountSen, 0\),/);
  assert.match(api, /kind === "TF" \? \(a\.docId \?\? a\.doc_id\)/);
});
