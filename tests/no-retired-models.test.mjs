// no-retired-models.test.mjs — BUG-2026-10-29-394. Hookka AI and the agents'
// AI focus were pinned to claude-sonnet-4-5-20250929 after Anthropic stopped
// serving it, so every call came back 404 not_found_error. No call site may
// name that model again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RETIRED = ["claude-sonnet-4-5-20250929"];

test("the assistant and the agent brain do not use a retired model", () => {
  for (const f of ["src/api/routes/assistant.ts", "src/api/lib/agent-brain.ts"]) {
    const code = readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "");
    for (const m of RETIRED) assert.ok(!code.includes(`"${m}"`), `${f} still calls ${m}`);
  }
});
