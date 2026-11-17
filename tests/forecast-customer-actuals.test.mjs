// Actual sales by customer beside the forecast (owner 2026-11-17, Forecast P&L
// with Sales opened 「sales的actual customer的sales没有show by customer？」): each
// customer row under Sales shows that month's actual sales in the Actual
// column, with an "Other sales" remainder so the customer rows add up to the
// Sales actual — the same shape as the supplier rows under a material
// (tests/forecast-actual-purchases.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { customerActualsFromLegs, customerActualIds } from "../src/lib/forecast-pnl.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("customer documents' revenue legs by month and customer, credit minus debit", () => {
  const isRevenue = (code) => ["500-0000", "500-0020", "510-0000", "520-0000"].includes(code);
  const acts = customerActualsFromLegs(
    [
      // Two invoices for c1 in October, on two sales accounts.
      { customerId: "c1", accountCode: "500-0000", ym: "2026-10", debitSen: 0, creditSen: 100_000 },
      { customerId: "c1", accountCode: "500-0020", ym: "2026-10", debitSen: 0, creditSen: 50_000 },
      // DISCOUNT ALLOWED (a debit on a revenue account) nets against it.
      { customerId: "c1", accountCode: "510-0000", ym: "2026-10", debitSen: 5_000, creditSen: 0 },
      // A credit note's RETURN INWARDS leg nets against c2's month.
      { customerId: "c2", accountCode: "500-0000", ym: "2026-10", debitSen: 0, creditSen: 30_000 },
      { customerId: "c2", accountCode: "520-0000", ym: "2026-10", debitSen: 7_500, creditSen: 0 },
      { customerId: "c2", accountCode: "500-0000", ym: "2026-11", debitSen: 0, creditSen: 12_345 },
      // AR / SST legs, no month, or no customer: not counted.
      { customerId: "c1", accountCode: "300-0000", ym: "2026-10", debitSen: 160_000, creditSen: 0 },
      { customerId: "c1", accountCode: "500-0000", ym: "", debitSen: 0, creditSen: 1 },
      { customerId: "", accountCode: "500-0000", ym: "2026-10", debitSen: 0, creditSen: 1 },
      // An invoice and its void in the same month drop the customer out.
      { customerId: "c3", accountCode: "500-0000", ym: "2026-10", debitSen: 0, creditSen: 900 },
      { customerId: "c3", accountCode: "500-0000", ym: "2026-10", debitSen: 900, creditSen: 0 },
    ],
    isRevenue,
  );
  assert.deepEqual(acts, { "2026-10": { c1: 145_000, c2: 22_500 }, "2026-11": { c2: 12_345 } });
  assert.deepEqual(customerActualIds(acts).sort(), ["c1", "c2"]);
  assert.deepEqual(customerActualIds({}), []);
});

test("the route reads the P&L's own source: revenue-bucket ledger legs of invoices, credit and debit notes", () => {
  const route = read("src/api/routes/accounting.ts");
  const at = route.indexOf('app.get("/forecast/customer-actuals"');
  assert.ok(at > 0, "GET /forecast/customer-actuals exists");
  const body = route.slice(at, route.indexOf("\n});\n", at));
  assert.match(body, /requirePermission\(c, "accounting", "read"\)/);
  assert.match(body, /sourceType LIKE 'invoice%' OR sourceType LIKE 'credit_note%' OR sourceType LIKE 'debit_note%'/);
  assert.match(body, /pnlBucketFor\(code, t, override\) === "REVENUE"/);
  assert.match(body, /dc\.docDate\(/);
  assert.match(body, /legBeforeOpening\(/);
  assert.match(body, /customerActualsFromLegs\(legs, isRevenue\)/);
});

test("Edit forecast: each customer row's Actual cell, customers with actuals listed, and the remainder row", () => {
  const ed = read("src/pages/accounting/monthly-pl-forecast-editor.tsx");
  assert.match(ed, /\/api\/accounting\/forecast\/customer-actuals\?from=\$\{/);
  assert.match(ed, /\.\.\.customerActualIds\(customerActs\)/);
  assert.match(ed, /customerActualCell\(cr\.id\)/);
  assert.match(ed, /!hideUnused \|\| detailUsed\("cu", "", cr\.id\) \|\| customerHasActual\.has\(cr\.id\)/);
  assert.match(ed, /Other sales \(no customer invoice \/ note\)/);
  // The remainder is the Sales row less the customers', so the rows add up.
  assert.match(ed, /r\.fcKey === "sales"\);\n\s*return \(salesRow\?\.values\[j\] \?\? 0\) - allCustomersActualSen\(c\)/);
});
