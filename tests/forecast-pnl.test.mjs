// Forecast P&L figures, shared by the Forecast page and the Cash Flow
// forecast (docs/superpowers/specs/2026-11-08-cash-flow-forecast-design.md
// 6.2: the salary and expense ratios must equal what /forecast shows).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const fp = await import(pathToFileURL(resolve(process.cwd(), "src/lib/forecast-pnl.ts")).href);

const acct = (code, type, name = code, isPostable = true) => ({ code, name, type, isPostable });
const accounts = [
  acct("701-0010", "COST", "PURCHASE - B.M FABRIC"),
  acct("701-0020", "COST", "PURCHASE - S FABRIC"),
  acct("702-0000", "COST", "PURCHASE - WOODEN", false),
  acct("700-1015", "COST", "CARRIAGE INWARDS"),
  acct("706-0000", "COST", "SST"),
  acct("750-0010", "COST", "PRODUCTION - SALARY"),
  acct("780-0030", "COST", "FACTORY RENTAL"),
  acct("900-S001", "EXPENSE", "STAFF SALARIES"),
  acct("900-0010", "EXPENSE", "UPKEEP"),
  acct("530-0010", "REVENUE", "OTHER INCOME"),
];
const depts = [
  { code: "OFFICE", bucket: "OPEX_SALARIES" },
  { code: "PROD-A", bucket: "DIRECT_LABOUR" },
  { code: "WH", bucket: "FACTORY_OVERHEAD" },
];
const codes = (rows) => rows.map((r) => r.code);

test("forecastEntryAmount: a % of sales, a legacy bare bp, an RM amount", () => {
  assert.equal(fp.forecastEntryAmount(1_000_000, { bp: 1540 }), 154_000);
  assert.equal(fp.forecastEntryAmount(1_000_000, 1540), 154_000);
  assert.equal(fp.forecastEntryAmount(1_000_000, { amtSen: 300_000 }), 300_000);
  assert.equal(fp.forecastEntryAmount(0, { bp: 1540 }), 0);
  assert.equal(fp.forecastEntryAmount(1_000_000, undefined), 0);
});

test("forecastEntryRatio: % keyed, RM keyed, RM keyed with no sales", () => {
  assert.deepEqual(fp.forecastEntryRatio(1_000_000, { bp: 1000 }), { num: 1000, den: 10000 });
  assert.deepEqual(fp.forecastEntryRatio(1_000_000, 1000), { num: 1000, den: 10000 });
  assert.deepEqual(fp.forecastEntryRatio(1_000_000, { amtSen: 50_000 }), { num: 50_000, den: 1_000_000 });
  assert.deepEqual(fp.forecastEntryRatio(0, { amtSen: 50_000 }), { fixedSen: 50_000 });
  assert.deepEqual(fp.forecastEntryRatio(1_000_000, undefined), { num: 0, den: 10000 });
});

test("forecastLineGroups sorts accounts and departments into the page's sections", () => {
  const g = fp.forecastLineGroups(accounts, {}, depts);
  assert.deepEqual(codes(g.materials), ["cat:FABRIC"], "B.M / S fabric fold into one row; the non-postable parent is out");
  assert.deepEqual(codes(g.direct), ["700-1015", "706-0000"]);
  assert.deepEqual(codes(g.labour), ["dept:PROD-A"]);
  assert.deepEqual(codes(g.labourExpDepts), ["dept:OFFICE"]);
  assert.deepEqual(codes(g.labourOvhDepts), ["dept:WH"]);
  assert.deepEqual(codes(g.labourAccounts), ["750-0010"]);
  assert.deepEqual(codes(g.overhead), ["780-0030"]);
  assert.deepEqual(codes(g.otherIncome), ["530-0010"]);
  assert.deepEqual(codes(g.expenses), ["900-0010", "900-S001"]);
  assert.deepEqual(codes(fp.forecastCogsRows(g)), [
    "cat:FABRIC", "700-1015", "706-0000", "dept:PROD-A", "dept:OFFICE", "dept:WH", "750-0010", "780-0030",
  ]);
});

test("forecastMonthFigures: a department month supersedes the 750-x and labour-map accounts", () => {
  const g = fp.forecastLineGroups(accounts, {}, depts);
  const m = {
    salesSen: 1_000_000,
    pct: {
      "cat:FABRIC": { bp: 3000 },
      "dept:PROD-A": { bp: 1000 },
      "750-0010": { bp: 500 },
      "780-0030": { amtSen: 20_000 },
      "900-0010": { bp: 300 },
      "900-S001": { bp: 200 },
    },
  };
  const f = fp.forecastMonthFigures(m, g, new Set(["900-S001"]));
  assert.equal(f.salesSen, 1_000_000);
  assert.equal(f.superseded("750-0010"), true);
  assert.equal(f.superseded("900-S001"), true);
  assert.equal(f.superseded("900-0010"), false);
  assert.equal(f.amt("780-0030"), 20_000);
  assert.equal(f.cogs, 420_000);
  assert.equal(f.exp, 30_000);
  assert.equal(f.oi, 0);
  assert.equal(f.gp, 580_000);
  assert.equal(f.np, 550_000);
});

test("forecastMonthFigures: a month with no department row counts its 750-x accounts", () => {
  const g = fp.forecastLineGroups(accounts, {}, depts);
  const f = fp.forecastMonthFigures({ salesSen: 1_000_000, pct: { "750-0010": { bp: 500 } } }, g, new Set(["900-S001"]));
  assert.equal(f.superseded("750-0010"), false);
  assert.equal(f.cogs, 50_000);
  assert.equal(fp.forecastMonthFigures(undefined, g, new Set()).cogs, 0);
});

// ---- Sales by customer (spec 2026-11-09-forecast-three-columns-design.md 4) ----

test("forecastSalesSen: the customer rows' sum wins once any is keyed; else the single total", () => {
  assert.equal(fp.forecastSalesSen({ salesSen: 999, salesByCustomer: { c1: 600_000, other: 400_000 } }), 1_000_000);
  assert.equal(fp.forecastSalesSen({ salesSen: 500_000, salesByCustomer: { c1: 0, c2: -5 } }), 500_000, "no real customer cell: the total stands");
  assert.equal(fp.forecastSalesSen({ salesSen: 500_000 }), 500_000);
  assert.equal(fp.forecastSalesSen({ salesSen: -1 }), 0);
  assert.equal(fp.forecastSalesSen(undefined), 0);
});

test("forecastMonthFigures: % lines read the customer sum", () => {
  const g = fp.forecastLineGroups(accounts, {}, depts);
  const f = fp.forecastMonthFigures({ salesSen: 1, salesByCustomer: { c1: 600_000, other: 400_000 }, pct: { "cat:FABRIC": { bp: 3000 } } }, g, new Set());
  assert.equal(f.salesSen, 1_000_000);
  assert.equal(f.amt("cat:FABRIC"), 300_000);
  assert.equal(f.gp, 700_000);
});

test("cleanSalesByCustomer: whole sen, positive only, a real key; junk reads as nothing", () => {
  assert.deepEqual(fp.cleanSalesByCustomer({ c1: 600_000.4, " c2 ": 5, other: 0, c3: -1, c4: "x", "": 7 }), { c1: 600_000, c2: 5 });
  assert.deepEqual(fp.cleanSalesByCustomer({ ["x".repeat(65)]: 1 }), {}, "an id longer than any real one is refused");
  assert.deepEqual(fp.cleanSalesByCustomer("junk"), {});
  assert.deepEqual(fp.cleanSalesByCustomer(null), {});
});

test("forecastCustomerRows: active customers and any keyed one, by name; Other last", () => {
  const master = [
    { id: "c2", name: "Beta", isActive: true },
    { id: "c1", name: "alpha", isActive: true },
    { id: "c3", name: "Gamma", isActive: false },
    { id: "c4", name: "Delta", isActive: false },
  ];
  assert.deepEqual(fp.forecastCustomerRows(master, ["c3", "gone", fp.FC_OTHER_CUSTOMER]), [
    { id: "c1", name: "alpha" },
    { id: "c2", name: "Beta" },
    { id: "c3", name: "Gamma" },
    { id: "gone", name: "Unknown customer (gone)" },
    { id: fp.FC_OTHER_CUSTOMER, name: "Other (new customers)" },
  ], "an inactive customer stays while it is keyed; one never keyed is left out");
  assert.deepEqual(fp.forecastCustomerRows([], []), [{ id: "other", name: "Other (new customers)" }]);
});

test("source guard: the Forecast page computes through forecast-pnl", () => {
  const src = readFileSync(resolve(process.cwd(), "src/pages/forecast.tsx"), "utf8");
  assert.match(src, /import \{[^}]*forecastLineGroups[^}]*\} from "@\/lib\/forecast-pnl"/);
  assert.match(src, /forecastMonthFigures\(/);
  assert.doesNotMatch(src, /const catOf = /);
  assert.doesNotMatch(src, /const sumGuard = /);
});
