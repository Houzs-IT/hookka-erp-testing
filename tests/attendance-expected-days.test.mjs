// Attendance "not in" counts only the days a person was employed
// (owner 2026-11-21: SAN WIN joined and left on 11-10, worked that one day,
// and the dashboard said "10 days not in").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { expectedWorkDays } = await import("../src/pages/dashboards/dashboard-shared-lib.ts");
const days = ["2026-11-03", "2026-11-06", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-20"];

test("joined and left the same day: expected only that day", () => {
  const w = { id: "a", empNo: "EMP-045", status: "RESIGNED", joinDate: "2026-11-10", resignedAt: "2026-11-10", countsToHeadcount: false };
  assert.deepEqual(expectedWorkDays(w, days, "2026-11-10"), ["2026-11-10"]);
});

test("mid-month joiner: nothing before the join date, even if a clock-in is missing on day one", () => {
  const w = { id: "b", empNo: "EMP-046", status: "ACTIVE", joinDate: "2026-11-11", resignedAt: "", countsToHeadcount: true };
  assert.deepEqual(expectedWorkDays(w, days, "2026-11-12"), ["2026-11-11", "2026-11-12", "2026-11-20"]);
});

test("leaver: nothing after the last working day", () => {
  const w = { id: "c", empNo: "EMP-017", status: "RESIGNED", joinDate: "2026-04-22", resignedAt: "2026-11-06", countsToHeadcount: false };
  assert.deepEqual(expectedWorkDays(w, days, "2026-11-03"), ["2026-11-03", "2026-11-06"]);
});

test("no dates on record (old feed): days from the first clock-in, as before", () => {
  const w = { id: "d", countsToHeadcount: true };
  assert.deepEqual(expectedWorkDays(w, days, "2026-11-11"), ["2026-11-11", "2026-11-12", "2026-11-20"]);
});

test("desktop card and phone month log both use expectedWorkDays", () => {
  for (const f of ["src/pages/dashboards/AttendanceLogCard.tsx", "src/pages/m/screens/dashboard/emp-lib.ts"]) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /expectedWorkDays\(w, workDays, \[\.\.\.inDays\]\.sort\(\)\[0\]\)/, f);
  }
});
