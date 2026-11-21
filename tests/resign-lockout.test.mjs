// ---------------------------------------------------------------------------
// resign-lockout.test.mjs — a leaver keeps the worker app up to and including
// their last working day and is locked out from the next day (owner
// 2026-11-21: "等到最后上班日之后才锁"). Was: locked the moment the status
// changed. Guards:
//   1. canUseWorkerApp — the one rule (unit).
//   2. The token resolver applies it, so EVERY worker-token route (worker app,
//      scan-complete, announcements, outsource issues) refuses a leaver's
//      token after the last day — tokens never expire, so this is the lock.
//   3. Login and getWorker apply it too.
//   4. Changing status no longer kills the session before the last day.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canUseWorkerApp } from "../src/lib/employment.ts";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");
const WORKER = read("src/api/routes/worker.ts");
const WORKERS = read("src/api/routes/workers.ts");
const AUTH = read("src/api/routes/worker-auth.ts");

test("canUseWorkerApp: ACTIVE yes; a leaver through the last day, locked the day after", () => {
  assert.equal(canUseWorkerApp({ status: "ACTIVE" }, "2026-11-21"), true);
  assert.equal(canUseWorkerApp({ status: "ACTIVE", resignedAt: null }, "2026-11-21"), true);
  const left = { status: "RESIGNED", resignedAt: "2026-11-21" };
  assert.equal(canUseWorkerApp(left, "2026-11-20"), true, "before the last day");
  assert.equal(canUseWorkerApp(left, "2026-11-21"), true, "ON the last day");
  assert.equal(canUseWorkerApp(left, "2026-11-22"), false, "the day after");
  assert.equal(canUseWorkerApp({ status: "INACTIVE", resignedAt: "2026-11-21T00:00:00Z" }, "2026-11-21"), true);
  assert.equal(canUseWorkerApp({ status: "INACTIVE", resignedAt: "2026-11-21" }, "2026-11-22"), false);
  assert.equal(canUseWorkerApp({ status: "resigned", resignedAt: "2026-11-21" }, "2026-11-22"), false);
});

test("canUseWorkerApp: no last day on record, or an unknown status, is locked", () => {
  assert.equal(canUseWorkerApp({ status: "RESIGNED", resignedAt: null }, "2026-11-21"), false);
  assert.equal(canUseWorkerApp({ status: "RESIGNED", resignedAt: "" }, "2026-11-21"), false);
  assert.equal(canUseWorkerApp({ status: "SUSPENDED", resignedAt: "2026-12-31" }, "2026-11-21"), false);
  assert.equal(canUseWorkerApp({ status: null }, "2026-11-21"), false);
});

test("the token resolver joins the worker and applies the rule (locks every worker-token route)", () => {
  const fn = AUTH.slice(AUTH.indexOf("export async function resolveWorkerToken"));
  assert.match(fn, /JOIN workers w ON w\.id = t\.workerId/);
  assert.match(fn, /w\.resignedAt AS "resignedAt"/);
  assert.match(fn, /canUseWorkerApp\(row, todayYmdMY\(\)\) \? row\.workerId : null/);
});

test("login and getWorker use the same rule, not status === ACTIVE", () => {
  assert.match(AUTH, /if \(!canUseWorkerApp\(worker, todayYmdMY\(\)\)\) \{\s*return c\.json\(\{ success: false, error: "Employee account inactive" \}, 403\)/);
  assert.doesNotMatch(AUTH, /worker\.status !== "ACTIVE"/);
  assert.match(WORKER, /async function getWorker\([\s\S]{0,1600}status, resignedAt,[\s\S]{0,1200}!canUseWorkerApp\(w, todayYmdMY\(\)\)/);
  assert.doesNotMatch(WORKER, /w\.status !== "ACTIVE"/);
});

test("changing status kills the session only once the app is no longer allowed", () => {
  assert.match(WORKERS, /if \(!canUseWorkerApp\(merged, todayYmdMY\(\)\)\) \{\s*await c\.var\.DB\.prepare\("DELETE FROM worker_tokens WHERE workerId = \?"\)/);
  assert.doesNotMatch(WORKERS, /merged\.status !== "ACTIVE"/);
  assert.match(WORKERS, /if \(!updated \|\| !canUseWorkerApp\(updated, lastDay\)\) \{\s*await c\.var\.DB\.prepare\("DELETE FROM worker_tokens WHERE workerId = \?"\)/);
});
