// ---------------------------------------------------------------------------
// change-log-records.test.mjs — finance backlog item 10, part 2: the finance
// saves that recorded nothing now write an audit row (chart of accounts, the
// other-party register, voucher drafts / approval steps / attachments, every
// void / restore / delete, bank matching and month close, cash-position
// ticks, mappings and numbering, fixed assets, opening-balance invoices, stock
// take) — and the Audit Log's All changes reads them: an action name, the
// reference a record without a number goes by, its amount, before / after
// fields (a patch compares what it sent; a whole stored value shows what was
// removed too; money in RM). Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const m = await import(pathToFileURL(resolve(process.cwd(), "src/lib/change-log.ts")).href);

const audit = (o) => m.auditEvents([{ id: "a1", ts: "2026-10-18T02:00:00.000Z", resource: "bank-reco", resourceId: "310-0010 2026-10-05", action: "match", ...o }])[0];

test("audit rows: the action's own name, an amount when the record carries one, a reference for records with no number", () => {
  const match = audit({ afterJson: JSON.stringify({ amountSen: 120000, legId: "lje-1" }) });
  assert.equal(m.actionLabel(match), "Matched");
  assert.equal(match.amountSen, 120000);
  assert.equal(m.actionLabel(audit({ action: "reject", resource: "payment-vouchers" })), "Sent back");
  assert.equal(m.actionLabel(audit({ action: "update", resource: "chart-of-accounts" })), "Edited", "a standard action reads as its kind");
  assert.equal(audit({ resource: "opening-balance", action: "delete", beforeJson: JSON.stringify({ id: "inv-1", invoiceNo: "INV-OB-001", totalSen: 50000 }) }).amountSen, 50000, "an invoice's total");
  assert.equal(m.payloadRef(audit({ resource: "other-parties", action: "create", afterJson: JSON.stringify({ id: "op-1", name: "A LANDLORD" }) })), "A LANDLORD");
  assert.equal(m.payloadRef(audit({ resource: "opening-balance", action: "delete", beforeJson: JSON.stringify({ id: "pi-1", piNo: "PI-OB-002" }) })), "PI-OB-002");
  assert.equal(m.payloadRef(audit({ resource: "bank-reco", afterJson: JSON.stringify({ amountSen: 1 }) })), null);
});

test("what changed: a patch compares only the fields it sent; a whole stored value shows removals; money in RM", () => {
  // A purchase invoice save sends a patch: the row's other fields did not become blank.
  assert.deepEqual(m.fieldChanges({ id: "pi-1", piNo: "PI-2610-046", supplierInvoiceNo: "F-1", purchaseOrderId: "po-1" }, { supplierInvoiceNo: "F-2" }, "purchase-invoices"), [
    { field: "supplierInvoiceNo", before: "F-1", after: "F-2" },
  ]);
  // A mapping is stored whole: an override taken away shows.
  assert.deepEqual(m.fieldChanges({ "600-1000": "FACTORY_OVERHEAD", "600-1100": "OPERATING_EXPENSE" }, { "600-1000": "DIRECT_LABOUR" }, "finance-settings"), [
    { field: "600-1000", before: "FACTORY_OVERHEAD", after: "DIRECT_LABOUR" },
    { field: "600-1100", before: "OPERATING_EXPENSE", after: "—" },
  ]);
  assert.deepEqual(m.fieldChanges({ FABRIC: "120.00" }, { FABRIC: "130.50", FOAM: "10.00" }, "stock-take"), [
    { field: "FABRIC", before: "120.00", after: "130.50" },
    { field: "FOAM", before: "—", after: "10.00" },
  ]);
  assert.deepEqual(m.fieldChanges({ interestSen: 0 }, { interestSen: 962800 }, "trade-finance"), [{ field: "interestSen", before: "0.00", after: "9,628.00" }]);
  const pv = audit({ resource: "payment-vouchers", resourceId: "pv-1", action: "update", beforeJson: JSON.stringify({ total: "120.00", lines: "600-1000 120.00" }), afterJson: JSON.stringify({ total: "125.00", lines: "600-1000 125.00" }) });
  assert.equal(m.changeSummary(pv), "total: 120.00 → 125.00; lines: 600-1000 120.00 → 600-1000 125.00");
  const setting = audit({ resource: "finance-settings", resourceId: "pnl_section_map", action: "update", beforeJson: JSON.stringify({ a: "X" }), afterJson: JSON.stringify({ a: "Y" }) });
  assert.equal(m.changeSummary(setting), "P&L sections · a: X → Y");
  const tick = { ...audit({ resource: "cash-position", resourceId: "310-0010", action: "tick", afterJson: JSON.stringify({ legId: "lje-9", clearedOn: "2026-10-05" }) }), note: "→ HPV-2610-001" };
  assert.equal(m.changeSummary(tick), "legId: — → lje-9; clearedOn: — → 2026-10-05 · → HPV-2610-001");
});

test("one act, once: a labour unpost is the ledger's undo; the new records name their types", () => {
  const ev = (o) => ({ id: o.id, at: o.at, kind: o.kind, source: o.source, docType: o.docType, docId: o.docId, actorUserId: null, actorName: null, amountSen: null, beforeSen: null, legs: [], action: o.action ?? null, before: null, after: null, reference: null, party: null, note: null });
  const out = m.mergeEvents([
    ev({ id: "L|u", at: "2026-10-09T09:59:00.000Z", kind: "undone", source: "ledger", docType: "labor_post", docId: "labor-2026-07" }),
    ev({ id: "A|u", at: "2026-10-09T09:59:01.000Z", kind: "deleted", source: "audit", docType: "accounting", docId: "labor-2026-07", action: "delete" }),
  ]);
  assert.deepEqual(out.map((e) => e.id), ["L|u"]);
  assert.equal(m.docTypeLabel({ docType: "accounting", docId: "labor-2026-07", source: "audit" }), "Labour posting");
  for (const [docType, label] of [["chart-of-accounts", "Chart of accounts"], ["bank-reco", "Bank reconciliation"], ["cash-position", "Daily cash position"], ["stock-take", "Stock take"], ["fixed-assets", "Fixed asset"], ["payment-vouchers", "Payment voucher"], ["other-parties", "Other party"]]) {
    assert.equal(m.docTypeLabel({ docType, docId: "x", source: "audit" }), label);
  }
  const ladder = m.ladderEvents([{ id: "pv-1", pvNo: "HPV-2610-041", payee: "A BANK ", totalSen: 50, approvedAt: "2026-10-16T02:00:00.000Z", approvedBy: "u-1" }]);
  assert.equal(ladder[0].party, "A BANK", "trimmed");
});

const api = readFileSync("src/api/routes/accounting.ts", "utf8").replace(/\r\n/g, "\n");
const route = (start) => {
  const a = api.indexOf("\n" + start);
  assert.notEqual(a, -1, start);
  const b = api.slice(a + 1).search(/\napp\.(get|post|put|delete)\(/);
  return api.slice(a, b < 0 ? undefined : a + 1 + b);
};

test("every finance save that recorded nothing now writes an audit row", () => {
  const rows = [
    ['app.post("/coa",', /resource: "chart-of-accounts", resourceId: code, action: "create"/],
    ['app.put("/coa",', /resource: "chart-of-accounts", resourceId: code, action: "update", before: rowToCoa\(existing\), after: rowToCoa\(updated!\)/],
    ['app.post("/journals/:id/lifecycle",', /resource: "journals", resourceId: id, action,/],
    ['app.delete("/journals/:id",', /resource: "journals", resourceId: id, action: "delete", before: entry/],
    ['app.post("/other-parties",', /resource: "other-parties", resourceId: id, action: "create"/],
    ['app.put("/other-parties/:id",', /resource: "other-parties", resourceId: id, action: "update", before: rowToOtherParty\(existing\)/],
    ['app.delete("/other-parties/:id",', /resource: "other-parties", resourceId: id, action: "delete", before: gone \? rowToOtherParty\(gone\) : null/],
    ['app.post("/other-party-bills/:billNo/attachments",', /resource: "other-party-bills", resourceId: c\.req\.param\("billNo"\), action: "attach"/],
    ['app.delete("/other-party-bills/:billNo/attachments/:fileId",', /action: "detach"/],
    ['app.delete("/other-party-bills/:billNo",', /resource: "other-party-bills", resourceId: billNo, action: "delete"/],
    ['app.post("/other-party-bills/:billNo/lifecycle",', /resource: "other-party-bills", resourceId: billNo, action, after: \{ state: lc\.newState \}/],
    ['app.post("/other-party-payments/:paymentNo/void",', /resource: "other-party-payments", resourceId: paymentNo, action: "void"/],
    ['app.post("/other-party-payments/:paymentNo/lifecycle",', /resource: "other-party-payments", resourceId: paymentNo, action, after: \{ state: newState \}/],
    ['app.post("/payment-vouchers",', /resource: "payment-vouchers", resourceId: id, action: "create", after: \{ pvNo, \.\.\.\(await pvAuditSnapshot\(c\.var\.DB, id\)\) \}/],
    ['app.put("/payment-vouchers/:id",', /action: "update", before: pvBefore, after: await pvAuditSnapshot\(c\.var\.DB, id\)/],
    ['app.post("/payment-vouchers/:id/approval",', /resource: "payment-vouchers", resourceId: c\.req\.param\("id"\), action, after: \{ pvNo: r\.pvNo, state: r\.state, \.\.\.\(reason \? \{ reason \} : \{\}\) \}/],
    ['app.post("/payment-vouchers/approval-batch",', /if \(r\.ok\) await emitAudit\(c, \{ resource: "payment-vouchers", resourceId: id, action,/],
    ['app.post("/payment-vouchers/:id/lifecycle",', /resource: "payment-vouchers", resourceId: id, action, after: \{ state: lc\.newState \}/],
    ['app.post("/payment-vouchers/:id/attachments",', /resource: "payment-vouchers", resourceId: id, action: "attach"/],
    ['app.post("/official-receipts/:id/lifecycle",', /resource: "official-receipts", resourceId: id, action,/],
    ['app.post("/fund-transfers/:no/lifecycle",', /resource: "fund-transfers", resourceId: no, action,/],
    ['app.put("/fund-transfers/:no/description",', /action: "describe"/],
    ['app.put("/labor/map",', /resource: "finance-settings", resourceId: "labor_account_map", action: "update", before: kvBefore\["labor_account_map"\] \?\? null/],
    ['app.put("/cashflow/map",', /resource: "finance-settings", resourceId: "cashflow_account_map"/],
    ['app.put("/doc-number-prefixes",', /resourceId: "doc_number_prefixes"/],
    ['app.put("/pnl/section-map",', /resourceId: "pnl_section_map"/],
    ['app.put("/bs/section-map",', /resourceId: "bs_section_map"/],
    ['app.put("/bank-reco/strict-lock",', /resourceId: "bank_reco_strict_lock"/],
    ['app.post("/fixed-assets",', /resource: "fixed-assets", resourceId: id, action: "create"/],
    ['app.put("/fixed-assets/:id",', /action: "dispose", before: row/],
    ['app.delete("/fixed-assets/:id",', /resource: "fixed-assets", resourceId: id, action: "delete", before: goneAsset/],
    ['app.post("/bank-reco/match",', /resource: "bank-reco", resourceId: `\$\{line\.accountCode\} \$\{line\.txnDate\}`, action: "match", after: \{ amountSen: line\.amountSen, legId \}/],
    ['app.post("/bank-reco/unmatch",', /action: "unmatch", before: \{ legId: umLine\.matchedLegId \}/],
    ['app.post("/bank-reco/match-group",', /action: "match-group"/],
    ['app.post("/bank-reco/match-split",', /action: "match-split", after: \{ amountSen: line\.amountSen, legIds \}/],
    ['app.post("/bank-reco/automatch",', /if \(matched > 0\) await emitAudit\(c, \{ resource: "bank-reco", resourceId: account, action: "automatch"/],
    ['app.delete("/bank-reco/line/:id",', /action: "line-delete"/],
    ['app.post("/bank-reco/import-session",', /resourceId: `\$\{account\} \$\{month\}`, action: "import"/],
    ['app.post("/bank-reco/ignore",', /action: body\.ignored === false \? "restore-line" : "ignore"/],
    ['app.post("/bank-reco/book-line",', /action: "book-line", after: \{ amountSen: line\.amountSen, docNo \}/],
    ['app.post("/bank-reco/finalize",', /action: "reopen"/],
    ['app.post("/bank-reco/finalize",', /action: "finalize", after: \{ balanced: snap\.balanced \}/],
    ['app.post("/cash-position/tick",', /action: "untick", before: \{ legId \}/],
    ['app.post("/cash-position/tick",', /action: "tick", after: \{ legId, clearedOn \}/],
    ['app.post("/cash-position/planned",', /action: "planned-add"/],
    ['app.delete("/cash-position/planned/:id",', /action: "planned-delete"/],
    ['app.post("/opening-balance/ar",', /resource: "opening-balance", resourceId: String\(invoiceNo\), action: "create"/],
    ['app.delete("/opening-balance/ar/:id",', /resource: "opening-balance", resourceId: id, action: "delete", before: row/],
    ['app.post("/opening-balance/ap",', /resource: "opening-balance", resourceId: String\(piNo\), action: "create"/],
    ['app.delete("/opening-balance/ap/:id",', /resource: "opening-balance", resourceId: id, action: "delete", before: row/],
    ['app.put("/stock-take",', /resource: "stock-take", resourceId: ym, action: "update", before: stBefore, after:/],
    ['app.post("/stock-take-item-alias-seed",', /action: "alias-seed"/],
    ['app.put("/material-opening-stock",', /resource: "material-opening-stock"/],
  ];
  for (const [start, re] of rows) assert.match(route(start), re, start);
  // Recorded after the write succeeded: never before a refusal.
  assert.match(route('app.post("/payment-vouchers/:id/approval",'), /if \(!r\.ok\) return c\.json\(\{ success: false, error: r\.error \}, 400\);\n\s*await emitAudit/);
  // The stock take records the month's figures before the save, in RM.
  assert.match(route('app.put("/stock-take",'), /SELECT item_group, value_sen FROM stock_take WHERE org_id = \? AND ym = \?/);
  // An opening invoice deleted is named by its number.
  assert.match(api, /"SELECT id, invoiceNo, customerId, totalSen, paidAmount, isOpening FROM invoices WHERE id = \?",/);
  assert.match(api, /"SELECT id, piNo, supplierId, amountSen, status, isOpening FROM purchase_invoices WHERE id = \?",/);
});
