// ---------------------------------------------------------------------------
// ar-invoices.test.mjs — AR Invoices (owner 2026-10-21 「我没发现ar invoice 在我的
// debtor part」 / 「这个other debtor bill 里面…我希望只有bill，然后…ar invoice
// 一起放进来，像creditor 的ap invoice」 → 「可以」): sales invoices and
// other-debtor bills in one list, the debtor twin of AP Invoices. An invoice
// dated before the books opened is Before opening and owes nothing here, so
// the open figures match Debtor Aging. Receive opens Receipts with the
// document ticked. The real route runs on a small in-memory database. Made-up
// figures only.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeLedgerDb, mountAccounting } from "./_ledger-mock.mjs";

void makeLedgerDb; // the shared mock is loaded for its module registration (tsx + aliases)

// A tiny database that answers the three reads GET /ar-invoices makes.
function arDb({ bills = [], invoices = [], openingDate = null } = {}) {
  const exec = (sql, args, mode) => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/FROM other_party_bills b/.test(s)) return bills.filter((b) => b.orgId === args[0]);
    if (/FROM invoices WHERE status <> 'DRAFT'/.test(s)) return invoices.filter((i) => i.status !== "DRAFT");
    if (/^SELECT value FROM kv_config WHERE key = \?$/.test(s)) return args[0] === "opening_date" && openingDate ? { value: openingDate } : null;
    if (/^INSERT INTO audit_events/.test(s)) return null;
    throw new Error(`unmocked SQL: ${s}`);
  };
  const prepare = (sql) => {
    const mk = (args) => ({
      bind: (...b) => mk(b),
      first: async () => exec(sql, args, "first"),
      all: async () => ({ results: exec(sql, args, "all") ?? [] }),
      run: async () => ({ success: true }),
    });
    return mk([]);
  };
  return { prepare, batch: async () => [] };
}

const bill = (o) => ({ id: "b1", billNo: "ODB-2610-001", partyId: "op1", partyName: "A RELATED COMPANY", billDate: "2026-10-16", referenceNo: "R-1", description: "charge back", totalSen: 65260, paidAmountSen: 0, status: "OPEN", lifecycleState: null, orgId: "hookka", ...o });
const inv = (o) => ({ id: "i1", invoiceNo: "INV-2610-001", customerId: "c1", customerName: "A CUSTOMER", doNo: "DO-2610-001", invoiceDate: "2026-10-05", dueDate: "2026-11-04", totalSen: 100000, paidAmount: 0, status: "SENT", isOpening: 0, ...o });

test("the list: sales invoices and other-debtor bills, each with its own status; before-opening invoices owe nothing here", async () => {
  const db = arDb({
    openingDate: "2026-05-22",
    bills: [bill({}), bill({ id: "b2", billNo: "ODB-2608-001", totalSen: 50000, paidAmountSen: 50000, billDate: "2026-08-20" }), bill({ id: "b3", billNo: "ODB-2609-001", lifecycleState: "VOID", billDate: "2026-09-01" })],
    invoices: [
      inv({}),
      inv({ id: "i2", invoiceNo: "INV-2609-010", invoiceDate: "2026-09-10", totalSen: 30000, paidAmount: 10000, status: "PARTIAL_PAID" }),
      inv({ id: "i3", invoiceNo: "INV-2604-001", invoiceDate: "2026-04-01", totalSen: 20000, paidAmount: 0, status: "SENT" }),
      inv({ id: "i4", invoiceNo: "INV-2604-002", invoiceDate: "2026-04-02", totalSen: 20000, paidAmount: 0, status: "SENT", isOpening: 1 }),
      inv({ id: "i5", invoiceNo: "INV-2610-002", status: "CANCELLED" }),
      inv({ id: "i6", invoiceNo: "INV-2610-003", status: "PAID", paidAmount: 100000 }),
      inv({ id: "i7", invoiceNo: "INV-2610-004", status: "DRAFT" }),
    ],
  });
  const res = await mountAccounting(db).request("/ar-invoices");
  const j = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  const by = Object.fromEntries(j.data.rows.map((r) => [r.no, [r.kind, r.status, r.outstandingSen]]));
  assert.deepEqual(by, {
    "ODB-2610-001": ["OD", "OPEN", 65260],
    "ODB-2608-001": ["OD", "PAID", 0],
    "ODB-2609-001": ["OD", "CANCELLED", 0],
    "INV-2610-001": ["INV", "OPEN", 100000],
    "INV-2609-010": ["INV", "OPEN", 20000],
    "INV-2604-001": ["INV", "BEFORE_OPENING", 0],
    "INV-2604-002": ["INV", "OPEN", 20000],
    "INV-2610-002": ["INV", "CANCELLED", 0],
    "INV-2610-003": ["INV", "PAID", 0],
  }, "a draft is never listed; an opening invoice keyed as such is owed like any other");
  assert.deepEqual(j.data.totals, { openSen: 205260, openCount: 4, invOpenSen: 140000, odOpenSen: 65260 });
  const first = j.data.rows.find((r) => r.no === "INV-2610-001");
  assert.deepEqual([first.customer, first.partyId, first.ref, first.dueDate, first.receivedSen], ["A CUSTOMER", "c1", "DO-2610-001", "2026-11-04", 0]);
  assert.deepEqual(j.data.rows.map((r) => r.date), [...j.data.rows.map((r) => r.date)].sort().reverse(), "newest first");
});

test("the page: AR Invoices in the Debtors menu, the old address lands on it, the statement at the foot", () => {
  const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
  const side = readFileSync("src/components/layout/sidebar.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(side, /\{ name: "AR Invoices", href: "\/accounting\?tab=arinvoices", icon: BookOpen \},/);
  assert.doesNotMatch(side, /name: "Other Debtor Bills"/);
  for (const key of ["arinvoices", "odebtorbills"]) {
    assert.match(ui, new RegExp(String.raw`\{tab === "${key}" && \(\n\s+<div className="space-y-4">\n\s+<ArInvoicesTab accounts=\{accounts\} \/>\n\s+<CustomerStatementCard \/>`), key);
  }
  const ar = ui.slice(ui.indexOf("function ArInvoicesTab("), ui.indexOf("function OtherPartyBillsTab("));
  // Only the bills and invoices: no aging card, no names list, no receipts fold.
  assert.doesNotMatch(ar, /<OtherPartyAging|<OtherPartiesTab|<OtherPartyPaymentsManager/);
  assert.match(ar, /fetch\("\/api\/accounting\/ar-invoices"\)/);
  assert.match(ar, /const openArInv = \(r: ArInvRow\) => \{ if \(r\.kind === "INV"\) navigate\(`\/invoices\/\$\{encodeURIComponent\(r\.id\)\}`\); else setDetailBillNo\(r\.no\); \};/);
  assert.match(ar, /onClick=\{\(\) => setBillPopup\(\{ mode: "new", scan: true \}\)\}/, "Scan Bill opens the form with its scan box");
  assert.match(ar, /r\.status === "OPEN" && r\.partyId \? \[\{ label: "Receive", action: \(\) => navigate\(receiveHref\(r\)\) \}\] : \[\],/);
  assert.match(ar, /formOnly=\{\{ mode: billPopup\.mode, bill: billPopup\.bill, scan: billPopup\.scan, onDone: \(\) => \{ setBillPopup\(null\); setVer\(\(v\) => v \+ 1\); \} \}\}/);
});

test("Receive: Receipts opens the right door with the document ticked", () => {
  const ui = readFileSync("src/pages/accounting/index.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(ui, /function parseReceiveLink\(raw: string \| null\): \{ kind: "INV" \| "OD"; docId: string; partyId: string \} \| null \{/);
  assert.match(ui, /const \[door, setDoor\] = useState<ReceiptKind \| null>\(receiveLink \? \(receiveLink\.kind === "INV" \? "CUSTOMER" : "OTHER"\) : null\);/);
  assert.match(ui, /if \(!editing && receiveFor\) seeded\[receiveFor\.billId\] = \{ amountStr: "", full: true \};/, "an other-debtor bill ticked in full");
  const pay = readFileSync("src/pages/invoices/payments.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(pay, /const pendingReceive = useRef\(editing \? null : receiveFor\?\.invoiceId \?\? null\);/);
  assert.match(pay, /const owed = inv \? Math\.round\(Number\(inv\.totalSen\) \|\| 0\) - Math\.round\(Number\(inv\.paidAmount\) \|\| 0\) : 0;\n\s*if \(owed > 0\) setAllocations\(\[\{ invoiceId: invId, amount: owed \}\]\);/, "the invoice ticked at what is still owed");
});
