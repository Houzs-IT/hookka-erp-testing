import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Owner 2026-11-17: rebuild the kept Board Report on the 1st, 7th, 10th and 15th
// (Malaysia date) so it opens ready to download without pressing Refresh.
const wf = readFileSync(".github/workflows/board-report-prebuild.yml", "utf8");

test("scheduled runs on the 1st, 7th, 10th and 15th force a rebuild", () => {
  assert.match(wf, /cron: '30 16 \* \* \*'/, "daily at 00:30 Malaysia time");
  assert.match(wf, /day=\$\(TZ=Asia\/Kuala_Lumpur date \+%d\)/);
  assert.match(wf, /\[ "\$day" = "01" \] \|\| \[ "\$day" = "07" \] \|\| \[ "\$day" = "10" \] \|\| \[ "\$day" = "15" \]/);
  assert.match(wf, /FORCE=true/);
  assert.match(wf, /github\.event_name \}\}" = "schedule"/, "a manual run keeps its own force tick");
});

test("the pre-build builds in the background like Refresh, and the workflow polls", () => {
  const w = readFileSync("src/api/worker.ts", "utf8");
  const route = w.slice(w.indexOf('app.post("/api/internal/board-report-prebuild"'), w.indexOf('app.post("/api/internal/rebuild-dashboard-snapshot"'));
  assert.match(route, /c\.executionCtx\.waitUntil\(build\.catch/);
  assert.match(route, /const done = await cache\.within\(build, cache\.BUILD_WAIT_MS\);/);
  assert.match(route, /done \? 200 : 202\)/);
  assert.match(route, /if \(body\.check\) \{/);
  assert.match(wf, /if \[ "\$status" != "202" \]; then/);
  assert.match(wf, /check=\$\(jq -nc --arg m "\$month" '\{month:\$m, check:true\}'\)/);
  assert.match(wf, /\[ "\$gen" \\> "\$started" \]/);
});
