// Trade finance: "Fill from Forecast P&L" (owner 2026-11-10: 「这个trade finance
// part 其实我是不是可以从forecast P&L 那边capture supplier 买的…然后我自己决定
// 要不要使用？」 → 「我想要一键按直接填可以吗？额度不够你提醒」 → MEDITEX bought
// in November on NET60 is drawn in January 「可以」 → repayments give the room
// back automatically → 「做」). One click fills the facility's planned drawdowns
// from the Forecast P&L figures of the suppliers it has paid before, each in
// the month it falls due by that supplier's own term, as far as the limit lets
// once each month's repayments are in; what does not fit is reminded, month by
// month (the bank pays it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fc = await import(pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-forecast.ts")).href);

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("tfForecastDue: the facility's suppliers only, each in its due month by its own term; history left out", () => {
  const months = {
    // RM 350,000 of sales in November: a 5% cell is RM 17,500.
    "2026-11": {
      salesSen: 35_000_000, pct: {},
      purchasesByType: { FABRIC: { med: 3_000_000, acacia: 500_000 }, FILLER: { med: { bp: 500 }, other: 200_000 } },
    },
    // Bought in August on NET60: due October, before the table starts.
    "2026-08": { salesSen: 35_000_000, pct: {}, purchasesByType: { FABRIC: { med: 1_000_000 } } },
    // Bought in December on NET30: due January.
    "2026-12": { salesSen: 40_000_000, pct: {}, purchasesByType: { OTHERS: { nly: 400_000 } } },
  };
  const due = fc.tfForecastDue({
    months,
    supplierIds: new Set(["med", "nly"]),
    termMonths: (id) => ({ med: 2, nly: 1 })[id] ?? 1,
    fromYm: "2026-11",
  });
  assert.deepEqual(due, { "2027-01": 3_000_000 + 1_750_000 + 400_000 });
});

const tfSched = {
  yms: ["2026-11", "2026-12", "2027-01", "2027-02"], currentYm: "2026-11", rateBp: 100, tenorDays: 90,
  owedNowSen: 154_251, drawnThisMonthSen: 0, dueBy: { "2026-12": 30_377, "2027-01": 123_874 }, limitSen: 300_000,
};

test("planTfFill: what fits under the limit each month, and what does not, month by month", () => {
  const due = { "2026-11": 122_926, "2026-12": 106_543, "2027-01": 11_650 };
  const r = fc.planTfFill(tfSched, due);
  assert.deepEqual(r.months, { "2026-11": 122_926, "2026-12": 51_456, "2027-01": 11_650 });
  assert.deepEqual(r.shortSen, { "2026-12": 106_543 - 51_456 }, "December is short; January fits again once the repayments are in");
  assert.deepEqual(fc.fillTfFromBills({ ...tfSched, billsDue: due }), r.months, "Fill from bills is the same fill, unchanged");
});

test("planTfFill: a repayment gives the room back the month it is paid", () => {
  // No other debt; 100,000 of room; 90-day tenor, no interest.
  const base = { yms: ["2027-01", "2027-02", "2027-03", "2027-04"], currentYm: "2027-01", rateBp: 0, tenorDays: 90, owedNowSen: 0, drawnThisMonthSen: 0, dueBy: {}, limitSen: 100_000 };
  const r = fc.planTfFill(base, { "2027-01": 80_000, "2027-02": 50_000, "2027-04": 70_000 });
  assert.deepEqual(r.months, { "2027-01": 80_000, "2027-02": 20_000, "2027-04": 70_000 }, "April: January's 80,000 is repaid first, so 70,000 fits");
  assert.deepEqual(r.shortSen, { "2027-02": 30_000 });
});

const api = read("src/api/routes/accounting.ts");
const page = read("src/pages/accounting/index.tsx");

test("the facility inputs carry the Forecast P&L dues of the suppliers it has paid before", () => {
  const fn = api.slice(api.indexOf("async function cfForecastTfFacilities("), api.indexOf('app.get("/cashflow-forecast-inputs"'));
  assert.match(fn, /SELECT id, name, paymentTerms FROM suppliers/);
  assert.match(fn, /tfForecastDue\(\{/);
  assert.match(fn, /forecastDue,/);
});

test("the popup: Fill from Forecast P&L beside Fill from bills, one click, and a reminder of what the limit cannot cover", () => {
  const dlg = page.slice(page.indexOf("function CfForecastInputsDialog("), page.indexOf("\nfunction ", page.indexOf("function CfForecastInputsDialog(") + 10));
  assert.match(dlg, /Fill from Forecast P&L/);
  assert.match(dlg, /fillTf\(f, f\.forecastDue \?\? \{\}, "forecast"\)/);
  assert.match(dlg, /fillTf\(f, f\.billsDue, "bills"\)/);
  assert.match(dlg, /planTfFill\(/);
  assert.match(dlg, /Over the limit:/, "the months the limit cannot cover, and by how much");
  assert.doesNotMatch(dlg, /text-\[#9A3A2D\][^"]*"[^>]*>\s*\{tfNote/, "the reminder is not red (red means negative to the owner)");
});
