// scan-step-logs.test.mjs — BUG-2026-10-19-334.
// A PO scan whose request is killed after the AI reply leaves no error on the
// row, so the logs are the only record of how far it got. Pin the markers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("PO extract logs each step after the AI reply", () => {
  const src = read("src/api/lib/scan-engine.ts");
  for (const s of ["ai call start", "ai headers status=", "ai body read chars=", "parsed ok=", "sample insert start", "sample insert done", "corrections replayed"]) {
    assert.ok(src.includes(s), `scan-engine.ts lost the "${s}" marker`);
  }
});

test("queue worker logs claim, extract result and row write", () => {
  const src = read("src/api/routes/scan-queue.ts");
  for (const s of ["claimed attempt=", "extract returned ok=", "row written"]) {
    assert.ok(src.includes(s), `scan-queue.ts lost the "${s}" marker`);
  }
});
