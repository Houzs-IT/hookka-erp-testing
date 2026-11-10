// ---------------------------------------------------------------------------
// scan-missing-key-fail-fast.test.mjs
//
// Staging, 9 Nov 2026: every "Scan to create" failed with "failed after 3
// attempts: ANTHROPIC_API_KEY not configured. Run `npx wrangler secret put …`".
// Two faults: the queue retried a config error three times, and the hint named
// the Workers command — the app runs on Cloudflare Pages, so it set nothing.
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runExtract } from "../src/api/lib/scan-engine.ts";
import { MISSING_ANTHROPIC_KEY_ERROR } from "../src/api/lib/claude-fetch.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("missing key: scan returns the Pages hint before touching the file", async () => {
  const r = await runExtract(null, {}, { kind: "po", bytes: new ArrayBuffer(0), mimeType: "image/jpeg", fileName: "a.jpg" });
  assert.equal(r.ok, false);
  assert.equal(r.error, MISSING_ANTHROPIC_KEY_ERROR);
});

test("the hint names the Pages command and the Preview environment", () => {
  assert.ok(MISSING_ANTHROPIC_KEY_ERROR.startsWith("ANTHROPIC_API_KEY not configured")); // scan-po.ts matches this prefix
  assert.match(MISSING_ANTHROPIC_KEY_ERROR, /wrangler pages secret put ANTHROPIC_API_KEY --project-name hookka-erp-testing --env preview/);
  assert.doesNotMatch(MISSING_ANTHROPIC_KEY_ERROR, /wrangler secret put/);
});

test("no source still tells users to run the Workers command", () => {
  for (const f of ["src/api/lib/scan-engine.ts", "src/api/lib/ocr-distill.ts", "src/api/routes/scan-po.ts", "src/api/worker.ts"]) {
    assert.doesNotMatch(read(f), /npx wrangler secret put ANTHROPIC_API_KEY/, f);
  }
});

test("scan queue does not re-queue a missing-key failure", () => {
  const src = read("src/api/routes/scan-queue.ts");
  assert.match(
    src,
    /attemptNo < MAX_OCR_ATTEMPTS &&[\s\S]{0,200}!result\.error\.startsWith\(MISSING_ANTHROPIC_KEY_ERROR\)/,
    "retry branch must exclude the missing-key error",
  );
  assert.match(src, /failed after \$\{attemptNo\} attempt/, "fail message must count real attempts, not always 3");
});
