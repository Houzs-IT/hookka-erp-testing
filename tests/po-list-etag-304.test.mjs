// ---------------------------------------------------------------------------
// po-list-etag-304.test.mjs
//
// /production polls the PO list every 8s and re-downloaded ~906 KB each time
// (measured on prod 2026-10-15), almost always an identical body. The list now
// carries an ETag and answers 304 when If-None-Match matches. Also pins the
// background refresh reading the cache version BEFORE it builds the body, so a
// write landing mid-build can't stamp the old body as fresh.
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  /* native type-stripping handles the .ts import */
}

const { poListBodyHash, poListBodyResponse, schedulePoListBodyRefresh, inFlightPoListBodyRefreshes } =
  await import("../src/api/routes/production-orders/_helpers.ts");

const BODY = JSON.stringify({ success: true, data: [{ id: "po-1" }], total: 1 });

test("matching If-None-Match gets a 304 with no body", async () => {
  const h = await poListBodyHash(BODY);
  const res = poListBodyResponse(`"${h}"`, BODY, h, "HIT");
  assert.equal(res.status, 304);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("ETag"), `"${h}"`);
});

test("a weak W/ tag (Cloudflare compression) still matches", async () => {
  const h = await poListBodyHash(BODY);
  assert.equal(poListBodyResponse(`W/"${h}"`, BODY, h, "HIT").status, 304);
});

test("a mismatched tag gets the full 200 with the current ETag", async () => {
  const h = await poListBodyHash(BODY);
  const res = poListBodyResponse(`"deadbeef"`, BODY, h, "MISS");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("ETag"), `"${h}"`);
  assert.equal(await res.text(), BODY);
});

test("an old KV entry with no hash sends no ETag", () => {
  const res = poListBodyResponse(`"anything"`, BODY, undefined, "HIT");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("ETag"), null);
});

test("background refresh stamps the version read BEFORE the build", async () => {
  const kvStore = new Map([["pos:version:org-1", "100"]]);
  const puts = [];
  const tasks = [];
  const c = {
    env: {
      SESSION_CACHE: {
        get: async (k) => kvStore.get(k) ?? null,
        put: async (k, v, opts) => puts.push({ k, v, opts }),
      },
    },
    executionCtx: { waitUntil: (p) => tasks.push(p) },
  };
  const payload = { success: true, data: [], total: 0 };
  schedulePoListBodyRefresh(c, "org-1", "pos:body:org-1:x", async () => {
    // A scan commits and bumps the version while the body is being built.
    kvStore.set("pos:version:org-1", "200");
    return payload;
  });
  await Promise.all(tasks);
  assert.equal(inFlightPoListBodyRefreshes.size, 0);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].opts.metadata.v, "100", "stamped the post-write version on a pre-write body");
  assert.equal(puts[0].opts.metadata.h, await poListBodyHash(JSON.stringify(payload)));
});

test("worker: only ETag replies drop no-store", () => {
  const src = readFileSync(resolve(process.cwd(), "src/api/worker.ts"), "utf8");
  assert.match(src, /c\.res\.headers\.has\("ETag"\)\s*\?\s*"private, no-cache"\s*:\s*"no-store, no-cache, must-revalidate, max-age=0"/);
});
