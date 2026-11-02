// hub-health.test.mjs — the health report tells the IT Hub which feature and
// model is failing and why, and a part that breaks becomes a red card.
import test from "node:test";
import assert from "node:assert/strict";
import { aiCheck, aiFailure, aiProblems, measureHealth } from "../src/api/lib/hub-health.ts";

const call = (feature, model, ok, http_status, created_at = "2026-11-02T01:00:00.000Z") => ({
  feature, model, ok, http_status, created_at,
});

test("a failure's status says what is wrong and whether it needs a person", () => {
  assert.equal(aiFailure(401).status, "critical");
  assert.equal(aiFailure(404).reason, "Model not available");
  assert.equal(aiFailure(404).status, "critical");
  assert.equal(aiFailure(400).status, "warning");
  assert.equal(aiFailure(529).status, "warning");
  assert.equal(aiFailure(null).reason, "Could not reach Anthropic");
});

test("the card names the feature, the model and the reason", () => {
  const c = aiCheck("ocr", "OCR", "idle", [
    call("scan_po", "claude-sonnet-4-6", 0, 404),
    call("scan_po", "claude-sonnet-4-6", 0, 404),
  ], true);
  assert.equal(c.status, "critical");
  assert.equal(c.summary, "PO scan, claude-sonnet-4-6: 2 of 2 failed in 24h. Model not available");
});

test("the latest call decides: working again is not a problem", () => {
  const c = aiCheck("ocr", "OCR", "idle", [
    call("scan_po", "m", 1, 200),
    call("scan_po", "m", 0, 401),
  ], true);
  assert.equal(c.status, "ok");
  assert.match(c.summary, /1 failed but working since/);
});

test("one model failing shows even when another is fine", () => {
  const c = aiCheck("ocr", "OCR", "idle", [
    call("scan_po", "good", 1, 200),
    call("scan_supplier_do", "old", 0, 404),
  ], true);
  assert.equal(c.status, "critical");
  assert.match(c.summary, /Supplier DO scan, old/);
});

test("no calls is idle, a missing key is red", () => {
  assert.equal(aiCheck("ocr", "OCR", "No scans", [], true).status, "ok");
  assert.equal(aiCheck("ocr", "OCR", "No scans", [], false).status, "critical");
});

test("the problem list holds only failures, at most ten", () => {
  const rows = [call("a", "m", 1, 200), ...Array.from({ length: 12 }, () => call("scan_po", "m", 0, 529))];
  const p = aiProblems(rows);
  assert.equal(p.length, 10);
  assert.equal(p[0].where, "PO scan, m");
  assert.equal(p[0].error, "Anthropic overloaded");
});

function stubDb({ failAll = false, calls = [] } = {}) {
  const stmt = (sql) => {
    const run = async (kind) => {
      if (failAll) throw new Error("connection secret detail");
      if (kind === "all") return { results: /ai_usage_events/.test(sql) ? calls : [] };
      if (/outbox_emails/.test(sql)) return { failed: 0, stuck: 0 };
      return { x: 1 };
    };
    return { bind: () => stmt(sql), first: () => run("first"), all: () => run("all"), run: () => run("run") };
  };
  return { prepare: stmt };
}

const ENV = { ANTHROPIC_API_KEY: "x", RESEND_API_KEY: "x" };

test("a healthy report is ok and has the three cards", async () => {
  const r = await measureHealth(stubDb(), ENV);
  assert.equal(r.ok, true);
  assert.equal(r.db.ok, true);
  assert.deepEqual(r.checks.map((c) => c.key), ["ocr", "ai", "email"]);
});

test("OCR and other AI are separate cards", async () => {
  const r = await measureHealth(stubDb({ calls: [call("assistant", "m", 0, 401)] }), ENV);
  assert.equal(r.checks.find((c) => c.key === "ocr").status, "ok");
  assert.equal(r.checks.find((c) => c.key === "ai").status, "critical");
  assert.equal(r.ok, false);
});

test("a dead database still gives a report, and hides the driver's message", async () => {
  const r = await measureHealth(stubDb({ failAll: true }), ENV);
  assert.equal(r.ok, false);
  assert.equal(r.db.ok, false);
  assert.ok(!JSON.stringify(r).includes("secret detail"));
});
