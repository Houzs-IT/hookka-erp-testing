import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Owner 2026-11-11: Mark Delivered goes straight to DELIVERED — the Proof of
// Delivery form (receiver name + signature) is no longer forced.
test("list row Mark Delivered: no POD form, plain DELIVERED transition", () => {
  const src = readFileSync("src/pages/delivery/index.tsx", "utf8");
  assert.doesNotMatch(src, /PODDialog/);
  assert.match(src, /action: \(\) => void handleMarkDeliveredOne\(row\)/);
  assert.match(src, /body: \{ status: "DELIVERED" \},/);
});

test("DO page Mark Delivered: no POD gate; Capture POD stays optional", () => {
  const src = readFileSync("src/pages/delivery/detail.tsx", "utf8");
  assert.doesNotMatch(src, /if \(target === "DELIVERED" && !order\.proofOfDelivery\)/);
  assert.match(src, /Capture POD/);
});
