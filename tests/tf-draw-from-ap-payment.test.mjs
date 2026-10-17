// ---------------------------------------------------------------------------
// tf-draw-from-ap-payment.test.mjs — drawing trade finance from AP Payment,
// with the interest recorded at drawdown (finance backlog item 17 part 2,
// owner 2026-10-17 「这个可以做」 + 「a, 提款时就记」).
//
// Paid from = the trade-finance line on an ordinary supplier's AP Payment:
// the voucher validates (supplier only, not the lender; due date defaults to
// payment date + tenor; interest ≥ 0); approve / Post now posts the supplier
// payment from the TF line (DR creditors · CR TF), the drawdown's due date,
// and the interest (DR 900-I004 · CR TF, dated the payment day) in the SAME
// entry chain; the new drawdown is then repayable with its interest. The
// real functions run against the in-memory ledger. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { makeLedgerDb, DEFAULT_COA, ORG } from "./_ledger-mock.mjs";

const acc = await import(pathToFileURL(resolve(process.cwd(), "src/api/routes/accounting.ts")).href);

const LENDER = "sup-lender";
const TF = "310-0020";
const COA = [...DEFAULT_COA, { code: TF, type: "LIABILITY", specialAccountType: null, isPostable: 1 }, { code: "400-0000", type: "LIABILITY", specialAccountType: "SCC", isPostable: 1 }];
const coaMap = () => new Map(COA.map((a) => [a.code, a]));

function world() {
  const db = makeLedgerDb({ coa: COA.map((a) => ({ ...a })), kv: { trade_finance_sources: JSON.stringify([{ accountCode: TF, lenderSupplierId: LENDER, lenderName: "A LENDER SDN BHD", tenorDays: 90 }]) } });
  db.st.suppliers.push({ id: LENDER, name: "A LENDER SDN BHD" }, { id: "sup-fabric", name: "A FABRIC CO" });
  db.st.pis.push({ id: "pi-1", pi_no: "PI-2610-001", supplier_invoice_no: "F-77", invoice_date: "2026-10-01", due_date: null, amount_sen: 100000, paid_amount_sen: 0, status: "CONFIRMED", currency: "MYR", fx_rate: 1, supplier_id: "sup-fabric", supplier_name: "A FABRIC CO", is_opening: 0 });
  return db;
}
const body = (o = {}) => ({ partyKind: "SUPPLIER", partyId: "sup-fabric", payFrom: TF, date: "2026-10-10", allocations: [{ docKind: "PI", docId: "pi-1", amountSen: 80000 }], ...o });

test("validate: an ordinary supplier may be paid from the trade-finance line; due date defaults to date + tenor", async () => {
  const r = await acc.validatePvAp(world(), ORG, coaMap(), body({ tfInterestSen: 1500 }), null);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.v.payFrom, TF);
  assert.deepEqual(r.v.tf, { dueDate: "2027-01-08", interestSen: 1500 });
  const typed = await acc.validatePvAp(world(), ORG, coaMap(), body({ tfDueDate: "2026-12-31" }), null);
  assert.deepEqual(typed.v.tf, { dueDate: "2026-12-31", interestSen: 0 });
  const bank = await acc.validatePvAp(world(), ORG, coaMap(), body({ payFrom: "310-0001" }), null);
  assert.equal(bank.v.tf, null, "a bank payment is not a drawdown");
});

test("validate: never the lender, never an other creditor, due date not before the payment, no negative interest", async () => {
  const lender = await acc.validatePvAp(world(), ORG, coaMap(), body({ partyId: LENDER, allocations: [] }), null);
  assert.equal(lender.ok, false);
  assert.match(lender.error, /lender is repaid from a bank account/);
  const other = await acc.validatePvAp(world(), ORG, coaMap(), body({ partyKind: "OTHER", partyId: "op-1" }), null);
  assert.equal(other.ok, false);
  assert.match(other.error, /Only a supplier can be paid through trade finance/);
  const early = await acc.validatePvAp(world(), ORG, coaMap(), body({ tfDueDate: "2026-10-01" }), null);
  assert.equal(early.ok, false);
  assert.match(early.error, /before the payment date/);
  const neg = await acc.validatePvAp(world(), ORG, coaMap(), body({ tfInterestSen: -1 }), null);
  assert.equal(neg.ok, false);
});

test("approve: the payment from the TF line, the due date and the interest at drawdown — one entry chain", async () => {
  const db = world();
  const r = await acc.pvApSettlementStatements(db, ORG, "user-1", {
    id: "pv-1", pvNo: "PV-2610-009", date: "2026-10-10", payFrom: TF, partyKind: "SUPPLIER", partyId: "sup-fabric",
    reference: "DD-1015", advanceSen: 0, tfDueDate: "2027-01-08", tfInterestSen: 1500,
  }, [{ docKind: "PI", docId: "pi-1", amountSen: 80000 }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.totalSen, 80000);
  const before = db.st.legs.length;
  await db.batch(r.statements);
  const posted = db.st.legs.slice(before);
  assert.deepEqual(posted.map((l) => [l.sourceType, l.sourceId, l.accountCode, l.debitSen, l.creditSen]), [
    ["supplier_payment", "PV-2610-009", "400-0000", 80000, 0],
    ["supplier_payment", "PV-2610-009", TF, 0, 80000],
    ["tf_interest", "tfint-2026-10-10-PV-2610-009", "900-I004", 1500, 0],
    ["tf_interest", "tfint-2026-10-10-PV-2610-009", TF, 0, 1500],
  ]);
  for (let i = 1; i < posted.length; i++) assert.equal(posted[i].prevHash, posted[i - 1].rowHash, `leg ${i + 1} chains on leg ${i} (no fork)`);
  assert.ok(db.st.coa.some((a) => a.code === "900-I004" && a.name === "INTEREST ON TRADE FINANCE"), "the interest account is created on first use");
  assert.deepEqual(db.st.tfDraws.map((d) => [d.draw_source_id, d.account_code, d.draw_date, d.due_date]), [["PV-2610-009", TF, "2026-10-10", "2027-01-08"]]);
  assert.equal(db.st.pis[0].paid_amount_sen, 80000);
  assert.equal(db.st.pis[0].status, "PARTIAL_PAID");
  // The drawdown is now repayable, interest included (Part 1's lender lines).
  const full = await acc.validatePvAp(db, ORG, coaMap(), { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [{ docKind: "TF", docId: "PV-2610-009", amountSen: 81500 }] }, null);
  assert.equal(full.ok, true, JSON.stringify(full));
  const over = await acc.validatePvAp(db, ORG, coaMap(), { partyKind: "SUPPLIER", partyId: LENDER, payFrom: "310-0001", allocations: [{ docKind: "TF", docId: "PV-2610-009", amountSen: 81501 }] }, null);
  assert.equal(over.ok, false);
});

test("approve: no interest → no interest legs and no interest account touched; a bank payment writes no drawdown", async () => {
  const db = world();
  const r = await acc.pvApSettlementStatements(db, ORG, "user-1", {
    id: "pv-2", pvNo: "PV-2610-010", date: "2026-10-10", payFrom: TF, partyKind: "SUPPLIER", partyId: "sup-fabric",
    reference: null, advanceSen: 0, tfDueDate: null, tfInterestSen: 0,
  }, [{ docKind: "PI", docId: "pi-1", amountSen: 10000 }]);
  await db.batch(r.statements);
  assert.equal(db.st.legs.filter((l) => l.sourceType === "tf_interest").length, 0);
  assert.ok(!db.st.coa.some((a) => a.code === "900-I004"));
  assert.deepEqual(db.st.tfDraws.map((d) => d.due_date), ["2027-01-08"], "blank due date → payment date + tenor");
  const db2 = world();
  const b = await acc.pvApSettlementStatements(db2, ORG, "user-1", {
    id: "pv-3", pvNo: "HPV-2610-011", date: "2026-10-10", payFrom: "310-0001", partyKind: "SUPPLIER", partyId: "sup-fabric",
    reference: null, advanceSen: 0, tfInterestSen: 999,
  }, [{ docKind: "PI", docId: "pi-1", amountSen: 10000 }]);
  await db2.batch(b.statements);
  assert.equal(db2.st.tfDraws.length, 0);
  assert.equal(db2.st.legs.filter((l) => l.sourceType === "tf_interest").length, 0, "interest only on a drawdown");
});

const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
const blk = readFileSync("src/pages/accounting/tabs/TradeFinanceBlock.tsx", "utf8").replace(/\r\n/g, "\n");
const api = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");

test("screen: Paid from offers the TF line for an ordinary supplier; due date + interest at drawdown; sent with the voucher", () => {
  assert.match(ui, /\{apForm\.partyKind === "SUPPLIER" && !apTfLender && tfLines\.filter\(\(t\) => t\.lenderSupplierId !== apForm\.partyId\)\.map\(\(t\) => \(/);
  assert.match(ui, /<span className="font-semibold">Drawing on trade finance<\/span>/);
  assert.match(ui, /<label className=\{fieldLabel\}>Due date \*<\/label>/);
  assert.match(ui, /<label className=\{fieldLabel\}>Interest at drawdown \(RM\)<\/label>/);
  assert.match(ui, /\.\.\.\(apTfDraw \? \{ tfDueDate: apForm\.tfDue \|\| tfAddDays\(apForm\.date, apTfDraw\.tenorDays\), tfInterestSen: apSen\(apForm\.tfInterest\) \} : \{\}\),/);
  assert.match(ui, /placeholder=\{apTfDraw \? "Bank's drawdown no\." : "e\.g\. TT ref, cheque no"\}/);
});

test("Creditor Aging: interest keyed later is still dated on the drawdown day; one interest-leg builder", () => {
  assert.match(blk, /void saveCharge\("interest", d\.drawSourceId, e\.target\.value, d\.drawDate\);/);
  assert.match(blk, /\? \{ drawSourceId, interestSen: sen, \.\.\.\(drawDate && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(drawDate\) \? \{ date: drawDate \} : \{\}\) \}/);
  assert.match(api, /const legs = tfInterestLegs\(\{ drawSourceId, accountCode, chargeDate, deltaSen, legNoBase, actorUserId, orgId \}\);/);
  assert.match(api, /extraLegs = tfInterestLegs\(\{ drawSourceId: pv\.pvNo, accountCode: drawSrc\.accountCode, chargeDate: pv\.date, deltaSen: pv\.tfInterestSen \?\? 0, legNoBase: 1, actorUserId, orgId \}\);/);
});
