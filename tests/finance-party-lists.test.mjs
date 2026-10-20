// ---------------------------------------------------------------------------
// Finance › Debtor List / Creditor List (owner 2026-10-17, Finance v2 「要」):
// trade customers and other debtors (suppliers and other creditors) in one
// list, each with what its aging row says is outstanding; double-click opens
// the record where it is kept. Made-up data only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { agingTotalSen, customerRows, otherPartyRows, overLimit, supplierRows } from "../src/lib/party-list.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("trade customers: fields read dual-keyed, outstanding from their aging rows, inactive kept", () => {
  const rows = customerRows(
    [
      { id: "c-1", code: "300-A001", name: "A Co", contactName: "Ann", creditTerms: "NET30", creditLimitSen: 100000, phone: "1", email: "a@x", isActive: true },
      { id: "c-2", code: "300-B001", name: "B Co", contact_name: "Ben", credit_terms: "COD", credit_limit_sen: 0, is_active: 0 },
    ],
    new Map([["c-1", 150000]]),
  );
  assert.deepEqual(rows.map((r) => [r.key, r.code, r.contact, r.termsOrNote, r.limitSen, r.outstandingSen, r.active]), [
    ["t:c-1", "300-A001", "Ann", "NET30", 100000, 150000, true],
    ["t:c-2", "300-B001", "Ben", "COD", 0, 0, false],
  ]);
  assert.equal(overLimit(rows[0]), true, "owes more than its limit");
  assert.equal(overLimit({ ...rows[0], limitSen: 0 }), false, "no limit set");
});

test("suppliers: payment terms, no credit limit, inactive / blacklisted read inactive", () => {
  const rows = supplierRows(
    [
      { id: "s-1", code: "400-A001", name: "S1", contactPerson: "Sam", paymentTerms: "60 days", status: "ACTIVE" },
      { id: "s-2", code: "400-B001", name: "S2", status: "BLACKLISTED" },
      { id: "s-3", code: "400-C001", name: "S3" },
    ],
    new Map([["s-1", 5000]]),
  );
  assert.deepEqual(rows.map((r) => [r.termsOrNote, r.limitSen, r.outstandingSen, r.active]), [
    ["60 days", 0, 5000, true], ["", 0, 0, false], ["", 0, 0, true],
  ]);
});

test("other parties: no code, what-for from their notes, outstanding = their open bills", () => {
  const rows = otherPartyRows(
    [{ id: "o-1", name: "Staff loan", notes: "advance", isActive: true }, { id: "o-2", name: "Deposit", is_active: 1 }],
    [{ partyId: "o-1", outstandingSen: 300 }, { partyId: "o-1", outstandingSen: 200 }],
  );
  assert.deepEqual(rows.map((r) => [r.key, r.code, r.termsOrNote, r.outstandingSen, r.active]), [
    ["o:o-1", "", "advance", 500, true], ["o:o-2", "", "", 0, true],
  ]);
  assert.equal(agingTotalSen({ currentSen: 1, days30Sen: 2, days60Sen: 3, days90Sen: 4, over90Sen: 5 }), 15);
});

test("the page: one list per side, chips, KPIs, double-click opens the record where it is kept", () => {
  const tab = read("src/pages/accounting/tabs/PartyListTab.tsx");
  assert.match(tab, /useCachedJson<ListResp>\(debtor \? "\/api\/customers" : "\/api\/suppliers"\)/);
  assert.match(tab, /`\/api\/accounting\/other-parties\?type=\$\{side\}`/);
  assert.match(tab, /`\/api\/accounting\/other-party-aging\?type=\$\{side\}`/);
  assert.match(tab, /owed\.set\(String\(\(debtor \? r\.customerId : r\.supplierId\) \?\? ""\), agingTotalSen\(r\)\);/);
  assert.match(tab, /navigate\(`\/accounting\?tab=\$\{debtor \? "odebtor" : "ocreditor"\}&edit=\$\{encodeURIComponent\(r\.id\)\}`\)/);
  assert.match(tab, /navigate\(`\/customers\?edit=\$\{encodeURIComponent\(r\.id\)\}`\)/);
  assert.match(tab, /navigate\(`\/suppliers\/\$\{encodeURIComponent\(r\.id\)\}`\)/);
  assert.match(tab, /key: "outstandingSen", label: "Outstanding", width: "140px", align: "right", type: "currency", total: "sum"/);
  assert.match(tab, /onDoubleClick=\{open\}/);
  // Right-click: Edit only, to the same place (owner 2026-10-20 「可以加右键edit 就好」).
  assert.match(tab, /contextMenuItems=\{\(\) => \[\{ label: "Edit", action: open \}\]\}/);
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /\{tab === "debtors" && <PartyListTab side="DEBTOR" \/>\}/);
  assert.match(ui, /\{tab === "creditors" && <PartyListTab side="CREDITOR" \/>\}/);
  assert.match(ui, /\{ key: "debtors", label: "Debtor List",/);
  assert.match(ui, /\{ key: "creditors", label: "Creditor List",/);
  const sb = read("src/components/layout/sidebar.tsx");
  assert.match(sb, /\{ name: "Debtor Aging", href: "\/accounting\?tab=ar", icon: Users \},\n\s*\{ name: "Debtor List", href: "\/accounting\?tab=debtors", icon: List \},/);
  assert.match(sb, /\{ name: "Creditor Aging", href: "\/accounting\?tab=ap", icon: Building2 \},\n\s*\{ name: "Creditor List", href: "\/accounting\?tab=creditors", icon: List \},/);
  const nav = read("src/lib/finance-nav.ts");
  assert.match(nav, /debtors: \{ title: "Debtor List",/);
  assert.match(nav, /creditors: \{ title: "Creditor List",/);
});

test("the places a record is kept open it from the list's link", () => {
  const cust = read("src/pages/customers.tsx");
  assert.match(cust, /const \[showAdd, setShowAdd\] = useState\(\(\) => new URLSearchParams\(window\.location\.search\)\.get\("new"\) === "1"\);/);
  assert.match(cust, /const \[editParam\] = useState\(\(\) => new URLSearchParams\(window\.location\.search\)\.get\("edit"\) \|\| ""\);/);
  assert.match(cust, /const cust = data\.find\(\(c\) => c\.id === editParam\);\n[^\n]*\n\s*if \(cust\) openEditCustomer\(cust\);/);
  const sup = read("src/pages/procurement/maintenance.tsx");
  assert.match(sup, /const \[showSupplierForm, setShowSupplierForm\] = useState\(\(\) => new URLSearchParams\(window\.location\.search\)\.get\("new"\) === "1"\);/);
  const ui = read("src/pages/accounting/index.tsx");
  assert.match(ui, /const p = deepLink\.edit \? parties\.find\(\(x\) => x\.id === deepLink\.edit\) : undefined;/);
  assert.match(ui, /if \(p\) startEdit\(p\);\n\s*else if \(deepLink\.isNew\) \{ setEditingId\(null\); setShowForm\(true\); \}/);
});
