// ---------------------------------------------------------------------------
// idle-sundays.test.mjs — owner 2026-10-15: 「礼拜天 remove 掉，因为没开工，
// 除非礼拜天开工才拉进来 … 全部的 chart 和数据都是，不要被这个影响了我们的数据」
//   • charts: an idle Sunday (every value 0) is left off the per-day axis;
//     a Sunday with any figure stays (src/lib/idle-sundays.ts)
//   • averages: Daily Capacity / Backlog working days skip idle Sundays and
//     public holidays but COUNT a worked one (src/api/lib/working-days.ts)
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dropIdleSundays, isSundayISO } from "../src/lib/idle-sundays.ts";
import { isWorkingDay, workingDaysBack, workingDaysInRange } from "../src/api/lib/working-days.ts";

// 2026-10-04 and 2026-10-11 are Sundays.
const none = new Set();

test("isSundayISO reads the weekday from the date, and ignores non-day keys", () => {
  assert.equal(isSundayISO("2026-10-04"), true);
  assert.equal(isSundayISO("2026-10-05"), false);
  assert.equal(isSundayISO("2026-10"), false);
});

test("charts: an idle Sunday is dropped, a worked Sunday and a weekday zero stay", () => {
  const rows = [
    { d: "2026-10-03", v: [5, 0] },
    { d: "2026-10-04", v: [0, 0] }, // idle Sunday → dropped
    { d: "2026-10-05", v: [0, 0] }, // weekday zero → a real zero, kept
    { d: "2026-10-11", v: [0, 3] }, // Sunday with work → kept
  ];
  const out = dropIdleSundays(rows, (r) => r.d, (r) => r.v);
  assert.deepEqual(out.map((r) => r.d), ["2026-10-03", "2026-10-05", "2026-10-11"]);
});

test("charts: weekly (Monday) buckets pass through untouched", () => {
  const rows = [{ d: "2026-10-05", v: [0] }, { d: "2026-10-12", v: [0] }];
  assert.equal(dropIdleSundays(rows, (r) => r.d, (r) => r.v).length, 2);
});

test("averages: an idle Sunday / holiday is not a working day, a worked one is", () => {
  assert.equal(isWorkingDay("2026-10-04", none, none), false);
  assert.equal(isWorkingDay("2026-10-04", none, new Set(["2026-10-04"])), true);
  const holiday = new Set(["2026-10-06"]);
  assert.equal(isWorkingDay("2026-10-06", holiday, none), false);
  assert.equal(isWorkingDay("2026-10-06", holiday, new Set(["2026-10-06"])), true);
  assert.equal(isWorkingDay("2026-10-05", none, none), true);
});

test("averages: a month's working days skip idle Sundays but pull a worked Sunday in", () => {
  const idle = workingDaysInRange("2026-10-01", "2026-10-14", none, none);
  assert.equal(idle.length, 12); // 14 days − 2 Sundays
  assert.ok(!idle.includes("2026-10-04"));
  const worked = workingDaysInRange("2026-10-01", "2026-10-14", none, new Set(["2026-10-11"]));
  assert.equal(worked.length, 13);
  assert.ok(worked.includes("2026-10-11"));
});

test("averages: the rolling 7 counts back over working days and includes a worked Sunday", () => {
  assert.deepEqual(workingDaysBack("2026-10-12", 7, none, none), [
    "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-12",
  ]);
  assert.deepEqual(workingDaysBack("2026-10-12", 7, none, new Set(["2026-10-11"])), [
    "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12",
  ]);
});

test("the dashboard builds both windows from the job cards' worked days", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/routes/dashboard-overview.ts"), "utf8");
  assert.match(src, /workingDaysBack\(yesterdayISOForWindows, 7, holidaySet, workedDays\)/);
  assert.match(src, /workingDaysInRange\(monthScope\.start, capEnd, holidaySet, workedDays\)/);
  assert.doesNotMatch(src, /cur\.getDay\(\) !== 0 && !holidaySet\.has\(iso\)/);
});
