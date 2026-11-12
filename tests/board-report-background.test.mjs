import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { takeBuildLock, within, cacheKey, lockKey, LOCK_STALE_MS } from "../src/api/lib/board-report-cache.ts";

// Owner 2026-11-10: the page sat on "Building…" for minutes. One build takes
// 10–20 s, but concurrent builds of the same month blocked each other.

function fakeDb(changes) {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      return { bind: (...args) => ({ run: async () => { seen.push({ sql, args }); return { meta: { changes } }; } }) };
    },
  };
}

test("one build per month: the lock is taken atomically, and only when free or stale", async () => {
  const free = fakeDb(1);
  assert.equal(await takeBuildLock(free, "2026-10", Date.parse("2026-11-10T14:00:00Z")), true);
  const { sql, args } = free.seen[0];
  assert.match(sql, /ON CONFLICT\(key\) DO UPDATE SET .* WHERE kv_config\.updated_at < \?/s);
  assert.equal(args[0], lockKey("2026-10"));
  assert.equal(args[3], new Date(Date.parse("2026-11-10T14:00:00Z") - LOCK_STALE_MS).toISOString());
  assert.equal(await takeBuildLock(fakeDb(0), "2026-10"), false, "a fresh lock held elsewhere → do not build");
});

test("within() gives up waiting but the build keeps going", async () => {
  assert.equal(await within(new Promise((r) => setTimeout(() => r("x"), 50)), 5), null);
  assert.equal(await within(Promise.resolve("done"), 50), "done");
  assert.equal(cacheKey("2026-10"), "board_report_cache:2026-10");
});

test("route: cached read, rebuild on request, 'building' instead of a second build, waitUntil", () => {
  const src = readFileSync("src/api/routes/reports.ts", "utf8");
  assert.match(src, /const rebuild = c\.req\.query\("rebuild"\) === "1";/);
  assert.match(src, /cache\.readBoardCache<Report>\(db, month\)/);
  assert.match(src, /if \(!\(await cache\.takeBuildLock\(db, month\)\)\) \{/);
  assert.match(src, /building: true/);
  assert.match(src, /c\.executionCtx\.waitUntil\(/);
  assert.match(src, /withFreshNotes/);
});

test("page: polls while building, Refresh rebuilds, says you can leave", () => {
  const page = readFileSync("src/pages/board-report/index.tsx", "utf8");
  // Polls carry &poll=1 so the server waits for the running build (owner 2026-11-13: Refresh showed the old copy).
  assert.match(page, /const rebuild = reloadKey > 0 && poll === 0 \? "&rebuild=1" : poll > 0 \? "&poll=1" : "";/);
  assert.match(page, /if \(json\.success && json\.building\)/);
  assert.match(page, /you can leave this page/);
});

test("month start: the last closed month is pre-built daily and kept (never rebuilt unless forced)", () => {
  const w = readFileSync("src/api/worker.ts", "utf8");
  assert.match(w, /app\.post\("\/api\/internal\/board-report-prebuild"/);
  assert.match(w, /if \(!body\.force && \(await cache\.readBoardCache\(db, month\)\)\)/);
  assert.match(readFileSync(".github/workflows/board-report-prebuild.yml", "utf8"), /cron: '30 16 \* \* \*'/);
});

test("a poll after Refresh waits for the new build instead of returning the previous copy (owner 2026-11-13)", () => {
  const src = readFileSync("src/api/routes/reports.ts", "utf8");
  const i = src.indexOf('if (!rebuild && c.req.query("poll") === "1")');
  assert.ok(i > 0, "poll guard present");
  assert.ok(i < src.indexOf("cache.readBoardCache<Report>(db, month)"), "checked before the old copy is read");
  assert.match(src.slice(i, i + 400), /Date\.now\(\) - Date\.parse\(started\) < cache\.LOCK_STALE_MS/);
});
