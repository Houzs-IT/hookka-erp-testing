// ---------------------------------------------------------------------------
// Supplier Discount: restore a cancelled note (owner 2026-10-20, from the
// design list 「要」). Restore posts it again as it stood — the supplier owes
// its amount less again, fresh legs under a stamped restate source (DR
// 400-0000 / CR the mapped purchase account), the cancelled set kept hidden;
// its old knock-offs against bills are not put back. Cancelling it again
// reverses the restored legs (a second, stamped reversal — the first cancel's
// purchase_credit_note_void already holds legs 1..n). Made-up figures only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try { register("tsx/esm", pathToFileURL("./")); } catch { /* native type-stripping */ }
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
const src = (p) => pathToFileURL(resolve(process.cwd(), p)).href;
const { default: accountingApp } = await import(src("src/api/routes/accounting.ts"));
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// A cancelled note: posted (legs 1..2), then cancelled (void legs), all hidden.
const ITEMS = JSON.stringify([{ materialCode: null, description: "Rebate", quantity: 1, unitPriceSen: 25000, lineType: "OTHER" }]);
function makeDb() {
  const st = {
    note: { id: "pcn-1", noteNumber: "PCN-0001", supplierId: "sup-1", supplierName: "Test Supplier", purchaseInvoiceId: null, piNo: null, date: "2026-09-15", reason: "", reasonDetail: "", items: ITEMS, totalAmount: 25000, status: "CANCELLED" },
    outstanding: 100000,
    legs: [
      { sourceType: "purchase_credit_note", sourceId: "pcn-1", legNo: 1, accountCode: "400-0000", debitSen: 25000, creditSen: 0, hidden: 1, orgId: "hookka" },
      { sourceType: "purchase_credit_note", sourceId: "pcn-1", legNo: 2, accountCode: "704-0010", debitSen: 0, creditSen: 25000, hidden: 1, orgId: "hookka" },
      { sourceType: "purchase_credit_note_void", sourceId: "pcn-1", legNo: 1, accountCode: "400-0000", debitSen: 0, creditSen: 25000, hidden: 1, orgId: "hookka" },
      { sourceType: "purchase_credit_note_void", sourceId: "pcn-1", legNo: 2, accountCode: "704-0010", debitSen: 25000, creditSen: 0, hidden: 1, orgId: "hookka" },
    ],
    audits: [],
  };
  const exec = (raw, a, mode) => {
    const s = raw.replace(/\s+/g, " ").trim();
    if (/^ALTER TABLE/.test(s) || /^SELECT 1 FROM pg_constraint/.test(s)) return mode === "all" ? [] : null;
    if (/FROM kv_config/.test(s)) return mode === "all" ? [] : null;
    if (s === "SELECT * FROM purchase_credit_notes WHERE id = ?") return a[0] === st.note.id ? { ...st.note } : null;
    if (/^UPDATE purchase_credit_notes SET status = '(POSTED|CANCELLED)', updatedAt = \? WHERE id = \?$/.test(s)) { st.note.status = s.match(/'(POSTED|CANCELLED)'/)[1]; return null; }
    if (s === "UPDATE suppliers SET outstandingSen = GREATEST(0, outstandingSen - ?) WHERE id = ?") { st.outstanding = Math.max(0, st.outstanding - a[0]); return null; }
    if (s === "UPDATE suppliers SET outstandingSen = outstandingSen + ? WHERE id = ?") { st.outstanding += a[0]; return null; }
    // The purchase-line → account mapping (purchase-invoices.ts): no materials, no map → the default purchase account 704-0010.
    if (/FROM raw_materials|FROM material_groups|FROM stock_account_map|purchase_account|FROM chart_of_accounts/.test(s)) return mode === "all" ? [] : null;
    if (/^SELECT accountCode, debitSen, creditSen FROM ledger_journal_entries WHERE hidden = 0 AND sourceType LIKE 'purchase_credit_note%' AND sourceId = \? AND orgId = \?$/.test(s)) {
      return st.legs.filter((l) => l.hidden === 0 && l.sourceType.startsWith("purchase_credit_note") && l.sourceId === a[0] && l.orgId === a[1]);
    }
    if (/^SELECT id FROM ledger_journal_entries WHERE orgId = \? AND sourceType = \? AND sourceId = \? LIMIT 1$/.test(s)) {
      return st.legs.some((l) => l.orgId === a[0] && l.sourceType === a[1] && l.sourceId === a[2]) ? { id: "x" } : null;
    }
    if (/^SELECT rowHash FROM ledger_journal_entries/.test(s) || /^SELECT pg_advisory_xact_lock/.test(s)) return null;
    if (/^INSERT INTO ledger_journal_entries/.test(s)) {
      if (st.legs.some((l) => l.orgId === a[11] && l.sourceType === a[1] && l.sourceId === a[2] && l.legNo === a[3])) throw new Error("duplicate (orgId, sourceType, sourceId, legNo)");
      st.legs.push({ sourceType: a[1], sourceId: a[2], legNo: a[3], accountCode: a[4], debitSen: a[5], creditSen: a[6], hidden: 0, orgId: a[11] });
      return null;
    }
    if (/^UPDATE ledger_journal_entries SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE 'purchase_credit_note%' AND sourceType <> \?$/.test(s)) {
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && l.sourceType.startsWith("purchase_credit_note") && l.sourceType !== a[2]) l.hidden = 1;
      return null;
    }
    if (/^UPDATE ledger_journal_entries SET hidden = 1 WHERE sourceId = \? AND orgId = \? AND sourceType LIKE 'purchase_credit_note%'$/.test(s)) {
      for (const l of st.legs) if (l.sourceId === a[0] && l.orgId === a[1] && l.sourceType.startsWith("purchase_credit_note")) l.hidden = 1;
      return null;
    }
    if (/^SELECT id, purchase_invoice_id, booked_sen FROM supplier_payments WHERE paymentNo = \? AND method = 'CREDIT_NOTE' AND orgId = \?$/.test(s)) return [];
    if (/^SELECT displayName FROM users/.test(s)) return null;
    if (/^INSERT INTO audit_events/.test(s)) { st.audits.push({ resourceId: a[5], action: a[6] }); return null; }
    throw new Error(`fake db: unknown SQL: ${s}`);
  };
  const prepare = (sql) => {
    let args = [];
    const stmt = {
      bind(...x) { args = x; return stmt; },
      async first() { return exec(sql, args, "first"); },
      async all() { return { results: exec(sql, args, "all") ?? [] }; },
      async run() { exec(sql, args, "run"); return { success: true }; },
    };
    return stmt;
  };
  return { db: { prepare, batch: async (stmts) => { for (const x of stmts) await x.run(); return []; } }, st };
}

function mount(db) {
  const parent = new Hono();
  parent.use("*", async (c, next) => {
    c.set("DB", db); c.set("orgId", "hookka"); c.set("userRole", "SUPER_ADMIN"); c.set("userId", "user-1");
    await next();
  });
  parent.route("/api/accounting", accountingApp);
  return async (path) => {
    const res = await parent.request(`/api/accounting${path}`, { method: "POST", headers: { "Content-Type": "application/json" } }, {});
    return { status: res.status, body: await res.json() };
  };
}

const live = (st) => st.legs.filter((l) => l.hidden === 0);
const net = (legs, code) => legs.filter((l) => l.accountCode === code).reduce((s, l) => s + l.debitSen - l.creditSen, 0);

test("Restore: posted again as it stood — the supplier owes less again, fresh live legs, the cancelled set still hidden", async () => {
  const { db, st } = makeDb();
  const call = mount(db);
  const r = await call("/purchase-credit-notes/pcn-1/restore");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(st.note.status, "POSTED");
  assert.equal(st.outstanding, 75000, "100,000 − 25,000");
  const l = live(st);
  assert.equal(l.length, 2);
  assert.ok(l.every((x) => /^purchase_credit_note_restate_post:\d+$/.test(x.sourceType)), "a stamped restate source — dated on the note");
  assert.equal(net(l, "400-0000"), 25000, "DR 400-0000");
  assert.equal(net(l, "704-0010"), -25000, "CR the purchase account");
  assert.equal(st.legs.filter((x) => x.hidden === 1).length, 4, "the original and its cancel stay hidden");
  assert.deepEqual(st.audits, [{ resourceId: "pcn-1", action: "restore" }]);
  // Only a cancelled note can be restored.
  const again = await call("/purchase-credit-notes/pcn-1/restore");
  assert.equal(again.status, 409);
  assert.match(again.body.error, /Only a cancelled supplier discount can be restored \(PCN-0001 is POSTED\)/);
});

test("Cancel after a Restore: the restored legs are reversed under a second, stamped reversal; nothing stays live", async () => {
  const { db, st } = makeDb();
  const call = mount(db);
  assert.equal((await call("/purchase-credit-notes/pcn-1/restore")).status, 200);
  const r = await call("/purchase-credit-notes/pcn-1/void");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(st.note.status, "CANCELLED");
  assert.equal(st.outstanding, 100000, "back where it was");
  assert.equal(live(st).length, 0, "nothing of the note stays visible");
  const revs = st.legs.filter((x) => /^purchase_credit_note_restate_rev:\d+$/.test(x.sourceType));
  assert.equal(revs.length, 2, "the restored pair mirrored once");
  // Every leg the note ever posted nets to nothing.
  assert.equal(net(st.legs, "400-0000"), 0);
  assert.equal(net(st.legs, "704-0010"), 0);
});

test("the page: a Restore on a cancelled row (the tab's buttons still never read Void or Delete)", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const tab = ui.slice(ui.indexOf("function SupplierDiscountTab"), ui.indexOf("\nfunction ", ui.indexOf("function SupplierDiscountTab") + 1));
  assert.match(tab, /\{n\.status === "CANCELLED" && \(\n\s+<button onClick=\{\(\) => restoreNote\(n\)\}[^>]*>Restore<\/button>/);
  assert.match(tab, /fetch\(`\/api\/accounting\/purchase-credit-notes\/\$\{encodeURIComponent\(row\.id\)\}\/restore`/);
  assert.match(tab, /The bills it was once knocked off stay as they are now\./);
  assert.doesNotMatch(tab, />Void</);
  assert.doesNotMatch(tab, />Delete</);
});
