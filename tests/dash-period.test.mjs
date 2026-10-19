// Quarter / year periods for the Command Center (owner 2026-10-17: 季度与年).
import test from "node:test";
import assert from "node:assert/strict";
import { parseDashPeriod } from "../src/api/lib/dash-period.ts";
import { revenueBuckets } from "../src/api/lib/dept-revenue.ts";

test("month, quarter, year and all parse to their months and the period before", () => {
  const m = parseDashPeriod("2026-10");
  assert.deepEqual([m.kind, m.months, m.prevKey, m.startISO, m.lastDayISO], ["month", ["2026-10"], "2026-09", "2026-10-01", "2026-10-31"]);
  const q = parseDashPeriod("2026-q4");
  assert.deepEqual([q.kind, q.key, q.months, q.prevKey, q.prevMonths], ["quarter", "2026-Q4", ["2026-10", "2026-11", "2026-12"], "2026-Q3", ["2026-07", "2026-08", "2026-09"]]);
  assert.equal(parseDashPeriod("2026-Q1").prevKey, "2025-Q4");
  const y = parseDashPeriod("2026");
  assert.deepEqual([y.kind, y.months.length, y.firstYm, y.lastYm, y.prevKey, y.lastDayISO], ["year", 12, "2026-01", "2026-12", "2025", "2026-12-31"]);
  assert.equal(y.monthsSql.split(",").length, 12);
  for (const bad of ["", "all", "2026-13", "2026-Q5", "x'; DROP"]) assert.equal(parseDashPeriod(bad).kind, "all", bad);
});

test("inYm only admits months inside the period; all admits everything", () => {
  const q = parseDashPeriod("2026-Q4");
  assert.equal(q.inYm("2026-11"), true);
  assert.equal(q.inYm("2026-11-05"), true);
  assert.equal(q.inYm("2026-09"), false);
  assert.equal(q.inYm(null), false);
  assert.equal(parseDashPeriod("all").inYm("1999-01"), true);
});

test("revenue buckets: a quarter is weekly inside the quarter, a year is monthly, both stop at today", () => {
  const q = revenueBuckets("2026-Q4", "2026-10-17");
  assert.equal(q.from, "2026-10-01");
  assert.equal(q.to, "2026-10-17");
  assert.equal(q.buckets[0], "2026-09-28"); // Monday of the week holding 10-01
  assert.equal(q.bucketOf("2026-10-15"), "2026-10-12");
  const y = revenueBuckets("2026", "2026-10-17");
  assert.equal(y.buckets.length, 10);
  assert.equal(y.bucketOf("2026-03-09"), "2026-03-01");
  assert.equal(revenueBuckets("2025", "2026-10-17").buckets.length, 12);
});
