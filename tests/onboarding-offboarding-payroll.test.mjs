// Owner 2026-11-21: onboarding / offboarding must reach payroll on their own.
// SOE SHWE (joined 2026-11-20) was missing from November and December because
// those payslips were generated before he was created and nothing added him.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ps = readFileSync("src/api/routes/payslips.ts", "utf8");
const wk = readFileSync("src/api/routes/workers.ts", "utf8");
const sync = readFileSync("src/api/lib/worker-payroll-sync.ts", "utf8");

test("payslip generation can recompute ONE worker without touching anyone else", () => {
  assert.match(ps, /export async function generatePayslipsForPeriod\(c: Context<Env>, body: GenerateBody\)/);
  assert.match(ps, /DELETE FROM payslips WHERE period = \? AND status = 'DRAFT' AND employeeId IN \(\$\{ph\}\)/);
  assert.match(ps, /status != 'DRAFT' AND employeeId IN \(\$\{ph\}\)/); // refuses an approved worker
  assert.match(ps, /draftDeletions\.length > 0 && !only \? nextId\.replace/); // ids append, never restart
});

test("INACTIVE leavers are paid their last month like RESIGNED", () => {
  assert.doesNotMatch(ps, /status = 'RESIGNED' AND resignedAt LIKE \?/);
  assert.match(ps, /status IN \('RESIGNED','INACTIVE'\) AND resignedAt LIKE \?/);
  assert.equal((ps.match(/status === "RESIGNED" \|\| \w+\??\.status === "INACTIVE"/g) || []).length, 3);
});

test("create / update / deactivate re-sync the worker's draft payslips", () => {
  assert.match(wk, /syncWorkerPayroll\(c, id, \{ fromPeriod: joinDate\.slice\(0, 7\) \}\)/);
  assert.match(wk, /syncWorkerPayroll\(c, id, \{ fromPeriod: affected\[0\], recomputePeriod \}\)/);
  assert.match(wk, /syncWorkerPayroll\(c, id, \{ fromPeriod: leftMonth, recomputePeriod: leftMonth \}\)/);
  // the form's join date is recorded; INACTIVE needs a last working day
  assert.ok(wk.includes('typeof body.joinDate === "string"') && wk.includes(".test(body.joinDate)"));
  assert.match(wk, /nextStatus === "RESIGNED" \|\| nextStatus === "INACTIVE"/);
  assert.match(wk, /resignedAt = COALESCE\(NULLIF\(resignedAt, ''\), \?\)/);
});

test("the sync never touches an approved payslip and follows the one employment rule", () => {
  assert.match(sync, /import \{ employedDuring, periodEnd \} from "\.\.\/\.\.\/lib\/employment";/);
  assert.match(sync, /if \(approved\) \{/);
  assert.match(sync, /DELETE FROM payslips WHERE period = \? AND employeeId = \? AND status = 'DRAFT'/);
});
