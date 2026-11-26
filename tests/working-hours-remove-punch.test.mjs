// HK-0178 / BUG-2026-11-26-562: a removed Working Hours row came back on refresh,
// because the grid rebuilds a row from any punch that has no entry, and Remove
// never touched the punch.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function fakeDb(lockedCount = 0) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql: sql.replace(/\s+/g, " "), args });
          return { first: async () => ({ c: lockedCount }) };
        },
      };
    },
  };
}

test("cleanup drops the day's punch + AUTO dock, only once no entry is left", async () => {
  const { punchCleanupStatements } = await import("../src/api/lib/remove-worker-day.ts");
  const db = fakeDb();
  const stmts = punchCleanupStatements(db, "org-1", "worker-a", "2026-11-26");
  assert.equal(stmts.length, 2);
  const [punch, dock] = db.calls;
  assert.match(punch.sql, /^DELETE FROM attendance_records WHERE employeeId = \? AND date = \? AND orgId = \?/);
  assert.match(punch.sql, /clockIn IS NOT NULL OR clockOut IS NOT NULL/, "a leave / stub row without a punch stays");
  assert.match(punch.sql, /NOT EXISTS \(SELECT 1 FROM working_hour_entries WHERE workerId = \? AND date = \?\)/, "split day keeps its punch");
  assert.deepEqual(punch.args, ["worker-a", "2026-11-26", "org-1", "worker-a", "2026-11-26"]);
  assert.match(dock.sql, /^DELETE FROM payroll_hour_deductions WHERE workerId = \? AND date = \? AND source = \?/);
  assert.match(dock.sql, /NOT EXISTS \(SELECT 1 FROM working_hour_entries/);
  assert.deepEqual(dock.args, ["worker-a", "2026-11-26", "AUTO", "worker-a", "2026-11-26"], "a MANUAL dock is never touched");
});

test("payroll lock reads the month of the day", async () => {
  const { isPayrollLocked } = await import("../src/api/lib/remove-worker-day.ts");
  const open = fakeDb(0);
  assert.equal(await isPayrollLocked(open, "2026-11-26"), false);
  assert.deepEqual(open.calls[0].args, ["2026-11"]);
  assert.equal(await isPayrollLocked(fakeDb(3), "2026-11-26"), true);
});

test("routes: /punch before /:id, both batch the cleanup behind the lock", () => {
  const r = read("src/api/routes/working-hour-entries.ts");
  const punch = r.indexOf('app.delete("/punch"');
  const byId = r.indexOf('app.delete("/:id"');
  assert.ok(punch > 0 && punch < byId, "/punch must be registered before /:id");
  for (const start of [punch, byId]) {
    const body = r.slice(start, r.indexOf("\n});\n", start));
    assert.match(body, /requirePermission\(c, "attendance", "delete"\)/);
    assert.match(body, /isPayrollLocked\(c\.var\.DB,[^\n]*\n\s+return c\.json\(\{ success: false, error: PAYROLL_LOCKED_ERROR \}, 409\)/);
    assert.match(body, /c\.var\.DB\.batch\(/);
    assert.match(body, /punchCleanupStatements\(c\.var\.DB, getOrgId\(c\)/);
  }
});

test("grid: a draft row built from a punch removes the punch on the server", () => {
  const p = read("src/pages/employees.tsx");
  const i = p.indexOf("const removeRow = useCallback");
  const body = p.slice(i, p.indexOf("const saveRow = useCallback", i));
  assert.match(body, /if \(!row\.id && \(row\.clockIn \|\| row\.clockOut\)\) \{/);
  assert.match(body, /fetch\(`\/api\/working-hour-entries\/punch\?\$\{q\}`, \{ method: "DELETE" \}\)/);
});
