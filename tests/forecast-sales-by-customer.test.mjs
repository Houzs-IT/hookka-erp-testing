// Forecast P&L: sales keyed by customer (owner 2026-11-09 「pNL forecast 那边我要
// 根据 customer 去 key-in 他的预计 sales」; spec
// docs/superpowers/specs/2026-11-09-forecast-three-columns-design.md section 4).
// The page and PUT /forecast; the arithmetic is pinned in forecast-pnl.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { forecastSnapshot } from "../src/lib/forecast-snapshot.ts";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const page = read("src/pages/forecast.tsx");
const api = read("src/api/routes/accounting.ts");
const put = api.slice(api.indexOf('app.put("/forecast"'), api.indexOf("\n});\n", api.indexOf('app.put("/forecast"')));

test("PUT /forecast keeps the customer cells and writes Sales as their sum", () => {
  assert.match(put, /const salesByCustomer = cleanSalesByCustomer\(m\.salesByCustomer\);/);
  assert.match(put, /salesSen: forecastSalesSen\(\{ salesSen: m\.salesSen, salesByCustomer \}\)/, "every reader of salesSen sees the same total");
  assert.match(put, /\.\.\.\(Object\.keys\(salesByCustomer\)\.length \? \{ salesByCustomer \} : \{\}\)/, "a month without customers is stored as before");
});

test("the page lists the customers under Sales and saves their cells", () => {
  assert.match(page, /fetch\("\/api\/customers"\)/);
  assert.match(page, /forecastCustomerRows\(/);
  assert.match(page, /salesByCustomer/);
  // A month with any customer cell shows the sum, not the single input.
  assert.match(page, /customerKeyed\(ym\) \?/);
  // A new month does not copy the previous month's customers.
  assert.match(page, /\{ salesStr: "", pct: inherited, customers: \{\} \}/);
  // Every customer cell is checked before Save, like the other money cells.
  assert.match(page, /label: `\$\{ym\} \$\{/);
});

test("snapshot: a customer cell is a change; keying and clearing it again is not", () => {
  const base = { "2026-12": { salesStr: "", pct: {} } };
  const snap = forecastSnapshot(base);
  assert.notEqual(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, customers: { c1: "100000" } } }), snap);
  assert.equal(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, customers: { c1: "" } } }), snap);
  assert.equal(forecastSnapshot({ "2026-12": { salesStr: "", pct: {}, customers: { c1: " " } } }), snap);
});
