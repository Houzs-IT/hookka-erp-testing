import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { findClockDayReads, scanSrcApi } from "../scripts/check-clock-dates.mjs";
import { mytWallClock } from "../src/lib/utils.ts";

// `new Date().toISOString().slice(0, 10)` is the UTC date: before 08:00 in
// Malaysia it is YESTERDAY. Every "today" in src must come from todayYmdMY()
// (src/lib/utils.ts), the one place allowed to do the +8h shift.
test("no UTC 'today' left in src", () => {
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["grep", "-nE", String.raw`new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\]|substring\(0, ?10\))`, "--", "src", ":!src/lib/utils.ts"],
      { encoding: "utf8" },
    );
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = no match, the passing case
  }
  assert.equal(out.trim(), "", `UTC today found — use todayYmdMY():\n${out}`);
});

// ── P2 (cross-system review, ported from Houzs#5517) ─────────────────────
// The one-line pattern above missed `const now = new Date(); … now.getMonth()`,
// which is how the UTC document-number month (#1247) got through. The gate
// below (scripts/check-clock-dates.mjs) follows a variable bound to the clock
// across lines.
const lines = (src) => findClockDayReads(src).map((h) => h.line);

test("clock-day detector: flags a clock variable read as a calendar day", () => {
  assert.deepEqual(lines("const now = new Date();\nconst x = 1;\nconst m = now.getMonth();"), [3]);
  assert.deepEqual(lines("function f(now: Date = new Date()) {\n  return now.getFullYear();\n}"), [2]);
  assert.deepEqual(lines("const d = new Date();\nd.setDate(d.getDate() + 14);"), [2]);
  assert.deepEqual(lines("const t = new Date(Date.now());\nconst s = t.toLocaleDateString('en-CA');"), [2]);
  assert.deepEqual(lines("const since = new Date(Date.now() - 7 * 86400000);\nconst y = since.getUTCDate();"), [2]);
  assert.deepEqual(lines("const ym = new Date().toISOString().slice(0, 7);"), [1]);
  assert.deepEqual(lines("const y = new Date().getFullYear();"), [1]);
});

test("clock-day detector: leaves the Malaysia shift, parsed dates and timestamps alone", () => {
  assert.deepEqual(lines("const now = new Date(Date.now() + 8 * 3600 * 1000);\nconst y = now.getUTCFullYear();"), []);
  assert.deepEqual(lines("const d = new Date(anchor);\nd.setMonth(d.getMonth() + 1);"), []);
  assert.deepEqual(lines("const now = new Date();\nconst s = now.toISOString();\nconst t = now.getTime();"), []);
  assert.deepEqual(lines("let d = new Date();\nd = new Date(iso);\nconst m = d.getMonth();"), []);
  assert.deepEqual(
    lines("function a(d: Date = new Date()) { return 1; }\nfunction b(d: Date) {\n  return d.getUTCDay();\n}"),
    [],
  );
  assert.deepEqual(lines("// const now = new Date(); now.getMonth()"), []);
});

test("no un-allowlisted server-clock calendar day in src/api, and no stale allowlist entry", () => {
  const { findings, stale } = scanSrcApi();
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line}  ${f.src}`),
    [],
    "Use todayYmdMY() / mytYymm() / mytWallClock(), or allowlist a genuinely-UTC site with its reason in scripts/data/clock-date-allowlist.json",
  );
  assert.deepEqual(stale.map((s) => `${s.file}  ${s.src}`), [], "remove allowlist entries for fixed sites");
});

test("every allowlist entry carries a reason", () => {
  const { entries } = JSON.parse(readFileSync("scripts/data/clock-date-allowlist.json", "utf8"));
  for (const e of entries) assert.ok(e.reason && e.reason.length > 10, `${e.file}: ${e.src}`);
});

test("mytWallClock reads the Malaysia day through its UTC fields", () => {
  const before = Date.now();
  const d = mytWallClock();
  assert.ok(d.getTime() - before >= 8 * 3600 * 1000 - 5);
  assert.equal(d.toISOString().slice(0, 10), new Date(before + 8 * 3600 * 1000).toISOString().slice(0, 10));
});

test("the sites fixed in P2 use the Malaysia day", () => {
  // LF whatever the checkout (a Windows clone has CRLF on disk).
  const src = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  assert.match(src("src/api/lib/delivery-return-create.ts"), /`DR-\$\{mytYymm\(\)\}-`/);
  assert.match(src("src/api/lib/purchase-return-create.ts"), /`PR-\$\{mytYymm\(\)\}-`/);
  assert.match(src("src/api/lib/purchase-return-create.ts"), /`SDN-\$\{mytYymm\(\)\}-`/);
  assert.match(src("src/api/lib/procurement-agent.ts"), /function todayLocalIso\(\): string \{\n\s+return todayYmdMY\(\);/);
  assert.match(src("src/api/lib/schedule-proposals.ts"), /function localToday\(\): string \{\n\s+return todayYmdMY\(\);/);
  assert.equal((src("src/api/routes/worker.ts").match(/const today = mytWallClock\(\);/g) ?? []).length, 3);
});
