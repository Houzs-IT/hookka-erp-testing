// Helper / 杂工 screens, batch 2b (owner 2026-11-11): Employees page tabs,
// Reports, the daily efficiency email + its low-efficiency lists, the leader
// Team app, the worker history page and the AI assistant tool. Same rule as
// 2a: Production Hours keep helpers; the efficiency figure leaves them out;
// "Overall" names the figure with them; a helper's own row shows "—".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const read = (p) => readFileSync(p, "utf8");
const eff = await import(pathToFileURL(resolve(process.cwd(), "src/api/lib/efficiency-allowance.ts")).href);

test("helper lookup reads an aliased id (a stub that ignores WHERE can't make everyone a helper)", async () => {
  const db = (rows) => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) });
  assert.deepEqual([...(await eff.helperWorkerIds(db([{ id: "a" }, { id: "b" }])))], []);
  assert.deepEqual([...(await eff.helperWorkerIds(db([{ helperId: "a" }, { helper_id: "b" }])))], ["a", "b"]);
});

test("Department Performance route: production efficiency + Overall, helper rows flagged", () => {
  const s = read("src/api/routes/department-performance.ts");
  assert.match(s, /const helperIds = await helperWorkerIds\(c\.var\.DB\);/);
  assert.match(s, /efficiencyPct: work - hw > 0 \? Math\.round\(\(\(prod - hp\) \/ \(work - hw\)\) \* 100\) : 0,/);
  assert.match(s, /\.\.\.\(helperIds\.has\(w\.workerId\) \? \{ isHelper: true \} : \{\}\),/);
  assert.match(s, /avgEfficiencyPct: totalPair\.efficiencyPct,/);
});

test("Employees page: Overall line on the efficiency cards, helpers show — + tag", () => {
  const s = read("src/pages/employees.tsx");
  assert.ok((s.match(/<HelperOverallLine/g) ?? []).length >= 4, "Dept Perf card, day rows, month KPI, header");
  assert.match(s, /if \(workerById\.get\(row\.workerId\)\?\.isHelper\) return -1;/);
  assert.match(s, /productionWorkMins > 0 && !selectedWorker\?\.isHelper/);
  assert.match(s, /\{w\.workingMinutes <= 0 \|\| w\.isHelper \? "—"/);
});

test("Reports: helper rows —, total names Overall", () => {
  const s = read("src/pages/reports.tsx");
  assert.match(s, /w\.workingMinutes > 0 && !w\.isHelper \? `\$\{w\.efficiencyPct\}%` : "—"/);
  assert.match(s, /helpers left out; Overall/);
});

test("daily email + daily report + production brief never list a helper as low efficiency", () => {
  const r = read("src/api/lib/efficiency-report.ts");
  assert.match(r, /const helpers = await helperWorkerIds\(db\);/);
  assert.match(r, /const hasProductionHours = w\.productionWorkingMinutes > 0 && !w\.isHelper;/);
  assert.match(r, /producerWork > 0 \? Math\.round\(\(producerProd \/ producerWork\) \* 100\) : 0,/);
  assert.match(read("src/api/lib/compliance-report.ts"), /\(w\) => !w\.isHelper && w\.productionWorkingMinutes > 0/);
  assert.match(read("src/api/lib/production-brief.ts"), /\.filter\(\(w\) => !w\.isHelper && w\.productionWorkingMinutes > 0 && w\.efficiencyPct < 60\)/);
});

test("leader Team app + worker history + AI tool", () => {
  const w = read("src/api/routes/worker.ts");
  assert.match(w, /const teamHelpers = await helperWorkerIds\(c\.var\.DB\);/);
  assert.match(w, /const leaderHelpers = await helperWorkerIds\(c\.var\.DB\);/);
  const t = read("src/pages/worker/team.tsx");
  assert.match(t, /const hasHours = w\.workingMinutes > 0 && !w\.isHelper;/);
  assert.match(t, /Overall \$\{totals\.overallPct\}% \(incl\. helpers/);
  assert.match(read("src/pages/worker/history.tsx"), /prodHrsMins > 0 && !hist\.isHelper/);
  assert.match(read("src/api/lib/assistant-tools.ts"), /isHelper: true, note: "Helper — assists others; no personal efficiency"/);
});
