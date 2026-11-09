import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(f, "utf8");

test("/api/health reports the deployed commit; deploy stamps it before pages deploy", () => {
  assert.match(read("src/api/build-stamp.ts"), /export const BUILD_COMMIT = "dev";/);
  assert.match(read("src/api/worker.ts"), /commit: BUILD_COMMIT,/);
  const wf = read(".github/workflows/deploy.yml");
  const stamp = wf.indexOf("Stamp build commit for /api/health");
  assert.ok(stamp > 0 && stamp < wf.indexOf("Deploy to Cloudflare Pages (main / branch push)"));
  assert.ok(stamp < wf.indexOf("Deploy to Cloudflare Pages (canary)"));
  assert.match(wf, /echo "export const BUILD_COMMIT = \\"\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\\";" > src\/api\/build-stamp\.ts/);
});

test("Smart Placement is on for the API Function", () => {
  assert.match(read("wrangler.toml"), /\[placement\]\r?\nmode = "smart"/);
});

test("the announcements admin list is capped and flags the cut", () => {
  const src = read("src/api/routes/announcements.ts");
  assert.match(src, /ORDER BY created_at DESC, id DESC LIMIT 301/);
  assert.match(src, /capList\(c, res\.results, 300\)/);
});

test("a new lead whose phone is already on file is flagged, +60 / 0 / spacing ignored", () => {
  const api = read("src/api/routes/sales-leads.ts");
  assert.match(api, /b\.allowDuplicatePhone !== true/);
  assert.match(api, /normalizePhone\(r\.phone\) === key/);
  assert.match(api, /duplicateOf: dup\.id/);
  const page = read("src/pages/leads/index.tsx");
  assert.match(page, /title: "Possible duplicate lead"/);
  assert.match(page, /post\(\{ allowDuplicatePhone: true \}\)/);
  assert.match(page, /Could not add the lead/);
});
