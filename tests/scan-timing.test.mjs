// scan-timing.test.mjs — HK-0005 slice 1: every scan reports how long each
// stage took, so "scanning is slow" can be pinned to a stage before anything
// is sped up. Test 1 is the timer itself; test 2 runs the REAL runExtract
// (supplier path) with a fake DB and a stubbed Claude call and checks the
// scan_timing line it logs. No network, no DB.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanTimer, STAGES } from "../src/api/lib/scan-timing.ts";
import { runExtract } from "../src/api/lib/scan-engine.ts";
import { setClaudeForwarder } from "../src/api/lib/claude-fetch.ts";

function captureLog(fn) {
  const lines = [];
  const real = console.log;
  console.log = (s) => lines.push(String(s));
  return Promise.resolve()
    .then(fn)
    .finally(() => (console.log = real))
    .then(() => lines.filter((l) => l.includes('"scan_timing"')).map((l) => JSON.parse(l)));
}

test("each mark is charged the time since the previous mark; done writes log + metrics", async () => {
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const points = [];
  try {
    const lines = await captureLog(() => {
      const t = scanTimer("po");
      now = 1200; t.mark("decode");
      now = 4200; t.mark("ai");
      now = 4250; t.mark("parse");
      t.done({ ERP_METRICS: { writeDataPoint: (p) => points.push(p) } }, "sqi-1", "ok");
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].total_ms, 3250);
    assert.equal(lines[0].decode_ms, 200);
    assert.equal(lines[0].ai_ms, 3000);
    assert.equal(lines[0].parse_ms, 50);
    assert.equal(lines[0].load_ms, 0);
    assert.deepEqual(points[0].blobs, ["scan", "po", "ok", "sqi-1"]);
    assert.equal(points[0].doubles.length, 1 + STAGES.length);
  } finally {
    Date.now = realNow;
  }
});

test("a broken metrics binding never throws into the scan", () => {
  const real = console.log;
  console.log = () => {};
  try {
    const env = { ERP_METRICS: { writeDataPoint: () => { throw new Error("boom"); } } };
    assert.doesNotThrow(() => scanTimer("supplier").done(env, null, "error"));
  } finally {
    console.log = real;
  }
});

test("runExtract logs one scan_timing line with the AI call in its own stage", async () => {
  const fakeDb = {
    prepare: () => ({
      bind() { return this; },
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 1 } }),
    }),
  };
  const claudeBody = JSON.stringify({
    content: [{ type: "text", text: JSON.stringify({ docs: [{ docNo: "INV-1", lines: [] }] }) }],
  });
  setClaudeForwarder({
    fetch: async () => {
      await new Promise((r) => setTimeout(r, 30));
      return new Response(claudeBody, { status: 200 });
    },
  });
  try {
    const pdf = new TextEncoder().encode("%PDF-1.4 fake").buffer;
    const lines = await captureLog(() =>
      runExtract(fakeDb, { ANTHROPIC_API_KEY: "test-key" }, {
        kind: "supplier",
        bytes: pdf,
        mimeType: "application/pdf",
        fileName: "inv.pdf",
        orgId: "org-1",
        recordSample: true,
      }).then((r) => assert.equal(r.ok, true)),
    );
    assert.equal(lines.length, 1, "exactly one scan_timing line per scan");
    const l = lines[0];
    assert.equal(l.kind, "supplier");
    assert.equal(l.outcome, "ok");
    assert.ok(l.ai_ms >= 25, `the Claude wait lands in ai_ms (got ${l.ai_ms})`);
    for (const s of ["encode", "prep", "parse", "save"]) assert.equal(typeof l[`${s}_ms`], "number");
  } finally {
    setClaudeForwarder(undefined);
  }
});

test("the queue worker shares its timer with runExtract and closes it once", () => {
  const src = readFileSync(new URL("../src/api/routes/scan-queue.ts", import.meta.url), "utf8");
  assert.match(src, /const timer = scanTimer\(next\.kind\)/);
  assert.match(src, /timer\.mark\("decode"\)/);
  assert.match(src, /runExtract\(db, env, \{\s*timer,/);
  assert.match(src, /timer\.done\(env, next\.id,/);
});
