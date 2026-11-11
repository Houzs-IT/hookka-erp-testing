// Monthly Balance Sheet (owner 2026-11-11 「balance sheet 我也想要看monthly 的
// 可以吗？」): each month-end's sheet — the same figures the Balance Sheet shows
// for that month — side by side, newest first, accounts lined up by code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildBsMatrix, fyMonthsShown } from "../src/lib/bs-monthly.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const e = (accountCode, category, balance, extra = {}) => ({ accountCode, accountName: `${accountCode} name`, category, balance, ...extra });

test("accounts line up across months by code; a month without the account shows 0", () => {
  const m = buildBsMatrix(["2026-11", "2026-10"], {
    "2026-11": [e("310-0010", "CURRENT_ASSET", 5_000), e("300-0000", "CURRENT_ASSET", 7_000)],
    "2026-10": [e("310-0010", "CURRENT_ASSET", 4_000), e("330-0000", "CURRENT_ASSET", 1_000)],
  });
  const ca = m.sections.CURRENT_ASSET;
  assert.deepEqual(ca.rows.map((r) => r.accountCode), ["300-0000", "310-0010", "330-0000"]);
  assert.deepEqual(ca.rows.find((r) => r.accountCode === "300-0000").values, [7_000, 0]);
  assert.deepEqual(ca.rows.find((r) => r.accountCode === "330-0000").values, [0, 1_000]);
  assert.deepEqual(ca.totals, [12_000, 5_000]);
});

test("the sheet's own arrangement per month: net current assets, both sides, the difference", () => {
  const month = [
    e("150-0000", "FIXED_ASSET", 10_000),
    e("310-0010", "CURRENT_ASSET", 6_000),
    e("400-0000", "CURRENT_LIABILITY", 4_000),
    e("480-0000", "LONG_TERM_LIABILITY", 2_000),
    e("200-0000", "EQUITY", 7_000),
    e("NP-CURRENT", "EQUITY", 3_000),
  ];
  const m = buildBsMatrix(["2026-11"], { "2026-11": month });
  assert.deepEqual(m.netCurrent, [2_000]);
  assert.deepEqual(m.left, [12_000]);
  assert.deepEqual(m.right, [12_000]);
  assert.deepEqual(m.diff, [0]);
  // Current Year Earnings stays last in Equity, as on the Balance Sheet.
  assert.deepEqual(m.sections.EQUITY.rows.map((r) => r.accountCode), ["200-0000", "NP-CURRENT"]);
});

test("names and parent accounts come from the newest month that has the account; a month not loaded is all zero", () => {
  const m = buildBsMatrix(["2026-11", "2026-10", "2026-09"], {
    "2026-11": [e("310-0010", "CURRENT_ASSET", 1, { accountName: "Bank (new name)", parentCode: "310-0000", parentName: "Cash & bank" })],
    "2026-10": [e("310-0010", "CURRENT_ASSET", 2, { accountName: "Bank (old name)" })],
  });
  const row = m.sections.CURRENT_ASSET.rows[0];
  assert.equal(row.accountName, "Bank (new name)");
  assert.equal(row.parentCode, "310-0000");
  assert.deepEqual(row.values, [1, 2, 0]);
});

test("the financial year's month-ends shown: from its first month to this month at most, newest first", () => {
  assert.deepEqual(fyMonthsShown({ startYm: "2026-09", endYm: "2027-08" }, "2026-11"), ["2026-11", "2026-10", "2026-09"]);
  assert.deepEqual(fyMonthsShown({ startYm: "2025-09", endYm: "2026-08" }, "2026-11").length, 12);
  assert.deepEqual(fyMonthsShown({ startYm: "2027-09", endYm: "2028-08" }, "2026-11"), []);
});

test("the Balance Sheet page has a Monthly view that reads each month's sheet from the same route", () => {
  const pg = read("src/pages/accounting/index.tsx");
  assert.match(pg, /\{ key: "monthly", label: "Monthly Balance Sheet"/);
  assert.match(pg, /<MonthlyBalanceSheet /);
  const mb = read("src/pages/accounting/monthly-balance-sheet.tsx");
  assert.match(mb, /\/api\/accounting\/pl\?period=\$\{ym\}/);
  assert.match(mb, /buildBsMatrix\(/);
});

test("a month answered from the report's older copy is asked again, as the single sheet does (prod 2026-11-11: a column read from a copy being rebuilt did not match the sheet)", () => {
  const mb = read("src/pages/accounting/monthly-balance-sheet.tsx");
  assert.match(mb, /const next = planStaleRetry\(run, j\);/);
  assert.match(mb, /Updating…/);
  // The forecast's start is the month's own column when the year shows it,
  // else read the same way (a year ahead shows none of its own).
  assert.match(mb, /startInYear \? byMonth\[fc\.startYm\] : fcOpening/);
  assert.match(mb, /loadSheet\(fcStartYm, company,/);
});
