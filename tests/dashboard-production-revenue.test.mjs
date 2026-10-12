// ---------------------------------------------------------------------------
// dashboard-production-revenue.test.mjs — Production Revenue on the finance
// dashboard (owner 2026-10-12).
//
// 「我想要把这个 total revenue 放在 revenue 下面，显示 production revenue。原本的
// revenue 改成 sales revenue」+「每个 cost 也要除 production revenue，可以用 "/"
// 分辨」+「这些 cost 和 percentage 我要一个 total 在下面」+「production salary 和
// non-production salary 也需要这个 production revenue 和 %」.
//
// Production Revenue is the Employees › Labor Cost vs Revenue page's Total
// Revenue: a production order's selling value, booked the day its LAST
// upholstery piece completes. One loader serves that page and the dashboard,
// so the two screens can never print different figures for the same month.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch {}
const m = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/production-revenue.ts")).href);

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const UI = read("src/pages/finance-dashboard.tsx");
const API = read("src/api/routes/accounting.ts");
const WHE = read("src/api/routes/working-hour-entries.ts");

test("buckets recognised orders by the month of their recognition date, per category", () => {
  const out = m.productionRevenueByMonth([
    { date: "2026-09-03", category: "BEDFRAME", totalPriceSen: 50000 },
    { date: "2026-09-30", category: "SOFA", totalPriceSen: 120000 },
    { date: "2026-09-30", category: "ACCESSORY", totalPriceSen: 1500 },
    { date: "2026-10-01", category: "BEDFRAME", totalPriceSen: 30000 },
    { date: "", category: "SOFA", totalPriceSen: 999 },
  ]);
  assert.deepEqual(out.get("2026-09"), { bedframe: 50000, sofa: 120000, accessory: 1500, total: 171500 });
  assert.deepEqual(out.get("2026-10"), { bedframe: 30000, sofa: 0, accessory: 0, total: 30000 });
  assert.equal(out.size, 2, "an order with no date is not booked anywhere");
});

test("a period sums its months; a month with nothing booked is zero, a period wholly ahead is null", () => {
  const by = m.productionRevenueByMonth([
    { date: "2026-07-10", category: "SOFA", totalPriceSen: 100 },
    { date: "2026-08-10", category: "BEDFRAME", totalPriceSen: 200 },
  ]);
  assert.deepEqual(m.sumProductionRevenue(by, ["2026-07", "2026-08", "2026-09"], "2026-10"), { bedframe: 200, sofa: 100, accessory: 0, total: 300 });
  assert.deepEqual(m.sumProductionRevenue(by, ["2026-10"], "2026-10"), { bedframe: 0, sofa: 0, accessory: 0, total: 0 });
  assert.equal(m.sumProductionRevenue(by, ["2026-11", "2026-12"], "2026-10"), null);
});

test("the Labor Cost vs Revenue endpoint reads the shared loader, not its own copy", () => {
  assert.match(WHE, /import \{ loadProductionRevenue \} from "\.\.\/lib\/production-revenue";/);
  assert.match(WHE, /await loadProductionRevenue\(c\.var\.DB, from, to\)/);
  // (GET /daily-breakdown keeps its own per-day production value — a different
  // query with its own category and price rules, not this card's concern.)
  const handler = WHE.slice(WHE.indexOf('app.get("/production-revenue"'), WHE.indexOf('app.get("/summary"'));
  assert.doesNotMatch(handler, /WITH per_po AS/, "the endpoint no longer carries its own copy of the SQL");
});

test("the dashboard carries production revenue per period and retires the old cached shape", () => {
  assert.match(API, /productionRevenue: prodRevByMonth \? sumProductionRevenue\(prodRevByMonth, b\.months, nowYm\) : null,/);
  // v15 introduced the field; any later bump keeps it retired.
  assert.match(API, /const DASH_PAYLOAD_V = "v(1[5-9]|[2-9]\d)";/);
  assert.match(API, /sourceTables: \[[\s\S]{0,1800}"job_cards",/, "a completed upholstery card must refresh the snapshot");
});

test("cost structure: SALES REVENUE, then PRODUCTION REVENUE, then the materials, then TOTAL", () => {
  // Cost structure + the salary card (one component draws both salary cards):
  // sales revenue, with production revenue right under it.
  assert.equal((UI.match(/>SALES REVENUE<\/td>[\s\S]{0,1200}?>PRODUCTION REVENUE<\/td>/g) ?? []).length, 2);
  // Sofa takes the accessories, like the sales side (only bedframe sales are their own account).
  assert.match(UI, /csLine === "bedframe" \? p\.bedframe : p\.sofa \+ p\.accessory/);
  assert.match(UI, /point\[`__ppct__\$\{cat\}`\] = pctOf\(amt, prod\);/);
  // The total sums every material in the table, not just the ones drawn.
  assert.match(UI, /for \(const cat of csCats\) \{\n\s*sum \+= point\[cat\] as number;/);
  assert.match(UI, /<td className=\{`\$\{td\} text-left`\}>TOTAL<\/td>/);
});

test("each figure reads 'share of sales / share of production revenue'", () => {
  assert.match(UI, /function PctPair\(/);
  assert.match(UI, /\{p === null \? "-" : `\$\{p\.toFixed\(2\)\}%`\}/);
  assert.match(UI, / \/ \{pp === null \? "-" : `\$\{pp\.toFixed\(2\)\}%`\}/);
  assert.match(UI, /RM · % of sales \/ % of production/);
});

test("both salary cards divide by production revenue too", () => {
  assert.match(UI, /rec\.__prod__ = prod;/);
  assert.match(UI, /rec\[`__ppct__\$\{d\.dept\}`\] = pctOf\(d\.costSen, prod\);/);
  assert.match(UI, /__cardppct__: pctOf\(amount, prod\),/);
});
