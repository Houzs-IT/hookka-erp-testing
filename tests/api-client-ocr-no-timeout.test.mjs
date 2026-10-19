// api-client-ocr-no-timeout.test.mjs — BUG-2026-10-19-334.
// The global fetch patch aborted every /api/* call at 30s, including the
// scan-queue /work request, so a PO whose Claude call took 31s was cancelled
// every attempt. OCR paths are exempt; everything else keeps the cap.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const signals = [];
globalThis.window = {
  location: { origin: "https://erp.example", href: "https://erp.example/" },
  fetch: (_input, init) => {
    signals.push(init?.signal);
    return new Promise(() => {});
  },
  addEventListener() {},
};
globalThis.document ??= { cookie: "" };
mock.timers.enable({ apis: ["setTimeout"] });
const { NO_TIMEOUT_PATH } = await import("../src/lib/api-client.ts");

function abortedAfter31s(url) {
  signals.length = 0;
  void window.fetch(url, { method: "POST" });
  mock.timers.tick(31_000);
  return signals[0].aborted;
}

test("OCR requests are not cut at 30s", () => {
  assert.equal(abortedAfter31s("/api/scan-queue/batch/sqb-1/work"), false);
  assert.equal(abortedAfter31s("/api/scan-po/extract"), false);
  assert.equal(abortedAfter31s("/api/scan-supplier/extract"), false);
});

test("every other /api call keeps the 30s cap", () => {
  assert.equal(abortedAfter31s("/api/scan-queue/batch/sqb-1"), true);
  assert.equal(abortedAfter31s("/api/sales-orders"), true);
  assert.ok(!NO_TIMEOUT_PATH.test("/api/scan-queue/batch/sqb-1/work/x"));
});
