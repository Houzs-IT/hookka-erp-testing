import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boardRefreshPoint, boardKeptIsStale } from "../src/lib/board-report.ts";

// Owner 2026-11-17: the last closed month's report renews itself on the 1st,
// 7th, 10th and 15th. The scheduled pre-build cannot finish a build
// (BUG-2026-11-17-531), so the FIRST OPEN after each of those days rebuilds it.
const wf = readFileSync(".github/workflows/board-report-prebuild.yml", "utf8");
const route = readFileSync("src/api/routes/reports.ts", "utf8");

test("refresh point = 00:00 Malaysia time of the latest 1st/7th/10th/15th", () => {
  assert.equal(boardRefreshPoint("2026-12-01"), "2026-11-30T16:00:00.000Z");
  assert.equal(boardRefreshPoint("2026-12-06"), "2026-11-30T16:00:00.000Z");
  assert.equal(boardRefreshPoint("2026-12-07"), "2026-12-06T16:00:00.000Z");
  assert.equal(boardRefreshPoint("2026-12-12"), "2026-12-09T16:00:00.000Z");
  assert.equal(boardRefreshPoint("2026-12-31"), "2026-12-14T16:00:00.000Z");
});

test("only the last closed month's copy built before the refresh point is stale", () => {
  assert.equal(boardKeptIsStale("2026-11", "2026-12-07", "2026-12-05T03:00:00.000Z"), true, "built before the 7th");
  assert.equal(boardKeptIsStale("2026-11", "2026-12-07", "2026-12-07T01:00:00.000Z"), false, "built on the 7th");
  assert.equal(boardKeptIsStale("2026-11", "2026-12-01", "2026-11-30T10:00:00.000Z"), true, "a mid-month copy of November, opened on 1 Dec");
  assert.equal(boardKeptIsStale("2026-10", "2026-12-07", "2026-11-01T00:00:00.000Z"), false, "older months keep their copy");
  assert.equal(boardKeptIsStale("2026-11", "2026-12-07", undefined), true);
});

test("the first open renews; a poll never does; the pre-build is best-effort", () => {
  assert.match(route, /const renew = !!kept && c\.req\.query\("poll"\) !== "1" && boardKeptIsStale\(month, today,/);
  assert.match(route, /if \(kept && !renew\) return c\.json/);
  assert.match(wf, /cron: '30 16 \* \* \*'/);
  assert.doesNotMatch(wf, /FORCE=true/, "no forced scheduled builds — they cannot finish");
  assert.match(wf, /::warning::Board Report build for \$month did not finish/);
});

test("the pre-build builds in the background like Refresh, and the workflow polls", () => {
  const w = readFileSync("src/api/worker.ts", "utf8");
  const r = w.slice(w.indexOf('app.post("/api/internal/board-report-prebuild"'), w.indexOf('app.post("/api/internal/rebuild-dashboard-snapshot"'));
  assert.match(r, /c\.executionCtx\.waitUntil\(build\.catch/);
  assert.match(r, /if \(body\.check\) \{/);
  assert.match(wf, /check=\$\(jq -nc --arg m "\$month" '\{month:\$m, check:true\}'\)/);
});
