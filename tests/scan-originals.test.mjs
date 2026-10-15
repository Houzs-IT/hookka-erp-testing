// ---------------------------------------------------------------------------
// HK-0005: scan originals live in object storage, are readable inline, and
// every read leaves a trail. Behaviour of the pure helpers + source guards on
// the route (same style as scan-queue-client-driven.test.mjs).
// ---------------------------------------------------------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scanFileKey,
  originalDisposition,
  stashScanBytes,
  readScanBytes,
} from "../src/api/lib/scan-file-store.ts";

test("scanFileKey: org + content hash, so identical bytes share one object", () => {
  assert.equal(scanFileKey("org1", "abc"), "scan-originals/org1/abc");
  assert.equal(scanFileKey(null, "abc"), "scan-originals/_/abc");
});

test("originalDisposition: only pdf and raster images render inline", () => {
  assert.equal(originalDisposition("application/pdf"), "inline");
  assert.equal(originalDisposition("image/jpeg"), "inline");
  assert.equal(originalDisposition("image/svg+xml"), "attachment", "svg can carry script");
  assert.equal(originalDisposition("text/html"), "attachment");
  assert.equal(originalDisposition(""), "attachment");
});

test("stashScanBytes: storage not configured -> falls back to the b64 column", async () => {
  const buf = new Uint8Array([1, 2, 3]).buffer;
  const r = await stashScanBytes({}, "org1", "h1", buf, "application/pdf");
  assert.equal(r.fileKey, null);
  assert.equal(r.b64, "AQID");
});

test("readScanBytes: legacy b64 row still readable; nothing stored -> null", async () => {
  const bytes = await readScanBytes({}, { fileKey: null, fileBytesB64: "AQID" });
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
  assert.equal(await readScanBytes({}, { fileKey: null, fileBytesB64: null }), null);
});

const route = readFileSync(new URL("../src/api/routes/scan-queue.ts", import.meta.url), "utf8");

test("route: no insert writes file bytes into the row when storage took them", () => {
  assert.equal((route.match(/stashScanBytes\(/g) ?? []).length >= 4, true,
    "upload hit+miss and child hit+miss all stash through the store");
  assert.doesNotMatch(route, /toBase64\(/, "the route no longer base64s files itself");
});

test("route: processing and the original sender read through readScanBytes", () => {
  assert.equal((route.match(/readScanBytes\(/g) ?? []).length >= 2, true);
  assert.doesNotMatch(route, /base64ToArrayBuffer\(/);
});

test("route: consume no longer evicts the original", () => {
  assert.doesNotMatch(route, /file_bytes_b64 = NULL\s+WHERE id = \?\s+AND \(org_id/);
  assert.doesNotMatch(route, /consumed_at = \?,\s+file_bytes_b64 = NULL/);
});

test("route: /:id/original serves inline and writes an access-trail row", () => {
  assert.match(route, /app\.get\("\/:id\/original"/);
  assert.match(route, /scan_original_access/);
  assert.match(route, /originalDisposition\(/);
});
