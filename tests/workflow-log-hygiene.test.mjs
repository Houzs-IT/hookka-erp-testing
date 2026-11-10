// ---------------------------------------------------------------------------
// workflow-log-hygiene.test.mjs — cross-system review pass 2, H3 B6.
//
// The repo is PUBLIC, so anything a workflow prints is readable by anyone.
// Cron workflows used to `echo "Body: $body"` — the nightly PI->GL backfill
// reply carries `postedRm` and failing invoice numbers. Every reply is now
// passed through scripts/ci/log-safe-body.jq, which keeps only the shape and
// count-like numbers. This test pins that no workflow prints a raw reply and
// runs the filter (when jq is on PATH) against a money-bearing body.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DIR = ".github/workflows";
const FILTER = readFileSync("scripts/ci/log-safe-body.jq", "utf8").trim();
const workflows = readdirSync(DIR).filter((f) => f.endsWith(".yml"));

test("B6: no workflow echoes a raw HTTP reply body", () => {
  for (const f of workflows) {
    const s = readFileSync(`${DIR}/${f}`, "utf8");
    assert.doesNotMatch(s, /echo "Body: \$body"/, `${f} prints the raw reply`);
    assert.doesNotMatch(s, /^\s*echo "\$body"\s*$/m, `${f} prints the raw reply`);
    assert.doesNotMatch(s, /head -c \d+ \/tmp\/beat\.txt/, `${f} prints the raw beat reply`);
  }
});

test("B6: every summarised reply uses the one canonical filter", () => {
  let uses = 0;
  for (const f of workflows) {
    const s = readFileSync(`${DIR}/${f}`, "utf8");
    if (!/counts only/i.test(s)) continue;
    uses++;
    assert.ok(s.includes(`jq -rc '${FILTER}'`), `${f}: filter differs from scripts/ci/log-safe-body.jq`);
  }
  assert.ok(uses >= 15, `expected the filter in the cron workflows, found ${uses}`);
});

let hasJq = true;
try { execFileSync("jq", ["--version"]); } catch { hasJq = false; }

test("B6: the filter hides money, numbers and text, keeps counts", { skip: !hasJq && "jq not installed" }, () => {
  const body = JSON.stringify({
    ok: true, posted: 3, postedRm: 1234567, totalSen: 99, amount: 5,
    failures: [{ invoiceNo: "PI-2026-001", reason: "x" }], error: "PI-2026-002 failed", nScanned: 12,
  });
  const out = execFileSync("jq", ["-rc", FILTER], { input: body }).toString().trim();
  assert.equal(out, "ok=true posted=3 postedRm=<number> totalSen=<number> amount=<number> failures=1 items error=<string> nScanned=12");
  assert.doesNotMatch(out, /PI-2026|1234567/);
});
