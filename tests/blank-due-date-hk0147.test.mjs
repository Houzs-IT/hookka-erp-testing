// HK-0147 — production job-card Due Date blank by default.
//
// "Blank by default" is the existing Planning > Production Lead Times switch
// ("Auto-schedule due dates" OFF), which the SO-confirm builder already obeys
// (src/api/routes/_shared/production-builder.ts, `blankDueDates`). These pins
// cover the two other job-card writers that ignored it, and the one reader that
// counted a blank ('') due date as overdue ('' < '2026-11-12' is TRUE in text
// comparison). Source-level, same pattern as production-overdue-counts.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

test("dept overdue count skips a blank ('') job-card due date", () => {
  const src = read("src/api/routes/production-orders.ts");
  assert.match(
    src,
    /AND jc\.dueDate IS NOT NULL\s+AND jc\.dueDate <> ''\s+AND jc\.dueDate < \?/,
    "a cleared due date must not count as overdue on a department tab",
  );
});

test("stock PO job cards honour the auto-schedule switch", () => {
  const src = read("src/api/routes/production-orders.ts");
  const stock = src.slice(src.indexOf('app.post("/stock"'), src.indexOf('app.post("/resync-po-numbers"'));
  assert.match(stock, /const blankDueDates = !\(await loadLeadTimeSettings\(db\)\)\.autoScheduleEnabled;/);
  assert.match(stock, /blankDueDates \? "" : targetEndDate,/);
});

test("job-card sync from BOM honours the auto-schedule switch", () => {
  const src = read("src/api/routes/jobcard-sync.ts");
  assert.match(src, /const blankDueDates = !\(await loadLeadTimeSettings\(db\)\)\.autoScheduleEnabled;/);
  assert.match(src, /const dueDate = blankDueDates \? "" : po\.targetEndDate/);
});

// Reopened 2026-11-16: the clear on 12 Nov blanked 10,096 cards; the Production
// Agent's heartbeat wrote 9,908 of them back within a day, because neither the
// proposal generator nor the auto-approve drain read the switch.
test("Production Agent proposals honour the auto-schedule switch", () => {
  const src = read("src/api/lib/schedule-proposals.ts");
  const gate = /if \(!\(await loadLeadTimeSettings\(db\)\)\.autoScheduleEnabled\) \{/;
  const gen = src.slice(src.indexOf("export async function generateProposals"), src.indexOf("computeChainWithAssignments(db)"));
  assert.match(gen, gate, "generateProposals must stop before the engine runs");
  const apply = src.slice(src.indexOf("export async function applyPendingProposals"), src.indexOf("FROM schedule_proposals WHERE status = 'PENDING'\n        ORDER BY"));
  assert.match(apply, gate, "the drain must stop before it reads the queue");
});
