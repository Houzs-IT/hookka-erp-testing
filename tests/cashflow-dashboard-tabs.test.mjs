import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
try { register("tsx/esm", pathToFileURL("./")); } catch { /* native strip */ }
const cf = await import(
  pathToFileURL(resolve(process.cwd(), "src/lib/cashflow-engine.ts")).href
);

// June 2026 as the statement printed it, in RM (BUG-2026-11-06-427).
const JUNE = [
  { section: "REVENUE_COLLECTION", value: 300000 },
  { section: "RAW_MATERIALS", value: -322327 },
  { section: "CAPEX", value: -990 },
  { section: "FINANCE_COST", value: -150 },
  { section: "LOAN", value: -10000 },
  { section: "UNALLOCATED", value: -36734 },
];

test("investing and financing come from the account lines", () => {
  assert.equal(cf.cashflowTabTotals(JUNE, "investing").total, -990);
  assert.equal(cf.cashflowTabTotals(JUNE, "financing").total, -46884);
});

test("free cash flow is operating less capex", () => {
  assert.equal(cf.cashflowTabTotals(JUNE, "operating").total, -22327);
  assert.equal(cf.cashflowTabTotals(JUNE, "freeCashFlow").total, -23317);
});

test("the three tabs add up to the whole cash movement", () => {
  const sum = ["operating", "investing", "financing"].reduce((s, t) => s + cf.cashflowTabTotals(JUNE, t).total, 0);
  assert.equal(sum, -70201);
});

test("every statement section sits in exactly one tab", () => {
  for (const sec of cf.SECTION_ORDER) {
    const hits = ["operating", "investing", "financing"].filter((t) => cf.sectionInCashflowTab(sec, t));
    assert.equal(hits.length, 1, sec);
  }
  for (const sec of cf.OPERATING_SECTIONS) assert.ok(cf.sectionInCashflowTab(sec, "operating"), sec);
});

test("money in and out add up to the tab total", () => {
  const lines = [{ section: "TRADE_FINANCE", value: 100 }, { section: "TRADE_FINANCE", value: -30 }];
  assert.deepEqual(cf.cashflowTabTotals(lines, "financing"), { total: 70, inflow: 100, outflow: -30 });
});

test("the dashboard no longer looks for subtotal rows", () => {
  const src = readFileSync("src/api/routes/accounting.ts", "utf8");
  assert.ok(!/kind === "subtotal" && r\.section === "CAPEX"/.test(src));
});

test("saving the forecast drops the stored dashboards", () => {
  const src = readFileSync("src/api/routes/accounting.ts", "utf8");
  const put = src.slice(src.indexOf('app.put("/forecast"'));
  assert.ok(put.indexOf("DELETE FROM accounting_dashboard_snapshot") > 0);
  assert.ok(put.indexOf("DELETE FROM accounting_dashboard_snapshot") < put.indexOf("LANDED COST"));
});
