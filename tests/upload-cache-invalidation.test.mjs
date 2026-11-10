// O5 (cross-system review 2026-11-10, sister Houzs#5478 / Conts#713): an
// upload clears the read cache, so a just-uploaded file shows at once instead
// of after the cached `/api/files…` list ages out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isUploadBody, uploadInvalidationPrefixes } from "../src/lib/upload-cache-invalidation.ts";

test("any write to the shared file store drops every cached /api/files list", () => {
  const fd = new FormData();
  fd.append("file", new Blob(["x"]), "a.png");
  assert.deepEqual(uploadInvalidationPrefixes("POST", "/api/files", fd), ["/api/files"]);
  assert.deepEqual(uploadInvalidationPrefixes("delete", "/api/files/f-1", undefined), ["/api/files"]);
  assert.deepEqual(uploadInvalidationPrefixes("PATCH", "/api/files/f-1/cover", undefined), ["/api/files"]);
});

test("reads and unrelated JSON saves leave the cache to their own call sites", () => {
  assert.deepEqual(uploadInvalidationPrefixes("GET", "/api/files", undefined), []);
  assert.deepEqual(uploadInvalidationPrefixes("POST", "/api/sales-orders", JSON.stringify({ a: 1 })), []);
  assert.deepEqual(uploadInvalidationPrefixes("POST", "/api/filesystem", JSON.stringify({})), []);
});

test("an upload body sent to a record drops that record's cached reads", () => {
  const fd = new FormData();
  assert.deepEqual(uploadInvalidationPrefixes("POST", "/api/delivery-orders/do-1/pod-photos", fd), [
    "/api/delivery-orders/do-1",
  ]);
  assert.deepEqual(uploadInvalidationPrefixes("PUT", "/api/organisations/logo", new Blob(["x"])), [
    "/api/organisations/logo",
  ]);
  assert.ok(isUploadBody(new Uint8Array(2)));
  assert.ok(!isUploadBody("text"));
  assert.ok(!isUploadBody(null));
});

test("the global fetch patch applies it only to a successful response", () => {
  const src = readFileSync("src/lib/api-client.ts", "utf8");
  const at = src.indexOf("uploadInvalidationPrefixes(methodOf(input, init), pathOf(url), init?.body)");
  assert.ok(at > 0, "api-client.ts must call uploadInvalidationPrefixes");
  const guard = src.lastIndexOf("if (isApiRequest(url) && response.ok)", at);
  assert.ok(guard > 0 && at - guard < 200, "the invalidation must sit under the response.ok guard");
  assert.match(src.slice(at, at + 200), /invalidateCachePrefix\(prefix\)/);
  // It runs after the network call, never before it.
  assert.ok(src.indexOf("response = await originalFetch(") < at);
});
