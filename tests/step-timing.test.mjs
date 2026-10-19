// ---------------------------------------------------------------------------
// step-timing.test.mjs — where a slow request spends its time (2026-10-19,
// owner 「优化加载速度」). timed() records a step under the current request;
// the timing middleware sends the steps as s-<name> Server-Timing entries.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { STEP_LIMIT, stepTimingEntries, timed, timedFn, withStepTiming } from "../src/api/lib/step-timing.ts";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("outside a request a timed step just runs", async () => {
  assert.equal(await timed("x", async () => 7), 7);
  await assert.rejects(timed("x", async () => { throw new Error("boom"); }), /boom/);
});

test("inside a request every step is recorded — a failed one too — and nothing else changes", async () => {
  const marks = [];
  const out = await withStepTiming(marks, async () => {
    const a = await timed("gl-window", async () => 1);
    const b = await timed("gl-window", async () => 2);
    const f = timedFn("pnl-window", async (x, y) => x * y);
    const c = await f(3, 4);
    await timed("broken", async () => { throw new Error("no"); }).catch(() => null);
    return a + b + c;
  });
  assert.equal(out, 15);
  assert.deepEqual(marks.map((m) => m.name), ["gl-window", "gl-window", "pnl-window", "broken"]);
  assert.ok(marks.every((m) => Number.isInteger(m.ms) && m.ms >= 0));
});

test("two requests keep their own steps", async () => {
  const m1 = [];
  const m2 = [];
  await Promise.all([
    withStepTiming(m1, async () => { await timed("one", async () => new Promise((r) => setTimeout(r, 5))); }),
    withStepTiming(m2, async () => { await timed("two", async () => new Promise((r) => setTimeout(r, 1))); }),
  ]);
  assert.deepEqual(m1.map((m) => m.name), ["one"]);
  assert.deepEqual(m2.map((m) => m.name), ["two"]);
});

test("Server-Timing entries: one per step, time added up, the slowest first, at most STEP_LIMIT", () => {
  const marks = [
    { name: "gl-window", ms: 100 }, { name: "gl-window", ms: 50 },
    { name: "material-replay", ms: 400 }, { name: "bad name!", ms: 1 },
  ];
  assert.deepEqual(stepTimingEntries(marks), [
    's-material-replay;dur=400;desc="1x"',
    's-gl-window;dur=150;desc="2x"',
    's-bad_name_;dur=1;desc="1x"',
  ]);
  const many = Array.from({ length: STEP_LIMIT + 5 }, (_, i) => ({ name: `s${i}`, ms: i }));
  assert.equal(stepTimingEntries(many).length, STEP_LIMIT);
  assert.deepEqual(stepTimingEntries([]), []);
});

test("the middleware runs each request with its own marks and sends them", () => {
  const obs = read("src/api/lib/observability.ts");
  assert.match(obs, /const stepMarks: StepMark\[\] = \[\];\n\s+try \{\n\s+await withStepTiming\(stepMarks, \(\) => next\(\)\);/);
  assert.match(obs, /parts\.push\(\.\.\.stepTimingEntries\(stepMarks\)\);\n\s+c\.res\.headers\.set\("Server-Timing", parts\.join\(", "\)\);/);
});

test("the slow reports' helpers are timed (names as they appear in Server-Timing)", () => {
  const api = read("src/api/routes/accounting.ts");
  for (const [fn, label] of [
    ["glWindowSigned", "gl-window"], ["loadMaterialCostData", "material-replay"], ["computePnlWindow", "pnl-window"],
    ["blankMonthStock", "blank-month-stock"], ["runningMonthEstimates", "running-estimates"], ["costByLineWindow", "cost-by-line"],
    ["loadBankRecoState", "bank-reco-state"], ["loadDocDateResolver", "doc-dates"], ["loadHistoricalPnl", "pnl-history"],
  ]) {
    assert.match(api, new RegExp(`\\nconst ${fn} = timedFn\\("${label}", ${fn}Untimed\\);\\n`), fn);
    assert.match(api, new RegExp(`\\nasync function ${fn}Untimed\\(`), `${fn}: the body is unchanged under a new name`);
  }
  assert.match(read("src/api/lib/production-stock.ts"), /\nexport const loadPreparedProduction = timedFn\("prod-orders", loadPreparedProductionUntimed\);\n/);
  assert.match(read("src/api/lib/labour-to-date.ts"), /\nexport const loadLabourToDate = timedFn\("labour-to-date", loadLabourToDateUntimed\);\n/);
  assert.match(read("src/api/lib/trade-finance.ts"), /\nexport const loadTfDraws = timedFn\("tf-draws", loadTfDrawsUntimed\);\n/);
});
