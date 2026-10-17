// ---------------------------------------------------------------------------
// A Code column on Debtor / Creditor Aging (owner 2026-10-17, Finance v2
// 「要」). /aging carries each trade row's party code (customers.code /
// suppliers.code), a trade-finance draw shows its TF account, an other party
// (no code in its register) shows "—"; the Excel / PDF export prints the code
// before the name. Made-up data only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildGroupedAgingExportAoa } from "../src/lib/aging-export.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("/aging rows carry their party's code; the cached shape is versioned", () => {
  const api = read("src/api/routes/accounting.ts");
  assert.match(api, /c\.var\.DB\.prepare\("SELECT id, code FROM customers"\)\.all/);
  assert.match(api, /c\.var\.DB\.prepare\("SELECT id, code FROM suppliers"\)\.all/);
  assert.equal((api.match(/customerCode: custCode\.get\(/g) ?? []).length, 2, "invoice rows and advance-only rows");
  assert.equal((api.match(/supplierCode: supCode\.get\(/g) ?? []).length, 2, "bill rows and advance-only rows");
  assert.match(api, /\|due\|notes\|code/);
});

test("the list shows Code first; every spanning cell grows by one", () => {
  const ui = read("src/pages/accounting/index.tsx");
  const t = ui.slice(ui.indexOf("function AgingListTable("), ui.indexOf("const AGING_TYPE_TAG"));
  assert.match(t, /const cols = 9 \+ \(nextDue \? 1 : 0\);/);
  assert.match(t, /<th className="py-3 px-4 text-left text-\[#6B7280\] font-medium">Code<\/th>\n\s*<th className="py-3 px-4 text-left text-\[#6B7280\] font-medium">\{partyHeader\}<\/th>/);
  assert.match(t, /data-aging-code="">\{r\.code \|\| "—"\}<\/td>/);
  assert.equal((t.match(/colSpan=\{nextDue \? 4 : 3\}/g) ?? []).length, 3, "document row, subtotal, total");
  assert.doesNotMatch(t, /colSpan=\{nextDue \? 3 : 2\}/);
  assert.match(ui, /kind: "trade", name: a\.customerName, code: a\.customerCode,/);
  assert.match(ui, /kind: "trade", name: a\.supplierName, code: a\.supplierCode,/);
  assert.match(ui, /kind: "tf", name: src\.lenderName, code: src\.accountCode,/);
});

test("the export prints the code before the party's name", () => {
  const aoa = buildGroupedAgingExportAoa("Customer", [
    { label: "Trade customers", parties: [{ name: "A Customer", code: "300-A001", currentSen: 10000, days30Sen: 0, days60Sen: 0, days90Sen: 0, over90Sen: 0, docs: [{ no: "INV-1", date: "2026-10-01", mo: 0, amountSen: 10000 }] }] },
    { label: "Other debtors", parties: [{ name: "Someone", currentSen: 500, days30Sen: 0, days60Sen: 0, days90Sen: 0, over90Sen: 0, docs: [] }] },
  ]);
  const firsts = aoa.map((r) => r[0]);
  assert.ok(firsts.includes("300-A001  A Customer"));
  assert.ok(firsts.includes("300-A001  A Customer — Total"));
  assert.ok(firsts.includes("Someone"), "no code, just the name");
});
