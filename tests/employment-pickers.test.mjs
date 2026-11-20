// Owner 2026-11-21 point 6: every picker offers the people employed TODAY by
// the one employment rule (no test accounts, nobody before joining / after
// leaving). Batch 3 of docs/plans/employee-lifecycle-one-rule.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");

test("the shared helper is the employment rule on today's date", async () => {
  const { isPickableWorker } = await import("../src/lib/worker.ts");
  assert.equal(isPickableWorker({ empNo: "EMP-1", status: "ACTIVE", joinDate: "2026-11-20" }, "2026-11-21"), true);
  assert.equal(isPickableWorker({ empNo: "EMP-1", status: "ACTIVE", joinDate: "2026-11-25" }, "2026-11-21"), false);
  assert.equal(isPickableWorker({ empNo: "EMP-2", status: "RESIGNED", resignedAt: "2026-10-07" }, "2026-11-21"), false);
  assert.equal(isPickableWorker({ empNo: "TEST-001", status: "ACTIVE" }, "2026-11-21"), false);
});

test("front-end pickers use it", () => {
  assert.match(read("src/pages/production/index.tsx"), /\.filter\(\(w\) => isPickableWorker\(w\)\)\s*\n\s*\.sort/);
  assert.match(read("src/pages/production/scan.tsx"), /\.filter\(\(w\) => isPickableWorker\(w\)\)/);
  assert.match(read("src/pages/production/fg-scan.tsx"), /isPickableWorker\(w\) && \(picShowAll/);
  assert.equal((read("src/pages/production/folder-detail.tsx").match(/\.filter\(\(w\) => isPickableWorker\(w\)\)/g) || []).length, 2);
  assert.match(read("src/components/worker-penalty-tab.tsx"), /\.filter\(\(w\) => isPickableWorker\(w\) && !taken\.has\(w\.id\)\)/);
  assert.equal((read("src/pages/employees.tsx").match(/isPickableWorker\(w\)/g) || []).length, 3);
});

test("server rosters (leave, push, team, announcements, PIN bulk, scheduling) use it", () => {
  for (const p of ["src/api/routes/leaves.ts", "src/api/routes/push.ts", "src/api/routes/worker.ts", "src/api/routes/announcements.ts", "src/api/routes/workers.ts"]) {
    assert.match(read(p), /employedOnParams\(todayYmdMY\(\)\)/, p);
  }
  assert.match(read("src/api/routes/scheduling.ts"), /employedOn\(w, todayYmdMY\(\)\)/);
});
