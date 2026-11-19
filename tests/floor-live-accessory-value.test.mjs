// Owner 2026-11-20 「要算配件」: Floor Live's department value includes accessory,
// so it equals Department Revenue for the same department and day.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { valueByDay, valueByDept } from "../src/api/lib/dept-completed.ts";

const rows = [
  { deptCode: "FAB_CUT", date: "2026-11-19", category: "BEDFRAME", totalSen: 1116250 },
  { deptCode: "FAB_CUT", date: "2026-11-19", category: "SOFA", totalSen: 1911375 },
  { deptCode: "FAB_CUT", date: "2026-11-19", category: "ACCESSORY", totalSen: 70000 },
];

test("department value carries accessory; the three add up to Department Revenue", () => {
  const v = valueByDept(rows, "2026-11-19", "2026-11-19").get("FAB_CUT");
  assert.deepEqual(v, { bedframeSen: 1116250, sofaSen: 1911375, accessorySen: 70000 });
  assert.equal(v.bedframeSen + v.sofaSen + v.accessorySen, 3097625, "RM 30,976.25 — the Department Revenue figure");
  assert.equal(valueByDay(rows).get("FAB_CUT|2026-11-19").accessorySen, 70000);
});

test("dashboard 'today' is Malaysia time, not the Workers' UTC clock", () => {
  const src = readFileSync("src/api/routes/dashboard-overview.ts", "utf8");
  assert.match(src, /function myTodayISO\(\)/);
  assert.doesNotMatch(src, /const todayISO = fmtISO\(new Date\(\)\)/);
  assert.doesNotMatch(src, /const todayISOTop = fmtISO\(new Date\(\)\)/);
});
