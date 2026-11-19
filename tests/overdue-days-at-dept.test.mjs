// Overdue sets list: days a line has sat in its current department (owner
// 2026-11-19 「在这个部门stuck着多少天了」).
import test from "node:test";
import assert from "node:assert/strict";
import { daysAtDept } from "../src/pages/dashboards/days-at-dept.ts";

const cards = [
  { departmentCode: "FAB_CUT", status: "COMPLETED", completedDate: "2026-11-02" },
  { departmentCode: "FAB_SEW", status: "COMPLETED", completedDate: "2026-11-05" },
  { departmentCode: "FOAM", status: "WAITING", completedDate: null },
];

test("counts from the last completion in another department", () => {
  assert.equal(daysAtDept({ status: "IN_PROGRESS", currentDepartment: "FOAM", jobCards: cards }, "2026-11-19"), 14);
});

test("a card already done in the current department does not reset the clock", () => {
  const more = [...cards, { departmentCode: "FOAM", status: "COMPLETED", completedDate: "2026-11-18" }];
  assert.equal(daysAtDept({ status: "IN_PROGRESS", currentDepartment: "FOAM", jobCards: more }, "2026-11-19"), 14);
});

test("first department counts from the start date; finished or unknown gives null", () => {
  assert.equal(daysAtDept({ status: "PENDING", currentDepartment: "FAB_CUT", startDate: "2026-11-15", jobCards: [] }, "2026-11-19"), 4);
  assert.equal(daysAtDept({ status: "COMPLETED", currentDepartment: "PACKING", jobCards: cards }, "2026-11-19"), null);
  assert.equal(daysAtDept({ status: "PENDING", currentDepartment: "FAB_CUT", jobCards: [] }, "2026-11-19"), null);
});
