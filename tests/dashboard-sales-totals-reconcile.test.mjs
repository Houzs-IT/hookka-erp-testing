// ---------------------------------------------------------------------------
// dashboard-sales-totals-reconcile.test.mjs — merged dashboard (owner
// 2026-10-17: 「确认一下数据对不对」). Three Sales cards printed three totals
// for Oct 2026: KPI RM 365,670.06, Sales by Customer RM 363,440.06 (accessory
// lines dropped), Sales by state RM 364,729.06 (created_at, line values,
// DRAFT / ON_HOLD included). All three now use the KPI's definition: confirmed
// SOs (not DRAFT / ON_HOLD / CANCELLED), by SO date, whole order total.
// Source-level pins (house style for routes with no test harness).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

test("Sales by Customer: Total is the customer's whole confirmed-SO value", () => {
  const src = read("src/api/routes/dashboard-overview.ts");
  assert.match(src, /e\.all \+= Number\(r\.soTotalSen\) \|\| 0;/);
  assert.match(src, /totalSen: e\.all,/);
  assert.match(src, /all: concentrationFor\(\(e\) => e\.all\)/);
  assert.doesNotMatch(src, /totalSen: e\.bfVal \+ e\.soVal/);
});

test("Sales by state / Top SKUs: SO date, confirmed only, whole total spread over lines", () => {
  const src = read("src/api/routes/dashboard-prototype.ts");
  assert.match(src, /date: dayKey\(r\.companySODate\) \?\? dayKey\(r\.createdAt\)/);
  assert.match(src, /if \(!so \|\| !isConfirmed\(so\.status\)\) continue;/);
  assert.match(src, /so\.totalSen \* Math\.max\(0, num\(it\.lineTotalSen\)\)\) \/ lineSum/);
});

test("Revenue trend orders use the SO date", () => {
  assert.match(read("src/api/routes/dashboard-prototype.ts"), /const k = dayKey\(r\.companySODate\) \?\? dayKey\(r\.createdAt\);/);
});
