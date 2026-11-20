// Owner 2026-11-21: one rule for "is this person an employee on day D", used
// system-wide so onboarding / offboarding reflect the same way everywhere.
import test from "node:test";
import assert from "node:assert/strict";
const e = await import("../src/lib/employment.ts");

test("a new joiner counts from their join date", () => {
  const w = { empNo: "EMP-047", status: "ACTIVE", joinDate: "2026-11-20" };
  assert.equal(e.employedOn(w, "2026-11-19"), false);
  assert.equal(e.employedOn(w, "2026-11-20"), true);
  assert.equal(e.employedDuring(w, "2026-11-01", "2026-11-30"), true);
  assert.equal(e.employedDuring(w, "2026-10-01", "2026-10-31"), false);
});

test("a leaver counts up to and including the last day, in the months they worked", () => {
  const w = { empNo: "EMP-038", status: "RESIGNED", joinDate: "2026-06-24", resignedAt: "2026-10-07" };
  assert.equal(e.employedOn(w, "2026-10-07"), true);
  assert.equal(e.employedOn(w, "2026-10-08"), false);
  assert.equal(e.employedDuring(w, "2026-10-01", "2026-10-31"), true);
  assert.equal(e.employedDuring(w, "2026-11-01", "2026-11-30"), false);
});

test("INACTIVE is a leaver; without a last day it counts as gone", () => {
  assert.equal(e.employedOn({ empNo: "EMP-039", status: "INACTIVE", joinDate: "2026-06-24" }, "2026-07-01"), false);
  assert.equal(e.employedOn({ empNo: "X", status: "INACTIVE", resignedAt: "2026-08-03" }, "2026-08-03"), true);
});

test("test accounts never count; outsource is the flag", () => {
  assert.equal(e.employedOn({ empNo: "TEST-003", status: "ACTIVE" }, "2026-11-21"), false);
  assert.equal(e.isOutsourceWorkerFlag({ isOutsource: 1 }), true);
  assert.equal(e.isOutsourceWorkerFlag({ isOutsource: false }), false);
});

test("the SQL builders bind the same rule", () => {
  assert.equal((e.employedOnSql("w").match(/\?/g) || []).length, e.employedOnParams("2026-11-21").length);
  assert.equal((e.employedDuringSql("w").match(/\?/g) || []).length, e.employedDuringParams("2026-11-01", "2026-11-30").length);
  assert.deepEqual(e.employedDuringParams("2026-11-01", "2026-11-30"), ["2026-11-30", "2026-11-01", "2026-11-01"]);
  assert.equal(e.periodEnd("2026-02"), "2026-02-28");
});
