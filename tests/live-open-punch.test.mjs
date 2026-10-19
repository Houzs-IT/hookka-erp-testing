// Owner 2026-10-19: the dashboard read 4,000% efficiency mid-morning because
// working hours only land at punch-out. liveSplitRows gives an open punch its
// hours so far — the figure the dashboard now adds for today.
import test from "node:test";
import assert from "node:assert/strict";
import { liveSplitRows } from "../src/api/lib/punch-autofill.ts";
import { HOOKKA_ATTENDANCE } from "../src/lib/attendance-rules.ts";

const total = (rows) => Math.round(rows.reduce((a, r) => a + r.hours, 0) * 100) / 100;

test("open punch: clock-in to now, from shift start, all in the home department", () => {
  const rows = liveSplitRows(7 * 60 + 52, 10 * 60, HOOKKA_ATTENDANCE, "FAB_SEW", [], 0);
  assert.equal(total(rows), 2);
  assert.deepEqual([...new Set(rows.map((r) => r.departmentCode))], ["FAB_SEW"]);
});

test("open punch: lunch comes off once the day passes it", () => {
  const rows = liveSplitRows(8 * 60, 14 * 60, HOOKKA_ATTENDANCE, "FAB_SEW", [], 0);
  assert.equal(total(rows), 5);
});

test("open punch: approved non-production hours are not counted twice", () => {
  const rows = liveSplitRows(8 * 60, 14 * 60, HOOKKA_ATTENDANCE, "FAB_SEW", [], 1.5);
  assert.equal(total(rows), 3.5);
});

test("open punch: a department scan moves the rest of the day", () => {
  const rows = liveSplitRows(8 * 60, 10 * 60, HOOKKA_ATTENDANCE, "FAB_SEW", [{ departmentCode: "PACKING", category: null, atMin: 9 * 60 }], 0);
  const by = Object.fromEntries(rows.map((r) => [r.departmentCode, r.hours]));
  assert.equal(by.FAB_SEW, 1);
  assert.equal(by.PACKING, 1);
});
