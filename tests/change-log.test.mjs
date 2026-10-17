// ---------------------------------------------------------------------------
// change-log.test.mjs — the Audit Log's "All changes" (finance backlog item
// 10, the design's "a full Audit Log of every change"). One dated list of who
// changed what in Finance, from the ledger (postings, edits with their legs
// before and after, voids, restores, undos), the payment-voucher ladder, the
// document lifecycle and the audit trail — one act seen by two trails listed
// once. Pure core src/lib/change-log.ts; route GET /api/accounting/change-log;
// screen src/pages/accounting/tabs/AuditLogTab.tsx. Made-up figures.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const m = await import(pathToFileURL(resolve(process.cwd(), "src/lib/change-log.ts")).href);

test("timestamps: Postgres text, app ISO, Date and zone-less times all become one UTC ISO form", () => {
  assert.equal(m.toIso("2026-10-16 09:38:03.509172+00"), "2026-10-16T09:38:03.509Z");
  assert.equal(m.toIso("2026-10-16T09:38:03.509Z"), "2026-10-16T09:38:03.509Z");
  assert.equal(m.toIso("2026-10-16 17:38:03+08"), "2026-10-16T09:38:03.000Z");
  assert.equal(m.toIso("2026-10-16T09:38:03"), "2026-10-16T09:38:03.000Z", "no zone = the server's UTC");
  assert.equal(m.toIso(new Date("2026-10-16T09:38:03.000Z")), "2026-10-16T09:38:03.000Z");
  assert.equal(m.toIso(""), null);
  assert.equal(m.toIso("not a time"), null);
});

test("a month is Malaysia time; the SQL pre-filter is a day wider either side", () => {
  assert.deepEqual(m.monthWindowMy("2026-10"), { from: "2026-09-30T16:00:00.000Z", to: "2026-10-31T16:00:00.000Z" });
  assert.deepEqual(m.monthWindowMy("2026-12"), { from: "2026-11-30T16:00:00.000Z", to: "2026-12-31T16:00:00.000Z" });
  assert.deepEqual(m.sqlDayBounds("2026-10"), { lo: "2026-09-29", hi: "2026-11-01" });
  const w = m.monthWindowMy("2026-10");
  assert.equal(m.inWindow(m.toIso("2026-09-30 16:00:00+00"), w), true, "00:00 on 1 Oct in Malaysia");
  assert.equal(m.inWindow(m.toIso("2026-09-30 15:59:59+00"), w), false, "still 30 Sep in Malaysia");
  assert.equal(m.myTime("2026-10-17T18:05:00.000Z"), "18 Oct 2026 02:05");
});

test("what a ledger source type says: posted, edited (with its side and stamp), voided, restored, undone, an edit adjustment", () => {
  assert.deepEqual(m.classifyLedger("payment_voucher", "pv-1"), { kind: "posted", base: "payment_voucher", docId: "pv-1", side: null, stamp: null });
  assert.deepEqual(m.classifyLedger("supplier_payment_restate_rev:1760000000000", "HPV-2610-001"), { kind: "edited", base: "supplier_payment", docId: "HPV-2610-001", side: "before", stamp: "1760000000000" });
  assert.deepEqual(m.classifyLedger("supplier_payment_restate_post:1760000000000", "HPV-2610-001"), { kind: "edited", base: "supplier_payment", docId: "HPV-2610-001", side: "after", stamp: "1760000000000" });
  assert.equal(m.classifyLedger("purchase_invoice_restate_post", "pi-1").stamp, null, "a GL re-sync has no stamp");
  assert.deepEqual(m.classifyLedger("purchase_invoice", "pi-1:edit-1760000000000"), { kind: "edited", base: "purchase_invoice", docId: "pi-1", side: null, stamp: null });
  assert.equal(m.classifyLedger("invoice_void", "inv-1").kind, "voided");
  assert.equal(m.classifyLedger("invoice_void", "inv-1").base, "invoice");
  assert.equal(m.classifyLedger("purchase_invoice_unvoid", "pi-1").kind, "restored");
  assert.equal(m.classifyLedger("labor_post_reversal", "lab-2026-09").kind, "undone");
  assert.equal(m.classifyLedger("labor_post_reversal", "lab-2026-09").base, "labor_post");
});

const leg = (o) => ({ accountCode: "600-1000", debitSen: 0, creditSen: 0, description: "", actorUserId: "u-1", postedAt: "2026-10-05 02:00:00.1+00", ...o });

test("ledger events: one per posting; an edit pairs its reversal with its re-post (amount before → after)", () => {
  const ev = m.ledgerEvents([
    leg({ sourceType: "payment_voucher", sourceId: "pv-1", debitSen: 12000, description: "HPV-2610-001 · Rent" }),
    leg({ sourceType: "payment_voucher", sourceId: "pv-1", accountCode: "310-0010", creditSen: 12000 }),
    // Edited three days later: the old entry reversed, the new one posted.
    leg({ sourceType: "payment_voucher_restate_rev:1760000000000", sourceId: "pv-1", accountCode: "310-0010", debitSen: 12000, postedAt: "2026-10-08 03:00:00+00" }),
    leg({ sourceType: "payment_voucher_restate_rev:1760000000000", sourceId: "pv-1", creditSen: 12000, postedAt: "2026-10-08 03:00:00+00" }),
    leg({ sourceType: "payment_voucher_restate_post:1760000000000", sourceId: "pv-1", accountCode: "600-1100", debitSen: 12500, postedAt: "2026-10-08 03:00:00+00" }),
    leg({ sourceType: "payment_voucher_restate_post:1760000000000", sourceId: "pv-1", accountCode: "310-0010", creditSen: 12500, postedAt: "2026-10-08 03:00:00+00" }),
    // A purchase invoice edit's adjustment, and a void.
    leg({ sourceType: "purchase_invoice", sourceId: "pi-1:edit-1760000000001", debitSen: 300, postedAt: "2026-10-09 01:00:00+00" }),
    leg({ sourceType: "purchase_invoice", sourceId: "pi-1:edit-1760000000001", accountCode: "400-0000", creditSen: 300, postedAt: "2026-10-09 01:00:00+00" }),
    leg({ sourceType: "invoice_void", sourceId: "inv-1", accountCode: "500-0000", debitSen: 5000, postedAt: "2026-10-10 01:00:00+00", actorUserId: null }),
    leg({ sourceType: "invoice_void", sourceId: "inv-1", accountCode: "300-0000", creditSen: 5000, postedAt: "2026-10-10 01:00:00+00", actorUserId: "u-2" }),
  ]);
  const by = Object.fromEntries(ev.map((e) => [`${e.kind}|${e.docId}`, e]));
  assert.equal(ev.length, 4);
  assert.equal(by["posted|pv-1"].amountSen, 12000);
  assert.equal(by["posted|pv-1"].at, "2026-10-05T02:00:00.100Z");
  const edit = by["edited|pv-1"];
  assert.equal(edit.beforeSen, 12000);
  assert.equal(edit.amountSen, 12500);
  assert.deepEqual(edit.legs.map((l) => [l.side, l.accountCode]), [["before", "310-0010"], ["before", "600-1000"], ["after", "600-1100"], ["after", "310-0010"]]);
  assert.equal(by["edited|pi-1"].beforeSen, null, "an adjustment has no 'before'");
  assert.equal(by["edited|pi-1"].amountSen, 300);
  assert.equal(by["voided|inv-1"].actorUserId, "u-2", "the first actor found");
  // The same document posted twice (a re-post at another time) = two events.
  const two = m.ledgerEvents([leg({ sourceType: "closing_stock", sourceId: "cs-2026-09-a", debitSen: 1 }), leg({ sourceType: "closing_stock", sourceId: "cs-2026-09-a", debitSen: 1, postedAt: "2026-10-06 02:00:00+00" })]);
  assert.equal(two.length, 2);
});

test("lifecycle, ladder and audit rows become events", () => {
  const life = m.lifecycleEvents([
    { sourceType: "payment_voucher", sourceId: "pv-2", state: "DELETED", actionAt: "2026-10-11T01:00:00.000Z", actorUserId: "u-1" },
    { sourceType: "supplier_payment", sourceId: "HPV-2610-004", state: "ACTIVE", actionAt: "2026-10-12T01:00:00.000Z", actorUserId: "u-1" },
    { sourceType: "supplier_payment", sourceId: "HPV-2610-005", state: "VOID", actionAt: null },
  ]);
  assert.deepEqual(life.map((e) => [e.kind, e.docId]), [["deleted", "pv-2"], ["restored", "HPV-2610-004"]]);
  const ladder = m.ladderEvents([
    { id: "pv-3", pvNo: "HPV-2610-007", payee: "A LANDLORD", totalSen: 9000, preparedAt: "2026-10-01T01:00:00.000Z", preparedBy: "u-1", checkedAt: "2026-10-01T02:00:00.000Z", checkedBy: "u-2", approvedAt: null },
    { id: "pv-4", pvNo: "DRAFT-1001-01", totalSen: 100, preparedAt: "2026-10-02T01:00:00.000Z", preparedBy: "u-1" },
  ]);
  assert.deepEqual(ladder.map((e) => [e.kind, e.docId, e.reference, e.actorUserId]), [["prepared", "pv-3", "HPV-2610-007", "u-1"], ["checked", "pv-3", "HPV-2610-007", "u-2"], ["prepared", "pv-4", null, "u-1"]], "a draft number is not a reference");
  assert.equal(ladder[0].party, "A LANDLORD");
  assert.equal(ladder[0].amountSen, 9000);
  const audit = m.auditEvents([
    { id: "a1", ts: "2026-10-13 01:00:00.5+00", actorUserId: "u-1", actorUserName: "Chew", resource: "accounting", resourceId: "fg_valuation_mode", action: "update", beforeJson: "{\"mode\":\"auto\"}", afterJson: "{\"mode\":\"stock_take_only\"}" },
    { id: "a2", ts: "2026-10-13 02:00:00+00", resource: "trade-finance", resourceId: "PV-2610-002", action: "draw-due-edit", beforeJson: "{bad", afterJson: null },
  ]);
  assert.deepEqual(audit.map((e) => [e.kind, e.action, e.actorName]), [["edited", "update", "Chew"], ["changed", "draw-due-edit", null]]);
  assert.deepEqual(audit[0].after, { mode: "stock_take_only" });
  assert.equal(audit[1].before, null, "unreadable JSON is dropped, not thrown");
});

const ev = (o) => ({ id: o.id, at: o.at, kind: o.kind, source: o.source, docType: o.docType ?? "supplier_payment", docId: o.docId, actorUserId: o.actorUserId ?? null, actorName: o.actorName ?? null, amountSen: o.amountSen ?? null, beforeSen: null, legs: [], action: o.action ?? null, before: null, after: null, reference: o.reference ?? null, party: null });

test("one act, once: the ledger's row is kept; the lifecycle and audit rows of the same act are dropped", () => {
  const at = "2026-10-15T02:56:00.000Z";
  const out = m.mergeEvents([
    ev({ id: "A|1", at: "2026-10-15T02:56:05.000Z", kind: "voided", source: "audit", docType: "supplier-payments", docId: "HPV-2610-020", actorUserId: "u-9", actorName: "Finance" }),
    ev({ id: "D|1", at: "2026-10-15T02:56:04.000Z", kind: "voided", source: "lifecycle", docId: "HPV-2610-020" }),
    ev({ id: "L|1", at, kind: "voided", source: "ledger", docId: "HPV-2610-020", amountSen: 5000 }),
  ]);
  assert.deepEqual(out.map((e) => e.id), ["L|1"]);
  assert.equal(out[0].actorUserId, "u-9", "the kept row takes the actor the others knew");
  assert.equal(out[0].actorName, "Finance");
  // A second void (no new ledger entry): the lifecycle row stays, its audit twin goes.
  const again = m.mergeEvents([
    ev({ id: "A|2", at: "2026-10-16T01:00:01.000Z", kind: "voided", source: "audit", docId: "HPV-2610-020" }),
    ev({ id: "D|2", at: "2026-10-16T01:00:00.000Z", kind: "voided", source: "lifecycle", docId: "HPV-2610-020" }),
  ]);
  assert.deepEqual(again.map((e) => e.id), ["D|2"]);
});

test("one act, once: matched by document id OR number; a 'created' is a 'posted'; other acts and later times stay", () => {
  const out = m.mergeEvents([
    // A purchase invoice created (audit) and posted (ledger) together.
    ev({ id: "L|pi", at: "2026-10-16T04:40:21.000Z", kind: "posted", source: "ledger", docType: "purchase_invoice", docId: "pi-1", reference: "PI-2610-001" }),
    ev({ id: "A|pi", at: "2026-10-16T04:40:21.500Z", kind: "created", source: "audit", docType: "purchase-invoices", docId: "pi-1" }),
    // An official receipt edited: the audit row names its number, the ledger its id.
    ev({ id: "L|or", at: "2026-10-14T01:00:00.000Z", kind: "edited", source: "ledger", docType: "official_receipt", docId: "or-1", reference: "HOR-2610-002" }),
    ev({ id: "A|or", at: "2026-10-14T01:00:01.000Z", kind: "edited", source: "audit", docType: "accounting", docId: "HOR-2610-002" }),
    // The same invoice edited 15 minutes later without a posting: its own row.
    ev({ id: "A|pi2", at: "2026-10-16T04:55:00.000Z", kind: "edited", source: "audit", docType: "purchase-invoices", docId: "pi-1" }),
    // A different act on the same document at the same time: its own row.
    ev({ id: "A|pi3", at: "2026-10-16T04:40:22.000Z", kind: "deleted", source: "audit", docType: "purchase-invoices", docId: "pi-1" }),
  ]);
  assert.deepEqual(out.map((e) => e.id), ["A|pi2", "A|pi3", "L|pi", "L|or"], "newest first");
});

test("what changed: fields before → after (time stamps left out); an edit's amount, or the accounts it moved", () => {
  assert.deepEqual(m.fieldChanges({ mode: "auto", updatedAt: "x" }, { mode: "stock_take_only", updatedAt: "y" }), [{ field: "mode", before: "auto", after: "stock_take_only" }]);
  assert.deepEqual(m.fieldChanges(null, { a: 1 }), [{ field: "a", before: "—", after: "1" }], "a creation lists what it was recorded with");
  assert.deepEqual(m.fieldChanges(null, null), []);
  const amountEdit = { ...ev({ id: "x", at: "2026-10-01T00:00:00.000Z", kind: "edited", source: "ledger", docId: "pv-1" }), beforeSen: 100000, amountSen: 125000 };
  assert.equal(m.changeSummary(amountEdit), "Amount 1,000.00 → 1,250.00");
  const moved = { ...amountEdit, beforeSen: 12000, amountSen: 12000, legs: [
    { side: "before", accountCode: "600-1000", debitSen: 12000, creditSen: 0, description: "" },
    { side: "before", accountCode: "310-0010", debitSen: 0, creditSen: 12000, description: "" },
    { side: "after", accountCode: "600-1100", debitSen: 12000, creditSen: 0, description: "" },
    { side: "after", accountCode: "310-0010", debitSen: 0, creditSen: 12000, description: "" },
  ] };
  assert.equal(m.changeSummary(moved), "Accounts: 600-1000 −120.00, 600-1100 +120.00");
  assert.equal(m.changeSummary({ ...amountEdit, beforeSen: null }), "Adjustment posted");
  const setting = { ...ev({ id: "a", at: "2026-10-01T00:00:00.000Z", kind: "edited", source: "audit", docType: "accounting", docId: "fg_valuation_mode", action: "update" }), before: { mode: "auto" }, after: { mode: "stock_take_only" } };
  assert.equal(m.changeSummary(setting), "Finished goods valuation · mode: auto → stock_take_only");
  const tf = { ...ev({ id: "t", at: "2026-10-01T00:00:00.000Z", kind: "changed", source: "audit", docType: "trade-finance", docId: "PV-2610-002", action: "draw-due-edit" }), before: { dueDate: "2026-12-01" }, after: { dueDate: "2026-12-15" } };
  assert.equal(m.changeSummary(tf), "Due date · dueDate: 2026-12-01 → 2026-12-15");
  assert.equal(m.docTypeLabel({ docType: "accounting", docId: "OCB-2610-003", source: "audit" }), "Other party bill");
  assert.equal(m.docTypeLabel({ docType: "accounting", docId: "opening-date", source: "audit" }), "Finance setting");
  assert.equal(m.docTypeLabel({ docType: "accounting", docId: "440-0040", source: "audit" }), "Chart of accounts", "POST /coa/rename names the new code");
  assert.equal(m.docTypeLabel({ docType: "accounting", docId: "pi-4e1c6620", source: "audit" }), "Opening balance · purchase invoice");
  assert.equal(m.docTypeLabel({ docType: "accounting", docId: "inv-e8f054d2", source: "audit" }), "Opening balance · sales invoice");
  assert.equal(m.docTypeLabel({ docType: "accounting", docId: "grn-1", source: "audit" }), "Landed cost");
  assert.equal(m.docTypeLabel({ docType: "tf_interest", docId: "tfint-x", source: "ledger" }), "Trade finance interest");
  assert.equal(m.docTypeLabel({ docType: "some_new_thing", docId: "x", source: "ledger" }), "Some new thing");
});

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const api = read("src/api/routes/accounting.ts");
const ui = read("src/pages/accounting/tabs/AuditLogTab.tsx");
const slice = (src, from, to) => { const a = src.indexOf(from); assert.notEqual(a, -1, from); const b = src.indexOf(to, a + 1); return src.slice(a, b === -1 ? undefined : b); };

test("GET /change-log: read-only, org-scoped, the month in Malaysia time, every trail, one act once", () => {
  const ep = slice(api, 'app.get("/change-log", async (c) => {', "// GET /other-party-aging");
  assert.match(ep, /requirePermission\(c, "accounting", "read"\)/);
  assert.match(ep, /const ym = \/\^\\d\{4\}-\\d\{2\}\$\/\.test\(q\) \? q : runningMonthYm\(\);/);
  assert.match(ep, /FROM ledger_journal_entries WHERE orgId = \? AND postedAt >= \? AND postedAt < \?/, "hidden legs included — an edited-away entry is history");
  assert.match(ep, /FROM document_lifecycle WHERE orgId = \? AND actionAt >= \? AND actionAt < \?/);
  assert.match(ep, /WHERE \(prepared_at >= \? AND prepared_at < \?\) OR \(checked_at >= \? AND checked_at < \?\) OR \(approved_at >= \? AND approved_at < \?\)/);
  assert.match(ep, /WHERE \(orgId = \? OR orgId IS NULL\) AND resource IN/);
  assert.match(ep, /\]\.filter\(\(e\) => inWindow\(e\.at, w\)\);/);
  assert.match(ep, /const merged = mergeEvents\(events\);/);
  assert.match(ep, /warnings\.push\(`\$\{label\} could not be read`\);/, "a trail that cannot be read is said, not hidden");
  assert.doesNotMatch(ep, /\b(INSERT|UPDATE|DELETE)\b/, "nothing written");
  assert.match(api, /const CHANGE_LOG_RESOURCES = \["accounting", "trade-finance", "supplier-payments", "other-party-payments", "payments", "invoices", "purchase-invoices", "credit-notes", "debit-notes"\];/);
});

test("screen: All changes (default, by month) beside Voided & deleted; double-click shows the change", () => {
  assert.match(ui, /const \[view, setView\] = useState<AuditView>\("all"\);/);
  assert.match(ui, /\{ key: "all", label: "All changes"/);
  assert.match(ui, /\{ key: "voided", label: "Voided & deleted"/);
  assert.match(ui, /\{view === "all" && <PeriodStepper value=\{month\} options=\{monthOpts\} onChange=\{setMonth\} today=\{today\} \/>\}/);
  assert.match(ui, /fetch\(`\/api\/accounting\/change-log\?month=\$\{month\}`\)/);
  assert.match(ui, /const rows = data && data\.month === month \? data\.rows : null;/, "never the last month's rows");
  assert.match(ui, /gridId="accounting-change-log"/);
  assert.match(ui, /onDoubleClick=\{\(r\) => setOpen\(r\)\}/);
  for (const h of ["When", "Who", "Action", "Type", "Reference", "Party", "Amount", "What changed"]) assert.ok(ui.includes(`label: "${h}"`), h);
  assert.match(ui, /\{ key: "before", title: "Before — the entry reversed" \}, \{ key: "after", title: "After — the entry posted" \}/);
  assert.match(ui, /useEscapeClose\(onClose\);/);
});
