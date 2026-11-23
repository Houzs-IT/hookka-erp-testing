// ---------------------------------------------------------------------------
// Cash Flow forecast trade finance from the real bills, and the suppliers that
// can use it (owner 2026-11-23):
//   「例如10月真实买了这么多货，那么根据term他12月就可以claim trade finance，那么他
//    会replace forecast P&L 的trade finance 数据」
//   「月份结束才换成真实单据，之前都用 Forecast P&L」 · 「只算还没付的」
//   「在 Supplier maintenance 打勾的供应商，到了 Cash Flow 的 trade finance 弹窗里会
//    自动帮你勾好每个月份，你只需要把不要的月份取消」
// Made-up figures only.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cleanTfPlans, tfActualDueBySupplier, tfAutoTicks, tfForecastDueBySupplier, tfMergeDues, tfToggleOffRow, tfToggleTick,
} from "../src/lib/cashflow-forecast.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const TERM = { "sup-a": 2, "sup-b": 1 };
const termMonths = (id) => TERM[id] ?? 1;

test("a closed month's unpaid bills fall due by the supplier's term; this month's wait for the month to end", () => {
  const due = tfActualDueBySupplier({
    fromYm: "2026-11",
    termMonths,
    bills: [
      { supplierId: "sup-a", date: "2026-10-12", sen: 500_000 }, // Oct, NET60 → Dec
      { supplierId: "sup-a", date: "2026-10-30", sen: 100_000 },
      { supplierId: "sup-b", date: "2026-09-05", sen: 70_000 }, // Sep, NET30 → Oct: past due → Nov
      { supplierId: "sup-b", date: "2026-11-02", sen: 90_000 }, // this month: the Forecast P&L stands for it
      { supplierId: "sup-b", date: "2026-10-03", sen: -5_000 }, // a credit: not a bill to draw on
    ],
  });
  assert.deepEqual(due, { "sup-a": { "2026-12": 600_000 }, "sup-b": { "2026-11": 70_000 } });
});

test("the Forecast P&L counts only from this month's purchases on: a closed month's figures give way to its bills", () => {
  const months = {
    "2026-10": { purchasesByType: { FABRIC: { "sup-a": 999_999 } } },
    "2026-11": { purchasesByType: { FABRIC: { "sup-a": 300_000 } } },
  };
  const all = tfForecastDueBySupplier({ months, termMonths, fromYm: "2026-11" });
  const fromNow = tfForecastDueBySupplier({ months, termMonths, fromYm: "2026-11", firstPurchaseYm: "2026-11" });
  // Without the cut October's forecast draws in December, next to October's real bills.
  assert.deepEqual(all, { "sup-a": { "2026-12": 999_999, "2027-01": 300_000 } });
  // From November's purchases on: November, NET60 → January.
  assert.deepEqual(fromNow, { "sup-a": { "2027-01": 300_000 } });
  assert.equal(fromNow["sup-a"]?.["2026-12"], undefined, "October is closed");
});

test("the two sources add up per supplier and month", () => {
  assert.deepEqual(
    tfMergeDues({ a: { "2026-12": 100 } }, { a: { "2026-12": 50, "2027-01": 7 }, b: { "2027-01": 3 } }),
    { a: { "2026-12": 150, "2027-01": 7 }, b: { "2027-01": 3 } },
  );
});

test("a supplier that can use trade finance is ticked every month it has an amount, but the months unticked", () => {
  const yms = ["2026-11", "2026-12", "2027-01"];
  const suppliers = [
    { id: "a", dueBy: { "2026-12": 100, "2027-01": 200 } },
    { id: "b", dueBy: { "2026-11": 50, "2026-12": 60 } },
    { id: "c", dueBy: { "2026-12": 999 } }, // not ticked in Supplier maintenance
  ];
  assert.deepEqual(tfAutoTicks(suppliers, ["a", "b"], yms, {}), { "2026-11": ["b"], "2026-12": ["a", "b"], "2027-01": ["a"] });
  // Untick b in December: kept; a month that comes into view later is ticked.
  const off = tfToggleTick({}, "b", "2026-12");
  assert.deepEqual(off, { "2026-12": ["b"] });
  assert.deepEqual(tfAutoTicks(suppliers, ["a", "b"], yms, off), { "2026-11": ["b"], "2026-12": ["a"], "2027-01": ["a"] });
  // Tick it again: back on.
  assert.deepEqual(tfToggleTick(off, "b", "2026-12"), {});
  // The name's tick: all off, then all back on.
  const allOff = tfToggleOffRow({}, suppliers[0], yms);
  assert.deepEqual(allOff, { "2026-12": ["a"], "2027-01": ["a"] });
  assert.deepEqual(tfToggleOffRow(allOff, suppliers[0], yms), {});
  // Some off: the name's tick turns them all back on.
  assert.deepEqual(tfToggleOffRow({ "2027-01": ["a"] }, suppliers[0], yms), {});
});

test("the unticked months are saved with the plan", () => {
  const { facilities } = cleanTfPlans({ "310-0020": { months: {}, off: { "2026-12": ["b", "b", " "], bad: ["x"] } } }, new Set(["310-0020"]));
  assert.deepEqual(facilities["310-0020"].off, { "2026-12": ["b"] });
});

test("Supplier maintenance: a Can use trade finance tick, stored and sent back", () => {
  const api = read("src/api/routes/suppliers.ts");
  assert.match(api, /ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tf_eligible INTEGER NOT NULL DEFAULT 0/);
  assert.match(api, /UPDATE suppliers SET tf_eligible = \? WHERE id = \?/);
  assert.match(api, /tfEligible: Number\(row\.tfEligible \?\? row\.tf_eligible \?\? 0\) === 1/);
  const form = read("src/pages/procurement/supplier-form-dialog.tsx");
  assert.match(form, /data-supplier-tf-eligible=""/);
  assert.match(form, /Can use trade finance/);
  assert.match(form, /tfEligible,\n\s+\}\);/);
  assert.match(read("src/pages/suppliers/detail.tsx"), /tfEligible: !!supplier\.tfEligible/);
  assert.match(read("src/pages/procurement/maintenance.tsx"), /tfEligible: s\.tfEligible === true/);
});

test("the forecast and the popup read the dues and the ticks the same way", () => {
  const route = read("src/api/routes/accounting.ts");
  // Real unpaid bills of the closed months + the Forecast P&L from this month on.
  assert.match(route, /tfActualDueBySupplier\(\{ bills, termMonths, fromYm: curYm \}\)/);
  assert.match(route, /firstPurchaseYm: o\.curYm/);
  assert.match(route, /d\.amountSen > 0 && !d\.no\.endsWith\(ADVANCE_DOC_SUFFIX\)/);
  assert.match(route, /const dueBySupplier = tfSupplierDues\(\{ ap: ag\.data\.ap,/);
  // The ticked suppliers drive the plan, their unticked months left out.
  assert.match(route, /SELECT id FROM suppliers WHERE tf_eligible = 1/);
  assert.match(route, /tfEligible\.length \? tfAutoTicks\(tfDues, tfEligible, tfYms, st\.off \?\? \{\}\) : st\.ticks/);
  assert.match(route, /eligibleSupplierIds: tf\.eligibleSupplierIds/);
  const page = read("src/pages/accounting/index.tsx");
  assert.match(page, /tfAuto \? tfAutoTicks\(tfSuppliers, tfEligible, yms, p\.off \?\? \{\}\) : p\.ticks/);
  assert.match(page, /tfAuto \? setOff\(f\.accountCode, \(o\) => tfToggleTick\(o, r\.id, ym\)\)/);
  assert.match(page, /tfAuto \? setOff\(f\.accountCode, \(o\) => tfToggleOffRow\(o, r, yms\)\)/);
  assert.match(page, /tfSuppliers\.filter\(\(x\) => tfEligible\.includes\(x\.id\)\)/);
});

test("the popup shades the cells from real unpaid bills and says what this month's Drawdown includes", () => {
  const route = read("src/api/routes/accounting.ts");
  assert.match(route, /const actualBySupplier = tfActualDuesFromAp\(ag\.data\.ap, termMonthsOf, curYm\);/);
  assert.match(route, /\.\.\.\(actualBySupplier\[id\] \? \{ actualBy: actualBySupplier\[id\] \} : \{\}\)/);
  assert.match(route, /tfMergeDues\(\n\s+tfActualDuesFromAp\(o\.ap, o\.termMonths, o\.curYm\),/);
  const page = read("src/pages/accounting/index.tsx");
  assert.match(page, /const tfCellBg = \(real: boolean, on: boolean\) => \(real \? \(on \? "bg-\[#DCE7F1\]" : "bg-\[#EEF3F8\]"\) : on \? "bg-\[#EFEAE0\]" : ""\);/);
  assert.match(page, /data-tf-real=\{tfRealSen\(r, ym\) > 0 \? "" : undefined\}/);
  assert.match(page, /data-tf-legend-real=""/);
  assert.match(page, /already drawn this month/);
  assert.match(page, /data-tf-drawn-note=""/);
});
