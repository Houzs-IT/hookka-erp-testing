// Owner 2026-11-24 「board report 跟着原本的改」: keep the 13 pages; the Balance
// sheet page gains a Forecast column + forecast ratios, and the Outlook page the
// Forecast Balance Sheet totals and ratios per month ahead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the board sources read the Forecast Balance Sheet for the report month and the months ahead", () => {
  const src = read("src/api/lib/board-report-sources.ts");
  assert.match(src, /await one\(`\?start=\$\{month\}`\);\s+await one\(""\);/);
  assert.match(src, /dashBsForecast\(fc\.data, op\.data\.balanceSheet\)/);
});

test("Balance sheet: a Forecast column and forecast ratios, same formulas as the dashboard", () => {
  const lib = read("src/lib/board-report.ts");
  assert.match(lib, /const rf = fc \? dashForecastRatios\(cur\.forecast \?\? null, fc\) : null;/);
  assert.match(lib, /forecast: fc\?\.debtPct \?\? null, unit: "%"/);
  const page = read("src/pages/board-report/pages-finance.tsx");
  assert.match(page, /\{d\.hasForecast && <th>Forecast<\/th>\}/);
  assert.doesNotMatch(page, /No balance-sheet forecast is kept in the ERP/);
});

test("Outlook: Forecast Balance Sheet rows per month", () => {
  const page = read("src/pages/board-report/pages-business.tsx");
  for (const label of ["Total assets", "Total liabilities", "Current ratio", "Quick ratio", "Debt to assets"]) assert.ok(page.includes(`<td>${label}</td>`), label);
});
