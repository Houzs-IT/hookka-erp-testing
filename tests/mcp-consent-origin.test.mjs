// The AI Connector "Allow" form post must not be refused as cross-site (BUG-2026-11-26-561).
// With Referrer-Policy no-referrer a browser sends `Origin: null` on the form post.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/api/routes/mcp.ts", import.meta.url), "utf8");

test("consent pages are not served with Referrer-Policy no-referrer", () => {
  assert.ok(!/"Referrer-Policy":\s*"no-referrer"/.test(src));
  assert.ok(/"Referrer-Policy":\s*"same-origin"/.test(src));
});

test("approve accepts Origin null only with Sec-Fetch-Site same-origin/none, refuses cross-site", () => {
  assert.match(src, /origin === "null" && \(site === "same-origin" \|\| site === "none"\)/);
  assert.match(src, /site === "cross-site" \|\| site === "same-site"/);
});
