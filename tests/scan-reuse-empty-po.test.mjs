// BUG-2026-11-23-543 — an empty customer-PO read was reused for the same file bytes, so Retry on
// the phone "Scan Sales Order" sheet returned "No purchase order was found" again without a new read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isReusableRead } from "../src/api/lib/scan-reuse.ts";

test("an empty PO read is never reused", () => {
  assert.equal(isReusableRead("po", { pos: [] }), false);
  assert.equal(isReusableRead("po", { pos: [{ customerPO: "A", items: [] }] }), false);
  assert.equal(isReusableRead("po", '{"pos":[]}'), false);
  assert.equal(isReusableRead("po", "not json"), false);
  assert.equal(isReusableRead("po", null), false);
});

test("a PO read with item lines is reused, as stored (object or JSON text)", () => {
  assert.equal(isReusableRead("po", { pos: [{ items: [] }, { items: [{ qty: 1 }] }] }), true);
  assert.equal(isReusableRead("po", '{"pos":[{"items":[{"qty":1}]}]}'), true);
});

test("supplier reads keep the old rule (any stored result)", () => {
  assert.equal(isReusableRead("supplier", { docs: [] }), true);
  assert.equal(isReusableRead("supplier", null), false);
});

test("both scan-queue cache lookups go through isReusableRead", () => {
  const src = readFileSync(new URL("../src/api/routes/scan-queue.ts", import.meta.url), "utf8");
  assert.equal(src.match(/cacheSource && isReusableRead\(/g)?.length, 2);
  assert.ok(!/cacheSource && cacheSource\.rawJson != null/.test(src), "an unguarded cache hit is back");
});
